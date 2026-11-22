// Tier 3 Pairwise Cross-Feature Combination E2E tests (T3.1–T3.12: 12 tests).
// Covers Mode × Lighting × District × Building × Traffic/Car × Streaming interactions.
import { check, eq, test, done, frames, simUntil } from "/lib/kit/test.js";
import {
    waitReady,
    getScene,
    walkSteps,
    driveSteps,
    teleportAndSettle,
    flyTo,
    dist2D,
    getStairPos,
    resolveYawToward,
    walkToPoint,
    enterBuilding,
    assertDiagnoseClean,
    captureMotionFrames,
} from "./helpers.js";

const api = await waitReady();
const scene = getScene();

function getTopFloor(info, bld) {
    const floors = (info && info.floors) || (bld && bld.floors) || 1;
    const count = Array.isArray(floors) ? floors.length : Number(floors);
    return Math.max(0, (Number.isFinite(count) ? count : 1) - 1);
}

await test("T3.1 night downtown drive -> exit -> skyscraper top floor", async () => {
    api.setTimeMode("night");
    api.setMode("walk");
    await teleportAndSettle(0, 2, 0);
    const enteredCar = api.enterNearestCar();
    check(Boolean(enteredCar), "entered car in night downtown");
    const driven = driveSteps({ forward: 1, right: 0.1, brake: 0 }, 50, 16);
    check(driven.trafficCount > 0, "night traffic active while driving");
    driveSteps({ forward: 0, right: 0, brake: 1 }, 20, 16);
    api.exitCar();
    frames(3);

    const { bld, info } = await enterBuilding("skyscraper");
    const top = getTopFloor(info, bld);
    api.useElevator(top);
    const arrived = simUntil(() => api.getState().floorIndex === top, Math.max(15000, (top || 10) * 1000), 50);
    check(arrived, "arrived at night skyscraper topFloor=" + top);
    assertDiagnoseClean(scene, "night skyscraper top floor");
});

await test("T3.2 dusk flyover suburbs -> commercial -> downtown LOD pull-in", async () => {
    api.setTimeOfDay(18.5);
    const streetLod = (await flyTo(-3500, 10, -3500)).lod;
    const motion = captureMotionFrames(5, (i) => {
        const t = i / 4;
        api.teleport(-3500 * (1 - t), 150 + 350 * t, -3500 * (1 - t), 0.78, -0.35);
        frames(3);
    });
    const high = api.getState();
    eq(motion.popCount, 0, "zero frame pops during dusk flyover");
    check(high.lod.voxelMinDist < streetLod.voxelMinDist, "dusk flyover contracted voxelMinDist");
    assertDiagnoseClean(scene, "dusk flyover downtown");
});

await test("T3.3 day commercial drive in active traffic", async () => {
    api.setTimeMode("day");
    api.setMode("walk");
    await teleportAndSettle(1024, 3, 0);
    check(api.getState().trafficCount > 0, "commercial traffic active");
    const entered = api.enterNearestCar();
    check(Boolean(entered), "entered car in commercial district");
    const p0 = api.getState().pos.slice();
    driveSteps({ forward: 0.9, right: 0, brake: 0 }, 40, 16);
    driveSteps({ forward: 0.6, right: 0.6, brake: 0 }, 25, 16);
    const after = driveSteps({ forward: 0, right: 0, brake: 1 }, 25, 16);
    check(dist2D(p0, after.pos) > 5.0, "navigated commercial road in traffic");
    api.exitCar();
});

await test("T3.4 skyscraper multi-floor stairs + elevator + bounded streaming", async () => {
    api.setTimeMode("day");
    await teleportAndSettle(0, 3, 0);
    const { bld, info } = await enterBuilding("skyscraper");
    const top = getTopFloor(info, bld);
    const baselineDraws = api.getState().poolDraws;

    const stairPos = getStairPos(info) || getStairPos(bld);
    check(Boolean(stairPos), "stair coordinates exposed for skyscraper");
    walkToPoint(stairPos, { tol: 1.0, maxSteps: 160 });
    const climbed = simUntil(() => {
        if (api.getState().floorIndex >= 1) return true;
        walkSteps({ forward: 1 }, 4, 16);
        return api.getState().floorIndex >= 1;
    }, 8000, 16);
    check(climbed && api.getState().floorIndex >= 1, "ascended skyscraper stairs to floor >= 1");

    const elevTimeout = Math.max(15000, (top || 10) * 1000);
    const mid = Math.min(top, 5);
    api.useElevator(mid);
    const arrivedMid = simUntil(() => api.getState().floorIndex === mid, elevTimeout, 50);
    check(arrivedMid, "elevator arrived at mid floor " + mid);
    eq(api.getState().floorIndex, mid, "floorIndex matches mid floor " + mid);
    check(api.getState().activeInteriors <= 8, "activeInteriors bounded at floor " + mid);

    api.useElevator(top);
    const arrivedTop = simUntil(() => api.getState().floorIndex === top, elevTimeout, 50);
    check(arrivedTop, "elevator arrived at top floor " + top);
    const topState = api.getState();
    eq(topState.floorIndex, top, "floorIndex matches top floor " + top);
    check(topState.poolDraws <= Math.max(baselineDraws * 2.5, baselineDraws + 60), "poolDraws bounded at top floor");

    api.useElevator(0);
    const arrivedLobby = simUntil(() => api.getState().floorIndex === 0, elevTimeout, 50);
    check(arrivedLobby, "elevator arrived back at lobby floor 0");
    eq(api.getState().floorIndex, 0, "returned to lobby floor 0");
});

