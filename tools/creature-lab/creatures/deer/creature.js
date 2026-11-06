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
    variants: {
        slip: { FAULT_SLIP: 0.25 },
        sink: { FAULT_SINK: 0.06 },
        overbend: { FAULT_OVERBEND: 1.2 },
        stumble: { FAULT_STUMBLE: 0.18 },
    },
    scenarios,
};
