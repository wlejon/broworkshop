// The leopard's skeleton: an adult Panthera pardus of ~56 kg, ~0.64 m at the
// shoulder, ~1.25 m head-and-body length plus a ~0.82 m four-segment sweeping
// counterbalance tail curving down into an upturned S-tip at rest.
//
// Facing +Z with +Y up and +X the leopard's left, ground at y = 0.
// Below the scapula and the femur head each digitigrade limb lies in one
// sagittal plane (x constant) so planar IK and skinned bones match cleanly.

const L = 1, R = -1;

function frontLeg(side, tag) {
    const x = (v) => v * side;
    return [
        { name: `scap${tag}`, parent: 'thorax', head: [x(0.068), 0.635, 0.240], tail: [x(0.098), 0.462, 0.372],
          limits: { x: [-46, 46], y: [-16, 16], z: [-18, 18] }, mass: 1.5 },
        { name: `humerus${tag}`, parent: `scap${tag}`, head: [x(0.098), 0.462, 0.372], tail: [x(0.098), 0.305, 0.248],
          limits: { x: [-75, 118], y: [-14, 14], z: [-16, 16] }, mass: 1.5 },
        { name: `radius${tag}`, parent: `humerus${tag}`, head: [x(0.098), 0.305, 0.248], tail: [x(0.098), 0.122, 0.302],
          limits: { x: [-142, 68], y: [-8, 8], z: [-10, 10] }, mass: 0.9 },
        { name: `mc${tag}`, parent: `radius${tag}`, head: [x(0.098), 0.122, 0.302], tail: [x(0.098), 0.038, 0.335],
          limits: { x: [-42, 145], y: [-8, 8], z: [-10, 10] }, mass: 0.32 },
        { name: `fpaw${tag}`, parent: `mc${tag}`, head: [x(0.098), 0.038, 0.335], tail: [x(0.098), 0.0, 0.398],
          limits: { x: [-85, 112], y: [-8, 8], z: [-12, 12] }, mass: 0.25 },
    ];
}

function hindLeg(side, tag) {
    const x = (v) => v * side;
    return [
        { name: `femur${tag}`, parent: 'pelvis', head: [x(0.086), 0.555, -0.395], tail: [x(0.096), 0.365, -0.268],
          limits: { x: [-85, 80], y: [-20, 20], z: [-20, 20] }, mass: 2.9 },
        { name: `tibia${tag}`, parent: `femur${tag}`, head: [x(0.096), 0.365, -0.268], tail: [x(0.096), 0.182, -0.448],
          limits: { x: [-86, 128], y: [-8, 8], z: [-10, 10] }, mass: 1.25 },
        { name: `mt${tag}`, parent: `tibia${tag}`, head: [x(0.096), 0.182, -0.448], tail: [x(0.096), 0.036, -0.405],
          limits: { x: [-140, 65], y: [-8, 8], z: [-10, 10] }, mass: 0.42 },
        { name: `hpaw${tag}`, parent: `mt${tag}`, head: [x(0.096), 0.036, -0.405], tail: [x(0.096), 0.0, -0.342],
          limits: { x: [-85, 112], y: [-8, 8], z: [-12, 12] }, mass: 0.25 },
    ];
}

