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
// plant data and bro.scene sways it. main.js mounts the panel; tests and the
// capture tool import this module (never main.js).

import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";
import { daylight } from "/lib/kit/sky.js";

export const GROUND = 30;          // half-size of the meadow, metres
export const PLANT_SCALE = 1.5;    // node scale: broflora grows ~5 m trees, drawn ~7.5 m

export const vp = sceneViewport('#stage', {
    orbit: { target: [0, 4, 0], dist: 24, fov: 45, near: 0.1, far: 400, rot: orbitRotation(Math.PI * 0.5, -0.12) },
    controls: { orbitButton: 0, panButton: 2, minDist: 2, maxDist: 150 },
});
export const { scene } = vp;
export const sky = daylight(scene, { order: ['golden', 'noon', 'dawn'], cascades: 3, atlas: 4096, pcf: 3 });
vp.onFrame((dt) => sky.update(dt));

scene.createMesh({
    mesh: 'plane', halfW: GROUND, halfD: GROUND, y: 0,
    color: '#33421a', metallic: 0, roughness: 1.0, receivesShadow: true,
});

// --- the plants -------------------------------------------------------------------

// A spreading broadleaf (round crown on a short clear trunk), a vase-shaped
// one, and a dome shrub with no trunk at all.
const COMMON = {
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

// The root module of a tree: a clear stem 1.6 units tall, slightly kinked,
// with three scaffold limbs at its top where the crown's modules attach.
function trunkPrototype() {
    const H = 1.6, n = 6, nodes = [], edges = [];
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

// Leaves along the twigs (emitScatterSegments / emitFoliageMesh) and the card.
export const FOLIAGE = {
    maxRadius: 0.035, minDepth: 2, perUnitLength: 160,
    upBias: 0.6, tiltJitter: 0.6, rollJitter: 0.9,
    baseScale: 1.0, scaleJitter: 0.3, scaleByRadius: 0.25, seed: 0x1eaf,
};
export function leafCard() {
    const m = Mesh.leafCard('oval', {
        width: 0.1, length: 0.17, bend: 0.4, fullUV: true, shapedSilhouette: true, cup: 0.3,
        widthSegments: 3, lengthSegments: 5,
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
        shadow: { origin: [-S / 2, 0, -S / 2], cellSize: 1, width: S, height: 24, depth: S, fill: 1 },
    });
    const mono = world.addPrototype(bro.flora.prototypes.monopodial(3, 0.7));
    const trunk = world.addPrototype(trunkPrototype());
    world.addVoronoiSite(mono, 0.5, 0.3);
    for (const p of PLANTS) {
        world.addPlant({ origin: [p.x / PLANT_SCALE, 0, p.z / PLANT_SCALE], species: SPECIES[p.kind],
                         prototypeIndex: p.kind === 'shrub' ? mono : trunk });
    }
    const n = Math.round(SIM_SECONDS / SIM_STEP);
    for (let i = 0; i < n; i++) world.step(SIM_STEP);
    return world;
}

// --- drawing ----------------------------------------------------------------------

const BARK = { color: [0.30, 0.24, 0.18], metallic: 0, roughness: 0.9 };
const LEAF = { color: [0.36, 0.52, 0.18], metallic: 0, roughness: 0.75 };

export const grove = { world: null, nodes: [], path: 'gpu', legacyWind: false, stats: {} };

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
    const tubes = world.emitBranchTubes({ sides: 7 });
    const scatter = world.emitScatterSegments(FOLIAGE);
    add(scene.createInstancedMesh(Object.assign({ tube: tubes, castsShadow: true, receivesShadow: true }, BARK)));
    add(scene.createInstancedMesh(Object.assign({
        mesh: leafCard(), scatter: Object.assign({}, FOLIAGE, scatter),
        doubleSided: true, subsurface: 0.5, vertexColorTint: false, castsShadow: true, receivesShadow: true,
    }, LEAF)));
    grove.stats = { segments: tubes.segCount, leaves: scatter.instanceCount };
}

function drawMeshes(world) {
    // `legacyWind` is the sway apps had before the vegetation path: the whole
    // mesh bent by vertex colour R (the "before" captures).
    const wind = grove.legacyWind ? { wind: true } : {};
    const bark = world.emitMesh(7);
    const leaves = world.emitFoliageMesh(leafCard(), FOLIAGE);
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
    tree:    { label: 'One tree', target: [1, 4.5, -6.5], dist: 15, yaw: Math.PI, pitch: -0.05 },
    backlit: { label: 'Into the sun', target: [0, 5, 0], dist: 24, yaw: Math.PI * 0.5, pitch: -0.04 },
};
export function setShot(key) {
    const s = SHOTS[key];
    grove.shot = key;
    vp.reframe(s.target, s.dist, { yaw: s.yaw, pitch: s.pitch });
}

// --- boot ---------------------------------------------------------------------------

sky.apply('golden');
setWind('breeze');
setShot('grove');
const t0 = performance.now();
grove.world = growWorld();
grove.growMs = performance.now() - t0;
draw('gpu');
