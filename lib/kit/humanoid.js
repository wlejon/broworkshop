// lib/kit/humanoid.js — a procedural humanoid clip library, authored as data.
//
// Every clip is a plain JSON object (a clipDef): a duration, a loop mode and
// per-bone keyframe tracks. The keys are GENERATED from a handful of phase-
// driven curves (a gait cycle is 24 keys x 16 bones, unreadable and untunable
// typed by hand) and baked into ordinary keyframes: JSON.stringify a def and
// it round-trips. compileClip (lib/kit/skeletal.js) turns one into a bromesh
// Animation for any skeleton.
//
//   import { humanoidClipDefs, compileClips, AUTORIG_HUMANOID } from "/lib/kit/humanoid.js";
//   import { boneFrames } from "/lib/kit/skeletal.js";
//
//   const r = Rig.autoRig(mesh, { rigType: 'humanoid' });
//   const clips = compileClips(humanoidClipDefs(), boneFrames(r.skeleton, AUTORIG_HUMANOID),
//                              { only: ['idle', 'walk', 'run'] });
//   for (const n of clips.names) node.addClip(n, clips.animations[n]);
//
// BONES are named by the canonical vocabulary in HUMANOID_BONES (root, hips,
// spine, chest, neck, head, shoulder/elbow/wrist, hip/knee/ankle/toe with _L /
// _R). `_L` is the character's LEFT, which is +X: the character faces +Z.
// boneFrames' `map` renames them for another rig (AUTORIG_HUMANOID below).
//
// ROTATIONS are Euler XYZ in model axes about the bone's pivot (see
// skeletal.js). For a downward-pointing limb:
//   -X swings it toward +Z   forward — hip flexion, arm swing forward, elbow bend
//   +X swings it toward -Z   backward — knee fold, hip extension
// for the upward-pointing spine chain the sense reverses (+X leans forward),
// and -Z lifts a RIGHT-side limb outward, +Z a LEFT-side one. Getting these
// backwards is the easiest way to author a gait that moonwalks.
//
// TRANSLATIONS are offsets from the bone's bind translation: `hips` bobs,
// `root` carries root motion (walkRM / runRM translate it down +Z).

const TAU = Math.PI * 2;

export const HUMANOID_BONES = [
    'root', 'hips', 'spine', 'chest', 'neck', 'head',
    'shoulder_L', 'elbow_L', 'wrist_L', 'shoulder_R', 'elbow_R', 'wrist_R',
    'hip_L', 'knee_L', 'ankle_L', 'toe_L', 'hip_R', 'knee_R', 'ankle_R', 'toe_R',
];

/**
 * boneFrames() options for a `Rig.autoRig(mesh, { rigType: 'humanoid' })`
 * skeleton. The auto-rig names sides by -X = `_L`, so the canonical left (+X)
 * maps to its `_R`; its `shoulder_*` is the clavicle, so the canonical
 * shoulder (the upper-arm joint) is `upper_arm_*`. It binds in a T-pose, so
 * `rest` hangs the arms ~75° into the A-pose the library is authored for.
 */
export const AUTORIG_HUMANOID = {
    map: {
        root: null, hips: 'pelvis', spine: 'spine_01', chest: 'spine_03', neck: 'neck', head: 'head',
        shoulder_L: 'upper_arm_R', elbow_L: 'forearm_R', wrist_L: 'hand_R',
        shoulder_R: 'upper_arm_L', elbow_R: 'forearm_L', wrist_R: 'hand_L',
        hip_L: 'upper_leg_R', knee_L: 'lower_leg_R', ankle_L: 'foot_R', toe_L: 'toe_R',
        hip_R: 'upper_leg_L', knee_R: 'lower_leg_L', ankle_R: 'foot_L', toe_R: 'toe_L',
    },
    rest: { shoulder_L: [0, 0, -1.3], shoulder_R: [0, 0, 1.3] },
};

// --- curve helpers ---------------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));
const smooth = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };

/** Linear interpolation across an ordered [position, value] table. */
function ramp(p, stops) {
    if (p <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; ++i) {
        if (p <= stops[i][0]) {
            const [p0, v0] = stops[i - 1], [p1, v1] = stops[i];
            return v0 + (v1 - v0) * (p - p0) / Math.max(1e-6, p1 - p0);
        }
    }
    return stops[stops.length - 1][1];
}

