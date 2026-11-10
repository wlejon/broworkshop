// The hexa's body: masses on its bones, blended into one skin (lab/flesh.js).
// Drawn for its silhouette, long and light:
//   trunk     a long back, deepest at the chest, a little fuller over each
//             pair of legs and drawn in between them
//   neck      arched up from the breast, slim under the head
//   head      small and narrow, a fine muzzle with a dark nose, lyre horns
//             swept back and out, long leaf ears held out to the sides
//   legs      a shoulder or haunch running on from the body, slim to the
//             knee, a long thin cannon, a small dark hoof
//   tail      a thin cord hanging to a dark tuft
// Tawny, darker down the back, white under the belly and breast with a dark
// stripe along each flank between them, as a gazelle has; dark bars across
// the upper legs, white from the knee down; a white muzzle and eye ring.

import { Flesh, SIDES } from "/app/lab/flesh.js";

const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const TAWNY = [0.64, 0.41, 0.19], BACK = [0.40, 0.23, 0.10], WHITE = [0.95, 0.92, 0.84], DARK = [0.10, 0.07, 0.06];
const HORN = [0.16, 0.13, 0.11], EAR_IN = [0.88, 0.72, 0.62];

function coat(p, n, share) {
    const LR = (k) => share(k + 'L') + share(k + 'R');
    const legs = [1, 2, 3].reduce((a, k) => a + share(`legL${k}`) + share(`legR${k}`), 0);
    const hoof = [1, 2, 3].reduce((a, k) => a + share(`hoofL${k}`) + share(`hoofR${k}`), 0);
    const trunk = share('trunk') + share('neck');
    // Darker down the back.
    let c = mix(TAWNY, BACK, 0.75 * sstep(0.35, 0.95, n[1]) * (1 - legs));
    // White underneath, and the flank stripe above it.
    const under = sstep(0.80, 0.74, p[1]) * sstep(-0.75, 0.9, p[2] + 0.0) * trunk * sstep(1.0, 0.86, p[2]);
    c = mix(c, WHITE, 0.96 * under);
    const stripe = sstep(0.775, 0.795, p[1]) * sstep(0.845, 0.825, p[1]) * sstep(-0.42, -0.3, p[2]) * sstep(0.62, 0.5, p[2]) * share('trunk') * sstep(0.25, 0.6, Math.abs(n[0]));
    c = mix(c, DARK, 0.85 * stripe);
    // The breast and the throat.
    c = mix(c, WHITE, 0.9 * share('neck') * sstep(0.1, 0.6, n[2]) * sstep(1.3, 1.0, p[1]));
    // The legs: dark bars across the upper leg, white from the knee down.
    const bars = sstep(0.25, 0.75, Math.cos(p[1] / 0.075 * 2 * Math.PI)) * sstep(0.76, 0.70, p[1]) * sstep(0.47, 0.52, p[1]);
    c = mix(c, DARK, 0.8 * legs * bars * sstep(0.2, 0.5, Math.abs(n[0]) + 0.3));
    c = mix(c, WHITE, 0.95 * legs * sstep(0.5, 0.44, p[1]));
    c = mix(c, DARK, hoof);
    // The head: a white muzzle and chin, a ring about each eye, dark from
    // the brow down the nose.
    // (The eyes' masses are the head's skin, the lids': face.bk draws the eye.)
    const head = share('skull') + share('muzzle') + share('jaw') + LR('eye');
    c = mix(c, WHITE, 0.95 * (share('jaw') + share('muzzle') * sstep(0.0, -0.5, n[1])));
    c = mix(c, BACK, 0.8 * head * sstep(0.5, 0.9, n[1]) * sstep(0.03, 0.015, Math.abs(p[0])));
    c = mix(c, WHITE, 0.55 * head * sstep(0.036, 0.024, Math.hypot(Math.abs(p[0]) - 0.066, p[1] - 1.436, p[2] - 1.15)) * sstep(0.03, 0.05, Math.abs(p[0])));
    // The ears, the horns, the tail's tuft.
    const er = LR('ear');
    c = mix(c, EAR_IN, 0.85 * er * sstep(0.1, 0.6, n[2]));
    c = mix(c, DARK, er * sstep(0.16, 0.19, Math.abs(p[0])));
    c = mix(c, HORN, LR('horn'));
    c = mix(c, DARK, share('tuft') + 0.6 * share('tail') * sstep(0.62, 0.5, p[1]));
    return mix(c, DARK, share('nose'));
}

