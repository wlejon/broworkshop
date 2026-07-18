// clips.js — the animation library, authored as data.
//
// Every clip here is a plain JSON object (`clipDef`): a duration, a loop mode,
// and a list of per-bone keyframe tracks. `compileClip` turns one into a
// bromesh `Animation`, which `skinnedMesh.addClip` registers and the engine's
// C++ player evaluates. Nothing in this app poses a bone from JavaScript per
// frame — the whole point is that the engine owns playback, so blending,
// crossfades and (later) blend spaces and state machines all compose on top of
// the same data.
//
// The keyframes are GENERATED rather than typed: a gait cycle is a handful of
// phase-driven curves, and writing 24 keys x 16 bones by hand would be both
// unreadable and impossible to tune. `sampleTracks` evaluates those curves at
// N evenly spaced phases and bakes the result into real keys. The output is
// still ordinary keyframe data — JSON.stringify a clipDef and it round-trips.
//
// Rotation conventions follow from rig.js's identity bind pose. Every limb
// bone points along its own local -Y, and the character FACES +Z (the toe
// bones extend forward along +Z), so for a downward-pointing limb:
//   -X rotation swings it toward +Z   forward — hip flexion, elbow bend
//   +X rotation swings it toward -Z   backward — knee fold, hip extension
// while for the upward-pointing spine chain the sense reverses:
//   +X rotation tips the torso toward +Z, i.e. leans it forward.
// -Z rotation lifts a RIGHT-side limb outward, +Z a LEFT-side one.
//
// Getting these backwards is the single easiest way to end up with a
// convincing gait that moonwalks, so they are stated once here and every
// generator below is written against them.

const TAU = Math.PI * 2;

// ── Math helpers ─────────────────────────────────────────────────────────────

/** Euler XYZ intrinsic (radians) → quaternion xyzw, matching bromesh. */
export function quatFromEuler(x, y, z) {
    const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
    const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
    const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
    return [
        sx * cy * cz + cx * sy * sz,
        cx * sy * cz - sx * cy * sz,
        cx * cy * sz + sx * sy * cz,
        cx * cy * cz - sx * sy * sz,
    ];
}

const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));
const smooth  = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };

/** Linear interpolation across an ordered [position, value] table. */
function ramp(p, stops) {
    if (p <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; ++i) {
        if (p <= stops[i][0]) {
            const [p0, v0] = stops[i - 1], [p1, v1] = stops[i];
            const t = (p - p0) / Math.max(1e-6, p1 - p0);
            return v0 + (v1 - v0) * t;
        }
    }
    return stops[stops.length - 1][1];
}

/** A 0 → 1 → 0 envelope with smooth shoulders, so a one-shot gesture loops. */
function envelope(p, rise = 0.18, fall = 0.82) {
    return smooth(p / rise) * (1 - smooth((p - fall) / (1 - fall)));
}

// ── Clip definition → Animation ──────────────────────────────────────────────

/**
 * Compile a clipDef into a bromesh Animation bound to `rig`'s bone order.
 *
 * Track shape:
 *   { bone: 'hip_L', property: 'rotation'|'translation'|'scale',
 *     interp: 'linear'|'step'|'cubicSpline',
 *     keys: [ { time, euler: [x,y,z] } | { time, value: [...] } ] }
 *
 * Rotation keys accept `euler` (readable, what the generators emit for hand
 * edits) or a raw xyzw `value`; both end up as quaternions in the channel,
 * which is the only thing the engine stores.
 */
export function compileClip(def, rig) {
    const channels = [];

    for (const track of def.tracks) {
        const boneIndex = rig.index[track.bone];
        if (boneIndex === undefined) {
            throw new Error(`clip "${def.name}": unknown bone "${track.bone}"`);
        }
        const stride = track.property === 'rotation' ? 4 : 3;
        const times = new Float32Array(track.keys.length);
        const values = new Float32Array(track.keys.length * stride);

        track.keys.forEach((key, i) => {
            times[i] = key.time;
            const v = key.euler ? quatFromEuler(key.euler[0], key.euler[1], key.euler[2])
                                : key.value;
            values.set(v, i * stride);
        });

        channels.push({
            boneIndex,
            path: track.property,
            interp: track.interp || 'linear',
            times, values,
        });
    }

    return new Animation({ name: def.name, duration: def.duration, channels });
}

