// lib/kit/sky.js — outdoor lighting for bro.scene demos: the shared HDR skies,
// a sun direction from angles, and a time-of-day rig.
//
//   import { hdriPath, skyEnvironment, sunDirection, sunControls, daylight } from "/lib/kit/sky.js";
//   skyEnvironment(scene, { hdri: 'kloofendal_43d_clear_puresky', intensity: 1 });
//   sun.direction = sunDirection(40, 135);              // elevation, heading (degrees)
//   sunControls('#sunPanel', sun, { elevation: 40 });   // the same as sliders
//   const rig = daylight(scene, { order: ['dawn', 'noon', 'golden', 'night'] });
//   rig.apply('golden');  rig.update(dt);               // fireflies drift at night
//
// The panoramas are the CC0 set committed once under demos/lighting-demo/hdri;
// hdriPath() resolves them from any app folder. When one is missing the rig
// falls back to a flat ambient so the app still runs.

import { params } from "./params.js";

/** The committed panoramas (demos/lighting-demo/hdri/<name>_2k.hdr). */
export const HDRIS = [
    'venice_sunset', 'kiara_1_dawn', 'spruit_sunrise', 'kloppenheim_06_puresky',
    'kloofendal_43d_clear_puresky', 'qwantani_puresky', 'belfast_sunset_puresky',
    'the_sky_is_on_fire', 'moonless_golf', 'dikhololo_night', 'snowy_forest_path_01',
    'spiaggia_di_mondello',
];

/** Absolute path of a committed panorama, from any app folder. */
export function hdriPath(name) {
    const lib = bro.resolvePath('/lib').replace(/\\/g, '/');
    return lib + '/../demos/lighting-demo/hdri/' + name + '_2k.hdr';
}

/**
 * setEnvironment with a committed panorama; on failure clears it and sets
 * `fallbackAmbient` (an [r, g, b]) instead. Returns whether the HDR loaded.
 */
export function skyEnvironment(scene, { hdri, intensity = 1, rotation = 0, fallbackAmbient = [0.3, 0.33, 0.36] }) {
    const ok = !!scene.setEnvironment({ hdr: hdriPath(hdri), intensity, rotation });
    if (!ok) {
        scene.setEnvironment(null);
        scene.setAmbient(fallbackAmbient);
    }
    return ok;
}

/**
 * The `direction` of a directional light (sun to scene) for a sun
 * `elevationDeg` above the horizon, with the light heading `headingDeg`
 * around +Y (0: light travels toward +Z, so the sun sits in -Z; 90: toward +X).
 */
export function sunDirection(elevationDeg, headingDeg) {
    const el = elevationDeg * Math.PI / 180, hd = headingDeg * Math.PI / 180;
    return [Math.sin(hd) * Math.cos(el), -Math.sin(el), Math.cos(hd) * Math.cos(el)];
}

/**
 * Sun elevation / heading / intensity sliders (kit params rows) driving a
 * directional LightNode, applied once up front. Returns { state, apply, panel }.
 */
export function sunControls(target, sun, init) {
    const state = Object.assign({ elevation: 40, heading: 135, intensity: 3 }, init);
    const deg = (v) => v + '°';
    const apply = () => {
        sun.direction = sunDirection(state.elevation, state.heading);
        sun.intensity = state.intensity;
    };
    const panel = params(target, state, {
        elevation: { min: 5, max: 85, step: 1, label: 'sun elevation', fmt: deg },
        heading:   { min: 0, max: 360, step: 5, label: 'sun heading', fmt: deg },
        intensity: { min: 0.5, max: 8, step: 0.1, label: 'sun intensity' },
    }, { onChange: apply });
    apply();
    return { state, apply, panel };
}

// --- time of day ----------------------------------------------------------------
//
// A preset is a whole lighting state. `sun.direction` points FROM the sun TO
// the scene; `envRotation` spins the sky so its bright spot sits behind that
// direction. `emissiveGain` scales self-lit things (flower eyes, lamps) and
// reaches the app through onChange. `fireflies` > 0 spawns that many drifting
// warm point lights; `spot` adds one spot light (a moonbeam); `fill` a second,
// shadowless directional. Fog distances are for a ~16 m scene: rig.setScale()
// stretches them (and the firefly swarm) for bigger ones.

