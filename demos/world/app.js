import "/lib/camera.js";
import { installSystemMenu } from "/lib/system-menu.js";

// =============================================================================
// World — a playable learned planet
// =============================================================================
//
// Terrain here is not noise. bro.worldgen runs three diffusion UNets to produce
// elevation in METRES at 30 m per cell, with drainage networks, coastlines and
// mountain ranges that FBm cannot produce because FBm has no notion of water
// flowing downhill. The world is a pure function of (seed, position), so there
// is nothing to save.
//
// THE SHAPE OF THE APP.  ONE height layer, everywhere:
//
//   layer 0   7.68 km  one coarse request, made once                 (983 km)
//
// The 30 m decoder field is DELIBERATELY GONE. It bought a crisp 30.7 km disc
// around the camera and left the other 470 km to a fallback — a resolution
// cliff you could see from the air, and a quality the rest of the world could
// not reach. The bar is that the world reads as vast and detailed from the
// coarse field ALONE, at every altitude, with no privileged spot. Decoder tiles
// come back later as a higher detail tier ON TOP of a surface that already
// works, not as the only place the surface works.
//
// The clipmap is ONE mesh, built once, parked on the camera and displaced on
// the GPU. No chunks, no LOD rings to crack and no horizon dome — the rings
// reach 500 km, so what is under your feet and what you see at the horizon are
// the same surface.
// =============================================================================

const WEIGHTS   = 'D:/projects/brodiffusion/weights/terrain-diffusion-30m-bro';
const SEA_LEVEL = 0;      // the model already puts sea level at 0 m
const COARSE_HALF = 64;   // coarse cells each way => 983 km at 7.68 km/cell

// The detail exemplar is still ONE decoder tile, and it is not a height layer:
// it is a 61 km sample of what ridges and drainage LOOK like, reused as the
// structure of every scale the coarse field cannot resolve. That is the whole
// mechanism by which mesh-level detail becomes global. Generated once at load;
// it wants to become a baked asset so the decoder leaves the runtime entirely.
const EXEMPLAR_CELLS = 2048;   // 61.4 km at 30 m
const METRES         = 30;     // metres per decoder cell (checkpoint native res)

const canvas = document.getElementById('c');
const scene  = canvas.getContext('scene');
const hud    = document.getElementById('hud');
const status = document.getElementById('status');

installSystemMenu();

// --- Sky, sun, terrain ---

scene.setToneMap({ mode: 'aces', exposure: 0.9, gamma: 2.2 });

const SUN_DIR = [-0.4, -0.85, -0.35];

const sun = scene.createLight({
    type: 'directional',
    direction: SUN_DIR,
    color: [1.0, 0.95, 0.86],
    intensity: 3.2,
});
sun.castsShadow = true;
sun.cascadeCount = 4;
sun.cascadeSplitLambda = 0.85;
scene.setShadowQuality(4096, 3);

// Analytic single-scattering sky + aerial perspective. sunDirection points
// TOWARDS the sun, so it is the negation of the light's travel direction. No
// setFog: aerial perspective is the air, and running both double-counts it.
scene.setAtmosphere({
    enabled: true,
    sunDirection: [-SUN_DIR[0], -SUN_DIR[1], -SUN_DIR[2]],
    seaLevel: SEA_LEVEL,
});

// 11 levels of 128 quads at 8 m reach 64 * 8 * 2^10 = 524 km, containing the
// coarse field's 491 km half-extent, so geometry exists everywhere there is
// data. Heights arrive in metres, so heightScale stays 1; detail synthesises the
// decades below the 30 m data floor.
const terrain = scene.createClipmapTerrain({
    levels: 11,
    resolution: 128,
    cellSize: 8,
    heightScale: 1,
    seaLevel: SEA_LEVEL,
    detailWavelength: 48,
    detailRelief: 0.35,
    detailOctaves: 7,
    snowLine: 1700,
});

// --- The detail exemplar — one decoder tile, used as structure, not as data ---

let world = null;
let exemplarReady = false;

// Decoder cell (i, j) -> world (z, x). i is north-south, j is west-east.
const cellI = (wz) => wz / METRES;
const cellJ = (wx) => wx / METRES;

function requestExemplar(camX, camZ) {
    const i0 = Math.round(cellI(camZ)) - EXEMPLAR_CELLS / 2;
    const j0 = Math.round(cellJ(camX)) - EXEMPLAR_CELLS / 2;
    world.elevation(i0, j0, i0 + EXEMPLAR_CELLS, j0 + EXEMPLAR_CELLS, {
        onDone: (r) => {
            terrain.setDetailExemplar({
                data: r.data, width: r.width, height: r.height,
                metresPerCell: METRES,
            });
            exemplarReady = true;
        },
        onError: (e) => { console.log('exemplar: ' + e); exemplarReady = true; },
    });
}

