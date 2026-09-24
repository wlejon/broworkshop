// The bake produces a real multi-storey surface: same-floor and cross-floor
// routes, the NavGrid's blind spot, save/load, bake parameters that visibly
// change the surface, walkers that climb, and an overlay with stacked layers.
//
//   scripts/validate.sh demos/nav-lab
import { check, test, done } from "/lib/kit/test.js";
import { marks } from "/app/level.js";
import { bakeParams, navState, findGridPath, saveMesh, loadMesh } from "/app/navmesh.js";
import { agentState, retargetAll } from "/app/agents.js";
import { state, setRoute, rebake } from "/app/lab.js";

advanceTime(100);
const mesh = () => navState.mesh;
const route = (from, to) => setRoute(from, to);

test('the bake produced a real surface', () => {
    check(bro.ai.game.navMeshAvailable === true, 'navmesh in this build');
    check(mesh() && mesh().valid === true, 'mesh baked and valid');
    check(navState.lastError === '', navState.lastError);
    check(navState.walkableSamples > 200, navState.walkableSamples + ' samples');
    check(navState.blobBytes > 1000, navState.blobBytes + ' B blob');
});
const baselineSamples = navState.walkableSamples;

test('a same-floor route stays on the walkable surface', () => {
    const p = route(marks.hallSW, marks.chamber);
    check(p && p.partial === false, 'complete path');
    check(p.points.length >= 3, p.points.length + ' waypoints');
    check(p.rise < 0.75, 'one storey, rise ' + p.rise.toFixed(3));
    // A waypoint that drifted off the surface is a route through a wall.
    let worst = 0;
    for (const w of p.points) {
        const q = mesh().nearestPoint(w, { x: 0.6, y: 1.0, z: 0.6 });
        check(q, 'waypoint snaps onto the mesh');
        worst = Math.max(worst, Math.hypot(q.x - w.x, q.y - w.y, q.z - w.z));
    }
    check(worst < 0.25, 'worst drift ' + worst.toFixed(4));
});

// Y must rise CONTINUOUSLY along a ramp. findPath string-pulls, so waypoint
// count cannot show it: sample the mesh along the route by arc length.
function heightProfile(path, samples) {
    const pts = path.points, segs = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
        segs.push(d); total += d;
    }
    const prof = [];
    for (let s = 0; s <= samples; s++) {
        let want = (s / samples) * total, i = 0;
        while (i < segs.length - 1 && want > segs[i]) { want -= segs[i]; i++; }
        const t = segs[i] > 1e-6 ? want / segs[i] : 0;
        const x = pts[i].x + (pts[i + 1].x - pts[i].x) * t, z = pts[i].z + (pts[i + 1].z - pts[i].z) * t;
        const y = pts[i].y + (pts[i + 1].y - pts[i].y) * t;
        const q = mesh().nearestPoint({ x, y, z }, { x: 0.8, y: 2.5, z: 0.8 });
        prof.push(q ? q.y : null);
    }
    return prof;
}

test('a cross-floor route climbs a ramp the NavGrid cannot see', () => {
    const p = route(marks.hallSW, marks.mezzanine);
    check(p && p.partial === false, 'complete path');
    check(p.rise > 3.0, 'rise ' + p.rise.toFixed(2));
    check(p.points[0].y < 1.0 && p.points[p.points.length - 1].y > 3.4, 'ground to mezzanine');
    const prof = heightProfile(p, 24);
    check(prof.every((y) => y !== null), 'the whole route is on the surface');
    const mid = prof.filter((y) => y > 0.8 && y < 3.4).length;
    check(mid >= 4, mid + ' samples at intermediate height');
    let jump = 0;
    for (let i = 1; i < prof.length; i++) jump = Math.max(jump, Math.abs(prof[i] - prof[i - 1]));
    check(jump < 1.0, 'largest height step ' + jump.toFixed(3));
    const g = findGridPath(marks.hallSW, marks.mezzanine);
    check(!g || g.points.every((w) => w.y === 0), 'the grid answer never leaves y 0');
});

test('the roof route spans all three storeys', () => {
    const p = route(marks.eastRoom, marks.roof);
    check(p && p.maxY > 7.0, 'maxY ' + (p && p.maxY.toFixed(2)));
    check(p.rise > 6.5, 'rise ' + p.rise.toFixed(2));
});

test('save + load round-trips the mesh exactly', () => {
    route(marks.hallSW, marks.mezzanine);
    const bytes = saveMesh();
    check(bytes > 1000, bytes + ' B');
    const r = loadMesh(state.start, state.goal);
    check(r.valid && r.bytes === bytes, `${bytes} out, ${r.bytes} in`);
    check(r.waypointsAfter === r.waypointsBefore && r.waypointsAfter > 0, `${r.waypointsBefore} -> ${r.waypointsAfter}`);
    check(r.identical, 'identical waypoints');
    rebake();
    check(navState.walkableSamples === baselineSamples, 're-bake restores the surface');
});

/** Bake with overrides, run fn, restore the defaults and prove the surface came back. */
function withParams(over, fn) {
    const saved = {};
    for (const k in over) { saved[k] = bakeParams[k]; bakeParams[k] = over[k]; }
    rebake();
    try { fn(); } finally {
        Object.assign(bakeParams, saved);
        rebake();
    }
    check(navState.walkableSamples === baselineSamples, `restored: ${navState.walkableSamples} vs ${baselineSamples}`);
}

