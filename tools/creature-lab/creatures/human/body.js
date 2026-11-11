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
    // The tunic: the trunk and the arms to above the elbows, its hem at the
    // top of the thighs; a pale band at the hem, the cuffs and the neck.
    const hem = sstep(0.845, 0.86, p[1]);
    const along = 0.53 * (Math.abs(p[0]) - 0.185) - 0.848 * (p[1] - 1.435);
    const sleeve = sstep(0.252, 0.236, along);
    const body = (share('trunk') + share('breast') + leg) * hem;
    c = mix(c, TUNIC, Math.min(1, body + arm * sleeve));
    c = mix(c, BELT, share('trunk') * sstep(1.03, 1.045, p[1]) * sstep(1.1, 1.085, p[1]));
    // Trousers under it, boots to under the calf.
    c = mix(c, TROUSER, Math.min(1, share('trunk') + leg) * (1 - hem));
    const boot = Math.min(1, LR('boot') + LR('heel') + leg * sstep(0.31, 0.295, p[1]));
    c = mix(c, BOOT, boot);
    // The head: skin, the hair over it.
    const headSkin = share('skull') + share('jaw') + share('chin') + share('brow') + share('nose')
        + share('upperlip') + share('lowerlip') + share('neck') + LR('alar') + LR('ear') + LR('earTragus');
    c = mix(c, SKIN, Math.min(1, headSkin));
    const hair = share('hair') + share('nape') + share('fringe') + LR('temple');
    const face = sstep(0.055, 0.085, p[2]) * sstep(1.712, 1.695, p[1]);
    c = mix(c, HAIR, Math.min(1, 1.6 * hair) * (1 - face) * (1 - LR('ear') - LR('earTragus')));
    c = mix(c, SKIN, LR('palm') + LR('thumb') + LR('finger0') + LR('finger1') + LR('finger2') + LR('finger3'));
    return mix(c, EYE, LR('eye'));
}

