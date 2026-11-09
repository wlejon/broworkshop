// The strider's keys: the poses it is drawn in and the cycles made of them
// (lab/posing.js has the form). Angles in degrees, lengths in metres. A
// pose places the feet (the ball of each from where it rests) and turns the
// bones off the legs; the legs are solved.
//
// Sides: a pose is drawn with the left leg leading; a cycle's second half
// is its first mirrored.

const TAU = 2 * Math.PI;

// A bone of both sides turned alike: [x, y, z] on the left, mirrored on the right.
const both = (name, [x, y, z]) => ({ [`${name}L`]: [x, y, z], [`${name}R`]: [x, -y, -z] });

// The arms: each upper arm's swing (deg back), its elbow's bend, and how
// far the elbows are held in from the rest pose's.
const arms = (backL, backR, bendL, bendR, inn = 9, wrist = 18) => ({
    upperarmL: [backL, 0, -inn], upperarmR: [backR, 0, inn],
    forearmL: [-bendL, 0, 0], forearmR: [-bendR, 0, 0],
    handL: [wrist, 0, 0], handR: [wrist, 0, 0],
});

// The tail at phase ph of a stride: lifted by `lift` (deg, shared down its
// joints), swinging `swing` deg side to side against the hips' turn, each
// joint a little after the one before and a little further (a whip), and
// bobbing twice a stride.
function tail(ph, { lift = 0, swing = 0, bob = 0, lag = 0.09, curl = 0 } = {}) {
    const out = {};
    for (let i = 0; i < 5; i++) {
        const y = swing * (0.6 + 0.2 * i) * Math.cos(TAU * (ph - 0.1 - lag * i));
        const x = lift * [0.4, 0.25, 0.15, 0.1, 0.1][i] + bob * Math.cos(2 * TAU * (ph - 0.12 * i)) + (i >= 3 ? curl : 0);
        out[`tail${i + 1}`] = [x, y, 0];
    }
    return out;
}

// The ears at phase ph: tipped back by `back`, nodding twice a stride.
const ears = (ph, back = 0, nod = 0) => ({
    ...both('ear1', [-back - nod * Math.cos(2 * TAU * (ph - 0.08)), 0, 0]),
    ...both('ear2', [-0.6 * back - 1.5 * nod * Math.cos(2 * TAU * (ph - 0.2)), 0, 0]),
});

// --- the walk: a springy strut, the ball of the foot down first ----------------
// Four poses a step. The hips drop as a foot takes the weight and rise over
// it, sway toward it and turn with the leg ahead; the chest turns against
// them; the arms swing against the legs.
const walk = {
    // The leading foot touches down, the trailing one on its toes.
    contact: {
        root: [-0.008, -0.026, 0.0], turn: [5, -8, -1],
        bones: {
            spine: [1, 5, 1], chest: [0, 7, 1], neck: [-3, -2, 0], head: [-2, -2, 0],
            ...arms(24, -26, 14, 42), ...tail(0, { lift: 8, swing: 9, bob: 2 }), ...ears(0, 4, 3),
        },
        feet: { L: { at: [-0.02, 0.0, 0.23], heel: -6, toe: -16 }, R: { at: [0.02, 0.0, -0.205], heel: 36 } },
    },
    // The weight comes on: the lowest, the leading leg giving.
    down: {
        root: [0.01, -0.036, 0.0], turn: [6, -6, 2],
        bones: {
            spine: [2, 4, -1], chest: [1, 6, -1], neck: [-4, -2, 0], head: [-3, -2, 0],
            ...arms(27, -29, 12, 48), ...tail(0.07, { lift: 8, swing: 9, bob: 2 }), ...ears(0.07, 4, 3),
        },
        feet: { L: { at: [-0.02, 0.0, 0.152], heel: -12 }, R: { at: [0.02, 0.016, -0.283], heel: 54, toe: 12 } },
    },
    // Passing: tall over the standing leg, the other drawn up and through.
    pass: {
        root: [0.032, -0.008, 0.0], turn: [4, 0, 5],
        bones: {
            spine: [0, 0, -3], chest: [0, 0, -3], neck: [-2, 0, 1], head: [-1, 0, 1],
            ...arms(0, 0, 24, 24), ...tail(0.25, { lift: 8, swing: 9, bob: 2 }), ...ears(0.25, 4, 3),
        },
        feet: { L: { at: [-0.02, 0.0, 0.012], heel: -4 }, R: { at: [0.01, 0.1, -0.1], heel: 58, toe: 28 } },
    },
    // Pushing off: up onto the toes, the free leg reaching ahead.
    up: {
        root: [0.024, -0.014, 0.0], turn: [5, 5, 3],
        bones: {
            spine: [1, -3, -2], chest: [0, -4, -2], neck: [-3, 1, 1], head: [-2, 1, 0],
            ...arms(-16, 14, 34, 18), ...tail(0.4, { lift: 8, swing: 9, bob: 2 }), ...ears(0.4, 4, 3),
        },
        feet: { L: { at: [-0.02, 0.0, -0.118], heel: 18 }, R: { at: [-0.01, 0.07, 0.19], heel: -2, toe: -26 } },
    },
};

