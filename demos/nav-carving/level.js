// level.js — the arena: three storeys, three runtime obstacles, three kinds
// of off-mesh link.
//
//   ground y 0     south courtyard; a blast-gate wall at z = -4 with one 3.2 m
//                  doorway; the north vault behind it
//   mezzanine 3.5  over the vault, reached by the east ramp (26.6°) or the lift
//   roof 7         reached by the ladder from the mezzanine or the lift; a
//                  bridge runs east to an island pad
//
// Static slabs are kit `slab` descriptors built as render mesh + Jolt static
// body, so the tiled bake (`fromPhysics`) walks exactly what is drawn. The
// three DYNAMIC pieces are not physics at all: each is a navmesh obstacle
// (a dtTileCache box) plus a visual.
//
//   gate       fills the doorway while closed: the vault is unreachable
//   barricade  crates across the ramp foot: the mezzanine is lift-only
//   bridge     baked walkable; retracting it drops an obstacle over the span,
//              so the island is jump-only
//
// Off-mesh links cannot ride a tiled bake (bakeNavMesh refuses the pair), so
// the links here are the app's: plan.js routes over them between navmesh legs.

import { slab, rampZ, buildSlabs } from "/lib/kit/nav3d.js";

export const FLOOR_Y = [0, 3.5, 7];
export const FLOOR_NAMES = ['ground', 'mezzanine', 'roof'];

const WALL = '#3a4458', FLOOR = '#5d6a80', DECK = '#6f7d94', RAMP = '#7f8ca3', POST = '#2a3242';

export const slabs = [];
const add = (o) => slabs.push(slab(o));

// --- ground, perimeter, the gate wall ------------------------------------------------
add({ name: 'ground', cx: 0, cy: -0.2, cz: 0, hx: 11, hy: 0.2, hz: 10, color: FLOOR });
for (const [name, cx, cz, hx, hz] of [
    ['wall.w', -11.25, 0, 0.25, 10], ['wall.e', 11.25, 0, 0.25, 10],
    ['wall.s', 0, 10.25, 11.5, 0.25], ['wall.n', 0, -10.25, 11.5, 0.25],
]) add({ name, kind: 'wall', cx, cy: 1.5, cz, hx, hy: 1.5, hz, color: WALL });

export const DOOR = { x: 0, z: -4, half: 1.6 };
for (const sgn of [-1, 1]) {
    const inner = DOOR.half, outer = 11, hx = (outer - inner) / 2;
    add({ name: sgn < 0 ? 'gatewall.w' : 'gatewall.e', kind: 'wall', cx: sgn * (inner + hx), cy: 1.5, cz: DOOR.z,
          hx, hy: 1.5, hz: 0.25, color: WALL });
}

// --- mezzanine (y 3.5) over the vault, and its ramp ---------------------------------
add({ name: 'mezzanine', cx: 0, cy: 3.3, cz: -6, hx: 9, hy: 0.2, hz: 3, color: DECK });
slabs.push(rampZ('ramp', 4, 0, -3, 3.5, 7, 1.2, 0.3, RAMP));

// --- roof (y 7), the bridge and the island -------------------------------------------
add({ name: 'roof', cx: -1.25, cy: 6.8, cz: 2, hx: 4.75, hy: 0.2, hz: 3, color: DECK });
export const BRIDGE = { x0: 3.4, x1: 8.1, z: 2, hz: 1.0 };
add({ name: 'bridge', cx: (BRIDGE.x0 + BRIDGE.x1) / 2, cy: 6.85, cz: BRIDGE.z, hx: (BRIDGE.x1 - BRIDGE.x0) / 2, hy: 0.15, hz: BRIDGE.hz, color: '#4fae6a' });
add({ name: 'island', cx: 9.3, cy: 6.8, cz: 2, hx: 1.3, hy: 0.2, hz: 2.5, color: DECK });
for (const [x, z] of [[-5.5, 4.6], [3.0, 4.6], [-5.5, -0.6], [9.8, 4.0]]) {
    add({ name: `post.${x}.${z}`, kind: 'wall', cx: x, cy: 3.3, cz: z, hx: 0.25, hy: 3.3, hz: 0.25, color: POST });
}

