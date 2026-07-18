// Navigation Lab — bro's polygon navmesh, on a level built to break a grid.
//
// bro ships a full Recast/Detour navmesh (bakeNavMesh / loadNavMesh, dynamic
// obstacles, off-mesh links, ORCA avoidance) and, until this app, nothing used
// it: every game in the workshop pathfinds on the flat `NavGrid`. That is fine
// for a single-storey arena and hopeless the moment a level has height. This
// app is the argument, made visible.
//
//   level.js    The building. Stacked floors, three ramps, a staircase, a
//               2.6 m choke point — one descriptor list driving both the
//               visual meshes and the Jolt static bodies.
//   navmesh.js  The bake (from the physics geometry, not a hand-written
//               triangle list), the sampled walkable-surface overlay, the
//               path queries, and the save/load cache.
//   agents.js   Walkers that follow the routes, so a path is something that
//               gets traversed rather than a line on the floor.
//   app.js      Wiring: camera, HUD, picking, the frame loop, exports.
//
// The two things worth doing first: raise "Agent radius" and re-bake to watch
// the walkable surface pull back from every wall until the corridor closes, and
// hit "Cross floor" to route from the ground hall up onto the mezzanine — then
// tick "Compare against NavGrid" and watch the grid answer stay pinned at
// y = 0, because one bit per XZ cell is all it has.

import "/lib/camera.js";
import { installSystemMenu } from "/lib/system-menu.js";
import { buildLevel, buildEnvironment, marks } from "/app/level.js";
import {
    bakeParams, navState, bake, bakeGrid, rebuildOverlay, setOverlayVisible,
    findPath, findGridPath, buildRibbon, saveMesh, loadMesh, CACHE_PATH,
} from "/app/navmesh.js";
import {
    agentState, createAgentWorld, spawnAgent, retargetAll, tickAgents, repathAll,
} from "/app/agents.js";
import {
    obstacleState, obstaclesEnabled, toggleObstacleAt, blockCorridor,
    clearObstacles, pumpObstacles, obstacleCount, obstaclesPending, CHOKE,
    placeObstacle, removeObstacle,
} from "/app/obstacles.js";
import {
    crowdState, setAvoidance, clearCrowd, tickCrowd, overlapMean,
    scenarioFunnel, scenarioVip, scenarioFactions, scenarioStacked,
    deviationOf, findRole, snapshot, resetPositions, resetStats, setAvoidHeight,
    STACK_LANE,
} from "/app/crowd.js";

installSystemMenu();

const canvas = document.getElementById('stage');
const scene = canvas.getContext('scene');

// Framed on the west hall with the mezzanine and roof deck in shot, because
// the stacked storeys are the whole thesis and they should be visible before
// the user touches anything.
const cam = Camera.createOrbit({
    target: [-2, 3, 2],
    dist: 52,
    fov: 50,
    near: 0.2,
    far: 400,
});

const levelNodes = buildLevel(scene);
const lights = buildEnvironment(scene);

// --- Shared app state --------------------------------------------------------

const state = {
    start: { ...marks.hallSW },
    goal: { ...marks.eastRoom },
    path: null,
    gridPath: null,
    showGrid: false,
    showOverlay: true,
    showShell: true,
};

let pathNode = null, gridNode = null;
const markerNodes = [];

// --- Query markers -----------------------------------------------------------

function makeMarker(color) {
    const n = scene.createMesh({
        mesh: 'sphere', radius: 0.42,
        color, emissive: 1.6, emissiveColor: color, roughness: 1.0,
    });
    n.castsShadow = false;
    markerNodes.push(n);
    return n;
}
const startMarker = makeMarker('#7bed9f');
const goalMarker = makeMarker('#ff6b6b');

// Waypoint pips. Pre-allocated and parked out of sight rather than created and
// destroyed per query — a click-to-path app re-queries constantly, and churning
// scene nodes on every click is the wrong shape.
const MAX_PIPS = 48;
const pips = [];
for (let i = 0; i < MAX_PIPS; i++) {
    const p = scene.createMesh({
        mesh: 'sphere', radius: 0.19,
        color: '#ffd166', emissive: 2.0, emissiveColor: '#ffb020', roughness: 1.0,
    });
    p.castsShadow = false;
    p.visible = false;
    pips.push(p);
}

