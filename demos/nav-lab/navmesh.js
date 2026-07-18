// navmesh.js — bake, visualise, query and cache the polygon navmesh.
//
// Bakes with `fromPhysics`, not from a hand-written triangle list. That is the
// feature's actual selling point: the walkable surface is derived from the same
// static Jolt bodies the player collides with, so the AI and the collision
// world cannot disagree about where the floor is. Jolt hands Recast a box's
// exact 12 triangles, which for a level built out of oriented boxes is
// pixel-perfect rather than an approximation.
//
// ─── An honest note on the overlay ───────────────────────────────────────────
//
// bro exposes no way to read the baked polygons back. `NavMesh` in
// brogameagent (include/brogameagent/nav_mesh.h) offers valid / findPath /
// nearestPoint / raycast / randomPoint / save / the obstacle API — and nothing
// that enumerates polygons, vertices, or even reports a polygon count. It is
// not a missing binding; the C++ class has no such accessor either. So a
// literal "draw the navmesh polygons" overlay is not implementable today.
//
// What this module draws instead is a SAMPLED walkable surface: a regular XZ
// lattice where every point is pushed through `nearestPoint` with a tight Y
// extent, once per storey. A point that snaps within half a cell of where it
// was asked is on the mesh; anything else is off it. Rendering the survivors as
// small quads at their SNAPPED height gives an overlay that is genuinely
// derived from the baked surface — it hugs the ramps, it stops dead at eroded
// walls, it stacks correctly over the mezzanine, and it visibly shrinks back
// from every wall as you raise agentRadius. `walkableSamples` then stands in
// for the poly count the API won't give us: same job (a single number that
// moves when the bake changes), honestly named.
//
// The tight Y extent is load-bearing. `NavMesh.kDefaultExtents` is y=1, and
// this level stacks storeys 4 m apart; probing each storey with y=1.2 keeps
// the mezzanine from swallowing the hall floor beneath it.

import { bounds, storeys } from '/app/level.js';

// Bake parameters, all live on HUD controls. Defaults are the API's own
// (agentRadius 0.5, height 2.0, climb 0.4, slope 45°, cell 0.25) so the app
// starts from documented behaviour rather than a tuned special case.
export const bakeParams = {
    agentRadius: 0.5,
    agentHeight: 2.0,
    agentMaxClimb: 0.4,
    agentMaxSlopeDeg: 45,
    cellSize: 0.25,

    // Tiled dtTileCache bake, which is what makes the runtime obstacle API
    // available (see obstacles.js). Off by default: the tiled build cannot be
    // serialised, so the save/load section of this app only works on a static
    // bake, and starting in the mode that supports MORE of the app is the
    // honest default.
    dynamicObstacles: false,
    tileSize: 16,
    maxObstacles: 128,
};

// Cache path for the save/load round trip. Hardcoded on purpose — native file
// dialogs block a headless run forever, so this app never opens one.
export const CACHE_PATH = 'nav-lab.navmesh';

// Off-mesh links, injected by links.js through the setter below rather than
// imported, so navmesh.js and links.js do not form an import cycle. null = a
// plain bake with no links at all.
let offMeshLinks = null;
export function setOffMeshLinks(defs) { offMeshLinks = defs && defs.length ? defs : null; }
export function currentOffMeshLinks() { return offMeshLinks; }

export const navState = {
    mesh: null,
    grid: null,
    linksBaked: 0,        // links handed to the last successful bake
    walkableSamples: 0,   // overlay proxy for the poly count the API lacks
    overlayQuads: 0,
    bakeMs: 0,
    blobBytes: 0,
    lastError: '',
    probeStep: 0.6,
    dynamic: false,       // did the last bake produce an obstacle-capable mesh?
    generation: 0,        // mesh.generation at the last bake
};

// --- Bake --------------------------------------------------------------------

// Re-bake from the live physics world. Returns the new mesh, or null with
// navState.lastError set — a bake CAN legitimately fail (erode the level away
// with a huge agentRadius and Recast has nothing left to build), and the HUD
// should say so rather than the app dying.
export function bake() {
    const t0 = performance.now();
    try {
        const opts = {
            fromPhysics: Physics,
            physicsLayers: ['static'],
            agentRadius: bakeParams.agentRadius,
            agentHeight: bakeParams.agentHeight,
            agentMaxClimb: bakeParams.agentMaxClimb,
            agentMaxSlopeDeg: bakeParams.agentMaxSlopeDeg,
            cellSize: bakeParams.cellSize,
            cellHeight: 0.2,
        };
        // The two exclusive modes. bakeNavMesh THROWS when offMeshLinks and
        // dynamicObstacles are combined — tile rebuilds would drop the links —
        // so the tiled bake wins and the links are left out rather than
        // letting a mode switch blow up the app. links.js's HUD says which
        // mode is live and why the other half is unavailable.
        if (bakeParams.dynamicObstacles) {
            opts.dynamicObstacles = true;
            opts.tileSize = bakeParams.tileSize;
            opts.maxObstacles = bakeParams.maxObstacles;
            navState.linksBaked = 0;
        } else if (offMeshLinks) {
            opts.offMeshLinks = offMeshLinks.map(l => ({
                start: l.start, end: l.end,
                radius: l.radius, bidirectional: l.bidirectional, userId: l.userId,
            }));
            navState.linksBaked = offMeshLinks.length;
        } else {
            navState.linksBaked = 0;
        }
        const mesh = bro.ai.game.bakeNavMesh(opts);
        navState.bakeMs = performance.now() - t0;
        navState.mesh = mesh;
        navState.lastError = '';
        navState.dynamic = !!mesh.supportsObstacles;
        navState.generation = mesh.generation;
        // save() THROWS on a tiled mesh — dtTileCache has no serialisation in
        // bro. Report 0 rather than guessing or swallowing the exception.
        navState.blobBytes = navState.dynamic ? 0 : mesh.save().byteLength;
        return mesh;
    } catch (e) {
        navState.bakeMs = performance.now() - t0;
        navState.lastError = String(e && e.message || e);
        return null;
    }
}

