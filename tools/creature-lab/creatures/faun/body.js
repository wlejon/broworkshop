// The faun's body: masses on its bones blended into one skin
// (lab/flesh.js), as skeleton.js stands it. Drawn for its silhouette, a
// slim upright body over heavy shaggy haunches:
//   head      a long head with a blunt muzzle and a tuft under the chin, two
//             ridged horns swept back from the brow, a leaf of an ear
//             drooping each side, a mane from the crown down the nape
//   trunk     square shoulders, a deep chest, a narrow waist, wide hips
//   arms      long, hanging to the thighs: a round shoulder, a lean upper
//             arm and forearm, a hand of three fingers and a thumb
//   legs      the strider's: the haunch and thigh as one heavy mass, a slim
//             shin to the raised hock, a long slim foot, the paw
//   tail      a short upturned tuft
// Tawny above the waist, paler down the breast and belly and on the face;
// dark shaggy brown from the waist down and on the forearms, hands, mane
// and tail; pale horns, dark at their tips.

import { Flesh, SIDES } from "/app/lab/flesh.js";

const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const add = (a, b) => a.map((x, i) => x + b[i]);
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const TAWNY = [0.62, 0.42, 0.24], PALE = [0.88, 0.76, 0.58], SHAG = [0.2, 0.125, 0.085], DARK = [0.09, 0.065, 0.055];
const HORN = [0.8, 0.74, 0.62], EYE = [0.03, 0.02, 0.02], EAR_IN = [0.8, 0.58, 0.5];

function coat(p, n, share) {
    const LR = (k) => share(k + 'L') + share(k + 'R');
    // Tawny, paler down the front; shaggy and dark from the waist down.
    let c = mix(TAWNY, PALE, 0.85 * sstep(0.1, 0.8, n[2]) * sstep(0.115, 0.04, Math.abs(p[0])) * sstep(1.2, 1.1, p[1]));
    c = mix(c, SHAG, sstep(0.9, 0.8, p[1] + 0.05 * n[2]) * (1 - LR('arm') - LR('palm')));
    c = mix(c, SHAG, LR('leg'));
    c = mix(c, DARK, LR('foot') + LR('paw') + LR('toe0') + LR('toe1') + LR('toe2'));
    // The forearms darken to the hands.
    c = mix(c, SHAG, LR('arm') * sstep(0.78, 0.62, p[1]));
    c = mix(c, DARK, LR('palm') + LR('thumb') + LR('finger0') + LR('finger1') + LR('finger2'));
    // The head: a pale face, a dark nose and chin tuft, the mane.
    c = mix(c, PALE, 0.8 * (share('muzzle') + 0.6 * share('skull') * sstep(0.0, 0.7, n[2])));
    c = mix(c, DARK, share('nose') + 0.85 * share('beard'));
    c = mix(c, SHAG, share('mane') * sstep(0.3, -0.3, n[2]));
    const er = LR('ear');
    c = mix(c, EAR_IN, 0.8 * er * sstep(0.2, 0.7, n[2]));
    c = mix(c, SHAG, er * sstep(0.15, 0.185, Math.abs(p[0])));
    // The horns: pale bone, dark at the tips.
    const hn = LR('horn');
    c = mix(c, HORN, hn);
    c = mix(c, DARK, 0.8 * hn * sstep(0.0, -0.06, p[2]));
    c = mix(c, SHAG, share('tail'));
    c = mix(c, PALE, 0.7 * share('tail') * sstep(0.2, 0.8, -n[1]));
    return mix(c, EYE, LR('eye'));
}

