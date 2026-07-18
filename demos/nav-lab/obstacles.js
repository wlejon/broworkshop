// obstacles.js — runtime holes punched in a baked navmesh.
//
// A default bakeNavMesh is static: the walkable surface is frozen at bake time,
// and a door that closes or a crate that lands in a corridor means re-baking the
// whole level. Baking with `dynamicObstacles: true` swaps the single-tile Detour
// build for a tiled dtTileCache, which can carve and restore obstacle volumes at
// runtime by rebuilding only the tiles they touch.
//
// The trade is real and worth stating plainly, because the HUD has to explain it:
//
//   - `save()` THROWS on a tiled mesh. There is no serialization for dtTileCache
//     in bro, so the chunk-1 disk cache and the dynamic-obstacle mode are
//     mutually exclusive. navmesh.js reports blobBytes 0 in this mode rather
//     than pretending.
//   - No detail mesh, so waypoint Y is quantised to cellHeight — paths on the
//     ramps read very slightly coarser.
//   - regionMinSize no longer culls small islands, so the tops of things survive
//     as tiny disconnected patches. The walkable-sample count therefore JUMPS
//     when you switch modes; that is the bake changing, not a bug.
//
// Update semantics, which drive everything below: addObstacle/removeObstacle
// only QUEUE a change. Tiles rebuild incrementally — one touched tile per
// update() call — and the engine pumps update() once per frame automatically, so
// a change lands over the next frame or two. `generation` bumps once per applied
// batch, and `obstaclesPending` is true until the queue drains. This module
// pumps to completion by hand (`while (!mesh.update()) {}`) so that a click and
// the findPath that follows it in the same tick agree about the world.

// ─── Measured: runtime obstacles are NOT eroded by agentRadius ───────────────
//
// The API docs say obstacles "carve the walkable surface exactly like baked-in
// geometry". They do not, and the difference matters. Baked geometry is eroded
// by agentRadius, so the walkable surface stops half an agent short of every
// wall. A dtTileCache obstacle instead carves approximately its own footprint —
// measured on this level, a 3.20 m box leaves a 2.90 m hole (half a cell of
// quantisation lost at each edge) at agentRadius 0.3, 0.5 AND 1.0. The hole
// does not grow with the radius at all.
//
// Left alone, that means a 0.5 m-radius agent will happily path within 15 cm of
// a crate's face and walk straight through its corner. So this module inflates
// every obstacle by the current agentRadius before handing it to Detour, and
// draws the visual box at its TRUE size. The gap you see between the crate and
// the edge of the hole in the overlay is exactly that correction — the same
// clearance the baked walls get for free.

import { bakeParams, navState } from '/app/navmesh.js';

// The doorway in the x = 4 divider: the leaves stop at |z| = 1.3 and the wall
// itself is 0.8 m thick, so a barrier a little wider than the clear span and a
// little thicker than the wall severs the only ground-level route east.
export const CHOKE = { x: 4, z: 0, halfZ: 1.3 };

export const obstacleState = {
    placed: [],          // { handle, node, x, y, z, hx, hy, hz, kind }
    generation: 0,       // last generation this module observed
    applyCalls: 0,       // update() calls the last pump needed = tiles rebuilt
    lastError: '',
};

// Default crate: big enough to matter at a 0.5 m agent radius, small enough to
// stay well inside the "an obstacle may span at most 8 tile-layers" limit.
export const CRATE = { hx: 1.0, hy: 1.0, hz: 1.0 };

export function obstaclesEnabled() {
    const m = navState.mesh;
    return !!(m && m.valid && m.supportsObstacles);
}

// Drain the pending-change queue synchronously. Returns the number of update()
// calls it took, which is one per rebuilt tile — a genuinely interesting number,
// because it is the whole argument for the tiled bake: a crate costs four tile
// rebuilds, not a re-bake of the level.
export function pumpObstacles(limit = 4096) {
    const m = navState.mesh;
    if (!m || !m.supportsObstacles) return 0;
    // Count calls MADE, not calls that returned false — the last update() of a
    // batch rebuilds a tile and reports "up to date" in the same breath, so the
    // obvious `while (!m.update()) n++` undercounts by one and reports 0 for a
    // one-tile change.
    let n = 0, done = false;
    while (n < limit && !done) { done = m.update(); n++; }
    // A redundant pump on an already-drained queue costs exactly one call and
    // must not wipe the count from the pump that did the work.
    if (n > 1 || obstacleState.applyCalls === 0) obstacleState.applyCalls = n;
    obstacleState.generation = m.generation;
    return n;
}

