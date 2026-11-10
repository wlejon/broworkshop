// The courser: an invented running bird of 24 kg on the strider's legs,
// 1.2 m to its crown: a level egg of a body, a slim S of a neck to a small
// head with a hooked bill and a crest of quills, small wings folded on its
// flanks and a long fan of a tail. It walks with a bird's head, thrown
// forward and held at each step, and runs stretched out low. No reference
// behind it; it is given in keys (poses.js: its attitudes drawn, its gaits
// made from a stride's phase) and the lab judges it by watching it.
//
// The lab's walk, trot and gallop are its walk, a jog and a run (`speeds`);
// its gaits report as walk and run.

import { bones, feet, tracks, chartJoints } from "./skeleton.js";
import { body } from "./body.js";
import { poses, cycles } from "./poses.js";

export default {
    name: 'courser',
    skeleton: { bones, feet, tracks, chartJoints },
    body,
    keys: { poses, cycles },
    face: 'face.bk',
    rig: { file: 'rig.bk', kernel: 'k_rig' },
    scale: { height: 1.2, length: 1.25 },
    speeds: { walk: 1.0, trot: 1.8, gallop: 3.0, circle: 0.8 },
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
            about: 'a run-up at 3 m/s, a leap over a 0.4 m log, the run-out',
            duration: 7,
            ground: { log: { at: [0, 9], yaw: 90, height: 0.4, length: 4 } },
            track: [{ t: 0, speed: 3 }, { t: 5.5, speed: 1.5 }],
        },
    },
};
