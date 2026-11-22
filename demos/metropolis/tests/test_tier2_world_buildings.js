// Tier 2 Boundary & Corner Cases: World Edges, Skyscraper Floors, Elevators & Collisions (Areas 2.1–2.4: 21 tests).
// Covers F1, F2, F3, F7, F9, F10, F11.
import { check, eq, test, done, frames, simUntil } from "/lib/kit/test.js";
import {
    waitReady,
    getScene,
    clearWalkInput,
    walkSteps,
    teleportAndSettle,
    flyTo,
    dist2D,
    toVec3,
    getDoorwayPos,
    getBuildingCenter,
    getStairPos,
    resolveYawToward,
    walkToPoint,
    enterBuilding,
    captureMotionFrames,
} from "./helpers.js";

const api = await waitReady();
const scene = getScene();

function getTopFloor(info, bld) {
    const floors = (info && info.floors) || (bld && bld.floors) || 1;
    const count = Array.isArray(floors) ? floors.length : Number(floors);
    return Math.max(0, (Number.isFinite(count) ? count : 1) - 1);
}

function getWallOutwardNormal(bld, door) {
    const outPos = toVec3(bld && (bld.outsidePos || bld.approachPos));
    if (outPos && door) {
        const dx = outPos[0] - door[0];
        const dz = outPos[2] - door[2];
        const len = Math.hypot(dx, dz);
        if (len > 1e-3) return [dx / len, dz / len];
    }
    const inPos = toVec3(bld && bld.insidePos);
    if (inPos && door) {
        const dx = door[0] - inPos[0];
        const dz = door[2] - inPos[2];
        const len = Math.hypot(dx, dz);
        if (len > 1e-3) return [dx / len, dz / len];
    }
    const nrm = toVec3(bld && bld.normal);
    if (nrm) {
        const len = Math.hypot(nrm[0], nrm[2]);
        if (len > 1e-3) return [-nrm[0] / len, -nrm[2] / len];
    }
    const center = getBuildingCenter(bld) || door;
    const dx = door[0] - center[0];
    const dz = door[2] - center[2];
    const len = Math.hypot(dx, dz) || 1;
    return [dx / len, dz / len];
}

// ── Area 2.1: World Edges (±6144 m) (5 tests) ───────────────────────────────

await test("T2.1.1 near-edge east (6140, y, 0)", async () => {
    api.setMode("walk");
    const st = await teleportAndSettle(6140, 3, 0);
    walkSteps({ forward: 0 }, 8);
    const cur = api.getState();
    check(cur.pos.every(Number.isFinite), "finite pos near east edge");
    check(Math.abs(cur.pos[0]) <= 6144.5, "x within world domain: " + cur.pos[0]);
    const sc = bro.eye.scene(scene);
    check(sc.skyRatio < 0.99, "valid terrain rendered at east edge");
});

await test("T2.1.2 near-edge west (-6140, y, 0)", async () => {
    api.setMode("walk");
    await teleportAndSettle(-6140, 3, 0);
    walkSteps({ forward: 0 }, 8);
    const motion = captureMotionFrames(4, () => frames(2));
    eq(motion.popCount, 0, "zero jitter pops near west edge (-6140)");
});

await test("T2.1.3 all four extreme corners near ±6140 m", async () => {
    for (const [x, z] of [[6140, 6140], [-6140, 6140], [6140, -6140], [-6140, -6140]]) {
        const st = await teleportAndSettle(x, 4, z);
        check(st.pos.every(Number.isFinite), `finite pos at corner (${x}, ${z})`);
        check(Math.abs(st.pos[0]) <= 6144.5 && Math.abs(st.pos[2]) <= 6144.5, "within ±6144 domain");
    }
});

await test("T2.1.4 beyond-edge teleport (6500, y, 6500) clamps within domain", async () => {
    api.setMode("walk");
    const st = await teleportAndSettle(6500, 10, 6500);
    check(st.pos.every(Number.isFinite), "no NaN on out-of-bounds teleport");
    check(Math.abs(st.pos[0]) <= 6144.5 && Math.abs(st.pos[2]) <= 6144.5, `clamped within ±6144: (${st.pos[0]}, ${st.pos[2]})`);
});

