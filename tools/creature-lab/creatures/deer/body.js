// The deer's body, sculpted in code in the rest pose: a barrel trunk, a
// neck rising from the chest, a long-muzzled head with big ears, a short
// flagging tail, and slender legs ending in split hooves. Coat: tawny above,
// cream underneath and inside the legs, a white throat patch and tail
// underside, a dark muzzle.

import { Sculpt } from "/app/lab/sculpt.js";

const COAT = [0.55, 0.37, 0.22];
const BACK = [0.45, 0.30, 0.18];
const CREAM = [0.88, 0.82, 0.72];
const WHITE = [0.95, 0.94, 0.90];
const MUZZLE = [0.20, 0.15, 0.12];
const NOSE = [0.05, 0.05, 0.05];
const HOOF = [0.12, 0.11, 0.10];
const LEGS = [0.50, 0.36, 0.25];

const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// The trunk's coat: darker along the back, cream under the belly and
// between the legs, a white rump patch round the tail.
function trunkColor(p, n) {
    let c = mix(COAT, BACK, sstep(0.3, 0.9, n[1]));
    c = mix(c, CREAM, sstep(-0.25, -0.65, n[1]));
    c = mix(c, WHITE, sstep(-0.52, -0.6, p[2]) * sstep(0.7, 0.85, p[1]) * sstep(0.08, 0.02, Math.abs(p[0])));
    return c;
}

function legColor(front) {
    return (p, n) => {
        let c = mix(LEGS, COAT, sstep(0.35, 0.6, p[1]));
        // Cream on the inner face of the leg.
        const inner = -Math.sign(p[0]) * n[0];
        c = mix(c, CREAM, sstep(0.2, 0.7, inner) * sstep(0.7, 0.4, p[1]));
        if (!front) c = mix(c, CREAM, sstep(0.5, 0.9, -n[2]) * sstep(0.62, 0.5, p[1]) * sstep(0.38, 0.45, p[1]));
        return c;
    };
}

function frontLeg(S, s) {
    const t = s > 0 ? 'L' : 'R';
    const x = (v) => v * s;
    S.loft([
        { c: [x(0.085), 0.93, 0.32], r: [0.055, 0.10] },
        { c: [x(0.10), 0.80, 0.38], r: [0.06, 0.10] },
        { c: [x(0.11), 0.70, 0.41], r: [0.062, 0.088] },
        { c: [x(0.11), 0.60, 0.375], r: [0.052, 0.074] },
        { c: [x(0.11), 0.52, 0.335], r: [0.043, 0.056] },
        { c: [x(0.11), 0.45, 0.336], r: [0.036, 0.046] },
        { c: [x(0.11), 0.35, 0.341], r: [0.025, 0.030] },
        { c: [x(0.11), 0.28, 0.345], r: [0.023, 0.030] },
        { c: [x(0.11), 0.24, 0.346], r: [0.017, 0.022] },
        { c: [x(0.11), 0.12, 0.351], r: [0.016, 0.020] },
        { c: [x(0.11), 0.078, 0.355], r: [0.020, 0.023] },
        { c: [x(0.11), 0.05, 0.37], r: [0.018, 0.020] },
    ], { bones: [['thorax', 0.5], `scap${t}`, `humerus${t}`, `radius${t}`, `mc${t}`, `fhoof${t}`], segs: 16, hint: [0, 0, 1],
         color: legColor(true), caps: [true, false] });
    hoof(S, x(0.11), 0.355, `mc${t}`, `fhoof${t}`);
}

function hindLeg(S, s) {
    const t = s > 0 ? 'L' : 'R';
    const x = (v) => v * s;
    S.loft([
        { c: [x(0.075), 0.84, -0.40], r: [0.07, 0.12] },
        { c: [x(0.095), 0.73, -0.37], r: [0.075, 0.125] },
        { c: [x(0.105), 0.63, -0.335], r: [0.064, 0.10] },
        { c: [x(0.105), 0.555, -0.315], r: [0.05, 0.075] },
        { c: [x(0.105), 0.49, -0.365], r: [0.042, 0.062] },
        { c: [x(0.105), 0.42, -0.44], r: [0.03, 0.042] },
        { c: [x(0.105), 0.365, -0.495], r: [0.023, 0.036] },
        { c: [x(0.105), 0.31, -0.492], r: [0.018, 0.024] },
        { c: [x(0.105), 0.16, -0.477], r: [0.016, 0.021] },
        { c: [x(0.105), 0.078, -0.465], r: [0.020, 0.023] },
        { c: [x(0.105), 0.05, -0.45], r: [0.018, 0.020] },
    ], { bones: [['pelvis', 0.6], `femur${t}`, `tibia${t}`, `mt${t}`, `hhoof${t}`], segs: 16, hint: [0, 0, 1],
         color: legColor(false), caps: [true, false] });
    hoof(S, x(0.105), -0.465, `mt${t}`, `hhoof${t}`);
}

// A cloven hoof: pastern into a dark wedge whose sole sits on the ground.
function hoof(S, x, z, upper, bone) {
    S.loft([
        { c: [x, 0.06, z + 0.012], r: [0.018, 0.02] },
        { c: [x, 0.035, z + 0.03], r: [0.021, 0.026] },
        { c: [x, 0.015, z + 0.045], r: [0.022, 0.028] },
        { c: [x, 0.004, z + 0.055], r: [0.018, 0.022] },
    ], { bones: [upper, bone], segs: 14, hint: [0, 0, 1], steps: 2,
         color: (p) => (p[1] < 0.042 ? HOOF : LEGS) });
}

