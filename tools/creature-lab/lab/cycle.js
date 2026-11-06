// Cutting a recording into what the sheets show: a gait cycle (left hind
// touchdown to the next, in the run's steady part) sampled at even phases,
// or for an action, even times across the run. And re-expressing a step's
// pose about the creature's own root, so every cell of a sheet frames it
// the same way.

import { T, TELE } from "./contract.js";
import { ROWS } from "./skeleton.js";

export const planted = (rec, k, f) => rec.tele[k * TELE + T.FOOT + 4 * f] > 0.5;

// Steps where foot f touches down (the rig's planted flag rising).
export function touchdowns(rec, f, from = 0) {
    const out = [];
    for (let k = Math.max(1, from); k < rec.steps; k++) if (planted(rec, k, f) && !planted(rec, k - 1, f)) out.push(k);
    return out;
}

// Every complete cycle of foot 0 (left hind) from `fromT` seconds on.
export function cycles(rec, fromT) {
    const td = touchdowns(rec, 0, Math.round((fromT ?? rec.scenario.duration * 0.4) / rec.dt));
    const out = [];
    for (let i = 0; i + 1 < td.length; i++) out.push({ a: td[i], b: td[i + 1], period: (td[i + 1] - td[i]) * rec.dt });
    return out;
}

// The last complete cycle, or null for a run without one.
export function lastCycle(rec, fromT) {
    const c = cycles(rec, fromT);
    return c.length ? c[c.length - 1] : null;
}

// Rows for a sheet: `rows` samples of the cycle (phase 0 = left hind
// touchdown) or, with no cycle, of the whole run.
export function sampleRows(rec, rows, cycle) {
    const out = [];
    for (let r = 0; r < rows; r++) {
        if (cycle) {
            const ph = r / rows;
            const step = Math.min(rec.steps - 1, Math.round(cycle.a + ph * (cycle.b - cycle.a)));
            out.push({ step, phase: ph, t: step * rec.dt, label: `phase ${ph.toFixed(2)}` });
        } else {
            const step = Math.min(rec.steps - 1, Math.round(((r + 0.5) / rows) * rec.steps));
            out.push({ step, phase: null, t: step * rec.dt, label: `t ${(step * rec.dt).toFixed(2)} s` });
        }
    }
    return out;
}

export function rootOf(rec, k) {
    const o = k * TELE;
    return { x: rec.tele[o + T.POS], y: rec.tele[o + T.POS + 1], z: rec.tele[o + T.POS + 2], yaw: rec.tele[o + T.YAW] };
}

// Step k's pose in the creature's frame: its root's ground point at the
// origin, its heading along +Z (`ground` the ground height under the root).
export function relativePose(rec, k, ground, out, at = 0) {
    const nb = rec.creature.skel.count;
    const P = rec.pose, o = k * rec.poseStride;
    const r = rootOf(rec, k);
    const c = Math.cos(-r.yaw), s = Math.sin(-r.yaw);
    for (let b = 0; b < nb; b++) {
        const i = o + b * ROWS, j = at + b * ROWS;
        for (let col = 0; col < 3; col++) {
            const x = P[i + col], y = P[i + 4 + col], z = P[i + 8 + col];
            out[j + col] = c * x + s * z;
            out[j + 4 + col] = y;
            out[j + 8 + col] = -s * x + c * z;
        }
        const px = P[i + 3] - r.x, py = P[i + 7] - ground, pz = P[i + 11] - r.z;
        out[j + 3] = c * px + s * pz;
        out[j + 7] = py;
        out[j + 11] = -s * px + c * pz;
    }
    return out;
}

// A world point re-expressed the same way.
export function toRelative(rec, k, ground, p) {
    const r = rootOf(rec, k);
    const c = Math.cos(-r.yaw), s = Math.sin(-r.yaw);
    const px = p[0] - r.x, pz = p[2] - r.z;
    return [c * px + s * pz, p[1] - ground, -s * px + c * pz];
}
