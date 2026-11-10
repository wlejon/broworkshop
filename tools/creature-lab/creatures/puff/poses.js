// The puff's keys: the poses it is drawn in and the cycles made of them
// (lab/posing.js has the form). Angles in degrees, lengths in metres. A
// pose places the feet (the ball of each from where it rests) and turns the
// bones off the legs; the legs are solved.
//
// Its gaits are not drawn pose by pose: `stride` makes a pose for any phase
// of a stride from how the puff moves (below), and a cycle is that read at
// eight phases a step. The attitudes (alert, flinching, pecking, sitting)
// are drawn.
//
// Sides: phase 0 is the left foot's touchdown; a cycle's second half is its
// first mirrored.

const TAU = 2 * Math.PI;
const cos = (turns) => Math.cos(TAU * turns);
const smooth = (t) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const mix = (a, b, t) => a + (b - a) * t;

// The wings: each lifted `out` from the body (the left's, the right's) and
// both swung `back`.
const wings = (outL = 0, outR = outL, back = 0) => ({ wingL: [back, 0, outL], wingR: [back, 0, -outR] });

// The tufts laid `back` and spread out and down by `flat`.
const tufts = (back = 0, flat = 0) => ({ tuftL: [-back, 0, -flat], tuftR: [-back, 0, flat] });

// The tail lifted and swung aside.
const tail = (lift = 0, swing = 0) => ({ tail1: [lift, swing, 0], tail2: [0.5 * lift, 0.6 * swing, 0] });

// --- how it goes ---------------------------------------------------------------
// It waddles. One phase p of a stride (0: the left foot lands) places all
// of it.
//
//   legs    the strider's: a foot lands ahead on the ball with the hock
//           high, the hock gives as the weight comes over it, then the
//           heel rises and it pushes off behind; in the air the foot folds
//           up, swings through and reaches
//   body    the whole ball rocks over the foot that stands, as a thing
//           with no waist must, and turns with the hips; it sinks at each
//           landing and bounces up after
//   head    stays where it was: level and facing where it goes, the body
//           rocking and turning under it
//   wings   each lifts off its side while its own foot is in the air, to
//           keep the ball over the other; at a run both are held out and
//           back
//   tufts   upright at a walk, laid back at a run
//   tail    tips up as the body sinks, and wags against the hips' turn
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
    // The rock: the ball's top over the standing foot (the left's side is +x).
    const rock = -G.rock * cos(p - G.duty / 2 - 0.02);
    // A wing's lift while its own foot swings.
    const air = (q) => (q < G.duty ? 0 : 0.5 - 0.5 * cos((q - G.duty) / (1 - G.duty)));
    const outL = G.wingOut + G.wingFlap * air(p), outR = G.wingOut + G.wingFlap * air((p + 0.5) % 1);
    const pitch = G.pitch + nod;
    return {
        root: [sway, G.down + bob, G.fore],
        turn: [pitch, Y, rock],
        bones: {
            chest: [-0.4 * nod, -0.3 * Y, 0],
            head: [-(G.pitch + 0.6 * nod) + G.chin, -0.7 * Y, -rock],
            ...wings(outL, outR, G.wingBack + G.wingBeat * cos(2 * (p - G.low - 0.1))),
            ...tufts(G.tuftBack, G.tuftFlat),
            ...tail(G.tailLift - 0.6 * G.pitch + G.tailBob * cos(2 * (p - G.low - 0.1)), G.tailWag * cos(p - 0.1)),
        },
        feet: {
            L: { at: [-G.inset, l.y, l.z], heel: l.heel, toe: l.toe },
            R: { at: [G.inset, r.y, r.z], heel: r.heel, toe: r.toe },
        },
    };
}

