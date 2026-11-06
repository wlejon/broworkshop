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
    rig: { file: 'rig.bk', kernel: 'k_rig' },
    scale: { height: 0.95, length: 1.6 },
    // Reference footfalls (Hildebrand): duty factor and each foot's
    // touchdown after the left hind's, as a share of the stride.
    cycles: {
        walk: { scenario: 'walk', reference: { duty: 0.64, offsets: { LH: 0, LF: 0.25, RF: 0.75, RH: 0.5 }, tolerance: { duty: 0.06, offset: 0.05 } } },
        trot: { scenario: 'trot', reference: { duty: 0.42, offsets: { LH: 0, LF: 0.5, RF: 0.0, RH: 0.5 }, tolerance: { duty: 0.06, offset: 0.05 } } },
        gallop: { scenario: 'gallop', reference: { duty: 0.27, offsets: { LH: 0, LF: 0.46, RF: 0.57, RH: 0.1 }, tolerance: { duty: 0.07, offset: 0.06 } } },
    },
    // The body at rest against a white-tailed deer of 0.95 m (body.js has
    // the sources): `form` checks each 'ring.field' or 'part.field' as [value,
    // tolerance] in metres.
    form: {
        // The legs' tops stay under the trunk's skin: the fore leg above the
        // elbow, the hind leg above the stifle fold.
        inside: { trunk: { foreL: 0.61, hindL: 0.64 } },
        reference: {
            'shoulder.top': [0.975, 0.015],
            'girth.depth': [0.41, 0.02],
            'girth.girth': [0.98, 0.04],
            'girth.width': [0.24, 0.02],
            'waist.bottom': [0.60, 0.02],
            'shoulder.width': [0.28, 0.02],
            'rump.width': [0.25, 0.02],
            'trunk.length': [1.20, 0.03],
            'neckbase.width': [0.18, 0.02],
            'neckmid.width': [0.115, 0.015],
            'forearm.width': [0.064, 0.008],
            'gaskin.width': [0.068, 0.01],
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
