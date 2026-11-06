// The deer's legs below the trunk: each a tube from inside the body (the
// upper arm and the thigh belong to the trunk's skin, lab body.js) down to a
// cloven hoof, its rings riding the leg's bones.
//
// Sizes are a white-tailed deer's (withers 0.95 m), skin over bone:
//   forearm under the elbow  6.5 cm wide, 9 cm deep (the olecranon behind)
//   carpus                   4.4 x 5.2 cm
//   cannon (fore and hind)   2.7 x 3.5 cm: the slender part, about a third
//                            of the forearm's width
//   fetlock                  3.5 x 4.2 cm, pastern 3.2 x 3.6 cm
//   gaskin under the stifle  7 x 12 cm (the calf muscle behind the tibia)
//   hock                     4.4 x 7 cm, the calcaneus behind
//   hoof                     about 5.5 cm long, 4.5 cm wide, 3.5 cm high
// The leg rings sit on the skeleton's leg lines (skeleton.js), and the top
// of each tube stays inside the trunk at every swing, so no tube end shows.

import { legColor, hoofColor, sstep } from "./coat.js";

// The point at height y on the segment a -> b of a leg line ([y, z] pairs).
function onLine(a, b, y) {
    const t = (a[0] - y) / (a[0] - b[0]);
    return a[1] + (b[1] - a[1]) * t;
}

const named = (s) => (n) => (s > 0 ? n : undefined);

// A leg's skin weights: each ring rides the leg's bones by its centre, and
// toward the top, from rest height `lo` to `hi`, it takes the trunk's own
// weights at each vertex instead. The tube's top then moves exactly as the
// trunk's skin about it does and stays hidden however the leg swings.
function legWeights(S, bones, trunkField, lo, hi) {
    return (p, c) => {
        const t = sstep(lo, hi, c[1]);
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
    // The humerus runs from the point of shoulder (y 0.72, z 0.43) to the elbow (0.52, 0.33).
    const hz = (y) => onLine([0.72, 0.43], [0.52, 0.33], y);
    S.loft([
        { c: [x(0.096), 0.68, hz(0.68)], r: [0.022, 0.045] },
        { c: [x(0.102), 0.61, hz(0.61) - 0.008], r: [0.026, 0.054] },
        { c: [x(0.106), 0.535, 0.328], r: [0.031, 0.046], name: nm('elbow') },
        { c: [x(0.110), 0.47, 0.334], r: [0.032, 0.043], name: nm('forearm') },
        { c: [x(0.110), 0.39, 0.340], r: [0.025, 0.031] },
        { c: [x(0.110), 0.30, 0.344], r: [0.021, 0.025] },
        { c: [x(0.110), 0.27, 0.345], r: [0.022, 0.026], name: nm('carpus') },
        { c: [x(0.110), 0.235, 0.346], r: [0.016, 0.019] },
        { c: [x(0.110), 0.14, 0.351], r: [0.0135, 0.0175] },
        { c: [x(0.110), 0.085, 0.354], r: [0.0175, 0.021], name: nm('ffetlock') },
        { c: [x(0.110), 0.055, 0.368], r: [0.016, 0.018] },
    ], { weights: legWeights(S, [`humerus${t}`, `radius${t}`, `mc${t}`, `fhoof${t}`], trunkField, 0.52, 0.62),
         segs: 16, hint: [0, 0, 1], name: `fore${t}`,
         color: legColor(true), caps: [true, false] });
    hoof(S, x(0.11), 0.355, `mc${t}`, `fhoof${t}`);
}

export function hindLeg(S, s, trunkField) {
    const t = s > 0 ? 'L' : 'R', nm = named(s);
    const x = (v) => v * s;
    // The femur runs from its head (y 0.80, z -0.42) to the stifle (0.56, -0.30),
    // the tibia from there to the hock (0.36, -0.50).
    const fz = (y) => onLine([0.80, -0.42], [0.56, -0.30], y);
    const tz = (y) => onLine([0.56, -0.30], [0.36, -0.50], y);
    S.loft([
        { c: [x(0.093), 0.70, fz(0.70) - 0.01], r: [0.024, 0.055] },
        { c: [x(0.099), 0.62, fz(0.62) - 0.026], r: [0.027, 0.054] },
        { c: [x(0.104), 0.555, tz(0.555) - 0.016], r: [0.034, 0.056], name: nm('stifle') },
        { c: [x(0.105), 0.49, tz(0.49) - 0.014], r: [0.033, 0.054], name: nm('gaskin') },
        { c: [x(0.105), 0.42, tz(0.42) - 0.006], r: [0.025, 0.040] },
        { c: [x(0.105), 0.37, -0.503], r: [0.022, 0.035], name: nm('hock') },
        { c: [x(0.105), 0.32, -0.494], r: [0.016, 0.022] },
        { c: [x(0.105), 0.16, -0.478], r: [0.0135, 0.018] },
        { c: [x(0.105), 0.085, -0.466], r: [0.0175, 0.021], name: nm('hfetlock') },
        { c: [x(0.105), 0.055, -0.452], r: [0.016, 0.018] },
    ], { weights: legWeights(S, [`femur${t}`, `tibia${t}`, `mt${t}`, `hhoof${t}`], trunkField, 0.54, 0.64),
         segs: 16, hint: [0, 0, 1], name: `hind${t}`,
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
