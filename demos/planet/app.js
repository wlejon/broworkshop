// Planet: an Earth-radius world drawn from a bro.tiles cube-sphere cache.
//
// The ground is one height function (ground.bk) evaluated per tile on the
// GPU in f64. Each tile's cells are written relative to the tile's center,
// and every tile is drawn camera-relative: the scene's camera sits at the
// origin and each tile instance is placed at (tile center - camera), both in
// doubles on the CPU, so nothing ever holds a planet-sized f32.
import { boot } from "/lib/kit/app.js";
import { bindControl, logMap } from "/lib/kit/params.js";
import { GROUND_LIGHT, createClouds } from "/app/clouds.js";
import { createGrass, grassModules } from "/app/grass.js";
import { createTrees, treeModules } from "/app/trees.js";
import { createRivers } from "/app/rivers.js";
import { constants, readApp } from "/app/shaders.js";

boot();

const RADIUS = 6371000;
const TILE = 32;            // cells along a tile's drawn edge
const BORDER = 2;           // cells beyond it: the skirts' bottoms, and the detail layer's gradients at the edge
const CELLS = TILE + 2 * BORDER;
const DETAIL = 4;         // detail texels along a cell's edge (planet.bk's detail layer)
const TEXELS = CELLS * DETAIL;
const HZ = CELLS / 2;        // horizon points along a tile's edge, every other cell (planet.bk's horizon layer)
const HZ_GRID = TILE + 2 * 16 - 1;   // the heights a tile's horizons march through, along an edge (planet.bk HZ_MARGIN 16)
const CAPACITY = 4096;
const SEED = 7;
const BASE_WAVELENGTH = 2400000;   // ground.bk's first octave
const DETAIL_PERIOD = 64;          // metres; the ground shader's fine detail repeats over it
const SWELL_PERIOD = 1024;         // metres; and its long waves
const WAVE_CLOCK = 1024;           // seconds the sea's waves repeat over

// The sea's waves, a wind sea at about 7 m/s: from 256 m to half a metre,
// six a halving (each somewhere in its sixth: whole ratios between them
// would tile into a lattice), each a sinusoid of the shader's periodic
// coordinates (a whole number of waves along each axis of the period) in a
// random direction, and its frequency the deep-water ω^2 = g k made a whole number
// over WAVE_CLOCK. Their slopes share Cox and Munk's mean square slope for
// that wind (0.003 + 0.00512 U), equally a halving above the peak (the
// saturation range: elevation ~ k^-3) and falling off past it as
// Pierson-Moskowitz does; what is shorter than the last is WAVE_RESIDUAL.
const WAVES = (() => {
    const total = 0.003 + 0.00512 * 7, residual = 0.3 * total, peak = 60;
    let seed = 4242;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const list = [];
    for (let i = 0; i < 54; i++) {
        const lambda = 256 * 2 ** (-(i + rnd()) / 6);
        const period = lambda > 12 ? SWELL_PERIOD : DETAIL_PERIOD;
        const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), r = Math.sqrt(1 - z * z);
        const n = [r * Math.cos(a), r * Math.sin(a), z].map((c) => Math.round(c * period / lambda));
        const k = 2 * Math.PI * Math.hypot(...n) / period;
        if (k === 0) continue;
        const omega = Math.round(Math.sqrt(9.81 * k) * WAVE_CLOCK / (2 * Math.PI)) * 2 * Math.PI / WAVE_CLOCK;
        list.push({ n, period, k, omega, shape: Math.exp(-1.25 * (2 * Math.PI / k / peak) ** 2) });
    }
    const sum = list.reduce((s, w) => s + w.shape, 0);
    // A sinusoid of slope amplitude s has mean square slope s^2 / 2.
    for (const w of list) w.slope = Math.sqrt(2 * (total - residual) * w.shape / sum);
    let tail = 0;
    for (let i = list.length - 1; i >= 0; i--) { tail += list[i].slope ** 2 / 2; list[i].tail = tail; }
    // Rivers and lakes are sheltered: no fetch for waves longer than a few
    // metres, and a breeze's ripples (Cox and Munk at 2 m/s, a mean square
    // slope of 0.0132) where the sea has its wind sea. They take the waves
    // from `fresh` on, 4 m and shorter, scaled with the residual to that.
    const fresh = list.findIndex((w) => 2 * Math.PI / w.k <= 4);
    const freshScale = Math.sqrt((0.003 + 0.00512 * 2) / (list[fresh].tail + residual));
    return { list, residual, swell: list.filter((w) => w.period === SWELL_PERIOD).length, fresh, freshScale };
})();
const MODULES = { 'planet::ground': readApp('ground.bk'), 'planet::relief': readApp('relief.bk'), 'planet::rivers': readApp('rivers.bk'),
                  'planet::clouds': readApp('clouds.bk'), tiles: bro.tiles.module };
