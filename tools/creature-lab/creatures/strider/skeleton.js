// The strider's skeleton: an invented upright biped of about 38 kg, 1.3 m
// from its soles to the crown, with no real animal behind it. It walks and
// runs on two plantigrade legs (heel, sole, toes), its trunk upright over
// them, and its long arms hang to its knees and swing as it goes. A round
// head on a short neck, and a long tail that balances it.
//
// The rest pose stands tall, the arms held 13 degrees out from the flanks
// (so the skin of each is its own); the rig lets them hang closer. Facing +Z with +Y up and +X its left, the ground at y = 0, as the
// lab's skeletons are (lab/skeleton.js). `limits` are each joint's range in
// degrees, x the flexion: positive swings a hanging bone's tail backward
// (a thigh back, a knee bent, an upper arm back) and an upright bone's
// forward (the trunk bending over, the head nodding down); a foot pointing
// forward goes toe down with positive x. z turns a bone's tail toward +X
// (out for the left side's, in for the right's). `mass` in kg.
//
// Each leg lies in one plane (x constant) for the planar leg solutions:
// the thigh turns the plane out (z) and then flexes in it (x), and turns
// about its length against the pelvis's turn, so its ranges read back with
// some y.

const L = 1, R = -1;

function leg(side, tag) {
    const x = 0.085 * side;
    const out = (lo, hi) => (side > 0 ? [lo, hi] : [-hi, -lo]);
    return [
        { name: `thigh${tag}`, parent: 'pelvis', head: [x, 0.665, 0.0], tail: [x, 0.37, 0.012],
          limits: { x: [-115, 50], y: [-45, 45], z: out(-30, 45) }, mass: 4.2 },
        { name: `shin${tag}`, parent: `thigh${tag}`, head: [x, 0.37, 0.012], tail: [x, 0.078, -0.012],
          limits: { x: [-2, 150], y: [-6, 6], z: [-6, 6] }, mass: 2.1 },
        { name: `foot${tag}`, parent: `shin${tag}`, head: [x, 0.078, -0.012], tail: [x, 0.018, 0.118],
          limits: { x: [-42, 55], y: [-12, 12], z: [-14, 14] }, mass: 0.7 },
        { name: `toe${tag}`, parent: `foot${tag}`, head: [x, 0.018, 0.118], tail: [x, 0.0, 0.168],
          limits: { x: [-65, 30], y: [-5, 5], z: [-5, 5] }, mass: 0.15 },
    ];
}

function arm(side, tag) {
    const x = (v) => v * side;
    const out = (lo, hi) => (side > 0 ? [lo, hi] : [-hi, -lo]);
    return [
        { name: `shoulder${tag}`, parent: 'chest', head: [x(0.04), 1.01, -0.012], tail: [x(0.175), 1.0, -0.018],
          limits: { x: [-25, 25], y: [-20, 20], z: out(-20, 25) }, mass: 0.6 },
        { name: `upperarm${tag}`, parent: `shoulder${tag}`, head: [x(0.175), 1.0, -0.018], tail: [x(0.238), 0.742, -0.03],
          limits: { x: [-100, 70], y: [-50, 50], z: out(-30, 90) }, mass: 1.6 },
        { name: `forearm${tag}`, parent: `upperarm${tag}`, head: [x(0.238), 0.742, -0.03], tail: [x(0.29), 0.505, -0.005],
          limits: { x: [-145, 5], y: [-40, 40], z: [-10, 10] }, mass: 0.9 },
        { name: `hand${tag}`, parent: `forearm${tag}`, head: [x(0.29), 0.505, -0.005], tail: [x(0.305), 0.395, 0.01],
          limits: { x: [-60, 70], y: [-30, 30], z: [-35, 35] }, mass: 0.4 },
    ];
}

export const bones = [
    { name: 'pelvis', parent: null, head: [0, 0.665, 0.0], tail: [0, 0.77, -0.012],
      limits: { x: [-180, 180], y: [-180, 180], z: [-180, 180] }, mass: 6.5 },
    { name: 'spine', parent: 'pelvis', head: [0, 0.77, -0.012], tail: [0, 0.895, -0.02],
      limits: { x: [-25, 45], y: [-25, 25], z: [-18, 18] }, mass: 5.0 },
    { name: 'chest', parent: 'spine', head: [0, 0.895, -0.02], tail: [0, 1.06, -0.005],
      limits: { x: [-18, 25], y: [-22, 22], z: [-12, 12] }, mass: 6.5 },
    { name: 'neck', parent: 'chest', head: [0, 1.055, 0.0], tail: [0, 1.115, 0.018],
      limits: { x: [-45, 50], y: [-60, 60], z: [-25, 25] }, mass: 0.9 },
    { name: 'head', parent: 'neck', head: [0, 1.115, 0.018], tail: [0, 1.29, 0.05],
      limits: { x: [-45, 45], y: [-55, 55], z: [-25, 25] }, mass: 2.8 },
    ...arm(L, 'L'),
    ...arm(R, 'R'),
    ...leg(L, 'L'),
    ...leg(R, 'R'),
    // The tail: long and bushy, out from the base of the spine, hanging back
    // and down, its tip curving up. x lifts it (positive: the tip up), y
    // swings it to the side.
    { name: 'tail1', parent: 'pelvis', head: [0, 0.665, -0.07], tail: [0, 0.6, -0.17],
      limits: { x: [-45, 50], y: [-45, 45], z: [-30, 30] }, mass: 0.45 },
    { name: 'tail2', parent: 'tail1', head: [0, 0.6, -0.17], tail: [0, 0.54, -0.3],
      limits: { x: [-35, 40], y: [-40, 40], z: [-25, 25] }, mass: 0.35 },
    { name: 'tail3', parent: 'tail2', head: [0, 0.54, -0.3], tail: [0, 0.515, -0.43],
      limits: { x: [-35, 40], y: [-40, 40], z: [-25, 25] }, mass: 0.25 },
    { name: 'tail4', parent: 'tail3', head: [0, 0.515, -0.43], tail: [0, 0.545, -0.56],
      limits: { x: [-35, 45], y: [-45, 45], z: [-25, 25] }, mass: 0.12 },
];

// The feet: `bone` ends at the toe, the point the rig plants.
export const feet = [
    { name: 'L', bone: 'toeL', hind: true, side: L },
    { name: 'R', bone: 'toeR', hind: true, side: R },
];

export const tracks = [
    { name: 'withers', bone: 'chest', at: 0.9 },
    { name: 'hips', bone: 'pelvis', at: 0.0 },
    { name: 'head', bone: 'head', at: 0.5 },
    { name: 'hand', bone: 'handL', at: 1.0 },
    { name: 'tail tip', bone: 'tail4', at: 1.0 },
];

export const chartJoints = ['thighL', 'shinL', 'footL', 'toeL', 'spine', 'chest', 'neck', 'head', 'upperarmL', 'forearmL', 'tail1', 'tail3'];
