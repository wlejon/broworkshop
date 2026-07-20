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
//   layer 0   7.68 km  a coarse window that follows the camera, sized to
//                       whatever the clipmap currently reaches
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
const SPAWN_HALF = 72;    // coarse cells searched for a start position

// =============================================================================
// THE PLANET DESCRIPTOR
//
// Everything that makes this world THIS world, in one object. Not a set of
// scattered constants: a planet is a thing you author, and worlds of different
// size and composition are the point — a moon is not a small Earth, it is a
// different radius, a different sea level and no snow line at all.
//
// So nothing below is allowed to be hard-coded downstream. This object is what
// the world builder will edit and serialise; the app is already written as its
// consumer so that the builder has something real to drive rather than a
// parallel implementation to keep in sync.
//
// RADIUS IS THE LOAD-BEARING FIELD. It sets the horizon, sqrt(2Rh+h^2), and
// therefore how far the world must be generated, held and drawn at every
// altitude. Earth's 6371 km shows 5 km of ground from a 2 m eye height; a
// 600 km moon shows 1.5 km and feels correspondingly small to stand on, which
// is the effect rather than a limitation. 0 means a flat, endless world.
//
// The elevation model was trained on Earth, so its landforms carry an implied
// scale. Putting them on a smaller planet is a deliberate choice (they read as
// oversized, which is what a small dense world SHOULD look like), not an
// accident to be corrected — but it is the reason radius and metresPerCell are
// separate knobs.
// =============================================================================
const PLANET = {
    name:   'earthlike',
    radius: 6371000,      // metres; 0 = flat world

    seaLevel:    0,       // metres; the model already puts sea level at 0
    heightScale: 1,       // sampled metres -> world metres; >1 exaggerates relief
    snowLine:    1700,    // metres; Infinity for a world with no snow

    // Structure below the data floor. detailRelief is a SLOPE, so it needs no
    // retuning when heightScale changes — see ClipmapConfig.
    detailWavelength: 48,
    detailRelief:     0.35,
    detailOctaves:    7,
};

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
    seaLevel: PLANET.seaLevel,
});

// 11 levels of 128 quads at 8 m REACH 64 * 8 * 2^10 = 524 km, and the stack
// zooms with altitude up to maxCellScale, so from orbit the rings reach 4194 km.
// Reach is a fixed triangle budget, so it is nearly free.
//
// What is NOT free is COVERING it with data, and that is bounded by the planet
// rather than by the rings: terrain.coverageDistance is min(reach, 2 x horizon).
// Past it the layer's coverage fades and the surface drops to sea level, which
// is safe precisely because that ground has already bent below the eye ray.
//
// Everything here that describes the WORLD rather than the mesh comes from
// PLANET. levels/resolution/cellSize/maxCellScale describe the mesh: they are a
// performance budget and are the same on any planet.
const terrain = scene.createClipmapTerrain({
    levels: 11,
    resolution: 128,
    cellSize: 8,
    maxCellScale: 8,

    planetRadius:     PLANET.radius,
    seaLevel:         PLANET.seaLevel,
    heightScale:      PLANET.heightScale,
    snowLine:         PLANET.snowLine,
    detailWavelength: PLANET.detailWavelength,
    detailRelief:     PLANET.detailRelief,
    detailOctaves:    PLANET.detailOctaves,
});

// --- The detail exemplar — one decoder tile, used as structure, not as data ---

let world = null;
let exemplarReady = false;
let exemplarPatch = null;

// Decoder cell (i, j) -> world (z, x). i is north-south, j is west-east.
const cellI = (wz) => wz / METRES;
const cellJ = (wx) => wx / METRES;

function requestExemplar(camX, camZ) {
    const i0 = Math.round(cellI(camZ)) - EXEMPLAR_CELLS / 2;
    const j0 = Math.round(cellJ(camX)) - EXEMPLAR_CELLS / 2;
    world.elevation(i0, j0, i0 + EXEMPLAR_CELLS, j0 + EXEMPLAR_CELLS, {
        onDone: (r) => {
            exemplarPatch = { data: r.data, width: r.width, height: r.height,
                              metresPerCell: METRES };
            terrain.setDetailExemplar(exemplarPatch);
            exemplarReady = true;
        },
        onError: (e) => { console.log('exemplar: ' + e); exemplarReady = true; },
    });
}

// --- Layer 0 — the coarse field, a window that follows the camera ---
//
// This USED to be one request centred on the origin, and that was a hard edge
// on the world. The clipmap's rings are camera-centred and reach 524 km in
// every direction forever, but a fixed layer does not: step past its footprint
// and the height texture is GL_CLAMP_TO_EDGE, so the edge texel column is
// smeared outward and elevation stops depending on that axis at all. Two points
// 400 km apart came back 1.8 m apart. On screen that is the whole world flatten-
// ed into parallel bands stretched to the horizon.
//
// Nothing about the model required that bound. The field is a pure function of
// (seed, position) and the coarse UNet is 2.8M parameters, so the window can
// simply be re-cut around the camera as it travels. Re-centring cannot move
// terrain: the request is in CELL indices, so every texel lands on the same
// cell it would have had from any other vantage.
//
// The reach is NOT a constant any more: the clipmap zooms its ring stack with
// altitude, so from orbit it asks for a footprint tens of times wider than it
// does on foot. Sizing the window from terrain.farDistance every time is what
// keeps data under the outermost ring at any altitude — a fixed 72 cells was
// correct only for the ground-level stack.
let coarseHalf = 0;

