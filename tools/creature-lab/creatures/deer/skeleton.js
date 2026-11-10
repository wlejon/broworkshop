// The deer's skeleton: a doe of about 55 kg, 0.95 m at the withers.
//
// Every bone is given in the rest pose, facing +Z with +Y up and +X the
// deer's left, the ground at y = 0. `head` is the joint the bone turns about
// and `tail` where it ends (its child's head, or a tip). A bone's rest frame
// is the world's axes, so a pose is each bone's rotation from rest and the
// position of its head. Parents come before children.
//
// `limits` are each joint's range in degrees, as the bone's rotation from
// rest relative to its parent's, decomposed R = Rx(x) Ry(y) Rz(z). For a
// limb x is flexion: positive swings the bone's tail backward (a hanging
// bone's tail toward -Z, a neck's toward the ground, a tail's up).
// `mass` (kg) sits at the bone's middle for the centre of mass.
//
// Below the scapula and the femur head each leg lies in one plane (x
// constant), so the rig's planar IK and the skinned bones agree exactly.

const L = 1, R = -1;

function frontLeg(side, tag) {
    const x = (v) => v * side;
    return [
        { name: `scap${tag}`, parent: 'thorax', head: [x(0.075), 0.97, 0.29], tail: [x(0.11), 0.72, 0.43],
          limits: { x: [-30, 30], y: [-6, 6], z: [-8, 8] }, mass: 1.6 },
        { name: `humerus${tag}`, parent: `scap${tag}`, head: [x(0.11), 0.72, 0.43], tail: [x(0.11), 0.52, 0.33],
          limits: { x: [-45, 70], y: [-6, 6], z: [-8, 8] }, mass: 1.3 },
        { name: `radius${tag}`, parent: `humerus${tag}`, head: [x(0.11), 0.52, 0.33], tail: [x(0.11), 0.27, 0.345],
          limits: { x: [-125, 32], y: [-4, 4], z: [-6, 6] }, mass: 0.6 },
        { name: `mc${tag}`, parent: `radius${tag}`, head: [x(0.11), 0.27, 0.345], tail: [x(0.11), 0.075, 0.355],
          limits: { x: [-6, 165], y: [-4, 4], z: [-5, 5] }, mass: 0.25 },
        { name: `fhoof${tag}`, parent: `mc${tag}`, head: [x(0.11), 0.075, 0.355], tail: [x(0.11), 0.0, 0.415],
          limits: { x: [-70, 100], y: [-4, 4], z: [-8, 8] }, mass: 0.15 },
    ];
}

function hindLeg(side, tag) {
    const x = (v) => v * side;
    return [
        { name: `femur${tag}`, parent: 'pelvis', head: [x(0.095), 0.80, -0.42], tail: [x(0.105), 0.56, -0.30],
          limits: { x: [-60, 60], y: [-8, 8], z: [-14, 14] }, mass: 2.6 },
        { name: `tibia${tag}`, parent: `femur${tag}`, head: [x(0.105), 0.56, -0.30], tail: [x(0.105), 0.36, -0.50],
          limits: { x: [-35, 95], y: [-5, 5], z: [-6, 6] }, mass: 1.0 },
        { name: `mt${tag}`, parent: `tibia${tag}`, head: [x(0.105), 0.36, -0.50], tail: [x(0.105), 0.075, -0.465],
          limits: { x: [-125, 30], y: [-4, 4], z: [-5, 5] }, mass: 0.35 },
        { name: `hhoof${tag}`, parent: `mt${tag}`, head: [x(0.105), 0.075, -0.465], tail: [x(0.105), 0.0, -0.405],
          limits: { x: [-70, 100], y: [-4, 4], z: [-8, 8] }, mass: 0.15 },
    ];
}