// Place a box obstacle with a matching visual. `p.y` is the BASE height — the
// descriptor takes a centre, and getting that wrong buries the crate half a
// metre into the floor where it carves nothing.
export function placeObstacle(scene, p, opts) {
    opts = opts || {};
    if (!obstaclesEnabled()) {
        obstacleState.lastError = 'this mesh was not baked with dynamicObstacles: true';
        return null;
    }
    const hx = opts.hx != null ? opts.hx : CRATE.hx;
    const hy = opts.hy != null ? opts.hy : CRATE.hy;
    const hz = opts.hz != null ? opts.hz : CRATE.hz;
    const cy = (p.y || 0) + hy;
    // The radius correction described at the top of this file. `pad: 0` opts
    // out, for callers that want the raw Detour behaviour.
    const pad = opts.pad != null ? opts.pad : bakeParams.agentRadius;

    let handle;
    try {
        handle = navState.mesh.addObstacle({
            type: 'box',
            center: { x: p.x, y: cy, z: p.z },
            halfExtents: { x: hx + pad, y: hy, z: hz + pad },
        });
    } catch (e) {
        // A full request queue (64 between pumps) or exhausted obstacle slots
        // both land here. Surfacing it beats silently dropping the crate.
        obstacleState.lastError = String((e && e.message) || e);
        return null;
    }

    const node = scene.createMesh({
        name: `obstacle.${handle}`,
        mesh: 'box', halfW: hx, halfH: hy, halfD: hz,
        x: p.x, y: cy, z: p.z,
        color: opts.color || '#e8833a',
        roughness: 0.55, metallic: 0.05,
        emissive: 0.3, emissiveColor: opts.color || '#ff9a3c',
    });

    const rec = { handle, node, x: p.x, y: cy, z: p.z, hx, hy, hz,
                  kind: opts.kind || 'crate' };
    obstacleState.placed.push(rec);
    obstacleState.lastError = '';
    return rec;
}

export function removeObstacle(scene, rec) {
    const i = obstacleState.placed.indexOf(rec);
    if (i < 0) return false;
    navState.mesh.removeObstacle(rec.handle);
    scene.destroyNode(rec.node);
    obstacleState.placed.splice(i, 1);
    return true;
}

// Nearest placed obstacle within `r` of a point, for click-to-remove.
export function obstacleNear(p, r = 1.6) {
    let best = null, bestD = r;
    for (const rec of obstacleState.placed) {
        const d = Math.hypot(rec.x - p.x, rec.z - p.z);
        if (d < bestD) { bestD = d; best = rec; }
    }
    return best;
}

// The click behaviour: drop a crate where you clicked, or pick up the one that
// is already there. Pumps so the surface is up to date before the caller
// re-queries or redraws the overlay.
export function toggleObstacleAt(scene, p, opts) {
    if (!obstaclesEnabled()) {
        obstacleState.lastError = 'this mesh was not baked with dynamicObstacles: true';
        return null;
    }
    const existing = obstacleNear(p);
    if (existing) {
        removeObstacle(scene, existing);
        pumpObstacles();
        return { action: 'removed', rec: existing };
    }
    const rec = placeObstacle(scene, p, opts);
    pumpObstacles();
    return rec ? { action: 'added', rec } : null;
}

// The one-click demo. Precise clicking is not a reproducible interaction, and
// "block the ONE corridor and watch every route re-plan" is the thing worth
// seeing — so it gets a button that lands the barrier exactly on the doorway.
export function blockCorridor(scene) {
    const existing = obstacleState.placed.find(r => r.kind === 'corridor');
    if (existing) {
        removeObstacle(scene, existing);
        pumpObstacles();
        return { action: 'opened' };
    }
    const rec = placeObstacle(scene, { x: CHOKE.x, y: 0, z: CHOKE.z }, {
        // Wider than the 2.6 m clear span and thicker than the 0.8 m wall, so
        // there is no sliver of walkable surface left to squeeze through.
        hx: 0.7, hy: 1.4, hz: CHOKE.halfZ + 0.3,
        color: '#d94f4f', kind: 'corridor',
    });
    pumpObstacles();
    return rec ? { action: 'blocked', rec } : null;
}

export function clearObstacles(scene) {
    const n = obstacleState.placed.length;
    for (const rec of obstacleState.placed.slice()) removeObstacle(scene, rec);
    pumpObstacles();
    return n;
}

// True while queued changes have not fully landed. Only ever observable when
// something else is driving update() — this module's own pump drains it first.
export function obstaclesPending() {
    const m = navState.mesh;
    return !!(m && m.supportsObstacles && m.obstaclesPending);
}

export function obstacleCount() {
    const m = navState.mesh;
    return m && m.supportsObstacles ? m.obstacleCount : 0;
}

export function generation() {
    const m = navState.mesh;
    return m ? m.generation : 0;
}
