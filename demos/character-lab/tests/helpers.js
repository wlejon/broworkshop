// Shared test helpers. Everything drives the app through its own key map and
// `tune`, so the paths under test are the paths a keyboard and the HUD take.
// Tests import lab.js, never main.js (an imported entry module is evaluated a
// second time — see ENGINE-ISSUES.md).
//
// Physics interpolation makes the RENDER transform lag a step; getState() is
// the true stepped state, so assertions read charState (filled from it).

import { keys, charState, teleport, isCrouched, RADIUS, STAND_HALF, CROUCH_HALF } from "/app/lab.js";

export function clearKeys() {
    for (const k of Object.keys(keys)) keys[k] = false;
}

/**
 * Hold keys for `ms` of virtual time, one advanceTime per 16 ms so the fixed
 * physics tick runs the same steps every run. Returns whether the controller
 * reported the move as blocked DURING the hold.
 */
export function hold(ms, ...held) {
    clearKeys();
    for (const k of held) keys[k] = true;
    let blocked = false;
    for (let t = 0; t < ms; t += 16) {
        advanceTime(16);
        if (charState.blocked) blocked = true;
    }
    clearKeys();
    advanceTime(16);
    return blocked;
}

/** Drop the character with its feet at (x, footY, z), at rest, and settle. */
export function place(x, footY, z) {
    clearKeys();
    if (isCrouched()) advanceTime(64);
    teleport(x, footY + RADIUS + (isCrouched() ? CROUCH_HALF : STAND_HALF), z);
    advanceTime(160);
}

export const footY = () => charState.position.y - RADIUS - (isCrouched() ? CROUCH_HALF : STAND_HALF);

/** Advance `ms` of virtual time in frame-sized steps. */
export function run(ms, each) {
    for (let t = 0; t < ms; t += 16) {
        advanceTime(16);
        if (each && each(t) === false) break;
    }
}
