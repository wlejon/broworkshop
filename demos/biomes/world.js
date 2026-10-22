// The biomes world: a rolling ground and the plants on it, the sky, and the
// views the capture script and the panel share. The plants are bro.scene's
// plants node: species described here, every plant built on the GPU.
import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";
import { daylight, SKY } from "/lib/kit/sky.js";
import { herbModule } from "/lib/herbs/index.js";
import { swardModule } from "/lib/sward/index.js";

export const HALF = 700;          // half-size of the world (m)
const CELL = 4;                   // ground cell (m)

export const vp = sceneViewport('#stage', {
    orbit: { target: [0, 4, 0], dist: 60, fov: 50, near: 0.1, far: 6000, rot: orbitRotation(Math.PI * 0.75, -0.3) },
    controls: { orbitButton: 0, panButton: 2, minDist: 1, maxDist: 3000 },
});
export const { scene } = vp;

// The atmosphere's sky, the real sun and a metered exposure: one model from
// the glade to the flyover.
const PRESETS = { afternoon: SKY.afternoon, golden: SKY.golden };
export const sky = daylight(scene, { presets: PRESETS, order: ['afternoon', 'golden'], pcf: 3, ground: [0.10, 0.13, 0.05] });

// --- the land ------------------------------------------------------------------------
//
// Every field is a FastNoise node tree: the engine places the plants from
// the same trees on its own threads (the plants node's rules), and the
// script reads them for the ground, the grass and the views.

const SEED = 1337;
const N = (type, props = {}) => {
    const n = FastNoise.create(type);
    for (const k in props) n.set(k, props[k]);
    return n;
};
const add = (a, b) => N('Add', { LHS: a, RHS: b });
const sub = (a, b) => N('Subtract', { LHS: a, RHS: b });   // (either side a node or a number)
const mul = (a, b) => N('Multiply', { LHS: a, RHS: b });
const clamp01 = (a) => N('Min', { LHS: N('Max', { LHS: a, RHS: 0 }), RHS: 1 });
// a * k + c
const affine = (a, k, c) => add(mul(a, k), c);
// Value-noise fbm of `octaves` with a feature every `size` metres, 0 ..
// (1 - 0.5^octaves) as the octaves' amplitudes sum.
const fbm = (size, octaves, seed) => {
    const n = N('FractalFBm', { Source: N('Value', { 'Feature Scale': size, 'Seed Offset': seed }), Octaves: octaves,
                               Lacunarity: 2.03, Gain: 0.5 });
    const top = 1 - Math.pow(0.5, octaves);
    return affine(n, top / 2, top / 2);
};
// A disc's distance from its centre in radii.
const radii = (c) => mul(N('DistanceToPoint', { 'Distance Function': 'Euclidean', 'Point X': c.x, 'Point Y': c.z }), 1 / c.r);
const sampled = (field) => (x, z) => field.genSingle2D(x, z, SEED);

// The glade the walk starts in, and a meadow down the slope from it.
export const GLADE = { x: 20, z: 30, r: 28 };
export const MEADOW = { x: -160, z: -120, r: 110 };

const HEIGHT = add(affine(fbm(1 / 0.0024, 4, 0), 90, -45), affine(fbm(1 / 0.009, 3, 1), 14, -7));
export const groundHeight = sampled(HEIGHT);

// 0 open .. 1 forest: groves with clearings, the glade and meadow kept open.
const COVER = mul(mul(clamp01(affine(fbm(1 / 0.006, 3, 2), 3.2, -0.36 * 3.2)),
                      clamp01(affine(radii(GLADE), 2.5, -0.85 * 2.5))),
                  clamp01(affine(radii(MEADOW), 1.6, -0.8 * 1.6)));
export const forestCover = sampled(COVER);
const DRY = fbm(1 / 0.02, 2, 3);
const dryness = sampled(DRY);
const herbPatches = sampled(affine(N('Value', { 'Feature Scale': 20, 'Seed Offset': 10 }), 0.5, 0.5));

function buildGround() {
    const n = Math.round((2 * HALF) / CELL) + 1;
    // (Row by row: x along a row, z down the rows, as heightmapGrid reads it.)
    const h = HEIGHT.genUniformGrid2D(-HALF, -HALF, n, n, CELL, SEED);
    const mesh = Mesh.heightmapGrid(h, n, n, CELL);
    const pos = mesh.positions;
    const colors = new Float32Array((pos.length / 3) * 4);
    for (let v = 0; v < pos.length / 3; v++) {
        const x = pos[v * 3], z = pos[v * 3 + 2];   // (the grid is centred on the origin)
        const cover = forestCover(x, z);
        const dry = dryness(x, z);
        // Meadow green to golden, forest floor to dark loam under the trees.
        const r = 0.10 + 0.10 * dry, g = 0.15 + 0.06 * dry, b = 0.035;
        colors[v * 4] = r * (1 - 0.55 * cover) + 0.05 * cover;
        colors[v * 4 + 1] = g * (1 - 0.55 * cover) + 0.05 * cover;
        colors[v * 4 + 2] = b * (1 - 0.3 * cover) + 0.025 * cover;
        colors[v * 4 + 3] = 1;
    }
    mesh.colors = colors;
    const node = scene.createMesh({ data: mesh, roughness: 0.95 });
    node.receivesShadow = true;
    return node;
}

