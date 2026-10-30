// Planet: an Earth-radius world drawn from a bro.tiles cube-sphere cache.
//
// The ground is one height function (planet.bk) evaluated per tile on the
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
const BASE_WAVELENGTH = 2400000;   // planet.bk's first octave

const mod = bro.kernel.compile(fs.readFileSync(bro.resolvePath('/app/planet.bk'), 'utf-8'), { file: 'planet.bk' });
const kTile = mod.kernel('k_tile');
const kHeight = mod.kernel('k_height');

// The octaves a tile's cells can carry: down to a wavelength of 2.5 cells.
const octavesFor = (extent) => Math.min(30, Math.max(1, Math.log2(BASE_WAVELENGTH / (2.5 * extent / TILE))));

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
        tileSize: TILE, border: BORDER, capacity: CAPACITY, maxLevel: 22,
        maxHeight: 9000, pixelsPerCell, producePerUpdate: 24,
        layers: { position: 16 },
        produce(tile) {
            const f = tile.frame, c = tile.center;
            kTile.dispatch([tile.cells, tile.cells], tile.layers.position,
                f.corner[0], f.corner[1], f.corner[2], f.u[0], f.u[1], f.u[2], f.v[0], f.v[1], f.v[2],
                c[0], c[1], c[2], RADIUS, BORDER, 1 / TILE, octavesFor(tile.extent), SEED);
        },
    });
    if (ground) ground.setShaderBuffer('u_pos', cache.layer('position'));
}

// ── The drawn tiles: one instanced patch ────────────────────────────────────

// A (TILE+1)^2 vertex grid, x/z = the cell it reads, plus a skirt along the
// four edges (y = 1) that drops below the surface to hide cracks between
// tiles of different levels.
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

const vertex = `buffer vec4 u_pos[];
    buffer vec4 u_inst[];
    out float v_h;
    out vec3 v_up;
    void userVertex(inout vec3 pos, inout vec3 normal, inout vec2 uv) {
        vec4 inst0 = u_inst[gl_InstanceIndex * 2];
        vec4 inst1 = u_inst[gl_InstanceIndex * 2 + 1];
        const int C = ${CELLS}, B = ${BORDER};
        int i = int(pos.x + 0.5), j = int(pos.z + 0.5);
        int k = int(inst0.x) * C * C + (j + B) * C + (i + B);
        vec4 c = u_pos[k];
        vec3 du = u_pos[k + 1].xyz - u_pos[k - 1].xyz;
        vec3 dv = u_pos[k + C].xyz - u_pos[k - C].xyz;
        normal = normalize(cross(du, dv));
        // Up at this vertex: from the planet's center, which sits at
        // -up * dist from the tile's center.
        vec3 up = normalize(c.xyz + inst1.xyz * inst1.w);
        // Skirts hang a sixteenth of the tile below the surface.
        pos = c.xyz - up * (pos.y * inst0.y * 0.0625);
        v_h = c.w;
        v_up = up;
    }`;

const fragment = `in float v_h;
    in vec3 v_up;
    void userFragment(inout vec3 baseColor, inout vec3 normal,
                      inout float metallic, inout float roughness,
                      inout vec3 emissive, inout float alpha) {
        float slope = 1.0 - clamp(dot(normalize(normal), normalize(v_up)), 0.0, 1.0);
        if (v_h <= 0.0) {
            float depth = clamp(-v_h / 2500.0, 0.0, 1.0);
            baseColor = mix(vec3(0.03, 0.16, 0.22), vec3(0.005, 0.03, 0.09), depth);
            normal = normalize(v_up);
            roughness = 0.12;
        } else {
            vec3 sand = vec3(0.62, 0.56, 0.42), grass = vec3(0.16, 0.27, 0.08), forest = vec3(0.06, 0.13, 0.05);
            vec3 rock = vec3(0.30, 0.27, 0.24), snow = vec3(0.92, 0.94, 0.97);
            vec3 c = mix(sand, grass, smoothstep(5.0, 40.0, v_h));
            c = mix(c, forest, smoothstep(150.0, 600.0, v_h) * (1.0 - smoothstep(1900.0, 2700.0, v_h)));
            c = mix(c, rock, max(smoothstep(0.22, 0.45, slope), smoothstep(2600.0, 3400.0, v_h)));
            c = mix(c, snow, smoothstep(4300.0, 4900.0, v_h) * (1.0 - smoothstep(0.4, 0.65, slope)));
            baseColor = c;
            roughness = 0.9;
        }
        metallic = 0.0;
    }`;

let ground = null;
ground = scene.createInstancedMesh({ mesh: patchMesh(), color: [1, 1, 1], castsShadow: false, receivesShadow: false, doubleSided: true });
ground.setShader({ vertex, fragment });
ground.cullMargin = 4 * RADIUS;   // tiles are placed by the shader; the CPU culls them below
const instBuf = bro.kernel.createBuffer(CAPACITY * 8 * 4);
ground.setShaderBuffer('u_inst', instBuf);
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

const inst = new Float32Array(CAPACITY * 16);
const instData = new Float32Array(CAPACITY * 8);
let lastStats = { drawn: 0, visible: 0, ms: 0 };

function frame() {
    const t0 = performance.now();
    const f = cameraFrame();
    const height = canvas.height || 1080;
    const aspect = (canvas.width || 1920) / height;
    const near = Math.min(1e5, Math.max(0.2, cam.alt * 0.05));
    const horizon = Math.sqrt(Math.max(0, (f.surface + cam.alt) ** 2 - RADIUS * RADIUS)) + 2e5;
    scene.setCamera({ eye: [0, 0, 0], target: f.fwd, up: f.camUp, fov: FOV, near, far: horizon + 1e5 });

    // The cache culls to the frustum and the horizon: what it draws is seen.
    cache.update({ position: f.pos, forward: f.fwd, up: f.camUp, fov: FOV,
                   viewportWidth: height * aspect, viewportHeight: height });

    const drawn = cache.drawn;
    let n = 0;
    for (const t of drawn) {
        if (n === CAPACITY) break;
        const rel = v3.sub(t.center, f.pos);
        const o = n * 16;
        inst[o] = 1; inst[o + 1] = 0; inst[o + 2] = 0; inst[o + 3] = rel[0];
        inst[o + 4] = 0; inst[o + 5] = 1; inst[o + 6] = 0; inst[o + 7] = rel[1];
        inst[o + 8] = 0; inst[o + 9] = 0; inst[o + 10] = 1; inst[o + 11] = rel[2];
        inst[o + 12] = 1; inst[o + 13] = 1; inst[o + 14] = 1; inst[o + 15] = 1;
        const dist = Math.hypot(t.center[0], t.center[1], t.center[2]);
        const extent = RADIUS * Math.PI / 2 / (1 << t.level);
        const p = n * 8;
        instData[p] = t.slot; instData[p + 1] = extent; instData[p + 2] = t.level; instData[p + 3] = 0;
        instData[p + 4] = t.center[0] / dist; instData[p + 5] = t.center[1] / dist; instData[p + 6] = t.center[2] / dist;
        instData[p + 7] = dist;
        n++;
    }
    if (n) instBuf.write(instData.subarray(0, n * 8));
    ground.setInstances(inst.subarray(0, n * 16));
    lastStats = { selected: cache.wanted, visible: n, ms: performance.now() - t0 };
    paintStats();
}

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
    const mpp = 2 * cam.alt * Math.tan(FOV * Math.PI / 360) / (canvas.height || 1080);
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
globalThis.planet = { cam, get cache() { return cache; }, get stats() { return lastStats; }, frame };
