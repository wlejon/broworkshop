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
    const hipsAt = (dy, dz = 0, dx = 0) =>
        [hipsBase[0] + dx, hipsBase[1] + dy, hipsBase[2] + dz];

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
    // ONE generator, many tunings, and that is the load-bearing decision in this
    // file. A blend space mixes clips key-for-key at whatever weights the
    // parameter asks for, so two clips only blend into something coherent if
    // their curves have the same SHAPE — same number of strides, the same limb
    // in front at the same phase, the same bones driven. Authoring walk, run,
    // the strafes, the backward walk and the crouch variants as one function
    // with different constants guarantees that structurally instead of hoping
    // for it. It also means a half-mix of walk and run is a real intermediate
    // gait rather than two skeletons fighting.
    //
    // Two extra axes on top of chunk 1's tuning, both defaulting to the
    // straight-ahead walk so `walk` and `run` are byte-identical to before:
    //   dir     +1 strides forward, -1 reverses the swing so the legs reach
    //           BACKWARD — a real backpedal, not `walk` played at speed -1
    //           (which would also reverse the arm counter-swing and the bob).
    //   strafe  -1 / +1 leans and abducts the legs sideways, and yaws the
    //           chest against the travel direction the way a sidestep does.
    const gait = (o) => {
        const dir = o.dir === undefined ? 1 : o.dir;
        const st  = o.strafe || 0;

        // Abduction envelopes: the trailing leg pushes off while the leading
        // one reaches out, half a cycle apart. clamp01 on the sine keeps each
        // leg's contribution one-sided, so the legs scissor sideways rather
        // than both drifting the same way.
        const outL = (p) => st * o.spread * clamp01(Math.sin(TAU * p));
        const outR = (p) => st * o.spread * clamp01(Math.sin(TAU * p + Math.PI));

        return {
            hips: {
                rot: (p) => [o.lean * 0.35 * dir,
                             o.twist * 0.5 * Math.sin(TAU * p) * dir,
                             o.roll * Math.sin(TAU * p) + st * 0.12],
                // Two bobs per stride: the body rises over each support leg.
                pos: (p) => hipsAt(-o.crouch + o.bob * Math.cos(TAU * p * 2),
                                   0, st * 0.035),
            },
            spine: { rot: (p) => [o.lean * 0.3 * dir,
                                  -o.twist * Math.sin(TAU * p) * dir,
                                  st * 0.06] },
            // A sidestep leads with the shoulders, so the chest carries a
            // constant yaw toward the travel direction on top of its swing.
            chest: { rot: (p) => [o.lean * 0.4 * dir,
                                  -o.twist * 1.4 * Math.sin(TAU * p) * dir - st * 0.26,
                                  st * 0.05] },
            head:  { rot: (p) => [-o.lean * 0.6 * dir,
                                  o.twist * 0.8 * Math.sin(TAU * p) * dir + st * 0.18, 0] },

            // Hip flexion is -X (forward), so the leading leg reaches toward
            // +Z; negating with `dir` makes it reach toward -Z instead.
            hip_L:  { rot: (p) => [-o.hip * dir * Math.sin(TAU * p), 0,  0.02 + outL(p)] },
            hip_R:  { rot: (p) => [-o.hip * dir * Math.sin(TAU * p + Math.PI), 0, -0.02 + outR(p)] },
            // Knees only fold backward (+X). Phase-shifted off the hip so the
            // knee folds as the leg comes through, not while it is planted.
            knee_L: { rot: (p) => [o.kneeMin + o.knee * clamp01(Math.sin(TAU * p + 1.7)), 0, 0] },
            knee_R: { rot: (p) => [o.kneeMin + o.knee * clamp01(Math.sin(TAU * p + 1.7 + Math.PI)), 0, 0] },
            ankle_L: { rot: (p) => [-o.ankle * dir * Math.sin(TAU * p + 2.6), 0, 0] },
            ankle_R: { rot: (p) => [-o.ankle * dir * Math.sin(TAU * p + 2.6 + Math.PI), 0, 0] },

            // Arms counter-swing against the same-side leg. Strafing pushes
            // them outward so they clear the hips.
            shoulder_L: { rot: (p) => [-o.arm * dir * Math.sin(TAU * p + Math.PI), 0,
                                        0.08 + st * 0.16] },
            shoulder_R: { rot: (p) => [-o.arm * dir * Math.sin(TAU * p), 0,
                                       -0.08 + st * 0.16] },
            elbow_L:    { rot: (p) => [-(o.elbow + o.elbowSwing * dir * Math.sin(TAU * p + Math.PI)), 0, 0] },
            elbow_R:    { rot: (p) => [-(o.elbow + o.elbowSwing * dir * Math.sin(TAU * p)), 0, 0] },
        };
    };

    // The straight-ahead walk tuning, reused as the base for every variant so
    // the differences between clips stay readable as a short override list.
    const WALK = {
        hip: 0.52, knee: 0.72, kneeMin: 0.08, ankle: 0.18,
        arm: 0.40, elbow: 0.30, elbowSwing: 0.12,
        bob: 0.030, crouch: 0.015, lean: 0.10, twist: 0.09, roll: 0.045,
        spread: 0.34,
    };
    const tune = (over) => Object.assign({}, WALK, over);

    defs.walk = {
        name: 'walk', duration: 1.0, loop: 'loop',
        tracks: sampleTracks(1.0, gait(WALK), 24),
    };

    // Faster cycle, longer stride, deeper knee fold, real forward lean.
    const RUN = tune({
        hip: 0.72, knee: 1.15, kneeMin: 0.20, ankle: 0.28,
        arm: 0.65, elbow: 0.95, elbowSwing: 0.30,
        bob: 0.050, crouch: 0.045, lean: 0.26, twist: 0.15, roll: 0.055,
    });
    defs.run = {
        name: 'run', duration: 0.62, loop: 'loop',
        tracks: sampleTracks(0.62, gait(RUN), 24),
    };

    // --- directional variants ------------------------------------------------
    // The four compass points of the classic locomotion square, feeding the 2D
    // blend space. All four share `walk`'s duration on purpose: the space
    // phase-syncs its members anyway, but equal durations mean the blended
    // cycle length stays constant as the parameter sweeps, so the cadence does
    // not audibly change while the direction does.
    //
    // A backpedal is NOT walk at negative speed. Negative speed reverses
    // everything — the arm counter-swing, the vertical bob, the ankle roll —
    // and reads as a film running backward. Reversing only the hip/arm SWING
    // keeps the bob and the knee fold going forward in time, which is what a
    // person actually does walking backward.
    defs.walkBack = {
        name: 'walkBack', duration: 1.0, loop: 'loop',
        tracks: sampleTracks(1.0, gait(tune({
            dir: -1, hip: 0.40, knee: 0.62, arm: 0.30, lean: 0.06, bob: 0.026,
        })), 24),
    };

    // Strafes: shorter stride, wide abduction, chest yawed into the travel
    // direction. `strafe` sign follows the 2D space's X axis (+1 = the
    // character's right, which is -X in world space since it faces +Z).
    defs.walkStrafeR = {
        name: 'walkStrafeR', duration: 1.0, loop: 'loop',
        tracks: sampleTracks(1.0, gait(tune({
            strafe: 1, hip: 0.20, knee: 0.46, arm: 0.16, spread: 0.38,
            bob: 0.024, twist: 0.04,
        })), 24),
    };
    defs.walkStrafeL = {
        name: 'walkStrafeL', duration: 1.0, loop: 'loop',
        tracks: sampleTracks(1.0, gait(tune({
            strafe: -1, hip: 0.20, knee: 0.46, arm: 0.16, spread: 0.38,
            bob: 0.024, twist: 0.04,
        })), 24),
    };

    // --- crouch pair ---------------------------------------------------------
    // A second 1D space (idle → walk, crouched) so the HUD can show that a
    // blend space is an ordinary base-track citizen: swapping which SPACE is
    // playing crossfades exactly like swapping a clip would.
    //
    // `crouch` drops the hips and `kneeMin` keeps the knees loaded through the
    // whole cycle; a still crouch is the same generator with the stride at
    // zero, which is what keeps the pair blendable with each other.
    const CROUCH = tune({
        crouch: 0.30, kneeMin: 0.62, lean: 0.42, bob: 0.016,
        hip: 0.26, knee: 0.40, arm: 0.18, elbow: 0.75, elbowSwing: 0.06,
    });
    defs.crouchIdle = {
        name: 'crouchIdle', duration: 3.0, loop: 'loop',
        tracks: sampleTracks(3.0, gait(Object.assign({}, CROUCH, {
            hip: 0.0, knee: 0.0, arm: 0.0, elbowSwing: 0.0,
            bob: 0.006, twist: 0.015, roll: 0.010,
        })), 16),
    };
    defs.crouchWalk = {
        name: 'crouchWalk', duration: 1.25, loop: 'loop',
        tracks: sampleTracks(1.25, gait(CROUCH), 24),
    };

    // --- layer clips: wave / point / nod --------------------------------------
    //
    // These three exist to be MASKED and stacked on top of a locomotion blend,
    // and they are authored as a set with deliberately DISJOINT default masks:
    // wave owns the right arm, point owns the left arm, nod owns the head. Run
    // all three at once over a walk and nothing fights, which is the clearest
    // possible demonstration that layers compose — three independent actions
    // and a gait, from four clips and zero per-frame JS.
    //
    // Every one of them drives the whole upper-body bone set (chest, neck,
    // head, both shoulder/elbow/wrist chains), even where the motion is
    // nominally one-sided. That is not padding: a mask entry with no
    // corresponding track leaves that bone at its BIND transform inside the
    // layer, so a bone that is masked IN but not animated would snap to the
    // T-pose and stomp the base. Covering the superset of every mask preset in
    // masks.js means any preset is safe on any of these clips.
    const upperFiller = (side, lift) => ({
        ['shoulder_' + side]: { rot: (p) => [0.04 * Math.sin(TAU * p), 0, lift] },
        ['elbow_' + side]:    { rot: () => [-0.18, 0, lift * 0.5] },
        ['wrist_' + side]:    { rot: () => [0, 0, 0] },
    });

    defs.wave = {
        name: 'wave',
        duration: 1.8,
        loop: 'loop',
        tracks: sampleTracks(1.8, Object.assign({
            hips:  { rot: (p) => [0, -0.06 * envelope(p), 0],
                     pos: (p) => hipsAt(0.010 * Math.sin(TAU * p)) },
            spine: { rot: (p) => [0.02, -0.05 * envelope(p), 0] },
            chest: { rot: (p) => [-0.03, -0.12 * envelope(p), 0] },
            neck:  { rot: (p) => [-0.02 * envelope(p), -0.08 * envelope(p), 0] },
            head:  { rot: (p) => [-0.06 * envelope(p), -0.22 * envelope(p), 0] },

            // Raise to roughly overhead-outward, then oscillate at the elbow.
            shoulder_R: { rot: (p) => [-0.15 * envelope(p), 0, -1.85 * envelope(p)] },
            elbow_R:    { rot: (p) => [-0.20 * envelope(p), 0,
                                       -0.35 * envelope(p)
                                       - 0.50 * envelope(p) * Math.sin(TAU * p * 3)] },
            wrist_R:    { rot: (p) => [0, 0, -0.25 * envelope(p) * Math.sin(TAU * p * 3)] },

            hip_L:  { rot: () => [0, 0,  0.02] },
            hip_R:  { rot: () => [0, 0, -0.02] },
            knee_L: { rot: () => [0.05, 0, 0] },
            knee_R: { rot: () => [0.05, 0, 0] },
        }, upperFiller('L', 0.10)), 40),
    };

    // --- point ---------------------------------------------------------------
    // The LEFT arm comes up and forward and holds, with a small settle. Mirror
    // side to wave on purpose, so `wave` on one layer and `point` on another
    // coexist rather than overwriting each other's shoulder.
    const settle = (p) => envelope(p, 0.22, 0.86);
    defs.point = {
        name: 'point',
        duration: 2.4,
        loop: 'loop',
        tracks: sampleTracks(2.4, Object.assign({
            chest: { rot: (p) => [-0.02, 0.14 * settle(p), 0] },
            neck:  { rot: (p) => [0.03 * settle(p), 0.10 * settle(p), 0] },
            head:  { rot: (p) => [0.05 * settle(p), 0.18 * settle(p), 0] },

            // -X on a hanging arm swings it forward; the small +Z lifts the
            // whole arm away from the hip so the point clears the body.
            shoulder_L: { rot: (p) => [-1.35 * settle(p)
                                       - 0.05 * settle(p) * Math.sin(TAU * p * 2),
                                       0, 0.10 + 0.16 * settle(p)] },
            // The elbow STRAIGHTENS as the arm comes up — a bent point reads
            // as a shrug. The idle bend is -0.18, so this cancels it out.
            elbow_L:    { rot: (p) => [-0.18 + 0.16 * settle(p), 0, 0.05] },
            wrist_L:    { rot: (p) => [-0.12 * settle(p), 0, 0] },
        }, upperFiller('R', -0.10)), 32),
    };

    // --- nod -----------------------------------------------------------------
    // Head and neck only, twice per cycle. Tiny, and that is the point: masked
    // to head-only it should be invisible everywhere except the head, which
    // makes it the cheapest possible read on whether masking works at all.
    defs.nod = {
        name: 'nod',
        duration: 1.5,
        loop: 'loop',
        tracks: sampleTracks(1.5, Object.assign({
            chest: { rot: () => [-0.03, 0, 0] },
            // +X tips the upward-pointing neck/head chain forward.
            neck:  { rot: (p) => [0.16 * envelope(p) * (1 - Math.cos(TAU * p * 2)) * 0.5, 0, 0] },
            head:  { rot: (p) => [0.30 * envelope(p) * (1 - Math.cos(TAU * p * 2)) * 0.5, 0, 0] },
        }, upperFiller('L', 0.10), upperFiller('R', -0.10)), 32),
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

    // --- root-motion variants ------------------------------------------------
    //
    // The same two gaits with ONE extra track: the `root` bone translating
    // steadily down +Z across the cycle. That track is the entire difference
    // between a clip that treadmills and a clip that travels.
    //
    // `root` is the right bone for it. It is parentless, it sits at the origin,
    // and rig.js deliberately excludes it from the skin weights — so it moves
    // the whole hierarchy and deforms nothing, which is exactly what a root
    // bone is for. setRootMotion({ bone: 'root' }) then extracts that
    // displacement out of the pose each tick and hands it to the app.
    //
    // The distances are the blend-space positions the clips sit at multiplied
    // by their durations, so each clip travels at the speed its axis position
    // CLAIMS: walkRM covers 1.6 m in its 1.0 s cycle, runRM 3.1 m in 0.62 s.
    // That is what makes the marker run a fair ruler — the character crosses a
    // 1.5 m marker gap in the time the parameter says it should, and mixing the
    // two mid-axis yields a speed between the two rather than a foot-slide.
    //
    // The ramp is linear and its last key equals the full distance. The engine
    // corrects loop wraps with the clip's net-loop root displacement, so
    // summing consumeRootMotion() over exactly one cycle returns exactly this
    // number — no drift accumulates over a long walk.
    const withRoot = (curves, distance) => Object.assign({}, curves, {
        root: { pos: (p) => [0, 0, p * distance] },
    });

    defs.walkRM = {
        name: 'walkRM', duration: 1.0, loop: 'loop',
        tracks: sampleTracks(1.0, withRoot(gait(WALK), 1.6), 24),
    };
    defs.runRM = {
        name: 'runRM', duration: 0.62, loop: 'loop',
        tracks: sampleTracks(0.62, withRoot(gait(RUN), 3.1), 24),
    };

    const animations = {};
    for (const name of Object.keys(defs)) animations[name] = compileClip(defs[name], rig);

    return { defs, animations, names: Object.keys(defs) };
}
