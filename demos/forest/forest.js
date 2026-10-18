// forest — a few thousand broadleaf trees on rolling hills, from above the
// canopy down to standing among the trunks: the showcase for bro.scene's
// forest node (scene.createForest) and its levels of detail.
//
// broflora grows a nursery of SPECIMENS once at boot (a couple of dozen
// plants of three habits, spaced so each grows its own crown), and
// world.emitForest() hands them to the forest node as bark, clumps and
// leaves. bro.flora.plantForest() then stands them a few thousand times over
// the hills, turned and scaled, thinning to a glade in the middle. The node
// draws every tree at the detail its size on screen asks for:
//
//   leaves   up close, every leaf, fluttering on its own
//   thinned  a little further, fewer leaves, then clusters: each kept leaf
//            a small card of the leaves round it
//   clumps   the crown's lobes, a card each on which the shader places the
//            lobe's own leaves
//   crowns   one such card a tree, far off
//
// Nothing is baked: every tier is drawn from the tree's own clumps and
// leaves, so a world of unique trees streams in at no extra cost.
//
// every tier posed by the same sway, so a tree does not swim as it hands
// over. Grass grows in the glade and the open, thin under the crowns, from
// bro.flora.forestCover(). main.js mounts the panel; tests and the capture
// tool import this module (never main.js).

import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";
import { daylight, DAYLIGHT } from "/lib/kit/sky.js";

export const GROUND = 240;         // half-size of the near ground (fine mesh, grass), metres
export const FAR = 900;            // half-size of the far ground
export const FOREST = 400;         // half-size of the planted area
export const PLANT_SCALE = 1.5;    // node scale: broflora grows ~5 m trees, drawn ~7.5 m
export const GRASS_RANGE = 150;    // how far blades are drawn (their rings end at 7, 20, 55, 150 m of it at 150)
export const GLADE = { x: 12, z: 18, r: 26 };
// A flower meadow at true scale, south-west of the glade: about 170 m
// across inside its ragged forest edge, so a view across it reaches 150 m
// of meadow to the trees on its far side.
export const MEADOW = { x: -120, z: -100, r: 85 };

export const vp = sceneViewport('#stage', {
    orbit: { target: [0, 4, 0], dist: 60, fov: 50, near: 0.1, far: 2000, rot: orbitRotation(Math.PI * 0.75, -0.3) },
    controls: { orbitButton: 0, panButton: 2, minDist: 1, maxDist: 600 },
});
export const { scene } = vp;
// Skies with nothing on the ground in them (the forest is the ground), and a
// haze for a view kilometres deep.
const PRESETS = {
    golden: Object.assign({}, DAYLIGHT.golden, { hdri: 'belfast_sunset_puresky', envIntensity: 0.35,
                                                  fog: { start: 60, end: 1100, color: [0.86, 0.62, 0.46] } }),
    noon: Object.assign({}, DAYLIGHT.noon, { fog: { start: 80, end: 1500, color: [0.66, 0.74, 0.82] } }),
};
// The meadow's and the forest floor's albedo lights the shade from below.
export const sky = daylight(scene, { presets: PRESETS, order: ['golden', 'noon'], cascades: 3, atlas: 4096, pcf: 3,
    ground: [0.09, 0.12, 0.05] });
scene.setMSAA(4);
vp.onFrame((dt) => sky.update(dt));

// --- the ground -------------------------------------------------------------------

