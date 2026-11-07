// The planet's core: a rocky world drawn from a bro.tiles cube-sphere cache,
// whatever the world (core/world.js says what one provides).
//
// The ground is the world's height function evaluated per tile on the GPU
// in f32: each tile's noise lattices are found on the CPU in f64 at the
// tile's anchor (core/anchor.bk, core/tiles.bk k_anchors), and a cell is an
// f32 offset from it. Each tile's cells are written relative to the tile's
// center, and every tile is drawn camera-relative: the scene's camera sits
// at the origin and each tile instance is placed at (tile center - camera),
// both in doubles on the CPU, so nothing ever holds a planet-sized f32.
//
// The core owns the tile cache and its production (the world fills its
// layers, core/layers.bk, then the core's kernels make the horizons, the
// ranges and the split errors), the anchors, the ground's hook
// (core/ground_mesh.bk) with its horizons and light, the sun and the hour,
// the camera, the frame loop and stats, hot reload, and the view ladder's
// hookup (core/views.js). The world owns its radius, ground, colour, air
// and systems.
import { bindControl, logMap } from "/lib/kit/params.js";
import { createAnchors, setAnchorWords } from "/app/core/anchors.js";
import { constants, readApp, sourcePath, moduleName } from "/app/core/shaders.js";
import { sunDirection, setNoon } from "/app/core/hour.js";
import { checkWorld, WORLD_PARTS } from "/app/core/world.js";

const TILE = 32;            // cells along a tile's drawn edge
const BORDER = 2;           // cells beyond it: the skirts' bottoms, and the detail layer's gradients at the edge
const CELLS = TILE + 2 * BORDER;
const DETAIL = 4;           // detail texels along a cell's edge (core/layers.bk's detail layer)
const TEXELS = CELLS * DETAIL;
const HZ = CELLS / 2;       // horizon points along a tile's edge, every other cell (core/tiles.bk's horizon layer)
const HZ_GRID = 2 * (TILE + 2 * 16 - 1) - 1;   // the heights a tile's horizons march through, along an edge (core/layers.bk HZ_MARGIN 16, HZ_DENSITY 2)
const CAPACITY = 4096;
const MAX_LEVEL = 22;
// The most tiles a batch holds; the engine paces batches by the frames
// (they run beside them), the nearest error first, so motion keeps its
// frame rate and the ground nearest the eye still sharpens first.
const PRODUCE_PER_UPDATE = 24;
export const TILE_LAYOUT = { TILE, BORDER, CELLS, DETAIL, TEXELS, HZ, HZ_GRID, CAPACITY, MAX_LEVEL, PRODUCE_PER_UPDATE };

// The core's modules, by name, which a world's kernels and hooks import.
const CORE_MODULES = { 'planet::anchor': readApp('core/anchor.bk'), 'planet::layers': readApp('core/layers.bk'),
                       'planet::noise': readApp('core/noise.bk'), tiles: bro.tiles.module };

// The module planet::ground_params: the ground hook's uniform block, its
// fields [name, type] in order, at the one uniform binding (4, 0).
function groundParams(fields) {
    const src = 'module planet::ground_params;\n\npub struct Params {\n' +
        fields.map(([name, type]) => `    ${name}: ${type},\n`).join('') +
        '}\n@binding(4, 0) pub var params: uniform<Params>;\n';
    bro.kernel.registerModule('planet::ground_params', src);
    return src;
}