// The 2D counterpart, baked from the SAME static bodies but clamped to the
// ground slab's Y band. That clamp is the comparison's whole point: a NavGrid
// has one bit per XZ cell, so it can only ever describe one storey, and you
// must pick which one up front.
export function bakeGrid() {
    navState.grid = bro.ai.game.createNavGrid({
        minX: bounds.minX, maxX: bounds.maxX,
        minZ: bounds.minZ, maxZ: bounds.maxZ,
        cellSize: 0.4,
        fromPhysics: Physics,
        physicsLayers: ['static'],
        physicsMinY: 0.05,          // above the ground slab's top face...
        physicsMaxY: 2.5,           // ...and below the mezzanine's underside
        padding: bakeParams.agentRadius,
    });
    return navState.grid;
}

// --- Sampled walkable-surface overlay ----------------------------------------

let overlayNode = null;

// Probe the lattice and rebuild the overlay mesh. One node, one raw triangle
// soup — a node per sample would be thousands of draws for a debug view.
export function rebuildOverlay(scene) {
    if (overlayNode) { scene.destroyNode(overlayNode); overlayNode = null; }
    navState.walkableSamples = 0;
    navState.overlayQuads = 0;
    const mesh = navState.mesh;
    if (!mesh || !mesh.valid) return null;

    const step = navState.probeStep;
    const half = step * 0.42;        // small gap between quads reads as a grid
    const ext = { x: step * 0.5, y: 1.2, z: step * 0.5 };

    const pos = [], nrm = [], idx = [];
    for (let x = bounds.minX; x <= bounds.maxX; x += step) {
        for (let z = bounds.minZ; z <= bounds.maxZ; z += step) {
            for (const storeyY of storeys) {
                const q = mesh.nearestPoint({ x, y: storeyY, z }, ext);
                if (!q) continue;
                // nearestPoint clamps to the extents box, so a hit on the far
                // side of an eroded wall still comes back — reject anything
                // that had to travel to reach the surface.
                if (Math.abs(q.x - x) > step * 0.3 || Math.abs(q.z - z) > step * 0.3) continue;
                navState.walkableSamples++;
                const b = pos.length / 3;
                const y = q.y + 0.06;   // float clear of z-fighting with the floor
                pos.push(x - half, y, z - half,  x + half, y, z - half,
                         x + half, y, z + half,  x - half, y, z + half);
                for (let k = 0; k < 4; k++) nrm.push(0, 1, 0);
                idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
                navState.overlayQuads++;
            }
        }
    }
    if (!pos.length) return null;

    overlayNode = scene.createMesh({
        name: 'navOverlay',
        positions: new Float32Array(pos),
        normals: new Float32Array(nrm),
        indices: new Uint32Array(idx),
        color: [0.20, 0.85, 0.95, 1.0],
        emissive: 0.9,
        emissiveColor: [0.15, 0.70, 0.85],
        roughness: 1.0,
        twoSided: true,
    });
    overlayNode.castsShadow = false;
    return overlayNode;
}

export function setOverlayVisible(v) {
    if (overlayNode) overlayNode.visible = !!v;
}

export function overlay() { return overlayNode; }

// --- Path ribbons ------------------------------------------------------------
//
// Two path drawings share one builder: the navmesh path (3D, follows ramps and
// climbs storeys) and the NavGrid path (pinned to y=0, because a grid has no
// height to give). Drawing them in the same style at their real heights is what
// makes the comparison self-evident on screen.

