// grove — a handful of grown broadleaf trees and shrubs on a meadow at golden
// hour, swaying in bro.scene's wind: the showcase for bro.flora's motion.
//
// broflora grows the plants once at boot (a few seconds of sim time on a
// fixed step), then they are drawn two ways:
//
//   gpu    the default: a branch-tube node and a leaf-scatter node, the
//          geometry built in the vertex shaders from per-segment records
//   mesh   the same plants as meshes: emitMesh (bark), emitFoliageMesh
//          (leaf cards) and emitBloomMesh
//
// Neither path does anything about wind: the emitters write the per-vertex
// plant data and bro.scene sways it. The meadow is bro.scene's grass, baked
// once from the ground mesh with lush to sun-dried patches, bending in the
// same gusts; a ball rolls a loop through it as a grass mover, parting and
// flattening it. main.js mounts the panel; tests and the capture tool import
// this module (never main.js).

import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";
import { daylight } from "/lib/kit/sky.js";

export const GROUND = 70;          // half-size of the ground, metres
export const PLANT_SCALE = 1.5;    // node scale: broflora grows ~5 m trees, drawn ~7.5 m

export const vp = sceneViewport('#stage', {
    orbit: { target: [0, 4, 0], dist: 24, fov: 45, near: 0.1, far: 400, rot: orbitRotation(Math.PI * 0.5, -0.12) },
    controls: { orbitButton: 0, panButton: 2, minDist: 2, maxDist: 150 },
});
export const { scene } = vp;
export const sky = daylight(scene, { order: ['golden', 'noon', 'dawn'], cascades: 3, atlas: 4096, pcf: 3 });
sky.setScale(1.7);   // the haze sits past the grove, on the hills
// Leaves are cut-out silhouettes in geometry, not alpha-tested textures, so
// multisampling is what smooths their edges (and the twigs').
scene.setMSAA(4);
vp.onFrame((dt) => sky.update(dt));

// --- the ground -------------------------------------------------------------------

// A meadow in a shallow bowl: gentle swells where the plants stand, rising to
// low hills all round so the view ends on land rather than an edge. Coloured
// from lush to sun-dried by a second noise, darker in the hollows.
const simplex = FastNoise.create('Simplex');
simplex.set('Feature Scale', 1);
const swell = FastNoise.create('FractalFBm');
swell.set('Source', simplex);
swell.set('Octaves', 4);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Ground height (metres) at world x, z. */
export function groundHeight(x, z) {
    const n = swell.genSingle2D(x * 0.035, z * 0.035, 0x9a0d);
    const r = Math.hypot(x, z);
    const hills = smooth(20, 62, r);
    return 0.7 * n + hills * hills * (18 + 8 * swell.genSingle2D(x * 0.012, z * 0.012, 0x41)) - 0.2;
}

/** How sun-dried the meadow is at x, z: 0 lush .. 1 straw. Patches, drier up the hills. */
export function dryness(x, z) {
    const patch = smooth(-0.35, 0.45, swell.genSingle2D(x * 0.17, z * 0.17, 0x77));
    const broad = smooth(-0.2, 0.5, swell.genSingle2D(x * 0.04, z * 0.04, 0x3d));
    const up = smooth(25, 60, Math.hypot(x, z));
    return Math.min(1, 0.75 * patch * broad + 0.1 * broad + 0.3 * up);
}

