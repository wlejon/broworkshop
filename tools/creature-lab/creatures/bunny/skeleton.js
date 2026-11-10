// The bunny's skeleton: a rabbit of about 1.6 kg, 0.42 m from its scut to its
// nose, sitting.
//
// The rest pose is the rabbit at rest on all fours: the back arched over
// the haunches, the hind legs folded under it in a Z (the thigh forward and
// down to the knee, the shank back and down to the heel) with the long hind
// foot flat on the ground from the heel to the toes, and the short fore legs
// near straight under the chest. Facing +Z with +Y up and +X the bunny's
// left, the ground at y = 0, as the lab's skeletons are (lab/skeleton.js;
// deer/skeleton.js has the conventions). `limits` are each joint's range in
// degrees, x the flexion: positive swings the bone's tail backward (a
// hanging bone's toward -Z, the neck's and the head's toward the ground,
// the tail's up; a bone standing up, as an ear does, swings forward, so an
// ear lays back along the neck with negative x). `mass` in kg.
//
// Below the scapula and the femur head each leg lies in one plane (x
// constant), for the planar leg solutions (creature::limbs). The blade and
// the thigh turn the leg's plane out (z) and then flex in it (x); read back
// as x, y, z angles that reads as some y, which is why their y ranges are
// wider than the rest. The hind's ranges reach a push onto the toes (the
// stifle and hock near straight), the blades' a step out to the side.

import { earAxis } from "./ear.js";

const L = 1, R = -1;

function frontLeg(side, tag) {
    const x = (v) => v * side;
    return [
        { name: `scap${tag}`, parent: 'thorax', head: [x(0.028), 0.150, 0.075], tail: [x(0.033), 0.100, 0.103],
          limits: { x: [-35, 35], y: [-12, 12], z: [-20, 20] }, mass: 0.02 },
        { name: `humerus${tag}`, parent: `scap${tag}`, head: [x(0.033), 0.100, 0.103], tail: [x(0.033), 0.058, 0.080],
          limits: { x: [-60, 80], y: [-6, 6], z: [-10, 10] }, mass: 0.025 },
        { name: `radius${tag}`, parent: `humerus${tag}`, head: [x(0.033), 0.058, 0.080], tail: [x(0.033), 0.012, 0.105],
          limits: { x: [-130, 60], y: [-5, 5], z: [-6, 6] }, mass: 0.012 },
        { name: `mc${tag}`, parent: `radius${tag}`, head: [x(0.033), 0.012, 0.105], tail: [x(0.033), 0.004, 0.122],
          limits: { x: [-15, 150], y: [-5, 5], z: [-6, 6] }, mass: 0.004 },
        { name: `paw${tag}`, parent: `mc${tag}`, head: [x(0.033), 0.004, 0.122], tail: [x(0.033), 0.0, 0.137],
          limits: { x: [-70, 90], y: [-5, 5], z: [-8, 8] }, mass: 0.003 },
    ];
}

function hindLeg(side, tag) {
    const x = (v) => v * side;
    return [
        { name: `femur${tag}`, parent: 'pelvis', head: [x(0.034), 0.105, -0.095], tail: [x(0.040), 0.065, -0.030],
          limits: { x: [-80, 75], y: [-18, 18], z: [-15, 15] }, mass: 0.11 },
        { name: `tibia${tag}`, parent: `femur${tag}`, head: [x(0.040), 0.065, -0.030], tail: [x(0.040), 0.014, -0.118],
          limits: { x: [-70, 125], y: [-6, 6], z: [-8, 8] }, mass: 0.05 },
        { name: `mt${tag}`, parent: `tibia${tag}`, head: [x(0.040), 0.014, -0.118], tail: [x(0.040), 0.006, -0.052],
          limits: { x: [-140, 80], y: [-5, 5], z: [-6, 6] }, mass: 0.018 },
        { name: `toe${tag}`, parent: `mt${tag}`, head: [x(0.040), 0.006, -0.052], tail: [x(0.040), 0.0, -0.021],
          limits: { x: [-70, 90], y: [-5, 5], z: [-8, 8] }, mass: 0.006 },
    ];
}