// `detail` overrides the meshing (Flesh's cell, triangles, simplifyError) for a coarser
// level of detail of the same body.
export function body(skel, detail = {}) {
    const B = new Flesh(skel, { color: coat, triangles: 22000, cell: 0.008, ...detail });
    const bn = (n) => skel.bones[skel.index(n)];
    const on = (b, u, off = [0, 0, 0]) => b.head.map((x, i) => x + (b.tail[i] - x) * u + off[i]);
    B.limb('trunk', ['pelvis', 'spine', 'thorax'], [
        { c: [0, 0.90, -0.70], r: [0.07, 0.08] },
        { c: [0, 0.89, -0.45], r: [0.165, 0.185] },
        { c: [0, 0.895, -0.16], r: [0.14, 0.155] },
        { c: [0, 0.89, 0.12], r: [0.16, 0.175] },
        { c: [0, 0.90, 0.39], r: [0.15, 0.17] },
        { c: [0, 0.895, 0.64], r: [0.175, 0.215] },
        { c: [0, 0.95, 0.84], r: [0.12, 0.15] },
    ], { blend: 0.04 });
    B.limb('neck', ['thorax', 'neck', 'neck2'], [
        { c: [0, 0.96, 0.78], r: [0.105, 0.135], bone: 'thorax' },
        { c: [0, 1.08, 0.875], r: [0.075, 0.10] },
        { c: [0, 1.21, 0.955], r: [0.06, 0.075] },
        { c: [0, 1.33, 1.015], r: [0.052, 0.062] },
        { c: [0, 1.42, 1.06], r: [0.05, 0.058], bone: 'head' },
    ], { up: [0, 0, 1], blend: 0.03 });
    // The head: a small skull, a fine muzzle, the jaw under it.
    B.blob('skull', 'head', [0, 1.425, 1.10], [0.068, 0.066, 0.085], { blend: 0.02 });
    B.limb('muzzle', ['head'], [
        { c: [0, 1.405, 1.17], r: [0.055, 0.052] },
        { c: [0, 1.365, 1.28], r: [0.038, 0.036] },
        { c: [0, 1.338, 1.365], r: [0.03, 0.026] },
    ], { up: [0, 1, 0], blend: 0.016 });
    B.limb('jaw', ['jaw'], [
        { c: [0, 1.37, 1.12], r: [0.045, 0.028] },
        { c: [0, 1.305, 1.335], r: [0.024, 0.015] },
    ], { up: [0, 1, 0], blend: 0.012 });
    B.blob('nose', 'head', [0, 1.342, 1.385], [0.022, 0.016, 0.012], { blend: 0.004, keep: true });
    // The tail: a thin cord, its tuft.
    B.limb('tail', ['tail1', 'tail2', 'tail3', 'tail4'], [
        { c: [0, 0.90, -0.66], r: [0.05, 0.05] },
        { c: [0, 0.84, -0.84], r: 0.026 },
        { c: [0, 0.72, -1.02], r: 0.018 },
        { c: [0, 0.57, -1.14], r: 0.015 },
        { c: [0, 0.46, -1.18], r: 0.015 },
    ], { blend: 0.02 });
    B.limb('tuft', ['tail4'], [
        { c: [0, 0.49, -1.17], r: 0.018 },
        { c: [0, 0.42, -1.19], r: [0.038, 0.045] },
        { c: [0, 0.30, -1.215], r: 0.006 },
    ], { up: [0, 0, 1], blend: 0.012, keep: true });
    for (const [s, t] of SIDES) {
        B.blob(`eye${t}`, 'head', [0.062 * s, 1.436, 1.15], [0.02, 0.023, 0.024], { blend: 0.004, keep: true });
        // A horn: up from the brow, swept back and out, its tip turned in.
        B.limb(`horn${t}`, ['head'], [
            { c: [0.032 * s, 1.475, 1.085], r: 0.019 },
            { c: [0.058 * s, 1.60, 1.03], r: 0.015 },
            { c: [0.085 * s, 1.72, 0.95], r: 0.010 },
            { c: [0.07 * s, 1.80, 0.90], r: 0.003 },
        ], { up: [0, 0, 1], blend: 0.008, keep: true });
        // An ear: a long leaf out to the side, open forward.
        const e = bn(`ear${t}`);
        const at = (u) => e.head.map((x, i) => x + (e.tail[i] - x) * u);
        B.limb(`ear${t}`, [`ear${t}`], [
            { c: at(-0.15), r: [0.018, 0.012], bone: 'head' },
            { c: at(0.4), r: [0.036, 0.009] },
            { c: at(0.75), r: [0.028, 0.007] },
            { c: at(1.0), r: [0.005, 0.004] },
        ], { up: [0, 0.3, 1], blend: 0.008 });
        for (const k of [1, 2, 3]) {
            const u = bn(`upper${t}${k}`), l = bn(`lower${t}${k}`), f = bn(`foot${t}${k}`);
            const [x, , z] = u.head;
            // The front pair's shoulder is slimmer than the haunches behind.
            const w = k === 1 ? 0.9 : k === 2 ? 0.95 : 1.08;
            B.limb(`leg${t}${k}`, [`upper${t}${k}`, `lower${t}${k}`], [
                { c: [x * 0.82, 0.88, z], r: [0.07 * w, 0.115 * w], bone: `upper${t}${k}` },
                { c: on(u, 0.3), r: [0.058 * w, 0.085 * w] },
                { c: on(u, 0.72), r: [0.04, 0.052] },
                { c: l.head, r: [0.033, 0.038] },
                { c: on(l, 0.35), r: [0.022, 0.026] },
                { c: on(l, 0.84), r: [0.02, 0.023] },
                { c: f.head, r: [0.024, 0.027], bone: `lower${t}${k}` },
            ], { up: [0, 0, 1], blend: 0.03 });
            B.limb(`hoof${t}${k}`, [`foot${t}${k}`], [
                { c: on(f, 0.15), r: [0.026, 0.028] },
                { c: on(f, 0.7, [0, 0.003, 0]), r: [0.032, 0.026] },
                { c: on(f, 1.0, [0, 0.012, 0]), r: [0.022, 0.012] },
            ], { up: [0, 1, 0], blend: 0.008, steps: 2 });
        }
    }
    return B.build();
}
