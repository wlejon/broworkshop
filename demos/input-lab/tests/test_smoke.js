// test_smoke.js — headless integration test for Input Lab.
//
// Run:
//   ./build/Release/bro-headless.exe ../broworkshop/demos/input-lab \
//       ../broworkshop/demos/input-lab/tests/test_smoke.js
//
// Everything here is a MEASURED assertion, not a no-throw. The one that
// matters most is the analog block: an injected axis at 0.5 must produce a
// strength of (0.5 - deadzone) / (1 - deadzone), i.e. an intermediate value.
// If the action layer ever quantised axis bindings to 0/1 the ship would still
// move and the panel would still light up — this is the only thing that would
// catch it.

import {
    padState, currentPad, actionState, ACTIONS, ship, strength,
    commitBinding, restoreDefaults, tickShip, rumblePlay, rumbleStop, rumbleLog,
    pointerState, captureState, gestureState, resetGesture,
    imeState, driveCJK, driveAccent, driveCancel, resetIme,
} from '/app/app.js';

const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-3 : eps);

advanceTime(64);
flush();

// Bindings persist to the engine-global .bro_settings.json, so a previous run
// (or a human clicking around) would otherwise poison every assertion below.
restoreDefaults();
flush();

// ── connection ──────────────────────────────────────────────────────────────

let connectEvents = 0, connectedIndex = -1, connectedId = null;
window.addEventListener('gamepadconnected', (e) => {
    connectEvents++; connectedIndex = e.gamepad.index; connectedId = e.gamepad.id;
});

assert(navigator.getGamepads().filter((p) => p).length === 0, 'no pads before injection');
assert(document.getElementById('padEmpty').style.display !== 'none', 'empty state visible');

const slot = gamepadConnect('Smoke Test Pad');
flush();
advanceTime(32);

assert(slot === 0, 'first injected pad takes slot 0, got ' + slot);
assert(connectEvents === 1, 'gamepadconnected fired exactly once, got ' + connectEvents);
assert(connectedIndex === 0, 'event carried slot 0');
assert(connectedId === 'Smoke Test Pad', 'event carried the injected id, got ' + connectedId);

const pads = navigator.getGamepads();
assert(pads[0] !== null, 'slot 0 populated in getGamepads()');
assert(pads[0].mapping === 'standard', 'mapping is standard');
assert(pads[0].buttons.length === 17, '17 buttons, got ' + pads[0].buttons.length);
assert(pads[0].axes.length === 4, '4 axes, got ' + pads[0].axes.length);
assert(pads[0].vibrationActuator.effects.indexOf('dual-rumble') >= 0, 'dual-rumble advertised');

// The app's own view of the world must agree, through its own frame loop.
assert(padState.connectCount === 1, 'panel counted the connect');
assert(currentPad() && currentPad().id === 'Smoke Test Pad', 'panel selected the new pad');
assert(document.getElementById('padEmpty').style.display === 'none', 'empty state hidden');
assert(document.getElementById('padList').textContent.indexOf('Smoke Test Pad') >= 0,
       'slot list names the pad');

// ── digital button ──────────────────────────────────────────────────────────

gamepadButton(0, 'south', true);
flush(); advanceTime(32);

let gp = navigator.getGamepads()[0];
assert(gp.buttons[0].pressed === true, 'south reads pressed');
assert(gp.buttons[0].value === 1, 'south value is 1, got ' + gp.buttons[0].value);
assert(document.getElementById('brow0').className.indexOf('on') >= 0,
       'south readout row lit');
assert(document.getElementById('bval0').textContent === '1.00', 'south readout shows 1.00');

gamepadButton(0, 'south', false);
flush(); advanceTime(32);
assert(navigator.getGamepads()[0].buttons[0].pressed === false, 'south released');
assert(document.getElementById('brow0').className.indexOf('on') < 0, 'south row unlit');

// ── analog trigger ──────────────────────────────────────────────────────────
//
// il_boost is bound to gamepad:righttrigger. A trigger's contribution is its
// raw value with no deadzone rescale, so 0.63 in must be 0.63 out.

gamepadButton(0, 'righttrigger', true, 0.63);
flush(); advanceTime(32);

gp = navigator.getGamepads()[0];
assert(near(gp.buttons[7].value, 0.63, 1e-5),
       'righttrigger value 0.63, got ' + gp.buttons[7].value);
