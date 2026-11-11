// The wader's body: masses on its bones blended into one skin
// (lab/flesh.js), as skeleton.js stands it:
//   trunk    an egg 0.32 m long and 0.17 across, carried a little nose-up,
//            the breast full, sleek shoulder pockets under the folded wings
//   wings    each a piece of its own, built spread: two-station arm segments
//            under layered coverts and a crisp blade to every flight feather
//   neck     long and slender in a continuous 8-station S-spline, thickest at
//            the base and flowing smoothly when coiled or extended
//   head     small, a dark crest trailing from the crown, the bill a
//            dagger 14 cm long
//   legs     feathered drumsticks out of the belly, the bare tarsi long and
//            thin, three toes spread forward and one behind
// Blue-grey above with pale-edged coverts, the neck and face white, a black
// stripe over the eye into the crest (face.bk), slate-black primaries, yellow
// bill and legs.

import { Flesh, SIDES } from "/app/lab/flesh.js";
import { WING, WING_Y } from "./skeleton.js";

const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const add = (a, b) => a.map((x, i) => x + b[i]);
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const GREY = [0.50, 0.54, 0.60], DARKGREY = [0.33, 0.36, 0.41], WHITE = [0.91, 0.91, 0.89];
const SILVER = [0.74, 0.77, 0.81], BLACK = [0.07, 0.07, 0.08], YELLOW = [0.86, 0.68, 0.22], LEG = [0.62, 0.52, 0.26];
const SLATE = [0.20, 0.22, 0.27];

// z of the spread wing's leading edge at |x| out along it.
function WING_FRONT(x) {
    const a = WING.shoulder, e = WING.elbow, w = WING.wrist, t = WING.tip;
    const seg = (p, q) => p[1] + (q[1] - p[1]) * Math.max(0, Math.min(1, (x - p[0]) / (q[0] - p[0])));
    return (x < e[0] ? seg(a, e) : x < w[0] ? seg(e, w) : seg(w, t)) + 0.03;
}

function coat(p, n, share) {
    const LR = (k) => share(k + 'L') + share(k + 'R');
    // Blue-grey mantle with subtle pale scapular sheen, white breast and belly.
    let c = mix(GREY, SILVER, 0.22 * sstep(0.3, 0.85, n[1]) * sstep(-0.08, 0.12, p[2]));
    c = mix(c, WHITE, 0.72 * sstep(-0.12, -0.68, n[1]));
    c = mix(c, WHITE, 0.55 * sstep(0.11, 0.17, p[2]) * sstep(0.56, 0.63, p[1]));
    // The wings (p is where the skin stands spread): blue-grey coverts with
    // crisp pale covert margins, dark carpal patch, slate-black flight feathers.
    let fl = 0, cv = LR('arm');
    for (const f of WING.feathers) { fl += LR(f.name); cv += LR('c' + f.name); }
    const wing = Math.min(1, cv + fl);
    if (wing > 0) {
        const x = Math.abs(p[0]);
        const back = WING_FRONT(x) - p[2];
        const feather = sstep(0.38, 0.62, fl / (cv + fl));
        const covEdge = (1 - feather) * sstep(0.055, 0.105, back) * (1 - sstep(0.115, 0.145, back));
        let up = mix(mix(GREY, DARKGREY, 0.26 + 0.48 * sstep(0.32, 0.8, x)), SLATE, feather);
        up = mix(up, SILVER, 0.45 * covEdge);
        up = mix(up, BLACK, feather * (0.28 + 0.42 * sstep(0.09, 0.28, back) + 0.34 * sstep(0.45, 0.8, x)));
        const under = mix(mix(WHITE, GREY, 0.42), mix(GREY, SLATE, 0.58), feather);
        c = mix(c, mix(up, under, sstep(-0.1, -0.5, n[1])), wing);
    }
    // The neck and face white, the crest black.
    const neck = Math.min(1, share('neck') + share('throat') + share('skull') + share('head'));
    c = mix(c, WHITE, neck);
    c = mix(c, BLACK, share('crest') + share('skull') * sstep(0.924, 0.934, p[1]));
    c = mix(c, YELLOW, share('bill'));
    c = mix(c, LEG, LR('shank') + LR('tarsus') + LR('toes') + LR('toeOut') + LR('toeIn') + LR('toeBack'));
    return c;
}

