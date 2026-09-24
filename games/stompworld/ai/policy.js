// The Stompworld policy/value net and its checkpoint files, shared by the
// trainer, the MCTS workers, the AI demo and the inspector. The net shape
// and seed must match between them or a checkpoint will not load.
//
// Checkpoints live in the app's ckpt/ folder (gitignored): best.bin +
// best.json (best trailing-mean return so far) and a ring of last_N.bin.
// Relative paths resolve against the app dir (brokit's fs does that on the
// page and in workers alike).

import { HEAD_SIZES } from "/app/sim.js";
import { obsDim } from "/app/ai/obs.js";

export const CKPT_DIR = "ckpt";
export const NET_SEED = 0xA11CE5n;

/** File names inside a checkpoint dir (tests point it somewhere scratch). */
export function ckptFiles(dir = CKPT_DIR) {
    return {
        dir,
        best: dir + "/best.bin",
        meta: dir + "/best.json",
        ring: (i) => dir + "/last_" + i + ".bin",
    };
}

/** A fresh (randomly initialised) policy/value net. */
export function createNet(seed = NET_SEED) {
    return bro.ai.game.nn.createPolicyValueNet({
        inDim: obsDim(),
        hidden: [128, 128],
        valueHidden: 64,
        headSizes: HEAD_SIZES,
        seed: BigInt(seed),
    });
}

/** Load best.bin into `net`. False when there is no usable checkpoint. */
export function loadBest(net, dir = CKPT_DIR) {
    const fs = require("fs");
    const path = ckptFiles(dir).best;
    try {
        if (!fs.existsSync(path)) return false;
        net.load(new Uint8Array(fs.readFileSync(path)));
        return true;
    } catch (e) {
        console.warn("stompworld: checkpoint " + path + " did not load: " + e.message);
        return false;
    }
}

/** best.json, or null. */
export function readBestMeta(dir = CKPT_DIR) {
    const fs = require("fs");
    try { return JSON.parse(fs.readFileSync(ckptFiles(dir).meta, "utf-8")); } catch (_) { return null; }
}

export function argmax(arr) {
    let best = 0;
    for (let i = 1; i < arr.length; i++) if (arr[i] > arr[best]) best = i;
    return best;
}

/** Softmax over `logits[legal[i]]`, written into a fresh array (0 elsewhere). */
export function softmax(logits, legal = null) {
    const n = logits.length;
    const idx = legal || Array.from({ length: n }, (_, i) => i);
    let m = -Infinity;
    for (const a of idx) if (logits[a] > m) m = logits[a];
    const out = new Float32Array(n);
    let s = 0;
    for (const a of idx) { out[a] = Math.exp(logits[a] - m); s += out[a]; }
    if (s > 0) for (const a of idx) out[a] /= s;
    return out;
}
