// The human's keys: the poses it is drawn in and the cycles made of them
// (lab/posing.js has the form). Angles in degrees, lengths in metres. A
// pose places the feet (the ball of each from where it rests) and turns the
// bones off the legs; the legs are solved.
//
// Its gaits are not drawn pose by pose: `stride` makes a pose for any phase
// of a stride from how a person moves (below), and a cycle is that read at
// eight phases a step. The attitudes (alert, flinching, picking something
// up, sitting) are drawn.
//
// Sides: phase 0 is the left foot's touchdown; a cycle's second half is its
// first mirrored.

const TAU = 2 * Math.PI, DEG = Math.PI / 180;
const cos = (turns) => Math.cos(TAU * turns);
const smooth = (t) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const smooth5 = (t) => { const x = Math.max(0, Math.min(1, t)); return x * x * x * (10 - 15 * x + 6 * x * x); };
const mix = (a, b, t) => a + (b - a) * t;

// The sole from its ball back to the heel's edge (skeleton.js): a foot
// pitched toes-up by `a` degrees with its heel on the ground has its ball
// this far over its rest height.
const SOLE = 0.185, ANKLE = 0.022;
// The leg as skeleton.js stands it: the hip's height, the hip to the ankle
// with the knee straight, the ankle to the ball and how far under level that
// lies at rest, the ball's height and how far ahead of the hip it rests, a
// hip out from the middle.
const HIP_UP = 0.92, LEG = 0.8379, FOOT_LEN = 0.1533, FOOT_DIP = 24.2, BALL_UP = 0.022, BALL_AHEAD = 0.115, HIP_OUT = 0.09;
// The toes, from the ball to their tip.
const TOES = 0.1;
const onHeel = (a) => {
    const r = Math.min(0, a) * DEG;
    return Math.max(0, SOLE * Math.sin(-r) - ANKLE * (1 - Math.cos(r)));
};

// An arm. The skeleton rests with it ARM_IN (32 deg) out from plumb so the
// armpit meshes cleanly open; here it hangs. `hinge` conjugates elbow and
// wrist flexion by Rz(s * ARM_IN) so bending the forearm or hand rotates
// purely around the anatomical hinge axis without splaying sideways.
const ARM_IN = 32;
function hinge(abductDeg, flexDeg) {
    const a = abductDeg * DEG, p = flexDeg * DEG;
    const ca = Math.cos(a), sa = Math.sin(a), cp = Math.cos(p), sp = Math.sin(p);
    const y = Math.asin(Math.max(-1, Math.min(1, sa * sp))) / DEG;
    const x = Math.atan2(ca * sp, cp) / DEG;
    const z = Math.atan2(-ca * sa * (1 - cp), ca * ca + sa * sa * cp) / DEG;
    return [x, y, z];
}
const arm = (t, back, bend, wrist = 8, out = 3, shrug = 0, twist = 0) => {
    const s = t === 'L' ? 1 : -1;
    return {
        [`shoulder${t}`]: [0, 0.15 * s * Math.max(-50, Math.min(40, back)), s * shrug],
        [`upperarm${t}`]: [back, -s * twist, s * (out - ARM_IN)],
        [`forearm${t}`]: hinge(s * ARM_IN, -bend),
        [`hand${t}`]: hinge(s * ARM_IN, -wrist),
    };
};
const arms = (back = 2, bend = 9, wrist = 8, out = 3, shrug = 0, twist = 0) => ({ ...arm('L', back, bend, wrist, out, shrug, twist), ...arm('R', back, bend, wrist, out, shrug, twist) });

