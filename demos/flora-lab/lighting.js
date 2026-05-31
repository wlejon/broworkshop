// lighting.js — a time-of-day lighting rig for flora-lab.
//
// Drives the full scene-lighting feature set against one meadow:
//   • IBL + skybox     — an HDR sky per preset (setEnvironment) gives the
//                        foliage orientation-dependent ambient (cool skylight
//                        from above, warm bounce below) plus a visible horizon.
//   • directional sun  — a CSM-shadowed key light tuned per preset, its angle
//                        roughly aligned to the bright spot in the HDR so cast
//                        shadows agree with the sky.
//   • point lights     — warm drifting "fireflies" that switch on at night,
//                        each casting into the shared shadow atlas.
//   • emissive         — the blooms' golden eyes self-illuminate; the rig hands
//                        the app a per-preset emissive gain so they glow in the
//                        dark and stay subtle by day.
//   • tonemap+exposure — ACES with a per-preset exposure stop.
//   • fog              — distance fog tinted to the sky so the patch fades into
//                        the horizon instead of hovering in a void.
//
// HDRs are the CC0 set committed under demos/lighting-demo/hdri (shared, not
// duplicated). If they're missing the rig degrades to a tuned flat ambient so
// the app still runs.

(function (root) {

    const HDRI = '../lighting-demo/hdri/';

    // Each preset is a complete lighting state. `sun.direction` points FROM the
    // sun TO the scene; `envRotation` spins the sky so its bright spot sits
    // behind that direction. `emissiveGain` is a multiplier the app applies to
    // the blooms' golden centers. `fireflies` > 0 spawns that many point lights.
    const PRESETS = {
        dawn: {
            label: 'Dawn',
            hdr: 'spruit_sunrise_2k.hdr',
            envIntensity: 0.45, envRotation: 2.00,
            sun: { direction: [-0.62, -0.46, -0.34], color: [1.00, 0.78, 0.55], intensity: 3.6 },
            shadow: true,
            tonemap: { mode: 'aces', exposure: 1.00 },
            fog: { start: 15, end: 60, color: [0.82, 0.74, 0.66] },
            ambientFallback: [0.26, 0.26, 0.30],
            emissiveGain: 0.8,
            fireflies: 0,
        },
        noon: {
            label: 'Noon',
            hdr: 'kloofendal_43d_clear_puresky_2k.hdr',
            envIntensity: 0.20, envRotation: 2.30,
            sun: { direction: [-0.32, -0.90, -0.28], color: [1.00, 0.97, 0.92], intensity: 5.0 },
            shadow: true,
            tonemap: { mode: 'aces', exposure: 0.95 },
            fog: { start: 26, end: 80, color: [0.66, 0.74, 0.82] },
            ambientFallback: [0.30, 0.34, 0.32],
            emissiveGain: 0.5,
            fireflies: 0,
        },
        golden: {
            label: 'Golden hour',
            hdr: 'the_sky_is_on_fire_2k.hdr',
            envIntensity: 0.30, envRotation: 4.00,
            sun: { direction: [-0.74, -0.34, -0.20], color: [1.00, 0.62, 0.32], intensity: 4.8 },
            shadow: true,
            tonemap: { mode: 'aces', exposure: 0.95 },
            fog: { start: 18, end: 70, color: [0.86, 0.55, 0.40] },
            ambientFallback: [0.28, 0.24, 0.22],
            emissiveGain: 0.9,
            fireflies: 0,
        },
        night: {
            label: 'Night',
            hdr: 'dikhololo_night_2k.hdr',
            envIntensity: 0.80, envRotation: 0.0,
            sun: { direction: [-0.35, -0.78, -0.50], color: [0.55, 0.62, 0.85], intensity: 0.45 },
            shadow: true,
            tonemap: { mode: 'aces', exposure: 1.35 },
            fog: { start: 14, end: 52, color: [0.07, 0.10, 0.18] },
            ambientFallback: [0.10, 0.12, 0.20],
            emissiveGain: 3.0,
            fireflies: 14,
            // A cool moonbeam raking down across the patch — the rig's spot
            // light, casting a hard-edged cone shadow into the atlas.
            spot: {
                position: [6.5, 14.0, 5.0],
                direction: [-0.40, -0.86, -0.31],
                color: [0.62, 0.74, 1.00], intensity: 55,
                range: 34, innerAngle: 0.16, outerAngle: 0.38,
                castsShadow: true,
            },
        },
    };

    const ORDER = ['dawn', 'noon', 'golden', 'night'];

    // Deterministic per-firefly drift so the swarm animates without a global RNG.
    function fireflyPos(i, t, spread, height) {
        const a = i * 2.3998277;             // golden-angle spacing
        const r = spread * (0.35 + 0.6 * ((i * 0.61803399) % 1));
        const bob = Math.sin(t * 0.9 + i * 1.7) * 0.5;
        const sway = t * (0.18 + 0.05 * (i % 4));
        return [
            Math.cos(a + sway) * r,
            height + bob + 0.4 * Math.sin(t * 0.5 + i),
            Math.sin(a + sway) * r,
        ];
    }

    // Build a controller bound to a scene context. `onEmissiveGain(g)` lets the
    // app retint the blooms when the time of day changes.
    function createLighting(scene, opts) {
        opts = opts || {};
        const onEmissiveGain = opts.onEmissiveGain || function () {};
        const fireflySpread = opts.fireflySpread || 7.0;
        const fireflyHeight = opts.fireflyHeight || 1.8;

        let current = null;        // preset key
        let haveHDR = false;       // did the last setEnvironment succeed?
        let sun = null;            // the directional LightNode
        let fireflies = [];        // active point LightNodes
        let spot = null;           // optional spot LightNode (e.g. moonbeam)
        let elapsed = 0;           // seconds, for firefly drift

        // One shadowed key light, reused across presets.
        sun = scene.createLight({
            type: 'directional',
            direction: PRESETS.noon.sun.direction,
            color: PRESETS.noon.sun.color,
            intensity: PRESETS.noon.sun.intensity,
            castsShadow: true,
        });
        sun.cascadeCount = 4;             // tight CSM across the patch
        sun.cascadeSplitLambda = 0.75;    // log-weighted splits for outdoor depth
        scene.setShadowQuality(4096, 3);  // crisp atlas + 3×3 PCF

        function clearFireflies() {
            for (const f of fireflies) { if (f && f.destroy) f.destroy(); }
            fireflies = [];
        }

        function spawnFireflies(n) {
            clearFireflies();
            for (let i = 0; i < n; i++) {
                const p = fireflyPos(i, 0, fireflySpread, fireflyHeight);
                const lamp = scene.createLight({
                    type: 'point',
                    position: p,
                    color: [1.0, 0.85, 0.45],   // warm amber
                    intensity: 3.2,
                    range: 4.5,
                });
                // One firefly casts a real shadow (6 cube tiles); the sun's 4
                // cascades + the moonbeam spot's 1 tile leave room for exactly
                // that within the 16-tile atlas budget.
                lamp.castsShadow = (i === 0);
                fireflies.push(lamp);
            }
        }

        function applySpot(cfg) {
            if (!cfg) {
                if (spot) { spot.destroy(); spot = null; }
                return;
            }
            if (!spot) {
                spot = scene.createLight({ type: 'spot', position: cfg.position });
            }
            spot.x = cfg.position[0];
            spot.y = cfg.position[1];
            spot.z = cfg.position[2];
            spot.direction = cfg.direction;
            spot.color = cfg.color;
            spot.intensity = cfg.intensity;
            spot.range = cfg.range;
            spot.innerAngle = cfg.innerAngle;
            spot.outerAngle = cfg.outerAngle;
            spot.castsShadow = !!cfg.castsShadow;
        }

        function apply(key) {
            const p = PRESETS[key];
            if (!p) return false;
            current = key;

            haveHDR = scene.setEnvironment({
                hdr: HDRI + p.hdr,
                intensity: p.envIntensity,
                rotation: p.envRotation,
            });
            if (!haveHDR) {
                scene.setEnvironment(null);
                scene.setAmbient(p.ambientFallback);
            }

            sun.direction = p.sun.direction;
            sun.color = p.sun.color;
            sun.intensity = p.sun.intensity;
            sun.castsShadow = p.shadow;

            scene.setToneMap(p.tonemap);
            if (p.fog) scene.setFog(p.fog);

            if (p.fireflies > 0) spawnFireflies(p.fireflies);
            else clearFireflies();
            applySpot(p.spot);

            onEmissiveGain(p.emissiveGain);
            return true;
        }

        // Animate the firefly swarm; call once per frame with dt seconds.
        function update(dt) {
            if (fireflies.length === 0) return;
            elapsed += dt;
            for (let i = 0; i < fireflies.length; i++) {
                const p = fireflyPos(i, elapsed, fireflySpread, fireflyHeight);
                const f = fireflies[i];
                f.x = p[0]; f.y = p[1]; f.z = p[2];
                // Gentle brightness flicker.
                f.intensity = 2.6 + 1.4 * (0.5 + 0.5 * Math.sin(elapsed * 3.0 + i * 2.1));
            }
        }

        return {
            presets: PRESETS,
            order: ORDER,
            apply,
            update,
            get current() { return current; },
            get usingHDR() { return haveHDR; },
            get emissiveGain() { return current ? PRESETS[current].emissiveGain : 1.0; },
        };
    }

    root.createLighting = createLighting;

})(globalThis);