export const bones = [
    { name: 'pelvis', parent: null, head: [0, 0.595, -0.380], tail: [0, 0.605, -0.110],
      limits: { x: [-180, 180], y: [-180, 180], z: [-180, 180] }, mass: 8.2 },
    { name: 'lumbar', parent: 'pelvis', head: [0, 0.605, -0.110], tail: [0, 0.608, 0.140],
      limits: { x: [-34, 36], y: [-24, 24], z: [-15, 15] }, mass: 7.6 },
    { name: 'thorax', parent: 'lumbar', head: [0, 0.608, 0.140], tail: [0, 0.605, 0.420],
      limits: { x: [-26, 28], y: [-22, 22], z: [-15, 15] }, mass: 12.0 },
    // Cervical base set low in the thoracic inlet so stalking and crouching to
    // drink fold the throat smoothly into the muscular chest without notching.
    { name: 'neck1', parent: 'thorax', head: [0, 0.505, 0.405], tail: [0, 0.595, 0.515],
      limits: { x: [-50, 75], y: [-40, 40], z: [-18, 18] }, mass: 2.8 },
    { name: 'neck2', parent: 'neck1', head: [0, 0.595, 0.515], tail: [0, 0.655, 0.595],
      limits: { x: [-48, 65], y: [-44, 44], z: [-20, 20] }, mass: 2.1 },
    { name: 'head', parent: 'neck2', head: [0, 0.655, 0.595], tail: [0, 0.610, 0.760],
      limits: { x: [-58, 70], y: [-52, 52], z: [-26, 26] }, mass: 3.5 },
    // Wide-set rounded semicircular feline ears on the dorsolateral cranium;
    // generous y/z range supports radar swivels, gallop pinning, and airplane ears.
    { name: 'earL', parent: 'head', head: [0.064, 0.716, 0.604], tail: [0.098, 0.749, 0.598],
      limits: { x: [-75, 65], y: [-75, 75], z: [-75, 75] }, mass: 0.06 },
    { name: 'earR', parent: 'head', head: [-0.064, 0.716, 0.604], tail: [-0.098, 0.749, 0.598],
      limits: { x: [-75, 65], y: [-75, 75], z: [-75, 75] }, mass: 0.06 },
    // Four-segment ~0.82 m sweeping counterbalance tail curving down near hock
    // level and turning up into the classic feline S-tip at rest.
    { name: 'tail1', parent: 'pelvis', head: [0, 0.592, -0.495], tail: [0, 0.460, -0.668],
      limits: { x: [-65, 95], y: [-60, 60], z: [-42, 42] }, mass: 0.65 },
    { name: 'tail2', parent: 'tail1', head: [0, 0.460, -0.668], tail: [0, 0.325, -0.835],
      limits: { x: [-65, 85], y: [-62, 62], z: [-45, 45] }, mass: 0.48 },
    { name: 'tail3', parent: 'tail2', head: [0, 0.325, -0.835], tail: [0, 0.258, -1.018],
      limits: { x: [-65, 85], y: [-65, 65], z: [-48, 48] }, mass: 0.34 },
    { name: 'tail4', parent: 'tail3', head: [0, 0.258, -1.018], tail: [0, 0.308, -1.188],
      limits: { x: [-70, 88], y: [-68, 68], z: [-48, 48] }, mass: 0.22 },
    ...frontLeg(L, 'L'),
    ...frontLeg(R, 'R'),
    ...hindLeg(L, 'L'),
    ...hindLeg(R, 'R'),
    // Face bones (lab/skeleton.js): binocular gaze direction and eyelid/pupil hinge.
    { name: 'gaze', parent: 'head', face: 'gaze', head: [0, 0.666, 0.678], tail: [0, 0.666, 0.708],
      limits: { x: [-25, 25], y: [-30, 30], z: [-1, 1] } },
    { name: 'lid', parent: 'head', face: 'lid', head: [0, 0.680, 0.678], tail: [0, 0.680, 0.698],
      limits: { x: [-60, 90], y: [-1, 1], z: [-25, 25] } },
];

export const feet = [
    { name: 'LH', bone: 'hpawL', hind: true, side: L },
    { name: 'LF', bone: 'fpawL', hind: false, side: L },
    { name: 'RF', bone: 'fpawR', hind: false, side: R },
    { name: 'RH', bone: 'hpawR', hind: true, side: R },
];

export const tracks = [
    { name: 'withers', bone: 'thorax', at: 0.45 },
    { name: 'hips', bone: 'pelvis', at: 0.0 },
    { name: 'head', bone: 'head', at: 0.55 },
    { name: 'tail tip', bone: 'tail4', at: 1.0 },
];

export const chartJoints = [
    'scapL', 'humerusL', 'radiusL', 'mcL', 'fpawL',
    'femurL', 'tibiaL', 'mtL', 'hpawL',
    'lumbar', 'neck1', 'head', 'tail1', 'tail3',
];