export const DAYLIGHT = {
    studio: {
        label: 'Studio',
        hdri: 'kloofendal_43d_clear_puresky', envIntensity: 0.85, envRotation: 2.3,
        sun: { direction: [-0.42, -0.82, -0.35], color: [1.0, 0.96, 0.88], intensity: 3.0 },
        fill: { direction: [0.55, -0.3, 0.45], color: [0.55, 0.68, 0.85], intensity: 0.6 },
        tonemap: { mode: 'aces', exposure: 1.02 },
        fog: { start: 24, end: 110, color: [0.72, 0.78, 0.84] },
        ambientFallback: [0.30, 0.33, 0.36],
        emissiveGain: 0.5, fireflies: 0,
    },
    dawn: {
        label: 'Dawn',
        hdri: 'spruit_sunrise', envIntensity: 0.45, envRotation: 2.00,
        sun: { direction: [-0.62, -0.46, -0.34], color: [1.00, 0.78, 0.55], intensity: 3.6 },
        tonemap: { mode: 'aces', exposure: 1.00 },
        fog: { start: 15, end: 60, color: [0.82, 0.74, 0.66] },
        ambientFallback: [0.26, 0.26, 0.30],
        emissiveGain: 0.8, fireflies: 0,
    },
    noon: {
        label: 'Noon',
        hdri: 'kloofendal_43d_clear_puresky', envIntensity: 0.20, envRotation: 2.30,
        sun: { direction: [-0.32, -0.90, -0.28], color: [1.00, 0.97, 0.92], intensity: 5.0 },
        tonemap: { mode: 'aces', exposure: 0.95 },
        fog: { start: 26, end: 80, color: [0.66, 0.74, 0.82] },
        ambientFallback: [0.30, 0.34, 0.32],
        emissiveGain: 0.5, fireflies: 0,
    },
    golden: {
        label: 'Golden hour',
        hdri: 'the_sky_is_on_fire', envIntensity: 0.30, envRotation: 4.00,
        sun: { direction: [-0.74, -0.34, -0.20], color: [1.00, 0.62, 0.32], intensity: 4.8 },
        tonemap: { mode: 'aces', exposure: 0.95 },
        fog: { start: 18, end: 70, color: [0.86, 0.55, 0.40] },
        ambientFallback: [0.28, 0.24, 0.22],
        emissiveGain: 0.9, fireflies: 0,
    },
    night: {
        label: 'Night',
        hdri: 'dikhololo_night', envIntensity: 0.80, envRotation: 0.0,
        sun: { direction: [-0.35, -0.78, -0.50], color: [0.55, 0.62, 0.85], intensity: 0.45 },
        tonemap: { mode: 'aces', exposure: 1.35 },
        fog: { start: 14, end: 52, color: [0.07, 0.10, 0.18] },
        ambientFallback: [0.10, 0.12, 0.20],
        emissiveGain: 3.0, fireflies: 14,
        // A cool moonbeam raking down across the scene, casting a hard cone shadow.
        spot: {
            position: [6.5, 14.0, 5.0], direction: [-0.40, -0.86, -0.31],
            color: [0.62, 0.74, 1.00], intensity: 55,
            range: 34, innerAngle: 0.16, outerAngle: 0.38, castsShadow: true,
        },
    },
};

// Deterministic per-firefly drift, so the swarm animates without an RNG.
function fireflyPos(i, t, spread, height) {
    const a = i * 2.3998277;                   // golden-angle spacing
    const r = spread * (0.35 + 0.6 * ((i * 0.61803399) % 1));
    const sway = t * (0.18 + 0.05 * (i % 4));
    return [
        Math.cos(a + sway) * r,
        height + Math.sin(t * 0.9 + i * 1.7) * 0.5 + 0.4 * Math.sin(t * 0.5 + i),
        Math.sin(a + sway) * r,
    ];
}

/**
 * A time-of-day rig on `scene`: one shadowed sun reused across presets, plus
 * the optional fill, spot and fireflies each preset asks for. opts:
 *   presets = DAYLIGHT, order = Object.keys(presets)
 *   cascades = 2, splitLambda = 0.75, atlas = 2048, pcf = 1   sun shadows
 *   fireflies: { spread = 7, height = 1.8 }                   swarm at scale 1
 *   onChange(preset)                                          after each apply
 * Returns { apply(key), update(dt), setScale(s), current, preset, presets,
 *           order, usingHDR, emissiveGain, sun }.
 */
