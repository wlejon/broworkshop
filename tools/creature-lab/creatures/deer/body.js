// The deer's body, sculpted in code in the rest pose: a white-tailed deer
// of 0.95 m at the withers (skeleton.js).
//
// The proportions, from white-tailed deer, as the reasons for the shapes:
//   withers (scapula top + skin)   0.97 m; the croup level with it
//   chest depth (withers to the    0.41 m, 43% of the withers height, so the
//     floor behind the elbows)     legs under the chest are 1.35x its depth
//   heart girth                    0.98 m: girth-weight tables give 0.94 to
//                                  1.0 m for the 75 to 85 kg a deer this tall
//                                  weighs (0.84 m is a 55 kg doe of 0.85 m)
//   chest width                    0.24 m behind the elbows, 0.28 m across
//                                  the arms: a deep, narrow section, its
//                                  sides full down to the elbows
//   belly line                     rising 7 cm from the girth to the flank
//   haunches                       0.25 m across, full down to the stifle
//   trunk, point of shoulder to    1.06 m, 1.1x the withers height; brisket
//     point of buttock             to buttock 1.29 m
//   neck                           0.30 m deep where it leaves the chest,
//                                  0.17 m at mid neck, 0.13 m at the throat
//   head                           0.29 m, ears 0.15 m, tail 0.2 m
//
// The trunk carries the shoulders and the thighs in its own skin: a hand
// drawn weight field gives the skin over each scapula, upper arm and thigh
// to that bone and the rest to the spine, so the blade slides under the
// skin and the leg swings out of the body instead of a tube ending at its
// surface. The legs below (legs.js) start inside the trunk.

import { Sculpt } from "/app/lab/sculpt.js";
import { frontLeg, hindLeg } from "./legs.js";
import { trunkColor, neckColor, headColor, tailColor, earColor, NOSE, sstep } from "./coat.js";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function segDist(p, a, b) {
    const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
    return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t);
}

// The trunk's skin weights at rest point p. Each side's scapula, humerus
// and femur take the skin within a few centimetres of them, fading over
// 6 to 9 cm; the midline (back, chest floor, belly) stays on the spine,
// which hands from pelvis to lumbar to thorax along the body.
function trunkWeights(skel) {
    const seg = (name) => { const b = skel.bones[skel.index(name)]; return [b.head, b.tail]; };
    const scap = seg('scapL'), hum = seg('humerusL'), fem = seg('femurL');
    return (p) => {
        const sx = Math.abs(p[0]), t = p[0] >= 0 ? 'L' : 'R';
        const q = [sx, p[1], p[2]];
        let ws = sstep(0.02, 0.08, sx) * (1 - sstep(0.05, 0.12, segDist(q, ...scap)));
        let wh = sstep(0.04, 0.09, sx) * (1 - sstep(0.05, 0.11, segDist(q, ...hum)));
        let wf = sstep(0.03, 0.08, sx) * (1 - sstep(0.07, 0.16, segDist(q, ...fem)));
        let limb = ws + wh + wf;
        if (limb > 1) { ws /= limb; wh /= limb; wf /= limb; limb = 1; }
        const spine = 1 - limb;
        const a = sstep(-0.24, -0.04, p[2]), b = sstep(0.04, 0.22, p[2]);
        return [
            ['pelvis', spine * (1 - a)], ['lumbar', spine * a * (1 - b)], ['thorax', spine * b],
            [`scap${t}`, ws], [`humerus${t}`, wh], [`femur${t}`, wf],
        ];
    };
}

// A trunk section: its upper and lower halves superellipses of exponents
// nt and nb (2 an ellipse, 3 squarer: full sides down to the elbows and the
// stifles, where the arm and the thigh lie on the body), narrowed toward
// the spine by kt (the withers' blade).
function trunkShape(th, u, s) {
    const [nt, nb, kt] = s;
    const v = Math.sin(th), c = Math.abs(Math.cos(th));
    const n = v > 0 ? nt : nb;
    let f = c > 1e-4 ? Math.pow(1 - Math.pow(Math.abs(v), n), 1 / n) / c : 1;
    if (v > 0) f *= 1 - kt * Math.pow(v, 1.6);
    return [f, 1];
}

// A trunk key ring from its z, the back's and the belly's heights and its half width.
const ring = (z, top, bottom, hw, s, name) => ({ c: [0, (top + bottom) / 2, z], r: [hw, (top - bottom) / 2], s, name });

