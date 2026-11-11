// The ursa skeleton: an adult brown/grizzly-type plantigrade bear of ~191 kg,
// 0.96 m at the interscapular shoulder hump, and 1.65 m snout-to-rump.
//
// Rest frame: facing +Z, +Y up, +X the bear's left, ground at y = 0.
// Unlike ungulates or digitigrade carnivores, bears stand and walk plantigrade
// on broad flat soles with naturally flexed elbows and stifles: low wrists and
// ankles (y = 0.060 m) carry horizontal hand/foot sole bones and broad clawed
// toe pads in ground contact.

const L = 1, R = -1;

function frontLeg(side, tag) {
    const x = (v) => v * side;
    return [
        { name: `scapula${tag}`, parent: 'thorax', head: [x(0.145), 0.89, 0.27], tail: [x(0.18), 0.62, 0.43],
          limits: { x: [-50, 50], y: [-24, 24], z: [-26, 26] }, mass: 6.5 },
        { name: `humerus${tag}`, parent: `scapula${tag}`, head: [x(0.18), 0.62, 0.43], tail: [x(0.18), 0.38, 0.23],
          limits: { x: [-95, 100], y: [-20, 20], z: [-20, 20] }, mass: 6.8 },
        { name: `forearm${tag}`, parent: `humerus${tag}`, head: [x(0.18), 0.38, 0.23], tail: [x(0.18), 0.150, 0.355],
          limits: { x: [-145, 65], y: [-16, 16], z: [-16, 16] }, mass: 4.6 },
        { name: `wrist${tag}`, parent: `forearm${tag}`, head: [x(0.18), 0.150, 0.355], tail: [x(0.18), 0.060, 0.365],
          contact: true, limits: { x: [-85, 145], y: [-24, 24], z: [-20, 20] }, mass: 0.9 },
        { name: `hand${tag}`, parent: `wrist${tag}`, head: [x(0.18), 0.060, 0.365], tail: [x(0.18), 0.020, 0.445],
          contact: true, limits: { x: [-95, 115], y: [-32, 32], z: [-26, 26] }, mass: 1.1 },
        { name: `fToe${tag}`, parent: `hand${tag}`, head: [x(0.18), 0.020, 0.445], tail: [x(0.18), 0.0, 0.510],
          contact: true, limits: { x: [-80, 95], y: [-20, 20], z: [-18, 18] }, mass: 0.6 },
    ];
}

function hindLeg(side, tag) {
    const x = (v) => v * side;
    return [
        { name: `femur${tag}`, parent: 'pelvis', head: [x(0.175), 0.72, -0.40], tail: [x(0.18), 0.41, -0.22],
          limits: { x: [-112, 112], y: [-28, 28], z: [-28, 28] }, mass: 8.8 },
        { name: `tibia${tag}`, parent: `femur${tag}`, head: [x(0.18), 0.41, -0.22], tail: [x(0.18), 0.155, -0.45],
          limits: { x: [-65, 145], y: [-16, 16], z: [-16, 16] }, mass: 4.6 },
        { name: `ankle${tag}`, parent: `tibia${tag}`, head: [x(0.18), 0.155, -0.45], tail: [x(0.18), 0.060, -0.465],
          contact: true, limits: { x: [-140, 75], y: [-24, 24], z: [-20, 20] }, mass: 0.8 },
        { name: `foot${tag}`, parent: `ankle${tag}`, head: [x(0.18), 0.060, -0.465], tail: [x(0.18), 0.020, -0.365],
          contact: true, limits: { x: [-95, 105], y: [-32, 32], z: [-26, 26] }, mass: 1.1 },
        { name: `hToe${tag}`, parent: `foot${tag}`, head: [x(0.18), 0.020, -0.365], tail: [x(0.18), 0.0, -0.295],
          contact: true, limits: { x: [-80, 95], y: [-20, 20], z: [-18, 18] }, mass: 0.6 },
    ];
}

