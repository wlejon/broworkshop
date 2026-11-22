// Enterable parked & driveable cars with steering, throttle, braking, slope alignment,
// building/curb/streetlight/traffic collision, and 3rd-person chase camera invariant.
import * as layout from '/app/world/city_layout.js';
import { getBlockParkedCars, getNearestRoadPoint, sampleSlopeTransform } from '/app/traffic/road_network.js';
import { pushCarVisual } from '/app/traffic/vehicle_meshes.js';

const MAX_FORWARD_SPEED = 32.0;
const MAX_REVERSE_SPEED = -13.5;
const WHEELBASE = 2.70;

function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
}

export function createDriveableCar(batches, collision, ambientTraffic) {
    const car = {
        inCar: false,
        claimedParkedId: null,
        hasDrivenCar: false,
        wx: 0,
        wy: 2,
        wz: 16,
        yaw: 0,
        chaseX: 0,
        chaseZ: 19.4,
        pitch: 0,
        roll: 0,
        speed: 0,
        steerAngle: 0,
        wheelSpin: 0,
        color: [0.74, 0.16, 0.18, 1],
    };

    function resetChaseBoom() {
        const fx = -Math.sin(car.yaw);
        const fz = -Math.cos(car.yaw);
        car.chaseX = car.wx - fx * 3.4;
        car.chaseZ = car.wz - fz * 3.4;
    }

    const input = {
        forward: 0,
        right: 0,
        brake: 0,
    };

    function setInput(opts = {}) {
        if (typeof opts.forward === 'number' && Number.isFinite(opts.forward)) input.forward = clamp(opts.forward, -1, 1);
        if (typeof opts.right === 'number' && Number.isFinite(opts.right)) input.right = clamp(opts.right, -1, 1);
        if (typeof opts.brake === 'number' && Number.isFinite(opts.brake)) input.brake = clamp(opts.brake, 0, 1);
    }

    function clearInput() {
        input.forward = 0;
        input.right = 0;
        input.brake = 0;
    }

    function resolveStreetlightCollision(x, z) {
        let cx = x;
        let cz = z;
        let hit = false;
        const bx0 = Math.floor(cx / layout.BLOCK_SIZE);
        const bz0 = Math.floor(cz / layout.BLOCK_SIZE);
        for (let bz = bz0 - 1; bz <= bz0 + 1; bz++) {
            for (let bx = bx0 - 1; bx <= bx0 + 1; bx++) {
                const xEdge = bx * layout.BLOCK_SIZE + 11.5;
                const zStart = bz * layout.BLOCK_SIZE + 20;
                for (let s = 0; s < 3; s++) {
                    const sz = zStart + s * 44;
                    const dx = cx - xEdge;
                    const dz = cz - sz;
                    const d = Math.hypot(dx, dz);
                    const minR = 1.15;
                    if (d < minR) {
                        hit = true;
                        const nx = d > 1e-4 ? dx / d : 1;
                        const nz = d > 1e-4 ? dz / d : 0;
                        cx = xEdge + nx * minR;
                        cz = sz + nz * minR;
                    }
                }
            }
        }
        return { x: cx, z: cz, hit };
    }

    function resolveParkedCarCollision(x, z, yaw) {
        let cx = x;
        let cz = z;
        let hit = false;
        let pushX = 0;
        let pushZ = 0;
        const bx0 = Math.floor(cx / layout.BLOCK_SIZE);
        const bz0 = Math.floor(cz / layout.BLOCK_SIZE);
        const halfW = 0.86;
        const halfL = 2.22;
        const aRx = Math.cos(yaw), aRz = -Math.sin(yaw);
        const aFx = -Math.sin(yaw), aFz = -Math.cos(yaw);

        for (let iter = 0; iter < 2; iter++) {
            for (let bz = bz0 - 1; bz <= bz0 + 1; bz++) {
                for (let bx = bx0 - 1; bx <= bx0 + 1; bx++) {
                    const parked = getBlockParkedCars(bx, bz);
                    for (let i = 0; i < parked.length; i++) {
                        const pk = parked[i];
                        if (pk.id === car.claimedParkedId) continue;
                        const dx = cx - pk.wx;
                        const dz = cz - pk.wz;
                        if (dx * dx + dz * dz > 25.0) continue;

                        const bRx = Math.cos(pk.yaw), bRz = -Math.sin(pk.yaw);
                        const bFx = -Math.sin(pk.yaw), bFz = -Math.cos(pk.yaw);

                        let minOverlap = Infinity;
                        let minNx = 0;
                        let minNz = 0;
                        let separated = false;

                        for (let ai = 0; ai < 4; ai++) {
                            const ux = ai === 0 ? aRx : ai === 1 ? aFx : ai === 2 ? bRx : bFx;
                            const uz = ai === 0 ? aRz : ai === 1 ? aFz : ai === 2 ? bRz : bFz;
                            const dist = Math.abs(dx * ux + dz * uz);
                            const projA = halfW * Math.abs(aRx * ux + aRz * uz) + halfL * Math.abs(aFx * ux + aFz * uz);
                            const projB = halfW * Math.abs(bRx * ux + bRz * uz) + halfL * Math.abs(bFx * ux + bFz * uz);
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
                            const dot = dx * minNx + dz * minNz;
                            if (dot < 0 || (dot === 0 && (aRx * minNx + aRz * minNz) < 0)) {
                                minNx = -minNx;
                                minNz = -minNz;
                            }
                            const mtvX = minNx * minOverlap;
                            const mtvZ = minNz * minOverlap;
                            cx += mtvX;
                            cz += mtvZ;
                            pushX += mtvX;
                            pushZ += mtvZ;
                        }
                    }
                }
            }
        }
        return { x: cx, z: cz, hit, pushX, pushZ };
    }

    function enterNearestCar(playerPos, isInsideBuilding = false) {
        if (car.inCar) return { ok: true, pos: [car.wx, car.wy, car.wz], yaw: car.yaw };
        if (isInsideBuilding) return false;

        const px = playerPos[0];
        const pz = playerPos[2];
        // Far border / off-road edge guard
        if (Math.abs(px) > 6120 || Math.abs(pz) > 6120) return false;

        // Check previously driven car if nearby
        let bestCar = null;
        let bestDist = Infinity;
        if (car.hasDrivenCar) {
            const d = Math.hypot(car.wx - px, car.wz - pz);
            if (d <= 24.0) {
                bestDist = d;
                bestCar = { wx: car.wx, wz: car.wz, yaw: car.yaw, color: car.color, parkedId: car.claimedParkedId };
            }
        }

        // Check nearby deterministic parked cars
        const bx0 = Math.floor(px / layout.BLOCK_SIZE);
        const bz0 = Math.floor(pz / layout.BLOCK_SIZE);
        for (let bz = bz0 - 1; bz <= bz0 + 1; bz++) {
            for (let bx = bx0 - 1; bx <= bx0 + 1; bx++) {
                const parked = getBlockParkedCars(bx, bz);
                for (let i = 0; i < parked.length; i++) {
                    const pk = parked[i];
                    const d = Math.hypot(pk.wx - px, pk.wz - pz);
                    if (d <= 24.0 && d < bestDist) {
                        bestDist = d;
                        bestCar = { wx: pk.wx, wz: pk.wz, yaw: pk.yaw, color: pk.color, parkedId: pk.id };
                    }
                }
            }
        }

        // Otherwise place/select a car cleanly on the nearest road lane within 56 m
        if (!bestCar) {
            const rp = getNearestRoadPoint(px, pz, { avoidIntersection: true });
            if (!rp || rp.dist > 56.0) return false;
            bestCar = { wx: rp.x, wz: rp.z, yaw: rp.yaw, color: [0.74, 0.16, 0.18, 1], parkedId: null };
        }

        // Ensure spawn spot sits cleanly outside building footprints
        const slope0 = sampleSlopeTransform(bestCar.wx, bestCar.wz, bestCar.yaw);
        const bRes = collision.resolveBox2D(bestCar.wx, bestCar.wz, slope0.y + 0.75, 1.05, 2.25, 0.72);
        const fx = bRes.x;
        const fz = bRes.z;
        const slope = sampleSlopeTransform(fx, fz, bestCar.yaw);

        car.inCar = true;
        car.hasDrivenCar = true;
        car.claimedParkedId = bestCar.parkedId;
        car.wx = fx;
        car.wy = slope.y;
        car.wz = fz;
        car.yaw = bestCar.yaw;
        resetChaseBoom();
        car.pitch = slope.pitch;
        car.roll = slope.roll;
        car.speed = 0;
        car.steerAngle = 0;
        car.color = bestCar.color;
        clearInput();

        return { ok: true, pos: [car.wx, car.wy, car.wz], yaw: car.yaw };
    }

    function exitCar() {
        if (!car.inCar) return null;
        car.inCar = false;
        car.speed = 0;
        clearInput();

        const rx = Math.cos(car.yaw);
        const rz = -Math.sin(car.yaw);
        const fx = -Math.sin(car.yaw);
        const fz = -Math.cos(car.yaw);
        const candidates = [
            [car.wx - rx * 1.85, car.wz - rz * 1.85],
            [car.wx + rx * 1.85, car.wz + rz * 1.85],
            [car.wx - fx * 2.90, car.wz - fz * 2.90],
        ];
        for (let i = 0; i < candidates.length; i++) {
            const cx = clamp(candidates[i][0], layout.WORLD_MIN + 2, layout.WORLD_MAX - 2);
            const cz = clamp(candidates[i][1], layout.WORLD_MIN + 2, layout.WORLD_MAX - 2);
            const gy = layout.sampleGroundHeight(cx, cz);
            const bRes = collision.resolveBox2D(cx, cz, gy + 0.9, 0.42, 0.42, 0.85);
            if (!bRes.collided) {
                return [cx, gy, cz];
            }
        }
        const gy = layout.sampleGroundHeight(car.wx, car.wz);
        const bRes = collision.resolveBox2D(car.wx, car.wz, gy + 0.9, 0.42, 0.42, 0.85);
        const fy = layout.sampleGroundHeight(bRes.x, bRes.z);
        return [bRes.x, fy, bRes.z];
    }

    function update(dt) {
        if (!car.inCar || !(dt > 0)) return;
        const stepDt = clamp(dt, 0, 0.05);

        const targetSteer = -input.right * 0.52;
        car.steerAngle += (targetSteer - car.steerAngle) * Math.min(1, stepDt * 10.0);

        if (input.brake > 0.02) {
            const decel = 28.0 * input.brake * stepDt;
            if (Math.abs(car.speed) <= decel) car.speed = 0;
            else car.speed -= Math.sign(car.speed) * decel;
        } else if (Math.abs(input.forward) > 0.01) {
            const accel = input.forward > 0 ? 14.0 : 10.5;
            car.speed += input.forward * accel * stepDt;
            // Aerodynamic + rolling drag limits natural top speed smoothly
            car.speed -= (0.28 * car.speed + 0.004 * car.speed * Math.abs(car.speed)) * stepDt;
        } else {
            // Coasting drag and static idle hold (zero phantom drift)
            if (Math.abs(car.speed) < 0.10) {
                car.speed = 0;
            } else {
                const drag = Math.min(Math.abs(car.speed), (2.2 + 0.35 * Math.abs(car.speed)) * stepDt);
                car.speed -= Math.sign(car.speed) * drag;
            }
        }
        car.speed = clamp(car.speed, MAX_REVERSE_SPEED, MAX_FORWARD_SPEED);

        if (Math.abs(car.speed) > 0.08) {
            const turnRate = (car.speed / WHEELBASE) * Math.tan(car.steerAngle);
            car.yaw += turnRate * stepDt;
        }

        const fx = -Math.sin(car.yaw);
        const fz = -Math.cos(car.yaw);
        let nx = clamp(car.wx + fx * car.speed * stepDt, layout.WORLD_MIN + 4, layout.WORLD_MAX - 4);
        let nz = clamp(car.wz + fz * car.speed * stepDt, layout.WORLD_MIN + 4, layout.WORLD_MAX - 4);

        const effHX = Math.abs(Math.cos(car.yaw)) * 0.94 + Math.abs(Math.sin(car.yaw)) * 2.22;
        const effHZ = Math.abs(Math.sin(car.yaw)) * 0.94 + Math.abs(Math.cos(car.yaw)) * 2.22;
        const bRes = collision.resolveBox2D(nx, nz, car.wy + 0.75, effHX, effHZ, 0.72, { collideCurbs: true });
        if (bRes.collided) {
            nx = bRes.x;
            nz = bRes.z;
            const pLen = Math.hypot(bRes.pushX, bRes.pushZ);
            if (pLen > 1e-6) {
                const nux = bRes.pushX / pLen;
                const nuz = bRes.pushZ / pLen;
                let vx = fx * car.speed;
                let vz = fz * car.speed;
                const vn = vx * nux + vz * nuz;
                if (vn < 0) {
                    vx -= vn * nux;
                    vz -= vn * nuz;
                    car.speed = clamp((vx * fx + vz * fz) * 0.85, MAX_REVERSE_SPEED, MAX_FORWARD_SPEED);
                }
            }
        }

        const poleRes = resolveStreetlightCollision(nx, nz);
        if (poleRes.hit) {
            nx = poleRes.x;
            nz = poleRes.z;
            car.speed *= 0.65;
        }

        const pkRes = resolveParkedCarCollision(nx, nz, car.yaw);
        if (pkRes.hit) {
            nx = pkRes.x;
            nz = pkRes.z;
            const pLen = Math.hypot(pkRes.pushX, pkRes.pushZ);
            if (pLen > 1e-6) {
                const nux = pkRes.pushX / pLen;
                const nuz = pkRes.pushZ / pLen;
                let vx = fx * car.speed;
                let vz = fz * car.speed;
                const vn = vx * nux + vz * nuz;
                if (vn < 0) {
                    vx -= vn * nux;
                    vz -= vn * nuz;
                    car.speed = clamp((vx * fx + vz * fz) * 0.70, MAX_REVERSE_SPEED, MAX_FORWARD_SPEED);
                }
            } else {
                car.speed *= 0.50;
            }
        }

        if (ambientTraffic) {
            const trRes = ambientTraffic.resolveCollision(nx, nz, 1.0, 2.2);
            if (trRes.hit) {
                nx = trRes.x;
                nz = trRes.z;
                car.speed *= 0.55;
            }
        }

        car.wx = nx;
        car.wz = nz;
        car.wheelSpin -= (car.speed / 0.32) * stepDt;

        // Towed-leash chase camera: keep 3.4 m behind car along travel path so turning never swings camPos opposite the turn
        let dxCam = car.wx - car.chaseX;
        let dzCam = car.wz - car.chaseZ;
        let dCam = Math.hypot(dxCam, dzCam);
        if (dCam > 1e-4) {
            let ux = dxCam / dCam;
            let uz = dzCam / dCam;
            if (Math.abs(car.steerAngle) < 0.08 && Math.abs(car.speed) > 1.0) {
                const sgn = car.speed >= 0 ? 1 : -1;
                const align = Math.min(1, stepDt * 1.2);
                ux += (fx * sgn - ux) * align;
                uz += (fz * sgn - uz) * align;
                const ul = Math.hypot(ux, uz) || 1;
                ux /= ul;
                uz /= ul;
            }
            car.chaseX = car.wx - ux * 3.4;
            car.chaseZ = car.wz - uz * 3.4;
        } else {
            resetChaseBoom();
        }

        const slope = sampleSlopeTransform(car.wx, car.wz, car.yaw);
        car.wy = slope.y;
        car.pitch += (slope.pitch - car.pitch) * Math.min(1, stepDt * 12.0);
        car.roll += (slope.roll - car.roll) * Math.min(1, stepDt * 12.0);
    }

    function getChaseCamera() {
        const tfx = -Math.sin(car.yaw);
        const tfz = -Math.cos(car.yaw);
        let cx = clamp(car.chaseX, layout.WORLD_MIN + 2, layout.WORLD_MAX - 2);
        let cz = clamp(car.chaseZ, layout.WORLD_MIN + 2, layout.WORLD_MAX - 2);
        const gy = layout.sampleGroundHeight(cx, cz);
        let cy = Math.max(car.wy + 1.72, gy + 0.65);

        const cRes = collision.resolveBox2D(cx, cz, cy, 0.45, 0.45, 0.55);
        if (cRes.collided) {
            cx = cRes.x;
            cz = cRes.z;
        }

        const tx = car.wx + tfx * 3.0;
        const ty = car.wy + 1.12;
        const tz = car.wz + tfz * 3.0;
        const dx = tx - cx;
        const dy = ty - cy;
        const dz = tz - cz;
        const horiz = Math.hypot(dx, dz) || 1;
        return {
            pos: [cx, cy, cz],
            yaw: Math.atan2(-dx, -dz),
            pitch: clamp(Math.atan2(dy, horiz), -1.2, 1.2),
        };
    }

    function pushInstances(camPos, altitude) {
        if (altitude > 240) return;
        const headTint = [0.95, 0.92, 0.82, 1.0];
        const tailTint = (car.inCar && input.brake > 0.1)
            ? [0.98, 0.24, 0.18, 1.0]
            : [0.90, 0.15, 0.13, 1.0];

        if (car.inCar || car.hasDrivenCar) {
            if (Math.hypot(car.wx - camPos[0], car.wz - camPos[2]) <= 240) {
                pushCarVisual(batches, camPos, {
                    wx: car.wx, wy: car.wy, wz: car.wz,
                    yaw: car.yaw, pitch: car.pitch, roll: car.roll,
                    wheelSpin: car.wheelSpin, wheelSteer: car.steerAngle,
                    color: car.color,
                }, headTint, tailTint);
            }
        }

        const bx0 = Math.floor(camPos[0] / layout.BLOCK_SIZE);
        const bz0 = Math.floor(camPos[2] / layout.BLOCK_SIZE);
        for (let bz = bz0 - 1; bz <= bz0 + 1; bz++) {
            for (let bx = bx0 - 1; bx <= bx0 + 1; bx++) {
                const parked = getBlockParkedCars(bx, bz);
                for (let i = 0; i < parked.length; i++) {
                    const pk = parked[i];
                    if (pk.id === car.claimedParkedId) continue;
                    if (Math.hypot(pk.wx - camPos[0], pk.wz - camPos[2]) > 180) continue;
                    pushCarVisual(batches, camPos, pk, [0.55, 0.54, 0.50, 1.0], [0.52, 0.12, 0.10, 1.0]);
                }
            }
        }
    }

    function syncAfterTeleport(x, _y, z) {
        if (!car.inCar) return;
        const effHX = Math.abs(Math.cos(car.yaw)) * 0.94 + Math.abs(Math.sin(car.yaw)) * 2.22;
        const effHZ = Math.abs(Math.sin(car.yaw)) * 0.94 + Math.abs(Math.cos(car.yaw)) * 2.22;
        let fx = clamp(x, layout.WORLD_MIN + 4, layout.WORLD_MAX - 4);
        let fz = clamp(z, layout.WORLD_MIN + 4, layout.WORLD_MAX - 4);

        for (let pass = 0; pass < 2; pass++) {
            const groundY = layout.sampleGroundHeight(fx, fz);
            const bRes = collision.resolveBox2D(fx, fz, groundY + 0.75, effHX, effHZ, 0.72);
            fx = bRes.x;
            fz = bRes.z;
        }
        const poleRes = resolveStreetlightCollision(fx, fz);
        fx = poleRes.x;
        fz = poleRes.z;
        const pkRes = resolveParkedCarCollision(fx, fz, car.yaw);
        fx = pkRes.x;
        fz = pkRes.z;
        const finalGroundY = layout.sampleGroundHeight(fx, fz);
        const bFinal = collision.resolveBox2D(fx, fz, finalGroundY + 0.75, effHX, effHZ, 0.72);
        fx = bFinal.x;
        fz = bFinal.z;

        const slope = sampleSlopeTransform(fx, fz, car.yaw);
        car.wx = fx;
        car.wy = slope.y;
        car.wz = fz;
        resetChaseBoom();
        car.pitch = slope.pitch;
        car.roll = slope.roll;
        car.speed = 0;
    }

    return {
        enterNearestCar,
        exitCar,
        setInput,
        clearInput,
        update,
        getChaseCamera,
        pushInstances,
        syncAfterTeleport,
        isInCar: () => car.inCar,
        getCarState: () => ({
            active: car.inCar,
            wx: car.wx,
            wy: car.wy,
            wz: car.wz,
            yaw: car.yaw,
            speed: car.speed,
        }),
    };
}