// `detail` overrides the meshing (Flesh's cell, triangles, simplifyError,
// keep) for a coarser level of detail of the same body.
export function body(skel, detail = {}) {
    const B = new Flesh(skel, { color: coat, triangles: 28000, cell: 0.005, ...detail });
    const bn = (n) => skel.bones[skel.index(n)];
    const at = (b, u, off = [0, 0, 0]) => add(lerp(b.head, b.tail, u), off);
    const scale = (v, k) => v.map((x) => x * k);
    // The trunk: hips, a waist, a rib cage, athletic shoulders cleanly inside
    // the axilla so the abducted upper arm emerges free at the shoulder joint.
    B.limb('trunk', ['pelvis', 'spine', 'chest'], [
        { c: [0, 0.885, -0.002], r: [0.08, 0.072] },
        { c: [0, 0.945, -0.003], r: [0.162, 0.104] },
        { c: [0, 1.02, 0.001], r: [0.138, 0.095] },
        { c: [0, 1.105, 0.008], r: [0.115, 0.085] },
        { c: [0, 1.2, 0.015], r: [0.136, 0.099] },
        { c: [0, 1.305, 0.016], r: [0.153, 0.108] },
        { c: [0, 1.395, 0.006], r: [0.146, 0.094] },
        { c: [0, 1.455, -0.002], r: [0.112, 0.068] },
        { c: [0, 1.49, -0.005], r: [0.056, 0.052] },
    ], { up: [0, 0, 1], blend: 0.02 });
    B.blob('breast', 'chest', [0, 1.32, 0.068], [0.122, 0.072, 0.048], { blend: 0.03 });
    // The neck: set back under the occiput so the jaw and chin have a crisp
    // submental corner in profile.
    B.limb('neck', ['chest', 'neck'], [
        { c: [0, 1.465, -0.006], r: [0.055, 0.054] },
        { c: [0, 1.525, -0.009], r: [0.047, 0.048] },
        { c: [0, 1.585, -0.014], r: [0.046, 0.047], bone: 'head' },
    ], { up: [0, 0, 1], blend: 0.012 });
    // The head: cranium, brow ridge, tapered jaw and chin, sculpted nose,
    // alar wings and lips.
    B.blob('skull', 'head', [0, 1.664, 0.014], [0.074, 0.091, 0.095], { blend: 0.012 });
    B.blob('brow', 'head', [0, 1.662, 0.082], [0.05, 0.014, 0.024], { blend: 0.01 });
    B.limb('jaw', ['head'], [
        { c: [0, 1.618, 0.034], r: [0.059, 0.045] },
        { c: [0, 1.586, 0.064], r: [0.039, 0.033] },
        { c: [0, 1.571, 0.085], r: [0.022, 0.019] },
    ], { up: [0, 1, 0], blend: 0.011, steps: 3, keep: true });
    B.blob('chin', 'head', [0, 1.568, 0.091], [0.019, 0.014, 0.016], { blend: 0.008, keep: true });
    B.limb('nose', ['head'], [
        { c: [0, 1.65, 0.102], r: [0.008, 0.008] },
        { c: [0, 1.633, 0.114], r: [0.009, 0.01] },
        { c: [0, 1.617, 0.123], r: [0.0105, 0.0105] },
        { c: [0, 1.609, 0.111], r: [0.0085, 0.0075] },
    ], { up: [0, 1, 0], blend: 0.006, keep: true });
    B.blob('upperlip', 'head', [0, 1.594, 0.096], [0.021, 0.0065, 0.013], { blend: 0.005, keep: true });
    B.blob('lowerlip', 'head', [0, 1.583, 0.095], [0.0185, 0.0065, 0.013], { blend: 0.005, keep: true });
    // The hair: cranial volume over the crown, swept fringe at the brow, and
    // full nape behind, sculpted cleanly above and behind the ears.
    B.blob('hair', 'head', [0, 1.702, 0.006], [0.082, 0.064, 0.1], { blend: 0.007, keep: true });
    B.blob('nape', 'head', [0, 1.642, -0.038], [0.075, 0.068, 0.054], { blend: 0.008 });
    B.blob('fringe', 'head', [0, 1.724, 0.068], [0.067, 0.03, 0.044], { blend: 0.007, keep: true });
    for (const [s, t] of SIDES) {
        B.blob(`eye${t}`, 'head', [0.031 * s, 1.642, 0.093], [0.014, 0.012, 0.012], { blend: 0.003, keep: true });
        B.blob(`alar${t}`, 'head', [0.0115 * s, 1.613, 0.112], [0.0072, 0.007, 0.0088], { blend: 0.004, keep: true });
        B.blob(`temple${t}`, 'head', [0.073 * s, 1.676, 0.028], [0.012, 0.021, 0.028], { blend: 0.006 });
        // Sculpted C-curved auricle and tragus cleanly outside the temporal wall.
        B.limb(`ear${t}`, ['head'], [
            { c: [0.081 * s, 1.651, 0.002], r: [0.0075, 0.011] },
            { c: [0.087 * s, 1.641, -0.008], r: [0.0082, 0.0125] },
            { c: [0.086 * s, 1.627, -0.008], r: [0.0082, 0.0125] },
            { c: [0.079 * s, 1.614, 0.001], r: [0.0068, 0.0095] },
        ], { up: [0, 0, 1], blend: 0.004, steps: 2, keep: true });
        B.blob(`earTragus${t}`, 'head', [0.081 * s, 1.631, 0.006], [0.0055, 0.007, 0.006], { blend: 0.003, keep: true });
        // The arm: deltoid cap, athletic biceps/triceps, tapered forearm and wrist.
        const sh = bn(`shoulder${t}`), ua = bn(`upperarm${t}`), fa = bn(`forearm${t}`), hd = bn(`hand${t}`);
        B.limb(`arm${t}`, [`shoulder${t}`, `upperarm${t}`, `forearm${t}`], [
            { c: at(sh, 0.55), r: [0.052, 0.05], bone: `shoulder${t}` },
            { c: at(ua, 0.02, [0, 0.004, 0]), r: [0.054, 0.056], bone: `upperarm${t}` },
            { c: at(ua, 0.24), r: [0.046, 0.049], bone: `upperarm${t}` },
            { c: at(ua, 0.55), r: [0.043, 0.046] },
            { c: at(ua, 0.85), r: [0.038, 0.04] },
            { c: fa.head, r: [0.037, 0.039] },
            { c: at(fa, 0.24), r: [0.039, 0.042] },
            { c: at(fa, 0.68), r: [0.029, 0.032] },
            { c: hd.head, r: [0.022, 0.026], bone: `forearm${t}` },
        ], { up: [0, 0, 1], blend: 0.012 });
        // The hand: local palmar/radial axes on the 32-deg abducted hand bone
        // so the palm is slender, fingers taper with a natural curl, and the
        // thumb stands clearly opposable.
        const hIn = [-0.848 * s, -0.53, 0];
        const hFwd = [0, 0, 1];
        const hOff = (inw, fwd) => add(scale(hIn, inw), scale(hFwd, fwd));
        B.limb(`palm${t}`, [`hand${t}`], [
            { c: at(hd, 0.05), r: [0.015, 0.027] },
            { c: at(hd, 0.5, hOff(0.001, 0.001)), r: [0.013, 0.036] },
        ], { up: [0, 0, 1], blend: 0.006, steps: 2 });
        for (const [i, d] of [[0, 0.024], [1, 0.008], [2, -0.008], [3, -0.023]]) {
            const len = [0.96, 1.05, 1.0, 0.88][i];
            const r0 = [0.0092, 0.0096, 0.0092, 0.0084][i];
            B.limb(`finger${i}${t}`, [`hand${t}`], [
                { c: at(hd, 0.48, hOff(0.001, d)), r: r0 },
                { c: at(hd, 0.78, hOff(0.003, d)), r: 0.9 * r0 },
                { c: at(hd, len, hOff(0.009, 0.98 * d)), r: 0.72 * r0 },
            ], { blend: 0.0042, steps: 3, keep: true });
        }
        B.limb(`thumb${t}`, [`hand${t}`], [
            { c: at(hd, 0.12, hOff(0.006, 0.026)), r: 0.012 },
            { c: at(hd, 0.31, hOff(0.015, 0.047)), r: 0.0092 },
            { c: at(hd, 0.48, hOff(0.022, 0.054)), r: 0.0072 },
        ], { blend: 0.004, steps: 3, keep: true });
        // The leg: full athletic outer sweep on thigh and glute, clean high
        // medial groin part, sculpted knee, gastrocnemius calf and slim ankle.
        const th = bn(`thigh${t}`), sn = bn(`shin${t}`), ft = bn(`foot${t}`), to = bn(`toe${t}`);
        B.limb(`leg${t}`, [`thigh${t}`, `shin${t}`], [
            { c: at(th, -0.01, [0.01 * s, 0, -0.014]), r: [0.078, 0.095], bone: `thigh${t}` },
            { c: at(th, 0.24, [0.008 * s, 0, -0.004]), r: [0.075, 0.092], bone: `thigh${t}` },
            { c: at(th, 0.62, [0.003 * s, 0, 0.002]), r: [0.064, 0.075] },
            { c: at(th, 0.95), r: [0.052, 0.058] },
            { c: at(sn, 0.06, [0, 0, 0.004]), r: [0.05, 0.055] },
            { c: at(sn, 0.3, [0.002 * s, 0, -0.018]), r: [0.05, 0.059] },
            { c: at(sn, 0.68, [0, 0, -0.007]), r: [0.037, 0.042] },
            { c: at(sn, 0.95), r: [0.033, 0.037], bone: `shin${t}` },
        ], { up: [0, 0, 1], blend: 0.016 });
        // The boot: an ankle, a heel behind and under it, a long sole to
        // the ball, a rounded toe.
        B.limb(`boot${t}`, [`foot${t}`, `toe${t}`], [
            { c: at(ft, -0.05, [0, 0.0, -0.004]), r: [0.035, 0.039], bone: `foot${t}` },
            { c: at(ft, 0.4, [0, 0.0, 0]), r: [0.039, 0.034], bone: `foot${t}` },
            { c: at(ft, 0.92, [0, 0.014, 0]), r: [0.046, 0.031], bone: `foot${t}` },
            { c: at(to, 0.45, [0, 0.017, 0]), r: [0.043, 0.027], bone: `toe${t}` },
            { c: at(to, 0.95, [0, 0.018, 0]), r: [0.03, 0.02], bone: `toe${t}` },
        ], { up: [0, 1, 0], blend: 0.012 });
        B.blob(`heel${t}`, `foot${t}`, add(ft.head, [0, -0.046, -0.022]), [0.034, 0.038, 0.042], { blend: 0.012 });
    }
    B.section('waist', { at: [0, 1.105, 0.004], normal: [0, 1, 0], bone: 'spine', radius: 0.3 });
    B.section('hips', { at: [0, 0.945, 0.0], normal: [0, 1, 0], bone: 'pelvis', radius: 0.3 });
    return B.build();
}