const boost = strength('il_boost');
assert(near(boost, 0.63, 1e-5), 'trigger-bound action strength is 0.63, got ' + boost);
assert(boost > 0.1 && boost < 0.9, 'trigger strength is INTERMEDIATE, not 0/1: ' + boost);
assert(bro.settings.isActionPressed('il_boost') === true, 'trigger past 0.1 counts as pressed');

gamepadButton(0, 'righttrigger', false, 0);
flush(); advanceTime(32);
assert(strength('il_boost') === 0, 'trigger released to 0');

// ── analog axis: the core claim ─────────────────────────────────────────────
//
// il_right is bound to gamepad:leftx+ with deadzone 0.15, so the documented
// rescale (m - dz) / (1 - dz) predicts each of these exactly. Three distinct
// intermediate points, because two could be a coincidence.

const DZ = 0.15;
const expect = (m) => (m - DZ) / (1 - DZ);

for (const m of [0.3, 0.5, 0.75]) {
    gamepadAxis(0, 'leftx', m);
    flush(); advanceTime(32);
    assert(near(navigator.getGamepads()[0].axes[0], m, 1e-5),
           'axes[0] reflects injected ' + m);
    const s = strength('il_right');
    assert(near(s, expect(m), 1e-4),
           `leftx+ @${m} -> strength ${s}, expected ${expect(m)}`);
    assert(s > 0.01 && s < 0.99, `strength at ${m} is genuinely intermediate: ${s}`);
    assert(bro.settings.isActionPressed('il_right') === true, 'axis past deadzone is pressed');
}

// ...and monotonic, which quantisation could not fake across three points.
gamepadAxis(0, 'leftx', 0.3); flush(); const s30 = strength('il_right');
gamepadAxis(0, 'leftx', 0.5); flush(); const s50 = strength('il_right');
gamepadAxis(0, 'leftx', 0.75); flush(); const s75 = strength('il_right');
assert(s30 < s50 && s50 < s75, `strength is monotonic: ${s30} < ${s50} < ${s75}`);
assert(s75 - s50 > 0.1 && s50 - s30 > 0.1, 'the steps are real, not rounding');

// Full deflection saturates at exactly 1; below the deadzone is exactly 0.
gamepadAxis(0, 'leftx', 1.0); flush();
assert(strength('il_right') === 1, 'full deflection is 1');
gamepadAxis(0, 'leftx', 0.05); flush(); advanceTime(32);
assert(strength('il_right') === 0, 'inside the deadzone is 0');
assert(bro.settings.isActionPressed('il_right') === false, 'deadzone releases the latch');

// The opposite direction of the same axis must stay silent.
gamepadAxis(0, 'leftx', -0.8); flush(); advanceTime(32);
assert(strength('il_right') === 0, 'leftx+ ignores negative deflection');
assert(strength('il_left') > 0.5, 'leftx- picks it up instead: ' + strength('il_left'));
gamepadAxis(0, 'leftx', 0); flush(); advanceTime(32);

// ── analog drives the ship differently from digital ─────────────────────────
//
// Same action, same physics, two binding kinds: half a stick must travel
// materially less than a held key over the same number of steps.

function runShip(steps) {
    ship.x = 280; ship.y = 120; ship.vx = 0; ship.vy = 0; ship.angle = 0;
    for (let i = 0; i < steps; i++) tickShip(1 / 60);
    return ship.x - 280;
}

bro.settings.rebindAction('il_thrust', ['gamepad:lefty-']);
gamepadAxis(0, 'lefty', -1.0); flush();
const distFull = runShip(60);
gamepadAxis(0, 'lefty', -0.5); flush();
const distHalf = runShip(60);
gamepadAxis(0, 'lefty', 0); flush();
const distZero = runShip(60);

assert(distFull > 20, 'full stick moved the ship: ' + distFull);
assert(distHalf > 2 && distHalf < distFull * 0.8,
       `half stick travels materially less than full: ${distHalf} vs ${distFull}`);
assert(near(distZero, 0, 1e-6), 'centred stick does not move the ship: ' + distZero);
restoreDefaults(); flush();

// ── keyboard binding: strength is exactly 1 or exactly 0 ────────────────────

const SDL_W = 119, SDL_D = 100, SDL_Q = 113;
assert(bro.settings.getActionKeys('il_thrust').indexOf('w') >= 0, 'w is bound to thrust');
assert(strength('il_thrust') === 0, 'thrust idle at 0');

