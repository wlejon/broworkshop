// The leopard's sculpted anatomy (Panthera pardus, ~56 kg, ~0.65 m shoulder
// height): deep muscular ribcage and prominent scapular blades tapering into a
// lithe, athletic tucked abdomen and rounded muscular hindquarters; thick
// cervical musculature; broad feline skull with wide zygomatic arches, short
// deep muzzle with plump whisker pads and firm chin, rounded cupped ears with
// carved inner pinna hollows; and a plush ~0.82 m sweeping S-tip tail.

import { Flesh, SIDES } from "/app/lab/flesh.js";
import { coat } from "./coat.js";
import { legs, legSections } from "./legs.js";

const ring = (z, top, bottom, hw) => ({ c: [0, (top + bottom) / 2, z], r: [hw, (top - bottom) / 2] });

export function body(skel, detail = {}) {
    const B = new Flesh(skel, { color: coat, triangles: 18000, ...detail });

    // Lithe feline trunk: rounded croup flowing into the tail root, taut lumbar
    // waist tuck, and deep muscular chest/prosternum between the forelimbs.
    B.limb('trunk', ['pelvis', 'lumbar', 'thorax'], [
        ring(-0.515, 0.610, 0.495, 0.056),
        ring(-0.470, 0.640, 0.455, 0.092),
        ring(-0.395, 0.652, 0.425, 0.112),
        ring(-0.285, 0.646, 0.422, 0.110),
        ring(-0.165, 0.640, 0.426, 0.104),
        ring(-0.030, 0.642, 0.402, 0.114),
        ring(0.115, 0.646, 0.376, 0.122),
        ring(0.255, 0.654, 0.366, 0.120),
        ring(0.365, 0.642, 0.382, 0.108),
        ring(0.435, 0.612, 0.420, 0.084),
        ring(0.475, 0.580, 0.458, 0.056),
    ], { blend: 0.030 });

    for (const [s, t] of SIDES) {
        // Prominent feline shoulder blade (supraspinatus/infraspinatus/deltoid)
        // riding proud along the sloped scapula so each blade rolls visibly in prowl.
        B.blob(`shoulder${t}`, `scap${t}`, [0.088 * s, 0.555, 0.300], [0.046, 0.092, 0.135], {
            dir: [0.030 * s, -0.170, 0.125], up: [0, 1, 0], blend: 0.030,
        });
        // Deep muscular feline haunch and hamstring mass along the femur.
        B.blob(`thigh${t}`, `femur${t}`, [0.078 * s, 0.485, -0.355], [0.064, 0.138, 0.165], {
            dir: [0.010 * s, -0.180, 0.110], up: [0, 0, 1], blend: 0.034,
        });
    }

    // Thick, powerful pantherine neck emerging forward and slightly up from the chest.
    B.limb('neck', ['neck1', 'neck2', 'head'], [
        { c: [0, 0.535, 0.395], r: [0.095, 0.118], bone: [['thorax', 0.45], ['neck1', 0.55]] },
        { c: [0, 0.568, 0.460], r: [0.088, 0.106], bone: 'neck1' },
        { c: [0, 0.606, 0.525], r: [0.080, 0.094] },
        { c: [0, 0.638, 0.575], r: [0.075, 0.084] },
        { c: [0, 0.654, 0.605], r: [0.072, 0.078], bone: 'head' },
    ], { up: [0, 1, 0], blend: 0.036 });

    head(B);

    // Long, plush, cylindrical-tapering leopard tail (~5.2-5.8 cm thick)
    // hanging in a graceful downward sweep and curling up into an S-tip.
    B.limb('tail', ['tail1', 'tail2', 'tail3', 'tail4'], [
        { c: [0, 0.592, -0.495], r: [0.038, 0.036], bone: [['pelvis', 0.45], ['tail1', 0.55]] },
        { c: [0, 0.526, -0.582], r: [0.031, 0.030], bone: 'tail1' },
        { c: [0, 0.460, -0.668], r: [0.029, 0.029] },
        { c: [0, 0.390, -0.752], r: [0.028, 0.028] },
        { c: [0, 0.325, -0.835], r: [0.027, 0.027] },
        { c: [0, 0.282, -0.928], r: [0.026, 0.026] },
        { c: [0, 0.258, -1.018], r: [0.025, 0.025] },
        { c: [0, 0.278, -1.105], r: [0.024, 0.024] },
        { c: [0, 0.308, -1.188], r: [0.020, 0.020], bone: 'tail4' },
    ], { blend: 0.016 });

    legs(B);
    sections(B);
    return B.build();
}