// The walk: a waddle, the ball rocking from foot to foot.
const WALK = {
    duty: 0.62, reach: 0.25, ahead: 0.01, lift: 0.1, inset: 0.03,
    heelLand: -4, heelGive: -13, heelPush: 34, heelFold: 62,
    down: -0.022, bob: 0.018, low: 0.06, fore: 0, sway: 0.026, yaw: 8, rock: 5.5, pitch: 2, nod: 1.4, chin: 0,
    wingOut: 2, wingFlap: 16, wingBack: 0, wingBeat: 2, tuftBack: 0, tuftFlat: 0,
    tailLift: 0, tailBob: 6, tailWag: 11,
};
// The run: tipped forward, the wings out and back behind it, the tufts
// flat, a long step and a flight after each.
const RUN = {
    duty: 0.3, reach: 0.29, ahead: -0.02, lift: 0.17, inset: 0.05,
    heelLand: 2, heelGive: -16, heelPush: 44, heelFold: 78,
    down: -0.05, bob: 0.026, low: 0.15, fore: 0.02, sway: 0.008, yaw: 9, rock: 2.5, pitch: 17, nod: 0, chin: -3,
    wingOut: 34, wingFlap: 8, wingBack: 58, wingBeat: 6, tuftBack: 46, tuftFlat: 22,
    tailLift: 22, tailBob: 9, tailWag: 5,
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
    // Standing: as the skeleton stands it.
    stand: { bones: {} },
    ...walk.poses,
    ...run.poses,
    // Alert: stretched up tall on straight legs, the tufts stood up, the
    // wings tight, the tail up.
    alert: {
        root: [0, 0.035, 0.02], turn: [-5, 0, 0],
        bones: { chest: [-3, 0, 0], head: [8, 0, 0], ...tufts(-8, -16), ...wings(0), ...tail(24) },
        feet: { L: { heel: 8 }, R: { heel: 8 } },
    },
    // Flinching: dropped onto its hocks, the head ducked, the tufts flat,
    // the wings thrown out.
    flinch: {
        root: [0, -0.17, 0.0], turn: [5, 0, 0],
        bones: { chest: [3, 0, 0], head: [8, 0, 0], ...tufts(58, 44), ...wings(48, 48, 8), ...tail(-26) },
        feet: { L: { at: [0.02, 0, 0.02], heel: -22 }, R: { at: [-0.02, 0, -0.02], heel: -22 } },
    },
    // Pecking: its legs bent and the whole ball tipped over on its hips
    // until it looks straight down, as a drinking bird tips, the hips back
    // to keep it over its feet, the wings out a little for balance, the
    // tail up behind. (The rig dips it from there to the ground: rig.bk.)
    forage: {
        root: [0, -0.34, -0.12], turn: [88, 0, 0],
        bones: { chest: [4, 0, 0], head: [2, 0, 0], ...tufts(8, 8), ...wings(20, 20, 16), ...tail(-30) },
        feet: { L: { at: [0.02, 0, 0.05], heel: -30 }, R: { at: [-0.02, 0, -0.01], heel: -30 } },
    },
    // Leaping, in the air: the wings thrown wide, the tufts flat, the tail
    // up. (The legs are the stride's own: rig.bk.)
    leap: {
        turn: [-3, 0, 0],
        bones: { head: [5, 0, 0], ...tufts(48, 24), ...wings(82, 82, 6), ...tail(26) },
    },
    // Lying: sat right down, the ball on the ground over its folded legs,
    // the tufts drooped, the wings a little loose.
    lie: {
        root: [0, -0.56, -0.02], turn: [-2, 0, 0],
        bones: { head: [4, 0, 0], ...tufts(18, 36), ...wings(6), ...tail(-8) },
        // (Its feet stay where it stood: the hips come down behind them.)
        feet: { L: { heel: -52 }, R: { heel: -52 } },
    },
    // Squatting: down on its hocks, on its way down to sitting and on its
    // way up.
    rest: {
        root: [0, -0.38, 0.07], turn: [6, 0, 0],
        bones: { head: [-4, 0, 0], ...tufts(6, 12), ...wings(12), ...tail(6) },
        feet: { L: { at: [0.02, 0, 0.05], heel: -56 }, R: { at: [-0.02, 0, 0.05], heel: -56 } },
    },
};

export const cycles = { walk: walk.cycle, run: run.cycle };