function placeMarker(node, p) { node.x = p.x; node.y = p.y + 0.5; node.z = p.z; }

// --- Path rebuild ------------------------------------------------------------
//
// One entry point for every path change, so the HUD buttons, the click handler
// and the smoke test all travel the identical code path.

function refreshPath() {
    if (pathNode) { scene.destroyNode(pathNode); pathNode = null; }
    if (gridNode) { scene.destroyNode(gridNode); gridNode = null; }

    state.path = findPath(state.start, state.goal);

    placeMarker(startMarker, state.start);
    placeMarker(goalMarker, state.goal);

    if (state.path) {
        pathNode = buildRibbon(scene, state.path.points, {
            name: 'navPath', width: 0.24, lift: 0.16,
            color: [1.0, 0.78, 0.25, 1.0],
        });
        const pts = state.path.points;
        for (let i = 0; i < pips.length; i++) {
            const on = i < pts.length;
            pips[i].visible = on;
            if (on) { pips[i].x = pts[i].x; pips[i].y = pts[i].y + 0.22; pips[i].z = pts[i].z; }
        }
    } else {
        for (const p of pips) p.visible = false;
    }

    // The grid answer is computed whenever the comparison is on, even if it
    // ends up unreachable — "the grid could not do this" is the interesting
    // result, and it needs to be shown rather than hidden.
    state.gridPath = state.showGrid ? findGridPath(state.start, state.goal) : null;
    if (state.gridPath) {
        gridNode = buildRibbon(scene, state.gridPath.points, {
            name: 'gridPath', width: 0.17, lift: 0.10,
            color: [1.0, 0.35, 0.85, 1.0], emissive: 1.2,
        });
    }

    updatePathReadout();
}

// --- Bake pipeline -----------------------------------------------------------

function rebake() {
    const mesh = bake();
    bakeGrid();
    rebuildOverlay(scene);
    setOverlayVisible(state.showOverlay);
    refreshPath();
    updateBakeReadout();
    return mesh;
}

// --- HUD ---------------------------------------------------------------------

const $ = id => document.getElementById(id);

function bindRange(id, fmt, apply) {
    const el = $(id), out = $(id + 'V');
    const push = () => {
        const v = parseFloat(el.value);
        out.textContent = fmt(v);
        apply(v);
    };
    el.addEventListener('input', push);
    push();
    return el;
}

// Bake sliders write the parameter but do NOT re-bake — baking is seconds-scale
// on a real level, and a slider that re-bakes on every pixel of drag would be
// unusable. The explicit button is the honest interaction.
bindRange('pRadius', v => v.toFixed(2) + ' m', v => { bakeParams.agentRadius = v; markStale(); });
bindRange('pHeight', v => v.toFixed(1) + ' m', v => { bakeParams.agentHeight = v; markStale(); });
bindRange('pSlope',  v => v.toFixed(0) + '°',  v => { bakeParams.agentMaxSlopeDeg = v; markStale(); });
bindRange('pClimb',  v => v.toFixed(2) + ' m', v => { bakeParams.agentMaxClimb = v; markStale(); });
bindRange('pCell',   v => v.toFixed(3),        v => { bakeParams.cellSize = v; markStale(); });

let stale = false;
function markStale() {
    // Guard the first pass: bindRange pushes once at wire-up, before any bake.
    if (!navState.mesh) return;
    stale = true;
    const h = $('bakeHint');
    h.className = 'hint';
    h.textContent = 'Parameters changed — press Re-bake to apply.';
}

$('btnBake').addEventListener('click', () => { stale = false; rebake(); });

bindRange('ovStep', v => v.toFixed(2), v => {
    navState.probeStep = v;
    if (navState.mesh) { rebuildOverlay(scene); setOverlayVisible(state.showOverlay); updateBakeReadout(); }
});

$('ovOn').addEventListener('change', e => {
    state.showOverlay = e.target.checked;
    setOverlayVisible(state.showOverlay);
});

$('shellOn').addEventListener('change', e => {
    state.showShell = e.target.checked;
    for (const { node } of levelNodes) node.visible = state.showShell;
});

$('gridOn').addEventListener('change', e => {
    state.showGrid = e.target.checked;
    refreshPath();
});

bindRange('aSpeed', v => v.toFixed(1), v => {
    agentState.speed = v;
    for (const rec of agentState.agents) rec.agent.speed = v;
});

