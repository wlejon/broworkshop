// The wader's skeleton: a long-legged wading bird of about 2 kg, 0.95 m
// to the crown standing, its trunk an egg carried a little nose-up, a long
// neck in an S, a dagger bill, a short tail, and wings 1.7 m across (stood
// here spread; the rig folds them along the flanks, their tips by the tail).
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
          limits: { x: [-70, 110], y: [-40, 40], z: out(-25, 35) }, mass: 0.16 },
        { name: `tibia${tag}`, parent: `femur${tag}`, head: [x, 0.48, 0.085], tail: [x, 0.27, -0.02],
          limits: { x: [-60, 130], y: [-8, 8], z: [-8, 8] }, mass: 0.08 },
        { name: `tarsus${tag}`, parent: `tibia${tag}`, head: [x, 0.27, -0.02], tail: [x, 0.025, 0.02],
          limits: { x: [-160, 40], y: [-6, 6], z: [-8, 8] }, mass: 0.03 },
        { name: `toe${tag}`, parent: `tarsus${tag}`, head: [x, 0.025, 0.02], tail: [x, 0.0, 0.12],
          limits: { x: [-60, 110], y: [-8, 8], z: [-10, 10] }, mass: 0.01 },
    ];
}

// A wing, stood here spread flat, 0.8 m from the shoulder to the tip (the
// rig folds it in its own plane, a Z, and lays it against the flank): the
// arm's three bones along the leading edge, and a bone to each flight
// feather from its root on the arm to its tip at the trailing edge: five
// primaries on the hand (the hand's own line is the outermost), five
// secondaries on the forearm, two tertials on the upper arm. [x out, z].
export const WING_Y = 0.635;
export const WING = {
    shoulder: [0.085, 0.10], elbow: [0.29, 0.06], wrist: [0.48, 0.12], tip: [0.86, 0.02],
    feathers: [
        { name: 'p2', on: 'hand', root: [0.53, 0.105], tip: [0.83, -0.04] },
        { name: 'p3', on: 'hand', root: [0.51, 0.11], tip: [0.78, -0.09] },
        { name: 'p4', on: 'hand', root: [0.495, 0.115], tip: [0.71, -0.13] },
        { name: 'p5', on: 'hand', root: [0.485, 0.117], tip: [0.64, -0.155] },
        { name: 'p6', on: 'hand', root: [0.48, 0.12], tip: [0.57, -0.17] },
        { name: 's1', on: 'forearm', root: [0.445, 0.109], tip: [0.50, -0.175] },
        { name: 's2', on: 'forearm', root: [0.405, 0.096], tip: [0.435, -0.175] },
        { name: 's3', on: 'forearm', root: [0.365, 0.084], tip: [0.37, -0.172] },
        { name: 's4', on: 'forearm', root: [0.327, 0.072], tip: [0.305, -0.168] },
        { name: 's5', on: 'forearm', root: [0.29, 0.06], tip: [0.245, -0.162] },
        { name: 't1', on: 'humerus', root: [0.22, 0.074], tip: [0.185, -0.15] },
        { name: 't2', on: 'humerus', root: [0.15, 0.087], tip: [0.13, -0.13] },
    ],
};

function wing(side, tag) {
    const at = (p) => [p[0] * side, WING_Y, p[1]];
    const free = { x: [-180, 180], y: [-180, 180], z: [-180, 180] };
    // (`beats`: lab/natural.js does not count a wingbeat as a kink.)
    return [
        { name: `humerus${tag}`, parent: 'body', head: at(WING.shoulder), tail: at(WING.elbow), limits: free, mass: 0.07 },
        { name: `forearm${tag}`, parent: `humerus${tag}`, head: at(WING.elbow), tail: at(WING.wrist), limits: free, mass: 0.04 },
        { name: `hand${tag}`, parent: `forearm${tag}`, head: at(WING.wrist), tail: at(WING.tip), limits: free, mass: 0.02 },
        // (`vane`: nor asks a feather to swing on its own.)
        ...WING.feathers.map((f) => ({ name: `${f.name}${tag}`, parent: `${f.on}${tag}`, head: at(f.root), tail: at(f.tip), limits: free, vane: true })),
    ].map((b) => ({ ...b, beats: true }));
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
      limits: { x: [-95, 80], y: [-60, 60], z: [-30, 30] }, mass: 0.07 },
    ...wing(L, 'L'),
    ...wing(R, 'R'),
    ...leg(L, 'L'),
    ...leg(R, 'R'),
    // The face (lab/skeleton.js). `gaze`: its eyes swing forward and down
    // to look along the bill at what it hunts (x down). `lid`: x raises the
    // lower lid to shut the eye, under 0 it stares; z draws the third
    // eyelid across from the front.
    { name: 'gaze', parent: 'head', face: 'gaze', head: [0, 0.912, 0.237], tail: [0, 0.912, 0.25],
      limits: { x: [-20, 35], y: [-1, 1], z: [-1, 1] } },
    { name: 'lid', parent: 'head', face: 'lid', head: [0, 0.92, 0.237], tail: [0, 0.92, 0.247],
      limits: { x: [-60, 90], y: [-1, 1], z: [-1, 90] } },
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
