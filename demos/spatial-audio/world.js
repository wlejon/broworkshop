// world.js — the three zones, the two extra levels, and the emitter markers,
// built as bro.scene meshes.
//
//   [Cave] ---bridge--- [Forest] ---bridge--- [Metal Hall]
//   x: -30..-12         x: -8..8               x: 12..30
//   plus a sky platform over the forest (y 8) and an underground pool (y -4)
//
// The geometry that should block sound (walls, ceilings, the sky platform) is
// collected in `occluders`; lab.js casts rays from the listener to each source
// with scene.raycast and counts how many of those it passes through.

export const ZONES = {
    cave:   { minX: -30, maxX: -12, color: '#3a3a3a', label: 'Stone Cave',      tint: '#8888aa' },
    forest: { minX:  -8, maxX:   8, color: '#2d5a27', label: 'Forest Clearing', tint: '#66cc66' },
    metal:  { minX:  12, maxX:  30, color: '#6a6a7a', label: 'Metal Hall',      tint: '#ccccee' },
};

/** Where each audible source sits (sound.js places its voices here). */
export const EMITTERS = {
    caveDrone: [-21, 2, 0],   forest1: [0, 3, 0],   forest2: [-2, 2, 4],
    metal1: [21, 3, 0],       metal2: [21, 3, 2],   drip: [-24, 3.5, -3],
    wind: [2, 2, 5],          hum: [22, 2, 0],      crystal: [0, 9, 0],
    pool: [0, -3, 0],
};

