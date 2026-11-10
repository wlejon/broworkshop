// The human: a person of 70 kg, 1.75 m to the crown, in a tunic, trousers
// and boots. It walks heel first, the foot rolling from the heel onto its
// sole and off its toes, the hips and the shoulders turning against each
// other and the arms swinging whole from the shoulders against the legs;
// it runs leaning in, landing under itself, the elbows bent and driven. No
// reference behind it; it is given in keys (poses.js: its attitudes drawn,
// its gaits made from a stride's phase) and the lab judges it by watching
// it.
//
// The lab's walk, trot and gallop are its walk, a jog and a run
// (`speeds`); its gaits report as walk and run.

import { bones, feet, tracks, chartJoints } from "./skeleton.js";
import { body } from "./body.js";
import { poses, cycles, soft } from "./poses.js";

export default {
    name: 'human',
    skeleton: { bones, feet, tracks, chartJoints },
    body,
    keys: { poses, cycles, soft },
    face: 'face.bk',
    rig: { file: 'rig.bk', kernel: 'k_rig' },
    scale: { height: 1.75, length: 0.5 },
    speeds: { walk: 1.35, trot: 2.4, gallop: 4.0, circle: 1.0 },
    space: 1.4,
    cycles: {
        walk: { scenario: 'walk' },
        jog: { scenario: 'trot' },
        run: { scenario: 'gallop' },
    },
    form: { reference: {} },
    // `plan`: the motion layers off, the keys as the rig stands them.
    variants: { plan: { LAYERS: 0 } },
    scenarios: {
        leap: {
            about: 'a run-up at 4 m/s, a leap over a 0.4 m log, the run-out',
            duration: 7,
            ground: { log: { at: [0, 12], yaw: 90, height: 0.4, length: 4 } },
            track: [{ t: 0, speed: 4 }, { t: 5.5, speed: 1.5 }],
        },
    },
};
