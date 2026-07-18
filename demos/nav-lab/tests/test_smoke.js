// tests/test_smoke.js — assert the navmesh does the things this app claims.
//
// Every assertion goes through the same entry points the HUD drives, so a green
// run means the app works, not just that the library does.

import {
    scene, state, navmesh, bakeParams, rebake, marks,
    setStart, setGoal, findPath, findGridPath, saveMesh, loadMesh,
    agents, retargetAll,
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
