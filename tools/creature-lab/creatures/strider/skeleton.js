// The strider's skeleton: an invented biped of about 36 kg that stands 1.2 m
// to its crown (1.37 to the tips of its ears), with no real animal behind
// it. It goes on two digitigrade legs: a short heavy thigh held forward, a
// long shin back to a raised hock, a long foot down to the ball, and the
// toes it stands on. Its trunk leans forward over them, balanced by a long
// heavy tail; a large head on a short neck, tall ears, slim arms carried
// in front of it.
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
    const x = 0.08 * side;
    const out = (lo, hi) => (side > 0 ? [lo, hi] : [-hi, -lo]);
    return [
        { name: `thigh${tag}`, parent: 'pelvis', head: [x, 0.60, 0.0], tail: [x, 0.405, 0.085],
          limits: { x: [-110, 95], y: [-45, 45], z: out(-30, 45) }, mass: 3.5 },
        { name: `shin${tag}`, parent: `thigh${tag}`, head: [x, 0.405, 0.085], tail: [x, 0.165, -0.085],
          limits: { x: [-50, 110], y: [-6, 6], z: [-6, 6] }, mass: 1.5 },
        { name: `foot${tag}`, parent: `shin${tag}`, head: [x, 0.165, -0.085], tail: [x, 0.022, -0.005],
          limits: { x: [-110, 100], y: [-20, 20], z: [-22, 22] }, mass: 0.6 },
        { name: `toe${tag}`, parent: `foot${tag}`, head: [x, 0.022, -0.005], tail: [x, 0.0, 0.07],
          limits: { x: [-80, 80], y: [-5, 5], z: [-5, 5] }, mass: 0.15 },
    ];
}

function arm(side, tag) {
    const x = (v) => v * side;
    const out = (lo, hi) => (side > 0 ? [lo, hi] : [-hi, -lo]);
    return [
        { name: `shoulder${tag}`, parent: 'chest', head: [x(0.03), 0.925, 0.09], tail: [x(0.09), 0.915, 0.09],
          limits: { x: [-25, 25], y: [-25, 25], z: out(-20, 25) }, mass: 0.4 },
        { name: `upperarm${tag}`, parent: `shoulder${tag}`, head: [x(0.09), 0.915, 0.09], tail: [x(0.135), 0.745, 0.05],
          limits: { x: [-120, 80], y: [-60, 60], z: out(-40, 100) }, mass: 0.9 },
        { name: `forearm${tag}`, parent: `upperarm${tag}`, head: [x(0.135), 0.745, 0.05], tail: [x(0.15), 0.585, 0.12],
          limits: { x: [-130, 25], y: [-50, 50], z: [-15, 15] }, mass: 0.6 },
        { name: `hand${tag}`, parent: `forearm${tag}`, head: [x(0.15), 0.585, 0.12], tail: [x(0.152), 0.50, 0.15],
          limits: { x: [-70, 70], y: [-30, 30], z: [-35, 35] }, mass: 0.3 },
    ];
}

function ear(side, tag) {
    const x = (v) => v * side;
    return [
        { name: `ear1${tag}`, parent: 'head', head: [x(0.067), 1.2, 0.08], tail: [x(0.105), 1.31, 0.062],
          limits: { x: [-50, 70], y: [-40, 40], z: [-45, 45] }, mass: 0.04 },
        { name: `ear2${tag}`, parent: `ear1${tag}`, head: [x(0.105), 1.31, 0.062], tail: [x(0.135), 1.415, 0.04],
          limits: { x: [-50, 70], y: [-30, 30], z: [-45, 45] }, mass: 0.02 },
    ];
}

// The tail: long and heavy, down and back from the base of the spine, its
// tip curving up. x lifts it (positive: the tip up), y swings it aside.
const TAIL = [[0, 0.60, -0.07], [0, 0.52, -0.20], [0, 0.445, -0.36], [0, 0.40, -0.53], [0, 0.41, -0.70], [0, 0.48, -0.84]];
const TAIL_MASS = [0.7, 0.5, 0.35, 0.2, 0.1];

export const bones = [
    { name: 'pelvis', parent: null, head: [0, 0.60, 0.0], tail: [0, 0.68, 0.02],
      limits: { x: [-180, 180], y: [-180, 180], z: [-180, 180] }, mass: 6.0 },
    { name: 'spine', parent: 'pelvis', head: [0, 0.68, 0.02], tail: [0, 0.80, 0.065],
      limits: { x: [-30, 50], y: [-30, 30], z: [-20, 20] }, mass: 4.0 },
    { name: 'chest', parent: 'spine', head: [0, 0.80, 0.065], tail: [0, 0.94, 0.10],
      limits: { x: [-25, 35], y: [-25, 25], z: [-15, 15] }, mass: 5.0 },
    { name: 'neck', parent: 'chest', head: [0, 0.94, 0.10], tail: [0, 1.0, 0.104],
      limits: { x: [-50, 55], y: [-60, 60], z: [-30, 30] }, mass: 0.8 },
    { name: 'head', parent: 'neck', head: [0, 1.0, 0.104], tail: [0, 1.2, 0.115],
      limits: { x: [-50, 50], y: [-60, 60], z: [-30, 30] }, mass: 2.8 },
    ...ear(L, 'L'),
    ...ear(R, 'R'),
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