keyDown(SDL_W); flush(); advanceTime(16);
assert(strength('il_thrust') === 1, 'key-bound action reads exactly 1.0 when held, got ' +
       strength('il_thrust'));
assert(bro.settings.isActionPressed('il_thrust') === true, 'key press is pressed');
keyUp(SDL_W); flush(); advanceTime(16);
assert(strength('il_thrust') === 0, 'key-bound action reads exactly 0.0 when released');
assert(bro.settings.isActionPressed('il_thrust') === false, 'key release clears pressed');

// The action edge stream reached the panel.
const thrustEvents = actionState.events.filter((e) => e.action === 'il_thrust');
assert(thrustEvents.length >= 2, 'down+up action events recorded, got ' + thrustEvents.length);
assert(thrustEvents[thrustEvents.length - 2].phase === 'down' &&
       thrustEvents[thrustEvents.length - 1].phase === 'up', 'edges arrive in order');
assert(thrustEvents[thrustEvents.length - 2].key === 'w', 'event names the binding');

// ── mouse binding fires from an injected mouse event ────────────────────────

assert(bro.settings.getActionKeys('il_fire').indexOf('mouse:left') >= 0,
       'fire is bound to mouse:left');
const firedBefore = actionState.events.filter((e) => e.action === 'il_fire').length;

mouseDown(900, 700, 0); flush(); advanceTime(16);
assert(strength('il_fire') === 1, 'mouse:left drives the action, got ' + strength('il_fire'));
assert(bro.settings.isActionPressed('il_fire') === true, 'mouse button is pressed');
mouseUp(900, 700, 0); flush(); advanceTime(16);
assert(strength('il_fire') === 0, 'mouse release clears strength');

const fireEvents = actionState.events.filter((e) => e.action === 'il_fire');
assert(fireEvents.length === firedBefore + 2, 'mouse produced one down and one up');
assert(fireEvents[fireEvents.length - 2].key === 'mouse:left',
       'event carries the mouse:left binding string');

// And the ship reacted to it, through getActionStrength only.
const shotsBefore = ship.firedCount;
mouseDown(900, 700, 0); flush();
tickShip(1 / 60);
assert(ship.firedCount === shotsBefore + 1, 'the ship fired from the mouse-bound action');
mouseUp(900, 700, 0); flush();

// ── rebinding changes getActionKeys and retires the old binding ─────────────

assert(bro.settings.getKeyAction('w') === 'il_thrust', 'getKeyAction resolves w');

bro.settings.rebindAction('il_thrust', ['q']);
flush();
assert(JSON.stringify(bro.settings.getActionKeys('il_thrust')) === '["q"]',
       'getActionKeys reports the new binding, got ' +
       JSON.stringify(bro.settings.getActionKeys('il_thrust')));
assert(bro.settings.getKeyAction('w') === null, 'the old key resolves to nothing');
assert(bro.settings.getKeyAction('q') === 'il_thrust', 'the new key resolves to the action');

keyDown(SDL_W); flush(); advanceTime(16);
assert(strength('il_thrust') === 0, 'the OLD binding no longer fires the action');
keyUp(SDL_W); flush();
keyDown(SDL_Q); flush(); advanceTime(16);
assert(strength('il_thrust') === 1, 'the NEW binding fires it');
keyUp(SDL_Q); flush();

// ── the rebinding UI commits through the same path ──────────────────────────

const chips = document.querySelectorAll('#binds_il_jump .bind');
assert(chips.length >= 2, 'jump row rendered its chips plus the add affordance');
chips[0].click();
flush();
assert(actionState.capturing !== null, 'clicking a chip arms capture');
assert(document.getElementById('capture').className.indexOf('on') >= 0,
       'capture banner shown');

keyDown(SDL_D); flush(); advanceTime(16);
assert(actionState.capturing === null, 'the captured key disarmed capture');
assert(actionState.lastBound && actionState.lastBound.binding === 'd',
       'capture committed "d", got ' + JSON.stringify(actionState.lastBound));
assert(bro.settings.getActionKeys('il_jump')[0] === 'd',
       'rebindAction landed slot 0 on d, got ' +
       JSON.stringify(bro.settings.getActionKeys('il_jump')));
keyUp(SDL_D); flush();