export function body(skel, detail = {}) {
    const B = new Flesh(skel, {
        color: coat,
        triangles: 20000,
        pieces: { wingL: 4800, wingR: 4800 },
        cell: 0.003,
        ...detail,
    });
    const bn = (name) => skel.bones[skel.index(name)];
    const bAt = (b, u, off = [0, 0, 0]) => add(lerp(b.head, b.tail, u), off);

    // Trunk: sleek egg tapering cleanly ahead of the tail base so `tail` owns
    // its own feather fan (`0` bound warnings) and wings nest flush outside.
    B.limb('trunk', ['body'], [
        { c: [0, 0.570, -0.112], r: [0.044, 0.038], bone: 'body' },
        { c: [0, 0.568, -0.070], r: [0.072, 0.068], bone: 'body' },
        { c: [0, 0.578, 0.005], r: [0.085, 0.084], bone: 'body' },
        { c: [0, 0.600, 0.082], r: [0.083, 0.082], bone: 'body' },
        { c: [0, 0.624, 0.148], r: [0.058, 0.060], bone: 'body' },
        { c: [0, 0.638, 0.174], r: [0.040, 0.042], bone: 'body' },
    ], { up: [0, 1, 0], blend: 0.024 });

    B.limb('tail', ['tail'], [
        { c: [0, 0.574, -0.126], r: [0.042, 0.017], bone: 'tail' },
        { c: [0, 0.560, -0.192], r: [0.048, 0.011], bone: 'tail' },
        { c: [0, 0.544, -0.258], r: [0.038, 0.006], bone: 'tail' },
    ], { up: [0, 1, 0], blend: 0.011 });

    // 8-station S-curved heron neck with smooth joint blending so coiled poses
    // (`idle`, `graze`, `flight`, `lie`) form a continuous graceful S-curve.
    const n1 = bn('neck1'), n2 = bn('neck2'), n3 = bn('neck3');
    B.blob('throat', [['body', 0.45], ['neck1', 0.55]], [0, 0.634, 0.156], [0.044, 0.048, 0.044], { blend: 0.026 });
    B.limb('neck', ['neck1', 'neck2', 'neck3'], [
        { c: bAt(n1, 0.02, [0, -0.004, -0.006]), r: [0.043, 0.045], bone: 'neck1' },
        { c: bAt(n1, 0.44, [0, 0, 0.002]), r: [0.035, 0.037], bone: 'neck1' },
        { c: bAt(n1, 0.88, [0, 0, -0.002]), r: [0.029, 0.031], bone: 'neck1' },
        { c: bAt(n2, 0.28), r: [0.026, 0.028], bone: 'neck2' },
        { c: bAt(n2, 0.76), r: [0.0235, 0.0255], bone: 'neck2' },
        { c: bAt(n3, 0.25), r: [0.0225, 0.0245], bone: 'neck3' },
        { c: bAt(n3, 0.72), r: [0.022, 0.024], bone: 'neck3' },
        { c: [0, 0.896, 0.204], r: [0.023, 0.025], bone: 'head' },
    ], { up: [0, 0, 1], joint: 0.026, blend: 0.020 });

    B.blob('skull', 'head', [0, 0.906, 0.226], [0.026, 0.028, 0.038], { blend: 0.012 });
    B.limb('bill', ['head'], [
        { c: [0, 0.902, 0.255], r: [0.011, 0.013], bone: 'head' },
        { c: [0, 0.895, 0.32], r: [0.007, 0.008], bone: 'head' },
        { c: [0, 0.887, 0.395], r: 0.0016, bone: 'head' },
    ], { blend: 0.005, keep: true });
    B.limb('crest', ['head'], [
        { c: [0, 0.925, 0.205], r: [0.006, 0.004], bone: 'head' },
        { c: [0, 0.918, 0.15], r: [0.004, 0.003], bone: 'head' },
        { c: [0, 0.905, 0.10], r: 0.0016, bone: 'head' },
    ], { blend: 0.004 });

    for (const [s, t] of SIDES) {
        B.blob(`eye${t}`, 'head', [0.021 * s, 0.912, 0.235], [0.007, 0.007, 0.007], { blend: 0.002, keep: true });
        // Subtle scapular shoulder fairing on the trunk where the folded wing meets the breast.
        B.blob(`scapula${t}`, 'body', [0.076 * s, 0.622, 0.108], [0.020, 0.022, 0.044], { blend: 0.020 });

        // Spread wing in its own piece (`wingL` / `wingR`), with two stations
        // per bone on `humerus`, `forearm`, and `hand` so Z-folding at the
        // shoulder, elbow, and wrist never stretches a single bone span.
        const at = (p) => [p[0] * s, WING_Y, p[1]];
        const seg = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
        const piece = `wing${t}`;
        B.limb(`arm${t}`, [`humerus${t}`, `forearm${t}`, `hand${t}`], [
            { c: at(seg(WING.shoulder, WING.elbow, 0.04)), r: [0.028, 0.015], bone: `humerus${t}` },
            { c: at(seg(WING.shoulder, WING.elbow, 0.80)), r: [0.029, 0.015], bone: `humerus${t}` },
            { c: at(seg(WING.elbow, WING.wrist, 0.20)), r: [0.029, 0.0145], bone: `forearm${t}` },
            { c: at(seg(WING.elbow, WING.wrist, 0.82)), r: [0.028, 0.0135], bone: `forearm${t}` },
            { c: at(seg(WING.wrist, WING.tip, 0.14)), r: [0.026, 0.0125], bone: `hand${t}` },
            { c: at(seg(WING.wrist, WING.tip, 0.56)), r: [0.023, 0.0098], bone: `hand${t}` },
            { c: at(WING.tip), r: [0.014, 0.006], bone: `hand${t}` },
        ], { up: [0, 1, 0], joint: 0.018, blend: 0.0035, piece });

        for (const f of WING.feathers) {
            const along = (u) => [f.root[0] + (f.tip[0] - f.root[0]) * u, f.root[1] + (f.tip[1] - f.root[1]) * u];
            const prim = f.name[0] === 'p';
            const w = prim ? 0.035 : 0.045;
            const fb = `${f.name}${t}`;
            B.limb(fb, [fb], [
                { c: at(f.root), r: [w * 0.72, 0.0072], bone: fb },
                { c: at(along(0.52)), r: [w, 0.0064], bone: fb },
                { c: at(f.tip), r: [w * (prim ? 0.46 : 0.74), 0.0054], bone: fb },
            ], { up: [0, 1, 0], blend: 0.0028, piece });
            B.limb(`c${fb}`, [fb], [
                { c: at(f.root), r: [w * 0.80, 0.0118], bone: fb },
                { c: at(along(prim ? 0.30 : 0.42)), r: [w * 0.94, 0.0098], bone: fb },
            ], { up: [0, 1, 0], blend: 0.0028, piece });
        }

        const fe = bn(`femur${t}`), ti = bn(`tibia${t}`);
        const ta = bn(`tarsus${t}`), to = bn(`toe${t}`);
        const x = fe.head[0];
        // The drumstick: feathered thigh out of the belly, tapering to the ankle.
        B.limb(`thigh${t}`, [`femur${t}`, `tibia${t}`], [
            { c: [x * 0.9, 0.535, 0.045], r: [0.040, 0.046], bone: `femur${t}` },
            { c: bAt(fe, 0.72), r: [0.034, 0.038], bone: `femur${t}` },
            { c: bAt(ti, 0.12), r: [0.027, 0.030], bone: `tibia${t}` },
            { c: [x, 0.42, 0.055], r: [0.016, 0.018], bone: `tibia${t}` },
        ], { up: [0, 0, 1], joint: 0.016, blend: 0.014 });
        // The bare lower drumstick, the joint, the tarsus.
        B.limb(`shank${t}`, [`tibia${t}`], [
            { c: [x, 0.43, 0.06], r: 0.009, bone: `tibia${t}` },
            { c: ti.tail, r: 0.0095, bone: `tibia${t}` },
        ], { blend: 0.006 });
        B.limb(`tarsus${t}`, [`tibia${t}`, `tarsus${t}`], [
            { c: ti.tail, r: 0.0105, bone: `tibia${t}` },
            { c: bAt(ta, 0.18), r: 0.009, bone: `tarsus${t}` },
            { c: [x, 0.15, 0.0], r: 0.0085, bone: `tarsus${t}` },
            { c: ta.tail, r: 0.009, bone: `tarsus${t}` },
        ], { joint: 0.012, blend: 0.006 });
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
