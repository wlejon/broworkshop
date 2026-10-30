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
const DETAIL_PERIOD = 64;          // metres; the ground shader's fine detail repeats over it

const readApp = (path) => fs.readFileSync(bro.resolvePath('/app/' + path), 'utf-8');
const mod = bro.kernel.compile(readApp('planet.bk'), { file: 'planet.bk', modules: { 'planet::ground': readApp('ground.bk') } });
const kTile = mod.kernel('k_tile');
const kHeight = mod.kernel('k_height');
const kRange = mod.kernel('k_range');
const kColor = mod.kernel('k_color');

// The octaves a tile's cells can carry: down to a wavelength of 2.5 cells
// (the tile kernels take theirs from ground.bk octaves_for, the same).
const octavesFor = (extent) => Math.min(30, Math.max(1, Math.log2(BASE_WAVELENGTH / (2.5 * extent / TILE))));
const MAX_LEVEL = 22;
// The finest octaves anything draws: a colour is the mean over them.
const TRUTH = octavesFor(RADIUS * Math.PI / 2 / 2 ** MAX_LEVEL);

const MAX_HEIGHT = 9000;
const PRODUCE_PER_UPDATE = 24;
// k_tile's per-tile height gather for k_range (planet.bk), zeroed between
// batches by k_range itself.
const span = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * 2 * 4);
span.write(new Int32Array(PRODUCE_PER_UPDATE * 2));

const canvas = document.querySelector('#stage');
const scene = canvas.getContext('scene');
scene.setToneMap({ mode: 'aces' });
// The sun above the air, in lux; the atmosphere dims and reddens it, lights
// the sky and the haze, and the exposure meters the light at the eye.
scene.createLight({ type: 'directional', direction: [-0.55, -0.35, -0.75], color: [1, 1, 1], intensity: 128000 });
scene.setExposure({ mode: 'auto', meter: 'incident' });
// The planet's center moves with the camera (the scene is camera-relative):
// frame() sets it. A clear day's haze; the ground's average albedo lights
// the air from below.
const atmosphere = { planetRadius: RADIUS, turbidity: 10, groundAlbedo: [0.08, 0.1, 0.1], planetCenter: [0, -RADIUS, 0] };

// ── The tile cache ──────────────────────────────────────────────────────────

