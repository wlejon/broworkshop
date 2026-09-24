// Checkpoint inspector (dev tool, not a test): loads ckpt/best.bin and
// prints what the policy thinks at interesting columns, plus greedy and
// sampled rollouts. Run from the broworkshop root:
//   bro-headless games/stompworld games/stompworld/ai/inspect.js

import { TILE } from "/app/rules.js";
import { createLevelSim, spawnAtCol, endReason, NUM_ACTIONS } from "/app/sim.js";
import { buildObs } from "/app/ai/obs.js";
import { createNet, loadBest, readBestMeta, argmax, softmax, ckptFiles } from "/app/ai/policy.js";

const BEST_BIN = ckptFiles().best;
import { makeRng } from "/app/ai/heuristic.js";

const NAMES = ["idle", "L", "R", "J", "JL", "JR"];
const net = createNet();
if (!loadBest(net)) {
    console.log("no checkpoint at " + BEST_BIN + " (train first)");
} else {
    const meta = readBestMeta() || {};
    console.log("=".repeat(72));
    console.log("checkpoint " + BEST_BIN + "  meanReturn(20)=" + (+meta.meanReturn || 0).toFixed(4)
        + "  netVersion=" + meta.netVersion);
    console.log("=".repeat(72));
    inspect();
}

function inspect() {
    const sim = createLevelSim({ timeLimit: 300 });
    const logits = new Float32Array(NUM_ACTIONS);
    const policy = () => { const v = net.forward(buildObs(sim), logits); return { v, probs: softmax(logits) }; };
    const start = (col) => { spawnAtCol(sim, col); sim.reset(); };

    console.log("\nPolicy and value at key columns (V near +1 = expects to reach the flag):");
    const spots = [
        ["intro flat", 2], ["approaching 1st gap", 12], ["after 1st gap", 18], ["between pipes", 33],
        ["past pipes", 38], ["edge of 2nd gap", 44], ["mid 2nd gap (air)", 46, 2], ["past 2nd gap", 50],
        ["floating platform", 56], ["approaching 3rd gap", 72], ["past 3rd gap", 78], ["long flat", 85],
        ["staircase base", 99], ["staircase top", 105], ["near flag", 115],
    ];
    for (const [label, col, airSteps = 0] of spots) {
        start(col);
        for (let i = 0; i < airSteps; i++) sim.step(5);
        const { v, probs } = policy();
        const p = sim.player;
        console.log("  col=" + String(col).padStart(3) + " (x=" + p.x.toFixed(0) + ", y=" + p.y.toFixed(0)
            + ", og=" + (p.onGround ? 1 : 0) + ")  V=" + v.toFixed(3) + "  " + label);
        console.log("    " + NAMES.map((n, i) => n + "=" + probs[i].toFixed(3)).join("  ")
            + "  → " + NAMES[argmax(probs)]);
    }

    console.log("\nGreedy rollouts (argmax, no search):");
    for (const col of [2, 30, 50, 80, 95]) {
        start(col);
        let total = 0, n = 0, maxX = sim.player.x;
        for (; n < 600; n++) {
            policy();
            const out = sim.step(argmax(logits));
            total += out.reward;
            maxX = Math.max(maxX, sim.player.x);
            if (out.done) { n++; break; }
        }
        console.log("  spawn col=" + String(col).padStart(3) + "  decisions=" + String(n).padStart(3)
            + "  maxCol=" + String(Math.floor(maxX / TILE)).padStart(3) + "  R=" + total.toFixed(2) + "  " + endReason(sim));
    }

    console.log("\nSampled rollouts (5 each):");
    for (const col of [2, 30, 50, 80]) {
        let flags = 0, bestX = 0;
        for (let trial = 0; trial < 5; trial++) {
            const rng = makeRng((trial + 1) * 7919);
            start(col);
            for (let t = 0; t < 600; t++) {
                const { probs } = policy();
                let r = rng(), a = NUM_ACTIONS - 1;
                for (let i = 0; i < NUM_ACTIONS; i++) { r -= probs[i]; if (r <= 0) { a = i; break; } }
                const out = sim.step(a);
                bestX = Math.max(bestX, sim.player.x);
                if (out.done) break;
            }
            if (sim.won) flags++;
        }
        console.log("  spawn col=" + String(col).padStart(3) + "  flags " + flags + "/5  best col " + Math.floor(bestX / TILE));
    }
}
