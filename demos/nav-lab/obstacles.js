// obstacles.js — runtime holes punched in a baked navmesh.
//
// A default bake is static. Baking with `dynamicObstacles: true` swaps in a
// tiled dtTileCache, which carves and restores obstacle volumes at runtime by
// rebuilding only the tiles they touch. The trade, which the HUD states:
//   - save() THROWS on a tiled mesh (no serialisation), so this mode and the
//     disk cache are exclusive, and so are this mode and off-mesh links;
//   - no detail mesh: waypoint Y is quantised to cellHeight;
//   - regionMinSize no longer culls islands, so crate tops survive as patches
//     and the sample count JUMPS on a mode switch — the bake, not a bug.
//
// addObstacle / removeObstacle only QUEUE a change; the engine pumps one tile
// per update() once a frame. This module pumps to completion by hand so a
// click and the findPath after it in the same tick agree about the world.
//
// Measured: runtime obstacles are NOT eroded by agentRadius. A 3.2 m box
// leaves a ~2.9 m hole at radius 0.3, 0.5 and 1.0 alike, so a 0.5 m agent
// would path 15 cm from a crate's face and clip its corner. Every obstacle is
// therefore inflated by the current radius before it reaches Detour, while
// the visual box keeps its true size: the gap between crate and hole in the
// overlay is exactly that correction.

import { bakeParams, navState } from "/app/navmesh.js";
import { CHOKE } from "/app/level.js";

export const obstacleState = {
    placed: [],          // { handle, node, x, y, z, hx, hy, hz, kind }
    applyCalls: 0,       // update() calls the last pump needed = tiles rebuilt
    lastError: '',
};

/** Default crate: matters at a 0.5 m radius, well inside the 8-tile-layer limit. */
export const CRATE = { hx: 1.0, hy: 1.0, hz: 1.0 };

let sceneRef = null;
export function bindObstacleScene(scene) { sceneRef = scene; }

export function obstaclesEnabled() {
    const m = navState.mesh;
    return !!(m && m.valid && m.supportsObstacles);
}

/**
 * Drain the pending-change queue now. Returns the update() calls made — one
 * per rebuilt tile, the whole argument for the tiled bake (a crate costs four
 * tile rebuilds, not a re-bake). Calls MADE, not calls that returned false:
 * the last update() rebuilds a tile and reports "up to date" in one breath.
 */
export function pumpObstacles(limit = 4096) {
    const m = navState.mesh;
    if (!m || !m.supportsObstacles) return 0;
    let n = 0, done = false;
    while (n < limit && !done) { done = m.update(); n++; }
    // A redundant pump on a drained queue costs one call; keep the real count.
    if (n > 1 || obstacleState.applyCalls === 0) obstacleState.applyCalls = n;
    return n;
}

const NOT_TILED = 'this mesh was not baked with dynamicObstacles: true';

/**
 * Place a box obstacle with a matching visual. `p.y` is the BASE height (the
 * descriptor takes a centre; getting that wrong buries the crate where it
 * carves nothing). opts: { hx, hy, hz, pad (default agentRadius; 0 = raw
 * Detour), color, kind }.
 */
export function placeObstacle(p, opts) {
    const o = opts || {};
    if (!obstaclesEnabled()) { obstacleState.lastError = NOT_TILED; return null; }
    const hx = o.hx != null ? o.hx : CRATE.hx, hy = o.hy != null ? o.hy : CRATE.hy, hz = o.hz != null ? o.hz : CRATE.hz;
    const cy = (p.y || 0) + hy;
    const pad = o.pad != null ? o.pad : bakeParams.agentRadius;
    let handle;
    try {
        handle = navState.mesh.addObstacle({ type: 'box', center: { x: p.x, y: cy, z: p.z }, halfExtents: { x: hx + pad, y: hy, z: hz + pad } });
    } catch (e) {
        // A full request queue (64 between pumps) or no free slot lands here.
        obstacleState.lastError = String((e && e.message) || e);
        return null;
    }
    const color = o.color || '#e8833a';
    const node = sceneRef.createMesh({
        name: `obstacle.${handle}`, mesh: 'box', halfW: hx, halfH: hy, halfD: hz, x: p.x, y: cy, z: p.z,
        color, roughness: 0.55, metallic: 0.05, emissive: 0.3, emissiveColor: color,
    });
    const rec = { handle, node, x: p.x, y: cy, z: p.z, hx, hy, hz, kind: o.kind || 'crate' };
    obstacleState.placed.push(rec);
    obstacleState.lastError = '';
    return rec;
}

export function removeObstacle(rec) {
    const i = obstacleState.placed.indexOf(rec);
    if (i < 0) return false;
    if (navState.mesh && navState.mesh.supportsObstacles) navState.mesh.removeObstacle(rec.handle);
    rec.node.destroy();
    obstacleState.placed.splice(i, 1);
    return true;
}

/** Nearest placed obstacle within r of a point (click-to-remove). */
export function obstacleNear(p, r = 1.6) {
    let best = null, bestD = r;
    for (const rec of obstacleState.placed) {
        const d = Math.hypot(rec.x - p.x, rec.z - p.z);
        if (d < bestD) { bestD = d; best = rec; }
    }
    return best;
}

/** The click: drop a crate here, or pick up the one already here. Pumps. */
export function toggleObstacleAt(p, opts) {
    if (!obstaclesEnabled()) { obstacleState.lastError = NOT_TILED; return null; }
    const existing = obstacleNear(p);
    if (existing) {
        removeObstacle(existing);
        pumpObstacles();
        return { action: 'removed', rec: existing };
    }
    const rec = placeObstacle(p, opts);
    pumpObstacles();
    return rec ? { action: 'added', rec } : null;
}

/** Block the doorway (or reopen it): the one reproducible "sever the corridor". */
export function blockCorridor() {
    const existing = obstacleState.placed.find((r) => r.kind === 'corridor');
    if (existing) {
        removeObstacle(existing);
        pumpObstacles();
        return { action: 'opened' };
    }
    // Wider than the 2.6 m clear span and thicker than the 0.8 m wall.
    const rec = placeObstacle({ x: CHOKE.x, y: 0, z: CHOKE.z }, { hx: 0.7, hy: 1.4, hz: CHOKE.halfZ + 0.3, color: '#d94f4f', kind: 'corridor' });
    pumpObstacles();
    return rec ? { action: 'blocked', rec } : null;
}

export function clearObstacles() {
    const n = obstacleState.placed.length;
    for (const rec of obstacleState.placed.slice()) removeObstacle(rec);
    pumpObstacles();
    return n;
}

/** True while queued changes have not landed (only observable when something else drives update()). */
export function obstaclesPending() {
    const m = navState.mesh;
    return !!(m && m.supportsObstacles && m.obstaclesPending);
}

export function obstacleCount() {
    const m = navState.mesh;
    return m && m.supportsObstacles ? m.obstacleCount : 0;
}