/**
 * Bake phase-driven curves into keyframe tracks.
 *
 * `curves` maps a bone name to `{ rot(p), pos(p) }`, each returning an Euler
 * triple / local translation for normalized phase p. Sampling runs 0..steps
 * INCLUSIVE so a looping clip gets a final key identical to its first — the
 * engine wraps at `duration`, and a missing end key would show as a hitch.
 */
function sampleTracks(duration, curves, steps) {
    const tracks = [];
    for (const bone of Object.keys(curves)) {
        const c = curves[bone];
        const rotKeys = c.rot ? [] : null;
        const posKeys = c.pos ? [] : null;

        for (let i = 0; i <= steps; ++i) {
            const p = i / steps;
            const time = p * duration;
            if (rotKeys) rotKeys.push({ time, euler: c.rot(p) });
            if (posKeys) posKeys.push({ time, value: c.pos(p) });
        }

        if (rotKeys) tracks.push({ bone, property: 'rotation', keys: rotKeys });
        if (posKeys) tracks.push({ bone, property: 'translation', keys: posKeys });
    }
    return tracks;
}

// ── The clip library ─────────────────────────────────────────────────────────

/**
 * Author every clip against a rig. Returns the plain clipDefs (for the HUD,
 * for JSON export, for inspection) and the compiled Animations keyed by name.
 * @param {Object} rig - the object buildSkeleton() returned
 * @returns {{ defs: Object, animations: Object, names: string[] }}
 */
