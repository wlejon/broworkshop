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
// The action NAMES are unchanged from chunk 1, which is what let chunk 3 hang
// gamepad bindings off the same `torque_*` actions without touching a line of
// vehicle code — the bindings below are pure additions to the same table.
//
// ANALOG (chunk 3). A keyboard has one bit per key and a gamepad has 8 bits per
// trigger, and a car is the machine where that difference is most obvious: half
// throttle should be half throttle, and a small stick deflection should be a
// gentle steering input rather than instant full lock. So the vehicles no
// longer read the boolean `held` set for MAGNITUDE — they read strength(), which
// is the engine's own `getActionStrength` for the action, floored by 1.0 while a
// KEY (or the smoke test's setHeld) has it down. A key therefore still yields
// exactly 1.0 and the keyboard drives identically to chunk 1, while a trigger at
// 40% yields 0.40 through the very same code path.
//
// `held` survives unchanged as the DIGITAL state, because the driving logic has
// genuine either/or decisions in it — is this a brake application or a reverse
// request, is the parking brake on — and those are not analog questions.

/** Action name → default bindings. Keyboard first, then the pad. */
export const ACTIONS = {
    // Triggers: the two analog pedals. RT is the throttle, LT the brake.
    throttle:   ['w', 'ArrowUp', 'gamepad:righttrigger'],
    brake:      ['s', 'ArrowDown', 'gamepad:lefttrigger'],
    // The left stick's X axis, bound as its two DIRECTIONS. Each side reports
    // its own deadzone-rescaled deflection, so the steering integrator sees a
    // signed analog target instead of a pair of switches.
    steerLeft:  ['a', 'ArrowLeft', 'gamepad:leftx-'],
    steerRight: ['d', 'ArrowRight', 'gamepad:leftx+'],
    handbrake:  [' ', 'gamepad:south'],
    respawn:    ['r', 'gamepad:north'],
    // Staging, pad-only: the keyboard equivalents (1/2/3 and Tab) are direct
    // key handlers in app.js and deliberately stay off the rebindable list.
    camera:     ['gamepad:rightshoulder'],
    swap:       ['gamepad:leftshoulder'],
};

/**
 * A stick has to move further than a key does before it counts as "pressed",
 * or the pad's resting jitter drives the car. 0.18 is past every deflection a
 * centred stick produced on the pads this was tested with, and the strength
 * curve rescales from there — (m − 0.18) / 0.82 — so the first millimetre past
 * the deadzone is a genuinely small steering input rather than a step to 0.22.
 */
const STICK_DEADZONE = 0.18;

/** Live held-state for every action. Mutated by the listener and by setHeld. */
export const held = Object.create(null);
for (const name in ACTIONS) held[name] = false;

// Which actions are down from a source that has no analog value to give: keys,
// and the smoke test's setHeld. Tracked separately from `held` precisely so a
// half-pressed TRIGGER does not get rounded up to 1.0 by the digital state it
// also sets — that bug would have quietly deleted the entire analog feature.
const keyed = Object.create(null);
for (const name in ACTIONS) keyed[name] = false;

// Registering the actions with the engine is what makes them rebindable in the
// settings panel. Guarded because the smoke test imports this module in
// contexts where bro.settings may not have been installed yet.
const haveSettings = typeof bro !== 'undefined' && bro.settings &&
                     typeof bro.settings.defineAction === 'function' &&
                     typeof bro.settings.getActionStrength === 'function';
if (haveSettings) {
    for (const name in ACTIONS) {
        bro.settings.defineAction(`torque_${name}`, ACTIONS[name],
                                  { deadzone: STICK_DEADZONE });
    }
}

let onRespawn = null;
let onCameraCycle = null;
let onVehicleSwap = null;

document.addEventListener('action', (e) => {
    const a = e.detail.action;
    if (!a || !a.startsWith('torque_')) return;
    const key = a.slice('torque_'.length);
    if (!(key in held)) return;
    const down = e.detail.phase === 'down';
    held[key] = down;
    // A binding string starting with "gamepad:" is the only kind that can carry
    // a partial value; everything else is a switch and pins strength to 1.
    const src = e.detail.key || '';
    keyed[key] = down && !String(src).startsWith('gamepad:');
    if (!down) return;
    if (key === 'respawn' && onRespawn) onRespawn();
    if (key === 'camera' && onCameraCycle) onCameraCycle();
    if (key === 'swap' && onVehicleSwap) onVehicleSwap();
});

/** Force an action's held state. The keyboard and the smoke test share this path. */
export function setHeld(name, on) {
    if (name in held) { held[name] = !!on; keyed[name] = !!on; }
}

/** Clear every action — used when switching vehicles so input never carries over. */
export function releaseAll() {
    for (const k in held) { held[k] = false; keyed[k] = false; }
}

/**
 * Analog strength for an action, 0..1.
 *
 * The floor is the digital state: a key down, or a setHeld from the test, is a
 * full 1.0 and nothing the engine reports can lower it. Above that floor the
 * engine's own reading wins — trigger value straight through, stick deflection
 * rescaled past the deadzone. One function, both input devices, and every
 * vehicle module calls it in place of the `held.x ? 1 : 0` it used to write.
 */
export function strength(name) {
    let s = keyed[name] ? 1 : 0;
    if (s < 1 && haveSettings) {
        const g = bro.settings.getActionStrength(`torque_${name}`);
        if (typeof g === 'number' && g > s) s = g;
    }
    return s > 1 ? 1 : s < 0 ? 0 : s;
}

/** Signed analog steering demand, right positive. The pair of axis bindings. */
export function steerDemand() {
    return strength('steerRight') - strength('steerLeft');
}

/** app.js installs the one respawn handler; it always targets the ACTIVE vehicle. */
export function setRespawnHandler(fn) { onRespawn = fn; }

/** Pad-only staging buttons, wired by app.js to the same paths the keys use. */
export function setNavHandlers({ onCamera, onSwap } = {}) {
    onCameraCycle = onCamera || null;
    onVehicleSwap = onSwap || null;
}

/**
 * What the driver is actually asking for this frame, digital and analog side by
 * side. The HUD draws exactly this, because the contrast between the two
 * columns IS the feature — on the keyboard they are identical, on a pad the
 * analog column is a continuum and the digital one is still a row of switches.
 */
export function inputSnapshot() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads
        ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    const analog = Object.create(null);
    const digital = Object.create(null);
    for (const name in ACTIONS) {
        analog[name] = strength(name);
        digital[name] = !!held[name];
    }
    return { analog, digital, steer: analog.steerRight - analog.steerLeft, pad };
}

/** The first connected pad, or null. Rumble and the HUD both want this. */
export function activePad() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads
        ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
}

/**
 * Steering is rate-limited rather than binary: a keyboard gives 0 or 1, and a
 * vehicle that snaps to full lock in one tick is undriveable. Return to centre
 * is faster than turn-in, which is what a self-centering rack does. All three
 * vehicles want this, with different rates — a tank's steering lever is much
 * less twitchy than a car's wheel — so it lives here as a small reusable
 * integrator rather than being copied into each module.
 *
 * The TARGET is now analog (chunk 3). On a keyboard that target is still
 * exactly ±1 and the behaviour is bit-for-bit what it was; on a stick it is
 * the deflection, so the rack settles at a partial lock and holds there. The
 * rate limit stays either way — a stick can be slammed to the stop too.
 */
export function makeSteering(rateIn, rateBack) {
    let steer = 0;
    return {
        get value() { return steer; },
        reset() { steer = 0; },
        /** Advance toward the target implied by the steer actions' strengths. */
        step(dt) {
            const target = steerDemand();
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
