// The finch's body: masses on its bones blended into one skin
// (lab/flesh.js), as skeleton.js stands it:
//   trunk   a plump egg 7 cm long, the breast full, the belly's feathers
//           hiding the thighs down to the ankle
//   head    round, close on the neck, a stout cone of a bill
//   wings   folded along the flanks, the tips crossed over the tail
//   tail    long and narrow, a little notched, angled down
//   legs    the bare tarsi short and thin, three toes forward, one back
// Warm brown above with a chestnut cap, a grey nape and cheek, a buff breast
// paling to a white belly. The wings are a darker brown with a buff bar and dark flight feathers,
// the tail dark, the bill horn-pink, the legs pinkish.

import { Flesh, SIDES } from "/app/lab/flesh.js";

const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const BROWN = [0.45, 0.32, 0.20], CHESTNUT = [0.48, 0.20, 0.10], GREY = [0.55, 0.55, 0.55];
const BUFF = [0.80, 0.66, 0.48], WHITE = [0.88, 0.86, 0.82], DARK = [0.16, 0.12, 0.09];
const WING = [0.36, 0.25, 0.16];
const BILL = [0.72, 0.58, 0.52], LEG = [0.70, 0.55, 0.50];

function coat(p, n, share) {
    const LR = (k) => share(k + 'L') + share(k + 'R');
    // Brown above, buff below, the belly white.
    let c = mix(BROWN, BUFF, sstep(0.1, -0.5, n[1]));
    c = mix(c, WHITE, sstep(-0.5, -0.9, n[1]) * sstep(0.02, -0.01, p[2]));
    // The head: a grey cheek and nape, a chestnut cap.
    const hd = share('skull');
    c = mix(c, mix(GREY, BUFF, sstep(-0.2, -0.7, n[1])), hd);
    c = mix(c, CHESTNUT, hd * sstep(0.2, 0.6, n[1]) * sstep(0.025, 0.04, p[2]));
    // Wings: brown, the flight feathers dark.
    const w = LR('wing');
    // (A shade darker than the back, so the folded wing reads on the flank;
    // a buff bar across it where the coverts end.)
    c = mix(c, WING, sstep(0.3, 0.7, w));
    c = mix(c, DARK, w * sstep(-0.012, -0.026, p[2]));
    c = mix(c, BUFF, 0.8 * sstep(0.45, 0.8, w) * sstep(-0.011, -0.007, p[2]) * sstep(-0.001, -0.005, p[2]));
    c = mix(c, DARK, share('tail') * sstep(-0.045, -0.06, p[2]));
    c = mix(c, BILL, share('bill'));
    c = mix(c, LEG, LR('tarsus') + LR('toes') + LR('toeOut') + LR('toeIn') + LR('toeBack'));
    return c;
}

export function body(skel, detail = {}) {
    const B = new Flesh(skel, { color: coat, triangles: 16000, cell: 0.0006, ...detail });
    B.limb('trunk', ['body'], [
        { c: [0, 0.047, -0.035], r: [0.012, 0.011] },
        { c: [0, 0.044, -0.015], r: [0.020, 0.019] },
        { c: [0, 0.046, 0.005], r: [0.0215, 0.022] },
        { c: [0, 0.052, 0.020], r: [0.019, 0.019] },
        { c: [0, 0.058, 0.030], r: [0.014, 0.014] },
    ], { up: [0, 1, 0], blend: 0.005 });
    B.limb('tail', ['tail'], [
        { c: [0, 0.050, -0.036], r: [0.009, 0.004] },
        { c: [0, 0.043, -0.060], r: [0.010, 0.0018] },
        { c: [0, 0.036, -0.085], r: [0.011, 0.0012] },
    ], { up: [0, 1, 0], blend: 0.003 });
    B.limb('neck', ['neck'], [
        { c: [0, 0.060, 0.026], r: [0.013, 0.013] },
        { c: [0, 0.071, 0.033], r: [0.011, 0.011] },
    ], { up: [0, 0, 1], blend: 0.004 });
    B.blob('skull', 'head', [0, 0.077, 0.040], [0.0115, 0.0115, 0.0125], { blend: 0.003 });
    B.limb('bill', ['head'], [
        { c: [0, 0.0745, 0.049], r: [0.0048, 0.0052] },
        { c: [0, 0.0725, 0.056], r: [0.0028, 0.003] },
        { c: [0, 0.0712, 0.0615], r: 0.0004 },
    ], { blend: 0.0012, keep: true });
    for (const [s, t] of SIDES) {
        B.blob(`eye${t}`, 'head', [0.0095 * s, 0.0785, 0.0445], [0.0026, 0.0026, 0.0026], { blend: 0.0008, keep: true });
        B.limb(`wing${t}`, [`humerus${t}`, `forearm${t}`, `hand${t}`], [
            // (Lying in the flank, their inner faces inside the body and
            // their tops no higher than the back between them: thin plates
            // standing off it left a trough behind the neck and a ragged
            // edge over the rump.)
            { c: [0.0145 * s, 0.054, 0.018], r: [0.006, 0.008], bone: `humerus${t}` },
            { c: [0.0175 * s, 0.050, 0.0], r: [0.006, 0.010] },
            { c: [0.0135 * s, 0.050, -0.025], r: [0.0055, 0.008] },
            { c: [0.008 * s, 0.050, -0.045], r: [0.004, 0.0045], bone: `hand${t}` },
            { c: [0.004 * s, 0.047, -0.060], r: [0.002, 0.002], bone: `hand${t}` },
        ], { up: [0, 1, 0], blend: 0.003 });
        const ta = skel.bones[skel.index(`tarsus${t}`)], to = skel.bones[skel.index(`toe${t}`)];
        const x = ta.head[0];
        // The feathered thigh into the belly, down to the ankle.
        B.limb(`thigh${t}`, [`femur${t}`, `tibia${t}`], [
            { c: [x * 0.8, 0.036, 0.010], r: [0.008, 0.009], bone: `femur${t}` },
            { c: [x, 0.024, 0.006], r: [0.0045, 0.005], bone: `tibia${t}` },
            { c: [x, 0.0185, 0.001], r: 0.0022, bone: `tibia${t}` },
        ], { up: [0, 0, 1], blend: 0.003 });
        B.limb(`tarsus${t}`, [`tarsus${t}`], [
            { c: ta.head, r: 0.0016 },
            { c: ta.tail, r: 0.0013 },
        ], { blend: 0.001, keep: true });
        const ball = ta.tail;
        const toe = (name, tip) => B.limb(name, [`toe${t}`], [
            { c: [ball[0], 0.0022, ball[2]], r: 0.0012 },
            { c: tip, r: 0.0007 },
        ], { blend: 0.0008, steps: 2, keep: true });
        toe(`toes${t}`, [x, 0.0007, to.tail[2]]);
        toe(`toeOut${t}`, [x + 0.006 * s, 0.0007, 0.016]);
        toe(`toeIn${t}`, [x - 0.005 * s, 0.0007, 0.016]);
        toe(`toeBack${t}`, [x, 0.0007, -0.006]);
    }
    return B.build();
}
