// The strider's body: masses on its bones blended into one skin
// (lab/flesh.js), as skeleton.js stands it. Drawn for its silhouette, soft
// and heavy low down:
//   head      large and round, cheek tufts out to a point each side, a
//             short muzzle with a dark nose, big eyes set forward, tall
//             leaf ears
//   trunk     a pear: narrow sloping shoulders under a ruff, a full belly,
//             wide haunches
//   arms      slim, carried in front, small hands of three fingers and a
//             thumb
//   legs      a heavy thigh running on from the haunch, a slim shin to the
//             raised hock, a long slim foot, and the paw it stands on
//   tail      long and bushy, thickest past its middle
// Russet fur, cream on the muzzle, cheeks, ruff, chest, belly and the
// tail's tip; dark stockings and gloves, dark ear tips and a dark band
// before the tail's tip.

import { Flesh, SIDES } from "/app/lab/flesh.js";

const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const add = (a, b) => a.map((x, i) => x + b[i]);
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const FUR = [0.66, 0.30, 0.11], BACK = [0.46, 0.19, 0.07], CREAM = [0.95, 0.88, 0.74], DARK = [0.11, 0.075, 0.06];
const EYE = [0.03, 0.02, 0.02], EAR_IN = [0.86, 0.66, 0.56];
// The head is drawn about HEAD_AT and stands, HEAD_S times the size, about
// HEAD_TO (the neck's top): face.bk has the same three.
const HEAD_AT = [0, 1.03, 0.105], HEAD_TO = [0, 1.0, 0.104], HEAD_S = 1.24;

function coat(p, n, share) {
    const LR = (k) => share(k + 'L') + share(k + 'R');
    // Darker down the back, from the crown to the tail.
    let c = mix(FUR, BACK, 0.8 * sstep(0.1, -0.6, n[2]) * sstep(0.5, 0.7, p[1]));
    // Cream underneath: the chest's bib and the belly, the ruff, the face.
    const front = sstep(0.15, 0.7, n[2]) * sstep(0.12, 0.055, Math.abs(p[0]));
    c = mix(c, CREAM, 0.95 * front * sstep(0.56, 0.66, p[1]) * sstep(1.0, 0.94, p[1]));
    c = mix(c, CREAM, 0.9 * share('ruff') * sstep(-0.5, 0.2, n[2]));
    c = mix(c, CREAM, share('muzzle') + 0.9 * LR('cheek') * sstep(1.14, 1.09, p[1]));
    // Dark stockings from the hock down, gloves from the wrist.
    c = mix(c, DARK, 0.92 * LR('leg') * sstep(0.30, 0.19, p[1]));
    c = mix(c, DARK, LR('foot') + LR('paw') + LR('toe0') + LR('toe1') + LR('toe2'));
    c = mix(c, DARK, 0.92 * LR('arm') * sstep(0.68, 0.60, p[1]));
    c = mix(c, DARK, LR('palm') + LR('thumb') + LR('finger0') + LR('finger1') + LR('finger2'));
    // The ears: dark tips and backs, pale inside.
    const er = LR('ear');
    c = mix(c, EAR_IN, 0.85 * er * sstep(0.1, 0.6, n[2]));
    c = mix(c, DARK, er * sstep(1.33, 1.385, p[1]));
    // The tail: a dark band, then a cream tip.
    const tl = share('tail');
    c = mix(c, DARK, 0.9 * tl * sstep(-0.56, -0.62, p[2]));
    c = mix(c, CREAM, tl * sstep(-0.68, -0.73, p[2]));
    return mix(c, EYE, LR('eye') + share('nose'));
}

