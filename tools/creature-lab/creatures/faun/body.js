// The faun's body: masses on its bones blended into one skin
// (lab/flesh.js), as skeleton.js stands it. Drawn for its silhouette, a
// slim athletic upper body with broad shoulders over heavy shaggy haunches:
//   head      a sleek caprine head with cheekbones, a blunt muzzle and a
//             crisp pointed chin tuft clear of the throat, two ridged horns
//             swept back from the brow, a pointed ear with a carved pinna
//             hollow drooping each side, and a layered swept-back forelock
//             and mane down the nape
//   trunk     broad heroic shoulders and clavicular shelf, a deep chest, a
//             narrow waist, wide hips
//   arms      long, hanging to the thighs: a round deltoid cap, a lean upper
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
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return a.map((x) => x / l); };
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const TAWNY = [0.62, 0.42, 0.24], PALE = [0.88, 0.76, 0.58], SHAG = [0.2, 0.125, 0.085], DARK = [0.09, 0.065, 0.055];
const HORN = [0.8, 0.74, 0.62], EYE = [0.03, 0.02, 0.02], EAR_IN = [0.82, 0.59, 0.5];

function coat(p, n, share) {
    const LR = (k) => share(k + 'L') + share(k + 'R');
    // Tawny, paler down the front; shaggy and dark from the waist down.
    let c = mix(TAWNY, PALE, 0.85 * sstep(0.1, 0.8, n[2]) * sstep(0.125, 0.04, Math.abs(p[0])) * sstep(1.2, 1.1, p[1]));
    c = mix(c, SHAG, sstep(0.9, 0.8, p[1] + 0.05 * n[2]) * (1 - LR('arm') - LR('palm')));
    c = mix(c, SHAG, LR('leg'));
    c = mix(c, DARK, LR('foot') + LR('paw') + LR('toe0') + LR('toe1') + LR('toe2'));
    // The forearms darken to the hands.
    c = mix(c, SHAG, LR('arm') * sstep(0.78, 0.62, p[1]));
    c = mix(c, DARK, LR('palm') + LR('thumb') + LR('finger0') + LR('finger1') + LR('finger2'));
    // The head: a pale face, a dark nose and chin tuft, the layered mane and forelock.
    c = mix(c, PALE, 0.82 * (share('muzzle') + 0.5 * LR('cheek') + 0.6 * share('skull') * sstep(0.0, 0.7, n[2])));
    c = mix(c, DARK, share('nose') + 0.88 * share('beard'));
    const mn = share('mane') + share('forelock') + share('maneLock') + share('napeLock');
    c = mix(c, SHAG, mn * sstep(0.45, -0.25, n[2]));
    c = mix(c, DARK, 0.45 * (share('forelock') + share('maneLock') + share('napeLock')));
    const er = LR('ear');
    c = mix(c, EAR_IN, 0.82 * er * sstep(0.15, 0.68, n[2]));
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
    // The trunk: wide hips, a narrow waist, a deep chest and broad clavicular shelf.
    B.limb('trunk', ['pelvis', 'spine', 'chest'], [
        { c: [0, 0.69, -0.03], r: [0.085, 0.075] },
        { c: [0, 0.745, -0.008], r: [0.128, 0.105] },
        { c: [0, 0.815, 0.012], r: [0.108, 0.088] },
        { c: [0, 0.875, 0.03], r: [0.094, 0.078] },
        { c: [0, 0.945, 0.048], r: [0.112, 0.090] },
        { c: [0, 1.012, 0.062], r: [0.138, 0.100] },
        { c: [0, 1.056, 0.070], r: [0.128, 0.084] },
        { c: [0, 1.1, 0.078], r: [0.062, 0.056] },
    ], { up: [0, -0.2, 0.98], blend: 0.022 });
    // The breast, full and athletic across the upper pectorals.
    B.blob('breast', 'chest', [0, 1.002, 0.116], [0.104, 0.072, 0.052], { blend: 0.028 });
    B.limb('neck', ['chest', 'neck'], [
        { c: [0, 1.09, 0.078], r: [0.052, 0.052] },
        { c: [0, 1.17, 0.098], r: [0.044, 0.047], bone: 'head' },
    ], { up: [0, 0, 1], blend: 0.018 });
    // The head: sleek tucked rear cranium, sculpted cheekbones, blunt muzzle.
    B.blob('skull', 'head', [0, 1.252, 0.114], [0.073, 0.076, 0.078], { blend: 0.014 });
    B.limb('muzzle', ['head'], [
        { c: [0, 1.225, 0.166], r: [0.05, 0.045] },
        { c: [0, 1.205, 0.215], r: [0.037, 0.033] },
        { c: [0, 1.196, 0.246], r: [0.029, 0.025] },
    ], { up: [0, 1, 0], blend: 0.013 });
    B.blob('nose', 'head', [0, 1.208, 0.268], [0.02, 0.014, 0.01], { blend: 0.004, keep: true });
    // Pointed caprine chin beard, cleanly forward of the throat and submental hollow.
    B.limb('beard', ['head'], [
        { c: [0, 1.182, 0.238], r: [0.0135, 0.0145] },
        { c: [0, 1.146, 0.242], r: [0.010, 0.0115] },
        { c: [0, 1.108, 0.235], r: [0.0035, 0.0042] },
    ], { up: [0, 0, 1], blend: 0.005, steps: 4, keep: true });
    // Layered swept-back forelock and mane tufts hugging the sleek cranium and nape.
    B.limb('forelock', ['head'], [
        { c: [0, 1.312, 0.136], r: [0.022, 0.014] },
        { c: [0, 1.342, 0.096], r: [0.018, 0.015] },
        { c: [0, 1.332, 0.052], r: [0.007, 0.008] },
    ], { up: [0, 1, 0], blend: 0.006, steps: 3, keep: true });
    B.limb('mane', ['head', 'neck', 'chest'], [
        { c: [0, 1.318, 0.072], r: [0.024, 0.022], bone: 'head' },
        { c: [0, 1.268, 0.040], r: [0.025, 0.028], bone: 'head' },
        { c: [0, 1.185, 0.028], r: [0.024, 0.032], bone: 'neck' },
        { c: [0, 1.09, 0.008], r: [0.024, 0.032], bone: 'chest' },
        { c: [0, 0.995, -0.018], r: [0.012, 0.015], bone: 'chest' },
    ], { up: [0, 0, 1], blend: 0.012 });
    B.limb('maneLock', ['head'], [
        { c: [0, 1.296, 0.054], r: [0.016, 0.014] },
        { c: [0, 1.258, 0.018], r: [0.012, 0.013] },
        { c: [0, 1.216, 0.005], r: [0.005, 0.005] },
    ], { up: [0, 0, 1], blend: 0.005, steps: 3, keep: true });
    B.limb('napeLock', ['neck'], [
        { c: [0, 1.215, 0.026], r: [0.015, 0.013] },
        { c: [0, 1.162, -0.002], r: [0.011, 0.012] },
        { c: [0, 1.118, -0.012], r: [0.005, 0.005] },
    ], { up: [0, 0, 1], blend: 0.005, steps: 3, keep: true });

    for (const [s, t] of SIDES) {
        B.blob(`cheek${t}`, 'head', [0.044 * s, 1.222, 0.152], [0.024, 0.022, 0.028], { blend: 0.012 });
        B.blob(`eye${t}`, 'head', [0.047 * s, 1.258, 0.168], [0.021, 0.021, 0.016], { blend: 0.004, keep: true });
        // A horn: up from the brow and swept back in a curve, tapering.
        B.limb(`horn${t}`, ['head'], [
            { c: [0.04 * s, 1.315, 0.118], r: 0.022 },
            { c: [0.056 * s, 1.385, 0.096], r: 0.019 },
            { c: [0.074 * s, 1.435, 0.04], r: 0.015 },
            { c: [0.088 * s, 1.445, -0.03], r: 0.01 },
            { c: [0.096 * s, 1.42, -0.085], r: 0.004 },
        ], { blend: 0.008, keep: true });
        // The ear: pointed caprine leaf drooping out to the side, with a carved inner pinna hollow.
        const e = bn(`ear${t}`);
        const et = norm(sub(e.tail, e.head));
        const ef0 = [0.22 * s, -0.22, 0.95];
        const eface = norm(ef0.map((x, k) => x - dot(ef0, et) * et[k]));
        const eat = (u, out = 0) => add(lerp(e.head, e.tail, u), eface.map((x) => x * out));
        B.limb(`ear${t}`, [`ear${t}`], [
            { c: eat(-0.14), r: [0.016, 0.010], bone: 'head' },
            { c: eat(0.16), r: [0.025, 0.009] },
            { c: eat(0.46), r: [0.032, 0.008] },
            { c: eat(0.78), r: [0.022, 0.0065] },
            { c: eat(1.08), r: [0.004, 0.004] },
        ], { up: eface, blend: 0.006, steps: 5, keep: true });
        B.limb(`earHollow${t}`, [`ear${t}`], [
            { c: eat(0.16, 0.0125), r: [0.010, 0.0095] },
            { c: eat(0.46, 0.0125), r: [0.020, 0.0112] },
            { c: eat(0.76, 0.0112), r: [0.013, 0.0096] },
            { c: eat(0.94, 0.0102), r: [0.0045, 0.0072] },
        ], { up: eface, blend: 0.0035, steps: 5, carve: true });
        // The arm: heroic deltoid cap over the shoulder, lean to the elbow,
        // fuller forearm below it and slim at the wrist.
        const sh = bn(`shoulder${t}`), ua = bn(`upperarm${t}`), fa = bn(`forearm${t}`), hd = bn(`hand${t}`);
        B.limb(`arm${t}`, [`shoulder${t}`, `upperarm${t}`, `forearm${t}`], [
            { c: at(sh, 0.52), r: [0.053, 0.054], bone: `shoulder${t}` },
            { c: at(ua, 0.03), r: [0.054, 0.056], bone: `upperarm${t}` },
            { c: at(ua, 0.35), r: [0.041, 0.044] },
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
