// The strider's keys: the poses it is drawn in and the cycles made of them
// (lab/posing.js has the form). Angles in degrees, lengths in metres. A
// pose places the feet (the ball of each from where it rests) and turns the
// bones off the legs; the legs are solved.
//
// Its gaits are not drawn pose by pose: `stride` makes a pose for any phase
// of a stride from how the strider moves (below), so every part's timing
// comes from the one phase and they keep step with each other, and a cycle
// is that read at eight phases a step. The attitudes (alert, flinching,
// foraging, resting) are drawn.
//
// Sides: phase 0 is the left foot's touchdown; a cycle's second half is its
// first mirrored.

const TAU = 2 * Math.PI;
const cos = (turns) => Math.cos(TAU * turns);
const smooth = (t) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const mix = (a, b, t) => a + (b - a) * t;

// A bone of both sides turned alike: [x, y, z] on the left, mirrored on the right.
const both = (name, [x, y, z]) => ({ [`${name}L`]: [x, y, z], [`${name}R`]: [x, -y, -z] });

// The arms, folded at the breast: the skeleton rests with them reaching
// forward and down (for the skin), ARM_DOWN hangs each upper arm, and the
// elbow is bent up in front. `back` swings an upper arm back of hanging
// (deg), `bend` is its elbow's, `wrist` lets the hand droop, `inn` brings
// the elbow in.
const ARM_DOWN = 44;
const arm = (t, back, bend, wrist = 50, inn = 0) => {
    const s = t === 'L' ? 1 : -1;
    return {
        [`shoulder${t}`]: [0, 0.3 * s * back, 0],
        [`upperarm${t}`]: [ARM_DOWN + back, 0, -s * inn],
        [`forearm${t}`]: [-bend, 0, 0],
        [`hand${t}`]: [wrist, 0, 0],
    };
};
const arms = (back = 14, bend = 122, wrist = 50, inn = 6) => ({ ...arm('L', back, bend, wrist, inn), ...arm('R', back, bend, wrist, inn) });

// The ears tipped back by `back`, the tips further by `nod`.
const ears = (back = 0, nod = 0) => ({ ...both('ear1', [-back, 0, 0]), ...both('ear2', [-0.6 * back - nod, 0, 0]) });

// The tail's joints lifted (x, deg each) and swung (y).
const tail = (lift = [0, 0, 0, 0, 0], swing = [0, 0, 0, 0, 0]) => Object.fromEntries(lift.map((x, i) => [`tail${i + 1}`, [x, swing[i], 0]]));

