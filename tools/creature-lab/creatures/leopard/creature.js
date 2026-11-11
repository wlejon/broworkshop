// Adult leopard (Panthera pardus): ~56 kg, ~0.64 m shoulder height, ~1.25 m
// head-and-body length plus a ~0.82 m sweeping counterbalance tail.

import { bones, feet, tracks, chartJoints } from "./skeleton.js";
import { body } from "./body.js";
import { scenarios } from "./scenarios.js";

export default {
    name: 'leopard',
    skeleton: { bones, feet, tracks, chartJoints },
    body,
    coat: 'coat.bk',
    face: 'face.bk',
    rig: {
        file: 'rig.bk',
        kernel: 'k_rig',
        modules: {
            'leopard::legs': 'legs.bk',
            'leopard::gait': 'gait.bk',
        },
    },
    scale: { height: 0.68, length: 1.95 },
    space: 2.4,
    speeds: { walk: 1.15, trot: 3.1, gallop: 8.0, circle: 0.95 },
    cycles: {
        walk: {
            scenario: 'walk',
            reference: {
                duty: 0.65,
                offsets: { LH: 0.0, LF: 0.23, RF: 0.73, RH: 0.50 },
                tolerance: { duty: 0.06, offset: 0.06 },
            },
        },
        trot: {
            scenario: 'trot',
            reference: {
                duty: 0.42,
                offsets: { LH: 0.0, LF: 0.50, RF: 0.0, RH: 0.50 },
                tolerance: { duty: 0.06, offset: 0.06 },
            },
        },
        gallop: {
            scenario: 'gallop',
            reference: {
                duty: 0.26,
                offsets: { LH: 0.0, LF: 0.54, RF: 0.43, RH: 0.11 },
                tolerance: { duty: 0.07, offset: 0.07 },
            },
        },
    },
    variants: {
        slip: { FAULT_SLIP: 0.25 },
        sink: { FAULT_SINK: 0.06 },
        overbend: { FAULT_OVERBEND: 2.4 },
        stumble: { FAULT_STUMBLE: 0.18 },
    },
    scenarios,
};