/** A 0 -> 1 -> 0 envelope with smooth shoulders, so a one-shot gesture loops. */
function envelope(p, rise = 0.18, fall = 0.82) {
    return smooth(p / rise) * (1 - smooth((p - fall) / (1 - fall)));
}

/** Bone -> { rot, pos } curves baked to tracks; see skeletal.js sampleTracks. */
function sample(duration, curves, steps) {
    const tracks = [];
    for (const bone of Object.keys(curves)) {
        const c = curves[bone];
        const rot = c.rot ? [] : null, pos = c.pos ? [] : null;
        for (let i = 0; i <= steps; ++i) {
            const p = i / steps, time = p * duration;
            if (rot) rot.push({ time, euler: c.rot(p) });
            if (pos) pos.push({ time, value: c.pos(p) });
        }
        if (rot) tracks.push({ bone, property: 'rotation', keys: rot });
        if (pos) tracks.push({ bone, property: 'translation', keys: pos });
    }
    return tracks;
}

const clip = (name, duration, curves, steps) =>
    ({ name, duration, loop: 'loop', tracks: sample(duration, curves, steps) });

/** Hips offset: (dy, dz, dx) from the bind pose — a bob is mostly dy. */
const hips = (dy, dz = 0, dx = 0) => [dx, dy, dz];

// --- the gait generator ---------------------------------------------------------
//
// ONE generator, many tunings, and that is the load-bearing decision here. A
// blend space mixes clips key-for-key, so two clips only blend coherently if
// their curves have the same SHAPE — same strides, the same limb in front at
// the same phase, the same bones driven. Walk, run, the strafes, the backpedal
// and the crouch pair are one function with different constants, which
// guarantees that structurally; a half-mix of walk and run is a real
// intermediate gait rather than two skeletons fighting.
//
//   dir     +1 strides forward, -1 reverses the SWING so the legs reach back —
//           a real backpedal, not walk at speed -1 (which would also reverse
//           the bob and the arm counter-swing and read as film run backward).
//   strafe  -1 / +1 leans and abducts the legs sideways and yaws the chest
//           into the travel direction, the way a sidestep does.

function gait(o) {
    const dir = o.dir === undefined ? 1 : o.dir;
    const st = o.strafe || 0;
    // One-sided abduction envelopes half a cycle apart: the legs scissor
    // sideways rather than both drifting the same way.
    const outL = (p) => st * o.spread * clamp01(Math.sin(TAU * p));
    const outR = (p) => st * o.spread * clamp01(Math.sin(TAU * p + Math.PI));
    return {
        hips: {
            rot: (p) => [o.lean * 0.35 * dir, o.twist * 0.5 * Math.sin(TAU * p) * dir,
                         o.roll * Math.sin(TAU * p) + st * 0.12],
            // Two bobs per stride: the body rises over each support leg.
            pos: (p) => hips(-o.crouch + o.bob * Math.cos(TAU * p * 2), 0, st * 0.035),
        },
        spine: { rot: (p) => [o.lean * 0.3 * dir, -o.twist * Math.sin(TAU * p) * dir, st * 0.06] },
        chest: { rot: (p) => [o.lean * 0.4 * dir,
                              -o.twist * 1.4 * Math.sin(TAU * p) * dir - st * 0.26, st * 0.05] },
        head:  { rot: (p) => [-o.lean * 0.6 * dir, o.twist * 0.8 * Math.sin(TAU * p) * dir + st * 0.18, 0] },

        hip_L:  { rot: (p) => [-o.hip * dir * Math.sin(TAU * p), 0,  0.02 + outL(p)] },
        hip_R:  { rot: (p) => [-o.hip * dir * Math.sin(TAU * p + Math.PI), 0, -0.02 + outR(p)] },
        // Knees only fold backward (+X), phase-shifted off the hip so the
        // knee folds as the leg comes through, not while it is planted.
        knee_L: { rot: (p) => [o.kneeMin + o.knee * clamp01(Math.sin(TAU * p + 1.7)), 0, 0] },
        knee_R: { rot: (p) => [o.kneeMin + o.knee * clamp01(Math.sin(TAU * p + 1.7 + Math.PI)), 0, 0] },
        ankle_L: { rot: (p) => [-o.ankle * dir * Math.sin(TAU * p + 2.6), 0, 0] },
        ankle_R: { rot: (p) => [-o.ankle * dir * Math.sin(TAU * p + 2.6 + Math.PI), 0, 0] },

        // Arms counter-swing against the same-side leg; a strafe pushes them
        // outward so they clear the hips.
        shoulder_L: { rot: (p) => [-o.arm * dir * Math.sin(TAU * p + Math.PI), 0, 0.08 + st * 0.16] },
        shoulder_R: { rot: (p) => [-o.arm * dir * Math.sin(TAU * p), 0, -0.08 + st * 0.16] },
        elbow_L: { rot: (p) => [-(o.elbow + o.elbowSwing * dir * Math.sin(TAU * p + Math.PI)), 0, 0] },
        elbow_R: { rot: (p) => [-(o.elbow + o.elbowSwing * dir * Math.sin(TAU * p)), 0, 0] },
    };
}

