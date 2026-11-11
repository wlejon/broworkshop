// The puff's body: masses on its bones blended into one skin
// (lab/flesh.js), as skeleton.js stands it. Drawn for its silhouette, a
// ball on stilts:
//   body      a round ball of feathers on the hips, fuller behind, tapering
//             into fluffy tibial trousers over the upper legs
//   head      a spherical owl head sunk in a circular breast ruff, a piece
//             of its own so it swivels ±135° inside the outline without a
//             crease; a wide flat facial disc on its front, two great eyes,
//             a hooked bill with cere and lower mandible, and swept brows
//             rising to ear tufts
//   wings     a short blade hanging down each side, each a piece of its
//             own, so it lifts clear
//   legs      the strider's, the thighs nestled in fluffy trouser plumage:
//             a slim shin to the raised hock, a long bare foot, three toes
//   tail      a short flat fan
// Dusk grey-brown above, barred darker on the wings and tail; cream below
// with soft bars across the breast, a pale facial disc; dark slate-horn
// bill and ochre feet.

import { Flesh, SIDES } from "/app/lab/flesh.js";

const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const add = (a, b) => a.map((x, i) => x + b[i]);
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const DUSK = [0.43, 0.36, 0.34], DEEP = [0.2, 0.16, 0.16], CREAM = [0.94, 0.89, 0.78], FACE = [0.97, 0.94, 0.87];
const OCHRE = [0.86, 0.62, 0.2], HORN = [0.34, 0.29, 0.25], CERE = [0.18, 0.16, 0.17], CLAW = [0.1, 0.08, 0.07], EYE = [0.03, 0.02, 0.02];

function coat(p, n, share) {
    const LR = (k) => share(k + 'L') + share(k + 'R');
    // Dusk above and behind, cream in front and below, soft bars across
    // the breast.
    const front = sstep(-0.25, 0.45, n[2] - 0.5 * n[1]);
    const bars = 0.5 + 0.5 * Math.sin(62 * p[1] + 9 * Math.cos(11 * p[0]));
    let c = mix(DUSK, CREAM, front);
    c = mix(c, DUSK, 0.28 * front * sstep(0.45, 0.9, bars) * sstep(0.92, 0.84, p[1]));
    // The crown and nape, darker; the face, pale cream framed by a dusk ruff.
    const hd = share('hood');
    c = mix(c, DEEP, 0.45 * hd * sstep(0.3, 0.9, n[1]));
    c = mix(c, mix(DUSK, CREAM, 0.42), 0.55 * hd * sstep(0.955, 0.895, p[1]));
    c = mix(c, FACE, share('disc'));
    c = mix(c, DEEP, 0.85 * (LR('brow') + LR('tuft')));
    // The wings and the tail: dusk, barred.
    const wg = LR('wing');
    c = mix(c, mix(DUSK, DEEP, 0.75 * sstep(0.35, 0.65, 0.5 + 0.5 * Math.sin(55 * p[1]))), wg);
    const tl = share('tail');
    c = mix(c, mix(DUSK, DEEP, 0.75 * sstep(0.35, 0.65, 0.5 + 0.5 * Math.sin(60 * p[2]))), tl);
    c = mix(c, CREAM, 0.6 * tl * sstep(0.1, 0.8, -n[1]));
    // The legs: fluffy cream trousers to the hock, bare ochre below.
    const lg = LR('leg') + LR('trouser');
    c = mix(c, CREAM, lg * sstep(0.68, 0.52, p[1]));
    c = mix(c, OCHRE, LR('leg') * sstep(0.35, 0.31, p[1]));
    c = mix(c, OCHRE, LR('foot') + LR('paw') + LR('toe0') + LR('toe1') + LR('toe2'));
    c = mix(c, CLAW, LR('claw0') + LR('claw1') + LR('claw2'));
    // Hooked owl bill: dark slate cere above, horn body, dark hooked tip.
    const bl = Math.min(1, share('bill') + share('billLo'));
    let billCol = mix(HORN, OCHRE, 0.28 * sstep(0.92, 0.955, p[1]));
    billCol = mix(billCol, CERE, sstep(0.955, 0.972, p[1]));
    billCol = mix(billCol, CLAW, 0.82 * sstep(0.924, 0.902, p[1]));
    c = mix(c, billCol, bl);
    return mix(c, EYE, LR('eye'));
}

