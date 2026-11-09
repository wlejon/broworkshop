// The wader's body: masses on its bones blended into one skin
// (lab/flesh.js), as skeleton.js stands it:
//   trunk    an egg 0.32 m long and 0.19 across, carried a little nose-up,
//            the breast full, the back flat under the folded wings
//   wings    folded along the flanks, a slab from the shoulder to the
//            primaries' tips crossed over the tail
//   neck     long and slender in an S, thickest at its base
//   head     small, a dark crest trailing from the crown, the bill a
//            dagger 14 cm long
//   legs     feathered drumsticks out of the belly, the bare tarsi long and
//            thin, three toes spread forward and one behind
// Blue-grey above, the neck and face white, a black stripe over the eye into
// the crest (face.bk), the primaries near black, the bill and legs yellow.

import { Flesh, SIDES } from "/app/lab/flesh.js";

const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const GREY = [0.50, 0.54, 0.60], DARKGREY = [0.33, 0.36, 0.41], WHITE = [0.90, 0.90, 0.88];
const BLACK = [0.07, 0.07, 0.08], YELLOW = [0.86, 0.68, 0.22], LEG = [0.62, 0.52, 0.26];

function coat(p, n, share) {
    const LR = (k) => share(k + 'L') + share(k + 'R');
    let c = mix(GREY, WHITE, 0.6 * sstep(-0.2, -0.7, n[1]));
    // The wings darker, their primaries (behind z -0.14) near black.
    c = mix(c, DARKGREY, LR('wing'));
    c = mix(c, BLACK, LR('wing') * sstep(-0.13, -0.19, p[2]));
    // The neck and face white, the crest black.
    const neck = share('neck') + share('head');
    c = mix(c, WHITE, neck);
    c = mix(c, BLACK, share('crest') + share('head') * sstep(0.925, 0.935, p[1]));
    c = mix(c, YELLOW, share('bill'));
    c = mix(c, LEG, LR('shank') + LR('tarsus') + LR('toes') + LR('toeOut') + LR('toeIn') + LR('toeBack'));
    return c;
}

export function body(skel, detail = {}) {
    const B = new Flesh(skel, { color: coat, triangles: 16000, cell: 0.003, ...detail });
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
        // The folded wing over the flank, its tip over the tail.
        B.limb(`wing${t}`, [`humerus${t}`, `forearm${t}`, `hand${t}`], [
            { c: [0.068 * s, 0.632, 0.10], r: [0.014, 0.04], bone: `humerus${t}` },
            { c: [0.082 * s, 0.622, 0.0], r: [0.016, 0.05] },
            { c: [0.07 * s, 0.628, -0.11], r: [0.013, 0.04] },
            { c: [0.04 * s, 0.6, -0.20], r: [0.008, 0.024], bone: `hand${t}` },
            { c: [0.018 * s, 0.578, -0.25], r: [0.004, 0.008], bone: `hand${t}` },
        ], { up: [0, 1, 0], blend: 0.012 });
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
