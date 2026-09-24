// Input Lab — a diagnostic dashboard for everything bro accepts as input: the
// W3C Gamepad API (17 buttons, 4 axes, dual-rumble), Pointer + Touch Events
// with per-pointer capture and engine-side pinch/pan/rotate recognition, IME
// composition, and the action layer that unifies keys, mouse buttons, pad
// buttons and stick directions behind two calls.
//
//   gamepad.js   the live controller (drawn by pad-draw.js), raw numbers for
//                every button and axis, the slot list, the rumble bench
//   actions.js   the binding table: isActionPressed as a dot beside
//                getActionStrength as a bar, chips that rebind live
//   ship.js      a playable target whose ONLY input is getActionStrength()
//   touch.js     multi-touch visualiser, a measured pointer-capture demo, and
//                the raw pointer/touch stream beside its compat mouse events
//   gestures.js  a map driven by gesturestart / change / end
//   ime.js       composition: preedit, derived range, commit, cancel-restores
//
// The frame loop is one place: poll the gamepads once, then every panel reads
// that same snapshot. This file is the thin boot; tests import the modules.

import { boot, fixedStep } from "/lib/kit/index.js";
import { initGamepadPanel, tickGamepadPanel, pollPads } from "/app/gamepad.js";
import { initActionPanel, tickActionPanel } from "/app/actions.js";
import { initShip, tickShip, drawShip, updateShipReadout } from "/app/ship.js";
import { initPointerPanel, tickPointerPanel } from "/app/touch.js";
import { initGesturePanel, tickGesturePanel } from "/app/gestures.js";
import { initImePanel } from "/app/ime.js";

const app = boot({});

initGamepadPanel();
initActionPanel();
initShip();
initPointerPanel();
initGesturePanel();
initImePanel();

// Fixed-step ship: the same stick deflection must travel the same distance
// whatever the frame rate, or the analog comparison is muddied.
const step = fixedStep(1 / 60);
let last = performance.now();

function frame() {
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000);   // a stall must not fast-forward the sim
    last = now;
    pollPads();                                       // one poll, shared by every panel
    tickGamepadPanel();
    tickActionPanel();
    tickPointerPanel();
    tickGesturePanel();
    step(dt, tickShip);
    drawShip();
    updateShipReadout();
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

app.status.ok('ready');
