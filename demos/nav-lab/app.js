// Navigation Lab — bro's polygon navmesh, on a level built to break a grid.
//
// bro ships a full Recast/Detour navmesh (bakeNavMesh / loadNavMesh, dynamic
// obstacles, off-mesh links, ORCA avoidance, ground-follow agents, a pile of
// steering kernels) and, until this app, nothing used it: every game in the
// workshop pathfinds on the flat `NavGrid`. That is fine for a single-storey
// arena and hopeless the moment a level has height. This app is the argument,
// made visible — and then the rest of the surface, made falsifiable.
//
//   level.js     The building. Stacked floors, three ramps, a staircase, a
//                2.6 m choke point — one descriptor list driving both the
//                visual meshes and the Jolt static bodies.
//   navmesh.js   The bake (from the physics geometry, not a hand-written
//                triangle list), the sampled walkable-surface overlay, the
//                path queries, and the save/load cache.
//   agents.js    Walkers that follow the routes, so a path is something that
//                gets traversed rather than a line on the floor.
//   obstacles.js Runtime holes: a tiled dtTileCache bake, crates that carve
//                the surface, and the incremental tile rebuilds behind them.
//   crowd.js     ORCA local avoidance, scored by a counter rather than by
//                vibes: priority, layers/mask, and the elevation filter.
//   links.js     Off-mesh links — a jump across a gap, a one-way drop off the
//                mezzanine, a ladder — plus the link yard they need and the
//                partial-path "walled in" demonstration.
//   grid.js      The NavGrid baked from the same physics, drawn as an overlay
//                next to the mesh, and the groundFollow contrast.
//   steering.js  The five steer.* kernels with their force vectors drawn, and
//                a turret that proves computeLeadAim by missing without it.
//   app.js       Wiring: camera, HUD, picking, the frame loop, exports.
//
// ─── A tour, in the order the HUD is laid out ────────────────────────────────
//
//  1. Raise "Agent radius" and re-bake. The walkable surface pulls back from
//     every wall until the 2.6 m corridor closes outright.
//  2. Tick the NavGrid overlay next to the mesh overlay. One flat magenta sheet
//     at y = 0 against four stacked cyan storeys — and a square hole under every
//     ramp, because a grid obstacle is a body's AABB.
//  3. "Cross floor" routes the hall up onto the mezzanine; "Compare against
//     NavGrid" shows the grid's answer pinned at y = 0.
//  4. "Send over the gap" walks an agent onto an island pad that touches
//     nothing. It gets there by jumping — the HUD's "on a link now" lights up
//     mid-air and the traversal counter ticks.
//  5. "Seal the pad" drops that jump link from the bake, and "Run the
//     comparison" asks for the same route twice: requireFullPath false clamps
//     to the lip of the gap and reports partial, true returns nothing at all.
//  6. "Walk the ramp" sends two identical agents up a slope. One has a
//     groundFollow raycast probe and climbs; the other does not and slides
//     through the geometry at a constant height.
//  7. The crowd and obstacle sections are chunk 2's; the steering pad and the
//     turret are the raw kernels with nothing between them and the screen.
//
// ─── The one thing the engine will not let this app do at once ───────────────
//
// Off-mesh links and dynamic obstacles are mutually exclusive: `bakeNavMesh`
// throws when both are asked for, because a dtTileCache rebuilds tiles at
// runtime and would silently drop bake-time link connections. Rather than
// hiding half of the engine behind whichever default was chosen, the mode
// switch is a first-class control with a banner at the top of the HUD saying
// which bake is live and what it costs.

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
import {
    linkState, LINK_DEFS, linkMarks, buildLinkYard, rebuildLinkVisuals,
    spawnLinkWalker, sendLinkWalkers, clearLinkWalkers, tickLinkWalkers,
    comparePartial, setLinksEnabled, setSealed, syncLinksToBake, linkIsLive,
    linkSegmentsOf, activeLinkDefs,
} from "/app/links.js";
import {
    gridState, rebuildGridOverlay, setGridOverlayVisible, gridWalkable,
    spawnFollowers, clearFollowers, walkTheRamp, resetFollowers, tickFollowers,
    followerSpread, followerOf, FOLLOW_START, FOLLOW_END,
} from "/app/grid.js";
import {
    steerState, kernelInfo, buildSteering, clearSteering, setSteeringVisible,
    tickSteering, simulateShot, trackAt, aimDir, setLead, resetTurretStats,
    agentSpeed, agentOf, distanceToTarget, bindScene as bindSteerScene,
    HIT_RADIUS, PROJECTILE_SPEED, TURRET, ARRIVE_SLOWING,
} from "/app/steering.js";

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
// The link yard's slabs are Jolt static bodies too, and they go in BEFORE the
// first bake — `fromPhysics` collects whatever is in the world at bake time, so
// geometry added afterwards would simply not exist to the navmesh.
const yardNodes = buildLinkYard(scene);
for (const n of yardNodes) levelNodes.push(n);
const lights = buildEnvironment(scene);
bindSteerScene(scene);

