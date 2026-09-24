// lab.js — the scene: floor, lights, the blended figure, the cannon, mouse
// grabbing, and the frame loop. main.js only boots it and binds the panel
// (tests import this module, never the entry; see ENGINE-ISSUES.md).

import { sceneViewport, orbitRotation, localPoint } from "/lib/kit/viewport3d.js";
import { addStatic, physicsEvents, pickRay, raycast, grabber } from "/lib/kit/physics3d.js";
import { RagdollBlender } from "./blender.js";
import { Cannon } from "./cannon.js";

export const HOME = { pivot: [0, 1.1, 0], dist: 5.5, yaw: 0.45, pitch: -0.26 };

export const vp = sceneViewport('#stage', {
    orbit: { target: HOME.pivot, rot: orbitRotation(HOME.yaw, HOME.pitch), dist: HOME.dist, fov: 45, near: 0.1, far: 100 },
    controls: { minDist: 1.5, maxDist: 30 },
});
export const scene = vp.scene;

export function resetCamera() { vp.reframe(HOME.pivot, HOME.dist, { yaw: HOME.yaw, pitch: HOME.pitch }); }

scene.setAmbient([0.08, 0.10, 0.14]);
scene.setToneMap({ mode: 'aces', exposure: 1.1 });
scene.createLight({ type: 'directional', position: [4, 8, 5], direction: [-0.5, -1.0, -0.4],
    color: [1.0, 0.96, 0.90], intensity: 2.2, castsShadow: true, name: 'sun' });
scene.createLight({ type: 'directional', direction: [0.6, -0.4, 0.5], color: [0.3, 0.6, 0.95], intensity: 1.1, name: 'rim' });

// A real floor the ragdoll lands on, and a faint grid so a sliding body reads as moving.
addStatic(scene, { shape: 'box', halfExtents: { x: 15, y: 0.5, z: 15 }, position: { x: 0, y: -0.5, z: 0 },
    layer: 'static', friction: 0.8, restitution: 0.05 }, { color: '#0b1019', roughness: 0.95 });
for (let i = -6; i <= 6; i++) {
    scene.createMesh({ mesh: 'box', halfW: 9, halfH: 0.002, halfD: 0.008, x: 0, y: 0.002, z: i * 1.5, color: '#1f2a3d', roughness: 1 });
    scene.createMesh({ mesh: 'box', halfW: 0.008, halfH: 0.002, halfD: 9, x: i * 1.5, y: 0.002, z: 0, color: '#1f2a3d', roughness: 1 });
}

export const blender = new RagdollBlender(scene, { stiffness: 12 });
export const cannon = new Cannon(scene, { onHit: (part) => blender.triggerRagdoll(part) });

// The one drain of the contact stream.
export const events = physicsEvents();
const partOf = (tag) => blender.rig.tags.indexOf(tag);
events.onContacts((list) => cannon.contacts(list, partOf));

// --- grabbing: left-drag a limb and the figure goes limp from that limb ------------

export const grab = grabber(vp, { stiffness: 90, damping: 12 });

/** Canvas-local pixel -> grab a part (true), or nothing (false). */
export function grabAt(lx, ly) {
    const hit = raycast(pickRay(vp, lx, ly), 100);
    if (!hit) return false;
    const part = partOf(hit.bodyId);
    if (part < 0) return false;
    blender.triggerRagdoll(part);
    return grab.begin(hit);
}

vp.canvas.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    const [lx, ly] = localPoint(vp.canvas, ev);
    grabAt(lx, ly);
});

// --- frame ---------------------------------------------------------------------------
//
// Contacts first (a hit this step switches the figure off the kinematic drive
// before the drive can overwrite the collision), then the blender.

const frameHooks = [];
export const onFrame = (fn) => frameHooks.push(fn);

vp.onFrame((dt, t) => {
    events.pump();
    blender.update(dt);
    cannon.update(dt);
    grab.update(dt);
    for (const fn of frameHooks) fn(dt, t);
});
