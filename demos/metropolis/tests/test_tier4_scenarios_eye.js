// Tier 4 Real-World Showcase Scenarios, HUD Audit, Sweep & 18-Cell bro.eye Quality Gate.
// Covers T4.1.1–T4.1.3, HUD bro.eye.audit(), bro.eye.sweep, and 18-cell structure + diagnose.
import { check, eq, test, done, frames, simUntil, shot, tier } from "/lib/kit/test.js";
import {
    waitReady,
    getScene,
    settle,
    walkSteps,
    driveSteps,
    teleportAndSettle,
    flyTo,
    getStairPos,
    walkToPoint,
    enterBuilding,
    buildInteriorStructureOpts,
    assertDiagnoseClean,
    assertStructureClean,
    captureMotionFrames,
} from "./helpers.js";

const api = await waitReady();
const scene = getScene();

function getTopFloor(info, bld) {
    const floors = (info && info.floors) || (bld && bld.floors) || 1;
    const count = Array.isArray(floors) ? floors.length : Number(floors);
    return Math.max(0, (Number.isFinite(count) ? count : 1) - 1);
}

// ── 4.1 Real-World End-to-End Showcase Scenarios ─────────────────────────────

await test("T4.1.1 suburban morning commute to downtown skyscraper top floor", async () => {
    api.setTimeOfDay(7.5);
    api.setMode("walk");
    await teleportAndSettle(-3800, 3, -3800);

    // Visit suburban home and exit back to sidewalk
    const home = await enterBuilding("home");
    walkSteps({ forward: 1 }, 12, 16);
    walkToPoint(home.approach, { tol: 1.0, maxSteps: 140, stopWhen: (s) => s.buildingId === null });
    eq(api.getState().buildingId, null, "exited suburban home");

    // Drive car along suburban street
    check(Boolean(api.enterNearestCar()), "entered suburban car for commute");
    const drove = driveSteps({ forward: 1, right: 0, brake: 0 }, 45, 16);
    check(drove.speed > 3.0, "commuted by car");
    driveSteps({ forward: 0, right: 0, brake: 1 }, 20, 16);
    api.exitCar();

    // Arrive downtown and enter skyscraper -> stairs to floor 1 -> elevator to topFloor
    await teleportAndSettle(0, 2, 0);
    const sky = await enterBuilding("skyscraper");
    const stairPos = getStairPos(sky.info) || getStairPos(sky.bld);
    if (stairPos) {
        walkToPoint(stairPos, { tol: 1.0, maxSteps: 120 });
        simUntil(() => {
            walkSteps({ forward: 1 }, 4, 16);
            return api.getState().floorIndex >= 1;
        }, 6000, 16);
    }

    const top = getTopFloor(sky.info, sky.bld);
    api.useElevator(top);
    check(simUntil(() => api.getState().floorIndex === top, Math.max(15000, (top || 10) * 1000), 50), "reached skyscraper topFloor=" + top);
    const curY = api.getState().pos[1];
    walkToPoint([sky.insideTarget[0], curY, sky.insideTarget[2]], { tol: 1.0, maxSteps: 40 });
    eq(api.getState().floorIndex, top, "remained at topFloor during top-floor navigation");
});

await test("T4.1.2 evening city flyover tour across 120 km² at dusk", async () => {
    api.setMode("fly");
    const waypoints = [
        [-4500, 120, -4500, 18.2],
        [0, 450, 0, 18.5],
        [4500, 250, 4500, 18.8],
        [-4500, 600, 4500, 19.2],
    ];
    let prevLod = null;
    for (const [x, y, z, hour] of waypoints) {
        api.setTimeOfDay(hour);
        const st = await flyTo(x, y, z, 0.6, -0.25);
        check(st.lod.voxelMinDist > 0 && Number.isFinite(st.lod.voxelMinDist), `valid flyover LOD at (${x},${y},${z})`);
        if (y >= 450 && prevLod) {
            check(st.lod.voxelMinDist <= prevLod.voxelMinDist * 1.1, "altitude LOD contracted over downtown");
        }
        prevLod = st.lod;
    }
    const motion = captureMotionFrames(4, () => {
        walkSteps({ forward: 1, yawDelta: 0.05 }, 3, 16);
    });
    eq(motion.popCount, 0, "zero frame pops on dusk flyover tour");
});

