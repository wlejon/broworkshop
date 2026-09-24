// The trainer: owns the net, the replay buffer, the SGD trainer and the
// checkpoints. Self-play happens in mcts_worker.js.
//
// In:  { type: 'init', ckptDir }                  start (ckptDir defaults to ckpt)
//      { type: 'tuples', tuples, weight }         training data (via the page)
//      { type: 'trajectory_end', totalReturn }    for the best-mean metric
// Out: { type: 'weights', version, bytes, stats } after training publishes
//      { type: 'stats', stats } / { type: 'warmup', stats } / { type: 'best' }
//
// Startup: publish the initial weights so the MCTS workers can start, then
// resume from <ckptDir>/best.bin if present, else behaviour-clone the
// heuristic from a few spawn columns and pretrain 5000 steps; then publish
// again and train on whatever arrives.

import { createLevelSim, spawnAtCol } from "/app/sim.js";
import { createNet, loadBest, readBestMeta, ckptFiles } from "/app/ai/policy.js";
import { populateWarmup } from "/app/ai/heuristic.js";

const fs = require("fs");

const RING_SIZE = 10;
const BEST_WINDOW = 20;
const PRETRAIN_STEPS = 5000;
const SGD_PER_TUPLE = 0.25;       // ~1 SGD step per 4 tuples ingested
const SGD_PER_INGEST_CAP = 200;   // so one huge message cannot stall the worker
const ACTION_MASK = new Float32Array(0);

// Behaviour-cloning curriculum: heuristic episodes from these columns.
const WARMUP_SPAWNS = [
    { col: 2, attempts: 40, minReward: -1.0 },
    { col: 12, attempts: 30, minReward: -1.0 },
    { col: 18, attempts: 30, minReward: -1.0 },
    { col: 32, attempts: 30, minReward: -1.0 },
    { col: 50, attempts: 30, minReward: -1.0 },
    { col: 70, attempts: 80, minReward: 0.2 },
];

function writeFile(path, data) {
    try { fs.writeFileSync(path, data); } catch (e) { console.warn("checkpoint write failed:", path, e.message); }
}

// ── Net + buffer + trainer ──────────────────────────────────────────────
// Trains on the GPU when bro.tensor has one; the MCTS workers only ever
// receive the downloaded weights, so they are unaffected.
const net = createNet();
const onGpu = !!(bro.tensor && bro.tensor.available);
if (onGpu) net.to("gpu");
const handle = bro.ai.game.nn.createWeightsHandle();
const buffer = bro.ai.game.learn.createGenericReplayBuffer(50000);
const trainer = bro.ai.game.learn.createGenericExItTrainer();
trainer.setNet(net);
trainer.setBuffer(buffer);
trainer.setWeightsHandle(handle);
trainer.setConfig({
    lr: 0.005, momentum: 0.9, batch: 64,
    policyWeight: 1.0, valueWeight: 1.0,
    publishEvery: 25,
    rngSeed: 0x1234n,
    device: onGpu ? "gpu" : "cpu",
});

let files = null;
let resumed = false;
let ringIdx = 0;
let bestMean = -Infinity;
const recentReturns = [];
let ingested = 0;
let trainSteps = 0;
let lossValue = 0;
let lossPolicy = 0;
let lastVersionSent = -1n;

function stats() {
    const snap = handle.snapshot();
    return {
        ingested,
        bufSize: buffer.size | 0,
        trainSteps,
        lossValue,
        lossPolicy,
        netVersion: snap ? snap.version : 0n,
        bestMean: Number.isFinite(bestMean) ? bestMean : 0,
        meanReturn: recentReturns.length ? recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length : 0,
        resumed: resumed ? 1 : 0,
    };
}

function publishWeights(version) {
    const bytes = net.save();
    self.postMessage({ type: "weights", version, bytes, stats: stats() }, [bytes.buffer]);
}