await test("T3.5 walk <-> fly mode switching across dusk home and business", async () => {
    api.setTimeMode("dusk");
    await teleportAndSettle(3500, 3, 3500);
    const home = await enterBuilding("home");
    check(home.state.buildingId != null, "inside dusk home");

    await flyTo(home.approach[0], 200, home.approach[2], 0, -0.35);
    eq(api.getMode(), "fly", "switched to fly at 200m");

    await teleportAndSettle(0, 3, 0);
    const biz = await enterBuilding("business");
    eq(api.getMode(), "walk", "switched back to walk for business");
    check(biz.state.buildingId !== home.state.buildingId, "entered distinct business building");
});

await test("T3.6 full walk -> drive -> fly -> walk mode ring in suburb", async () => {
    api.setTimeMode("day");
    await teleportAndSettle(3500, 3, 3500);
    const { approach } = await enterBuilding("home");
    walkToPoint(approach, { tol: 1.0, maxSteps: 140, stopWhen: (s) => s.buildingId === null });
    eq(api.getState().buildingId, null, "exited suburban home to street");

    check(Boolean(api.enterNearestCar()), "entered suburban car");
    driveSteps({ forward: 1, right: 0, brake: 0 }, 35, 16);
    api.setMode("fly");
    frames(2);
    eq(api.getState().inCar, false, "fly mode released car");
    await flyTo(2000, 120, 2000);
    api.setMode("walk");
    await teleportAndSettle(0, 3, 0);
    eq(api.getMode(), "walk", "completed full walk->drive->fly->walk ring");
});

await test("T3.7 night suburban home interior -> street -> car headlights", async () => {
    api.setTimeMode("night");
    await teleportAndSettle(3500, 3, 3500);
    const { approach } = await enterBuilding("home");
    assertDiagnoseClean(scene, "night suburban home interior");

    walkToPoint(approach, { tol: 1.0, maxSteps: 140, stopWhen: (s) => s.buildingId === null });
    check(Boolean(api.enterNearestCar()), "entered suburban car at night");
    driveSteps({ forward: 0.8, right: 0, brake: 0 }, 30, 16);
    assertDiagnoseClean(scene, "night suburban drive");
    api.exitCar();
});

await test("T3.8 dusk business visit at distant quadrant (4000, -4000)", async () => {
    api.setTimeMode("dusk");
    await teleportAndSettle(4000, 3, -4000);
    const { state } = await enterBuilding("business");
    check(state.buildingId != null, "entered business in distant quadrant");
    const motion = captureMotionFrames(4, () => frames(2));
    eq(motion.popCount, 0, "zero precision pops inside distant business");
    assertDiagnoseClean(scene, "distant dusk business");
});

await test("T3.9 day park-to-downtown street grading and traffic continuity", async () => {
    api.setTimeMode("day");
    api.setMode("walk");
    let prev = await teleportAndSettle(270, 3, 12);
    eq(prev.district, "park", "spawned in central park district");
    resolveYawToward([270, prev.pos[1], 12], [200, prev.pos[1], 12]);
    prev = walkSteps({ forward: 0 }, 4);
    let maxDy = 0;
    for (let i = 0; i < 40; i++) {
        const cur = walkSteps({ forward: 1, sprint: true }, 4, 16);
        maxDy = Math.max(maxDy, Math.abs(cur.pos[1] - prev.pos[1]));
        prev = cur;
    }
    eq(prev.district, "downtown", "traversed from park across x=256 into downtown");
    check(maxDy < 0.4, "park/street transition grading smooth: maxDy=" + maxDy.toFixed(3));
    check(prev.trafficCount > 0, "traffic active along downtown avenue");
});

await test("T3.10 night flyover 800m dive to street walk restores street LOD", async () => {
    api.setTimeMode("night");
    const high = await flyTo(0, 800, 0, 0, -0.5);
    api.setMode("walk");
    const low = await teleportAndSettle(0, 2, 0);
    check(
        low.lod.voxelMinDist > high.lod.voxelMinDist,
        `street LOD expanded back out (${high.lod.voxelMinDist} -> ${low.lod.voxelMinDist})`
    );
    assertDiagnoseClean(scene, "night street after 800m dive");
});

await test("T3.11 dusk downtown drive past mid-tier parallax skyscrapers", async () => {
    api.setTimeOfDay(18.25);
    api.setMode("walk");
    await teleportAndSettle(0, 2, 0);
    check(Boolean(api.enterNearestCar()), "entered car for dusk downtown canyon drive");
    driveSteps({ forward: 0.9, right: 0, brake: 0 }, 35, 16);
    assertDiagnoseClean(scene, "dusk downtown drive parallax");
    api.exitCar();
});

await test("T3.12 sequential home vs business vs skyscraper interior isolation", async () => {
    api.setTimeMode("day");
    await teleportAndSettle(3500, 3, 3500);
    const h = await enterBuilding("home");
    await teleportAndSettle(1024, 3, 0);
    const b = await enterBuilding("business");
    await teleportAndSettle(0, 3, 0);
    const s = await enterBuilding("skyscraper");

    check(h.state.buildingId !== b.state.buildingId, "home and business have distinct buildingIds");
    check(b.state.buildingId !== s.state.buildingId, "business and skyscraper have distinct buildingIds");
    check(s.state.activeInteriors <= 8, "previous distant interiors unloaded cleanly: " + s.state.activeInteriors);
});

done("metropolis tier3 pairwise");