// `detail` overrides the meshing (Flesh's cell, triangles, simplifyError,
// keep) for a coarser level of detail of the same body.
export function body(skel, detail = {}) {
    const B = new Flesh(skel, { color: coat, triangles: 24000, cell: 0.0045, ...detail });
    const bn = (n) => skel.bones[skel.index(n)];
    const at = (b, u, off = [0, 0, 0]) => add(lerp(b.head, b.tail, u), off);
    // The trunk: wide hips, a narrow waist, a deep chest, square shoulders.
    B.limb('trunk', ['pelvis', 'spine', 'chest'], [
        { c: [0, 0.69, -0.03], r: [0.085, 0.075] },
        { c: [0, 0.745, -0.008], r: [0.128, 0.105] },
        { c: [0, 0.815, 0.012], r: [0.108, 0.088] },
        { c: [0, 0.875, 0.03], r: [0.094, 0.078] },
        { c: [0, 0.945, 0.048], r: [0.108, 0.088] },
        { c: [0, 1.01, 0.062], r: [0.128, 0.098] },
        { c: [0, 1.055, 0.07], r: [0.118, 0.082] },
        { c: [0, 1.1, 0.078], r: [0.062, 0.056] },
    ], { up: [0, -0.2, 0.98], blend: 0.022 });
    // The breast, full in front.
    B.blob('breast', 'chest', [0, 1.0, 0.115], [0.095, 0.07, 0.05], { blend: 0.03 });
    B.limb('neck', ['chest', 'neck'], [
        { c: [0, 1.09, 0.078], r: [0.052, 0.054] },
        { c: [0, 1.17, 0.097], r: [0.046, 0.05], bone: 'head' },
    ], { up: [0, 0, 1], blend: 0.02 });
    // The head: a skull long from back to front, a blunt deep muzzle.
    B.blob('skull', 'head', [0, 1.252, 0.1], [0.078, 0.082, 0.092], { blend: 0.015 });
    B.limb('muzzle', ['head'], [
        { c: [0, 1.225, 0.165], r: [0.052, 0.046] },
        { c: [0, 1.205, 0.215], r: [0.038, 0.034] },
        { c: [0, 1.196, 0.245], r: [0.03, 0.026] },
    ], { up: [0, 1, 0], blend: 0.014 });
    B.blob('nose', 'head', [0, 1.208, 0.268], [0.02, 0.014, 0.01], { blend: 0.004, keep: true });
    B.limb('beard', ['head'], [
        { c: [0, 1.17, 0.215], r: 0.02 },
        { c: [0, 1.13, 0.212], r: 0.014 },
        { c: [0, 1.095, 0.2], r: 0.005 },
    ], { blend: 0.01, steps: 3 });
    // The mane: a crest of hair from the crown down the nape to between
    // the shoulders.
    B.limb('mane', ['head', 'neck', 'chest'], [
        { c: [0, 1.335, 0.075], r: [0.03, 0.03], bone: 'head' },
        { c: [0, 1.29, 0.015], r: [0.034, 0.045], bone: 'head' },
        { c: [0, 1.19, 0.015], r: [0.032, 0.045], bone: 'neck' },
        { c: [0, 1.09, 0.002], r: [0.03, 0.04], bone: 'chest' },
        { c: [0, 0.99, -0.02], r: [0.014, 0.018], bone: 'chest' },
    ], { up: [0, 0, 1], blend: 0.016 });
    for (const [s, t] of SIDES) {
        B.blob(`eye${t}`, 'head', [0.047 * s, 1.258, 0.168], [0.021, 0.021, 0.016], { blend: 0.004, keep: true });
        // A horn: up from the brow and swept back in a curve, tapering.
        B.limb(`horn${t}`, ['head'], [
            { c: [0.04 * s, 1.315, 0.115], r: 0.022 },
            { c: [0.056 * s, 1.385, 0.095], r: 0.019 },
            { c: [0.074 * s, 1.435, 0.04], r: 0.015 },
            { c: [0.088 * s, 1.445, -0.03], r: 0.01 },
            { c: [0.096 * s, 1.42, -0.085], r: 0.004 },
        ], { blend: 0.008, keep: true });
        // The ear: a long leaf out to the side, open to the front, drooping.
        const e = bn(`ear${t}`);
        B.limb(`ear${t}`, [`ear${t}`], [
            { c: at(e, -0.2), r: [0.012, 0.02], bone: 'head' },
            { c: at(e, 0.35), r: [0.012, 0.036] },
            { c: at(e, 0.75), r: [0.009, 0.028] },
            { c: at(e, 1.1), r: [0.005, 0.008] },
        ], { up: [0, 1, 0.3], blend: 0.008 });
        // The arm: a round shoulder, lean to the elbow, a forearm fuller
        // below it and slim at the wrist.
        const sh = bn(`shoulder${t}`), ua = bn(`upperarm${t}`), fa = bn(`forearm${t}`), hd = bn(`hand${t}`);
        B.limb(`arm${t}`, [`shoulder${t}`, `upperarm${t}`, `forearm${t}`], [
            { c: at(sh, 0.55), r: [0.05, 0.05], bone: `shoulder${t}` },
            { c: at(ua, 0.02), r: [0.05, 0.052], bone: `upperarm${t}` },
            { c: at(ua, 0.35), r: [0.04, 0.043] },
            { c: at(ua, 0.8), r: [0.032, 0.034] },
            { c: fa.head, r: [0.03, 0.031] },
            { c: at(fa, 0.25), r: [0.034, 0.035] },
            { c: at(fa, 0.7), r: [0.026, 0.027] },
            { c: hd.head, r: [0.02, 0.022], bone: `forearm${t}` },
        ], { up: [0, 0, 1], blend: 0.014 });
        // The hand: a palm, three fingers on from it and a thumb forward.
        B.limb(`palm${t}`, [`hand${t}`], [
            { c: at(hd, 0.05), r: [0.018, 0.027] },
            { c: at(hd, 0.55), r: [0.014, 0.032] },
        ], { up: [0, 0, 1], blend: 0.008, steps: 2 });
        for (const [i, d] of [[0, 0.02], [1, 0.0], [2, -0.02]]) {
            const w = [0, 0, d];
            B.limb(`finger${i}${t}`, [`hand${t}`], [
                { c: at(hd, 0.55, w), r: 0.0105 },
                { c: at(hd, 0.95, [0, 0, 1.1 * d]), r: 0.009 },
                { c: at(hd, 1.25 - 0.1 * Math.abs(i - 1), [-0.006 * s, 0, 1.15 * d + 0.004]), r: 0.0065 },
            ], { blend: 0.005, steps: 2, keep: true });
        }
        const th0 = at(hd, 0.2, [-0.004 * s, 0.0, 0.028]);
        B.limb(`thumb${t}`, [`hand${t}`], [
            { c: th0, r: 0.0105 },
            { c: add(th0, [-0.004 * s, -0.034, 0.024]), r: 0.007 },
        ], { blend: 0.006, steps: 2, keep: true });
        // The leg: the haunch and thigh as one heavy shaggy mass, a slim
        // shin, the hock's knob, a long slim foot.
        const th = bn(`thigh${t}`), sn = bn(`shin${t}`), ft = bn(`foot${t}`), to = bn(`toe${t}`);
        B.limb(`leg${t}`, [`thigh${t}`, `shin${t}`], [
            { c: at(th, -0.1, [0.016 * s, 0.0, -0.02]), r: [0.074, 0.094], bone: `thigh${t}` },
            { c: at(th, 0.4, [0.014 * s, 0, -0.012]), r: [0.07, 0.096] },
            { c: at(th, 0.85), r: [0.052, 0.068] },
            { c: at(sn, 0.08), r: [0.044, 0.056] },
            { c: at(sn, 0.32, [0, 0, -0.012]), r: [0.035, 0.05] },
            { c: at(sn, 0.62), r: [0.024, 0.031] },
            { c: at(sn, 0.85), r: [0.018, 0.021] },
            { c: at(sn, 1.0), r: [0.02, 0.024], bone: `shin${t}` },
        ], { up: [0, 0, 1], blend: 0.02 });
        B.limb(`foot${t}`, [`foot${t}`], [
            { c: at(ft, 0.0, [0, 0.004, -0.008]), r: [0.02, 0.025], bone: `shin${t}` },
            { c: at(ft, 0.4), r: [0.0145, 0.0165] },
            { c: at(ft, 0.95), r: [0.019, 0.019] },
        ], { up: [0, 0, 1], blend: 0.012 });
        // The paw: a broad pad under the ball, three toes spread ahead.
        B.blob(`paw${t}`, [[`toe${t}`, 0.6], [`foot${t}`, 0.4]], at(to, 0.1, [0, -0.003, 0]), [0.035, 0.018, 0.03], { blend: 0.01 });
        for (const [i, dx] of [[0, -0.021], [1, 0.0], [2, 0.021]]) {
            B.limb(`toe${i}${t}`, [`toe${t}`], [
                { c: at(to, 0.2, [dx * s, 0.0, 0]), r: 0.013 },
                { c: at(to, 1.0 - Math.abs(dx) * 7, [dx * 1.5 * s, 0.011, 0]), r: 0.0115 },
            ], { blend: 0.007, steps: 2 });
        }
    }
    // The tail: a short tuft, turned up.
    const t1 = bn('tail1'), t2 = bn('tail2');
    B.limb('tail', ['tail1', 'tail2'], [
        { c: at(t1, -0.4), r: [0.03, 0.03], bone: 'pelvis' },
        { c: at(t1, 0.6), r: [0.022, 0.024] },
        { c: at(t2, 0.4), r: [0.025, 0.027] },
        { c: at(t2, 1.05), r: [0.008, 0.008] },
    ], { up: [0, 0, -1], blend: 0.016 });
    B.section('waist', { at: [0, 0.875, 0.03], normal: [0, 0.98, 0.2], bone: 'spine', radius: 0.3 });
    B.section('hips', { at: [0, 0.745, 0.0], normal: [0, 0.98, 0.2], bone: 'pelvis', radius: 0.3 });
    return B.build();
}
