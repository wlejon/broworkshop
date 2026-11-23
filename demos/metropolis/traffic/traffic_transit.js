// Sculpted ambient traffic (4 car archetypes + buses), elevated 4-car commuter
// rail trains along the closed loop, and a physics-free road/bridge driveable hero car
// with dual GPU-tiled headlights. All ambient instances stay off shadows so
// shadowPagesDynamic stays 0 during camera motion.

import {
    createBodyForArchetype, createGlassForArchetype, createCarWheelMesh, createCarLightMesh,
} from "/app/traffic/vehicle_meshes.js";
import { riverCenterX, riverSignedDist, terrainHeight } from "/app/world/terrain_field.js";
import { uvBox } from "/lib/city-building-mesh.js";

const BODY_COLORS = [
    [0.72, 0.14, 0.14],
    [0.16, 0.28, 0.54],
    [0.84, 0.84, 0.86],
    [0.24, 0.27, 0.30],
    [0.64, 0.50, 0.22],
    [0.18, 0.42, 0.28],
];

function makeTrainCarMesh() {
    const body = uvBox(2.9, 2.75, 16.5, 4).translate(0, 1.85, 0);
    const roof = uvBox(2.6, 0.32, 15.8, 4).translate(0, 3.35, 0);
    const bogieF = uvBox(2.2, 0.48, 2.6, 2).translate(0, 0.42, -5.4);
    const bogieR = uvBox(2.2, 0.48, 2.6, 2).translate(0, 0.42, 5.4);
    return Mesh.merge([body, roof, bogieF, bogieR]);
}

function makeBusMesh() {
    const hull = uvBox(2.55, 2.55, 10.8, 4).translate(0, 1.55, 0);
    const roof = uvBox(2.35, 0.24, 10.2, 4).translate(0, 2.92, 0);
    return Mesh.merge([hull, roof]);
}

function writeMat4(dst, off, x, y, z, yaw, pitch = 0, roll = 0) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    dst[off + 0] = cy * cr + sy * sp * sr;
    dst[off + 1] = -cy * sr + sy * sp * cr;
    dst[off + 2] = sy * cp;
    dst[off + 3] = 0;
    dst[off + 4] = cp * sr;
    dst[off + 5] = cp * cr;
    dst[off + 6] = -sp;
    dst[off + 7] = 0;
    dst[off + 8] = -sy * cr + cy * sp * sr;
    dst[off + 9] = sy * sr + cy * sp * cr;
    dst[off + 10] = cy * cp;
    dst[off + 11] = 0;
    dst[off + 12] = x;
    dst[off + 13] = y;
    dst[off + 14] = z;
    dst[off + 15] = 1;
}

