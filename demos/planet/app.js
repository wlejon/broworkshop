// Planet: an Earth-radius world drawn from a bro.tiles cube-sphere cache.
//
// The ground is one height function (ground.bk) evaluated per tile on the
// GPU in f64. Each tile's cells are written relative to the tile's center,
// and every tile is drawn camera-relative: the scene's camera sits at the
// origin and each tile instance is placed at (tile center - camera), both in
// doubles on the CPU, so nothing ever holds a planet-sized f32.
import { boot } from "/lib/kit/app.js";
import { bindControl, logMap } from "/lib/kit/params.js";

boot();

const fs = require('fs');
const RADIUS = 6371000;
const TILE = 32;            // cells along a tile's drawn edge
const BORDER = 2;           // cells beyond it, for the vertex shader's normals
const CELLS = TILE + 2 * BORDER;
const CAPACITY = 4096;
const SEED = 7;
const BASE_WAVELENGTH = 2400000;   // ground.bk's first octave

const readApp = (path) => fs.readFileSync(bro.resolvePath('/app/' + path), 'utf-8');
const mod = bro.kernel.compile(readApp('planet.bk'), { file: 'planet.bk', modules: { 'planet::ground': readApp('ground.bk') } });
const kTile = mod.kernel('k_tile');
const kHeight = mod.kernel('k_height');
const kRange = mod.kernel('k_range');
const kColor = mod.kernel('k_color');

// The octaves a tile's cells can carry: down to a wavelength of 2.5 cells.
const octavesFor = (extent) => Math.min(30, Math.max(1, Math.log2(BASE_WAVELENGTH / (2.5 * extent / TILE))));
const MAX_LEVEL = 22;
// The finest octaves anything draws: a colour is the mean over them.
const TRUTH = octavesFor(RADIUS * Math.PI / 2 / 2 ** MAX_LEVEL);

// What the octaves finer than a tile's can still add to its surface, in
// metres, from ground.bk's amplitudes: the detail fbm (octave 4 up, 250 + 900
// at most), the ridges (octaves 2 to 11, 6500 at most), counted from the last
// octave the tile resolves (a peak between its cells), with a quarter more
// for simplex's reach past 1. Below the continents' octaves it is everything.
const MAX_HEIGHT = 9000;
function rangeMargin(octaves) {
    const k = Math.floor(octaves) - 1;
    if (k < 4) return MAX_HEIGHT;
    let m = 1150 * 2 * Math.pow(0.5, k - 4);
    for (let o = Math.max(k, 2); o < 12; o++) m += 6500 * Math.pow(0.5, o - 1);
    return m * 1.25;
}

const canvas = document.querySelector('#stage');
const scene = canvas.getContext('scene');
scene.setToneMap({ mode: 'aces' });
scene.setAmbient([0.025, 0.03, 0.04]);
scene.createLight({ type: 'directional', direction: [-0.55, -0.35, -0.75], color: [1, 0.97, 0.9], intensity: 3.2 });

// ── The tile cache ──────────────────────────────────────────────────────────

