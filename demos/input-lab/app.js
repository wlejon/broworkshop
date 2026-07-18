// Input Lab — a diagnostic dashboard for everything bro accepts as input.
//
// bro ships a full W3C Gamepad API (17 buttons, 4 axes, dual-rumble haptics),
// W3C Pointer + Touch Events with per-pointer capture and engine-side
// pinch/pan/rotate recognition, IME composition against the text controls, and
// an action-binding layer that unifies keyboard, mouse buttons, gamepad buttons
// and stick-axis directions behind two calls. Almost none of it is exercised by
// any app in the workshop. This is that app.
//
//   gamepad.js   The live controller: a schematic pad that lights up per
//                button and moves its stick knobs off axes[], plus the raw
//                numbers for all 17 buttons and 4 axes, the slot list, and the
//                rumble bench. Everything reads one snapshot per frame.
//   actions.js   The binding table. Every action shows isActionPressed as a
//                dot and getActionStrength as a bar, in the same row, so the
//                digital/analog split is visible rather than described. Chips
//                rebind live through rebindAction().
//   ship.js      A playable target whose ONLY input is getActionStrength() —
//                the proof that analog strength drives smooth motion where a
//                key would be binary.
//   touch.js     Three claims about pointers that need more than one of them:
//                a visualiser tracking every live contact by pointerId with
//                its own colour and trail; a capture demo that MEASURES how
//                many moves arrive at an element while the pointer is outside
//                its bounds (which is exactly what setPointerCapture buys);
//                and an interleaved log of the raw pointer/touch stream next
//                to the compat mouse events a tap synthesizes from it.
//   gestures.js  A map you can pinch, two-finger pan and twist, driven by the
//                gesture events bro recognises from the two oldest contacts.
//                e.scale / e.rotation are relative to gesturestart, so the
//                view multiplies onto a base captured there.
//   ime.js       Composition: the preedit, its derived range, the commit, and
//                the fact that a cancel restores rather than clears. Buttons
//                drive the headless imeCompose/imeCommit/imeCancel seams so
//                the panel demonstrates itself without a CJK IME installed.
//
// The frame loop is deliberately one place: poll the gamepads once, then let
// every panel read that same snapshot. Two panels polling independently would
// be able to disagree about the same frame. Panels that are purely event-driven
// (the whole IME panel, the capture readout) update from their handlers and are
// absent from the loop entirely — there is nothing to poll.
//
// House rule throughout: no readout block rebuilds its innerHTML per frame.
// Rows are built once and only textContent is rewritten, because a per-frame
// rebuild relayouts the panel at 60 Hz and paints torn.

import { installSystemMenu } from '/lib/system-menu.js';
import {
    initGamepadPanel, tickGamepadPanel, pollPads, padState, currentPad,
    play as rumblePlay, ramp as rumbleRamp, stop as rumbleStop, rumbleLog,
} from '/app/gamepad.js';
import {
    initActionPanel, tickActionPanel, actionState, ACTIONS,
    commitBinding, restoreDefaults, strength,
} from '/app/actions.js';
import { initShip, tickShip, drawShip, updateShipReadout, ship } from '/app/ship.js';
import {
    initPointerPanel, tickPointerPanel, pointerState, captureState,
} from '/app/touch.js';
import {
    initGesturePanel, tickGesturePanel, gestureState, reset as resetGesture,
} from '/app/gestures.js';
import {
    initImePanel, imeState, driveCJK, driveAccent, driveCancel, resetIme,
} from '/app/ime.js';

installSystemMenu();

initGamepadPanel();
initActionPanel();
initShip();
initPointerPanel();
initGesturePanel();
initImePanel();

// Fixed-step integration. The ship is a physical thing being driven by analog
// values, so a variable dt would make the same stick deflection produce
// different travel on a slow frame — which would muddy exactly the property
// this app exists to show.
const STEP = 1 / 60;
let accumulator = 0;
let last = performance.now();

export const stats = { frames: 0, steps: 0 };

function frame() {
    const now = performance.now();
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;          // a stall must not fast-forward the sim

    pollPads();                        // one poll, shared by every panel
    tickGamepadPanel();
    tickActionPanel();
    tickPointerPanel();                // canvas redraw only — state is event-driven
    tickGesturePanel();

    accumulator += dt;
    while (accumulator >= STEP) { tickShip(STEP); accumulator -= STEP; stats.steps++; }
    drawShip();
    updateShipReadout();

    stats.frames++;
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Exported for tests: the smoke test drives the app through exactly the entry
// points the UI uses, rather than reaching into bro.settings behind its back.
export {
    padState, currentPad, actionState, ACTIONS, ship, strength,
    commitBinding, restoreDefaults, tickShip,
    rumblePlay, rumbleRamp, rumbleStop, rumbleLog,
    pointerState, captureState,
    gestureState, resetGesture,
    imeState, driveCJK, driveAccent, driveCancel, resetIme,
};