function head(B) {
    // Broad domed feline cranium narrowing into a distinct supraorbital stop,
    // wide nasal bridge, and short deep pantherine muzzle.
    B.limb('head', ['head'], [
        { c: [0, 0.654, 0.585], r: [0.065, 0.060] },
        { c: [0, 0.658, 0.628], r: [0.068, 0.063] },
        { c: [0, 0.652, 0.660], r: [0.052, 0.056] },
        { c: [0, 0.640, 0.692], r: [0.036, 0.044] },
        { c: [0, 0.630, 0.728], r: [0.034, 0.039] },
        { c: [0, 0.622, 0.756], r: [0.027, 0.029] },
    ], { blend: 0.014 });

    // Firm feline chin & lower jaw symphysis tucked cleanly beneath the upper lip.
    B.blob('chin', 'head', [0, 0.602, 0.718], [0.025, 0.014, 0.032], {
        dir: [0, -0.14, 1], up: [0, 1, 0], blend: 0.010, keep: 0.005,
    });

    // Broad triangular feline nose leather pad at the tip of the muzzle.
    B.blob('nose', 'head', [0, 0.631, 0.758], [0.019, 0.014, 0.014], { blend: 0.004, keep: true });

    for (const [s, t] of SIDES) {
        // Supraorbital feline brow ridge overhanging the upper orbit.
        B.blob(`brow${t}`, 'head', [0.036 * s, 0.673, 0.676], [0.018, 0.008, 0.020], {
            dir: [0.35 * s, 0.14, 0.92], up: [0, 1, 0], blend: 0.009,
        });
        // Powerful zygomatic arch / masseter cheek ruff below the orbit.
        B.blob(`cheek${t}`, 'head', [0.053 * s, 0.626, 0.642], [0.026, 0.034, 0.040], {
            dir: [0.20 * s, -0.12, 1], up: [0, 1, 0], blend: 0.016,
        });
        // Plump, rounded feline whisker pad framing the upper lip on each side.
        B.blob(`muzzle${t}`, 'head', [0.025 * s, 0.618, 0.735], [0.021, 0.019, 0.028], {
            dir: [0.16 * s, -0.08, 1], up: [0, 1, 0], blend: 0.009, keep: 0.005,
        });
        // Bold forward-facing binocular feline eyeball standing proud in the
        // narrowed orbital stop (angled ~33 deg outward from straight ahead).
        B.blob(`eye${t}`, 'head', [0.036 * s, 0.655, 0.680], [0.0165, 0.0155, 0.0195], {
            dir: [0.54 * s, 0.02, 0.84], up: [0, 1, 0], blend: 0.0025, keep: true,
        });
        // Short, wide, semicircular rounded panther ear pinna (topping ~0.758 m).
        B.limb(`ear${t}`, [`ear${t}`], [
            { c: [0.054 * s, 0.704, 0.606], r: [0.030, 0.015], bone: `ear${t}` },
            { c: [0.074 * s, 0.725, 0.602], r: [0.034, 0.014], bone: `ear${t}` },
            { c: [0.090 * s, 0.741, 0.599], r: [0.029, 0.012], bone: `ear${t}` },
            { c: [0.098 * s, 0.749, 0.598], r: [0.021, 0.010], bone: `ear${t}` },
        ], { up: [0, 0, 1], blend: 0.008, soft: 1.8, keep: 0.005 });
        // Cupped anterior pinna hollow carved into the front of the rounded ear,
        // leaving a thick dorsal back wall for the black-and-white ear ocellus.
        B.limb(`earHollow${t}`, [`ear${t}`], [
            { c: [0.072 * s, 0.723, 0.611], r: [0.019, 0.0065], bone: `ear${t}` },
            { c: [0.086 * s, 0.737, 0.608], r: [0.016, 0.0058], bone: `ear${t}` },
            { c: [0.093 * s, 0.744, 0.606], r: [0.011, 0.0045], bone: `ear${t}` },
        ], { up: [0, 0, 1], carve: true, blend: 0.005, soft: 1.15, keep: 0.005 });
    }
}

function sections(B) {
    const across = (name, bone, at) => B.section(name, { at, normal: [0, 0, 1], bone, radius: 0.32 });
    across('rump', 'pelvis', [0, 0.54, -0.455]);
    across('hip', 'pelvis', [0, 0.53, -0.370]);
    across('waist', 'lumbar', [0, 0.53, -0.165]);
    across('ribs', 'thorax', [0, 0.52, -0.020]);
    across('girth', 'thorax', [0, 0.51, 0.145]);
    across('shoulder', 'thorax', [0, 0.52, 0.275]);
    B.section('neckmid', { at: [0, 0.606, 0.525], normal: [0, 0.55, 0.83], bone: 'neck2', radius: 0.22 });
    across('cheeks', 'head', [0, 0.648, 0.638]);
    across('muzzle', 'head', [0, 0.624, 0.730]);
    legSections(B);
}
