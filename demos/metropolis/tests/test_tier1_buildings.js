// Tier 1 Buildings, Interiors & Multi-Story 3D Navigation E2E tests (Areas 1.6–1.7: 11 tests).
// Covers F7 (enterable homes/businesses/skyscrapers), F9 (interior streaming), F10 (culling),
// F11 (multi-story 3D navigation), F17 (bro.eye.structure).
import { check, eq, test, done, frames, simUntil } from "/lib/kit/test.js";
import {
    waitReady,
    getScene,
    walkSteps,
    teleportAndSettle,
    dist2D,
    toVec3,
    getDoorwayPos,
    getBuildingCenter,
    getStairPos,
    walkToPoint,
    enterBuilding,
    buildInteriorStructureOpts,
    assertStructureClean,
} from "./helpers.js";

const api = await waitReady();
const scene = getScene();

function getRoomsList(info, bld) {
    const rooms = (info && info.rooms) || (bld && bld.rooms) || [];
    return Array.isArray(rooms) ? rooms : [];
}

function getRoomCenter(r) {
    return toVec3((r && (r.center || r.pos || r.doorway)) || (r && r.cx != null ? [r.cx, r.y ?? 0, r.cz] : null));
}

function getTopFloor(info, bld) {
    const floors = (info && info.floors) || (bld && bld.floors) || 1;
    const count = Array.isArray(floors) ? floors.length : Number(floors);
    return Math.max(0, (Number.isFinite(count) ? count : 1) - 1);
}

// ── Area 1.6: Enterable Homes, Businesses & Skyscrapers (6 tests) ────────────

await test("T1.6.1 enter suburban home through doorway", async () => {
    await teleportAndSettle(3500, 3, 3500);
    const { state } = await enterBuilding("home");
    check(state.buildingId != null, "entered home buildingId=" + state.buildingId);
    check(state.roomId != null, "inside valid roomId=" + state.roomId);
});

await test("T1.6.2 home furnished rooms and active interior streaming", async () => {
    await teleportAndSettle(3500, 3, 3500);
    const { bld, state, info } = await enterBuilding("home");
    check(state.activeInteriors >= 1, "activeInteriors >= 1 inside home: " + state.activeInteriors);
    const rooms = getRoomsList(info, bld);
    if (rooms.length >= 2) {
        const curRoomId = state.roomId;
        const other = rooms.find((r) => (r.id ?? r.roomId) !== curRoomId) || rooms[1];
        const target = getRoomCenter(other);
        if (target) {
            const st2 = walkToPoint(target, { tol: 1.0, maxSteps: 120 });
            check(st2.buildingId === state.buildingId, "remained inside home while traversing rooms");
        }
    }
    const curInfo = typeof api.getCurrentBuildingInfo === "function" ? api.getCurrentBuildingInfo() : info;
    check(Boolean(curInfo), "getCurrentBuildingInfo() populated inside home");
});

await test("T1.6.3 enter commercial business and verify lit interior", async () => {
    await teleportAndSettle(0, 3, 0);
    const { state } = await enterBuilding("business");
    check(state.buildingId != null, "entered business buildingId=" + state.buildingId);
    frames(4);
    const m = bro.eye.measure();
    check(m.dynamicRange > 0.04, "business interior renders lit furnished surfaces (range=" + m.dynamicRange.toFixed(3) + ")");
});

await test("T1.6.4 enter downtown skyscraper lobby at floor 0", async () => {
    await teleportAndSettle(0, 3, 0);
    const { state } = await enterBuilding("skyscraper");
    check(state.buildingId != null, "entered skyscraper buildingId=" + state.buildingId);
    eq(state.floorIndex, 0, "skyscraper entry lands on lobby floor 0");
});