let cache = null;
function makeCache(pixelsPerCell) {
    cache = bro.tiles.createCache({
        domain: { type: 'cubeSphere', radius: RADIUS, center: [0, 0, 0] },
        tileSize: TILE, border: BORDER, capacity: CAPACITY, maxLevel: MAX_LEVEL,
        minHeight: 0, maxHeight: MAX_HEIGHT, pixelsPerCell, producePerUpdate: 24,
        layers: { position: 16, color: 16 },
        ranges: true,
        produce(tile) {
            const f = tile.frame, c = tile.center, octaves = octavesFor(tile.extent);
            const frame = [f.corner[0], f.corner[1], f.corner[2], f.u[0], f.u[1], f.u[2], f.v[0], f.v[1], f.v[2],
                           c[0], c[1], c[2], RADIUS, BORDER, 1 / TILE];
            kTile.dispatch([tile.cells, tile.cells], tile.layers.position, ...frame, octaves, SEED);
            kColor.dispatch([tile.cells, tile.cells], tile.layers.position, tile.layers.color, ...frame,
                            octaves, TRUTH, SEED, tile.cells);
            kRange.dispatch([1], tile.layers.position, tile.range, tile.cells * tile.cells, rangeMargin(octaves), MAX_HEIGHT);
        },
    });
    if (ground) {
        ground.setShaderBuffer('u_pos', cache.layer('position'));
        ground.setShaderBuffer('u_col', cache.layer('color'));
        ground.setShaderBuffer('u_tiles', cache.drawList);
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

// Instance i draws the cache's draw-list record i (tiles-api.js): its slot,
// level, and center as hi + lo floats, from which the camera (split the same
// way) is subtracted for a camera-relative placement good to f64.
const vertex = `buffer vec4 u_pos[];
    buffer vec4 u_col[];
    buffer ivec4 u_tiles[];
    uniform vec3 u_camHi;
    uniform vec3 u_camLo;
    out vec4 v_col;
    out vec3 v_up;
    void userVertex(inout vec3 pos, inout vec3 normal, inout vec2 uv) {
        ivec4 ids = u_tiles[gl_InstanceIndex * 4];   // slot, parentSlot, root, level
        vec4 hi = intBitsToFloat(u_tiles[gl_InstanceIndex * 4 + 2]);
        vec4 lo = intBitsToFloat(u_tiles[gl_InstanceIndex * 4 + 3]);
        const int C = ${CELLS}, B = ${BORDER};
        int i = int(pos.x + 0.5), j = int(pos.z + 0.5);
        int k = ids.x * C * C + (j + B) * C + (i + B);
        vec4 c = u_pos[k];
        vec3 du = u_pos[k + 1].xyz - u_pos[k - 1].xyz;
        vec3 dv = u_pos[k + C].xyz - u_pos[k - C].xyz;
        normal = normalize(cross(du, dv));
        // A skirt's bottom sits under the border cell beyond the edge, so the
        // skirts of neighbouring tiles cross beneath their seam instead of
        // sharing a plane: f32 rounding differs tile to tile, and coplanar
        // skirts leave pinholes along the seam and at corners.
        if (pos.y > 0.5) {
            int si = i == 0 ? -1 : (i == ${TILE} ? 1 : 0);
            int sj = j == 0 ? -1 : (j == ${TILE} ? 1 : 0);
            c.xyz = u_pos[k + sj * C + si].xyz;
        }
        // Up at this vertex: away from the planet's center at the origin.
        vec3 up = normalize(c.xyz + hi.xyz);
        // Skirts hang a sixteenth of the tile's edge below the surface.
        float extent = ${RADIUS * Math.PI / 2} / float(1 << ids.w);
        vec3 rel = (hi.xyz - u_camHi) + (lo.xyz - u_camLo);
        pos = rel + c.xyz - up * (pos.y * extent * 0.0625);
        v_col = u_col[k];
        v_up = up;
    }`;

// The colour layer (planet.bk k_color) is the mean of the ground under each
// cell: albedo, and how much of it is water.
const fragment = `in vec4 v_col;
    in vec3 v_up;
    void userFragment(inout vec3 baseColor, inout vec3 normal,
                      inout float metallic, inout float roughness,
                      inout vec3 emissive, inout float alpha) {
        float water = clamp(v_col.a, 0.0, 1.0);
        baseColor = v_col.rgb;
        // A skirt filling a crack is seen from either side, and its back face
        // gets the flipped normal: the ground never faces down, so shade the
        // side facing up.
        vec3 n = normalize(normal);
        if (dot(n, v_up) < 0.0) n = -n;
        normal = normalize(mix(n, normalize(v_up), water));
        roughness = mix(0.9, 0.12, water);
        metallic = 0.0;    }`;

let ground = null;
ground = scene.createInstancedMesh({ mesh: patchMesh(), color: [1, 1, 1], castsShadow: false, receivesShadow: false, doubleSided: true });
ground.setShader({ vertex, fragment });
ground.cullMargin = 4 * RADIUS;   // the shader places tiles; the cache culls them
makeCache(2);

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
const groundHeight = (dir) => kHeight.eval(dir[0], dir[1], dir[2], RADIUS, 18, SEED);

function cameraFrame() {
    const up = [Math.cos(cam.lat) * Math.sin(cam.lon), Math.sin(cam.lat), Math.cos(cam.lat) * Math.cos(cam.lon)];
    const east = v3.norm(v3.cross([0, 1, 0], up));
    const north = v3.cross(up, east);
    const hd = cam.heading * Math.PI / 180, pt = cam.pitch * Math.PI / 180;
    const level = v3.add(v3.scale(north, Math.cos(hd)), v3.scale(east, Math.sin(hd)));
    const right = v3.sub(v3.scale(east, Math.cos(hd)), v3.scale(north, Math.sin(hd)));
    const fwd = v3.add(v3.scale(level, Math.cos(pt)), v3.scale(up, Math.sin(pt)));
    const camUp = v3.cross(right, fwd);
    const surface = RADIUS + groundHeight(up);
    return { up, east, north, fwd, camUp, right, pos: v3.scale(up, surface + cam.alt), surface };
}

// ── Per frame ───────────────────────────────────────────────────────────────

const camHi = [0, 0, 0], camLo = [0, 0, 0];
let lastStats = { drawn: 0, visible: 0, ms: 0 };
let lastView = null;

function frame() {
    const t0 = performance.now();
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
    ground.setShaderUniform('u_camHi', camHi);
    ground.setShaderUniform('u_camLo', camLo);
    lastStats = { selected: cache.wanted, visible: n, ms: performance.now() - t0 };
    // Text changes cost the page a layout and raster: a few times a second.
    if (t0 - lastPaint > 250) {
        lastPaint = t0;
        paintStats();
    }
}
let lastPaint = -1e9;

// ── Controls ────────────────────────────────────────────────────────────────

const altCtl = bindControl('#alt', {
    out: '#altVal', map: logMap(2, 3e7),
    fmt: (v) => v >= 1000 ? (v / 1000).toFixed(v >= 1e5 ? 0 : 1) + ' km' : v.toFixed(0) + ' m',
    onChange: (v) => { cam.alt = v; },
});
altCtl.value = cam.alt;
bindControl('#pitch', { out: '#pitchVal', fmt: (v) => v.toFixed(0) + '°', onChange: (v) => { cam.pitch = v; } });
bindControl('#detail', { out: '#detailVal', fmt: (v) => v.toFixed(1) + ' px/cell', onChange: (v) => makeCache(v) });

function paintStats() {
    const s = cache.stats;
    document.querySelector('#stats').textContent =
        `tiles  ${lastStats.visible} drawn / ${lastStats.selected} selected\n` +
        `cache  ${cache.resident} resident, ${cache.pending} pending\n` +
        `       ${s.produced} produced, ${s.evicted} evicted\n` +
        `cpu    ${lastStats.ms.toFixed(2)} ms`;
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
globalThis.planet = { cam, get cache() { return cache; }, get stats() { return lastStats; }, get lastView() { return lastView; }, frame };
