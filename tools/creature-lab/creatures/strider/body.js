// The strider's body: masses on its bones blended into one skin
// (lab/flesh.js), as skeleton.js stands it:
//   trunk     a deep chest broad across the shoulders, narrowing to a
//             waist, the hips a little wider again; a flat belly
//   head      a round skull on a short neck, a short tapering muzzle with
//             a dark nose, eyes set forward under a brow, tall round ears
//             on the sides of the crown
//   arms      long, to the knees: a rounded shoulder, a slim upper arm, a
//             forearm thickening below the elbow and tapering to the
//             wrist, a narrow palm with three fingers and a thumb
//   legs      thighs full at the hip and tapering to the knee, a calf, a
//             slim ankle; plantigrade feet, a round heel and four toes
// Fur the colour of dry bark, darker down the back and on the forearms and
// shins, pale on the throat, chest and muzzle; the bare hands and soles dark.

import { Flesh, SIDES } from "/app/lab/flesh.js";

const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const add = (a, b) => a.map((x, i) => x + b[i]);
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const FUR = [0.50, 0.38, 0.26], BACK = [0.28, 0.20, 0.14], PALE = [0.84, 0.76, 0.62];
const SKIN = [0.20, 0.15, 0.13], EYE = [0.05, 0.04, 0.03], LID = [0.16, 0.12, 0.10], EAR = [0.36, 0.24, 0.20];

function coat(p, n, share) {
    const LR = (k) => share(k + 'L') + share(k + 'R');
    // Darker down the back, from the crown to the rump.
    let c = mix(FUR, BACK, 0.8 * sstep(-0.1, -0.7, n[2]) * sstep(0.55, 0.75, p[1]));
    // Dark stockings: the shins and the forearms.
    c = mix(c, BACK, 0.7 * LR('leg') * sstep(0.36, 0.2, p[1]));
    c = mix(c, BACK, 0.7 * LR('arm') * sstep(0.76, 0.62, p[1]));
    // A pale bib: the throat and chest, fading down the belly.
    c = mix(c, PALE, 0.85 * sstep(0.35, 0.8, n[2]) * sstep(0.78, 0.92, p[1]) * sstep(1.12, 1.06, p[1]) * sstep(0.1, 0.05, Math.abs(p[0])));
    c = mix(c, PALE, share('throat'));
    c = mix(c, mix(FUR, PALE, 0.6), 0.6 * share('belly') * sstep(0.2, 0.7, n[2]));
    // The face: a pale muzzle and a pale ring about the eyes.
    c = mix(c, PALE, share('muzzle') + 0.7 * LR('cheek'));
    c = mix(c, EAR, 0.7 * LR('ear') * sstep(0.2, 0.7, Math.abs(n[0])));
    let bare = LR('palm') + LR('thumb') + LR('sole');
    for (const i of [0, 1, 2]) bare += LR(`finger${i}`);
    for (const i of [0, 1, 2, 3]) bare += LR(`toe${i}`);
    c = mix(c, SKIN, bare);
    c = mix(c, LID, LR('lid'));
    return mix(c, EYE, LR('eye') + share('nose'));
}