export function daylight(scene, opts) {
    const o = Object.assign({ presets: DAYLIGHT, cascades: 2, splitLambda: 0.75, atlas: 2048, pcf: 1 }, opts);
    const presets = o.presets;
    const order = o.order || Object.keys(presets);
    const swarm = Object.assign({ spread: 7, height: 1.8 }, o.fireflies);

    let current = null, haveHDR = false, scale = 1, elapsed = 0;
    let fireflies = [], spot = null, fill = null;

    const sun = scene.createLight({ type: 'directional', direction: [-0.3, -0.9, -0.3], castsShadow: true });
    sun.cascadeCount = o.cascades;
    sun.cascadeSplitLambda = o.splitLambda;
    scene.setShadowQuality(o.atlas, o.pcf);

    const clearFireflies = () => { for (const f of fireflies) f.destroy(); fireflies = []; };
    const spawnFireflies = (n) => {
        clearFireflies();
        for (let i = 0; i < n; i++) {
            const lamp = scene.createLight({
                type: 'point', position: fireflyPos(i, elapsed, swarm.spread * scale, swarm.height),
                color: [1.0, 0.85, 0.45], intensity: 3.2, range: 4.5 * Math.sqrt(scale),
            });
            // One firefly casts a real shadow (6 cube tiles); with the sun's
            // cascades and the spot's tile that fits the 16-tile atlas.
            lamp.castsShadow = (i === 0);
            fireflies.push(lamp);
        }
    };
    const applySpot = (cfg) => {
        if (!cfg) { if (spot) { spot.destroy(); spot = null; } return; }
        if (!spot) spot = scene.createLight({ type: 'spot', position: cfg.position });
        spot.x = cfg.position[0] * scale; spot.y = cfg.position[1] * scale; spot.z = cfg.position[2] * scale;
        spot.direction = cfg.direction;
        spot.color = cfg.color;
        spot.intensity = cfg.intensity * scale * scale;
        spot.range = cfg.range * scale;
        spot.innerAngle = cfg.innerAngle;
        spot.outerAngle = cfg.outerAngle;
        spot.castsShadow = !!cfg.castsShadow;
    };
    const applyFill = (cfg) => {
        if (!cfg) { if (fill) { fill.destroy(); fill = null; } return; }
        if (!fill) fill = scene.createLight({ type: 'directional', direction: cfg.direction });
        fill.direction = cfg.direction;
        fill.color = cfg.color;
        fill.intensity = cfg.intensity;
    };
    const applyFog = (p) => {
        if (p.fog) scene.setFog({ start: p.fog.start * scale, end: p.fog.end * scale, color: p.fog.color });
        else scene.setFog({});
    };

    const api = {
        presets, order, sun,
        get current() { return current; },
        get preset() { return current ? presets[current] : null; },
        get usingHDR() { return haveHDR; },
        get emissiveGain() { return current ? presets[current].emissiveGain : 1; },
        /** Switch to preset `key`; false for an unknown key. */
        apply(key) {
            const p = presets[key];
            if (!p) return false;
            current = key;
            haveHDR = skyEnvironment(scene, { hdri: p.hdri, intensity: p.envIntensity,
                rotation: p.envRotation, fallbackAmbient: p.ambientFallback });
            sun.direction = p.sun.direction;
            sun.color = p.sun.color;
            sun.intensity = p.sun.intensity;
            sun.castsShadow = p.shadow !== false;
            scene.setToneMap(p.tonemap);
            applyFog(p);
            applyFill(p.fill);
            if (p.fireflies > 0) spawnFireflies(p.fireflies); else clearFireflies();
            applySpot(p.spot);
            if (o.onChange) o.onChange(p);
            return true;
        },
        /** Stretch fog, the spot and the firefly swarm for a scene `s` times the ~16 m default. */
        setScale(s) {
            if (!(s > 0) || Math.abs(s - scale) < 1e-6) return;
            scale = s;
            if (current) { const p = presets[current]; applyFog(p); applySpot(p.spot); if (p.fireflies) spawnFireflies(p.fireflies); }
        },
        /** Drift and flicker the fireflies; call once a frame (runs while a sim is paused too). */
        update(dt) {
            if (fireflies.length === 0) return;
            elapsed += dt;
            for (let i = 0; i < fireflies.length; i++) {
                const p = fireflyPos(i, elapsed, swarm.spread * scale, swarm.height);
                const f = fireflies[i];
                f.x = p[0]; f.y = p[1]; f.z = p[2];
                f.intensity = 2.6 + 1.4 * (0.5 + 0.5 * Math.sin(elapsed * 3.0 + i * 2.1));
            }
        },
    };
    return api;
}
