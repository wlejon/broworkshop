// The biomes world: a rolling ground and the plants on it, the sky, and the
// views the capture script and the panel share. The plants are bro.scene's
// plants node: species described here, every plant built on the GPU.
import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";
import { daylight, SKY } from "/lib/kit/sky.js";
import { herbModule } from "/lib/herbs/index.js";
import { swardModule } from "/lib/sward/index.js";
import { treeModule, treeSpecies } from "/lib/trees/index.js";
import { TEMPERATE } from "/lib/trees/temperate.js";

export const HALF = 8000;         // half-size of the world (m)

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
const DRY = fbm(1 / 0.016, 4, 3);
const BROAD_DRY = fbm(1 / 0.0025, 2, 17);
const HERB_PATCHES = affine(N('Value', { 'Feature Scale': 20, 'Seed Offset': 10 }), 0.5, 0.5);

// The land: the height tree, and a surface from the same cover, dryness and
// herb trees as GLSL: meadow green to golden, forest floor to dark loam
// under the trees; the sward thinning under them, drying and shortening
// where the ground is dry; the herbs in patches everywhere.
function buildGround() {
    const surface = COVER.glsl({ name: 'coverField' }) + DRY.glsl({ name: 'dryField' }) + BROAD_DRY.glsl({ name: 'broadDryField' }) +
        HERB_PATCHES.glsl({ name: 'herbField' }) + `
LandSurface landSurface(LandPoint q) {
    float cover = coverField(q.p, LAND_SEED), dry = dryField(q.p, LAND_SEED);
    // The sward dries on the rises and the slopes and stays lush in the
    // hollows, and over whole hillsides by the broad field: what still
    // shows from high up, where the patches are a texel.
    float dried = dry + 0.004 * q.height + 0.8 * (1.0 - q.normal.y) + 0.35 * (broadDryField(q.p, LAND_SEED) - 0.5);
    vec3 open = vec3(0.10 + 0.10 * dry, 0.15 + 0.06 * dry, 0.035);
    LandSurface s = landSurfaceOf(open * vec3(1.0 - 0.55 * cover, 1.0 - 0.55 * cover, 1.0 - 0.3 * cover) +
                                  vec3(0.05, 0.05, 0.025) * cover);
    s.cover = vec4(1.0 - 0.75 * cover, clamp((dried - 0.3) * 1.4, 0.0, 0.75), 0.8 + 0.6 * (1.0 - dry), cover);
    s.herbs = 0.25 + 0.6 * herbField(q.p, LAND_SEED);
    return s;
}
`;
    return scene.createLand({ height: HEIGHT, seed: SEED, extent: HALF, surface });
}

// --- the plants ---------------------------------------------------------------------

// The temperate wood's six (lib/trees/temperate.js): 0 broadleaf, 1 birch,
// 2 conifer, 3 shrub, 4 oak, 5 lime.
export const SPECIES = TEMPERATE;

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
    // Out in the open: shrubs in loose groups and the odd lone tree, as
    // grazed ground has, so a meadow seen from a hillside or the air is
    // dotted, not a bare lawn; never in the glade's or the meadow's heart.
    const groups = clamp01(affine(fbm(1 / 0.025, 2, 13), 4.0, -0.45 * 4.0));
    const meadowHeart = clamp01(affine(radii(MEADOW), 3, -0.55 * 3));
    const open = {
        spacing: 7, jitter: 1.0, sink: 0.05, seed: 13,
        chance: mul(mul(mul(mul(sub(1, COVER), add(mul(groups, 0.5), 0.015)), SHRUB_INSIDE), clearing), meadowHeart),
        species: [{ species: 3, weight: 0.8 }, { species: 0, weight: 0.12 }, { species: 2, weight: 0.08 }],
        scale: 1.0, scaleVariety: 0.35, tintVariety: 1.0,
    };
    return { ground: HEIGHT, seed: SEED, range: 6000, layers: [trees, shrubs, open] };
}

export const ground = buildGround();
export const grass = scene.createGrass({
    ground, turf: true,
    sward: swardModule({ lush: [0.08, 0.15, 0.035] }),
    herbs: herbModule({ species: ['bracken', 'woodsorrel', { preset: 'daisy', abundance: 1.5 }, 'poppy'] }),
});
// The world drawn as itself to 12 km, past its edge from anywhere in it
// (far off the plants cost next to nothing: 0.01-0.02 ms against 6 km on
// the high views; the grass reaches its own 150 m whatever the band); the
// land's canopy past that.
scene.setBands({ real: 12000 });
export const plants = scene.createPlants({
    module: treeModule(), species: SPECIES.map(treeSpecies), rules: rules(), receivesShadow: true, land: ground,
});
plants.castsShadow = true;

// --- views --------------------------------------------------------------------------

const at = (x, z, up) => [x, groundHeight(x, z) + up, z];
export const SHOTS = {
    glade:  { label: 'Glade', eye: () => at(GLADE.x - 6, GLADE.z - 8, 1.7), look: () => at(GLADE.x + 30, GLADE.z + 40, 6) },
    edge:   { label: 'Forest edge', eye: () => at(MEADOW.x + 40, MEADOW.z + 30, 1.7), look: () => at(MEADOW.x + 120, MEADOW.z + 110, 8) },
    meadow: { label: 'Meadow', eye: () => at(MEADOW.x - 30, MEADOW.z - 40, 2.0), look: () => at(MEADOW.x + 80, MEADOW.z + 60, 4) },
    mount:  { label: 'Mounted', eye: () => at(MEADOW.x - 70, MEADOW.z + 10, 4.5), look: () => at(MEADOW.x + 10, MEADOW.z + 70, 1) },
    canopy: { label: 'Canopy', eye: () => at(GLADE.x, GLADE.z, 34), look: () => at(GLADE.x + 120, GLADE.z + 140, 0) },
    above:  { label: 'Above', eye: () => at(0, 0, 160), look: () => at(220, 260, 0) },
    flyover: { label: 'Flyover', eye: () => at(-300, -300, 420), look: () => at(150, 150, 0) },
    high:   { label: 'High', eye: () => at(-900, -900, 1500), look: () => at(700, 700, 0) },
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
