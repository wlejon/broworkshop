// Green spiny iguana (Iguana iguana) skeleton: ~5.0 kg adult, ~0.27 m dorsal
// crest height, ~1.35 m snout-to-tail-tip length.
//
// Rest pose faces +Z with +Y up and +X to the iguana's left, ground at y = 0.
// Unlike parasagittal mammals, humerusL/R and femurL/R project laterally
// outward (±X) from scapulaL/R and pelvis so the elbows (|x| = 0.162 m) and
// knees (|x| = 0.174 m) sit clear out beside the flanks, dropping through
// forearmL/R and tibiaL/R to broad, low plantigrade 5-toed feet.
//
// Axial chain carries a flexible S-wave spine (pelvis -> lumbar -> thorax),
// neck -> head -> hinged jaw, pendulous gular dewlap (parented to neck so head
// + jaw form a clean two-bone cranial leaf chain), and a 4-bone whip tail
// tapering back to z = -0.915 m.

const L = 1, R = -1;

function frontLeg(side, tag) {
    const x = (v) => v * side;
    return [
        { name: `scapula${tag}`, parent: 'thorax',
          head: [x(0.044), 0.194, 0.255], tail: [x(0.064), 0.156, 0.266],
          limits: { x: [-45, 45], y: [-40, 40], z: [-40, 40] }, mass: 0.045 },
        { name: `humerus${tag}`, parent: `scapula${tag}`,
          head: [x(0.064), 0.156, 0.266], tail: [x(0.166), 0.132, 0.238],
          limits: { x: [-105, 105], y: [-105, 105], z: [-100, 100] }, mass: 0.085 },
        { name: `forearm${tag}`, parent: `humerus${tag}`,
          head: [x(0.166), 0.132, 0.238], tail: [x(0.156), 0.024, 0.286],
          limits: { x: [-105, 105], y: [-95, 95], z: [-95, 95] }, mass: 0.055 },
        { name: `wrist${tag}`, parent: `forearm${tag}`, contact: true,
          head: [x(0.156), 0.024, 0.286], tail: [x(0.158), 0.012, 0.308],
          limits: { x: [-95, 95], y: [-85, 85], z: [-80, 80] }, mass: 0.018 },
        { name: `hand${tag}`, parent: `wrist${tag}`, contact: true,
          head: [x(0.158), 0.012, 0.308], tail: [x(0.160), 0.005, 0.334],
          limits: { x: [-80, 85], y: [-50, 50], z: [-50, 50] }, mass: 0.015 },
        { name: `fToe${tag}`, parent: `hand${tag}`, contact: true,
          head: [x(0.160), 0.005, 0.334], tail: [x(0.162), 0.0, 0.364],
          limits: { x: [-75, 85], y: [-45, 45], z: [-45, 45] }, mass: 0.012 },
    ];
}

function hindLeg(side, tag) {
    const x = (v) => v * side;
    return [
        { name: `femur${tag}`, parent: 'pelvis',
          head: [x(0.048), 0.172, -0.068], tail: [x(0.178), 0.148, -0.036],
          limits: { x: [-105, 105], y: [-105, 105], z: [-100, 100] }, mass: 0.120 },
        { name: `tibia${tag}`, parent: `femur${tag}`,
          head: [x(0.178), 0.148, -0.036], tail: [x(0.164), 0.026, -0.114],
          limits: { x: [-105, 105], y: [-95, 95], z: [-95, 95] }, mass: 0.075 },
        { name: `ankle${tag}`, parent: `tibia${tag}`, contact: true,
          head: [x(0.164), 0.026, -0.114], tail: [x(0.168), 0.013, -0.086],
          limits: { x: [-95, 95], y: [-85, 85], z: [-80, 80] }, mass: 0.022 },
        { name: `foot${tag}`, parent: `ankle${tag}`, contact: true,
          head: [x(0.168), 0.013, -0.086], tail: [x(0.172), 0.005, -0.052],
          limits: { x: [-80, 85], y: [-50, 50], z: [-50, 50] }, mass: 0.020 },
        { name: `hToe${tag}`, parent: `foot${tag}`, contact: true,
          head: [x(0.172), 0.005, -0.052], tail: [x(0.176), 0.0, -0.014],
          limits: { x: [-75, 85], y: [-45, 45], z: [-45, 45] }, mass: 0.015 },
    ];
}

