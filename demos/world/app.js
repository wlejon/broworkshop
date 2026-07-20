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
// is no generation order to preserve and nothing to save.
//
// THE ARCHITECTURE THAT MAKES THIS PLAYABLE.  A single elevation request costs
// seconds, which would be fatal if it happened per terrain chunk. It doesn't:
//
//   - Generation happens at TILE scale (1024 cells = 30.7 km), asynchronously,
//     on a background thread. Cost is dominated by fixed overhead rather than
//     area, so one big tile is ~25x cheaper per cell than many small ones.
//   - Chunk streaming then samples an already-resident tile, which is a cheap
//     array read, so terrain.setHeightSource stays synchronous and simple.
//
// Flying at 100 m/s crosses a tile in five minutes, so generation runs far
// ahead of the camera.
// =============================================================================

const WEIGHTS   = 'D:/projects/brodiffusion/weights/terrain-diffusion-30m-bro';
const TILE      = 1024;   // elevation cells per tile edge (30.7 km)
const METRES    = 30;     // metres per elevation cell (the checkpoint's native res)
const CELL      = 10;     // metres per TERRAIN cell — 3x finer than the data
const CHUNK     = 64;     // terrain cells per chunk edge (640 m)
const SEA_LEVEL = 0;      // the model already puts sea level at 0 m

const canvas = document.getElementById('c');
const scene  = canvas.getContext('scene');
const hud    = document.getElementById('hud');
const status = document.getElementById('status');

installSystemMenu();

// ============================================================================
// Sky, sun, water
// ============================================================================

scene.setToneMap({ mode: 'aces', exposure: 0.9, gamma: 2.2 });
scene.setEnvironment({
    hdr: '../lighting-demo/hdri/kloofendal_43d_clear_puresky_2k.hdr',
    intensity: 1.0,
});

const sun = scene.createLight({
    type: 'directional',
    direction: [-0.4, -0.85, -0.35],
    color: [1.0, 0.95, 0.86],
    intensity: 3.2,
});
sun.castsShadow = true;
sun.cascadeCount = 4;
sun.cascadeSplitLambda = 0.85;
scene.setShadowQuality(4096, 3);

// A big flat plane at y=0. The model already puts sea level at 0 m, so this
// needs no tuning — wherever the terrain goes negative, this is the surface
// above it, and ~70% of a generated region is typically ocean.
const water = scene.createMesh({
    data: Mesh.plane(1000000, 1000000, 1, 1),
    position: [0, SEA_LEVEL, 0],
    color: [0.02, 0.10, 0.20],
    metallic: 0.1,
    roughness: 0.08,
});

// ============================================================================
// Tile cache — the async half
// ============================================================================

let world = null;
const tiles = new Map();          // "ti,tj" -> { data, width, height } | 'pending'
let pendingCount = 0;
let generatedTiles = 0;

const tileKey = (ti, tj) => ti + ',' + tj;

// Elevation cell (i, j) -> world (z, x). i is north-south, j is west-east.
const worldToCellI = (wz) => wz / METRES;
const worldToCellJ = (wx) => wx / METRES;

function requestTile(ti, tj) {
    const k = tileKey(ti, tj);
    if (!world || tiles.has(k)) return;
    // One request at a time per world: the pipeline's tile cache is not
    // thread-safe and elevation() throws rather than racing it.
    if (world.generating) return;

    tiles.set(k, 'pending');
    pendingCount++;
    world.elevation(ti * TILE, tj * TILE, (ti + 1) * TILE, (tj + 1) * TILE, {
        onDone: (r) => {
            tiles.set(k, r);
            pendingCount--;
            generatedTiles++;
            onTileArrived();
        },
        onError: (e) => {
            // Drop it so a later frame retries rather than leaving a hole
            // wedged 'pending' forever.
            tiles.delete(k);
            pendingCount--;
            console.log('tile ' + k + ' failed: ' + e);
        },
    });
}

function tileAt(ti, tj) {
    const t = tiles.get(tileKey(ti, tj));
    return (t && t !== 'pending') ? t : null;
}

// ============================================================================
// Elevation sampling — the synchronous half
// ============================================================================