// Rebinding to a gamepad button through the poll-driven capture path.
document.querySelectorAll('#binds_il_jump .bind')[0].click();
flush();
assert(actionState.capturing !== null, 'armed again');
gamepadButton(0, 'west', true);
flush(); advanceTime(32);
assert(bro.settings.getActionKeys('il_jump')[0] === 'gamepad:west',
       'gamepad capture wrote gamepad:west, got ' +
       JSON.stringify(bro.settings.getActionKeys('il_jump')));
gamepadButton(0, 'west', false); flush(); advanceTime(16);

// Escape cancels rather than binding.
const beforeCancel = JSON.stringify(bro.settings.getActionKeys('il_aim'));
document.querySelectorAll('#binds_il_aim .bind')[0].click();
flush();
keyDown(27); flush(); advanceTime(16);   // SDLK_ESCAPE
assert(actionState.capturing === null, 'Escape disarmed capture');
assert(JSON.stringify(bro.settings.getActionKeys('il_aim')) === beforeCancel,
       'Escape left the bindings untouched');
keyUp(27); flush();

// commitBinding is the seam the UI uses; drive a mouse binding through it.
document.querySelectorAll('#binds_il_aim .bind')[0].click();
flush();
assert(commitBinding('mouse:x2') === true, 'commitBinding accepted a mouse:x2 string');
assert(bro.settings.getActionKeys('il_aim')[0] === 'mouse:x2', 'mouse:x2 is bound');

restoreDefaults(); flush();
assert(bro.settings.getActionKeys('il_aim')[0] === 'mouse:right', 'defaults restored');

// ── rumble ──────────────────────────────────────────────────────────────────

const rumBefore = rumbleLog.length;
const p = rumblePlay({ duration: 120, strongMagnitude: 0.9, weakMagnitude: 0.3 });
assert(p && typeof p.then === 'function', 'playEffect returned a promise');
let rumbleResult = null;
p.then((r) => { rumbleResult = r; });
advanceTime(32);
assert(rumbleResult === 'complete', 'playEffect resolved "complete", got ' + rumbleResult);
assert(rumbleLog.length === rumBefore + 1, 'the panel logged the effect');
rumbleStop();
assert(rumbleLog[rumbleLog.length - 1].kind === 'reset', 'reset() logged');

// The preset buttons go through the same path.
document.getElementById('rumThud').click();
advanceTime(32);
assert(rumbleLog[rumbleLog.length - 1].kind === 'play', 'preset button played an effect');
assert(rumbleLog[rumbleLog.length - 1].params.strongMagnitude === 1.0, 'thud is full strong');

// ── two pads ────────────────────────────────────────────────────────────────

const slot2 = gamepadConnect('Second Pad');
flush(); advanceTime(32);
assert(slot2 === 1, 'second pad took slot 1, got ' + slot2);
assert(padState.connectCount === 2, 'panel saw two connects');
assert(navigator.getGamepads().filter((x) => x).length === 2, 'two live pads');
assert(padState.selected === 1, 'panel followed the newest pad');
assert(document.getElementById('padList').textContent.indexOf('Second Pad') >= 0,
       'slot list shows both pads');

// Slots are independent.
gamepadAxis(1, 'rightx', 0.9);
flush(); advanceTime(32);
assert(near(navigator.getGamepads()[1].axes[2], 0.9, 1e-5), 'pad 1 axis set');
assert(navigator.getGamepads()[0].axes[2] === 0, 'pad 0 untouched');
gamepadAxis(1, 'rightx', 0); flush();

// ── disconnect ──────────────────────────────────────────────────────────────

let disconnectEvents = 0;
window.addEventListener('gamepaddisconnected', () => { disconnectEvents++; });
gamepadDisconnect(1);
flush(); advanceTime(32);
assert(disconnectEvents === 1, 'gamepaddisconnected fired');
assert(navigator.getGamepads()[1] === null, 'the slot reads null, not missing');
assert(navigator.getGamepads().length === 2, 'the slot array keeps its hole');
assert(padState.disconnectCount === 1, 'panel counted the disconnect');

gamepadDisconnect(0);
flush(); advanceTime(32);
assert(navigator.getGamepads().filter((x) => x).length === 0, 'all pads gone');
assert(document.getElementById('padEmpty').style.display === 'block',
       'empty state returned when the last pad left');

