// Tier 1 World Core & Horizon E2E tests (Areas 1.1–1.5: 26 tests).
// Covers F1 (120 km² tile streaming), F2 (camera-relative precision), F3 (road/parcel grading),
// F4 (VoxelDAG far-horizon ring), F5 (zero-churn instance pools), F8 (mid-tier parallax).
import { check, eq, test, done, frames, tier } from "/lib/kit/test.js";
import {
    waitReady,
    getApi,
    getScene,
    settle,
    walkSteps,
    teleportAndSettle,
    flyTo,
    dist2D,
    getDoorwayPos,
    getBuildingCenter,
    resolveYawToward,
    walkToPoint,
    assertDiagnoseClean,
    assertStructureClean,
    captureMotionFrames,
} from "./helpers.js";

const api = await waitReady();
const scene = getScene();

// ── Area 1.1: 120 km² Tile Streaming (6 tests) ───────────────────────────────

await test("T1.1.1 boot readiness and center origin (0, 0)", async () => {
    api.setMode("walk");
    api.setTimeMode("day");
    const st = await teleportAndSettle(0, 2, 0);
    check(api.ready === true, "api.ready is true");
    check(Array.isArray(st.pos) && st.pos.every(Number.isFinite), "pos is finite");
    check(dist2D(st.pos, [0, 0, 0]) < 5.0, "near origin (0,0)");
    const sc = bro.eye.scene(scene);
    check(sc.skyRatio < 0.95, "rendered scene contains ground/city geometry (skyRatio=" + sc.skyRatio.toFixed(2) + ")");
});

await test("T1.1.2 southwest quadrant (-5500, -5500) tile streaming", async () => {
    const st = await teleportAndSettle(-5500, null, -5500);
    walkSteps({ forward: 0 }, 10);
    const cur = api.getState();
    check(dist2D(cur.pos, [-5500, 0, -5500]) < 5.0, "teleported to (-5500, -5500)");
    const sc = bro.eye.scene(scene);
    check(sc.skyRatio < 0.95, "southwest quadrant terrain/buildings rendered");
});

await test("T1.1.3 northeast quadrant (5500, 5500) tile streaming", async () => {
    const st = await teleportAndSettle(5500, null, 5500);
    check(dist2D(st.pos, [5500, 0, 5500]) < 5.0, "teleported to (5500, 5500) spanning >= 11 km diagonal");
    const sc = bro.eye.scene(scene);
    check(sc.skyRatio < 0.95, "northeast quadrant rendered");
});

await test("T1.1.4 northwest quadrant (-5500, 5500) tile streaming", async () => {
    const st = await teleportAndSettle(-5500, null, 5500);
    check(dist2D(st.pos, [-5500, 0, 5500]) < 5.0, "teleported to (-5500, 5500)");
    const m = bro.eye.measure();
    check(m.dynamicRange > 0.05, "northwest quadrant has non-blank visual contrast: " + m.dynamicRange.toFixed(3));
});

await test("T1.1.5 southeast quadrant (5500, -5500) tile streaming", async () => {
    const st = await teleportAndSettle(5500, null, -5500);
    check(dist2D(st.pos, [5500, 0, -5500]) < 5.0, "teleported to (5500, -5500)");
    if (typeof perf !== "undefined" && typeof perf.pendingWork === "function") {
        eq(perf.pendingWork().length, 0, "tile streaming converged with zero pending work");
    }
});

await test("T1.1.6 multi-hop streaming round-trip across 120 km²", async () => {
    for (const [x, z] of [[-5500, -5500], [0, 0], [5500, 5500], [0, 0]]) {
        const st = await teleportAndSettle(x, null, z);
        check(dist2D(st.pos, [x, 0, z]) < 5.0, `round-trip hop (${x}, ${z}) settled`);
    }
    const sc = bro.eye.scene(scene);
    check(sc.skyRatio < 0.95, "downtown center cleanly restored after multi-hop");
});

// ── Area 1.2: Camera-Relative Precision (5 tests) ────────────────────────────

await test("T1.2.1 stationary camera precision stability at origin (0, 0)", async () => {
    api.setMode("walk");
    const p0 = (await teleportAndSettle(0, 2, 0)).pos.slice();
    const motion = captureMotionFrames(4, () => frames(2));
    const p1 = api.getState().pos;
    check(dist2D(p0, p1) < 1e-4 && Math.abs(p0[1] - p1[1]) < 1e-4, "stationary pos drift < 1e-4");
    eq(motion.popCount, 0, "zero frame pops at origin");
    eq(motion.stutterCount, 0, "zero stutter at origin");
});