export const bones = [
    // Heavy ursine axial frame rising from rounded hindquarters up into the shoulder hump.
    { name: 'pelvis', parent: null, head: [0, 0.76, -0.38], tail: [0, 0.79, -0.10],
      limits: { x: [-180, 180], y: [-180, 180], z: [-180, 180] }, mass: 28.0 },
    { name: 'lumbar', parent: 'pelvis', head: [0, 0.79, -0.10], tail: [0, 0.82, 0.16],
      limits: { x: [-28, 28], y: [-26, 26], z: [-20, 20] }, mass: 26.0 },
    { name: 'thorax', parent: 'lumbar', head: [0, 0.82, 0.16], tail: [0, 0.87, 0.46],
      limits: { x: [-28, 28], y: [-26, 26], z: [-20, 20] }, mass: 52.0 },
    // Low-to-mid thoracic neck root so nose-to-ground snuffling folds smoothly into the brisket.
    { name: 'neck', parent: 'thorax', head: [0, 0.75, 0.45], tail: [0, 0.81, 0.69],
      limits: { x: [-68, 80], y: [-55, 55], z: [-28, 28] }, mass: 6.0 },
    { name: 'head', parent: 'neck', head: [0, 0.81, 0.69], tail: [0, 0.75, 0.99],
      limits: { x: [-72, 75], y: [-58, 58], z: [-34, 34] }, mass: 4.8 },
    // Parted cleanly at rest so the lower mandible skins in its own isolated loop; closed snugly in rig.bk.
    { name: 'jaw', parent: 'head', head: [0, 0.746, 0.790], tail: [0, 0.654, 0.968],
      limits: { x: [-42, 42], y: [-12, 12], z: [-10, 10] }, mass: 0.7 },
    // High-set rounded cupped bear ears emerging cleanly on the dorsolateral crown of the skull.
    { name: 'earL', parent: 'head', head: [0.082, 0.868, 0.730], tail: [0.154, 0.966, 0.718],
      limits: { x: [-60, 55], y: [-60, 60], z: [-48, 48] }, mass: 0.08 },
    { name: 'earR', parent: 'head', head: [-0.082, 0.868, 0.730], tail: [-0.154, 0.966, 0.718],
      limits: { x: [-60, 55], y: [-60, 60], z: [-48, 48] }, mass: 0.08 },
    // Short furry ursine stub tail projecting cleanly past the rump contour.
    { name: 'tail', parent: 'pelvis', head: [0, 0.790, -0.588], tail: [0, 0.742, -0.748],
      limits: { x: [-50, 75], y: [-45, 45], z: [-25, 25] }, mass: 0.34 },
    ...frontLeg(L, 'L'),
    ...frontLeg(R, 'R'),
    ...hindLeg(L, 'L'),
    ...hindLeg(R, 'R'),
    // Face bones (lab/skeleton.js) driving eye gaze and lid aperture in face.bk.
    { name: 'gaze', parent: 'head', face: 'gaze', head: [0, 0.832, 0.818], tail: [0, 0.832, 0.848],
      limits: { x: [-28, 28], y: [-34, 34], z: [-2, 2] } },
    { name: 'lid', parent: 'head', face: 'lid', head: [0, 0.846, 0.818], tail: [0, 0.846, 0.838],
      limits: { x: [-65, 90], y: [-2, 2], z: [-20, 20] } },
];

// Plantigrade feet in Hildebrand order (LH, LF, RF, RH); `heel` marks the rear
// of the cushioned plantigrade sole pad carried by foot/hand.
export const feet = [
    { name: 'LH', bone: 'hToeL', hind: true, side: L, heel: [0.18, 0.006, -0.465] },
    { name: 'LF', bone: 'fToeL', hind: false, side: L, heel: [0.18, 0.006, 0.365] },
    { name: 'RF', bone: 'fToeR', hind: false, side: R, heel: [-0.18, 0.006, 0.365] },
    { name: 'RH', bone: 'hToeR', hind: true, side: R, heel: [-0.18, 0.006, -0.465] },
];

export const tracks = [
    { name: 'withers', bone: 'thorax', at: 0.55 },
    { name: 'hips', bone: 'pelvis', at: 0.0 },
    { name: 'head', bone: 'head', at: 0.52 },
    { name: 'tail tip', bone: 'tail', at: 1.0 },
];

export const chartJoints = [
    'scapulaL', 'humerusL', 'forearmL', 'wristL', 'handL', 'fToeL',
    'femurL', 'tibiaL', 'ankleL', 'footL', 'hToeL', 'neck', 'head',
];