// ── pointers: several at once ───────────────────────────────────────────────
//
// The dashboard is three panels wide, so the pointer/gesture/IME row sits below
// a 1080-tall viewport and nothing there is hit-testable. Grow the viewport
// instead of scrolling: injection coordinates are viewport-relative, so a taller
// viewport is the deterministic way to put a panel under the finger.

resize(1920, 3400);
advanceTime(32);
flush();

const ptrCanvas = document.getElementById('ptrCanvas');
let pc = ptrCanvas.getBoundingClientRect();
assert(pc.width === 560 && pc.height === 300, 'pointer canvas laid out at its intrinsic size');
assert(pc.bottom < 3400, 'pointer panel is inside the viewport, got bottom ' + pc.bottom);
const P = (fx, fy) => [pc.left + fx, pc.top + fy];

// Two fingers land at once. This is the assertion nothing else in the workshop
// can make: two INDEPENDENT contacts, distinct ids, both tracked.
touchDown(41, ...P(80, 80));
touchDown(42, ...P(400, 200));
flush(); advanceTime(16);

assert(pointerState.pointers.size === 2,
       'two simultaneous contacts tracked, got ' + pointerState.pointers.size);
const ids = Array.from(pointerState.pointers.keys());
assert(ids.length === 2 && ids[0] !== ids[1],
       'the two contacts have DISTINCT pointerIds: ' + JSON.stringify(ids));
assert(ids.every((i) => i >= 2), 'touch pointerIds start at 2 (the mouse owns 1): ' + ids);
assert(pointerState.maxConcurrent >= 2, 'the panel recorded a two-pointer peak');
assert(pointerState.lastTouchList === 2,
       'TouchEvent.touches agrees with our map, got ' + pointerState.lastTouchList);

// Both are in the VISUALISER's state, at their own coordinates, with their own
// trail and colour — not one record being overwritten by the other.
const recs = Array.from(pointerState.pointers.values());
const a = recs.find((r) => Math.round(r.x) === 80);
const b = recs.find((r) => Math.round(r.x) === 400);
assert(a && b, 'both contacts are at their own canvas-local coordinates: ' +
       JSON.stringify(recs.map((r) => [Math.round(r.x), Math.round(r.y)])));
assert(Math.round(a.y) === 80 && Math.round(b.y) === 200, 'and their own y');
assert(a.color !== b.color, 'each contact drew in its own colour');
assert(a.primary === true && b.primary === false,
       'the first finger of the set is primary, the second is not');
assert(a.type === 'touch' && b.type === 'touch', 'both report pointerType "touch"');

// Moves are routed per pointer: moving one must not disturb the other.
const bBefore = { x: b.x, y: b.y };
touchMove(41, ...P(140, 120));
flush(); advanceTime(16);
assert(Math.round(a.x) === 140 && Math.round(a.y) === 120, 'the moved contact followed');
assert(b.x === bBefore.x && b.y === bBefore.y, 'the other contact did not move');
assert(a.trail.length >= 2, 'the moved contact accumulated a trail: ' + a.trail.length);
assert(b.trail.length === 1, 'the still contact did not');

touchUp(41, ...P(140, 120));
flush();
assert(pointerState.pointers.size === 1, 'lifting one finger leaves the other tracked');
touchUp(42, ...P(400, 200));
flush();
assert(pointerState.pointers.size === 0, 'both gone');

// ── a touch produces its compat mouse event too ─────────────────────────────

document.getElementById('ptrClear').click();
flush();

touchDown(50, ...P(300, 150));
touchUp(50, ...P(300, 150));       // a clean tap: no travel past the slop
flush(); advanceTime(16);

const seq = pointerState.log.map((e) => e.type);
assert(seq.indexOf('pointerdown') >= 0, 'the tap produced a pointer event');
assert(seq.indexOf('touchstart') >= 0, 'and a touch event');
assert(seq.indexOf('mousedown') >= 0, 'and its COMPAT mouse event');
assert(seq.indexOf('mouseup') >= 0 && seq.indexOf('click') >= 0, 'and mouseup + click');
assert(seq.indexOf('pointerdown') < seq.indexOf('mousedown'),
       'the compat mouse event arrives AFTER the pointer stream: ' + seq.join(' > '));
assert(seq.indexOf('touchend') < seq.indexOf('mousedown'),
       'and specifically after touchend: ' + seq.join(' > '));
