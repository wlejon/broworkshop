// The courser's keys: the poses it is drawn in and the cycles made of them
// (lab/posing.js has the form). Angles in degrees, lengths in metres. A
// pose places the feet (the ball of each from where it rests) and turns the
// bones off the legs; the legs are solved.
//
// Its gaits are not drawn pose by pose: `stride` makes a pose for any phase
// of a stride from how the courser moves (below), and a cycle is that read
// at eight phases a step. The attitudes (alert, flinching, pecking,
// resting) are drawn.
//
// Sides: phase 0 is the left foot's touchdown; a cycle's second half is its
// first mirrored.

const TAU = 2 * Math.PI;
const cos = (turns) => Math.cos(TAU * turns);
const smooth = (t) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const mix = (a, b, t) => a + (b - a) * t;
const frac = (x) => x - Math.floor(x);

// The neck and head. `reach` bends the neck's foot forward and its top back
// by as much, which carries the head forward (back, under 0) without
// tipping it; `down` bends the whole neck forward and down (under 0: drawn
// up tall); `nose` is the bill's own pitch below level, whatever the neck
// and the body (`body`, its pitch) are doing under it. `yaw` turns the head.
const neck = (reach = 0, down = 0, nose = 0, body = 0, yaw = 0) => ({
    neck1: [reach + 0.4 * down, 0.2 * yaw, 0],
    neck2: [0.35 * down, 0.2 * yaw, 0],
    neck3: [-reach + 0.25 * down, 0.25 * yaw, 0],
    head: [nose - down - body, 0.35 * yaw, 0],
});

// The wings: `out` swings the tips out from the flanks, `lift` raises them.
const wings = (out = 0, lift = 0, more = 0) => ({ wingL: [lift, -out - more, 0], wingR: [lift, out - more, 0] });

// The crest raised by `up` (0: lying back along the nape).
const crest = (up = 0) => ({ crest1: [0.65 * up, 0, 0], crest2: [0.35 * up, 0, 0] });

// The tail's joints lifted (x, deg each) and swung (y).
const tail = (lift = [0, 0, 0], swing = [0, 0, 0]) => Object.fromEntries(lift.map((x, i) => [`tail${i + 1}`, [x, swing[i], 0]]));