// `detail` overrides the meshing (Flesh's cell, triangles, simplifyError, keep)
// for a coarser level of detail of the same body.
export function body(skel, detail = {}) {
    const B = new Flesh(skel, { color: coat, triangles: 18000, cell: 0.0045, ...detail });
    B.limb('trunk', ['pelvis', 'spine', 'chest'], [
        { c: [0, 0.605, -0.012], r: [0.105, 0.080] },
        { c: [0, 0.675, -0.010], r: [0.135, 0.095] },
        { c: [0, 0.79, -0.008], r: [0.112, 0.085] },
        { c: [0, 0.90, -0.004], r: [0.140, 0.104] },
        { c: [0, 0.975, -0.010], r: [0.158, 0.106] },
        { c: [0, 1.035, -0.014], r: [0.118, 0.080] },
    ], { up: [0, 0, 1], blend: 0.025 });
    B.blob('belly', [['spine', 0.7], ['pelvis', 0.3]], [0, 0.765, 0.035], [0.09, 0.075, 0.06], { blend: 0.03 });
    B.blob('rump', 'pelvis', [0, 0.64, -0.055], [0.11, 0.07, 0.06], { blend: 0.03 });
    B.limb('neck', ['chest', 'neck'], [
        { c: [0, 1.03, -0.006], r: [0.075, 0.068] },
        { c: [0, 1.12, 0.010], r: [0.052, 0.054] },
    ], { up: [0, 0, 1], blend: 0.025 });
    B.blob('throat', 'neck', [0, 1.09, 0.040], [0.035, 0.04, 0.02], { blend: 0.02 });
    B.blob('skull', 'head', [0, 1.20, 0.02], [0.084, 0.088, 0.088], { blend: 0.015 });
    B.blob('brow', 'head', [0, 1.235, 0.078], [0.068, 0.020, 0.030], { blend: 0.012 });
    B.limb('muzzle', ['head'], [
        { c: [0, 1.168, 0.075], r: [0.050, 0.042] },
        { c: [0, 1.162, 0.118], r: [0.034, 0.030] },
        { c: [0, 1.160, 0.142], r: [0.020, 0.018] },
    ], { up: [0, 1, 0], blend: 0.012 });
    B.blob('nose', 'head', [0, 1.170, 0.155], [0.017, 0.012, 0.010], { blend: 0.004, keep: true });
    for (const [s, t] of SIDES) {
        B.blob(`cheek${t}`, 'head', [0.048 * s, 1.20, 0.072], [0.03, 0.03, 0.03], { blend: 0.01 });
        B.blob(`eye${t}`, 'head', [0.038 * s, 1.212, 0.095], [0.017, 0.017, 0.015], { blend: 0.004, keep: true });
        B.blob(`lid${t}`, 'head', [0.038 * s, 1.224, 0.092], [0.020, 0.010, 0.015], { blend: 0.005, keep: true });
        // Tall round ears, thin, standing out from the sides of the crown.
        B.blob(`ear${t}`, 'head', [0.080 * s, 1.272, -0.004], [0.011, 0.034, 0.028], { blend: 0.01 });
        const bn = (n) => skel.bones[skel.index(`${n}${t}`)];
        const ua = bn('upperarm'), fa = bn('forearm'), hd = bn('hand');
        const at = (b, u) => lerp(b.head, b.tail, u);
        // The arm: a round shoulder over the joint, slim above the elbow,
        // the forearm's muscle just below it.
        B.blob(`delt${t}`, `upperarm${t}`, add(ua.head, [0.005 * s, -0.01, 0.0]), [0.05, 0.06, 0.052], { blend: 0.02 });
        B.limb(`arm${t}`, [`shoulder${t}`, `upperarm${t}`, `forearm${t}`], [
            { c: [0.13 * s, 1.0, -0.016], r: [0.048, 0.050], bone: `shoulder${t}` },
            { c: at(ua, 0.15), r: [0.044, 0.046] },
            { c: at(ua, 0.6), r: [0.034, 0.038] },
            { c: fa.head, r: [0.031, 0.034] },
            { c: at(fa, 0.25), r: [0.035, 0.036] },
            { c: at(fa, 0.7), r: [0.026, 0.028] },
            { c: hd.head, r: [0.020, 0.022], bone: `forearm${t}` },
        ], { up: [0, 0, 1], blend: 0.018 });
        // The hand: a narrow palm, three fingers on from it and a thumb
        // forward and in.
        B.limb(`palm${t}`, [`hand${t}`], [
            { c: at(hd, 0.05), r: [0.016, 0.024] },
            { c: at(hd, 0.45), r: [0.012, 0.028] },
        ], { up: [0, 0, 1], blend: 0.008, steps: 2 });
        for (const [i, dz] of [[0, 0.016], [1, 0.0], [2, -0.015]]) {
            const f0 = add(at(hd, 0.45), [0, 0, dz]);
            B.limb(`finger${i}${t}`, [`hand${t}`], [
                { c: f0, r: 0.0085 },
                { c: add(at(hd, 0.8), [0.002 * s, 0, dz * 1.15]), r: 0.007 },
                { c: add(at(hd, 1.05), [0.004 * s, 0.004, dz * 1.2 + 0.006]), r: 0.0055 },
            ], { blend: 0.004, steps: 2, keep: true });
        }
        const th0 = add(at(hd, 0.15), [-0.008 * s, 0, 0.020]);
        B.limb(`thumb${t}`, [`hand${t}`], [
            { c: th0, r: 0.009 },
            { c: add(th0, [-0.006 * s, -0.035, 0.012]), r: 0.007 },
        ], { blend: 0.005, steps: 2, keep: true });
        const th = bn('thigh'), sn = bn('shin'), ft = bn('foot');
        const x = th.head[0];
        B.limb(`leg${t}`, [`thigh${t}`, `shin${t}`], [
            { c: [x * 0.92, 0.63, 0.0], r: [0.075, 0.082], bone: `thigh${t}` },
            { c: [x, 0.50, 0.010], r: [0.060, 0.064] },
            { c: [x, 0.40, 0.014], r: [0.046, 0.050] },
            { c: sn.head, r: [0.042, 0.046] },
            { c: [x, 0.28, -0.004], r: [0.042, 0.046] },
            { c: [x, 0.16, -0.010], r: [0.030, 0.032] },
            { c: ft.head, r: [0.025, 0.027], bone: `shin${t}` },
        ], { up: [0, 0, 1], blend: 0.02 });
        B.blob(`calf${t}`, `shin${t}`, [x, 0.285, -0.032], [0.036, 0.06, 0.03], { blend: 0.02 });
        // The foot: a round heel behind the ankle, the sole flat, four short
        // toes on its front.
        B.limb(`sole${t}`, [`foot${t}`], [
            { c: [x, 0.034, -0.032], r: [0.028, 0.030] },
            { c: [x, 0.032, 0.035], r: [0.034, 0.028] },
            { c: [x * 1.03, 0.022, 0.105], r: [0.040, 0.019] },
        ], { up: [0, 1, 0], blend: 0.012 });
        for (const [i, dx] of [[0, -0.026], [1, -0.009], [2, 0.009], [3, 0.026]]) {
            const tx = x * 1.04 + dx * s;
            B.limb(`toe${i}${t}`, [`toe${t}`], [
                { c: [tx, 0.018, 0.112], r: 0.0105 },
                { c: [tx * 1.0 + dx * 0.15 * s, 0.010, 0.155 - Math.abs(dx) * 0.5], r: 0.0085 },
            ], { blend: 0.006, steps: 2 });
        }
    }
    B.section('waist', { at: [0, 0.79, -0.01], normal: [0, 1, 0], bone: 'spine', radius: 0.3 });
    B.section('chest', { at: [0, 0.95, -0.02], normal: [0, 1, 0], bone: 'chest', radius: 0.3 });
    return B.build();
}