const compat = pointerState.log.filter((e) => e.kind === 'compat');
assert(compat.length === 3, 'three synthesized events flagged as compat, got ' + compat.length);

// A DRAG past the ~10px slop synthesizes nothing — same finger, no mouse.
document.getElementById('ptrClear').click();
touchDown(51, ...P(100, 100));
touchMove(51, ...P(300, 220));
touchUp(51, ...P(300, 220));
flush(); advanceTime(16);
const dragMouse = pointerState.log.filter(
    (e) => e.type === 'mousedown' || e.type === 'click');
assert(dragMouse.length === 0,
       'a drag synthesizes no compat mouse events, got ' + JSON.stringify(dragMouse));

// ── pointer capture keeps the stream after leaving the element ──────────────
//
// The real proof is not that capture was granted, it is that moves outside the
// element's own rect still arrive at it.

const capBox = document.getElementById('capBox');
let cb = capBox.getBoundingClientRect();
const gotBefore = captureState.gotEvents;

touchDown(60, cb.left + 20, cb.top + 20);
flush();
assert(captureState.captured === true, 'gotpointercapture fired on the holder');
assert(captureState.gotEvents === gotBefore + 1, 'exactly one capture acquired');
assert(capBox.hasPointerCapture(captureState.pointerId) === true,
       'hasPointerCapture agrees');

// Walk the pointer far outside the box — a different panel entirely.
touchMove(60, cb.left + 300, cb.top + 260);
touchMove(60, cb.left + 500, cb.top + 400);
flush(); advanceTime(16);

assert(captureState.movesTotal >= 2,
       'the captured element still received the moves, got ' + captureState.movesTotal);
assert(captureState.movesOutsideBounds >= 2,
       'and those moves were delivered while the pointer was OUTSIDE its bounds, got ' +
       captureState.movesOutsideBounds);

const lostBefore = captureState.lostEvents;
touchUp(60, cb.left + 500, cb.top + 400);
flush();
assert(captureState.lostEvents === lostBefore + 1,
       'lostpointercapture fired — capture auto-releases on pointerup');
assert(captureState.captured === false, 'the holder no longer holds it');

// The control: same drag with capture switched off delivers nothing outside.
const capEnable = document.getElementById('capEnable');
capEnable.checked = false;
capEnable.dispatchEvent(new Event('change'));
flush();
assert(captureState.enabled === false, 'the HUD toggle disabled capture');

cb = capBox.getBoundingClientRect();
touchDown(61, cb.left + 20, cb.top + 20);
flush();
assert(captureState.pointerId !== null && captureState.movesOutsideBounds === 0,
       'the uncaptured drag really started on the box (counters reset)');
assert(captureState.captured === false, 'and no capture was taken');
touchMove(61, cb.left + 300, cb.top + 260);
touchMove(61, cb.left + 500, cb.top + 400);
flush(); advanceTime(16);
assert(captureState.movesOutsideBounds === 0,
       'WITHOUT capture, no out-of-bounds move reaches the element, got ' +
       captureState.movesOutsideBounds);
touchUp(61, cb.left + 500, cb.top + 400);
flush();

capEnable.checked = true;
capEnable.dispatchEvent(new Event('change'));
flush();

// ── touchCancel clears the tracked contacts ─────────────────────────────────

pc = ptrCanvas.getBoundingClientRect();
const cancelsBefore = pointerState.cancelCount;
touchDown(70, ...P(120, 120));
touchDown(71, ...P(420, 220));
flush();
assert(pointerState.pointers.size === 2, 'two contacts down before the cancel');

touchCancel(70, ...P(120, 120));
touchCancel(71, ...P(420, 220));
flush(); advanceTime(16);
assert(pointerState.pointers.size === 0,
       'touchCancel cleared every tracked pointer, got ' + pointerState.pointers.size);
assert(pointerState.cancelCount === cancelsBefore + 2, 'both cancels were counted');
assert(pointerState.log.filter((e) => e.type === 'pointercancel').length >= 2,
       'pointercancel reached the log');

// ── gestures: pinch scales, twist rotates ───────────────────────────────────

const gestCanvas = document.getElementById('gestCanvas');
const gc = gestCanvas.getBoundingClientRect();
const G = (fx, fy) => [gc.left + fx, gc.top + fy];

resetGesture();
assert(gestureState.scale === 1 && gestureState.rotation === 0, 'view reset');

