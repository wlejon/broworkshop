// The hexa: an invented six-legged browser of the open plain, slender and
// long-backed on three pairs of long legs, with an arched neck, lyre horns
// and a tufted tail; on its own skeleton and rig, its body masses blended
// into one skin. No reference behind it, so the lab judges it by watching
// it (watch), the finder, form and natural.

import { bones, feet, tracks, chartJoints } from "./skeleton.js";
import { body } from "./body.js";

export default {
    name: 'hexa',
    skeleton: { bones, feet, tracks, chartJoints },
    body,
    rig: { file: 'rig.bk', kernel: 'k_rig' },
    scale: { height: 1.5, length: 2.6 },
    speeds: { walk: 1.2, trot: 1.9, gallop: 2.6, circle: 1.0 },
    cycles: {
        walk: { scenario: 'walk' },
    },
    form: { reference: {} },
    // `plan`: the motion layers off, the rig's plan as it draws it.
    variants: { plan: { LAYERS: 0 } },
    scenarios: {
        leap: {
            about: 'trotting at 1.9 m/s, a leap over a 0.2 m log, trotting on',
            duration: 6,
            ground: { log: { at: [0, 5], yaw: 90, height: 0.2, length: 3 } },
            track: [{ t: 0, speed: 1.9 }],
        },
    },
};