// --- Shared app state --------------------------------------------------------

const state = {
    start: { ...marks.hallSW },
    goal: { ...marks.eastRoom },
    path: null,
    gridPath: null,
    showGrid: false,
    showOverlay: true,
    showShell: true,
    requireFullPath: false,   // hard-fail semantics on every HUD query
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
// Where a partial route gives up. Distinct on purpose — see refreshPath().
const clampMarker = makeMarker('#ff8f5a');
clampMarker.visible = false;

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

    state.path = findPath(state.start, state.goal,
                          { requireFullPath: state.requireFullPath });

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

    // A clamped route needs a mark of its own: the last waypoint of a partial
    // path is NOT the goal, and drawing it in the same yellow as every other
    // pip is how a demo quietly lies about what it found.
    const pts = state.path && state.path.points;
    if (state.path && state.path.partial && pts && pts.length) {
        const end = pts[pts.length - 1];
        clampMarker.visible = true;
        clampMarker.x = end.x; clampMarker.y = end.y + 0.7; clampMarker.z = end.z;
    } else {
        clampMarker.visible = false;
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
    // Every live route was planned against the mesh that is about to be
    // replaced. The binding takes shared ownership so nothing dangles, but a
    // walker still following the old surface is a walker walking a lie.
    for (const rec of linkState.walkers) {
        try { rec.carrier.stopNavigation(); } catch (e) { /* no active route */ }
    }
    syncLinksToBake();
    const mesh = bake();
    bakeGrid();
    rebuildOverlay(scene);
    setOverlayVisible(state.showOverlay);
    rebuildGridOverlay(scene);
    rebuildLinkVisuals(scene);
    refreshPath();
    updateBakeReadout();
    updateLinkReadout();
    updateModeBanner();
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

// --- Collapsible HUD ---------------------------------------------------------
//
// The HUD grew past a screen once every feature had a home. Each <section>
// folds on a click of its heading — except when the click landed on the
// checkbox that heading contains, which has to keep toggling the feature.

for (const h of document.querySelectorAll('#hud section h2')) {
    h.addEventListener('click', (e) => {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'LABEL')) return;
        const sec = h.parentNode;
        sec.className = sec.className.indexOf('collapsed') >= 0 ? 'sec' : 'sec collapsed';
    });
}

// --- Mode: static + links, or tiled + obstacles ------------------------------
//
// One re-bake either way. `dynOn` stays the source of truth for the obstacle
// half (chunk 2's code and its tests drive bakeParams.dynamicObstacles
// directly), and these buttons drive it plus the link flag together so the two
// controls can never disagree about which bake is up.

function applyMode(tiled) {
    clearObstacles(scene);
    obstacleState.placed.length = 0;
    bakeParams.dynamicObstacles = !!tiled;
    setLinksEnabled(!tiled);
    $('dynOn').checked = !!tiled;
    stale = false;
    rebake();
    updateObstacleReadout();
}

$('btnModeLinks').addEventListener('click', () => applyMode(false));
$('btnModeTiled').addEventListener('click', () => applyMode(true));