let coarse = null, coarseOriginX = 0, coarseOriginZ = 0;
let coarseCellI = null, coarseCellJ = null;   // window centre, in coarse cells

// i is north-south (z), j is west-east (x) — the decoder's convention.
const COARSE_COOLDOWN = 20;   // frames between re-cuts, whatever asks for one
let coarseCooldown = 0;

// minHalf forces a wider window than visibility alone would justify. Exactly
// one caller needs it: the spawn search, which reads SPAWN_HALF cells looking
// for somewhere worth standing before there is a camera to have a horizon.
function loadCoarse(camX, camZ, eyeAboveGround, minHalf = 0) {
    if (coarseCooldown > 0) coarseCooldown--;
    const cell = coarse ? coarse.cellSize : 7680;
    const ci = Math.round(camZ / cell);
    const cj = Math.round(camX / cell);

    // Cover what can actually be SEEN, with a margin, and let the camera drift
    // a quarter of that margin before paying for a re-cut.
    //
    // coverageDistance, not farDistance. The rings reach 524 km from the deck
    // and the horizon is 5 km; sizing from the rings meant generating a
    // 137,000 sq km field to render 79 of them. On the ground this is now a
    // 4-cell radius instead of 70 — three orders of magnitude of generator work
    // that was going behind the planet.
    const half = Math.max(
        minHalf,
        Math.ceil((terrain.coverageDistance(eyeAboveGround) * 1.1) / cell) + 2);
    const restep = Math.max(4, Math.floor(half * 0.08));
    // Re-cut when the window is too small, when it is much too big (descending
    // shrinks the ring stack, and holding a 1206-square field to fly at ground
    // level is pure waste), or when the camera has drifted far enough.
    if (coarseCellI !== null && half <= coarseHalf && half > coarseHalf * 0.6 &&
        Math.abs(ci - coarseCellI) < restep &&
        Math.abs(cj - coarseCellJ) < restep) return false;

    // A COOLDOWN, because generating the field is not what a re-cut costs.
    // world.coarse returns a 1212-square window in well under a millisecond;
    // setHeightLayer then copies six megabytes, uploads it and builds a mip
    // pyramid. Doing that on consecutive frames locks the window, so the rate
    // is capped here rather than hoping the trigger never fires twice. Missing
    // data for a few frames costs a clamped rim on the outermost ring; missing
    // the cap costs the whole app.
    if (coarseCooldown > 0) return false;
    coarseCooldown = COARSE_COOLDOWN;
    coarseHalf = half;

    // Synchronous: the coarse UNet is small enough that this has always been a
    // load-screen call. Now that it also fires mid-flight, the cost is a hitch,
    // so it is reported rather than hidden.
    const t0 = performance.now();
    coarse = world.coarse(ci - half, cj - half, ci + half, cj + half);
    const ms = performance.now() - t0;
    coarseOriginZ = (ci - half) * coarse.cellSize;
    coarseOriginX = (cj - half) * coarse.cellSize;
    coarseCellI = ci; coarseCellJ = cj;
    console.log('coarse window re-cut at ' + (camX / 1000).toFixed(0) + ', ' +
                (camZ / 1000).toFixed(0) + ' km: ' + coarse.width + 'x' +
                coarse.height + ' in ' + ms.toFixed(0) + ' ms');
    terrain.setHeightLayer(0, {
        data: coarse.data, width: coarse.width, height: coarse.height,
        originX: coarseOriginX, originZ: coarseOriginZ,
        metresPerCell: coarse.cellSize,
    });
    return true;
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
            if (d > SPAWN_HALF * 0.5) continue;         // room to fly any way
            let lo = Infinity;                           // ocean nearby?
            for (let di = -1; di <= 1; di++)
                for (let dj = -1; dj <= 1; dj++)
                    lo = Math.min(lo, c.data[(i + di) * w + (j + dj)]);
            const score = h + (lo < 0 ? 1200 : 0) - d * 40;
            if (score > best) {
                best = score; bh = h;
                bx = coarseOriginX + j * c.cellSize;
                bz = coarseOriginZ + i * c.cellSize;
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
            loadCoarse(0, 0, 2, SPAWN_HALF);
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
        cam.pos[1] = Math.max(PLANET.seaLevel, g === null ? cam.pos[1] : g) + EYE;
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
    const aglNow = Math.max(0, cam.pos[1] - (gNow === null ? PLANET.seaLevel : gNow));
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
        if (g !== null) { cam.pos[1] = Math.max(PLANET.seaLevel, g) + EYE; cam.vel[1] = 0; }
    }

    // The world has no edge: re-cut the coarse window when the camera has
    // travelled far enough that the ring stack would otherwise reach past it.
    // The window is sized from eye height above ground, because that is what
    // sets the horizon and therefore how much of the reach is actually visible.
    const gCoarse = elevationAt(cam.pos[0], cam.pos[2]);
    const aglCoarse = Math.max(1, cam.pos[1] -
                               (gCoarse === null ? PLANET.seaLevel : gCoarse));
    if (world && !world.generating) loadCoarse(cam.pos[0], cam.pos[2], aglCoarse);
    terrain.update(cam.pos[0], cam.pos[1], cam.pos[2]);

    const g = gCoarse;
    const agl = aglCoarse;
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
// Diagnostics: enough to rebuild the terrain with a different config and
// re-install the same height data, so tests can bisect config against artifact.
export const coarseField = () => ({ data: coarse, originX: coarseOriginX,
                                    originZ: coarseOriginZ });
export const exemplar = () => exemplarPatch;
export const worldgen = () => world;
export const ready = () => exemplarReady;