// Two fingers 100 px apart, spread to 300 px: e.scale must be 3, and the view
// scale must follow it upward.
touchDown(80, ...G(180, 160));
touchDown(81, ...G(280, 160));
flush(); advanceTime(16);
assert(gestureState.active === true, 'the second finger started a gesture');

touchMove(80, ...G(80, 160));
touchMove(81, ...G(380, 160));
flush(); advanceTime(16);

assert(near(gestureState.lastEventScale, 3, 1e-3),
       'e.scale is distance-now / distance-at-start = 3, got ' + gestureState.lastEventScale);
assert(near(gestureState.scale, 3, 1e-3),
       'the viewer scaled UP with the pinch, got ' + gestureState.scale);
assert(gestureState.scale > 1, 'pinch-out zoomed in, not out');
assert(gestureState.changes >= 1, 'gesturechange fired');

// Now pinch back IN from here — the direction must reverse.
const scaleAtPeak = gestureState.scale;
touchMove(80, ...G(155, 160));
touchMove(81, ...G(305, 160));
flush(); advanceTime(16);
assert(gestureState.scale < scaleAtPeak,
       `pinch-in zoomed out again: ${gestureState.scale} < ${scaleAtPeak}`);

touchUp(80, ...G(155, 160));
touchUp(81, ...G(305, 160));
flush(); advanceTime(16);
assert(gestureState.active === false, 'lifting a founding finger ended the gesture');
assert(gestureState.gestures === 1, 'one completed gesture');

// Rotation: a horizontal pair swung to vertical is 90° CLOCKWISE in screen
// coordinates (y grows downward), and bro reports clockwise as positive.
resetGesture();
touchDown(90, ...G(180, 160));
touchDown(91, ...G(280, 160));
flush(); advanceTime(16);
touchMove(90, ...G(230, 110));
touchMove(91, ...G(230, 210));
flush(); advanceTime(16);

assert(near(gestureState.lastEventRotation, 90, 0.5),
       'e.rotation is +90 (clockwise positive), got ' + gestureState.lastEventRotation);
assert(near(gestureState.rotation, 90, 0.5),
       'the viewer rotated with it, got ' + gestureState.rotation);
assert(Math.abs(gestureState.rotation) > 1, 'rotation is a real change, not noise');

touchUp(90, ...G(230, 110));
touchUp(91, ...G(230, 210));
flush(); advanceTime(16);

// The gesture is applied on top of the view's existing state, not assigned to
// it — a second gesture must accumulate rather than snap back.
touchDown(92, ...G(180, 160));
touchDown(93, ...G(280, 160));
flush(); advanceTime(16);
touchMove(92, ...G(230, 110));
touchMove(93, ...G(230, 210));
flush(); advanceTime(16);
assert(near(gestureState.rotation, 180, 1),
       'a second +90 gesture accumulated onto the first, got ' + gestureState.rotation);
touchUp(92, ...G(230, 110));
touchUp(93, ...G(230, 210));
flush(); advanceTime(16);
resetGesture();

// Gesture recognition is DOCUMENT-WIDE. Two fingers already resting on the
// visualiser panel are the founding pair, so a two-finger pinch on the map
// founds nothing and moves nothing — the events went to the other panel.
touchDown(94, ...P(100, 100));
touchDown(95, ...P(300, 200));
flush(); advanceTime(16);
const changesBefore = gestureState.changes;
touchDown(96, ...G(180, 160));
touchDown(97, ...G(280, 160));
flush(); advanceTime(16);
touchMove(96, ...G(80, 160));
touchMove(97, ...G(380, 160));
flush(); advanceTime(16);
assert(gestureState.changes === changesBefore,
       'a pinch on the map is inert while an older pair holds the gesture, got ' +
       (gestureState.changes - changesBefore) + ' changes');
assert(gestureState.scale === 1, 'and the view did not move');
touchUp(96, ...G(80, 160)); touchUp(97, ...G(380, 160));
touchUp(94, ...P(100, 100)); touchUp(95, ...P(300, 200));
flush(); advanceTime(16);
assert(pointerState.pointers.size === 0, 'all contacts lifted');
resetGesture();

// ── IME composition ─────────────────────────────────────────────────────────

const imeInput = document.getElementById('imeInput');
assert(imeState.headless === true, 'the IME seams are available under bro-headless');

resetIme();
flush();
assert(imeInput.value === '', 'field starts empty');

