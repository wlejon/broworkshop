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
// THE SHAPE OF THE APP.  The model gives two scales — a 30 m decoder field that
// costs seconds per tile, and a 7.68 km coarse field that costs a fraction of
// one and covers a thousand kilometres. That is a two-level height pyramid,
// which is what scene.createClipmapTerrain() consumes:
//
//   layer 0   30 m     decoder tiles composited around the camera   (30.7 km)
//   layer 1   7.68 km  one coarse request, made once                 (983 km)
//
// The clipmap is ONE mesh, built once, parked on the camera and displaced on
// the GPU. No chunks, no LOD rings to crack and no horizon dome — the rings
// reach 500 km, so what is under your feet and what you see at the horizon are
// the same surface, and everything that used to bridge them is gone.
//
// Decoder requests are sized generously — cost is fixed overhead, not area
// (1024^2 1.1 s, 2048^2 1.3 s, 3072^2 4.3 s) — so tiles are 2048 cells / 61 km.
// =============================================================================

const WEIGHTS   = 'D:/projects/brodiffusion/weights/terrain-diffusion-30m-bro';
const TILE      = 2048;   // decoder cells per tile edge (61.4 km)
const METRES    = 30;     // metres per decoder cell (the checkpoint's native res)
const SEA_LEVEL = 0;      // the model already puts sea level at 0 m
const FINE_N    = 1024;   // layer-0 texels per axis => 30.7 km around the camera
const COARSE_HALF = 64;   // coarse cells each way => 983 km at 7.68 km/cell

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

// --- Tile cache — the async half ---

let world = null;
const tiles = new Map();          // "ti,tj" -> { data, width, height } | 'pending'
let pendingCount = 0, generatedTiles = 0;

const tileKey = (ti, tj) => ti + ',' + tj;

// Decoder cell (i, j) -> world (z, x). i is north-south, j is west-east.
const cellI = (wz) => wz / METRES;
const cellJ = (wx) => wx / METRES;

function requestTile(ti, tj) {
    const k = tileKey(ti, tj);
    // One request at a time per world: the pipeline's tile cache is not
    // thread-safe and elevation() throws rather than racing it.
    if (!world || world.generating || tiles.has(k)) return;
    tiles.set(k, 'pending');
    pendingCount++;
    world.elevation(ti * TILE, tj * TILE, (ti + 1) * TILE, (tj + 1) * TILE, {
        onDone: (r) => {
            tiles.set(k, r); pendingCount--; generatedTiles++;
            fineOriginI = null;         // force a recomposite with the new data
        },
        // Drop it so a later frame retries rather than wedging 'pending'.
        onError: (e) => { tiles.delete(k); pendingCount--; console.log('tile ' + k + ': ' + e); },
    });
}

function tileAt(ti, tj) {
    const t = tiles.get(tileKey(ti, tj));
    return (t && t !== 'pending') ? t : null;
}

// --- Layer 0 — the 30 m field, composited around the camera ---
//
// A height layer is ONE contiguous texture with ONE origin, so the per-tile Map
// has to be flattened into a layer-sized array around the camera. Snapping that
// origin to the 30 m cell grid puts every texel exactly on a decoder cell, so
// the composite is a copy rather than a resample and cannot introduce a seam.

const fine = new Float32Array(FINE_N * FINE_N);
let fineOriginI = null, fineOriginJ = null;

function composeFine(camX, camZ) {
    const i0 = Math.round(cellI(camZ)) - FINE_N / 2;
    const j0 = Math.round(cellJ(camX)) - FINE_N / 2;
    if (fineOriginI !== null &&
        Math.abs(i0 - fineOriginI) < FINE_N / 8 &&
        Math.abs(j0 - fineOriginJ) < FINE_N / 8) return;
    if (!tileAt(Math.floor(cellI(camZ) / TILE), Math.floor(cellJ(camX) / TILE))) return;

    for (let r = 0; r < FINE_N; r++) {
        const gi = i0 + r, ti = Math.floor(gi / TILE);
        for (let c = 0; c < FINE_N; c++) {
            const gj = j0 + c, tj = Math.floor(gj / TILE);
            const t = tileAt(ti, tj);
            // No tile here yet: leave the coarse layer to cover it. NaN would
            // poison the texture, so fall through to the coarse sample.
            fine[r * FINE_N + c] = t
                ? t.data[(gi - ti * TILE) * t.width + (gj - tj * TILE)]
                : coarseAt(j0 * METRES + c * METRES, i0 * METRES + r * METRES);
        }
    }
    fineOriginI = i0; fineOriginJ = j0;
    terrain.setHeightLayer(0, {
        data: fine, width: FINE_N, height: FINE_N,
        originX: j0 * METRES, originZ: i0 * METRES, metresPerCell: METRES,
    });
}