await test("T1.2.2 stationary camera precision at distant (-5500, -5500)", async () => {
    await teleportAndSettle(-5500, null, -5500);
    walkSteps({ forward: 0 }, 10);
    const motion = captureMotionFrames(4, () => frames(2));
    eq(motion.popCount, 0, "zero vertex quantization pops at (-5500, -5500)");
    check(motion.meanDeltaE < 0.5, "stationary deltaE < 0.5 at distant coords: " + motion.meanDeltaE.toFixed(3));
});

await test("T1.2.3 stationary stability check at distant (5500, 5500)", async () => {
    await teleportAndSettle(5500, null, 5500);
    walkSteps({ forward: 0 }, 10);
    const sc = bro.eye.scene(scene, { checkStability: true, jitterPx: 0.5 });
    eq(sc.errorCount, 0, "bro.eye.scene checkStability reports 0 errors at (5500, 5500)");
    check(Boolean(sc.stability), "sc.stability object returned");
    eq(sc.stability.tested, true, "sc.stability.tested === true");
    check(sc.stability.shimmerScore <= 0.1, "shimmerScore <= 0.1: " + sc.stability.shimmerScore);
    check(sc.stability.depthFlipRatio <= 0.05, "depthFlipRatio <= 0.05: " + sc.stability.depthFlipRatio);
    check(sc.stability.meanDeltaE <= 2.0, "meanDeltaE <= 2.0: " + sc.stability.meanDeltaE);
    check(sc.stability.changedRatio <= 0.025, "changedRatio <= 0.025: " + sc.stability.changedRatio);
    const scZero = bro.eye.scene(scene, { checkStability: true, jitterPx: 0.0 });
    eq(scZero.errorCount, 0, "bro.eye.scene stationary (jitterPx=0) reports 0 errors at (5500, 5500)");
    check(scZero.stability && scZero.stability.tested === true, "scZero.stability.tested === true");
    check(scZero.stability.maxDeltaE <= 5, "stationary maxDeltaE <= 5: " + scZero.stability.maxDeltaE);
});

await test("T1.2.4 smooth micro-panning at distant (5500, -5500)", async () => {
    await teleportAndSettle(5500, null, -5500);
    walkSteps({ forward: 0 }, 8);
    const motion = captureMotionFrames(5, () => {
        walkSteps({ yawDelta: 0.025 }, 3, 16);
    });
    eq(motion.popCount, 0, "zero pops during micro-panning at distant coords");
    check(motion.smoothness > 0.4, "smooth panning cadence: " + motion.smoothness.toFixed(2));
});

await test("T1.2.5 slow walk forward without snapping at (-5500, 5500)", async () => {
    await teleportAndSettle(-5500, null, 5500, 0, 0);
    walkSteps({ forward: 0 }, 8);
    const pStart = api.getState().pos.slice();
    let prevStepDist = 0;
    let monotonic = true;
    for (let i = 0; i < 6; i++) {
        const cur = walkSteps({ forward: 1 }, 4, 16);
        const d = dist2D(pStart, cur.pos);
        if (d < prevStepDist - 0.05) monotonic = false;
        prevStepDist = d;
    }
    check(prevStepDist > 0.3, "slow walk advanced forward: " + prevStepDist.toFixed(2) + " m");
    check(monotonic, "walk progression monotonic without backward quantization snap");
});

// ── Area 1.3: Road & Parcel Grading (5 tests) ────────────────────────────────

await test("T1.3.1 downtown avenue elevation smoothness", async () => {
    await teleportAndSettle(0, 3, 0, 0, 0);
    let prev = walkSteps({ forward: 0 }, 10);
    let maxStepDy = 0;
    for (let i = 0; i < 16; i++) {
        const cur = walkSteps({ forward: 1, sprint: true }, 4, 16);
        maxStepDy = Math.max(maxStepDy, Math.abs(cur.pos[1] - prev.pos[1]));
        prev = cur;
    }
    check(maxStepDy < 0.25, "downtown avenue step delta-Y smooth: " + maxStepDy.toFixed(3));
});

