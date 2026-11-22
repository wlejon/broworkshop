// Tree Lab: bro.flora's species presets grown alone, each at full size, drawn
// as branch tubes and scattered leaves that bro.scene sways in its wind field,
// beside a 1.8 m post for scale. main.js mounts the panel; the capture
// scripts import this module (never main.js).

import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";
import { daylight } from "/lib/kit/sky.js";

export const vp = sceneViewport('#stage', {
    orbit: { target: [0, 8, 0], dist: 40, fov: 50, near: 0.1, far: 4000, rot: orbitRotation(Math.PI * 0.3, -0.08) },
    controls: { orbitButton: 0, panButton: 2, minDist: 1, maxDist: 2000 },
});
export const { scene } = vp;
export const sky = daylight(scene, { order: ['noon', 'golden', 'dawn'], pcf: 3, ground: [0.11, 0.15, 0.06] });
sky.apply('noon');
sky.setScale(6);
scene.setMSAA(4);
scene.setWind?.({ speed: 6, direction: [1, 0, 0.3] });
vp.onFrame((dt) => sky.update(dt));

export const ground = scene.createMesh({
    mesh: 'plane', halfW: 600, halfD: 600, y: 0,
    color: [0.16, 0.2, 0.09], metallic: 0, roughness: 1.0, receivesShadow: true,
});

// A person for scale: a 1.8 m post, 0.45 m wide.
export const person = scene.createMesh({
    mesh: 'box', halfW: 0.225, halfH: 0.9, halfD: 0.15, y: 0.9,
    color: [0.6, 0.3, 0.2], metallic: 0, roughness: 0.8, castsShadow: true, receivesShadow: true,
});

const SIM_STEP = 0.02;
const BARK = { color: [0.2, 0.17, 0.14], metallic: 0, roughness: 0.9 };
const LEAF = { color: [0.07, 0.13, 0.04], metallic: 0, roughness: 0.7 };

// A leaf card `k` times its grown size (the node's scale undone, so a tree
// drawn 2.6x keeps leaves of a real leaf's size).
export function leafCard(k = 1) {
    const m = Mesh.leafCard('oval', {
        width: 0.07 * k, length: 0.12 * k, bend: 0.4, fullUV: true, shapedSilhouette: true, cup: 0.55,
        widthSegments: 3, lengthSegments: 5,
    });
    m.colors = new Float32Array(0);
    return m;
}

/** Grow `name` alone for `seconds` of sim time (cached under the app's cache dir). */
export function growSpecies(name, { seconds = 50, seed = 0xc0f1, species } = {}) {
    const S = 40;
    const world = bro.flora.createWorld({
        rngSeed: seed,
        climate: { annualTempBase: 12, annualPrecip: 1000 },
        shadow: { origin: [-S / 2, -2, -S / 2], cellSize: 1, width: S, height: 60, depth: S, fill: 1 },
    });
    world.plantSpecies(name, Object.assign({ origin: [0, 0, 0] }, species ? { species } : {}));
    const grow = world.grow(Math.round(seconds / SIM_STEP), SIM_STEP, { cache: bro.app.cacheDir });
    return { world, grow };
}

/** Size of a grown plant from its segments: height, trunk diameter at its base, clear bole, crown width. */
export function measureTree(world) {
    const segs = world.emitSegments();
    let height = 0, baseR = 0, crownMin = Infinity, rx = 0;
    for (const s of segs) {
        height = Math.max(height, s.from[1], s.to[1]);
        if (s.parent < 0) baseR = Math.max(baseR, s.radius);
        rx = Math.max(rx, Math.hypot(s.to[0], s.to[2]));
    }
    // The clear bole: the lowest point a leafy twig reaches (the leaf
    // scatter's default keeps off wood over 5 cm).
    const fol = world.emitFoliage();
    segs.forEach((s, i) => {
        if (fol[i] && fol[i].mass > 0 && s.radius <= 0.05) crownMin = Math.min(crownMin, s.from[1], s.to[1]);
    });
    return { height, trunkD: 2 * baseR, bole: Number.isFinite(crownMin) ? crownMin : 0, crownW: 2 * rx, segments: segs.length };
}

export const lab = { nodes: [], world: null, name: '' };

/** Look at `target` from `dist` metres off, the eye at height `eyeY`, from compass angle `yaw`. */
export function lookFrom(target, dist, eyeY, yaw = 0.9) {
    const pitch = Math.asin(Math.max(-0.99, Math.min(0.99, (target[1] - eyeY) / dist)));
    vp.reframe(target, dist, { yaw, pitch });
}

/**
 * Draw a grown world: branch tubes + clumped leaf scatter, both swayed by the
 * scene's wind. `scale` sizes the tree; `leaf` the leaves' own size against
 * the grown one (1/scale keeps a leaf its grown size whatever the tree's, and
 * the crown is filled with that many times as many squared).
 */
export function draw(world, { x = 0, z = 0, scale = 1, leaf = 1 } = {}) {
    const k = leaf / scale;
    const tubes = world.emitBranchTubes({ sides: 10 });
    const scatter = world.emitScatterSegments({ seed: 0x1eaf, perArea: 90 / (k * k) });
    const bark = scene.createInstancedMesh(Object.assign({ tube: tubes, castsShadow: true, receivesShadow: true }, BARK));
    const leaves = scene.createInstancedMesh(Object.assign({
        mesh: leafCard(k), scatter,
        doubleSided: true, subsurface: 0.5, vertexColorTint: false, castsShadow: true, receivesShadow: true,
    }, LEAF));
    for (const n of [bark, leaves]) {
        n.position = [x, 0, z];
        n.scale = [scale, scale, scale];
        lab.nodes.push(n);
    }
    return { bark, leaves, segs: tubes.segCount, leafCount: scatter.instanceCount };
}

export function clear() {
    for (const n of lab.nodes) n.destroy();
    lab.nodes.length = 0;
}
