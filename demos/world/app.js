import "/lib/camera.js";
import { installSystemMenu } from "/lib/system-menu.js";
import { PLANET, loadChart } from "/app/planet.js";

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
// rather than by the rings: terrain.coverageDistance is min(reach, horizon(eye)
// + horizon(highest ground)) — two tangent lengths, so a peak beyond the eye's
// own horizon still shows. Past it the layer fades and the surface drops to sea
// level, which is safe because that ground has already bent below the eye ray.
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

// --- Terrain model state ---

let world = null;
let modelReady = false;

// --- Layer 1 — the whole planet, baked, or a window that follows the camera ---
//
// The COARSEST layer is the base of the blend and must cover everything, so it
// sits at the highest used slot (1), leaving slot 0 — the finest — for the 30 m
// detail window that streams in near the ground. With no fine window installed,
// slot 0 is empty and contributes zero weight, so the coarse field shows alone.
//
// PREFERRED PATH: the entire globe, once, from tools/bake-planet.js. 5212 x 2606
// cells at 7.68 km is 52 MB, which is a texture rather than a problem, and it
// makes the coarse field a READ instead of a computation. That removes the
// re-cut hitch outright — not shortens it: from 400 km up the window was over
// 1200 cells square and measured 36 s of synchronous generation, a hard lock of
// the whole app that no window tuning could remove because the cost was real
// work the camera had to wait for.
//
// It also removes the last edge. A camera-following window is unbounded but
// always finite, so coverage is a race against how fast you fly; the baked chart
// simply contains every place there is.
//
// The chart is laid out as its own grid: cell (i, j) sits at world
// (x = j * cell, z = i * cell), so x runs one full circumference and z runs pole
// to pole. LONGITUDE WRAPS — the layer is marked periodic, so flying east past
// the meridian arrives back at the start over the band the bake blended, and
// there is no edge to reach any more.
//
// Latitude does not, and cannot: an equirectangular chart's polar rows are
// single points. Flying over a pole is the remaining case the geometry cannot
// express, because the ring stack is still laid out in CHART metres rather than
// true arc — near the poles a cell of longitude is much shorter on the ground
// than at the equator, and at the pole itself it is zero. That is what a
// camera-centred spherical chart fixes.
//
// FALLBACK: generate a window live. The binary is gitignored, so a fresh clone
// has no bake, and the app has to work before someone has run the tool.
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

let baked = false;
let EAST_SPAN = 0;      // metres of longitude before the world repeats
let coarse = null, coarseOriginX = 0, coarseOriginZ = 0;
let coarseCellI = null, coarseCellJ = null;   // window centre, in coarse cells

// i is north-south (z), j is west-east (x) — the decoder's convention.
const COARSE_COOLDOWN = 20;   // frames between re-cuts, whatever asks for one
let coarseCooldown = 0;

// minHalf forces a wider window than visibility alone would justify. Exactly
// one caller needs it: the spawn search, which reads SPAWN_HALF cells looking
// for somewhere worth standing before there is a camera to have a horizon.
function loadCoarse(camX, camZ, eyeAboveSeaLevel, minHalf = 0) {
    if (baked) return false;          // the whole planet is already resident
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
        Math.ceil((terrain.coverageDistance(eyeAboveSeaLevel) * 1.1) / cell) + 2);
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
    terrain.setHeightLayer(1, {
        data: coarse.data, width: coarse.width, height: coarse.height,
        originX: coarseOriginX, originZ: coarseOriginZ,
        metresPerCell: coarse.cellSize,
    });
    return true;
}

// --- Layer 0 — streamed 30 m detail, near the ground and moving slowly ---
//
// The coarse chart resolves 7.68 km; the decoder resolves 30 m, with real
// drainage and broken faces the fBm floor only approximates. But a full decoder
// tile is SECONDS of work (a 1024^2 tile is ~4.6 s), so it cannot keep up with
// fast flight — and it does not have to. It is a BONUS tier on top of a surface
// that already works: streamed only when the eye is low and slow, where a
// 30.7 km tile stays relevant for a long time, with the fBm floor covering
// until it lands and after it is released. Never a wait, never a repeat.
const METRES        = 30;      // metres per decoder cell (checkpoint native res)
const FINE_N        = 1024;    // decoder cells per window edge (30.7 km)
const FINE_REQ_AGL  = 3000;    // request a window only below this height AGL
const FINE_HOLD_AGL = 6000;    // release it once climbing past this
const FINE_REQ_SPD  = 250;     // m/s of actual motion; above this, skip

let fineCellI = null, fineCellJ = null, finePending = false;