await test("T4.1.3 downtown night cruise and commercial business visit", async () => {
    api.setTimeMode("night");
    api.setMode("walk");
    await teleportAndSettle(128, 2, 128);
    check(Boolean(api.enterNearestCar()), "entered car for downtown night cruise");
    driveSteps({ forward: 0.9, right: 0, brake: 0 }, 35, 16);
    driveSteps({ forward: 0.6, right: 0.7, brake: 0 }, 20, 16);
    const stopped = driveSteps({ forward: 0, right: 0, brake: 1 }, 25, 16);
    check(stopped.trafficCount > 0, "night traffic active during cruise");
    api.exitCar();

    const biz = await enterBuilding("business");
    check(biz.state.buildingId != null, "entered business after night drive");
    walkSteps({ forward: 1 }, 15, 16);
    walkToPoint(biz.approach, { tol: 1.0, maxSteps: 140, stopWhen: (s) => s.buildingId === null });
    eq(api.getState().buildingId, null, "exited business cleanly back to night street");
});

// ── 4.2 HUD Audit, Sweep & 18-Cell bro.eye Quality Gate ──────────────────────

await test("T4.2.1 HUD bro.eye.audit across walk, drive, fly and lighting modes", async () => {
    const combos = [
        ["walk", "day"],
        ["drive", "dusk"],
        ["fly", "night"],
    ];
    for (const [mode, light] of combos) {
        api.setTimeMode(light);
        if (mode === "drive") {
            api.setMode("walk");
            await teleportAndSettle(0, 2, 0);
            api.enterNearestCar();
        } else if (mode === "fly") {
            if (api.getState().inCar) api.exitCar();
            await flyTo(0, 120, 0, 0, -0.25);
        } else {
            if (api.getState().inCar) api.exitCar();
            api.setMode("walk");
            await teleportAndSettle(0, 2, 0);
        }
        frames(4);
        const audit = bro.eye.audit();
        eq(audit.errorCount, 0, `HUD audit errorCount === 0 (${mode}/${light})`);
        eq(audit.warningCount, 0, `HUD audit warningCount === 0 (${mode}/${light})`);
        check(audit.score >= 90, `HUD audit score >= 90 (${mode}/${light}): ${audit.score}`);
    }
    if (api.getState().inCar) api.exitCar();
    api.setMode("walk");
    api.setTimeMode("day");
});

await test("T4.2.2 three-mood bro.eye.sweep downtown overlook", async () => {
    await flyTo(0, 80, 0, 0.5, -0.2);
    const sw = bro.eye.sweep(scene, {
        states: [
            { label: "Day", apply: () => { api.setTimeMode("day"); frames(4); } },
            { label: "Dusk", apply: () => { api.setTimeMode("dusk"); frames(4); } },
            { label: "Night", apply: () => { api.setTimeMode("night"); frames(4); } },
        ],
        sheetWidth: 768,
        sheetHeight: 432,
    });
    eq(sw.ok, true, "3-mood sweep ok === true");
    check(sw.states.every((s) => s.hotspotCount === 0), "zero bloom hotspots in 3-mood sweep");
    api.setTimeMode("day");
});