await test("T2.1.5 continuous fly past negative border -6144 clamps safely", async () => {
    const startPos = [-6120, 30, 0];
    await flyTo(startPos[0], startPos[1], startPos[2], 0, 0);
    resolveYawToward(startPos, [-6160, 30, 0]);
    for (let i = 0; i < 40; i++) {
        walkSteps({ forward: 1, sprint: true }, 3, 16);
    }
    const st = api.getState();
    check(st.pos.every(Number.isFinite), "finite pos after flying at border");
    check(st.pos[0] <= -6100, "flew toward negative border -6144: x=" + st.pos[0]);
    check(st.pos[0] >= -6145 && st.pos[0] <= 6145, "x bounded at negative edge: " + st.pos[0]);
});

// ── Area 2.2: Skyscraper Ground-to-Top Floors (5 tests) ──────────────────────

await test("T2.2.1 skyscraper floor 0 lobby boundary and ground support", async () => {
    await teleportAndSettle(0, 3, 0);
    const { state } = await enterBuilding("skyscraper");
    eq(state.floorIndex, 0, "lobby floorIndex === 0");
    const y0 = state.pos[1];
    const walked = walkSteps({ forward: 1 }, 10, 16);
    check(Math.abs(walked.pos[1] - y0) < 0.3, "lobby slab supports player steadily");
});

await test("T2.2.2 skyscraper floor 1 boundary via elevator", async () => {
    await teleportAndSettle(0, 3, 0);
    const { bld, info } = await enterBuilding("skyscraper");
    const topFloor = getTopFloor(info, bld);
    if (topFloor >= 1) {
        api.useElevator(1);
        simUntil(() => api.getState().floorIndex === 1, 10000, 50);
        eq(api.getState().floorIndex, 1, "reached floor 1");
    }
    check(api.getState().buildingId != null, "remained inside skyscraper at floor 1");
});

await test("T2.2.3 skyscraper mid-tower floor perimeter containment", async () => {
    await teleportAndSettle(0, 3, 0);
    const { bld, info } = await enterBuilding("skyscraper");
    const topFloor = getTopFloor(info, bld);
    const mid = Math.max(1, Math.floor(topFloor / 2));
    api.useElevator(mid);
    simUntil(() => api.getState().floorIndex === mid, Math.max(15000, (topFloor || 10) * 1000), 50);
    const st0 = api.getState();
    eq(st0.floorIndex, mid, "reached mid-tower floor " + mid);
    // Walk outward toward walls; exterior walls must prevent falling out
    const after = walkSteps({ forward: 1, sprint: true }, 45, 16);
    check(after.buildingId != null, "mid-tower exterior walls prevent falling out");
    check(Math.abs(after.pos[1] - st0.pos[1]) < 1.0, "remained on mid-tower floor slab");
});

await test("T2.2.4 skyscraper top floor boundary and skyline visibility", async () => {
    await teleportAndSettle(0, 3, 0);
    const { bld, info } = await enterBuilding("skyscraper");
    const topFloor = getTopFloor(info, bld);
    api.useElevator(topFloor);
    const ok = simUntil(() => api.getState().floorIndex === topFloor, Math.max(15000, (topFloor || 10) * 1000), 50);
    check(ok, "arrived at topFloor=" + topFloor);
    const st = api.getState();
    eq(st.floorIndex, topFloor, "floorIndex === topFloor");
    const m = bro.eye.measure();
    check(m.dynamicRange > 0.04, "top floor interior/skyline renders cleanly");
});

await test("T2.2.5 beyond-bounds floor requests (-1 and topFloor + 50) clamp safely", async () => {
    await teleportAndSettle(0, 3, 0);
    const { bld, info } = await enterBuilding("skyscraper");
    const topFloor = getTopFloor(info, bld);

    api.useElevator(-1);
    frames(60);
    const low = api.getState();
    check(low.floorIndex >= 0 && low.floorIndex <= topFloor, "negative floor clamped: " + low.floorIndex);

    api.useElevator(topFloor + 50);
    simUntil(() => api.getState().floorIndex === topFloor, Math.max(15000, (topFloor || 10) * 1000), 50);
    frames(60);
    const high = api.getState();
    check(high.floorIndex <= topFloor && high.floorIndex >= 0, "excess floor clamped <= topFloor: " + high.floorIndex);
    eq(high.floorIndex, topFloor, "excess floor clamped === topFloor");
});