// --- how it goes ---------------------------------------------------------------
// It goes as a ground bird does. One phase p of a stride (0: the left foot
// lands) places all of it.
//
//   legs    the strider's: a foot lands ahead on the ball with the hock
//           high, the hock gives as the weight comes over it, then the
//           heel rises and it pushes off behind; in the air the foot folds
//           up under the thigh, swings through and reaches
//   body    level, and kept so: the hips sink and rise and turn a little
//           with each step and the back gives that up along its length, so
//           the breast hardly moves
//   head    walking, it is thrown forward once a step and then left where
//           it is in the world while the body walks up under it (the neck
//           folding into its S), then thrown forward again; running, the
//           neck is stretched out low ahead and held there
//   tail    the fan is the body's counterweight: it tips against the
//           hips' pitch and swings a little behind their turning
//   wings   shut at a walk; at a run held a little off the flanks, and
//           flicked out at each landing to steady it
//   crest   lies back, lifting a little after each of the head's throws
function stride(p, G) {
    // One leg at phase q since its touchdown: the ball from its rest place.
    // Zero-slope C1 heel roll and smooth toe uncurling across liftoff (s = 1, u = 0).
    const leg = (q) => {
        if (q < G.duty) {
            const s = q / G.duty;
            const heel = s < 0.45
                ? mix(G.heelLand, G.heelGive, smooth(s / 0.45))
                : mix(G.heelGive, G.heelPush, smooth((s - 0.45) / 0.55));
            return { z: G.reach * (1 - 2 * s) + G.ahead, y: 0, heel, toe: mix(G.toeLand, 0, smooth(s / 0.34)) };
        }
        const u = (q - G.duty) / (1 - G.duty);
        const heel = u < 0.34
            ? mix(G.heelPush, G.heelFold, smooth(u / 0.34))
            : mix(G.heelFold, G.heelLand, smooth((u - 0.34) / 0.66));
        const toe = u < 0.38
            ? mix(0, G.toeCurl, smooth(u / 0.38))
            : u < 0.84
                ? mix(G.toeCurl, G.toeOpen, smooth((u - 0.38) / 0.46))
                : mix(G.toeOpen, G.toeLand, smooth((u - 0.84) / 0.16));
        // (It reaches a little past where it lands and is drawn back onto the ground.)
        const fwd = smooth(u / 0.92);
        const z = G.reach * (-1 + 2 * (u < 0.92 ? 1.035 * fwd : mix(1.035, 1, smooth((u - 0.92) / 0.08)))) + G.ahead;
        return { z, y: G.lift * Math.sin(Math.PI * u ** 0.92) ** 1.65, heel, toe };
    };
    const l = leg(p), r = leg((p + 0.5) % 1);
    const yaw = (ph) => -G.yaw * cos(ph - 0.03);
    const sway = G.sway * cos(p - G.duty / 2);
    const bob = -G.bob * cos(2 * (p - G.low));
    const nod = G.nod * cos(2 * (p - G.low - 0.08));
    const Y = yaw(p), roll = G.roll * cos(p - G.duty / 2);
    // The head's throw: s runs 0..1 over a step from the throw's start.
    // Thrown forward over `throwT` of the step, then let back at the
    // body's pace until the next.
    const s = frac(2 * (p - G.throwAt));
    const held = (s - G.throwT) / (1 - G.throwT);
    const thrown = s < G.throwT ? mix(-1, 1, smooth(s / G.throwT)) : mix(1, -1, 0.7 * held + 0.3 * smooth(held));
    const reach = G.neckReach + G.throw * thrown;
    // (The crest lifts smoothly as the head stops at the throw's end, and settles.)
    const flick = G.crestFlick * smooth(s / G.throwT) * (1 - smooth(Math.max(0, held)));
    // The wings' flick at a landing, each a moment after its own side's foot.
    const flickL = G.wingFlick * Math.max(0, cos(p - 0.07)) ** 6, flickR = G.wingFlick * Math.max(0, cos(p - 0.57)) ** 6;
    const pitch = G.pitch + nod;
    const sw = (i) => -G.tailYaw * (1 + 0.5 * i) * cos(p - 0.03 - G.tailLag * (i + 1));
    return {
        root: [sway, G.down + bob, G.fore],
        turn: [pitch, Y, roll],
        bones: {
            spine: [-0.35 * nod, -0.35 * Y, -0.5 * roll],
            chest: [-0.35 * nod, -0.45 * Y, -0.4 * roll],
            ...neck(reach, G.neckDown + 0.4 * G.throw * (1 - thrown * thrown), G.nose, G.pitch + 0.3 * nod, -0.2 * Y),
            wingL: [G.wingLift + 0.4 * flickL, -G.wingOut - flickL, 0],
            wingR: [G.wingLift + 0.4 * flickR, G.wingOut + flickR, 0],
            ...crest(G.crest + flick),
            ...tail([0, 1, 2].map((i) => G.tailLift[i] - 0.5 * pitch - G.tailBob * (1 + 0.5 * i) * cos(2 * (p - G.low - 0.1 - 0.06 * i))),
                [0, 1, 2].map((i) => sw(i) - (i ? sw(i - 1) : 0))),
        },
        feet: {
            L: { at: [-G.inset, l.y, l.z], heel: l.heel, toe: l.toe },
            R: { at: [G.inset, r.y, r.z], heel: r.heel, toe: r.toe },
        },
    };
}