// --- the run: leaning into it, a flight between steps -------------------------
// Four poses a step: the foot lands near under the hip, the leg gives, pushes
// off long behind, and the body flies. The tail is carried level behind, the
// ears laid back, the arms pumping with the elbows bent.
// (The heights are what its time in the air allows: a tenth of a second off
// the ground is a centimetre and a half of rise.)
const RUN_TAIL = { lift: 26, swing: 5, bob: 2 };
const run = {
    contact: {
        root: [-0.004, -0.018, 0.0], turn: [23, -9, -1],
        bones: {
            spine: [4, 5, 1], chest: [2, 8, 1], neck: [-14, -2, 0], head: [-13, -2, 0],
            ...arms(34, -40, 60, 96, 12, 10), ...tail(0, RUN_TAIL), ...ears(0, 30, 4),
        },
        feet: { L: { at: [-0.03, 0.0, 0.2], heel: 2, toe: -10 }, R: { at: [0.01, 0.16, -0.22], heel: 62, toe: 30 } },
    },
    down: {
        root: [0.008, -0.05, 0.0], turn: [25, -6, 2],
        bones: {
            spine: [5, 3, -1], chest: [3, 5, -1], neck: [-15, -1, 0], head: [-14, -1, 0],
            ...arms(26, -30, 66, 92, 12, 10), ...tail(0.1, RUN_TAIL), ...ears(0.1, 30, 4),
        },
        feet: { L: { at: [-0.03, 0.0, 0.035], heel: -12 }, R: { at: [0.01, 0.13, -0.02], heel: 56, toe: 30 } },
    },
    push: {
        root: [0.012, -0.022, 0.0], turn: [23, 7, 3],
        bones: {
            spine: [3, -4, -2], chest: [2, -6, -2], neck: [-14, 1, 0], head: [-12, 1, 0],
            ...arms(-30, 26, 92, 62, 12, 10), ...tail(0.26, RUN_TAIL), ...ears(0.26, 30, 4),
        },
        feet: { L: { at: [-0.02, 0.01, -0.235], heel: 46 }, R: { at: [-0.005, 0.12, 0.26], heel: 18, toe: -10 } },
    },
    flight: {
        root: [0.006, 0.0, 0.0], turn: [22, 9, 1],
        bones: {
            spine: [2, -5, -1], chest: [2, -8, -1], neck: [-13, 2, 0], head: [-12, 2, 0],
            ...arms(-38, 32, 96, 60, 12, 10), ...tail(0.4, RUN_TAIL), ...ears(0.4, 30, 4),
        },
        feet: { L: { at: [-0.01, 0.14, -0.31], heel: 62, toe: 26 }, R: { at: [-0.02, 0.08, 0.27], heel: 6, toe: -18 } },
    },
};

export const poses = {
    // Standing: as the skeleton stands it, the arms hanging in.
    stand: { bones: { ...arms(-6, -6, 26, 26), ...tail(0, { lift: 0 }) } },
    'walk-contact': walk.contact,
    'walk-down': walk.down,
    'walk-pass': walk.pass,
    'walk-up': walk.up,
    'run-contact': run.contact,
    'run-down': run.down,
    'run-push': run.push,
    'run-flight': run.flight,
    // Alert: drawn up tall, the ears up and forward, the hands at its chest.
    alert: {
        root: [0, 0.035, -0.01], turn: [-9, 0, 0],
        bones: { spine: [-3, 0, 0], neck: [-6, 0, 0], head: [4, 0, 0], ...arms(-14, -14, 100, 100, 12, 30), ...tail(0, { lift: 22, curl: 8 }), ...ears(0, -8) },
        feet: { L: { heel: 8 }, R: { heel: 8 } },
    },
    // Flinching: down and back from what startled it, the ears flat.
    flinch: {
        root: [0, -0.13, -0.04], turn: [14, 0, 0],
        bones: { spine: [8, 0, 0], neck: [-14, 0, 0], head: [-6, 0, 0], ...arms(-30, -30, 110, 110, -6, 20), ...tail(0, { lift: 40, curl: 10 }), ...ears(0, 62) },
        feet: { L: { at: [0.02, 0, 0], heel: -16 }, R: { at: [-0.02, 0, 0], heel: -16 } },
    },
    // Foraging: crouched low over the ground, the nose and hands down to it,
    // the tail up behind.
    forage: {
        root: [0, -0.26, -0.07], turn: [54, 0, 0],
        bones: { spine: [14, 0, 0], chest: [10, 0, 0], neck: [-2, 0, 0], head: [6, 0, 0], ...arms(-62, -52, 16, 30, 4, -10), ...tail(0, { lift: 52, curl: 6 }), ...ears(0, 14) },
        feet: { L: { at: [0.02, 0, 0.03], heel: -22 }, R: { at: [-0.02, 0, -0.02], heel: -22 } },
    },
    // Resting: sat back on its haunches, the hocks on the ground, the hands
    // on its knees, the tail laid round.
    rest: {
        root: [0, -0.32, -0.1], turn: [-4, 0, 0],
        bones: {
            spine: [10, 0, 0], chest: [6, 0, 0], neck: [-8, 0, 0], head: [2, 0, 0], ...arms(-28, -28, 62, 62, 6, 30), ...ears(0, 12),
            tail1: [34, 18, 0], tail2: [6, 26, 0], tail3: [0, 28, 0], tail4: [-4, 28, 0], tail5: [-6, 22, 0],
        },
        feet: { L: { at: [0.02, 0, 0.04], heel: -54 }, R: { at: [-0.02, 0, 0.04], heel: -54 } },
    },
};

export const cycles = {
    walk: {
        keys: [[0, 'walk-contact'], [0.09, 'walk-down'], [0.25, 'walk-pass'], [0.4, 'walk-up']],
        mirror: true,
        stance: { L: [0, 0.62] },
    },
    run: {
        keys: [[0, 'run-contact'], [0.1, 'run-down'], [0.26, 'run-push'], [0.4, 'run-flight']],
        mirror: true,
        stance: { L: [0, 0.3] },
    },
};