// --- how it goes ---------------------------------------------------------------
// It goes as a running bird does: the body carried level and steady over
// the hips, the tail out behind against it, and the legs doing the work
// under it. One phase p of a stride (0: the left foot lands) places all of
// it.
//
//   legs    a foot lands ahead on the ball with the hock high, the hock
//           gives as the weight comes over it and the leg stands near
//           straight under the hip, then the heel rises and it pushes off
//           behind; in the air the foot folds up under the thigh, swings
//           through and reaches, the toes lifted to land
//   hips    lowest as the weight comes onto a leg, highest over it (a
//           walk) or in the air (a run); they lean to the standing side,
//           and turn so the reaching leg's hip leads
//   back    the spine and chest turn back against the hips, so the
//           shoulders stay square to where it goes
//   tail    each joint keeps the heading the hips had a moment before, and
//           a little more of it down its length: a wave runs out along it
//           behind each step, and it lifts and settles twice a stride
//   arms    carried bent, each swinging against its side's leg from the
//           shoulder, the elbows pumping and giving with each step
//   ears    nod back at each landing
function stride(p, G) {
    // One leg at phase q since its touchdown: the ball from its rest place.
    const leg = (q) => {
        if (q < G.duty) {
            const s = q / G.duty;
            const heel = s < 0.45 ? mix(G.heelLand, G.heelGive, smooth(s / 0.45)) : mix(G.heelGive, G.heelPush, ((s - 0.45) / 0.55) ** 2);
            return { z: G.reach * (1 - 2 * s) + G.ahead, y: 0, heel, toe: mix(-10, 0, smooth(s / 0.14)) };
        }
        const u = (q - G.duty) / (1 - G.duty);
        const heel = u < 0.34 ? mix(G.heelPush, G.heelFold, smooth(u / 0.34)) : mix(G.heelFold, G.heelLand, smooth((u - 0.34) / 0.66));
        const su = smooth(u / 0.34);
        const toe = u < 0.34 ? 26 * su * su : u < 0.8 ? mix(26, -14, smooth((u - 0.34) / 0.46)) : mix(-14, -10, smooth((u - 0.8) / 0.2));
        // (It reaches a little past where it lands and is drawn back onto the ground.)
        const fwd = smooth(u / 0.92) + 0.06 * Math.sin(Math.PI * Math.min(1, u / 0.92)) * (u > 0.5 ? 1 : 0) * 0;
        const z = G.reach * (-1 + 2 * (u < 0.92 ? 1.04 * fwd : mix(1.04, 1, (u - 0.92) / 0.08))) + G.ahead;
        return { z, y: G.lift * Math.sin(Math.PI * u ** 0.85) ** 1.3, heel, toe };
    };
    const l = leg(p), r = leg((p + 0.5) % 1);
    const yaw = (ph) => -G.yaw * cos(ph - 0.03);
    const sway = G.sway * cos(p - G.duty / 2);
    const bob = -G.bob * cos(2 * (p - G.low));
    const nod = G.nod * cos(2 * (p - G.low - 0.08));
    const Y = yaw(p), roll = G.roll * cos(p - G.duty / 2);
    // The tail: joint i heads where the hips did (i + 1) beats ago, and more so.
    // (`stream` under 1 draws it toward the line it travels along instead.)
    const head = (i) => (i < 0 ? Y : (G.stream ?? 1) ** (i + 1) * (1 + G.whip * (i + 1)) * yaw(p - G.lag * (i + 1)));
    const lift = (i) => G.tailLift[i] + G.tailBob * (1 + 0.3 * i) * cos(2 * (p - G.low - 0.1 - 0.05 * i));
    const beat = cos(2 * (p - G.low - 0.12));
    // The arms swing against the legs (the left back as the left foot
    // reaches): the elbow opens as an arm goes back and closes as it comes
    // forward, and the hand trails the forearm a beat behind.
    const swing = G.armSwing * cos(p - 0.06), pump = G.armPump * cos(p - 0.12), wrist = G.armWrist * cos(p - 0.24);
    // The head rides each step on the neck: the neck gives forward as the
    // weight lands, and the head lifts against it a moment after.
    const give = G.headNod * cos(2 * (p - G.low - 0.14)), lift2 = -0.7 * G.headNod * cos(2 * (p - G.low - 0.22));
    return {
        root: [sway, G.down + bob, G.fore],
        turn: [G.pitch + nod, Y, roll],
        bones: {
            spine: [0.3 * G.curl - 0.4 * nod, -0.3 * Y, -0.5 * roll],
            chest: [0.3 * G.curl - 0.3 * nod, -0.42 * Y, -0.5 * roll],
            neck: [-0.5 * (G.pitch + 0.6 * G.curl) - 0.3 * nod + give, -0.14 * Y, 0],
            head: [-0.5 * (G.pitch + 0.6 * G.curl) + G.chin + lift2, -0.1 * Y, 0],
            ...arm('L', G.armBack + swing, G.armBend + G.armBeat * beat - pump, 44 + wrist, 6),
            ...arm('R', G.armBack - swing, G.armBend + G.armBeat * beat + pump, 44 - wrist, 6),
            ...tail([0, 1, 2, 3, 4].map(lift), [0, 1, 2, 3, 4].map((i) => head(i) - head(i - 1))),
            ...ears(G.earBack + G.earNod * (0.5 + 0.5 * cos(2 * (p - G.low - 0.06))), G.earNod * (0.5 + 0.5 * cos(2 * (p - G.low - 0.14)))),
        },
        feet: {
            L: { at: [-G.inset, l.y, l.z], heel: l.heel, toe: l.toe },
            R: { at: [G.inset, r.y, r.z], heel: r.heel, toe: r.toe },
        },
    };
}

