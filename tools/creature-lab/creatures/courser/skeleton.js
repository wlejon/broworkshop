// The courser's skeleton: an invented running bird of about 24 kg on the
// strider's legs, 1.2 m to its crown. Its body is a long egg carried level
// over the hips, a little nose-up; a slim neck stands from its front in an
// S to a small head with a hooked bill, a crest of quills swept back from
// the crown; small wings lie folded along the flanks, and a long stiff fan
// of tail feathers is held out behind against the weight of the front.
// Its legs are the strider's: a short thigh held forward along the belly,
// a long shin back to a raised hock, a long slim foot down to the ball,
// and the toes it stands on.
//
// The rest pose is how it stands. Facing +Z with +Y up and +X its left, the
// ground at y = 0, as the lab's skeletons are (lab/skeleton.js). `limits`
// are each joint's range in degrees, x the flexion: positive swings a
// hanging bone's tail backward and an upright bone's forward; a bone
// pointing forward (the trunk, the head) goes nose down with positive x.
// z turns a bone's tail toward +X. `mass` in kg.
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

// A wing: one bone from the shoulder back along the flank, folded. It is a
// piece of its own (body.js), so it can be lifted off the body: y swings its
// tip out (under 0 for the left's), x lifts it.
function wing(side, tag) {
    return [
        { name: `wing${tag}`, parent: 'spine', head: [0.125 * side, 0.865, 0.25], tail: [0.15 * side, 0.82, -0.1],
          limits: { x: [-40, 40], y: [-80, 80], z: [-70, 70] }, mass: 0.5 },
    ];
}

// The neck: three bones in an S from the breast to the skull. Bent forward
// at the bottom and back at the top by as much, it carries the head
// forward and level (poses.js `reach`).
const NECK = [[0, 0.83, 0.32], [0, 0.925, 0.415], [0, 1.05, 0.378], [0, 1.165, 0.40]];
// The tail: three bones, a stiff fan. x lifts it (positive: the tip up), y
// swings it aside.
const TAIL = [[0, 0.745, -0.1], [0, 0.755, -0.3], [0, 0.775, -0.5], [0, 0.8, -0.7]];
const TAIL_MASS = [0.7, 0.4, 0.2];

export const bones = [
    { name: 'pelvis', parent: null, head: [0, 0.72, 0.0], tail: [0, 0.765, 0.1],
      limits: { x: [-180, 180], y: [-180, 180], z: [-180, 180] }, mass: 5.5 },
    { name: 'spine', parent: 'pelvis', head: [0, 0.765, 0.1], tail: [0, 0.8, 0.21],
      limits: { x: [-25, 30], y: [-25, 25], z: [-15, 15] }, mass: 4.2 },
    { name: 'chest', parent: 'spine', head: [0, 0.8, 0.21], tail: [0, 0.83, 0.32],
      limits: { x: [-20, 25], y: [-20, 20], z: [-12, 12] }, mass: 3.6 },
    ...[0, 1, 2].map((i) => ({
        name: `neck${i + 1}`, parent: i ? `neck${i}` : 'chest', head: NECK[i], tail: NECK[i + 1],
        limits: { x: [-70, 80], y: [-50, 50], z: [-25, 25] }, mass: [0.5, 0.35, 0.3][i],
    })),
    { name: 'head', parent: 'neck3', head: [0, 1.165, 0.40], tail: [0, 1.155, 0.56],
      limits: { x: [-95, 70], y: [-80, 80], z: [-35, 35] }, mass: 0.6 },
    // The crest: quills from the back of the crown, lying back; x raises
    // them.
    { name: 'crest1', parent: 'head', head: [0, 1.215, 0.385], tail: [0, 1.235, 0.305],
      limits: { x: [-30, 80], y: [-40, 40], z: [-25, 25] }, mass: 0.02 },
    { name: 'crest2', parent: 'crest1', head: [0, 1.235, 0.305], tail: [0, 1.225, 0.215],
      limits: { x: [-40, 50], y: [-40, 40], z: [-25, 25] }, mass: 0.01 },
    // The face (lab/skeleton.js): a bird's eye barely turns in its head
    // (`gaze`, a few degrees); the lids' hinge: x shuts the eye (under 0
    // opens it wide), z draws the third eyelid across from the front.
    { name: 'gaze', parent: 'head', face: 'gaze', head: [0, 1.185, 0.44], tail: [0, 1.185, 0.47],
      limits: { x: [-20, 20], y: [-20, 20], z: [-1, 1] } },
    { name: 'lid', parent: 'head', face: 'lid', head: [0, 1.195, 0.44], tail: [0, 1.195, 0.46],
      limits: { x: [-60, 90], y: [-1, 1], z: [-1, 90] } },
    ...wing(L, 'L'),
    ...wing(R, 'R'),
    ...leg(L, 'L'),
    ...leg(R, 'R'),
    ...TAIL_MASS.map((mass, i) => ({
        name: `tail${i + 1}`, parent: i ? `tail${i}` : 'pelvis', head: TAIL[i], tail: TAIL[i + 1],
        limits: { x: [-40, 60], y: [-40, 40], z: [-30, 30] }, mass,
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
    { name: 'head', bone: 'head', at: 0.3 },
    { name: 'bill', bone: 'head', at: 1.0 },
    { name: 'tail tip', bone: 'tail3', at: 1.0 },
];

export const chartJoints = ['thighL', 'shinL', 'footL', 'toeL', 'spine', 'chest', 'neck1', 'neck2', 'neck3', 'head', 'tail1', 'tail3'];