// Start the planet of `world` (core/world.js) on the page's #stage canvas.
export function startPlanet(world) {
    checkWorld(world);
    const RADIUS = world.radius;
    const modules = { ...CORE_MODULES, ...world.modules };
    const core = bro.kernel.compile(readApp('core/tiles.bk'), { file: 'core/tiles.bk', modules });
    const kHorizon = core.kernel('k_horizon');
    const kRange = core.kernel('k_range');
    const kAnchors = core.kernel('k_anchors');
    const kSplitDetail = core.kernel('k_split_detail');
    const kTexelSpread = core.kernel('k_texel_spread');
    // An anchor's size is the world's lattices' (core/anchor.bk).
    setAnchorWords(core.consts.ANCHOR_WORDS);
    // The sun's path is the world's season's.
    setNoon(world.noon);

    const canvas = document.querySelector('#stage');
    const scene = canvas.getContext('scene');
    const w = world.create({ scene, modules, kAnchors, tile: TILE_LAYOUT });
    for (const k of WORLD_PARTS) {
        if (w[k] === undefined) throw new Error(`planet: the world ${world.name}'s create() gave no ${k}`);
    }

    // The batch's tiles' heights gathered for k_range (core/layers.bk span),
    // zeroed between batches by k_range itself.
    const span = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * 2 * 4);
    span.write(new Int32Array(PRODUCE_PER_UPDATE * 2));
    // The batch's horizon heights, the world's production to k_horizon.
    const horizonHeights = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * HZ_GRID * HZ_GRID * 4);
    // The batch's texel spreads, k_texel_spread to k_split_detail (which zeroes them).
    const texelSpread = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * 4);
    // The batch's tiles' anchors (anchors.js), by record.
    const batchAnchors = createAnchors(kAnchors, PRODUCE_PER_UPDATE, RADIUS);

    scene.setToneMap({ mode: 'aces' });
    // The sun above the air, in lux (the world's); the atmosphere dims and
    // reddens it, lights the sky and the haze, and the exposure meters the
    // light at the eye. The sun turns about the planet's axis (y) with the
    // hour (core/hour.js).
    const sun = scene.createLight({ type: 'directional', direction: sunDirection(12), color: [1, 1, 1], intensity: world.sunIntensity });
    let sunHour = 12;
    function setHour(hour) {
        sunHour = hour;
        sun.direction = sunDirection(hour);
    }
    // Under the meter by the world's compensation (stops; -0.6 unless it
    // gives one): the land's colour reads richer than metered grey, as a
    // photographer exposes a landscape.
    scene.setExposure({ mode: 'auto', meter: 'incident', compensation: world.exposure ?? -0.6 });
    // The world's air about its centre, which moves with the camera (the
    // scene is camera-relative): frame() sets it.
    const atmosphere = { planetRadius: RADIUS, ...world.atmosphere, planetCenter: [0, -RADIUS, 0] };

    // ── The tile cache ──────────────────────────────────────────────────────

    let cache = null;
    // `pixelsPerTexel`: how large a detail texel may project, what the ground
    // shades at; a tile's vertices are DETAIL texels apart.
    function makeCache(pixelsPerTexel, select = {}) {
        const pixelsPerCell = select.pixelsPerCell ?? pixelsPerTexel * DETAIL;
        const detail = select.pixelsPerDetail > 0;
        const contrast = select.contrast ?? 0.03;
        // The old cache's pools (about a gigabyte) go now, not at a collection.
        if (cache) cache.destroy();
        cache = bro.tiles.createCache({
            domain: { type: 'cubeSphere', radius: RADIUS, center: [0, 0, 0] },
            tileSize: TILE, border: BORDER, capacity: CAPACITY, maxLevel: MAX_LEVEL,
            minHeight: world.minHeight, maxHeight: world.maxHeight, pixelsPerCell, producePerUpdate: PRODUCE_PER_UPDATE,
            layers: { position: 16, detail: DETAIL * DETAIL * 8, horizon: 16, ...w.layers },
            ranges: true, detail, pixelsPerDetail: select.pixelsPerDetail,
            // The whole batch in a dispatch a stage: the GPU fills up on the
            // batch's cells together, where a tile's own were a few warps.
            // The world fills the layers (core/layers.bk), then the core's
            // kernels run over them.
            produce(batch) {
                batch.tiles.forEach((t, i) => batchAnchors.set(i, t.anchor.base, t.anchor.dir));
                batchAnchors.write(batch.count);
                w.produce(batch, { cache: this, anchors: batchAnchors.buffer, span, horizonHeights });
                kHorizon.dispatch([HZ, HZ, batch.count], batch.table, horizonHeights, this.layer('horizon'), HZ_GRID, RADIUS, BORDER, 1 / TILE);
                kRange.dispatch([batch.count], batch.table, span, this.ranges, 1 / TILE, world.maxHeight, world.minHeight);
                if (this.detail) {
                    const half = TILE * DETAIL / 2;
                    kTexelSpread.dispatch([half, half, batch.count], batch.table, this.layer('detail'), texelSpread, TEXELS, BORDER * DETAIL);
                    kSplitDetail.dispatch([batch.count], batch.table, this.layer('position'), this.detail, texelSpread, TILE, BORDER,
                                          (TILE * DETAIL) ** 2, contrast, world.minHeight);
                }
            },
        });
        if (ground) {
            ground.setShaderTexture('pos', { buffer: cache.layer('position'), width: CELLS, height: CELLS, layers: CAPACITY, atlas: 2, channels: 4, format: 'float32' });
            ground.setShaderBuffer('det', cache.layer('detail'));
            ground.setShaderBuffer('hz', cache.layer('horizon'));
            ground.setShaderBuffer('tiles', cache.drawList);
            w.bindGround(ground, cache);
        }
    }

    // ── The drawn tiles: one instanced patch ────────────────────────────────

    // A (TILE+1)^2 vertex grid, x/z = the cell it reads, plus a skirt along
    // the four edges (y = 1) that drops below the surface, out under the
    // neighbour, to hide cracks between tiles.
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

    // The ground's hook (core/ground_mesh.bk) and the layout it reads: the
    // tiles' cells and texels, and the world's own constants.
    const GROUND_LAYOUT = constants('planet::ground_layout', {
        CELLS: ['i32', CELLS], BORDER: ['i32', BORDER], TILE: ['i32', TILE], DETAIL: ['i32', DETAIL],
        TEXELS: ['i32', TEXELS], HZ: ['i32', HZ], FACE_EXTENT: ['f32', RADIUS * Math.PI / 2],
        ...w.ground.layout,
    });

    // The hook's one uniform block: the core's fields, then the world's
    // (its ground.params, [name, type] in order), which the world's systems
    // set by name (ground.setShaderUniform).
    const GROUND_PARAMS = groundParams([['cam_hi', 'vec3<f32>'], ['cam_lo', 'vec3<f32>'], ['to_sun', 'vec3<f32>'],
                                        ...w.ground.params]);

    const groundModules = { tiles: bro.tiles.module, 'planet::ground_layout': GROUND_LAYOUT, 'planet::ground_params': GROUND_PARAMS,
                            'planet::ground_core': readApp('core/ground_core.bk'), 'planet::noise': modules['planet::noise'],
                            'planet::periodic': readApp('core/periodic.bk'),
                            ...w.ground.modules };
    let ground = null;
    ground = scene.createInstancedMesh({
        mesh: patchMesh(), color: [1, 1, 1],
        castsShadow: false, receivesShadow: false, doubleSided: true,
        module: readApp('core/ground_mesh.bk'), file: 'core/ground_mesh.bk', modules: groundModules,
    });
    ground.cullMargin = 4 * RADIUS;   // the shader places tiles; the cache culls them
    makeCache(Number(document.querySelector('#detail').value));
    w.attach(ground);

    // ── Camera: doubles about the planet's center ───────────────────────────

    const start = world.start ?? { lat: 0.45, lon: 0.3, alt: 2.8 * RADIUS, heading: 0, pitch: -90 };
    const cam = { lat: start.lat, lon: start.lon, alt: start.alt, heading: start.heading, pitch: start.pitch };
    // The farthest the camera goes: the world's, else 4.7 radii.
    const MAX_ALT = world.maxAltitude ?? 4.7 * RADIUS;
    // The lowest ground's sphere, and how far past its horizon the camera's
    // far plane reaches: the world's horizonReach, else as far as its
    // highest ground can stand up from behind it. (The far plane also spans
    // the air's froxels, so it sets their depth resolution.)
    const FLOOR = RADIUS + world.minHeight;
    const REACH = world.horizonReach ?? Math.sqrt((RADIUS + world.maxHeight) ** 2 - FLOOR * FLOOR);
    const FOV = 55;
    const v3 = {
        add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
        sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
        scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
        dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
        cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
        norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    };
    // The drawn surface's height under a unit direction (the world's).
    const groundHeight = (dir) => w.surfaceHeight(dir);

    function cameraFrame() {
        const up = [Math.cos(cam.lat) * Math.sin(cam.lon), Math.sin(cam.lat), Math.cos(cam.lat) * Math.cos(cam.lon)];
        const east = v3.norm(v3.cross([0, 1, 0], up));
        const north = v3.cross(up, east);
        const hd = cam.heading * Math.PI / 180, pt = cam.pitch * Math.PI / 180;
        const level = v3.add(v3.scale(north, Math.cos(hd)), v3.scale(east, Math.sin(hd)));
        const right = v3.sub(v3.scale(east, Math.cos(hd)), v3.scale(north, Math.sin(hd)));
        const fwd = v3.add(v3.scale(level, Math.cos(pt)), v3.scale(up, Math.sin(pt)));
        const camUp = v3.cross(right, fwd);
        // The altitude is over the drawn surface.
        const surface = RADIUS + groundHeight(up);
        return { up, east, north, fwd, camUp, right, pos: v3.scale(up, surface + cam.alt), surface };
    }

    // ── Per frame ───────────────────────────────────────────────────────────

    const camHi = [0, 0, 0], camLo = [0, 0, 0];
    const lastStats = { selected: 0, visible: 0 };
    let lastView = null;
    let lastPaint = -1e9, framesSincePaint = 0;

    function frame() {
        const f = cameraFrame();
        // The scene renders at the canvas's layout size (not its width/height
        // attributes), in device pixels: what a tile's cells project onto.
        const height = (canvas.clientHeight || 1080) * devicePixelRatio;
        const aspect = (canvas.clientWidth || 1920) * devicePixelRatio / height;
        const near = Math.min(1e5, Math.max(0.2, cam.alt * 0.05));
        // The horizon over the lowest ground (radius + minHeight), and past
        // it what the highest can stand up from behind it.
        const horizon = Math.sqrt(Math.max(0, (f.surface + cam.alt) ** 2 - FLOOR * FLOOR)) + REACH;
        scene.setCamera({ eye: [0, 0, 0], target: f.fwd, up: f.camUp, fov: FOV, near, far: horizon + 1e5, origin: f.pos });

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
        const d = sun.direction, dl = Math.hypot(d[0], d[1], d[2]);
        const toSun = [-d[0] / dl, -d[1] / dl, -d[2] / dl];
        ground.setShaderUniform('to_sun', toSun);
        const cone = Math.atan(Math.tan(FOV * Math.PI / 360) * Math.hypot(1, aspect));
        // The world's systems, about the same camera.
        w.update({ pos: f.pos, alt: cam.alt, surface: f.surface, toSun, camHi, camLo, fwd: f.fwd, cone, view: lastView });
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

    // ── Controls ────────────────────────────────────────────────────────────

    const altCtl = bindControl('#alt', {
        out: '#altVal', map: logMap(2, MAX_ALT),
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
        cam.alt = Math.max(2, Math.min(MAX_ALT, cam.alt * Math.pow(1.0015, e.deltaY)));
        altCtl.value = cam.alt;
        e.preventDefault();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    function loop() {
        frame();
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    // Hot reload: the app's .bk files named (paths from the app's folder, or
    // a module's file name alone: ['relief.bk']) read again and swapped into
    // every module and hook reading them (bro.kernel.reload, the scene's
    // reloadShaders), then what a changed kernel feeds made again: the
    // ground's tiles when the core's kernels changed, and whatever the
    // world's reload says (Earth: the rivers, and from them or their own
    // kernels the ground's tiles, the clouds, the grass and the trees), each
    // kept drawn while it changes over. A hook's change is its pipeline
    // alone. Returns the kernels changed by module, what was produced again
    // and the milliseconds each part took. `texts` ({ file: source }) stands
    // in for a file's text on disk: a candidate tried without writing it.
    function reload(files, texts = {}) {
        const sources = {};
        for (const f of files) {
            const path = sourcePath(f);
            const text = texts[f] ?? readApp(path);
            // A root module or hook by its file: brokernel keeps a compiled
            // module's file name alone (bro.kernel.compile's `file`), so the
            // core's and the world's .bk files have names of their own.
            sources[path] = text;
            sources[path.slice(path.lastIndexOf('/') + 1)] = text;
            sources[moduleName(path)] = text; // an imported module, by its name
        }
        const t0 = Date.now();
        const changed = {};
        for (const { file, kernels } of bro.kernel.reload(sources)) {
            if (kernels.length) changed[file] = kernels;
        }
        for (const map of [modules, w.ground.modules]) {
            for (const name of Object.keys(map)) {
                if (name in sources) map[name] = sources[name];
            }
        }
        const t1 = Date.now();
        scene.reloadShaders(sources);
        const t2 = Date.now();
        const redone = [];
        const ms = { kernels: t1 - t0, hooks: t2 - t1 };
        const refreshGround = () => { cache.refresh(); redone.push('ground'); };
        w.reload(changed, { redone, ms, refreshGround, coreChanged: 'tiles.bk' in changed });
        return { changed, redone, ms };
    }

    // A window's edit loop: saved .bk files of the app swap in place (a compile
    // error keeps the running code and says why); any other change reloads.
    window.addEventListener('sourcechange', (e) => {
        const files = e.detail.files;
        if (!files.every((f) => f.endsWith('.bk') && !f.startsWith('/'))) return;
        e.preventDefault();
        try {
            const r = reload(files);
            console.log(`planet: ${files.join(', ')} reloaded; changed ${JSON.stringify(r.changed)}, redone [${r.redone}]`);
        } catch (err) {
            console.error(`planet: ${files.join(', ')} kept the running code: ${err.message}`);
        }
    });

    // For tests and tools: the core's handles and the world's (Earth's
    // clouds, grass, trees and rivers).
    // groundModules: the ground hook's modules by name, as given to it (an
    // A/B's set B names what it replaces: perf.compareShaders).
    globalThis.planet = Object.defineProperties({ cam, setHour, ground, groundModules, makeCache, groundHeight, frame, reload,
                                                  world, kAnchors }, {
        cache: { get: () => cache, enumerable: true },
        stats: { get: () => lastStats, enumerable: true },
        lastView: { get: () => lastView, enumerable: true },
        ...Object.getOwnPropertyDescriptors(w.api ?? {}),
    });
    return globalThis.planet;
}
