// navmesh.js — bake, draw, query and cache the polygon navmesh.
//
// Baked with `fromPhysics`: the walkable surface comes from the same static
// Jolt bodies the level collides with, so AI and collision cannot disagree.
//
// The overlay is SAMPLED (kit walkableOverlay): bro has no polygon read-back
// (brogameagent's NavMesh has no accessor either), so a lattice is snapped
// through nearestPoint once per storey with a tight Y extent. It hugs the
// ramps, stops at eroded walls, stacks over the mezzanine and shrinks as the
// agent radius grows; `walkableSamples` stands in for the poly count the API
// does not give. The tight Y extent is load-bearing: the default y = 1 would
// be fine, but storeys 4 m apart must never swallow each other.
//
// Two bakes, one switch: off-mesh links and dynamic obstacles are exclusive
// (`bakeNavMesh` throws if asked for both — dtTileCache tile rebuilds would
// drop the links). `bakeParams.dynamicObstacles` picks the tiled bake and the
// links are left out; the HUD says which is live.

import { walkableOverlay, routeOf } from "/lib/kit/nav3d.js";
import { bounds, storeys } from "/app/level.js";

/** Bake parameters, all on HUD controls. Defaults are the API's own. */
export const bakeParams = {
    agentRadius: 0.5,
    agentHeight: 2.0,
    agentMaxClimb: 0.4,
    agentMaxSlopeDeg: 45,
    cellSize: 0.25,
    // Tiled dtTileCache bake: the runtime obstacle API (obstacles.js). Off by
    // default: a tiled mesh cannot be saved, and links need the static bake.
    dynamicObstacles: false,
    tileSize: 16,
    maxObstacles: 128,
};

/** Snap extents for every query: tight in Y so stacked storeys resolve apart. */
export const EXTENTS = { x: 2, y: 1.2, z: 2 };

export const navState = {
    mesh: null,
    grid: null,
    links: null,          // off-mesh link defs for the next static bake (links.js sets them)
    linksBaked: 0,        // links handed to the last successful bake
    walkableSamples: 0,   // overlay proxy for the poly count the API lacks
    overlayQuads: 0,
    overlay: null,        // overlay node
    overlayVisible: true,
    probeStep: 0.6,
    bakeMs: 0,
    blobBytes: 0,
    lastError: '',
};

// --- bake ----------------------------------------------------------------------------

/**
 * Re-bake from the live physics world. A bake can legitimately fail (erode the
 * level away with a huge radius); that returns null with navState.lastError
 * set rather than killing the app.
 */
export function bake() {
    const t0 = performance.now();
    const opts = {
        fromPhysics: Physics, physicsLayers: ['static'],
        agentRadius: bakeParams.agentRadius, agentHeight: bakeParams.agentHeight,
        agentMaxClimb: bakeParams.agentMaxClimb, agentMaxSlopeDeg: bakeParams.agentMaxSlopeDeg,
        cellSize: bakeParams.cellSize, cellHeight: 0.2,
    };
    let links = 0;
    if (bakeParams.dynamicObstacles) {
        Object.assign(opts, { dynamicObstacles: true, tileSize: bakeParams.tileSize, maxObstacles: bakeParams.maxObstacles });
    } else if (navState.links && navState.links.length) {
        opts.offMeshLinks = navState.links.map((l) => ({
            start: l.start, end: l.end, radius: l.radius, bidirectional: l.bidirectional, userId: l.userId,
        }));
        links = navState.links.length;
    }
    try {
        const mesh = bro.ai.game.bakeNavMesh(opts);
        navState.mesh = mesh;
        navState.linksBaked = links;
        navState.lastError = '';
        // save() THROWS on a tiled mesh (no dtTileCache serialisation in bro).
        navState.blobBytes = mesh.supportsObstacles ? 0 : mesh.save().byteLength;
        return mesh;
    } catch (e) {
        navState.lastError = String((e && e.message) || e);
        return null;
    } finally {
        navState.bakeMs = performance.now() - t0;
    }
}