// --- how it goes ---------------------------------------------------------------
// One phase p of a stride (0: the left foot lands) places all of it.
//
//   feet    a foot lands on its heel with the toes up, rolls flat as the
//           weight comes onto it, stays flat as the body passes over, then
//           the heel peels up and it pushes off its toes; in the air the
//           shin folds up behind, the foot swings through low and the toes
//           come up for the heel to land. At a run it lands nearly flat
//           under the body and the shin folds right up behind in the air
//   hips    turn so the reaching leg's hip leads, drop on the swinging
//           leg's side, go over the standing foot; lowest with both feet
//           down (at a run, in the middle of each stance), highest between
//   trunk   upright at a walk, leaning in at a run; the waist and chest
//           turn back against the hips and on past them and tip back
//           against their drop, so the shoulders stay level and their line
//           swings opposite to the hips'
//   arms    swing whole from the shoulder against the legs (the left
//           forward as the right foot reaches), further forward than back,
//           the elbow bending as the arm comes forward and nearly straight
//           behind, the hand trailing the forearm; at a run the elbows are
//           bent square and driven, the hands crossing a little in front
//   head    level and facing where it goes: the neck takes back the
//           trunk's lean and turning
function stride(p, G) {
    // One leg at phase q since its touchdown: the ball from its rest place.
    const leg = (q) => {
        if (q < G.duty) {
            const s = q / G.duty;
            // The heel's lift: landed toes-up, flat by `flat`, peeling off from `peel`.
            const heel = s < G.flat ? mix(G.heelLand, 0, smooth(s / G.flat))
                : s < G.peel ? 0
                : mix(0, G.heelPush, smooth((s - G.peel) / (1 - G.peel)));
            // (`ahead` is from the ball's rest place, which is ahead of the hip.)
            return { z: G.reach * (1 - 2 * s) + G.ahead, y: onHeel(heel), heel, toe: Math.min(heel, 0), air: 0 };
        }
        const u = (q - G.duty) / (1 - G.duty);
        const heel = u < 0.4 ? mix(G.heelPush, G.heelFold, smooth(u / 0.4)) : mix(G.heelFold, G.heelLand, smooth((u - 0.4) / 0.6));
        // (The toes hang as the foot leaves and are drawn up before it lands.)
        const toe = u < 0.25 ? mix(0, 0.55 * G.heelPush, smooth(u / 0.25)) : mix(0.55 * G.heelPush, G.heelLand, smooth((u - 0.25) / 0.65));
        const v0 = -0.10, v1 = -0.08;
        const u2 = u * u, u3 = u2 * u;
        const fwd = v0 * u + (10 - 6 * v0 - 4 * v1) * u3 + (-15 + 8 * v0 + 7 * v1) * u3 * u + (6 - 3 * v0 - 3 * v1) * u3 * u2;
        const s = Math.sin(Math.PI * u);
        const y = G.lift * s * s + onHeel(G.heelLand) * smooth((u - 0.55) / 0.45)
            + TOES * Math.sin(Math.max(0, toe) * DEG);
        return { z: G.reach * (-1 + 2 * fwd) + G.ahead, y, heel, toe, air: smooth(u / 0.2) * smooth((1 - u) / 0.36) ** 2 };
    };
    const l = leg(p), r = leg((p + 0.5) % 1);
    const Y = -G.yaw * cos(p - 0.02);
    const sway = G.sway * cos(p - G.duty / 2);
    // The hips' height: walking vaults over the standing leg with a natural
    // loading-response knee flexion wave in early stance (accounting for
    // pelvic roll so neither hip over-reaches); running is a spring-mass
    // bounce matched to ballistic free-fall between steps.
    const smin = (a, b, e) => 0.5 * (a + b - Math.hypot(a - b, e));
    const over = (f, q, side, yaw, rll) => {
        const a = (FOOT_DIP + f.heel) * DEG;
        const az = f.z + BALL_AHEAD - FOOT_LEN * Math.cos(a) - (G.fore - side * HIP_OUT * Math.sin(yaw * DEG));
        const ay = BALL_UP + f.y + FOOT_LEN * Math.sin(a);
        const s = q < G.duty ? q / G.duty : 1;
        const load = q < G.duty
            ? (G.loadDip || 0) * (smooth(s / 0.20) * (1 - 0.85 * smooth((s - 0.23) / 0.24)) + 0.55 * smooth((s - 0.60) / 0.40))
            : 0;
        const v = G.vault - load;
        return ay + Math.sqrt(Math.max(0, (v * LEG) ** 2 - az * az)) - side * HIP_OUT * Math.sin(rll * DEG) + 0.3 * f.air - HIP_UP;
    };
    const vaultAt = (pp) => {
        const q = ((pp % 1) + 1) % 1, q2 = (q + 0.5) % 1;
        const yaw = -G.yaw * cos(q - 0.02), rll = G.roll * cos(q - G.duty / 2 - 0.02);
        return smin(over(leg(q), q, 1, yaw, rll), over(leg(q2), q2, -1, yaw, rll), 0.004);
    };
    let vault = 0;
    if (G.vault) for (let i = -4; i <= 4; i++) vault += (1 - Math.abs(i) / 5) * vaultAt(p + 0.011 * i) / 5;
    const thrown = () => {
        const T = (2 * G.reach) / G.duty / G.speed, ts = G.duty * T, tf = (0.5 - G.duty) * T;
        const up = 0.5 * 9.81 * tf - (G.rise - G.fold) / tf, dn = up - 9.81 * tf;
        const q = p % 0.5;
        if (q < G.duty) {
            const s = q / G.duty, s2 = s * s, s3 = s2 * s;
            return (s3 - 2 * s2 + s) * dn * ts + (-2 * s3 + 3 * s2) * G.rise + (s3 - s2) * up * ts;
        }
        const t = (q - G.duty) * T;
        return G.rise + up * t - 0.5 * 9.81 * t * t - G.fold * smooth(t / tf);
    };
    const bob = G.vault ? vault : thrown();
    const nod = G.nod * cos(2 * (p - G.low - 0.06));
    // The hips drop on the side of the leg in the air.
    const roll = G.roll * cos(p - G.duty / 2 - 0.02);
    // The shoulders' line: against the hips, a little after them.
    const S = G.counter * G.yaw * cos(p - 0.06);
    // The arms: forward further than back, phased so hands peak in counter-phase
    // with the opposite foot across walk, jog, and run.
    const sw = cos(p + (G.armLead ?? -0.02));
    const swingL = G.armBack + (sw > 0 ? G.armAft : G.armFore) * sw, swingR = G.armBack - (sw > 0 ? G.armFore : G.armAft) * sw;
    const el = cos(p - 0.07), wr = cos(p - 0.16);
    const shrug = G.shrug * cos(2 * (p - G.low - 0.1));
    const lean = G.pitch + nod;
    return {
        root: [sway, G.down + bob, G.fore],
        turn: [lean, Y, roll],
        bones: {
            spine: [0.4 * G.curl - 0.3 * nod, 0.5 * (S - Y), -0.55 * roll],
            chest: [0.6 * G.curl - 0.2 * nod, 0.5 * (S - Y), -0.6 * roll],
            neck: [-0.5 * (G.pitch + G.curl) - 0.25 * nod, -0.5 * S, 0.1 * roll],
            head: [-0.5 * (G.pitch + G.curl) + G.chin - 0.25 * nod, -0.5 * S, 0.05 * roll],
            ...arm('L', swingL, G.armBend - G.armPump * el, G.wrist - G.wristSwing * wr, G.armOut, shrug, G.armTwist),
            ...arm('R', swingR, G.armBend + G.armPump * el, G.wrist + G.wristSwing * wr, G.armOut, shrug, G.armTwist),
        },
        feet: {
            L: { at: [-G.inset, l.y, l.z], heel: l.heel, toe: l.toe },
            R: { at: [G.inset, r.y, r.z], heel: r.heel, toe: r.toe },
        },
    };
}

