// The leopard's limbs: thick, powerful grappling forelimbs with heavy triceps,
// stout forearms and wrists, deep spring-loaded thighs and gaskins, and broad,
// round cushioned digitigrade paws with subtle medial/lateral toe-pad lobes.

import { SIDES } from "/app/lab/flesh.js";

const ring = (x, y, zf, zb, hw) => ({ c: [x, y, (zf + zb) / 2], r: [hw, (zf - zb) / 2] });

export function legs(B) {
    for (const [s, t] of SIDES) {
        const x = (v) => v * s;

        // Forelimb: point of shoulder (0.462, 0.372), elbow (0.305, 0.248) with
        // prominent olecranon/triceps, thick muscular forearm, stout wrist (0.122, 0.302).
        B.limb(`fore${t}`, [`humerus${t}`, `radius${t}`, `mc${t}`, `fpaw${t}`], [
            { ...ring(x(0.088), 0.462, 0.420, 0.252, 0.048), bone: `humerus${t}` },
            ring(x(0.095), 0.392, 0.390, 0.222, 0.050),
            ring(x(0.098), 0.320, 0.340, 0.200, 0.046),
            ring(x(0.098), 0.272, 0.326, 0.222, 0.042),
            ring(x(0.098), 0.216, 0.334, 0.248, 0.038),
            ring(x(0.098), 0.162, 0.336, 0.266, 0.033),
            ring(x(0.098), 0.122, 0.336, 0.272, 0.030),
            { c: [x(0.098), 0.080, 0.318], r: [0.028, 0.029] },
            { c: [x(0.098), 0.044, 0.336], r: [0.032, 0.032] },
        ], { up: [0, 0, 1], blend: 0.024 });

        forePaw(B, t, x, 0.098, 0.335);

        // Hindlimb: stifle (0.365, -0.268) under deep haunch, muscular gaskin
        // tapering to calcaneal hock (0.182, -0.448), sturdy plush metatarsus.
        B.limb(`hind${t}`, [`femur${t}`, `tibia${t}`, `mt${t}`, `hpaw${t}`], [
            { ...ring(x(0.088), 0.420, -0.235, -0.425, 0.046), bone: `femur${t}` },
            ring(x(0.094), 0.360, -0.225, -0.410, 0.046),
            ring(x(0.096), 0.295, -0.290, -0.434, 0.041),
            ring(x(0.096), 0.232, -0.362, -0.464, 0.033),
            { c: [x(0.096), 0.182, -0.445], r: [0.027, 0.038] },
            { c: [x(0.096), 0.134, -0.430], r: [0.025, 0.029] },
            { c: [x(0.096), 0.080, -0.415], r: [0.025, 0.028] },
            { c: [x(0.096), 0.042, -0.402], r: [0.028, 0.030] },
        ], { up: [0, 0, 1], blend: 0.024 });

        hindPaw(B, t, x, 0.096, -0.405);
    }
}

// Broad, round cushioned feline forepaw (~8.4 cm wide) with lateral/medial
// digital toe-pad lobes so the silhouette reads unmistakably as a big cat paw.
function forePaw(B, t, x, cx, z0) {
    B.limb(`fpaw${t}`, [`mc${t}`, `fpaw${t}`], [
        { c: [x(cx), 0.040, z0 + 0.008], r: [0.033, 0.022], bone: `mc${t}` },
        { c: [x(cx), 0.024, z0 + 0.038], r: [0.040, 0.021], bone: `fpaw${t}` },
        { c: [x(cx), 0.019, z0 + 0.062], r: [0.037, 0.018], bone: `fpaw${t}` },
    ], { up: [0, 1, 0], blend: 0.009, steps: 2, keep: 0.006 });
    B.blob(`ftoeIn${t}`, `fpaw${t}`, [x(cx - 0.022), 0.018, z0 + 0.056], [0.014, 0.015, 0.024], { blend: 0.007 });
    B.blob(`ftoeOut${t}`, `fpaw${t}`, [x(cx + 0.022), 0.018, z0 + 0.054], [0.014, 0.015, 0.024], { blend: 0.007 });
}

// Slightly narrower oval cushioned feline hindpaw (~7.0 cm wide).
function hindPaw(B, t, x, cx, z0) {
    B.limb(`hpaw${t}`, [`mt${t}`, `hpaw${t}`], [
        { c: [x(cx), 0.038, z0 + 0.008], r: [0.029, 0.021], bone: `mt${t}` },
        { c: [x(cx), 0.023, z0 + 0.038], r: [0.034, 0.020], bone: `hpaw${t}` },
        { c: [x(cx), 0.018, z0 + 0.060], r: [0.031, 0.017], bone: `hpaw${t}` },
    ], { up: [0, 1, 0], blend: 0.009, steps: 2, keep: 0.006 });
    B.blob(`htoeIn${t}`, `hpaw${t}`, [x(cx - 0.018), 0.017, z0 + 0.054], [0.012, 0.014, 0.022], { blend: 0.007 });
    B.blob(`htoeOut${t}`, `hpaw${t}`, [x(cx + 0.018), 0.017, z0 + 0.052], [0.012, 0.014, 0.022], { blend: 0.007 });
}

export function legSections(B) {
    const flat = (name, bone, at) => B.section(name, { at, normal: [0, 1, 0], bone, radius: 0.16 });
    flat('arm', 'humerusL', [0.096, 0.380, 0.312]);
    flat('elbow', ['humerusL', 'radiusL'], [0.098, 0.315, 0.282]);
    flat('forearm', 'radiusL', [0.098, 0.225, 0.296]);
    flat('wrist', ['radiusL', 'mcL'], [0.098, 0.125, 0.305]);
    flat('stifle', ['femurL', 'tibiaL'], [0.094, 0.365, -0.325]);
    flat('gaskin', 'tibiaL', [0.096, 0.295, -0.365]);
    flat('hock', ['tibiaL', 'mtL'], [0.096, 0.185, -0.442]);
}