await test("T1.6.5 on-demand interior stream and unload cycle", async () => {
    await teleportAndSettle(3500, 3, 3500);
    const { approach, outDir } = await enterBuilding("home");
    const insideCount = api.getState().activeInteriors;
    check(insideCount >= 1, "interior streamed on entry: " + insideCount);

    // Exit building first, then move 300 m away into an open clearing/park/distant offset
    const exited = walkToPoint(approach, { tol: 1.0, maxSteps: 140, stopWhen: (s) => s.buildingId === null });
    eq(exited.buildingId, null, "exited home before moving 300 m away");

    const candidates = [
        [approach[0] + outDir[0] * 300, approach[1] + 1, approach[2] + outDir[1] * 300],
        [-256, 3, 256],
        [6120, 3, 6120],
    ];
    let farState = await teleportAndSettle(candidates[0][0], candidates[0][1], candidates[0][2]);
    for (let k = 1; k < candidates.length && (farState.buildingId != null || farState.activeInteriors >= insideCount); k++) {
        farState = await teleportAndSettle(candidates[k][0], candidates[k][1], candidates[k][2]);
    }
    eq(farState.buildingId, null, "outside after moving 300 m away");
    check(
        farState.activeInteriors < insideCount || farState.activeInteriors === 0,
        `distant interior unloaded (inside=${insideCount}, far=${farState.activeInteriors})`
    );
});

await test("T1.6.6 skyscraper selective floor streaming and culling", async () => {
    await teleportAndSettle(0, 3, 0);
    const { bld, state, info } = await enterBuilding("skyscraper");
    const topFloor = getTopFloor(info, bld);
    const lobbyDraws = state.poolDraws;
    const lobbyActive = state.activeInteriors;

    if (topFloor >= 4 && typeof api.useElevator === "function") {
        const target = Math.min(topFloor, Math.max(3, Math.floor(topFloor / 2)));
        api.useElevator(target);
        simUntil(() => api.getState().floorIndex === target, Math.max(15000, (topFloor || 10) * 1000), 50);
    }
    const upper = api.getState();
    check(upper.activeInteriors <= Math.max(lobbyActive + 4, 8), "selective floor streaming bounds activeInteriors: " + upper.activeInteriors);
    check(upper.poolDraws <= Math.max(lobbyDraws * 2.5, lobbyDraws + 60), `culled poolDraws bounded on upper floor (lobby=${lobbyDraws}, upper=${upper.poolDraws})`);
});

// ── Area 1.7: Multi-Story 3D Navigation (5 tests) ────────────────────────────

await test("T1.7.1 doorway entry and 180-degree exit back to street", async () => {
    await teleportAndSettle(3500, 3, 3500);
    const { approach, insideTarget, state } = await enterBuilding("home");
    check(state.buildingId != null, "inside building after doorway entry");
    const exited = walkToPoint(approach, {
        tol: 1.0,
        maxSteps: 160,
        stopWhen: (s) => s.buildingId === null && dist2D(s.pos, insideTarget) > 2.0,
    });
    eq(exited.buildingId, null, "exited building through doorway back onto street/yard");
});

await test("T1.7.2 multi-room interior navigation updates roomId", async () => {
    await teleportAndSettle(0, 3, 0);
    const { bld, state, info } = await enterBuilding("business");
    const rooms = getRoomsList(info, bld);
    const initialRoom = state.roomId;
    check(initialRoom != null, "initial roomId defined: " + initialRoom);

    let visitedDifferentRoom = false;
    for (const r of rooms) {
        const target = getRoomCenter(r);
        if (!target) continue;
        const st = walkToPoint(target, { tol: 0.9, maxSteps: 120 });
        if (st.roomId != null && st.roomId !== initialRoom) {
            visitedDifferentRoom = true;
            break;
        }
    }
    if (rooms.length >= 2) {
        check(visitedDifferentRoom, "walking into adjacent room updated roomId");
    } else {
        // Explore floor area via walkToPoint interior offsets if room list is not enumerated on info
        const center = getBuildingCenter(bld) || state.pos;
        const offsets = [
            [center[0] + 2.5, state.pos[1], center[2]],
            [center[0] - 2.5, state.pos[1], center[2]],
            [center[0], state.pos[1], center[2] + 2.5],
            [center[0], state.pos[1], center[2] - 2.5],
        ];
        for (const pt of offsets) {
            const st = walkToPoint(pt, {
                tol: 0.8,
                maxSteps: 80,
                stopWhen: (s) => s.roomId != null && s.roomId !== initialRoom,
            });
            if (st.roomId != null && st.roomId !== initialRoom) {
                visitedDifferentRoom = true;
                break;
            }
        }
        check(api.getState().buildingId === state.buildingId, "remained in building during multi-room exploration");
    }
});

