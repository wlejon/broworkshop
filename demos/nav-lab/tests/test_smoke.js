// tests/test_smoke.js — assert the navmesh does the things this app claims.
//
// Every assertion goes through the same entry points the HUD drives, so a green
// run means the app works, not just that the library does.

import {
    scene, state, navmesh, bakeParams, rebake, marks,
    setStart, setGoal, findPath, findGridPath, saveMesh, loadMesh,
    agents, retargetAll, agentState,
    obstacleState, obstaclesEnabled, blockCorridor, clearObstacles,
    placeObstacle, removeObstacle, pumpObstacles, obstacleCount,
    obstaclesPending, CHOKE,
    crowdState, setAvoidance, clearCrowd, overlapMean,
    scenarioFunnel, scenarioVip, scenarioFactions, scenarioStacked,
    deviationOf, findRole, snapshot, setAvoidHeight, STACK_LANE, refreshOverlay,
    linkState, LINK_DEFS, linkMarks, linkIsLive, linkSegmentsOf, sendLinkWalkers,
    comparePartial, setSealed, activeLinkDefs,
    gridState, gridWalkable, setGridOverlayVisible, walkTheRamp, resetFollowers,
    followerSpread, followerOf,
    steerState, setSteeringVisible, simulateShot, agentSpeed, distanceToTarget,
    agentOf, ARRIVE_SLOWING, HIT_RADIUS, TURRET, trackAt, aimDir,
} from "/app/app.js";