// --- Layer 1 — the coarse field, one request, once ---
//
// 128 coarse cells at 7.68 km is 983 km across: the whole visible world from any
// altitude a player reaches, in a single 64 KB texture. The 2.8M-param coarse
// UNet alone, so it is a blocking call cheap enough for the load screen.

let coarse = null, coarseOrigin = 0;

function loadCoarse() {
    coarse = world.coarse(-COARSE_HALF, -COARSE_HALF, COARSE_HALF, COARSE_HALF);
    coarseOrigin = -COARSE_HALF * coarse.cellSize;
    terrain.setHeightLayer(1, {
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
// procedural detail the layers do not. Before the first decoder tile lands there
// is nothing worth standing on, so this reports null and walk mode declines.
function elevationAt(wx, wz) {
    return generatedTiles ? terrain.elevationAt(wx, wz) : null;
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
    // Well above the coarse height: it is a 7.68 km average and the real 30 m
    // terrain under it can be considerably higher.
    cam.pos = [bx, bh + 900, bz];
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
            status.textContent = 'Generating terrain (61 km across)...';
            requestTile(Math.floor(cellI(cam.pos[2]) / TILE),
                        Math.floor(cellJ(cam.pos[0]) / TILE));
        },
        onError: (e) => { status.textContent = 'Model load failed: ' + e; },
    });
}

// --- Camera — fly and walk ---

let mode = 'fly';           // 'fly' | 'walk'
const EYE = 1.7;            // metres, walking
const WALK_SPEED = 6;       // m/s (a jog)
const FLY_SPEED = 220;      // m/s

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

// --- Streaming — the tile under the camera, then the ring around it ---

function streamTiles() {
    if (!world || world.generating) return;
    const ti = Math.floor(cellI(cam.pos[2]) / TILE);
    const tj = Math.floor(cellJ(cam.pos[0]) / TILE);

    // A 2048^2 tile is 16 MB, so the cache cannot just grow. Anything beyond
    // two tiles is 120+ km off and regenerates in ~1.3 s, and the world is a
    // pure function of (seed, position), so dropping one loses nothing.
    if (tiles.size > 12) {
        for (const [k, v] of tiles) {
            if (v === 'pending') continue;   // would desync pendingCount
            const [ki, kj] = k.split(',').map(Number);
            if (Math.max(Math.abs(ki - ti), Math.abs(kj - tj)) > 2) tiles.delete(k);
        }
    }

    if (!tileAt(ti, tj)) { requestTile(ti, tj); return; }
    for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++)
            if (!tileAt(ti + di, tj + dj)) { requestTile(ti + di, tj + dj); return; }
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

    let speed = (mode === 'fly') ? FLY_SPEED : WALK_SPEED;
    if (keys['shift']) speed *= 3;
    Camera.flyIntegrate(cam, Camera.flyThrustFromKeys(cam, keys), dt, speed);

    if (mode === 'walk') {
        // No physics body: the ground is a direct lookup into the same surface
        // the GPU draws, so a character controller would add nothing but a
        // collision shape to keep in sync.
        const g = elevationAt(cam.pos[0], cam.pos[2]);
        if (g !== null) { cam.pos[1] = Math.max(SEA_LEVEL, g) + EYE; cam.vel[1] = 0; }
    }

    streamTiles();
    composeFine(cam.pos[0], cam.pos[2]);
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
        '  |  tiles ' + generatedTiles + (pendingCount ? ' (+' + pendingCount + ')' : '') +
        '  |  ' + terrain.layerCount + ' layers, ' +
        (terrain.triangleCount / 1000).toFixed(0) + 'k tris';

    if (generatedTiles && status.textContent) status.textContent = '';
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

export { cam, tiles, terrain, elevationAt, toggleMode };