await test("T1.3.2 curb and sidewalk transition toward business doorway", async () => {
    await teleportAndSettle(0, 3, 0, 0, 0);
    const biz = api.getNearestBuilding("business");
    check(Boolean(biz), "nearest business found");
    const door = getDoorwayPos(biz);
    const center = getBuildingCenter(biz) || door;
    let ox = door[0] - center[0];
    let oz = door[2] - center[2];
    const len = Math.hypot(ox, oz) || 1;
    ox /= len;
    oz /= len;
    // Start 10 m out in street direction and walk across curb/sidewalk toward doorway
    const st0 = await teleportAndSettle(door[0] + ox * 10, door[1] + 1, door[2] + oz * 10);
    walkSteps({ forward: 0 }, 10);
    const y0 = api.getState().pos[1];
    const st1 = walkToPoint([door[0] + ox * 1.2, door[1], door[2] + oz * 1.2], { tol: 0.9, maxSteps: 120 });
    check(Math.abs(st1.pos[1] - y0) <= 0.6, "curb/sidewalk climb bounded without falling/spiking");
    check(dist2D(st1.pos, door) < 3.0, "reached sidewalk outside business doorway");
});

await test("T1.3.3 suburban parcel grading around home", async () => {
    await teleportAndSettle(3500, 3, 3500);
    const home = api.getNearestBuilding("home");
    check(Boolean(home), "nearest suburban home found");
    const door = getDoorwayPos(home);
    const center = getBuildingCenter(home) || door;
    let ox = door[0] - center[0];
    let oz = door[2] - center[2];
    const len = Math.hypot(ox, oz) || 1;
    await teleportAndSettle(door[0] + (ox / len) * 6, door[1] + 1, door[2] + (oz / len) * 6);
    walkSteps({ forward: 0 }, 10);
    const yBefore = api.getState().pos[1];
    const st = walkToPoint([door[0] + (ox / len) * 1.2, door[1], door[2] + (oz / len) * 1.2], { tol: 0.9, maxSteps: 100 });
    check(Math.abs(st.pos[1] - yBefore) < 0.75, "suburban yard/parcel grading continuous");
});

await test("T1.3.4 downtown skyscraper plaza structural grounding", async () => {
    await teleportAndSettle(0, 3, 0);
    const sky = api.getNearestBuilding("skyscraper");
    check(Boolean(sky), "nearest skyscraper found");
    const door = getDoorwayPos(sky);
    const center = getBuildingCenter(sky) || door;
    let ox = door[0] - center[0];
    let oz = door[2] - center[2];
    const len = Math.hypot(ox, oz) || 1;
    const plazaPos = [door[0] + (ox / len) * 18, door[1] + 1.5, door[2] + (oz / len) * 18];
    await teleportAndSettle(plazaPos[0], plazaPos[1], plazaPos[2]);
    resolveYawToward(plazaPos, door);
    walkSteps({ forward: 0 }, 8);
    assertStructureClean(scene, "skyscraper plaza");
});

await test("T1.3.5 distant quadrant road elevation and visual consistency", async () => {
    for (const [x, z] of [[-4500, 4500], [4500, -4500]]) {
        await teleportAndSettle(x, null, z);
        walkSteps({ forward: 0 }, 10);
        const st = api.getState();
        check(Number.isFinite(st.pos[1]) && Math.abs(st.pos[1]) < 200, `valid elevation at (${x}, ${z}): ${st.pos[1]}`);
        assertDiagnoseClean(scene, `distant road (${x},${z})`);
    }
});

// ── Area 1.4: VoxelDAG Far-Horizon Ring (5 tests) ───────────────────────────

await test("T1.4.1 street-level VoxelDAG horizon ring stays in far distance", async () => {
    api.setMode("walk");
    const st = await teleportAndSettle(0, 2, 0);
    check(Boolean(st.lod) && Number.isFinite(st.lod.voxelMinDist), "lod.voxelMinDist exposed");
    check(st.lod.voxelMinDist >= 100, "voxelMinDist >= 100m at street level: " + st.lod.voxelMinDist);
});