const simplex = FastNoise.create('Simplex');
simplex.set('Feature Scale', 1);
const fbm = FastNoise.create('FractalFBm');
fbm.set('Source', simplex);
fbm.set('Octaves', 4);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Ground height (metres) at world x, z: rolling hills, a flatter glade. */
export function groundHeight(x, z) {
    // Broad hills, gentler round the glade where the flight comes down.
    const r = Math.hypot(x - GLADE.x, z - GLADE.z);
    // The meadow lies in a broad, shallow hollow.
    const m = smooth(MEADOW.r * 1.7, MEADOW.r * 0.6, Math.hypot(x - MEADOW.x, z - MEADOW.z));
    const broad = 9 * fbm.genSingle2D(x * 0.006, z * 0.006, 0x51) * (1 - 0.6 * smooth(140, 50, r)) * (1 - 0.8 * m);
    // The swells die away toward the near ground's edge, so the far
    // ground's coarse mesh is true to the same function.
    const near = smooth(GROUND, GROUND - 40, Math.max(Math.abs(x), Math.abs(z)));
    const swell = 1.4 * fbm.genSingle2D(x * 0.03, z * 0.03, 0x9a0d) * near;
    const g = Math.max(smooth(GLADE.r * 2.2, GLADE.r * 0.5, r), 0.6 * m);
    return broad + swell * (1 - 0.7 * g);
}

/** How sun-dried the grass is at x, z: patches, drier on the rises. */
export function dryness(x, z) {
    const patch = smooth(-0.3, 0.5, fbm.genSingle2D(x * 0.12, z * 0.12, 0x77));
    // The meadow's hollow holds its water: greener than the glade's rises.
    return Math.min(1, 0.6 * patch + 0.25 * smooth(2, 9, groundHeight(x, z))) * (1 - 0.45 * meadowShare(x, z));
}

// A deer path from the glade west into the trees, which the flight walks:
// no trunk stands on it.
const TRAIL = [[30, 22], [-6, 16], [-20, 13], [-27, 12], [-36, 11]];
function trailDistance(x, z) {
    let best = Infinity;
    for (let i = 0; i + 1 < TRAIL.length; i++) {
        const [ax, az] = TRAIL[i], [bx, bz] = TRAIL[i + 1];
        const dx = bx - ax, dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
    }
    return best;
}

/** How far x, z lies inside the meadow's ragged edge: 1 deep in it, 0 in the trees. */
export function meadowShare(x, z) {
    const d = Math.hypot(x - MEADOW.x, z - MEADOW.z) + 16 * fbm.genSingle2D(x * 0.025, z * 0.025, 0x3e);
    return smooth(MEADOW.r * 1.12, MEADOW.r * 0.85, d);
}

/** Where trees stand: 0 .. 1, nothing in the glade or the meadow, ragged edges round them, none on the trail. */
export function treeDensity(x, z) {
    const d = Math.hypot(x - GLADE.x, z - GLADE.z) + 8 * fbm.genSingle2D(x * 0.05, z * 0.05, 0x3);
    return smooth(GLADE.r * 0.8, GLADE.r * 1.25, d) * smooth(2.5, 4.5, trailDistance(x, z)) * (1 - meadowShare(x, z)) *
           (0.85 + 0.15 * fbm.genSingle2D(x * 0.02, z * 0.02, 0x8));
}

// The low plants (broflora's herb presets): bro.scene's grass node picks one
// a cell of its own grid by the light under the canopy and each species'
// colonies, and builds it where it stands.
export const HERB_RANGE = 24;
export const HERBS = ['bracken', 'ladyfern', 'woodsorrel', 'bluebell', 'foxglove', 'nettle',
                      'daisy', 'poppy', 'yarrow', 'clover', 'plantain'];

/** How thickly herbs grow: 0 .. 1, thin on the trail and dry ground, `canopy` the cover overhead. */
export function herbDensity(x, z, y, canopy) {
    const patchy = 0.75 + 0.25 * fbm.genSingle2D(x * 0.04, z * 0.04, 0x4e7b);
    return 0.8 * patchy * smooth(1.0, 2.5, trailDistance(x, z)) * (1 - 0.5 * dryness(x, z)) * (1 - 0.3 * canopy * canopy);
}

