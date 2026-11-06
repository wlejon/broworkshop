// The deer's legs: each a tube from inside the trunk down to a cloven hoof,
// its rings riding the leg's bones. The thigh itself is the trunk's skin
// (body.js: the hindquarters' section hangs in two lobes down to 0.52 m, the
// femur's), so the haunch and the ham are one surface; the hind leg's tube
// starts inside that lobe at the stifle and carries the gaskin. The fore
// leg's tube carries the upper arm and the triceps down to the forearm. Each
// tube starts narrow inside the trunk and swells out through the trunk's
// lower side at a shallow angle, so the muscle reads below and beside the
// body without a hard edge where the two surfaces meet, and tapers to the
// slender cannon.
//
// Sizes are a white-tailed deer's (withers 0.95 m), skin over bone and
// muscle, measured as proportions off side and front photographs of does
// and young bucks standing square (depth front to back, width side to side):
//   haunches and thighs            27.5 cm across at the hip; the hams hang to
//                                  0.52 m, 4 cm under the stifle, their back
//                                  line running on from the buttock
//   thigh at the stifle's height,  8 cm wide, 19 cm deep from the patella to
//     below the lobes              the hamstrings' lower edge (girth 0.45 m)
//   gaskin under the stifle        7.4 cm wide, 11 cm deep, the calf muscles
//                                  behind the tibia (girth 0.32 m); from there
//                                  the Achilles runs straight to the hock
//   hock                           4.4 x 7 cm, the calcaneus behind
//   upper arm at the elbow's       9 cm wide, 16 cm deep with the triceps
//     height above it              behind (girth 0.42 m), the arm's mass
//                                  standing proud of the chest wall by 2 cm
//   forearm under the elbow        7.2 cm wide, 9.6 cm deep (girth 0.27 m),
//                                  tapering to 4.4 x 5.2 cm at the carpus
//   cannon (fore and hind)         2.7 x 3.5 cm: about a third of the forearm
//   fetlock                        3.5 x 4.2 cm, pastern 3.2 x 3.6 cm
//   hoof                           about 5.5 cm long, 4.5 cm wide, 3.5 cm high
// A ring is given by its height, the skin's front and back (z) at that
// height and its half width, so the outline the photographs give is the
// outline written.

import { legColor, hoofColor, sstep } from "./coat.js";

const named = (s) => (n) => (s > 0 ? n : undefined);

// A ring at height y from its front and back z, its half width hw and its
// centre's x.
const ring = (x, y, zf, zb, hw, name) => ({ c: [x, y, (zf + zb) / 2], r: [hw, (zf - zb) / 2], name });

// A leg's skin weights: each ring rides the leg's bones by its centre, and
// toward the top, from rest height `lo` to `hi`, it takes the trunk's own
// weights at each vertex instead. The tube's top then moves exactly as the
// trunk's skin about it does and stays hidden however the leg swings.
// `back(p)` (optional) gives a vertex a share of the trunk's weights of its
// own: the hamstrings, which run from the pelvis to the tibia, so the back
// of the thigh stretches between them instead of swinging out with the femur.
function legWeights(S, bones, trunkField, lo, hi, back = null) {
    return (p, c) => {
        const t = Math.max(sstep(lo, hi, c[1]), back ? back(p) : 0);
        const sum = new Map();
        const add = (list, k) => { for (const [b, w] of list) sum.set(b, (sum.get(b) || 0) + k * w); };
        add(S.distanceWeights(c, bones), 1 - t);
        if (t > 0) add(trunkField(p), t);
        return [...sum];
    };
}

