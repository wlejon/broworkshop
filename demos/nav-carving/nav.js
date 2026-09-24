// nav.js — the tiled navmesh and the three obstacles that carve it.
//
// One bake at boot (`dynamicObstacles: true`, from the level's physics). After
// that the surface only changes through `addObstacle` / `removeObstacle`,
// which rebuild the handful of tiles they touch and bump `mesh.generation`;
// everything that caches a route (plan.js, agents.js) compares that integer.

import { OBSTACLES, bounds, FLOOR_Y } from "/app/level.js";

export const AGENT_RADIUS = 0.35;
export const EXTENTS = { x: 1.5, y: 1.2, z: 1.5 };

export const navState = {
    mesh: null,
    bakeMs: 0,
    lastError: '',
    handles: { gate: 0, barricade: 0, bridge: 0 },   // live obstacle handle, 0 = none
    tilesRebuilt: 0,    // update() calls the last change needed
};

export function bake() {
    const t0 = Date.now();
    try {
        navState.mesh = bro.ai.game.bakeNavMesh({
            fromPhysics: Physics, physicsLayers: ['static'],
            agentRadius: AGENT_RADIUS, agentHeight: 1.8, agentMaxClimb: 0.4, agentMaxSlopeDeg: 40,
            cellSize: 0.2, cellHeight: 0.1,
            dynamicObstacles: true, tileSize: 32, maxObstacles: 32,
        });
        navState.lastError = '';
    } catch (e) {
        navState.mesh = null;
        navState.lastError = String((e && e.message) || e);
    }
    navState.bakeMs = Date.now() - t0;
    for (const k in navState.handles) navState.handles[k] = 0;
    return navState.mesh;
}

export function generation() { return navState.mesh ? navState.mesh.generation : 0; }

/** Apply queued tile rebuilds now (the engine would pump them over the next frames). */
function pump() {
    let n = 0;
    while (n < 256 && !navState.mesh.update()) n++;
    navState.tilesRebuilt = n + 1;
}

/**
 * Carve (on = true) or restore (false) one named obstacle's box. Padded by the
 * agent radius: a raw Detour box only removes its own footprint, and an agent
 * centre may stand right up against it.
 */
export function setObstacle(name, on) {
    const mesh = navState.mesh;
    if (!mesh || !mesh.supportsObstacles) return false;
    const h = navState.handles[name];
    if (!!on === !!h) return false;
    if (on) {
        const o = OBSTACLES[name];
        navState.handles[name] = mesh.addObstacle({
            type: 'box', center: { x: o.x, y: o.base + o.hy, z: o.z },
            halfExtents: { x: o.hx + AGENT_RADIUS, y: o.hy, z: o.hz + AGENT_RADIUS },
        });
    } else {
        mesh.removeObstacle(h);
        navState.handles[name] = 0;
    }
    pump();
    return true;
}

export function obstacleOn(name) { return !!navState.handles[name]; }

export function findRoute(from, to, requireFullPath) {
    const m = navState.mesh;
    return m && m.valid ? m.findPath(from, to, { extents: EXTENTS, requireFullPath: !!requireFullPath }) : null;
}

export function nearest(p, ext) {
    const m = navState.mesh;
    return m && m.valid ? m.nearestPoint(p, ext || EXTENTS) : null;
}

/** Is there walkable surface at p (within tol in XZ, on p's storey)? */
export function walkableAt(p, tol = 0.25) {
    const q = nearest(p, { x: 0.3, y: 0.8, z: 0.3 });
    return !!q && Math.abs(q.x - p.x) <= tol && Math.abs(q.z - p.z) <= tol;
}

export const overlayOpts = { bounds, storeys: FLOOR_Y, step: 0.5, yExtent: 1.0 };
