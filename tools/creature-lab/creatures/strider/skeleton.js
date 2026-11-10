// The strider's skeleton: an invented biped of about 30 kg that carries its
// body level over two long legs, as a running bird does, with no real animal
// behind it. Its trunk rises forward from the hips at a third of a right
// angle and is balanced over the feet by a long tail held out behind; a fox's
// head on a short upright neck, tall ears (1.2 m to the crown, 1.4 to their
// tips), and small arms folded at its chest. Its legs are digitigrade: a
// short thigh held forward along the belly, a long shin back to a raised
// hock, a long slim foot down to the ball, and the toes it stands on.
//
// The rest pose is how it stands. Facing +Z with +Y up and +X its left, the
// ground at y = 0, as the lab's skeletons are (lab/skeleton.js). `limits`
// are each joint's range in degrees, x the flexion: positive swings a
// hanging bone's tail backward (a thigh back, a knee bent, an upper arm
// back) and an upright bone's forward (the trunk bending over, the head
// nodding down); a foot pointing forward goes toe down with positive x.
// z turns a bone's tail toward +X (out for the left side's, in for the
// right's). `mass` in kg.
//
// Each leg lies in one plane (x constant), as the planar leg solutions want.

const L = 1, R = -1;

function leg(side, tag) {
    const x = 0.075 * side;
    const out = (lo, hi) => (side > 0 ? [lo, hi] : [-hi, -lo]);
    return [
        { name: `thigh${tag}`, parent: 'pelvis', head: [x, 0.72, 0.0], tail: [x, 0.585, 0.165],
          limits: { x: [-110, 95], y: [-45, 45], z: out(-30, 45) }, mass: 3.0 },
        { name: `shin${tag}`, parent: `thigh${tag}`, head: [x, 0.585, 0.165], tail: [x, 0.275, -0.03],
          limits: { x: [-60, 115], y: [-6, 6], z: [-6, 6] }, mass: 1.2 },
        { name: `foot${tag}`, parent: `shin${tag}`, head: [x, 0.275, -0.03], tail: [x, 0.03, 0.06],
          limits: { x: [-120, 110], y: [-20, 20], z: [-22, 22] }, mass: 0.5 },
        { name: `toe${tag}`, parent: `foot${tag}`, head: [x, 0.03, 0.06], tail: [x, 0.0, 0.145],
          limits: { x: [-90, 90], y: [-5, 5], z: [-5, 5] }, mass: 0.15 },
    ];
}

// The arms: small, from the front of the chest. (At rest they reach
// forward and down, clear of the body, so each is meshed in a skin of its
// own, and lie in a plane fore and aft, so they fold about one axis; every
// pose folds them to the breast: poses.js `arm`.)
function arm(side, tag) {
    const x = (v) => v * side;
    const out = (lo, hi) => (side > 0 ? [lo, hi] : [-hi, -lo]);
    return [
        { name: `shoulder${tag}`, parent: 'chest', head: [x(0.07), 0.88, 0.218], tail: [x(0.106), 0.87, 0.23],
          limits: { x: [-25, 25], y: [-25, 25], z: out(-20, 25) }, mass: 0.3 },
        { name: `upperarm${tag}`, parent: `shoulder${tag}`, head: [x(0.106), 0.87, 0.23], tail: [x(0.133), 0.792, 0.306],
          limits: { x: [-120, 110], y: [-60, 60], z: out(-40, 60) }, mass: 0.5 },
        { name: `forearm${tag}`, parent: `upperarm${tag}`, head: [x(0.133), 0.792, 0.306], tail: [x(0.149), 0.715, 0.382],
          limits: { x: [-150, 25], y: [-50, 50], z: [-15, 15] }, mass: 0.35 },
        { name: `hand${tag}`, parent: `forearm${tag}`, head: [x(0.149), 0.715, 0.382], tail: [x(0.155), 0.671, 0.424],
          limits: { x: [-80, 80], y: [-30, 30], z: [-35, 35] }, mass: 0.15 },
    ];
}

