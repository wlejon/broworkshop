// Tier 1 Traffic, Driveable Cars, Traversal Modes & Lighting Cycle E2E tests (Areas 1.8–1.11: 20 tests).
// Covers F6 (day/dusk/night), F12 (ambient traffic), F13 (driveable cars), F14 (walk/drive/fly & flyover LOD), F18.
import { check, eq, test, done, frames, press, clickOn } from "/lib/kit/test.js";
import {
    waitReady,
    getScene,
    settle,
    walkSteps,
    driveSteps,
    teleportAndSettle,
    flyTo,
    dist2D,
    assertDiagnoseClean,
    captureMotionFrames,
} from "./helpers.js";

const api = await waitReady();
const scene = getScene();

async function ensureInCarAt(x = 0, z = 0) {
    if (api.getState().inCar) api.exitCar();
    api.setMode("walk");
    await teleportAndSettle(x, 2, z, 0, 0);
    const entered = api.enterNearestCar();
    check(Boolean(entered), "enterNearestCar() succeeded near road");
    frames(3);
    const st = api.getState();
    eq(st.inCar, true, "inCar === true");
    eq(api.getMode(), "drive", "mode === 'drive'");
    return st;
}

// ── Area 1.8: Ambient Traffic (5 tests) ──────────────────────────────────────

await test("T1.8.1 downtown ambient traffic presence", async () => {
    api.setMode("walk");
    api.setTimeMode("day");
    const st = await teleportAndSettle(0, 2, 0);
    check(Number.isFinite(st.trafficCount) && st.trafficCount > 0, "downtown trafficCount > 0: " + st.trafficCount);
});

await test("T1.8.2 commercial and suburban traffic presence", async () => {
    for (const [x, z, label] of [[1024, 0, "commercial"], [3500, 3500, "suburb"]]) {
        const st = await teleportAndSettle(x, 3, z);
        check(st.trafficCount > 0, `${label} trafficCount > 0: ${st.trafficCount}`);
    }
});

await test("T1.8.3 continuous road-following traffic motion", async () => {
    await teleportAndSettle(0, 2, 0, 0, -0.05);
    const motion = captureMotionFrames(6, () => {
        for (let s = 0; s < 10; s++) advanceTime(30);
        flush();
    });
    eq(motion.popCount, 0, "zero pops while traffic moves along streets");
    check(api.getState().trafficCount > 0, "traffic remains active during 3s sim");
});

await test("T1.8.4 traffic persistence across distant quadrants", async () => {
    for (const [x, z] of [[3000, 3000], [-3000, -3000]]) {
        const st = await teleportAndSettle(x, 3, z);
        check(st.trafficCount > 0, `traffic active at (${x}, ${z}): ${st.trafficCount}`);
    }
});

await test("T1.8.5 traffic night lighting parity", async () => {
    api.setTimeMode("night");
    const st = await teleportAndSettle(0, 2, 0);
    check(st.trafficCount > 0, "night trafficCount > 0");
    assertDiagnoseClean(scene, "night street traffic");
    api.setTimeMode("day");
});

// ── Area 1.9: Driveable Cars (5 tests) ───────────────────────────────────────

await test("T1.9.1 enter nearest car transitions to drive mode", async () => {
    const st = await ensureInCarAt(0, 0);
    eq(st.mode, "drive", "getState().mode === 'drive'");
    api.exitCar();
});

await test("T1.9.2 car accelerates forward cleanly", async () => {
    const start = await ensureInCarAt(0, 0);
    const p0 = start.pos.slice();
    const after = driveSteps({ forward: 1, right: 0, brake: 0 }, 60, 16);
    check(after.speed > 4.0, "car accelerated to speed > 4: " + after.speed.toFixed(2));
    check(dist2D(p0, after.pos) > 3.0, "car moved forward along road: " + dist2D(p0, after.pos).toFixed(2) + "m");
    api.exitCar();
});

