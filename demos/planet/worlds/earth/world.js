// Earth: the planet's first world (core/world.js says what a world is).
//
// Its ground is ground.bk's height function: relief (relief.bk) cut by a
// drainage network, the rivers (riverbuild.bk, rivers.js) and the finer
// valleys found per tile (dendry*.bk), coloured by its climate and soil
// (climate.bk, surface.bk), with a sea at the radius. produce.bk fills a
// batch's tiles: the drainage at the batch's points first, then the cells,
// the relief anchors, the horizon heights, the texels' heights and soil, and
// the detail texels. Over the ground: the sea's waves (waves.js, drawn by
// the ground's hook), clouds (clouds.js), grass (grass.js) and trees
// (trees.js), each lit by the sun's grid (sun.js).
import { GROUND_LIGHT, createClouds } from "/app/worlds/earth/clouds.js";
import { createGrass, grassModules } from "/app/worlds/earth/grass.js";
import { createTrees, treeModules } from "/app/worlds/earth/trees.js";
import { createRivers } from "/app/worlds/earth/rivers.js";
import { DETAIL_PERIOD, SWELL_PERIOD, WAVE_CLOCK, WIND, WAVES } from "/app/worlds/earth/waves.js";
import { EARTH_VIEWS, EARTH_QUICK_VIEWS } from "/app/worlds/earth/views.js";
import { readApp } from "/app/core/shaders.js";

const DIR = 'worlds/earth/';
const read = (f) => readApp(DIR + f);

const RADIUS = 6371000;
const SEED = 7;
const BASE_WAVELENGTH = 2400000;   // ground.bk's first octave
const MAX_HEIGHT = 9000;

const MODULES = {
    'planet::world': read('world.bk'), 'planet::world_lattice': read('world_lattice.bk'),
    'planet::ground': read('ground.bk'), 'planet::surface': read('surface.bk'),
    'planet::relief': read('relief.bk'), 'planet::rivers': read('rivers.bk'),
    'planet::clouds': read('clouds.bk'),
    'planet::climate': read('climate.bk'), 'planet::dendry': read('dendry.bk'),
    'planet::dendry_grid': read('dendry_grid.bk'), 'planet::dendry_field': read('dendry_field.bk'),
    'planet::cloud_field': read('cloud_field.bk'), 'planet::cloud_lighting': read('cloud_lighting.bk'),
};