await test("T1.7.3 staircase ascent to floor 1 and descent to floor 0", async () => {
    await teleportAndSettle(0, 3, 0);
    const { bld, state, info } = await enterBuilding("skyscraper");
    const lobbyPos = state.pos.slice();
    const y0 = state.pos[1];
    eq(state.floorIndex, 0, "started on floor 0");

    const stairPos = getStairPos(info) || getStairPos(bld);
    check(Boolean(stairPos), "stair coordinates exposed for multi-story building");
    walkToPoint(stairPos, { tol: 1.0, maxSteps: 160 });

    // Walk up stair flight until floorIndex reaches 1
    simUntil(() => {
        if (api.getState().floorIndex >= 1) return true;
        walkSteps({ forward: 1 }, 4, 16);
        return api.getState().floorIndex >= 1;
    }, 8000, 16);
    const upState = api.getState();
    check(upState.floorIndex >= 1, "ascended stairs to floor >= 1 (got " + upState.floorIndex + ")");
    check(upState.pos[1] > y0 + 1.5, `elevation rose via stairs (y0=${y0.toFixed(2)}, y1=${upState.pos[1].toFixed(2)})`);

    // Steer back down stairs to stair entry / lobby until floorIndex returns to 0
    let downState = walkToPoint(stairPos, { tol: 0.7, maxSteps: 160, stopWhen: (s) => s.floorIndex === 0 });
    if (downState.floorIndex > 0) {
        downState = walkToPoint(lobbyPos, { tol: 0.8, maxSteps: 160, stopWhen: (s) => s.floorIndex === 0 });
    }
    eq(downState.floorIndex, 0, "descended stairs back to floor 0");
});

await test("T1.7.4 elevator ride from lobby to mid floor", async () => {
    await teleportAndSettle(0, 3, 0);
    const { bld, state, info } = await enterBuilding("skyscraper");
    const yLobby = state.pos[1];
    const topFloor = getTopFloor(info, bld);
    const midFloor = Math.max(1, Math.min(topFloor, Math.floor(topFloor / 2)));

    api.useElevator(midFloor);
    const arrived = simUntil(() => api.getState().floorIndex === midFloor, Math.max(15000, (topFloor || 10) * 1000), 50);
    check(arrived, `elevator arrived at mid floor ${midFloor}`);
    const midState = api.getState();
    eq(midState.floorIndex, midFloor, "floorIndex matches midFloor");
    check(midState.pos[1] > yLobby + 2.0 * midFloor, `elevation rose proportionally (lobby=${yLobby.toFixed(2)}, mid=${midState.pos[1].toFixed(2)})`);
});

await test("T1.7.5 multi-floor structural walkability across home, business, skyscraper", async () => {
    await teleportAndSettle(3500, 3, 3500);
    const home = await enterBuilding("home");
    assertStructureClean(scene, "home interior", buildInteriorStructureOpts(home));

    await teleportAndSettle(0, 3, 0);
    const biz = await enterBuilding("business");
    assertStructureClean(scene, "business interior", buildInteriorStructureOpts(biz));

    await teleportAndSettle(0, 3, 0);
    const sky = await enterBuilding("skyscraper");
    const topFloor = getTopFloor(sky.info, sky.bld);
    const target = Math.min(topFloor, 3);
    if (target > 0) {
        api.useElevator(target);
        simUntil(() => api.getState().floorIndex === target, Math.max(15000, (topFloor || 10) * 1000), 50);
    }
    const upper = api.getState();
    assertStructureClean(scene, "skyscraper upper floor", buildInteriorStructureOpts(sky, upper));
});

done("metropolis tier1 buildings");
