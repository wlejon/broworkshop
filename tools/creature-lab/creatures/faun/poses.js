// The faun's keys: the poses it is drawn in and the cycles made of them
// (lab/posing.js has the form). Angles in degrees, lengths in metres. A
// pose places the feet (the ball of each from where it rests) and turns the
// bones off the legs; the legs are solved.
//
// Its gaits are not drawn pose by pose: `stride` makes a pose for any phase
// of a stride from how the faun moves (below), and a cycle is that read at
// eight phases a step. The attitudes (alert, flinching, gathering, sitting)
// are drawn.
//
// Sides: phase 0 is the left foot's touchdown; a cycle's second half is its
// first mirrored.

const TAU = 2 * Math.PI;
const cos = (turns) => Math.cos(TAU * turns);
const smooth = (t) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const mix = (a, b, t) => a + (b - a) * t;

// An arm. The skeleton rests with it ARM_IN out from the body (for the
// skin); here it hangs. `back` swings the upper arm back from hanging
// (under 0: forward and up), `bend` is the elbow's, `wrist` curls the hand
// in, `out` holds the elbow away from the flank, `shrug` lifts the
// shoulder. The collar bone goes a quarter of the way with the arm.
const ARM_IN = 15;
const arm = (t, back, bend, wrist = 12, out = 0, shrug = 0) => {
    const s = t === 'L' ? 1 : -1;
    return {
        [`shoulder${t}`]: [0, 0.25 * s * Math.max(-50, back), s * shrug],
        [`upperarm${t}`]: [back, 0, s * (out - ARM_IN)],
        [`forearm${t}`]: [-bend, 0, 0],
        [`hand${t}`]: [-wrist, 0, 0],
    };
};
const arms = (back = 2, bend = 10, wrist = 12, out = 0, shrug = 0) => ({ ...arm('L', back, bend, wrist, out, shrug), ...arm('R', back, bend, wrist, out, shrug) });

// The ears swept `back` and let `droop` (under 0: pricked).
const ears = (back = 0, droop = 0) => ({ earL: [0, back, -droop], earR: [0, -back, droop] });

// The tail lifted and swung aside.
const tail = (lift = 0, swing = 0) => ({ tail1: [lift, swing, 0], tail2: [0.6 * lift, 0.7 * swing, 0] });

