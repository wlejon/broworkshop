// The strider's body: masses on its bones blended into one skin
// (lab/flesh.js), as skeleton.js stands it. Drawn for a clear silhouette:
// every part reads apart from the next, wide where it carries muscle and
// pinched at its joints.
//   head      large and round on a slim neck, full cheeks, a short muzzle
//             with a dark nose, big eyes set forward under a brow, tall
//             round ears on the crown
//   trunk     the shoulders sloping from the neck to round deltoids, a deep
//             chest narrowing to a waist, the hips wider again, two round
//             glutes behind; the legs part high, so each reads as its own
//   arms      long, to the knees: slim above the elbow, the forearm's
//             muscle below it, a slim wrist, a narrow palm, three fingers
//             and a thumb
//   legs      full thighs tapering to the knee, a calf, slim ankles;
//             plantigrade feet, a round heel and three toes
//   tail      long and bushy, thickest past its middle, ringed
// Fur the colour of dry bark, darker down the back, on the shins and the
// forearms, pale on the throat, chest, belly and muzzle; dark rings down the
// tail and a dark tip; the bare hands and soles dark.

import { Flesh, SIDES } from "/app/lab/flesh.js";

const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const add = (a, b) => a.map((x, i) => x + b[i]);
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const FUR = [0.52, 0.39, 0.26], BACK = [0.30, 0.21, 0.14], PALE = [0.86, 0.78, 0.64], RING = [0.22, 0.15, 0.10];
const SKIN = [0.20, 0.15, 0.13], EYE = [0.05, 0.04, 0.03], LID = [0.16, 0.12, 0.10], EAR = [0.40, 0.27, 0.22];

function coat(p, n, share) {
    const LR = (k) => share(k + 'L') + share(k + 'R');
    // Darker down the back, from the crown to the rump.
    let c = mix(FUR, BACK, 0.75 * sstep(-0.1, -0.7, n[2]) * sstep(0.6, 0.8, p[1]));
    // Dark stockings: the shins and the forearms.
    c = mix(c, BACK, 0.75 * LR('leg') * sstep(0.34, 0.18, p[1]));
    c = mix(c, BACK, 0.7 * LR('arm') * sstep(0.74, 0.6, p[1]));
    // Pale underneath: the throat, a bib down the chest, the belly.
    const front = sstep(0.3, 0.75, n[2]) * sstep(0.12, 0.05, Math.abs(p[0]));
    c = mix(c, PALE, 0.85 * front * sstep(0.74, 0.86, p[1]) * sstep(1.1, 1.04, p[1]));
    c = mix(c, PALE, share('throat'));
    c = mix(c, mix(FUR, PALE, 0.7), 0.7 * share('belly') * sstep(0.2, 0.7, n[2]));
    // The tail: dark rings, a dark tip.
    const tl = share('tail');
    if (tl > 0) {
        const along = -p[2];
        const ring = sstep(0.25, 0.75, Math.sin(along * 48 - 1.2)) * sstep(0.2, 0.26, along);
        c = mix(c, RING, tl * Math.max(0.85 * ring, sstep(0.47, 0.53, along)));
    }
    // The face: a pale muzzle and cheeks, the ears darker at their rims.
    c = mix(c, PALE, share('muzzle') + 0.75 * LR('cheek'));
    c = mix(c, EAR, 0.8 * LR('ear') * sstep(0.2, 0.7, Math.abs(n[0])));
    let bare = LR('palm') + LR('thumb') + LR('sole');
    for (const i of [0, 1, 2]) bare += LR(`finger${i}`) + LR(`toe${i}`);
    c = mix(c, SKIN, bare);
    c = mix(c, LID, LR('lid'));
    return mix(c, EYE, LR('eye') + share('nose'));
}