// --- the plants ---------------------------------------------------------------------

export const SPECIES = [
    // 0 a broadleaf: a big round crown of deep green lobes.
    { height: 15, base: 0.2, radius: 5.2, shape: 0.05, lobes: 16, lobeSize: 0.52, leafLength: 0.34, leafWidth: 0.55,
      elements: 8000, trunk: 0.32, spread: 0.85, droop: 0.15,
      light: [0.19, 0.32, 0.07], dark: [0.02, 0.05, 0.025], hueVariety: 0.4, glow: 0.9, glowColor: [1.0, 0.9, 0.35],
      bark: [0.12, 0.10, 0.08], density: 0.9 },
    // 1 a birch-like tree: tall, light, airy, pale bark.
    { height: 14, base: 0.4, radius: 3.0, shape: 0.15, lobes: 11, lobeSize: 0.5, leafLength: 0.24, leafWidth: 0.6,
      elements: 4800, trunk: 0.16, spread: 0.7, droop: 0.45,
      light: [0.30, 0.42, 0.09], dark: [0.05, 0.09, 0.03], hueVariety: 0.3, glow: 1.1, glowColor: [1.0, 0.95, 0.45],
      bark: [0.55, 0.52, 0.47], density: 0.6 },
    // 2 a conifer: a dark cone of drooping needle tiers.
    { height: 18, base: 0.1, radius: 4.4, shape: 0.95, lobes: 34, lobeSize: 0.36, leafLength: 0.32, leafWidth: 0.42,
      elements: 6500, trunk: 0.28, spread: 0.95, droop: 0.5, needle: 1,
      light: [0.10, 0.20, 0.08], dark: [0.015, 0.04, 0.025], hueVariety: 0.18, glow: 0.35, glowColor: [0.8, 0.9, 0.4],
      bark: [0.16, 0.10, 0.07], density: 0.8 },
    // 3 a shrub.
    { height: 1.8, base: 0.05, radius: 1.3, shape: 0.0, lobes: 7, lobeSize: 0.55, leafLength: 0.18, leafWidth: 0.55,
      elements: 1600, trunk: 0.04, spread: 0.6, droop: 0.1,
      light: [0.27, 0.40, 0.08], dark: [0.04, 0.08, 0.025], hueVariety: 0.35, glow: 0.8, glowColor: [1.0, 0.9, 0.35],
      bark: [0.12, 0.09, 0.07], density: 0.7 },
    // 4 an oak-like tree: broad and low, its crown a few big dark lobes,
    // bluer than the broadleaf.
    { height: 13, base: 0.22, radius: 6.2, shape: 0.0, lobes: 12, lobeSize: 0.6, leafLength: 0.3, leafWidth: 0.6,
      elements: 8000, trunk: 0.42, spread: 1.0, droop: 0.1,
      light: [0.13, 0.25, 0.08], dark: [0.015, 0.04, 0.025], hueVariety: 0.3, glow: 0.7, glowColor: [0.9, 0.95, 0.4],
      bark: [0.10, 0.09, 0.08], density: 1.0 },
    // 5 a lime-like tree: tall and rounded, a fresh yellow green.
    { height: 17, base: 0.25, radius: 4.6, shape: 0.1, lobes: 15, lobeSize: 0.5, leafLength: 0.32, leafWidth: 0.7,
      elements: 7000, trunk: 0.3, spread: 0.8, droop: 0.25,
      light: [0.30, 0.40, 0.07], dark: [0.04, 0.08, 0.02], hueVariety: 0.3, glow: 1.0, glowColor: [1.0, 0.95, 0.4],
      bark: [0.14, 0.12, 0.10], density: 0.8 },
];

// What grows where: two layers of candidates over the whole world, each
// kept by the fields where it stands (scene.createPlants' rules). The
// world ends with its ground, a few metres in from its edge.
const INSIDE = clamp01(affine(N('DistanceToPoint', { 'Distance Function': 'Max Axis' }), -1, HALF - 4));
const SHRUB_INSIDE = clamp01(affine(N('DistanceToPoint', { 'Distance Function': 'Max Axis' }), -1, HALF - 2));
const step01 = (a, at, width) => clamp01(affine(a, 1 / width, 0.5 - at / width));   // 0 below at, 1 above, over width