// --- the lift: a shaft west of the roof, a landing stub on each upper floor ------------
export const SHAFT = { x: -9.5, z: 3.0, half: 1.0 };
add({ name: 'landing.1', cx: -7.2, cy: 3.3, cz: 0.45, hx: 1.2, hy: 0.2, hz: 3.65, color: DECK });
add({ name: 'landing.2', cx: -7.2, cy: 6.8, cz: 3.0, hx: 1.3, hy: 0.2, hz: 1.1, color: DECK });
for (const [x, z] of [[-10.7, 1.8], [-10.7, 4.2], [-8.3, 1.8], [-8.3, 4.2]]) {
    add({ name: `shaft.${x}.${z}`, kind: 'wall', cx: x, cy: 4.25, cz: z, hx: 0.12, hy: 4.25, hz: 0.12, color: '#2aa7c9' });
}

// --- runtime obstacles (navmesh boxes; `base` is the bottom face) ---------------------
export const OBSTACLES = {
    gate:      { x: DOOR.x, base: 0, z: DOOR.z, hx: DOOR.half + 0.1, hy: 1.4, hz: 0.4, color: '#e0475b' },
    barricade: { x: 7, base: 0, z: 4.1, hx: 1.5, hy: 0.6, hz: 1.2, color: '#e8a23a' },
    bridge:    { x: (BRIDGE.x0 + BRIDGE.x1) / 2, base: 6.5, z: BRIDGE.z, hx: (BRIDGE.x1 - BRIDGE.x0) / 2 - 0.15, hy: 0.6, hz: BRIDGE.hz + 0.2, color: '#4fae6a' },
};

// --- off-mesh links -------------------------------------------------------------------
// Ladder and jump are two-ended; the lift joins every pair of its landings.
export const LINKS = [
    { id: 'ladder', kind: 'ladder', color: '#f5a623', start: { x: -3, y: 3.5, z: -3.7 }, end: { x: -3, y: 7, z: -0.4 } },
    { id: 'jump', kind: 'jump', color: '#7bed9f', arc: 2.2, start: { x: 3.0, y: 7, z: 4.2 }, end: { x: 8.6, y: 7, z: 4.1 } },
];
export const LANDINGS = [
    { x: -7.6, y: 0, z: 3.0 },
    { x: -7.2, y: 3.5, z: 3.0 },
    { x: -7.2, y: 7, z: 3.0 },
];

// --- named destinations (the send-to buttons) -----------------------------------------
export const TARGETS = {
    south:  { label: 'South courtyard', x: 0, y: 0, z: 5 },
    vault:  { label: 'North vault', x: 0, y: 0, z: -7.5 },
    mezz:   { label: 'Mezzanine', x: 2, y: 3.5, z: -6 },
    roof:   { label: 'Roof', x: -1.5, y: 7, z: 2 },
    island: { label: 'Island', x: 9.4, y: 7, z: 2 },
};

export const SPAWN = { x: 0, y: 0, z: 4.5 };
export const bounds = { minX: -11, maxX: 11, minZ: -10, maxZ: 10 };

export function floorOf(y) { return y > 5.2 ? 2 : y > 1.75 ? 1 : 0; }

/** Physics world + static slabs. Returns [{ node, tag, slab }]. */
export function buildLevel(scene) {
    Physics.createWorld({});
    return buildSlabs(scene, slabs);
}

export function buildLights(scene) {
    scene.setAmbient([0.07, 0.08, 0.11]);
    const sun = scene.createLight({ type: 'directional', direction: [-0.55, -1.0, -0.4], color: [1.0, 0.97, 0.9], intensity: 3.0 });
    sun.castsShadow = true;
    scene.createLight({ type: 'directional', direction: [0.5, -0.35, 0.6], color: [0.4, 0.6, 0.9], intensity: 0.9 });
}
