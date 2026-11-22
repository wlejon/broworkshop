// Tier 4 Automated Performance Benchmarks (perf.measure) for Street >= 200 fps & Flyover LOD/Churn.
// Covers F1–F15, AC7 (street >= 200 fps / <= 5.0 ms), AC8 (flyover fps, LOD pull-in, bounded churn).
import { check, eq, test, done, frames, simUntil, tier } from "/lib/kit/test.js";
import {
    waitReady,
    getScene,
    settle,
    clearWalkInput,
    teleportAndSettle,
    getDoorwayPos,
    getBuildingCenter,
    resolveYawToward,
    runPerfMeasure,
} from "./helpers.js";

const api = await waitReady();
const scene = getScene();

function assertStreetBudget(r, label) {
    check(Number.isFinite(r.wall.mean) && r.wall.mean < 250, `${label}: wall.mean bounded (${r.wall.mean.toFixed(2)}ms)`);
    if (r.converge) {
        eq(r.converge.settled, true, `${label}: converge settled cleanly`);
    }
    if (r.timed) {
        check(r.total.mean <= 5.0, `${label}: total.mean <= 5.0ms (>= 200 fps), got ${r.total.mean.toFixed(3)}ms (${r.fps.toFixed(1)} fps)`);
        check(r.total.p99 <= 12.0, `${label}: total.p99 <= 12.0ms (no stall), got ${r.total.p99.toFixed(3)}ms`);
        check((r.spikes || []).length / r.frames <= 0.15, `${label}: bounded spike fraction (${(r.spikes || []).length}/${r.frames})`);
    }
}

await test("T4.3.1a street-level downtown >= 200 fps (<= 5.0 ms) benchmark", async () => {
    api.setTimeMode("day");
    api.setMode("walk");
    await teleportAndSettle(0, 2, 0, 0, 0);
    const totalSteps = tier(35, 135);
    const r = await runPerfMeasure("street_downtown", {
        frames: tier(30, 120),
        warm: tier(5, 15),
        budget: 5.0,
        stepMs: 5.0,
        converge: { maxFrames: 200 },
        step: (i) => {
            const yaw = (i / totalSteps) * 0.6;
            api.setWalkInput({ forward: 0.8, right: 0, jump: false, sprint: false, yawDelta: yaw * 0.02, pitchDelta: 0 });
        },
    });
    clearWalkInput();
    assertStreetBudget(r, "street_downtown");
});

await test("T4.3.1b interior transition (street -> skyscraper lobby -> floor 1) >= 200 fps", async () => {
    api.setTimeMode("day");
    api.setMode("walk");
    await teleportAndSettle(0, 2, 0);
    const sky = api.getNearestBuilding("skyscraper");
    const door = getDoorwayPos(sky);
    const center = getBuildingCenter(sky) || door;
    let ox = door[0] - center[0];
    let oz = door[2] - center[2];
    const len = Math.hypot(ox, oz) || 1;
    ox /= len;
    oz /= len;
    const startPos = [door[0] + ox * 0.6, door[1], door[2] + oz * 0.6];
    const insideTarget = [door[0] - ox * 3.0, door[1], door[2] - oz * 3.0];
    await teleportAndSettle(startPos[0], startPos[1], startPos[2]);
    resolveYawToward(startPos, insideTarget);

    const warmCount = tier(10, 15);
    let enteredBuilding = false;
    let elevatorTriggered = false;
    let prevPos = null;
    let steerSign = 1;
    let lastDot = null;
    const r = await runPerfMeasure("interior_transition", {
        frames: tier(60, 120),
        warm: warmCount,
        budget: 5.0,
        stepMs: 5.0,
        converge: { maxFrames: 200 },
        step: (i) => {
            const st = api.getState();
            if (st.buildingId == null) {
                let yawDelta = 0;
                let fwd = 1;
                if (prevPos) {
                    const fx = st.pos[0] - prevPos[0];
                    const fz = st.pos[2] - prevPos[2];
                    const fLen = Math.hypot(fx, fz);
                    const tx = insideTarget[0] - st.pos[0];
                    const tz = insideTarget[2] - st.pos[2];
                    const d = Math.hypot(tx, tz);
                    if (fLen > 1e-4 && d > 0.2) {
                        const dot = Math.max(-1, Math.min(1, (fx * tx + fz * tz) / (fLen * d)));
                        const cross = (fx * tz - fz * tx) / (fLen * d);
                        if (lastDot !== null && dot < lastDot - 0.03) steerSign = -steerSign;
                        lastDot = dot;
                        const angle = Math.atan2(cross, dot);
                        yawDelta = Math.max(-0.25, Math.min(0.25, steerSign * angle * 0.3));
                        if (dot < 0.3) fwd = 0;
                    }
                }
                prevPos = st.pos.slice();
                api.setWalkInput({ forward: fwd, right: 0, jump: false, sprint: true, yawDelta, pitchDelta: 0 });
            } else {
                enteredBuilding = true;
                api.setWalkInput({ forward: 0.2, right: 0, jump: false, sprint: false, yawDelta: 0.008, pitchDelta: 0 });
                if (!elevatorTriggered && i >= warmCount) {
                    elevatorTriggered = true;
                    api.useElevator(1);
                }
            }
        },
    });
    clearWalkInput();
    const endSt = api.getState();
    if (endSt.buildingId != null) enteredBuilding = true;
    check(enteredBuilding, "interior_transition: entered skyscraper during benchmark");
    check(elevatorTriggered, "interior_transition: triggered elevator inside skyscraper");
    simUntil(() => api.getState().floorIndex >= 1, 5000, 50);
    const floorSt = api.getState();
    check(floorSt.floorIndex >= 1, "interior_transition: elevator ascended to floor >= 1 (got " + floorSt.floorIndex + ")");
    check(floorSt.buildingId != null, "interior_transition: remained inside skyscraper after elevator ascent");
    assertStreetBudget(r, "interior_transition");
});

