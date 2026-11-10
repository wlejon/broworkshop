// The human's body: masses on its bones blended into one skin
// (lab/flesh.js), as skeleton.js stands it. Drawn for its silhouette, a
// person a little simplified:
//   trunk     hips, a waist narrower than both, a rib cage deep in front,
//             shoulders square and wider than the hips
//   head      an egg, wider at the back and the crown, a jaw and chin under
//             its front, a small nose, an ear each side; a cap of hair over
//             the crown and down the back of the skull
//   arms      a round shoulder, an upper arm, a forearm fuller under the
//             elbow and slim at the wrist; a hand of a palm, four fingers
//             held together a little curled, and a thumb forward of them
//   legs      a full thigh, a knee, a calf behind the shin, a slim ankle;
//             a boot with a heel behind the ankle and a long sole
// Dressed: a tunic to the top of the thighs, belted, its sleeves to the
// elbows; trousers; boots to under the calf. Bare head, forearms and hands.

import { Flesh, SIDES } from "/app/lab/flesh.js";

const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const add = (a, b) => a.map((x, i) => x + b[i]);
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const SKIN = [0.83, 0.6, 0.46], HAIR = [0.17, 0.1, 0.06], TUNIC = [0.16, 0.4, 0.44], TRIM = [0.82, 0.72, 0.5];
const BELT = [0.24, 0.13, 0.07], TROUSER = [0.3, 0.26, 0.23], BOOT = [0.15, 0.09, 0.06], EYE = [0.9, 0.88, 0.84];

function coat(p, n, share) {
    const LR = (k) => share(k + 'L') + share(k + 'R');
    const arm = LR('arm'), leg = LR('leg');
    let c = SKIN;
    // The tunic: the trunk and the arms to the elbows, its hem at the top
    // of the thighs; a pale band at the hem, the cuffs and the neck.
    const hem = sstep(0.845, 0.86, p[1]);
    const sleeve = sstep(1.165, 1.18, p[1]);
    const body = (share('trunk') + share('breast') + leg) * hem;
    c = mix(c, TUNIC, Math.min(1, body + arm * sleeve));
    c = mix(c, BELT, share('trunk') * sstep(1.03, 1.045, p[1]) * sstep(1.1, 1.085, p[1]));
    // Trousers under it, boots to under the calf.
    c = mix(c, TROUSER, Math.min(1, share('trunk') + leg) * (1 - hem));
    const boot = Math.min(1, LR('boot') + LR('heel') + leg * sstep(0.31, 0.295, p[1]));
    c = mix(c, BOOT, boot);
    // The head: skin, the hair over it.
    c = mix(c, SKIN, share('skull') + share('jaw') + share('nose') + share('neck') + LR('ear'));
    const hair = share('hair') + share('nape') + share('fringe');
    const face = sstep(0.055, 0.085, p[2]) * sstep(1.712, 1.695, p[1]);
    c = mix(c, HAIR, Math.min(1, 1.6 * hair) * (1 - face));
    c = mix(c, SKIN, LR('palm') + LR('thumb') + LR('finger0') + LR('finger1') + LR('finger2') + LR('finger3'));
    return mix(c, EYE, LR('eye'));
}

