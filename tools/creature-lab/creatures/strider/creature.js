// The strider: an invented upright biped of 38 kg, 1.3 m tall, with long
// arms that swing as it goes. It walks heel to toe and runs with a flight
// between steps; foraging it crouches and picks at the ground, resting it
// squats on its heels. No reference behind it; the lab judges it by the
// finder, form and natural.
//
// The lab's walk, trot and gallop are its walk, a jog and a run (`speeds`);
// its gaits report as walk and run.

import { bones, feet, tracks, chartJoints } from "./skeleton.js";
import { body } from "./body.js";

export default {
    name: 'strider',
    skeleton: { bones, feet, tracks, chartJoints },
    body,
    face: 'face.bk',
    rig: { file: 'rig.bk', kernel: 'k_rig' },
    scale: { height: 1.3, length: 0.45 },
    speeds: { walk: 1.1, trot: 2.0, gallop: 3.0, circle: 0.8 },
    space: 1.2,
    cycles: {
        walk: { scenario: 'walk' },
        jog: { scenario: 'trot' },
        run: { scenario: 'gallop' },
    },
    form: { reference: {} },
    // `plan`: the motion layers off, the rig's plan as it draws it.
    variants: { plan: { LAYERS: 0 } },
    scenarios: {},
};
