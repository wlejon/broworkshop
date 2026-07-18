// input.js — one driver, three vehicles.
//
// Chunk 1 kept the held-action set inside car.js, which was right when the car
// was the only thing to drive. With a garage it is wrong twice over: each
// vehicle module would register its own `action` listener (they never
// unregister, so a rebuilt vehicle would leave a live listener behind holding a
// destroyed constraint), and the three vehicles would each carry a private copy
// of "is W down" that could disagree.
//
// So the driver is a singleton and the vehicles are what changes underneath
// them. Exactly one listener exists for the lifetime of the app; `held` is the
// one true keyboard state; and every vehicle module reads the same object.
// Switching vehicles is then a pure rebinding — no input state moves.
//
// The action NAMES are unchanged from chunk 1, so chunk 3 can still hang
// gamepad bindings off `torque_*` without touching any of the vehicle code.

/** Action name → default key bindings. Chunk 3 appends "gamepad:*" to these. */
export const ACTIONS = {
    throttle:   ['w', 'ArrowUp'],
    brake:      ['s', 'ArrowDown'],
    steerLeft:  ['a', 'ArrowLeft'],
    steerRight: ['d', 'ArrowRight'],
    handbrake:  [' '],
    respawn:    ['r'],
};

/** Live held-state for every action. Mutated by the listener and by setHeld. */
export const held = Object.create(null);
for (const name in ACTIONS) held[name] = false;

// Registering the actions with the engine is what makes them rebindable in the
// settings panel. Guarded because the smoke test imports this module in
// contexts where bro.settings may not have been installed yet.
if (typeof bro !== 'undefined' && bro.settings && bro.settings.defineAction) {
    for (const name in ACTIONS) bro.settings.defineAction(`torque_${name}`, ACTIONS[name]);
}

let onRespawn = null;

document.addEventListener('action', (e) => {
    const a = e.detail.action;
    if (!a || !a.startsWith('torque_')) return;
    const key = a.slice('torque_'.length);
    if (!(key in held)) return;
    held[key] = e.detail.phase === 'down';
    if (key === 'respawn' && e.detail.phase === 'down' && onRespawn) onRespawn();
});

/** Force an action's held state. The keyboard and the smoke test share this path. */
export function setHeld(name, on) {
    if (name in held) held[name] = !!on;
}

/** Clear every action — used when switching vehicles so input never carries over. */
export function releaseAll() {
    for (const k in held) held[k] = false;
}

/** app.js installs the one respawn handler; it always targets the ACTIVE vehicle. */
export function setRespawnHandler(fn) { onRespawn = fn; }

/**
 * Steering is rate-limited rather than binary: a keyboard gives 0 or 1, and a
 * vehicle that snaps to full lock in one tick is undriveable. Return to centre
 * is faster than turn-in, which is what a self-centering rack does. All three
 * vehicles want this, with different rates — a tank's steering lever is much
 * less twitchy than a car's wheel — so it lives here as a small reusable
 * integrator rather than being copied into each module.
 */
export function makeSteering(rateIn, rateBack) {
    let steer = 0;
    return {
        get value() { return steer; },
        reset() { steer = 0; },
        /** Advance toward the target implied by the held steer actions. */
        step(dt) {
            const target = (held.steerRight ? 1 : 0) - (held.steerLeft ? 1 : 0);
            const rate = (target === 0 || Math.sign(target) !== Math.sign(steer))
                ? rateBack : rateIn;
            const s = rate * dt;
            steer += Math.max(-s, Math.min(s, target - steer));
            if (Math.abs(steer) < 1e-4) steer = 0;
            return steer;
        },
    };
}

/**
 * Chassis roll: the angle between the chassis' own up axis and world up, in
 * degrees, signed so that a right-hand lean is positive. The motorcycle's whole
 * demonstration is this number staying small with the lean controller on and
 * running away without it, and the tank uses it to report how far it is tipped
 * on a slope — so it is shared rather than duplicated.
 */
export function rollDegrees(node) {
    const o = node.localToWorld(0, 0, 0);
    const up = node.localToWorld(0, 1, 0);
    const right = node.localToWorld(1, 0, 0);
    const uy = Math.max(-1, Math.min(1, up.y - o.y));
    const mag = Math.acos(uy) * 180 / Math.PI;
    // Sign from which way the chassis' right axis has dropped: rolling to the
    // right pushes local +X below the horizon.
    return (right.y - o.y) < 0 ? mag : -mag;
}
