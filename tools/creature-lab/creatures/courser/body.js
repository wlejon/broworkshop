// The courser's body: masses on its bones blended into one skin
// (lab/flesh.js), as skeleton.js stands it. Drawn for its silhouette, a
// level egg of a body carried high on long slim legs:
//   head      small, a hooked raptor bill with saffron cere under a sleek
//             swept-back orbital ridge, quills fanned from the crown
//   neck      slim, in a smooth S from a full breast
//   trunk     a long egg, deepest over the legs
//   wings     layered secretary-bird / ratite display winglets (each its own
//             piece): ash coverts with pale tips over fanned black primaries
//   legs      the strider's: feathered black trousers blending smoothly from
//             the hip, slim shin to the raised hock, long bare foot, three toes
//   tail      a long flat fan with subterminal black band and white tip

import { Flesh, SIDES } from "/app/lab/flesh.js";

const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const add = (a, b) => a.map((x, i) => x + b[i]);
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const ASH = [0.56, 0.59, 0.62], SLATE = [0.36, 0.39, 0.43], PALE = [0.87, 0.88, 0.87], BLACK = [0.045, 0.045, 0.05];
const SKIN = [0.80, 0.52, 0.42], BILL = [0.42, 0.47, 0.52], CERE = [0.93, 0.74, 0.16], EYE = [0.03, 0.02, 0.02];

function coat(p, n, share) {
    const LR = (k) => share(k + 'L') + share(k + 'R');
    // Ash mantle, darker along the back, pale underneath and up the neck to a white head.
    let c = mix(ASH, SLATE, 0.7 * sstep(0.2, 0.9, n[1]) * sstep(0.3, 0.1, p[2]));
    c = mix(c, PALE, 0.8 * sstep(0.1, 0.8, -n[1]) * sstep(0.62, 0.72, p[1]));
    c = mix(c, PALE, sstep(0.86, 1.1, p[1]) * sstep(0.2, 0.3, p[2]));

    // Layered winglets: ash lesser coverts, pale-tipped greater coverts, jet-black primaries.
    const wArm = LR('wingArm');
    const wCov = LR('wcov0') + LR('wcov1') + LR('wcov2');
    const wPrim = LR('wprim0') + LR('wprim1') + LR('wprim2') + LR('wprim3') + LR('wprim4');
    const wg = Math.min(1, wArm + wCov + wPrim);
    if (wg > 0) {
        let wc = mix(ASH, SLATE, 0.35 * sstep(0.86, 0.82, p[1]));
        const covTip = Math.min(1, wCov) * sstep(0.11, 0.03, p[2]) * (1 - sstep(0.01, -0.03, p[2]));
        wc = mix(wc, PALE, 0.65 * covTip);
        const primShare = sstep(0.25, 0.65, wPrim / Math.max(wg, 1e-4));
        wc = mix(wc, BLACK, Math.max(primShare, 0.85 * sstep(-0.02, -0.09, p[2])));
        c = mix(c, wc, wg);
    }

    // Black trousers to the hock, bare coral-pink skin below.
    const lg = LR('leg') + LR('trouser');
    c = mix(c, BLACK, lg * sstep(0.71, 0.61, p[1]));
    c = mix(c, SKIN, LR('leg') * sstep(0.335, 0.3, p[1]));
    c = mix(c, SKIN, LR('foot') + LR('paw') + LR('toe0') + LR('toe1') + LR('toe2'));
    c = mix(c, BLACK, LR('claw0') + LR('claw1') + LR('claw2'));

    // The tail: a black band before its crisp white tip.
    const tl = share('tail');
    c = mix(c, PALE, 0.7 * tl * sstep(0.0, -0.6, n[1]));
    c = mix(c, BLACK, tl * sstep(-0.47, -0.52, p[2]));
    c = mix(c, PALE, tl * sstep(-0.63, -0.66, p[2]));

    // The crest's quills, the bill and its cere.
    const cr = share('crestBase') + share('quill0') + share('quill1') + share('quill2') + share('quill3') + share('quill4');
    c = mix(c, BLACK, Math.min(1, cr));
    c = mix(c, BILL, share('bill'));
    c = mix(c, BLACK, share('bill') * sstep(0.525, 0.545, p[2]));
    c = mix(c, CERE, share('cere'));
    return mix(c, EYE, LR('eye'));
}

