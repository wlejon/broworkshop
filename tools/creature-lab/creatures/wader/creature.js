// The wader: an invented long-legged wading bird of 2 kg, 0.95 m to the
// crown, blue-grey with a white neck and a dagger bill. It walks with the
// head-bob (the head held still in the world while the body passes, then
// thrust ahead), runs when pressed, forages with the neck lowered and
// strikes at the ground, sits on its folded legs, and startles with its
// wings half open. Asked for more than its run it opens its wings, springs
// off and flies on slow deep beats, the neck drawn back and the legs
// trailed behind, and comes down and lands when asked to slow; a log across
// its way it lifts itself over on a few beats. No reference behind it; the
// lab judges it by the finder, form and natural.
//
// The lab's walk, trot and gallop are its walk, a quick walk and a run
// (`speeds`); its gaits report as walk, run and fly.

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
    // `spread`, `half`: the wings held open and half open, to look at them.
    variants: { plan: { LAYERS: 0 }, spread: { WING_SPREAD: 1 }, half: { WING_SPREAD: 0.5 } },
    scenarios: {
        flight: {
            about: 'walks, takes off, climbs and flies, comes down and lands, walks on and stops',
            duration: 12,
            track: [{ t: 0, speed: 0.6 }, { t: 1, speed: 6 }, { t: 6.5, speed: 0.6 }, { t: 11, speed: 0 }],
        },
        leap: {
            about: 'striding at 1.3 m/s, lifts itself on its wings over a 15 cm log in its way, walks on',
            duration: 6,
            ground: { log: { at: [0, 3], yaw: 90, height: 0.15, length: 2 } },
            track: [{ t: 0, speed: 1.3 }],
        },
    },
};
