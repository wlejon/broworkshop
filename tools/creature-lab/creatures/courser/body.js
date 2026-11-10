// The courser's body: masses on its bones blended into one skin
// (lab/flesh.js), as skeleton.js stands it. Drawn for its silhouette, a
// level egg of a body carried high on long slim legs:
//   head      small, a hooked bill under a heavy brow, quills swept back
//             from the crown
//   neck      slim, in an S from a full breast
//   trunk     a long egg, deepest over the legs, the folded wings lying
//             along its flanks (each a piece of its own, so it lifts clear)
//   legs      the strider's: a feathered thigh running on from the body, a
//             slim shin to the raised hock, a long bare foot, three toes
//   tail      a long flat fan
// Ash grey, paler on the neck and white on the head and under the tail;
// black trousers, flight feathers and crest, a black band before the
// tail's white tip; bare pink legs, a slate bill with a yellow cere.

import { Flesh, SIDES } from "/app/lab/flesh.js";

const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const add = (a, b) => a.map((x, i) => x + b[i]);
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const ASH = [0.56, 0.59, 0.62], SLATE = [0.36, 0.39, 0.43], PALE = [0.86, 0.87, 0.86], BLACK = [0.045, 0.045, 0.05];
const SKIN = [0.80, 0.52, 0.42], BILL = [0.42, 0.47, 0.52], CERE = [0.93, 0.74, 0.16], EYE = [0.03, 0.02, 0.02];

function coat(p, n, share) {
    const LR = (k) => share(k + 'L') + share(k + 'R');
    // Ash, darker along the back, pale underneath and up the neck to a
    // white head.
    let c = mix(ASH, SLATE, 0.7 * sstep(0.2, 0.9, n[1]) * sstep(0.3, 0.1, p[2]));
    c = mix(c, PALE, 0.8 * sstep(0.1, 0.8, -n[1]) * sstep(0.62, 0.72, p[1]));
    c = mix(c, PALE, sstep(0.86, 1.1, p[1]) * sstep(0.2, 0.3, p[2]));
    // The wings: ash coverts, the flight feathers black behind and below.
    const wg = LR('wing');
    c = mix(c, ASH, wg);
    c = mix(c, BLACK, wg * Math.max(sstep(0.06, -0.02, p[2]), sstep(0.815, 0.785, p[1])));
    // Black trousers to the hock, bare skin below.
    c = mix(c, BLACK, LR('leg') * sstep(0.7, 0.62, p[1]));
    c = mix(c, SKIN, LR('leg') * sstep(0.335, 0.3, p[1]));
    c = mix(c, SKIN, LR('foot') + LR('paw') + LR('toe0') + LR('toe1') + LR('toe2'));
    c = mix(c, BLACK, LR('claw0') + LR('claw1') + LR('claw2'));
    // The tail: a black band before its white tip.
    const tl = share('tail');
    c = mix(c, PALE, 0.7 * tl * sstep(0.0, -0.6, n[1]));
    c = mix(c, BLACK, tl * sstep(-0.47, -0.52, p[2]));
    c = mix(c, PALE, tl * sstep(-0.63, -0.66, p[2]));
    // The crest's quills, the bill and its cere.
    c = mix(c, BLACK, share('quill0') + share('quill1') + share('quill2') + share('quill3') + share('quill4'));
    c = mix(c, BILL, share('bill'));
    c = mix(c, BLACK, share('bill') * sstep(0.525, 0.545, p[2]));
    c = mix(c, CERE, share('cere'));
    return mix(c, EYE, LR('eye'));
}