// The ground is the soil under the grass: dark and cooler than the blades
// (the shade at the foot of a sward, not a lit floor), so the gaps between
// blades read as depth.
function groundMesh() {
    const N = 141, cell = (2 * GROUND) / (N - 1);
    const h = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = groundHeight(-GROUND + i * cell, -GROUND + j * cell);
    const m = Mesh.heightmapGrid(h, N, N, cell);
    const pos = m.positions, nrm = m.normals, c = new Float32Array(m.vertexCount * 4);
    const lush = [0.028, 0.038, 0.022], dry = [0.085, 0.066, 0.036], earth = [0.16, 0.13, 0.08];
    for (let v = 0; v < m.vertexCount; v++) {
        const x = pos[v * 3], z = pos[v * 3 + 2];
        const patch = dryness(x, z);
        const fleck = 0.88 + 0.24 * swell.genSingle2D(x * 0.9, z * 0.9, 0x5);
        const hollow = 0.75 + 0.25 * smooth(-0.6, 0.4, groundHeight(x, z) - 0.25 * (groundHeight(x + 3, z) + groundHeight(x - 3, z) + groundHeight(x, z + 3) + groundHeight(x, z - 3)) + 0.2);
        const steep = smooth(0.85, 0.6, nrm[v * 3 + 1]);
        for (let k = 0; k < 3; k++) {
            const g = lush[k] + (dry[k] - lush[k]) * patch;
            c[v * 4 + k] = (g + (earth[k] - g) * steep) * fleck * hollow;
        }
        c[v * 4 + 3] = 1;
    }
    m.colors = c;
    return m;
}

export const ground = scene.createMesh({
    data: groundMesh(),
    color: [1, 1, 1], metallic: 0, roughness: 1.0, receivesShadow: true,
});

// --- the grass ----------------------------------------------------------------------

// Blades over the whole ground, from bro.scene: the field is baked once from
// the ground mesh, with where it grows (thin at the trunks), how dry it is
// (the same patches the soil is coloured by) and how tall (lush hollows grow
// tall, dry rises short).
function growGrass(world) {
    return scene.createGrass({
        ground,
        cell: 0.5,
        dry: dryness,
        density: world.groundCover({ scale: PLANT_SCALE }),   // thin in the crowns' shade, clear at the trunks
        tall: (x, z) => 1.15 - 0.45 * dryness(x, z),
        castsShadow: true,
    });
}

// --- the roller ---------------------------------------------------------------------

// A ball rolling a loop through the meadow: a grass mover, so the blades part
// round it and lie flat in its wake, rising again over the next seconds.
function ballMesh() {
    const m = Mesh.sphere(ROLLER.radius, 24, 16);
    const pos = m.positions, c = new Float32Array(m.vertexCount * 4);
    for (let v = 0; v < m.vertexCount; v++) {
        const band = Math.abs(pos[v * 3 + 1]) < ROLLER.radius * 0.25 || Math.abs(pos[v * 3]) < ROLLER.radius * 0.18;
        c.set(band ? [0.85, 0.8, 0.7, 1] : [0.55, 0.1, 0.07, 1], v * 4);
    }
    m.colors = c;
    return m;
}
export const ROLLER = { radius: 0.32, speed: 1.6, centre: [-2, 15.5], rx: 6, rz: 2.2 };
// It starts just short of the 'ground' shot's spot, so a capture there sees it pass.
export const roller = { node: null, s: 3.85, running: true, q: [0, 0, 0, 1] };
/** The roller's path at arc parameter a (radians): a loop through the open meadow in front of the grove. */
export function rollerAt(a) {
    return [ROLLER.centre[0] + ROLLER.rx * Math.cos(a), ROLLER.centre[1] + ROLLER.rz * Math.sin(a) + 1.2 * Math.sin(2 * a)];
}
function placeRoller(dt) {
    if (!roller.node) return;
    const [x0, z0] = rollerAt(roller.s);
    if (roller.running) roller.s += dt * ROLLER.speed / Math.hypot(ROLLER.rx, ROLLER.rz) * 1.4;
    const [x, z] = rollerAt(roller.s);
    const dx = x - x0, dz = z - z0, d = Math.hypot(dx, dz);
    if (d > 1e-6) {
        // Roll: turn about the horizontal axis across the motion by d / r.
        const ax = dz / d, az = -dx / d, h = 0.5 * d / ROLLER.radius;
        const s = Math.sin(h), r = [ax * s, 0, az * s, Math.cos(h)], q = roller.q;
        roller.q = [
            r[3] * q[0] + r[0] * q[3] + r[1] * q[2] - r[2] * q[1],
            r[3] * q[1] - r[0] * q[2] + r[1] * q[3] + r[2] * q[0],
            r[3] * q[2] + r[0] * q[1] - r[1] * q[0] + r[2] * q[3],
            r[3] * q[3] - r[0] * q[0] - r[1] * q[1] - r[2] * q[2],
        ];
        roller.node.rotation = roller.q;
    }
    roller.node.position = [x, groundHeight(x, z) + ROLLER.radius, z];
}
vp.onFrame((dt) => placeRoller(Math.min(dt, 0.1)));

