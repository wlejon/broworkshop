// The wader: an invented long-legged wading bird of 2 kg, 0.95 m to the
// crown, blue-grey with a white neck and a dagger bill. It walks with the
// head-bob (the head held still in the world while the body passes, then
// thrust ahead), runs when pressed, forages with the neck lowered and
// strikes at the ground, sits on its folded legs, and startles with its
// wings half open. No reference behind it; the lab judges it by the
// finder, form and natural.
//
// The lab's walk, trot and gallop are its walk, a quick walk and a run
// (`speeds`); its gaits report as walk and run.

import { bones, feet, tracks, chartJoints } from "./skeleton.js";
import { body } from "./body.js";

export default {
    name: 'wader',
    skeleton: { bones, feet, tracks, chartJoints },
    body,
    face: 'face.bk',
    rig: { file: 'rig.bk', kernel: 'k_rig' },
    scale: { height: 0.95, length: 0.66 },
    speeds: { walk: 0.6, trot: 1.3, gallop: 2.6, circle: 0.5 },
    space: 1.0,
    cycles: {
        walk: { scenario: 'walk' },
        stride: { scenario: 'trot' },
        run: { scenario: 'gallop' },
    },
    form: { reference: {} },
    // `plan`: the motion layers off, the rig's plan as it draws it.
    variants: { plan: { LAYERS: 0 } },
    scenarios: {},
};
