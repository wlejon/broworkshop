// The hexa's skeleton: an invented six-legged grazer, no real animal behind
// it. A long low barrel on three pairs of legs, a heavy head on a short
// thick neck, and a tail as long as the body. About 2 m from the shoulders
// to the haunches, the back 0.7 m up, 4.2 m from snout to tail tip.
//
// The lab's conventions (lab/skeleton.js): facing +Z, +Y up, +X its left,
// the ground at y = 0. Each leg lies in one plane (x constant), so the rig's
// planar IK and the skinned bones agree. Legs are numbered from the front:
// 1 on the thorax, 2 on the spine, 3 on the pelvis.

const LEGS = [[1, 'thorax', 0.62], [2, 'spine', 0.12], [3, 'pelvis', -0.40]];

function leg(side, tag, n, parent, z) {
    const x = 0.24 * side;
    return [
        { name: `upper${tag}${n}`, parent, head: [x, 0.52, z], tail: [x, 0.29, z + 0.10],
          limits: { x: [-75, 65], y: [-10, 10], z: [-25, 25] }, mass: 9 },
        { name: `lower${tag}${n}`, parent: `upper${tag}${n}`, head: [x, 0.29, z + 0.10], tail: [x, 0.05, z - 0.02],
          limits: { x: [-20, 120], y: [-6, 6], z: [-8, 8] }, mass: 4 },
        { name: `foot${tag}${n}`, parent: `lower${tag}${n}`, head: [x, 0.05, z - 0.02], tail: [x, 0.0, z + 0.10],
          limits: { x: [-70, 70], y: [-10, 10], z: [-15, 15] }, mass: 1.5 },
    ];
}

export const bones = [
    { name: 'pelvis', parent: null, head: [0, 0.62, -0.55], tail: [0, 0.64, -0.05], mass: 60 },
    { name: 'spine', parent: 'pelvis', head: [0, 0.64, -0.05], tail: [0, 0.66, 0.45],
      limits: { x: [-12, 12], y: [-18, 18], z: [-10, 10] }, mass: 70 },
    { name: 'thorax', parent: 'spine', head: [0, 0.66, 0.45], tail: [0, 0.68, 0.85],
      limits: { x: [-12, 12], y: [-18, 18], z: [-10, 10] }, mass: 60 },
    { name: 'neck', parent: 'thorax', head: [0, 0.68, 0.80], tail: [0, 0.68, 1.08],
      limits: { x: [-40, 40], y: [-45, 45], z: [-15, 15] }, mass: 25 },
    { name: 'head', parent: 'neck', head: [0, 0.68, 1.08], tail: [0, 0.50, 1.55],
      limits: { x: [-40, 40], y: [-40, 40], z: [-20, 20] }, mass: 30 },
    { name: 'jaw', parent: 'head', head: [0, 0.58, 1.14], tail: [0, 0.44, 1.48],
      limits: { x: [-5, 30], y: [-3, 3], z: [-3, 3] }, mass: 6 },
    { name: 'tail1', parent: 'pelvis', head: [0, 0.62, -0.55], tail: [0, 0.58, -0.95],
      limits: { x: [-30, 30], y: [-35, 35], z: [-10, 10] }, mass: 12 },
    { name: 'tail2', parent: 'tail1', head: [0, 0.58, -0.95], tail: [0, 0.50, -1.35],
      limits: { x: [-30, 30], y: [-35, 35], z: [-10, 10] }, mass: 6 },
    { name: 'tail3', parent: 'tail2', head: [0, 0.50, -1.35], tail: [0, 0.40, -1.75],
      limits: { x: [-30, 30], y: [-35, 35], z: [-10, 10] }, mass: 3 },
    { name: 'tail4', parent: 'tail3', head: [0, 0.40, -1.75], tail: [0, 0.30, -2.15],
      limits: { x: [-30, 30], y: [-40, 40], z: [-10, 10] }, mass: 1 },
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

export const chartJoints = ['upperL1', 'lowerL1', 'upperL2', 'lowerL2', 'upperL3', 'lowerL3', 'spine', 'neck', 'head', 'tail1'];
