// Unified walk / drive / fly traversal controller, input handlers, and camera synchronization.
import { localToWorld } from '/app/buildings/building_gen.js';

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const EYE_HEIGHT = 1.65;

export function createTraversalController({
    canvas,
    layout,
    streamer,
    elevators,
    collision,
    driveCar,
    hud,
    onStateChange,
}) {
    const startX = 0;
    const startZ = 24;
    const startGround = layout.sampleGroundHeight(startX, startZ);
    const camPos = [startX, startGround + 28, startZ];
    const walkFeet = [startX, startGround, startZ];
    const walkVel = [0, 0, 0];
    let walkGrounded = true;
    let mode = 'fly';
    let yaw = 0.0;
    let pitch = -0.26;
    let currentSpeed = 0;
    const camFwd = [0, 0, -1];
    const camRight = [1, 0, 0];
    const camUp = [0, 1, 0];

    const activeWalkInfo = {
        buildingId: null,
        floorIndex: 0,
        roomId: null,
        inElevator: false,
    };

    const pendingWalkInput = {
        forward: 0,
        right: 0,
        jump: false,
        sprint: false,
        yawDelta: 0,
        pitchDelta: 0,
    };

    let disembarkOnArrive = false;
    let userTurnedInElev = false;
    let usedKeyboardDrive = false;

    function updateBasis() {
        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        const cp = Math.cos(pitch), sp = Math.sin(pitch);
        camFwd[0] = -sy * cp;
        camFwd[1] = sp;
        camFwd[2] = -cy * cp;
        camRight[0] = cy;
        camRight[1] = 0;
        camRight[2] = -sy;
        camUp[0] = -sy * (-sp);
        camUp[1] = cp;
        camUp[2] = -cy * (-sp);
    }
    updateBasis();

    function refreshActiveBuildingInfo() {
        const probePos = mode === 'walk'
            ? [walkFeet[0], walkFeet[1] + 0.25, walkFeet[2]]
            : camPos;
        const act = streamer.getActiveBuilding(probePos);
        if (act && act.inside) {
            activeWalkInfo.buildingId = act.buildingId;
            activeWalkInfo.floorIndex = act.floorIndex;
            activeWalkInfo.roomId = act.roomId;
            activeWalkInfo.inElevator = mode === 'walk'
                ? elevators.getActiveFloorHint(act.blueprint, walkFeet) != null
                : false;
        } else {
            activeWalkInfo.buildingId = null;
            activeWalkInfo.floorIndex = 0;
            activeWalkInfo.roomId = null;
            activeWalkInfo.inElevator = false;
        }
    }

    function enterNearestCar() {
        refreshActiveBuildingInfo();
        const inside = Boolean(activeWalkInfo.buildingId);
        const probePos = mode === 'walk' ? walkFeet : camPos;
        const res = driveCar.enterNearestCar(probePos, inside);
        if (!res) return false;
        mode = 'drive';
        currentSpeed = 0;
        disembarkOnArrive = false;
        const chase = driveCar.getChaseCamera();
        camPos[0] = chase.pos[0];
        camPos[1] = chase.pos[1];
        camPos[2] = chase.pos[2];
        yaw = chase.yaw;
        pitch = chase.pitch;
        updateBasis();
        refreshActiveBuildingInfo();
        hud.syncMode(mode);
        onStateChange?.();
        return res;
    }

    function exitCar() {
        if (!driveCar.isInCar()) {
            if (mode === 'drive') setMode('walk');
            return false;
        }
        const exitPos = driveCar.exitCar();
        mode = 'walk';
        currentSpeed = 0;
        if (exitPos) {
            walkFeet[0] = exitPos[0];
            walkFeet[1] = exitPos[1];
            walkFeet[2] = exitPos[2];
        }
        walkVel[0] = 0; walkVel[1] = 0; walkVel[2] = 0;
        const res = collision.moveCharacter(walkFeet, walkVel, 0, { wasGrounded: true });
        walkFeet[0] = res.pos[0]; walkFeet[1] = res.pos[1]; walkFeet[2] = res.pos[2];
        walkGrounded = res.grounded;
        camPos[0] = walkFeet[0];
        camPos[1] = walkFeet[1] + EYE_HEIGHT;
        camPos[2] = walkFeet[2];
        pitch = clamp(pitch, -0.45, 0.45);
        updateBasis();
        activeWalkInfo.buildingId = res.buildingId;
        activeWalkInfo.floorIndex = res.floorIndex;
        activeWalkInfo.roomId = res.roomId;
        activeWalkInfo.inElevator = res.inElevator;
        hud.syncMode(mode);
        onStateChange?.();
        return true;
    }

    function setMode(nextMode) {
        if (nextMode !== 'fly' && nextMode !== 'walk' && nextMode !== 'drive') return mode;
        if (nextMode === mode && (nextMode !== 'drive' || driveCar.isInCar())) return mode;

        if (nextMode === 'drive') {
            enterNearestCar();
            return mode;
        }

        if (driveCar.isInCar()) {
            const exitPos = driveCar.exitCar();
            if (exitPos) {
                walkFeet[0] = exitPos[0];
                walkFeet[1] = exitPos[1];
                walkFeet[2] = exitPos[2];
                camPos[0] = exitPos[0];
                camPos[1] = exitPos[1] + EYE_HEIGHT;
                camPos[2] = exitPos[2];
            }
        }

        mode = nextMode;
        disembarkOnArrive = false;
        if (mode === 'walk') {
            const gy = layout.sampleGroundHeight(camPos[0], camPos[2]);
            walkFeet[0] = camPos[0];
            walkFeet[1] = Math.max(gy, camPos[1] - EYE_HEIGHT);
            walkFeet[2] = camPos[2];
            walkVel[0] = 0; walkVel[1] = 0; walkVel[2] = 0;
            const res = collision.moveCharacter(walkFeet, walkVel, 0, { wasGrounded: true });
            walkFeet[0] = res.pos[0]; walkFeet[1] = res.pos[1]; walkFeet[2] = res.pos[2];
            walkGrounded = res.grounded;
            camPos[0] = walkFeet[0];
            camPos[1] = walkFeet[1] + EYE_HEIGHT;
            camPos[2] = walkFeet[2];
            activeWalkInfo.buildingId = res.buildingId;
            activeWalkInfo.floorIndex = res.floorIndex;
            activeWalkInfo.roomId = res.roomId;
            activeWalkInfo.inElevator = res.inElevator;
        } else {
            currentSpeed = 0;
            refreshActiveBuildingInfo();
        }
        hud.syncMode(mode);
        onStateChange?.();
        return mode;
    }

    function setWalkInput(opts = {}) {
        if (typeof opts.forward === 'number' && Number.isFinite(opts.forward)) pendingWalkInput.forward = clamp(opts.forward, -1, 1);
        if (typeof opts.right === 'number' && Number.isFinite(opts.right)) pendingWalkInput.right = clamp(opts.right, -1, 1);
        if (typeof opts.jump === 'boolean') pendingWalkInput.jump = opts.jump;
        if (typeof opts.sprint === 'boolean') pendingWalkInput.sprint = opts.sprint;
        if (typeof opts.yawDelta === 'number' && Number.isFinite(opts.yawDelta)) {
            pendingWalkInput.yawDelta += opts.yawDelta;
            if (Math.abs(opts.yawDelta) > 1e-4) userTurnedInElev = true;
        }
        if (typeof opts.pitchDelta === 'number' && Number.isFinite(opts.pitchDelta)) pendingWalkInput.pitchDelta += opts.pitchDelta;
    }

    function boardElevatorIfNeeded(bp, clampedTarget) {
        const sh = bp.elevatorShaft;
        if (!sh) return;
        const est = elevators.ensureBuilding(bp);
        if (!est) return;
        const curFloorIdx = clamp(activeWalkInfo.floorIndex, 0, bp.totalFloors - 1);
        const curFl = bp.floors[curFloorIdx];
        if (Math.abs(est.currentY - curFl.yBase) > 0.25) {
            est.currentY = curFl.yBase;
            est.prevY = curFl.yBase;
            est.currentFloor = curFloorIdx;
            est.velocityY = 0;
        }
        const [cx, cy, cz] = localToWorld(bp, sh.cx, est.currentY, sh.cz);
        walkFeet[0] = cx;
        walkFeet[1] = cy;
        walkFeet[2] = cz;
        walkVel[0] = 0; walkVel[1] = 0; walkVel[2] = 0;
        camPos[0] = cx;
        camPos[1] = cy + EYE_HEIGHT;
        camPos[2] = cz;
        activeWalkInfo.inElevator = true;
        activeWalkInfo.floorIndex = curFloorIdx;
        if (clampedTarget !== curFloorIdx) {
            disembarkOnArrive = true;
            userTurnedInElev = false;
        }
    }

    function stepMovement(dt) {
        if (dt <= 0) return;

        let fwdMove = 0;
        let rightMove = 0;
        let upMove = 0;
        if (keys.has('KeyW') || keys.has('ArrowUp')) fwdMove += 1;
        if (keys.has('KeyS') || keys.has('ArrowDown')) fwdMove -= 1;
        if (keys.has('KeyD') || keys.has('ArrowRight')) rightMove += 1;
        if (keys.has('KeyA') || keys.has('ArrowLeft')) rightMove -= 1;

        if (mode === 'drive' && driveCar.isInCar()) {
            if (fwdMove !== 0 || rightMove !== 0 || keys.has('Space')) {
                usedKeyboardDrive = true;
                driveCar.setInput({
                    forward: fwdMove,
                    right: rightMove,
                    brake: keys.has('Space') ? 1 : 0,
                });
            } else if (usedKeyboardDrive) {
                usedKeyboardDrive = false;
                driveCar.clearInput();
            }
            driveCar.update(dt);
            const chase = driveCar.getChaseCamera();
            camPos[0] = chase.pos[0];
            camPos[1] = chase.pos[1];
            camPos[2] = chase.pos[2];
            yaw = chase.yaw;
            pitch = chase.pitch;
            currentSpeed = Math.abs(driveCar.getCarState().speed);
            updateBasis();
            refreshActiveBuildingInfo();
            return;
        }

        if (mode === 'walk') {
            if (disembarkOnArrive && activeWalkInfo.buildingId && activeWalkInfo.inElevator) {
                const bp = streamer.getBlueprintById(activeWalkInfo.buildingId);
                const est = bp ? elevators.getState(bp.id) : null;
                const tgtFl = bp && est ? bp.floors[est.targetFloor] : null;
                if (bp && bp.elevatorShaft && est && tgtFl &&
                    (est.state === 'idle' || Math.abs(est.currentY - tgtFl.yBase) <= 0.65) &&
                    est.currentFloor === est.targetFloor) {
                    disembarkOnArrive = false;
                    // Dock cab cleanly on arrival so floorY and doorOpen match immediately
                    const rawSt = elevators.ensureBuilding(bp);
                    if (rawSt) {
                        rawSt.currentY = tgtFl.yBase;
                        rawSt.prevY = tgtFl.yBase;
                        rawSt.velocityY = 0;
                        rawSt.currentFloor = est.targetFloor;
                        rawSt.doorOpen = 1;
                        rawSt.state = 'idle';
                    }
                    const sh = bp.elevatorShaft;
                    const [dx, dy, dz] = localToWorld(bp, sh.doorX, tgtFl.yBase, sh.doorZ + 1.15);
                    walkFeet[0] = dx;
                    walkFeet[1] = dy;
                    walkFeet[2] = dz;
                    walkVel[0] = 0; walkVel[1] = 0; walkVel[2] = 0;
                    if (!userTurnedInElev) {
                        yaw = bp.rot + Math.PI;
                        pitch = -0.02;
                        updateBasis();
                    }
                }
            }

            if (pendingWalkInput.yawDelta !== 0 || pendingWalkInput.pitchDelta !== 0) {
                yaw += pendingWalkInput.yawDelta;
                pitch = clamp(pitch + pendingWalkInput.pitchDelta, -1.48, 1.48);
                pendingWalkInput.yawDelta = 0;
                pendingWalkInput.pitchDelta = 0;
                updateBasis();
            }

            const fIn = clamp(fwdMove + pendingWalkInput.forward, -1, 1);
            const rIn = clamp(rightMove + pendingWalkInput.right, -1, 1);
            const jump = keys.has('Space') || pendingWalkInput.jump;
            const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') || pendingWalkInput.sprint;
            pendingWalkInput.jump = false;

            const sy = Math.sin(yaw), cy = Math.cos(yaw);
            let wxDir = -sy * fIn + cy * rIn;
            let wzDir = -cy * fIn - sy * rIn;
            const mag = Math.hypot(wxDir, wzDir);
            if (mag > 1.0) { wxDir /= mag; wzDir /= mag; }
            const speed = (mag > 1e-4 ? (sprint ? 9.5 : 5.2) : 0);
            currentSpeed = speed * Math.min(1, mag);

            const res = collision.moveCharacter(walkFeet, walkVel, dt, {
                wishDir: [wxDir, wzDir],
                speed: sprint ? 9.5 : 5.2,
                jump,
                wasGrounded: walkGrounded,
            });
            walkFeet[0] = res.pos[0]; walkFeet[1] = res.pos[1]; walkFeet[2] = res.pos[2];
            walkVel[0] = res.vel[0]; walkVel[1] = res.vel[1]; walkVel[2] = res.vel[2];
            walkGrounded = res.grounded;
            activeWalkInfo.buildingId = res.buildingId;
            activeWalkInfo.floorIndex = res.floorIndex;
            activeWalkInfo.roomId = res.roomId;
            activeWalkInfo.inElevator = res.inElevator;

            camPos[0] = walkFeet[0];
            camPos[1] = walkFeet[1] + EYE_HEIGHT;
            camPos[2] = walkFeet[2];
            return;
        }

        // 'fly' mode
        if (pendingWalkInput.yawDelta !== 0 || pendingWalkInput.pitchDelta !== 0) {
            yaw += pendingWalkInput.yawDelta;
            pitch = clamp(pitch + pendingWalkInput.pitchDelta, -1.48, 1.48);
            pendingWalkInput.yawDelta = 0;
            pendingWalkInput.pitchDelta = 0;
            updateBasis();
        }
        const fIn = clamp(fwdMove + pendingWalkInput.forward, -1, 1);
        const rIn = clamp(rightMove + pendingWalkInput.right, -1, 1);
        if (keys.has('Space') || keys.has('KeyE')) upMove += 1;
        if (keys.has('KeyC') || keys.has('KeyQ')) upMove -= 1;
        pendingWalkInput.jump = false;

        const alt = Math.max(0, camPos[1] - layout.sampleGroundHeight(camPos[0], camPos[2]));
        const baseSpeed = 28 + alt * 0.45;
        const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') || pendingWalkInput.sprint;
        const speed = sprint ? baseSpeed * 3.0 : baseSpeed;
        currentSpeed = (fIn !== 0 || rIn !== 0 || upMove !== 0) ? speed : 0;

        if (fIn !== 0 || rIn !== 0 || upMove !== 0) {
            camPos[0] = clamp(camPos[0] + (camFwd[0] * fIn + camRight[0] * rIn) * speed * dt, layout.WORLD_MIN + 8, layout.WORLD_MAX - 8);
            camPos[1] = clamp(camPos[1] + (camFwd[1] * fIn + upMove) * speed * dt, -4, 2400);
            camPos[2] = clamp(camPos[2] + (camFwd[2] * fIn + camRight[2] * rIn) * speed * dt, layout.WORLD_MIN + 8, layout.WORLD_MAX - 8);
        }
        refreshActiveBuildingInfo();
    }

    function teleport(x, y, z, newYaw, newPitch) {
        camPos[0] = clamp(Number(x) || 0, layout.WORLD_MIN + 2, layout.WORLD_MAX - 2);
        camPos[2] = clamp(Number(z) || 0, layout.WORLD_MIN + 2, layout.WORLD_MAX - 2);
        const groundY = layout.sampleGroundHeight(camPos[0], camPos[2]);
        const hasY = y !== null && y !== undefined && Number.isFinite(Number(y));
        disembarkOnArrive = false;

        if (mode === 'drive' && driveCar.isInCar()) {
            driveCar.syncAfterTeleport(camPos[0], hasY ? Number(y) : groundY, camPos[2]);
            const chase = driveCar.getChaseCamera();
            camPos[0] = chase.pos[0];
            camPos[1] = chase.pos[1];
            camPos[2] = chase.pos[2];
        } else if (mode === 'walk') {
            walkFeet[0] = camPos[0];
            walkFeet[1] = hasY ? Math.max(groundY, Number(y) - EYE_HEIGHT) : groundY;
            walkFeet[2] = camPos[2];
            camPos[1] = walkFeet[1] + EYE_HEIGHT;
        } else {
            const targetY = hasY ? Number(y) : (groundY + 28);
            camPos[1] = Math.max(groundY + EYE_HEIGHT, targetY);
            walkFeet[0] = camPos[0];
            walkFeet[1] = camPos[1] - EYE_HEIGHT;
            walkFeet[2] = camPos[2];
        }
        walkVel[0] = 0; walkVel[1] = 0; walkVel[2] = 0;
        if (typeof newYaw === 'number' && Number.isFinite(newYaw)) yaw = newYaw;
        if (typeof newPitch === 'number' && Number.isFinite(newPitch)) pitch = clamp(newPitch, -1.48, 1.48);
        updateBasis();
    }

    // Keyboard & Pointer bindings
    const keys = new Set();
    let dragging = false;
    let lastPtrX = 0;
    let lastPtrY = 0;

    function attachInputHandlers(setTimeModeFn) {
        window.addEventListener('keydown', (e) => {
            if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
            keys.add(e.code);
            if (e.key === '1') setTimeModeFn('day');
            else if (e.key === '2') setTimeModeFn('dusk');
            else if (e.key === '3') setTimeModeFn('night');
            else if (e.key === 'f' || e.key === 'F') {
                if (mode === 'walk') setMode('fly');
                else if (mode === 'drive') exitCar();
                else setMode('walk');
            } else if (e.key === 'm' || e.key === 'M') {
                setMode(mode === 'fly' ? 'walk' : 'fly');
            } else if ((e.key === 'e' || e.key === 'E') && !e.repeat) {
                if (mode === 'drive' && driveCar.isInCar()) exitCar();
                else if (mode === 'walk') enterNearestCar();
            } else if (e.key === 'h' || e.key === 'H') {
                hud.toggleVisibility();
            }
        });
        window.addEventListener('keyup', (e) => keys.delete(e.code));

        canvas.addEventListener('pointerdown', (e) => {
            if (e.button === 2 || e.button === 0) {
                dragging = true;
                lastPtrX = e.clientX;
                lastPtrY = e.clientY;
            }
        });
        window.addEventListener('pointerup', () => { dragging = false; });
        window.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - lastPtrX;
            const dy = e.clientY - lastPtrY;
            lastPtrX = e.clientX;
            lastPtrY = e.clientY;
            yaw -= dx * 0.003;
            pitch = clamp(pitch - dy * 0.003, -1.48, 1.48);
            userTurnedInElev = true;
            updateBasis();
        });
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    return {
        camPos,
        walkFeet,
        camFwd,
        camRight,
        camUp,
        activeWalkInfo,
        getMode: () => mode,
        getYaw: () => yaw,
        getPitch: () => pitch,
        getSpeed: () => currentSpeed,
        updateBasis,
        refreshActiveBuildingInfo,
        enterNearestCar,
        exitCar,
        setMode,
        setWalkInput,
        boardElevatorIfNeeded,
        clearKeyboardDrive: () => { usedKeyboardDrive = false; },
        stepMovement,
        teleport,
        attachInputHandlers,
    };
}
