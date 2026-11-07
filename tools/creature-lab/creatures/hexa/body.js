// The hexa's body: masses on its bones, blended into one skin (lab/flesh.js).
// A barrel of a body, slung low between three pairs of legs, a humped
// shoulder, a heavy wedge of a head with a jaw and brow ridges, and a tail
// tapering from the hips' width to a point. Slate grey with a pale belly
// and dark bands across the back.

import { Flesh, SIDES } from "/app/lab/flesh.js";

const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const SLATE = [0.36, 0.40, 0.42], BELLY = [0.78, 0.74, 0.62], BAND = [0.18, 0.20, 0.23], HORN = [0.85, 0.80, 0.66], DARK = [0.06, 0.05, 0.05];

function coat(p, n, share) {
    let c = mix(SLATE, BELLY, (-n[1] - 0.2) / 0.5);
    // Bands across the back and down the tail, every 0.32 m.
    c = mix(c, BAND, (n[1] - 0.2) * 1.4 * (0.5 + 0.5 * Math.cos(p[2] / 0.32 * 2 * Math.PI)));
    const feet = SIDES.flatMap(([, t]) => [1, 2, 3].map((k) => share(`foot${t}${k}`))).reduce((a, b) => a + b, 0);
    c = mix(c, DARK, feet);
    c = mix(c, HORN, share('browL') + share('browR'));
    return mix(c, DARK, share('eyeL') + share('eyeR'));
}

export function body(skel) {
    const B = new Flesh(skel, { color: coat, triangles: 16000 });
    B.limb('barrel', ['pelvis', 'spine', 'thorax'], [
        { c: [0, 0.62, -0.68], r: [0.16, 0.14] },
        { c: [0, 0.61, -0.45], r: [0.26, 0.20] },
        { c: [0, 0.61, 0.05], r: [0.30, 0.23] },
        { c: [0, 0.63, 0.55], r: [0.29, 0.23] },
        { c: [0, 0.66, 0.86], r: [0.20, 0.19] },
    ], { blend: 0.05 });
    B.blob('hump', 'thorax', [0, 0.80, 0.55], [0.17, 0.12, 0.26], { blend: 0.06 });
    B.limb('neck', ['thorax', 'neck'], [
        { c: [0, 0.66, 0.78], r: [0.19, 0.20] },
        { c: [0, 0.68, 1.06], r: [0.15, 0.17] },
    ], { blend: 0.05 });
    B.limb('head', ['head'], [
        { c: [0, 0.71, 1.10], r: [0.18, 0.18] },
        { c: [0, 0.63, 1.38], r: [0.14, 0.14] },
        { c: [0, 0.54, 1.60], r: [0.09, 0.085] },
    ], { blend: 0.03 });
    B.limb('jaw', ['jaw'], [
        { c: [0, 0.55, 1.14], r: [0.14, 0.09] },
        { c: [0, 0.45, 1.50], r: [0.075, 0.05] },
    ], { blend: 0.03 });
    B.limb('tail', ['tail1', 'tail2', 'tail3', 'tail4'], [
        { c: [0, 0.62, -0.62], r: [0.14, 0.12] },
        { c: [0, 0.57, -1.00], r: [0.09, 0.08] },
        { c: [0, 0.47, -1.45], r: [0.05, 0.045] },
        { c: [0, 0.35, -1.85], r: [0.03, 0.025] },
        { c: [0, 0.29, -2.15], r: 0.008 },
    ], { blend: 0.03 });
    for (const [s, t] of SIDES) {
        B.blob(`brow${t}`, 'head', [0.10 * s, 0.86, 1.17], [0.055, 0.04, 0.10], { blend: 0.015 });
        B.blob(`eye${t}`, 'head', [0.145 * s, 0.76, 1.24], [0.024, 0.024, 0.024], { blend: 0.006 });
        for (const k of [1, 2, 3]) {
            const u = skel.bones[skel.index(`upper${t}${k}`)], l = skel.bones[skel.index(`lower${t}${k}`)];
            const [x, , z] = u.head;
            B.limb(`leg${t}${k}`, [`upper${t}${k}`, `lower${t}${k}`], [
                { c: [x * 0.8, 0.60, z], r: [0.10, 0.12], bone: `upper${t}${k}` },
                { c: [x, 0.45, z + 0.04], r: [0.085, 0.10] },
                { c: l.head, r: [0.06, 0.07] },
                { c: [x, 0.15, z + 0.03], r: [0.045, 0.05] },
                { c: [x, 0.07, z - 0.01], r: 0.04, bone: `lower${t}${k}` },
            ], { up: [0, 0, 1], blend: 0.035 });
            B.limb(`foot${t}${k}`, [`foot${t}${k}`], [
                { c: [x, 0.05, z - 0.03], r: [0.05, 0.05] },
                { c: [x, 0.03, z + 0.08], r: [0.055, 0.03] },
            ], { blend: 0.012, steps: 2 });
        }
    }
    return B.build();
}
