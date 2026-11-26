// lab.js — the wrecking lab: one bro.dynamics world, one structure standing in
// it, and whatever gets thrown at it. main.js wires the DOM; tests import this.

import { sceneViewport, orbitRotation, localPoint } from "/lib/kit/viewport3d.js";
import { fixedStep } from "/lib/kit/ui.js";
import { addStatic, addBody, applyMoved, structureView, pickRay } from "/lib/kit/dynamics3d.js";
import { BUILDS } from "/app/buildings.js";

export const lab = {
    vp: null, scene: null, world: null, structure: null, view: null, build: 'tower',
    nodes: new Map(), thrown: [], frames: 0, slow: false, stepMs: 0,
};

/** What can be thrown: a body spec without its place and speed, and its look. */
export const SHOTS = {
    ball: { spec: { shape: 'sphere', radius: 0.5, mass: 400 }, look: { color: '#d8dde2', metallic: 0.9, roughness: 0.3 } },
    wrecker: { spec: { shape: 'sphere', radius: 1.1, mass: 5000 }, look: { color: '#3b3f45', metallic: 0.8, roughness: 0.45 } },
    mech: { spec: { shape: 'box', half: [1.6, 2.4, 1.6], mass: 20000 }, look: { color: '#c7772c', metallic: 0.5, roughness: 0.5 } },
    truck: { spec: { shape: 'box', half: [3, 1.5, 3], mass: 60000 }, look: { color: '#8a2f2a', metallic: 0.4, roughness: 0.6 } },
};

const TINT = {
    footing: [0.42, 0.42, 0.43], column: [0.78, 0.76, 0.72], slab: [0.66, 0.66, 0.67],
    wall: [0.80, 0.72, 0.62], core: [0.6, 0.6, 0.62],
};

const listeners = [];
export function onTick(fn) { listeners.push(fn); }

export function startLab(canvas) {
    const vp = sceneViewport(canvas, {
        orbit: { target: [0, 20, 0], dist: 80, fov: 50, near: 0.5, far: 1500, rot: orbitRotation(0.6, -0.22) },
        controls: { minDist: 6 },
    });
    Object.assign(lab, { vp, scene: vp.scene });
    const scene = vp.scene;
    scene.setAmbient([0.10, 0.11, 0.14]);
    const sun = scene.createLight({ type: 'directional', direction: [-0.5, -1.0, -0.35], color: [1.0, 0.96, 0.88], intensity: 3.2 });
    sun.castsShadow = true;
    scene.createLight({ type: 'directional', direction: [0.5, -0.3, 0.6], color: [0.45, 0.6, 0.9], intensity: 0.8 });

    rebuild('tower');
    canvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const p = localPoint(canvas, e);
        const select = (id, d) => (document.getElementById(id) || {}).value || d;
        throwAt(pickRay(vp, p.x, p.y), select('shot', 'wrecker'), +select('speed', 30));
    });
    const step = fixedStep(1 / 60, 4);
    vp.onFrame((dt) => {
        step(lab.slow ? dt / 4 : dt, tick);
        if (++lab.frames % 10 === 0) for (const fn of listeners) fn();
    });
    return lab;
}

/** One step of the world, and the scene brought up to it. */
export function tick(h) {
    lab.world.step(h, 4);
    lab.stepMs = lab.world.counts.stepMs;
    applyMoved(lab.world, lab.nodes);
    lab.view.update();
}

/** Clears the world and stands `name` (a key of BUILDS) in it. */
export function rebuild(name) {
    const scene = lab.scene;
    if (lab.world) {
        for (const node of lab.nodes.values()) node.destroy();
        lab.nodes.clear();
        lab.view.destroy();
        lab.ground.destroy();
        lab.world.destroy();
    }
    lab.build = name || lab.build;
    lab.thrown = [];
    const world = lab.world = bro.dynamics.createWorld();
    lab.ground = addStatic(world, scene, { shape: 'box', half: [400, 1, 400], position: [0, -1.8, 0] }, { color: '#4a4d52', roughness: 0.95 }).mesh;
    const b = BUILDS[lab.build]();
    lab.kinds = b.kinds;
    lab.structure = world.addStructure({ members: b.members, ties: b.ties });
    lab.view = structureView(scene, lab.structure, {
        color(member, cell) {
            const t = TINT[b.kinds[member]] || TINT.wall;
            const k = 0.94 + 0.12 * (((cell * 2654435761) >>> 0) / 4294967296);
            return [t[0] * k, t[1] * k, t[2] * k];
        },
    });
    lab.vp.reframe(b.focus, b.dist);
    return lab.structure;
}

/**
 * Throws a SHOTS body along a ray ({ origin, dir }) at `speed` m/s, from 12 m
 * short of whatever the ray meets (or 40 m out when it meets nothing).
 */
export function throwAt(ray, kind, speed) {
    if (!ray) return null;
    // What stands has no bodies: the structure answers for it, the world for the rest.
    const standing = lab.structure.raycast(ray.origin, ray.dir, 2000);
    const body = lab.world.raycast(ray.origin, ray.dir, 2000);
    const near = Math.min(standing ? standing.distance : Infinity, body ? body.distance : Infinity);
    const reach = Math.max(0, (near < Infinity ? near : 60) - 14);
    const from = [ray.origin[0] + ray.dir[0] * reach, ray.origin[1] + ray.dir[1] * reach, ray.origin[2] + ray.dir[2] * reach];
    return launch(kind, from, [ray.dir[0] * speed, ray.dir[1] * speed, ray.dir[2] * speed]);
}

/** A SHOTS body at `position` with `velocity`. Returns its body. */
export function launch(kind, position, velocity) {
    const shot = SHOTS[kind] || SHOTS.wrecker;
    const made = addBody(lab.world, lab.scene, { ...shot.spec, position, velocity, friction: 0.6 }, shot.look);
    lab.nodes.set(made.body, made.node);
    lab.thrown.push(made.body);
    return made.body;
}
