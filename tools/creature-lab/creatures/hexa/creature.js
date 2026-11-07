// The hexa: an invented six-legged grazer with a long tail and a heavy
// head, on its own skeleton and rig, its body masses blended into one skin.
// No reference behind it, so the lab judges it by the finder, form and
// natural alone.

import { bones, feet, tracks, chartJoints } from "./skeleton.js";
import { body } from "./body.js";

export default {
    name: 'hexa',
    skeleton: { bones, feet, tracks, chartJoints },
    body,
    rig: { file: 'rig.bk', kernel: 'k_rig' },
    scale: { height: 0.85, length: 4.2 },
    cycles: {
        walk: { scenario: 'walk' },
    },
    form: { reference: {} },
    variants: {},
    scenarios: {},
};