// Bilinear-sample the resident tiles at a world position. Returns null if the
// covering tile is not loaded yet, which is what tells the height source to
// decline the whole chunk rather than emit a half-real one.
function elevationAt(wx, wz) {
    const ci = worldToCellI(wz);
    const cj = worldToCellJ(wx);
    const i0 = Math.floor(ci), j0 = Math.floor(cj);
    const fi = ci - i0,        fj = cj - j0;

    // The four corners can straddle a tile boundary, so each is resolved
    // independently. Tiles agree exactly where they meet (worldgen crops a
    // margin off every request), so this cannot produce a seam.
    let acc = 0;
    for (let dz = 0; dz < 2; dz++) {
        for (let dx = 0; dx < 2; dx++) {
            const gi = i0 + dz, gj = j0 + dx;
            const ti = Math.floor(gi / TILE), tj = Math.floor(gj / TILE);
            const t = tileAt(ti, tj);
            if (!t) return null;
            const li = gi - ti * TILE, lj = gj - tj * TILE;
            const w = (dz ? fi : 1 - fi) * (dx ? fj : 1 - fj);
            acc += w * t.data[li * t.width + lj];
        }
    }
    return acc;
}

// ============================================================================
// Terrain
// ============================================================================

let terrain = null;
let servedChunks = 0, declinedChunks = 0;

function terrainOpts() {
    return {
        chunkSize: [CHUNK, 600, CHUNK],   // y bounds the height range, in cells
        cellSize: CELL,
        // heightAmplitude does NOT shape anything here — the height source has
        // already replaced the noise generator. It survives only because
        // colorizeByHeight bands the palette over [seaLevel, seaLevel +
        // heightAmplitude], so it has to describe the real elevation range or
        // every slope above 13.6 m comes out as snow.
        heightAmplitude: 2800,
        loadRadius: 5,
        unloadRadius: 8,
        maxLoadsPerUpdate: 3,
        // Without LOD rings the world ends in a visible polygon a few km out:
        // a 640 m chunk at loadRadius 5 reaches 3.2 km, which is nothing at
        // 220 m/s. Each ring is 3x coarser, so this reaches ~86 km for a
        // handful more chunks — and the height source is handed the ring's own
        // cellSize, so coarse rings sample the same tiles correctly.
        lodLevels: 4,
        lodScaleFactor: 3,
        seaLevel: SEA_LEVEL,
        meshMode: 0,                      // smooth — the data is already smooth
        palette: new Float32Array([
            0, 0, 0, 0,                   // 0: air
            0.20, 0.34, 0.12, 1,          // 1: lowland green
            0.36, 0.30, 0.18, 1,          // 2: slope
            0.42, 0.40, 0.38, 1,          // 3: rock
            0.90, 0.92, 0.95, 1,          // 4: snow
            0.76, 0.70, 0.48, 1,          // 5: shore sand
        ]),
    };
}

function createTerrain() {
    terrain = scene.createTerrain(terrainOpts());
    terrain.setHeightSource((cx, cz, lod, pw, ph, cellSize, wx0, wz0) => {
        // Use wx0/wz0 as given. The padded grid reaches one sample beyond the
        // chunk on every side and those positions already carry that offset;
        // re-deriving it and dropping the skirt would shift each chunk one cell
        // against its neighbours — which, for a coherent source, looks entirely
        // correct and simply fails to line up.
        const out = new Float32Array(pw * ph);
        for (let pz = 0; pz < ph; pz++) {
            for (let px = 0; px < pw; px++) {
                const h = elevationAt(wx0 + px * cellSize, wz0 + pz * cellSize);
                if (h === null) {
                    // No tile here yet. Do NOT return null: that falls back to
                    // the built-in FBm, and with heightAmplitude set to describe
                    // a 2800 m elevation range the noise erupts into kilometre
                    // -high spikes along the horizon. The coarse LOD rings reach
                    // ~86 km, well past the resident tiles, so this is the
                    // common case rather than an edge one.
                    //
                    // Sea floor instead: flat, below the water plane, and
                    // therefore invisible until the real tile lands and
                    // onTileArrived rebuilds it.
                    declinedChunks++;
                    out.fill(SEA_LEVEL - 50);
                    return out;
                }
                out[pz * pw + px] = h;
            }
        }
        servedChunks++;
        return out;
    });
}

// A chunk built while its tile was missing fell back to noise and will never
// re-ask on its own, so a newly arrived tile has to force a rebuild. This is
// heavy, but it happens once per ~30 km of travel.
function onTileArrived() {
    if (!terrain) { createTerrain(); return; }
    terrain.configure(terrainOpts());
}

// ============================================================================
// Load
// ============================================================================