// Two bones up the ear (ear.js), the first to just under its widest.
function ear(side, tag) {
    const E = earAxis(side), mid = E.at(0.45);
    return [
        { name: `ear${tag}1`, parent: 'head', head: E.base, tail: mid,
          limits: { x: [-110, 60], y: [-105, 105], z: [-45, 45] }, mass: 0.006 },
        { name: `ear${tag}2`, parent: `ear${tag}1`, head: mid, tail: E.tip,
          limits: { x: [-50, 40], y: [-15, 15], z: [-20, 20] }, mass: 0.004 },
    ];
}

export const bones = [
    { name: 'pelvis', parent: null, head: [0, 0.115, -0.105], tail: [0, 0.150, -0.045],
      limits: { x: [-180, 180], y: [-180, 180], z: [-180, 180] }, mass: 0.30 },
    { name: 'lumbar', parent: 'pelvis', head: [0, 0.150, -0.045], tail: [0, 0.165, 0.030],
      limits: { x: [-30, 30], y: [-15, 15], z: [-10, 10] }, mass: 0.30 },
    { name: 'thorax', parent: 'lumbar', head: [0, 0.165, 0.030], tail: [0, 0.150, 0.110],
      limits: { x: [-20, 20], y: [-12, 12], z: [-8, 8] }, mass: 0.32 },
    { name: 'neck', parent: 'thorax', head: [0, 0.118, 0.105], tail: [0, 0.150, 0.150],
      limits: { x: [-60, 70], y: [-50, 50], z: [-15, 15] }, mass: 0.06 },
    { name: 'head', parent: 'neck', head: [0, 0.150, 0.150], tail: [0, 0.122, 0.205],
      limits: { x: [-60, 75], y: [-60, 60], z: [-25, 25] }, mass: 0.11 },
    // The nose and whisker pads, which twitch.
    { name: 'nose', parent: 'head', head: [0, 0.122, 0.205], tail: [0, 0.128, 0.228],
      limits: { x: [-15, 15], y: [-10, 10], z: [-10, 10] }, mass: 0.003 },
    ...ear(L, 'L'),
    ...ear(R, 'R'),
    { name: 'tail', parent: 'pelvis', head: [0, 0.112, -0.150], tail: [0, 0.128, -0.185],
      limits: { x: [-40, 70], y: [-30, 30], z: [-10, 10] }, mass: 0.015 },
    ...frontLeg(L, 'L'),
    ...frontLeg(R, 'R'),
    ...hindLeg(L, 'L'),
    ...hindLeg(R, 'R'),
    // The face (lab/skeleton.js): where the eyes look, and the lids' hinge
    // (x shuts them, under 0 opens them wide).
    { name: 'gaze', parent: 'head', face: 'gaze', head: [0, 0.164, 0.178], tail: [0, 0.164, 0.186],
      limits: { x: [-20, 20], y: [-25, 25], z: [-1, 1] } },
    { name: 'lid', parent: 'head', face: 'lid', head: [0, 0.170, 0.178], tail: [0, 0.170, 0.184],
      limits: { x: [-60, 90], y: [-1, 1], z: [-20, 20] } },
];

// The feet in the order the lab reports them (Hildebrand: hind and fore of
// each side). `bone` ends at the toe, the point the rig plants.
export const feet = [
    { name: 'LH', bone: 'toeL', hind: true, side: L },
    { name: 'LF', bone: 'pawL', hind: false, side: L },
    { name: 'RF', bone: 'pawR', hind: false, side: R },
    { name: 'RH', bone: 'toeR', hind: true, side: R },
];

export const tracks = [
    { name: 'withers', bone: 'thorax', at: 0.4 },
    { name: 'hips', bone: 'pelvis', at: 0.0 },
    { name: 'head', bone: 'head', at: 0.5 },
    { name: 'ear tip', bone: 'earL2', at: 1.0 },
    { name: 'tail tip', bone: 'tail', at: 1.0 },
];

export const chartJoints = ['scapL', 'humerusL', 'radiusL', 'mcL', 'femurL', 'tibiaL', 'mtL', 'toeL', 'lumbar', 'neck', 'head', 'earL1'];