/**
 * The 2D counterpart, from the SAME static bodies, clamped to the ground
 * storey's Y band: a NavGrid holds one bit per XZ cell, so the storey is
 * chosen at bake time.
 */
export function bakeGrid() {
    navState.grid = bro.ai.game.createNavGrid({
        minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ,
        cellSize: 0.4, fromPhysics: Physics, physicsLayers: ['static'],
        physicsMinY: 0.05,   // above the ground slab's top face...
        physicsMaxY: 2.5,    // ...and below the mezzanine's underside
        padding: bakeParams.agentRadius,
    });
    return navState.grid;
}

// --- overlay -------------------------------------------------------------------------

/** Re-probe the walkable-surface overlay (~20k nearestPoint calls: on change only). */
export function rebuildOverlay(scene) {
    if (navState.overlay) { navState.overlay.destroy(); navState.overlay = null; }
    const { node, samples } = walkableOverlay(scene, navState.mesh, {
        bounds, storeys, step: navState.probeStep,
        look: { color: [0.2, 0.85, 0.95, 1], emissiveColor: [0.15, 0.7, 0.85] },
    });
    navState.overlay = node;
    navState.walkableSamples = navState.overlayQuads = samples;
    setOverlayVisible(navState.overlayVisible);
    return node;
}

export function setOverlayVisible(on) {
    navState.overlayVisible = !!on;
    if (navState.overlay) navState.overlay.visible = navState.overlayVisible;
}

// --- queries -------------------------------------------------------------------------

/**
 * findPath as a kit route ({ points, length, rise, partial, links, ... }).
 * opts: { requireFullPath }.
 */
export function findPath(from, to, opts) {
    const mesh = navState.mesh;
    if (!mesh || !mesh.valid) return null;
    return routeOf(mesh.findPath(from, to, { extents: EXTENTS, requireFullPath: !!(opts && opts.requireFullPath) }));
}

/** The same query put to the NavGrid: points at y = 0, all a grid knows. */
export function findGridPath(from, to) {
    const grid = navState.grid;
    if (!grid) return null;
    const raw = grid.findPath(from.x, from.z, to.x, to.z);
    if (!raw || !raw.length) return null;
    const points = raw.map((p) => ({ x: p.x, y: 0, z: p.z }));
    let length = 0;
    for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    return { points, length, partial: !!raw.partial };
}

// --- save / load round trip ----------------------------------------------------------
//
// The production recipe: bake once, cache to disk, memcpy back at startup. A
// fixed path (native file dialogs would block a headless run) in the temp dir,
// not the app folder, so running the tests leaves the checkout clean.

export const CACHE_PATH = require('path').join(require('os').tmpdir(), 'bro-nav-lab.navmesh');

export function saveMesh() {
    if (!navState.mesh || !navState.mesh.valid) throw new Error('no baked mesh to save');
    const blob = navState.mesh.save();
    require('fs').writeFileSync(CACHE_PATH, Buffer.from(blob));
    navState.blobBytes = blob.byteLength;
    return blob.byteLength;
}

/**
 * Load the cached blob and verify it by replaying one query on the old and the
 * restored mesh: a byte count only proves bytes moved, not that the mesh
 * survived. The restored mesh becomes the live one.
 */
export function loadMesh(probeFrom, probeTo) {
    const buf = require('fs').readFileSync(CACHE_PATH);
    const restored = bro.ai.game.loadNavMesh(buf.buffer || buf);
    const ask = (m) => (m && m.valid ? m.findPath(probeFrom, probeTo, { extents: EXTENTS }) : null);
    const before = ask(navState.mesh), after = ask(restored);
    let identical = !!(before && after) && before.length === after.length;
    for (let i = 0; identical && i < before.length; i++) identical = Math.abs(before[i] - after[i]) <= 1e-5;
    navState.mesh = restored;
    return {
        bytes: buf.length != null ? buf.length : buf.byteLength,
        valid: restored.valid,
        waypointsBefore: before ? before.length / 3 : 0,
        waypointsAfter: after ? after.length / 3 : 0,
        identical,
    };
}