// --- how it goes ---------------------------------------------------------------
// It goes upright. One phase p of a stride (0: the left foot lands) places
// all of it.
//
//   legs    the strider's: a foot lands ahead on the ball with the hock
//           high, the hock gives as the weight comes over it, then the
//           heel rises and it pushes off behind; in the air the foot folds
//           up under the thigh, swings through and reaches
//   hips    turn so the reaching leg's hip leads, drop on the swinging
//           leg's side, sink as the weight lands
//   trunk   leans into its pace; the waist and chest turn back against the
//           hips and on past them, so the shoulders' line swings opposite
//           to the hips' and each shoulder goes forward with its own arm
//   arms    swing whole from the shoulder against the legs (the left back
//           as the left foot reaches), long and loose at a walk with the
//           elbow giving as the arm comes forward; at a run the elbows are
//           bent square and driven, held a little off the flanks
//   head    carried level and facing where it goes: the neck takes back
//           the trunk's lean and its turning
//   ears    droop and swing; laid back at a run
//   tail    flicks to the side of the foot that lands; up at a run
function stride(p, G) {
    // One leg at phase q since its touchdown: the ball from its rest place.
    const leg = (q) => {
        if (q < G.duty) {
            const s = q / G.duty;
            const heel = s < 0.45 ? mix(G.heelLand, G.heelGive, smooth(s / 0.45)) : mix(G.heelGive, G.heelPush, ((s - 0.45) / 0.55) ** 2);
            return { z: G.reach * (1 - 2 * s) + G.ahead, y: 0, heel, toe: mix(-10, 0, smooth(s / 0.12)) };
        }
        const u = (q - G.duty) / (1 - G.duty);
        const heel = u < 0.3 ? mix(G.heelPush, G.heelFold, smooth(u / 0.3)) : mix(G.heelFold, G.heelLand, smooth((u - 0.3) / 0.7));
        const toe = u < 0.3 ? mix(0, 34, smooth(u / 0.3)) : u < 0.8 ? mix(34, -16, smooth((u - 0.3) / 0.5)) : mix(-16, -10, smooth((u - 0.8) / 0.2));
        // (It reaches a little past where it lands and is drawn back onto the ground.)
        const fwd = smooth(u / 0.92);
        const z = G.reach * (-1 + 2 * (u < 0.92 ? 1.04 * fwd : mix(1.04, 1, (u - 0.92) / 0.08))) + G.ahead;
        return { z, y: G.lift * Math.sin(Math.PI * u ** 0.85) ** 1.3, heel, toe };
    };
    const l = leg(p), r = leg((p + 0.5) % 1);
    const Y = -G.yaw * cos(p - 0.03);
    const sway = G.sway * cos(p - G.duty / 2);
    const bob = -G.bob * cos(2 * (p - G.low));
    const nod = G.nod * cos(2 * (p - G.low - 0.08));
    const roll = G.roll * cos(p - G.duty / 2);
    const lean = G.pitch + nod;
    // The shoulders' line: against the hips, a little after them.
    const S = G.counter * G.yaw * cos(p - 0.07);
    // The arms: the upper arm's swing, the elbow's give, the wrist after.
    const swing = G.armSwing * cos(p - 0.05), pump = G.armPump * cos(p - 0.13), wrist = G.wristSwing * cos(p - 0.22);
    // (Both shoulders lift a little as the weight lands.)
    const shrug = G.shrug * cos(2 * (p - G.low - 0.1));
    return {
        root: [sway, G.down + bob, G.fore],
        turn: [lean, Y, roll],
        bones: {
            spine: [0.4 * G.curl - 0.35 * nod, 0.5 * (S - Y), -0.6 * roll],
            chest: [0.6 * G.curl - 0.25 * nod, 0.5 * (S - Y), -0.7 * roll],
            neck: [-0.5 * (G.pitch + G.curl) - 0.2 * nod, -0.5 * S, 0.15 * roll],
            head: [-0.5 * (G.pitch + G.curl) + G.chin - 0.2 * nod, -0.5 * S, 0.15 * roll],
            ...arm('L', G.armBack + swing, G.armBend - pump, G.wrist - wrist, G.armOut, shrug),
            ...arm('R', G.armBack - swing, G.armBend + pump, G.wrist + wrist, G.armOut, shrug),
            ...ears(G.earBack, G.earDroop),
            ...tail(G.tailLift + G.tailBob * cos(2 * (p - G.low - 0.12)), G.tailWag * cos(p - 0.1)),
        },
        feet: {
            L: { at: [-G.inset, l.y, l.z], heel: l.heel, toe: l.toe },
            R: { at: [G.inset, r.y, r.z], heel: r.heel, toe: r.toe },
        },
    };
}