// --- the plants -------------------------------------------------------------------

// A spreading broadleaf (round crown on a short clear trunk), a vase-shaped
// one, and a dome shrub with no trunk at all.
const COMMON = {
    pipeExp: 2.0, leafDiameter: 0.028,
    shadeTolerance: 0.35, moduleMatureAge: 0.6, rootVigorMax: 4.0, apicalControl: 0.35,
    apicalControlMature: 0.3, individualVariation: 0.2, maxAge: 400, seedingRadius: 0.0,
};
export const SPECIES = {
    spreading: Object.assign({}, COMMON, { growthScale: 2.5, orthotropy: 0.55, tropismG2: 0.05 }),
    vase: Object.assign({}, COMMON, { growthScale: 2.0, orthotropy: 0.7, tropismG2: 0.03 }),
    shrub: Object.assign({}, COMMON, { growthScale: 2.0, orthotropy: 0.4, tropismG2: 0.12, shadeTolerance: 0.6 }),
};

/** Where each plant stands (world metres, after PLANT_SCALE) and what it is. */
export const PLANTS = [
    { x: -8.0, z: -1.5, kind: 'spreading' },
    { x: 1.0, z: -6.5, kind: 'spreading' },
    { x: 9.0, z: 0.5, kind: 'vase' },
    { x: -2.5, z: 7.0, kind: 'vase' },
    { x: 6.5, z: 9.5, kind: 'spreading' },
    { x: -14.0, z: 7.0, kind: 'shrub' },
    { x: 1.5, z: 1.0, kind: 'shrub' },
    { x: 14.0, z: -6.0, kind: 'shrub' },
    { x: -5.5, z: -11.0, kind: 'shrub' },
];

// The root module of a tree: a clear stem 2 units tall, slightly kinked,
// with three scaffold limbs at its top where the crown's modules attach.
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

// Leaves in crown clumps (emitScatterSegments / emitFoliageMesh defaults) and the card.
// The mesh path bakes every leaf into one mesh, so it carries fewer, larger,
// plainer cards (~100k leaves rather than the GPU path's ~400k).
export const FOLIAGE = { seed: 0x1eaf, perArea: 90 };
export const MESH_FOLIAGE = { seed: 0x1eaf, perArea: 28 };
export function leafCard(big) {
    const k = big ? 1.7 : 1;
    const m = Mesh.leafCard('oval', {
        width: 0.07 * k, length: 0.12 * k, bend: 0.4, fullUV: true, shapedSilhouette: true, cup: 0.55,
        widthSegments: big ? 2 : 3, lengthSegments: big ? 3 : 5,
    });
    m.colors = new Float32Array(0);
    return m;
}

const SIM_STEP = 0.02, SIM_SECONDS = 50;

