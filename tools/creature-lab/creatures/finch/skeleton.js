// The finch's skeleton: a small songbird of about 24 g, 14 cm from the bill
// to the tail's tip and 9 cm to the crown standing. Its body is a plump egg
// carried a little nose-up, the head close on a short neck, a stout conical
// bill. The tail is long and angled down behind, and the wings fold along the
// flanks with their tips over the tail.
//
// The legs are the wader's Z in miniature: the femur and most of the
// drumstick hidden in the belly's feathers, the bare tarsus short and near
// upright, three toes ahead and one behind (creature::limbs solve_hind).
//
// The lab's conventions (lab/skeleton.js): facing +Z with +Y up and +X its
// left, the ground at y = 0. `limits` in degrees, x the flexion; `mass` in
// kg. Each leg lies in one plane (x constant).

const L = 1, R = -1;

function leg(side, tag) {
    const x = 0.011 * side;
    const out = (lo, hi) => (side > 0 ? [lo, hi] : [-hi, -lo]);
    return [
        { name: `femur${tag}`, parent: 'body', head: [x, 0.045, 0.004], tail: [x, 0.035, 0.015],
          limits: { x: [-70, 70], y: [-40, 40], z: out(-25, 35) }, mass: 0.0012 },
        { name: `tibia${tag}`, parent: `femur${tag}`, head: [x, 0.035, 0.015], tail: [x, 0.0175, 0.0],
          limits: { x: [-60, 140], y: [-8, 8], z: [-8, 8] }, mass: 0.0006 },
        { name: `tarsus${tag}`, parent: `tibia${tag}`, head: [x, 0.0175, 0.0], tail: [x, 0.0035, 0.005],
          limits: { x: [-160, 40], y: [-6, 6], z: [-8, 8] }, mass: 0.0002 },
        { name: `toe${tag}`, parent: `tarsus${tag}`, head: [x, 0.0035, 0.005], tail: [x, 0.0, 0.019],
          limits: { x: [-60, 110], y: [-8, 8], z: [-10, 10] }, mass: 0.0001 },
    ];
}

function wing(side, tag) {
    const x = (v) => v * side;
    return [
        { name: `humerus${tag}`, parent: 'body', head: [x(0.016), 0.062, 0.02], tail: [x(0.02), 0.059, -0.004],
          limits: { x: [-80, 40], y: [-30, 60], z: side > 0 ? [-20, 100] : [-100, 20] }, mass: 0.0009 },
        { name: `forearm${tag}`, parent: `humerus${tag}`, head: [x(0.02), 0.059, -0.004], tail: [x(0.019), 0.062, -0.03],
          limits: { x: [-30, 30], y: [-100, 10], z: [-20, 20] }, mass: 0.0005 },
        { name: `hand${tag}`, parent: `forearm${tag}`, head: [x(0.019), 0.062, -0.03], tail: [x(0.009), 0.052, -0.066],
          limits: { x: [-30, 30], y: [-50, 50], z: [-20, 20] }, mass: 0.0003 },
    ];
}

export const bones = [
    { name: 'body', parent: null, head: [0, 0.045, -0.025], tail: [0, 0.058, 0.03],
      limits: { x: [-180, 180], y: [-180, 180], z: [-180, 180] }, mass: 0.0165 },
    { name: 'tail', parent: 'body', head: [0, 0.05, -0.03], tail: [0, 0.036, -0.085],
      limits: { x: [-45, 40], y: [-30, 30], z: [-15, 15] }, mass: 0.0008 },
    { name: 'neck', parent: 'body', head: [0, 0.058, 0.026], tail: [0, 0.073, 0.033],
      limits: { x: [-60, 110], y: [-60, 60], z: [-30, 30] }, mass: 0.0012 },
    { name: 'head', parent: 'neck', head: [0, 0.073, 0.033], tail: [0, 0.071, 0.062],
      limits: { x: [-80, 80], y: [-90, 90], z: [-35, 35] }, mass: 0.0022 },
    ...wing(L, 'L'),
    ...wing(R, 'R'),
    ...leg(L, 'L'),
    ...leg(R, 'R'),
];

export const feet = [
    { name: 'L', bone: 'toeL', hind: true, side: L },
    { name: 'R', bone: 'toeR', hind: true, side: R },
];

export const tracks = [
    { name: 'withers', bone: 'body', at: 0.85 },
    { name: 'hips', bone: 'body', at: 0.35 },
    { name: 'head', bone: 'head', at: 0.2 },
    { name: 'tail tip', bone: 'tail', at: 1.0 },
];

export const chartJoints = ['femurL', 'tibiaL', 'tarsusL', 'toeL', 'neck', 'head', 'tail', 'humerusL'];
