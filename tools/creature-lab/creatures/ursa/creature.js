// `ursa`: a heavy plantigrade bear (~191 kg, 0.96 m shoulder hump, 1.65 m snout-to-rump)
// with prominent grizzled interscapular hump, cream-gold chest V-crescent, carved
// cupped ears, 5-clawed plantigrade paws, heel-to-paw sole roll, and rotary gallop.

import { bones, feet, tracks, chartJoints } from "./skeleton.js";
import { body } from "./body.js";
import { scenarios } from "./scenarios.js";

export default {
    name: 'ursa',
    skeleton: { bones, feet, tracks, chartJoints },
    body,
    coat: 'coat.bk',
    face: 'face.bk',
    rig: {
        file: 'rig.bk',
        kernel: 'k_rig',
        modules: { 'ursa::gait': 'gait.bk' },
    },
    scale: { height: 0.96, length: 1.65 },
    speeds: { walk: 1.25, trot: 3.0, gallop: 6.8, circle: 1.0 },
    space: 3.2,
    startle: 0.38,
    alarm: 11,
    cycles: {
        walk: {
            scenario: 'walk',
            reference: {
                duty: 0.62,
                offsets: { LH: 0, LF: 0.24, RF: 0.74, RH: 0.50 },
                tolerance: { duty: 0.07, offset: 0.06 },
            },
        },
        trot: {
            scenario: 'trot',
            reference: {
                duty: 0.42,
                offsets: { LH: 0, LF: 0.50, RF: 0.0, RH: 0.50 },
                tolerance: { duty: 0.07, offset: 0.06 },
            },
        },
        gallop: {
            scenario: 'gallop',
            reference: {
                duty: 0.27,
                offsets: { LH: 0, LF: 0.58, RF: 0.46, RH: 0.12 },
                tolerance: { duty: 0.08, offset: 0.07 },
            },
        },
    },
    variants: {
        slip: { FAULT_SLIP: 0.25 },
        sink: { FAULT_SINK: 0.06 },
        overbend: { FAULT_OVERBEND: 2.2 },
        stumble: { FAULT_STUMBLE: 0.18 },
        boulder: { HUMP_ROLL: 1.35, BREAKOVER: 0.48 },
    },
    scenarios,
};
