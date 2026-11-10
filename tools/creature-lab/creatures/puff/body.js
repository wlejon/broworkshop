// The puff's body: masses on its bones blended into one skin
// (lab/flesh.js), as skeleton.js stands it. Drawn for its silhouette, a
// ball on stilts:
//   body      a round ball of feathers on the hips, fuller behind
//   head      a second, smaller ball sunk in the top of the first, about
//             the point it turns on, so it swivels inside the outline; a
//             wide flat face on its front, two great eyes, a small hooked
//             bill between them, a brow sweeping up and out over each eye
//             to a tuft
//   wings     a short blade hanging down each side, each a piece of its
//             own, so it lifts clear
//   legs      the strider's, the thighs lost in the body's feathers: a
//             slim shin to the raised hock, a long bare foot, three toes
//   tail      a short flat fan
// Dusk grey-brown above, barred darker on the wings and tail; cream below
// with soft bars across the breast, a pale face; ochre bill and feet.

import { Flesh, SIDES } from "/app/lab/flesh.js";

const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const add = (a, b) => a.map((x, i) => x + b[i]);
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const DUSK = [0.43, 0.36, 0.34], DEEP = [0.2, 0.16, 0.16], CREAM = [0.94, 0.89, 0.78], FACE = [0.97, 0.94, 0.87];
const OCHRE = [0.86, 0.62, 0.2], CLAW = [0.1, 0.08, 0.07], EYE = [0.03, 0.02, 0.02];

function coat(p, n, share) {
    const LR = (k) => share(k + 'L') + share(k + 'R');
    // Dusk above and behind, cream in front and below, soft bars across
    // the breast.
    const front = sstep(-0.25, 0.45, n[2] - 0.5 * n[1]);
    const bars = 0.5 + 0.5 * Math.sin(62 * p[1] + 9 * Math.cos(11 * p[0]));
    let c = mix(DUSK, CREAM, front);
    c = mix(c, DUSK, 0.28 * front * sstep(0.45, 0.9, bars) * sstep(0.92, 0.84, p[1]));
    // The crown and nape, darker; the face, pale.
    c = mix(c, DEEP, 0.45 * share('hood') * sstep(0.3, 0.9, n[1]));
    c = mix(c, FACE, share('disc'));
    c = mix(c, DEEP, 0.85 * (LR('brow') + LR('tuft')));
    // The wings and the tail: dusk, barred.
    const wg = LR('wing');
    c = mix(c, mix(DUSK, DEEP, 0.75 * sstep(0.35, 0.65, 0.5 + 0.5 * Math.sin(55 * p[1]))), wg);
    const tl = share('tail');
    c = mix(c, mix(DUSK, DEEP, 0.75 * sstep(0.35, 0.65, 0.5 + 0.5 * Math.sin(60 * p[2]))), tl);
    c = mix(c, CREAM, 0.6 * tl * sstep(0.1, 0.8, -n[1]));
    // The legs: feathered cream to the hock, bare below.
    c = mix(c, CREAM, LR('leg') * sstep(0.6, 0.5, p[1]));
    c = mix(c, OCHRE, LR('leg') * sstep(0.35, 0.31, p[1]));
    c = mix(c, OCHRE, LR('foot') + LR('paw') + LR('toe0') + LR('toe1') + LR('toe2') + share('bill'));
    c = mix(c, CLAW, LR('claw0') + LR('claw1') + LR('claw2'));
    c = mix(c, CLAW, 0.7 * share('bill') * sstep(0.92, 0.9, p[1]));
    return mix(c, EYE, LR('eye'));
}

