// The finch: an invented small songbird of 24 g, 14 cm from the bill to the
// tail's tip, brown with a chestnut cap, a grey cheek and a buff breast.
// It hops with both feet together and a flight between hops, glances about
// in quick turns of the head, pecks at the ground, settles onto its belly
// to rest, and flutters its wings when startled. No reference behind it;
// the lab judges it by the finder, form and natural.
//
// The lab's walk, trot and gallop are its slow, quick and fast hopping
// (`speeds`); its gait reports as hop.

import { bones, feet, tracks, chartJoints } from "./skeleton.js";
import { body } from "./body.js";

export default {
    name: 'finch',
    skeleton: { bones, feet, tracks, chartJoints },
    body,
    face: 'face.bk',
    rig: { file: 'rig.bk', kernel: 'k_rig' },
    scale: { height: 0.09, length: 0.15 },
    speeds: { walk: 0.25, trot: 0.55, gallop: 0.9, circle: 0.2 },
    space: 0.25,
    cycles: {
        hop: { scenario: 'walk' },
        'quick hop': { scenario: 'trot' },
        'fast hop': { scenario: 'gallop' },
    },
    form: { reference: {} },
    // `plan`: the motion layers off, the rig's plan as it draws it.
    variants: { plan: { LAYERS: 0 } },
    scenarios: {},
};
