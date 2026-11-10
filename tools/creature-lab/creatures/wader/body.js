// The wader's body: masses on its bones blended into one skin
// (lab/flesh.js), as skeleton.js stands it:
//   trunk    an egg 0.32 m long and 0.19 across, carried a little nose-up,
//            the breast full, the back flat under the folded wings
//   wings    each a piece of its own, built spread: the arm under its
//            coverts and a blade to every flight feather (the rig folds them)
//   neck     long and slender in an S, thickest at its base
//   head     small, a dark crest trailing from the crown, the bill a
//            dagger 14 cm long
//   legs     feathered drumsticks out of the belly, the bare tarsi long and
//            thin, three toes spread forward and one behind
// Blue-grey above, the neck and face white, a black stripe over the eye into
// the crest (face.bk), the primaries near black, the bill and legs yellow.

import { Flesh, SIDES } from "/app/lab/flesh.js";
import { WING, WING_Y } from "./skeleton.js";

const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const GREY = [0.50, 0.54, 0.60], DARKGREY = [0.33, 0.36, 0.41], WHITE = [0.90, 0.90, 0.88];
const BLACK = [0.07, 0.07, 0.08], YELLOW = [0.86, 0.68, 0.22], LEG = [0.62, 0.52, 0.26];
const SLATE = [0.20, 0.22, 0.27];

// z of the spread wing's leading edge at |x| out along it.
function WING_FRONT(x) {
    const a = WING.shoulder, e = WING.elbow, w = WING.wrist, t = WING.tip;
    const seg = (p, q) => p[1] + (q[1] - p[1]) * Math.max(0, Math.min(1, (x - p[0]) / (q[0] - p[0])));
    return (x < e[0] ? seg(a, e) : x < w[0] ? seg(e, w) : seg(w, t)) + 0.03;
}

function coat(p, n, share) {
    const LR = (k) => share(k + 'L') + share(k + 'R');
    let c = mix(GREY, WHITE, 0.6 * sstep(-0.2, -0.7, n[1]));
    // The wings (p is where the skin stands spread): the coverts over the
    // arm grey, a black patch at the wrist, the flight feathers slate and
    // darker to their tips; beneath, pale linings and grey flight feathers.
    let fl = 0, cv = LR('arm');
    for (const f of WING.feathers) { fl += LR(f.name); cv += LR('c' + f.name); }
    const wing = Math.min(1, cv + fl);
    if (wing > 0) {
        const x = Math.abs(p[0]);
        const back = WING_FRONT(x) - p[2];                    // m behind the leading edge
        const feather = sstep(0.4, 0.6, fl / (cv + fl));
        let up = mix(mix(GREY, DARKGREY, 0.3 + 0.5 * sstep(0.3, 0.8, x)), SLATE, feather);
        up = mix(up, BLACK, feather * (0.25 + 0.4 * sstep(0.10, 0.30, back) + 0.35 * sstep(0.45, 0.8, x)));
        const under = mix(mix(WHITE, GREY, 0.5), mix(GREY, SLATE, 0.6), feather);
        c = mix(c, mix(up, under, sstep(-0.1, -0.5, n[1])), wing);
    }
    // The neck and face white, the crest black.
    const neck = share('neck') + share('head');
    c = mix(c, WHITE, neck);
    c = mix(c, BLACK, share('crest') + share('head') * sstep(0.925, 0.935, p[1]));
    c = mix(c, YELLOW, share('bill'));
    c = mix(c, LEG, LR('shank') + LR('tarsus') + LR('toes') + LR('toeOut') + LR('toeIn') + LR('toeBack'));
    return c;
}