// The ground: turf under the grass (scene_ground.glsl shades it as the sward,
// the litter under the trees and the soil), its vertex colour the ground's
// data where the grass field does not reach: (grass density, dryness, how
// closed the canopy is). `half` the mesh's half-size, N its vertices a side,
// `drop` how far it sits below the height function (the far ground, under
// the near one).
function groundMesh(cover, half, N, drop) {
    const cell = (2 * half) / (N - 1);
    const h = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = groundHeight(-half + i * cell, -half + j * cell) - drop;
    const m = Mesh.heightmapGrid(h, N, N, cell);
    const pos = m.positions, c = new Float32Array(m.vertexCount * 4);
    for (let v = 0; v < m.vertexCount; v++) {
        const x = pos[v * 3], z = pos[v * 3 + 2];
        c[v * 4] = cover(x, z);
        c[v * 4 + 1] = dryness(x, z);
        c[v * 4 + 2] = cover.canopy(x, z);
        c[v * 4 + 3] = herbDensity(x, z, 0, c[v * 4 + 2]);
    }
    m.colors = c;
    return m;
}

// --- the nursery ------------------------------------------------------------------

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

/** Grow the nursery: one broflora world, a grid of specimens on flat ground. */
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
    forest.grow = world.grow(Math.round(SIM_SECONDS / SIM_STEP), SIM_STEP, { cache: bro.app.cacheDir });
    return world;
}

// --- the forest -------------------------------------------------------------------

const BARK = { color: [0.2, 0.17, 0.14], roughness: 0.9 };
const LEAF = { color: [0.07, 0.13, 0.04], roughness: 0.7 };

// The forest is a node per kind of plant, each drawing its leaves in its
// form: the broadleaves, the needle conifers, the scale-leaf ones, the
// shrubs. forest.parts holds each {name, emit, trees, node}; forest.node,
// .emit and .trees are the broadleaves'.
export const forest = { world: null, emit: null, trees: null, node: null, parts: [], grass: null, ground: null, stats: {} };

const range = (a, n) => [...Array(n).keys()].map((i) => a + i);
const BROADLEAF = range(0, NURSERY.cols * NURSERY.rows);
const SHRUB_PLANTS = range(NURSERY.cols * NURSERY.rows + CONIFERS.length, SHRUBS.length);

// Conifers take the high ground and patches of their own: the share of
// the trees at a point that are conifers, and of those the scale-leaved.
export function coniferShare(x, z, y) {
    const patch = fbm.genSingle2D(x * 0.008, z * 0.008, 0xc0f);
    return Math.min(0.95, Math.max(0, 0.12 + 0.6 * smooth(-1, 5, y) + 0.9 * patch));
}

// Shrubs at the forest's edges (the glade's ragged rim), scattered in the
// glade, in patches of understorey under the trees; never on the trail.
export function shrubDensity(x, z) {
    const d = Math.hypot(x - GLADE.x, z - GLADE.z) + 8 * fbm.genSingle2D(x * 0.05, z * 0.05, 0x3);
    const ring = smooth(GLADE.r * 0.7, GLADE.r * 1.3, d);
    const edge = 4 * ring * (1 - ring);
    const under = ring * (0.015 + 0.15 * smooth(0.2, 0.55, fbm.genSingle2D(x * 0.03, z * 0.03, 0x5b)));
    // The meadow's edge: shrubs along it, a few out in the grass.
    const m = meadowShare(x, z), medge = 4 * m * (1 - m);
    return Math.min(1, 0.55 * edge + 0.05 * (1 - ring) + under * (1 - m) + 0.5 * medge + 0.01 * m) *
           smooth(3, 5, trailDistance(x, z));
}