export function createTrafficAndTransit(scene, graph) {
    // 1. Sculpted instanced car archetypes + wheels + transit buses + commuter trains
    const bodyNodes = [], glassNodes = [];
    for (let a = 0; a < 4; a++) {
        bodyNodes.push(scene.createInstancedMesh({
            mesh: createBodyForArchetype(a), color: [1, 1, 1], roughness: 0.26, metallic: 0.72,
            castsShadow: false, receivesShadow: true,
        }));
        glassNodes.push(scene.createInstancedMesh({
            mesh: createGlassForArchetype(a), color: [0.06, 0.09, 0.12], roughness: 0.08, metallic: 0.1,
            castsShadow: false, receivesShadow: true,
        }));
    }
    const wheelMesh = createCarWheelMesh();
    const busNode = scene.createInstancedMesh({
        mesh: makeBusMesh(), color: [0.16, 0.42, 0.74], roughness: 0.35, metallic: 0.45,
        castsShadow: false, receivesShadow: true,
    });
    const trainNode = scene.createInstancedMesh({
        mesh: makeTrainCarMesh(), color: [0.76, 0.80, 0.86], roughness: 0.28, metallic: 0.78,
        emissiveColor: [0.12, 0.16, 0.22],
        castsShadow: false, receivesShadow: true,
    });

    // Hero driveable coupe + 4 animated wheels + dual GPU-tiled headlights
    const heroColor = [0.78, 0.14, 0.14];
    const heroBody = scene.createMesh({
        mesh: createBodyForArchetype(2), color: heroColor, roughness: 0.22, metallic: 0.82,
        castsShadow: false, receivesShadow: true,
    });
    const heroGlass = scene.createMesh({
        mesh: createGlassForArchetype(2), color: [0.06, 0.09, 0.12], roughness: 0.08, metallic: 0.15,
        castsShadow: false, receivesShadow: true,
    });
    const heroWheels = [
        [-0.84, 0.32, -1.36], [0.84, 0.32, -1.36],
        [-0.84, 0.32,  1.36], [0.84, 0.32,  1.36],
    ].map(() => scene.createMesh({ mesh: wheelMesh, color: [0.18, 0.19, 0.21], roughness: 0.45, metallic: 0.55, castsShadow: false }));

    const heroLights = [-0.6, 0.6].map(() => scene.createLight({
        type: 'spot', position: [0, -200, 0], direction: [0, -0.15, -1],
        color: [1.0, 0.94, 0.82], intensity: 0, range: 65,
        innerAngle: 0.25, outerAngle: 0.55, castsShadow: false,
    }));
    const trainHeadlight = scene.createLight({
        type: 'point', position: [0, -200, 0], color: [1.0, 0.92, 0.78], intensity: 0, range: 55, castsShadow: false,
    });

    // Build adjacency list over drivable road segments for smooth intersections
    const validRoads = graph.roads.filter((r) => Math.hypot(r.x1 - r.x0, r.z1 - r.z0) > 15);
    const adj = new Map();
    const keyPt = (x, z) => `${Math.round(x / 6)},${Math.round(z / 6)}`;
    for (const r of validRoads) {
        for (const p of [[r.x0, r.z0], [r.x1, r.z1]]) {
            const k = keyPt(p[0], p[1]);
            if (!adj.has(k)) adj.set(k, []);
            adj.get(k).push(r);
        }
    }

    // Spawn 140 ambient cars + 16 city buses strictly along valid road/bridge segments
    const ambientCars = [];
    for (let i = 0; i < 156 && validRoads.length > 0; i++) {
        const seg = validRoads[(i * 19) % validRoads.length];
        const isBus = i >= 140;
        ambientCars.push({
            seg,
            dir: (i & 1) ? 1 : -1,
            t: ((i * 0.37) % 0.8) + 0.1,
            speed: isBus ? 11.5 : 13 + (i % 7) * 2.2,
            arch: i & 3,
            isBus,
            color: BODY_COLORS[i % BODY_COLORS.length],
            wx: seg.x0, wy: 0, wz: seg.z0, yaw: 0,
        });
    }

    // Build cumulative arc length around closed transitLoop
    const loopLens = [];
    let loopTotal = 0;
    for (const tr of graph.transitLoop) {
        const l = Math.hypot(tr.x1 - tr.x0, tr.y1 - tr.y0, tr.z1 - tr.z0);
        loopLens.push(l);
        loopTotal += l;
    }
    function sampleLoopPose(sDist) {
        let rem = ((sDist % loopTotal) + loopTotal) % loopTotal;
        for (let i = 0; i < graph.transitLoop.length; i++) {
            const l = loopLens[i];
            if (rem <= l || i === graph.transitLoop.length - 1) {
                const tr = graph.transitLoop[i];
                const f = l > 0 ? rem / l : 0;
                const x = tr.x0 + (tr.x1 - tr.x0) * f;
                const y = tr.y0 + (tr.y1 - tr.y0) * f + 0.15;
                const z = tr.z0 + (tr.z1 - tr.z0) * f;
                const dx = tr.x1 - tr.x0, dy = tr.y1 - tr.y0, dz = tr.z1 - tr.z0;
                const yaw = Math.atan2(-dx, -dz);
                const pitch = Math.atan2(dy, Math.hypot(dx, dz) || 1);
                return { x, y, z, yaw, pitch };
            }
            rem -= l;
        }
        return { x: 0, y: 12, z: 0, yaw: 0, pitch: 0 };
    }

    const trains = [0, 1, 2, 3].map((idx) => ({ s: (idx / 4) * loopTotal, speed: 19.0 }));
    const trainMats = new Float32Array(trains.length * 4 * 16);
    const busMats = new Float32Array(16 * 16);
    const archBufs = [0, 1, 2, 3].map(() => new Float32Array(64 * 16));
    const archColors = [0, 1, 2, 3].map(() => new Float32Array(64 * 4));
    const archCounts = [0, 0, 0, 0];

    // Driveable Hero Car initialized on West Riverfront Blvd facing south toward central bridge
    const heroStartX = riverCenterX(120) - 94;
    const heroStartZ = 120;
    const hero = {
        x: heroStartX,
        y: terrainHeight(heroStartX, heroStartZ) + 0.16,
        z: heroStartZ,
        yaw: 0, // facing -Z toward z=0 central bridge
        pitch: 0,
        roll: 0,
        speed: 0,
        steer: 0,
        wheelSpin: 0,
    };
    const driveInput = { throttle: 0, steer: 0, brake: false };

    function sampleDriveSurfaceY(x, z) {
        // Check if on or approaching any elevated bridge first so hero car drives cleanly over water!
        for (const b of graph.bridges) {
            if (Math.abs(z - b.z0) <= b.halfW + 3.0 && x >= b.x0 && x <= b.x1) {
                const t = (x - b.x0) / (b.x1 - b.x0);
                return { y: graph.sampleRoadDeckY(b, t), onBridge: true };
            }
        }
        return { y: terrainHeight(x, z) + 0.16, onBridge: false };
    }

    function update(dt, nightFactor = 0, eye = [0, 20, 0]) {
        const clampedDt = Math.min(0.05, Math.max(0, dt));

        // Update Hero Driveable Car
        const accel = driveInput.throttle > 0 ? 18 : (driveInput.throttle < 0 ? -14 : 0);
        if (driveInput.brake) {
            hero.speed *= Math.max(0, 1 - 6.0 * clampedDt);
        } else if (accel !== 0) {
            hero.speed = Math.max(-14, Math.min(34, hero.speed + accel * clampedDt));
        } else {
            hero.speed *= Math.max(0, 1 - 1.8 * clampedDt);
        }
        const targetSteer = driveInput.steer * 0.48;
        hero.steer += (targetSteer - hero.steer) * Math.min(1, 10 * clampedDt);
        if (Math.abs(hero.speed) > 0.15) {
            const dirSign = hero.speed >= 0 ? 1 : -1;
            hero.yaw += hero.steer * Math.min(1.0, Math.abs(hero.speed) / 8.0) * 1.9 * clampedDt * dirSign;
        }
        const fwdX = -Math.sin(hero.yaw), fwdZ = -Math.cos(hero.yaw);
        const nx = hero.x + fwdX * hero.speed * clampedDt;
        const nz = hero.z + fwdZ * hero.speed * clampedDt;
        const surf = sampleDriveSurfaceY(nx, nz);
        if (surf.onBridge || riverSignedDist(nx, nz) >= 6.0) {
            hero.x = nx; hero.z = nz; hero.y = surf.y;
        } else {
            hero.speed = 0; // Guardrail keeps car from driving into water!
        }
        hero.wheelSpin += (hero.speed * clampedDt) / 0.32;
        hero.roll = -hero.steer * Math.min(1, Math.abs(hero.speed) / 20) * 0.06;

        // Place hero body, glass, 4 rotating/steering wheels & headlights
        heroBody.position = [hero.x, hero.y, hero.z];
        heroBody.rotation = [hero.pitch, hero.yaw, hero.roll];
        heroGlass.position = [hero.x, hero.y, hero.z];
        heroGlass.rotation = [hero.pitch, hero.yaw, hero.roll];
        const wheelOffsets = [[-0.84, 0.32, -1.36, true], [0.84, 0.32, -1.36, true], [-0.84, 0.32, 1.36, false], [0.84, 0.32, 1.36, false]];
        const cy = Math.cos(hero.yaw), sy = Math.sin(hero.yaw);
        for (let wi = 0; wi < 4; wi++) {
            const [lx, ly, lz, front] = wheelOffsets[wi];
            heroWheels[wi].position = [hero.x + cy * lx + sy * lz, hero.y + ly, hero.z - sy * lx + cy * lz];
            heroWheels[wi].rotation = [hero.wheelSpin, hero.yaw + (front ? hero.steer : 0), 0];
        }
        const hlPower = nightFactor > 0.05 ? nightFactor * 550 : 0;
        const hSideX = [-0.6, 0.6];
        for (let hi = 0; hi < 2; hi++) {
            heroLights[hi].position = [hero.x + cy * hSideX[hi] + sy * (-2.05), hero.y + 0.68, hero.z - sy * hSideX[hi] + cy * (-2.05)];
            heroLights[hi].direction = [fwdX, -0.14, fwdZ];
            heroLights[hi].intensity = hlPower;
            heroLights[hi].range = 72;
        }

        // Advance Ambient Cars + Buses
        archCounts.fill(0);
        let busCount = 0;
        for (const c of ambientCars) {
            const seg = c.seg;
            const dx = seg.x1 - seg.x0, dz = seg.z1 - seg.z0;
            const len = Math.hypot(dx, dz) || 1;
            c.t += (c.speed * clampedDt / len) * c.dir;
            if (c.t > 1 || c.t < 0) {
                const endX = c.dir > 0 ? seg.x1 : seg.x0;
                const endZ = c.dir > 0 ? seg.z1 : seg.z0;
                const list = adj.get(keyPt(endX, endZ));
                if (list && list.length > 1) {
                    const pick = list[(seg.id + Math.floor(c.t * 17)) % list.length];
                    if (pick !== seg) {
                        c.seg = pick;
                        const d0 = Math.hypot(pick.x0 - endX, pick.z0 - endZ);
                        const d1 = Math.hypot(pick.x1 - endX, pick.z1 - endZ);
                        if (d0 <= d1) { c.dir = 1; c.t = 0.02; }
                        else { c.dir = -1; c.t = 0.98; }
                    } else {
                        c.dir *= -1;
                        c.t = Math.max(0.02, Math.min(0.98, c.t));
                    }
                } else {
                    c.dir *= -1;
                    c.t = Math.max(0.02, Math.min(0.98, c.t));
                }
            }
            const s2 = c.seg;
            const sdx = s2.x1 - s2.x0, sdz = s2.z1 - s2.z0;
            const slen = Math.hypot(sdx, sdz) || 1;
            const tx = (sdx / slen) * c.dir, tz = (sdz / slen) * c.dir;
            const rnx = -tz, rnz = tx;
            const laneOff = s2.halfW * 0.45;
            c.wx = s2.x0 + sdx * c.t + rnx * laneOff;
            c.wz = s2.z0 + sdz * c.t + rnz * laneOff;
            c.wy = graph.sampleRoadDeckY(s2, c.t);
            c.yaw = Math.atan2(-tx, -tz);

            if (c.isBus && busCount < 16) {
                writeMat4(busMats, busCount * 16, c.wx, c.wy, c.wz, c.yaw);
                busCount++;
            } else if (!c.isBus) {
                const cnt = archCounts[c.arch];
                if (cnt < 64) {
                    writeMat4(archBufs[c.arch], cnt * 16, c.wx, c.wy, c.wz, c.yaw);
                    archColors[c.arch].set([c.color[0], c.color[1], c.color[2], 1], cnt * 4);
                    archCounts[c.arch]++;
                }
            }
        }
        for (let a = 0; a < 4; a++) {
            const cnt = archCounts[a];
            bodyNodes[a].setInstances(archBufs[a].subarray(0, cnt * 16), archColors[a].subarray(0, cnt * 4));
            glassNodes[a].setInstances(archBufs[a].subarray(0, cnt * 16));
        }
        busNode.setInstances(busMats.subarray(0, busCount * 16));

        // Advance Elevated Commuter Trains (4 x 4-car articulated sets = 16 cars)
        let ti = 0;
        let train0Pose = null;
        for (let tIdx = 0; tIdx < trains.length; tIdx++) {
            const tr = trains[tIdx];
            tr.s = (tr.s + tr.speed * clampedDt) % loopTotal;
            for (let carIdx = 0; carIdx < 4; carIdx++) {
                const p = sampleLoopPose(tr.s - carIdx * 17.6);
                if (tIdx === 0 && carIdx === 0) train0Pose = p;
                writeMat4(trainMats, ti * 16, p.x, p.y, p.z, p.yaw, p.pitch, 0);
                ti++;
            }
        }
        trainNode.setInstances(trainMats);
        if (train0Pose) {
            trainHeadlight.position = [train0Pose.x, train0Pose.y + 1.8, train0Pose.z];
            trainHeadlight.intensity = nightFactor > 0.05 ? nightFactor * 420 : 0;
            trainHeadlight.range = 65;
        }
    }

    update(0, 0);

    return {
        update,
        getNodes: () => [...bodyNodes, ...glassNodes, busNode, trainNode, heroBody, heroGlass, ...heroWheels],
        setDriveInput(inp) {
            if (inp.throttle !== undefined) driveInput.throttle = inp.throttle;
            if (inp.steer !== undefined) driveInput.steer = inp.steer;
            if (inp.brake !== undefined) driveInput.brake = Boolean(inp.brake);
        },
        getHeroCar: () => ({ x: hero.x, y: hero.y, z: hero.z, yaw: hero.yaw, speed: hero.speed, steer: hero.steer }),
        setHeroCarPose(x, z, yaw = 0) {
            const surf = sampleDriveSurfaceY(x, z);
            hero.x = x; hero.z = z; hero.y = surf.y; hero.yaw = yaw; hero.speed = 0;
            update(0, 0);
        },
        getTrainPose: (idx = 0) => sampleLoopPose(trains[idx % trains.length].s),
        stats: () => ({ vehicles: ambientCars.length + 1, trains: trains.length }),
        destroy() {
            for (const n of [...bodyNodes, ...glassNodes, busNode, trainNode, heroBody, heroGlass, ...heroWheels, ...heroLights, trainHeadlight]) {
                n.destroy();
            }
        },
    };
}
