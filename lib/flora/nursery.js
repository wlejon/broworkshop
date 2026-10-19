// The nursery: broflora specimens grown once and drawn many times over by
// bro.scene's forest nodes. demos/forest and demos/wilds stand the same
// plants: two dozen broadleaves of three habits on flat ground, spaced so
// each grows its own crown, then rows of broflora's conifer and shrub
// presets. The grown world is cached under the app's cache dir.
//
//   const { world, grow } = growNursery();
//   const emits = emitParts(world);           // broadleaf, needle, scale, shrub
//   const node = scene.createForest(forestNodeOptions(k, emits[k], trees[k]));

const COMMON = {
    pipeExp: 2.0, leafDiameter: 0.028,
    shadeTolerance: 0.35, moduleMatureAge: 0.6, rootVigorMax: 4.0, apicalControl: 0.35,
    apicalControlMature: 0.3, individualVariation: 0.25, maxAge: 400, seedingRadius: 0.0,
};
export const SPECIES = {
    spreading: Object.assign({}, COMMON, { growthScale: 2.5, orthotropy: 0.55, tropismG2: 0.05 }),
    vase: Object.assign({}, COMMON, { growthScale: 2.0, orthotropy: 0.7, tropismG2: 0.03 }),
    tall: Object.assign({}, COMMON, { growthScale: 2.2, orthotropy: 0.8, tropismG2: 0.02, apicalControl: 0.5 }),
};
const HABITS = ['spreading', 'vase', 'tall'];
export const NURSERY = { cols: 6, rows: 4, spacing: 9 };   // 24 broadleaf specimens, far enough apart to grow their own crowns
// bro.flora's species presets, grown in rows of their own past the
// broadleaves: conifers (needle and scale-leaf sprays) and shrubs.
export const CONIFERS = ['fir', 'spruce', 'pine', 'fir', 'spruce', 'cypress', 'fir', 'spruce', 'pine', 'cypress'];
export const SHRUBS = ['boxwood', 'holly', 'hydrangea', 'boxwood', 'holly', 'hydrangea'];
export const SPECIMENS = NURSERY.cols * NURSERY.rows + CONIFERS.length + SHRUBS.length;

// The broadleaves are grown down from this stem: a trunk to 2 m and three
// scaffold limbs.
function trunkPrototype() {
    const H = 2.0, n = 6, nodes = [], edges = [];
    for (let i = 0; i <= n; i++) {
        nodes.push({ position: [0.03 * Math.sin(i * 1.7), H * i / n, 0.03 * Math.cos(i * 2.3)],
                     ageAtBirth: 0.03 * i, lengthMax: 1, thickening: 1 });
        if (i) edges.push([i - 1, i]);
    }
    for (let k = 0; k < 3; k++) {
        const a = k * 2.094 + 0.4;
        nodes.push({ position: [Math.cos(a) * 0.25, H + 0.15, Math.sin(a) * 0.25], ageAtBirth: 0.2, lengthMax: 0.8, thickening: 1 });
        edges.push([n, nodes.length - 1]);
    }
    return { name: 'trunk', nodes, edges, rootNode: 0, terminalNodes: [n, n + 1, n + 2, n + 3] };
}

export const FOLIAGE = { seed: 0x1eaf, perArea: 90 };
export function leafCard() {
    const m = Mesh.leafCard('oval', {
        width: 0.07, length: 0.12, bend: 0.4, fullUV: true, shapedSilhouette: true, cup: 0.55,
        widthSegments: 3, lengthSegments: 5,
    });
    m.colors = new Float32Array(0);
    return m;
}

const SIM_STEP = 0.02, SIM_SECONDS = 50;

/** Grow the nursery: one broflora world, a grid of specimens on flat ground.
 *  { world, grow } (grow: world.grow's result, `cached` when it was read). */
export function growNursery() {
    const { cols, rows, spacing } = NURSERY;
    const presetRows = Math.ceil(CONIFERS.length / cols) + Math.ceil(SHRUBS.length / cols);
    const W = cols * spacing + 10, D = (rows + presetRows) * spacing + 10;
    const world = bro.flora.createWorld({
        rngSeed: 0xf0e57,
        climate: { annualTempBase: 15, annualPrecip: 1100 },
        shadow: { origin: [-W / 2, -2, -D / 2], cellSize: 1, width: W, height: 26, depth: D, fill: 1 },
    });
    const mono = world.addPrototype(bro.flora.prototypes.monopodial(3, 0.7));
    const trunk = world.addPrototype(trunkPrototype());
    world.addVoronoiSite(mono, 0.5, 0.3);
    const at = (i, j) => [(i - (cols - 1) / 2) * spacing + 1.3 * Math.sin(i * 2.1 + j), 0,
                          (j - (rows + presetRows - 1) / 2) * spacing + 1.3 * Math.cos(i * 1.3 + 2 * j)];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const kind = HABITS[(i + 2 * j) % HABITS.length];
        world.addPlant({ origin: at(i, j), species: SPECIES[kind], prototypeIndex: trunk });
    }
    // The presets in order after the broadleaves (plant index = specimen).
    [...CONIFERS, ...SHRUBS].forEach((name, k) => {
        const row = k < CONIFERS.length ? rows + Math.floor(k / cols)
                                        : rows + Math.ceil(CONIFERS.length / cols) + Math.floor((k - CONIFERS.length) / cols);
        const col = k < CONIFERS.length ? k % cols : (k - CONIFERS.length) % cols;
        world.plantSpecies(name, { origin: at(col, row) });
    });
    // Grown once per change to the nursery or to broflora's step: the grown
    // world is cached under the app's cache dir, keyed by all of that.
    const grow = world.grow(Math.round(SIM_SECONDS / SIM_STEP), SIM_STEP, { cache: bro.app.cacheDir });
    return { world, grow };
}

const range = (a, n) => [...Array(n).keys()].map((i) => a + i);
export const BROADLEAF = range(0, NURSERY.cols * NURSERY.rows);
export const SHRUB_PLANTS = range(NURSERY.cols * NURSERY.rows + CONIFERS.length, SHRUBS.length);

/** The forest's parts, a node each: their names, in emitParts' order. */
export const PARTS = ['broadleaf', 'needle', 'scale', 'shrub'];

/** One emit a node: the broadleaves and shrubs by plant, the conifers by
 *  leaf form (each takes its form's spray defaults). */
export function emitParts(world) {
    return [world.emitForest(Object.assign({ plants: BROADLEAF }, FOLIAGE)),
            world.emitForest({ seed: FOLIAGE.seed, leafForm: 'needle' }),
            world.emitForest({ seed: FOLIAGE.seed, leafForm: 'scale' }),
            world.emitForest(Object.assign({ plants: SHRUB_PLANTS }, FOLIAGE))];
}

export const BARK = { color: [0.2, 0.17, 0.14], roughness: 0.9 };
export const LEAF = { color: [0.07, 0.13, 0.04], roughness: 0.7 };

/** createForest's options for part k (PARTS' order) of `emit`, `trees` its
 *  instances. No leaf: each node draws its form's own card at its species'
 *  leaf size (a broadleaf's leaf, a conifer's spray, a shrub's small leaf). */
export function forestNodeOptions(k, emit, trees) {
    return Object.assign({
        forest: emit, instances: trees,
        doubleSided: true, subsurface: k === 0 || k === 3 ? 0.5 : 0.3, vertexColorTint: false,
        castsShadow: true, receivesShadow: true, barkColor: BARK.color, barkRoughness: BARK.roughness,
    }, LEAF);
}