const mod = bro.kernel.compile(readApp('planet.bk'), { file: 'planet.bk', modules: MODULES });
const rivers = createRivers(bro.kernel.compile(readApp('riverbuild.bk'), { file: 'riverbuild.bk', modules: MODULES }), RADIUS, SEED);
const kTile = mod.kernel('k_tile');
const kHeight = mod.kernel('k_height');
const kRange = mod.kernel('k_range');
const kAnchor = mod.kernel('k_anchor');
const kDetailHeight = mod.kernel('k_detail_height');
const kDetail = mod.kernel('k_detail');
const kHorizonHeights = mod.kernel('k_horizon_heights');
const kHorizon = mod.kernel('k_horizon');

// The octaves a tile's cells can carry: down to a wavelength of 2.5 cells
// (the tile kernels take theirs from ground.bk octaves_for, the same).
const octavesFor = (extent) => Math.min(30, Math.max(1, Math.log2(BASE_WAVELENGTH / (2.5 * extent / TILE))));
const MAX_LEVEL = 22;
// The finest octaves anything draws: a colour is the mean over them.
const TRUTH = octavesFor(RADIUS * Math.PI / 2 / 2 ** MAX_LEVEL);

const MAX_HEIGHT = 9000;
// The most tiles a batch holds; the engine paces batches by the frames
// (they run beside them), the nearest error first, so motion keeps its
// frame rate and the ground nearest the eye still sharpens first.
const PRODUCE_PER_UPDATE = 24;
// k_tile's per-tile height gather for k_range (planet.bk), zeroed between
// batches by k_range itself.
const span = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * 2 * 4);
span.write(new Int32Array(PRODUCE_PER_UPDATE * 2));
// The batch's texel mean heights, k_detail_height to k_detail.
const texelHeights = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * TEXELS * TEXELS * 4);
// The batch's horizon heights, k_horizon_heights to k_horizon.
const horizonHeights = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * HZ_GRID * HZ_GRID * 4);
// Each resident tile's relief anchors (planet.bk k_anchor), by slot.
const anchors = bro.kernel.createBuffer(CAPACITY * 20 * 4);

const canvas = document.querySelector('#stage');
const scene = canvas.getContext('scene');
scene.setToneMap({ mode: 'aces' });
// The sun above the air, in lux; the atmosphere dims and reddens it, lights
// the sky and the haze, and the exposure meters the light at the eye.
// The sun turns about the planet's axis (y) with the hour: noon is the
// direction it starts in.
const NOON = [-0.55, -0.35, -0.75];
const sun = scene.createLight({ type: 'directional', direction: NOON, color: [1, 1, 1], intensity: 128000 });
let sunHour = 12;
function setHour(hour) {
    sunHour = hour;
    const a = (hour - 12) / 24 * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
    sun.direction = [NOON[0] * c + NOON[2] * s, NOON[1], -NOON[0] * s + NOON[2] * c];
}
scene.setExposure({ mode: 'auto', meter: 'incident' });
// Water mirrors its banks: screen-space reflections out to 600 m (the
// engine weighs them by Fresnel at the angle the water is seen at and skips
// rough ground).
scene.setSSR({ enabled: true, maxDistance: 600, steps: 64, thickness: 20 });
// The planet's center moves with the camera (the scene is camera-relative):
// frame() sets it. A clear day's haze; the ground's average albedo lights
// the air from below.
const atmosphere = { planetRadius: RADIUS, turbidity: 10, groundAlbedo: [0.08, 0.1, 0.1], planetCenter: [0, -RADIUS, 0] };