// `detail` overrides the meshing (Flesh's cell, triangles, simplifyError,
// keep) for a coarser level of detail of the same body.
export function body(skel, detail = {}) {
    const B = new Flesh(skel, {
        color: coat,
        triangles: 20000,
        pieces: { head: 6200, wingL: 1300, wingR: 1300 },
        cell: 0.0045,
        ...detail,
    });
    const bn = (n) => skel.bones[skel.index(n)];
    const at = (b, u, off = [0, 0, 0]) => add(lerp(b.head, b.tail, u), off);
    // The body: a plump plumage ball on the hips, fuller behind.
    B.blob('ball', [['chest', 0.6], ['pelvis', 0.4]], [0, 0.844, 0.055], [0.232, 0.214, 0.222], { blend: 0.034 });
    B.blob('rump', 'pelvis', [0, 0.775, -0.07], [0.178, 0.152, 0.162], { blend: 0.038 });

    // The head: its own piece centered concentrically about the swivel pivot
    // [0, 0.95, 0.075], sunk smoothly into the top of the plumage ball so
    // ±135° owl head turns swivel inside the outline without a crease or step.
    const hp = 'head';
    B.blob('hood', 'head', [0, 0.968, 0.072], [0.206, 0.186, 0.202], { blend: 0.028, piece: hp });
    B.blob('disc', 'head', [0, 0.972, 0.196], [0.158, 0.132, 0.062], { blend: 0.02, piece: hp });
    B.limb('bill', ['head'], [
        { c: [0, 0.970, 0.256], r: [0.024, 0.026] },
        { c: [0, 0.950, 0.292], r: [0.018, 0.022] },
        { c: [0, 0.924, 0.298], r: [0.010, 0.014] },
        { c: [0, 0.899, 0.287], r: [0.0035, 0.005] },
    ], { up: [0, 1, 0], blend: 0.005, keep: true, piece: hp });
    B.limb('billLo', ['head'], [
        { c: [0, 0.938, 0.256], r: [0.017, 0.013] },
        { c: [0, 0.923, 0.280], r: [0.009, 0.008] },
    ], { up: [0, 1, 0], blend: 0.004, steps: 2, keep: true, piece: hp });

    for (const [s, t] of SIDES) {
        B.blob(`eye${t}`, 'head', [0.078 * s, 0.985, 0.238], [0.046, 0.048, 0.024], { blend: 0.004, keep: true, piece: hp });
        // The brow: from over the bill up and out over the eye to the tuft.
        const tf = bn(`tuft${t}`);
        B.limb(`brow${t}`, ['head'], [
            { c: [0.02 * s, 1.022, 0.262], r: 0.014 },
            { c: [0.07 * s, 1.062, 0.232], r: 0.02 },
            { c: [0.1 * s, 1.1, 0.16], r: 0.024 },
        ], { blend: 0.012, steps: 3, piece: hp });
        B.limb(`tuft${t}`, [`tuft${t}`], [
            { c: at(tf, -0.25), r: [0.03, 0.022], bone: 'head' },
            { c: at(tf, 0.22), r: [0.027, 0.018], bone: `tuft${t}` },
            { c: at(tf, 0.68), r: [0.017, 0.011], bone: `tuft${t}` },
            { c: at(tf, 1.05), r: [0.005, 0.004], bone: `tuft${t}` },
        ], { up: [0, 0, 1], blend: 0.009, piece: hp });

        // The wing: a short blade down the side, a piece of its own.
        const piece = `wing${t}`;
        B.limb(`wing${t}`, [`wing${t}`], [
            { c: [0.2 * s, 0.945, 0.055], r: [0.03, 0.05], bone: `wing${t}` },
            { c: [0.232 * s, 0.86, 0.03], r: [0.03, 0.078], bone: `wing${t}` },
            { c: [0.246 * s, 0.775, 0.005], r: [0.024, 0.07], bone: `wing${t}` },
            { c: [0.246 * s, 0.705, -0.02], r: [0.014, 0.04], bone: `wing${t}` },
            { c: [0.24 * s, 0.665, -0.035], r: [0.005, 0.01], bone: `wing${t}` },
        ], { up: [0, 0.2, 1], blend: 0.006, piece });

        // Fluffy trouser fairing where the thigh emerges from the lower belly,
        // softening the groin crease into natural owl trouser plumage.
        const th = bn(`thigh${t}`), sn = bn(`shin${t}`), ft = bn(`foot${t}`), to = bn(`toe${t}`);
        B.blob(`trouser${t}`, [['pelvis', 0.65], [`thigh${t}`, 0.35]], [0.092 * s, 0.675, 0.055], [0.082, 0.092, 0.112], { blend: 0.045 });
        B.limb(`leg${t}`, [`thigh${t}`, `shin${t}`], [
            { c: at(th, -0.08, [0.014 * s, 0.0, -0.02]), r: [0.064, 0.078], bone: `thigh${t}` },
            { c: at(th, 0.38, [0.012 * s, 0, -0.012]), r: [0.054, 0.068] },
            { c: at(th, 0.85), r: [0.038, 0.048] },
            { c: at(sn, 0.10), r: [0.034, 0.042] },
            { c: at(sn, 0.34, [0, 0, -0.01]), r: [0.028, 0.036] },
            { c: at(sn, 0.62), r: [0.023, 0.029] },
            { c: at(sn, 0.85), r: [0.016, 0.018] },
            { c: at(sn, 1.0), r: [0.019, 0.023], bone: `shin${t}` },
        ], { up: [0, 0, 1], blend: 0.032 });
        B.limb(`foot${t}`, [`foot${t}`], [
            { c: at(ft, 0.0, [0, 0.004, -0.008]), r: [0.019, 0.024], bone: `shin${t}` },
            { c: at(ft, 0.4), r: [0.013, 0.015] },
            { c: at(ft, 0.95), r: [0.017, 0.017] },
        ], { up: [0, 0, 1], blend: 0.012 });
        // The foot it stands on: a pad under the ball, three stout toes
        // spread ahead, and a claw on each.
        B.blob(`paw${t}`, [[`toe${t}`, 0.6], [`foot${t}`, 0.4]], at(to, 0.1, [0, -0.003, 0]), [0.03, 0.018, 0.03], { blend: 0.01 });
        for (const [i, dx] of [[0, -0.03], [1, 0.0], [2, 0.03]]) {
            const end = at(to, 0.95 - Math.abs(dx) * 6, [dx * 1.8 * s, 0.012, 0]);
            B.limb(`toe${i}${t}`, [`toe${t}`], [
                { c: at(to, 0.2, [dx * s, 0.0, 0]), r: 0.013 },
                { c: end, r: 0.011 },
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
        { c: at(t1, 0.25), r: [0.076, 0.032], bone: 'tail1' },
        { c: at(t1, 0.85), r: [0.086, 0.021], bone: 'tail1' },
        { c: at(t2, 0.35), r: [0.092, 0.015], bone: 'tail2' },
        { c: at(t2, 1.0), r: [0.07, 0.009], bone: 'tail2' },
    ], { up: [0, 1, 0], blend: 0.018 });
    B.section('waist', { at: [0, 0.85, 0.055], normal: [0, 1, 0], bone: 'chest', radius: 0.4 });
    B.section('hips', { at: [0, 0.76, 0.0], normal: [0, 1, 0], bone: 'pelvis', radius: 0.4 });
    return B.build();
}