test('agent radius erodes the surface and closes the 2.6 m corridor', () => {
    const open = route(marks.hallSW, marks.eastRoom);
    check(open && open.partial === false, 'passable at r 0.5');
    withParams({ agentRadius: 1.6 }, () => {
        check(navState.walkableSamples < baselineSamples, `${baselineSamples} -> ${navState.walkableSamples}`);
        const p = route(marks.hallSW, marks.eastRoom);
        check(!p || p.partial, 'closed at r 1.6');
    });
});

test('a 22° slope limit severs the 26.6° ramp', () => {
    const p0 = route(marks.eastRoom, marks.platform);
    check(p0 && !p0.partial && p0.maxY > 2.5, 'walkable at 45°');
    withParams({ agentMaxSlopeDeg: 22 }, () => {
        const p = route(marks.eastRoom, marks.platform);
        check(!p || p.partial || p.maxY < 2.5, 'severed');
        check(navState.walkableSamples < baselineSamples, 'surface shrank');
    });
});

// The 52° ramp needs maxSlope AND a finer cellSize: Recast's ledge filter
// rejects spans whose per-cell rise exceeds the climb budget.
function steepRampWalkable() {
    let n = 0;
    for (let x = -1.3; x >= -3.9; x -= 0.3) {
        const y = 4 * (x + 0.9) / -3.1;
        const q = mesh().nearestPoint({ x, y, z: 10 }, { x: 0.2, y: 0.25, z: 0.2 });
        if (q && Math.abs(q.x - x) < 0.15 && Math.abs(q.z - 10) < 0.15 && Math.abs(q.y - y) < 0.4) n++;
    }
    return n;
}

test('the 52° ramp is a two-parameter case', () => {
    check(steepRampWalkable() === 0, 'off the mesh at 45°');
    withParams({ agentMaxSlopeDeg: 85 }, () => check(steepRampWalkable() === 0, 'maxSlope alone does not admit it'));
    withParams({ agentMaxSlopeDeg: 60, cellSize: 0.15 }, () => check(steepRampWalkable() >= 8, steepRampWalkable() + ' of 9'));
});

test('a 0.2 m step budget severs the staircase', () => {
    withParams({ agentMaxClimb: 0.2 }, () => {
        const p = route(marks.eastRoom, marks.roof);
        check(!p || p.partial || p.maxY < 7.0, 'roof cut off');
    });
});

test('walkers follow the 3D route and climb', () => {
    const agents = agentState.agents;
    check(agents.length === 4, agents.length + ' agents');
    route(marks.hallSW, marks.mezzanine);
    check(retargetAll(marks.mezzanine).every(Boolean), 'every walker got a route');
    const goalOf = (a) => a.route.points[a.route.points.length - 1];
    const dist = (a) => Math.hypot(a.agent.x - goalOf(a).x, a.agent.z - goalOf(a).z);
    const before = agents.map((a) => ({ x: a.agent.x, z: a.agent.z, d: dist(a) }));
    advanceTime(4000);
    agents.forEach((a, i) => {
        check(Math.hypot(a.agent.x - before[i].x, a.agent.z - before[i].z) > 1.0, `walker ${i} moved`);
        check(a.done || before[i].d - dist(a) > 1.0, `walker ${i} closed on its goal`);
        check(Math.abs(a.node.x - a.agent.x) < 1e-3 && Math.abs(a.node.z - a.agent.z) < 1e-3, 'node tracks agent');
    });
    advanceTime(14000);
    const gained = agents.filter((a) => a.y > 1.0).length;
    check(gained > 0, gained + ' walkers above y 1');
});

test('the overlay shows the stacked storeys', () => {
    check(navState.overlayQuads > 200, navState.overlayQuads + ' quads');
    let ground = 0, mezz = 0, roof = 0;
    for (let x = -20; x <= 20; x += 1.0) {
        for (let z = -20; z <= 20; z += 1.0) {
            [0, 4, 8].forEach((y, k) => {
                const q = mesh().nearestPoint({ x, y, z }, { x: 0.5, y: 1.2, z: 0.5 });
                if (!q || Math.abs(q.x - x) > 0.3 || Math.abs(q.z - z) > 0.3) return;
                if (k === 0) ground++; else if (k === 1) mezz++; else roof++;
            });
        }
    }
    check(ground > 100 && mezz > 20 && roof > 10, `${ground} / ${mezz} / ${roof} cells`);
    let stacked = 0;
    for (let x = -19; x <= -3; x += 0.8) {
        for (let z = 5; z <= 19; z += 0.8) {
            const lo = mesh().nearestPoint({ x, y: 0, z }, { x: 0.4, y: 1.2, z: 0.4 });
            const hi = mesh().nearestPoint({ x, y: 4, z }, { x: 0.4, y: 1.2, z: 0.4 });
            if (lo && hi && Math.abs(hi.y - lo.y) > 2.0) stacked++;
        }
    }
    check(stacked > 30, stacked + ' XZ columns walkable at two heights');
});

done('nav-lab bake');