// Build a flat ribbon along a list of {x,y,z} points. Returns a scene node, or
// null for a degenerate path.
export function buildRibbon(scene, pts, opts) {
    opts = opts || {};
    const w = opts.width != null ? opts.width : 0.22;
    const lift = opts.lift != null ? opts.lift : 0.16;
    if (!pts || pts.length < 2) return null;

    const pos = [], nrm = [], idx = [];
    for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        let dx = b.x - a.x, dz = b.z - a.z;
        const L = Math.hypot(dx, dz);
        if (L < 1e-4) continue;
        // Perpendicular in XZ; the ribbon stays horizontal even on ramps, which
        // keeps it readable from the orbit camera instead of edge-on.
        const px = (-dz / L) * w, pz = (dx / L) * w;
        const base = pos.length / 3;
        pos.push(a.x - px, a.y + lift, a.z - pz,  a.x + px, a.y + lift, a.z + pz,
                 b.x + px, b.y + lift, b.z + pz,  b.x - px, b.y + lift, b.z - pz);
        for (let k = 0; k < 4; k++) nrm.push(0, 1, 0);
        idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    if (!pos.length) return null;

    const node = scene.createMesh({
        name: opts.name || 'pathRibbon',
        positions: new Float32Array(pos),
        normals: new Float32Array(nrm),
        indices: new Uint32Array(idx),
        color: opts.color || [1.0, 0.78, 0.25, 1.0],
        emissive: opts.emissive != null ? opts.emissive : 1.4,
        emissiveColor: opts.emissiveColor || opts.color || [1.0, 0.7, 0.2],
        roughness: 1.0,
        twoSided: true,
    });
    node.castsShadow = false;
    return node;
}

// --- Queries -----------------------------------------------------------------

// findPath, unpacked from the flat Float32Array into {x,y,z} points and
// annotated with the numbers the HUD reports. The tight Y extent matters here
// for the same reason it does in the sampler: it is what makes a query near the
// mezzanine resolve to the mezzanine rather than the hall four metres below.
export function findPath(from, to, opts) {
    const mesh = navState.mesh;
    if (!mesh || !mesh.valid) return null;
    const wp = mesh.findPath(from, to, {
        extents: { x: 2, y: 1.2, z: 2 },
        requireFullPath: !!(opts && opts.requireFullPath),
    });
    if (!wp) return null;

    const pts = [];
    for (let i = 0; i < wp.length; i += 3) pts.push({ x: wp[i], y: wp[i + 1], z: wp[i + 2] });

    let length = 0, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
        if (i) length += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y, p.z - pts[i - 1].z);
    }
    // `links` holds the POINT indices whose following segment is an off-mesh
    // link traversal rather than a walk across the surface. Empty on a mesh
    // baked without links, or on a route that happened not to use one.
    return { points: pts, length, minY, maxY, rise: maxY - minY,
             partial: !!wp.partial, links: wp.links || [] };
}

// The same query put to the 2D grid. Returns points at a constant y=0 — not a
// simplification on our part, that is literally all a NavGrid knows.
export function findGridPath(from, to) {
    const grid = navState.grid;
    if (!grid) return null;
    const raw = grid.findPath(from.x, from.z, to.x, to.z);
    if (!raw || !raw.length) return null;
    const pts = raw.map(p => ({ x: p.x, y: 0, z: p.z }));
    let length = 0;
    for (let i = 1; i < pts.length; i++)
        length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    return { points: pts, length, partial: !!raw.partial };
}

// --- Save / load round trip --------------------------------------------------
//
// The documented production recipe is bake once, cache to disk, memcpy back at
// startup. Exercising it from the HUD proves the cache is real rather than
// aspirational: reload, re-query, and confirm the restored mesh answers the
// same path with the same waypoints.

export function saveMesh() {
    const fs = require('fs');
    if (!navState.mesh || !navState.mesh.valid) throw new Error('no baked mesh to save');
    const blob = navState.mesh.save();
    fs.writeFileSync(CACHE_PATH, Buffer.from(blob));
    navState.blobBytes = blob.byteLength;
    return blob.byteLength;
}

// Load the cached blob and verify it against the in-memory mesh by replaying a
// path query on both. A byte count alone would not prove the mesh SURVIVED the
// round trip, only that bytes moved.
export function loadMesh(probeFrom, probeTo) {
    const fs = require('fs');
    const buf = fs.readFileSync(CACHE_PATH);
    const restored = bro.ai.game.loadNavMesh(buf.buffer || buf);

    const before = navState.mesh && navState.mesh.valid
        ? navState.mesh.findPath(probeFrom, probeTo, { extents: { x: 2, y: 1.2, z: 2 } })
        : null;
    const after = restored.findPath(probeFrom, probeTo, { extents: { x: 2, y: 1.2, z: 2 } });

    let identical = !!(before && after) && before.length === after.length;
    if (identical) {
        for (let i = 0; i < before.length; i++) {
            if (Math.abs(before[i] - after[i]) > 1e-5) { identical = false; break; }
        }
    }
    navState.mesh = restored;
    return {
        bytes: buf.length != null ? buf.length : buf.byteLength,
        valid: restored.valid,
        waypointsBefore: before ? before.length / 3 : 0,
        waypointsAfter: after ? after.length / 3 : 0,
        identical,
    };
}

// Dynamic obstacles live in obstacles.js and the ORCA crowd in crowd.js; both
// build on the bake configured above (`bakeParams.dynamicObstacles`).

// Off-mesh links live in links.js (they are handed to bake() through
// setOffMeshLinks above), the NavGrid overlay and groundFollow demo in grid.js,
// and the steer.* / computeLeadAim kernels in steering.js.