// Preset queries. "Cross floor" is the headline: a ground-floor start and a
// mezzanine goal, which a NavGrid cannot even express.
$('btnSameFloor').addEventListener('click', () => {
    state.start = { ...marks.hallSW }; state.goal = { ...marks.chamber }; refreshPath();
});
$('btnCrossFloor').addEventListener('click', () => {
    state.start = { ...marks.hallSW }; state.goal = { ...marks.mezzanine }; refreshPath();
});
$('btnToRoof').addEventListener('click', () => {
    state.start = { ...marks.eastRoom }; state.goal = { ...marks.roof }; refreshPath();
});

$('btnSend').addEventListener('click', () => retargetAll(state.goal));

// --- Dynamic obstacles -------------------------------------------------------
//
// Switching modes is a re-bake, not a toggle: static and tiled are two
// different Detour builds. Every obstacle is dropped on the way through,
// because their handles belong to the mesh that is about to be thrown away.

$('dynOn').addEventListener('change', e => {
    clearObstacles(scene);
    obstacleState.placed.length = 0;
    bakeParams.dynamicObstacles = e.target.checked;
    stale = false;
    rebake();
    updateObstacleReadout();
});

$('btnBlock').addEventListener('click', () => {
    const r = blockCorridor(scene);
    afterObstacleChange(r && r.action === 'blocked'
        ? 'Corridor blocked. Every route through the doorway re-planned; the '
        + 'overlay hole is the mesh, not a decal.'
        : 'Corridor reopened — the surface came back exactly as it was.');
});

$('btnClearObs').addEventListener('click', () => {
    const n = clearObstacles(scene);
    afterObstacleChange(`Removed ${n} obstacle${n === 1 ? '' : 's'}; the walkable `
                      + 'surface is restored.');
});

// One place where an obstacle change lands: pump the tile rebuilds, refresh the
// overlay so the hole is visible, re-plan every live route, and re-query the
// HUD's own path so the drawn ribbon is not stale either.
function afterObstacleChange(message) {
    const h = $('obsHint');
    if (!obstaclesEnabled()) {
        h.className = 'hint bad';
        h.textContent = 'Tick "Dynamic-obstacle bake" first — a static mesh has '
                      + 'no runtime obstacle API.';
        return;
    }
    pumpObstacles();
    rebuildOverlay(scene);
    setOverlayVisible(state.showOverlay);
    repathAll();
    refreshPath();
    updateBakeReadout();
    updateObstacleReadout();
    if (message) { h.className = 'hint good'; h.textContent = message; }
    if (obstacleState.lastError) {
        h.className = 'hint bad';
        h.textContent = obstacleState.lastError;
    }
}

function updateObstacleReadout() {
    $('stGen').textContent = navState.mesh ? navState.mesh.generation : '—';
    $('stObs').textContent = obstaclesEnabled() ? obstacleCount() : '—';
    $('stPending').textContent = obstaclesEnabled()
        ? (obstaclesPending() ? 'draining' : 'idle') : '—';
    $('stTiles').textContent = obstacleState.applyCalls;
    $('stRepath').textContent = agentState.repaths;
}

// --- ORCA crowd --------------------------------------------------------------

$('avoidOn').addEventListener('change', e => {
    setAvoidance(e.target.checked);
    updateCrowdReadout();
});

bindRange('cCount', v => v.toFixed(0), v => { crowdState.count = v | 0; });

function runScenario(fn, blurb) {
    fn(scene, crowdState.count);
    setAvoidance($('avoidOn').checked);
    const h = $('crowdHint');
    h.className = 'hint';
    h.textContent = blurb;
    updateCrowdReadout();
}

$('btnFunnel').addEventListener('click', () => runScenario(scenarioFunnel,
    'Both halves are ordered through the 2.6 m doorway at once. Toggle '
  + 'avoidance: with it off they walk through each other and the overlapping-'
  + 'pair count sits high; with it on they queue and sidestep.'));

$('btnVip').addEventListener('click', () => runScenario(scenarioVip,
    'Gold VIP at priority 1.0 and grey control at priority 0.0 make the same '
  + 'trip into the same oncoming crowd. The pair splits the avoidance effort by '
  + 'priority, so the control is shoved three times as far off its line.'));