// `detail` overrides the meshing (Flesh's cell, triangles, simplifyError,
// keep) for a coarser level of detail of the same body.
export function body(skel, detail = {}) {
    const B = new Flesh(skel, { color: coat, triangles: 20000, pieces: { wingL: 1200, wingR: 1200 }, cell: 0.0045, ...detail });
    const bn = (n) => skel.bones[skel.index(n)];
    const at = (b, u, off = [0, 0, 0]) => add(lerp(b.head, b.tail, u), off);
    // The body: a ball, and a fuller rump behind and below it.
    B.blob('ball', [['chest', 0.6], ['pelvis', 0.4]], [0, 0.855, 0.055], [0.236, 0.228, 0.226], { blend: 0.03 });
    B.blob('rump', 'pelvis', [0, 0.775, -0.07], [0.175, 0.15, 0.16], { blend: 0.035 });
    // The head: a ball about the point it turns on, a little flattened in
    // front where the face is.
    B.blob('hood', 'head', [0, 0.975, 0.075], [0.2, 0.182, 0.19], { blend: 0.03 });
    B.blob('disc', 'head', [0, 0.972, 0.195], [0.158, 0.13, 0.062], { blend: 0.02 });
    B.limb('bill', ['head'], [
        { c: [0, 0.96, 0.262], r: [0.026, 0.03] },
        { c: [0, 0.932, 0.294], r: [0.017, 0.02] },
        { c: [0, 0.898, 0.29], r: [0.004, 0.006] },
    ], { up: [0, 1, 0], blend: 0.006, keep: true });
    for (const [s, t] of SIDES) {
        B.blob(`eye${t}`, 'head', [0.078 * s, 0.985, 0.238], [0.046, 0.048, 0.024], { blend: 0.004, keep: true });
        // The brow: from over the bill up and out over the eye to the tuft.
        const tf = bn(`tuft${t}`);
        B.limb(`brow${t}`, ['head'], [
            { c: [0.02 * s, 1.022, 0.262], r: 0.014 },
            { c: [0.07 * s, 1.062, 0.232], r: 0.02 },
            { c: [0.1 * s, 1.1, 0.16], r: 0.024 },
        ], { blend: 0.012, steps: 3 });
        B.limb(`tuft${t}`, [`tuft${t}`], [
            { c: at(tf, -0.25), r: [0.03, 0.022], bone: 'head' },
            { c: at(tf, 0.35), r: [0.026, 0.016] },
            { c: at(tf, 0.75), r: [0.016, 0.01] },
            { c: at(tf, 1.05), r: [0.005, 0.004] },
        ], { up: [0, 0, 1], blend: 0.008 });
        // The wing: a short blade down the side, a piece of its own.
        const piece = `wing${t}`;
        B.limb(`wing${t}`, [`wing${t}`], [
            { c: [0.2 * s, 0.945, 0.055], r: [0.03, 0.05] },
            { c: [0.232 * s, 0.86, 0.03], r: [0.03, 0.078] },
            { c: [0.246 * s, 0.775, 0.005], r: [0.024, 0.07] },
            { c: [0.246 * s, 0.705, -0.02], r: [0.014, 0.04] },
            { c: [0.24 * s, 0.665, -0.035], r: [0.005, 0.01] },
        ], { up: [0, 0.2, 1], blend: 0.006, piece });
        // The leg: the thigh in the body's feathers, a slim shin, the
        // hock's knob, a long slim foot.
        const th = bn(`thigh${t}`), sn = bn(`shin${t}`), ft = bn(`foot${t}`), to = bn(`toe${t}`);
        B.limb(`leg${t}`, [`thigh${t}`, `shin${t}`], [
            { c: at(th, -0.1, [0.014 * s, 0.0, -0.02]), r: [0.06, 0.075], bone: `thigh${t}` },
            { c: at(th, 0.4, [0.012 * s, 0, -0.012]), r: [0.05, 0.064] },
            { c: at(th, 0.85), r: [0.036, 0.046] },
            { c: at(sn, 0.08), r: [0.032, 0.04] },
            { c: at(sn, 0.32, [0, 0, -0.01]), r: [0.027, 0.035] },
            { c: at(sn, 0.62), r: [0.023, 0.029] },
            { c: at(sn, 0.85), r: [0.016, 0.018] },
            { c: at(sn, 1.0), r: [0.019, 0.023], bone: `shin${t}` },
        ], { up: [0, 0, 1], blend: 0.02 });
        B.limb(`foot${t}`, [`foot${t}`], [
            { c: at(ft, 0.0, [0, 0.004, -0.008]), r: [0.019, 0.024], bone: `shin${t}` },
            { c: at(ft, 0.4), r: [0.013, 0.015] },
            { c: at(ft, 0.95), r: [0.018, 0.018] },
        ], { up: [0, 0, 1], blend: 0.012 });
        // The foot it stands on: a pad under the ball, three stout toes
        // spread wide, a claw on each.
        B.blob(`paw${t}`, [[`toe${t}`, 0.6], [`foot${t}`, 0.4]], at(to, 0.1, [0, -0.003, 0]), [0.032, 0.018, 0.03], { blend: 0.01 });
        for (const [i, dx] of [[0, -0.03], [1, 0.0], [2, 0.03]]) {
            const end = at(to, 0.95 - Math.abs(dx) * 6, [dx * 1.8 * s, 0.011, 0]);
            B.limb(`toe${i}${t}`, [`toe${t}`], [
                { c: at(to, 0.2, [dx * s, 0.0, 0]), r: 0.0135 },
                { c: end, r: 0.012 },
            ], { blend: 0.007, steps: 2 });
            B.limb(`claw${i}${t}`, [`toe${t}`], [
                { c: end, r: 0.008 },
                { c: add(end, [dx * 0.2 * s, -0.007, 0.022]), r: 0.003 },
            ], { blend: 0.004, steps: 2 });
        }
    }
    // The tail: a short flat fan.
    const t1 = bn('tail1'), t2 = bn('tail2');
    B.limb('tail', ['tail1', 'tail2'], [
        { c: at(t1, -0.4), r: [0.07, 0.045], bone: 'pelvis' },
        { c: at(t1, 0.5), r: [0.08, 0.026] },
        { c: t2.head, r: [0.09, 0.018] },
        { c: at(t2, 0.6), r: [0.092, 0.013] },
        { c: at(t2, 1.0), r: [0.07, 0.009] },
    ], { up: [0, 1, 0], blend: 0.016 });
    B.section('waist', { at: [0, 0.86, 0.055], normal: [0, 1, 0], bone: 'chest', radius: 0.4 });
    B.section('hips', { at: [0, 0.76, 0.0], normal: [0, 1, 0], bone: 'pelvis', radius: 0.4 });
    return B.build();
}
