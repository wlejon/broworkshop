// lab.js — Navigation Lab: bro's Recast/Detour navmesh on a level built to
// break a grid, and the rest of bro.ai.game's navigation surface made
// falsifiable.
//
//   level.js      the building: stacked floors, ramps, stairs, a choke, the link yard
//   navmesh.js    bake (fromPhysics), sampled surface overlay, queries, save/load
//   agents.js     route walkers on the kit's JS waypoint follower
//   obstacles.js  the tiled dtTileCache bake: crates that carve the surface
//   crowd.js      ORCA avoidance scored by an overlap counter
//   links.js      off-mesh links (jump / drop / ladder), binding walkers, partial paths
//   grid.js       the NavGrid from the same physics, and the groundFollow contrast
//   steering.js   the five steer.* kernels and computeLeadAim's turret
//   lab.js        this: scene, path markers, bake pipeline, picking, frame loop
//   hud.js        the controls and readouts
//
// A tour, top to bottom of the side panel: raise "Agent radius" and re-bake
// (the corridor closes); tick the NavGrid overlay (one flat sheet vs four
// storeys); "Cross floor" then "Compare against NavGrid" (pinned at y 0);
// "Send over the gap" (onLink lights up mid-air); "Seal the pad" + "Run the
// comparison" (one flag, two answers); "Walk the ramp" (groundFollow); the
// crowd scenarios with avoidance on and off; the tiled mode's crates; the
// steering pad and the turret.
//
// Tests import this module and the ones above it, never main.js.

import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";
import { fixedStep } from "/lib/kit/ui.js";
import { localPoint } from "/lib/kit/physics3d.js";
import { ribbon, marker, pipPool, pickSurface } from "/lib/kit/nav3d.js";
import { buildLevel, buildLights, marks } from "/app/level.js";
import { bakeParams, navState, bake, bakeGrid, rebuildOverlay, findPath, findGridPath } from "/app/navmesh.js";
import { createAgentWorld, spawnAgent, retargetAll, tickAgents, repathAll } from "/app/agents.js";
import { bindObstacleScene, obstacleState, clearObstacles, pumpObstacles, toggleObstacleAt } from "/app/obstacles.js";
import { bindCrowdScene, tickCrowd } from "/app/crowd.js";
import { bindLinkScene, rebuildLinkVisuals, spawnLinkWalkers, tickLinkWalkers, stopLinkWalkers, syncLinksToBake, setLinksEnabled } from "/app/links.js";
import { bindGridScene, rebuildGridOverlay, spawnFollowers, tickFollowers } from "/app/grid.js";
import { buildSteering, tickSteering } from "/app/steering.js";

export const state = {
    start: { ...marks.hallSW },
    goal: { ...marks.eastRoom },
    path: null,
    gridPath: null,
    showGrid: false,          // compute + draw the NavGrid's answer too
    requireFullPath: false,   // hard-fail semantics on every HUD query
    showShell: true,
};

const listeners = {};
/** Subscribe to 'path' | 'bake' | 'obstacles' | 'tick' (HUD readouts). */
export function on(ev, fn) { (listeners[ev] || (listeners[ev] = [])).push(fn); }
function emit(ev, arg) { for (const fn of listeners[ev] || []) fn(arg); }

export const lab = {
    vp: null, scene: null, levelNodes: [], lights: null,
    get started() { return !!this.scene; },
};

let startMarker, goalMarker, clampMarker, pips, pathNode = null, gridNode = null;

/** Build the scene and everything in it. Called once by main.js. */
export function startLab(canvas) {
    const vp = sceneViewport(canvas, {
        // Framed on the west hall with the mezzanine and roof in shot: the
        // stacked storeys are the thesis and should be visible at once.
        orbit: { target: [0, 2, 0], dist: 50, fov: 50, near: 0.2, far: 400, rot: orbitRotation(0.55, -0.62) },
        controls: { minDist: 3 },
    });
    const scene = vp.scene;
    Object.assign(lab, { vp, scene });
    lab.levelNodes = buildLevel(scene);   // before the first bake: fromPhysics sees only what exists
    lab.lights = buildLights(scene);
    bindObstacleScene(scene); bindCrowdScene(scene); bindLinkScene(scene); bindGridScene(scene);

    startMarker = marker(scene, '#7bed9f');
    goalMarker = marker(scene, '#ff6b6b');
    clampMarker = marker(scene, '#ff8f5a');   // where a partial route gives up
    clampMarker.visible = false;
    pips = pipPool(scene, 48);

    createAgentWorld();
    syncLinksToBake();   // links are in the default bake: the mode where most of the engine is reachable
    rebake();

    // Spawn on the surface, not at nominal coordinates (a wide-radius bake erodes the margin).
    const base = (navState.mesh && navState.mesh.nearestPoint(marks.hallSW, { x: 3, y: 1.2, z: 3 })) || marks.hallSW;
    for (let i = 0; i < 4; i++) {
        spawnAgent(scene, { x: base.x + (i % 2) * 1.6 - 0.8, y: base.y, z: base.z + Math.floor(i / 2) * 1.6 - 0.8 }, i);
    }
    spawnLinkWalkers();
    spawnFollowers();
    buildSteering(scene);   // hidden until asked for

    vp.canvas.addEventListener('mousedown', onPick);
    vp.onFrame(frame);
    return lab;
}

// --- path ----------------------------------------------------------------------------

function place(node, p, lift) { node.x = p.x; node.y = p.y + lift; node.z = p.z; }