// ── The tile cache ──────────────────────────────────────────────────────────

let cache = null;
// `pixelsPerTexel`: how large a detail texel may project, what the ground
// shades at; a tile's vertices are DETAIL texels apart.
function makeCache(pixelsPerTexel) {
    const pixelsPerCell = pixelsPerTexel * DETAIL;
    cache = bro.tiles.createCache({
        domain: { type: 'cubeSphere', radius: RADIUS, center: [0, 0, 0] },
        tileSize: TILE, border: BORDER, capacity: CAPACITY, maxLevel: MAX_LEVEL,
        minHeight: 0, maxHeight: MAX_HEIGHT, pixelsPerCell, producePerUpdate: PRODUCE_PER_UPDATE,
        layers: { position: 16, relief: 16, detail: DETAIL * DETAIL * 8, horizon: 16 },
        ranges: true,
        // The whole batch in six dispatches: the GPU fills up on the
        // batch's cells together, where a tile's own were a few warps.
        produce(batch) {
            const grid = [CELLS, CELLS, batch.count], pos = this.layer('position');
            kTile.dispatch(grid, batch.table, pos, this.layer('relief'), span, RADIUS, BORDER, 1 / TILE, TRUTH, SEED, rivers.net);
            kAnchor.dispatch([batch.count], batch.table, anchors, RADIUS, 1 / TILE, DETAIL, SEED);
            kHorizonHeights.dispatch([HZ_GRID, HZ_GRID, batch.count], batch.table, horizonHeights, RADIUS, 1 / TILE, SEED, rivers.net);
            kHorizon.dispatch([HZ, HZ, batch.count], batch.table, horizonHeights, this.layer('horizon'), HZ_GRID, RADIUS, BORDER, 1 / TILE);
            const texels = [TEXELS, TEXELS, batch.count];
            kDetailHeight.dispatch(texels, batch.table, texelHeights, RADIUS, BORDER, 1 / TILE, DETAIL, SEED, rivers.net);
            kDetail.dispatch(texels, batch.table, texelHeights, this.layer('detail'), RADIUS, BORDER, 1 / TILE, DETAIL, TRUTH, SEED, rivers.net);
            kRange.dispatch([batch.count], batch.table, span, this.ranges, 1 / TILE, MAX_HEIGHT);
        },
    });
    if (ground) {
        ground.setShaderTexture('pos', { buffer: cache.layer('position'), width: CELLS, height: CELLS, layers: CAPACITY, atlas: 2, channels: 4, format: 'float32' });
        ground.setShaderBuffer('relief', cache.layer('relief'));
        ground.setShaderBuffer('anchors', anchors);
        ground.setShaderBuffer('det', cache.layer('detail'));
        ground.setShaderBuffer('hz', cache.layer('horizon'));
        ground.setShaderBuffer('tiles', cache.drawList);
    }
}

// ── The drawn tiles: one instanced patch ────────────────────────────────────