await test("T4.3.1c suburban street traversal >= 200 fps (<= 5.0 ms) benchmark", async () => {
    api.setTimeMode("day");
    api.setMode("walk");
    await teleportAndSettle(3500, 3, 3500, 0, 0);
    const r = await runPerfMeasure("street_suburb", {
        frames: tier(30, 120),
        warm: tier(5, 15),
        budget: 5.0,
        stepMs: 5.0,
        converge: { maxFrames: 200 },
        step: (i) => {
            api.setWalkInput({ forward: 1, right: 0, jump: false, sprint: true, yawDelta: Math.sin(i * 0.1) * 0.01, pitchDelta: 0 });
        },
    });
    clearWalkInput();
    assertStreetBudget(r, "street_suburb");
});

await test("T4.3.2 flyover traversal fps, altitude LOD pull-in, and bounded churn", async () => {
    api.setTimeMode("day");
    api.setMode("fly");
    await teleportAndSettle(0, 10, 0, 0.78, -0.25);

    const warmCount = tier(5, 15);
    const measCount = tier(30, 120);
    const total = warmCount + measCount;
    const samples = [];

    const r = await runPerfMeasure("flyover_traversal", {
        frames: measCount,
        warm: warmCount,
        budget: 5.0,
        stepMs: 5.0,
        converge: { maxFrames: 200 },
        step: (i) => {
            const t = i / Math.max(1, total - 1);
            const x = 1200 * t;
            const y = 10 + 690 * t;
            const z = 1200 * t;
            api.teleport(x, y, z, 0.78, -0.25 - 0.2 * t);
            const st = api.getState();
            const culls = typeof scene.cullStats === "function" ? scene.cullStats() : null;
            samples.push({
                altitude: st.altitude,
                voxelMinDist: st.lod && st.lod.voxelMinDist,
                meshFadeEnd: st.lod && st.lod.meshFadeEnd,
                poolDraws: st.poolDraws,
                culls,
            });
        },
    });

    const first = samples[0];
    const last = samples[samples.length - 1];
    const draws = samples.map((s) => s.poolDraws).filter((v) => Number.isFinite(v));
    const minDraws = Math.min(...draws);
    const maxDraws = Math.max(...draws);

    console.log(
        `[perf] flyover_summary: fps=${r.fps.toFixed(1)} ` +
        `startLod=(${first.voxelMinDist}, ${first.meshFadeEnd}) ` +
        `endLod=(${last.voxelMinDist}, ${last.meshFadeEnd}) ` +
        `poolDraws=[${minDraws}..${maxDraws}] refine.mean=${r.refine.mean.toFixed(3)}ms ` +
        `converge.frames=${r.converge ? r.converge.frames : "n/a"}`
    );

    check(first.voxelMinDist > 0 && last.voxelMinDist > 0, "positive voxelMinDist throughout flyover");
    check(
        last.voxelMinDist < first.voxelMinDist,
        `altitude-adaptive voxelMinDist pull-in (${first.voxelMinDist} -> ${last.voxelMinDist})`
    );
    check(
        last.meshFadeEnd < first.meshFadeEnd,
        `altitude-adaptive meshFadeEnd pull-in (${first.meshFadeEnd} -> ${last.meshFadeEnd})`
    );
    check(draws.length === samples.length && minDraws > 0 && Number.isFinite(maxDraws), "valid poolDraws across flyover");
    check(
        maxDraws <= Math.max(minDraws * 4.0, minDraws + 150),
        `bounded poolDraws churn during flyover (${minDraws}..${maxDraws})`
    );
    if (r.converge) {
        eq(r.converge.settled, true, "flyover converge settled");
    }
    if (r.timed) {
        check(r.total.max < 25.0, `no frame stall during flyover (total.max=${r.total.max.toFixed(2)}ms)`);
    }
    api.setMode("walk");
});

done("metropolis tier4 perf");
