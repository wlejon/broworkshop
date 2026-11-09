// The strider's body: masses on its bones blended into one skin
// (lab/flesh.js), as skeleton.js stands it:
//   trunk     a pear: hips 0.29 m across, a waist, the chest deep and
//             round, the shoulders sloping into the neck; a round belly
//   head      a ball 0.2 m across on a short thick neck, a low brow, a
//             broad muzzle, large eyes set forward, small round ears
//   arms      long and loose, to the knees, thick at the shoulder and
//             tapering to broad flat hands with a thumb
//   legs      short heavy thighs, a calf, plantigrade feet with a round
//             heel behind the ankle and the toes spread in a pad
// Fur the colour of dry bark, darker down the back, pale on the face and
// belly; the bare hands and soles dark.

import { Flesh, SIDES } from "/app/lab/flesh.js";

const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const add = (a, b) => a.map((x, i) => x + b[i]);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const mul = (a, k) => a.map((x) => x * k);
const norm = (a) => mul(a, 1 / Math.hypot(...a));
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const FUR = [0.46, 0.36, 0.26], BACK = [0.30, 0.23, 0.17], PALE = [0.80, 0.72, 0.58];
const SKIN = [0.22, 0.17, 0.15], EYE = [0.05, 0.04, 0.03], LID = [0.16, 0.12, 0.10];

function coat(p, n, share) {
    const LR = (k) => share(k + 'L') + share(k + 'R');
    let c = mix(FUR, BACK, 0.75 * sstep(-0.2, -0.8, n[2]) * sstep(0.7, 1.0, p[1] / 1.0));
    // The belly and the inner limbs pale.
    c = mix(c, PALE, 0.8 * share('belly') * sstep(0.2, 0.7, n[2]));
    c = mix(c, PALE, 0.5 * sstep(-0.3, -0.8, n[1]) * sstep(0.5, 0.8, p[1]));
    // The face: the muzzle and the round about the eyes pale.
    c = mix(c, PALE, share('muzzle') + 0.6 * LR('cheek'));
    c = mix(c, SKIN, LR('hand') + LR('thumb') + LR('sole'));
    c = mix(c, LID, LR('lid'));
    return mix(c, EYE, LR('eye') + share('nose'));
}

