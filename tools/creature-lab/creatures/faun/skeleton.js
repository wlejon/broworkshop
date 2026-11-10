// The faun's skeleton: an invented upright biped of about 34 kg on the
// strider's legs, 1.33 m to its crown and 1.45 to the top of its horns. A
// narrow trunk stands over the hips, leaning a little forward so its weight
// is over the toes; square shoulders with long arms that hang to the
// thighs; a short neck and a long-muzzled head with two horns swept back, a
// drooping ear each side; a short upturned tail. Its legs are the
// strider's: a short thigh held forward, a long shin back to a raised hock,
// a long slim foot down to the ball, and the toes it stands on.
//
// The rest pose is how it stands, but for the arms, which are held a fifth
// of a right angle out from the body so the skin between arm and flank is
// meshed open (every pose brings them in: poses.js `arm`). Facing +Z with
// +Y up and +X its left, the ground at y = 0, as the lab's skeletons are
// (lab/skeleton.js). `limits` are each joint's range in degrees, x the
// flexion: positive swings a hanging bone's tail backward (a thigh back, a
// knee bent, an upper arm back) and an upright bone's forward (the trunk
// bending over, the head nodding down). z turns a hanging bone's tail
// toward +X (out for the left side's, in for the right's). `mass` in kg.
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

// An arm: a collar bone out to the shoulder, the upper arm, the forearm and
// the hand, hanging a fifth of a right angle out.
function arm(side, tag) {
    const x = (v) => v * side;
    const out = (lo, hi) => (side > 0 ? [lo, hi] : [-hi, -lo]);
    return [
        { name: `shoulder${tag}`, parent: 'chest', head: [x(0.045), 1.035, 0.07], tail: [x(0.145), 1.04, 0.062],
          limits: { x: [-20, 20], y: [-30, 30], z: out(-15, 35) }, mass: 0.6 },
        { name: `upperarm${tag}`, parent: `shoulder${tag}`, head: [x(0.145), 1.04, 0.062], tail: [x(0.222), 0.815, 0.058],
          limits: { x: [-170, 70], y: [-70, 70], z: out(-40, 150) }, mass: 1.1 },
        { name: `forearm${tag}`, parent: `upperarm${tag}`, head: [x(0.222), 0.815, 0.058], tail: [x(0.29), 0.612, 0.085],
          limits: { x: [-150, 8], y: [-70, 70], z: [-15, 15] }, mass: 0.7 },
        { name: `hand${tag}`, parent: `forearm${tag}`, head: [x(0.29), 0.612, 0.085], tail: [x(0.322), 0.52, 0.1],
          limits: { x: [-80, 80], y: [-30, 30], z: [-35, 35] }, mass: 0.25 },
    ];
}

export const bones = [
    { name: 'pelvis', parent: null, head: [0, 0.72, 0.0], tail: [0, 0.8, 0.015],
      limits: { x: [-180, 180], y: [-180, 180], z: [-180, 180] }, mass: 5.0 },
    { name: 'spine', parent: 'pelvis', head: [0, 0.8, 0.015], tail: [0, 0.925, 0.042],
      limits: { x: [-30, 55], y: [-35, 35], z: [-25, 25] }, mass: 5.0 },
    { name: 'chest', parent: 'spine', head: [0, 0.925, 0.042], tail: [0, 1.065, 0.072],
      limits: { x: [-25, 40], y: [-30, 30], z: [-20, 20] }, mass: 6.5 },
    { name: 'neck', parent: 'chest', head: [0, 1.065, 0.072], tail: [0, 1.15, 0.092],
      limits: { x: [-50, 55], y: [-60, 60], z: [-30, 30] }, mass: 0.8 },
    { name: 'head', parent: 'neck', head: [0, 1.15, 0.092], tail: [0, 1.33, 0.1],
      limits: { x: [-50, 50], y: [-70, 70], z: [-30, 30] }, mass: 2.4 },
    // The ears: one bone each, out to the side and drooping; x swings one
    // back, z lifts or lowers it.
    { name: 'earL', parent: 'head', head: [0.072, 1.262, 0.085], tail: [0.185, 1.238, 0.06],
      limits: { x: [-50, 50], y: [-85, 85], z: [-60, 60] }, mass: 0.04 },
    { name: 'earR', parent: 'head', head: [-0.072, 1.262, 0.085], tail: [-0.185, 1.238, 0.06],
      limits: { x: [-50, 50], y: [-85, 85], z: [-60, 60] }, mass: 0.04 },
    // The face (lab/skeleton.js): where the eyes look, and the lids' hinge
    // (x shuts them, under 0 opens them wide; z is the brows': over 0 their
    // inner ends lifted, under 0 drawn down).
    { name: 'gaze', parent: 'head', face: 'gaze', head: [0, 1.255, 0.17], tail: [0, 1.255, 0.2],
      limits: { x: [-35, 35], y: [-40, 40], z: [-1, 1] } },
    { name: 'lid', parent: 'head', face: 'lid', head: [0, 1.27, 0.17], tail: [0, 1.27, 0.19],
      limits: { x: [-60, 90], y: [-1, 1], z: [-40, 40] } },
    ...arm(L, 'L'),
    ...arm(R, 'R'),
    ...leg(L, 'L'),
    ...leg(R, 'R'),
    // The tail: short and upturned. x lifts it, y swings it aside.
    { name: 'tail1', parent: 'pelvis', head: [0, 0.745, -0.095], tail: [0, 0.79, -0.165],
      limits: { x: [-70, 60], y: [-50, 50], z: [-30, 30] }, mass: 0.15 },
    { name: 'tail2', parent: 'tail1', head: [0, 0.79, -0.165], tail: [0, 0.865, -0.195],
      limits: { x: [-60, 50], y: [-50, 50], z: [-30, 30] }, mass: 0.08 },
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
    { name: 'tail tip', bone: 'tail2', at: 1.0 },
];

export const chartJoints = ['thighL', 'shinL', 'footL', 'toeL', 'spine', 'chest', 'neck', 'head', 'shoulderL', 'upperarmL', 'forearmL', 'handL'];