function rules() {
    // The canopy: conifers where the pine noise is up, birches in their
    // patches, and the broadleaves in stands of a kind, mixed at their
    // margins: oak in one, lime in the next, the common broadleaf between.
    const conifer = clamp01(affine(fbm(1 / 0.004, 2, 4), 2.2, -0.35 * 2.2));
    const rest = sub(1, conifer);
    const birch = mul(rest, mul(step01(fbm(1 / 0.011, 2, 5), 0.62, 0.04), 0.6));
    const broad = mul(rest, sub(1, mul(step01(fbm(1 / 0.011, 2, 5), 0.62, 0.04), 0.6)));
    const kind = fbm(1 / 0.008, 2, 6);
    const oak = step01(mul(kind, -1), -0.42, 0.12), lime = step01(kind, 0.58, 0.12);
    // Stands of an age with every tree its own: old giants, young ones in
    // their gaps, the edge's lower than the core's; a stand's tone (its
    // soil, its age) shared, each tree a little its own.
    const age = fbm(1 / 0.02, 2, 7);
    const trees = {
        spacing: 5.5, jitter: 0.9, sink: 0.1, seed: 11,
        chance: mul(mul(COVER, 0.95), INSIDE),
        species: [
            { species: 2, weight: conifer },
            { species: 1, weight: birch },
            { species: 4, weight: mul(broad, oak) },
            { species: 5, weight: mul(broad, lime) },
            { species: 0, weight: mul(broad, sub(1, add(oak, lime))) },
        ],
        scale: mul(affine(age, 0.75, 0.65), affine(COVER, 0.25, 0.75)), scaleVariety: 0.22,
        tint: affine(fbm(1 / 0.015, 2, 8), 1.6, -0.8), tintVariety: 0.4,
    };
    // Shrubs in thickets along the forest's edges and a few in its
    // understorey; out in the open only where a thicket has crept out,
    // and never in the glade's heart, where the walk starts.
    const edge = mul(mul(COVER, sub(1, COVER)), 4);
    const thicket = N('Max', { LHS: affine(fbm(1 / 0.05, 2, 9), 3.5, -0.45 * 3.5), RHS: 0 });
    const clearing = clamp01(affine(radii(GLADE), 4, -0.4 * 4));
    const shrubs = {
        spacing: 2.4, jitter: 1.0, sink: 0.05, seed: 12,
        chance: mul(mul(mul(thicket, add(add(mul(edge, 0.75), mul(COVER, 0.15)), 0.05)), SHRUB_INSIDE), clearing),
        species: [3], scale: 1.0, scaleVariety: 0.4, tintVariety: 1.0,
    };
    return { ground: HEIGHT, seed: SEED, range: 2000, layers: [trees, shrubs] };
}

export const ground = buildGround();
export const grass = scene.createGrass({
    ground, turf: true, cell: 2,
    sward: swardModule(),
    density: (x, z) => 1 - 0.75 * forestCover(x, z),
    dry: (x, z) => Math.max(0, dryness(x, z) - 0.35) * 1.4,
    tall: (x, z) => 0.8 + 0.6 * (1 - dryness(x, z)),
    floor: (x, z) => forestCover(x, z),
    herbs: {
        ...herbModule({ species: ['bracken', 'woodsorrel', { preset: 'daisy', abundance: 1.5 }, 'poppy'] }),
        density: (x, z, y, canopy) => 0.25 + 0.6 * herbPatches(x, z),
    },
});
export const plants = scene.createPlants({ species: SPECIES, rules: rules(), receivesShadow: true });
plants.castsShadow = true;

// --- views --------------------------------------------------------------------------

const at = (x, z, up) => [x, groundHeight(x, z) + up, z];
export const SHOTS = {
    glade:  { label: 'Glade', eye: () => at(GLADE.x - 6, GLADE.z - 8, 1.7), look: () => at(GLADE.x + 30, GLADE.z + 40, 6) },
    edge:   { label: 'Forest edge', eye: () => at(MEADOW.x + 40, MEADOW.z + 30, 1.7), look: () => at(MEADOW.x + 120, MEADOW.z + 110, 8) },
    meadow: { label: 'Meadow', eye: () => at(MEADOW.x - 30, MEADOW.z - 40, 2.0), look: () => at(MEADOW.x + 80, MEADOW.z + 60, 4) },
    canopy: { label: 'Canopy', eye: () => at(GLADE.x, GLADE.z, 34), look: () => at(GLADE.x + 120, GLADE.z + 140, 0) },
    above:  { label: 'Above', eye: () => at(0, 0, 160), look: () => at(220, 260, 0) },
    flyover: { label: 'Flyover', eye: () => at(-300, -300, 420), look: () => at(150, 150, 0) },
};

export const still = { view: null };
export function holdView(eye, look) { still.view = { eye, look }; }
export function setShot(name) {
    const s = SHOTS[name];
    if (s) holdView(s.eye(), s.look());
}
export function land() {
    if (!still.view) return;
    const { eye, look } = still.view;
    still.view = null;
    const d = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]];
    const dist = Math.hypot(d[0], d[1], d[2]);
    vp.reframe(look, dist, { yaw: Math.atan2(-d[0], -d[2]), pitch: Math.asin(d[1] / dist) });
}
vp.onView((view) => {
    if (!still.view) return;
    view.position = still.view.eye;
    view.target = still.view.look;
    view.up = [0, 1, 0];
});

scene.setWind({ direction: [0.8, 0, 0.6], speed: 3, gust: 1.2 });
scene.setDither(true);
// The ambient through the probe grid: the sky under the crowns, the light
// the ground and the leaves send back.
scene.setProbeGrid(true);
sky.apply('afternoon');
setShot('glade');