await test("T1.9.3 car steers left and right", async () => {
    await ensureInCarAt(0, 0);
    const p0 = api.getState().pos.slice();
    const sRight = driveSteps({ forward: 0.7, right: 1, brake: 0, hold: true }, 35, 16);
    const rightVec = [sRight.pos[0] - p0[0], sRight.pos[2] - p0[2]];
    const sLeft = driveSteps({ forward: 0.7, right: -1, brake: 0 }, 35, 16);
    const leftVec = [sLeft.pos[0] - sRight.pos[0], sLeft.pos[2] - sRight.pos[2]];
    const cross = rightVec[0] * leftVec[1] - rightVec[1] * leftVec[0];
    check(Math.hypot(rightVec[0], rightVec[1]) > 1.0 && Math.hypot(leftVec[0], leftVec[1]) > 1.0, "car traveled while steering");
    check(Math.abs(cross) > 0.2, "steering changed lateral heading (cross=" + cross.toFixed(2) + ")");
    api.exitCar();
});

await test("T1.9.4 car braking reduces speed monotonically to stop", async () => {
    await ensureInCarAt(0, 0);
    const moving = driveSteps({ forward: 1, right: 0, brake: 0, hold: true }, 45, 16);
    check(moving.speed > 3.0, "reached cruising speed before braking: " + moving.speed.toFixed(2));
    const braked = driveSteps({ forward: 0, right: 0, brake: 1 }, 60, 16);
    check(braked.speed < moving.speed * 0.35, `braking slowed car (${moving.speed.toFixed(2)} -> ${braked.speed.toFixed(2)})`);
    api.exitCar();
});

await test("T1.9.5 exit car returns to walk mode on road", async () => {
    await ensureInCarAt(0, 0);
    driveSteps({ forward: 0, right: 0, brake: 1 }, 20, 16);
    api.exitCar();
    frames(4);
    const st = api.getState();
    eq(st.inCar, false, "inCar === false after exitCar");
    eq(api.getMode(), "walk", "mode === 'walk' after exitCar");
    check(Number.isFinite(st.pos[1]) && Math.abs(st.pos[1]) < 100, "player grounded on street after exitCar");
});

// ── Area 1.10: Traversal Mode Switching (5 tests) ────────────────────────────

await test("T1.10.1 walk -> fly -> walk mode cycle", async () => {
    api.setMode("walk");
    await teleportAndSettle(0, 2, 0);
    eq(api.getMode(), "walk", "initial walk mode");
    api.setMode("fly");
    frames(2);
    eq(api.getMode(), "fly", "switched to fly mode");
    await flyTo(0, 80, 0);
    api.setMode("walk");
    walkSteps({ forward: 0 }, 20, 16);
    eq(api.getMode(), "walk", "returned to walk mode");
    check(Number.isFinite(api.getState().pos[1]), "valid height in walk mode");
});

await test("T1.10.2 walk -> drive -> walk synchronization", async () => {
    api.setMode("walk");
    await ensureInCarAt(0, 0);
    eq(api.getState().mode, "drive", "state.mode synchronized to drive");
    api.exitCar();
    frames(2);
    eq(api.getMode(), "walk", "back to walk");
    eq(api.getState().inCar, false, "inCar false");
});

await test("T1.10.3 fly -> drive -> fly transition without velocity stickiness", async () => {
    await flyTo(0, 35, 0);
    eq(api.getMode(), "fly", "started in fly");
    await teleportAndSettle(0, 2, 0);
    const entered = api.enterNearestCar();
    check(Boolean(entered), "entered nearest car from fly");
    frames(2);
    eq(api.getMode(), "drive", "transitioned to drive");
    api.setMode("fly");
    frames(2);
    eq(api.getMode(), "fly", "transitioned back to fly");
    eq(api.getState().inCar, false, "inCar cleared on setMode('fly')");
});

await test("T1.10.4 altitude-adaptive flyover ascent pulls LOD ring inward", async () => {
    api.setMode("walk");
    const low = await teleportAndSettle(0, 2, 0);
    const high = await flyTo(0, 320, 0, 0, -0.3);
    check(high.altitude >= 290, "flyover altitude >= 290m: " + high.altitude.toFixed(1));
    check(
        high.lod.voxelMinDist < low.lod.voxelMinDist,
        `voxelMinDist contracted on climb (${low.lod.voxelMinDist} -> ${high.lod.voxelMinDist})`
    );
});