$('btnFactions').addEventListener('click', () => runScenario(scenarioFactions,
    'Two factions cross one junction. Each masks only its own layer, so it '
  + 'queues against its own kind and walks straight through the other — '
  + 'layers/mask, doing something you can see.'));

$('btnStacked').addEventListener('click', () => runScenario(scenarioStacked,
    'The same lane on the hall floor and on the mezzanine 4 m above it. Agents '
  + 'carry an elevation and a 2 m avoidance height; the spans do not overlap, '
  + 'so the solver skips every cross-level pair and the two crowds ignore each '
  + 'other. A flat 2D solver would have them fighting through a floor.'));

$('btnClearCrowd').addEventListener('click', () => {
    clearCrowd(scene);
    updateCrowdReadout();
});

function updateCrowdReadout() {
    $('stScenario').textContent = crowdState.scenario;
    $('stCrowd').textContent = crowdState.agents.length;
    $('stOverlap').textContent = crowdState.overlapNow;
    $('stOverlapMean').textContent = overlapMean().toFixed(2);
}

$('btnSave').addEventListener('click', () => {
    const h = $('cacheHint');
    try {
        const bytes = saveMesh();
        h.className = 'hint good';
        h.textContent = `Saved ${bytes} bytes to ${CACHE_PATH}.`;
    } catch (e) {
        h.className = 'hint bad';
        h.textContent = 'Save failed: ' + (e.message || e);
    }
});

$('btnLoad').addEventListener('click', () => {
    const h = $('cacheHint');
    try {
        const r = loadMesh(state.start, state.goal);
        rebuildOverlay(scene);
        setOverlayVisible(state.showOverlay);
        refreshPath();
        updateBakeReadout();
        h.className = 'hint ' + (r.identical ? 'good' : 'bad');
        h.textContent = r.identical
            ? `Restored ${r.bytes} bytes; the same query returns the same ${r.waypointsAfter} waypoints.`
            : `Round trip mismatch: ${r.waypointsBefore} waypoints before, ${r.waypointsAfter} after.`;
    } catch (e) {
        h.className = 'hint bad';
        h.textContent = 'Load failed: ' + (e.message || e);
    }
});

// --- Readouts ----------------------------------------------------------------

function updateBakeReadout() {
    $('stSamples').textContent = navState.walkableSamples;
    $('stQuads').textContent = navState.overlayQuads;
    $('stBake').textContent = `${navState.bakeMs.toFixed(0)} ms / ${navState.blobBytes} B`;
    const h = $('bakeHint');
    if (navState.lastError) {
        h.className = 'hint bad';
        h.textContent = 'Bake failed: ' + navState.lastError;
    } else if (!stale) {
        h.className = 'hint good';
        h.textContent = `Baked from ${levelNodes.length} static bodies via fromPhysics.`;
    }
}

function updatePathReadout() {
    const p = state.path, h = $('pathHint');
    if (!p) {
        $('stWp').textContent = '—';
        $('stLen').textContent = 'no path';
        $('stRise').textContent = '—';
        h.className = 'hint bad';
        h.textContent = 'No route: an endpoint did not snap onto the baked surface. '
                      + 'Re-bake with a smaller agent radius, or pick a point on the mesh.';
    } else {
        $('stWp').textContent = p.points.length;
        $('stLen').textContent = p.length.toFixed(2) + ' m';
        $('stRise').textContent = p.rise.toFixed(2) + ' m';
        if (p.partial) {
            h.className = 'hint bad';
            h.textContent = 'Partial route — the goal is unreachable, so the path clamps '
                          + 'to the closest reachable point.';
        } else if (p.rise > 0.75) {
            h.className = 'hint good';
            h.textContent = `Multi-level route: the path climbs ${p.rise.toFixed(1)} m across `
                          + `storeys. A NavGrid has no Y at all and cannot express this.`;
        } else {
            h.className = 'hint';
            h.textContent = 'Single-storey route — switch on the NavGrid comparison to see '
                          + 'the two agree here, then try "Cross floor".';
        }
    }

    const g = state.gridPath;
    $('stGwp').textContent  = state.showGrid ? (g ? g.points.length : 'none') : '—';
    $('stGlen').textContent = state.showGrid ? (g ? g.length.toFixed(2) + ' m' : '—') : '—';

    const gh = $('gridHint');
    if (state.showGrid && p) {
        if (p.rise > 0.75) {
            gh.className = 'hint bad';
            gh.textContent = g
                ? `The grid returns a ${g.points.length}-waypoint route pinned at y = 0 — it walks `
                + `to the goal's XZ shadow on the ground floor and stops ${p.rise.toFixed(1)} m below `
                + `the actual goal. It has no way to know a mezzanine exists.`
                : 'The grid finds nothing: the goal projects onto a blocked ground-floor cell.';
        } else {
            gh.className = 'hint';
            gh.textContent = g
                ? `Same storey, so both agree: navmesh ${p.length.toFixed(1)} m, grid `
                + `${g.length.toFixed(1)} m. The grid is fine right up until the level gains height.`
                : 'The grid finds nothing here.';
        }
    } else if (state.showGrid) {
        gh.className = 'hint';
        gh.textContent = 'No navmesh route to compare against.';
    }
}

