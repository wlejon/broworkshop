// isle — a model-driven, procedurally-synthesized island.
//
// Boot: init worldgen → load world (seed = island identity) → bake the control
// atlas (elevation, seconds) → stand up clipmap terrain + HDRI sky + sea →
// run a freefly camera (scroll = move speed). The island's shape is the
// diffusion model's; the fine relief and materials are the engine's procedural
// clipmap shaders. See PLAN.md for the full arc.

import { DEFAULT_ISLAND, bakeAtlasAsync } from '/app/lib/atlas.js';
import { createTerrain } from '/app/lib/terrain.js';
import { createSky } from '/app/lib/sky.js';

const WEIGHTS = 'D:/projects/brodiffusion/weights/terrain-diffusion-30m-bro';
const Camera = window.Camera;

const canvas = document.getElementById('c');
const scene  = canvas.getContext('scene');
const hud    = document.getElementById('hud');
const boot   = document.getElementById('boot');

// ---- state / test seam ----------------------------------------------------
let atlas = null, terrain = null, world = null;
let _ready = false, _bakeMs = 0, _loadMs = 0;
export function ready() { return _ready; }

// ---- fixed scene: sky + sea (built immediately, before the model lands) ----
const sky = createSky(scene, {});

// Minimal flat sea for M1 (a shaded/animated water surface arrives in M2).
// A huge plane at y = 0; the island's sub-sea terrain is hidden beneath it.
const sea = scene.createMesh({
    mesh: 'plane',
    color: [0.03, 0.16, 0.25],
    metallic: 0.0, roughness: 0.5,
    scale: [40000, 1, 40000],           // half-extent ~200 km
    y: 0,
});
sea.castsShadow = false;

// ---- freefly camera --------------------------------------------------------
// High and to the south, looking down at the island centred on the origin.
const cam = Camera.createFly({
    pos:   [0, 4200, 9000],
    rot:   Camera.quatFromAxis(1, 0, 0, -0.42),   // pitch down ~24°
    fov:   58, near: 3, far: 220000,
    accel: 14, damping: 6, rollSpeed: 2.2, lookSpeed: 0.0022,
});
let moveSpeed = 900;                     // m/s; scroll wheel scales it
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// ---- input -----------------------------------------------------------------
const keys = {};
addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
addEventListener('keyup',   (e) => { keys[e.key.toLowerCase()] = false; });
canvas.addEventListener('click', () => { if (canvas.requestPointerLock) canvas.requestPointerLock(); });
addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) Camera.flyLook(cam, e.movementX, e.movementY);
});
addEventListener('wheel', (e) => {
    moveSpeed = clamp(moveSpeed * (e.deltaY < 0 ? 1.12 : 0.89), 4, 30000);
}, { passive: true });

// ---- load the model, then bake the island ---------------------------------
boot.textContent = 'loading terrain model…';
const tLoad = performance.now();
bro.worldgen.init();
bro.worldgen.loadWorld(WEIGHTS, {
    seed: DEFAULT_ISLAND.seed,
    onReady: (w) => {
        world = w; _loadMs = performance.now() - tLoad;
        boot.textContent = 'baking island…';
        const tBake = performance.now();
        bakeAtlasAsync(w, DEFAULT_ISLAND, (err, a) => {
            if (err) { boot.textContent = 'bake failed: ' + err; return; }
            atlas = a; _bakeMs = performance.now() - tBake;
            terrain = createTerrain(scene, atlas, DEFAULT_ISLAND);
            boot.classList.add('hidden');
            _ready = true;
        });
    },
    onError: (m) => { boot.textContent = 'model load failed: ' + m; },
});

// ---- frame loop ------------------------------------------------------------
let last = performance.now();
function frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const thrust = Camera.flyThrustFromKeys(cam, keys);
    Camera.flyIntegrate(cam, thrust, dt, moveSpeed);
    if (keys['q']) Camera.flyRoll(cam, dt, +1);
    if (keys['e']) Camera.flyRoll(cam, dt, -1);

    if (terrain) terrain.update(cam.pos[0], cam.pos[1], cam.pos[2]);
    scene.setCamera(Camera.flyViewOptsQuat(cam, canvas));

    if (hud && _ready) {
        hud.textContent =
            `isle · seed ${DEFAULT_ISLAND.seed}\n` +
            `elev ${atlas.min.toFixed(0)}..${atlas.max.toFixed(0)} m  (${(DEFAULT_ISLAND.N * DEFAULT_ISLAND.cellSize / 1000).toFixed(1)} km)\n` +
            `load ${(_loadMs / 1000).toFixed(1)}s  bake ${(_bakeMs / 1000).toFixed(1)}s\n` +
            `alt ${cam.pos[1].toFixed(0)} m  speed ${moveSpeed.toFixed(0)} m/s\n` +
            `WASD+Space/Ctrl fly · scroll speed · click mouselook`;
    }
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// expose bake timing for the headless smoke
export function stats() { return { loadMs: _loadMs, bakeMs: _bakeMs, atlas: atlas && { min: atlas.min, max: atlas.max, w: atlas.width, h: atlas.height } }; }