// `detail` overrides the meshing (Flesh's cell, triangles, simplifyError,
// keep) for a coarser level of detail of the same body.
export function body(skel, detail = {}) {
    const B = new Flesh(skel, { color: coat, triangles: 20000, pieces: { wingL: 1400, wingR: 1400 }, cell: 0.0045, ...detail });
    const bn = (n) => skel.bones[skel.index(n)];
    const at = (b, u, off = [0, 0, 0]) => add(lerp(b.head, b.tail, u), off);
    // The trunk: an egg along the line from the rump up to the breast,
    // deepest over the legs.
    B.limb('trunk', ['pelvis', 'spine', 'chest'], [
        { c: [0, 0.735, -0.165], r: [0.05, 0.048] },
        { c: [0, 0.745, -0.085], r: [0.105, 0.098] },
        { c: [0, 0.765, 0.03], r: [0.138, 0.134] },
        { c: [0, 0.79, 0.14], r: [0.146, 0.144] },
        { c: [0, 0.815, 0.25], r: [0.132, 0.13] },
        { c: [0, 0.838, 0.33], r: [0.1, 0.102] },
        { c: [0, 0.86, 0.385], r: [0.058, 0.064] },
    ], { up: [0, 0.98, -0.2], blend: 0.025 });
    // The breast, full under the neck's root.
    B.blob('breast', 'chest', [0, 0.795, 0.325], [0.09, 0.09, 0.075], { blend: 0.03 });
    const nk = [1, 2, 3].map((i) => bn(`neck${i}`));
    B.limb('neck', nk.map((b) => b.name), [
        { c: [0, 0.848, 0.335], r: [0.062, 0.064], bone: 'chest' },
        { c: at(nk[0], 0.55), r: [0.047, 0.05] },
        { c: nk[1].head, r: [0.04, 0.042] },
        { c: at(nk[1], 0.55), r: [0.034, 0.035] },
        { c: nk[2].head, r: [0.031, 0.032] },
        { c: at(nk[2], 0.6), r: [0.03, 0.031] },
        { c: at(nk[2], 1.05), r: [0.032, 0.034], bone: 'head' },
    ], { up: [0, 0, 1], blend: 0.016 });
    // The head: a small skull, flat on top, and the bill hooked at its tip.
    B.blob('skull', 'head', [0, 1.185, 0.432], [0.04, 0.038, 0.054], { blend: 0.012 });
    B.limb('bill', ['head'], [
        { c: [0, 1.176, 0.478], r: [0.021, 0.023] },
        { c: [0, 1.17, 0.515], r: [0.014, 0.017] },
        { c: [0, 1.158, 0.545], r: [0.008, 0.01] },
        { c: [0, 1.142, 0.556], r: [0.004, 0.005] },
    ], { up: [0, 1, 0], blend: 0.006, keep: true });
    B.blob('cere', 'head', [0, 1.186, 0.488], [0.017, 0.012, 0.018], { blend: 0.005, keep: true });
    for (const [s, t] of SIDES) {
        B.blob(`eye${t}`, 'head', [0.031 * s, 1.19, 0.452], [0.011, 0.0135, 0.0135], { blend: 0.003, keep: true });
        // The brow: a ridge over the eye, lowest in front.
        B.limb(`brow${t}`, ['head'], [
            { c: [0.027 * s, 1.203, 0.482], r: 0.007 },
            { c: [0.036 * s, 1.21, 0.452], r: 0.0095 },
            { c: [0.034 * s, 1.209, 0.42], r: 0.007 },
        ], { blend: 0.006, steps: 3 });
        // The wing, folded: a long blade back along the flank from the
        // shoulder, its tip over the tail's root.
        const piece = `wing${t}`;
        B.limb(`wing${t}`, [`wing${t}`], [
            { c: [0.122 * s, 0.862, 0.262], r: [0.02, 0.04] },
            { c: [0.142 * s, 0.85, 0.16], r: [0.022, 0.07] },
            { c: [0.152 * s, 0.835, 0.04], r: [0.02, 0.078] },
            { c: [0.15 * s, 0.82, -0.07], r: [0.016, 0.058] },
            { c: [0.14 * s, 0.805, -0.17], r: [0.009, 0.026] },
            { c: [0.132 * s, 0.798, -0.215], r: [0.004, 0.008] },
        ], { up: [0, 1, 0.12], blend: 0.006, piece });
        // The leg: the feathered thigh as one heavy mass, a slim shin, the
        // hock's knob, a long slim foot.
        const th = bn(`thigh${t}`), sn = bn(`shin${t}`), ft = bn(`foot${t}`), to = bn(`toe${t}`);
        B.limb(`leg${t}`, [`thigh${t}`, `shin${t}`], [
            { c: at(th, -0.1, [0.014 * s, 0.0, -0.02]), r: [0.07, 0.092], bone: `thigh${t}` },
            { c: at(th, 0.4, [0.012 * s, 0, -0.012]), r: [0.066, 0.092] },
            { c: at(th, 0.85), r: [0.05, 0.064] },
            { c: at(sn, 0.08), r: [0.042, 0.052] },
            { c: at(sn, 0.32, [0, 0, -0.01]), r: [0.034, 0.046] },
            { c: at(sn, 0.62), r: [0.023, 0.03] },
            { c: at(sn, 0.85), r: [0.015, 0.017] },
            { c: at(sn, 1.0), r: [0.018, 0.022], bone: `shin${t}` },
        ], { up: [0, 0, 1], blend: 0.02 });
        B.limb(`foot${t}`, [`foot${t}`], [
            { c: at(ft, 0.0, [0, 0.004, -0.008]), r: [0.018, 0.023], bone: `shin${t}` },
            { c: at(ft, 0.4), r: [0.012, 0.014] },
            { c: at(ft, 0.95), r: [0.017, 0.017] },
        ], { up: [0, 0, 1], blend: 0.012 });
        // The foot it stands on: a pad under the ball, three long toes
        // spread ahead, a claw on each.
        B.blob(`paw${t}`, [[`toe${t}`, 0.6], [`foot${t}`, 0.4]], at(to, 0.1, [0, -0.003, 0]), [0.028, 0.017, 0.028], { blend: 0.01 });
        for (const [i, dx] of [[0, -0.026], [1, 0.0], [2, 0.026]]) {
            const end = at(to, 1.0 - Math.abs(dx) * 6, [dx * 1.7 * s, 0.01, 0]);
            B.limb(`toe${i}${t}`, [`toe${t}`], [
                { c: at(to, 0.2, [dx * s, 0.0, 0]), r: 0.0115 },
                { c: end, r: 0.0095 },
            ], { blend: 0.006, steps: 2 });
            B.limb(`claw${i}${t}`, [`toe${t}`], [
                { c: end, r: 0.007 },
                { c: add(end, [dx * 0.25 * s, -0.006, 0.02]), r: 0.003 },
            ], { blend: 0.004, steps: 2 });
        }
    }
    // The crest: five quills from the back of the crown, fanned, each
    // ending in a small paddle.
    const c1 = bn('crest1'), c2 = bn('crest2');
    [[-0.022, 0.82, -0.012], [-0.011, 0.95, -0.004], [0, 1.05, 0], [0.011, 0.95, -0.004], [0.022, 0.82, -0.012]].forEach(([dx, len, dy], i) => {
        const tip = add(lerp(c1.head, c2.tail, len), [2.6 * dx, dy, 0]);
        B.limb(`quill${i}`, ['crest1', 'crest2'], [
            { c: add(c1.head, [0.5 * dx, -0.006, 0.012]), r: 0.0055, bone: 'head' },
            { c: add(lerp(c1.head, c2.tail, 0.45 * len), [1.5 * dx, 0.004 + dy, 0]), r: 0.004, bone: 'crest1' },
            { c: add(lerp(c1.head, c2.tail, 0.8 * len), [2.3 * dx, 0.003 + dy, 0]), r: [0.0075, 0.0036], bone: 'crest2' },
            { c: tip, r: [0.0045, 0.003], bone: 'crest2' },
        ], { up: [0, 1, 0], blend: 0.0025, keep: true });
    });
    // The tail: a flat fan, narrow at the rump, widest near its end.
    const tb = [1, 2, 3].map((i) => bn(`tail${i}`));
    B.limb('tail', tb.map((b) => b.name), [
        { c: at(tb[0], -0.35), r: [0.062, 0.05], bone: 'pelvis' },
        { c: at(tb[0], 0.4), r: [0.07, 0.036] },
        { c: tb[1].head, r: [0.082, 0.026] },
        { c: tb[2].head, r: [0.105, 0.019] },
        { c: at(tb[2], 0.65), r: [0.118, 0.015] },
        { c: at(tb[2], 1.0), r: [0.095, 0.01] },
    ], { up: [0, 1, 0], blend: 0.016 });
    B.section('waist', { at: [0, 0.79, 0.14], normal: [0, 0.2, 0.98], bone: 'spine', radius: 0.3 });
    B.section('hips', { at: [0, 0.745, 0.0], normal: [0, 0.2, 0.98], bone: 'pelvis', radius: 0.3 });
    return B.build();
}
