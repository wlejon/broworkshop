// scene_setup.js — the stage and the moving sound sources.
//
// The geometry exists to make the audio legible. There is a ground plane to
// give the orbits a floor to read against, a ring of pillars so the camera has
// parallax while you orbit (which is what makes a camera-bound listener
// obvious), and a listener marker at the origin so the "where am I hearing
// from" question has a visible answer.
//
// The sources are the point. Each one is a mesh node on a parametric path,
// with a broaudio playback attached via node.attachAudioEmitter(). After the
// attach, THIS FILE NEVER TOUCHES AUDIO POSITION AGAIN — the app only moves
// the node, and the engine derives spatial position and velocity from the
// node's world transform each frame. That is the whole difference from the
// older demos/spatial-audio, which pushed setVoiceSpatialPosition by hand
// every frame from a three.js transform.
//
// Paths are drawn as rings of small emissive beads sampled from the same
// path function that drives the node, so what you see is provably the path
// the audio travels.

const TAU = Math.PI * 2;

/** Ground, pillars, sun, listener marker. Returns the props worth keeping. */
export function buildEnvironment(scene) {
    scene.setAmbient([0.035, 0.045, 0.06]);
    scene.setToneMap({ mode: 'aces', exposure: 1.15 });
    scene.setFog({ color: '#0a1017', start: 40, end: 130 });

    scene.createMesh({
        mesh: 'plane', name: 'ground',
        positions: undefined, halfW: 70, halfD: 70,
        y: 0, color: '#243040', roughness: 0.92, metallic: 0.0,
    });

    // A ring of pillars at the orbit radius of the car: they give the eye a
    // fixed frame while the camera swings, and they occlude nothing acoustically
    // (there is no occlusion model) which is itself worth noticing.
    const pillars = [];
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        pillars.push(scene.createMesh({
            mesh: 'cylinder', name: `pillar${i}`,
            radius: 0.5, halfHeight: 3.2, segments: 12,
            x: Math.cos(a) * 26, y: 3.2, z: Math.sin(a) * 26,
            color: '#33445c', roughness: 0.75,
        }));
    }

    // The sun. Shadows make the moving sources read as objects in a space
    // rather than floating dots, which matters for judging where they are.
    const sun = scene.createLight({
        type: 'directional', name: 'sun',
        direction: [-0.45, -0.82, -0.35],
        color: '#fff2dd', intensity: 3.1,
    });
    sun.castsShadow = true;

    scene.createLight({
        type: 'point', name: 'fill',
        position: [0, 5, 0], color: '#5fa8ff', intensity: 8, range: 30,
    });

    // The listener marker sits at the orbit centre. It is decoration: the real
    // listener is wherever the camera is, which is exactly the point the HUD
    // toggle makes when you unbind and the mix stops following you.
    const listenerMark = scene.createMesh({
        mesh: 'sphere', name: 'listenerMark', radius: 0.55, segments: 20, rings: 14,
        x: 0, y: 1.2, z: 0, color: '#e8f4ff', emissive: 0.5, emissiveColor: '#7fd0ff',
        roughness: 0.3,
    });

    return { pillars, sun, listenerMark };
}

/**
 * Create one emitting source: a mesh on a path, with a looping clip attached
 * to the node as an audio emitter.
 *
 * @param {object} spec.path  t (seconds) -> [x, y, z]; also sampled for beads
 */
function makeSource(scene, ctx, spec) {
    const p0 = spec.path(0);
    const node = scene.createMesh({
        mesh: spec.mesh || 'sphere', name: spec.key,
        radius: spec.radius || 0.4, segments: 18, rings: 12,
        halfW: spec.halfW, halfH: spec.halfH, halfD: spec.halfD,
        x: p0[0], y: p0[1], z: p0[2],
        color: spec.color, emissive: 0.55, emissiveColor: spec.color,
        roughness: 0.4, metallic: 0.1,
    });

    // Loop the clip, then hand the playback to the node. attachAudioEmitter
    // flips spatialization on for us and pushes the current world position
    // immediately, so the very first mixed block is already placed correctly.
    const playback = ctx.playClip(spec.clip.id, spec.gain, true);
    node.attachAudioEmitter(playback);

    // Distance model is still ours to tune — the attach only owns position and
    // velocity. Ref distance sets where attenuation starts; max distance keeps
    // the far sources from vanishing entirely at the far side of the orbit.
    ctx.setPlaybackSpatialDistanceModel(playback, 'inverse');
    ctx.setPlaybackSpatialRefDistance(playback, spec.refDistance || 3.0);
    ctx.setPlaybackSpatialMaxDistance(playback, 240);
    ctx.setPlaybackSpatialRolloff(playback, spec.rolloff || 1.0);

    // Path beads, sampled from the same function that drives the node.
    const beads = [];
    if (spec.beadCount) {
        for (let i = 0; i < spec.beadCount; i++) {
            const p = spec.path((i / spec.beadCount) * spec.period);
            beads.push(scene.createMesh({
                mesh: 'sphere', name: `${spec.key}_bead${i}`,
                radius: 0.09, segments: 6, rings: 4,
                x: p[0], y: p[1], z: p[2],
                color: spec.color, emissive: 1.2, emissiveColor: spec.color,
            }));
        }
    }

    return {
        key: spec.key, label: spec.label, color: spec.color, busKey: spec.busKey,
        node, playback, beads,
        path: spec.path, period: spec.period,
        gain: spec.gain,
        // `clock` is the source's OWN time. Pausing a source freezes its clock
        // and nothing else, so the others keep circling — which is what makes
        // "mute the world, listen to one thing move" possible without touching
        // the mixer.
        clock: 0, moving: true, speed: spec.speed || 1.0,
    };
}