function trunk(S, skel) {
    S.loft([
        ring(-0.655, 0.855, 0.705, 0.030, [2.0, 2.0, 0.2]),
        ring(-0.630, 0.885, 0.640, 0.080, [2.2, 2.2, 0.35]),
        ring(-0.570, 0.925, 0.600, 0.125, [2.3, 2.6, 0.35], 'rump'),
        ring(-0.450, 0.968, 0.572, 0.138, [2.2, 3.8, 0.3], 'hip'),
        ring(-0.310, 0.966, 0.622, 0.124, [2.2, 3.0, 0.3], 'flank'),
        ring(-0.180, 0.956, 0.600, 0.118, [2.2, 2.2, 0.3], 'waist'),
        ring(-0.020, 0.956, 0.566, 0.126, [2.2, 2.2, 0.35], 'ribs'),
        ring(0.160, 0.958, 0.556, 0.120, [2.2, 2.2, 0.42], 'girth'),
        ring(0.300, 0.982, 0.556, 0.142, [2.1, 3.5, 0.55], 'shoulder'),
        ring(0.420, 0.955, 0.585, 0.130, [2.1, 3.2, 0.5]),
        ring(0.500, 0.920, 0.640, 0.095, [2.0, 2.6, 0.4]),
        ring(0.550, 0.870, 0.700, 0.052, [2.0, 2.2, 0.3]),
        ring(0.572, 0.810, 0.745, 0.020, [2.0, 2.0, 0.3]),
    ], { weights: trunkWeights(skel), segs: 40, steps: 4, hint: [0, 1, 0], name: 'trunk',
         shape: trunkShape, color: trunkColor });
}

// The neck: from inside the chest, deep at its base where it meets the
// brisket and the withers, tapering to the throat under the skull.
function neck(S) {
    S.loft([
        { c: [0, 0.80, 0.42], r: [0.10, 0.17] },
        { c: [0, 0.90, 0.50], r: [0.092, 0.15], name: 'neckbase' },
        { c: [0, 1.00, 0.57], r: [0.072, 0.112] },
        { c: [0, 1.10, 0.625], r: [0.058, 0.088], name: 'neckmid' },
        { c: [0, 1.19, 0.67], r: [0.052, 0.074] },
        { c: [0, 1.265, 0.705], r: [0.048, 0.066] },
        { c: [0, 1.30, 0.72], r: [0.044, 0.058] },
    ], { bones: [['thorax', 0.7], 'neck1', 'neck2', 'head'], segs: 24, hint: [0, 0, 1], name: 'neck',
         color: neckColor, caps: [false, false] });
}

// Head: cranium to muzzle, widest across the eyes; eyes, ears.
function head(S) {
    S.loft([
        { c: [0, 1.31, 0.695], r: [0.045, 0.045] },
        { c: [0, 1.315, 0.735], r: [0.062, 0.063] },
        { c: [0, 1.30, 0.785], r: [0.06, 0.058] },
        { c: [0, 1.272, 0.845], r: [0.045, 0.05] },
        { c: [0, 1.242, 0.905], r: [0.034, 0.042] },
        { c: [0, 1.212, 0.955], r: [0.028, 0.034] },
        { c: [0, 1.197, 0.988], r: [0.02, 0.024] },
    ], { bones: ['head'], segs: 20, hint: [0, 1, 0], name: 'head', color: headColor });
    for (const s of [1, -1]) {
        S.blob([0.046 * s, 1.30, 0.80], [0.012, 0.012, 0.014], { bones: ['head'], color: NOSE, segs: 10, rows: 6 });
        S.loft([
            { c: [0.045 * s, 1.325, 0.75], r: [0.022, 0.009] },
            { c: [0.08 * s, 1.355, 0.738], r: [0.036, 0.011] },
            { c: [0.12 * s, 1.39, 0.725], r: [0.032, 0.009] },
            { c: [0.155 * s, 1.42, 0.715], r: [0.008, 0.004] },
        ], { bones: [s > 0 ? 'earL' : 'earR'], segs: 12, hint: [0, 0, 1], color: earColor });
    }
}

// Tail: brown above, white beneath, broad and flat.
function tail(S) {
    S.loft([
        { c: [0, 0.865, -0.585], r: [0.035, 0.025] },
        { c: [0, 0.835, -0.645], r: [0.05, 0.028] },
        { c: [0, 0.79, -0.698], r: [0.05, 0.026] },
        { c: [0, 0.74, -0.745], r: [0.03, 0.02] },
    ], { bones: [['pelvis', 0.6], 'tail1', 'tail2'], segs: 14, hint: [0, 1, 0], color: tailColor });
}

export function body(skel) {
    const S = new Sculpt(skel);
    trunk(S, skel);
    neck(S);
    head(S);
    tail(S);
    for (const s of [1, -1]) { frontLeg(S, s); hindLeg(S, s); }
    return S.build();
}
