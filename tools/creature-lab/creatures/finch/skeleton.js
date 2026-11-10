// The finch's skeleton: a small songbird of about 24 g, 14 cm from the bill
// to the tail's tip, 9 cm to the crown standing and 24 cm across its spread
// wings. Its body is a plump egg carried a little nose-up, the head close on
// a short neck, a stout conical bill. The tail is long and angled down
// behind. The wings are stood spread (the rig folds them along the flanks
// with their tips over the tail, and opens them to fly).
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

// A wing, stood here spread flat (the rig folds it): the arm's three bones
// from the shoulder out along the leading edge, and the flight feathers,
// each a bone from its root on the arm to its tip at the trailing edge:
// four primaries on the hand (the hand's own line is the outermost), four
// secondaries on the forearm, a tertial on the upper arm. They are the
// rig's to turn (a wing folds by its feathers closing like a fan, each
// over the next), so every one is free about all three axes.
export const WING_Y = 0.062;
export const WING = {
    shoulder: [0.016, 0.02], elbow: [0.034, 0.012], wrist: [0.058, 0.022], tip: [0.122, 0.0],
    feathers: [
        { name: 'p2', on: 'hand', root: [0.070, 0.018], tip: [0.114, -0.012] },
        { name: 'p3', on: 'hand', root: [0.066, 0.019], tip: [0.103, -0.021] },
        { name: 'p4', on: 'hand', root: [0.062, 0.020], tip: [0.090, -0.028] },
        { name: 'p5', on: 'hand', root: [0.058, 0.020], tip: [0.077, -0.032] },
        { name: 's1', on: 'forearm', root: [0.052, 0.018], tip: [0.064, -0.034] },
        { name: 's2', on: 'forearm', root: [0.046, 0.016], tip: [0.052, -0.034] },
        { name: 's3', on: 'forearm', root: [0.040, 0.014], tip: [0.041, -0.033] },
        { name: 's4', on: 'forearm', root: [0.034, 0.012], tip: [0.031, -0.031] },
        { name: 't1', on: 'humerus', root: [0.024, 0.016], tip: [0.021, -0.026] },
    ],
};

function wing(side, tag) {
    const at = (p) => [p[0] * side, WING_Y, p[1]];
    const free = { x: [-180, 180], y: [-180, 180], z: [-180, 180] };
    // (`beats`: lab/natural.js does not count a wingbeat as a kink.)
    return [
        { name: `humerus${tag}`, parent: 'body', head: at(WING.shoulder), tail: at(WING.elbow), limits: free, mass: 0.0009 },
        { name: `forearm${tag}`, parent: `humerus${tag}`, head: at(WING.elbow), tail: at(WING.wrist), limits: free, mass: 0.0005 },
        { name: `hand${tag}`, parent: `forearm${tag}`, head: at(WING.wrist), tail: at(WING.tip), limits: free, mass: 0.0003 },
        ...WING.feathers.map((f) => ({ name: `${f.name}${tag}`, parent: `${f.on}${tag}`, head: at(f.root), tail: at(f.tip), limits: free })),
    ].map((b) => ({ ...b, beats: true }));
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
    // The face (lab/skeleton.js): a bird's eye does not turn in its head, so
    // there is only the lids' hinge. x raises the lower lid to shut the eye
    // (as a bird's shuts); z draws the third eyelid across from the front.
    { name: 'lid', parent: 'head', face: 'lid', head: [0, 0.08, 0.045], tail: [0, 0.08, 0.048],
      limits: { x: [-10, 90], y: [-1, 1], z: [-1, 90] } },
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