// The walk: an easy upright stride, the arms long and loose.
const WALK = {
    duty: 0.62, reach: 0.25, ahead: 0.01, lift: 0.09, inset: 0.035,
    heelLand: -4, heelGive: -13, heelPush: 34, heelFold: 62,
    down: -0.022, bob: 0.014, low: 0.06, fore: 0, sway: 0.02, yaw: 7, roll: 2.6, pitch: 3, nod: 1.0, curl: 0, chin: 0,
    counter: 0.8, armBack: 3, armSwing: 21, armBend: 17, armPump: 9, wrist: 12, wristSwing: 9, armOut: 0, shrug: 1.2,
    earBack: 0, earDroop: 0, tailLift: 0, tailBob: 5, tailWag: 12,
};
// The run: leaning into it, a long step and a flight after each, the elbows
// square and driving, the ears laid back and the tail up.
const RUN = {
    duty: 0.3, reach: 0.29, ahead: -0.02, lift: 0.17, inset: 0.05,
    heelLand: 2, heelGive: -16, heelPush: 44, heelFold: 78,
    down: -0.05, bob: 0.024, low: 0.15, fore: 0.02, sway: 0.008, yaw: 9, roll: 1.8, pitch: 15, nod: 1.6, curl: 4, chin: -4,
    counter: 1.1, armBack: 10, armSwing: 40, armBend: 98, armPump: 14, wrist: 22, wristSwing: 6, armOut: 5, shrug: 2,
    earBack: 38, earDroop: 8, tailLift: 28, tailBob: 8, tailWag: 6,
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
const walk = cycleOf('walk', WALK), run = cycleOf('run', RUN);

export const poses = {
    // Standing: as the skeleton stands it, the arms hanging.
    stand: { turn: [3, 0, 0], bones: { neck: [-1.5, 0, 0], head: [-1.5, 0, 0], ...arms() } },
    ...walk.poses,
    ...run.poses,
    // Alert: drawn up tall, the chest out and the head high, the ears
    // pricked, the arms a little off its sides, the tail up.
    alert: {
        root: [0, 0.03, 0.03], turn: [-4, 0, 0],
        bones: { spine: [-4, 0, 0], chest: [-6, 0, 0], neck: [-2, 0, 0], head: [9, 0, 0], ...arms(-3, 24, 18, 7), ...ears(-12, -28), ...tail(32) },
        feet: { L: { heel: 6 }, R: { heel: 6 } },
    },
    // Flinching: ducked, the shoulders up about the head and the hands
    // thrown up before the chest, the ears back, the tail clamped down.
    flinch: {
        root: [0, -0.15, 0.02], turn: [12, 0, 0],
        bones: { spine: [10, 0, 0], chest: [8, 0, 0], neck: [-18, 0, 0], head: [-6, 0, 0], ...arms(-34, 122, 30, 4, 20), ...ears(52, 22), ...tail(-48) },
        feet: { L: { at: [0.02, 0, 0.02], heel: -22 }, R: { at: [-0.02, 0, -0.02], heel: -22 } },
    },
    // Gathering: crouched over its feet, the left hand down to the ground
    // and the right on its knee, looking at what it picks.
    forage: {
        root: [0, -0.3, 0.03], turn: [38, 0, 0],
        bones: {
            spine: [14, 0, 0], chest: [12, 0, 0], neck: [-28, 0, 0], head: [-10, 0, 0],
            ...arm('L', -62, 8, 20, 4), ...arm('R', -32, 36, 26, 2), ...ears(6, 8), ...tail(18),
        },
        feet: { L: { at: [0.02, 0, 0.06], heel: -46 }, R: { at: [-0.02, 0, 0.0], heel: -46 } },
    },
    // Leaping, in the air: the chest lifted and the head up, the arms
    // thrown forward and up, one higher, the ears flat, the tail up. (The
    // legs are the stride's own: rig.bk.)
    leap: {
        turn: [6, 0, 0],
        bones: {
            spine: [-4, 0, 0], chest: [-8, 0, 0], neck: [-4, 0, 0], head: [8, 0, 0],
            ...arm('L', -112, 34, 10, 10, 10), ...arm('R', -64, 58, 14, 12, 6), ...ears(46, 10), ...tail(34),
        },
    },
    // Lying: sat down on its folded legs, the trunk upright and a little
    // slumped, the hands on the ground beside it, the tail laid aside.
    lie: {
        root: [0, -0.52, -0.02], turn: [8, 0, 0],
        bones: { spine: [8, 0, 0], chest: [6, 0, 0], neck: [-10, 0, 0], head: [-4, 0, 0], ...arms(-16, 14, -30, 2), ...ears(4, 14), ...tail(-22, 16) },
        // (Its feet stay where it stood: the hips come down behind them.)
        feet: { L: { heel: -52 }, R: { heel: -52 } },
    },
    // Squatting: down on its hocks with its hands on its knees, on its way
    // down to sitting and on its way up.
    rest: {
        root: [0, -0.36, 0.09], turn: [16, 0, 0],
        bones: { spine: [6, 0, 0], chest: [4, 0, 0], neck: [-16, 0, 0], head: [-8, 0, 0], ...arms(-30, 52, 24, 4), ...ears(0, 6), ...tail(6) },
        feet: { L: { at: [0.02, 0, 0.05], heel: -56 }, R: { at: [-0.02, 0, 0.05], heel: -56 } },
    },
};

export const cycles = { walk: walk.cycle, run: run.cycle };