// The walk: a measured strut, the head thrown and held at every step.
const WALK = {
    duty: 0.62, reach: 0.25, ahead: 0.01, lift: 0.1, inset: 0.035,
    heelLand: -4, heelGive: -13, heelPush: 32, heelFold: 58,
    toeCurl: 24, toeOpen: -9, toeLand: -5,
    down: -0.022, bob: 0.012, low: 0.06, fore: 0, sway: 0.016, yaw: 6, roll: 2.0, pitch: 0, nod: 1.0,
    throwAt: 0.2, throwT: 0.36, throw: 9, neckReach: 0, neckDown: 0, nose: 0, crestFlick: 9, crest: 0,
    wingOut: 0, wingLift: 0, wingFlick: 0,
    tailLift: [0, 0, 0], tailBob: 0.9, tailYaw: 2.2, tailLag: 0.07,
};
// The run: stretched out, the neck low ahead and the tail level behind, a
// long step and a flight after each.
const RUN = {
    duty: 0.3, reach: 0.29, ahead: -0.02, lift: 0.17, inset: 0.05,
    heelLand: 2, heelGive: -16, heelPush: 42, heelFold: 74,
    toeCurl: 26, toeOpen: -8, toeLand: -4,
    down: -0.05, bob: 0.022, low: 0.15, fore: 0.02, sway: 0.008, yaw: 7, roll: 1.5, pitch: 7, nod: 0.4,
    throwAt: 0.2, throwT: 0.5, throw: 0, neckReach: 16, neckDown: 26, nose: 4, crestFlick: 3, crest: -6,
    wingOut: 9, wingLift: 5, wingFlick: 10,
    tailLift: [3, 2, 1], tailBob: 1.6, tailYaw: 2.6, tailLag: 0.06,
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
    // Alert: drawn up tall on straight legs, the neck straight up and the
    // crest raised, the wings a little off the flanks.
    alert: {
        root: [0, 0.03, 0.03], turn: [-7, 0, 0],
        bones: { spine: [-2, 0, 0], ...neck(-3, -24, -4, -9), ...crest(62), ...wings(7, 3), ...tail([-4, -3, -2]) },
        feet: { L: { heel: 6 }, R: { heel: 6 } },
    },
    // Flinching: down on its hocks, the neck snatched back into its S and
    // the head low, the crest up and the wings thrown half open.
    flinch: {
        root: [0, -0.14, 0.0], turn: [5, 0, 0],
        bones: { spine: [3, 0, 0], ...neck(-30, 18, 6, 8), ...crest(80), ...wings(38, 16), ...tail([10, 8, 6]) },
        feet: { L: { at: [0.02, 0, 0.02], heel: -22 }, R: { at: [-0.02, 0, -0.02], heel: -22 } },
    },
    // Pecking: tipped down over its feet, the neck down and the bill to the
    // ground, the tail up behind against it.
    forage: {
        root: [0, -0.2, 0.0], turn: [36, 0, 0],
        bones: { ...neck(4, 96, 72, 36), ...crest(-6), ...tail([-16, -10, -6]) },
        feet: { L: { at: [0.02, 0, 0.06], heel: -34 }, R: { at: [-0.02, 0, 0.0], heel: -34 } },
    },
    // Leaping, in the air: the neck stretched out ahead, the wings thrown
    // open and up, the tail lifted, the crest flat. (The legs are the
    // stride's own: rig.bk.)
    leap: {
        turn: [2, 0, 0],
        bones: { spine: [-2, 0, 0], chest: [-3, 0, 0], ...neck(18, 22, 2, -3), ...crest(-8), ...wings(64, 30), ...tail([4, 2, 1]) },
    },
    // Lying: sat down on its folded legs as a hen sits, the breast on the
    // ground, the neck drawn back into its S, the tail level.
    lie: {
        root: [0, -0.52, -0.02], turn: [3, 0, 0],
        bones: { ...neck(-20, 6, 0, 3), ...crest(4), ...wings(3, 0), ...tail([4, 2, 0]) },
        // (Its feet stay where it stood: the hips come down behind them.)
        feet: { L: { heel: -52 }, R: { heel: -52 } },
    },
    // Sitting: back on its hocks, the body tipped up, on its way down to
    // lying and on its way up.
    rest: {
        root: [0, -0.36, 0.1], turn: [-12, 0, 0],
        bones: { ...neck(-8, 0, 0, -12), ...crest(14), ...wings(10, 4), ...tail([-12, -8, -4]) },
        feet: { L: { at: [0.02, 0, 0.05], heel: -56 }, R: { at: [-0.02, 0, 0.05], heel: -56 } },
    },
};

export const cycles = { walk: walk.cycle, run: run.cycle };