function ear(side, tag) {
    const x = (v) => v * side;
    return [
        { name: `ear1${tag}`, parent: 'head', head: [x(0.067), 1.2, 0.221], tail: [x(0.105), 1.31, 0.203],
          limits: { x: [-80, 70], y: [-40, 40], z: [-45, 45] }, mass: 0.04 },
        { name: `ear2${tag}`, parent: `ear1${tag}`, head: [x(0.105), 1.31, 0.203], tail: [x(0.135), 1.415, 0.181],
          limits: { x: [-65, 70], y: [-30, 30], z: [-45, 45] }, mass: 0.02 },
    ];
}

// The tail: long, out behind as the body's counterweight, dipping from the
// hips and curving up to its brush. x lifts it (positive: the tip up), y
// swings it aside.
const TAIL = [[0, 0.715, -0.07], [0, 0.69, -0.23], [0, 0.672, -0.41], [0, 0.68, -0.59], [0, 0.725, -0.76], [0, 0.81, -0.91]];
const TAIL_MASS = [1.0, 0.8, 0.55, 0.35, 0.2];

export const bones = [
    { name: 'pelvis', parent: null, head: [0, 0.72, 0.0], tail: [0, 0.775, 0.06],
      limits: { x: [-180, 180], y: [-180, 180], z: [-180, 180] }, mass: 4.8 },
    { name: 'spine', parent: 'pelvis', head: [0, 0.775, 0.06], tail: [0, 0.835, 0.14],
      limits: { x: [-30, 50], y: [-30, 30], z: [-20, 20] }, mass: 3.6 },
    { name: 'chest', parent: 'spine', head: [0, 0.835, 0.14], tail: [0, 0.905, 0.215],
      limits: { x: [-25, 35], y: [-25, 25], z: [-15, 15] }, mass: 4.6 },
    { name: 'neck', parent: 'chest', head: [0, 0.905, 0.215], tail: [0, 1.0, 0.245],
      limits: { x: [-50, 55], y: [-60, 60], z: [-30, 30] }, mass: 0.7 },
    { name: 'head', parent: 'neck', head: [0, 1.0, 0.245], tail: [0, 1.2, 0.256],
      limits: { x: [-50, 50], y: [-60, 60], z: [-30, 30] }, mass: 2.2 },
    ...ear(L, 'L'),
    ...ear(R, 'R'),
    // The face (lab/skeleton.js): where the eyes look, and the lids' hinge
    // (x shuts them, under 0 opens them wide; z tilts them).
    { name: 'gaze', parent: 'head', face: 'gaze', head: [0, 1.14, 0.33], tail: [0, 1.14, 0.36],
      limits: { x: [-35, 35], y: [-40, 40], z: [-1, 1] } },
    { name: 'lid', parent: 'head', face: 'lid', head: [0, 1.16, 0.33], tail: [0, 1.16, 0.35],
      limits: { x: [-60, 90], y: [-1, 1], z: [-30, 30] } },
    ...arm(L, 'L'),
    ...arm(R, 'R'),
    ...leg(L, 'L'),
    ...leg(R, 'R'),
    ...TAIL_MASS.map((mass, i) => ({
        name: `tail${i + 1}`, parent: i ? `tail${i}` : 'pelvis', head: TAIL[i], tail: TAIL[i + 1],
        limits: { x: [-45, 50], y: [-45, 45], z: [-30, 30] }, mass,
    })),
];

// The feet: `bone` ends at the toe tip.
export const feet = [
    { name: 'L', bone: 'toeL', hind: true, side: L },
    { name: 'R', bone: 'toeR', hind: true, side: R },
];

export const tracks = [
    { name: 'withers', bone: 'chest', at: 0.9 },
    { name: 'hips', bone: 'pelvis', at: 0.0 },
    { name: 'head', bone: 'head', at: 0.5 },
    { name: 'hand', bone: 'handL', at: 1.0 },
    { name: 'tail tip', bone: 'tail5', at: 1.0 },
];

export const chartJoints = ['thighL', 'shinL', 'footL', 'toeL', 'spine', 'chest', 'neck', 'head', 'upperarmL', 'forearmL', 'tail1', 'tail3'];
