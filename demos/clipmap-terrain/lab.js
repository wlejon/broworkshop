// Clipmap Terrain — scene.createClipmapTerrain: concentric rings of fixed
// topology parked on the camera and displaced on the GPU from a height
// pyramid, so the ground runs continuously from underfoot to the horizon.
//
// This module builds the world (sky, sun, one 8 km height layer), the fly
// camera (click to capture the mouse; it never dips below 15 m above ground)
// and the live surface settings. main.js wires the panel; tests import this.

import { flyCamera } from "/lib/kit/flycam.js";
import { skyEnvironment } from "/lib/kit/sky.js";
import { ridgeHeights } from "/app/heightmap.js";

export const canvas = document.getElementById('stage');
export const scene = canvas.getContext('scene');

scene.setToneMap({ mode: 'aces', exposure: 0.9, gamma: 2.2 });
skyEnvironment(scene, { hdri: 'kloofendal_43d_clear_puresky', intensity: 1.0 });

export const sun = scene.createLight({ type: 'directional', color: [1.0, 0.97, 0.92], intensity: 3.2, castsShadow: true });
sun.cascadeCount = 4;
sun.shadowNormalBias = 0.05;

// --- the clipmap ------------------------------------------------------------------

const FOREST_ALBEDO = [0.12, 0.26, 0.10];

/**
 * The live surface settings; edit, then applySurface(). detailRelief is a
 * SLOPE, not metres: each detail octave's amplitude is relief x its own
 * wavelength x the ground's slope (engine default 0.35). detailWavelength is
 * the coarsest synthesised octave in metres, near the layer's 8 m cell.
 */
export const surface = { snowLine: 1800,detailRelief: 0.35, detailWavelength: 24, forestStrength: 0.7 };

export const clipmap = scene.createClipmapTerrain({
    levels: 6,
    resolution: 128,
    cellSize: 2.0,
    heightScale: 1.0,
    seaLevel: 0.0,
    snowLine: surface.snowLine,
    planetRadius: 0.0,                       // flat world
    detailRelief: surface.detailRelief,
    detailWavelength: surface.detailWavelength,
    detailGain: 0.5,
    detailOctaves: 3,
    materials: {
        rock:  { albedo: [0.38, 0.36, 0.35], roughness: 0.85 },
        snow:  { albedo: [0.92, 0.95, 0.98], roughness: 0.35 },
        sand:  { albedo: [0.76, 0.70, 0.50], roughness: 0.90 },
        grass: { albedo: [0.22, 0.42, 0.18], roughness: 0.80 },
    },
    forest: { albedo: FOREST_ALBEDO, strength: surface.forestStrength },
});

/** The height layer: 1024² cells at 8 m, centred on the origin (texel 0 at -4096 m). */
export const LAYER = { width: 1024, height: 1024, metresPerCell: 8, originX: -4096, originZ: -4096, seed: 42 };
clipmap.setHeightLayer(0, {
    data: ridgeHeights(LAYER),
    width: LAYER.width, height: LAYER.height,
    originX: LAYER.originX, originZ: LAYER.originZ,
    metresPerCell: LAYER.metresPerCell,
    wrapX: false, bandLimited: false,
});

export function applySurface() {
    clipmap.setSnowLine(surface.snowLine);
    clipmap.setDetail({ relief: surface.detailRelief, wavelength: surface.detailWavelength, gain: 0.5, octaves: 3 });
    clipmap.setForest({ albedo: FOREST_ALBEDO, strength: surface.forestStrength });
}

// --- the camera -------------------------------------------------------------------

/**
 * Named viewpoints (yaw 0 looks down -Z), placed on this seed's field: the
 * summit is near (-1000, 500) at ~3.2 km, a valley floor near (-1100, 1780).
 */
export const VIEWS = {
    home:   { label: 'Start',         pos: [0, 2600, 3200],     yaw: 0,     pitch: -0.30 },
    peak:   { label: 'Mountain Peak', pos: [-1000, 3240, 560],  yaw: 0.8,   pitch: -0.15 },
    valley: { label: 'Low Valley',    pos: [-1100, 140, 1780],  yaw: 0,     pitch: 0.12 },
    orbit:  { label: 'High Orbit',    pos: [0, 3500, 4500],     yaw: 0,     pitch: -0.65 },
    ridge:  { label: 'Snow Ridge',    pos: [600, 2400, 100],    yaw: 0.66,  pitch: -0.20 },
};

export const fly = flyCamera(canvas, {
    ...VIEWS.home, look: 'lock', worldUp: true, speed: 250, boost: 3, lookSpeed: 0.0022,
    ground: (x, z) => clipmap.elevationAt(x, z), clearance: 15,
    fov: 65, near: 1, far: 50000,
});

export function setView(name) {
    fly.pose(VIEWS[name]);
    step(0);
}

// --- frame ------------------------------------------------------------------------

const hooks = [];
/** fn(dt) after each frame's camera + clipmap update. */
export function onFrame(fn) { hooks.push(fn); }

function step(dt) {
    const view = fly.update(dt);
    clipmap.update(fly.cam.pos[0], fly.cam.pos[1], fly.cam.pos[2]);
    scene.setCamera(view);
    return view;
}

let last = performance.now();
function frame() {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    step(dt);
    for (const fn of hooks) fn(dt);
    requestAnimationFrame(frame);
}
step(0);
requestAnimationFrame(frame);
