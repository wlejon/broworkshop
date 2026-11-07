// Scenarios: scripted intent tracks, the lab's stand-in for a brain.
//
// A scenario is { about, duration (s), ground?, start?, track }. `track` is
// keys in time order; each key sets what it names from its time on (a
// value holds until a later key changes it):
//   speed     wanted speed, m/s, along `heading`
//   heading   degrees (0 is +Z, 90 is +X)
//   turn      degrees a second the heading turns, from the key on
//   face      degrees: hold this facing (turning in place), or null to face the way it moves
//   action    'move' | 'graze' | 'startle' | 'lie' | 'alert' | 'bound'
//   param     the action's amount
//   gaze      [x, y, z] to look at, or null
// ground: { slope (deg), uphill (deg), rough (m), wavelength (m), seed }.
// start: { pos: [x, z], yaw (deg) }.
//
// A creature's scenarios.js adds its own (and may replace these by name).

import { INTENT, I, ACTION } from "./contract.js";

const DEG = Math.PI / 180;

const walk = 1.1, trot = 3.0, gallop = 7.5;

export const SCENARIOS = {
    stand: { about: 'standing still: breath, ear flicks', duration: 4, track: [{ t: 0 }] },
    walk: { about: 'a straight walk', duration: 7, track: [{ t: 0, speed: walk }] },
    trot: { about: 'a straight trot', duration: 7, track: [{ t: 0, speed: trot }] },
    gallop: { about: 'a straight gallop', duration: 7, track: [{ t: 0, speed: gallop }] },
    'start-stop': {
        about: 'stand, walk off, stop, stand',
        duration: 8, track: [{ t: 0 }, { t: 1, speed: walk }, { t: 5, speed: 0 }],
    },
    gaits: {
        about: 'walk, trot, gallop and back down to a stop',
        duration: 16,
        track: [{ t: 0, speed: walk }, { t: 3, speed: trot }, { t: 6, speed: gallop }, { t: 9, speed: trot },
                { t: 11.5, speed: walk }, { t: 13.5, speed: 0 }],
    },
    'tight-turn': {
        about: 'a walk round a tight circle (70 deg/s)',
        duration: 8, track: [{ t: 0, speed: 0.9 }, { t: 1.5, turn: 70 }],
    },
    'trot-turn': {
        about: 'a trot into a 90 degree turn',
        duration: 6, track: [{ t: 0, speed: trot }, { t: 2.5, heading: 90 }],
    },
    'turn-in-place': {
        about: 'standing, turn to face behind',
        duration: 6, track: [{ t: 0, face: 0 }, { t: 1, face: 180 }],
    },
    'slope-up': {
        about: 'walk straight up a 15 degree slope',
        duration: 7, ground: { slope: 15, uphill: 0 }, track: [{ t: 0, speed: walk }],
    },
    'slope-down': {
        about: 'walk straight down a 15 degree slope',
        duration: 7, ground: { slope: 15, uphill: 180 }, track: [{ t: 0, speed: walk }],
    },
    'slope-across': {
        about: 'walk across a 15 degree slope (uphill to the left)',
        duration: 7, ground: { slope: 15, uphill: 90 }, track: [{ t: 0, speed: walk }],
    },
    'rough-walk': {
        about: 'walk over rough ground (6 cm bumps, 1.4 m apart)',
        duration: 7, ground: { rough: 0.06, wavelength: 1.4, seed: 3 }, track: [{ t: 0, speed: walk }],
    },
    'rough-trot': {
        about: 'trot over rough ground',
        duration: 7, ground: { rough: 0.06, wavelength: 1.4, seed: 3 }, track: [{ t: 0, speed: trot }],
    },
    idle: {
        about: 'standing, looking round',
        duration: 8,
        track: [{ t: 0 }, { t: 1, gaze: [2, 1.3, 3] }, { t: 3, gaze: [-2.5, 1.0, 2] }, { t: 5, gaze: [0.5, 0.3, 2.5] }, { t: 6.5, gaze: null }],
    },
    graze: { about: 'grazing', duration: 6, track: [{ t: 0 }, { t: 0.5, action: 'graze' }] },
    startle: {
        about: 'standing, then startled by something ahead-right',
        duration: 5, track: [{ t: 0 }, { t: 1, action: 'startle', gaze: [2, 1.2, 4] }, { t: 4, action: 'move', gaze: null }],
    },
    'lie-down': {
        about: 'lie down, rest, get up',
        duration: 12, track: [{ t: 0 }, { t: 1, action: 'lie' }, { t: 7.5, action: 'move' }],
    },
};

// A creature's scenarios merged over the lab's.
export function scenariosFor(creature) {
    return { ...SCENARIOS, ...((creature && creature.def.scenarios) || {}) };
}

// The ground record lab/ground.bk reads (16 floats). `g.log`, a round log
// lying on the ground: { at: [x, z] its middle, yaw (deg) its long axis,
// height (m, its diameter), length (m) }.
export function groundEnv(g = {}) {
    const e = new Float32Array(16);
    e.set([(g.slope || 0) * DEG, (g.uphill || 0) * DEG, g.rough || 0, g.wavelength || 1.5, g.seed || 1, g.base || 0, 0, 0]);
    if (g.log) {
        const at = g.log.at || [0, 0];
        e.set([g.log.height || 1, at[0], at[1], (g.log.yaw || 0) * DEG, g.log.length || 4], 8);
    }
    return e;
}

// The intent at every step of a scenario: Float32Array(steps * INTENT).
export function intentTrack(sc, dt, steps, seed = 1) {
    const out = new Float32Array(steps * INTENT);
    const keys = [...sc.track].sort((a, b) => a.t - b.t);
    const st = { speed: 0, heading: (sc.start && sc.start.yaw) || 0, turn: 0, face: null, action: 'move', param: 0, gaze: null };
    let ki = 0;
    for (let k = 0; k < steps; k++) {
        const t = k * dt;
        while (ki < keys.length && keys[ki].t <= t + 1e-9) {
            const key = keys[ki++];
            for (const f of ['speed', 'heading', 'turn', 'face', 'action', 'param', 'gaze']) if (f in key) st[f] = key[f];
        }
        st.heading += st.turn * dt;
        const h = st.heading * DEG, o = k * INTENT;
        out[o + I.VEL_X] = st.speed * Math.sin(h);
        out[o + I.VEL_Z] = st.speed * Math.cos(h);
        if (st.face != null) { out[o + I.HEADING_MODE] = 1; out[o + I.HEADING] = st.face * DEG; }
        if (st.gaze) { out[o + I.GAZE_X] = st.gaze[0]; out[o + I.GAZE_Y] = st.gaze[1]; out[o + I.GAZE_Z] = st.gaze[2]; out[o + I.GAZE_W] = 1; }
        const a = ACTION[String(st.action).toUpperCase()];
        if (a === undefined) throw new Error(`scenario: unknown action ${st.action}`);
        out[o + I.ACTION] = a;
        out[o + I.ACTION_PARAM] = st.param;
        out[o + I.SEED] = seed;
    }
    return out;
}
