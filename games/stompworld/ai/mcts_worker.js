// Self-play data generator: one worker = one MCTS search depth. The
// Training screen runs several at different `iterations` / `rolloutDepth`,
// so the trainer sees both many cheap episodes and fewer high-quality ones.
//
// - Dirichlet noise on the root prior is on (exploration).
// - A shared failure tape: death / stall / timeout tails are recorded as
//   (state signature, action) pairs that later searches down-weight, so
//   the workers keep finding new failures instead of repeating one. Each
//   worker posts its traces to the page ('tape_record'), which forwards
//   them to the others ('tape_apply'). Wins stay off the tape; masking
//   them pushed the agent away from winning lines.
// - Message-driven: the page answers each 'ready' with a 'tick', and each
//   tick runs a batch of decisions.
//
// Out: { type: 'tuples', workerId, reason, tuples, weight }
//      { type: 'trajectory', workerId, startSnap, actions, decisions,
//        totalReturn, bestX, searchDepth, reason }
//      { type: 'stats' | 'ready' | 'tape_record', ... }

import { TILE } from "/app/rules.js";
import { createLevelSim, spawnAtCol, endReason } from "/app/sim.js";
import { createPlayAgent } from "/app/ai/play_agent.js";

const SPAWN_COL = 2;
const TIME_LIMIT = 30;
const STATS_EVERY_DECISIONS = 200;
const DECISIONS_PER_TICK = 32;

let workerId = 0;
let agent = null;
let sim = null;
let tape = null;
let running = false;
let inEpisode = false;
let episodes = 0;
let lastReason = "fresh";
let sinceStats = 0;
const sigs = [];

/** Coarse state key for the tape: col, row, onGround, vx sign, armed. */
function signature(s) {
    const p = s.player;
    const vxSign = p.vx > 8 ? 1 : (p.vx < -8 ? -1 : 0);
    return Math.floor(p.x / TILE) + "," + Math.floor(p.y / TILE) + ","
        + (p.onGround ? 1 : 0) + "," + vxSign + "," + (s.hasWeapon ? 1 : 0);
}

function startEpisode() {
    spawnAtCol(sim, SPAWN_COL);
    sim.reset();
    agent.startEpisode();
    sigs.length = 0;
    inEpisode = true;
}

function endEpisode(reason) {
    const r = agent.endEpisode(reason);
    const len = Math.min(sigs.length, r.actions.length);
    if (reason !== "flag" && len > 0) {
        const trace = [];
        for (let i = 0; i < len; i++) trace.push({ sig: sigs[i], action: r.actions[i] });
        tape.recordFailure(trace);
        self.postMessage({ type: "tape_record", workerId, trace });
    }
    self.postMessage({
        type: "tuples", workerId, reason,
        tuples: r.tuples,
        weight: reason === "flag" ? 3 : 1,
    });
    self.postMessage({
        type: "trajectory", workerId,
        startSnap: r.startSnap, actions: r.actions,
        decisions: r.decisions, totalReturn: r.totalReturn,
        bestX: r.bestX, searchDepth: agent.iterations,
        reason,
    });
    episodes++;
    lastReason = reason;
    inEpisode = false;
}

function runBatch() {
    if (!running) return;
    if (agent.weightsLoaded) {
        for (let i = 0; i < DECISIONS_PER_TICK; i++) {
            if (!inEpisode) startEpisode();
            sigs.push(signature(sim));
            if (agent.applyAction(agent.decide()).done) endEpisode(endReason(sim));
            if (++sinceStats >= STATS_EVERY_DECISIONS) {
                sinceStats = 0;
                self.postMessage({
                    type: "stats", workerId, episodes, lastReason,
                    iterations: agent.iterations,
                    netVersion: agent.netVersion,
                    tapeSize: tape.size,
                    tapeCapacity: tape.capacity,
                });
            }
        }
    }
    self.postMessage({ type: "ready", workerId });
}

function init(m) {
    workerId = m.workerId | 0;
    sim = createLevelSim({ timeLimit: TIME_LIMIT, stallDecisions: 50, trackDamagedTiles: false });
    tape = bro.ai.game.grid.createFailureTape({
        tapeDepth: 1024,      // record a long episode in full
        ringCapacity: 500,    // live (sig, action) entries across all traces
        penalty: 0.1,
        floor: 0.001,
    });
    agent = createPlayAgent({
        sim,
        iterations: (m.iterations | 0) || 100,
        rolloutDepth: (m.rolloutDepth | 0) || 8,
        dirichletAlpha: 0.5,
        dirichletEpsilon: 0.25,
        seed: BigInt(workerId) * 0x9E3779B1n ^ 0xA11CE5n,
        sigFn: () => signature(sim),
        priorAdjust: (sig, prior) => tape.applyPriors(sig, prior),
    });
    running = true;
    self.postMessage({ type: "ready", workerId });
}

self.onmessage = (e) => {
    const m = e && e.data;
    if (!m) return;
    if (m.type === "init") init(m);
    else if (m.type === "weights" && agent) agent.setWeights(new Uint8Array(m.bytes), m.version);
    else if (m.type === "tape_apply" && tape && m.trace && m.trace.length) tape.recordFailure(m.trace);
    else if (m.type === "clear_tape" && tape) tape.clear();
    else if (m.type === "tick") runBatch();
    else if (m.type === "stop") running = false;
};