/** The straight-ahead walk tuning; every variant is a short override list. */
export const WALK = {
    hip: 0.52, knee: 0.72, kneeMin: 0.08, ankle: 0.18,
    arm: 0.40, elbow: 0.30, elbowSwing: 0.12,
    bob: 0.030, crouch: 0.015, lean: 0.10, twist: 0.09, roll: 0.045,
    spread: 0.34,
};
const tune = (over, base) => Object.assign({}, base || WALK, over);

/** Faster cycle, longer stride, deeper knee fold, real forward lean. */
export const RUN = tune({
    hip: 0.72, knee: 1.15, kneeMin: 0.20, ankle: 0.28,
    arm: 0.65, elbow: 0.95, elbowSwing: 0.30,
    bob: 0.050, crouch: 0.045, lean: 0.26, twist: 0.15, roll: 0.055,
});

/** Hips dropped, knees loaded through the whole cycle. */
export const CROUCH = tune({
    crouch: 0.30, kneeMin: 0.62, lean: 0.42, bob: 0.016,
    hip: 0.26, knee: 0.40, arm: 0.18, elbow: 0.75, elbowSwing: 0.06,
});

/**
 * The library, as plain clipDefs keyed by name:
 *   idle, walk, run, walkBack, walkStrafeR, walkStrafeL   locomotion
 *   crouchIdle, crouchWalk                                the crouch pair
 *   wave, point, nod                                      layer gestures
 *   jump                                                  one-shot
 *   walkRM, runRM                                         root-motion gaits
 */