// --- Layer 0 — the coarse field, one request, once ---
//
// 128 coarse cells at 7.68 km is 983 km across: the whole visible world from any
// altitude a player reaches, in a single 64 KB texture. The 2.8M-param coarse
// UNet alone, so it is a blocking call cheap enough for the load screen.

let coarse = null, coarseOrigin = 0;

function loadCoarse() {
    coarse = world.coarse(-COARSE_HALF, -COARSE_HALF, COARSE_HALF, COARSE_HALF);
    coarseOrigin = -COARSE_HALF * coarse.cellSize;
    terrain.setHeightLayer(0, {
        data: coarse.data, width: coarse.width, height: coarse.height,
        originX: coarseOrigin, originZ: coarseOrigin, metresPerCell: coarse.cellSize,
    });
    console.log('coarse field: ' + coarse.width + 'x' + coarse.height + ' at ' +
                coarse.cellSize + ' m => ' +
                (coarse.width * coarse.cellSize / 1000).toFixed(0) + ' km');
}

function coarseAt(wx, wz) {
    if (!coarse) return SEA_LEVEL;
    const fx = (wx - coarseOrigin) / coarse.cellSize;
    const fz = (wz - coarseOrigin) / coarse.cellSize;
    const x0 = Math.max(0, Math.min(coarse.width  - 2, Math.floor(fx)));
    const z0 = Math.max(0, Math.min(coarse.height - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - x0)), tz = Math.max(0, Math.min(1, fz - z0));
    const d = coarse.data, w = coarse.width;
    return (d[z0 * w + x0] * (1 - tx) + d[z0 * w + x0 + 1] * tx) * (1 - tz) +
           (d[(z0 + 1) * w + x0] * (1 - tx) + d[(z0 + 1) * w + x0 + 1] * tx) * tz;
}

// The clipmap is the drawn surface AND the collision surface — it carries the
// procedural detail the layer does not. Valid as soon as the coarse field is in.
function elevationAt(wx, wz) {
    return coarse ? terrain.elevationAt(wx, wz) : null;
}

// Spawn somewhere worth looking at. The origin is not neutral — for seed 42 it is
// 941 m under water — and where it lands is a property of the seed, so a
// hardcoded position would only move the problem. The coarse field answers
// "where is high ground near the middle" directly; preferring height NEAR A
// COAST puts sea, shoreline and a range in one frame.
function chooseSpawn() {
    const c = coarse, w = c.width;
    let best = -Infinity, bx = 0, bz = 0, bh = 0;
    for (let i = 1; i < c.height - 1; i++) {
        for (let j = 1; j < w - 1; j++) {
            const h = c.data[i * w + j];
            if (h < 200) continue;                       // want to stand on land
            const d = Math.hypot(i - c.height / 2, j - w / 2);
            if (d > COARSE_HALF * 0.5) continue;         // room to fly any way
            let lo = Infinity;                           // ocean nearby?
            for (let di = -1; di <= 1; di++)
                for (let dj = -1; dj <= 1; dj++)
                    lo = Math.min(lo, c.data[(i + di) * w + (j + dj)]);
            const score = h + (lo < 0 ? 1200 : 0) - d * 40;
            if (score > best) {
                best = score; bh = h;
                bx = coarseOrigin + j * c.cellSize;
                bz = coarseOrigin + i * c.cellSize;
            }
        }
    }
    if (best === -Infinity) return;                      // all ocean; origin will do
    // Start in the air, not on the ground. From 25 km the whole world is in
    // frame at once — coastline, range and horizon — which is the view that
    // says what this is; walking up to it afterwards is the reveal, not the
    // introduction. (Well above the coarse height regardless: it is a 7.68 km
    // average and the real 30 m terrain under it can be considerably higher.)
    cam.pos = [bx, bh + 25000, bz];
    cam.vel = [0, 0, 0];
    console.log('spawn: ' + (bx / 1000).toFixed(0) + ', ' + (bz / 1000).toFixed(0) + ' km');
}

// --- Load ---

status.textContent = 'Loading terrain model...';
if (!bro.worldgen || !bro.worldgen.available) {
    status.textContent = 'bro.worldgen unavailable — build with BRO_WITH_DIFFUSION.';
} else {
    bro.worldgen.init();
    bro.worldgen.loadWorld(WEIGHTS, {
        seed: 42,
        onReady: (w) => {
            world = w;
            loadCoarse();
            chooseSpawn();
            status.textContent = 'Sampling detail structure...';
            requestExemplar(cam.pos[0], cam.pos[2]);
        },
        onError: (e) => { status.textContent = 'Model load failed: ' + e; },
    });
}

// --- Camera — fly and walk ---

let mode = 'fly';           // 'fly' | 'walk'
const EYE = 1.7;            // metres, walking
const WALK_SPEED = 6;       // m/s (a jog)

