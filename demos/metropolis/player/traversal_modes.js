// Unified traversal controller supporting Fly, Walk (indoor + outdoor),
// Drive (chase camera behind sculpted hero car), and Transit (elevated rail ride-along).

import { riverCenterX, riverSignedDist, terrainHeight, districtAt } from "/app/world/terrain_field.js";

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const EYE_HEIGHT = 1.68;

export function createTraversalController({ canvas, scene, graph, streamer, traffic, onModeChange }) {
    let mode = 'fly';
    let yaw = 0.55;
    let pitch = -0.32;
    const camPos = [riverCenterX(0) - 240, 38, 130];
    const camFwd = [0, 0, -1];
    const camUp = [0, 1, 0];
    const walkFeet = [riverCenterX(0) - 96, terrainHeight(riverCenterX(0) - 96, 80), 80];
    let nearestStationName = 'Central Waterfront';

    const keys = new Set();
    const walkInput = { forward: 0, right: 0, sprint: false };
    let hadKeyDrive = false;
    let dragging = false;

    const surfaceHeightAt = (x, z) => {
        for (const b of graph.bridges) {
            if (Math.abs(z - b.z0) <= b.halfW + 3 && x >= b.x0 && x <= b.x1) {
                return graph.sampleRoadDeckY(b, (x - b.x0) / (b.x1 - b.x0));
            }
        }
        const bp = streamer.findBuildingContaining(x, walkFeet[1] + 0.5, z);
        if (bp) return bp.groundY + 0.22;
        return Math.max(0.25, terrainHeight(x, z));
    };

    const onKeyDown = (e) => {
        const k = e.key.toLowerCase();
        keys.add(k);
        if (k === 'f') {
            const order = ['fly', 'walk', 'drive', 'transit'];
            setMode(order[(order.indexOf(mode) + 1) % order.length]);
        } else if (k === 'e') {
            setMode(mode === 'drive' ? 'walk' : 'drive');
        }
    };
    const onKeyUp = (e) => keys.delete(e.key.toLowerCase());
    const onMouseDown = (e) => { if (e.button === 0 || e.button === 2) dragging = true; };
    const onMouseUp = () => { dragging = false; };
    const onMouseMove = (e) => {
        if (!dragging) return;
        yaw -= (e.movementX || 0) * 0.003;
        pitch = clamp(pitch - (e.movementY || 0) * 0.003, -1.45, 1.45);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);

    function setMode(next) {
        if (!['fly', 'walk', 'drive', 'transit'].includes(next)) return;
        mode = next;
        if (next === 'walk') {
            walkFeet[0] = camPos[0];
            walkFeet[2] = camPos[2];
            walkFeet[1] = surfaceHeightAt(walkFeet[0], walkFeet[2]);
            pitch = clamp(pitch, -1.2, 1.2);
        }
        if (onModeChange) onModeChange(mode);
    }

    function setPose(pos, newYaw = yaw, newPitch = pitch) {
        camPos[0] = pos[0]; camPos[1] = pos[1]; camPos[2] = pos[2];
        walkFeet[0] = pos[0]; walkFeet[2] = pos[2]; walkFeet[1] = pos[1] - EYE_HEIGHT;
        yaw = newYaw;
        pitch = clamp(newPitch, -1.45, 1.45);
        pushCamera();
    }

    function pushCamera() {
        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        const cp = Math.cos(pitch), sp = Math.sin(pitch);
        camFwd[0] = -sy * cp;
        camFwd[1] = sp;
        camFwd[2] = -cy * cp;
        scene.setCamera({
            fov: mode === 'drive' ? 62 : 58,
            near: 0.25,
            far: 14000,
            position: camPos,
            target: [camPos[0] + camFwd[0] * 50, camPos[1] + camFwd[1] * 50, camPos[2] + camFwd[2] * 50],
            up: camUp,
        });
    }

    function update(dt) {
        const d = Math.min(0.05, Math.max(0, dt));
        const fwdInput = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
        const sideInput = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
        const vertInput = (keys.has(' ') ? 1 : 0) - (keys.has('c') ? 1 : 0);
        const boost = keys.has('shift') ? 3.0 : 1.0;

        if (mode === 'fly') {
            const speed = 52 * boost * d;
            const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
            const fx = -sy * cp, fy = sp, fz = -cy * cp;
            const rx = cy, rz = -sy;
            camPos[0] += (fx * fwdInput + rx * sideInput) * speed;
            camPos[1] += (fy * fwdInput + vertInput) * speed;
            camPos[2] += (fz * fwdInput + rz * sideInput) * speed;
            const floorY = surfaceHeightAt(camPos[0], camPos[2]) + 1.8;
            if (camPos[1] < floorY) camPos[1] = floorY;
        } else if (mode === 'walk') {
            const f = walkInput.forward !== 0 ? walkInput.forward : fwdInput;
            const r = walkInput.right !== 0 ? walkInput.right : sideInput;
            const speed = (walkInput.sprint || keys.has('shift') ? 9.5 : 5.2) * d;
            const cy = Math.cos(yaw), sy = Math.sin(yaw);
            const nx = walkFeet[0] + (-sy * f + cy * r) * speed;
            const nz = walkFeet[2] + (-cy * f - sy * r) * speed;
            if (riverSignedDist(nx, nz) >= 3.0 || surfaceHeightAt(nx, nz) > 4.0) {
                walkFeet[0] = nx; walkFeet[2] = nz;
            }
            walkFeet[1] = surfaceHeightAt(walkFeet[0], walkFeet[2]);
            camPos[0] = walkFeet[0]; camPos[1] = walkFeet[1] + EYE_HEIGHT; camPos[2] = walkFeet[2];
        } else if (mode === 'drive') {
            const keyActive = fwdInput !== 0 || sideInput !== 0 || keys.has(' ');
            if (keyActive || hadKeyDrive) {
                traffic.setDriveInput({ throttle: fwdInput, steer: -sideInput, brake: keys.has(' ') });
                hadKeyDrive = keyActive;
            }
            const car = traffic.getHeroCar();
            const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
            camPos[0] = car.x + sy * 8.2;
            camPos[1] = car.y + 3.2;
            camPos[2] = car.z + cy * 8.2;
            yaw = car.yaw;
            pitch = -0.18;
        } else if (mode === 'transit') {
            const tp = traffic.getTrainPose(0);
            const sy = Math.sin(tp.yaw), cy = Math.cos(tp.yaw);
            camPos[0] = tp.x + cy * 2.1 + sy * 2.5;
            camPos[1] = tp.y + 3.1;
            camPos[2] = tp.z - sy * 2.1 + cy * 2.5;
            yaw = tp.yaw;
            pitch = -0.14;
            let bestD = Infinity;
            for (const st of graph.stations) {
                const sd = Math.hypot(tp.x - st.x, tp.z - st.z);
                if (sd < bestD) { bestD = sd; nearestStationName = st.name; }
            }
        }

        pushCamera();
    }

    pushCamera();

    return {
        setMode,
        setPose,
        setWalkInput(inp) {
            if (inp.forward !== undefined) walkInput.forward = inp.forward;
            if (inp.right !== undefined) walkInput.right = inp.right;
            if (inp.sprint !== undefined) walkInput.sprint = Boolean(inp.sprint);
        },
        update,
        getState: () => ({
            mode,
            pos: [camPos[0], camPos[1], camPos[2]],
            fwd: [camFwd[0], camFwd[1], camFwd[2]],
            up: [camUp[0], camUp[1], camUp[2]],
            yaw, pitch,
            district: districtAt(camPos[0], camPos[2]),
            inBuilding: streamer.findBuildingContaining(camPos[0], camPos[1], camPos[2]),
            stationName: nearestStationName,
            speed: traffic.getHeroCar().speed,
        }),
        destroy() {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            canvas.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('mousemove', onMouseMove);
        },
    };
}
