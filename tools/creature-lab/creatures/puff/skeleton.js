// The puff's skeleton: an invented ball of feathers of about 16 kg on the
// strider's legs, 1.15 m to its crown. A round body sits on the hips and a
// round head sits in the top of it with no neck between, an owl's wide
// face on its front: two great eyes, a small hooked bill, a feathered tuft
// over each brow. A short wing hangs down each side and a short fan of a
// tail sticks out behind. Its legs are the strider's: a short thigh held
// forward (here inside the body's feathers), a long shin back to a raised
// hock, a long slim foot down to the ball, and the toes it stands on.
//
// The head turns about its own middle, so it swivels inside the body's
// outline as an owl's does.
//
// The rest pose is how it stands. Facing +Z with +Y up and +X its left, the
// ground at y = 0, as the lab's skeletons are (lab/skeleton.js). `limits`
// are each joint's range in degrees, x the flexion: positive swings a
// hanging bone's tail backward and an upright bone's forward (the body
// tipping over, the head nodding down). z turns a hanging bone's tail
// toward +X (out for the left side's, in for the right's). `mass` in kg.
//
// Each leg lies in one plane (x constant), as the planar leg solutions want.

const L = 1, R = -1;

function leg(side, tag) {
    const x = 0.075 * side;
    const out = (lo, hi) => (side > 0 ? [lo, hi] : [-hi, -lo]);
    return [
        { name: `thigh${tag}`, parent: 'pelvis', head: [x, 0.72, 0.0], tail: [x, 0.585, 0.165],
          limits: { x: [-110, 95], y: [-45, 45], z: out(-30, 45) }, mass: 1.4 },
        { name: `shin${tag}`, parent: `thigh${tag}`, head: [x, 0.585, 0.165], tail: [x, 0.275, -0.03],
          limits: { x: [-60, 115], y: [-6, 6], z: [-6, 6] }, mass: 0.7 },
        { name: `foot${tag}`, parent: `shin${tag}`, head: [x, 0.275, -0.03], tail: [x, 0.03, 0.06],
          limits: { x: [-120, 110], y: [-20, 20], z: [-22, 22] }, mass: 0.3 },
        { name: `toe${tag}`, parent: `foot${tag}`, head: [x, 0.03, 0.06], tail: [x, 0.0, 0.145],
          limits: { x: [-90, 90], y: [-5, 5], z: [-5, 5] }, mass: 0.15 },
    ];
}

export const bones = [
    { name: 'pelvis', parent: null, head: [0, 0.72, 0.0], tail: [0, 0.8, 0.04],
      limits: { x: [-180, 180], y: [-180, 180], z: [-180, 180] }, mass: 4.0 },
    // The body's ball, and the head in the top of it.
    { name: 'chest', parent: 'pelvis', head: [0, 0.8, 0.04], tail: [0, 0.95, 0.075],
      limits: { x: [-30, 40], y: [-35, 35], z: [-25, 25] }, mass: 6.0 },
    { name: 'head', parent: 'chest', head: [0, 0.95, 0.075], tail: [0, 1.13, 0.08],
      limits: { x: [-50, 60], y: [-135, 135], z: [-50, 50] }, mass: 2.0 },
    // A tuft over each brow: x under 0 lays it back, z spreads it out and
    // down (under 0 for the left's).
    { name: 'tuftL', parent: 'head', head: [0.095, 1.105, 0.1], tail: [0.15, 1.235, 0.06],
      limits: { x: [-80, 40], y: [-30, 30], z: [-70, 40] }, mass: 0.02 },
    { name: 'tuftR', parent: 'head', head: [-0.095, 1.105, 0.1], tail: [-0.15, 1.235, 0.06],
      limits: { x: [-80, 40], y: [-30, 30], z: [-40, 70] }, mass: 0.02 },
    // The face (lab/skeleton.js): where the eyes look (a little: they are
    // nearly fixed in the head), and the lids' hinge: x shuts both (under
    // 0 opens them wide), z winks one (over 0 the left, under 0 the right).
    { name: 'gaze', parent: 'head', face: 'gaze', head: [0, 0.985, 0.25], tail: [0, 0.985, 0.28],
      limits: { x: [-25, 25], y: [-25, 25], z: [-1, 1] } },
    { name: 'lid', parent: 'head', face: 'lid', head: [0, 1.0, 0.25], tail: [0, 1.0, 0.27],
      limits: { x: [-60, 90], y: [-1, 1], z: [-90, 90] } },
    // A wing: one bone hanging down the side from the shoulder, a piece of
    // its own (body.js). z lifts it out from the body (over 0 for the
    // left's), x swings it back.
    { name: 'wingL', parent: 'chest', head: [0.2, 0.93, 0.05], tail: [0.245, 0.71, 0.0],
      limits: { x: [-60, 100], y: [-40, 40], z: [-10, 120] }, mass: 0.4 },
    { name: 'wingR', parent: 'chest', head: [-0.2, 0.93, 0.05], tail: [-0.245, 0.71, 0.0],
      limits: { x: [-60, 100], y: [-40, 40], z: [-120, 10] }, mass: 0.4 },
    ...leg(L, 'L'),
    ...leg(R, 'R'),
    // The tail: a short fan. x lifts it, y swings it aside.
    { name: 'tail1', parent: 'pelvis', head: [0, 0.75, -0.17], tail: [0, 0.725, -0.29],
      limits: { x: [-50, 70], y: [-50, 50], z: [-30, 30] }, mass: 0.15 },
    { name: 'tail2', parent: 'tail1', head: [0, 0.725, -0.29], tail: [0, 0.71, -0.4],
      limits: { x: [-40, 50], y: [-40, 40], z: [-30, 30] }, mass: 0.08 },
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
    { name: 'wing tip', bone: 'wingL', at: 1.0 },
    { name: 'tail tip', bone: 'tail2', at: 1.0 },
];

export const chartJoints = ['thighL', 'shinL', 'footL', 'toeL', 'chest', 'head', 'wingL', 'tuftL', 'tail1'];