function updateModeBanner() {
    const bar = $('modeBar'), hint = $('modeHint');
    const tiled = !!(navState.mesh && navState.mesh.supportsObstacles);
    bar.className = tiled ? 'mode tiled' : 'mode';
    bar.textContent = tiled
        ? 'Tiled + obstacles — crates carve the surface at runtime. Off-mesh '
        + 'links are dropped and save() throws in this mode.'
        : `Static + links — ${navState.linksBaked} off-mesh link(s) in the bake, `
        + 'save() works. No runtime obstacle API on a static mesh.';
    hint.className = 'hint';
    hint.textContent = 'bakeNavMesh throws outright if you ask for both: a '
        + 'dtTileCache rebuilds tiles and would silently drop bake-time links. '
        + 'Two bakes, one switch, nothing hidden.';
}

// --- Off-mesh links ----------------------------------------------------------

$('btnLinkJump').addEventListener('click', () => {
    const n = sendLinkWalkers(linkMarks.padEast);
    linkHint(n, 'the island pad — the 4.5 m gap has no walkable route across it, '
              + 'so every one of these routes goes through the jump link.');
});
$('btnLinkDrop').addEventListener('click', () => {
    const n = sendLinkWalkers(linkMarks.hallBelow);
    linkHint(n, 'the hall floor below the mezzanine. The one-way drop is the '
              + 'short way down; walking would mean the whole ramp.');
});
$('btnLinkLadder').addEventListener('click', () => {
    const n = sendLinkWalkers(linkMarks.ladderTop);
    linkHint(n, 'the mezzanine, via the ladder at its south-east corner.');
});
$('btnLinkHome').addEventListener('click', () => {
    for (const rec of linkState.walkers) {
        try { rec.carrier.stopNavigation(); } catch (e) { /* none */ }
        rec.agent.setPosition(rec.startedAt.x, rec.startedAt.z);
        rec.visitedEast = false;
    }
    linkState.traversals = 0;
    linkState.crossedGap = 0;
    linkState.lastLink = '—';
    updateLinkReadout();
});

function linkHint(started, where) {
    const h = $('linkHint');
    if (!started) {
        h.className = 'hint bad';
        h.textContent = 'No route: either the links are not in the current bake '
                      + '(check the mode) or the pad is sealed.';
        return;
    }
    h.className = 'hint good';
    h.textContent = `${started} walker(s) routed to ${where}`;
}

function updateLinkReadout() {
    const defs = activeLinkDefs() || [];
    $('stLinks').textContent = navState.linksBaked;
    // No link read-back exists, so "live" is inferred: ask for a route from
    // each link's takeoff to its landing and see whether the mesh answers.
    let live = 0;
    for (const d of defs) if (linkIsLive(d)) live++;
    $('stLinksLive').textContent = `${live} / ${defs.length}`;
    $('stOnLink').textContent = linkState.onLinkNow;
    $('stLastLink').textContent = linkState.lastLink;
    $('stTraversals').textContent = linkState.traversals;
    $('stCrossed').textContent = linkState.crossedGap;
}

// --- Partial paths -----------------------------------------------------------

$('btnSeal').addEventListener('click', () => { setSealed(true);  stale = false; rebake(); runPartial(); });
$('btnUnseal').addEventListener('click', () => { setSealed(false); stale = false; rebake(); runPartial(); });
$('btnPartial').addEventListener('click', runPartial);

$('reqFull').addEventListener('change', e => {
    state.requireFullPath = e.target.checked;
    refreshPath();
});

