// Tier 2 Boundary & Corner Cases: Vehicles, Solar Horizon Angles & Flyover Altitudes (Areas 2.5–2.7: 19 tests).
// Covers F4, F6, F8, F12, F13, F14.
import { check, eq, test, done, frames } from "/lib/kit/test.js";
import {
    waitReady,
    getScene,
    settle,
    driveSteps,
    teleportAndSettle,
    flyTo,
    dist2D,
    getDoorwayPos,
    getBuildingCenter,
    assertDiagnoseClean,
} from "./helpers.js";

const api = await waitReady();
const scene = getScene();

async function enterCarOnStreet(x = 0, z = 0) {
    if (api.getState().inCar) api.exitCar();
    api.setMode("walk");
    await teleportAndSettle(x, 2, z, 0, 0);
    const ok = api.enterNearestCar();
    check(Boolean(ok), "entered nearest car");
    frames(3);
    return api.getState();
}

// ── Area 2.5: Vehicle Collision & Speed Boundaries (6 tests) ─────────────────

await test("T2.5.1 vehicle zero-speed idle stability", async () => {
    const s0 = await enterCarOnStreet(0, 0);
    const p0 = s0.pos.slice();
    const s1 = driveSteps({ forward: 0, right: 0, brake: 0 }, 30, 16);
    check(Math.abs(s1.speed) <= 0.15, "idle speed near zero: " + s1.speed.toFixed(3));
    check(dist2D(p0, s1.pos) < 0.25, "no phantom idle drift");
    api.exitCar();
});

await test("T2.5.2 vehicle reverse gear boundary", async () => {
    const s0 = await enterCarOnStreet(0, 0);
    const p0 = s0.pos.slice();
    const rev = driveSteps({ forward: -1, right: 0, brake: 0 }, 45, 16);
    check(dist2D(p0, rev.pos) > 0.5, "car moved in reverse");
    check(Number.isFinite(rev.speed) && Math.abs(rev.speed) < 60, "reverse speed bounded: " + rev.speed.toFixed(2));
    api.exitCar();
});

await test("T2.5.3 vehicle max speed saturation stays finite and controllable", async () => {
    await enterCarOnStreet(0, 0);
    const s1 = driveSteps({ forward: 1, right: 0, brake: 0, hold: true }, 120, 16);
    const s2 = driveSteps({ forward: 1, right: 0, brake: 0 }, 80, 16);
    check(Number.isFinite(s2.speed) && s2.speed > 5 && s2.speed < 120, "max speed finite & bounded: " + s2.speed.toFixed(2));
    check(Math.abs(s2.speed - s1.speed) < 15, `speed plateaus near max (${s1.speed.toFixed(1)} -> ${s2.speed.toFixed(1)})`);
    api.exitCar();
});

await test("T2.5.4 vehicle collision against building exterior blocks penetration", async () => {
    await teleportAndSettle(0, 3, 0);
    const biz = api.getNearestBuilding("business");
    const door = getDoorwayPos(biz);
    const center = getBuildingCenter(biz) || door;
    let ox = door[0] - center[0];
    let oz = door[2] - center[2];
    const len = Math.hypot(ox, oz) || 1;
    ox /= len;
    oz /= len;
    const s0 = await enterCarOnStreet(door[0] + ox * 14, door[2] + oz * 14);
    const target = [center[0], door[1], center[2]];
    const startDist = dist2D(s0.pos, target);
    const wallHalf = Math.max(1.5, Math.min(biz.width ?? 8, biz.depth ?? 8) * 0.5);

    let turnDir = 1;
    let steerSign = 1;
    let lastDot = null;
    let bestDot = null;
    let minDist = startDist;
    let stalledCount = 0;

    for (let k = 0; k < 85; k++) {
        const p0 = api.getState().pos.slice();
        const s1 = driveSteps({ forward: 0.45, right: 0, brake: 0, hold: true }, 2, 16);
        check(s1.pos.every(Number.isFinite), "car pos finite during building approach");
        eq(s1.buildingId, null, "car never enters building interior footprint");
        const d1 = dist2D(s1.pos, target);
        if (d1 < minDist) minDist = d1;

        const fx = s1.pos[0] - p0[0];
        const fz = s1.pos[2] - p0[2];
        const fLen = Math.hypot(fx, fz);
        if (fLen > 0.015 && d1 > 0.5) {
            stalledCount = 0;
            const ux = fx / fLen;
            const uz = fz / fLen;
            const tx = (target[0] - s1.pos[0]) / d1;
            const tz = (target[2] - s1.pos[2]) / d1;
            const dot = Math.max(-1, Math.min(1, ux * tx + uz * tz));
            const cross = ux * tz - uz * tx;
            if (lastDot !== null && lastDot < 0 && dot >= 0) {
                bestDot = dot;
            }
            if (bestDot === null || dot > bestDot) {
                bestDot = dot;
            }
            if (dot < bestDot - 0.03) {
                if (lastDot !== null && lastDot >= 0) steerSign = -steerSign;
                else turnDir = -turnDir;
                bestDot = dot;
            }
            lastDot = dot;
            let right;
            if (dot < 0) {
                right = turnDir;
            } else {
                const angle = Math.atan2(cross, dot);
                right = Math.max(-1, Math.min(1, steerSign * angle * 1.4));
            }
            const fwd = dot >= 0.88 ? 0.95 : 0.35;
            const s2 = driveSteps({ forward: fwd, right, brake: 0, hold: true }, 6, 16);
            check(s2.pos.every(Number.isFinite), "car pos finite during building approach");
            eq(s2.buildingId, null, "car never enters building interior footprint");
            const d2 = dist2D(s2.pos, target);
            if (d2 < minDist) minDist = d2;
        } else if (k >= 6) {
            stalledCount++;
            if (stalledCount >= 4) break;
        }
    }
    driveSteps({ forward: 0, right: 0, brake: 0 }, 1, 16);
    check(minDist < startDist - 4.0, `car closed distance toward building (${startDist.toFixed(1)} -> ${minDist.toFixed(1)})`);
    check(minDist >= wallHalf * 0.85, `car halted/deflected outside building footprint (minDist=${minDist.toFixed(2)}, wallHalf=${wallHalf.toFixed(2)})`);
    api.exitCar();
});