// `detail` overrides the meshing (Flesh's cell, triangles, simplifyError, keep)
// for a coarser level of detail of the same body.
export function body(skel, detail = {}) {
    const B = new Flesh(skel, { color: coat, triangles: 16000, cell: 0.005, ...detail });
    B.limb('trunk', ['pelvis', 'spine', 'chest'], [
        { c: [0, 0.60, -0.005], r: [0.115, 0.085] },
        { c: [0, 0.68, -0.005], r: [0.148, 0.112] },
        { c: [0, 0.79, -0.012], r: [0.130, 0.105] },
        { c: [0, 0.90, -0.018], r: [0.150, 0.118] },
        { c: [0, 0.98, -0.020], r: [0.160, 0.112] },
        { c: [0, 1.035, -0.018], r: [0.120, 0.085] },
    ], { up: [0, 0, 1], blend: 0.03 });
    B.blob('belly', [['spine', 0.7], ['pelvis', 0.3]], [0, 0.775, 0.045], [0.115, 0.10, 0.085], { blend: 0.03 });
    B.blob('rump', 'pelvis', [0, 0.635, -0.06], [0.135, 0.075, 0.07], { blend: 0.03 });
    B.limb('neck', ['chest', 'neck'], [
        { c: [0, 1.02, -0.005], r: [0.085, 0.075] },
        { c: [0, 1.11, 0.012], r: [0.060, 0.058] },
    ], { up: [0, 0, 1], blend: 0.025 });
    B.blob('skull', 'head', [0, 1.195, 0.03], [0.098, 0.102, 0.098], { blend: 0.015 });
    B.blob('brow', 'head', [0, 1.243, 0.093], [0.082, 0.024, 0.035], { blend: 0.012 });
    B.blob('muzzle', 'head', [0, 1.172, 0.108], [0.060, 0.040, 0.045], { blend: 0.014 });
    B.blob('nose', 'head', [0, 1.192, 0.150], [0.018, 0.011, 0.010], { blend: 0.004, keep: true });
    for (const [s, t] of SIDES) {
        B.blob(`cheek${t}`, 'head', [0.055 * s, 1.18, 0.075], [0.04, 0.035, 0.04], { blend: 0.012 });
        B.blob(`eye${t}`, 'head', [0.042 * s, 1.219, 0.112], [0.021, 0.021, 0.019], { blend: 0.004, keep: true });
        B.blob(`lid${t}`, 'head', [0.042 * s, 1.233, 0.108], [0.025, 0.012, 0.018], { blend: 0.005, keep: true });
        B.blob(`ear${t}`, 'head', [0.098 * s, 1.21, 0.0], [0.014, 0.034, 0.03], { blend: 0.008 });
        const ua = skel.bones[skel.index(`upperarm${t}`)], fa = skel.bones[skel.index(`forearm${t}`)];
        const hd = skel.bones[skel.index(`hand${t}`)];
        const at = (b, u) => lerp(b.head, b.tail, u);
        const ax = (b) => norm(sub(b.tail, b.head));
        // The arm, out from the flank at rest: its sections' up is its own
        // forward (the side of the arm toward the trunk stays its inside).
        B.limb(`arm${t}`, [`shoulder${t}`, `upperarm${t}`, `forearm${t}`], [
            { c: [0.13 * s, 1.0, -0.016], r: [0.058, 0.062], bone: `shoulder${t}` },
            { c: at(ua, 0.08), r: [0.058, 0.06] },
            { c: at(ua, 0.55), r: [0.046, 0.052] },
            { c: fa.head, r: [0.040, 0.042] },
            { c: at(fa, 0.5), r: [0.038, 0.040] },
            { c: hd.head, r: [0.028, 0.030], bone: `forearm${t}` },
        ], { up: [0, 0, 1], blend: 0.02 });
        // The hand: a broad flat paddle down from the wrist, the thumb
        // forward and in.
        const h = ax(hd);
        B.limb(`hand${t}`, [`hand${t}`], [
            { c: at(hd, 0.15), r: [0.020, 0.033] },
            { c: at(hd, 0.6), r: [0.017, 0.038] },
            { c: at(hd, 0.92), r: [0.013, 0.030] },
        ], { up: [0, 0, 1], blend: 0.01, steps: 2 });
        const th0 = add(at(hd, 0.2), [-0.010 * s, 0, 0.026]);
        B.limb(`thumb${t}`, [`hand${t}`], [
            { c: th0, r: 0.012 },
            { c: add(th0, add(mul(h, 0.035), [-0.004 * s, 0, 0.01])), r: 0.009 },
        ], { blend: 0.006, steps: 2 });
        const th = skel.bones[skel.index(`thigh${t}`)], sn = skel.bones[skel.index(`shin${t}`)];
        const ft = skel.bones[skel.index(`foot${t}`)];
        const x = th.head[0];
        B.limb(`leg${t}`, [`thigh${t}`, `shin${t}`], [
            { c: [x * 0.9, 0.64, 0.0], r: [0.085, 0.09], bone: `thigh${t}` },
            { c: [x, 0.52, 0.008], r: [0.074, 0.078] },
            { c: sn.head, r: [0.054, 0.056] },
            { c: [x, 0.27, -0.002], r: [0.050, 0.054] },
            { c: [x, 0.16, -0.01], r: [0.036, 0.038] },
            { c: ft.head, r: [0.030, 0.032], bone: `shin${t}` },
        ], { up: [0, 0, 1], blend: 0.022 });
        B.blob(`calf${t}`, `shin${t}`, [x, 0.28, -0.03], [0.042, 0.065, 0.035], { blend: 0.02 });
        // The foot: a round heel behind the ankle, the sole flat, the toes
        // spread into a pad.
        B.limb(`sole${t}`, [`foot${t}`, `toe${t}`], [
            { c: [x, 0.037, -0.034], r: [0.032, 0.033], bone: `foot${t}` },
            { c: [x, 0.036, 0.040], r: [0.040, 0.034], bone: `foot${t}` },
            { c: [x * 1.04, 0.022, 0.112], r: [0.046, 0.021], bone: `toe${t}` },
            { c: [x * 1.06, 0.016, 0.152], r: [0.040, 0.016], bone: `toe${t}` },
        ], { up: [0, 1, 0], blend: 0.012 });
    }
    B.section('waist', { at: [0, 0.79, -0.01], normal: [0, 1, 0], bone: 'spine', radius: 0.3 });
    B.section('chest', { at: [0, 0.95, -0.02], normal: [0, 1, 0], bone: 'chest', radius: 0.3 });
    return B.build();
}