export function body(skel, detail = {}) {
    const B = new Flesh(skel, {
        color: coat,
        triangles: 22000,
        pieces: { wingL: 2800, wingR: 2800 },
        cell: 0.0042,
        ...detail,
    });
    const bn = (n) => skel.bones[skel.index(n)];
    const at = (b, u, off = [0, 0, 0]) => add(lerp(b.head, b.tail, u), off);

    // The trunk: an egg along the line from the rump up to the breast, deepest over the legs,
    // tapering cleanly below the nape so the S-curved neck emerges with its own closed skin loop.
    B.limb('trunk', ['pelvis', 'spine', 'chest'], [
        { c: [0, 0.735, -0.155], r: [0.05, 0.048], bone: 'pelvis' },
        { c: [0, 0.745, -0.085], r: [0.105, 0.098], bone: 'pelvis' },
        { c: [0, 0.765, 0.025], r: [0.138, 0.134], bone: 'pelvis' },
        { c: [0, 0.786, 0.125], r: [0.146, 0.140], bone: 'spine' },
        { c: [0, 0.804, 0.235], r: [0.130, 0.122], bone: 'chest' },
        { c: [0, 0.816, 0.318], r: [0.090, 0.080], bone: 'chest' },
        { c: [0, 0.828, 0.358], r: [0.052, 0.048], bone: 'chest' },
    ], { up: [0, 0.98, -0.2], joint: 0.028, blend: 0.024 });

    // The breast, full under the neck's root.
    B.blob('breast', 'chest', [0, 0.790, 0.322], [0.088, 0.084, 0.074], { blend: 0.028 });

    // Explicit 2-station-per-bone weighting along `neck1`, `neck2`, `neck3` (`0` bound warnings).
    const nk = [1, 2, 3].map((i) => bn(`neck${i}`));
    B.limb('neck', nk.map((b) => b.name), [
        { c: [0, 0.832, 0.326], r: [0.054, 0.054], bone: 'chest' },
        { c: at(nk[0], 0.38), r: [0.046, 0.047], bone: 'neck1' },
        { c: at(nk[0], 0.82), r: [0.040, 0.041], bone: 'neck1' },
        { c: at(nk[1], 0.25), r: [0.036, 0.037], bone: 'neck2' },
        { c: at(nk[1], 0.75), r: [0.033, 0.034], bone: 'neck2' },
        { c: at(nk[2], 0.25), r: [0.031, 0.032], bone: 'neck3' },
        { c: at(nk[2], 0.72), r: [0.030, 0.031], bone: 'neck3' },
        { c: at(nk[2], 1.05), r: [0.032, 0.034], bone: 'head' },
    ], { up: [0, 0, 1], joint: 0.022, blend: 0.014 });

    // The head: a sleek raptor skull and hooked bill with cere.
    B.blob('skull', 'head', [0, 1.185, 0.432], [0.04, 0.038, 0.054], { blend: 0.012 });
    B.limb('bill', ['head'], [
        { c: [0, 1.176, 0.478], r: [0.021, 0.023], bone: 'head' },
        { c: [0, 1.17, 0.515], r: [0.014, 0.017], bone: 'head' },
        { c: [0, 1.158, 0.545], r: [0.008, 0.01], bone: 'head' },
        { c: [0, 1.142, 0.556], r: [0.004, 0.005], bone: 'head' },
    ], { up: [0, 1, 0], blend: 0.006, keep: true });
    B.blob('cere', 'head', [0, 1.186, 0.488], [0.017, 0.012, 0.018], { blend: 0.005, keep: true });

    for (const [s, t] of SIDES) {
        B.blob(`eye${t}`, 'head', [0.031 * s, 1.19, 0.452], [0.011, 0.0135, 0.0135], { blend: 0.003, keep: true });
        // Sleek swept-back supraorbital raptor ridge matching `face.bk`.
        B.limb(`brow${t}`, ['head'], [
            { c: [0.025 * s, 1.199, 0.482], r: 0.0055, bone: 'head' },
            { c: [0.0355 * s, 1.209, 0.452], r: 0.0085, bone: 'head' },
            { c: [0.0325 * s, 1.213, 0.414], r: 0.006, bone: 'head' },
        ], { blend: 0.006, steps: 3 });

        // Layered display winglet (`piece: 'wingL'/'wingR'`): leading scapular/lesser
        // covert cuff, three overlapping greater coverts, and five fanned primary blades.
        const piece = `wing${t}`;
        const wb = `wing${t}`;
        B.limb(`wingArm${t}`, [wb], [
            { c: [0.122 * s, 0.866, 0.268], r: [0.018, 0.032], bone: wb },
            { c: [0.140 * s, 0.858, 0.175], r: [0.019, 0.044], bone: wb },
            { c: [0.146 * s, 0.848, 0.070], r: [0.016, 0.038], bone: wb },
        ], { up: [0, 1, 0.12], blend: 0.005, piece });

        // Three overlapping ash-and-pale greater covert blades.
        [
            [[0.136, 0.862, 0.235], [0.150, 0.846, 0.085], 0.026],
            [[0.140, 0.848, 0.205], [0.153, 0.824, 0.045], 0.028],
            [[0.140, 0.832, 0.175], [0.151, 0.802, 0.015], 0.026],
        ].forEach(([root, tip, h], i) => {
            const mid = lerp(root, tip, 0.55);
            B.limb(`wcov${i}${t}`, [wb], [
                { c: [root[0] * s, root[1], root[2]], r: [0.011, h * 0.78], bone: wb },
                { c: [mid[0] * s, mid[1], mid[2]], r: [0.010, h], bone: wb },
                { c: [tip[0] * s, tip[1], tip[2]], r: [0.006, h * 0.62], bone: wb },
            ], { up: [0, 1, 0.14], blend: 0.0035, piece });
        });

        // Five fanned black primary/secondary remex feather blades with distinct tips.
        [
            [[0.145, 0.846, 0.095], [0.136, 0.826, -0.235], 0.021],
            [[0.147, 0.832, 0.075], [0.140, 0.806, -0.210], 0.023],
            [[0.147, 0.818, 0.055], [0.143, 0.788, -0.172], 0.024],
            [[0.145, 0.805, 0.035], [0.142, 0.774, -0.128], 0.023],
            [[0.141, 0.794, 0.020], [0.138, 0.764, -0.082], 0.020],
        ].forEach(([root, tip, h], i) => {
            const mid = lerp(root, tip, 0.54);
            B.limb(`wprim${i}${t}`, [wb], [
                { c: [root[0] * s, root[1], root[2]], r: [0.0085, h * 0.80], bone: wb },
                { c: [mid[0] * s, mid[1], mid[2]], r: [0.0075, h], bone: wb },
                { c: [tip[0] * s, tip[1], tip[2]], r: [0.0045, h * 0.45], bone: wb },
            ], { up: [0, 1, 0.15], blend: 0.0028, keep: true, piece });
        });

        // Feathered thigh blended smoothly into hip trousers, slim shin, long bare foot.
        const th = bn(`thigh${t}`), sn = bn(`shin${t}`), ft = bn(`foot${t}`), to = bn(`toe${t}`);
        B.blob(`trouser${t}`, [['pelvis', 0.56], [`thigh${t}`, 0.44]], [0.088 * s, 0.722, 0.020], [0.058, 0.068, 0.078], { blend: 0.028 });
        B.limb(`leg${t}`, [`thigh${t}`, `shin${t}`], [
            { c: at(th, -0.04, [0.010 * s, 0.0, -0.014]), r: [0.062, 0.084], bone: `thigh${t}` },
            { c: at(th, 0.42, [0.009 * s, 0, -0.010]), r: [0.058, 0.084], bone: `thigh${t}` },
            { c: at(th, 0.86), r: [0.047, 0.061], bone: `thigh${t}` },
            { c: at(sn, 0.10), r: [0.041, 0.051], bone: `shin${t}` },
            { c: at(sn, 0.34, [0, 0, -0.01]), r: [0.034, 0.046], bone: `shin${t}` },
            { c: at(sn, 0.62), r: [0.023, 0.03], bone: `shin${t}` },
            { c: at(sn, 0.85), r: [0.015, 0.017], bone: `shin${t}` },
            { c: at(sn, 1.0), r: [0.018, 0.022], bone: `shin${t}` },
        ], { up: [0, 0, 1], joint: 0.024, blend: 0.022 });

        B.limb(`foot${t}`, [`foot${t}`], [
            { c: at(ft, 0.0, [0, 0.004, -0.008]), r: [0.018, 0.023], bone: `shin${t}` },
            { c: at(ft, 0.4), r: [0.012, 0.014] },
            { c: at(ft, 0.95), r: [0.017, 0.017] },
        ], { up: [0, 0, 1], blend: 0.012 });

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

    // The crest: fanned occipital quills weighted cleanly across `crest1` and `crest2`.
    const c1 = bn('crest1'), c2 = bn('crest2');
    B.limb('crestBase', ['crest1', 'crest2'], [
        { c: at(c1, 0.08), r: [0.016, 0.008], bone: 'crest1' },
        { c: at(c1, 0.78), r: [0.020, 0.007], bone: 'crest1' },
        { c: at(c2, 0.45), r: [0.022, 0.006], bone: 'crest2' },
    ], { up: [0, 1, 0], joint: 0.012, blend: 0.005 });

    [[-0.022, 0.82, -0.012], [-0.011, 0.95, -0.004], [0, 1.05, 0], [0.011, 0.95, -0.004], [0.022, 0.82, -0.012]].forEach(([dx, len, dy], i) => {
        const tip = add(lerp(c1.head, c2.tail, len), [2.6 * dx, dy, 0]);
        B.limb(`quill${i}`, ['crest1', 'crest2'], [
            { c: add(c1.head, [0.5 * dx, -0.004, 0.006]), r: 0.0055, bone: 'crest1' },
            { c: add(lerp(c1.head, c2.tail, 0.42 * len), [1.5 * dx, 0.004 + dy, 0]), r: 0.0045, bone: 'crest1' },
            { c: add(lerp(c1.head, c2.tail, 0.78 * len), [2.3 * dx, 0.003 + dy, 0]), r: [0.008, 0.004], bone: 'crest2' },
            { c: tip, r: [0.005, 0.0032], bone: 'crest2' },
        ], { up: [0, 1, 0], joint: 0.010, blend: 0.0028, keep: true });
    });

    // The tail: a flat fan, narrow at the rump, widest near its end.
    const tb = [1, 2, 3].map((i) => bn(`tail${i}`));
    B.limb('tail', tb.map((b) => b.name), [
        { c: at(tb[0], -0.30), r: [0.062, 0.05], bone: 'pelvis' },
        { c: at(tb[0], 0.45), r: [0.07, 0.036], bone: 'tail1' },
        { c: at(tb[1], 0.15), r: [0.082, 0.026], bone: 'tail2' },
        { c: at(tb[1], 0.82), r: [0.098, 0.021], bone: 'tail2' },
        { c: at(tb[2], 0.45), r: [0.118, 0.015], bone: 'tail3' },
        { c: at(tb[2], 1.0), r: [0.095, 0.01], bone: 'tail3' },
    ], { up: [0, 1, 0], joint: 0.022, blend: 0.016 });

    B.section('waist', { at: [0, 0.79, 0.14], normal: [0, 0.2, 0.98], bone: 'spine', radius: 0.3 });
    B.section('hips', { at: [0, 0.745, 0.0], normal: [0, 0.2, 0.98], bone: 'pelvis', radius: 0.3 });
    return B.build();
}
