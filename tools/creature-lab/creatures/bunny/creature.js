// The bunny: a wild rabbit of 1.6 kg, the lab's second quadruped and its
// first small one. It hops rather than walks (the fore feet one after the
// other, then the hind pair together), runs in a half-bound, sits up on its
// haunches when alert, loafs lying down. No reference behind it; the lab
// judges it by the finder, form and natural.
//
// The lab's walk, trot and gallop are its slow hop, a quick bound and a run
// (`speeds`); its gaits report as hop and bound.

import { bones, feet, tracks, chartJoints } from "./skeleton.js";
import { body } from "./body.js";
import { scenarios } from "./scenarios.js";
import { motion } from "./motion.js";

export default {
    name: 'bunny',
    skeleton: { bones, feet, tracks, chartJoints },
    body,
    coat: 'coat.bk',
    face: 'face.bk',
    rig: { file: 'rig.bk', kernel: 'k_rig', modules: { 'bunny::legs': 'legs.bk', 'bunny::stride': 'stride.bk', 'bunny::act': 'act.bk' } },
    scale: { height: 0.2, length: 0.42 },
    speeds: { walk: 0.5, trot: 1.8, gallop: 4.5, circle: 0.4 },
    // m kept between neighbours in a flock.
    space: 0.6,
    cycles: {
        hop: { scenario: 'walk' },
        bound: { scenario: 'trot' },
        run: { scenario: 'gallop' },
    },
    form: { reference: {} },
    // Its own motion oracle (flights, the trunk's stretch and gather, the
    // head's carriage, the hind feet landing ahead): motion.js.
    motion,
    scenarios,
};
