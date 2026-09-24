// The tiled bake: runtime crates carve the surface, reroute, and restore
// exactly; blocking the choke severs it and the walkers re-plan.
//
//   scripts/validate.sh demos/nav-lab
import { check, test, done, text, clickOn } from "/lib/kit/test.js";
import { marks, CHOKE } from "/app/level.js";
import { navState } from "/app/navmesh.js";
import { agentState, retargetAll } from "/app/agents.js";
import { obstacleState, obstaclesEnabled, placeObstacle, removeObstacle, pumpObstacles, obstacleCount,
    obstaclesPending, blockCorridor, clearObstacles } from "/app/obstacles.js";
import { setRoute, refreshOverlay } from "/app/lab.js";
import { reach } from "./reach.js";

advanceTime(100);
const mesh = () => navState.mesh;

/** Walkable samples in a square footprint. */
function samplesIn(cx, cz, h, y = 0) {
    let n = 0;
    for (let x = cx - h; x <= cx + h; x += 0.3) {
        for (let z = cz - h; z <= cz + h; z += 0.3) {
            const q = mesh().nearestPoint({ x, y, z }, { x: 0.15, y: 0.6, z: 0.15 });
            if (q && Math.abs(q.x - x) < 0.12 && Math.abs(q.z - z) < 0.12) n++;
        }
    }
    return n;
}

/** Where a route crosses x = atX (null if never). */
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

test('the static bake refuses obstacles', () => {
    check(!obstaclesEnabled(), 'static mesh has no obstacle API');
    check(blockCorridor() === null && /dynamicObstacles/.test(obstacleState.lastError), obstacleState.lastError);
});

test('the tiled mode button bakes a dtTileCache mesh', () => {
    clickOn('#btnModeTiled');
    check(mesh() && mesh().valid && mesh().supportsObstacles, navState.lastError);
    check(obstaclesEnabled(), 'obstaclesEnabled agrees');
    check(navState.blobBytes === 0 && navState.linksBaked === 0, 'no blob, no links');
    let threw = false;
    try { mesh().save(); } catch (e) { threw = true; }
    check(threw, 'save() throws on a tiled mesh');
    check(navState.walkableSamples > 200, navState.walkableSamples + ' samples');
    check(/Tiled/.test(text('#modeBar')), 'mode banner: ' + text('#modeBar'));
});

// In the OPEN west hall, where a detour exists (the corridor is the severing case).
const LANE_Z = -8, A = { x: -17, y: 0, z: LANE_Z }, B = { x: -1, y: 0, z: LANE_Z };
const CRATE_AT = { x: -9, y: 0, z: LANE_Z }, H = 1.6;

test('a crate carves the surface, reroutes, and restores exactly', () => {
    const dynSamples = navState.walkableSamples, gen0 = mesh().generation;
    const open = setRoute(A, B);
    check(open && !open.partial, 'open lane');
    check(Math.max(...open.points.map((p) => Math.abs(p.z - LANE_Z))) < 0.6, 'straight down the lane');
    const footBefore = samplesIn(CRATE_AT.x, CRATE_AT.z, H);
    check(footBefore > 30, footBefore + ' samples before');

    const crate = placeObstacle(CRATE_AT, { hx: H, hy: 1.2, hz: H });
    check(crate && crate.handle > 0, obstacleState.lastError);
    check(obstacleCount() === 1 && obstaclesPending() === true, 'queued, pending');
    const tiles = pumpObstacles();
    check(tiles >= 1 && !obstaclesPending(), tiles + ' update() calls');
    check(mesh().generation > gen0, 'generation moved');
    check(samplesIn(CRATE_AT.x, CRATE_AT.z, H) === 0, 'footprint carved');
    refreshOverlay();
    check(navState.walkableSamples < dynSamples, `${dynSamples} -> ${navState.walkableSamples}`);

    const detour = setRoute(A, B);
    check(detour && !detour.partial && detour.points.length > open.points.length, 'bends around');
    check(Math.max(...detour.points.map((p) => Math.abs(p.z - LANE_Z))) > H * 0.8, 'leaves the lane');
    // No point on any segment may be inside the crate.
    let best = Infinity;
    for (let i = 0; i + 1 < detour.points.length; i++) {
        const a = detour.points[i], b = detour.points[i + 1];
        for (let t = 0; t <= 1; t += 0.02) {
            const dx = Math.max(Math.abs(a.x + (b.x - a.x) * t - CRATE_AT.x) - H, 0);
            const dz = Math.max(Math.abs(a.z + (b.z - a.z) * t - CRATE_AT.z) - H, 0);
            best = Math.min(best, Math.hypot(dx, dz));
        }
    }
    check(best > 0, 'closest approach ' + best.toFixed(3));

    removeObstacle(crate);
    pumpObstacles();
    check(obstacleCount() === 0 && samplesIn(CRATE_AT.x, CRATE_AT.z, H) === footBefore, 'footprint back');
    refreshOverlay();
    check(navState.walkableSamples === dynSamples, 'overlay restored');
    const back = setRoute(A, B);
    check(back.points.length === open.points.length
        && back.points.every((p, i) => Math.abs(p.x - open.points[i].x) < 1e-4 && Math.abs(p.z - open.points[i].z) < 1e-4), 'same route');
});

test('blocking the choke severs it and the walkers re-plan', () => {
    const via = setRoute(marks.hallSW, marks.eastRoom);
    check(via && !via.partial, 'baseline reaches the east room');
    const z = crossingZ(via, CHOKE.x);
    check(z !== null && Math.abs(z) < CHOKE.halfZ + 0.2, 'through the doorway at z ' + z);
    retargetAll(marks.eastRoom);
    const agents = agentState.agents, repaths = agentState.repaths;
    check(agents.every((a) => a.route && !a.done), 'walkers routed through');
    advanceTime(50);   // the frame loop records the current generation

    const doorOpen = samplesIn(CHOKE.x, 0, 0.7), gen = mesh().generation;
    reach('#btnBlock');
    check(obstacleCount() === 1 && mesh().generation > gen, 'barrier applied');
    check(doorOpen > 10 && samplesIn(CHOKE.x, 0, 0.7) === 0, `${doorOpen} -> doorway carved`);
    check(/blocked/.test(text('#obsHint')), text('#obsHint'));
    const sealed = setRoute(marks.hallSW, marks.eastRoom);
    check(!sealed || sealed.partial, 'the east room is unreachable');
    if (sealed) check(Math.max(...sealed.points.map((p) => p.x)) < CHOKE.x, 'clamped west of the divider');
    advanceTime(200);
    check(agentState.repaths > repaths, `${repaths} -> ${agentState.repaths} repaths`);
    check(agents.every((a) => !a.route || crossingZ(a.route, CHOKE.x) === null), 'no route through the sealed door');

    clearObstacles();
    const re = setRoute(marks.hallSW, marks.eastRoom);
    check(re && !re.partial && Math.abs(crossingZ(re, CHOKE.x)) < CHOKE.halfZ + 0.2, 'reopened through the doorway');
});

test('switching back to the static bake restores the links', () => {
    clickOn('#btnModeLinks');
    check(!mesh().supportsObstacles && navState.linksBaked === 3, navState.linksBaked + ' links');
    check(/Static/.test(text('#modeBar')), text('#modeBar'));
});

done('nav-lab obstacles');