function plant(trees, shrubs) {
    const area = [-FOREST, -FOREST, FOREST, FOREST];
    const t = bro.flora.plantForest(trees, {
        area, spacing: 6.5, jitter: 0.42, seed: 0x7ee5,
        ground: groundHeight, density: treeDensity, sink: 0.12,
        // The presets grow to their own heights (a fir ~12 m, a pine ~20):
        // drawn near them, the broadleaves at the nursery's 1.5.
        scale: [[PLANT_SCALE * 0.85, PLANT_SCALE * 1.2], [0.7, 0.95], [0.75, 1.0]],
        mix: (x, z, y) => { const c = coniferShare(x, z, y); return [1 - c, 0.82 * c, 0.18 * c]; },
    });
    const s = bro.flora.plantForest(shrubs, {
        area, spacing: 3.5, jitter: 0.45, seed: 0x5b0b,
        ground: groundHeight, density: shrubDensity, scale: [0.9, 1.3], sink: 0.05,
    });
    return [...t, s];
}

/** Every forest node: set the tier, the level of detail; the stats summed. */
export function setTier(t) { for (const p of forest.parts) p.node.setForestTier(t); }
export function setLod(lod) { for (const p of forest.parts) p.node.setForestLod(lod); }
export function forestStats() {
    let sum = null;
    for (const p of forest.parts) {
        const s = p.node.forestStats();
        if (!sum) { sum = JSON.parse(JSON.stringify(s)); continue; }
        for (const k of ['leaves', 'clumps', 'crowns']) sum.trees[k] += s.trees[k];
        for (const k of ['culled', 'leaves', 'vertices', 'shadowVertices', 'entries', 'draws', 'treeCount', 'specimenCount'])
            sum[k] += s[k];
    }
    return sum;
}

// Wall-clock ms: headless's performance.now rides the virtual clock.
export const wallNow = () => (globalThis.perf && perf.now ? perf.now() : performance.now());

function build() {
    const ms = forest.bootMs;
    let t = wallNow();
    const lap = (k) => { const n = wallNow(); ms[k] = n - t; t = n; };
    const w = forest.world;
    // One emit a node: the broadleaves and shrubs by plant, the conifers by
    // leaf form (each takes its form's spray defaults).
    const emits = [w.emitForest(Object.assign({ plants: BROADLEAF }, FOLIAGE)),
                   w.emitForest({ seed: FOLIAGE.seed, leafForm: 'needle' }),
                   w.emitForest({ seed: FOLIAGE.seed, leafForm: 'scale' }),
                   w.emitForest(Object.assign({ plants: SHRUB_PLANTS }, FOLIAGE))];
    lap('emit');
    const trees = plant(emits.slice(0, 3), emits[3]);
    lap('plant');
    const names = ['broadleaf', 'needle', 'scale', 'shrub'];
    forest.parts = emits.map((emit, k) => ({
        name: names[k], emit, trees: trees[k],
        node: scene.createForest(Object.assign({
            forest: emit, instances: trees[k],
            // No leaf: each node draws its form's own card at its species'
            // leaf size (a broadleaf's leaf, a conifer's spray, a shrub's
            // small leaf).
            doubleSided: true, subsurface: k === 0 || k === 3 ? 0.5 : 0.3, vertexColorTint: false,
            castsShadow: true, receivesShadow: true, barkColor: BARK.color, barkRoughness: BARK.roughness,
        }, LEAF)),
    }));
    forest.emit = emits[0];
    forest.trees = trees[0];
    forest.node = forest.parts[0].node;
    lap('node');
    // Thin grass goes on under the crowns (the canopy is closed only where
    // several overlap), clear at the trunks.
    const cover = bro.flora.forestCover(emits, { instances: trees, floor: 0.25, closed: 4 });
    forest.cover = cover;
    lap('cover');
    const groundOpts = { color: [1, 1, 1], metallic: 0, roughness: 1.0, receivesShadow: true };
    forest.ground = scene.createMesh(Object.assign({ data: groundMesh(cover, GROUND, 241, 0) }, groundOpts));
    forest.far = scene.createMesh(Object.assign({ data: groundMesh(cover, FAR, 181, 0.8) }, groundOpts));
    lap('ground');
    forest.grass = scene.createGrass({
        ground: forest.ground,
        area: [-GROUND, -GROUND, GROUND, GROUND],
        cell: 0.6,
        dry: dryness,
        density: cover,
        floor: cover.canopy,
        // The understory and the glade's flowers: each species finds its
        // own light (ferns and wood sorrel under the crowns, the meadow
        // flowers in the glade, foxgloves and nettles at its edges), thinner
        // on the trail and where the ground is dry.
        // The plants to 24 m (past that the blades and turf stand in): a
        // tenth of a millisecond under 30 m's at the trace's low views.
        herbs: { species: HERBS, density: herbDensity, range: HERB_RANGE },
        tall: (x, z) => 1.1 - 0.4 * dryness(x, z),
        // Blades to 150 m (the glade's far side from its middle); past
        // them the turf, shaded as the grass, stands in.
        range: GRASS_RANGE,
        turf: [forest.ground, forest.far],
        castsShadow: true,
    });
    lap('grass');
    forest.stats = { specimens: emits.reduce((a, e) => a + e.specimenCount, 0),
                     trees: trees.reduce((a, t) => a + t.length / 8, 0),
                     leaves: emits.reduce((a, e) => a + e.leafCount, 0) };
}