/** Grow the grove: one broflora world, every plant in it, SIM_SECONDS of growth. */
export function growWorld() {
    const S = 40;
    const world = bro.flora.createWorld({
        rngSeed: 0x6a07e,
        climate: { annualTempBase: 15, annualPrecip: 1000 },
        shadow: { origin: [-S / 2, -2, -S / 2], cellSize: 1, width: S, height: 26, depth: S, fill: 1 },
    });
    const mono = world.addPrototype(bro.flora.prototypes.monopodial(3, 0.7));
    const trunk = world.addPrototype(trunkPrototype());
    world.addVoronoiSite(mono, 0.5, 0.3);
    for (const p of PLANTS) {
        // Sunk a little, so the root flare meets the slope on its low side.
        const y = groundHeight(p.x, p.z) - 0.08;
        world.addPlant({ origin: [p.x / PLANT_SCALE, y / PLANT_SCALE, p.z / PLANT_SCALE], species: SPECIES[p.kind],
                         prototypeIndex: p.kind === 'shrub' ? mono : trunk });
    }
    // Grown once per change to the grove or to broflora's step: the grown
    // world is cached under the app's cache dir, keyed by all of that.
    grove.grow = world.grow(Math.round(SIM_SECONDS / SIM_STEP), SIM_STEP, { cache: bro.app.cacheDir });
    return world;
}

// --- conifers and shrubs ----------------------------------------------------------

// bro.flora's species presets, at full size (no PLANT_SCALE): conifers on
// the rising ground round the meadow, shrubs among the broadleaves. They
// grow in a nursery world of their own, each with room to grow its whole
// crown, and stand where PRESET_PLANTS puts them through forest nodes, a
// node per leaf form (a conifer's needle or scale-leaf sprays are cut out
// on the GPU, which only the forest node draws). `yaw` is the side the
// capture tool's species views see each from (the orbit's yaw: 0 from +z).
export const PRESET_PLANTS = [
    { name: 'fir', x: -25, z: -9, yaw: -1.9 },
    { name: 'spruce', x: -27, z: 3, yaw: -1.45 },
    { name: 'pine', x: -23, z: 16, yaw: -1.0 },
    { name: 'cypress', x: 25, z: -7, yaw: 1.85 },
    { name: 'juniper', x: 23, z: 7, yaw: 1.25 },
    { name: 'boxwood', x: -4.5, z: 3, yaw: 0 },
    { name: 'holly', x: 4.5, z: 4.5, yaw: 0.2 },
    { name: 'hydrangea', x: -10.5, z: 3, yaw: -0.2 },
];
const PRESET_SPACING = 16;

/** Grow the presets in their own nursery: a row, far enough apart to grow alone. */
export function growPresets() {
    const n = PRESET_PLANTS.length, W = n * PRESET_SPACING + 10;
    const world = bro.flora.createWorld({
        rngSeed: 0xc0f1,
        climate: { annualTempBase: 12, annualPrecip: 1000 },
        shadow: { origin: [-W / 2, -2, -12], cellSize: 1, width: W, height: 28, depth: 24, fill: 1 },
    });
    PRESET_PLANTS.forEach((p, k) => world.plantSpecies(p.name, { origin: [(k - (n - 1) / 2) * PRESET_SPACING, 0, 0] }));
    grove.presetGrow = world.grow(Math.round(SIM_SECONDS / SIM_STEP), SIM_STEP, { cache: bro.app.cacheDir });
    return world;
}

// A node per kind: the needle conifers, the scale-leaved, the shrubs; each
// emit's specimens stood at their PRESET_PLANTS place.
function drawPresets(world) {
    const kinds = [{ name: 'needle', opts: { leafForm: 'needle' } },
                   { name: 'scale', opts: { leafForm: 'scale' } },
                   { name: 'shrub', opts: Object.assign({ plants: [5, 6, 7] }, FOLIAGE) }];
    grove.presets = kinds.map(({ name, opts }) => {
        const emit = world.emitForest(Object.assign({ seed: FOLIAGE.seed }, opts));
        const rows = [];
        for (let s = 0; s < emit.specimenCount; s++) {
            const p = PRESET_PLANTS[emit.specimens[s * 16 + 11] | 0];
            rows.push(p.x, groundHeight(p.x, p.z) - 0.06, p.z, 1, (p.x * 1.7 + p.z) % 6.283, s, 0, 0);
        }
        const node = scene.createForest(Object.assign({
            // No leaf: each node draws its form's own card at its species'
            // leaf size (a conifer's spray, a boxwood's small leaf).
            forest: emit, instances: new Float32Array(rows),
            doubleSided: true, subsurface: name === 'shrub' ? 0.5 : 0.3, vertexColorTint: false,
            castsShadow: true, receivesShadow: true, barkColor: BARK.color, barkRoughness: BARK.roughness,
        }, { color: LEAF.color, roughness: LEAF.roughness }));
        return { name, emit, node };
    });
}

