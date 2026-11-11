// Green spiny iguana (Iguana iguana): ~5.0 kg sprawling-limb arboreal/terrestrial
// herbivorous reptile (~0.27 m dorsal crest height, ~1.35 m snout-to-tail-tip).

import { bones, feet, tracks, chartJoints } from "./skeleton.js";
import { body } from "./body.js";
import { scenarios } from "./scenarios.js";

export default {
    name: 'iguana',
    skeleton: { bones, feet, tracks, chartJoints },
    body,
    coat: 'coat.bk',
    face: 'face.bk',
    rig: {
        file: 'rig.bk',
        kernel: 'k_rig',
        modules: { 'iguana::gait': 'gait.bk' },
    },
    scale: { height: 0.27, length: 1.35 },
    // Deliberate sprawling walk (~0.55 m/s), brisk diagonal trot (~1.6 m/s),
    // and elevated lizard sprint (~4.2 m/s).
    speeds: { walk: 0.55, trot: 1.6, gallop: 4.2, circle: 0.44 },
    // Flock spacing, rapid reptilian startle reflex, and alert radius.
    space: 1.45,
    startle: 0.30,
    alarm: 7.5,
    // Hildebrand footfall references for sprawling walk, diagonal trot, and lizard sprint.
    cycles: {
        walk: {
            scenario: 'walk',
            reference: {
                duty: 0.66,
                offsets: { LH: 0.0, LF: 0.25, RF: 0.75, RH: 0.50 },
                tolerance: { duty: 0.07, offset: 0.06 },
            },
        },
        trot: {
            scenario: 'trot',
            reference: {
                duty: 0.48,
                offsets: { LH: 0.0, LF: 0.50, RF: 0.0, RH: 0.50 },
                tolerance: { duty: 0.07, offset: 0.06 },
            },
        },
        gallop: {
            scenario: 'gallop',
            reference: {
                duty: 0.36,
                offsets: { LH: 0.0, LF: 0.42, RF: 0.54, RH: 0.10 },
                tolerance: { duty: 0.08, offset: 0.07 },
            },
        },
    },
    variants: {
        slip: { FAULT_SLIP: 0.25 },
        sink: { FAULT_SINK: 0.04 },
        overbend: { FAULT_OVERBEND: 2.0 },
        stumble: { FAULT_STUMBLE: 0.18 },
        bask: { LIE_HIP: 0.064, LIE_SHOULDER: 0.086 },
        display: { BOB_AMP: 0.44, DEWLAP_FLARE: 0.78 },
    },
    scenarios,
};
