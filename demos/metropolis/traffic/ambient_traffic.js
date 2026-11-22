// Pre-warmed zero-churn streamed ambient curved-road traffic across the 120 km^2 city & suburbs.
import * as layout from '/app/world/city_layout.js';
import {
    CAR_PALETTES,
    getBlockParkedCars,
    getLaneSpec,
    getSpawnSegmentsNear,
    laneCoord,
    sampleSlopeTransform,
    yawForGridAxisDir,
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
            archetype: (i * 3) % 4,
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
        const gu = seg.axis === 'z' ? coordAcross : s;
        const gv = seg.axis === 'z' ? s : coordAcross;
        if (layout.riverCorridorInfo(gu, gv).roadSuppress > 0.2) return false;
        const [wx, wz] = layout.gridToWorld(gu, gv);
        if (skipDistCheckCam && Math.hypot(wx - skipDistCheckCam[0], wz - skipDistCheckCam[2]) < 14.0) {
            return false;
        }
        for (let i = 0; i < MAX_TRAFFIC; i++) {
            const o = vehicles[i];
            if (o === v || !o.active) continue;
            if (Math.hypot(o.wx - wx, o.wz - wz) < 10.5) return false;
        }
        const [pbx0, pbz0] = layout.worldToBlock(wx, wz);
        for (let bz = pbz0 - 1; bz <= pbz0 + 1; bz++) {
            for (let bx = pbx0 - 1; bx <= pbx0 + 1; bx++) {
                const parked = getBlockParkedCars(bx, bz);
                for (let j = 0; j < parked.length; j++) {
                    if (Math.hypot(parked[j].wx - wx, parked[j].wz - wz) < 5.5) return false;
                }
            }
        }

        const yaw = yawForGridAxisDir(gu, gv, seg.axis, dir);
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
            return;
        }
        // Check if continuing straight enters a river-suppressed minor segment
        const nextPerp = v.perpIdx + v.dir;
        const nextMid = (nextPerp + 0.5) * layout.BLOCK_SIZE;
        const lineCoord = v.lineIdx * layout.BLOCK_SIZE;
        const nextGu = v.axis === 'z' ? lineCoord : nextMid;
        const nextGv = v.axis === 'z' ? nextMid : lineCoord;
        const nextRiver = layout.riverCorridorInfo(nextGu, nextGv);
        const straightBlocked = v.axis === 'z'
            ? nextRiver.dist < layout.RIVER_HALF_W + 22.0
            : nextRiver.roadSuppress > 0.2;

        const h = layout.hash2f(v.lineIdx * 13 + v.seed, crossIdx * 17 + v.laneIdx, 701);
        if (!straightBlocked && h < 0.72) {
            v.perpIdx = nextPerp;
            v.roadKind = layout.roadKindForLine(v.lineIdx, v.perpIdx);
            const spec = getLaneSpec(v.roadKind);
            v.laneIdx = Math.min(v.laneIdx, spec.offsets.length - 1);
            v.maxSpeed = spec.speedLimit * 0.76;
        } else {
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
        const [bx0, bz0] = layout.worldToBlock(v.wx, v.wz);
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
                    v.wheelSteer = clamp((v.yaw - prevYaw) * 0.2, -0.35, 0.35);
                } else {
                    v.wheelSteer *= Math.max(0, 1 - stepDt * 6);
                }

                const targetLineCoord = v.lineIdx * layout.BLOCK_SIZE;
                const targetAcross = laneCoord(targetLineCoord, v.roadKind, v.axis, v.dir, v.laneIdx);
                const gu = v.axis === 'z' ? targetAcross : v.s;
                const gv = v.axis === 'z' ? v.s : targetAcross;
                const [targetWx, targetWz] = layout.gridToWorld(gu, gv);
                const targetYaw = yawForGridAxisDir(gu, gv, v.axis, v.dir);

                const blend = Math.min(1, stepDt * 8.0);
                v.wx += (targetWx - v.wx) * blend;
                v.wz += (targetWz - v.wz) * blend;

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

    function resolveCollision(wx, wz, halfW = 0.95, halfL = 2.2, yaw = 0) {
        let cx = wx;
        let cz = wz;
        let hit = false;
        const aRx = Math.cos(yaw), aRz = -Math.sin(yaw);
        const aFx = -Math.sin(yaw), aFz = -Math.cos(yaw);
        const bHW = 0.96, bHL = 2.24;
        for (let i = 0; i < MAX_TRAFFIC; i++) {
            const v = vehicles[i];
            if (!v.active) continue;
            const dx = cx - v.wx;
            const dz = cz - v.wz;
            if (dx * dx + dz * dz > 26.0) continue;

            const bRx = Math.cos(v.yaw), bRz = -Math.sin(v.yaw);
            const bFx = -Math.sin(v.yaw), bFz = -Math.cos(v.yaw);
            let minOverlap = Infinity;
            let minNx = 0, minNz = 0;
            let separated = false;
            for (let ai = 0; ai < 4; ai++) {
                const ux = ai === 0 ? aRx : ai === 1 ? aFx : ai === 2 ? bRx : bFx;
                const uz = ai === 0 ? aRz : ai === 1 ? aFz : ai === 2 ? bRz : bFz;
                const dist = Math.abs(dx * ux + dz * uz);
                const projA = halfW * Math.abs(aRx * ux + aRz * uz) + halfL * Math.abs(aFx * ux + aFz * uz);
                const projB = bHW * Math.abs(bRx * ux + bRz * uz) + bHL * Math.abs(bFx * ux + bFz * uz);
                const overlap = (projA + projB) - dist;
                if (overlap <= 0) {
                    separated = true;
                    break;
                }
                if (overlap < minOverlap) {
                    minOverlap = overlap;
                    minNx = ux;
                    minNz = uz;
                }
            }
            if (!separated && minOverlap > 0) {
                hit = true;
                if (dx * minNx + dz * minNz < 0) {
                    minNx = -minNx;
                    minNz = -minNz;
                }
                cx += minNx * minOverlap * 0.7;
                cz += minNz * minOverlap * 0.7;
                v.wx -= minNx * minOverlap * 0.3;
                v.wz -= minNz * minOverlap * 0.3;
                v.speed = Math.min(v.speed, 2.0);
            }
        }
        return { x: cx, z: cz, hit };
    }

    function clearOverlap(wx, wz, minRadius = 5.5) {
        const r2 = minRadius * minRadius;
        for (let i = 0; i < MAX_TRAFFIC; i++) {
            const v = vehicles[i];
            if (!v.active) continue;
            const dx = v.wx - wx;
            const dz = v.wz - wz;
            if (dx * dx + dz * dz < r2) {
                v.active = false;
            }
        }
    }

    return {
        update,
        pushInstances,
        resolveCollision,
        clearOverlap,
        getCount: () => activeCount,
        getVehicles: () => vehicles,
    };
}