// The walk: upright and easy, heel first with a smooth loading-response wave,
// the arms long and loose.
const WALK = {
    duty: 0.512, reach: 0.336, ahead: -0.026, lift: 0.026, inset: 0.034,
    heelLand: -18, flat: 0.17, peel: 0.55, heelPush: 55, heelFold: 26,
    vault: 0.995, loadDip: 0.010, down: 0, low: 0.04, fore: 0.018, sway: 0.018, yaw: 4.5, roll: 3.2, pitch: 2.5, nod: 0.7, curl: 2.5, chin: 2.5,
    counter: 0.55, armLead: -0.02, armBack: 2, armFore: 15, armAft: 11, armBend: 18, armPump: 8, wrist: 8, wristSwing: 5, armOut: 3, armTwist: 4, shrug: 0.7,
};
// The run: leaning in, landing under itself, a crisp flight after each step,
// strong push-off extension, the shin folded high behind, elbows driving.
const RUN = {
    duty: 0.254, reach: 0.328, ahead: -0.039, lift: 0.074, inset: 0.048, speed: 4.0,
    heelLand: -6, flat: 0.12, peel: 0.44, heelPush: 56, heelFold: 88,
    down: -0.0012, rise: 0.008, fold: 0.006, low: 0.15, fore: 0.028, sway: 0.006, yaw: 8.5, roll: 3.6, pitch: 9.5, nod: 1.0, curl: 3, chin: 6.0,
    counter: 0.7, armLead: -0.045, armBack: 6, armFore: 38, armAft: 40, armBend: 84, armPump: 16, wrist: 12, wristSwing: 5, armOut: 5, armTwist: 16, shrug: 1.4,
};
// The jog: upright, light and springy, landing with an athletic ~20-deg knee
// and bounding cleanly into flight, arms relaxed at ~70 deg.
const JOG = {
    ...RUN,
    duty: 0.282, reach: 0.268, ahead: -0.024, lift: 0.080, inset: 0.044, speed: 2.4,
    heelLand: -7, heelPush: 58, heelFold: 84,
    down: 0.015, rise: 0.005, fold: 0.005, low: 0.15, yaw: 6.5, roll: 3.4, pitch: 5.5, nod: 0.8, chin: 4,
    counter: 0.7, armLead: 0.0, armBack: 5, armFore: 27, armAft: 27, armBend: 70, armPump: 13, armOut: 4.5, armTwist: 12, shrug: 1.0,
};