export function buildClips(rig) {
    // The hips track carries the body's local translation, so every generator
    // that bobs the body has to start from the bind-pose value rather than
    // from zero — a translation channel REPLACES the bone's local offset.
    const hipsBase = rig.worldPos[rig.index.hips];
    const hipsAt = (dy, dz = 0) => [hipsBase[0], hipsBase[1] + dy, hipsBase[2] + dz];

    const defs = {};

    // --- idle ----------------------------------------------------------------
    // Slow breath plus a barely-there weight shift. Long duration and small
    // amplitudes on purpose: it is the neutral pose everything crossfades
    // back to, and it has to survive being blended with anything.
    defs.idle = {
        name: 'idle',
        duration: 4.0,
        loop: 'loop',
        tracks: sampleTracks(4.0, {
            hips: {
                rot: (p) => [0, 0.035 * Math.sin(TAU * p), 0.02 * Math.sin(TAU * p)],
                pos: (p) => hipsAt(0.012 * Math.sin(TAU * p * 2)),
            },
            spine: { rot: (p) => [0.02 + 0.018 * Math.sin(TAU * p * 2), 0, 0] },
            chest: { rot: (p) => [-0.03 - 0.025 * Math.sin(TAU * p * 2), 0, 0] },
            head:  { rot: (p) => [0.02 * Math.sin(TAU * p), -0.07 * Math.sin(TAU * p), 0] },

            shoulder_L: { rot: (p) => [0.03 * Math.sin(TAU * p), 0,  0.10] },
            elbow_L:    { rot: (p) => [-0.16 - 0.04 * Math.sin(TAU * p), 0, 0.05] },
            shoulder_R: { rot: (p) => [0.03 * Math.sin(TAU * p + 0.6), 0, -0.10] },
            elbow_R:    { rot: (p) => [-0.16 - 0.04 * Math.sin(TAU * p + 0.6), 0, -0.05] },

            hip_L:  { rot: () => [0, 0,  0.02] },
            hip_R:  { rot: () => [0, 0, -0.02] },
            knee_L: { rot: () => [0.05, 0, 0] },
            knee_R: { rot: () => [0.05, 0, 0] },
        }, 16),
    };

    // --- walk / run ----------------------------------------------------------
    // One generator, two tunings. Keeping them structurally identical is what
    // lets a blend space (chunk 2) mix them without the gait falling apart —
    // matching curve SHAPES blend far better than matching key counts.
    const gait = (o) => ({
        hips: {
            rot: (p) => [o.lean * 0.35,
                          o.twist * 0.5 * Math.sin(TAU * p),
                          o.roll * Math.sin(TAU * p)],
            // Two bobs per stride: the body rises over each support leg.
            pos: (p) => hipsAt(-o.crouch + o.bob * Math.cos(TAU * p * 2)),
        },
        spine: { rot: (p) => [o.lean * 0.3, -o.twist * Math.sin(TAU * p), 0] },
        chest: { rot: (p) => [o.lean * 0.4, -o.twist * 1.4 * Math.sin(TAU * p), 0] },
        head:  { rot: (p) => [-o.lean * 0.6, o.twist * 0.8 * Math.sin(TAU * p), 0] },

        // Hip flexion is -X (forward), so the leading leg reaches toward +Z.
        hip_L:  { rot: (p) => [-o.hip * Math.sin(TAU * p), 0,  0.02] },
        hip_R:  { rot: (p) => [-o.hip * Math.sin(TAU * p + Math.PI), 0, -0.02] },
        // Knees only fold backward (+X). Phase-shifted off the hip so the knee
        // folds as the leg comes through, not while it is planted.
        knee_L: { rot: (p) => [o.kneeMin + o.knee * clamp01(Math.sin(TAU * p + 1.7)), 0, 0] },
        knee_R: { rot: (p) => [o.kneeMin + o.knee * clamp01(Math.sin(TAU * p + 1.7 + Math.PI)), 0, 0] },
        ankle_L: { rot: (p) => [-o.ankle * Math.sin(TAU * p + 2.6), 0, 0] },
        ankle_R: { rot: (p) => [-o.ankle * Math.sin(TAU * p + 2.6 + Math.PI), 0, 0] },

        // Arms counter-swing against the same-side leg.
        shoulder_L: { rot: (p) => [-o.arm * Math.sin(TAU * p + Math.PI), 0,  0.08] },
        shoulder_R: { rot: (p) => [-o.arm * Math.sin(TAU * p), 0, -0.08] },
        elbow_L:    { rot: (p) => [-(o.elbow + o.elbowSwing * Math.sin(TAU * p + Math.PI)), 0, 0] },
        elbow_R:    { rot: (p) => [-(o.elbow + o.elbowSwing * Math.sin(TAU * p)), 0, 0] },
    });

    defs.walk = {
        name: 'walk', duration: 1.0, loop: 'loop',
        tracks: sampleTracks(1.0, gait({
            hip: 0.52, knee: 0.72, kneeMin: 0.08, ankle: 0.18,
            arm: 0.40, elbow: 0.30, elbowSwing: 0.12,
            bob: 0.030, crouch: 0.015, lean: 0.10, twist: 0.09, roll: 0.045,
        }), 24),
    };

    // Faster cycle, longer stride, deeper knee fold, real forward lean.
    defs.run = {
        name: 'run', duration: 0.62, loop: 'loop',
        tracks: sampleTracks(0.62, gait({
            hip: 0.72, knee: 1.15, kneeMin: 0.20, ankle: 0.28,
            arm: 0.65, elbow: 0.95, elbowSwing: 0.30,
            bob: 0.050, crouch: 0.045, lean: 0.26, twist: 0.15, roll: 0.055,
        }), 24),
    };

    // --- wave ----------------------------------------------------------------
    // Right arm up and waving over an idle-ish body. Authored as a full-body
    // clip so it stands alone in the selector; chunk 2 masks it to the upper
    // body and layers it over the gait, which is the same data used two ways.
    defs.wave = {
        name: 'wave',
        duration: 1.8,
        loop: 'loop',
        tracks: sampleTracks(1.8, {
            hips:  { rot: (p) => [0, -0.06 * envelope(p), 0],
                     pos: (p) => hipsAt(0.010 * Math.sin(TAU * p)) },
            spine: { rot: (p) => [0.02, -0.05 * envelope(p), 0] },
            chest: { rot: (p) => [-0.03, -0.12 * envelope(p), 0] },
            head:  { rot: (p) => [-0.06 * envelope(p), -0.22 * envelope(p), 0] },

            // Raise to roughly overhead-outward, then oscillate at the elbow.
            shoulder_R: { rot: (p) => [-0.15 * envelope(p), 0, -1.85 * envelope(p)] },
            elbow_R:    { rot: (p) => [-0.20 * envelope(p), 0,
                                       -0.35 * envelope(p)
                                       - 0.50 * envelope(p) * Math.sin(TAU * p * 3)] },
            shoulder_L: { rot: (p) => [0.04 * Math.sin(TAU * p), 0, 0.10] },
            elbow_L:    { rot: (p) => [-0.18, 0, 0.05] },

            hip_L:  { rot: () => [0, 0,  0.02] },
            hip_R:  { rot: () => [0, 0, -0.02] },
            knee_L: { rot: () => [0.05, 0, 0] },
            knee_R: { rot: () => [0.05, 0, 0] },
        }, 40),
    };

    // --- jump ----------------------------------------------------------------
    // A piecewise timeline rather than a sinusoid: anticipation, extension,
    // float, absorb, recover. It starts and ends standing, so it loops cleanly
    // AND works as a one-shot (chunk 3 makes it a one-shot state that
    // auto-advances back to locomotion).
    const JUMP = 1.4;
    const jumpHeight = (p) => ramp(p, [
        [0.00, 0], [0.22, -0.24], [0.34, 0.02], [0.46, 0.34],
        [0.60, 0.34], [0.74, 0.02], [0.86, -0.22], [1.00, 0],
    ]);
    const jumpTuck = (p) => ramp(p, [
        [0.00, 0.05], [0.22, 1.05], [0.36, 0.10], [0.52, 0.85],
        [0.68, 0.90], [0.80, 0.25], [0.88, 1.00], [1.00, 0.05],
    ]);
    const jumpArm = (p) => ramp(p, [
        [0.00, 0.0], [0.22, -0.70], [0.38, 1.25], [0.60, 1.45],
        [0.78, 0.85], [0.88, -0.30], [1.00, 0.0],
    ]);

    defs.jump = {
        name: 'jump',
        duration: JUMP,
        loop: 'loop',
        tracks: sampleTracks(JUMP, {
            hips:  { rot: (p) => [0.28 * jumpTuck(p), 0, 0],
                     pos: (p) => hipsAt(jumpHeight(p)) },
            spine: { rot: (p) => [0.20 * jumpTuck(p), 0, 0] },
            chest: { rot: (p) => [0.18 * jumpTuck(p), 0, 0] },
            head:  { rot: (p) => [-0.30 * jumpTuck(p), 0, 0] },

            // Knees come forward (-X hip) and fold back (+X knee); the ankle
            // dorsiflexes so the toe stays up through the tuck.
            hip_L:  { rot: (p) => [-1.05 * jumpTuck(p), 0,  0.04] },
            hip_R:  { rot: (p) => [-1.05 * jumpTuck(p), 0, -0.04] },
            knee_L: { rot: (p) => [1.65 * jumpTuck(p) + 0.05, 0, 0] },
            knee_R: { rot: (p) => [1.65 * jumpTuck(p) + 0.05, 0, 0] },
            ankle_L: { rot: (p) => [-0.45 * jumpTuck(p), 0, 0] },
            ankle_R: { rot: (p) => [-0.45 * jumpTuck(p), 0, 0] },

            // jumpArm is written as "how far forward"; -X is forward for a
            // hanging arm, so the whole curve is negated on the way in.
            shoulder_L: { rot: (p) => [-jumpArm(p), 0,  0.14] },
            shoulder_R: { rot: (p) => [-jumpArm(p), 0, -0.14] },
            elbow_L:    { rot: (p) => [-(0.30 + 0.35 * jumpTuck(p)), 0, 0] },
            elbow_R:    { rot: (p) => [-(0.30 + 0.35 * jumpTuck(p)), 0, 0] },
        }, 36),
    };

    // CHUNK 2: `walk` and `run` share the `gait` generator, so
    //   addBlendSpace1D('locomotion', [{clip:'idle',pos:0},
    //                                  {clip:'walk',pos:1.6},
    //                                  {clip:'run',pos:5.0}])
    // mixes cleanly. Add strafe variants here (gait({...}) with a lateral hip
    // offset and a yawed chest) to feed addBlendSpace2D. `wave` is already
    // authored to sit on the upper body only — mask it to
    // chest/neck/head/shoulder_*/elbow_*/wrist_* for playLayer.
    // CHUNK 3: `jump` starts and ends standing, which is exactly the shape a
    // one-shot state-machine state with autoAdvance wants. For root motion,
    // add a variant whose `hips` translation track advances in +Z across the
    // cycle — setRootMotion({ bone: 'hips' }) then extracts it.

    const animations = {};
    for (const name of Object.keys(defs)) animations[name] = compileClip(defs[name], rig);

    return { defs, animations, names: Object.keys(defs) };
}