// --- wind ---------------------------------------------------------------------------

export const WINDS = {
    still: { label: 'Still', wind: { strength: 0, speed: 0, gust: 0 } },
    breeze: { label: 'Breeze', wind: { direction: [1, 0, 0.3], strength: 0.05, frequency: 1.1, speed: 2.5, gust: 1 } },
    gusty: { label: 'Gusty', wind: { direction: [1, 0, 0.3], strength: 0.12, frequency: 1.4, speed: 4.5, gust: 1.6 } },
};
export function setWind(key) {
    forest.wind = key;
    scene.setWind(WINDS[key].wind);
}

// --- the flight ---------------------------------------------------------------------

// From high over the canopy with the low sun behind, down toward the glade,
// skimming the crowns, dropping into the glade, across it and in among the
// trunks past its far edge, turning to look back at the glade through
// them. Keys are [time s, eye x, height above ground, eye z, look x, look
// height, look z].
export const FLIGHT = [
    [0, 240, 150, 130, 12, 0, 18],
    [7, 160, 80, 85, 12, 5, 18],
    [13, 90, 32, 52, 0, 8, 18],
    [18, 54, 15, 32, -5, 5, 20],
    [22, 30, 5, 22, -12, 3, 18],
    [26, -6, 1.8, 16, -40, 2.2, 12],
    [29, -20, 1.7, 13, -24, 2.2, -20],
    [32, -27, 1.7, 12, 10, 2.6, 22],
    [34, -28, 1.7, 12, 10, 2.6, 22],
];
export const FLIGHT_SECONDS = FLIGHT[FLIGHT.length - 1][0];

function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
/** The flight's eye and look-at point at time t (s). */
export function flightAt(t) {
    const K = FLIGHT, n = K.length;
    t = Math.max(0, Math.min(FLIGHT_SECONDS, t));
    let i = 0;
    while (i < n - 2 && t > K[i + 1][0]) i++;
    const u = (t - K[i][0]) / (K[i + 1][0] - K[i][0]);
    const e = u * u * (3 - 2 * u) * 0.35 + u * 0.65;   // ease a little at the keys
    const at = (c) => catmull(K[Math.max(0, i - 1)][c], K[i][c], K[i + 1][c], K[Math.min(n - 1, i + 2)][c], e);
    const ex = at(1), ez = at(3), lx = at(4), lz = at(6), h = at(2);
    const eg = groundHeight(ex, ez);
    // High up, the look height is over the ground it looks at; near the
    // ground, over the eye's own, so a level look stays level on a slope.
    const lg = groundHeight(lx, lz) + (eg - groundHeight(lx, lz)) * smooth(20, 4, h);
    return { eye: [ex, eg + h, ez], look: [lx, lg + at(5), lz] };
}