export const bones = [
    { name: 'pelvis', parent: null, head: [0, 0.86, -0.40], tail: [0, 0.89, -0.12],
      limits: { x: [-180, 180], y: [-180, 180], z: [-180, 180] }, mass: 9 },
    { name: 'lumbar', parent: 'pelvis', head: [0, 0.89, -0.12], tail: [0, 0.92, 0.12],
      limits: { x: [-14, 14], y: [-12, 12], z: [-8, 8] }, mass: 9 },
    { name: 'thorax', parent: 'lumbar', head: [0, 0.92, 0.12], tail: [0, 0.96, 0.44],
      limits: { x: [-14, 14], y: [-12, 12], z: [-8, 8] }, mass: 15 },
    // The neck turns low in the thoracic inlet, near its underside: lowered
    // to graze (some 80 degrees) the skin of the bend's inside, as far from
    // the joint as it is below it, sweeps an arc about it, so a joint at
    // mid-depth swung the throat up into the chest (a notch under the
    // neck); low, the throat folds into the brisket.
    { name: 'neck1', parent: 'thorax', head: [0, 0.71, 0.44], tail: [0, 1.05, 0.64],
      limits: { x: [-45, 80], y: [-35, 35], z: [-12, 12] }, mass: 2.5 },
    { name: 'neck2', parent: 'neck1', head: [0, 1.05, 0.64], tail: [0, 1.28, 0.73],
      limits: { x: [-45, 65], y: [-40, 40], z: [-12, 12] }, mass: 2.0 },
    { name: 'head', parent: 'neck2', head: [0, 1.28, 0.73], tail: [0, 1.18, 0.99],
      limits: { x: [-60, 70], y: [-45, 45], z: [-20, 20] }, mass: 3.0 },
    { name: 'earL', parent: 'head', head: [0.045, 1.325, 0.75], tail: [0.155, 1.42, 0.715],
      limits: { x: [-70, 50], y: [-70, 70], z: [-50, 50] }, mass: 0.05 },
    { name: 'earR', parent: 'head', head: [-0.045, 1.325, 0.75], tail: [-0.155, 1.42, 0.715],
      limits: { x: [-70, 50], y: [-70, 70], z: [-50, 50] }, mass: 0.05 },
    { name: 'tail1', parent: 'pelvis', head: [0, 0.86, -0.585], tail: [0, 0.81, -0.68],
      limits: { x: [-30, 115], y: [-35, 35], z: [-10, 10] }, mass: 0.2 },
    { name: 'tail2', parent: 'tail1', head: [0, 0.81, -0.68], tail: [0, 0.73, -0.75],
      limits: { x: [-40, 60], y: [-35, 35], z: [-10, 10] }, mass: 0.1 },
    ...frontLeg(L, 'L'),
    ...frontLeg(R, 'R'),
    ...hindLeg(L, 'L'),
    ...hindLeg(R, 'R'),
    // The face (lab/skeleton.js): where the eyes look, and the lids' hinge
    // (x shuts them, under 0 opens them wide).
    { name: 'gaze', parent: 'head', face: 'gaze', head: [0, 1.313, 0.79], tail: [0, 1.313, 0.82],
      limits: { x: [-25, 25], y: [-30, 30], z: [-1, 1] } },
    { name: 'lid', parent: 'head', face: 'lid', head: [0, 1.33, 0.79], tail: [0, 1.33, 0.81],
      limits: { x: [-60, 90], y: [-1, 1], z: [-20, 20] } },
];

// The feet in the order the lab reports them (Hildebrand: hind and fore of
// each side). `bone` ends at the toe, the contact point the rig plants.
export const feet = [
    { name: 'LH', bone: 'hhoofL', hind: true, side: L },
    { name: 'LF', bone: 'fhoofL', hind: false, side: L },
    { name: 'RF', bone: 'fhoofR', hind: false, side: R },
    { name: 'RH', bone: 'hhoofR', hind: true, side: R },
];

// Points the lab tracks in the trajectory sheets: a bone and where along it
// (0 its head, 1 its tail).
export const tracks = [
    { name: 'withers', bone: 'thorax', at: 0.55 },
    { name: 'hips', bone: 'pelvis', at: 0.0 },
    { name: 'head', bone: 'head', at: 0.55 },
    { name: 'tail tip', bone: 'tail2', at: 1.0 },
];

// Joints the charts plot over the gait cycle (flexion, x).
export const chartJoints = ['scapL', 'humerusL', 'radiusL', 'mcL', 'fhoofL', 'femurL', 'tibiaL', 'mtL', 'hhoofL', 'neck1', 'head'];