/** Resume from the best checkpoint, or behaviour-clone + pretrain. */
function warmStart() {
    const meta = readBestMeta(files.dir);
    if (meta && loadBest(net, files.dir)) {
        resumed = true;
        bestMean = Number.isFinite(+meta.meanReturn) ? +meta.meanReturn : -Infinity;
        return { resumed: true, meanReturn: bestMean };
    }
    const sim = createLevelSim({ timeLimit: 20, stallDecisions: 50, trackDamagedTiles: false });
    const warmup = { attempts: 0, kept: 0, flags: 0, deaths: 0, timeouts: 0, tuplesPushed: 0, pretrainSteps: 0 };
    for (const ws of WARMUP_SPAWNS) {
        spawnAtCol(sim, ws.col);
        const r = populateWarmup(buffer, sim, {
            targetSamples: ws.attempts,
            maxAttempts: ws.attempts,
            maxDecisions: 400,
            minReward: ws.minReward,
            seed: 0xBC51A57E ^ (ws.col * 0x9E3779B1),
        });
        for (const k in r) warmup[k] += r[k];
    }
    if (buffer.size >= 32) {
        const last = trainer.stepN(PRETRAIN_STEPS);
        warmup.pretrainSteps = PRETRAIN_STEPS;
        warmup.pretrainLossPolicy = lossPolicy = +last.lossPolicy || 0;
        warmup.pretrainLossValue = lossValue = +last.lossValue || 0;
    }
    return warmup;
}

function start(ckptDir) {
    files = ckptFiles(ckptDir || undefined);
    try { fs.mkdirSync(files.dir, { recursive: true }); } catch (_) { /* exists */ }
    publishWeights(0n);
    self.postMessage({ type: "warmup", stats: warmStart() });
    report();
}

// ── Ingest + train ──────────────────────────────────────────────────────

function ingest(tuples, weight) {
    if (!tuples || !tuples.length) return 0;
    const repeats = Math.max(1, weight | 0);
    for (let k = 0; k < repeats; k++) {
        for (const t of tuples) {
            buffer.push({
                obs: t.obs,
                policyTarget: t.policyTarget,
                actionMask: ACTION_MASK,
                valueTarget: +t.valueTarget || 0,
            });
        }
    }
    return tuples.length * repeats;
}

function train(pushed) {
    if (buffer.size < 32) return;
    const n = Math.min(SGD_PER_INGEST_CAP, Math.max(4, Math.ceil(pushed * SGD_PER_TUPLE)));
    const last = trainer.stepN(n);
    trainSteps += n;
    lossValue = +last.lossValue || lossValue;
    lossPolicy = +last.lossPolicy || lossPolicy;
}

/** Send new weights when the trainer published a version, else stats. */
function report() {
    const snap = handle.snapshot();
    const v = snap ? snap.version : 0n;
    if (v === lastVersionSent) {
        self.postMessage({ type: "stats", stats: stats() });
        return;
    }
    lastVersionSent = v;
    publishWeights(v);
}

// ── Checkpoints: a ring of recent nets + the best trailing mean ────────

function onTrajectoryEnd(totalReturn) {
    recentReturns.push(+totalReturn || 0);
    if (recentReturns.length > BEST_WINDOW) recentReturns.shift();
    writeFile(files.ring(ringIdx), net.save());
    ringIdx = (ringIdx + 1) % RING_SIZE;
    if (recentReturns.length < BEST_WINDOW) return;
    const mean = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
    if (mean <= bestMean) return;
    bestMean = mean;
    writeFile(files.best, net.save());
    const snap = handle.snapshot();
    writeFile(files.meta, JSON.stringify({
        meanReturn: mean,
        window: BEST_WINDOW,
        netVersion: snap ? snap.version.toString() : "0",
        ingested,
        trainSteps,
    }, null, 2));
    self.postMessage({ type: "best", meanReturn: mean });
}

self.onmessage = (e) => {
    const m = e && e.data;
    if (!m) return;
    if (m.type === "init" && !files) start(m.ckptDir);
    else if (!files) return;
    else if (m.type === "tuples") {
        const n = ingest(m.tuples, m.weight);
        ingested += n;
        train(n);
        report();
    } else if (m.type === "trajectory_end") {
        onTrajectoryEnd(m.totalReturn);
    }
};
