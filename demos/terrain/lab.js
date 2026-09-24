// Terrain — an endless chunked height-field world from scene.createTerrain.
//
// All the heavy lifting (noise, height columns, meshing, the chunk lifecycle)
// runs in C++; this module configures it, streams chunks around a free-fly
// camera, and sculpts: a left click raycasts from the view centre and raises
// or lowers the column it hits. Parameter changes are debounced into one
// terrain.configure(). main.js wires the panel; tests import this module.

import { flyCamera } from "/lib/kit/flycam.js";
import { skyEnvironment } from "/lib/kit/sky.js";
import { defaultConfig, terrainOptions } from "/app/config.js";

export const canvas = document.getElementById('stage');
export const scene = canvas.getContext('scene');

scene.setToneMap({ mode: 'aces', exposure: 0.85, gamma: 2.2 });
skyEnvironment(scene, { hdri: 'kloofendal_43d_clear_puresky', intensity: 1.0 });

export const sun = scene.createLight({ type: 'directional', color: [1.0, 0.96, 0.88], intensity: 3.5, castsShadow: true });
sun.cascadeCount = 4;
sun.cascadeSplitLambda = 0.85;
sun.shadowNormalBias = 0.05;
scene.setShadowQuality(4096, 3);

/** The live parameters (config.js shape); edit, then reconfigure(). */
export const config = defaultConfig();
export const terrain = scene.createTerrain(terrainOptions(config));

// --- the camera -----------------------------------------------------------------

export const HOME = { pos: [50, 42, 50], yaw: -Math.PI / 4, pitch: -0.30 };
export const fly = flyCamera(canvas, {
    ...HOME, speed: 18, lookSpeed: 0.003, roll: true, fov: 65, near: 0.5, far: 500,
});

// --- sculpting ------------------------------------------------------------------

export const sculpt = { mode: 'raise', edits: 0 };

/** Raycast from the view centre and raise / lower the column it hits. Returns the hit or null. */
export function sculptAtCenter(mode = sculpt.mode) {
    const hit = terrain.raycast(fly.cam.pos, fly.forward(), 200);
    if (!hit) return null;
    const p = hit.position;
    terrain.setVoxel(p[0], p[1], p[2], mode === 'lower' ? 0 : 1);
    terrain.rebuild();
    sculpt.edits++;
    return hit;
}

export function toggleSculptMode() {
    sculpt.mode = sculpt.mode === 'raise' ? 'lower' : 'raise';
    return sculpt.mode;
}

// --- reconfigure ----------------------------------------------------------------

// Slider drags coalesce: configure() runs once, DEBOUNCE_MS after the last change.
const DEBOUNCE_MS = 200;
let timer = null;
export const regen = { pending: false, count: 0, onStart: null };

export function reconfigure() {
    regen.pending = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(applyConfig, DEBOUNCE_MS);
}

export function applyConfig() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    regen.pending = false;
    regen.count++;
    if (regen.onStart) regen.onStart();
    terrain.configure(terrainOptions(config));
}

// --- frame ----------------------------------------------------------------------

let last = performance.now();
const hooks = [];
/** fn(dt) after each frame's camera + chunk update. */
export function onFrame(fn) { hooks.push(fn); }

function frame() {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const view = fly.update(dt);
    terrain.update(fly.cam.pos[0], fly.cam.pos[1], fly.cam.pos[2]);
    scene.setCamera(view);
    for (const fn of hooks) fn(dt);
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