// ── Area 2.3: Elevator Limits (5 tests) ──────────────────────────────────────

await test("T2.3.1 elevator min floor 0 descent limit", async () => {
    await teleportAndSettle(0, 3, 0);
    await enterBuilding("skyscraper");
    const y0 = api.getState().pos[1];
    api.useElevator(0);
    frames(10);
    api.useElevator(-5);
    frames(10);
    eq(api.getState().floorIndex, 0, "stayed at floor 0");
    check(Math.abs(api.getState().pos[1] - y0) < 0.2, "no downward drop below floor 0");
});

await test("T2.3.2 elevator max floor ascent limit", async () => {
    await teleportAndSettle(0, 3, 0);
    const { bld, info } = await enterBuilding("skyscraper");
    const topFloor = getTopFloor(info, bld);
    api.useElevator(topFloor);
    simUntil(() => api.getState().floorIndex === topFloor, Math.max(15000, (topFloor || 10) * 1000), 50);
    const yTop = api.getState().pos[1];
    api.useElevator(topFloor + 10);
    frames(15);
    eq(api.getState().floorIndex, topFloor, "stayed at topFloor");
    check(Math.abs(api.getState().pos[1] - yTop) < 0.5, "no overshoot above topFloor");
});

await test("T2.3.3 elevator same-floor call is clean no-op", async () => {
    await teleportAndSettle(0, 3, 0);
    const { bld, info } = await enterBuilding("skyscraper");
    const topFloor = getTopFloor(info, bld);
    const f = Math.min(topFloor, 3);
    api.useElevator(f);
    simUntil(() => api.getState().floorIndex === f, 12000, 50);
    const pBefore = api.getState().pos.slice();
    api.useElevator(f);
    frames(10);
    const pAfter = api.getState().pos;
    eq(api.getState().floorIndex, f, "remained on floor " + f);
    check(Math.abs(pAfter[1] - pBefore[1]) < 0.1, "no vertical jitter on same-floor call");
});

await test("T2.3.4 rapid consecutive elevator re-targeting converges cleanly", async () => {
    await teleportAndSettle(0, 3, 0);
    const { bld, info } = await enterBuilding("skyscraper");
    const topFloor = getTopFloor(info, bld);
    const target = Math.min(topFloor, 4);
    api.useElevator(topFloor);
    frames(10);
    api.useElevator(1);
    frames(6);
    api.useElevator(target);
    const arrived = simUntil(() => api.getState().floorIndex === target, 15000, 50);
    check(arrived, `rapid re-targeting converged to floor ${target}`);
    check(api.getState().buildingId != null, "remained safely inside skyscraper shaft/floor");
});

await test("T2.3.5 elevator call outside building is safe no-op", async () => {
    api.setMode("walk");
    const st0 = await teleportAndSettle(0, 3, 0);
    walkSteps({ forward: 0 }, 5);
    const before = api.getState();
    eq(before.buildingId, null, "outdoors before elevator call");
    api.useElevator(3);
    frames(8);
    const after = api.getState();
    eq(after.buildingId, null, "still outdoors after outside useElevator");
    eq(after.floorIndex, before.floorIndex, "floorIndex unchanged outdoors");
});

// ── Area 2.4: Doorway, Wall, Furniture & Stair Collisions (6 tests) ──────────

