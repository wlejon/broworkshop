// Metropolis — 120 km² Streamed City & Suburbs (Milestone M4: Traffic, Cars, Traversal Modes & Integration).
import { boot } from '/lib/kit/app.js';
import { initPerfDefaults, applyScenePerfBudget, beginPerfFrame, endPerfFrame, getPerfSnapshot } from '/app/world/perf_budget.js';
import { createPoolRegistry } from '/app/world/instance_pool.js';
import * as layout from '/app/world/city_layout.js';
import { createTerrainTiles } from '/app/world/terrain_tiles.js';
import { createHorizonVoxels } from '/app/world/horizon_voxels.js';
import { createAtmosphereCycle } from '/app/world/atmosphere_cycle.js';
import { getBuildingBlueprint, localToWorld } from '/app/buildings/building_gen.js';
import { createInteriorStreamer } from '/app/buildings/interior_streamer.js';
import { createElevators } from '/app/buildings/elevators.js';
import { createBuildingCollision } from '/app/buildings/building_collision.js';
import { registerCarBatches } from '/app/traffic/vehicle_meshes.js';
import { createAmbientTraffic } from '/app/traffic/ambient_traffic.js';
import { createDriveableCar } from '/app/traffic/driveable_car.js';
import { createStreetscape } from '/app/world/streetscape.js';
import { createHud } from '/app/player/hud.js';
import { createTraversalController } from '/app/player/traversal_modes.js';

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

function rotateLocalNormal(rot, nx, nz) {
    const c = Math.cos(rot), s = Math.sin(rot);
    return [c * nx + s * nz, 0, -s * nx + c * nz];
}

initPerfDefaults();
const app = boot({ menu: false });
const canvas = document.getElementById('stage');
const scene = canvas?.getContext?.('scene') ?? null;
const backendOk = Boolean(scene && typeof bro !== 'undefined' && bro.tiles && bro.voxeldag && bro.kernel?.gpu);

