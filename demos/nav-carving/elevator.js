// elevator.js — the lift: a car on a request queue, with doors.
//
// Pure state (no scene): calls queue floors first-come first-served; the car
// travels at LIFT_SPEED, arrives, and dwells with its doors open so riders can
// board or leave. Riders are agents.js's business; they read `boardable`.

import { FLOOR_Y } from "/app/level.js";
import { LIFT_SPEED } from "/app/plan.js";

export const DWELL = 1.6;   // seconds the doors stay open at a stop

export const lift = {
    y: 0,
    floor: 0,          // floor index the car is stopped at, -1 while travelling
    queue: [],         // requested floors, in call order
    dwell: 0,          // doors-open time left
    door: 0,           // 0 shut .. 1 open (visual)
    trips: 0,          // stops made
};

export function resetLift() {
    Object.assign(lift, { y: 0, floor: 0, queue: [], dwell: 0, door: 0, trips: 0 });
}

/** Request a stop. A call at the floor the car is idling on just opens the doors. */
export function callLift(floor) {
    if (floor < 0 || floor >= FLOOR_Y.length) return;
    if (lift.floor === floor && lift.dwell > 0) return;
    if (!lift.queue.includes(floor)) lift.queue.push(floor);
}

/** Doors open at `floor` right now. */
export function boardable(floor) {
    return lift.floor === floor && lift.dwell > 0;
}

export function tickLift(dt) {
    if (lift.dwell > 0) {
        lift.dwell = Math.max(0, lift.dwell - dt);
        lift.door = Math.min(1, lift.door + dt * 4);
        return;
    }
    lift.door = Math.max(0, lift.door - dt * 4);
    if (!lift.queue.length || lift.door > 0) return;   // doors shut before it moves
    const target = lift.queue[0], ty = FLOOR_Y[target];
    const dy = ty - lift.y, step = LIFT_SPEED * dt;
    if (Math.abs(dy) <= step) {
        lift.y = ty;
        lift.floor = target;
        lift.queue.shift();
        lift.dwell = DWELL;
        lift.trips++;
    } else {
        lift.y += Math.sign(dy) * step;
        lift.floor = -1;
    }
}

export function liftLabel() {
    return lift.floor >= 0 ? `F${lift.floor} ${lift.dwell > 0 ? 'open' : 'idle'} (${lift.y.toFixed(1)} m)` : `moving (${lift.y.toFixed(1)} m)`;
}