function runPartial() {
    const from = { ...marks.eastRoom }, to = { ...linkMarks.padEast };
    const r = comparePartial(from, to);
    // Draw the loose answer, so the clamp point is on screen next to the goal
    // it never reached.
    state.requireFullPath = false;
    $('reqFull').checked = false;
    setStart(from);
    setGoal(to);

    $('stLoose').textContent = r.looseFound
        ? (r.loosePartial ? 'partial' : 'complete') : 'none';
    $('stStrict').textContent = r.strictFound ? 'complete' : 'none';
    $('stShort').textContent = isFinite(r.shortfall) ? r.shortfall.toFixed(2) + ' m' : '—';

    const h = $('partialHint');
    if (r.loosePartial && !r.strictFound) {
        h.className = 'hint good';
        h.textContent = `Sealed. requireFullPath:false walks to the lip of the gap `
                      + `and stops ${r.shortfall.toFixed(1)} m short with partial=true `
                      + `(orange marker); requireFullPath:true returns nothing at all. `
                      + `Same mesh, same query, one flag.`;
    } else if (r.looseFound && r.strictFound) {
        h.className = 'hint';
        h.textContent = 'The jump link is in the bake, so the pad is reachable and '
                      + 'both flags agree on a complete route. Seal it to see them split.';
    } else {
        h.className = 'hint bad';
        h.textContent = 'Neither query found a route — the start point did not snap '
                      + 'onto the surface.';
    }
}

// --- NavGrid overlay ---------------------------------------------------------

$('gridOverlayOn').addEventListener('change', e => {
    setGridOverlayVisible(e.target.checked);
    updateGridReadout();
});

function updateGridReadout() {
    $('stGridCells').textContent = gridState.cells;
    $('stGridTested').textContent = gridState.tested;
}

// --- Ground follow -----------------------------------------------------------

$('btnWalkRamp').addEventListener('click', () => { walkTheRamp(); updateFollowReadout(); });
$('btnFollowReset').addEventListener('click', () => { resetFollowers(); updateFollowReadout(); });
$('followOn').addEventListener('change', e => {
    gridState.followOn = e.target.checked;
    for (const rec of gridState.followers) rec.node.visible = gridState.followOn;
});

function updateFollowReadout() {
    const fmt = f => {
        const s = followerSpread(f);
        return s > 0 ? s.toFixed(2) + ' m' : '—';
    };
    $('stFollowY').textContent = fmt(true);
    $('stFlatY').textContent = fmt(false);
}

// --- Steering kernels --------------------------------------------------------

const legend = $('steerLegend');
for (const k of kernelInfo) {
    const row = document.createElement('div');
    const swatch = document.createElement('i');
    swatch.style.background = k.color;
    row.appendChild(swatch);
    const text = document.createElement('span');
    text.textContent = k.label;
    row.appendChild(text);
    legend.appendChild(row);
}

$('steerOn').addEventListener('change', e => setSteeringVisible(e.target.checked));
$('leadOn').addEventListener('change', e => { setLead(e.target.checked); updateAimReadout(); });

// The measured version of the turret claim, run off-screen at a fixed sample
// time so the two numbers are comparable rather than whatever the frame happened
// to catch.
$('btnMeasureAim').addEventListener('click', () => {
    const t = 1.0;                       // mid-sweep, away from a direction change
    const direct = simulateShot(t, false);
    const lead = simulateShot(t, true);
    const h = $('aimHint');
    h.className = 'hint good';
    h.textContent = `Straight aim passes ${direct.closest.toFixed(2)} m behind the `
                  + `target; computeLeadAim comes within ${lead.closest.toFixed(2)} m `
                  + `(hit radius ${HIT_RADIUS} m). Same turret, same target, same tick.`;
});

function updateSteerReadout() {
    $('stSeekV').textContent = agentSpeed('seek').toFixed(2) + ' m/s';
    $('stArriveV').textContent = agentSpeed('arrive').toFixed(2) + ' m/s';
    $('stArriveD').textContent = distanceToTarget('arrive').toFixed(2) + ' m';
}

