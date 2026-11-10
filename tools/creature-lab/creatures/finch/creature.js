// The finch: an invented small songbird of 24 g, 14 cm from the bill to the
// tail's tip, brown with a chestnut cap, a grey cheek and a buff breast.
// It hops with both feet together and a flight between hops, glances about
// in quick turns of the head, pecks at the ground, settles onto its belly
// to rest, and flicks its folded wings and tail when startled. Asked to go
// faster than it hops it takes off and flies, in a finch's bounds (a burst
// of beats, then the wings shut), and comes down and lands when it is asked
// to slow; a log in the way of its hopping it flits over. No reference
// behind it; the lab judges it by the finder, form and natural.
//
// The lab's walk and trot are its slow and quick hopping and its gallop is
// its flight (`speeds`); its gaits report as hop and fly.

import { bones, feet, tracks, chartJoints } from "./skeleton.js";
import { body } from "./body.js";

export default {
    name: 'finch',
    skeleton: { bones, feet, tracks, chartJoints },
    body,
    face: 'face.bk',
    rig: { file: 'rig.bk', kernel: 'k_rig' },
    scale: { height: 0.09, length: 0.15 },
    speeds: { walk: 0.25, trot: 0.55, gallop: 2.5, circle: 0.2 },
    space: 0.25,
    cycles: {
        hop: { scenario: 'walk' },
        'quick hop': { scenario: 'trot' },
        flight: { scenario: 'gallop' },
    },
    form: { reference: {} },
    // `plan`: the motion layers off, the rig's plan as it draws it.
    // `spread`, `half`: the wings held open and half open, to look at them.
    variants: { plan: { LAYERS: 0 }, spread: { WING_SPREAD: 1 }, half: { WING_SPREAD: 0.5 } },
    scenarios: {
        flight: {
            about: 'hops, takes off, flies a few bounds, comes down and lands, hops on and stops',
            duration: 7,
            track: [{ t: 0, speed: 0.4 }, { t: 1, speed: 2.5 }, { t: 3.6, speed: 0.4 }, { t: 6, speed: 0 }],
        },
        leap: {
            about: 'hopping at 0.5 m/s, a flit over a 5 cm log in its way, hopping on',
            duration: 5,
            ground: { log: { at: [0, 1.2], yaw: 90, height: 0.05, length: 1 } },
            track: [{ t: 0, speed: 0.5 }],
        },
    },
};