export function frontLeg(S, s, trunkField) {
    const t = s > 0 ? 'L' : 'R', nm = named(s);
    const x = (v) => v * s;
    // The point of shoulder is at (y 0.72, z 0.45), the elbow joint at
    // (0.52, 0.33) with the olecranon behind it, the carpus at 0.27.
    S.loft([
        ring(x(0.094), 0.72, 0.465, 0.275, 0.045),
        ring(x(0.104), 0.64, 0.445, 0.250, 0.050),
        ring(x(0.108), 0.575, 0.410, 0.245, 0.046, nm('arm')),
        ring(x(0.110), 0.515, 0.378, 0.268, 0.039, nm('elbow')),
        ring(x(0.110), 0.46, 0.379, 0.283, 0.036, nm('forearm')),
        ring(x(0.110), 0.385, 0.373, 0.309, 0.027),
        ring(x(0.110), 0.30, 0.369, 0.319, 0.021),
        ring(x(0.110), 0.27, 0.371, 0.319, 0.022, nm('carpus')),
        { c: [x(0.110), 0.235, 0.346], r: [0.016, 0.019] },
        { c: [x(0.110), 0.14, 0.351], r: [0.0135, 0.0175] },
        { c: [x(0.110), 0.085, 0.354], r: [0.0175, 0.021], name: nm('ffetlock') },
        { c: [x(0.110), 0.055, 0.368], r: [0.016, 0.018] },
    ], { weights: legWeights(S, [`humerus${t}`, `radius${t}`, `mc${t}`, `fhoof${t}`], trunkField, 0.50, 0.60),
         segs: 18, hint: [0, 0, 1], name: `fore${t}`,
         color: legColor(true), caps: [true, false] });
    hoof(S, x(0.11), 0.355, `mc${t}`, `fhoof${t}`);
}

// The back of the thigh: behind the femur (z under -0.40) and above the
// gaskin, the skin goes with the trunk (the pelvis, through its field).
// The share grows up the whole thigh, so a swinging leg shears that skin
// along the line from the buttock to the gaskin, as the muscles run.
const hamstrings = (p) => sstep(0.44, 0.74, p[1]) * sstep(-0.40, -0.50, p[2]);

export function hindLeg(S, s, trunkField) {
    const t = s > 0 ? 'L' : 'R', nm = named(s);
    const x = (v) => v * s;
    // The femur runs from its head (y 0.80, z -0.42) to the stifle (0.56,
    // -0.30), the tibia from there to the hock (0.36, -0.50). The back line
    // runs on from the buttock (z -0.64) down the hamstrings to the gaskin,
    // then straight down the Achilles to the point of the hock.
    S.loft([
        ring(x(0.082), 0.635, -0.35, -0.46, 0.028),
        ring(x(0.096), 0.55, -0.272, -0.465, 0.041, nm('stifle')),
        ring(x(0.104), 0.49, -0.342, -0.480, 0.037, nm('gaskin')),
        ring(x(0.105), 0.43, -0.410, -0.515, 0.028),
        { c: [x(0.105), 0.37, -0.503], r: [0.022, 0.035], name: nm('hock') },
        { c: [x(0.105), 0.32, -0.494], r: [0.016, 0.022] },
        { c: [x(0.105), 0.16, -0.478], r: [0.0135, 0.018] },
        { c: [x(0.105), 0.085, -0.466], r: [0.0175, 0.021], name: nm('hfetlock') },
        { c: [x(0.105), 0.055, -0.452], r: [0.016, 0.018] },
    ], { weights: legWeights(S, [`femur${t}`, `tibia${t}`, `mt${t}`, `hhoof${t}`], trunkField, 0.47, 0.55, hamstrings),
         segs: 18, hint: [0, 0, 1], name: `hind${t}`,
         color: legColor(false), caps: [true, false] });
    hoof(S, x(0.105), -0.465, `mt${t}`, `hhoof${t}`);
}

// A cloven hoof: pastern into a dark wedge whose sole sits on the ground.
function hoof(S, x, z, upper, bone) {
    S.loft([
        { c: [x, 0.06, z + 0.012], r: [0.017, 0.019] },
        { c: [x, 0.035, z + 0.03], r: [0.021, 0.025] },
        { c: [x, 0.015, z + 0.045], r: [0.022, 0.027] },
        { c: [x, 0.004, z + 0.055], r: [0.018, 0.022] },
    ], { bones: [upper, bone], segs: 14, hint: [0, 0, 1], steps: 2, color: hoofColor });
}
