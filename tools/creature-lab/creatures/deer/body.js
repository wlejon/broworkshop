// The deer's body: a white-tailed deer of 0.95 m at the withers
// (skeleton.js), as masses on its bones blended into one skin (lab/flesh.js).
//
// The proportions, from white-tailed deer, as the reasons for the shapes:
//   withers (scapula top + skin)   0.97 m; the croup level with it
//   chest depth (withers to the    0.41 m, 43% of the withers height, so the
//     floor behind the elbows)     legs under the chest are 1.35x its depth
//   heart girth                    0.98 m: girth-weight tables give 0.94 to
//                                  1.0 m for the 75 to 85 kg a deer this tall
//                                  weighs
//   chest width                    0.24 m behind the elbows, 0.28 m across
//                                  the shoulders: a deep, narrow section
//   belly line                     rising 7 cm from the girth to the flank
//   haunches                       0.275 m across, the hams hanging to 0.52 m
//   trunk, brisket to buttock      1.2 m
//   neck                           0.30 m deep where it leaves the chest,
//                                  0.17 m at mid neck, 0.13 m at the throat;
//                                  0.12 m across at mid neck and 0.11 m under
//                                  the jaw, as wide as the cheeks
//   head                           0.29 m, ears 0.15 m, tail 0.2 m
//
// The trunk is a tube along the spine; the shoulder blades and the thighs
// are masses of their own on the scapulae and femurs, laid on its sides, so
// the skin over them goes with those bones and the blend hands it to the
// spine. The neck, the head with its ears and eyes, the tail and the legs
// (legs.js) blend into it. A key ring is { c, r: [side, up] }; a trunk ring
// is written by its z, the back's and the belly's heights and half width.

import { Flesh, SIDES } from "/app/lab/flesh.js";
import { coat } from "./coat.js";
import { legs, legSections } from "./legs.js";

const ring = (z, top, bottom, hw) => ({ c: [0, (top + bottom) / 2, z], r: [hw, (top - bottom) / 2] });

export function body(skel) {
    const B = new Flesh(skel, { color: coat, triangles: 14000 });
    B.limb('trunk', ['pelvis', 'lumbar', 'thorax'], [
        ring(-0.625, 0.875, 0.690, 0.060),
        ring(-0.595, 0.910, 0.645, 0.095),
        ring(-0.540, 0.935, 0.610, 0.110),
        ring(-0.450, 0.965, 0.600, 0.118),
        ring(-0.310, 0.964, 0.612, 0.118),
        ring(-0.180, 0.956, 0.600, 0.116),
        ring(-0.020, 0.956, 0.566, 0.124),
        ring(0.160, 0.958, 0.556, 0.118),
        ring(0.300, 0.972, 0.560, 0.118),
        ring(0.420, 0.950, 0.580, 0.110),
        ring(0.490, 0.910, 0.640, 0.085),
        ring(0.540, 0.850, 0.680, 0.050),
    ], { blend: 0.03 });
    for (const [s, t] of SIDES) {
        // The shoulder blade's muscle, along the scapula, flat against the ribs.
        B.blob(`shoulder${t}`, `scap${t}`, [0.088 * s, 0.84, 0.36], [0.04, 0.085, 0.15], { dir: [0.035 * s, -0.25, 0.14], up: [0, 0, 1], blend: 0.03 });
        // The thigh: haunch and ham, from the croup down to the stifle and
        // back to the buttock, hanging along the femur.
        B.blob(`thigh${t}`, `femur${t}`, [0.072 * s, 0.71, -0.47], [0.068, 0.155, 0.19], { dir: [0, -1, 0.25], up: [0, 0, 1], blend: 0.035 });
    }
    B.limb('neck', ['neck1', 'neck2', 'head'], [
        { c: [0, 0.78, 0.40], r: [0.10, 0.17], bone: 'thorax' },
        { c: [0, 0.89, 0.48], r: [0.092, 0.15], bone: [['thorax', 0.5], ['neck1', 0.5]] },
        { c: [0, 1.00, 0.555], r: [0.074, 0.12] },
        { c: [0, 1.10, 0.625], r: [0.062, 0.088] },
        { c: [0, 1.19, 0.67], r: [0.057, 0.074] },
        { c: [0, 1.265, 0.705], r: [0.054, 0.066] },
        { c: [0, 1.30, 0.72], r: [0.050, 0.058], bone: 'head' },
    ], { up: [0, 0, 1], blend: 0.04 });
    head(B);
    B.limb('tail', ['tail1', 'tail2'], [
        { c: [0, 0.865, -0.585], r: [0.035, 0.025], bone: [['pelvis', 0.5], ['tail1', 0.5]] },
        { c: [0, 0.835, -0.645], r: [0.05, 0.026] },
        { c: [0, 0.79, -0.698], r: [0.048, 0.022] },
        { c: [0, 0.74, -0.745], r: [0.028, 0.016] },
    ], { blend: 0.012 });
    legs(B);
    sections(B);
    return B.build();
}

