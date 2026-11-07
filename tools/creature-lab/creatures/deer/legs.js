// The deer's legs: each a limb from inside the trunk down to a cloven hoof,
// blending into the trunk, the shoulder blade and the thigh (body.js) at its
// top. The fore leg carries the upper arm and the triceps down to the
// forearm; the hind leg starts at the stifle under the thigh and carries the
// gaskin, its back line running straight down the Achilles to the hock.
//
// Sizes are a white-tailed deer's (withers 0.95 m), skin over bone and
// muscle, measured as proportions off side and front photographs of does
// and young bucks standing square (depth front to back, width side to side):
//   thigh at the stifle's height   8 cm wide, 19 cm deep (girth 0.45 m)
//   gaskin under the stifle        7.4 cm wide, 11 cm deep (girth 0.32 m)
//   hock                           4.4 x 7 cm, the calcaneus behind
//   upper arm above the elbow      9 cm wide, 16 cm deep with the triceps
//                                  behind (girth 0.42 m)
//   forearm under the elbow        7.2 cm wide, 9.6 cm deep (girth 0.27 m),
//                                  tapering to 4.4 x 5.2 cm at the carpus
//   cannon (fore and hind)         2.7 x 3.5 cm: about a third of the forearm
//   fetlock                        3.5 x 4.2 cm, pastern 3.2 x 3.6 cm
//   hoof                           about 5.5 cm long, 4.5 cm wide, 3.5 cm high
// A ring is given by its height, the skin's front and back (z) at that
// height and its half width, so the outline the photographs give is the
// outline written.

import { SIDES } from "/app/lab/flesh.js";

// A ring at height y from its front and back z, its half width hw and its centre's x.
const ring = (x, y, zf, zb, hw) => ({ c: [x, y, (zf + zb) / 2], r: [hw, (zf - zb) / 2] });

export function legs(B) {
    for (const [s, t] of SIDES) {
        const x = (v) => v * s;
        // The point of shoulder is at (y 0.72, z 0.45), the elbow joint at
        // (0.52, 0.33) with the olecranon behind it, the carpus at 0.27.
        B.limb(`fore${t}`, [`humerus${t}`, `radius${t}`, `mc${t}`, `fhoof${t}`], [
            { ...ring(x(0.090), 0.70, 0.445, 0.285, 0.040), bone: `humerus${t}` },
            ring(x(0.104), 0.64, 0.445, 0.250, 0.050),
            ring(x(0.108), 0.575, 0.410, 0.245, 0.046),
            ring(x(0.110), 0.515, 0.378, 0.268, 0.039),
            ring(x(0.110), 0.46, 0.379, 0.283, 0.036),
            ring(x(0.110), 0.385, 0.373, 0.309, 0.027),
            ring(x(0.110), 0.30, 0.369, 0.319, 0.021),
            ring(x(0.110), 0.27, 0.371, 0.319, 0.022),
            { c: [x(0.110), 0.235, 0.346], r: [0.016, 0.019] },
            { c: [x(0.110), 0.14, 0.351], r: [0.0135, 0.0175] },
            { c: [x(0.110), 0.085, 0.354], r: [0.0175, 0.021] },
            { c: [x(0.110), 0.055, 0.368], r: [0.016, 0.018] },
        ], { up: [0, 0, 1], blend: 0.025 });
        hoof(B, `fhoof${t}`, x(0.11), 0.355, [`mc${t}`, `fhoof${t}`]);
        // The femur runs from its head (y 0.80, z -0.42) to the stifle (0.56,
        // -0.30), the tibia from there to the hock (0.36, -0.50).
        B.limb(`hind${t}`, [`femur${t}`, `tibia${t}`, `mt${t}`, `hhoof${t}`], [
            { ...ring(x(0.084), 0.62, -0.33, -0.48, 0.034), bone: `femur${t}` },
            ring(x(0.096), 0.55, -0.272, -0.465, 0.041),
            ring(x(0.104), 0.49, -0.342, -0.480, 0.037),
            ring(x(0.105), 0.43, -0.410, -0.515, 0.028),
            { c: [x(0.105), 0.37, -0.503], r: [0.022, 0.035] },
            { c: [x(0.105), 0.32, -0.494], r: [0.016, 0.022] },
            { c: [x(0.105), 0.16, -0.478], r: [0.0135, 0.018] },
            { c: [x(0.105), 0.085, -0.466], r: [0.0175, 0.021] },
            { c: [x(0.105), 0.055, -0.452], r: [0.016, 0.018] },
        ], { up: [0, 0, 1], blend: 0.025 });
        hoof(B, `hhoof${t}`, x(0.105), -0.465, [`mt${t}`, `hhoof${t}`]);
    }
}

// A cloven hoof: a dark wedge from the pastern, its sole on the ground.
function hoof(B, name, x, z, bones) {
    B.limb(name, bones, [
        { c: [x, 0.058, z + 0.012], r: [0.016, 0.018] },
        { c: [x, 0.036, z + 0.030], r: [0.020, 0.024] },
        { c: [x, 0.022, z + 0.044], r: [0.021, 0.025] },
    ], { up: [0, 0, 1], blend: 0.006, steps: 2 });
}

// Where form measures the legs, on the left: square across each, a joint's
// section halfway between its two bones as they bend.
export function legSections(B) {
    const flat = (name, bone, at) => B.section(name, { at, normal: [0, 1, 0], bone, radius: 0.15 });
    flat('arm', 'humerusL', [0.108, 0.575, 0.3275]);
    flat('elbow', ['humerusL', 'radiusL'], [0.110, 0.515, 0.323]);
    flat('forearm', 'radiusL', [0.110, 0.46, 0.331]);
    flat('carpus', ['radiusL', 'mcL'], [0.110, 0.27, 0.345]);
    flat('ffetlock', ['mcL', 'fhoofL'], [0.110, 0.08, 0.354]);
    flat('stifle', ['femurL', 'tibiaL'], [0.096, 0.55, -0.3685]);
    flat('gaskin', 'tibiaL', [0.104, 0.49, -0.411]);
    flat('hock', ['tibiaL', 'mtL'], [0.105, 0.37, -0.503]);
    flat('hfetlock', ['mtL', 'hhoofL'], [0.105, 0.08, -0.466]);
}