// --- drawing ----------------------------------------------------------------------

const BARK = { color: [0.2, 0.17, 0.14], metallic: 0, roughness: 0.9 };
const LEAF = { color: [0.2, 0.36, 0.11], metallic: 0, roughness: 0.7 };

export const grove = { world: null, nodes: [], presets: [], path: 'gpu', legacyWind: false, stats: {} };

function clearNodes() {
    for (const n of grove.nodes) n.destroy();
    grove.nodes.length = 0;
}

function add(node) {
    node.scale = [PLANT_SCALE, PLANT_SCALE, PLANT_SCALE];
    grove.nodes.push(node);
    return node;
}

function drawGpu(world) {
    const tubes = world.emitBranchTubes({ sides: 10 });
    const scatter = world.emitScatterSegments(FOLIAGE);
    add(scene.createInstancedMesh(Object.assign({ tube: tubes, castsShadow: true, receivesShadow: true }, BARK)));
    add(scene.createInstancedMesh(Object.assign({
        mesh: leafCard(), scatter,
        doubleSided: true, subsurface: 0.5, vertexColorTint: false, castsShadow: true, receivesShadow: true,
    }, LEAF)));
    grove.stats = { segments: tubes.segCount, leaves: scatter.instanceCount };
}

function drawMeshes(world) {
    // `legacyWind` is the sway apps had before the vegetation path: the whole
    // mesh bent by vertex colour R (the "before" captures).
    const wind = grove.legacyWind ? { wind: true } : {};
    const bark = world.emitMesh(7);
    const leaves = world.emitFoliageMesh(leafCard(true), MESH_FOLIAGE);
    add(scene.createMesh(Object.assign({ data: bark, vertexColorTint: false, castsShadow: true, receivesShadow: true }, BARK, wind)));
    if (grove.legacyWind) {
        // Leaf cards bake their own bend in R; the scatter wrote it per leaf.
        const c = new Float32Array(leaves.vertexCount * 4);
        const pos = leaves.positions;
        for (let i = 0; i < leaves.vertexCount; i++) c.set([Math.min(1, pos[i * 3 + 1] / 6), 0, 0, 1], i * 4);
        leaves.colors = c;
    }
    add(scene.createMesh(Object.assign({
        data: leaves, twoSided: true, subsurface: 0.5, vertexColorTint: false, castsShadow: true, receivesShadow: true,
    }, LEAF, wind)));
    grove.stats = { bark: bark.triangleCount, leaves: leaves.triangleCount };
}

/** (Re)draw the grown world as `path` ('gpu' | 'mesh'). */
export function draw(path) {
    grove.path = path || grove.path;
    clearNodes();
    if (grove.path === 'mesh') drawMeshes(grove.world); else drawGpu(grove.world);
}

// --- wind ---------------------------------------------------------------------------

/** Wind presets: setWind options. 'still' stops everything. */
export const WINDS = {
    still: { label: 'Still', wind: { strength: 0, speed: 0, gust: 0 } },
    breeze: { label: 'Breeze', wind: { direction: [1, 0, 0.3], strength: 0.05, frequency: 1.1, speed: 2.5, gust: 1 } },
    gusty: { label: 'Gusty', wind: { direction: [1, 0, 0.3], strength: 0.12, frequency: 1.4, speed: 4.5, gust: 1.6 } },
};
export function setWind(key) {
    grove.wind = key;
    scene.setWind(WINDS[key].wind);
}