function loadFine(camX, camZ, agl, speed) {
    if (!world || !modelReady) return;
    // Climbed out of the regime the fine tier serves: drop to coarse + fBm so a
    // stale patch does not hang under a distant view.
    if (agl > FINE_HOLD_AGL) {
        if (fineCellI !== null) {
            terrain.setHeightLayer(0, null);
            fineCellI = fineCellJ = null;
        }
        return;
    }
    // Low, but too high or too fast to be worth a tile, or one is already in
    // flight (the pipeline serves one request at a time): keep what we have.
    if (agl > FINE_REQ_AGL || speed > FINE_REQ_SPD) return;
    if (world.generating || finePending) return;

    // Decoder cell (i, j) -> world (z = i*METRES, x = j*METRES).
    const ci = Math.round(camZ / METRES);
    const cj = Math.round(camX / METRES);
    // Re-cut only after drifting a quarter of the window from its centre.
    if (fineCellI !== null &&
        Math.abs(ci - fineCellI) < FINE_N / 4 &&
        Math.abs(cj - fineCellJ) < FINE_N / 4) return;

    const i0 = ci - FINE_N / 2, j0 = cj - FINE_N / 2;
    finePending = true;
    world.elevation(i0, j0, i0 + FINE_N, j0 + FINE_N, {
        onDone: (r) => {
            finePending = false;
            terrain.setHeightLayer(0, {
                data: r.data, width: r.width, height: r.height,
                originX: j0 * METRES, originZ: i0 * METRES,
                metresPerCell: METRES,
            });
            fineCellI = ci; fineCellJ = cj;
        },
        onError: (e) => { finePending = false; console.log('fine: ' + e); },
    });
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
    // Search a box around the chart's middle, not the whole field. With a
    // camera-following window those were the same thing; with the whole planet
    // resident they are 5000 cells apart, and scanning 13.6 M cells to pick a
    // spawn inside a 36-cell radius is work with no result attached.
    const ci = c.height / 2, cj = w / 2, r = SPAWN_HALF * 0.5;
    const i0 = Math.max(1, Math.floor(ci - r)), i1 = Math.min(c.height - 1, Math.ceil(ci + r));
    const j0 = Math.max(1, Math.floor(cj - r)), j1 = Math.min(w - 1, Math.ceil(cj + r));
    let best = -Infinity, bx = 0, bz = 0, bh = 0;
    for (let i = i0; i < i1; i++) {
        for (let j = j0; j < j1; j++) {
            const h = c.data[i * w + j];
            if (h < 200) continue;                       // want to stand on land
            const d = Math.hypot(i - ci, j - cj);
            if (d > r) continue;                         // room to fly any way
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

// The chart goes in FIRST, before the decoder loads. It costs a file read, and
// it means there is a planet to look at during the seconds the model takes —
// the surface is complete from the first frame and detail arrives on top of it,
// rather than the app showing a flat plane until a generator answers.
const chart = loadChart('D:/projects/broworkshop/demos/world/');
if (chart) {
    baked = true;
    coarse = { data: chart.data, width: chart.width, height: chart.height,
               cellSize: chart.cellSize };
    coarseOriginX = 0;
    coarseOriginZ = 0;
    EAST_SPAN = chart.width * chart.cellSize;
    terrain.setHeightLayer(1, {
        data: chart.data, width: chart.width, height: chart.height,
        originX: 0, originZ: 0, metresPerCell: chart.cellSize,
        // Longitude is periodic. Without this the chart had an east-west edge
        // where GL_CLAMP_TO_EDGE smeared the last column outward forever — the
        // one place left in the world you could reach the end of.
        wrapX: true,
    });
    console.log('planet: baked chart ' + chart.width + 'x' + chart.height +
                ' at ' + (chart.cellSize / 1000).toFixed(2) + ' km');
}

status.textContent = 'Loading terrain model...';
if (!bro.worldgen || !bro.worldgen.available) {
    status.textContent = 'bro.worldgen unavailable — build with BRO_WITH_DIFFUSION.';
} else {
    bro.worldgen.init();
    bro.worldgen.loadWorld(WEIGHTS, {
        seed: PLANET.seed,   // the world's identity; see planet.js
        onReady: (w) => {
            world = w;
            if (!baked) { loadCoarse(0, 0, 2, SPAWN_HALF); chooseSpawn(); }
            modelReady = true;
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

// With a baked chart the spawn can be picked immediately — the field is already
// there. It waits until here only because chooseSpawn writes to `cam`, which is
// declared above; the un-baked path still picks its spawn from the model's
// onReady, since there is nothing to search until the first window lands.
if (baked) chooseSpawn();

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

        // Longitude wraps, so keep the camera on the chart. Left unwrapped, x grows
    // without bound and the elevation lookup stays correct (the sampler is
    // periodic) while the HUD reports a position off the map and fp32 slowly
    // loses the sub-cell offset the detail taps depend on.
    if (baked) cam.pos[0] -= EAST_SPAN * Math.floor(cam.pos[0] / EAST_SPAN);

    // The world has no edge: re-cut the coarse window when the camera has
    // travelled far enough that the ring stack would otherwise reach past it.
    // Sized from eye height above SEA LEVEL, which is what sets the horizon.
    // Height above the ground underfoot is a different quantity and using it
    // here cut the world off 30 km out while standing on a 3.7 km massif, where
    // the true horizon is 219 km — the terrain ended in a wall.
    const gCoarse = elevationAt(cam.pos[0], cam.pos[2]);
    const aglCoarse = Math.max(1, cam.pos[1] -
                               (gCoarse === null ? PLANET.seaLevel : gCoarse));
    const aslCoarse = Math.max(1, cam.pos[1] - PLANET.seaLevel);
    if (world && !world.generating) loadCoarse(cam.pos[0], cam.pos[2], aslCoarse);
    loadFine(cam.pos[0], cam.pos[2], aglCoarse,
             Math.hypot(cam.vel[0], cam.vel[1], cam.vel[2]));
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

    if (modelReady && status.textContent) status.textContent = '';
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

export { cam, terrain, elevationAt, toggleMode, sun, scene };
// Diagnostics: enough to rebuild the terrain with a different config and
// re-install the same height data, so tests can bisect config against artifact.
export const coarseField = () => ({ data: coarse, originX: coarseOriginX,
                                    originZ: coarseOriginZ });
export const worldgen = () => world;
export const ready = () => modelReady;
