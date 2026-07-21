// sky.js — atmosphere: HDRI environment, sun + shadows, tonemap, distance fog.
//
// Naturalistic PBR: an image-based-lighting skybox provides ambient + specular,
// a single directional sun casts cascaded shadows, ACES tonemaps, and linear
// distance fog gives the island aerial depth. Climate-tinted fog and a
// day/season cycle come later (M2/M5); this is the fixed hero lighting.

const HDRI = '../lighting-demo/hdri/';

export function createSky(scene, opts) {
    opts = opts || {};

    scene.setToneMap({ mode: 'aces', exposure: opts.exposure != null ? opts.exposure : 0.82, gamma: 2.2 });

    const haveHDR = scene.setEnvironment({
        hdr:       HDRI + (opts.hdr || 'qwantani_puresky_2k.hdr'),
        intensity: opts.envIntensity != null ? opts.envIntensity : 1.0,
        rotation:  opts.envRotation  != null ? opts.envRotation  : 0.6,
    });
    if (!haveHDR) {
        // Robust degrade when the HDR is missing (mirrors flora-lab).
        scene.setEnvironment(null);
        scene.setAmbient(opts.ambientFallback || [0.42, 0.52, 0.62]);
    }

    const sun = scene.createLight({
        type:      'directional',
        direction: opts.sunDir || [-0.42, -1.0, -0.38],
        color:     opts.sunColor || [1.0, 0.95, 0.85],
        intensity: opts.sunIntensity != null ? opts.sunIntensity : 3.4,
    });
    sun.castsShadow = true;
    sun.cascadeCount = 4;
    sun.cascadeSplitLambda = 0.85;
    sun.shadowNormalBias = 0.06;
    scene.setShadowQuality(4096, 3);

    if (opts.fog !== false) {
        scene.setFog({
            start: opts.fogStart != null ? opts.fogStart : 5000,
            end:   opts.fogEnd   != null ? opts.fogEnd   : 34000,
            color: opts.fogColor || [0.64, 0.73, 0.83],
        });
    }

    return { sun, haveHDR };
}
