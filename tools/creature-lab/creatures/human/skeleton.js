// The human's skeleton: a person of 70 kg, 1.75 m to the crown, standing
// upright on flat feet. A pelvis, a waist and a rib cage, a neck and a
// head; a collar bone out to each shoulder and an arm of three bones that
// hangs to the middle of the thigh; legs of four bones in a row (thigh,
// shin, foot, toes), the foot from the ankle to its ball and the toes on
// from there, so it stands on the whole sole: the heel is behind and under
// the ankle, and the ball and the heel are both on the ground at rest.
//
// The rest pose is how it stands, but for the arms, which are held a third
// of a right angle (32 deg) out from the body so the skin between arm and
// flank is meshed cleanly open (every pose brings them in: poses.js `arm`).
// Facing +Z with +Y up and +X its left, the ground at y = 0, as the lab's
// skeletons are (lab/skeleton.js). `limits` are each joint's range in
// degrees, x the flexion: positive swings a hanging bone's tail backward (a
// thigh back, a knee bent, an upper arm back) and an upright bone's forward
// (the trunk bending over, the head nodding down). z turns a hanging bone's
// tail toward +X (out for the left side's, in for the right's). `mass` in kg.

// Each leg lies in one plane (x constant), as the planar leg solutions want.

const L = 1, R = -1;


function leg(side, tag) {
    const x = 0.09 * side;
    const out = (lo, hi) => (side > 0 ? [lo, hi] : [-hi, -lo]);
    return [
        { name: `thigh${tag}`, parent: 'pelvis', head: [x, 0.92, 0.0], tail: [x, 0.5, 0.02],
          limits: { x: [-136, 50], y: [-45, 45], z: out(-25, 50) }, mass: 7.5 },
        { name: `shin${tag}`, parent: `thigh${tag}`, head: [x, 0.5, 0.02], tail: [x, 0.085, -0.025],
          limits: { x: [-4, 150], y: [-6, 6], z: [-6, 6] }, mass: 3.2 },
        { name: `foot${tag}`, parent: `shin${tag}`, head: [x, 0.085, -0.025], tail: [x, 0.022, 0.115],
          limits: { x: [-66, 84], y: [-22, 22], z: [-24, 24] }, mass: 0.8 },
        { name: `toe${tag}`, parent: `foot${tag}`, head: [x, 0.022, 0.115], tail: [x, 0.004, 0.185],
          limits: { x: [-95, 45], y: [-5, 5], z: [-5, 5] }, mass: 0.15 },
    ];
}

// An arm: a collar bone out to the shoulder, the upper arm, the forearm and
// the hand, abducted 32 deg out from plumb so the armpit meshes cleanly free.
function arm(side, tag) {
    const x = (v) => v * side;
    const out = (lo, hi) => (side > 0 ? [lo, hi] : [-hi, -lo]);
    return [
        { name: `shoulder${tag}`, parent: 'chest', head: [x(0.03), 1.44, 0.01], tail: [x(0.185), 1.435, -0.012],
          limits: { x: [-20, 20], y: [-30, 30], z: out(-15, 35) }, mass: 1.0 },
        { name: `upperarm${tag}`, parent: `shoulder${tag}`, head: [x(0.185), 1.435, -0.012], tail: [x(0.3386), 1.1892, -0.012],
          limits: { x: [-180, 75], y: [-85, 85], z: out(-60, 155) }, mass: 2.0 },
        { name: `forearm${tag}`, parent: `upperarm${tag}`, head: [x(0.3386), 1.1892, -0.012], tail: [x(0.4709), 0.9787, 0.02],
          limits: { x: [-155, 8], y: [-85, 85], z: [-68, 68] }, mass: 1.1 },
        { name: `hand${tag}`, parent: `forearm${tag}`, head: [x(0.4709), 0.9787, 0.02], tail: [x(0.5617), 0.8287, 0.04],
          limits: { x: [-80, 75], y: [-45, 45], z: [-45, 45] }, mass: 0.45 },
    ];
}

export const bones = [
    { name: 'pelvis', parent: null, head: [0, 0.94, 0.0], tail: [0, 1.04, 0.0],
      limits: { x: [-180, 180], y: [-180, 180], z: [-180, 180] }, mass: 9.0 },
    { name: 'spine', parent: 'pelvis', head: [0, 1.04, 0.0], tail: [0, 1.2, 0.005],
      limits: { x: [-30, 60], y: [-35, 35], z: [-30, 30] }, mass: 9.0 },
    { name: 'chest', parent: 'spine', head: [0, 1.2, 0.005], tail: [0, 1.47, -0.01],
      limits: { x: [-25, 40], y: [-35, 35], z: [-25, 25] }, mass: 14.0 },
    { name: 'neck', parent: 'chest', head: [0, 1.47, -0.01], tail: [0, 1.57, 0.01],
      limits: { x: [-50, 55], y: [-60, 60], z: [-35, 35] }, mass: 1.2 },
    { name: 'head', parent: 'neck', head: [0, 1.57, 0.01], tail: [0, 1.75, 0.02],
      limits: { x: [-50, 50], y: [-70, 70], z: [-35, 35] }, mass: 4.5 },
    // The face (lab/skeleton.js): where the eyes look, and the lids' hinge
    // (x shuts them, under 0 opens them wide; z is the brows': over 0 their
    // inner ends lifted, under 0 drawn down).
    { name: 'gaze', parent: 'head', face: 'gaze', head: [0, 1.635, 0.1], tail: [0, 1.635, 0.13],
      limits: { x: [-35, 35], y: [-40, 40], z: [-1, 1] } },
    { name: 'lid', parent: 'head', face: 'lid', head: [0, 1.65, 0.1], tail: [0, 1.65, 0.12],
      limits: { x: [-60, 90], y: [-1, 1], z: [-40, 40] } },
    ...arm(L, 'L'),
    ...arm(R, 'R'),
    ...leg(L, 'L'),
    ...leg(R, 'R'),
];

// The feet: `bone` ends at the toe tip; `heel` is the sole's back end at
// rest (it stands on the whole sole, and lands on that end of it).
export const feet = [
    { name: 'L', bone: 'toeL', hind: true, side: L, heel: [0.09, 0, -0.07] },
    { name: 'R', bone: 'toeR', hind: true, side: R, heel: [-0.09, 0, -0.07] },
];

export const tracks = [
    { name: 'withers', bone: 'chest', at: 0.9 },
    { name: 'hips', bone: 'pelvis', at: 0.0 },
    { name: 'head', bone: 'head', at: 0.5 },
    { name: 'hand', bone: 'handL', at: 1.0 },
    { name: 'elbow', bone: 'forearmL', at: 0.0 },
];

export const chartJoints = ['thighL', 'shinL', 'footL', 'toeL', 'spine', 'chest', 'neck', 'head', 'shoulderL', 'upperarmL', 'forearmL', 'handL'];