let checks = 0;
function check(label, cond, detail) {
    checks++;
    if (!cond) throw new Error(`FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    console.log(`  ok  ${label}${detail ? ' (' + detail + ')' : ''}`);
}

advanceTime(100);

// --- 1. The bake produced a real surface -------------------------------------

console.log('[1] bake');
check('navmesh is available in this build', bro.ai.game.navMeshAvailable === true);
check('mesh baked and valid', !!navmesh.mesh && navmesh.mesh.valid === true);
check('bake produced no error', navmesh.lastError === '', navmesh.lastError);
check('walkable surface is non-empty', navmesh.walkableSamples > 200,
      navmesh.walkableSamples + ' samples');
check('serialised blob is non-trivial', navmesh.blobBytes > 1000, navmesh.blobBytes + ' B');

const baselineSamples = navmesh.walkableSamples;

// --- 2. Same-floor route, with every waypoint on the walkable surface --------

console.log('[2] same-floor path');
setStart(marks.hallSW);
setGoal(marks.chamber);
const flat = state.path;
check('same-floor path found', !!flat);
check('same-floor path is complete, not clamped', flat.partial === false);
check('same-floor path has intermediate waypoints', flat.points.length >= 3,
      flat.points.length + ' waypoints');
check('same-floor path stays on one storey', flat.rise < 0.75, 'rise ' + flat.rise.toFixed(3));

// Every waypoint must snap back onto the mesh essentially where it already is —
// a waypoint that has drifted off the walkable surface is a route through a
// wall, which is the failure mode that matters.
let worst = 0;
for (const p of flat.points) {
    const q = navmesh.mesh.nearestPoint(p, { x: 0.6, y: 1.0, z: 0.6 });
    if (!q) throw new Error('FAIL: waypoint did not snap onto the mesh: ' + JSON.stringify(p));
    worst = Math.max(worst, Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z));
}
check('every waypoint lies on the walkable surface', worst < 0.25,
      'worst drift ' + worst.toFixed(4) + ' m');

// --- 3. Multi-level route — the whole reason this app exists -----------------

console.log('[3] cross-floor path (the multi-level proof)');
setStart(marks.hallSW);
setGoal(marks.mezzanine);
const climb = state.path;
check('cross-floor path found', !!climb);
check('cross-floor path is complete, not clamped', climb.partial === false);
check('cross-floor path actually changes elevation', climb.rise > 3.0,
      'rise ' + climb.rise.toFixed(2) + ' m');
check('cross-floor path starts on the ground floor', climb.points[0].y < 1.0,
      'y0 ' + climb.points[0].y.toFixed(2));
check('cross-floor path ends on the mezzanine', climb.points[climb.points.length - 1].y > 3.4,
      'yN ' + climb.points[climb.points.length - 1].y.toFixed(2));

// Y must rise CONTINUOUSLY along a ramp rather than teleporting between
// storeys. Waypoint count cannot show this: findPath returns the funnel-
// STRAIGHTENED corridor, so a route with clear line of sight across the
// surface collapses to just its two endpoints even while the ground under it
// climbs 4 m. Sample the mesh along the route instead — that is what actually
// proves there is a walkable ramp and not a stitched-together seam.
function heightProfile(path, samples) {
    const prof = [];
    // Walk the polyline by arc length so multi-segment routes sample evenly.
    const pts = path.points;
    let total = 0;
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
        segs.push(d); total += d;
    }
    for (let s = 0; s <= samples; s++) {
        let want = (s / samples) * total, i = 0;
        while (i < segs.length - 1 && want > segs[i]) { want -= segs[i]; i++; }
        const t = segs[i] > 1e-6 ? want / segs[i] : 0;
        const x = pts[i].x + (pts[i + 1].x - pts[i].x) * t;
        const z = pts[i].z + (pts[i + 1].z - pts[i].z) * t;
        const yGuess = pts[i].y + (pts[i + 1].y - pts[i].y) * t;
        const q = navmesh.mesh.nearestPoint({ x, y: yGuess, z }, { x: 0.8, y: 2.5, z: 0.8 });
        prof.push(q ? q.y : null);
    }
    return prof;
}

const profile = heightProfile(climb, 24);
check('the whole route stays on the walkable surface', profile.every(y => y !== null),
      profile.filter(y => y === null).length + ' gaps in 25 samples');
const midHeights = profile.filter(y => y !== null && y > 0.8 && y < 3.4).length;
check('elevation rises gradually along a ramp, not in one jump', midHeights >= 4,
      midHeights + ' of 25 surface samples at intermediate height');
let maxJump = 0;
for (let i = 1; i < profile.length; i++)
    if (profile[i] !== null && profile[i - 1] !== null)
        maxJump = Math.max(maxJump, Math.abs(profile[i] - profile[i - 1]));
check('no single step of the route teleports between storeys', maxJump < 1.0,
      'largest height step ' + maxJump.toFixed(3) + ' m');

// And the grid, given exactly the same query, cannot follow.
const gridAnswer = findGridPath(marks.hallSW, marks.mezzanine);
if (gridAnswer) {
    let gridMaxY = -Infinity;
    for (const p of gridAnswer.points) gridMaxY = Math.max(gridMaxY, p.y);
    check('NavGrid answer to the same query never leaves y = 0', gridMaxY === 0,
          'grid max y ' + gridMaxY + ' vs navmesh ' + climb.maxY.toFixed(2));
} else {
    check('NavGrid cannot answer the cross-floor query at all', true, 'no grid path');
}

// --- 4. Route to the second storey, over the stairs --------------------------

console.log('[4] roof route');
setStart(marks.eastRoom);
setGoal(marks.roof);
const roof = state.path;
check('roof path found', !!roof);
check('roof path reaches the top storey', roof.maxY > 7.0, 'maxY ' + roof.maxY.toFixed(2));
check('roof path spans all three storeys', roof.rise > 6.5, 'rise ' + roof.rise.toFixed(2));

// --- 5. Save / load round trip ----------------------------------------------

console.log('[5] save + load round trip');
setStart(marks.hallSW);
setGoal(marks.mezzanine);
const savedBytes = saveMesh();
check('save wrote a blob', savedBytes > 1000, savedBytes + ' B');

const round = loadMesh(state.start, state.goal);
check('loaded mesh is valid', round.valid === true);
check('round trip preserved the blob size', round.bytes === savedBytes,
      `${savedBytes} out, ${round.bytes} in`);
check('round trip preserved the waypoint count',
      round.waypointsAfter === round.waypointsBefore && round.waypointsAfter > 0,
      `${round.waypointsBefore} -> ${round.waypointsAfter}`);
check('round trip preserved the waypoints exactly', round.identical === true);

// The restored mesh must still describe the same walkable surface, so re-run
// the app's own sampler against it and compare to the pre-save baseline.
rebake();   // back to a known-good in-memory mesh for the parameter test below
check('re-bake after load restores the baseline surface',
      navmesh.walkableSamples === baselineSamples,
      `${navmesh.walkableSamples} vs ${baselineSamples}`);

// --- 6. Bake parameters measurably change the surface ------------------------

console.log('[6] bake parameters');

// Agent radius erodes the walkable area. A humanoid-plus radius must leave a
// strictly smaller surface than the default, and must close the 2.6 m corridor.
setStart(marks.hallSW);
setGoal(marks.eastRoom);
const throughChoke = state.path;
check('the choke corridor is passable at the default radius',
      !!throughChoke && throughChoke.partial === false);

bakeParams.agentRadius = 1.6;
rebake();
const wideSamples = navmesh.walkableSamples;
check('a larger agent radius shrinks the walkable surface', wideSamples < baselineSamples,
      `${baselineSamples} @ r=0.5 -> ${wideSamples} @ r=1.6`);

setStart(marks.hallSW);
setGoal(marks.eastRoom);
const choked = state.path;
check('the 2.6 m corridor closes for a 1.6 m-radius agent',
      !choked || choked.partial === true,
      choked ? 'partial=' + choked.partial : 'no path at all');

bakeParams.agentRadius = 0.5;
rebake();
check('restoring the radius restores the surface', navmesh.walkableSamples === baselineSamples,
      `${navmesh.walkableSamples} vs ${baselineSamples}`);

// Slope, one variable at a time: ramp D is 26.6°, and it is the only route onto
// the east platform. Tightening maxSlope below it must take the platform off
// the mesh entirely.
setStart(marks.eastRoom);
setGoal(marks.platform);
check('the 26.6° ramp is walkable at the default 45° limit',
      !!state.path && state.path.partial === false && state.path.maxY > 2.5,
      state.path ? 'maxY ' + state.path.maxY.toFixed(2) : 'no path');

bakeParams.agentMaxSlopeDeg = 22;
rebake();
setStart(marks.eastRoom);
setGoal(marks.platform);
const tooSteep = state.path;
check('a 22° slope limit severs the 26.6° ramp to the platform',
      !tooSteep || tooSteep.partial === true || tooSteep.maxY < 2.5,
      tooSteep ? `partial=${tooSteep.partial} maxY=${tooSteep.maxY.toFixed(2)}` : 'no path');
check('a tighter slope limit shrinks the walkable surface',
      navmesh.walkableSamples < baselineSamples,
      `${baselineSamples} @ 45° -> ${navmesh.walkableSamples} @ 22°`);

bakeParams.agentMaxSlopeDeg = 45;
rebake();
check('restoring the slope limit restores the surface',
      navmesh.walkableSamples === baselineSamples,
      `${navmesh.walkableSamples} vs ${baselineSamples}`);

// The 52° ramp is the two-parameter case. Documented behaviour would suggest
// maxSlope alone controls it; measured behaviour is that it stays off the mesh
// at any slope limit while cellSize is 0.25, because Recast's ledge filter
// rejects spans whose per-cell rise exceeds the climb budget. Assert BOTH
// halves, so this file fails loudly if the engine's behaviour ever changes.
function steepRampWalkable() {
    // Sample the 52° ramp's own surface: y = 4 * (x + 0.9) / -3.1 at z = 10.
    let walkable = 0;
    for (let x = -1.3; x >= -3.9; x -= 0.3) {
        const y = 4 * (x + 0.9) / -3.1;
        const q = navmesh.mesh.nearestPoint({ x, y, z: 10 }, { x: 0.2, y: 0.25, z: 0.2 });
        if (q && Math.abs(q.x - x) < 0.15 && Math.abs(q.z - 10) < 0.15 && Math.abs(q.y - y) < 0.4)
            walkable++;
    }
    return walkable;
}

check('the 52° ramp is off the mesh at the default 45° limit', steepRampWalkable() === 0);

bakeParams.agentMaxSlopeDeg = 85;
rebake();
check('raising maxSlope ALONE still does not admit the 52° ramp (ledge filter)',
      steepRampWalkable() === 0, 'maxSlope 85, cellSize 0.25');

bakeParams.agentMaxSlopeDeg = 60;
bakeParams.cellSize = 0.15;
rebake();
check('maxSlope 60 together with a 0.15 cellSize does admit the 52° ramp',
      steepRampWalkable() >= 8, steepRampWalkable() + ' of 9 ramp samples walkable');

bakeParams.agentMaxSlopeDeg = 45;
bakeParams.cellSize = 0.25;
rebake();

// Step height: the staircase risers are 0.5 m, so a 0.2 m climb budget must
// sever the roof deck from everything below it.
bakeParams.agentMaxClimb = 0.2;
rebake();
setStart(marks.eastRoom);
setGoal(marks.roof);
const severed = state.path;
check('a 0.2 m step budget severs the 0.333 m staircase',
      !severed || severed.partial === true || severed.maxY < 7.0,
      severed ? `partial=${severed.partial} maxY=${severed.maxY.toFixed(2)}` : 'no path');

bakeParams.agentMaxClimb = 0.4;
rebake();
check('restoring the step height restores the surface',
      navmesh.walkableSamples === baselineSamples,
      `${navmesh.walkableSamples} vs ${baselineSamples}`);

// --- 7. Agents traverse the route -------------------------------------------

console.log('[7] agents');
check('agents spawned', agents.length === 4, agents.length + ' agents');

setStart(marks.hallSW);
setGoal(marks.mezzanine);
const routes = retargetAll(marks.mezzanine);
check('every agent got a route', routes.every(r => !!r));

// Progress is measured as distance closed toward the route's final waypoint,
// not as waypoints consumed: findPath string-pulls the corridor, so this
// particular route is two points long and an agent can walk its entire 25 m
// without ever "advancing a leg".
const goalOf = a => a.route.points[a.route.points.length - 1];
const distToGoal = a => Math.hypot(a.agent.x - goalOf(a).x, a.agent.z - goalOf(a).z);

const before = agents.map(a => ({ x: a.agent.x, z: a.agent.z, d: distToGoal(a) }));
advanceTime(4000);
const after = agents.map(a => ({ x: a.agent.x, z: a.agent.z, d: distToGoal(a) }));

let moved = 0, closed = 0;
for (let i = 0; i < agents.length; i++) {
    if (Math.hypot(after[i].x - before[i].x, after[i].z - before[i].z) > 1.0) moved++;
    if (before[i].d - after[i].d > 1.0) closed++;
}
check('agents moved along their routes', moved === agents.length,
      moved + '/' + agents.length + ' moved > 1 m');
check('agents closed distance to their goal', closed === agents.length,
      closed + '/' + agents.length + ' closed > 1 m; median closed '
      + (before[0].d - after[0].d).toFixed(2) + ' m');
check('agent scene nodes track their agents',
      agents.every(a => Math.abs(a.node.x - a.agent.x) < 1e-3
                     && Math.abs(a.node.z - a.agent.z) < 1e-3));

// Keep walking: they should climb the ramp and gain real height.
advanceTime(14000);
const gained = agents.filter(a => a.y > 1.0).length;
check('agents gained elevation following the 3D route', gained > 0,
      gained + '/' + agents.length + ' above y=1, highest '
      + Math.max(...agents.map(a => a.y)).toFixed(2));

// --- 8. Overlay tracks the mesh ---------------------------------------------

console.log('[8] overlay');
check('overlay produced quads', navmesh.overlayQuads > 200, navmesh.overlayQuads + ' quads');
check('overlay quad count matches the sample count',
      navmesh.overlayQuads === navmesh.walkableSamples);

// The stacked storeys must show up as separate overlay layers — if the sampler
// collapsed them the whole multi-level story would be a lie on screen.
let onGround = 0, onMezz = 0, onRoof = 0;
for (let x = -20; x <= 20; x += 1.0) {
    for (let z = -20; z <= 20; z += 1.0) {
        for (const [y, bump] of [[0, 0], [4, 1], [8, 2]]) {
            const q = navmesh.mesh.nearestPoint({ x, y, z }, { x: 0.5, y: 1.2, z: 0.5 });
            if (!q || Math.abs(q.x - x) > 0.3 || Math.abs(q.z - z) > 0.3) continue;
            if (bump === 0) onGround++; else if (bump === 1) onMezz++; else onRoof++;
        }
    }
}
check('ground floor is walkable', onGround > 100, onGround + ' cells');
check('mezzanine is walkable directly above the ground floor', onMezz > 20, onMezz + ' cells');
check('roof deck is walkable above both', onRoof > 10, onRoof + ' cells');

// The overlapping-column test: find an XZ where two storeys are both walkable.
let stacked = 0;
for (let x = -19; x <= -3; x += 0.8) {
    for (let z = 5; z <= 19; z += 0.8) {
        const lo = navmesh.mesh.nearestPoint({ x, y: 0, z }, { x: 0.4, y: 1.2, z: 0.4 });
        const hi = navmesh.mesh.nearestPoint({ x, y: 4, z }, { x: 0.4, y: 1.2, z: 0.4 });
        if (lo && hi && Math.abs(hi.y - lo.y) > 2.0) stacked++;
    }
}
check('there are XZ columns walkable at two different heights at once',
      stacked > 30, stacked + ' stacked columns — a NavGrid stores one bit per column');

// --- 9. Dynamic-obstacle bake -----------------------------------------------
//
// A tiled dtTileCache build. Its numbers legitimately DIFFER from the static
// bake's — no detail mesh, and regionMinSize no longer culls small islands — so
// nothing here compares against the chunk-1 baseline.

console.log('[9] dynamic-obstacle bake');
bakeParams.dynamicObstacles = true;
rebake();

check('the tiled bake produced a valid mesh',
      !!navmesh.mesh && navmesh.mesh.valid === true, navmesh.lastError);
check('the mesh reports runtime obstacle support',
      navmesh.mesh.supportsObstacles === true);
check('obstaclesEnabled() agrees', obstaclesEnabled() === true);
check('a tiled mesh does not serialise (documented limitation)',
      navmesh.blobBytes === 0);
let saveThrew = false;
try { navmesh.mesh.save(); } catch (e) { saveThrew = true; }
check('save() throws on a tiled mesh rather than returning junk', saveThrew);
check('the tiled bake still has a substantial walkable surface',
      navmesh.walkableSamples > 200, navmesh.walkableSamples + ' samples');

const dynSamples = navmesh.walkableSamples;
const gen0 = navmesh.mesh.generation;

// --- 10. A crate carves the surface and reroutes a path ----------------------
//
// Run this in the OPEN west hall, where a detour exists. The corridor (section
// 11) is the severing case; conflating the two would let a partial path pass
// for a reroute.

console.log('[10] a crate reroutes a path');
const LANE_Z = -8, LANE_A = { x: -17, y: 0, z: LANE_Z }, LANE_B = { x: -1, y: 0, z: LANE_Z };
const CRATE_AT = { x: -9, y: 0, z: LANE_Z }, CRATE_H = 1.6;

setStart(LANE_A);
setGoal(LANE_B);
const openLane = state.path;
check('the open lane is a straight, complete route',
      !!openLane && openLane.partial === false, openLane
        ? openLane.points.length + ' waypoints' : 'no path');
const straightDev = Math.max(...openLane.points.map(p => Math.abs(p.z - LANE_Z)));
check('the unobstructed route runs straight down the lane', straightDev < 0.6,
      'max |z - lane| ' + straightDev.toFixed(3) + ' m');

// Walkable samples inside the crate's footprint, before it lands.
function samplesIn(cx, cz, h, y = 0) {
    let n = 0;
    for (let x = cx - h; x <= cx + h; x += 0.3) {
        for (let z = cz - h; z <= cz + h; z += 0.3) {
            const q = navmesh.mesh.nearestPoint({ x, y, z }, { x: 0.15, y: 0.6, z: 0.15 });
            if (q && Math.abs(q.x - x) < 0.12 && Math.abs(q.z - z) < 0.12) n++;
        }
    }
    return n;
}
const footBefore = samplesIn(CRATE_AT.x, CRATE_AT.z, CRATE_H);
check('the crate footprint is walkable before the crate lands', footBefore > 30,
      footBefore + ' samples');

const crate = placeObstacle(scene, CRATE_AT, { hx: CRATE_H, hy: 1.2, hz: CRATE_H });
check('addObstacle returned a handle', !!crate && crate.handle > 0,
      crate ? 'handle ' + crate.handle : obstacleState.lastError);
check('obstacleCount counts the queued obstacle', obstacleCount() === 1);
check('obstaclesPending is true before the tiles are pumped', obstaclesPending() === true);

const tiles = pumpObstacles();
check('pumping rebuilt at least one tile', tiles >= 1, tiles + ' update() calls');
check('obstaclesPending drained', obstaclesPending() === false);
check('generation incremented after the obstacle batch applied',
      navmesh.mesh.generation > gen0, `${gen0} -> ${navmesh.mesh.generation}`);

const footAfter = samplesIn(CRATE_AT.x, CRATE_AT.z, CRATE_H);
check('the crate removed the walkable surface under it', footAfter === 0,
      `${footBefore} -> ${footAfter} samples in the footprint`);

refreshOverlay();
check('the overlay lost samples where the crate landed',
      navmesh.walkableSamples < dynSamples,
      `${dynSamples} -> ${navmesh.walkableSamples}`);

setStart(LANE_A);
setGoal(LANE_B);
const detour = state.path;
check('a route still exists past the crate', !!detour && detour.partial === false);
check('the route now bends around the crate', detour.points.length > openLane.points.length,
      `${openLane.points.length} -> ${detour.points.length} waypoints`);
const detourDev = Math.max(...detour.points.map(p => Math.abs(p.z - LANE_Z)));
check('the detour leaves the straight lane', detourDev > CRATE_H * 0.8,
      'max |z - lane| ' + detourDev.toFixed(2) + ' m');

// No waypoint, and no point on any segment between waypoints, may lie inside
// the crate — a route that clips the corner would still "have more waypoints".
function minDistToBox(path, cx, cz, h) {
    let best = Infinity;
    const pts = path.points;
    for (let i = 0; i + 1 < pts.length; i++) {
        for (let t = 0; t <= 1; t += 0.02) {
            const x = pts[i].x + (pts[i + 1].x - pts[i].x) * t;
            const z = pts[i].z + (pts[i + 1].z - pts[i].z) * t;
            const dx = Math.max(Math.abs(x - cx) - h, 0);
            const dz = Math.max(Math.abs(z - cz) - h, 0);
            best = Math.min(best, Math.hypot(dx, dz));
        }
    }
    return best;
}
check('no part of the route passes through the crate',
      minDistToBox(detour, CRATE_AT.x, CRATE_AT.z, CRATE_H) > 0,
      'closest approach ' + minDistToBox(detour, CRATE_AT.x, CRATE_AT.z, CRATE_H).toFixed(3) + ' m');

// Removing it must restore the surface AND the original answer, exactly.
removeObstacle(scene, crate);
pumpObstacles();
check('obstacleCount is back to zero', obstacleCount() === 0);
check('the footprint is walkable again', samplesIn(CRATE_AT.x, CRATE_AT.z, CRATE_H) === footBefore,
      `${footBefore} -> ${samplesIn(CRATE_AT.x, CRATE_AT.z, CRATE_H)}`);
refreshOverlay();
check('the overlay is restored to the pre-crate sample count',
      navmesh.walkableSamples === dynSamples,
      `${navmesh.walkableSamples} vs ${dynSamples}`);

setStart(LANE_A);
setGoal(LANE_B);
const restored = state.path;
check('the original straight route comes back unchanged',
      restored.points.length === openLane.points.length
      && restored.points.every((p, i) =>
            Math.abs(p.x - openLane.points[i].x) < 1e-4
         && Math.abs(p.z - openLane.points[i].z) < 1e-4),
      `${openLane.points.length} -> ${restored.points.length} waypoints`);

// --- 11. Blocking the choke severs it, and the walkers re-plan ---------------

console.log('[11] blocking the corridor');
setStart(marks.hallSW);
setGoal(marks.eastRoom);
const viaChoke = state.path;
check('the baseline route reaches the east room', !!viaChoke && viaChoke.partial === false);

// Where does the route cross x = 4? It must be inside the 2.6 m doorway.
function crossingZ(path, atX) {
    const pts = path.points;
    for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        if ((a.x - atX) * (b.x - atX) > 0) continue;
        const t = Math.abs(b.x - a.x) < 1e-6 ? 0 : (atX - a.x) / (b.x - a.x);
        return a.z + (b.z - a.z) * t;
    }
    return null;
}
const zAtDoor = crossingZ(viaChoke, CHOKE.x);
check('the baseline route goes through the doorway', zAtDoor !== null
      && Math.abs(zAtDoor) < CHOKE.halfZ + 0.2,
      'crosses x=4 at z=' + (zAtDoor === null ? 'never' : zAtDoor.toFixed(2)));

// Put the four route-walkers on that route, so the repath is observable.
retargetAll(marks.eastRoom);
const repathsBefore = agentState.repaths;
check('all four walkers are routed through the corridor',
      agents.every(a => a.route && !a.done));

const doorOpen = samplesIn(CHOKE.x, 0, 0.7);
const genBeforeBlock = navmesh.mesh.generation;
blockCorridor(scene);
check('the barrier was added', obstacleCount() === 1);
check('generation moved when the barrier applied',
      navmesh.mesh.generation > genBeforeBlock,
      `${genBeforeBlock} -> ${navmesh.mesh.generation}`);

// Sample the doorway's clear span, comfortably inside the barrier footprint.
check('the doorway was walkable before the barrier', doorOpen > 10,
      doorOpen + ' samples in the doorway');
const doorSamples = samplesIn(CHOKE.x, 0, 0.7);
check('the doorway has no walkable surface left', doorSamples === 0,
      `${doorOpen} -> ${doorSamples} samples in the doorway`);

setStart(marks.hallSW);
setGoal(marks.eastRoom);
const sealed = state.path;
check('the east room is now unreachable, so the route clamps',
      !sealed || sealed.partial === true,
      sealed ? 'partial=' + sealed.partial : 'no path at all');
if (sealed) {
    check('the clamped route stops on the west side of the divider',
          Math.max(...sealed.points.map(p => p.x)) < CHOKE.x,
          'furthest east x=' + Math.max(...sealed.points.map(p => p.x)).toFixed(2));
}

// The frame loop watches `generation` and re-plans; one tick is enough.
advanceTime(200);
check('the walkers re-planned when the surface changed',
      agentState.repaths > repathsBefore,
      `${repathsBefore} -> ${agentState.repaths} repaths`);
check('no walker is still holding a route through the sealed doorway',
      agents.every(a => !a.route || crossingZ(a.route, CHOKE.x) === null));

clearObstacles(scene);
setStart(marks.hallSW);
setGoal(marks.eastRoom);
const reopened = state.path;
check('removing the barrier reopens the corridor',
      !!reopened && reopened.partial === false);
check('the reopened route uses the doorway again',
      Math.abs(crossingZ(reopened, CHOKE.x)) < CHOKE.halfZ + 0.2,
      'crosses x=4 at z=' + crossingZ(reopened, CHOKE.x).toFixed(2));

// Back to the static bake for the crowd work — the crowd needs a navmesh, not
// a tiled one specifically, and the static bake is what the app boots with.
bakeParams.dynamicObstacles = false;
rebake();
check('switching back to the static bake restores the chunk-1 surface',
      navmesh.walkableSamples === baselineSamples,
      `${navmesh.walkableSamples} vs ${baselineSamples}`);

// --- 12. ORCA: the funnel, avoidance off vs on -------------------------------
//
// The key measurement in this file. Same roster, same start line, same route,
// same number of ticks — the only difference is world.setAvoidance. If the mean
// overlapping-pair count does not fall, avoidance is not doing anything.

console.log('[12] ORCA avoidance through the choke');
const CROWD_N = 30, RUN_MS = 9000;

function funnelRun(avoid) {
    scenarioFunnel(scene, CROWD_N);
    setAvoidance(avoid);
    advanceTime(RUN_MS);
    return { mean: overlapMean(), peak: crowdState.overlapPeak };
}

const off = funnelRun(false);
const on = funnelRun(true);
console.log(`      avoidance OFF: mean ${off.mean.toFixed(2)} pairs, peak ${off.peak}`);
console.log(`      avoidance ON : mean ${on.mean.toFixed(2)} pairs, peak ${on.peak}`);

check('the crowd is the size we asked for', crowdState.agents.length === CROWD_N,
      crowdState.agents.length + ' agents');
check('world.avoidanceEnabled reflects the toggle',
      agentState.world.avoidanceEnabled === true);
check('agents interpenetrate with avoidance OFF', off.mean > 1.0,
      off.mean.toFixed(2) + ' overlapping pairs per tick');
check('avoidance measurably reduces overlapping pairs', on.mean < off.mean * 0.6,
      `${off.mean.toFixed(2)} off -> ${on.mean.toFixed(2)} on `
      + `(${(100 * (1 - on.mean / off.mean)).toFixed(0)}% fewer)`);
check('the worst instantaneous pile-up also drops', on.peak < off.peak,
      `peak ${off.peak} -> ${on.peak}`);
check('the crowd still gets through the doorway — avoidance did not deadlock it',
      crowdState.agents.some(r => r.agent.x > CHOKE.x)
      && crowdState.agents.some(r => r.agent.x < CHOKE.x),
      'agents on both sides of the divider');

// --- 13. Priority: a VIP holds its line --------------------------------------

console.log('[13] avoidance priority');
scenarioVip(scene, 18);
setAvoidance(true);
advanceTime(RUN_MS);

const vip = findRole('vip'), ctl = findRole('control');
check('the VIP and the control both exist', !!vip && !!ctl);
const vipDev = deviationOf(vip), ctlDev = deviationOf(ctl);
console.log(`      VIP (priority 1.0) mean deviation ${vipDev.toFixed(3)} m; `
          + `control (priority 0.0) ${ctlDev.toFixed(3)} m`);
check('both test subjects actually met the crowd',
      vip.devN > 100 && ctl.devN > 100, `${vip.devN} / ${ctl.devN} samples`);
check('the high-priority agent is pushed off its line less than the low-priority one',
      vipDev < ctlDev,
      `VIP ${vipDev.toFixed(3)} m vs control ${ctlDev.toFixed(3)} m`);

// --- 14. layers / mask: two factions that only see their own kind ------------

console.log('[14] avoidance layers and mask');
scenarioFactions(scene, 24);
setAvoidance(true);
advanceTime(RUN_MS);

const cross = crowdState.crossFactionAccum, same = crowdState.sameFactionAccum;
console.log(`      cross-faction overlap-ticks ${cross}, within-faction ${same}`);
check('the two factions walk straight through each other', cross > 0,
      cross + ' cross-faction overlap-ticks');
check('each faction still avoids its own kind', cross > same * 2,
      `cross ${cross} vs same ${same}`);

// --- 15. The elevation filter: stacked crowds ignore each other --------------
//
// The strongest form of "they did not influence each other": run the ground
// lane alone, run it again with a crowd on the mezzanine directly overhead, and
// require the ground trajectories to come out IDENTICAL. Playback under
// advanceTime is deterministic, so any interaction at all would show up.

console.log('[15] the multi-level elevation filter');
const STACK_N = 24, STACK_MS = 5000;

function stackRun(levels, height) {
    scenarioStacked(scene, STACK_N, levels);
    setAvoidance(true);
    setAvoidHeight(height);
    advanceTime(STACK_MS);
    return snapshot('ground');
}

const alone = stackRun([0], 2.0);
const withMezz = stackRun([0, 4], 2.0);
const merged = stackRun([0, 4], 12.0);

check('the ground lane has agents on it', alone.length >= 2, alone.length + ' ground agents');
check('the mezzanine run has the same ground roster', withMezz.length === alone.length);

let worstDelta = 0, worstVel = 0;
for (let i = 0; i < alone.length; i++) {
    worstDelta = Math.max(worstDelta,
        Math.hypot(alone[i].x - withMezz[i].x, alone[i].z - withMezz[i].z));
    worstVel = Math.max(worstVel,
        Math.hypot(alone[i].vx - withMezz[i].vx, alone[i].vz - withMezz[i].vz));
}
console.log(`      ground vs ground+mezzanine: worst position delta `
          + `${worstDelta.toExponential(2)} m, worst velocity delta `
          + `${worstVel.toExponential(2)} m/s`);
check('a crowd on the mezzanine does not move the crowd below it at all',
      worstDelta === 0, 'worst position delta ' + worstDelta);
check('...and does not perturb their velocities either',
      worstVel === 0, 'worst velocity delta ' + worstVel);

// Now break the filter on purpose: a 12 m avoidance height makes the two
// spans overlap, the solver stops treating them as separate levels, and the
// ground crowd starts dodging agents four metres over its head.
let mergedDelta = 0;
for (let i = 0; i < alone.length; i++) {
    mergedDelta = Math.max(mergedDelta,
        Math.hypot(alone[i].x - merged[i].x, alone[i].z - merged[i].z));
}
console.log(`      with the filter defeated (height 12): worst delta `
          + `${mergedDelta.toFixed(3)} m`);
check('widening the avoidance height DOES make the levels interact',
      mergedDelta > 0.1,
      'worst position delta ' + mergedDelta.toFixed(3) + ' m — so the identical '
      + 'trajectories above were the elevation filter, not an absent crowd');

// --- 16. Off-mesh links: a route that is not walking --------------------------
//
// The link yard's east pad touches nothing. If a route reaches it, the route
// used the jump link — there is no other explanation available, and this
// section spends its first three checks establishing exactly that before it
// claims anything about links at all.

console.log('[16] off-mesh links');
clearCrowd(scene);
setAvoidance(false);

check('the static bake carries the off-mesh links', navmesh.linksBaked === 3,
      navmesh.linksBaked + ' links');
check('links and dynamic obstacles cannot be combined (documented, enforced)',
      (() => {
          try {
              bro.ai.game.bakeNavMesh({
                  fromPhysics: Physics, dynamicObstacles: true,
                  offMeshLinks: [{ start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } }],
              });
              return false;
          } catch (e) { return /offMeshLinks/.test(e.message); }
      })(), 'bakeNavMesh throws rather than silently dropping them');

// Each link, probed the only way the API allows: ask for a route from its own
// takeoff to its own landing and see whether the mesh answers.
for (const def of LINK_DEFS) {
    check(`the ${def.id} link survived the bake`, linkIsLive(def) === true,
          `${def.start.x},${def.start.y},${def.start.z} -> `
        + `${def.end.x},${def.end.y},${def.end.z}`);
}

// The gap really is a gap: nothing walkable between the two pads.
let gapSamples = 0;
for (let x = 11.2; x <= 15.3; x += 0.25) {
    const q = navmesh.mesh.nearestPoint({ x, y: 3, z: -10.5 }, { x: 0.15, y: 0.5, z: 0.15 });
    if (q && Math.abs(q.x - x) < 0.12) gapSamples++;
}
check('there is no walkable surface across the 4.5 m gap', gapSamples === 0,
      gapSamples + ' walkable samples between the pads');

setStart(marks.eastRoom);
setGoal(linkMarks.padEast);
const jumped = state.path;
check('a route to the island pad exists', !!jumped && jumped.partial === false,
      jumped ? jumped.points.length + ' waypoints' : 'no path');
const segs = linkSegmentsOf(jumped);
check('the route carries link information', segs.length >= 1,
      'wp.links = ' + JSON.stringify(jumped.links));
check('the marked link segment is the one that spans the gap',
      segs.length >= 1 && Math.hypot(segs[0].to.x - segs[0].from.x,
                                     segs[0].to.z - segs[0].from.z) > 4.0
      && segs[0].from.x < 11.5 && segs[0].to.x > 15.0,
      segs.length ? `takeoff x=${segs[0].from.x.toFixed(2)} -> landing `
                  + `x=${segs[0].to.x.toFixed(2)}` : 'no link segment');
check('the route ends on the island pad', jumped
      && jumped.points[jumped.points.length - 1].x > 15.4,
      'final x ' + jumped.points[jumped.points.length - 1].x.toFixed(2));

// Now the strong proof: an AGENT crossing. Not "the query mentioned a link" —
// a body that was on the west side of a 4.5 m hole and is now on the east side.
const walkersBefore = linkState.walkers.map(w => ({ x: w.agent.x, z: w.agent.z }));
check('the link walkers start west of the gap',
      walkersBefore.every(w => w.x < 11.0),
      'max start x ' + Math.max(...walkersBefore.map(w => w.x)).toFixed(2));

const startedRoutes = sendLinkWalkers(linkMarks.padEast);
check('every link walker got a route', startedRoutes === linkState.walkers.length,
      `${startedRoutes}/${linkState.walkers.length}`);

// Poll for onLink across the traversal. It is true for only the fraction of a
// second the agent spends between takeoff and landing, so sample often.
let onLinkTicks = 0, sawOnLink = false;
for (let i = 0; i < 120; i++) {
    advanceTime(120);
    if (linkState.onLinkNow > 0) { sawOnLink = true; onLinkTicks++; }
    // Both conditions, because they land one frame apart: crossedGap trips as
    // soon as a walker is over the pad, which can still be the last frame of
    // the link, while the traversal only counts once onLink has gone false.
    if (linkState.crossedGap >= linkState.walkers.length
        && linkState.traversals >= linkState.walkers.length) break;
}
advanceTime(500);   // let them settle on the pad before measuring positions
check('navigationInfo().onLink fired during the traversal', sawOnLink === true,
      onLinkTicks + ' sampled frames with a walker mid-link');
check('the traversal counter moved', linkState.traversals >= linkState.walkers.length,
      linkState.traversals + ' completed link crossings');
check('the last link entered was the jump', linkState.lastLink === 'jump',
      linkState.lastLink);

const walkersAfter = linkState.walkers.map(w => ({ x: w.agent.x, z: w.agent.z, y: w.node.y }));
check('every walker physically crossed the gap',
      walkersAfter.every(w => w.x > 15.4),
      walkersBefore.map((b, i) => `x ${b.x.toFixed(1)} -> ${walkersAfter[i].x.toFixed(1)}`).join('; '));
check('...and is standing on the island pad, three metres up',
      walkersAfter.every(w => w.y > 3.4 && w.y < 4.4),
      'node y ' + walkersAfter.map(w => w.y.toFixed(2)).join(', '));
check('linkState counted them onto the island',
      linkState.crossedGap === linkState.walkers.length,
      linkState.crossedGap + '/' + linkState.walkers.length);

// --- 17. Partial paths: walled in --------------------------------------------
//
// Seal the pad (drop ONLY the jump link from the bake) and the island is
// unreachable. The same query, on the same mesh, in the same tick, answers two
// different ways depending on requireFullPath — which is the point.

console.log('[17] partial paths');
setSealed(true);
rebake();
check('sealing removed one link from the bake', navmesh.linksBaked === 2,
      navmesh.linksBaked + ' links');
check('the jump link is gone from the mesh',
      linkIsLive(LINK_DEFS.find(l => l.id === 'jump')) === false);
check('the other two links are untouched',
      LINK_DEFS.filter(l => l.id !== 'jump').every(linkIsLive));

const sealedCmp = comparePartial({ ...marks.eastRoom }, { ...linkMarks.padEast });
check('requireFullPath:false still returns a route', sealedCmp.looseFound === true);
check('...and marks it partial', sealedCmp.loosePartial === true);
check('...clamped short of the goal', sealedCmp.shortfall > 2.0,
      'stops ' + sealedCmp.shortfall.toFixed(2) + ' m from the island');
check('...at the closest reachable point, which is the ground under the pad',
      sealedCmp.clampedAt.y < 1.0 && Math.abs(sealedCmp.clampedAt.x - linkMarks.padEast.x) < 3.0,
      `clamped at ${sealedCmp.clampedAt.x.toFixed(2)}, `
    + `${sealedCmp.clampedAt.y.toFixed(2)}, ${sealedCmp.clampedAt.z.toFixed(2)}`);
check('requireFullPath:true returns NO path for the identical query',
      sealedCmp.strictFound === false,
      'same mesh, same endpoints, one flag apart');

// And it is genuinely the seal doing it, not the query: restore the link.
setSealed(false);
rebake();
const openCmp = comparePartial({ ...marks.eastRoom }, { ...linkMarks.padEast });
check('restoring the jump makes both flags agree on a complete route',
      openCmp.looseFound && !openCmp.loosePartial && openCmp.strictFound,
      `loose partial=${openCmp.loosePartial}, strict found=${openCmp.strictFound}`);

// --- 18. The NavGrid, baked from the same physics ----------------------------

console.log('[18] NavGrid physics bake');
setGridOverlayVisible(true);
check('the grid overlay drew cells', gridState.cells > 1000,
      `${gridState.cells} walkable of ${gridState.tested} probed`);
check('the grid is not simply all-walkable', gridState.cells < gridState.tested * 0.9,
      `${(100 * gridState.cells / gridState.tested).toFixed(0)}% walkable`);

// Cells this app can name from the level descriptor, with no reference to the
// grid's internals: solid geometry must be blocked, open floor must not be.
for (const [label, x, z] of [
    ['the divider wall', 4, -10],
    ['a pillar', 10, -6],
    ['the inner chamber wall', 12, -18],
]) {
    check(`${label} is blocked in the grid`, gridWalkable(x, z) === false, `(${x}, ${z})`);
}
for (const [label, x, z] of [
    ['the open west hall', -17, -17],
    ['the open east room', 19, -10],
]) {
    check(`${label} is walkable in the grid`, gridWalkable(x, z) === true, `(${x}, ${z})`);
}

// The headline difference, measured: a NavGrid obstacle is the body's AABB
// projected to XZ, so a ramp blocks its whole footprint. The navmesh walks up
// the very same ramp.
const RAMP_D_ON = { x: 14, y: 1.5, z: -1.0 };
const onRampMesh = navmesh.mesh.nearestPoint(RAMP_D_ON, { x: 0.6, y: 1.2, z: 0.6 });
check('the navmesh is walkable on ramp D', !!onRampMesh
      && Math.abs(onRampMesh.x - RAMP_D_ON.x) < 0.4 && onRampMesh.y > 0.8,
      onRampMesh ? 'snapped to y ' + onRampMesh.y.toFixed(2) : 'off the mesh');
check('the NavGrid blocks the same ramp — its AABB is the obstacle',
      gridWalkable(RAMP_D_ON.x, RAMP_D_ON.z) === false,
      `(${RAMP_D_ON.x}, ${RAMP_D_ON.z}) walkable on the mesh, blocked on the grid`);

// --- 19. groundFollow --------------------------------------------------------
//
// Two agents, identical except for the groundFollow probe, steered in a
// straight line up the link-yard ramp. Neither has a navmesh or a nav grid, so
// the probe is the only variable in the experiment.

console.log('[19] ground follow');
resetFollowers();
advanceTime(200);
walkTheRamp();
advanceTime(9000);

const gfSpread = followerSpread(true), flatSpread = followerSpread(false);
const gfRec = followerOf(true), flatRec = followerOf(false);
console.log(`      groundFollow node Y ${gfRec.yMin.toFixed(2)}..${gfRec.yMax.toFixed(2)}; `
          + `plain node Y ${flatRec.yMin.toFixed(2)}..${flatRec.yMax.toFixed(2)}`);
check('both agents actually walked', Math.abs(gfRec.agent.z - flatRec.agent.z) < 1.5
      && gfRec.agent.z < -6, `z ${gfRec.agent.z.toFixed(2)} / ${flatRec.agent.z.toFixed(2)}`);
check('the groundFollow agent climbed the ramp', gfSpread > 2.5,
      'Y varied by ' + gfSpread.toFixed(2) + ' m');
check('the plain agent kept a constant height', flatSpread === 0,
      'Y varied by ' + flatSpread.toFixed(3) + ' m');
check('the groundFollow agent ended up on the pad', gfRec.node.y > 3.4,
      'node y ' + gfRec.node.y.toFixed(2));
check('the plain agent is still at its spawn height, inside the ramp',
      Math.abs(flatRec.node.y - 0.76) < 1e-3, 'node y ' + flatRec.node.y.toFixed(3));

// --- 20. Steering kernels and lead aim ---------------------------------------

console.log('[20] steer.* kernels');

// The kernels first, as pure functions, so a live measurement that agrees with
// them means something.
const seekF = bro.ai.game.steer.seek(0, 0, 10, 0);
check('steer.seek returns a unit direction',
      Math.abs(Math.hypot(seekF.fx, seekF.fz) - 1) < 1e-3,
      `|f| = ${Math.hypot(seekF.fx, seekF.fz).toFixed(4)}`);
const far = bro.ai.game.steer.arrive(0, 0, 10, 0, 3.0);
const near = bro.ai.game.steer.arrive(8.5, 0, 10, 0, 3.0);
const nearer = bro.ai.game.steer.arrive(9.5, 0, 10, 0, 3.0);
check('steer.arrive is at full magnitude outside the slowing radius',
      Math.abs(Math.hypot(far.fx, far.fz) - 1) < 1e-3);
check('steer.arrive shrinks inside the slowing radius, monotonically',
      Math.hypot(nearer.fx, nearer.fz) < Math.hypot(near.fx, near.fz)
      && Math.hypot(near.fx, near.fz) < 1.0,
      `1.5 m out: ${Math.hypot(near.fx, near.fz).toFixed(3)}, `
    + `0.5 m out: ${Math.hypot(nearer.fx, nearer.fz).toFixed(3)}`);

// And live, on the pad: the two agents chase the same orbiting target and only
// one of them slows down for it.
setSteeringVisible(true);
advanceTime(3000);
let arriveSum = 0, seekSum = 0, samples = 0, insideSlowing = 0;
for (let i = 0; i < 50; i++) {
    advanceTime(100);
    const d = distanceToTarget('arrive');
    if (d < ARRIVE_SLOWING) insideSlowing++;
    arriveSum += agentSpeed('arrive');
    seekSum += agentSpeed('seek');
    samples++;
}
const arriveMean = arriveSum / samples, seekMean = seekSum / samples;
console.log(`      mean speed — arrive ${arriveMean.toFixed(2)} m/s, seek `
          + `${seekMean.toFixed(2)} m/s over ${samples} samples `
          + `(${insideSlowing} inside the slowing radius)`);
check('the arrive agent settled inside its slowing radius', insideSlowing > samples * 0.8,
      `${insideSlowing}/${samples} samples within ${ARRIVE_SLOWING} m`);
check('arrive decelerates near the target', arriveMean < seekMean * 0.8,
      `${arriveMean.toFixed(2)} vs ${seekMean.toFixed(2)} m/s`);
check('seek never slows down — it is at the agent speed throughout',
      Math.abs(seekMean - agentOf('seek').speed) < 0.02,
      `${seekMean.toFixed(3)} vs speed ${agentOf('seek').speed}`);
check('flee and evade both moved away from the target',
      distanceToTarget('flee') > 3.0 && distanceToTarget('evade') > 3.0,
      `flee ${distanceToTarget('flee').toFixed(1)} m, `
    + `evade ${distanceToTarget('evade').toFixed(1)} m`);

// computeLeadAim: the same turret, the same target, the same instant — the only
// difference is whether the solver was told the target is moving.
console.log('[20b] computeLeadAim');
const SAMPLE_T = 1.0;          // mid-sweep, well away from a direction reversal
const direct = simulateShot(SAMPLE_T, false);
const lead = simulateShot(SAMPLE_T, true);
console.log(`      direct aim closest approach ${direct.closest.toFixed(3)} m; `
          + `lead aim ${lead.closest.toFixed(3)} m (hit radius ${HIT_RADIUS} m)`);
check('the lead solution is valid', lead.valid === true);
check('aiming straight at the target MISSES a crossing target',
      direct.closest > HIT_RADIUS * 2, 'closest approach ' + direct.closest.toFixed(2) + ' m');
check('computeLeadAim HITS the same target', lead.closest <= HIT_RADIUS,
      'closest approach ' + lead.closest.toFixed(3) + ' m');
check('lead aim is at least five times more accurate here',
      lead.closest * 5 < direct.closest,
      `${direct.closest.toFixed(2)} m -> ${lead.closest.toFixed(3)} m`);
check('the two solutions differ in yaw, which is where the miss comes from',
      Math.abs(lead.yaw - direct.yaw) > 0.05,
      `yaw ${direct.yaw.toFixed(3)} -> ${lead.yaw.toFixed(3)} rad`);

// The miss is systematic, not one unlucky sample. Sweep the launch time — but
// split the sweep, because computeLeadAim solves for a target moving at a
// CONSTANT velocity, and this track reverses direction every 2.4 s. A shot
// whose ~0.6 s flight spans a reversal is aimed at a future the target never
// visits, and it should miss. Asserting both halves is the difference between
// testing the solver and testing a hand-picked sample.
const REVERSAL = 2.4, FLIGHT = 0.65;
const spansReversal = t => Math.floor(t / REVERSAL) !== Math.floor((t + FLIGHT) / REVERSAL);

let leadWins = 0, clean = 0, dirty = 0, dirtyWorse = 0;
for (const t of [0.4, 0.8, 1.2, 1.6, 2.0, 2.8, 3.2, 3.6, 4.0, 4.4]) {
    const a = simulateShot(t, false), b = simulateShot(t, true);
    if (spansReversal(t)) {
        dirty++;
        if (b.closest > HIT_RADIUS) dirtyWorse++;
    } else {
        clean++;
        if (b.closest < a.closest && b.closest <= HIT_RADIUS) leadWins++;
    }
}
check('lead aim hits at every launch time with a constant-velocity flight',
      leadWins === clean, `${leadWins}/${clean} launch times`);
check('...and honestly misses when the flight spans a direction reversal',
      dirty > 0 && dirtyWorse === dirty,
      `${dirtyWorse}/${dirty} — the solver assumes constant target velocity, `
    + 'and says so; it is not a magic tracker');

// Leave the app on a scenario worth looking at in the screenshot.
scenarioFunnel(scene, 24);
setAvoidance(true);
advanceTime(2500);

// --- Done --------------------------------------------------------------------

scene.setCamera({
    fov: 50, near: 0.2, far: 400,
    position: [30, 34, 46], target: [-4, 3, 4], up: [0, 1, 0],
});
setStart(marks.hallSW);
setGoal(marks.mezzanine);
advanceTime(200);
screenshot('nav-lab-smoke.png');

console.log(`\nnav-lab smoke test PASSED — ${checks} checks`);