// A (TILE+1)^2 vertex grid, x/z = the cell it reads, plus a skirt along the
// four edges (y = 1) that drops below the surface, out under the neighbour,
// to hide cracks between tiles.
function patchMesh() {
    const N = TILE + 1, pos = [], idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pos.push(i, 0, j);
    for (let j = 0; j < TILE; j++)
        for (let i = 0; i < TILE; i++) {
            const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
            idx.push(a, b, d, a, d, c);
        }
    const edges = [[], [], [], []];
    for (let k = 0; k < N; k++) {
        edges[0].push([k, 0]); edges[1].push([TILE, k]); edges[2].push([TILE - k, TILE]); edges[3].push([0, TILE - k]);
    }
    for (const e of edges) {
        const base = pos.length / 3;
        for (const [i, j] of e) pos.push(i, 1, j);
        for (let k = 0; k + 1 < e.length; k++) {
            const t0 = e[k][1] * N + e[k][0], t1 = e[k + 1][1] * N + e[k + 1][0];
            idx.push(t0, base + k, t1, t1, base + k, base + k + 1);
        }
    }
    const normals = new Float32Array(pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    return new Mesh({ positions: new Float32Array(pos), normals, indices: new Uint32Array(idx) });
}

// The ground's hook (ground_mesh.bk) and the layout it reads: the tiles'
// cells and texels, the ground light cache's tiles and the sea's waves.
const GROUND_LAYOUT = constants('planet::ground_layout', {
    CELLS: ['i32', CELLS], BORDER: ['i32', BORDER], TILE: ['i32', TILE], DETAIL: ['i32', DETAIL],
    TEXELS: ['i32', TEXELS], HZ: ['i32', HZ], FACE_EXTENT: ['f32', RADIUS * Math.PI / 2],
    DETAIL_PERIOD: ['f32', DETAIL_PERIOD], SWELL_PERIOD: ['f32', SWELL_PERIOD],
    SEED: ['i32', SEED],
    GL_TILE: ['i32', GROUND_LIGHT.tile], GL_BORDER: ['i32', GROUND_LIGHT.border],
    GL_ATLAS: ['i32', GROUND_LIGHT.atlas], GL_LEVELS: ['i32', GROUND_LIGHT.levels],
    WAVE_COUNT: ['i32', WAVES.list.length], WAVE_SWELL: ['i32', WAVES.swell], WAVE_FRESH: ['i32', WAVES.fresh],
    WAVE_RESIDUAL: ['f32', WAVES.residual], WAVE_FRESH_SCALE: ['f32', WAVES.freshScale],
    // Each wave's vector (radians a metre) and the footprint it fades out
    // at; its frequency, the slopes' variance from it on, its slope
    // amplitude over k and its own variance.
    WAVE_K: ['vec4<f32>', WAVES.list.map((w) => [...w.n.map((c) => c * 2 * Math.PI / w.period), Math.PI / 2 / w.k])],
    WAVE_F: ['vec4<f32>', WAVES.list.map((w) => [w.omega, w.tail, w.slope / w.k, w.slope * w.slope / 2])],
});

let ground = null;
ground = scene.createInstancedMesh({
    mesh: patchMesh(), color: [1, 1, 1],
    castsShadow: false, receivesShadow: false, doubleSided: true,
    module: readApp('ground_mesh.bk'), file: 'ground_mesh.bk',
    modules: { tiles: bro.tiles.module, 'planet::ground_layout': GROUND_LAYOUT, 'planet::relief': MODULES['planet::relief'],
               ...treeModules, ...grassModules },
});
ground.cullMargin = 4 * RADIUS;   // the shader places tiles; the cache culls them
makeCache(Number(document.querySelector('#detail').value));
const cloudMod = bro.kernel.compile(readApp('clouds.bk'), { file: 'clouds.bk', modules: MODULES });
const sunMod = bro.kernel.compile(readApp('sun.bk'), { file: 'sun.bk', modules: MODULES });
const grassMod = bro.kernel.compile(readApp('grass.bk'), { file: 'grass.bk', modules: MODULES });
const grass = createGrass(scene, RADIUS, grassMod, sunMod, TRUTH, SEED, rivers.net, [ground]);
const treeMod = bro.kernel.compile(readApp('trees.bk'), { file: 'trees.bk', modules: MODULES });
const trees = createTrees(scene, RADIUS, treeMod, sunMod, TRUTH, SEED, rivers.net, [ground]);
const clouds = createClouds(scene, RADIUS, cloudMod, [ground], SEED,
                            { source: readApp('clouds_volume.bk'), modules: MODULES }, MAX_HEIGHT);

// ── Camera: doubles about the planet's center ───────────────────────────────

const cam = { lat: 0.45, lon: 0.3, alt: 1.8e7, heading: 0, pitch: -90 };
const FOV = 55;
const v3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
const groundHeight = (dir) => kHeight.run(1, dir[0], dir[1], dir[2], RADIUS, 18, SEED, rivers.cpu)[0];

function cameraFrame() {
    const up = [Math.cos(cam.lat) * Math.sin(cam.lon), Math.sin(cam.lat), Math.cos(cam.lat) * Math.cos(cam.lon)];
    const east = v3.norm(v3.cross([0, 1, 0], up));
    const north = v3.cross(up, east);
    const hd = cam.heading * Math.PI / 180, pt = cam.pitch * Math.PI / 180;
    const level = v3.add(v3.scale(north, Math.cos(hd)), v3.scale(east, Math.sin(hd)));
    const right = v3.sub(v3.scale(east, Math.cos(hd)), v3.scale(north, Math.sin(hd)));
    const fwd = v3.add(v3.scale(level, Math.cos(pt)), v3.scale(up, Math.sin(pt)));
    const camUp = v3.cross(right, fwd);
    // The altitude is over the ground, or over the sea where the ground is below it.
    const surface = RADIUS + Math.max(groundHeight(up), 0);
    return { up, east, north, fwd, camUp, right, pos: v3.scale(up, surface + cam.alt), surface };
}

// ── Per frame ───────────────────────────────────────────────────────────────

const camHi = [0, 0, 0], camLo = [0, 0, 0];
const lastStats = { selected: 0, visible: 0 };
let lastView = null;

function frame() {
    const f = cameraFrame();
    // The scene renders at the canvas's layout size (not its width/height
    // attributes), in device pixels: what a tile's cells project onto.
    const height = (canvas.clientHeight || 1080) * devicePixelRatio;
    const aspect = (canvas.clientWidth || 1920) * devicePixelRatio / height;
    const near = Math.min(1e5, Math.max(0.2, cam.alt * 0.05));
    const horizon = Math.sqrt(Math.max(0, (f.surface + cam.alt) ** 2 - RADIUS * RADIUS)) + 2e5;
    scene.setCamera({ eye: [0, 0, 0], target: f.fwd, up: f.camUp, fov: FOV, near, far: horizon + 1e5 });

    // The cache culls to the frustum and the horizon: what it draws is seen.
    lastView = { position: f.pos, forward: f.fwd, up: f.camUp, fov: FOV,
                 viewportWidth: height * aspect, viewportHeight: height };
    cache.update(lastView);

    // The draw list on the GPU is what the shader reads: one instance per
    // record, and the camera split hi + lo as the records' centers are.
    const n = cache.drawCount;
    if (n !== ground.instanceCount) ground.setInstanceCount(n);
    for (let k = 0; k < 3; k++) {
        camHi[k] = Math.fround(f.pos[k]);
        camLo[k] = f.pos[k] - camHi[k];
    }
    ground.setShaderUniform('cam_hi', camHi);
    ground.setShaderUniform('cam_lo', camLo);
    ground.setShaderUniform('time', performance.now() / 1000 % WAVE_CLOCK);
    ground.setShaderUniform('trees_far', trees.far);
    const d = sun.direction, dl = Math.hypot(d[0], d[1], d[2]);
    clouds.update(f.pos, f.surface + cam.alt - RADIUS, [-d[0] / dl, -d[1] / dl, -d[2] / dl], lastView);
    const cone = Math.atan(Math.tan(FOV * Math.PI / 360) * Math.hypot(1, aspect));
    ground.setShaderUniform('to_sun', [-d[0] / dl, -d[1] / dl, -d[2] / dl]);
    grass.update(f.pos, cam.alt, [-d[0] / dl, -d[1] / dl, -d[2] / dl], camHi, camLo, f.fwd, cone, performance.now() / 1000 % WAVE_CLOCK);
    trees.update(f.pos, cam.alt, [-d[0] / dl, -d[1] / dl, -d[2] / dl], camHi, camLo, f.fwd, cone, performance.now() / 1000 % WAVE_CLOCK);
    for (let k = 0; k < 3; k++) atmosphere.planetCenter[k] = -f.pos[k];
    scene.setAtmosphere(atmosphere);
    lastStats.selected = cache.wanted;
    lastStats.visible = n;
    // Text changes cost the page a layout and raster: a few times a second,
    // or every 60 frames where the frame clock barely moves (headless frames
    // run as fast as they render). (performance.now() is the frame clock: it
    // moves between frames.)
    const now = performance.now();
    if (now - lastPaint > 250 || ++framesSincePaint >= 60) {
        lastPaint = now;
        framesSincePaint = 0;
        paintStats();
    }
}
let lastPaint = -1e9, framesSincePaint = 0;

// ── Controls ────────────────────────────────────────────────────────────────

const altCtl = bindControl('#alt', {
    out: '#altVal', map: logMap(2, 3e7),
    fmt: (v) => v >= 1000 ? (v / 1000).toFixed(v >= 1e5 ? 0 : 1) + ' km' : v.toFixed(0) + ' m',
    onChange: (v) => { cam.alt = v; },
});
altCtl.value = cam.alt;
const pitchCtl = bindControl('#pitch', { out: '#pitchVal', fmt: (v) => v.toFixed(0) + '°', onChange: (v) => { cam.pitch = v; } });
bindControl('#detail', { out: '#detailVal', fmt: (v) => v.toFixed(1) + ' px/texel', onChange: (v) => makeCache(v) });
const sunCtl = bindControl('#sun', { out: '#sunVal', fmt: (v) => String(Math.floor(v)).padStart(2, '0') + ':' + String(Math.floor(v % 1 * 60)).padStart(2, '0'), onChange: (v) => setHour(v) });

// The stats, and the controls the camera moves without them (the wheel, a
// right-drag, a script).
function paintStats() {
    if (altCtl.value !== cam.alt) altCtl.value = cam.alt;
    if (pitchCtl.value !== cam.pitch) pitchCtl.value = cam.pitch;
    if (sunCtl.value !== sunHour) sunCtl.value = sunHour;
    const s = cache.stats;
    document.querySelector('#stats').textContent =
        `tiles  ${lastStats.visible} drawn / ${lastStats.selected} selected\n` +
        `cache  ${cache.resident} resident, ${cache.pending} pending\n` +
        `       ${s.produced} produced, ${s.evicted} evicted`;
}

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, button: e.button };
    canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.button === 2) {
        cam.heading = (cam.heading + dx * 0.2) % 360;
        cam.pitch = Math.max(-90, Math.min(0, cam.pitch - dy * 0.2));
        return;
    }
    // Move the ground point under the cursor with it: metres per pixel at
    // the camera's altitude, turned into an angle across the sphere.
    const mpp = 2 * cam.alt * Math.tan(FOV * Math.PI / 360) / (canvas.clientHeight || 1080);
    const hd = cam.heading * Math.PI / 180;
    const north = (dy * Math.cos(hd) + dx * Math.sin(hd)) * mpp, east = (dy * Math.sin(hd) * -1 + dx * Math.cos(hd)) * -mpp;
    cam.lat = Math.max(-1.55, Math.min(1.55, cam.lat + north / RADIUS));
    cam.lon += east / (RADIUS * Math.max(0.05, Math.cos(cam.lat)));
});
canvas.addEventListener('wheel', (e) => {
    cam.alt = Math.max(2, Math.min(3e7, cam.alt * Math.pow(1.0015, e.deltaY)));
    altCtl.value = cam.alt;
    e.preventDefault();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function loop() {
    frame();
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// For tests and tools.
globalThis.planet = { cam, setHour, ground, get cache() { return cache; }, clouds, grass, trees, rivers, groundHeight, get stats() { return lastStats; }, get lastView() { return lastView; }, frame };