export const bones = [
    // Axial spine: generous lateral yaw (y) and roll/pitch limits for S-wave undulation.
    { name: 'pelvis', parent: null,
      head: [0, 0.186, -0.080], tail: [0, 0.195, 0.040],
      limits: { x: [-180, 180], y: [-180, 180], z: [-180, 180] }, mass: 1.04 },
    { name: 'lumbar', parent: 'pelvis',
      head: [0, 0.195, 0.040], tail: [0, 0.204, 0.165],
      limits: { x: [-30, 30], y: [-34, 34], z: [-24, 24] }, mass: 1.18 },
    { name: 'thorax', parent: 'lumbar',
      head: [0, 0.204, 0.165], tail: [0, 0.208, 0.292],
      limits: { x: [-30, 30], y: [-34, 34], z: [-24, 24] }, mass: 1.40 },

    // Cervical & cranial chain: neck carries head->jaw and the pendulous gular dewlap.
    { name: 'neck', parent: 'thorax',
      head: [0, 0.196, 0.292], tail: [0, 0.236, 0.354],
      limits: { x: [-52, 72], y: [-48, 48], z: [-28, 28] }, mass: 0.095 },
    { name: 'head', parent: 'neck',
      head: [0, 0.236, 0.354], tail: [0, 0.228, 0.435],
      limits: { x: [-58, 68], y: [-52, 52], z: [-30, 30] }, mass: 0.065 },
    { name: 'jaw', parent: 'head',
      head: [0, 0.215, 0.360], tail: [0, 0.210, 0.428],
      limits: { x: [-15, 50], y: [-14, 14], z: [-14, 14] }, mass: 0.020 },
    { name: 'dewlap', parent: 'neck',
      head: [0, 0.194, 0.348], tail: [0, 0.118, 0.372],
      limits: { x: [-52, 52], y: [-32, 32], z: [-28, 28] }, mass: 0.016 },

    // Sinuous 4-bone whip tail tapering back to z = -0.915 m.
    { name: 'tail1', parent: 'pelvis',
      head: [0, 0.180, -0.092], tail: [0, 0.148, -0.285],
      limits: { x: [-36, 46], y: [-34, 34], z: [-20, 20] }, mass: 0.100 },
    { name: 'tail2', parent: 'tail1',
      head: [0, 0.148, -0.285], tail: [0, 0.116, -0.495],
      limits: { x: [-36, 46], y: [-36, 36], z: [-20, 20] }, mass: 0.060 },
    { name: 'tail3', parent: 'tail2',
      head: [0, 0.116, -0.495], tail: [0, 0.088, -0.710],
      limits: { x: [-38, 48], y: [-38, 38], z: [-22, 22] }, mass: 0.032 },
    { name: 'tail4', parent: 'tail3',
      head: [0, 0.088, -0.710], tail: [0, 0.068, -0.915],
      limits: { x: [-38, 48], y: [-38, 38], z: [-22, 22] }, mass: 0.018 },

    // Sprawling limbs.
    ...frontLeg(L, 'L'),
    ...frontLeg(R, 'R'),
    ...hindLeg(L, 'L'),
    ...hindLeg(R, 'R'),

    // Face state bones (eye gaze direction and scaly eyelid blink).
    { name: 'gaze', parent: 'head', face: 'gaze',
      head: [0, 0.244, 0.384], tail: [0, 0.244, 0.404],
      limits: { x: [-25, 25], y: [-32, 32], z: [-2, 2] } },
    { name: 'lid', parent: 'head', face: 'lid',
      head: [0, 0.252, 0.384], tail: [0, 0.252, 0.400],
      limits: { x: [-55, 90], y: [-2, 2], z: [-20, 20] } },
];

// Hildebrand foot order: LH, LF, RF, RH.
export const feet = [
    { name: 'LH', bone: 'hToeL', hind: true, side: L },
    { name: 'LF', bone: 'fToeL', hind: false, side: L },
    { name: 'RF', bone: 'fToeR', hind: false, side: R },
    { name: 'RH', bone: 'hToeR', hind: true, side: R },
];

// Trajectory & head-stabilisation tracking points.
export const tracks = [
    { name: 'withers', bone: 'thorax', at: 0.60 },
    { name: 'hips', bone: 'pelvis', at: 0.0 },
    { name: 'head', bone: 'head', at: 0.55 },
    { name: 'tail tip', bone: 'tail4', at: 1.0 },
];

export const chartJoints = [
    'scapulaL', 'humerusL', 'forearmL', 'wristL', 'fToeL',
    'femurL', 'tibiaL', 'ankleL', 'hToeL',
    'lumbar', 'neck', 'head', 'dewlap', 'tail1',
];
