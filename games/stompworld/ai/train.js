// Train AI mode: runs the trainer worker plus NUM_MCTS self-play workers,
// routes their messages, and replays the best recent trajectory in the
// level with the other recent ones as translucent ghosts.
//
// The page is the hub: MCTS workers send tuples (forwarded to the trainer)
// and finished trajectories (kept in a best-crop pool and a replay ring);
// the trainer's weights are broadcast back to every MCTS worker.

import { createLevelSim, FIXED_DT_MS, FRAME_SKIP } from "/app/sim.js";
import {
    createCamera, followBody, drawWorld, drawHero, heroFrame, drawBeams,
    drawPanel, drawNotice, makeFlash, ageFlashes,
} from "/app/render.js";

const MCTS_DEPTHS = [40, 80, 100, 100, 100];
const MCTS_ROLLOUT = [4, 4, 4, 6, 10];
const RING_SIZE = 10;
const POOL_CAPACITY = 32;
const FAST_MULT = 8;

/**
 * `cue(name)` plays a game sound (land, jump, stomp, die, win, flyer);
 * `ckptDir` is where the trainer resumes from and saves (default ckpt).
 */
export function createTraining(cue, { ckptDir } = {}) {
    const sim = createLevelSim({ timeLimit: 600 });
    const cam = createCamera(sim.tilemap);
    followBody(cam, sim.player, true);

    const t = {
        fast: false,
        episodes: 0,
        ring: [],              // recent trajectories
        primary: null,         // the one being replayed
        ghosts: [],            // [{ frames }] for the others
        actionIdx: 0,
        tickInDecision: 0,
        tickAcc: 0,
        done: false,
        startTick: 0,
        beams: [],
        pickupT: 0,
        trainerStats: {},
        warmup: null,
        trainerReady: false,
        droppedTuples: 0,
        mctsStats: MCTS_DEPTHS.map(() => ({})),
        pool: bro.ai.game.grid.createBestCrop({
            capacity: POOL_CAPACITY,
            depthBonus: 0.001, ageDecay: 0.0001,
            seedTopK: 8, seed: 0xC0DE5EEDn,
        }),
        poolTop: 0,
        poolAccepted: 0,
        prev: null,            // hero + stomper state last decision (sound cues)
        flyerCueCooldown: 0,
    };

    const trainer = new Worker("ai/trainer_worker.js", { type: "module" });
    trainer.onmessage = (e) => onTrainer(e.data);
    trainer.postMessage({ type: "init", ckptDir });
    const mcts = MCTS_DEPTHS.map((iterations, i) => {
        const w = new Worker("ai/mcts_worker.js", { type: "module" });
        w.onmessage = (e) => onMcts(e.data, i);
        w.postMessage({ type: "init", workerId: i + 1, iterations, rolloutDepth: MCTS_ROLLOUT[i] });
        return w;
    });
    let running = true;

    function post(w, msg, transfer) {
        try { w.postMessage(msg, transfer); } catch (_) { /* worker already gone */ }
    }

    function onTrainer(m) {
        if (!m) return;
        if (m.stats) Object.assign(t.trainerStats, m.stats);
        if (m.type === "weights") {
            for (const w of mcts) {
                const copy = new Uint8Array(m.bytes);
                post(w, { type: "weights", bytes: copy, version: m.version }, [copy.buffer]);
            }
        } else if (m.type === "warmup") {
            t.warmup = m.stats || {};
            t.trainerReady = true;
        }
    }

    function onMcts(m, idx) {
        if (!m) return;
        if (m.type === "tuples") {
            if (!t.trainerReady) t.droppedTuples += m.tuples ? m.tuples.length : 0;
            else post(trainer, { type: "tuples", tuples: m.tuples, reason: m.reason, weight: m.weight | 0 });
        } else if (m.type === "trajectory") {
            addTrajectory(m);
        } else if (m.type === "tape_record") {
            mcts.forEach((w, i) => { if (i !== idx) post(w, { type: "tape_apply", trace: m.trace }); });
        } else if (m.type === "stats") {
            t.mctsStats[idx] = m;
        } else if (m.type === "ready") {
            post(mcts[idx], { type: "tick" });
        }
    }

    function addTrajectory(m) {
        t.pool.push({ snapshot: m.startSnap, prefix: m.actions, score: m.totalReturn, depth: m.searchDepth });
        t.poolAccepted++;
        t.poolTop = Math.max(t.poolTop, m.totalReturn);
        if (t.trainerReady) post(trainer, { type: "trajectory_end", totalReturn: m.totalReturn, reason: m.reason });
        t.ring.push(m);
        while (t.ring.length > RING_SIZE) t.ring.shift();
    }

    // ── Replay ──────────────────────────────────────────────────────────

    /** Best of the last 10 (or 5, or 1) trajectories; the rest are ghosts. */
    function pickReplay() {
        const n = t.ring.length >= 10 ? 10 : (t.ring.length >= 5 ? 5 : 1);
        const window = t.ring.slice(-n);
        let best = 0;
        for (let i = 1; i < window.length; i++) {
            if (window[i].totalReturn > window[best].totalReturn) best = i;
        }
        return { primary: window[best], ghosts: window.filter((_, i) => i !== best) };
    }

    /** Hero positions per tick of a trajectory, replayed in a scratch sim. */
    function ghostTrack(traj) {
        const g = createLevelSim({ timeLimit: 600, trackDamagedTiles: false });
        g.restore(traj.startSnap);
        const frames = [];
        for (let i = 0; i < traj.actions.length; i++) {
            g.beginDecision();
            let ended = false;
            for (let k = 0; k < FRAME_SKIP && !ended; k++) {
                ended = g.tickPhysics(traj.actions[i], k);
                const p = g.player;
                const tick = i * FRAME_SKIP + k;
                frames.push({ tick, x: p.x, y: p.y, facing: p.facing, frame: heroFrame(p, tick) });
            }
            if (g.endDecision().done || ended) break;
        }
        return frames;
    }

    function startReplay() {
        if (!t.ring.length) return false;
        const sel = pickReplay();
        t.primary = sel.primary;
        t.ghosts = sel.ghosts.map(ghostTrack);
        t.actionIdx = 0;
        t.tickInDecision = 0;
        t.tickAcc = 0;
        t.done = false;
        sim.reset();
        sim.restore(t.primary.startSnap);
        t.startTick = sim.tick;
        sim.beginDecision();
        t.episodes++;
        t.prev = null;
        t.beams = [];
        return true;
    }

    function update(dt) {
        if (!running) return;
        t.pickupT += dt;
        if (t.flyerCueCooldown > 0) t.flyerCueCooldown -= dt;
        if ((!t.primary || t.done) && !startReplay()) return;

        t.tickAcc = Math.min(200, t.tickAcc + dt * (t.fast ? FAST_MULT : 1));
        while (t.tickAcc >= FIXED_DT_MS && !t.done) {
            const ended = sim.tickPhysics(t.primary.actions[t.actionIdx], t.tickInDecision);
            t.tickInDecision++;
            t.tickAcc -= FIXED_DT_MS;
            if (t.tickInDecision < FRAME_SKIP && !ended) continue;
            const out = sim.endDecision();
            sim.tilemap.commitOverlays();
            for (const b of sim.recentBeams) t.beams.push(makeFlash(b));
            decisionCues();
            t.tickInDecision = 0;
            t.actionIdx++;
            if (out.done || t.actionIdx >= t.primary.actions.length) {
                t.done = true;
                if (!t.fast && t.primary.reason === "flag") cue("win");
                else if (!t.fast && t.primary.reason === "death") cue("die");
                break;
            }
            sim.beginDecision();
        }
        followBody(cam, sim.player);
        t.beams = ageFlashes(t.beams, dt);
    }

    /** Sounds for the replay, from what changed since the last decision. */
    function decisionCues() {
        const p = sim.player;
        const prev = t.prev;
        t.prev = t.fast ? null : { onGround: p.onGround, alive: sim.stompers.map((s) => s.alive) };
        if (!prev) return;
        if (!prev.onGround && p.onGround) cue("land");
        else if (prev.onGround && !p.onGround && p.vy < -200) cue("jump");
        if (sim.stompers.some((s, i) => prev.alive[i] && !s.alive)) cue("stomp");
        if (t.flyerCueCooldown <= 0) {
            const near = sim.flyers.some((f) => f.alive
                && Math.hypot(f.x + f.w / 2 - (p.x + p.w / 2), f.y + f.h / 2 - (p.y + p.h / 2)) < 80);
            if (near) { cue("flyer"); t.flyerCueCooldown = 350; }
        }
    }

    // ── Draw ────────────────────────────────────────────────────────────

    function draw(ctx) {
        const replaying = !!t.primary;
        drawWorld(ctx, cam, {
            tilemap: sim.tilemap,
            flag: sim.flag,
            pickup: sim.pickupCollected ? null : sim.pickup,
            pickupT: t.pickupT,
            stompers: replaying ? sim.stompers : [],
            flyers: replaying ? sim.flyers : [],
            hero: null,
        });
        if (!replaying) {
            const dots = ".".repeat(1 + ((Date.now() / 400) | 0) % 3);
            drawNotice(ctx, t.warmup ? "Waiting for first run" + dots : "Pretraining the agent" + dots, [
                (t.warmup ? "Workers warming up after weights publish" : "Behavior cloning + 5000-step pretrain in progress") + "…",
            ]);
        } else {
            drawBeams(ctx, cam, t.beams);
            const tick = sim.tick - t.startTick;
            ctx.save();
            ctx.globalAlpha = 0.3;
            for (const frames of t.ghosts) {
                const f = ghostFrame(frames, tick);
                if (f) drawHero(ctx, cam, f, f.frame);
            }
            ctx.restore();
            drawHero(ctx, cam, sim.player, heroFrame(sim.player, sim.tick));
        }
        drawPanel(ctx, hudLines(), 460);
    }

    function hudLines() {
        const w = t.trainerStats;
        const pr = t.primary;
        const tape = t.mctsStats.find((s) => s && s.tapeSize != null) || { tapeSize: 0, tapeCapacity: 0 };
        const lines = [
            "TRAINING — F = fast" + (t.fast ? " [ON]" : "") + "   C = clear tape   Esc = quit",
            "replay: ep " + t.episodes + "   ring " + t.ring.length + "/" + RING_SIZE
                + "   ghosts " + t.ghosts.length
                + (pr ? "   primary: " + pr.reason + " R=" + pr.totalReturn.toFixed(2) + " bestX=" + (pr.bestX | 0)
                      : "   [waiting for first trajectory]"),
            "history tape: " + tape.tapeSize + "/" + (tape.tapeCapacity || 0) + " (shared across workers)",
            "pool: " + t.pool.size + "/" + POOL_CAPACITY + "   top return " + t.poolTop.toFixed(2)
                + "   accepted " + t.poolAccepted,
        ];
        t.mctsStats.forEach((ms, i) => {
            lines.push("mcts#" + (i + 1) + " (it=" + MCTS_DEPTHS[i] + "):   ep " + (ms.episodes | 0)
                + "   last: " + (ms.lastReason || "fresh"));
        });
        if (!t.warmup) {
            lines.push("trainer: warming up (BC + pretrain)" + ".".repeat(1 + ((Date.now() / 400) | 0) % 3)
                + "   tuples dropped during warmup: " + t.droppedTuples);
        } else {
            lines.push("trainer: ingested " + (w.ingested || 0) + "   buf " + (w.bufSize || 0)
                + "   train " + (w.trainSteps || 0) + "   net v" + (w.netVersion ? w.netVersion.toString() : "0"));
        }
        lines.push("loss  v=" + (+w.lossValue || 0).toFixed(4) + "   p=" + (+w.lossPolicy || 0).toFixed(4)
            + "   mean(20)=" + (+w.meanReturn || 0).toFixed(3) + "   best=" + (+w.bestMean || 0).toFixed(3)
            + (w.resumed ? "   [resumed]" : ""));
        const wu = t.warmup;
        if (wu && wu.resumed) {
            lines.push("warmup: resumed @ mean " + (+wu.meanReturn || 0).toFixed(3));
        } else if (wu) {
            lines.push("warmup: kept " + (wu.kept | 0) + "/" + (wu.attempts | 0) + " (flag " + (wu.flags | 0) + ")"
                + "   tuples " + (wu.tuplesPushed | 0) + "   pretrain " + (wu.pretrainSteps | 0)
                + " p=" + (+wu.pretrainLossPolicy || 0).toFixed(3));
        }
        return lines;
    }

    function stop() {
        running = false;
        for (const w of [trainer, ...mcts]) {
            post(w, { type: "stop" });
            try { w.terminate(); } catch (_) { /* already gone */ }
        }
    }

    return {
        update, draw, stop,
        toggleFast() { t.fast = !t.fast; },
        clearTape() { for (const w of mcts) post(w, { type: "clear_tape" }); },
        /** For tests and the HUD: counters only. */
        get state() {
            return {
                trainerReady: t.trainerReady, warmup: t.warmup, episodes: t.episodes,
                trajectories: t.poolAccepted, fast: t.fast,
                mctsEpisodes: t.mctsStats.reduce((s, m) => s + (m.episodes | 0), 0),
            };
        },
    };
}

function ghostFrame(frames, tick) {
    if (!frames.length || tick < 0 || tick > frames[frames.length - 1].tick) return null;
    if (tick <= frames[0].tick) return frames[0];
    let lo = 0, hi = frames.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (frames[mid].tick <= tick) lo = mid; else hi = mid;
    }
    return frames[lo];
}