// `detail` overrides the meshing (Flesh's cell, triangles, simplifyError,
// keep) for a coarser level of detail of the same body.
export function body(skel, detail = {}) {
    const B = new Flesh(skel, { color: coat, triangles: 22000, cell: 0.0045, ...detail });
    const bn = (n) => skel.bones[skel.index(n)];
    const at = (b, u, off = [0, 0, 0]) => add(lerp(b.head, b.tail, u), off);
    // The trunk, a pear: narrow at the shoulders, full at the belly and hips.
    B.limb('trunk', ['pelvis', 'spine', 'chest'], [
        { c: [0, 0.555, -0.02], r: [0.075, 0.075] },
        { c: [0, 0.615, -0.014], r: [0.132, 0.112] },
        { c: [0, 0.69, 0.018], r: [0.134, 0.118] },
        { c: [0, 0.77, 0.05], r: [0.11, 0.102] },
        { c: [0, 0.85, 0.078], r: [0.086, 0.086] },
        { c: [0, 0.915, 0.094], r: [0.068, 0.07] },
        { c: [0, 0.96, 0.1], r: [0.052, 0.055] },
    ], { up: [0, 0, 1], blend: 0.025 });
    B.blob('belly', [['spine', 0.6], ['pelvis', 0.4]], [0, 0.695, 0.075], [0.09, 0.09, 0.065], { blend: 0.03 });
    // The ruff: a collar of long fur about the neck, fuller in front.
    B.blob('ruff', [['chest', 0.5], ['neck', 0.5]], [0, 0.955, 0.112], [0.1, 0.055, 0.09], { blend: 0.022 });
    B.blob('bib', 'chest', [0, 0.9, 0.148], [0.062, 0.065, 0.042], { blend: 0.025 });
    B.limb('neck', ['chest', 'neck'], [
        { c: [0, 0.945, 0.098], r: [0.052, 0.052] },
        { c: [0, 1.02, 0.104], r: [0.052, 0.054], bone: 'head' },
    ], { up: [0, 0, 1], blend: 0.02 });
    // The head, drawn about the neck's top at HEAD_AT and scaled by
    // HEAD_S from there (face.bk draws on it in the unscaled coordinates):
    // a large round skull, a short muzzle, the nose.
    const hp = (v) => v.map((x, i) => HEAD_TO[i] + (x - HEAD_AT[i]) * HEAD_S);
    const hr = (r) => (Array.isArray(r) ? r.map((x) => x * HEAD_S) : r * HEAD_S);
    B.blob('skull', 'head', hp([0, 1.115, 0.11]), hr([0.104, 0.096, 0.104]), { blend: 0.015 });
    B.limb('muzzle', ['head'], [
        { c: hp([0, 1.088, 0.175]), r: hr([0.05, 0.04]) },
        { c: hp([0, 1.078, 0.215]), r: hr([0.032, 0.027]) },
        { c: hp([0, 1.075, 0.236]), r: hr([0.02, 0.018]) },
    ], { up: [0, 1, 0], blend: 0.014 });
    B.blob('nose', 'head', hp([0, 1.084, 0.25]), hr([0.016, 0.012, 0.01]), { blend: 0.004, keep: true });
    for (const [s, t] of SIDES) {
        // A cheek tuft, out and down to a point.
        B.limb(`cheek${t}`, ['head'], [
            { c: hp([0.07 * s, 1.092, 0.13]), r: hr([0.04, 0.042]) },
            { c: hp([0.118 * s, 1.07, 0.105]), r: hr([0.026, 0.03]) },
            { c: hp([0.158 * s, 1.045, 0.085]), r: hr([0.006, 0.007]) },
        ], { up: [0, 1, 0], blend: 0.014 });
        B.blob(`eye${t}`, 'head', hp([0.047 * s, 1.132, 0.186]), hr([0.025, 0.027, 0.02]), { blend: 0.004, keep: true });
        // The ear: a tall leaf, open to the front and a little out, wide
        // at its middle.
        const e1 = bn(`ear1${t}`), e2 = bn(`ear2${t}`);
        B.limb(`ear${t}`, [`ear1${t}`, `ear2${t}`], [
            { c: at(e1, -0.25), r: [0.028, 0.016], bone: 'head' },
            { c: at(e1, 0.45), r: [0.05, 0.012], bone: `ear1${t}` },
            { c: at(e2, 0.2), r: [0.045, 0.01], bone: `ear2${t}` },
            { c: at(e2, 1.0), r: [0.008, 0.006], bone: `ear2${t}` },
        ], { up: [0.45 * s, 0, 1], blend: 0.008 });
        // The arm: slim, a small round shoulder under the ruff.
        const ua = bn(`upperarm${t}`), fa = bn(`forearm${t}`), hd = bn(`hand${t}`);
        B.limb(`arm${t}`, [`shoulder${t}`, `upperarm${t}`, `forearm${t}`], [
            { c: [0.05 * s, 0.925, 0.09], r: [0.034, 0.036], bone: `shoulder${t}` },
            { c: at(ua, 0.08), r: [0.036, 0.038], bone: `upperarm${t}` },
            { c: at(ua, 0.6), r: [0.027, 0.029] },
            { c: fa.head, r: [0.023, 0.025] },
            { c: at(fa, 0.3), r: [0.025, 0.026] },
            { c: at(fa, 0.8), r: [0.018, 0.019] },
            { c: hd.head, r: [0.015, 0.017], bone: `forearm${t}` },
        ], { up: [0, 0, 1], blend: 0.016 });
        // The hand: a narrow palm, three fingers on from it and a thumb.
        B.limb(`palm${t}`, [`hand${t}`], [
            { c: at(hd, 0.05), r: [0.014, 0.02] },
            { c: at(hd, 0.5), r: [0.011, 0.024] },
        ], { up: [0, 0, 1], blend: 0.008, steps: 2 });
        for (const [i, d] of [[0, 0.014], [1, 0.0], [2, -0.014]]) {
            // (Spread across the palm's width: back to front of the body.)
            const w = [0, 0.3 * d, d];
            B.limb(`finger${i}${t}`, [`hand${t}`], [
                { c: at(hd, 0.5, w), r: 0.0078 },
                { c: at(hd, 0.85, [w[0], w[1] * 1.1, w[2] * 1.15]), r: 0.0064 },
                { c: at(hd, 1.1, [w[0] - 0.003 * s, w[1] * 1.2, w[2] * 1.2 + 0.004]), r: 0.005 },
            ], { blend: 0.004, steps: 2, keep: true });
        }
        const th0 = at(hd, 0.2, [-0.008 * s, 0.004, 0.018]);
        B.limb(`thumb${t}`, [`hand${t}`], [
            { c: th0, r: 0.008 },
            { c: add(th0, [-0.008 * s, -0.026, 0.02]), r: 0.006 },
        ], { blend: 0.005, steps: 2, keep: true });
        // The leg: the haunch and thigh as one heavy mass, a slim shin, the
        // hock's knob, a long slim foot.
        const th = bn(`thigh${t}`), sn = bn(`shin${t}`), ft = bn(`foot${t}`), to = bn(`toe${t}`);
        const x = th.head[0];
        B.limb(`leg${t}`, [`thigh${t}`, `shin${t}`], [
            { c: at(th, -0.08, [0.012 * s, 0, -0.02]), r: [0.076, 0.094], bone: `thigh${t}` },
            { c: at(th, 0.4, [0.008 * s, 0, -0.012]), r: [0.07, 0.09] },
            { c: at(th, 0.82), r: [0.048, 0.058] },
            { c: at(sn, 0.06), r: [0.04, 0.045] },
            { c: at(sn, 0.35, [0, 0, -0.008]), r: [0.034, 0.042] },
            { c: at(sn, 0.72), r: [0.023, 0.026] },
            { c: at(sn, 1.0), r: [0.022, 0.025], bone: `shin${t}` },
        ], { up: [0, 0, 1], blend: 0.02 });
        B.limb(`foot${t}`, [`foot${t}`], [
            { c: at(ft, 0.0, [0, 0.004, -0.008]), r: [0.021, 0.026], bone: `shin${t}` },
            { c: at(ft, 0.45), r: [0.016, 0.018] },
            { c: at(ft, 0.95), r: [0.02, 0.019] },
        ], { up: [0, 0, 1], blend: 0.012 });
        // The paw: a broad pad under the ball, three toes spread ahead.
        B.blob(`paw${t}`, [[`toe${t}`, 0.6], [`foot${t}`, 0.4]], at(to, 0.1, [0, -0.003, 0]), [0.034, 0.018, 0.03], { blend: 0.01 });
        for (const [i, dx] of [[0, -0.021], [1, 0.0], [2, 0.021]]) {
            B.limb(`toe${i}${t}`, [`toe${t}`], [
                { c: at(to, 0.2, [dx * s, 0.0, 0]), r: 0.0125 },
                { c: at(to, 1.0 - Math.abs(dx) * 7, [dx * 1.5 * s, 0.011, 0]), r: 0.011 },
            ], { blend: 0.007, steps: 2 });
        }
    }
    // The tail: bushy, thickest past its middle, a soft point.
    const tb = [1, 2, 3, 4, 5].map((i) => bn(`tail${i}`));
    B.limb('tail', tb.map((b) => b.name), [
        { c: at(tb[0], -0.3), r: [0.04, 0.042], bone: 'pelvis' },
        { c: at(tb[0], 0.7), r: [0.052, 0.054] },
        { c: tb[2].head, r: [0.074, 0.076] },
        { c: tb[3].head, r: [0.086, 0.088] },
        { c: tb[4].head, r: [0.08, 0.082] },
        { c: at(tb[4], 0.75), r: [0.052, 0.054] },
        { c: at(tb[4], 1.15), r: [0.012, 0.012] },
    ], { up: [0, 1, 0], blend: 0.022 });
    B.section('waist', { at: [0, 0.78, 0.052], normal: [0, 1, 0], bone: 'spine', radius: 0.3 });
    B.section('hips', { at: [0, 0.63, 0.0], normal: [0, 1, 0], bone: 'pelvis', radius: 0.3 });
    return B.build();
}