// Seeded so every run (and every test) builds the same forest.
function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function buildWorld(scene) {
    const rnd = lcg(0xA0D10);
    const occluders = new Set();
    const box = (name, x, y, z, w, h, d, color, extra) => scene.createMesh(Object.assign({
        mesh: 'box', name, halfW: w / 2, halfH: h / 2, halfD: d / 2, x, y, z, color, roughness: 0.9,
    }, extra));
    // A wall standing on `base`, blocking sound.
    const wall = (name, x, z, w, h, d, color, base) => {
        const n = box(name, x, (base || 0) + h / 2, z, w, h, d, color, { roughness: 1 });
        occluders.add(n);
        return n;
    };

    scene.setAmbient([0.12, 0.12, 0.2]);
    scene.setToneMap({ mode: 'aces', exposure: 1.1 });
    scene.setFog({ color: '#1a1a2e', start: 20, end: 60 });
    scene.setClearColor && scene.setClearColor('#1a1a2e');
    const sun = scene.createLight({ type: 'directional', name: 'sun', direction: [-0.4, -0.8, -0.4], color: '#ffeedd', intensity: 2.0 });
    sun.castsShadow = true;

    // Grounds and bridges.
    for (const key in ZONES) {
        const z = ZONES[key];
        scene.createMesh({ mesh: 'plane', name: key + 'Ground', halfW: (z.maxX - z.minX) / 2, halfD: 10,
                           x: (z.minX + z.maxX) / 2, y: 0, z: 0, color: z.color, roughness: 0.9 });
    }
    box('bridgeWest', -10, 0, 0, 4, 0.15, 3, '#8a7a6a', { roughness: 0.7 });
    box('bridgeEast', 10, 0, 0, 4, 0.15, 3, '#8a7a6a', { roughness: 0.7 });

    // Cave: four walls (the east one faces the bridge), a ceiling, stalactites.
    wall('caveBack', -21, -10, 18, 6, 0.5, '#2a2a2a');
    wall('caveFront', -21, 10, 18, 6, 0.5, '#2a2a2a');
    wall('caveWest', -30, 0, 0.5, 6, 20, '#2a2a2a');
    wall('caveEast', -12, 0, 0.5, 6, 20, '#333333');
    occluders.add(box('caveCeiling', -21, 6, 0, 18, 0.1, 20, '#222222', { roughness: 1 }));
    for (let i = 0; i < 12; i++) {
        const len = 0.5 + rnd() * 2;
        scene.createMesh({ mesh: 'cylinder', name: 'stalactite' + i, radius: 0.12, halfHeight: len / 2, segments: 5,
                           x: -28 + rnd() * 14, y: 6 - len / 2, z: -8 + rnd() * 16, color: '#4a4a4a' });
    }
    const caveTorch = scene.createLight({ type: 'point', name: 'caveTorch', position: [-22, 3, 0], color: '#ff8844', intensity: 3, range: 15 });

    // Forest: trunks and canopies, keeping the centre path clear.
    for (let i = 0; i < 20; i++) {
        const tx = -7 + rnd() * 14, tz = -9 + rnd() * 18, th = 3 + rnd() * 3;
        const r = 0.8 + rnd() * 0.6, g = Math.floor(rnd() * 0x10);
        if (Math.abs(tz) < 2) continue;
        scene.createMesh({ mesh: 'cylinder', name: 'trunk' + i, radius: 0.18, halfHeight: th / 2, segments: 6,
                           x: tx, y: th / 2, z: tz, color: '#5a3a1a' });
        scene.createMesh({ mesh: 'sphere', name: 'canopy' + i, radius: r, segments: 8, rings: 6,
                           x: tx, y: th + 0.5, z: tz, color: [0.16, 0.42 + g / 160, 0.1] });
    }
    scene.createLight({ type: 'point', name: 'forestSky', position: [0, 10, 0], color: '#88ccff', intensity: 1, range: 20 });

    // Metal hall: bright walls, polished pillars, a ceiling.
    wall('metalBack', 21, -10, 18, 8, 0.3, '#5a5a6a');
    wall('metalFront', 21, 10, 18, 8, 0.3, '#5a5a6a');
    wall('metalEast', 30, 0, 0.3, 8, 20, '#5a5a6a');
    occluders.add(box('metalCeiling', 21, 8, 0, 18, 0.1, 20, '#4a4a5a', { metallic: 0.6, roughness: 0.3 }));
    for (let i = 0; i < 6; i++) {
        for (const z of [-9, 9]) {
            scene.createMesh({ mesh: 'cylinder', name: 'pillar' + i + (z < 0 ? 'n' : 's'), radius: 0.3, halfHeight: 4,
                               segments: 8, x: 14 + i * 3, y: 4, z, color: '#8888aa', metallic: 0.8, roughness: 0.2 });
        }
    }
    scene.createLight({ type: 'point', name: 'metalLamp', position: [21, 7, 0], color: '#ccddff', intensity: 4, range: 25 });

    // Upper level: a sky platform on four columns over the forest.
    occluders.add(box('skyPlatform', 0, 8, 0, 8, 0.3, 8, '#6688aa', { metallic: 0.3, roughness: 0.5 }));
    for (const [cx, cz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
        scene.createMesh({ mesh: 'cylinder', name: 'skyColumn' + cx + cz, radius: 0.2, halfHeight: 4, segments: 6,
                           x: cx, y: 4, z: cz, color: '#556677' });
    }
    const skyLight = scene.createLight({ type: 'point', name: 'skyLight', position: [0, 9.5, 0], color: '#cc88ff', intensity: 3, range: 15 });

    // Lower level: an underground pool chamber below the forest.
    scene.createMesh({ mesh: 'plane', name: 'poolFloor', halfW: 7, halfD: 7, x: 0, y: -4, z: 0, color: '#1a2a3a', roughness: 0.3 });
    const water = box('water', 0, -2, 0, 10, 0.04, 10, '#2244aa', { roughness: 0.1, metallic: 0.3, emissive: 0.15 });
    wall('poolNorth', 0, -7, 14, 4, 0.3, '#1a1a2a', -4);
    wall('poolSouth', 0, 7, 14, 4, 0.3, '#1a1a2a', -4);
    wall('poolWest', -7, 0, 0.3, 4, 14, '#1a1a2a', -4);
    wall('poolEast', 7, 0, 0.3, 4, 14, '#1a1a2a', -4);
    scene.createLight({ type: 'point', name: 'poolLight', position: [0, -2.5, 0], color: '#2255cc', intensity: 3, range: 12 });

    // Glowing markers (with a small light each) where the point sources are.
    const marker = (name, pos, color) => {
        scene.createLight({ type: 'point', name: name + 'Glow', position: pos, color, intensity: 0.5, range: 5 });
        return scene.createMesh({ mesh: 'sphere', name, radius: 0.15, segments: 8, rings: 6,
                                  x: pos[0], y: pos[1], z: pos[2], color, emissive: 1.5, unlit: true });
    };
    const markers = [
        marker('dripMarker', EMITTERS.drip, '#4488ff'),
        marker('windMarker', EMITTERS.wind, '#88ffaa'),
        marker('humMarker', EMITTERS.hum, '#ffaa44'),
        marker('crystalMarker', EMITTERS.crystal, '#ee88ff'),
        marker('poolMarker', EMITTERS.pool, '#2266ff'),
    ];

    return { occluders, markers, caveTorch, skyLight, water };
}