// A gait's cycle: `stride` at sixteen phases a step, the second step mirrored.
const STEPS = 16;
function cycleOf(name, G) {
    const poses = {}, keys = [];
    for (let i = 0; i < STEPS; i++) {
        poses[`${name}-${i}`] = stride((0.5 * i) / STEPS, G);
        keys.push([(0.5 * i) / STEPS, `${name}-${i}`]);
    }
    return { poses, cycle: { keys, mirror: true, stance: { L: [0, G.duty] } } };
}
const walk = cycleOf('walk', WALK), jog = cycleOf('jog', JOG), run = cycleOf('run', RUN);

export const poses = {
    // Standing: as the skeleton stands it, the arms hanging, the elbows a
    // little bent.
    stand: { bones: { ...arms() } },
    ...walk.poses,
    ...jog.poses,
    ...run.poses,
    // Alert: drawn up, the chest out and the chin up, the arms a little
    // off its sides with the hands open.
    alert: {
        root: [0, 0.0, 0.01], turn: [-2, 0, 0],
        bones: { spine: [-3, 0, 0], chest: [-5, 0, 0], neck: [2, 0, 0], head: [5, 0, 0], ...arms(-4, 22, -6, 9) },
    },
    // Flinching: ducked with the knees bent, the back rounded and the
    // shoulders up, the forearms thrown up before the face.
    flinch: {
        root: [0, -0.14, -0.03], turn: [16, 0, 0],
        bones: { spine: [12, 0, 0], chest: [10, 0, 0], neck: [4, 0, 0], head: [8, 0, 0], ...arms(-58, 128, 10, 8, 16, 26) },
        feet: { L: { at: [0.02, 0, 0.03] }, R: { at: [-0.02, 0, -0.03] } },
    },
    // Picking something up: squatted on the balls of its feet, the back
    // bent over, the left hand down to the ground and the right forearm on
    // its knee, looking at what it picks.
    forage: {
        root: [0, -0.48, 0.02], turn: [36, 0, 0],
        bones: {
            spine: [15, 0, 0], chest: [11, 0, 0], neck: [-15, 0, 0], head: [-8, 0, 0],
            ...arm('L', -62, 16, 20, 3, 0, 10), ...arm('R', -42, 72, 14, 6, 0, 38),
        },
        feet: { L: { at: [0.03, 0, 0.1], heel: 32 }, R: { at: [-0.03, 0, 0.0], heel: 40 } },
    },
    // Leaping, in the air: the chest up, one arm thrown forward and up and
    // the other back, as a hurdler's. (The legs are the stride's own:
    // rig.bk.)
    leap: {
        turn: [12, 0, 0],
        bones: {
            spine: [0, 0, 0], chest: [-2, 0, 0], neck: [-4, 0, 0], head: [-2, 0, 0],
            ...arm('L', -62, 58, 8, 10, 6, 14), ...arm('R', 40, 72, 10, 10, 4, 10),
        },
    },
    // Lying: sat down on the ground behind its feet, the knees up, leaning
    // back comfortably on its hands without extreme wrist hyperextension.
    lie: {
        root: [0, -0.8, -0.35], turn: [-28, 0, 0],
        bones: { spine: [6, 0, 0], chest: [4, 0, 0], neck: [10, 0, 0], head: [8, 0, 0], ...arms(32, 8, -48, 10, 6) },
        feet: { L: { at: [0.03, 0, 0.16] }, R: { at: [-0.03, 0, 0.16] } },
    },
    // Squatting: down over its heels with its elbows on its knees, on its
    // way down to sitting and on its way up.
    rest: {
        root: [0, -0.48, -0.07], turn: [28, 0, 0],
        bones: { spine: [10, 0, 0], chest: [8, 0, 0], neck: [-16, 0, 0], head: [-10, 0, 0], ...arms(-50, 62, 12, 6, 0, 26) },
        feet: { L: { at: [0.03, 0, 0.06], heel: 28 }, R: { at: [-0.03, 0, 0.06], heel: 28 } },
    },
};

export const cycles = { walk: walk.cycle, jog: jog.cycle, run: run.cycle };

// It stands on straight legs: a key's leg eases straight only at the very
// end of its reach.
export const soft = 0.9992;
