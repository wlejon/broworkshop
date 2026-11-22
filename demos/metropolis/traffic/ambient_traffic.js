// Pre-warmed zero-churn streamed ambient road-following traffic across the 120 km^2 city & suburbs.
import * as layout from '/app/world/city_layout.js';
import {
    CAR_PALETTES,
    getBlockParkedCars,
    getLaneSpec,
    getSpawnSegmentsNear,
    laneCoord,
    sampleSlopeTransform,
    yawForAxisDir,
} from '/app/traffic/road_network.js';
import { pushCarVisual } from '/app/traffic/vehicle_meshes.js';

const MAX_TRAFFIC = 56;
const STREAM_RADIUS = 275;
const RECYCLE_RADIUS = 295;
const FLYOVER_CULL_ALT = 280;

function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
}

export function createAmbientTraffic(batches) {
    const vehicles = new Array(MAX_TRAFFIC);
    for (let i = 0; i < MAX_TRAFFIC; i++) {
        vehicles[i] = {
            active: false,
            axis: 'z',
            lineIdx: 0,
            perpIdx: 0,
            dir: -1,
            laneIdx: 0,
            roadKind: 'avenue',
            s: 0,
            wx: 0,
            wy: 2,
            wz: 0,
            yaw: 0,
            pitch: 0,
            roll: 0,
            speed: 0,
            maxSpeed: 14,
            wheelSpin: 0,
            wheelSteer: 0,
            color: CAR_PALETTES[i % CAR_PALETTES.length],
            seed: i * 977 + 13,
        };
    }

    let initialized = false;
    let lastSpawnX = NaN;
    let lastSpawnZ = NaN;
    let activeCount = 0;

    function placeVehicleOnSegment(v, seg, dir, laneIdx, s, skipDistCheckCam) {
        const lineCoord = seg.lineCoord;
        const coordAcross = laneCoord(lineCoord, seg.roadKind, seg.axis, dir, laneIdx);
        const wx = seg.axis === 'z' ? coordAcross : s;
        const wz = seg.axis === 'z' ? s : coordAcross;
        if (skipDistCheckCam && Math.hypot(wx - skipDistCheckCam[0], wz - skipDistCheckCam[2]) < 14.0) {
            return false;
        }
        // Avoid spawning on top of another active vehicle or parked car
        for (let i = 0; i < MAX_TRAFFIC; i++) {
            const o = vehicles[i];
            if (o === v || !o.active) continue;
            if (Math.hypot(o.wx - wx, o.wz - wz) < 10.5) return false;
        }
        const pbx0 = Math.floor(wx / layout.BLOCK_SIZE);
        const pbz0 = Math.floor(wz / layout.BLOCK_SIZE);
        for (let bz = pbz0 - 1; bz <= pbz0 + 1; bz++) {
            for (let bx = pbx0 - 1; bx <= pbx0 + 1; bx++) {
                const parked = getBlockParkedCars(bx, bz);
                for (let j = 0; j < parked.length; j++) {
                    if (Math.hypot(parked[j].wx - wx, parked[j].wz - wz) < 5.5) return false;
                }
            }
        }

        const yaw = yawForAxisDir(seg.axis, dir);
        const slope = sampleSlopeTransform(wx, wz, yaw);
        v.active = true;
        v.axis = seg.axis;
        v.lineIdx = seg.lineIdx;
        v.perpIdx = seg.perpIdx;
        v.dir = dir;
        v.laneIdx = laneIdx;
        v.roadKind = seg.roadKind;
        v.s = s;
        v.wx = wx;
        v.wy = slope.y;
        v.wz = wz;
        v.yaw = yaw;
        v.pitch = slope.pitch;
        v.roll = slope.roll;
        v.maxSpeed = seg.spec.speedLimit * (0.68 + 0.16 * ((v.seed % 5) / 4));
        v.speed = v.maxSpeed * 0.8;
        v.wheelSteer = 0;
        return true;
    }

    function populateNear(camPos, forceAll = false) {
        const segs = getSpawnSegmentsNear(camPos, 24, 255);
        if (segs.length === 0) return;

        let count = 0;
        for (let i = 0; i < MAX_TRAFFIC; i++) {
            const v = vehicles[i];
            if (!forceAll && v.active) {
                const d = Math.hypot(v.wx - camPos[0], v.wz - camPos[2]);
                if (d <= RECYCLE_RADIUS) {
                    count++;
                    continue;
                }
            }
            v.active = false;
            let placed = false;
            for (let attempt = 0; attempt < 8 && !placed; attempt++) {
                const segIdx = (i * 7 + attempt * 13 + Math.floor(Math.abs(camPos[0] + camPos[2]))) % segs.length;
                const seg = segs[segIdx];
                const dir = ((i + attempt) & 1) === 0 ? -1 : 1;
                const laneIdx = (i + attempt) % seg.spec.offsets.length;
                const frac = 0.12 + 0.76 * (((i * 37 + attempt * 53) % 100) / 100);
                const s = seg.startS + frac * (seg.endS - seg.startS);
                placed = placeVehicleOnSegment(v, seg, dir, laneIdx, s, camPos);
            }
            if (placed) count++;
        }
        activeCount = count;
        lastSpawnX = camPos[0];
        lastSpawnZ = camPos[2];
        initialized = true;
    }

    function advanceIntersection(v) {
        const crossIdx = v.dir > 0 ? v.perpIdx + 1 : v.perpIdx;
        if (crossIdx <= layout.BLOCK_MIN || crossIdx >= layout.BLOCK_MAX) {
            v.dir = -v.dir;
            v.yaw = yawForAxisDir(v.axis, v.dir);
            return;
        }
        const h = layout.hash2f(v.lineIdx * 13 + v.seed, crossIdx * 17 + v.laneIdx, 701);
        if (h < 0.72) {
            // Continue straight into next block
            v.perpIdx += v.dir;
            v.roadKind = layout.roadKindForLine(v.lineIdx, v.perpIdx);
            const spec = getLaneSpec(v.roadKind);
            v.laneIdx = Math.min(v.laneIdx, spec.offsets.length - 1);
            v.maxSpeed = spec.speedLimit * 0.76;
        } else {
            // Smooth turn onto cross street (update axis & snap to intersection lane exit)
            const turnRight = h < 0.86;
            const oldAxis = v.axis;
            const oldDir = v.dir;
            const newAxis = oldAxis === 'z' ? 'x' : 'z';
            let newDir;
            if (oldAxis === 'z') {
                newDir = turnRight ? (oldDir < 0 ? 1 : -1) : (oldDir < 0 ? -1 : 1);
            } else {
                newDir = turnRight ? (oldDir > 0 ? 1 : -1) : (oldDir > 0 ? -1 : 1);
            }
            const newLineIdx = crossIdx;
            const newPerpIdx = v.lineIdx - (newDir < 0 ? 1 : 0);
            const newKind = layout.roadKindForLine(newLineIdx, newPerpIdx);
            const spec = getLaneSpec(newKind);
            const oldLineIdx = v.lineIdx;
            v.axis = newAxis;
            v.lineIdx = newLineIdx;
            v.perpIdx = clamp(newPerpIdx, layout.BLOCK_MIN + 1, layout.BLOCK_MAX - 1);
            v.dir = newDir;
            v.roadKind = newKind;
            v.laneIdx = Math.min(v.laneIdx, spec.offsets.length - 1);
            const perpLineCoord = oldLineIdx * layout.BLOCK_SIZE;
            v.s = perpLineCoord + v.dir * (spec.halfWidth + 2.0);
            v.maxSpeed = spec.speedLimit * 0.72;
        }
    }

    function computeDesiredGap(v, playerCar) {
        let minAhead = 24.0;
        const fx = -Math.sin(v.yaw);
        const fz = -Math.cos(v.yaw);

        for (let i = 0; i < MAX_TRAFFIC; i++) {
            const o = vehicles[i];
            if (o === v || !o.active) continue;
            const dx = o.wx - v.wx;
            const dz = o.wz - v.wz;
            const fwdDist = dx * fx + dz * fz;
            if (fwdDist > 0.5 && fwdDist < minAhead) {
                const latDist = Math.abs(-fz * dx + fx * dz);
                if (latDist < 2.2) minAhead = fwdDist;
            }
        }
        if (playerCar && playerCar.active) {
            const dx = playerCar.wx - v.wx;
            const dz = playerCar.wz - v.wz;
            const fwdDist = dx * fx + dz * fz;
            if (fwdDist > 0.5 && fwdDist < minAhead) {
                const latDist = Math.abs(-fz * dx + fx * dz);
                if (latDist < 2.4) minAhead = fwdDist;
            }
        }
        const bx0 = Math.floor(v.wx / layout.BLOCK_SIZE);
        const bz0 = Math.floor(v.wz / layout.BLOCK_SIZE);
        for (let bz = bz0 - 1; bz <= bz0 + 1; bz++) {
            for (let bx = bx0 - 1; bx <= bx0 + 1; bx++) {
                const parked = getBlockParkedCars(bx, bz);
                for (let j = 0; j < parked.length; j++) {
                    const pk = parked[j];
                    const dx = pk.wx - v.wx;
                    const dz = pk.wz - v.wz;
                    const fwdDist = dx * fx + dz * fz;
                    if (fwdDist > 0.5 && fwdDist < minAhead) {
                        const latDist = Math.abs(-fz * dx + fx * dz);
                        if (latDist < 2.15) minAhead = fwdDist;
                    }
                }
            }
        }
        return minAhead;
    }

    function update(dt, camPos, playerCar = null) {
        const teleported = !initialized || Math.hypot(camPos[0] - lastSpawnX, camPos[2] - lastSpawnZ) > 220;
        if (teleported) {
            populateNear(camPos, true);
        }

        const stepDt = clamp(dt, 0, 0.05);
        let needsRecycle = false;
        let count = 0;

        for (let i = 0; i < MAX_TRAFFIC; i++) {
            const v = vehicles[i];
            if (!v.active) {
                needsRecycle = true;
                continue;
            }
            const dCam = Math.hypot(v.wx - camPos[0], v.wz - camPos[2]);
            if (dCam > RECYCLE_RADIUS) {
                v.active = false;
                needsRecycle = true;
                continue;
            }
            count++;

            if (stepDt > 0) {
                const ahead = computeDesiredGap(v, playerCar);
                let targetSpd = v.maxSpeed;
                if (ahead < 8.5) targetSpd = 0;
                else if (ahead < 18.0) targetSpd = v.maxSpeed * ((ahead - 8.5) / 9.5);

                const accel = targetSpd >= v.speed ? 6.5 : 14.0;
                if (v.speed < targetSpd) v.speed = Math.min(targetSpd, v.speed + accel * stepDt);
                else v.speed = Math.max(targetSpd, v.speed - accel * stepDt);

                v.s += v.dir * v.speed * stepDt;
                v.wheelSpin -= (v.speed / 0.32) * stepDt;

                const segMin = v.perpIdx * layout.BLOCK_SIZE;
                const segMax = (v.perpIdx + 1) * layout.BLOCK_SIZE;
                if ((v.dir > 0 && v.s >= segMax - 2.0) || (v.dir < 0 && v.s <= segMin + 2.0)) {
                    const prevYaw = v.yaw;
                    advanceIntersection(v);
                    // Keep yaw smooth via small steering kick (actual yaw snaps only on road change)
                    v.wheelSteer = clamp((v.yaw - prevYaw) * 0.2, -0.35, 0.35);
                } else {
                    v.wheelSteer *= Math.max(0, 1 - stepDt * 6);
                }

                const targetLineCoord = v.lineIdx * layout.BLOCK_SIZE;
                const targetAcross = laneCoord(targetLineCoord, v.roadKind, v.axis, v.dir, v.laneIdx);
                const targetWx = v.axis === 'z' ? targetAcross : v.s;
                const targetWz = v.axis === 'z' ? v.s : targetAcross;
                const targetYaw = yawForAxisDir(v.axis, v.dir);

                const blend = Math.min(1, stepDt * 8.0);
                v.wx += (targetWx - v.wx) * blend;
                v.wz += (targetWz - v.wz) * blend;

                // Shortest-angle yaw lerp
                let dYaw = targetYaw - v.yaw;
                while (dYaw > Math.PI) dYaw -= Math.PI * 2;
                while (dYaw < -Math.PI) dYaw += Math.PI * 2;
                v.yaw += dYaw * Math.min(1, stepDt * 9.0);

                const slope = sampleSlopeTransform(v.wx, v.wz, v.yaw);
                v.wy = slope.y;
                v.pitch = slope.pitch;
                v.roll = slope.roll;
            }
        }

        activeCount = count;
        if (needsRecycle) {
            populateNear(camPos, false);
        }
    }

    function pushInstances(camPos, altitude, _atmoState) {
        if (altitude > FLYOVER_CULL_ALT) return;
        const headTint = [0.95, 0.92, 0.82, 1.0];
        const tailTint = [0.92, 0.16, 0.14, 1.0];
        for (let i = 0; i < MAX_TRAFFIC; i++) {
            const v = vehicles[i];
            if (!v.active) continue;
            if (Math.hypot(v.wx - camPos[0], v.wz - camPos[2]) > STREAM_RADIUS) continue;
            pushCarVisual(batches, camPos, v, headTint, tailTint);
        }
    }

    function resolveCollision(wx, wz, _halfW = 0.95, _halfL = 2.2) {
        let cx = wx;
        let cz = wz;
        let hit = false;
        const minSep = 3.5;
        for (let i = 0; i < MAX_TRAFFIC; i++) {
            const v = vehicles[i];
            if (!v.active) continue;
            const dx = cx - v.wx;
            const dz = cz - v.wz;
            const d = Math.hypot(dx, dz);
            if (d < minSep) {
                hit = true;
                const nx = d > 1e-4 ? dx / d : 1;
                const nz = d > 1e-4 ? dz / d : 0;
                const pen = minSep - d;
                cx += nx * pen * 0.7;
                cz += nz * pen * 0.7;
                v.wx -= nx * pen * 0.3;
                v.wz -= nz * pen * 0.3;
                v.speed = Math.min(v.speed, 2.0);
            }
        }
        return { x: cx, z: cz, hit };
    }

    return {
        update,
        pushInstances,
        resolveCollision,
        getCount: () => activeCount,
        getVehicles: () => vehicles,
    };
}