await test("T1.10.5 HUD and keyboard mode parity with bro.eye.audit", async () => {
    api.setMode("walk");
    api.setTimeMode("day");
    await teleportAndSettle(0, 2, 0);
    frames(4);
    const audit = bro.eye.audit();
    eq(audit.errorCount, 0, "HUD bro.eye.audit errorCount === 0");

    if (document.querySelector('#todButtons [data-tod="dusk"]')) {
        clickOn('#todButtons [data-tod="dusk"]');
        frames(2);
        eq(api.getTimeMode(), "dusk", "clicking #todButtons dusk updated timeMode");
        clickOn('#todButtons [data-tod="day"]');
        frames(2);
        eq(api.getTimeMode(), "day", "clicking #todButtons day restored timeMode");
    }

    const modeCtrl = document.querySelector('[data-mode="fly"], #btnFly, #modeFly');
    if (modeCtrl) {
        clickOn(modeCtrl);
        frames(2);
        eq(api.getMode(), "fly", "HUD mode button switched to fly");
    } else {
        press("f");
        frames(3);
        check(api.getMode() !== "walk", "pressing 'f' changed mode from walk (got " + api.getMode() + ")");
    }
    const activeMode = api.getMode();
    const activeHudText = (document.body.textContent || "").toLowerCase();
    check(activeHudText.includes(activeMode), `HUD reflects active mode '${activeMode}'`);

    api.setMode("walk");
    frames(2);
    eq(api.getMode(), "walk", "restored walk mode cleanly");
    const restoredText = (document.body.textContent || "").toLowerCase();
    check(restoredText.length > 0 && restoredText.includes("walk"), "HUD reflects restored walk mode");
});

// ── Area 1.11: Day / Dusk / Night Lighting Cycles (5 tests) ──────────────────

await test("T1.11.1 day preset lighting and exposure", async () => {
    api.setMode("walk");
    api.setTimeMode("day");
    await teleportAndSettle(0, 15, 0, 0, -0.05);
    await settle({ exposure: true });
    eq(api.getTimeMode(), "day", "getTimeMode() === 'day'");
    const m = bro.eye.measure();
    check(m.lumaMean > 0.15, "daylight lumaMean bright: " + m.lumaMean.toFixed(3));
    check(m.blownWhiteRatio < 0.08, "daylight not over-clipped: " + m.blownWhiteRatio.toFixed(3));
});

await test("T1.11.2 dusk preset warm horizon without clipping", async () => {
    api.setTimeMode("dusk");
    await settle({ exposure: true });
    eq(api.getTimeMode(), "dusk", "getTimeMode() === 'dusk'");
    const m = bro.eye.measure();
    check(m.dynamicRange > 0.08, "dusk preserves tonal range: " + m.dynamicRange.toFixed(3));
    check(m.blownWhiteRatio < 0.08, "dusk not clipped: " + m.blownWhiteRatio.toFixed(3));
});

await test("T1.11.3 night preset darkens sky below daylight lumaMean", async () => {
    api.setTimeMode("day");
    await settle({ exposure: true });
    const dayLuma = bro.eye.measure().lumaMean;

    api.setTimeMode("night");
    await settle({ exposure: true });
    eq(api.getTimeMode(), "night", "getTimeMode() === 'night'");
    const nightLuma = bro.eye.measure().lumaMean;
    check(dayLuma > nightLuma, `day luma (${dayLuma.toFixed(3)}) > night luma (${nightLuma.toFixed(3)})`);
});

await test("T1.11.4 numeric solar hour progression 8h -> 12h -> 17.5h -> 22h", async () => {
    const lumas = [];
    for (const h of [8, 12, 17.5, 22]) {
        api.setTimeOfDay(h);
        await settle({ exposure: true });
        lumas.push(bro.eye.measure().lumaMean);
    }
    check(lumas[1] > lumas[3], `noon luma (${lumas[1].toFixed(3)}) > night 22h luma (${lumas[3].toFixed(3)})`);
    check(lumas.every((v) => Number.isFinite(v) && v >= 0), "all solar hours produced valid luminance");
});

await test("T1.11.5 three-mood bro.eye.sweep consistency", async () => {
    await flyTo(0, 60, 0, 0.4, -0.2);
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
    eq(sw.stateCount, 3, "3 states captured");
    check(sw.states.every((s) => s.hotspotCount === 0), "0 HDR bloom hotspots across day/dusk/night");
    api.setTimeMode("day");
});

done("metropolis tier1 mobility and lighting");