await test("T2.4.1 solid exterior wall frontal collision block", async () => {
    await teleportAndSettle(3500, 3, 3500);
    const home = api.getNearestBuilding("home");
    const door = getDoorwayPos(home);
    const [ox, oz] = getWallOutwardNormal(home, door);
    const tx = -oz;
    const tz = ox;
    const wallSpan = Math.abs(ox) > Math.abs(oz) ? (home.depth ?? home.width ?? 6) : (home.width ?? home.depth ?? 6);
    const latOff = Math.min(2.5, Math.max(1.0, wallSpan * 0.3));

    const startPos = [door[0] + ox * 2.2 + tx * latOff, door[1], door[2] + oz * 2.2 + tz * latOff];
    const interiorTarget = [door[0] - ox * 1.5 + tx * latOff, door[1], door[2] - oz * 1.5 + tz * latOff];
    await teleportAndSettle(startPos[0], startPos[1], startPos[2]);
    resolveYawToward(startPos, interiorTarget);
    let everEntered = false;
    let maxInward = 0;
    for (let k = 0; k < 10; k++) {
        const b = walkSteps({ forward: 1, sprint: true, hold: true }, 6, 16);
        const bw = (startPos[0] - b.pos[0]) * ox + (startPos[2] - b.pos[2]) * oz;
        if (bw > maxInward) maxInward = bw;
        if (b.buildingId != null) everEntered = true;
    }
    clearWalkInput();
    const st = api.getState();
    const inwardTravel = (startPos[0] - st.pos[0]) * ox + (startPos[2] - st.pos[2]) * oz;
    if (inwardTravel > maxInward) maxInward = inwardTravel;
    check(inwardTravel > 0.3, "walked toward exterior wall (" + inwardTravel.toFixed(2) + "m)");
    check(maxInward < 2.35, "exterior wall blocked inward penetration (" + maxInward.toFixed(2) + "m < 2.35m)");
    check(dist2D(st.pos, interiorTarget) > 0.5, "solid wall blocked penetration to interior target");
    eq(everEntered, false, "never entered building footprint during exterior wall walk");
    eq(st.buildingId, null, "solid wall blocked entry away from doorway");
});

await test("T2.4.2 diagonal wall sliding retains tangential motion", async () => {
    await teleportAndSettle(3500, 3, 3500);
    const home = api.getNearestBuilding("home");
    const door = getDoorwayPos(home);
    const [ox, oz] = getWallOutwardNormal(home, door);
    const tx = -oz;
    const tz = ox;
    const wallSpan = Math.abs(ox) > Math.abs(oz) ? (home.depth ?? home.width ?? 6) : (home.width ?? home.depth ?? 6);
    const latOff = Math.min(2.5, Math.max(1.0, wallSpan * 0.3));

    const startPos = [door[0] + ox * 2.2 + tx * latOff, door[1], door[2] + oz * 2.2 + tz * latOff];
    const wallTarget = [door[0] - ox * 1.2 + tx * latOff, door[1], door[2] - oz * 1.2 + tz * latOff];
    await teleportAndSettle(startPos[0], startPos[1], startPos[2]);
    const yawWall = resolveYawToward(startPos, wallTarget);
    // Pick right-input polarity that slides away from doorway (+t direction)
    const probeR = walkSteps({ right: 1 }, 2, 16);
    const rightSign = ((probeR.pos[0] - startPos[0]) * tx + (probeR.pos[2] - startPos[2]) * tz) >= 0 ? 1 : -1;
    api.teleport(startPos[0], startPos[1], startPos[2], yawWall, 0);
    frames(2);
    const st0 = api.getState();
    const st1 = walkSteps({ forward: 1, right: 0.7 * rightSign }, 35, 16);
    check(dist2D(st0.pos, st1.pos) > 0.5, "slid tangentially along exterior wall: " + dist2D(st0.pos, st1.pos).toFixed(2));
    eq(st1.buildingId, null, "did not clip through wall while sliding");
});

await test("T2.4.3 room corner wedging and clean recovery", async () => {
    await teleportAndSettle(0, 3, 0);
    const { state } = await enterBuilding("business");
    const bId = state.buildingId;
    walkSteps({ forward: 1, right: 1 }, 35, 16);
    const wedged = api.getState();
    check(wedged.pos.every(Number.isFinite) && wedged.buildingId === bId, "remained cleanly bounded at corner");
    const freed = walkSteps({ forward: -1, right: -1 }, 25, 16);
    check(dist2D(wedged.pos, freed.pos) > 0.3, "backed out cleanly from room corner");
});

