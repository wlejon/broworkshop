// view.js — the scene canvas: camera, lights, the bay views and mouse picking.

import { segmented } from "/lib/kit/ui.js";
import { sceneViewport, orbitRotation, localPoint } from "/lib/kit/viewport3d.js";
import { pickRay, raycast, grabber } from "/lib/kit/physics3d.js";
import { bodies } from "./sim/spawn.js";
import { findPart } from "./sim/ragdolls.js";
import { select, spawnCurrent } from "./ui/sandbox.js";
import { selectRagdollPart } from "./ui/bodies.js";

// Yaw matters: the orbit eye sits on the pivot's +Z side at yaw 0. The machine
// yard (z = -18) has the whole sandbox between it and +Z, so it is viewed from
// behind (yaw ~ pi); the bridge (z = +18) is the mirror case.
export const VIEWS = {
    sandbox:  { pivot: [2, 2, 0],      dist: 46, yaw: -0.55,           pitch: -0.42 },
    machines: { pivot: [-6, 3.5, -18], dist: 24, yaw: Math.PI - 0.40,  pitch: -0.34 },
    bench:    { pivot: [20, 3, -18],   dist: 15, yaw: Math.PI - 0.30,  pitch: -0.30 },
    bridge:   { pivot: [0, 4.5, 18],   dist: 24, yaw: 0.30,            pitch: -0.22 },
};

// A raised three-quarter view from front-left: yaw separates the lanes across
// the screen, pitch gets the eye above the perimeter walls, and together they
// make the translucent area hulls read as volumes.
export const vp = sceneViewport('#stage', {
    orbit: { target: VIEWS.sandbox.pivot, rot: orbitRotation(VIEWS.sandbox.yaw, VIEWS.sandbox.pitch),
             dist: VIEWS.sandbox.dist, fov: 52, near: 0.1, far: 400 },
    controls: { minDist: 4 },
});
export const scene = vp.scene;

// Lit, not flat: the lanes differ in roughness as well as colour, and a
// shadow-casting sun makes a bouncing ball's height legible. Exposure sits
// below 1 because a hot key light washes saturated lanes toward white.
scene.setAmbient([0.055, 0.06, 0.075]);
scene.setToneMap({ mode: 'aces', exposure: 0.85 });
scene.createLight({ type: 'directional', position: [-12, 18, 10], direction: [-0.35, -1.0, -0.28],
    color: [1.0, 0.97, 0.90], intensity: 2.4, castsShadow: true, name: 'sun' });
scene.createLight({ type: 'directional', direction: [0.5, -0.6, 0.5],    // cool fill for the shadow side
    color: [0.45, 0.58, 0.80], intensity: 0.9, name: 'fill' });

const views = segmented('#views', Object.keys(VIEWS), { value: 'sandbox', onChange: (v) => focusView(v) });

export function focusView(name) {
    const v = VIEWS[name];
    if (!v) return false;
    views.value = name;
    vp.reframe(v.pivot, v.dist, { yaw: v.yaw, pitch: v.pitch });
    return true;
}

// --- picking --------------------------------------------------------------------
//
// Left click: a ragdoll part -> select the part; a loose body -> select it and
// start dragging; anything else -> spawn there. The ray deliberately ignores
// the collision matrix: "I can click it" and "it collides with that" are
// different questions.

export const grab = grabber(vp);

/** Act on the closest hit along a world ray (the mouse path minus unprojection). */
export function actOnRay(ray) {
    const hit = raycast(ray, 400);
    if (!hit) return { kind: 'miss' };
    // Ragdoll parts are ordinary bodies to a raycast: look the part up first.
    const part = findPart(hit.bodyId);
    if (part) {
        selectRagdollPart(part.entry, part.index);
        return { kind: 'part', tag: hit.bodyId, part: part.index, point: hit.position };
    }
    if (bodies.has(hit.bodyId)) {
        select(hit.bodyId);
        grab.begin(hit);
        return { kind: 'select', tag: hit.bodyId, point: hit.position };
    }
    // Static geometry: spawn just above the surface, not interpenetrating it.
    const p = { x: hit.position.x, y: hit.position.y + 1.2, z: hit.position.z };
    return { kind: 'spawn', tag: spawnCurrent(p).tag, point: p };
}

/** Resolve a canvas-local pixel to an action. */
export function pickAt(lx, ly) {
    return actOnRay(pickRay(vp, lx, ly));
}

vp.canvas.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    const [lx, ly] = localPoint(vp.canvas, ev);
    pickAt(lx, ly);
});