// --- views --------------------------------------------------------------------------

// Camera shots: target, distance, yaw, pitch. The golden-hour sun sits low in
// +X: 'grove' and 'tree' see it from the side, 'backlit' looks into it
// through the crowns.
export const SHOTS = {
    grove:   { label: 'Grove', target: [0, 4, 0], dist: 32, yaw: 0.0, pitch: -0.1 },
    tree:    { label: 'One tree', target: [6.5, 4.5, 9.5], dist: 18, yaw: 0, pitch: -0.05 },
    close:   { label: 'Under the crown', target: [6.5, 4.0, 11.0], dist: 7, yaw: 0.35, pitch: 0.12 },
    limb:    { label: 'A limb', target: [5.2, 5.4, 12.6], dist: 2.4, yaw: 0.5, pitch: 0.12 },
    trunk:   { label: 'A trunk', target: [6.5, 1.4, 9.5], lift: true, dist: 3.4, yaw: 0.35, pitch: -0.08 },
    bark:    { label: 'Its bark', target: [6.5, 0.7, 9.5], lift: true, dist: 1.3, yaw: 2.8, pitch: -0.12 },
    backlit: { label: 'Into the sun', target: [2, 5, 0], dist: 36, yaw: Math.PI * 0.5, pitch: -0.06 },
    meadow:  { label: 'Meadow', target: [-1, 1.4, 9], lift: true, dist: 26, yaw: -0.3, pitch: -0.11 },
    ground:  { label: 'In the grass', target: [-1, 0.3, 13.5], lift: true, dist: 3.6, yaw: -0.25, pitch: -0.16 },
    parting: { label: 'Parting', target: [-1.5, 0, 13.3], lift: true, dist: 6, yaw: 0.1, pitch: -0.55 },
    roller:  { label: 'The roller', follow: true, dist: 4.5, yaw: 0.9, pitch: -0.28 },
    conifers: { label: 'Conifers', target: [-25, 6, 3], lift: true, dist: 30, yaw: 1.0, pitch: 0.0 },
    shrubs:  { label: 'Shrubs', target: [-7.5, 0.8, 3], lift: true, dist: 10, yaw: 0.46, pitch: -0.14 },
};
export function setShot(key) {
    const s = SHOTS[key];
    grove.shot = key;
    // `lift`: the target's height is above the ground there, not absolute.
    const t = s.follow ? followTarget() : s.lift ? [s.target[0], groundHeight(s.target[0], s.target[2]) + s.target[1], s.target[2]] : s.target;
    vp.reframe(t, s.dist, { yaw: s.yaw, pitch: s.pitch });
}
function followTarget() {
    const p = roller.node ? roller.node.position : [0, 0, 0];
    return [p[0], p[1] + 0.2, p[2]];
}
vp.onFrame(() => { if (SHOTS[grove.shot] && SHOTS[grove.shot].follow) vp.reframe(followTarget(), SHOTS[grove.shot].dist); });

// --- boot ---------------------------------------------------------------------------

sky.apply('golden');
setWind('breeze');
setShot('grove');
grove.world = growWorld();
grove.growMs = grove.grow.ms;  // wall time: headless's performance.now rides the virtual clock
draw('gpu');
grove.presetWorld = growPresets();
drawPresets(grove.presetWorld);
grove.grass = growGrass(grove.world);
roller.node = scene.createMesh({ data: ballMesh(), color: [1, 1, 1], roughness: 0.55, castsShadow: true, receivesShadow: true });
grove.grass.addMover(roller.node, { radius: 0.7, strength: 1.2, trample: 1 });
placeRoller(0);