// Flying speed is ALTITUDE-PROPORTIONAL. A fixed rate cannot serve a world that
// is 983 km across and also has metre-scale relief: 220 m/s is reckless at
// treetop height and a 75-minute crossing from orbit. Tying it to height above
// ground keeps the screen-space flow rate roughly constant, which is the thing
// that actually feels controllable — you cover ground when there is ground to
// cover and slow down as you close on it.
const FLY_BASE   = 60;      // m/s at zero altitude
const FLY_PER_M  = 0.55;    // + this much per metre above ground
const FLY_MAX    = 90000;   // m/s ceiling: 983 km in ~11 s
const BOOST      = 6;       // shift
let   speedTrim  = 1;       // mouse wheel, 1/16x .. 16x

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    speedTrim = Math.min(16, Math.max(1 / 16,
                speedTrim * (e.deltaY < 0 ? 1.25 : 0.8)));
});

const cam = Camera.createFly({
    pos: [0, 1200, 0],
    rot: Camera.quatNorm(Camera.quatMul(
        Camera.quatFromAxis(0, 1, 0, -Math.PI / 4),
        Camera.quatFromAxis(1, 0, 0, -0.55))),
    accel: 14.0, damping: 7.0, rollSpeed: 2.0, lookSpeed: 0.003,
});

const keys = {};
let mouseX = 0, mouseY = 0, looking = false;

document.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === 'f') toggleMode();
});
document.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

canvas.addEventListener('mousedown', () => { looking = true; canvas.requestPointerLock(); });
document.addEventListener('mouseup', () => { looking = false; document.exitPointerLock(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('mousemove', (e) => {
    if (looking) { mouseX += e.movementX; mouseY += e.movementY; }
});

function toggleMode() {
    mode = (mode === 'fly') ? 'walk' : 'fly';
    if (mode === 'walk') {
        // Never below sea level — walking the seabed is a worse failure than
        // hovering.
        const g = elevationAt(cam.pos[0], cam.pos[2]);
        cam.pos[1] = Math.max(SEA_LEVEL, g === null ? cam.pos[1] : g) + EYE;
        cam.vel = [0, 0, 0];
    }
}

// --- Frame ---

let last = performance.now(), frames = 0, acc = 0, fps = 0;

function frame() {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    frames++; acc += dt;
    if (acc >= 0.5) { fps = Math.round(frames / acc); frames = 0; acc = 0; }

    if (mouseX || mouseY) { Camera.flyLook(cam, mouseX, mouseY); mouseX = mouseY = 0; }

    const gNow = elevationAt(cam.pos[0], cam.pos[2]);
    const aglNow = Math.max(0, cam.pos[1] - (gNow === null ? SEA_LEVEL : gNow));
    let speed = (mode === 'fly')
        ? Math.min(FLY_MAX, FLY_BASE + aglNow * FLY_PER_M) * speedTrim
        : WALK_SPEED;
    if (keys['shift']) speed *= BOOST;
    Camera.flyIntegrate(cam, Camera.flyThrustFromKeys(cam, keys), dt, speed);

    if (mode === 'walk') {
        // No physics body: the ground is a direct lookup into the same surface
        // the GPU draws, so a character controller would add nothing but a
        // collision shape to keep in sync.
        const g = elevationAt(cam.pos[0], cam.pos[2]);
        if (g !== null) { cam.pos[1] = Math.max(SEA_LEVEL, g) + EYE; cam.vel[1] = 0; }
    }

    terrain.update(cam.pos[0], cam.pos[1], cam.pos[2]);

    const g = elevationAt(cam.pos[0], cam.pos[2]);
    const agl = Math.max(1, cam.pos[1] - (g === null ? SEA_LEVEL : g));
    // Depth is reversed-Z, so a 500 km far plane costs nothing. Near still
    // scales with altitude: at 4 km up nothing is within 200 m anyway.
    cam.far  = terrain.farDistance * 1.05;
    cam.near = Math.max(0.5, Math.min(agl * 0.05, 400));
    cam.fov  = 70;
    scene.setCamera(Camera.flyViewOptsQuat(cam, canvas));

    hud.textContent =
        mode.toUpperCase() +
        '  |  ' + (cam.pos[0] / 1000).toFixed(2) + ', ' + (cam.pos[2] / 1000).toFixed(2) + ' km' +
        '  |  alt ' + Math.round(cam.pos[1]) + ' m' +
        (g === null ? '' : '  |  ground ' + Math.round(g) + ' m') +
        '  |  ' + fps + ' fps' +
        (mode === 'fly'
            ? '  |  ' + (speed / 1000 * 3600).toFixed(0) + ' km/h' +
              (speedTrim !== 1 ? ' (trim ' + speedTrim.toFixed(2) + 'x)' : '')
            : '') +
        '  |  ' + terrain.layerCount + ' layer, ' +
        (terrain.triangleCount / 1000).toFixed(0) + 'k tris';

    if (exemplarReady && status.textContent) status.textContent = '';
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

export { cam, terrain, elevationAt, toggleMode, sun, scene };
export const ready = () => exemplarReady;