// Head: 0.29 m from poll to nose, a broad wedge from the front: 0.13 m
// across the eyes, the cheeks 0.10 m below and before them, narrowing to a
// muzzle 5 cm across and 6.5 cm deep under a straight top line. Eyes 3 cm
// across where the skull is widest; ears (0.16 m, broad) above them.
function head(B) {
    B.limb('head', ['head'], [
        { c: [0, 1.31, 0.695], r: [0.050, 0.048] },
        { c: [0, 1.305, 0.735], r: [0.060, 0.070] },
        { c: [0, 1.29, 0.785], r: [0.060, 0.066] },
        { c: [0, 1.272, 0.832], r: [0.050, 0.057] },
        { c: [0, 1.246, 0.890], r: [0.037, 0.045] },
        { c: [0, 1.218, 0.946], r: [0.030, 0.035] },
        { c: [0, 1.203, 0.980], r: [0.022, 0.025] },
    ], { blend: 0.02 });
    for (const [s, t] of SIDES) {
        B.blob(`eye${t}`, 'head', [0.060 * s, 1.315, 0.79], [0.012, 0.015, 0.016], { blend: 0.004 });
        B.limb(`ear${t}`, [`ear${t}`], [
            { c: [0.045 * s, 1.33, 0.75], r: [0.020, 0.012] },
            { c: [0.08 * s, 1.358, 0.738], r: [0.036, 0.011] },
            { c: [0.12 * s, 1.39, 0.725], r: [0.036, 0.009] },
            { c: [0.152 * s, 1.42, 0.715], r: [0.012, 0.007] },
        ], { up: [0, 0, 1], blend: 0.008 });
    }
}

// Where form measures the body: square across the trunk, the neck and the
// head, and the legs' sections (legs.js).
function sections(B) {
    const across = (name, bone, at) => B.section(name, { at, normal: [0, 0, 1], bone, radius: 0.35 });
    across('rump', 'pelvis', [0, 0.77, -0.555]);
    across('hip', 'pelvis', [0, 0.77, -0.45]);
    across('flank', 'lumbar', [0, 0.79, -0.31]);
    across('waist', 'lumbar', [0, 0.78, -0.18]);
    across('ribs', 'thorax', [0, 0.76, -0.02]);
    across('girth', 'thorax', [0, 0.757, 0.16]);
    across('shoulder', 'thorax', [0, 0.77, 0.30]);
    const neck = (name, bone, at, dir) => B.section(name, { at, normal: dir, bone, radius: 0.25 });
    neck('neckbase', 'neck1', [0, 0.89, 0.48], [0, 0.73, 0.69]);
    neck('neckmid', 'neck2', [0, 1.10, 0.625], [0, 0.88, 0.47]);
    neck('throat', 'neck2', [0, 1.265, 0.705], [0, 0.9, 0.43]);
    across('eyes', 'head', [0, 1.29, 0.785]);
    across('cheeks', 'head', [0, 1.272, 0.832]);
    legSections(B);
}