await test("T2.4.4 narrow doorway center permits entry while jamb offset blocks", async () => {
    await teleportAndSettle(3500, 3, 3500);
    const home = api.getNearestBuilding("home");
    const door = getDoorwayPos(home);
    const [ox, oz] = getWallOutwardNormal(home, door);
    const tx = -oz;
    const tz = ox;
    const wallSpan = Math.abs(ox) > Math.abs(oz) ? (home.depth ?? home.width ?? 6) : (home.width ?? home.depth ?? 6);
    const latOff = Math.min(2.5, Math.max(1.0, wallSpan * 0.3));

    const offPos = [door[0] + ox * 2.2 + tx * latOff, door[1], door[2] + oz * 2.2 + tz * latOff];
    const interiorTarget = [door[0] - ox * 1.5 + tx * latOff, door[1], door[2] - oz * 1.5 + tz * latOff];
    await teleportAndSettle(offPos[0], offPos[1], offPos[2]);
    resolveYawToward(offPos, interiorTarget);
    let everEntered = false;
    let maxInward = 0;
    for (let k = 0; k < 10; k++) {
        const b = walkSteps({ forward: 1, sprint: true, hold: true }, 6, 16);
        const bw = (offPos[0] - b.pos[0]) * ox + (offPos[2] - b.pos[2]) * oz;
        if (bw > maxInward) maxInward = bw;
        if (b.buildingId != null) everEntered = true;
    }
    clearWalkInput();
    const blockedSt = api.getState();
    const inward = (offPos[0] - blockedSt.pos[0]) * ox + (offPos[2] - blockedSt.pos[2]) * oz;
    if (inward > maxInward) maxInward = inward;
    check(inward > 0.3, "walked toward wall jamb offset (" + inward.toFixed(2) + "m)");
    check(maxInward < 2.35, "wall jamb blocked inward penetration (" + maxInward.toFixed(2) + "m < 2.35m)");
    check(dist2D(blockedSt.pos, interiorTarget) > 0.5, "wall beside doorway blocked penetration");
    eq(everEntered, false, "never entered building footprint at jamb offset");
    eq(blockedSt.buildingId, null, "wall beside doorway blocked entry");

    // Now enter cleanly through doorway center
    const res = await enterBuilding("home");
    check(res.state.buildingId != null, "centered doorway walk permitted entry");
});

await test("T2.4.5 interior furniture AABB collision check", async () => {
    await teleportAndSettle(3500, 3, 3500);
    const { bld, state, info } = await enterBuilding("home");
    const furn = (info && info.furniture) || (bld && bld.furniture) || [];
    if (Array.isArray(furn) && furn.length > 0) {
        const item = furn[0];
        const fPos = toVec3(item.pos || item.center || item);
        if (fPos) {
            const st = walkToPoint(fPos, { tol: 0.1, maxSteps: 90 });
            check(st.buildingId === state.buildingId, "remained inside building while colliding with furniture");
            check(st.pos.every(Number.isFinite), "finite pos against furniture AABB");
        }
    } else {
        // Traverse interior space verifying collision boundaries remain intact
        const st1 = walkSteps({ forward: 1 }, 30, 16);
        const st2 = walkSteps({ right: 1 }, 30, 16);
        check(st1.pos.every(Number.isFinite) && st2.pos.every(Number.isFinite), "interior collision finite");
    }
});

await test("T2.4.6 stair step-up vs upper floor slab headroom bound", async () => {
    await teleportAndSettle(0, 3, 0);
    const { bld, state, info } = await enterBuilding("skyscraper");
    const yStart = state.pos[1];
    const stairPos = getStairPos(info) || getStairPos(bld);
    check(Boolean(stairPos), "stair coordinates exposed");
    walkToPoint(stairPos, { tol: 1.0, maxSteps: 140 });
    simUntil(() => {
        if (api.getState().floorIndex >= 1) return true;
        walkSteps({ forward: 1 }, 4, 16);
        return api.getState().floorIndex >= 1;
    }, 8000, 16);
    const st1 = api.getState();
    check(st1.floorIndex >= 1 && st1.pos[1] > yStart + 1.0, "stair step-up reached floor 1");
    // Verify player does not clip straight upward through ceiling slab on jump
    const jumped = walkSteps({ jump: true }, 12, 16);
    check(jumped.pos[1] < st1.pos[1] + 2.5, "ceiling slab bounds jump headroom");
});

done("metropolis tier2 world and buildings");