let cache = null;
function makeCache(pixelsPerCell) {
    cache = bro.tiles.createCache({
        domain: { type: 'cubeSphere', radius: RADIUS, center: [0, 0, 0] },
        tileSize: TILE, border: BORDER, capacity: CAPACITY, maxLevel: MAX_LEVEL,
        minHeight: 0, maxHeight: MAX_HEIGHT, pixelsPerCell, producePerUpdate: PRODUCE_PER_UPDATE,
        layers: { position: 16, color: 16 },
        ranges: true,
        // The whole batch in three dispatches: the GPU fills up on the
        // batch's cells together, where a tile's own were a few warps.
        produce(batch) {
            const grid = [CELLS, CELLS, batch.count], pos = this.layer('position');
            kTile.dispatch(grid, batch.table, pos, span, RADIUS, BORDER, 1 / TILE, SEED);
            kColor.dispatch(grid, batch.table, pos, this.layer('color'), RADIUS, BORDER, 1 / TILE, TRUTH, SEED, CELLS);
            kRange.dispatch([batch.count], batch.table, span, this.ranges, 1 / TILE, MAX_HEIGHT);
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
    out vec3 v_q;
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
        // The ground's fine detail is periodic over ${DETAIL_PERIOD} m: the tile's
        // center modulo that (exact in f32, the period a power of two) plus
        // the cell's offset from it is a coordinate good to micrometres near
        // the camera, and the same modulo the period on every tile.
        v_q = mod(hi.xyz, ${DETAIL_PERIOD}.0) + mod(lo.xyz, ${DETAIL_PERIOD}.0) + c.xyz;
    }`;

// The colour layer (planet.bk k_color) is the mean of the ground under each
// cell: albedo, and how much of it is water. Per pixel, the land carries on
// past the finest tile's cells: octaves of wavelength 1/8 m down to 2 mm, of
// albedo variation (ground.bk variation, the same contrast per octave) and of
// relief (the same slope per octave), each faded out as its wavelength nears
// a pixel. Both are zero-mean, so what a pixel averages to is the cell's.
const fragment = `in vec4 v_col;
    in vec3 v_up;
    in vec3 v_q;
    const float VARY_LUM = 0.11;      // ground.bk VARY_LUM
    const float PERLIN_VAR = 0.0728;  // ground.bk PERLIN_VAR
    const float RELIEF = 0.08;        // slope per octave, per unit of the noise's gradient

    // One of the 12 cube-edge gradients at lattice point c, the lattice
    // periodic over \`cells\` (a power of two).
    vec3 latticeGradient(ivec3 c, int cells, int seed) {
        uvec3 p = uvec3(c & (cells - 1));
        uint h = (p.x * 0x8da6b343u ^ p.y * 0xd8163841u ^ p.z * 0xcb1ab31fu ^ uint(seed)) * 0x27d4eb2du;
        h ^= h >> 15;
        uint e = h % 12u;
        float s1 = (e & 1u) != 0u ? -1.0 : 1.0, s2 = (e & 2u) != 0u ? -1.0 : 1.0;
        uint axis = e >> 2;
        return axis == 0u ? vec3(0.0, s1, s2) : (axis == 1u ? vec3(s1, 0.0, s2) : vec3(s1, s2, 0.0));
    }

    // Perlin noise at x (lattice units) and its gradient: x value, yzw gradient.
    vec4 perlinGrad(vec3 x, int cells, int seed) {
        ivec3 i = ivec3(floor(x));
        vec3 f = fract(x);
        vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
        vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
        vec3 ga = latticeGradient(i, cells, seed), gb = latticeGradient(i + ivec3(1, 0, 0), cells, seed);
        vec3 gc = latticeGradient(i + ivec3(0, 1, 0), cells, seed), gd = latticeGradient(i + ivec3(1, 1, 0), cells, seed);
        vec3 ge = latticeGradient(i + ivec3(0, 0, 1), cells, seed), gf = latticeGradient(i + ivec3(1, 0, 1), cells, seed);
        vec3 gg = latticeGradient(i + ivec3(0, 1, 1), cells, seed), gh = latticeGradient(i + ivec3(1, 1, 1), cells, seed);
        float va = dot(ga, f), vb = dot(gb, f - vec3(1, 0, 0)), vc = dot(gc, f - vec3(0, 1, 0)), vd = dot(gd, f - vec3(1, 1, 0));
        float ve = dot(ge, f - vec3(0, 0, 1)), vf = dot(gf, f - vec3(1, 0, 1)), vg = dot(gg, f - vec3(0, 1, 1)), vh = dot(gh, f - vec3(1, 1, 1));
        float k1 = vb - va, k2 = vc - va, k3 = ve - va, k4 = va - vb - vc + vd;
        float k5 = va - vc - ve + vg, k6 = va - vb - ve + vf, k7 = -va + vb + vc - vd + ve - vf - vg + vh;
        float value = va + u.x * k1 + u.y * k2 + u.z * k3 + u.x * u.y * k4 + u.y * u.z * k5 + u.z * u.x * k6 + u.x * u.y * u.z * k7;
        vec3 grad = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga)
                  + u.x * u.y * (ga - gb - gc + gd) + u.y * u.z * (ga - gc - ge + gg) + u.z * u.x * (ga - gb - ge + gf)
                  + u.x * u.y * u.z * (-ga + gb + gc - gd + ge - gf - gg + gh)
                  + du * (vec3(k1, k2, k3) + u.yzx * vec3(k4, k5, k6) + u.zxy * vec3(k6, k4, k5) + u.yzx * u.zxy * k7);
        return vec4(value, grad);
    }

    void userFragment(inout vec3 baseColor, inout vec3 normal,
                      inout float metallic, inout float roughness,
                      inout vec3 emissive, inout float alpha) {
        float water = clamp(v_col.a, 0.0, 1.0);
        // A skirt filling a crack is seen from either side, and its back face
        // gets the flipped normal: the ground never faces down, so shade the
        // side facing up.
        vec3 n = normalize(normal);
        if (dot(n, v_up) < 0.0) n = -n;

        // The octaves a pixel resolves: full weight from 4 pixels a
        // wavelength, none at 2.
        float footprint = max(length(dFdx(v_q)), length(dFdy(v_q)));
        float lum = 0.0, lumVar = 0.0, wavelength = 0.125;
        vec3 slope = vec3(0.0);
        int cells = int(${DETAIL_PERIOD}.0 / wavelength);
        for (int k = 0; k < 6; k++) {
            float w = clamp(wavelength / footprint * 0.5 - 1.0, 0.0, 1.0);
            if (w <= 0.0) break;
            vec3 x = v_q / wavelength;
            // One noise for both: the relief's crests are the lighter ground.
            vec4 g = perlinGrad(x, cells, 11 + k);
            float a = VARY_LUM * w;
            lum += g.x * a;
            lumVar += a * a * PERLIN_VAR;
            slope += g.yzw * (RELIEF * w);
            wavelength *= 0.5;
            cells *= 2;
        }
        float land = 1.0 - water;
        baseColor = v_col.rgb * mix(1.0, exp(lum - 0.5 * lumVar), land);
        // The relief's gradient along the surface tilts the normal against it.
        n = normalize(n - (slope - dot(slope, n) * n) * land);
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
    for (let k = 0; k < 3; k++) atmosphere.planetCenter[k] = -f.pos[k];
    scene.setAtmosphere(atmosphere);
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