/**
 * Build every moving source. `clips` comes from audio_sources.buildClips().
 * Returns an array in HUD order.
 */
export function buildSources(scene, ctx, clips) {
    const sources = [];

    // Car: a wide, slow circle at head height. The workhorse — big enough
    // radius that distance attenuation swings a lot across one lap.
    sources.push(makeSource(scene, ctx, {
        key: 'car', label: 'car', color: '#ff8a5c', busKey: 'vehicles',
        clip: clips.car, gain: 0.85, mesh: 'box',
        halfW: 0.9, halfH: 0.45, halfD: 1.6, radius: 0.9,
        refDistance: 5, period: 16, speed: 1.0, beadCount: 72,
        path: (t) => {
            const a = (t / 16) * TAU;
            return [Math.cos(a) * 18, 0.7, Math.sin(a) * 18];
        },
    }));

    // Bee: a tight, fast orbit right next to the listener, with a vertical
    // bob. At this radius the head model does most of the work and the pan
    // swings hard — the clearest demonstration that position is live.
    sources.push(makeSource(scene, ctx, {
        key: 'bee', label: 'bee', color: '#ffe066', busKey: 'insects',
        clip: clips.bee, gain: 0.5, radius: 0.16,
        refDistance: 1.2, rolloff: 1.4, period: 2.4, speed: 1.0, beadCount: 60,
        path: (t) => {
            const a = (t / 2.4) * TAU;
            return [Math.cos(a) * 2.6, 1.5 + Math.sin(a * 3) * 0.5, Math.sin(a) * 2.6];
        },
    }));

    // Machine: fixed. The control in the experiment — it never Dopplers, so
    // any wobble you hear belongs to something else.
    sources.push(makeSource(scene, ctx, {
        key: 'machine', label: 'machine', color: '#7be0c4', busKey: 'machines',
        clip: clips.machine, gain: 0.7, mesh: 'box',
        halfW: 1.2, halfH: 1.2, halfD: 1.2, radius: 1.2,
        refDistance: 4, period: 1, speed: 1.0, beadCount: 0,
        path: () => [-11, 1.2, -8],
    }));

    // Bird: a long figure-eight overhead. Elevation is the axis the head model
    // handles with its cutoff shift, so this one is the elevation-cue exhibit.
    sources.push(makeSource(scene, ctx, {
        key: 'bird', label: 'bird', color: '#b8a5ff', busKey: 'air',
        clip: clips.bird, gain: 0.9, radius: 0.28,
        refDistance: 6, period: 12, speed: 1.0, beadCount: 80,
        path: (t) => {
            const a = (t / 12) * TAU;
            return [Math.sin(a) * 22, 9 + Math.sin(a * 2) * 3.5, Math.sin(a * 2) * 11];
        },
    }));

    return sources;
}

/**
 * Advance every source's own clock and write the resulting position onto its
 * node. This is the ONLY per-frame work the app does for spatial audio — no
 * setPlaybackSpatialPosition, no velocity bookkeeping, no listener maths.
 */
export function tickSources(sources, dt) {
    for (const s of sources) {
        if (!s.moving) continue;
        s.clock += dt * s.speed;
        const p = s.path(s.clock);
        s.node.position = p;
    }
}

/** Show or hide every path bead. */
export function setPathsVisible(sources, visible) {
    for (const s of sources) for (const b of s.beads) b.visible = visible;
}