assert(driveCJK() === true, 'the CJK driver ran');
flush(); advanceTime(16);

// The three composition events, in spec order, with the right payloads.
const comp = imeState.events.filter((e) => e.type.indexOf('composition') === 0);
assert(comp[0].type === 'compositionstart', 'compositionstart came first');
assert(comp[comp.length - 1].type === 'compositionend', 'compositionend came last');
const middles = comp.slice(1, -1);
assert(middles.length >= 3, 'one compositionupdate per preedit revision, got ' + middles.length);
assert(middles.every((e) => e.type === 'compositionupdate'),
       'everything between start and end is an update: ' +
       JSON.stringify(comp.map((e) => e.type)));
assert(comp[1].data === 'n', 'the first update carried the first preedit "n", got ' + comp[1].data);
assert(comp[comp.length - 1].data === '你好',
       'compositionend carried the committed string, got ' + comp[comp.length - 1].data);

assert(imeInput.value === '你好', 'the committed text is in the field, got ' + imeInput.value);
assert(imeState.committed === '你好', 'the panel recorded the commit');
assert(imeState.composing === false, 'composition finished');
assert(imeState.compositions === 1, 'one completed composition');
assert(document.getElementById('ival5').textContent === '"你好"',
       'the readout shows the field value, got ' + document.getElementById('ival5').textContent);

// `input` fired for the composition revisions too, tagged so an app can tell
// them apart from a finished edit.
const comps = imeState.events.filter((e) => e.type === 'input (insertCompositionText)');
assert(comps.length >= 4, 'each revision raised input/insertCompositionText, got ' + comps.length);

// The preedit was visible in .value mid-composition, and its range was derived.
resetIme();
imeInput.focus();
imeCompose('ni');
flush();
assert(imeState.composing === true, 'composing');
assert(imeInput.value === 'ni', 'the preedit is provisionally in .value: ' + imeInput.value);
assert(imeState.preedit === 'ni', 'the panel shows the preedit');
assert(imeState.rangeStart === 0 && imeState.rangeEnd === 2,
       `composition range is [0,2), got [${imeState.rangeStart},${imeState.rangeEnd})`);
imeCommit('你');
flush();
assert(imeInput.value === '你', 'commit replaced the preedit, got ' + imeInput.value);

// A second composition appends and its range starts after the existing text.
imeCompose('ha');
flush();
assert(imeState.rangeStart === 1,
       'the next composition starts after the committed text, got ' + imeState.rangeStart);
imeCommit('好');
flush();
assert(imeInput.value === '你好', 'two commits accumulate, got ' + imeInput.value);

// ── cancel restores rather than clears ──────────────────────────────────────

resetIme();
flush();
assert(imeInput.value === '', 'field cleared');
assert(driveCancel() === true, 'the cancel driver ran');
flush(); advanceTime(16);

assert(imeInput.value === '',
       'a cancelled composition leaves an empty field empty, got ' + imeInput.value);
assert(imeState.composing === false, 'composition ended');
assert(imeState.cancelled === 1, 'the panel counted it as cancelled, not committed');
const cend = imeState.events.filter((e) => e.type === 'compositionend').pop();
assert(cend.data === '', 'compositionend carried "" for the cancel, got ' + JSON.stringify(cend.data));

// …but cancel is a RESTORE, not a clear: pre-existing text must survive it.
resetIme();
imeInput.focus();
imeCompose('ab');
imeCommit('kept');
flush();
assert(imeInput.value === 'kept', 'committed some text first');
imeCompose('か');
imeCompose('かん');
flush();
assert(imeInput.value === 'keptかん', 'the preedit is appended provisionally: ' + imeInput.value);
imeCancel();
flush();
assert(imeInput.value === 'kept',
       'cancel restored the pre-composition value rather than clearing, got ' + imeInput.value);

// The dead-key path lands the accented letter.
resetIme();
assert(driveAccent() === true, 'the accent driver ran');
flush();
assert(imeInput.value === 'é', 'the dead-key composition committed é, got ' + imeInput.value);

resetIme();
resize(1920, 1080);
flush();

// ── the frame loop actually ran ─────────────────────────────────────────────

advanceTime(200);
assert(ship.history.length === 180, 'the thrust strip chart is full-length');

restoreDefaults();
console.log('input-lab smoke test: all assertions passed');