function create(core) {
    const { scene, modules, kAnchors } = core;
    const { TILE, BORDER, CELLS, DETAIL, TEXELS, HZ_GRID, CAPACITY, MAX_LEVEL, PRODUCE_PER_UPDATE } = core.tile;
    const compile = (f) => core.kernels[f];

    const mod = compile('produce.bk');
    const rivers = createRivers(compile('riverbuild.bk'), RADIUS, SEED);
    const kTile = mod.kernel('k_tile');
    const kHeight = mod.kernel('k_height');
    const kAnchor = mod.kernel('k_anchor');
    const kDetailHeight = mod.kernel('k_detail_height');
    const kDetail = mod.kernel('k_detail');
    const kSoil = mod.kernel('k_soil');
    const kHorizonHeights = mod.kernel('k_horizon_heights');
    const kDrainReaches = mod.kernel('k_drain_reaches');
    const kDrainPoints = mod.kernel('k_drain_points');
    const kDrainLinks = mod.kernel('k_drain_links');
    const kDrainParts = mod.kernel('k_drain_parts');
    const kPointDrains = mod.kernel('k_point_drains');
    const kWindowPoints = mod.kernel('k_window_points');
    const kWindowLinks = mod.kernel('k_window_links');

    // The octaves a tile's cells can carry: down to a wavelength of 2.5 cells
    // (the tile kernels take theirs from ground.bk octaves_for, the same).
    const octavesFor = (extent) => Math.min(30, Math.max(1, Math.log2(BASE_WAVELENGTH / (2.5 * extent / TILE))));
    // The finest octaves anything draws: a colour is the mean over them.
    const TRUTH = octavesFor(RADIUS * Math.PI / 2 / 2 ** MAX_LEVEL);

    // The batch's texels, each its point and mean height, k_detail_height to k_detail.
    const texelHeights = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * TEXELS * TEXELS * 16);
    // And what each texel's colour takes from its drainage and its climate
    // (produce.bk k_point_drains, two vec4s), found at every other texel
    // (tex_drains).
    const TEX_DRAINS = Math.floor(TEXELS / 2) + 1;
    const texelDrains = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * TEX_DRAINS * TEX_DRAINS * 16);
    const texelClimates = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * TEX_DRAINS * TEX_DRAINS * 32);
    // The batch's soil heights, k_soil to k_detail (produce.bk SOIL_STRIDE).
    const SOIL_STRIDE = 67;
    const soilGrid = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * SOIL_STRIDE * SOIL_STRIDE * 4);
    // The batch's drainage grids (dendry_grid.bk): each level's segments, two
    // vec4s a point, read by the tile's kernels; and one level's potentials at a
    // time, k_drain_points to k_drain_links.
    const DRAIN_LEVELS = 4, DRAIN_GRID = 101, DRAIN_POT_GRID = 103;
    const drainSegs = bro.kernel.createBuffer(DRAIN_LEVELS * PRODUCE_PER_UPDATE * DRAIN_GRID * DRAIN_GRID * 32);
    const drainPots = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * DRAIN_POT_GRID * DRAIN_POT_GRID * 32);
    // And the rivers' reaches about each tile, level 0, three vec4s a reach.
    const drainReaches = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * DRAIN_GRID * DRAIN_GRID * 48);
    // The drainage at the batch's points from the grids (base level, relative
    // height, dryness): k_point_drains' for the texels, the horizon heights and
    // the soil (produce.bk drain_points), and the vertices; and beside each, the
    // levels' drops (dendry.bk Drain drops).
    const HZ_DRAINS = Math.floor((HZ_GRID + 1) / 2);
    const DRAIN_POINTS = TEX_DRAINS * TEX_DRAINS + HZ_DRAINS * HZ_DRAINS + SOIL_STRIDE * SOIL_STRIDE;
    const pointDrains = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * DRAIN_POINTS * 16);
    const vertexDrains = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * CELLS * CELLS * 16);
    const pointDrops = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * DRAIN_POINTS * 16);
    const vertexDrops = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * CELLS * CELLS * 16);
    // The vertices' windows on the levels finer than a tile's grid holds
    // (dendry_grid.bk WIN, POTS): every level's links, two vec4s each, and one
    // level's potentials at a time.
    const WINDOW_LINKS = 26, WINDOW_POTS = 50;
    // Whether a tile `extent` metres across holds drainage level k in its grid
    // (dendry_grid.bk grid_holds: its texel_cell under half the level's
    // spacing): 1 it does, -1 it does not, 0 too near to say in f64 what the
    // kernel finds in f32 (both run). A batch dispatches a level's grid only
    // when some tile holds it, its windows only when some tile does not; the
    // kernels skip the tiles the level is not theirs for.
    const drainHeld = (extent, k) => {
        const octaves = Math.min(30, Math.max(1, Math.log2(BASE_WAVELENGTH / (2.5 * extent * 2 / (TILE * DETAIL)))));
        const ratio = BASE_WAVELENGTH / (2.5 * 2 ** octaves) / (0.5 * Math.PI / 2 * RADIUS / (512 * 4 ** k));
        return ratio < 0.99 ? 1 : ratio > 1.01 ? -1 : 0;
    };
    const drainWindows = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * CELLS * CELLS * DRAIN_LEVELS * WINDOW_LINKS * 32);
    const windowPots = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * CELLS * CELLS * WINDOW_POTS * 32);
    // Each of those points' levels' parts, k_drain_parts to k_point_drains.
    const drainParts = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * (DRAIN_LEVELS + 1) * (DRAIN_POINTS + CELLS * CELLS) * 16);
    // Each resident tile's relief anchors (produce.bk k_anchor), by slot.
    const anchors = bro.kernel.createBuffer(CAPACITY * 24 * 4);

    // A batch's drainage, then its cells, relief anchors, horizon heights and
    // texels (core/layers.bk's formats for the core's layers).
    function produce(batch, { cache, anchors: at, span, horizonHeights }) {
        const grid = [CELLS, CELLS, batch.count], pos = cache.layer('position');
        // The levels some tile's grid holds, and those some tile's
        // vertices find in windows (drainHeld).
        let gridTo = 0, windowFrom = DRAIN_LEVELS + 1;
        for (const t of batch.tiles) {
            for (let level = 1; level <= DRAIN_LEVELS; level++) {
                const held = drainHeld(t.extent, level);
                if (held >= 0) gridTo = Math.max(gridTo, level);
                if (held <= 0) windowFrom = Math.min(windowFrom, level);
            }
        }
        kDrainReaches.dispatch([DRAIN_GRID, DRAIN_GRID, batch.count], batch.table, at, drainReaches, RADIUS, 1 / TILE, DETAIL, rivers.net);
        for (let level = 1; level <= gridTo; level++) {
            kDrainPoints.dispatch([DRAIN_POT_GRID, DRAIN_POT_GRID, batch.count], batch.table, at, drainPots, drainSegs, drainReaches,
                                  RADIUS, 1 / TILE, DETAIL, level, PRODUCE_PER_UPDATE, SEED);
            kDrainLinks.dispatch([DRAIN_GRID, DRAIN_GRID, batch.count], batch.table, at, drainSegs, drainPots,
                                 RADIUS, 1 / TILE, DETAIL, level, PRODUCE_PER_UPDATE, SEED);
        }
        for (let level = windowFrom; level <= DRAIN_LEVELS; level++) {
            kWindowPoints.dispatch([CELLS * CELLS, WINDOW_POTS, batch.count], batch.table, at, windowPots, drainWindows, drainSegs,
                                   drainReaches, rivers.net, CELLS, RADIUS, BORDER, 1 / TILE, DETAIL, level, PRODUCE_PER_UPDATE, SEED);
            kWindowLinks.dispatch([CELLS * CELLS, WINDOW_LINKS, batch.count], batch.table, at, drainWindows, windowPots, CELLS,
                                  RADIUS, BORDER, 1 / TILE, DETAIL, level, SEED);
        }
        kDrainParts.dispatch([DRAIN_POINTS + CELLS * CELLS, DRAIN_LEVELS + 1, batch.count], batch.table, at, drainSegs, drainReaches,
                             drainParts, TEXELS, HZ_GRID, CELLS, RADIUS, BORDER, 1 / TILE, DETAIL, TRUTH, PRODUCE_PER_UPDATE, SEED,
                             rivers.net, drainWindows);
        kPointDrains.dispatch([DRAIN_POINTS + CELLS * CELLS, batch.count], batch.table, at, drainParts, pointDrains, texelDrains,
                              vertexDrains, pointDrops, vertexDrops, texelClimates, TEXELS, HZ_GRID, CELLS, RADIUS, BORDER, 1 / TILE, DETAIL,
                              TRUTH, SEED);
        kTile.dispatch(grid, batch.table, at, pos, cache.layer('relief'), span, RADIUS, BORDER, 1 / TILE, TRUTH, SEED, rivers.net,
                       vertexDrains, vertexDrops);
        kAnchor.dispatch([batch.count], batch.table, at, anchors, RADIUS, 1 / TILE, DETAIL, SEED);
        kHorizonHeights.dispatch([HZ_GRID, HZ_GRID, batch.count], batch.table, at, horizonHeights, RADIUS, 1 / TILE, SEED, rivers.net,
                                 pointDrains, TEXELS, pointDrops);
        const texels = [TEXELS, TEXELS, batch.count];
        kDetailHeight.dispatch(texels, batch.table, at, texelHeights, RADIUS, BORDER, 1 / TILE, DETAIL, SEED, rivers.net,
                               pointDrains, HZ_GRID, pointDrops);
        kSoil.dispatch([SOIL_STRIDE, SOIL_STRIDE, batch.count], batch.table, at, soilGrid, TEXELS, RADIUS, BORDER, 1 / TILE, DETAIL, SEED, rivers.net,
                       pointDrains, HZ_GRID, pointDrops);
        kDetail.dispatch(texels, batch.table, at, texelHeights, cache.layer('detail'), RADIUS, BORDER, 1 / TILE, DETAIL, TRUTH, SEED,
                         rivers.net, soilGrid, anchors, texelDrains, texelClimates, pointDrains, HZ_GRID, pointDrops);
    }

    // What the ground's hook reads of Earth: the periods of its periodic
    // coordinates, the wind and the sea's waves, the ground light cache's
    // tiles (clouds.js), and the relief, trees' and grass's modules.
    const groundPart = {
        layout: {
            DETAIL_PERIOD: ['f32', DETAIL_PERIOD], FAR_PERIOD: ['f32', SWELL_PERIOD],
            SEED: ['i32', SEED], WIND: ['vec3<f32>', WIND],
            GL_TILE: ['i32', GROUND_LIGHT.tile], GL_BORDER: ['i32', GROUND_LIGHT.border],
            GL_ATLAS: ['i32', GROUND_LIGHT.atlas], GL_LEVELS: ['i32', GROUND_LIGHT.levels],
            WAVE_COUNT: ['i32', WAVES.list.length], WAVE_SWELL: ['i32', WAVES.swell], WAVE_FRESH: ['i32', WAVES.fresh],
            WAVE_RESIDUAL: ['f32', WAVES.residual], WAVE_FRESH_SCALE: ['f32', WAVES.freshScale],
            // Each wave's vector (radians a metre) and the footprint it fades out
            // at; its frequency, the slopes' variance from it on, its slope
            // amplitude over k and its own variance.
            WAVE_K: ['vec4<f32>', WAVES.list.map((w) => [...w.n.map((c) => c * 2 * Math.PI / w.period), Math.PI / 2 / w.k])],
            WAVE_F: ['vec4<f32>', WAVES.list.map((w) => [w.omega, w.tail, w.slope / w.k, w.slope * w.slope / 2])],
        },
        // Its fields of the hook's uniform block, after the core's: the
        // waves' clock, the drawn trees' reach, the clouds' ground light
        // cache's footprint, and where the grass's and trees' fields lie
        // (grass.js, trees.js, clouds.js set them).
        params: [['time', 'f32'], ['trees_far', 'f32'], ['cloud_w0', 'f32'],
                 ...['grass_a', 'grass_e', 'grass_f', 'grass_uv', 'tree_o_hi', 'tree_o_lo', 'tree_lattice',
                     'tree_a', 'tree_e', 'tree_f', 'tree_uv'].map((n) => [n, 'vec3<f32>'])],
        modules: { 'planet::world_ground': read('world_ground.bk'), 'planet::ground_detail': read('ground_detail.bk'),
                   'planet::relief': modules['planet::relief'], ...treeModules, ...grassModules },
    };

    let ground = null, clouds = null, grass = null, trees = null;
    function attach(node) {
        ground = node;
        const cloudMod = compile('clouds.bk');
        const sunMod = compile('sun.bk');
        const grassMod = compile('grass.bk');
        grass = createGrass(scene, RADIUS, grassMod, sunMod, TRUTH, SEED, rivers.net, kAnchors, [ground]);
        const treeMod = compile('trees.bk');
        trees = createTrees(scene, RADIUS, treeMod, sunMod, TRUTH, SEED, rivers.net, kAnchors, [ground]);
        clouds = createClouds(scene, RADIUS, cloudMod, [ground], SEED,
                              { source: read('clouds_volume.bk'), modules }, MAX_HEIGHT);
    }

    function update(f) {
        const time = performance.now() / 1000 % WAVE_CLOCK;
        ground.setShaderUniform('time', time);
        ground.setShaderUniform('trees_far', trees.far);
        clouds.update(f.pos, f.surface + f.alt - RADIUS, f.toSun, f.view);
        grass.update(f.pos, f.alt, f.toSun, f.camHi, f.camLo, f.fwd, f.cone, time);
        trees.update(f.pos, f.alt, f.toSun, f.camHi, f.camLo, f.fwd, f.cone, time);
    }

    // After a hot reload: the rivers when their kernels changed, and from them
    // or the tiles' kernels (Earth's or the core's) the ground's tiles, the
    // clouds, the grass and the trees; each system from its own kernels.
    function reload(changed, { redone, ms, refreshGround, coreChanged }) {
        const redo = (f) => f in changed;   // by file name (core/world.js)
        const t = Date.now();
        const drained = redo('riverbuild.bk');
        if (drained) { rivers.rebuild(); redone.push('rivers'); }
        ms.rivers = Date.now() - t;
        const tiles = drained || coreChanged || redo('produce.bk');
        if (tiles) refreshGround();
        if (tiles || redo('clouds.bk')) { clouds.refresh(); redone.push('clouds'); }
        if (tiles || redo('sun.bk') || redo('grass.bk')) { grass.refresh(); redone.push('grass'); }
        if (tiles || redo('sun.bk') || redo('trees.bk')) { trees.refresh(); redone.push('trees'); }
    }

    return {
        layers: { relief: 16 },
        ground: groundPart,
        produce,
        bindGround(node, cache) {
            node.setShaderBuffer('relief', cache.layer('relief'));
            node.setShaderBuffer('anchors', anchors);
        },
        attach,
        // The drawn surface (the ground, or the sea over it) at 18 octaves.
        surfaceHeight: (dir) => kHeight.run(1, dir[0], dir[1], dir[2], RADIUS, 18, SEED, rivers.cpu)[0],
        update,
        reload,
        api: {
            get clouds() { return clouds; }, get grass() { return grass; },
            get trees() { return trees; }, get rivers() { return rivers; },
        },
    };
}

export default {
    name: 'earth',
    radius: RADIUS,
    // The sea stands at the radius: the drawn surface is never below it.
    minHeight: 0,
    maxHeight: MAX_HEIGHT,
    // The far plane 200 km past the sea's horizon: the ranges past it are
    // lost in the haze, and the air's froxels keep their depth.
    horizonReach: 2e5,
    sunIntensity: 128000,
    // A clear day's haze; the ground's average albedo lights the air from below.
    atmosphere: { turbidity: 10, groundAlbedo: [0.08, 0.1, 0.1] },
    start: { lat: 0.45, lon: 0.3, alt: 1.8e7, heading: 0, pitch: -90 },
    views: EARTH_VIEWS,
    quickViews: EARTH_QUICK_VIEWS,
    modules: MODULES,
    kernels: Object.fromEntries(['produce.bk', 'riverbuild.bk', 'clouds.bk', 'sun.bk', 'grass.bk', 'trees.bk']
        .map((f) => [f, { source: read(f), file: DIR + f }])),
    create,
};