// The walk: a light, level strut. The feet are down for most of a step and
// land near the body's middle line.
const WALK = {
    duty: 0.62, reach: 0.25, ahead: 0.01, lift: 0.09, inset: 0.035,
    heelLand: -4, heelGive: -13, heelPush: 34, heelFold: 56,
    down: -0.022, bob: 0.014, low: 0.06, fore: 0, sway: 0.018, yaw: 7, roll: 2.2, pitch: 1.5, nod: 1.2, curl: 0, chin: 0, headNod: 6,
    whip: 0.14, lag: 0.075, tailLift: [0, 0, 0, 0, 0], tailBob: 0.7,
    armBack: 12, armSwing: 17, armPump: 14, armWrist: 14, armBend: 108, armBeat: 4, earBack: 2, earNod: 8,
};
// The run: stretched out and leaning into it, a long step and a flight
// after each; the tail streams level behind, the ears are laid back.
// (Its rise is what its time in the air allows: an eighth of a second off
// the ground is two centimetres.)
const RUN = {
    duty: 0.3, reach: 0.29, ahead: -0.02, lift: 0.17, inset: 0.05,
    heelLand: 2, heelGive: -16, heelPush: 42, heelFold: 62,
    down: -0.05, bob: 0.024, low: 0.15, fore: 0.02, sway: 0.008, yaw: 9, roll: 1.5, pitch: 13, nod: 2, curl: 6, chin: 3, headNod: 5,
    whip: 0.03, lag: 0.06, stream: 0.55, tailLift: [4, 5, 3, -5, -9], tailBob: 1.6,
    armBack: 24, armSwing: 30, armPump: 20, armWrist: 18, armBend: 118, armBeat: 6, earBack: 34, earNod: 5,
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
    // Standing: as the skeleton stands it, the arms folded.
    stand: { bones: { ...arms() } },
    ...walk.poses,
    ...run.poses,
    // Alert: drawn up tall on straight legs, the head high, the ears up and
    // forward, the tail lifted.
    alert: {
        root: [0, 0.03, 0.085], turn: [-16, 0, 0],
        bones: { spine: [-5, 0, 0], neck: [-4, 0, 0], head: [20, 0, 0], ...arms(8, 122, 55), ...tail([8, 8, 4, 0, 0]), ...ears(-8) },
        feet: { L: { heel: 6 }, R: { heel: 6 } },
    },
    // Flinching: down and back from what startled it, the ears flat.
    flinch: {
        root: [0, -0.15, 0.035], turn: [8, 0, 0],
        bones: { spine: [8, 0, 0], chest: [4, 0, 0], neck: [-16, 0, 0], head: [-2, 0, 0], ...arms(26, 134, 30, 10), ...tail([10, 10, 6, 0, -6]), ...ears(52) },
        feet: { L: { at: [0.02, 0, 0.02], heel: -22 }, R: { at: [-0.02, 0, -0.02], heel: -22 } },
    },
    // Foraging: tipped down over its feet, the nose and hands to the
    // ground, the tail lifted behind against it.
    forage: {
        root: [0, -0.33, 0.03], turn: [50, 0, 0],
        bones: { spine: [10, 0, 0], chest: [12, 0, 0], neck: [24, 0, 0], head: [4, 0, 0], ...arms(-36, 24, 10, 0), ...tail([-20, -14, -8, -2, 4]), ...ears(10) },
        feet: { L: { at: [0.02, 0, 0.06], heel: -46 }, R: { at: [-0.02, 0, 0.0], heel: -46 } },
    },
    // Leaping, in the air: stretched out level, the chest lifted and the
    // head up looking where it will land, the arms thrown forward, the tail
    // up behind it, the ears flat. (The legs are the stride's own: rig.bk.)
    leap: {
        turn: [4, 0, 0],
        bones: {
            spine: [-5, 0, 0], chest: [-7, 0, 0], neck: [-6, 0, 0], head: [10, 0, 0], ...arms(-34, 62, 14, 12),
            ...tail([10, 10, 8, 5, 2]), ...ears(46, 10),
        },
    },
    // Lying: down on its belly, the legs folded beside it with the feet
    // flat, the forearms out in front on the ground, the head up, the tail
    // laid round its side.
    lie: {
        root: [0, -0.55, -0.05], turn: [36, 0, 0],
        bones: {
            spine: [-4, 0, 0], chest: [-8, 0, 0], neck: [-26, 0, 0], head: [2, 0, 0], ...arms(-70, 14, -34, 4), ...ears(18),
            tail1: [-42, 24, 0], tail2: [-16, 36, 0], tail3: [-4, 40, 0], tail4: [2, 40, 0], tail5: [2, 30, 0],
        },
        // (The shins lie along the ground back from the knees and the feet
        // come forward over them, the hocks folded as far as they go.)
        // (Its feet stay where it stood: the hips come down behind them.)
        feet: { L: { heel: -52 }, R: { heel: -52 } },
    },
    // Sitting: sat back on its hocks, the body upright, the hands at its
    // breast, the tail laid round. (It sits on its way down to lying and on
    // its way up.)
    rest: {
        root: [0, -0.4, 0.15], turn: [-24, 0, 0],
        bones: {
            spine: [4, 0, 0], chest: [4, 0, 0], neck: [0, 0, 0], head: [16, 0, 0], ...arms(10, 118, 50), ...ears(12),
            tail1: [20, 14, 0], tail2: [4, 24, 0], tail3: [0, 28, 0], tail4: [-4, 28, 0], tail5: [-6, 22, 0],
        },
        feet: { L: { at: [0.02, 0, 0.05], heel: -58 }, R: { at: [-0.02, 0, 0.05], heel: -58 } },
    },
};

export const cycles = { walk: walk.cycle, run: run.cycle };