// `detail` overrides the meshing (Flesh's cell, triangles, simplifyError, keep)
// for a coarser level of detail of the same body.
export function body(skel, detail = {}) {
    const B = new Flesh(skel, { color: coat, triangles: 20000, cell: 0.0045, ...detail });
    // The trunk: hips, a waist, the chest's barrel, the shoulders' top.
    B.limb('trunk', ['pelvis', 'spine', 'chest'], [
        { c: [0, 0.625, -0.015], r: [0.072, 0.062] },
        { c: [0, 0.675, -0.012], r: [0.122, 0.088] },
        { c: [0, 0.735, -0.008], r: [0.112, 0.082] },
        { c: [0, 0.80, -0.006], r: [0.094, 0.076] },
        { c: [0, 0.875, -0.002], r: [0.115, 0.088] },
        { c: [0, 0.95, 0.004], r: [0.138, 0.104] },
        { c: [0, 1.01, -0.006], r: [0.128, 0.094] },
        { c: [0, 1.05, -0.012], r: [0.085, 0.07] },
    ], { up: [0, 0, 1], blend: 0.022 });
    B.blob('belly', [['spine', 0.6], ['pelvis', 0.4]], [0, 0.755, 0.03], [0.08, 0.07, 0.055], { blend: 0.025 });
    B.blob('throat', 'neck', [0, 1.075, 0.03], [0.03, 0.035, 0.02], { blend: 0.02 });
    // The neck, slim under the skull.
    B.limb('neck', ['chest', 'neck'], [
        { c: [0, 1.035, -0.012], r: [0.062, 0.056] },
        { c: [0, 1.095, 0.004], r: [0.039, 0.044] },
        { c: [0, 1.14, 0.012], r: [0.046, 0.05], bone: 'head' },
    ], { up: [0, 0, 1], blend: 0.02 });
    // The head: a large round skull, full cheeks, a short muzzle.
    B.blob('skull', 'head', [0, 1.205, 0.012], [0.094, 0.092, 0.09], { blend: 0.015 });
    B.blob('brow', 'head', [0, 1.238, 0.072], [0.07, 0.022, 0.032], { blend: 0.012 });
    B.limb('muzzle', ['head'], [
        { c: [0, 1.168, 0.074], r: [0.05, 0.043] },
        { c: [0, 1.16, 0.115], r: [0.033, 0.029] },
        { c: [0, 1.158, 0.137], r: [0.019, 0.017] },
    ], { up: [0, 1, 0], blend: 0.012 });
    B.blob('nose', 'head', [0, 1.168, 0.149], [0.017, 0.012, 0.01], { blend: 0.004, keep: true });
    for (const [s, t] of SIDES) {
        B.blob(`cheek${t}`, 'head', [0.056 * s, 1.18, 0.06], [0.036, 0.034, 0.034], { blend: 0.012 });
        B.blob(`eye${t}`, 'head', [0.042 * s, 1.215, 0.098], [0.018, 0.018, 0.016], { blend: 0.004, keep: true });
        B.blob(`lid${t}`, 'head', [0.042 * s, 1.228, 0.095], [0.021, 0.011, 0.016], { blend: 0.005, keep: true });
        // Tall round ears on the crown, thin, a little out.
        B.blob(`ear${t}`, 'head', [0.072 * s, 1.29, -0.012], [0.012, 0.042, 0.034], { blend: 0.01 });
        const bn = (n) => skel.bones[skel.index(`${n}${t}`)];
        const ua = bn('upperarm'), fa = bn('forearm'), hd = bn('hand');
        const at = (b, u) => lerp(b.head, b.tail, u);
        // The shoulder's slope, from the neck's base out to the deltoid.
        B.limb(`trap${t}`, [`shoulder${t}`], [
            { c: [0.035 * s, 1.045, -0.022], r: [0.03, 0.028] },
            { c: [0.13 * s, 1.025, -0.02], r: [0.04, 0.036] },
        ], { up: [0, 1, 0], blend: 0.02 });
        B.blob(`delt${t}`, `upperarm${t}`, add(ua.head, [0.006 * s, -0.016, 0.0]), [0.043, 0.056, 0.047], { blend: 0.018 });
        B.blob(`pec${t}`, 'chest', [0.065 * s, 0.965, 0.055], [0.062, 0.05, 0.04], { blend: 0.02 });
        // The arm: slim above the elbow, the forearm's muscle below it.
        B.limb(`arm${t}`, [`upperarm${t}`, `forearm${t}`], [
            { c: at(ua, 0.12), r: [0.04, 0.042] },
            { c: at(ua, 0.55), r: [0.03, 0.033] },
            { c: fa.head, r: [0.025, 0.027] },
            { c: at(fa, 0.22), r: [0.031, 0.032] },
            { c: at(fa, 0.75), r: [0.021, 0.022] },
            { c: hd.head, r: [0.016, 0.018], bone: `forearm${t}` },
        ], { up: [0, 0, 1], blend: 0.016 });
        // The hand: a narrow palm, three fingers on from it and a thumb
        // forward and in.
        B.limb(`palm${t}`, [`hand${t}`], [
            { c: at(hd, 0.05), r: [0.015, 0.022] },
            { c: at(hd, 0.45), r: [0.011, 0.026] },
        ], { up: [0, 0, 1], blend: 0.008, steps: 2 });
        for (const [i, dz] of [[0, 0.015], [1, 0.0], [2, -0.014]]) {
            const f0 = add(at(hd, 0.45), [0, 0, dz]);
            B.limb(`finger${i}${t}`, [`hand${t}`], [
                { c: f0, r: 0.008 },
                { c: add(at(hd, 0.8), [0.002 * s, 0, dz * 1.15]), r: 0.0065 },
                { c: add(at(hd, 1.05), [0.004 * s, 0.004, dz * 1.2 + 0.006]), r: 0.005 },
            ], { blend: 0.004, steps: 2, keep: true });
        }
        const th0 = add(at(hd, 0.15), [-0.008 * s, 0, 0.019]);
        B.limb(`thumb${t}`, [`hand${t}`], [
            { c: th0, r: 0.0085 },
            { c: add(th0, [-0.006 * s, -0.033, 0.012]), r: 0.0065 },
        ], { blend: 0.005, steps: 2, keep: true });
        // The leg: a full thigh set out from the middle, so the legs part
        // high, tapering to the knee; a calf; a slim ankle.
        const th = bn('thigh'), sn = bn('shin'), ft = bn('foot');
        const x = th.head[0];
        B.limb(`leg${t}`, [`thigh${t}`, `shin${t}`], [
            { c: [x * 1.04, 0.645, -0.004], r: [0.066, 0.076], bone: `thigh${t}` },
            { c: [x, 0.56, 0.008], r: [0.06, 0.074] },
            { c: [x, 0.47, 0.014], r: [0.05, 0.062] },
            { c: sn.head, r: [0.037, 0.042] },
            { c: [x, 0.31, -0.006], r: [0.036, 0.04] },
            { c: [x, 0.19, -0.01], r: [0.026, 0.028] },
            { c: ft.head, r: [0.021, 0.023], bone: `shin${t}` },
        ], { up: [0, 0, 1], blend: 0.018 });
        B.blob(`glute${t}`, [[`thigh${t}`, 0.35], ['pelvis', 0.65]], [0.052 * s, 0.65, -0.058], [0.062, 0.068, 0.055], { blend: 0.02 });
        // The front of the thigh, full over its middle.
        B.blob(`quad${t}`, `thigh${t}`, [x, 0.53, 0.036], [0.044, 0.07, 0.036], { blend: 0.02 });
        B.blob(`calf${t}`, `shin${t}`, [x, 0.315, -0.026], [0.028, 0.05, 0.024], { blend: 0.018 });
        // The foot: a round heel behind the ankle, the sole flat, three
        // short toes on its front.
        B.limb(`sole${t}`, [`foot${t}`], [
            { c: [x, 0.03, -0.026], r: [0.024, 0.027] },
            { c: [x, 0.028, 0.032], r: [0.029, 0.024] },
            { c: [x * 1.03, 0.019, 0.098], r: [0.034, 0.017] },
        ], { up: [0, 1, 0], blend: 0.011 });
        for (const [i, dx] of [[0, -0.019], [1, 0.0], [2, 0.019]]) {
            const tx = x * 1.03 + dx * s;
            B.limb(`toe${i}${t}`, [`toe${t}`], [
                { c: [tx, 0.016, 0.108], r: 0.0105 },
                { c: [tx + dx * 0.2 * s, 0.009, 0.15 - Math.abs(dx) * 0.6], r: 0.0082 },
            ], { blend: 0.006, steps: 2 });
        }
    }
    // The tail: from the base of the spine, bushiest past its middle.
    B.limb('tail', ['tail1', 'tail2', 'tail3', 'tail4'], [
        { c: [0, 0.668, -0.06], r: [0.038, 0.04] },
        { c: [0, 0.6, -0.17], r: [0.045, 0.047] },
        { c: [0, 0.545, -0.29], r: [0.054, 0.056] },
        { c: [0, 0.515, -0.42], r: [0.052, 0.054] },
        { c: [0, 0.535, -0.52], r: [0.036, 0.038] },
        { c: [0, 0.555, -0.565], r: [0.014, 0.014] },
    ], { up: [0, 1, 0], blend: 0.02 });
    B.section('waist', { at: [0, 0.8, -0.006], normal: [0, 1, 0], bone: 'spine', radius: 0.3 });
    B.section('chest', { at: [0, 0.95, 0.0], normal: [0, 1, 0], bone: 'chest', radius: 0.3 });
    return B.build();
}