if (!backendOk) {
    const unavailEl = document.getElementById('unavailable');
    if (unavailEl) unavailEl.hidden = false;
    app.status.warn('backend unavailable');
    globalThis.__metropolis = {
        ready: false,
        scene: null,
        whenReady: () => Promise.resolve(false),
        getState: () => ({ available: false, ready: false }),
    };
} else {
    applyScenePerfBudget(scene, 4.0);

    const pools = createPoolRegistry(scene);
    const streetscape = createStreetscape(scene, pools, layout);
    const carBatches = registerCarBatches(pools);

    const terrain = createTerrainTiles(scene, layout);
    const horizon = createHorizonVoxels(scene, layout);
    const atmo = createAtmosphereCycle(scene);
    const streamer = createInteriorStreamer(scene, pools, layout, horizon);
    const elevators = createElevators(streamer);
    const collision = createBuildingCollision(streamer, layout, elevators);
    const ambientTraffic = createAmbientTraffic(carBatches);
    const driveCar = createDriveableCar(carBatches, collision, ambientTraffic, streetscape);

    // Pre-warm all instance batches (including traffic & cars) before async wait
    pools.warmAll();

    let lastLod = horizon.update([0, 30, 24], 28);
    let simTime = 0;
    let warmFramesLeft = 2;
    let subsystemsReady = false;
    let isReady = false;
    let resolveReady = null;
    const readyPromise = new Promise((resolve) => {
        resolveReady = resolve;
    });

    function buildHudSnapshot() {
        const p = getPerfSnapshot();
        const t = terrain.getStats();
        const a = atmo.getState();
        const bs = streamer.getStats();
        const pos = ctrl.camPos;
        const groundY = layout.sampleGroundHeight(pos[0], pos[2]);
        return {
            mode: ctrl.getMode(),
            timeMode: a.mode,
            timeHours: a.timeHours,
            emissiveScale: a.emissiveScale,
            inCar: driveCar.isInCar(),
            speed: ctrl.getSpeed(),
            pos,
            alt: Math.max(0, pos[1] - groundY),
            zone: layout.sampleDistrict(pos[0], pos[2]).zone,
            buildingId: ctrl.activeWalkInfo.buildingId,
            floorIndex: ctrl.activeWalkInfo.floorIndex,
            activeInteriors: bs.activeInteriors,
            trafficCount: ambientTraffic.getCount(),
            lod: lastLod,
            perf: p,
            tiles: t,
        };
    }

    const hud = createHud({
        onSetMode: (m) => ctrl.setMode(m),
        onSetTimeMode: (t) => setTimeMode(t),
    });

    const ctrl = createTraversalController({
        canvas,
        layout,
        streamer,
        elevators,
        collision,
        driveCar,
        hud,
        onStateChange: () => hud.update(buildHudSnapshot(), true),
    });

    function setTimeMode(m) {
        const s = atmo.setPreset(m);
        hud.syncTod(s.mode);
        hud.update(buildHudSnapshot(), true);
        return s;
    }

    function setTimeOfDay(hours) {
        const s = atmo.setTimeOfDay(hours);
        hud.syncTod(s.mode);
        hud.update(buildHudSnapshot(), true);
        return s;
    }

    ctrl.attachInputHandlers(setTimeMode);
    hud.syncMode(ctrl.getMode());
    hud.syncTod(atmo.getState().mode);

    function tryMarkReady() {
        if (!isReady && subsystemsReady && warmFramesLeft <= 0) {
            isReady = true;
            app.status.ok('ready');
            hud.update(buildHudSnapshot(), true);
            if (resolveReady) {
                const resolve = resolveReady;
                resolveReady = null;
                resolve(globalThis.__metropolis);
            }
        }
    }

    Promise.all([
        terrain.whenReady(),
        pools.whenReady(),
        horizon.whenReady(),
    ]).then(() => {
        subsystemsReady = true;
        tryMarkReady();
    });

    function populateNearbyInstances(lod, altitude) {
        pools.beginAll();
        const atmoState = atmo.getState();
        const camPos = ctrl.camPos;

        let floorHint = ctrl.activeWalkInfo.floorIndex;
        if (ctrl.activeWalkInfo.buildingId && ctrl.activeWalkInfo.inElevator) {
            const bp = streamer.getBlueprintById(ctrl.activeWalkInfo.buildingId);
            const elevHint = elevators.getActiveFloorHint(bp, ctrl.walkFeet);
            if (elevHint != null) floorHint = elevHint;
        }
        streamer.update(camPos, floorHint, lod, atmoState, elevators, simTime);
        streetscape.update(camPos, altitude);
        ambientTraffic.pushInstances(camPos, altitude, atmoState);
        driveCar.pushInstances(camPos, altitude);

        pools.commitAll();
    }

    function applyCameraAndStreams(dt = 0) {
        ctrl.updateBasis();
        const camPos = ctrl.camPos;
        const groundY = layout.sampleGroundHeight(camPos[0], camPos[2]);
        if (ctrl.getMode() === 'fly') {
            const minEyeY = groundY + 1.65;
            if (camPos[1] < minEyeY) camPos[1] = minEyeY;
        }
        const altitude = Math.max(0, camPos[1] - groundY);

        const vw = canvas.clientWidth || 1600;
        const vh = canvas.clientHeight || 960;
        const near = altitude > 250 ? 0.8 : 0.20;
        scene.setCamera({
            eye: [0, 0, 0],
            target: ctrl.camFwd,
            up: ctrl.camUp,
            fov: 60,
            near,
            far: 16000,
            origin: camPos,
        });

        terrain.update(camPos, ctrl.camFwd, ctrl.camUp, { width: vw, height: vh, fov: 60 }, simTime);
        lastLod = horizon.update(camPos, altitude);
        populateNearbyInstances(lastLod, altitude);
        atmo.update(dt);
    }

    function step(dtSec = 1 / 60) {
        const dt = clamp(dtSec, 0, 0.1);
        simTime += dt;
        beginPerfFrame();
        elevators.update(dt);
        ctrl.stepMovement(dt);
        ambientTraffic.update(dt, ctrl.camPos, driveCar.getCarState());
        applyCameraAndStreams(dt);
        endPerfFrame();
        if (warmFramesLeft > 0) {
            warmFramesLeft--;
            tryMarkReady();
        }
        hud.update(buildHudSnapshot(), false);
    }

    function teleport(x, y, z, newYaw, newPitch) {
        ctrl.teleport(x, y, z, newYaw, newPitch);
        const camPos = ctrl.camPos;
        const groundY = layout.sampleGroundHeight(camPos[0], camPos[2]);
        const altitude = Math.max(0, camPos[1] - groundY);
        const vw = canvas.clientWidth || 1600;
        const vh = canvas.clientHeight || 960;
        scene.setCamera({
            eye: [0, 0, 0],
            target: ctrl.camFwd,
            up: ctrl.camUp,
            fov: 60,
            near: Math.max(0.20, altitude > 250 ? 0.8 : 0.20),
            far: 16000,
            origin: camPos,
        });
        terrain.forceUpdate(camPos, ctrl.camFwd, ctrl.camUp, { width: vw, height: vh, fov: 60 });
        lastLod = horizon.update(camPos, altitude);
        ambientTraffic.update(0, camPos, driveCar.getCarState());
        ctrl.refreshActiveBuildingInfo();
        populateNearbyInstances(lastLod, altitude);
        hud.update(buildHudSnapshot(), true);
        return getState();
    }

    function buildFloorMetadata(bp, floorIdx) {
        const fl = bp.floors[floorIdx];
        if (!fl) return { rooms: [], doors: [], stairs: [], furniture: [] };
        const rooms = fl.rooms.map((rm) => ({
            id: rm.id,
            role: rm.role,
            center: localToWorld(bp, 0.5 * (rm.x0 + rm.x1), fl.yBase, 0.5 * (rm.z0 + rm.z1)),
        }));
        const doors = fl.doors.map((d) => ({
            position: localToWorld(bp, d.x, fl.yBase, d.z),
            normal: rotateLocalNormal(bp.rot, d.nx, d.nz),
            width: d.width,
            height: d.height,
            depth: 0.8,
            kind: d.kind,
        }));
        const stairs = fl.stairs.map((st) => {
            const start = localToWorld(bp, st.cx, fl.yBase, st.z0);
            const end = localToWorld(bp, st.cx, fl.yCeil, st.z1);
            const dir = st.dir ?? 1;
            const entry = localToWorld(bp, st.cx, fl.yBase + 0.35, st.z0 + dir * 1.2);
            return {
                pos: entry,
                start,
                end,
                bottom: start,
                top: end,
                width: st.width,
                headroom: 2.1,
            };
        });
        const furniture = fl.furniture.map((fn) => ({
            type: fn.type,
            pos: localToWorld(bp, fn.x, fl.yBase, fn.z),
        }));
        return { rooms, doors, stairs, furniture };
    }

    function describeBuildingTarget(bp, dist) {
        const fd = bp.frontDoorLocal;
        const doorway = localToWorld(bp, fd.x, bp.baseY, fd.z);
        const outsidePos = localToWorld(bp, fd.x, bp.parcel.padY, fd.z + 3.8);
        const insidePos = localToWorld(bp, fd.x, bp.baseY, fd.z - 2.4);
        const meta = buildFloorMetadata(bp, 0);
        const floors = bp.floors.map((fl) => ({ index: fl.index, yBase: fl.yBase, name: `floor_${fl.index}` }));

        let elevatorsList = [];
        let elevatorPos = null;
        if (bp.elevatorShaft) {
            const sh = bp.elevatorShaft;
            const est = elevators.getState(bp.id);
            elevatorPos = localToWorld(bp, sh.doorX, bp.baseY, sh.doorZ + 1.4);
            elevatorsList = [{
                pos: elevatorPos,
                cabCenter: localToWorld(bp, sh.cx, est ? est.currentY : bp.baseY, sh.cz),
                minFloor: 0,
                maxFloor: bp.totalFloors - 1,
            }];
        }

        return {
            id: bp.id,
            kind: bp.kind,
            distance: dist,
            center: [bp.originX, bp.baseY, bp.originZ],
            width: bp.width,
            depth: bp.depth,
            baseY: bp.baseY,
            floorHeight: bp.floorHeight,
            floors,
            doorway,
            outsidePos,
            insidePos,
            normal: [-Math.sin(bp.rot), 0, -Math.cos(bp.rot)],
            stairPos: meta.stairs.length > 0 ? meta.stairs[0].pos : null,
            stairs: meta.stairs,
            elevatorPos,
            elevators: elevatorsList,
            rooms: meta.rooms,
            doors: meta.doors,
            doorways: meta.doors,
            furniture: meta.furniture,
        };
    }

    function getNearestBuilding(kind) {
        const camPos = ctrl.camPos;
        const searchCenters = [[camPos[0], camPos[2]]];
        if (kind === 'skyscraper') searchCenters.push([0, 0]);
        else if (kind === 'business') searchCenters.push([1500, 0]);
        else if (kind === 'home') searchCenters.push([3200, 0]);

        let bestParcel = null;
        let bestDist = Infinity;

        for (let ci = 0; ci < searchCenters.length; ci++) {
            const [sx, sz] = searchCenters[ci];
            const [bx0, bz0] = layout.worldToBlock(sx, sz);
            for (let rad = 0; rad <= 6 && !bestParcel; rad++) {
                for (let bz = bz0 - rad; bz <= bz0 + rad; bz++) {
                    for (let bx = bx0 - rad; bx <= bx0 + rad; bx++) {
                        if (Math.abs(bx - bx0) !== rad && Math.abs(bz - bz0) !== rad) continue;
                        const parcels = layout.getParcelsInBlock(bx, bz);
                        for (let i = 0; i < parcels.length; i++) {
                            const p = parcels[i];
                            if (p.kind === 'park') continue;
                            if (kind && p.kind !== kind) continue;
                            const d = Math.hypot(p.cx - camPos[0], p.cz - camPos[2]);
                            if (d < bestDist) {
                                bestDist = d;
                                bestParcel = p;
                            }
                        }
                    }
                }
            }
            if (bestParcel) break;
        }
        if (!bestParcel) return null;
        return describeBuildingTarget(getBuildingBlueprint(bestParcel), bestDist);
    }

    function getCurrentBuildingInfo() {
        const probePos = ctrl.getMode() === 'walk'
            ? [ctrl.walkFeet[0], ctrl.walkFeet[1] + 0.25, ctrl.walkFeet[2]]
            : ctrl.camPos;
        const act = streamer.getActiveBuilding(probePos);
        if (!act) {
            return {
                inside: false,
                buildingId: null,
                kind: null,
                floorIndex: 0,
                roomId: null,
                roomRole: null,
                floors: [],
                floorYBase: null,
                inElevator: false,
                elevator: null,
            };
        }
        const bp = act.blueprint;
        const fl = bp.floors[act.floorIndex];
        const meta = buildFloorMetadata(bp, act.floorIndex);
        const floors = bp.floors.map((f) => ({ index: f.index, yBase: f.yBase, name: `floor_${f.index}` }));
        let elevatorPos = null;
        let elevatorsList = [];
        if (bp.elevatorShaft) {
            const sh = bp.elevatorShaft;
            const est = elevators.getState(bp.id);
            elevatorPos = localToWorld(bp, sh.doorX, fl ? fl.yBase : bp.baseY, sh.doorZ + 1.4);
            elevatorsList = [{
                pos: elevatorPos,
                cabCenter: localToWorld(bp, sh.cx, est ? est.currentY : bp.baseY, sh.cz),
                minFloor: 0,
                maxFloor: bp.totalFloors - 1,
            }];
        }
        return {
            inside: act.inside,
            buildingId: act.buildingId,
            kind: act.kind,
            width: bp.width,
            depth: bp.depth,
            baseY: bp.baseY,
            floorHeight: bp.floorHeight,
            floorIndex: act.floorIndex,
            floorY: fl ? fl.yBase : bp.baseY,
            floorYBase: fl ? fl.yBase : bp.baseY,
            roomId: act.roomId,
            roomRole: act.roomRole,
            floors,
            rooms: meta.rooms,
            doors: meta.doors,
            doorways: meta.doors,
            stairs: meta.stairs,
            stairPos: meta.stairs.length > 0 ? meta.stairs[0].pos : null,
            furniture: meta.furniture,
            inElevator: ctrl.activeWalkInfo.inElevator,
            elevator: elevators.getState(bp.id),
            elevatorPos,
            elevators: elevatorsList,
        };
    }

    function useElevator(targetFloor) {
        if (ctrl.getMode() !== 'walk') {
            return { ok: false, reason: 'not_in_walk_mode' };
        }
        ctrl.refreshActiveBuildingInfo();
        const bid = ctrl.activeWalkInfo.buildingId;
        if (!bid) return { ok: false, reason: 'not_in_building' };
        const bp = streamer.getBlueprintById(bid);
        if (!bp || !bp.elevatorShaft) return { ok: false, reason: 'no_elevator', buildingId: bid };
        const clamped = clamp(Math.round(Number(targetFloor) || 0), 0, bp.totalFloors - 1);
        if (!ctrl.activeWalkInfo.inElevator) {
            if (clamped === ctrl.activeWalkInfo.floorIndex) {
                return { ok: true, buildingId: bid, targetFloor: clamped, currentFloor: clamped, noOp: true };
            }
            ctrl.boardElevatorIfNeeded(bp, clamped);
        }
        return collision.callOrRideElevator(bid, clamped);
    }

    function getState() {
        const camPos = ctrl.camPos;
        const groundY = layout.sampleGroundHeight(camPos[0], camPos[2]);
        const altitude = Math.max(0, camPos[1] - groundY);
        const a = atmo.getState();
        const ps = pools.stats();
        const bs = streamer.getStats();
        return {
            available: true,
            ready: isReady,
            pos: camPos.slice(),
            yaw: ctrl.getYaw(),
            pitch: ctrl.getPitch(),
            mode: ctrl.getMode(),
            speed: ctrl.getSpeed(),
            inCar: driveCar.isInCar(),
            timeMode: a.mode,
            timeHours: a.timeHours,
            nightFactor: a.nightFactor,
            emissiveScale: a.emissiveScale,
            altitude,
            groundY,
            district: layout.sampleDistrict(camPos[0], camPos[2]).zone,
            buildingId: ctrl.activeWalkInfo.buildingId,
            floorIndex: ctrl.activeWalkInfo.floorIndex,
            roomId: ctrl.activeWalkInfo.roomId,
            inElevator: ctrl.activeWalkInfo.inElevator,
            trafficCount: ambientTraffic.getCount(),
            activeInteriors: bs.activeInteriors,
            poolDraws: ps.drawCalls,
            buildingStats: bs,
            lod: { ...lastLod },
            perf: { ...getPerfSnapshot() },
            poolStats: ps,
            tiles: terrain.getStats(),
            voxelStats: horizon.stats(),
        };
    }

    globalThis.__metropolis = {
        get ready() { return isReady; },
        scene,
        whenReady: () => readyPromise,
        setMode: ctrl.setMode,
        getMode: ctrl.getMode,
        setWalkInput: ctrl.setWalkInput,
        enterNearestCar: ctrl.enterNearestCar,
        exitCar: ctrl.exitCar,
        setDriveInput: (opts) => {
            ctrl.clearKeyboardDrive();
            driveCar.setInput(opts);
        },
        teleport,
        setTimeMode,
        setTimeOfDay,
        getTimeMode: () => atmo.getState().mode,
        getNearestBuilding,
        getCurrentBuildingInfo,
        useElevator,
        step,
        getState,
        _subsystems: {
            scene, layout, terrain, horizon, atmosphere: atmo, pools,
            streamer, elevators, collision, ambientTraffic, driveCar,
            getBuildingBlueprint,
        },
    };

    // Initial synchronous setup + rAF loop
    ambientTraffic.update(0, ctrl.camPos, driveCar.getCarState());
    applyCameraAndStreams(0);
    let lastRafMs = performance.now();
    function rafLoop(now) {
        const dt = clamp((now - lastRafMs) / 1000, 0, 0.05);
        lastRafMs = now;
        step(dt);
        requestAnimationFrame(rafLoop);
    }
    requestAnimationFrame(rafLoop);
}
