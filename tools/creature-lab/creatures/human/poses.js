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
const mix = (a, b, t) => a + (b - a) * t;

// The sole from its ball back to the heel's edge (skeleton.js): a foot
// pitched toes-up by `a` degrees with its heel on the ground has its ball
// this far over it.
const SOLE = 0.185;
// The leg as skeleton.js stands it: the hip's height, the hip to the ankle
// with the knee straight, the ankle to the ball and how far under level that
// lies at rest, the ball's height and how far ahead of the hip it rests, a
// hip out from the middle.
const HIP_UP = 0.92, LEG = 0.8379, FOOT_LEN = 0.1533, FOOT_DIP = 24.2, BALL_UP = 0.022, BALL_AHEAD = 0.115, HIP_OUT = 0.09;
// The toes, from the ball to their tip.
const TOES = 0.1;
const onHeel = (a) => SOLE * Math.sin(Math.max(0, -a) * DEG);

// An arm. The skeleton rests with it ARM_IN out from the body (for the
// skin); here it hangs. `back` swings the upper arm back from hanging
// (under 0: forward and up), `bend` is the elbow's, `wrist` curls the hand
// in, `out` holds the elbow away from the flank, `shrug` lifts the
// shoulder, `twist` turns the upper arm about its length (over 0: the
// forearm across the body). The collar bone goes a seventh of the way with
// the arm.
const ARM_IN = 15;
const arm = (t, back, bend, wrist = 8, out = 3, shrug = 0, twist = 0) => {
    const s = t === 'L' ? 1 : -1;
    return {
        [`shoulder${t}`]: [0, 0.15 * s * Math.max(-50, Math.min(40, back)), s * shrug],
        [`upperarm${t}`]: [back, -s * twist, s * (out - ARM_IN)],
        [`forearm${t}`]: [-bend, 0, 0],
        [`hand${t}`]: [-wrist, 0, 0],
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
            const heel = s < G.flat ? mix(G.heelLand, 0, smooth(s / G.flat)) : s < G.peel ? 0 : mix(0, G.heelPush, ((s - G.peel) / (1 - G.peel)) ** 1.8);
            // (`ahead` is from the ball's rest place, which is ahead of the hip.)
            return { z: G.reach * (1 - 2 * s) + G.ahead, y: onHeel(heel), heel, toe: Math.min(heel, 0), air: 0 };
        }
        const u = (q - G.duty) / (1 - G.duty);
        const heel = u < 0.35 ? mix(G.heelPush, G.heelFold, smooth(u / 0.35)) : mix(G.heelFold, G.heelLand, smooth((u - 0.35) / 0.65));
        // (The toes hang as the foot leaves and are drawn up before it lands.)
        const toe = u < 0.25 ? mix(0, 0.6 * G.heelPush, smooth(u / 0.25)) : mix(0.6 * G.heelPush, G.heelLand, smooth((u - 0.25) / 0.6));
        const fwd = smooth(u);
        // (The ball is carried over the toes hanging under it, so they clear.)
        const y = G.lift * Math.sin(Math.PI * Math.min(1, u / 0.9) ** 0.8) ** 1.2 + onHeel(G.heelLand) * smooth((u - 0.6) / 0.4)
            + TOES * Math.sin(Math.max(0, toe) * DEG);
        return { z: G.reach * (-1 + 2 * fwd) + G.ahead, y, heel, toe, air: smooth(u / 0.2) * smooth((1 - u) / 0.36) ** 2 };
    };
    const l = leg(p), r = leg((p + 0.5) % 1);
    const Y = -G.yaw * cos(p - 0.02);
    const sway = G.sway * cos(p - G.duty / 2);
    // The hips' height. Walking, they vault over the legs: as high as the
    // leg on the ground lets them be with its knee `vault` short of straight,
    // so they are highest passing over the standing foot and lowest with
    // both feet down, whatever the stride's length. (A leg in the air holds
    // them only as it leaves the ground and as it comes to it.) Running, the
    // leg is a spring and the body is thrown: between steps it is in free
    // fall for the flight's time (the stride's time at `speed`, less the
    // stance), which sets the speed it leaves the ground and comes back to
    // it with, and the stance is the dip that turns that speed round; `down`
    // is the hips' height as a foot lands.
    // (The weight changing feet is a corner in that height: it is rounded
    // over a tenth of the stride, which leaves the landing leg straight.)
    const over = (f, side, yaw) => {
        const a = (FOOT_DIP + f.heel) * DEG;
        const az = f.z + BALL_AHEAD - FOOT_LEN * Math.cos(a) - (G.fore - side * HIP_OUT * Math.sin(yaw * DEG));
        const ay = BALL_UP + f.y + FOOT_LEN * Math.sin(a);
        return ay + Math.sqrt(Math.max(0, (G.vault * LEG) ** 2 - az * az)) + 0.3 * f.air - HIP_UP;
    };
    const vaultAt = (pp) => {
        const q = ((pp % 1) + 1) % 1, yaw = -G.yaw * cos(q - 0.02);
        return Math.min(over(leg(q), 1, yaw), over(leg((q + 0.5) % 1), -1, yaw));
    };
    let vault = 0;
    if (G.vault) for (let i = -4; i <= 4; i++) vault += (1 - Math.abs(i) / 5) * vaultAt(p + 0.0125 * i) / 5;
    const thrown = () => {
        // (It leaves the ground `rise` higher than it comes back to it: on
        // a leg pushed out long, to land on one that gives; and the legs
        // folding up under it in the air bring the hips down besides.)
        const T = (2 * G.reach) / G.duty / G.speed, ts = G.duty * T, tf = (0.5 - G.duty) * T;
        // (`fold`: that much of the fall is the hips' own, under a mass
        // that falls freely: the legs' weight is carried up past them.)
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
    // The arms: forward further than back; the elbow bends as it comes forward.
    const sw = cos(p + 0.01);
    const swingL = G.armBack + (sw > 0 ? G.armAft : G.armFore) * sw, swingR = G.armBack - (sw > 0 ? G.armFore : G.armAft) * sw;
    const el = cos(p - 0.05), wr = cos(p - 0.15);
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

// The walk: upright and easy, heel first, the arms long and loose.
const WALK = {
    duty: 0.62, reach: 0.42, ahead: -0.055, lift: 0.04, inset: 0.035,
    heelLand: -20, flat: 0.16, peel: 0.54, heelPush: 66, heelFold: 44,
    vault: 0.987, down: 0, low: 0.04, fore: 0.02, sway: 0.02, yaw: 5, roll: 3.5, pitch: 2.5, nod: 0.8, curl: 3, chin: 0,
    counter: 0.5, armBack: 2, armFore: 13, armAft: 10, armBend: 22, armPump: 8, wrist: 8, wristSwing: 5, armOut: 3, armTwist: 4, shrug: 0.8,
};
// The run: leaning in, landing nearly flat under itself, a flight after
// each step, the shin folded up behind, the elbows square and driving.
const RUN = {
    duty: 0.3, reach: 0.38, ahead: -0.075, lift: 0.12, inset: 0.05, speed: 4.0,
    heelLand: -4, flat: 0.12, peel: 0.42, heelPush: 84, heelFold: 105,
    down: -0.035, rise: 0.01, fold: 0.022, low: 0.15, fore: 0.03, sway: 0.006, yaw: 9, roll: 2.5, pitch: 11, nod: 1.2, curl: 3, chin: -3,
    counter: 0.7, armBack: 8, armFore: 40, armAft: 42, armBend: 92, armPump: 14, wrist: 14, wristSwing: 5, armOut: 6, armTwist: 22, shrug: 1.5,
};
// The jog: the run taken easy. Shorter steps with the foot down for more of
// each and a short flight between, more upright, the shin folded less far
// and the arms carried lower and swung less.
const JOG = {
    ...RUN,
    duty: 0.38, reach: 0.33, ahead: -0.1, lift: 0.07, inset: 0.045, speed: 2.4,
    heelLand: -8, heelPush: 72, heelFold: 78,
    down: -0.035, rise: 0.01, fold: 0.012, low: 0.19, yaw: 7, pitch: 7, nod: 1.0, chin: -1,
    counter: 0.7, armBack: 6, armFore: 26, armAft: 28, armBend: 80, armPump: 10, armTwist: 16, shrug: 1.2,
};

// A gait's cycle: `stride` at eight phases a step, the second step mirrored.
const STEPS = 8;
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
        bones: { spine: [12, 0, 0], chest: [10, 0, 0], neck: [4, 0, 0], head: [8, 0, 0], ...arms(-58, 128, 10, 8, 16, 30) },
        feet: { L: { at: [0.02, 0, 0.03] }, R: { at: [-0.02, 0, -0.03] } },
    },
    // Picking something up: squatted on the balls of its feet, the back
    // bent over, the left hand down to the ground and the right forearm on
    // its knee, looking at what it picks.
    forage: {
        root: [0, -0.52, 0.02], turn: [38, 0, 0],
        bones: {
            spine: [16, 0, 0], chest: [12, 0, 0], neck: [-16, 0, 0], head: [-8, 0, 0],
            ...arm('L', -64, 14, 22, 2, 0, 10), ...arm('R', -44, 74, 14, 6, 0, 46),
        },
        feet: { L: { at: [0.03, 0, 0.1], heel: 34 }, R: { at: [-0.03, 0, 0.0], heel: 44 } },
    },
    // Leaping, in the air: the chest up, one arm thrown forward and up and
    // the other back, as a hurdler's. (The legs are the stride's own:
    // rig.bk.)
    leap: {
        turn: [8, 0, 0],
        bones: {
            spine: [-2, 0, 0], chest: [-5, 0, 0], neck: [-3, 0, 0], head: [2, 0, 0],
            ...arm('L', -96, 62, 8, 10, 8, 16), ...arm('R', 38, 68, 10, 12, 4, 10),
        },
    },
    // Lying: sat down on the ground behind its feet, the knees up, leaning
    // back a little on its hands.
    lie: {
        root: [0, -0.8, -0.36], turn: [-14, 0, 0],
        bones: { spine: [10, 0, 0], chest: [8, 0, 0], neck: [2, 0, 0], head: [2, 0, 0], ...arms(34, 6, -62, 10, 6) },
        feet: { L: { at: [0.03, 0, 0.0] }, R: { at: [-0.03, 0, 0.0] } },
    },
    // Squatting: down over its heels with its elbows on its knees, on its
    // way down to sitting and on its way up.
    rest: {
        root: [0, -0.5, -0.08], turn: [30, 0, 0],
        bones: { spine: [10, 0, 0], chest: [8, 0, 0], neck: [-18, 0, 0], head: [-10, 0, 0], ...arms(-52, 62, 12, 6, 0, 30) },
        feet: { L: { at: [0.03, 0, 0.02], heel: 30 }, R: { at: [-0.03, 0, 0.02], heel: 30 } },
    },
};

export const cycles = { walk: walk.cycle, jog: jog.cycle, run: run.cycle };

// It stands on straight legs: a key's leg eases straight only at the very
// end of its reach.
export const soft = 0.997;
