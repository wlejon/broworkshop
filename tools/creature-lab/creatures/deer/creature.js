// The deer: the lab's reference quadruped. A creature folder's
// creature.js exports this shape (lab/creature.js loads it):
//
//   name, skeleton { bones, feet, tracks, chartJoints }, body(skel),
//   rig { file, kernel, modules? }, cycles (gaits the sheets cut a cycle
//   of, and reference values to compare against), variants (knob sets:
//   the deliberately broken rigs among them), scenarios (its own, added to
//   the lab's).

import { bones, feet, tracks, chartJoints } from "./skeleton.js";
import { body } from "./body.js";
import { scenarios } from "./scenarios.js";

export default {
    name: 'deer',
    skeleton: { bones, feet, tracks, chartJoints },
    body,
    rig: { file: 'rig.bk', kernel: 'k_rig', modules: { 'deer::legs': 'legs.bk' } },
    scale: { height: 0.95, length: 1.6 },
    // Reference footfalls (Hildebrand): duty factor and each foot's
    // touchdown after the left hind's, as a share of the stride.
    cycles: {
        walk: { scenario: 'walk', reference: { duty: 0.64, offsets: { LH: 0, LF: 0.25, RF: 0.75, RH: 0.5 }, tolerance: { duty: 0.06, offset: 0.05 } } },
        trot: { scenario: 'trot', reference: { duty: 0.42, offsets: { LH: 0, LF: 0.5, RF: 0.0, RH: 0.5 }, tolerance: { duty: 0.06, offset: 0.05 } } },
        gallop: { scenario: 'gallop', reference: { duty: 0.27, offsets: { LH: 0, LF: 0.46, RF: 0.57, RH: 0.1 }, tolerance: { duty: 0.07, offset: 0.06 } } },
    },
    // The body at rest against a white-tailed deer of 0.95 m (body.js has
    // the sources): `form` checks each 'section.field' (body.js and legs.js
    // name the sections) as [value, tolerance] in metres.
    form: {
        reference: {
            'shoulder.top': [0.975, 0.015],
            'girth.depth': [0.41, 0.02],
            'girth.girth': [0.98, 0.04],
            'girth.width': [0.24, 0.02],
            'waist.bottom': [0.60, 0.02],
            'shoulder.width': [0.28, 0.02],
            'rump.width': [0.25, 0.02],
            'neckbase.width': [0.18, 0.02],
            'neckmid.width': [0.124, 0.012],
            'throat.width': [0.108, 0.01],
            'eyes.width': [0.13, 0.01],
            'cheeks.width': [0.104, 0.01],
            // The upper legs' muscle (legs.js has the sources).
            // Leg rings: width side to side, length front to back.
            // The thighs are the trunk's lobes, hanging to 0.52 m at the hip.
            'hip.bottom': [0.52, 0.02],
            'hip.width': [0.275, 0.015],
            'stifle.girth': [0.45, 0.04],
            'stifle.width': [0.082, 0.008],
            'stifle.length': [0.19, 0.02],
            'gaskin.girth': [0.32, 0.03],
            'gaskin.width': [0.074, 0.008],
            'gaskin.length': [0.11, 0.015],
            'arm.girth': [0.42, 0.03],
            'arm.width': [0.092, 0.008],
            'arm.length': [0.16, 0.015],
            'forearm.girth': [0.27, 0.02],
            'forearm.width': [0.072, 0.008],
            'forearm.length': [0.096, 0.01],
        },
    },
    variants: {
        slip: { FAULT_SLIP: 0.25 },
        sink: { FAULT_SINK: 0.06 },
        overbend: { FAULT_OVERBEND: 2.4 },
        stumble: { FAULT_STUMBLE: 0.18 },
    },
    scenarios,
};