await test("T2.5.5 vehicle curb and sidewalk response keeps valid elevation", async () => {
    const s0 = await enterCarOnStreet(0, 0);
    const baseY = s0.pos[1];
    const after = driveSteps({ forward: 0.85, right: 0.8, brake: 0 }, 40, 16);
    check(Number.isFinite(after.pos[1]), "finite height across curb/sidewalk");
    check(after.pos[1] >= baseY - 1.0 && after.pos[1] <= baseY + 2.5, `car stays on road/curb surface (y=${after.pos[1].toFixed(2)})`);
    api.exitCar();
});

await test("T2.5.6 ambient traffic collision safety and no-nearby-car edge", async () => {
    await enterCarOnStreet(0, 0);
    const driven = driveSteps({ forward: 0.9, right: 0, brake: 0 }, 50, 16);
    check(driven.pos.every(Number.isFinite) && Number.isFinite(driven.speed), "car remains stable in traffic lane");
    api.exitCar();

    // Far from street traffic/parked cars (e.g. inside park or far edge), enterNearestCar must fail safely
    api.setMode("walk");
    await teleportAndSettle(6140, 3, 6140);
    const res = api.enterNearestCar();
    if (!res) {
        eq(api.getState().inCar, false, "enterNearestCar returns falsy without forcing drive mode");
        eq(api.getMode(), "walk", "stays in walk mode when no car nearby");
    } else {
        // If a car was spawned near boundary road, exiting cleanly must work
        eq(api.getState().inCar, true, "car entered cleanly if spawned nearby");
        api.exitCar();
    }
});

// ── Area 2.6: Day / Dusk / Night Horizon Angles (7 tests) ────────────────────

await test("T2.6.1 midnight solar hour setTimeOfDay(0)", async () => {
    await flyTo(0, 45, 0, 0.3, -0.15);
    api.setTimeOfDay(0);
    await settle({ exposure: true });
    const m = bro.eye.measure();
    check(Number.isFinite(m.lumaMean) && m.lumaMean >= 0, "midnight lumaMean finite: " + m.lumaMean.toFixed(3));
    assertDiagnoseClean(scene, "midnight 0h");
});

await test("T2.6.2 pre-dawn twilight setTimeOfDay(5.5)", async () => {
    api.setTimeOfDay(5.5);
    await settle({ exposure: true });
    const m = bro.eye.measure();
    check(m.dynamicRange > 0.03, "pre-dawn gradient dynamicRange valid: " + m.dynamicRange.toFixed(3));
    check(m.blownWhiteRatio < 0.08, "pre-dawn no exposure clip");
});

await test("T2.6.3 sunrise horizon grazing setTimeOfDay(6.0)", async () => {
    api.setTimeOfDay(6.0);
    await settle({ exposure: true });
    assertDiagnoseClean(scene, "sunrise grazing 6.0h");
});

