// The hexa's skeleton: an invented six-legged browser of the open plain, no
// real animal behind it. A long supple back carried high on three pairs of
// slender legs, a deep chest, an arched neck of two bones up to a small
// narrow head with lyre horns and long ears, and a thin tail hanging to a
// tuft. The back 1.1 m up, the horns' tips 1.8 m, 2.6 m from nose to tail.
//
// The lab's conventions (lab/skeleton.js): facing +Z, +Y up, +X its left,
// the ground at y = 0. Each leg lies in one plane (x constant), so the rig's
// planar IK and the skinned bones agree. Legs are numbered from the front:
// 1 on the thorax, 2 on the spine, 3 on the pelvis.

// (They stand a little ahead of the trunk's middle, under its centre of
// mass: the neck and head reach out in front.)
const LEGS = [[1, 'thorax', 0.66], [2, 'spine', 0.12], [3, 'pelvis', -0.42]];

// A leg: the upper leg down and forward to the knee, the long cannon back
// and down to the fetlock, the hoof it stands on. (It stands well bent, so
// a step has reach to spare before the leg is straight.)
function leg(side, tag, n, parent, z) {
    const x = 0.15 * side;
    return [
        { name: `upper${tag}${n}`, parent, head: [x, 0.80, z], tail: [x, 0.46, z + 0.12],
          limits: { x: [-80, 70], y: [-10, 10], z: [-25, 25] }, mass: 4 },
        { name: `lower${tag}${n}`, parent: `upper${tag}${n}`, head: [x, 0.46, z + 0.12], tail: [x, 0.09, z - 0.05],
          limits: { x: [-20, 135], y: [-6, 6], z: [-8, 8] }, mass: 1.6 },
        { name: `foot${tag}${n}`, parent: `lower${tag}${n}`, head: [x, 0.09, z - 0.05], tail: [x, 0.0, z + 0.03],
          limits: { x: [-80, 80], y: [-10, 10], z: [-15, 15] }, mass: 0.5 },
    ];
}

function ear(side, tag) {
    return { name: `ear${tag}`, parent: 'head', head: [0.055 * side, 1.47, 1.075], tail: [0.19 * side, 1.545, 1.01],
             limits: { x: [-50, 50], y: [-60, 60], z: [-50, 50] }, mass: 0.05 };
}

export const bones = [
    { name: 'pelvis', parent: null, head: [0, 0.90, -0.62], tail: [0, 0.91, -0.12], mass: 38 },
    { name: 'spine', parent: 'pelvis', head: [0, 0.91, -0.12], tail: [0, 0.92, 0.38],
      limits: { x: [-14, 14], y: [-20, 20], z: [-10, 10] }, mass: 34 },
    { name: 'thorax', parent: 'spine', head: [0, 0.92, 0.38], tail: [0, 0.96, 0.80],
      limits: { x: [-14, 14], y: [-20, 20], z: [-10, 10] }, mass: 24 },
    { name: 'neck', parent: 'thorax', head: [0, 0.96, 0.76], tail: [0, 1.19, 0.95],
      limits: { x: [-45, 65], y: [-40, 40], z: [-15, 15] }, mass: 6 },
    { name: 'neck2', parent: 'neck', head: [0, 1.19, 0.95], tail: [0, 1.42, 1.06],
      limits: { x: [-45, 65], y: [-45, 45], z: [-15, 15] }, mass: 3.5 },
    { name: 'head', parent: 'neck2', head: [0, 1.42, 1.06], tail: [0, 1.33, 1.37],
      limits: { x: [-50, 50], y: [-50, 50], z: [-25, 25] }, mass: 4.5 },
    { name: 'jaw', parent: 'head', head: [0, 1.375, 1.10], tail: [0, 1.295, 1.34],
      limits: { x: [-5, 30], y: [-3, 3], z: [-3, 3] }, mass: 0.5 },
    ear(1, 'L'),
    ear(-1, 'R'),
    { name: 'tail1', parent: 'pelvis', head: [0, 0.90, -0.62], tail: [0, 0.84, -0.84],
      limits: { x: [-40, 40], y: [-40, 40], z: [-10, 10] }, mass: 2 },
    { name: 'tail2', parent: 'tail1', head: [0, 0.84, -0.84], tail: [0, 0.72, -1.02],
      limits: { x: [-40, 40], y: [-40, 40], z: [-10, 10] }, mass: 1 },
    { name: 'tail3', parent: 'tail2', head: [0, 0.72, -1.02], tail: [0, 0.57, -1.14],
      limits: { x: [-40, 40], y: [-40, 40], z: [-10, 10] }, mass: 0.6 },
    { name: 'tail4', parent: 'tail3', head: [0, 0.57, -1.14], tail: [0, 0.38, -1.20],
      limits: { x: [-40, 40], y: [-45, 45], z: [-10, 10] }, mass: 0.4 },
    ...LEGS.flatMap(([n, parent, z]) => [...leg(1, 'L', n, parent, z), ...leg(-1, 'R', n, parent, z)]),
];

// The feet, front to back on each side; `bone` ends at the toe.
export const feet = [
    { name: 'L1', bone: 'footL1', hind: false, side: 1 },
    { name: 'R1', bone: 'footR1', hind: false, side: -1 },
    { name: 'L2', bone: 'footL2', hind: false, side: 1 },
    { name: 'R2', bone: 'footR2', hind: false, side: -1 },
    { name: 'L3', bone: 'footL3', hind: true, side: 1 },
    { name: 'R3', bone: 'footR3', hind: true, side: -1 },
];

export const tracks = [
    { name: 'withers', bone: 'thorax', at: 0.5 },
    { name: 'hips', bone: 'pelvis', at: 0.0 },
    { name: 'head', bone: 'head', at: 0.5 },
    { name: 'tail tip', bone: 'tail4', at: 1.0 },
];

export const chartJoints = ['upperL1', 'lowerL1', 'upperL2', 'lowerL2', 'upperL3', 'lowerL3', 'spine', 'neck', 'neck2', 'head', 'tail1'];