// --- Picking -----------------------------------------------------------------
//
// The overlay, ribbons, pips, markers and agent capsules are all mesh nodes, so
// scene.raycast() would happily return one of them. Hide the annotation layer
// for the duration of the cast and the ray can only hit level geometry.

const annotationNodes = () => [
    ...pips, ...markerNodes, ...agentState.agents.map(a => a.node),
].concat(pathNode ? [pathNode] : [], gridNode ? [gridNode] : []);

function pickLevel(px, py) {
    const ray = scene.unprojectLocal(px, py);
    if (!ray) return null;

    const hidden = [];
    for (const n of annotationNodes()) {
        if (n.visible) { hidden.push(n); n.visible = false; }
    }
    const overlayWas = state.showOverlay;
    setOverlayVisible(false);

    const hit = scene.raycast(ray.origin, ray.dir, 500);

    for (const n of hidden) n.visible = true;
    setOverlayVisible(overlayWas);
    if (!hit) return null;

    // Snap the geometric hit onto the navmesh — clicking a wall face or the
    // side of a ramp should still resolve to the nearest place you can stand.
    const p = { x: hit.point[0], y: hit.point[1], z: hit.point[2] };
    const snapped = navState.mesh && navState.mesh.valid
        ? navState.mesh.nearestPoint(p, { x: 2.5, y: 2.0, z: 2.5 })
        : null;
    return snapped || p;
}

// Exposed for the smoke test, which cannot move a mouse but can drive the same
// code the mouse drives.
function setStart(p) { state.start = { ...p }; refreshPath(); }
function setGoal(p)  { state.goal  = { ...p }; refreshPath(); }

canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const r = canvas.getBoundingClientRect();
    const p = pickLevel(e.clientX - r.left, e.clientY - r.top);
    if (!p) return;
    // Alt-click drops a crate where you clicked, or picks up the one already
    // there. Everything after that is the same code the "Block the corridor"
    // button runs, so a click and the button cannot drift apart.
    if (e.altKey) {
        const r = toggleObstacleAt(scene, p);
        afterObstacleChange(r
            ? (r.action === 'added'
                ? 'Crate dropped — the overlay hole is a real gap in the baked '
                + 'surface, carved by rebuilding only the tiles it touches.'
                : 'Crate removed; those tiles rebuilt back to their original '
                + 'walkable surface.')
            : null);
        return;
    }
    if (e.ctrlKey)       retargetAll(p);
    else if (e.shiftKey) setGoal(p);
    else                 setStart(p);
});

// --- Camera input (right = orbit, middle = pan, wheel = zoom) -----------------