export function body(skel, detail = {}) {
    const B = new Flesh(skel, { color: coat, triangles: 16000, pieces: { wingL: 4000, wingR: 4000 }, cell: 0.003, ...detail });
    B.limb('trunk', ['body'], [
        { c: [0, 0.565, -0.15], r: [0.035, 0.03] },
        { c: [0, 0.565, -0.09], r: [0.075, 0.068] },
        { c: [0, 0.578, 0.00], r: [0.094, 0.088] },
        { c: [0, 0.60, 0.08], r: [0.09, 0.085] },
        { c: [0, 0.625, 0.15], r: [0.062, 0.062] },
        { c: [0, 0.64, 0.18], r: [0.04, 0.04] },
    ], { up: [0, 1, 0], blend: 0.025 });
    B.limb('tail', ['tail'], [
        { c: [0, 0.575, -0.13], r: [0.04, 0.016] },
        { c: [0, 0.562, -0.20], r: [0.048, 0.010] },
        { c: [0, 0.556, -0.255], r: [0.040, 0.005] },
    ], { up: [0, 1, 0], blend: 0.012 });
    B.limb('neck', ['neck1', 'neck2', 'neck3'], [
        { c: [0, 0.625, 0.14], r: [0.045, 0.045], bone: 'neck1' },
        { c: [0, 0.725, 0.20], r: [0.028, 0.03] },
        { c: [0, 0.82, 0.165], r: [0.022, 0.024] },
        { c: [0, 0.885, 0.195], r: [0.022, 0.024], bone: 'neck3' },
    ], { up: [0, 0, 1], blend: 0.018 });
    B.blob('skull', 'head', [0, 0.906, 0.226], [0.026, 0.028, 0.038], { blend: 0.01 });
    B.limb('bill', ['head'], [
        { c: [0, 0.902, 0.255], r: [0.011, 0.013] },
        { c: [0, 0.895, 0.32], r: [0.007, 0.008] },
        { c: [0, 0.887, 0.395], r: 0.0015 },
    ], { blend: 0.005, keep: true });
    B.limb('crest', ['head'], [
        { c: [0, 0.925, 0.205], r: [0.006, 0.004] },
        { c: [0, 0.918, 0.15], r: [0.004, 0.003] },
        { c: [0, 0.905, 0.10], r: 0.0015 },
    ], { blend: 0.004 });
    for (const [s, t] of SIDES) {
        B.blob(`eye${t}`, 'head', [0.021 * s, 0.912, 0.235], [0.007, 0.007, 0.007], { blend: 0.002, keep: true });
        // A wing, spread as the skeleton stands it, a piece of its own
        // (meshed apart from the body, which it lies against folded): the
        // arm under its coverts along the leading edge, and a broad blade
        // to each flight feather's bone, each lying over the next.
        const at = (p) => [p[0] * s, WING_Y, p[1]];
        const piece = `wing${t}`;
        B.limb(`arm${t}`, [`humerus${t}`, `forearm${t}`, `hand${t}`], [
            { c: at(WING.shoulder), r: [0.03, 0.016], bone: `humerus${t}` },
            { c: at(WING.elbow), r: [0.03, 0.015], bone: `forearm${t}` },
            { c: at(WING.wrist), r: [0.028, 0.013], bone: `hand${t}` },
            { c: at([0.68, 0.068]), r: [0.024, 0.010], bone: `hand${t}` },
            { c: at(WING.tip), r: [0.014, 0.006], bone: `hand${t}` },
        ], { up: [0, 1, 0], blend: 0.003, piece });
        for (const f of WING.feathers) {
            const along = (u) => [f.root[0] + (f.tip[0] - f.root[0]) * u, f.root[1] + (f.tip[1] - f.root[1]) * u];
            const prim = f.name[0] === 'p';
            const w = prim ? 0.036 : 0.046;
            B.limb(`${f.name}${t}`, [`${f.name}${t}`], [
                { c: at(f.root), r: [w * 0.7, 0.007] },
                { c: at(along(0.5)), r: [w, 0.006] },
                { c: at(f.tip), r: [w * (prim ? 0.45 : 0.75), 0.005] },
            ], { up: [0, 1, 0], blend: 0.003, piece });
            // Its covert: a shorter, thicker blade over its root, on the
            // same bone, so the coverts close with the feathers they
            // cover. (They end in a step over the blade, and the grey ends
            // at that step, where the mesh keeps an edge: a marking drawn
            // across a flat sheet has no vertices to hold it once the
            // sheet is decimated.)
            B.limb(`c${f.name}${t}`, [`${f.name}${t}`], [
                { c: at(f.root), r: [w * 0.8, 0.012] },
                { c: at(along(prim ? 0.3 : 0.42)), r: [w * 0.95, 0.010] },
            ], { up: [0, 1, 0], blend: 0.003, piece });
        }
        const fe = skel.bones[skel.index(`femur${t}`)], ti = skel.bones[skel.index(`tibia${t}`)];
        const ta = skel.bones[skel.index(`tarsus${t}`)], to = skel.bones[skel.index(`toe${t}`)];
        const x = fe.head[0];
        // The drumstick: feathered thigh out of the belly, tapering to the ankle.
        B.limb(`thigh${t}`, [`femur${t}`, `tibia${t}`], [
            { c: [x * 0.9, 0.53, 0.05], r: [0.04, 0.045], bone: `femur${t}` },
            { c: ti.head, r: [0.03, 0.034] },
            { c: [x, 0.42, 0.055], r: [0.016, 0.018], bone: `tibia${t}` },
        ], { up: [0, 0, 1], blend: 0.012 });
        // The bare lower drumstick, the joint, the tarsus.
        B.limb(`shank${t}`, [`tibia${t}`], [
            { c: [x, 0.43, 0.06], r: 0.009 },
            { c: ti.tail, r: 0.0095 },
        ], { blend: 0.006 });
        B.limb(`tarsus${t}`, [`tibia${t}`, `tarsus${t}`], [
            { c: ti.tail, r: 0.0105, bone: `tibia${t}` },
            { c: [x, 0.15, 0.0], r: 0.0085, bone: `tarsus${t}` },
            { c: ta.tail, r: 0.009, bone: `tarsus${t}` },
        ], { blend: 0.006 });
        const ball = ta.tail;
        const toe = (name, tip) => B.limb(name, [`toe${t}`], [
            { c: [ball[0], 0.012, ball[2]], r: 0.0075, bone: `toe${t}` },
            { c: tip, r: 0.004, bone: `toe${t}` },
        ], { blend: 0.004, steps: 2 });
        toe(`toes${t}`, [x, 0.004, to.tail[2]]);
        toe(`toeOut${t}`, [x + 0.04 * s, 0.004, 0.09]);
        toe(`toeIn${t}`, [x - 0.035 * s, 0.004, 0.09]);
        toe(`toeBack${t}`, [x, 0.004, -0.04]);
    }
    return B.build();
}