/** The one entry point for every path change (HUD buttons, clicks, tests). */
export function refreshPath() {
    const scene = lab.scene;
    if (pathNode) { pathNode.destroy(); pathNode = null; }
    if (gridNode) { gridNode.destroy(); gridNode = null; }
    state.path = findPath(state.start, state.goal, { requireFullPath: state.requireFullPath });
    place(startMarker, state.start, 0.5);
    place(goalMarker, state.goal, 0.5);
    const pts = state.path ? state.path.points : null;
    if (pts) pathNode = ribbon(scene, pts, { name: 'navPath', width: 0.24, lift: 0.16 });
    pips.show(pts);
    // A clamped route gets a mark of its own: its last waypoint is NOT the
    // goal, and drawing it in pip yellow is how a demo lies about what it found.
    clampMarker.visible = !!(state.path && state.path.partial && pts.length);
    if (clampMarker.visible) place(clampMarker, pts[pts.length - 1], 0.7);
    // The grid's answer is computed even when unreachable: "the grid could not
    // do this" is the interesting result.
    state.gridPath = state.showGrid ? findGridPath(state.start, state.goal) : null;
    if (state.gridPath) {
        gridNode = ribbon(scene, state.gridPath.points, { name: 'gridPath', width: 0.17, lift: 0.1, color: [1.0, 0.35, 0.85, 1.0], emissive: 1.2 });
    }
    emit('path', state.path);
    return state.path;
}

export function setStart(p) { state.start = { ...p }; return refreshPath(); }
export function setGoal(p) { state.goal = { ...p }; return refreshPath(); }
export function setRoute(from, to) { state.start = { ...from }; state.goal = { ...to }; return refreshPath(); }

// --- bake pipeline -------------------------------------------------------------------

/**
 * Re-bake with the current parameters and redraw everything derived from the
 * mesh. Live link routes are stopped first: they were planned on the surface
 * being replaced.
 */
export function rebake() {
    stopLinkWalkers();
    syncLinksToBake();
    const mesh = bake();
    bakeGrid();
    drawSurface();
    rebuildGridOverlay();
    rebuildLinkVisuals();
    refreshPath();
    emit('bake', mesh);
    return mesh;
}

/**
 * Static + links (false) or tiled + obstacles (true): a re-bake, not a toggle.
 * Obstacles are dropped on the way through (their handles belong to the mesh
 * being thrown away), and the link flag follows so the two cannot disagree.
 */
export function applyMode(tiled) {
    clearObstacles();
    bakeParams.dynamicObstacles = !!tiled;
    setLinksEnabled(!tiled);
    return rebake();
}

/** Re-probe the overlay against the current mesh (on change only; ~20k queries). */
export function refreshOverlay() {
    drawSurface();
    emit('bake', navState.mesh);
}

/**
 * Where an obstacle change lands: pump the tile rebuilds, redraw the overlay
 * hole, re-plan every live route and the HUD's own path.
 */
export function afterObstacleChange() {
    pumpObstacles();
    drawSurface();
    repathAll();
    refreshPath();
    emit('obstacles', obstacleState.lastError);
}

// The overlay is redrawn whenever the mesh or its generation differs from
// what was last drawn (a bake, a load, an obstacle batch the engine pumped).
let drawnMesh = null, drawnGeneration = -1;
function drawSurface() {
    rebuildOverlay(lab.scene);
    drawnMesh = navState.mesh;
    drawnGeneration = drawnMesh ? drawnMesh.generation : -1;
}

export function setShellVisible(on) {
    state.showShell = !!on;
    for (const { node } of lab.levelNodes) node.visible = state.showShell;
}

// --- picking -------------------------------------------------------------------------

/** The walkable point under a canvas-local pixel (a physics ray, snapped onto the mesh). */
export function pickLevel(lx, ly) {
    return pickSurface(lab.vp, lx, ly, { mesh: navState.mesh });
}

// Left button: set the start; shift: the goal; ctrl: retarget the walkers;
// alt: drop or pick up a crate (the same path the "Block the corridor" button runs).
function onPick(e) {
    if (e.button !== 0) return;
    const [lx, ly] = localPoint(lab.vp.canvas, e);
    const p = pickLevel(lx, ly);
    if (!p) return;
    if (e.altKey) {
        const r = toggleObstacleAt(p);
        afterObstacleChange();
        emit('crate', r);
    } else if (e.ctrlKey) retargetAll(p);
    else if (e.shiftKey) setGoal(p);
    else setStart(p);
}

// --- frame loop ----------------------------------------------------------------------
//
// The AI world steps on a fixed 60 Hz accumulator (steering that varies with
// frame time is not reproducible, and the tests assert exact positions).

const step = fixedStep(1 / 60);
let frames = 0;

function frame(dt) {
    step(dt, (h) => {
        tickAgents(h);   // one world, one tick: the crowd only consumes waypoints and measures
        tickCrowd();
        tickSteering(h);
    });
    // These read what the ENGINE wrote (binding transforms, onLink), once a frame.
    tickLinkWalkers();
    tickFollowers();
    // The engine pumps queued obstacle rebuilds on its own; redraw the overlay
    // when the surface version moves so a new hole appears without a click.
    const mesh = navState.mesh;
    if (mesh !== drawnMesh || (mesh && mesh.generation !== drawnGeneration)) {
        drawSurface();
        emit('bake', mesh);
    }
    if (++frames % 20 === 0) emit('tick');
}
