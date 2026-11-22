// Per-building elevator cab state, trapezoidal kinematics, and shaft door gating.
import { localToWorld, worldToLocal } from '/app/buildings/building_gen.js';

const MAX_ELEVATORS = 128;

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

export function createElevators(streamer) {
    const states = new Map();

    function ensureBuilding(bp) {
        if (!bp || !bp.elevatorShaft) return null;
        let st = states.get(bp.id);
        if (st) {
            states.delete(bp.id);
            states.set(bp.id, st);
            return st;
        }
        const y0 = bp.floors[0].yBase;
        st = {
            buildingId: bp.id,
            bp,
            currentFloor: 0,
            targetFloor: 0,
            currentY: y0,
            prevY: y0,
            velocityY: 0,
            doorOpen: 1,
            state: 'idle',
        };
        if (states.size >= MAX_ELEVATORS) {
            states.delete(states.keys().next().value);
        }
        states.set(bp.id, st);
        return st;
    }

    function callOrRide(buildingId, targetFloor, explicitBp = null) {
        const bp = explicitBp || streamer?.getBlueprintById?.(buildingId) || states.get(buildingId)?.bp || null;
        if (!bp || !bp.elevatorShaft) {
            return { ok: false, reason: 'no_elevator', buildingId };
        }
        const st = ensureBuilding(bp);
        const clamped = clamp(Math.round(Number(targetFloor) || 0), 0, bp.totalFloors - 1);
        st.targetFloor = clamped;
        const targetY = bp.floors[clamped].yBase;
        if (Math.abs(targetY - st.currentY) <= 0.01) {
            st.currentY = targetY;
            st.prevY = targetY;
            st.velocityY = 0;
            st.currentFloor = clamped;
            st.doorOpen = 1;
            st.state = 'idle';
        } else {
            st.doorOpen = 0;
            st.state = targetY > st.currentY ? 'moving_up' : 'moving_down';
        }
        const sh = bp.elevatorShaft;
        return {
            ok: true,
            buildingId: bp.id,
            targetFloor: st.targetFloor,
            currentFloor: st.currentFloor,
            currentY: st.currentY,
            state: st.state,
            cabCenter: localToWorld(bp, sh.cx, st.currentY, sh.cz),
        };
    }

    function update(dt) {
        if (!(dt > 0)) return;
        const stepDt = Math.min(dt, 0.05);
        for (const st of states.values()) {
            st.prevY = st.currentY;
            const bp = st.bp;
            const targetY = bp.floors[st.targetFloor].yBase;
            const diff = targetY - st.currentY;
            const dist = Math.abs(diff);
            const accel = 18.0;
            if (dist <= 0.02 && Math.abs(st.velocityY) <= accel * stepDt * 1.5) {
                st.currentY = targetY;
                st.velocityY = 0;
                st.currentFloor = st.targetFloor;
                st.doorOpen = 1;
                st.state = 'idle';
                continue;
            }
            const maxSpeed = clamp(6.0 + bp.totalFloors * 0.35, 6.0, 18.0);
            const dir = diff >= 0 ? 1 : -1;
            const stopDist = (st.velocityY * st.velocityY) / (2.0 * accel);
            const minClose = dist < 0.25 ? Math.max(0.35, Math.min(2.0, dist * 6.0)) : 0;
            if (dist <= stopDist && st.velocityY * dir > 0) {
                st.velocityY -= dir * accel * stepDt;
                if (st.velocityY * dir < minClose) st.velocityY = dir * minClose;
            } else {
                st.velocityY += dir * accel * stepDt;
                if (minClose > 0 && st.velocityY * dir > 0 && st.velocityY * dir < minClose) {
                    st.velocityY = dir * minClose;
                }
            }
            st.velocityY = clamp(st.velocityY, -maxSpeed, maxSpeed);
            const nextY = st.currentY + st.velocityY * stepDt;
            if ((diff > 0 && nextY >= targetY) || (diff < 0 && nextY <= targetY)) {
                st.currentY = targetY;
                st.velocityY = 0;
                st.currentFloor = st.targetFloor;
                st.doorOpen = 1;
                st.state = 'idle';
            } else {
                st.currentY = nextY;
                st.currentFloor = clamp(Math.round((st.currentY - bp.baseY) / bp.floorHeight), 0, bp.totalFloors - 1);
                st.doorOpen = 0;
                st.state = dir > 0 ? 'moving_up' : 'moving_down';
            }
        }
    }

    function getState(buildingId) {
        const st = states.get(buildingId);
        if (!st) return null;
        return {
            buildingId: st.buildingId,
            currentFloor: st.currentFloor,
            targetFloor: st.targetFloor,
            currentY: st.currentY,
            prevY: st.prevY,
            deltaY: st.currentY - st.prevY,
            velocityY: st.velocityY,
            doorOpen: st.doorOpen,
            state: st.state,
            shaft: st.bp.elevatorShaft,
        };
    }

    function isDoorOpenAt(buildingId, floorIndex) {
        const st = states.get(buildingId);
        if (!st) return floorIndex === 0;
        const fl = st.bp.floors[floorIndex];
        if (!fl) return false;
        return st.state === 'idle' && Math.abs(st.currentY - fl.yBase) <= 0.35;
    }

    function getActiveFloorHint(bp, feetPos) {
        if (!bp || !bp.elevatorShaft || !feetPos) return null;
        const st = states.get(bp.id);
        if (!st) return null;
        const [lx, , lz] = worldToLocal(bp, feetPos[0], feetPos[1], feetPos[2]);
        const sh = bp.elevatorShaft;
        if (
            lx >= sh.x0 && lx <= sh.x1 &&
            lz >= sh.z0 && lz <= sh.z1 &&
            Math.abs(feetPos[1] - st.currentY) <= 1.2
        ) {
            return st.currentFloor;
        }
        return null;
    }

    return {
        ensureBuilding,
        callOrRide,
        update,
        getState,
        isDoorOpenAt,
        getActiveFloorHint,
    };
}