export const flight = { on: false, t: 0, speed: 1 };
// A view held off the flight (a shot with its own eye and look-at point):
// { eye, look }, world.
export const still = { view: null };
/** Fly from time t (s); land() hands the view to the orbit camera. */
export function fly(t) {
    flight.on = true;
    flight.t = t || 0;
    flight.speed = 1;
    still.view = null;
    forest.shot = null;
}
/** Hold the view at eye, looking at look (world), off the flight. */
export function holdView(eye, look) {
    flight.on = false;
    still.view = { eye, look };
}
/** Stop the flight (or a held view) where it is, the orbit camera taking over its view. */
export function land() {
    if (!flight.on && !still.view) return;
    const { eye, look } = flight.on ? flightAt(flight.t) : still.view;
    flight.on = false;
    still.view = null;
    const d = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]];
    const dist = Math.hypot(d[0], d[1], d[2]);
    vp.reframe(look, dist, { yaw: Math.atan2(-d[0], -d[2]), pitch: Math.asin(d[1] / dist) });
}
vp.onFrame((dt) => { if (flight.on) flight.t = Math.min(FLIGHT_SECONDS, flight.t + dt * flight.speed); });
vp.onView((view) => {
    const f = flight.on ? flightAt(flight.t) : still.view;
    if (!f) return;
    view.position = f.eye;
    view.target = f.look;
    view.up = [0, 1, 0];
});

// --- views --------------------------------------------------------------------------

// The meadow seen from its edge nearest the glade, across it to the trees
// on its far side: meadowAt(d) is the point d m out from that edge (world
// x, z), MEADOW_LOOK the way across.
export const MEADOW_LOOK = (() => {
    const dx = GLADE.x - MEADOW.x, dz = GLADE.z - MEADOW.z, l = Math.hypot(dx, dz);
    return [-dx / l, -dz / l];
})();
const MEADOW_EDGE = [MEADOW.x - MEADOW_LOOK[0] * MEADOW.r * 0.8, MEADOW.z - MEADOW_LOOK[1] * MEADOW.r * 0.8];
export function meadowAt(d) {
    return [MEADOW_EDGE[0] + MEADOW_LOOK[0] * d, MEADOW_EDGE[1] + MEADOW_LOOK[1] * d];
}

// The flight's views (t, s), and two of their own (`view`: eye x, height
// over the ground, z, look x, height, z).
export const SHOTS = {
    above:   { label: 'Above', t: 0 },
    canopy:  { label: 'Over the canopy', t: 13 },
    skim:    { label: 'Skimming', t: 18 },
    glade:   { label: 'The glade', t: 23 },
    trunks:  { label: 'Among the trunks', t: 34 },
    meadow:  { label: 'The meadow', view: [meadowAt(0)[0], 1.7, meadowAt(0)[1], meadowAt(150)[0], 2.5, meadowAt(150)[1]] },
    understory: { label: 'Under the trees', view: [60, 1.7, -40, 80, 2.2, -60] },
};
/** The world eye and look-at point of a view [x, h, z, lx, lh, lz] (heights over the ground). */
export function viewPoints(v) {
    return { eye: [v[0], groundHeight(v[0], v[2]) + v[1], v[2]], look: [v[3], groundHeight(v[3], v[5]) + v[4], v[5]] };
}
export function setShot(key) {
    const s = SHOTS[key];
    forest.shot = key;
    if (s.view) {
        const { eye, look } = viewPoints(s.view);
        holdView(eye, look);
        return;
    }
    still.view = null;
    flight.on = true;
    flight.t = s.t;
    flight.speed = 0;
}

// --- boot ---------------------------------------------------------------------------

sky.apply('golden');
setWind('breeze');
setShot('above');
forest.bootMs = {};
const t0 = wallNow();
forest.world = growNursery();
forest.growMs = forest.bootMs.grow = wallNow() - t0;
build();
forest.bootMs.total = wallNow() - t0;
console.log('forest boot ms: ' + Object.entries(forest.bootMs).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', '));