await test("T4.2.3 18-cell bro.eye.structure and bro.eye.diagnose matrix (6 viewpoints x 3 lighting)", async () => {
    const lights = ["day", "dusk", "night"];
    let translucentDetectedCells = 0;
    let cellsChecked = 0;

    for (const light of lights) {
        api.setTimeMode(light);

        // 1. street_downtown
        if (api.getState().inCar) api.exitCar();
        api.setMode("walk");
        await teleportAndSettle(0, 2, 0, 0.25, -0.02);
        const d1 = assertDiagnoseClean(scene, `street_downtown/${light}`, { expectTranslucent: true });
        if ((d1.meshes || []).some((m) => m.translucent)) translucentDetectedCells++;
        assertStructureClean(scene, `street_downtown/${light}`);
        cellsChecked++;

        // 2. street_suburb
        await teleportAndSettle(3500, 3, 3500, 0.2, -0.02);
        const d2 = assertDiagnoseClean(scene, `street_suburb/${light}`);
        if ((d2.meshes || []).some((m) => m.translucent)) translucentDetectedCells++;
        assertStructureClean(scene, `street_suburb/${light}`);
        cellsChecked++;

        // 3. interior_home
        const home = await enterBuilding("home");
        const d3 = assertDiagnoseClean(scene, `interior_home/${light}`);
        if ((d3.meshes || []).some((m) => m.translucent)) translucentDetectedCells++;
        assertStructureClean(scene, `interior_home/${light}`, buildInteriorStructureOpts(home));
        cellsChecked++;

        // 4. interior_business
        await teleportAndSettle(0, 3, 0);
        const biz = await enterBuilding("business");
        const d4 = assertDiagnoseClean(scene, `interior_business/${light}`, { expectTranslucent: true });
        if ((d4.meshes || []).some((m) => m.translucent)) translucentDetectedCells++;
        assertStructureClean(scene, `interior_business/${light}`, buildInteriorStructureOpts(biz));
        cellsChecked++;

        // 5. interior_skyscraper (lobby floor 0 AND upper floor >= 3)
        await teleportAndSettle(0, 3, 0);
        const sky = await enterBuilding("skyscraper");
        const d5a = assertDiagnoseClean(scene, `interior_skyscraper_lobby/${light}`, { expectTranslucent: true });
        if ((d5a.meshes || []).some((m) => m.translucent)) translucentDetectedCells++;
        assertStructureClean(scene, `interior_skyscraper_lobby/${light}`, buildInteriorStructureOpts(sky, sky.state));
        const top = getTopFloor(sky.info, sky.bld);
        const upperTarget = Math.min(top, Math.max(1, 3));
        api.useElevator(upperTarget);
        simUntil(() => api.getState().floorIndex === upperTarget, Math.max(15000, (top || 10) * 1000), 50);
        const up = api.getState();
        const d5b = assertDiagnoseClean(scene, `interior_skyscraper_upper/${light}`, { expectTranslucent: true });
        if ((d5b.meshes || []).some((m) => m.translucent)) translucentDetectedCells++;
        assertStructureClean(scene, `interior_skyscraper_upper/${light}`, buildInteriorStructureOpts(sky, up));
        cellsChecked++;

        // 6. driving_and_flyover (drive street + flyover 250 m)
        api.setMode("walk");
        await teleportAndSettle(0, 2, 0);
        check(Boolean(api.enterNearestCar()), `entered car for driving/${light}`);
        driveSteps({ forward: 0.8, right: 0, brake: 0 }, 15, 16);
        const d6a = assertDiagnoseClean(scene, `driving/${light}`, { expectTranslucent: true });
        if ((d6a.meshes || []).some((m) => m.translucent)) translucentDetectedCells++;
        assertStructureClean(scene, `driving/${light}`);
        api.exitCar();

        await flyTo(0, 250, 0, 0.4, -0.35);
        const d6b = assertDiagnoseClean(scene, `flyover_250m/${light}`);
        if ((d6b.meshes || []).some((m) => m.translucent)) translucentDetectedCells++;
        assertStructureClean(scene, `flyover_250m/${light}`, { nearRadius: 400 });
        cellsChecked++;
    }

    eq(cellsChecked, 18, "all 18 viewpoint x lighting cells checked");
    check(
        translucentDetectedCells >= 15,
        "id_translucent active across glazed skyscraper/business/street/vehicle views (cells=" + translucentDetectedCells + ")"
    );
    shot("matrix_complete");
    api.setMode("walk");
    api.setTimeMode("day");
});

done("metropolis tier4 scenarios and eye gate");