export function body(skel) {
    const S = new Sculpt(skel);
    // Trunk: rump to brisket, deeper than wide, the back narrowing to the spine.
    S.loft([
        { c: [0, 0.80, -0.635], r: [0.05, 0.06] },
        { c: [0, 0.795, -0.60], r: [0.105, 0.105] },
        { c: [0, 0.785, -0.51], r: [0.145, 0.14] },
        { c: [0, 0.775, -0.36], r: [0.155, 0.165] },
        { c: [0, 0.765, -0.17], r: [0.148, 0.17] },
        { c: [0, 0.76, 0.03], r: [0.158, 0.19] },
        { c: [0, 0.765, 0.20], r: [0.165, 0.21] },
        { c: [0, 0.775, 0.34], r: [0.152, 0.205] },
        { c: [0, 0.79, 0.46], r: [0.12, 0.17] },
        { c: [0, 0.81, 0.53], r: [0.07, 0.10] },
    ], { bones: ['pelvis', 'lumbar', 'thorax', ['scapL', 0.55], ['scapR', 0.55], ['femurL', 0.5], ['femurR', 0.5]],
         weights: 'vertex', segs: 36, steps: 4, hint: [0, 1, 0],
         shape: (th) => [1 - 0.22 * Math.pow(Math.max(0, Math.sin(th)), 3), 1],
         color: trunkColor });
    // Neck: from inside the chest up to the back of the skull.
    S.loft([
        { c: [0, 0.82, 0.40], r: [0.11, 0.15] },
        { c: [0, 0.90, 0.50], r: [0.088, 0.125] },
        { c: [0, 1.00, 0.585], r: [0.072, 0.10] },
        { c: [0, 1.10, 0.645], r: [0.062, 0.085] },
        { c: [0, 1.20, 0.695], r: [0.056, 0.072] },
        { c: [0, 1.28, 0.725], r: [0.054, 0.064] },
    ], { bones: [['thorax', 0.7], 'neck1', 'neck2', 'head'], segs: 22, hint: [0, 0, 1],
         color: (p, n) => mix(mix(COAT, BACK, sstep(0.0, 0.8, n[2] < 0 ? -n[2] : 0)), WHITE,
             sstep(0.4, 0.8, n[2] > 0 ? n[2] : 0) * sstep(1.12, 1.2, p[1]) * sstep(1.27, 1.22, p[1])),
         caps: [false, false] });
    // Head: cranium to muzzle.
    S.loft([
        { c: [0, 1.31, 0.695], r: [0.045, 0.045] },
        { c: [0, 1.315, 0.735], r: [0.064, 0.064] },
        { c: [0, 1.30, 0.79], r: [0.06, 0.058] },
        { c: [0, 1.27, 0.85], r: [0.045, 0.05] },
        { c: [0, 1.24, 0.91], r: [0.034, 0.042] },
        { c: [0, 1.21, 0.958], r: [0.028, 0.034] },
        { c: [0, 1.195, 0.99], r: [0.02, 0.024] },
    ], { bones: ['head'], segs: 20, hint: [0, 1, 0],
         color: (p, n) => {
             let c = mix(COAT, MUZZLE, sstep(0.9, 0.96, p[2]));
             c = mix(c, NOSE, sstep(0.965, 0.985, p[2]));
             return mix(c, WHITE, sstep(-0.5, -0.8, n[1]) * sstep(0.88, 0.94, p[2]));
         } });
    for (const s of [1, -1]) {
        S.blob([0.046 * s, 1.30, 0.80], [0.012, 0.012, 0.014], { bones: ['head'], color: NOSE, segs: 10, rows: 6 });
        const e = s > 0 ? 'earL' : 'earR';
        S.loft([
            { c: [0.045 * s, 1.325, 0.75], r: [0.022, 0.009] },
            { c: [0.08 * s, 1.355, 0.738], r: [0.036, 0.011] },
            { c: [0.12 * s, 1.39, 0.725], r: [0.032, 0.009] },
            { c: [0.155 * s, 1.42, 0.715], r: [0.008, 0.004] },
        ], { bones: [e], segs: 12, hint: [0, 0, 1],
             color: (p, n) => (n[2] > 0.3 ? [0.85, 0.72, 0.65] : COAT) });
    }
    // Tail: brown above, white beneath.
    S.loft([
        { c: [0, 0.855, -0.57], r: [0.035, 0.025] },
        { c: [0, 0.83, -0.64], r: [0.05, 0.028] },
        { c: [0, 0.79, -0.695], r: [0.05, 0.026] },
        { c: [0, 0.74, -0.745], r: [0.03, 0.02] },
    ], { bones: [['pelvis', 0.6], 'tail1', 'tail2'], segs: 14, hint: [0, 1, 0],
         color: (p, n) => mix(BACK, WHITE, sstep(0.0, -0.4, n[1])) });
    for (const s of [1, -1]) { frontLeg(S, s); hindLeg(S, s); }
    return S.build();
}