export function humanoidClipDefs() {
    const defs = {};

    // Slow breath plus a barely-there weight shift: the neutral pose
    // everything crossfades back to, so it has to survive any blend.
    defs.idle = clip('idle', 4.0, {
        hips: {
            rot: (p) => [0, 0.035 * Math.sin(TAU * p), 0.02 * Math.sin(TAU * p)],
            pos: (p) => hips(0.012 * Math.sin(TAU * p * 2)),
        },
        spine: { rot: (p) => [0.02 + 0.018 * Math.sin(TAU * p * 2), 0, 0] },
        chest: { rot: (p) => [-0.03 - 0.025 * Math.sin(TAU * p * 2), 0, 0] },
        head:  { rot: (p) => [0.02 * Math.sin(TAU * p), -0.07 * Math.sin(TAU * p), 0] },
        shoulder_L: { rot: (p) => [0.03 * Math.sin(TAU * p), 0, 0.10] },
        elbow_L:    { rot: (p) => [-0.16 - 0.04 * Math.sin(TAU * p), 0, 0.05] },
        shoulder_R: { rot: (p) => [0.03 * Math.sin(TAU * p + 0.6), 0, -0.10] },
        elbow_R:    { rot: (p) => [-0.16 - 0.04 * Math.sin(TAU * p + 0.6), 0, -0.05] },
        hip_L:  { rot: () => [0, 0, 0.02] },
        hip_R:  { rot: () => [0, 0, -0.02] },
        knee_L: { rot: () => [0.05, 0, 0] },
        knee_R: { rot: () => [0.05, 0, 0] },
    }, 16);

    defs.walk = clip('walk', 1.0, gait(WALK), 24);
    defs.run = clip('run', 0.62, gait(RUN), 24);

    // The four compass points of the 2D locomotion square. All share walk's
    // duration so the blended cadence stays constant as direction sweeps.
    defs.walkBack = clip('walkBack', 1.0, gait(tune({
        dir: -1, hip: 0.40, knee: 0.62, arm: 0.30, lean: 0.06, bob: 0.026,
    })), 24);
    // `strafe` +1 = the character's right, which is -X (it faces +Z).
    const STRAFE = { hip: 0.20, knee: 0.46, arm: 0.16, spread: 0.38, bob: 0.024, twist: 0.04 };
    defs.walkStrafeR = clip('walkStrafeR', 1.0, gait(tune({ strafe: 1, ...STRAFE })), 24);
    defs.walkStrafeL = clip('walkStrafeL', 1.0, gait(tune({ strafe: -1, ...STRAFE })), 24);

    // The crouch pair: a still crouch is the same generator with the stride
    // at zero, which is what keeps the two blendable with each other.
    defs.crouchIdle = clip('crouchIdle', 3.0, gait(tune({
        hip: 0.0, knee: 0.0, arm: 0.0, elbowSwing: 0.0, bob: 0.006, twist: 0.015, roll: 0.010,
    }, CROUCH)), 16);
    defs.crouchWalk = clip('crouchWalk', 1.25, gait(CROUCH), 24);

    // --- layer gestures: wave / point / nod ---------------------------------
    // Authored to be MASKED over locomotion, with disjoint natural masks (wave
    // the right arm, point the left, nod the head). Each drives the whole
    // upper-body set anyway: a bone masked IN with no track snaps to its bind
    // transform inside the layer, so covering every upper bone makes any mask
    // preset safe on any of these clips.
    const upperFiller = (side, lift) => ({
        ['shoulder_' + side]: { rot: (p) => [0.04 * Math.sin(TAU * p), 0, lift] },
        ['elbow_' + side]:    { rot: () => [-0.18, 0, lift * 0.5] },
        ['wrist_' + side]:    { rot: () => [0, 0, 0] },
    });

    defs.wave = clip('wave', 1.8, Object.assign({
        hips:  { rot: (p) => [0, -0.06 * envelope(p), 0], pos: (p) => hips(0.010 * Math.sin(TAU * p)) },
        spine: { rot: (p) => [0.02, -0.05 * envelope(p), 0] },
        chest: { rot: (p) => [-0.03, -0.12 * envelope(p), 0] },
        neck:  { rot: (p) => [-0.02 * envelope(p), -0.08 * envelope(p), 0] },
        head:  { rot: (p) => [-0.06 * envelope(p), -0.22 * envelope(p), 0] },
        // Raise to roughly overhead-outward, then oscillate at the elbow.
        shoulder_R: { rot: (p) => [-0.15 * envelope(p), 0, -1.85 * envelope(p)] },
        elbow_R:    { rot: (p) => [-0.20 * envelope(p), 0,
                                   -0.35 * envelope(p) - 0.50 * envelope(p) * Math.sin(TAU * p * 3)] },
        wrist_R:    { rot: (p) => [0, 0, -0.25 * envelope(p) * Math.sin(TAU * p * 3)] },
        hip_L:  { rot: () => [0, 0, 0.02] },
        hip_R:  { rot: () => [0, 0, -0.02] },
        knee_L: { rot: () => [0.05, 0, 0] },
        knee_R: { rot: () => [0.05, 0, 0] },
    }, upperFiller('L', 0.10)), 40);

    // The LEFT arm comes up and forward and holds; mirror side to wave, so
    // the two coexist on separate layers.
    const settle = (p) => envelope(p, 0.22, 0.86);
    defs.point = clip('point', 2.4, Object.assign({
        chest: { rot: (p) => [-0.02, 0.14 * settle(p), 0] },
        neck:  { rot: (p) => [0.03 * settle(p), 0.10 * settle(p), 0] },
        head:  { rot: (p) => [0.05 * settle(p), 0.18 * settle(p), 0] },
        shoulder_L: { rot: (p) => [-1.35 * settle(p) - 0.05 * settle(p) * Math.sin(TAU * p * 2),
                                   0, 0.10 + 0.16 * settle(p)] },
        // The elbow STRAIGHTENS as the arm comes up — a bent point is a shrug.
        elbow_L: { rot: (p) => [-0.18 + 0.16 * settle(p), 0, 0.05] },
        wrist_L: { rot: (p) => [-0.12 * settle(p), 0, 0] },
    }, upperFiller('R', -0.10)), 32);

    // Head and neck, twice per cycle: tiny, so masked to the head it is the
    // cheapest possible read on whether masking works at all.
    defs.nod = clip('nod', 1.5, Object.assign({
        chest: { rot: () => [-0.03, 0, 0] },
        neck:  { rot: (p) => [0.16 * envelope(p) * (1 - Math.cos(TAU * p * 2)) * 0.5, 0, 0] },
        head:  { rot: (p) => [0.30 * envelope(p) * (1 - Math.cos(TAU * p * 2)) * 0.5, 0, 0] },
    }, upperFiller('L', 0.10), upperFiller('R', -0.10)), 32);

    // --- jump: anticipation, extension, float, absorb, recover --------------
    // Starts and ends standing, so it loops cleanly AND works as a one-shot.
    const height = (p) => ramp(p, [[0.00, 0], [0.22, -0.24], [0.34, 0.02], [0.46, 0.34],
                                   [0.60, 0.34], [0.74, 0.02], [0.86, -0.22], [1.00, 0]]);
    const tuck = (p) => ramp(p, [[0.00, 0.05], [0.22, 1.05], [0.36, 0.10], [0.52, 0.85],
                                 [0.68, 0.90], [0.80, 0.25], [0.88, 1.00], [1.00, 0.05]]);
    const armUp = (p) => ramp(p, [[0.00, 0.0], [0.22, -0.70], [0.38, 1.25], [0.60, 1.45],
                                  [0.78, 0.85], [0.88, -0.30], [1.00, 0.0]]);
    defs.jump = clip('jump', 1.4, {
        hips:  { rot: (p) => [0.28 * tuck(p), 0, 0], pos: (p) => hips(height(p)) },
        spine: { rot: (p) => [0.20 * tuck(p), 0, 0] },
        chest: { rot: (p) => [0.18 * tuck(p), 0, 0] },
        head:  { rot: (p) => [-0.30 * tuck(p), 0, 0] },
        hip_L:  { rot: (p) => [-1.05 * tuck(p), 0, 0.04] },
        hip_R:  { rot: (p) => [-1.05 * tuck(p), 0, -0.04] },
        knee_L: { rot: (p) => [1.65 * tuck(p) + 0.05, 0, 0] },
        knee_R: { rot: (p) => [1.65 * tuck(p) + 0.05, 0, 0] },
        ankle_L: { rot: (p) => [-0.45 * tuck(p), 0, 0] },
        ankle_R: { rot: (p) => [-0.45 * tuck(p), 0, 0] },
        shoulder_L: { rot: (p) => [-armUp(p), 0, 0.14] },
        shoulder_R: { rot: (p) => [-armUp(p), 0, -0.14] },
        elbow_L: { rot: (p) => [-(0.30 + 0.35 * tuck(p)), 0, 0] },
        elbow_R: { rot: (p) => [-(0.30 + 0.35 * tuck(p)), 0, 0] },
    }, 36);

    // --- root-motion gaits ---------------------------------------------------
    // The same two gaits plus ONE track: `root` translating steadily down +Z.
    // Distances are the blend-space positions times the durations (walk
    // 1.6 m/s x 1.0 s, run 5.0 m/s x 0.62 s), so each clip travels at the speed
    // its axis position claims and a mid-axis mix yields a speed in between.
    // The ramp is linear and its last key is the full distance; the engine
    // corrects loop wraps with the net-loop displacement, so no drift builds.
    const withRoot = (curves, distance) =>
        Object.assign({}, curves, { root: { pos: (p) => [0, 0, p * distance] } });
    defs.walkRM = clip('walkRM', 1.0, withRoot(gait(WALK), 1.6), 24);
    defs.runRM = clip('runRM', 0.62, withRoot(gait(RUN), 3.1), 24);

    return defs;
}

/**
 * Compile clipDefs for one skeleton. `frames` is boneFrames(skeleton, ...);
 * opts.only limits which clips are compiled. Tracks naming a canonical bone
 * the skeleton lacks (an auto-rig has no `root`) are dropped.
 * Returns { defs, animations, names }.
 */
export function compileClips(defs, frames, opts) {
    const only = opts && opts.only;
    const names = Object.keys(defs).filter((n) => !only || only.includes(n));
    const animations = {};
    for (const n of names) animations[n] = compileClipLenient(defs[n], frames);
    const kept = {};
    for (const n of names) kept[n] = defs[n];
    return { defs: kept, animations, names };
}

import { compileClip } from "./skeletal.js";
const compileClipLenient = (def, frames) => compileClip(def, frames, { lenient: true });