// `detail` overrides the meshing (Flesh's cell, triangles, simplifyError,
// keep) for a coarser level of detail of the same body.
export function body(skel, detail = {}) {
    const B = new Flesh(skel, { color: coat, triangles: 28000, cell: 0.005, ...detail });
    const bn = (n) => skel.bones[skel.index(n)];
    const at = (b, u, off = [0, 0, 0]) => add(lerp(b.head, b.tail, u), off);
    // The trunk: hips, a waist, a rib cage, square shoulders.
    B.limb('trunk', ['pelvis', 'spine', 'chest'], [
        { c: [0, 0.855, -0.005], r: [0.095, 0.08] },
        { c: [0, 0.94, -0.008], r: [0.168, 0.108] },
        { c: [0, 1.02, -0.004], r: [0.152, 0.1] },
        { c: [0, 1.1, 0.004], r: [0.132, 0.09] },
        { c: [0, 1.2, 0.012], r: [0.148, 0.102] },
        { c: [0, 1.31, 0.014], r: [0.166, 0.11] },
        { c: [0, 1.4, 0.004], r: [0.168, 0.098] },
        { c: [0, 1.455, -0.004], r: [0.12, 0.07] },
        { c: [0, 1.49, -0.006], r: [0.058, 0.054] },
    ], { up: [0, 0, 1], blend: 0.024 });
    B.blob('breast', 'chest', [0, 1.315, 0.07], [0.125, 0.075, 0.05], { blend: 0.035 });
    B.limb('neck', ['chest', 'neck'], [
        { c: [0, 1.47, -0.006], r: [0.056, 0.056] },
        { c: [0, 1.53, 0.004], r: [0.05, 0.052] },
        { c: [0, 1.6, 0.012], r: [0.05, 0.054], bone: 'head' },
    ], { up: [0, 0, 1], blend: 0.018 });
    // The head: an egg wider behind, a jaw under its front.
    B.blob('skull', 'head', [0, 1.662, 0.018], [0.076, 0.094, 0.098], { blend: 0.014 });
    B.blob('jaw', 'head', [0, 1.6, 0.05], [0.058, 0.052, 0.058], { blend: 0.02 });
    B.limb('nose', ['head'], [
        { c: [0, 1.648, 0.107], r: [0.009, 0.008] },
        { c: [0, 1.624, 0.122], r: [0.0125, 0.011] },
        { c: [0, 1.612, 0.112], r: [0.012, 0.008] },
    ], { up: [0, 1, 0], blend: 0.008, keep: true });
    // The hair: a cap over the crown and down the back of the skull, a
    // fringe over the brow.
    B.blob('hair', 'head', [0, 1.69, -0.004], [0.086, 0.082, 0.104], { blend: 0.012 });
    B.blob('nape', 'head', [0, 1.635, -0.05], [0.078, 0.07, 0.062], { blend: 0.012 });
    B.blob('fringe', 'head', [0, 1.722, 0.07], [0.066, 0.03, 0.04], { blend: 0.012 });
    for (const [s, t] of SIDES) {
        B.blob(`eye${t}`, 'head', [0.032 * s, 1.642, 0.094], [0.0145, 0.0125, 0.012], { blend: 0.003, keep: true });
        B.blob(`ear${t}`, 'head', [0.077 * s, 1.637, 0.004], [0.01, 0.03, 0.017], { blend: 0.006, keep: true });
        // The arm: a round shoulder, the upper arm, a forearm fuller under
        // the elbow and slim at the wrist.
        const sh = bn(`shoulder${t}`), ua = bn(`upperarm${t}`), fa = bn(`forearm${t}`), hd = bn(`hand${t}`);
        B.limb(`arm${t}`, [`shoulder${t}`, `upperarm${t}`, `forearm${t}`], [
            { c: at(sh, 0.6), r: [0.058, 0.056], bone: `shoulder${t}` },
            { c: at(ua, 0.03), r: [0.058, 0.06], bone: `upperarm${t}` },
            { c: at(ua, 0.35), r: [0.047, 0.05] },
            { c: at(ua, 0.8), r: [0.04, 0.042] },
            { c: fa.head, r: [0.038, 0.04] },
            { c: at(fa, 0.25), r: [0.04, 0.042] },
            { c: at(fa, 0.7), r: [0.03, 0.032] },
            { c: hd.head, r: [0.023, 0.027], bone: `forearm${t}` },
        ], { up: [0, 0, 1], blend: 0.014 });
        // The hand: a palm, four fingers on from it, a thumb forward.
        B.limb(`palm${t}`, [`hand${t}`], [
            { c: at(hd, 0.04), r: [0.018, 0.03] },
            { c: at(hd, 0.5), r: [0.014, 0.041] },
        ], { up: [0, 0, 1], blend: 0.008, steps: 2 });
        for (const [i, d] of [[0, 0.03], [1, 0.01], [2, -0.01], [3, -0.029]]) {
            const len = [0.98, 1.06, 1.02, 0.9][i];
            B.limb(`finger${i}${t}`, [`hand${t}`], [
                { c: at(hd, 0.5, [0, 0, d]), r: 0.0095 },
                { c: at(hd, 0.78, [-0.004 * s, 0, 1.02 * d]), r: 0.0088 },
                { c: at(hd, len, [-0.016 * s, 0, 1.0 * d]), r: 0.007 },
            ], { blend: 0.004, steps: 3, keep: true });
        }
        const th0 = at(hd, 0.14, [-0.006 * s, 0.0, 0.034]);
        B.limb(`thumb${t}`, [`hand${t}`], [
            { c: th0, r: 0.012 },
            { c: add(th0, [-0.006 * s, -0.04, 0.026]), r: 0.0098 },
            { c: add(th0, [-0.012 * s, -0.072, 0.03]), r: 0.0075 },
        ], { blend: 0.006, steps: 3, keep: true });
        // The leg: a full thigh, the knee, a calf behind the shin, a slim
        // ankle.
        const th = bn(`thigh${t}`), sn = bn(`shin${t}`), ft = bn(`foot${t}`), to = bn(`toe${t}`);
        B.limb(`leg${t}`, [`thigh${t}`, `shin${t}`], [
            { c: at(th, -0.02, [0.004 * s, 0, -0.012]), r: [0.088, 0.098], bone: `thigh${t}` },
            { c: at(th, 0.25, [0.004 * s, 0, -0.004]), r: [0.084, 0.092] },
            { c: at(th, 0.65), r: [0.067, 0.073] },
            { c: at(th, 0.95), r: [0.055, 0.06] },
            { c: at(sn, 0.06, [0, 0, 0.004]), r: [0.052, 0.056] },
            { c: at(sn, 0.32, [0, 0, -0.018]), r: [0.05, 0.06] },
            { c: at(sn, 0.68, [0, 0, -0.008]), r: [0.038, 0.043] },
            { c: at(sn, 0.95), r: [0.034, 0.038], bone: `shin${t}` },
        ], { up: [0, 0, 1], blend: 0.02 });
        // The boot: an ankle, a heel behind and under it, a long sole to
        // the ball, a rounded toe.
        B.limb(`boot${t}`, [`foot${t}`, `toe${t}`], [
            { c: at(ft, -0.05, [0, 0.0, -0.004]), r: [0.036, 0.04], bone: `foot${t}` },
            { c: at(ft, 0.4, [0, 0.0, 0]), r: [0.04, 0.034], bone: `foot${t}` },
            { c: at(ft, 0.92, [0, 0.014, 0]), r: [0.047, 0.031], bone: `foot${t}` },
            { c: at(to, 0.45, [0, 0.017, 0]), r: [0.044, 0.027], bone: `toe${t}` },
            { c: at(to, 0.95, [0, 0.018, 0]), r: [0.03, 0.02], bone: `toe${t}` },
        ], { up: [0, 1, 0], blend: 0.012 });
        B.blob(`heel${t}`, `foot${t}`, add(ft.head, [0, -0.046, -0.022]), [0.034, 0.038, 0.042], { blend: 0.012 });
    }
    B.section('waist', { at: [0, 1.1, 0.004], normal: [0, 1, 0], bone: 'spine', radius: 0.3 });
    B.section('hips', { at: [0, 0.94, 0.0], normal: [0, 1, 0], bone: 'pelvis', radius: 0.3 });
    return B.build();
}