status.textContent = 'Loading terrain model...';
if (!bro.worldgen || !bro.worldgen.available) {
    status.textContent = 'bro.worldgen unavailable — build with BRO_WITH_DIFFUSION.';
} else {
    bro.worldgen.init();
    bro.worldgen.loadWorld(WEIGHTS, {
        seed: 42,
        onReady: (w) => {
            world = w;
            status.textContent = 'Generating first tile (30.7 km)...';
            requestTile(0, 0);
        },
        onError: (e) => { status.textContent = 'Model load failed: ' + e; },
    });
}

// ============================================================================
// Camera — fly and walk
// ============================================================================

let mode = 'fly';           // 'fly' | 'walk'
const EYE = 1.7;            // metres, walking
const WALK_SPEED = 6;       // m/s (a jog)
const FLY_SPEED = 220;      // m/s

const cam = Camera.createFly({
    pos: [0, 1200, 0],
    rot: Camera.quatNorm(Camera.quatMul(
        Camera.quatFromAxis(0, 1, 0, -Math.PI / 4),
        Camera.quatFromAxis(1, 0, 0, -0.55))),
    accel: 14.0,
    damping: 7.0,
    rollSpeed: 2.0,
    lookSpeed: 0.003,
});

const keys = {};
let mouseX = 0, mouseY = 0, looking = false;

document.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === 'f') toggleMode();
});
document.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2 || e.button === 0) { looking = true; canvas.requestPointerLock(); }
});
document.addEventListener('mouseup', () => { looking = false; document.exitPointerLock(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('mousemove', (e) => {
    if (!looking) return;
    mouseX += e.movementX;
    mouseY += e.movementY;
});

function toggleMode() {
    mode = (mode === 'fly') ? 'walk' : 'fly';
    if (mode === 'walk') {
        // Drop to the surface, but never below sea level — walking on the
        // seabed is a worse failure than hovering.
        const g = elevationAt(cam.pos[0], cam.pos[2]);
        cam.pos[1] = Math.max(SEA_LEVEL, g === null ? cam.pos[1] : g) + EYE;
        cam.vel = [0, 0, 0];
    }
}

// ============================================================================
// Streaming — keep the tile under the camera, and the one being approached
// ============================================================================

function streamTiles() {
    if (!world || world.generating) return;
    const ci = worldToCellI(cam.pos[2]), cj = worldToCellJ(cam.pos[0]);
    const ti = Math.floor(ci / TILE),    tj = Math.floor(cj / TILE);

    // The tile we're standing on first, then the ring around it — a tile edge
    // can be reached in a couple of minutes of flight, so the neighbours need
    // to be in flight well before they're needed.
    if (!tileAt(ti, tj)) { requestTile(ti, tj); return; }
    for (const [di, dj] of [[0,1],[1,0],[0,-1],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]) {
        if (!tileAt(ti + di, tj + dj)) { requestTile(ti + di, tj + dj); return; }
    }
}

// ============================================================================
// Frame
// ============================================================================

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
        const g = elevationAt(cam.pos[0], cam.pos[2]);
        if (g !== null) {
            // Stick to the surface. No physics body: the terrain is a height
            // field, so the ground is a direct lookup and a character
            // controller would only add a collision shape to keep in sync.
            cam.pos[1] = Math.max(SEA_LEVEL, g) + EYE;
            cam.vel[1] = 0;
        }
    }

    streamTiles();
    if (terrain) terrain.update(cam.pos[0], cam.pos[1], cam.pos[2]);

    // far has to clear the horizon: at 3.4 km up that is ~208 km, and a
    // nearer far plane slices the ocean off in a hard straight line that
    // reads as a rendering bug rather than a horizon.
    cam.fov = 70; cam.near = 1.0; cam.far = 400000;
    scene.setCamera(Camera.flyViewOptsQuat(cam, canvas));

    const g = elevationAt(cam.pos[0], cam.pos[2]);
    hud.textContent =
        mode.toUpperCase() +
        '  |  ' + (cam.pos[0] / 1000).toFixed(2) + ', ' + (cam.pos[2] / 1000).toFixed(2) + ' km' +
        '  |  alt ' + Math.round(cam.pos[1]) + ' m' +
        (g === null ? '' : '  |  ground ' + Math.round(g) + ' m') +
        '  |  ' + fps + ' fps' +
        '  |  tiles ' + generatedTiles + (pendingCount ? ' (+' + pendingCount + ')' : '') +
        '  |  chunks ' + (terrain ? terrain.chunkCount : 0) +
        (declinedChunks ? '  |  awaiting tile ' + declinedChunks : '');

    if (terrain && status.textContent) status.textContent = '';
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

export { cam, tiles, elevationAt, toggleMode };