function updateAimReadout() {
    $('stShots').textContent = steerState.fired;
    $('stHits').textContent = `${steerState.hits} / ${steerState.misses}`;
    $('stClosest').textContent = steerState.fired
        ? steerState.lastClosest.toFixed(2) + ' m' : '—';
}

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
    const segs = linkSegmentsOf(p);
    $('stLinkSegs').textContent = p ? segs.length : '—';
    $('stPartial').textContent = p ? String(!!p.partial) : '—';

    if (!p) {
        $('stWp').textContent = '—';
        $('stLen').textContent = 'no path';
        $('stRise').textContent = '—';
        h.className = 'hint bad';
        h.textContent = state.requireFullPath
            ? 'No route. requireFullPath is on, so an unreachable goal returns '
            + 'nothing rather than a clamped path — untick it to see how far the '
            + 'route would have got.'
            : 'No route: an endpoint did not snap onto the baked surface. '
            + 'Re-bake with a smaller agent radius, or pick a point on the mesh.';
    } else {
        $('stWp').textContent = p.points.length;
        $('stLen').textContent = p.length.toFixed(2) + ' m';
        $('stRise').textContent = p.rise.toFixed(2) + ' m';
        if (segs.length) {
            h.className = 'hint good';
            const s = segs[0];
            h.textContent = `This route uses ${segs.length} off-mesh link`
                + `${segs.length === 1 ? '' : 's'} — waypoint ${s.index} is a takeoff, `
                + `and the segment after it is a jump/drop/climb rather than a walk. `
                + `Detour routed through it with no special-case code in this app.`;
        } else if (p.partial) {
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
    ...linkState.nodes, ...linkState.walkers.map(w => w.node),
    ...gridState.followers.map(f => f.node),
    ...steerState.agents.map(a => a.node), ...steerState.agents.map(a => a.arrow),
    ...steerState.shots.map(s => s.node),
].concat(pathNode ? [pathNode] : [], gridNode ? [gridNode] : [],
         gridState.overlay ? [gridState.overlay] : [],
         steerState.target ? [steerState.target] : []);

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
// Links are in the default bake: they are the headline of this section, and
// baking them in means the app opens in the mode where the most of the engine
// is reachable (links + save/load; the tiled obstacle bake is one click away).
syncLinksToBake();
rebake();
updateObstacleReadout();
updateCrowdReadout();
updateGridReadout();

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

// Link walkers start at the foot of the yard ramp, on the ground, so the first
// "Send over the gap" is a complete journey: up the ramp, across the west pad,
// and off the edge.
for (let i = 0; i < 2; i++) {
    spawnLinkWalker(scene, {
        x: linkMarks.yardFoot.x + (i - 0.5) * 1.4,
        y: 0,
        z: linkMarks.yardFoot.z + 1.0,
    }, i);
}

// The groundFollow pair and the steering pad exist from boot but the steering
// pad starts hidden: five capsules chasing a ball is a distraction until the
// user asks for it, and the navmesh is what the app opens on.
spawnFollowers(scene);
buildSteering(scene);
setSteeringVisible(false);
updateLinkReadout();
updateFollowReadout();
updateAimReadout();

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
        // The steering pad integrates the raw kernels itself and touches no AI
        // world at all, so it rides the same fixed step purely for
        // reproducibility — the smoke test asserts on its speeds.
        tickSteering(AI_STEP);
        aiAccum -= AI_STEP;
    }

    // These two read state the ENGINE wrote (the agent binding's transforms and
    // its onLink flag), so they run once per frame after the bindings have been
    // stepped, not once per fixed AI step.
    tickLinkWalkers();
    tickFollowers();

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
        updateLinkReadout();
        updateFollowReadout();
        updateSteerReadout();
        updateAimReadout();
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

// Chunk 3: off-mesh links, partial paths, the NavGrid overlay + groundFollow,
// and the steering kernels.
export {
    linkState, LINK_DEFS, linkMarks, rebuildLinkVisuals, spawnLinkWalker,
    sendLinkWalkers, clearLinkWalkers, tickLinkWalkers, comparePartial,
    setLinksEnabled, setSealed, syncLinksToBake, linkIsLive, linkSegmentsOf,
    activeLinkDefs, yardNodes,
    gridState, rebuildGridOverlay, setGridOverlayVisible, gridWalkable,
    spawnFollowers, clearFollowers, walkTheRamp, resetFollowers, tickFollowers,
    followerSpread, followerOf, FOLLOW_START, FOLLOW_END,
    steerState, kernelInfo, buildSteering, setSteeringVisible, tickSteering,
    simulateShot, trackAt, aimDir, setLead, resetTurretStats, agentSpeed,
    agentOf, distanceToTarget, HIT_RADIUS, PROJECTILE_SPEED, TURRET,
    ARRIVE_SLOWING,
    applyMode, runPartial,
};
