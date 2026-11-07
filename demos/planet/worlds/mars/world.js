// Mars: the planet's second world (core/world.js says what a world is), dry,
// dusty and red, under a thin butterscotch sky.
//
// Its ground is ground.bk's height function: the broad landforms
// (landforms.bk: the hemispheric dichotomy, the Tharsis and Elysium rises,
// the great basins, the polar deposits and caps), the shield volcanoes
// (volcanoes.bk), the rolling relief (relief.bk), craters at every scale
// (craters.bk), the canyons (canyons.bk) and the dunes on the sand
// (dunes.bk), coloured by surface.bk. produce.bk fills a batch's tiles: the
// cells, the horizon heights, the texels' heights and what colours them,
// and the detail texels. The ground's hook adds the regolith's finer tone
// and relief and the sand's ripples (world_ground.bk).
import { MARS_VIEWS, MARS_QUICK_VIEWS } from "/app/worlds/mars/views.js";
import { readApp } from "/app/core/shaders.js";

const DIR = 'worlds/mars/';
const read = (f) => readApp(DIR + f);

const RADIUS = 3389500;
const SEED = 11;
const BASE_WAVELENGTH = 2097152;   // scale.bk's first octave
// Hellas's floor stands 8 km under the datum, Olympus's summit 21 km over it.
const MIN_HEIGHT = -10000;
const MAX_HEIGHT = 23000;
// The ground hook's periodic coordinates: the ripples' over 64 m, the
// dunes' over 4096 m (dunes.bk DUNE_PERIOD).
const DETAIL_PERIOD = 64;
const FAR_PERIOD = 4096;

const MODULES = {
    'planet::world': read('world.bk'), 'planet::world_lattice': read('world_lattice.bk'),
    'planet::ground': read('ground.bk'), 'planet::surface': read('surface.bk'), 'planet::scale': read('scale.bk'),
    'planet::landforms': read('landforms.bk'), 'planet::volcanoes': read('volcanoes.bk'),
    'planet::relief': read('relief.bk'), 'planet::craters': read('craters.bk'),
    'planet::canyons': read('canyons.bk'), 'planet::dunes': read('dunes.bk'), 'planet::strata': read('strata.bk'),
    'planet::frost': read('frost.bk'),
};

function create(core) {
    const { modules } = core;
    const { TILE, BORDER, DETAIL, TEXELS, HZ_GRID, MAX_LEVEL, PRODUCE_PER_UPDATE } = core.tile;
    const compile = (f) => bro.kernel.compile(read(f), { file: DIR + f, modules });

    const mod = compile('produce.bk');
    const kTile = mod.kernel('k_tile');
    const kHeight = mod.kernel('k_height');
    const kDetailHeight = mod.kernel('k_detail_height');
    const kDetail = mod.kernel('k_detail');
    const kHorizonHeights = mod.kernel('k_horizon_heights');

    // The octaves a tile's cells can carry (scale.bk octaves_for, the same),
    // and the finest anything draws: a vertex is the ground at them.
    const octavesFor = (extent) => Math.min(30, Math.max(1, Math.log2(BASE_WAVELENGTH / (2.5 * extent / TILE))));
    const TRUTH = octavesFor(RADIUS * Math.PI / 2 / 2 ** MAX_LEVEL);

    // The batch's texels: each its point and mean height, and what colours
    // it (three vec4s), k_detail_height to k_detail.
    const texelHeights = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * TEXELS * TEXELS * 16);
    const texelFields = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * TEXELS * TEXELS * 16 * mod.consts.FIELDS);

    function produce(batch, { cache, anchors, span, horizonHeights }) {
        kTile.dispatch([TILE + 2 * BORDER, TILE + 2 * BORDER, batch.count], batch.table, anchors, cache.layer('position'), span,
                       RADIUS, BORDER, 1 / TILE, TRUTH, SEED, MIN_HEIGHT);
        kHorizonHeights.dispatch([HZ_GRID, HZ_GRID, batch.count], batch.table, anchors, horizonHeights, RADIUS, 1 / TILE, SEED);
        const texels = [TEXELS, TEXELS, batch.count];
        kDetailHeight.dispatch(texels, batch.table, anchors, texelHeights, texelFields, RADIUS, BORDER, 1 / TILE, DETAIL, SEED);
        kDetail.dispatch(texels, batch.table, texelHeights, texelFields, cache.layer('detail'), RADIUS);
    }

    const groundPart = {
        layout: { DETAIL_PERIOD: ['f32', DETAIL_PERIOD], FAR_PERIOD: ['f32', FAR_PERIOD], SEED: ['i32', SEED] },
        params: [],
        modules: { 'planet::world_ground': read('world_ground.bk') },
    };

    // After a hot reload: the ground's tiles when its kernels or the core's
    // changed (any of the ground's modules changes produce.bk's kernels).
    function reload(changed, { refreshGround, coreChanged }) {
        if (coreChanged || 'produce.bk' in changed) refreshGround();
    }

    return {
        layers: {},
        ground: groundPart,
        produce,
        bindGround() {},
        attach() {},
        // The drawn surface at 18 octaves (8 m).
        surfaceHeight: (dir) => kHeight.run(1, dir[0], dir[1], dir[2], RADIUS, 18, SEED)[0],
        update() {},
        reload,
    };
}

export default {
    name: 'mars',
    radius: RADIUS,
    minHeight: MIN_HEIGHT,
    maxHeight: MAX_HEIGHT,
    // 1.52 AU: 43% of Earth's sunlight, its disc two thirds as wide.
    sunIntensity: 55000,
    // A thin CO2 air (Rayleigh some 3.5% of Earth's, its scale height 11 km)
    // carrying fine dust well mixed to the same height (an optical depth of
    // 0.25 at the datum, a clear season's), which scatters the red and
    // absorbs the blue: a butterscotch sky by day, its light reddened.
    atmosphere: {
        rayleigh: [0.20e-6, 0.47e-6, 1.16e-6], rayleighScaleHeight: 11100,
        mieScattering: [2.2e-5, 2.0e-5, 1.67e-5], mieAbsorption: [0.06e-5, 0.27e-5, 0.65e-5],
        mieG: 0.7, mieScaleHeight: 11100,
        ozone: [0, 0, 0], thickness: 120000,
        groundAlbedo: [0.25, 0.14, 0.07], sunAngularRadius: 0.003076,
    },
    // Late northern spring: the sun 20 degrees north of the equator at noon.
    noon: [-0.527, -0.342, -0.777],
    start: { lat: -0.087, lon: -1.48, alt: 9.5e6, heading: 0, pitch: -90 },
    views: MARS_VIEWS,
    quickViews: MARS_QUICK_VIEWS,
    modules: MODULES,
    create,
};
