// The wader's skeleton: a long-legged wading bird of about 2 kg, 0.95 m
// to the crown standing, its trunk an egg carried a little nose-up, a long
// neck in an S, a dagger bill, a short tail, the wings folded along the
// flanks with their tips over the tail.
//
// A bird's leg is a Z of four bones: the femur, short and forward inside
// the body; the drumstick (tibiotarsus) back and down to the joint that
// looks like a backward knee and is the ankle; the bare tarsus down and a
// little forward; the toes flat ahead. That is the shape of a quadruped's
// hind leg (creature::limbs solve_hind), the femur and the tarsus held
// near their rest angle to each other.
//
// The lab's conventions (lab/skeleton.js): facing +Z with +Y up and +X its
// left, the ground at y = 0. `limits` in degrees, x the flexion (positive
// swings a hanging bone's tail backward and a forward-pointing one's
// down); `mass` in kg. Each leg lies in one plane (x constant).

const L = 1, R = -1;

function leg(side, tag) {
    const x = 0.06 * side;
    const out = (lo, hi) => (side > 0 ? [lo, hi] : [-hi, -lo]);
    return [
        { name: `femur${tag}`, parent: 'body', head: [x, 0.56, 0.02], tail: [x, 0.48, 0.085],
          limits: { x: [-70, 70], y: [-40, 40], z: out(-25, 35) }, mass: 0.16 },
        { name: `tibia${tag}`, parent: `femur${tag}`, head: [x, 0.48, 0.085], tail: [x, 0.27, -0.02],
          limits: { x: [-60, 130], y: [-8, 8], z: [-8, 8] }, mass: 0.08 },
        { name: `tarsus${tag}`, parent: `tibia${tag}`, head: [x, 0.27, -0.02], tail: [x, 0.025, 0.02],
          limits: { x: [-160, 40], y: [-6, 6], z: [-8, 8] }, mass: 0.03 },
        { name: `toe${tag}`, parent: `tarsus${tag}`, head: [x, 0.025, 0.02], tail: [x, 0.0, 0.12],
          limits: { x: [-60, 110], y: [-8, 8], z: [-10, 10] }, mass: 0.01 },
    ];
}

function wing(side, tag) {
    const x = (v) => v * side;
    return [
        { name: `humerus${tag}`, parent: 'body', head: [x(0.07), 0.635, 0.10], tail: [x(0.088), 0.615, -0.01],
          limits: { x: [-80, 40], y: [-30, 60], z: side > 0 ? [-20, 90] : [-90, 20] }, mass: 0.07 },
        { name: `forearm${tag}`, parent: `humerus${tag}`, head: [x(0.088), 0.615, -0.01], tail: [x(0.085), 0.64, -0.13],
          limits: { x: [-30, 30], y: [-90, 10], z: [-20, 20] }, mass: 0.04 },
        { name: `hand${tag}`, parent: `forearm${tag}`, head: [x(0.085), 0.64, -0.13], tail: [x(0.06), 0.60, -0.30],
          limits: { x: [-30, 30], y: [-40, 40], z: [-20, 20] }, mass: 0.02 },
    ];
}

export const bones = [
    { name: 'body', parent: null, head: [0, 0.56, -0.06], tail: [0, 0.62, 0.15],
      limits: { x: [-180, 180], y: [-180, 180], z: [-180, 180] }, mass: 1.15 },
    { name: 'tail', parent: 'body', head: [0, 0.575, -0.12], tail: [0, 0.54, -0.26],
      limits: { x: [-35, 35], y: [-30, 30], z: [-15, 15] }, mass: 0.04 },
    { name: 'neck1', parent: 'body', head: [0, 0.625, 0.15], tail: [0, 0.725, 0.20],
      limits: { x: [-60, 130], y: [-45, 45], z: [-25, 25] }, mass: 0.10 },
    { name: 'neck2', parent: 'neck1', head: [0, 0.725, 0.20], tail: [0, 0.82, 0.165],
      limits: { x: [-70, 80], y: [-45, 45], z: [-25, 25] }, mass: 0.07 },
    { name: 'neck3', parent: 'neck2', head: [0, 0.82, 0.165], tail: [0, 0.895, 0.20],
      limits: { x: [-70, 80], y: [-45, 45], z: [-25, 25] }, mass: 0.05 },
    { name: 'head', parent: 'neck3', head: [0, 0.895, 0.20], tail: [0, 0.885, 0.40],
      limits: { x: [-80, 80], y: [-60, 60], z: [-30, 30] }, mass: 0.07 },
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
    { name: 'head', bone: 'head', at: 0.15 },
    { name: 'tail tip', bone: 'tail', at: 1.0 },
];

export const chartJoints = ['femurL', 'tibiaL', 'tarsusL', 'toeL', 'neck1', 'neck2', 'neck3', 'head', 'tail', 'humerusL'];