let rightDown = false, middleDown = false;
function updatePointerLock() {
    const want = rightDown || middleDown;
    const locked = document.pointerLockElement === canvas;
    if (want && !locked) canvas.requestPointerLock();
    else if (!want && locked) document.exitPointerLock();
}
canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2)      { rightDown  = true; e.preventDefault(); updatePointerLock(); }
    else if (e.button === 1) { middleDown = true; e.preventDefault(); updatePointerLock(); }
});
document.addEventListener('mouseup', (e) => {
    if (e.button === 2) rightDown  = false;
    if (e.button === 1) middleDown = false;
    updatePointerLock();
});
document.addEventListener('mousemove', (e) => {
    if (rightDown)  Camera.orbitLook(cam, e.movementX, e.movementY);
    if (middleDown) Camera.orbitPan (cam, e.movementX, e.movementY);
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
canvas.addEventListener('wheel', (e) => {
    cam.dist = Math.max(3.0, cam.dist * Math.exp(e.deltaY * 0.001));
    e.preventDefault();
});

// --- Boot --------------------------------------------------------------------

createAgentWorld();
rebake();
updateObstacleReadout();
updateCrowdReadout();

// Spawn on the walkable surface rather than at nominal coordinates: after a
// wide-radius bake the nominal spawn may be inside the eroded margin.
const spawnBase = navState.mesh && navState.mesh.valid
    ? navState.mesh.nearestPoint(marks.hallSW, { x: 3, y: 1.2, z: 3 }) || marks.hallSW
    : marks.hallSW;
for (let i = 0; i < 4; i++) {
    spawnAgent(scene, {
        x: spawnBase.x + (i % 2) * 1.6 - 0.8,
        y: spawnBase.y,
        z: spawnBase.z + Math.floor(i / 2) * 1.6 - 0.8,
    }, i);
}

// --- Frame loop --------------------------------------------------------------
//
// The AI world is stepped on a fixed accumulator rather than the raw frame
// delta: steering that varies with frame time is not reproducible, and the
// smoke test asserts on exact agent positions after advanceTime().

// Re-probe the walkable-surface overlay against the current mesh. Cheap to say,
// ~20k nearestPoint calls to do, which is why it is only ever driven by an
// explicit change rather than per frame.
function refreshOverlay() {
    rebuildOverlay(scene);
    setOverlayVisible(state.showOverlay);
    updateBakeReadout();
}

let lastSeenGeneration = -1;
function watchGeneration() {
    const gen = navState.mesh ? navState.mesh.generation : 0;
    if (gen === lastSeenGeneration) return;
    lastSeenGeneration = gen;
    rebuildOverlay(scene);
    setOverlayVisible(state.showOverlay);
    updateBakeReadout();
    updateObstacleReadout();
}

const AI_STEP = 1 / 60;
let aiAccum = 0;
let last = performance.now();
let fpsAccum = 0, fpsFrames = 0;

function frame() {
    scene.setCamera(Camera.orbitViewOpts(cam, canvas));

    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    aiAccum += dt;
    let steps = 0;
    while (aiAccum >= AI_STEP && steps++ < 8) {
        // One world, one tick: tickAgents steps it, tickCrowd only consumes
        // waypoints and measures. Stepping twice would double every velocity.
        tickAgents(AI_STEP);
        tickCrowd(AI_STEP);
        aiAccum -= AI_STEP;
    }

    // The surface can change without anybody in this file asking — the engine
    // pumps queued obstacle rebuilds once per frame on its own. Watch the
    // generation and refresh the overlay when it moves, so the hole under a
    // freshly dropped crate appears without a manual redraw.
    watchGeneration();

    fpsAccum += dt;
    if (++fpsFrames >= 20) {
        $('fps').textContent = (fpsFrames / fpsAccum).toFixed(0) + ' fps';
        $('stWalking').textContent =
            `${agentState.agents.filter(a => !a.done).length} / ${agentState.agents.length}`;
        updateObstacleReadout();
        updateCrowdReadout();
        fpsAccum = 0; fpsFrames = 0;
    }

    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

export {
    scene, cam, canvas, state, levelNodes, lights, marks,
    navState as navmesh, bakeParams, rebake, refreshPath,
    setStart, setGoal, pickLevel,
    findPath, findGridPath, saveMesh, loadMesh, CACHE_PATH,
};
export const world = agentState.world;
export const agents = agentState.agents;
export { agentState, retargetAll, tickAgents, repathAll };

export {
    obstacleState, obstaclesEnabled, toggleObstacleAt, blockCorridor,
    clearObstacles, pumpObstacles, obstacleCount, obstaclesPending, CHOKE,
    placeObstacle, removeObstacle,
    crowdState, setAvoidance, clearCrowd, tickCrowd, overlapMean,
    scenarioFunnel, scenarioVip, scenarioFactions, scenarioStacked,
    deviationOf, findRole, snapshot, resetPositions, resetStats, setAvoidHeight,
    STACK_LANE,
};
export { afterObstacleChange, updateObstacleReadout, updateCrowdReadout, refreshOverlay };