await test("T2.6.4 solar noon setTimeOfDay(12.0)", async () => {
    api.setTimeOfDay(12.0);
    await settle({ exposure: true });
    const m = bro.eye.measure();
    check(m.lumaMean > 0.15, "solar noon lumaMean high: " + m.lumaMean.toFixed(3));
    assertDiagnoseClean(scene, "solar noon 12.0h");
});

await test("T2.6.5 sunset horizon grazing setTimeOfDay(18.0)", async () => {
    api.setTimeOfDay(18.0);
    await settle({ exposure: true });
    assertDiagnoseClean(scene, "sunset grazing 18.0h");
});

await test("T2.6.6 post-sunset dusk setTimeOfDay(18.5)", async () => {
    api.setTimeOfDay(18.5);
    await settle({ exposure: true });
    const m = bro.eye.measure();
    check(m.blownWhiteRatio < 0.08, "post-sunset dusk no HDR white clip");
    assertDiagnoseClean(scene, "post-sunset dusk 18.5h");
});

await test("T2.6.7 end-of-day wrap 23.99 and out-of-range solar hours (-2, 26)", async () => {
    api.setTimeOfDay(23.99);
    await settle({ exposure: true });
    const mWrap = bro.eye.measure();
    check(Number.isFinite(mWrap.lumaMean), "23.99h valid luminance");

    for (const h of [-2, 26]) {
        api.setTimeOfDay(h);
        frames(4);
        const m = bro.eye.measure();
        check(Number.isFinite(m.lumaMean) && m.lumaMean >= 0 && m.lumaMean <= 1, `out-of-range hour ${h} safe`);
    }
    api.setTimeMode("day");
});

// ── Area 2.7: Flyover Altitude Thresholds (6 tests) ──────────────────────────

let lod2 = null;
let lod50 = null;
let lod200 = null;
let lod600 = null;

await test("T2.7.1 street baseline altitude 2 m LOD snapshot", async () => {
    api.setMode("walk");
    const st = await teleportAndSettle(0, 2, 0);
    lod2 = st.lod;
    check(lod2 && lod2.voxelMinDist > 0 && lod2.meshFadeEnd > 0, "baseline LOD valid at 2m");
});

await test("T2.7.2 low rooftop altitude 50 m LOD check", async () => {
    const st = await flyTo(0, 50, 0, 0, -0.2);
    lod50 = st.lod;
    check(lod50.voxelMinDist > 0 && lod50.voxelMinDist <= lod2.voxelMinDist * 1.05, `50m voxelMinDist=${lod50.voxelMinDist}`);
});

await test("T2.7.3 mid-skyscraper altitude 200 m LOD pull-in", async () => {
    const st = await flyTo(0, 200, 0, 0, -0.3);
    lod200 = st.lod;
    check(lod200.voxelMinDist <= lod50.voxelMinDist, `200m voxelMinDist (${lod200.voxelMinDist}) <= 50m (${lod50.voxelMinDist})`);
    check(lod200.meshFadeEnd <= lod50.meshFadeEnd, `200m meshFadeEnd (${lod200.meshFadeEnd}) <= 50m (${lod50.meshFadeEnd})`);
});

await test("T2.7.4 high flyover altitude 600 m significant LOD contraction", async () => {
    const st = await flyTo(0, 600, 0, 0, -0.45);
    lod600 = st.lod;
    check(lod600.voxelMinDist < lod2.voxelMinDist, `600m voxelMinDist (${lod600.voxelMinDist}) < 2m (${lod2.voxelMinDist})`);
    const sc = bro.eye.scene(scene);
    check(sc.skyRatio < 0.95, "city footprint visible from 600m altitude");
});

await test("T2.7.5 stratospheric overview 1500 m keeps bounded positive LOD", async () => {
    const st = await flyTo(0, 1500, 0, 0, -0.6);
    check(st.lod.voxelMinDist > 0 && Number.isFinite(st.lod.voxelMinDist), "1500m voxelMinDist positive: " + st.lod.voxelMinDist);
    check(st.lod.meshFadeEnd > 0 && Number.isFinite(st.lod.meshFadeEnd), "1500m meshFadeEnd positive: " + st.lod.meshFadeEnd);
});

await test("T2.7.6 ground clamp in fly mode prevents sinking below terrain", async () => {
    await flyTo(0, 20, 0, 0, -0.5);
    api.teleport(0, -50, 0);
    frames(5);
    const st = api.getState();
    check(st.altitude >= -0.5 && st.pos[1] > -10, `fly mode clamped above terrain (y=${st.pos[1].toFixed(2)}, alt=${st.altitude.toFixed(2)})`);
});

done("metropolis tier2 vehicles and environment");