await test("T1.4.2 zero close-up voxel block artifacts on downtown facade", async () => {
    await teleportAndSettle(0, 2, 0);
    const bld = api.getNearestBuilding("skyscraper") || api.getNearestBuilding("business");
    const door = getDoorwayPos(bld);
    const center = getBuildingCenter(bld) || door;
    let ox = door[0] - center[0];
    let oz = door[2] - center[2];
    const len = Math.hypot(ox, oz) || 1;
    const viewPos = [door[0] + (ox / len) * 15, door[1] + 2, door[2] + (oz / len) * 15];
    await teleportAndSettle(viewPos[0], viewPos[1], viewPos[2]);
    resolveYawToward(viewPos, door);
    assertDiagnoseClean(scene, "close-up facade 15m");
});

await test("T1.4.3 mid-tier meshFadeEnd and voxelMinDist handoff alignment", async () => {
    const st = await teleportAndSettle(0, 2, 0);
    check(st.lod.meshFadeEnd > 50, "meshFadeEnd > 50m: " + st.lod.meshFadeEnd);
    check(
        st.lod.voxelMinDist >= st.lod.meshFadeEnd * 0.65 && st.lod.voxelMinDist <= st.lod.meshFadeEnd * 1.5,
        `voxelMinDist (${st.lod.voxelMinDist}) aligns with meshFadeEnd (${st.lod.meshFadeEnd})`
    );
});

await test("T1.4.4 distant horizon skyline silhouette visible from 2 km out", async () => {
    await flyTo(2000, 25, 0, Math.PI * 0.5, -0.04);
    const m = bro.eye.measure();
    check(m.dynamicRange > 0.08, "horizon skyline yields structured contrast: " + m.dynamicRange.toFixed(3));
});

await test("T1.4.5 smooth 360-degree yaw sweep across horizon ring at 40m altitude", async () => {
    await flyTo(0, 40, 0, 0, -0.05);
    const motion = captureMotionFrames(tier(5, 8), () => {
        walkSteps({ yawDelta: 0.08 }, 2, 16);
    });
    eq(motion.popCount, 0, "zero horizon ring pop-in/out across yaw sweep");
});

// ── Area 1.5: Zero-Churn Instance Pools & Mid-Tier Parallax (5 tests) ────────

await test("T1.5.1 pre-warmed instance pools active after boot", async () => {
    api.setMode("walk");
    const st = await teleportAndSettle(0, 2, 0);
    check(Number.isFinite(st.poolDraws) && st.poolDraws > 0, "poolDraws > 0 at downtown: " + st.poolDraws);
    frames(10);
});

await test("T1.5.2 bounded poolDraws across 360-degree downtown pan", async () => {
    await teleportAndSettle(0, 2, 0);
    const samples = [];
    for (let i = 0; i < 8; i++) {
        const st = walkSteps({ yawDelta: Math.PI / 4 }, 3, 16);
        samples.push(st.poolDraws);
    }
    const minP = Math.min(...samples);
    const maxP = Math.max(...samples);
    check(minP > 0 && Number.isFinite(maxP), "all poolDraws samples valid");
    check(maxP <= Math.max(minP * 3.0, minP + 50), `poolDraws bounded across pan (min=${minP}, max=${maxP})`);
});

await test("T1.5.3 mid-tier parallax window clarity in day", async () => {
    api.setTimeMode("day");
    await flyTo(120, 25, 120, Math.atan2(120, 120), -0.05);
    assertDiagnoseClean(scene, "mid-tier parallax day");
});

await test("T1.5.4 mid-tier parallax window glow at night without bloom hotspots", async () => {
    api.setTimeMode("night");
    await flyTo(120, 25, 120, Math.atan2(120, 120), -0.05);
    assertDiagnoseClean(scene, "mid-tier parallax night");
    const m = bro.eye.measure();
    check(m.blownWhiteRatio < 0.08, "night window glow not clipping white: " + m.blownWhiteRatio.toFixed(3));
    api.setTimeMode("day");
});

await test("T1.5.5 distant 3 km teleport poolDraws steady-state recovery", async () => {
    api.setMode("walk");
    const before = (await teleportAndSettle(0, 2, 0)).poolDraws;
    const far = (await teleportAndSettle(3000, null, 3000)).poolDraws;
    const back = (await teleportAndSettle(0, 2, 0)).poolDraws;
    check(far > 0 && back > 0, `poolDraws active far (${far}) and back (${back})`);
    check(Math.abs(back - before) <= Math.max(before * 0.5, 20), `poolDraws returned to steady state (before=${before}, back=${back})`);
});

done("metropolis tier1 world");
