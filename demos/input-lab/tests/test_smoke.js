// test_smoke.js — headless integration test for Input Lab.
//
// Run: scripts/validate.sh demos/input-lab
//
// Everything here is a MEASURED assertion, not a no-throw. The one that
// matters most is the analog block: an injected axis at 0.5 must produce a
// strength of (0.5 - deadzone) / (1 - deadzone), i.e. an intermediate value.
// If the action layer ever quantised axis bindings to 0/1 the ship would still
// move and the panel would still light up — this is the only thing that would
// catch it.
//
// The page boots from main.js; this script imports the panel modules under it
// (never main.js, which would boot the app a second time and double-count
// every event). The blocks share state and run in order.

import { test, check, eq, near, shot, done } from '/lib/kit/test.js';
import { padState, currentPad, rumbleLog, play as rumblePlay, stop as rumbleStop } from '/app/gamepad.js';
import { actionState, commitBinding, restoreDefaults, strength } from '/app/actions.js';
import { ship, tickShip } from '/app/ship.js';
import { pointerState, captureState } from '/app/touch.js';
import { gestureState, reset as resetGesture } from '/app/gestures.js';
import { imeState, driveCJK, driveAccent, driveCancel, resetIme } from '/app/ime.js';

const $ = (id) => document.getElementById(id);
const rowOn = (containerId, i) => $(containerId).children[i].classList.contains('on');
const rowVal = (containerId, i) => $(containerId).children[i].lastChild.textContent;

// The deck wraps to several rows; a tall viewport puts every panel under the
// finger (injection coordinates are viewport-relative) and in the screenshot.
resize(1920, 3000);
advanceTime(64);
flush();

// Bindings persist to the engine-global .bro_settings.json, so a previous run
// (or a human clicking around) would otherwise poison every assertion below.
restoreDefaults();
flush();

test('page booted on the kit', () => {
    check(document.body.classList.contains('k-app'), 'body.k-app');
    eq($('status').textContent, 'ready', 'status');
    eq(document.querySelectorAll('.k-deck > .k-panel').length, 6, 'six panels');
});

// ── gamepad ─────────────────────────────────────────────────────────────────

let connectEvents = 0, connectedIndex = -1, connectedId = null;
window.addEventListener('gamepadconnected', (e) => {
    connectEvents++; connectedIndex = e.gamepad.index; connectedId = e.gamepad.id;
});

test('connection', () => {
    eq(navigator.getGamepads().filter((p) => p).length, 0, 'no pads before injection');
    check(!$('padEmpty').hidden && $('padBody').hidden, 'empty state visible');

    const slot = gamepadConnect('Smoke Test Pad');
    flush(); advanceTime(32);
    eq(slot, 0, 'first injected pad takes slot 0');
    eq(connectEvents, 1, 'gamepadconnected fired exactly once');
    eq(connectedIndex, 0, 'event carried slot 0');
    eq(connectedId, 'Smoke Test Pad', 'event carried the injected id');

    const pads = navigator.getGamepads();
    check(pads[0] !== null, 'slot 0 populated in getGamepads()');
    eq(pads[0].mapping, 'standard', 'mapping');
    eq(pads[0].buttons.length, 17, 'buttons');
    eq(pads[0].axes.length, 4, 'axes');
    check(pads[0].vibrationActuator.effects.indexOf('dual-rumble') >= 0, 'dual-rumble advertised');

    // The app's own view of the world must agree, through its own frame loop.
    eq(padState.connectCount, 1, 'panel counted the connect');
    check(currentPad() && currentPad().id === 'Smoke Test Pad', 'panel selected the new pad');
    check($('padEmpty').hidden && !$('padBody').hidden, 'empty state hidden, body shown');
    check($('padList').textContent.indexOf('Smoke Test Pad') >= 0, 'slot list names the pad');
    eq($('padSummary').textContent, '1 pad', 'header chip');
});

test('digital button', () => {
    gamepadButton(0, 'south', true);
    flush(); advanceTime(32);
    const gp = navigator.getGamepads()[0];
    check(gp.buttons[0].pressed === true, 'south reads pressed');
    eq(gp.buttons[0].value, 1, 'south value');
    check(rowOn('btnReadout', 0), 'south readout row lit');
    eq(rowVal('btnReadout', 0), '1.00', 'south readout value');

    gamepadButton(0, 'south', false);
    flush(); advanceTime(32);
    check(navigator.getGamepads()[0].buttons[0].pressed === false, 'south released');
    check(!rowOn('btnReadout', 0), 'south row unlit');
});

// il_boost is bound to gamepad:righttrigger. A trigger's contribution is its
// raw value with no deadzone rescale, so 0.63 in must be 0.63 out.
test('analog trigger', () => {
    gamepadButton(0, 'righttrigger', true, 0.63);
    flush(); advanceTime(32);
    near(navigator.getGamepads()[0].buttons[7].value, 0.63, 1e-5, 'righttrigger value');
    const boost = strength('il_boost');
    near(boost, 0.63, 1e-5, 'trigger-bound action strength');
    check(boost > 0.1 && boost < 0.9, 'trigger strength is INTERMEDIATE, not 0/1: ' + boost);
    check(bro.settings.isActionPressed('il_boost') === true, 'trigger past 0.1 counts as pressed');

    gamepadButton(0, 'righttrigger', false, 0);
    flush(); advanceTime(32);
    eq(strength('il_boost'), 0, 'trigger released');
});

// il_right is bound to gamepad:leftx+ with deadzone 0.15, so the documented
// rescale (m - dz) / (1 - dz) predicts each of these exactly. Three distinct
// intermediate points, because two could be a coincidence.
test('analog axis: rescaled, intermediate, monotonic', () => {
    const DZ = 0.15;
    const expect = (m) => (m - DZ) / (1 - DZ);
    for (const m of [0.3, 0.5, 0.75]) {
        gamepadAxis(0, 'leftx', m);
        flush(); advanceTime(32);
        near(navigator.getGamepads()[0].axes[0], m, 1e-5, 'axes[0] reflects injected ' + m);
        const s = strength('il_right');
        near(s, expect(m), 1e-4, 'leftx+ @' + m);
        check(s > 0.01 && s < 0.99, `strength at ${m} is genuinely intermediate: ${s}`);
        check(bro.settings.isActionPressed('il_right') === true, 'axis past deadzone is pressed');
    }
    // The axis readout mirrors the snapshot.
    eq(rowVal('axisReadout', 0), '+0.75', 'axis readout');
    check(rowOn('axisReadout', 0), 'axis readout lit');

    gamepadAxis(0, 'leftx', 0.3); flush(); const s30 = strength('il_right');
    gamepadAxis(0, 'leftx', 0.5); flush(); const s50 = strength('il_right');
    gamepadAxis(0, 'leftx', 0.75); flush(); const s75 = strength('il_right');
    check(s30 < s50 && s50 < s75, `strength is monotonic: ${s30} < ${s50} < ${s75}`);
    check(s75 - s50 > 0.1 && s50 - s30 > 0.1, 'the steps are real, not rounding');

    // Full deflection saturates at exactly 1; below the deadzone is exactly 0.
    gamepadAxis(0, 'leftx', 1.0); flush();
    eq(strength('il_right'), 1, 'full deflection');
    gamepadAxis(0, 'leftx', 0.05); flush(); advanceTime(32);
    eq(strength('il_right'), 0, 'inside the deadzone');
    check(bro.settings.isActionPressed('il_right') === false, 'deadzone releases the latch');

    // The opposite direction of the same axis must stay silent.
    gamepadAxis(0, 'leftx', -0.8); flush(); advanceTime(32);
    eq(strength('il_right'), 0, 'leftx+ ignores negative deflection');
    check(strength('il_left') > 0.5, 'leftx- picks it up instead: ' + strength('il_left'));
    gamepadAxis(0, 'leftx', 0); flush(); advanceTime(32);
});

// Same action, same physics, two binding kinds: half a stick must travel
// materially less than a full one over the same number of steps.
test('analog drives the ship differently from digital', () => {
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
    restoreDefaults(); flush();

    check(distFull > 20, 'full stick moved the ship: ' + distFull);
    check(distHalf > 2 && distHalf < distFull * 0.8,
          `half stick travels materially less than full: ${distHalf} vs ${distFull}`);
    near(distZero, 0, 1e-6, 'centred stick does not move the ship');
});

const SDL_W = 119, SDL_D = 100, SDL_Q = 113;

test('keyboard binding: strength is exactly 1 or exactly 0', () => {
    check(bro.settings.getActionKeys('il_thrust').indexOf('w') >= 0, 'w is bound to thrust');
    eq(strength('il_thrust'), 0, 'thrust idle');
    keyDown(SDL_W); flush(); advanceTime(16);
    eq(strength('il_thrust'), 1, 'key-bound action held');
    check(bro.settings.isActionPressed('il_thrust') === true, 'key press is pressed');
    // The binding table shows it: dot lit, bar full.
    const row = $('binds_il_thrust').parentNode;
    check(row.querySelector('.dot').classList.contains('on'), 'action row dot lit');
    keyUp(SDL_W); flush(); advanceTime(16);
    eq(strength('il_thrust'), 0, 'key-bound action released');
    check(bro.settings.isActionPressed('il_thrust') === false, 'key release clears pressed');
    check(!row.querySelector('.dot').classList.contains('on'), 'action row dot unlit');

    const ev = actionState.events.filter((e) => e.action === 'il_thrust');
    check(ev.length >= 2, 'down+up action events recorded, got ' + ev.length);
    check(ev[ev.length - 2].phase === 'down' && ev[ev.length - 1].phase === 'up', 'edges arrive in order');
    eq(ev[ev.length - 2].key, 'w', 'event names the binding');
});

test('mouse binding fires from an injected mouse event', () => {
    check(bro.settings.getActionKeys('il_fire').indexOf('mouse:left') >= 0, 'fire is bound to mouse:left');
    // Press on inert prose so the click lands on nothing interactive.
    const r = document.querySelector('#panelActions .k-note').getBoundingClientRect();
    const mx = r.left + r.width / 2, my = r.top + r.height / 2;
    const firedBefore = actionState.events.filter((e) => e.action === 'il_fire').length;

    mouseDown(mx, my, 0); flush(); advanceTime(16);
    eq(strength('il_fire'), 1, 'mouse:left drives the action');
    check(bro.settings.isActionPressed('il_fire') === true, 'mouse button is pressed');
    mouseUp(mx, my, 0); flush(); advanceTime(16);
    eq(strength('il_fire'), 0, 'mouse release clears strength');

    const fire = actionState.events.filter((e) => e.action === 'il_fire');
    eq(fire.length, firedBefore + 2, 'mouse produced one down and one up');
    eq(fire[fire.length - 2].key, 'mouse:left', 'event carries the binding string');

    // And the ship reacted to it, through getActionStrength only.
    const shotsBefore = ship.firedCount;
    mouseDown(mx, my, 0); flush();
    tickShip(1 / 60);
    eq(ship.firedCount, shotsBefore + 1, 'the ship fired from the mouse-bound action');
    mouseUp(mx, my, 0); flush();
});

test('rebinding changes getActionKeys and retires the old binding', () => {
    eq(bro.settings.getKeyAction('w'), 'il_thrust', 'getKeyAction resolves w');
    bro.settings.rebindAction('il_thrust', ['q']);
    flush();
    eq(bro.settings.getActionKeys('il_thrust'), ['q'], 'getActionKeys');
    eq(bro.settings.getKeyAction('w'), null, 'the old key resolves to nothing');
    eq(bro.settings.getKeyAction('q'), 'il_thrust', 'the new key resolves to the action');

    keyDown(SDL_W); flush(); advanceTime(16);
    eq(strength('il_thrust'), 0, 'the OLD binding no longer fires');
    keyUp(SDL_W); flush();
    keyDown(SDL_Q); flush(); advanceTime(16);
    eq(strength('il_thrust'), 1, 'the NEW binding fires');
    keyUp(SDL_Q); flush();
});

test('the rebinding UI commits through the same path', () => {
    const chips = document.querySelectorAll('#binds_il_jump .bind');
    check(chips.length >= 2, 'jump row rendered its chips plus the add affordance');
    chips[0].click();
    flush();
    check(actionState.capturing !== null, 'clicking a chip arms capture');
    check(!$('capture').hidden, 'capture banner shown');

    keyDown(SDL_D); flush(); advanceTime(16);
    check(actionState.capturing === null, 'the captured key disarmed capture');
    check($('capture').hidden, 'capture banner hidden again');
    check(actionState.lastBound && actionState.lastBound.binding === 'd',
          'capture committed "d", got ' + JSON.stringify(actionState.lastBound));
    eq(bro.settings.getActionKeys('il_jump')[0], 'd', 'rebindAction landed slot 0');
    keyUp(SDL_D); flush();

    // Rebinding to a gamepad button through the poll-driven capture path.
    document.querySelectorAll('#binds_il_jump .bind')[0].click();
    flush();
    check(actionState.capturing !== null, 'armed again');
    gamepadButton(0, 'west', true);
    flush(); advanceTime(32);
    eq(bro.settings.getActionKeys('il_jump')[0], 'gamepad:west', 'gamepad capture');
    gamepadButton(0, 'west', false); flush(); advanceTime(16);

    // Escape cancels rather than binding.
    const beforeCancel = JSON.stringify(bro.settings.getActionKeys('il_aim'));
    document.querySelectorAll('#binds_il_aim .bind')[0].click();
    flush();
    keyDown(27); flush(); advanceTime(16);   // SDLK_ESCAPE
    check(actionState.capturing === null, 'Escape disarmed capture');
    eq(JSON.stringify(bro.settings.getActionKeys('il_aim')), beforeCancel, 'Escape left the bindings untouched');
    keyUp(27); flush();

    // commitBinding is the seam the UI uses; drive a mouse binding through it.
    document.querySelectorAll('#binds_il_aim .bind')[0].click();
    flush();
    check(commitBinding('mouse:x2') === true, 'commitBinding accepted a mouse:x2 string');
    eq(bro.settings.getActionKeys('il_aim')[0], 'mouse:x2', 'mouse:x2 bound');
    check($('binds_il_aim').textContent.indexOf('mouse:x2') >= 0, 'chip re-rendered');

    restoreDefaults(); flush();
    eq(bro.settings.getActionKeys('il_aim')[0], 'mouse:right', 'defaults restored');
});

test('rumble', () => {
    const before = rumbleLog.length;
    const p = rumblePlay({ duration: 120, strongMagnitude: 0.9, weakMagnitude: 0.3 });
    check(p && typeof p.then === 'function', 'playEffect returned a promise');
    let result = null;
    p.then((r) => { result = r; });
    advanceTime(32);
    eq(result, 'complete', 'playEffect resolved');
    eq(rumbleLog.length, before + 1, 'the panel logged the effect');
    rumbleStop();
    eq(rumbleLog[rumbleLog.length - 1].kind, 'reset', 'reset() logged');

    // The preset buttons go through the same path.
    $('rumThud').click();
    advanceTime(32);
    eq(rumbleLog[rumbleLog.length - 1].kind, 'play', 'preset button played an effect');
    eq(rumbleLog[rumbleLog.length - 1].params.strongMagnitude, 1.0, 'thud is full strong');
    check($('rumStatus').textContent !== 'idle', 'status line updated');
});

test('two pads, independent slots', () => {
    const slot2 = gamepadConnect('Second Pad');
    flush(); advanceTime(32);
    eq(slot2, 1, 'second pad slot');
    eq(padState.connectCount, 2, 'panel saw two connects');
    eq(navigator.getGamepads().filter((x) => x).length, 2, 'two live pads');
    eq(padState.selected, 1, 'panel followed the newest pad');
    check($('padList').textContent.indexOf('Second Pad') >= 0, 'slot list shows both pads');
    eq($('padList').children.length, 2, 'two slot chips');
    eq($('padSummary').textContent, '2 pads', 'header chip');

    gamepadAxis(1, 'rightx', 0.9);
    flush(); advanceTime(32);
    near(navigator.getGamepads()[1].axes[2], 0.9, 1e-5, 'pad 1 axis set');
    eq(navigator.getGamepads()[0].axes[2], 0, 'pad 0 untouched');
    shot('gamepad');
    gamepadAxis(1, 'rightx', 0); flush();
});

test('disconnect', () => {
    let disconnects = 0;
    window.addEventListener('gamepaddisconnected', () => { disconnects++; });
    gamepadDisconnect(1);
    flush(); advanceTime(32);
    eq(disconnects, 1, 'gamepaddisconnected fired');
    check(navigator.getGamepads()[1] === null, 'the slot reads null, not missing');
    eq(navigator.getGamepads().length, 2, 'the slot array keeps its hole');
    eq(padState.disconnectCount, 1, 'panel counted the disconnect');
    check($('padList').children[1].classList.contains('gone'), 'the gone slot stays, greyed');

    gamepadDisconnect(0);
    flush(); advanceTime(32);
    eq(navigator.getGamepads().filter((x) => x).length, 0, 'all pads gone');
    check(!$('padEmpty').hidden && $('padBody').hidden, 'empty state returned when the last pad left');
});

// ── pointers ────────────────────────────────────────────────────────────────

const ptrCanvas = $('ptrCanvas');
let pc = ptrCanvas.getBoundingClientRect();
const P = (fx, fy) => [pc.left + fx, pc.top + fy];

test('pointers: two independent contacts', () => {
    pc = ptrCanvas.getBoundingClientRect();
    check(pc.width === 560 && pc.height === 300, 'pointer canvas laid out at its intrinsic size');
    check(pc.bottom < 3000, 'pointer panel is inside the viewport, got bottom ' + pc.bottom);

    touchDown(41, ...P(80, 80));
    touchDown(42, ...P(400, 200));
    flush(); advanceTime(16);

    eq(pointerState.pointers.size, 2, 'two simultaneous contacts tracked');
    const ids = Array.from(pointerState.pointers.keys());
    check(ids[0] !== ids[1], 'the two contacts have DISTINCT pointerIds: ' + JSON.stringify(ids));
    check(ids.every((i) => i >= 2), 'touch pointerIds start at 2 (the mouse owns 1): ' + ids);
    check(pointerState.maxConcurrent >= 2, 'the panel recorded a two-pointer peak');
    eq(pointerState.lastTouchList, 2, 'TouchEvent.touches agrees with our map');
    eq($('ptrSummary').textContent.indexOf('2'), 0, 'summary chip counts two live');

    const recs = Array.from(pointerState.pointers.values());
    const a = recs.find((r) => Math.round(r.x) === 80);
    const b = recs.find((r) => Math.round(r.x) === 400);
    check(a && b, 'both contacts are at their own canvas-local coordinates: ' +
          JSON.stringify(recs.map((r) => [Math.round(r.x), Math.round(r.y)])));
    check(Math.round(a.y) === 80 && Math.round(b.y) === 200, 'and their own y');
    check(a.color !== b.color, 'each contact drew in its own colour');
    check(a.primary === true && b.primary === false, 'the first finger is primary, the second is not');
    check(a.type === 'touch' && b.type === 'touch', 'both report pointerType "touch"');
    check($('ptrTable').textContent.indexOf('touch') >= 0, 'the table lists the contacts');

    // Moves are routed per pointer: moving one must not disturb the other.
    const bBefore = { x: b.x, y: b.y };
    touchMove(41, ...P(140, 120));
    flush(); advanceTime(16);
    check(Math.round(a.x) === 140 && Math.round(a.y) === 120, 'the moved contact followed');
    check(b.x === bBefore.x && b.y === bBefore.y, 'the other contact did not move');
    check(a.trail.length >= 2, 'the moved contact accumulated a trail: ' + a.trail.length);
    eq(b.trail.length, 1, 'the still contact did not');
    shot('pointers');

    touchUp(41, ...P(140, 120));
    flush();
    eq(pointerState.pointers.size, 1, 'lifting one finger leaves the other tracked');
    touchUp(42, ...P(400, 200));
    flush();
    eq(pointerState.pointers.size, 0, 'both gone');
});

test('a tap produces its compat mouse events, a drag does not', () => {
    $('ptrClear').click();
    flush();
    touchDown(50, ...P(300, 150));
    touchUp(50, ...P(300, 150));       // a clean tap: no travel past the slop
    flush(); advanceTime(16);

    const seq = pointerState.log.map((e) => e.type);
    check(seq.indexOf('pointerdown') >= 0, 'the tap produced a pointer event');
    check(seq.indexOf('touchstart') >= 0, 'and a touch event');
    check(seq.indexOf('mousedown') >= 0, 'and its COMPAT mouse event');
    check(seq.indexOf('mouseup') >= 0 && seq.indexOf('click') >= 0, 'and mouseup + click');
    check(seq.indexOf('pointerdown') < seq.indexOf('mousedown'),
          'the compat mouse event arrives AFTER the pointer stream: ' + seq.join(' > '));
    check(seq.indexOf('touchend') < seq.indexOf('mousedown'),
          'and specifically after touchend: ' + seq.join(' > '));
    eq(pointerState.log.filter((e) => e.kind === 'compat').length, 3, 'three synthesized events flagged compat');
    check($('ptrLog').querySelectorAll('.lrow.compat').length >= 3, 'the log shows them amber');

    $('ptrClear').click();
    touchDown(51, ...P(100, 100));
    touchMove(51, ...P(300, 220));
    touchUp(51, ...P(300, 220));
    flush(); advanceTime(16);
    const dragMouse = pointerState.log.filter((e) => e.type === 'mousedown' || e.type === 'click');
    eq(dragMouse.length, 0, 'a drag synthesizes no compat mouse events');
});

// The real proof is not that capture was granted, it is that moves outside the
// element's own rect still arrive at it.
test('pointer capture keeps the stream after leaving the element', () => {
    const capBox = $('capBox');
    let cb = capBox.getBoundingClientRect();
    const gotBefore = captureState.gotEvents;

    touchDown(60, cb.left + 20, cb.top + 20);
    flush();
    check(captureState.captured === true, 'gotpointercapture fired on the holder');
    eq(captureState.gotEvents, gotBefore + 1, 'exactly one capture acquired');
    check(capBox.hasPointerCapture(captureState.pointerId) === true, 'hasPointerCapture agrees');
    check(rowOn('capReadout', 0), 'the readout shows capture held');

    touchMove(60, cb.left + 300, cb.top + 260);
    touchMove(60, cb.left + 500, cb.top + 400);
    flush(); advanceTime(16);
    check(captureState.movesTotal >= 2, 'the captured element still received the moves');
    check(captureState.movesOutsideBounds >= 2,
          'those moves were delivered while OUTSIDE its bounds, got ' + captureState.movesOutsideBounds);

    const lostBefore = captureState.lostEvents;
    touchUp(60, cb.left + 500, cb.top + 400);
    flush();
    eq(captureState.lostEvents, lostBefore + 1, 'lostpointercapture fired on pointerup');
    check(captureState.captured === false, 'the holder no longer holds it');

    // The control: same drag with capture switched off delivers nothing outside.
    const capEnable = $('capEnable');
    capEnable.checked = false;
    capEnable.dispatchEvent(new Event('change'));
    flush();
    check(captureState.enabled === false, 'the toggle disabled capture');

    cb = capBox.getBoundingClientRect();
    touchDown(61, cb.left + 20, cb.top + 20);
    flush();
    check(captureState.pointerId !== null && captureState.movesOutsideBounds === 0,
          'the uncaptured drag really started on the box (counters reset)');
    check(captureState.captured === false, 'and no capture was taken');
    touchMove(61, cb.left + 300, cb.top + 260);
    touchMove(61, cb.left + 500, cb.top + 400);
    flush(); advanceTime(16);
    eq(captureState.movesOutsideBounds, 0, 'WITHOUT capture, no out-of-bounds move reaches the element');
    touchUp(61, cb.left + 500, cb.top + 400);
    flush();

    capEnable.checked = true;
    capEnable.dispatchEvent(new Event('change'));
    flush();
});

test('touchCancel clears the tracked contacts', () => {
    pc = ptrCanvas.getBoundingClientRect();
    const cancelsBefore = pointerState.cancelCount;
    touchDown(70, ...P(120, 120));
    touchDown(71, ...P(420, 220));
    flush();
    eq(pointerState.pointers.size, 2, 'two contacts down before the cancel');
    touchCancel(70, ...P(120, 120));
    touchCancel(71, ...P(420, 220));
    flush(); advanceTime(16);
    eq(pointerState.pointers.size, 0, 'touchCancel cleared every tracked pointer');
    eq(pointerState.cancelCount, cancelsBefore + 2, 'both cancels were counted');
    check(pointerState.log.filter((e) => e.type === 'pointercancel').length >= 2, 'pointercancel reached the log');
});

// ── gestures ────────────────────────────────────────────────────────────────

const gc = $('gestCanvas').getBoundingClientRect();
const G = (fx, fy) => [gc.left + fx, gc.top + fy];

test('gestures: pinch scales both ways', () => {
    resetGesture();
    check(gestureState.scale === 1 && gestureState.rotation === 0, 'view reset');
    // Two fingers 100 px apart spread to 300 px: e.scale must be 3.
    touchDown(80, ...G(180, 160));
    touchDown(81, ...G(280, 160));
    flush(); advanceTime(16);
    check(gestureState.active === true, 'the second finger started a gesture');
    touchMove(80, ...G(80, 160));
    touchMove(81, ...G(380, 160));
    flush(); advanceTime(16);
    near(gestureState.lastEventScale, 3, 1e-3, 'e.scale is distance-now / distance-at-start');
    near(gestureState.scale, 3, 1e-3, 'the viewer scaled UP with the pinch');
    check(gestureState.changes >= 1, 'gesturechange fired');
    eq(rowVal('gestReadout', 0), '3.000×', 'readout shows the view scale');

    const peak = gestureState.scale;
    touchMove(80, ...G(155, 160));
    touchMove(81, ...G(305, 160));
    flush(); advanceTime(16);
    check(gestureState.scale < peak, `pinch-in zoomed out again: ${gestureState.scale} < ${peak}`);

    touchUp(80, ...G(155, 160));
    touchUp(81, ...G(305, 160));
    flush(); advanceTime(16);
    check(gestureState.active === false, 'lifting a founding finger ended the gesture');
    eq(gestureState.gestures, 1, 'one completed gesture');
    check($('gestPhase').textContent.indexOf('gestureend') === 0, 'phase line reports gestureend');
});

// A horizontal pair swung to vertical is 90° CLOCKWISE in screen coordinates
// (y grows downward), and bro reports clockwise as positive.
test('gestures: twist rotates and accumulates', () => {
    resetGesture();
    const twist = (i, j) => {
        touchDown(i, ...G(180, 160)); touchDown(j, ...G(280, 160));
        flush(); advanceTime(16);
        touchMove(i, ...G(230, 110)); touchMove(j, ...G(230, 210));
        flush(); advanceTime(16);
    };
    const lift = (i, j) => {
        touchUp(i, ...G(230, 110)); touchUp(j, ...G(230, 210));
        flush(); advanceTime(16);
    };
    twist(90, 91);
    near(gestureState.lastEventRotation, 90, 0.5, 'e.rotation is +90 (clockwise positive)');
    near(gestureState.rotation, 90, 0.5, 'the viewer rotated with it');
    lift(90, 91);
    // Applied on top of the view's existing state, not assigned to it.
    twist(92, 93);
    near(gestureState.rotation, 180, 1, 'a second +90 gesture accumulated onto the first');
    shot('gesture');
    lift(92, 93);
    resetGesture();
});

// Gesture recognition is DOCUMENT-WIDE. Two fingers already resting on the
// visualiser are the founding pair, so a pinch on the map moves nothing.
test('gestures: recognition is document-wide', () => {
    pc = ptrCanvas.getBoundingClientRect();
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
    eq(gestureState.changes - changesBefore, 0, 'a pinch on the map is inert while an older pair holds the gesture');
    eq(gestureState.scale, 1, 'and the view did not move');
    touchUp(96, ...G(80, 160)); touchUp(97, ...G(380, 160));
    touchUp(94, ...P(100, 100)); touchUp(95, ...P(300, 200));
    flush(); advanceTime(16);
    eq(pointerState.pointers.size, 0, 'all contacts lifted');
    resetGesture();
});

// ── IME ─────────────────────────────────────────────────────────────────────

const imeInput = $('imeInput');

test('IME: a CJK composition in spec order', () => {
    check(imeState.headless === true, 'the IME seams are available under bro-headless');
    resetIme();
    flush();
    eq(imeInput.value, '', 'field starts empty');
    check(driveCJK() === true, 'the CJK driver ran');
    flush(); advanceTime(16);

    const comp = imeState.events.filter((e) => e.type.indexOf('composition') === 0);
    eq(comp[0].type, 'compositionstart', 'first event');
    eq(comp[comp.length - 1].type, 'compositionend', 'last event');
    const middles = comp.slice(1, -1);
    check(middles.length >= 3, 'one compositionupdate per preedit revision, got ' + middles.length);
    check(middles.every((e) => e.type === 'compositionupdate'),
          'everything between start and end is an update: ' + JSON.stringify(comp.map((e) => e.type)));
    eq(comp[1].data, 'n', 'the first update carried the first preedit');
    eq(comp[comp.length - 1].data, '你好', 'compositionend carried the committed string');

    eq(imeInput.value, '你好', 'the committed text is in the field');
    eq(imeState.committed, '你好', 'the panel recorded the commit');
    check(imeState.composing === false, 'composition finished');
    eq(imeState.compositions, 1, 'one completed composition');
    eq(rowVal('imeReadout', 5), '"你好"', 'the readout shows the field value');
    check(!$('imeBanner').classList.contains('on'), 'banner back to idle');

    // `input` fired for the revisions too, tagged so an app can tell them apart.
    const revs = imeState.events.filter((e) => e.type === 'input (insertCompositionText)');
    check(revs.length >= 4, 'each revision raised input/insertCompositionText, got ' + revs.length);
});

test('IME: preedit is provisional and its range is derived', () => {
    resetIme();
    eq(imeState.compositions, 0, 'clear reset the counters');
    imeInput.focus();
    imeCompose('ni');
    flush();
    check(imeState.composing === true, 'composing');
    eq(imeInput.value, 'ni', 'the preedit is provisionally in .value');
    eq(imeState.preedit, 'ni', 'the panel shows the preedit');
    check(imeState.rangeStart === 0 && imeState.rangeEnd === 2,
          `composition range is [0,2), got [${imeState.rangeStart},${imeState.rangeEnd})`);
    check($('imeBanner').classList.contains('on'), 'banner lit while composing');
    check(rowOn('imeReadout', 0), 'composing row lit');
    shot('ime');
    imeCommit('你');
    flush();
    eq(imeInput.value, '你', 'commit replaced the preedit');

    imeCompose('ha');
    flush();
    eq(imeState.rangeStart, 1, 'the next composition starts after the committed text');
    imeCommit('好');
    flush();
    eq(imeInput.value, '你好', 'two commits accumulate');
});

test('IME: cancel restores rather than clears', () => {
    resetIme();
    flush();
    eq(imeInput.value, '', 'field cleared');
    check(driveCancel() === true, 'the cancel driver ran');
    flush(); advanceTime(16);
    eq(imeInput.value, '', 'a cancelled composition leaves an empty field empty');
    check(imeState.composing === false, 'composition ended');
    eq(imeState.cancelled, 1, 'counted as cancelled, not committed');
    const cend = imeState.events.filter((e) => e.type === 'compositionend').pop();
    eq(cend.data, '', 'compositionend carried "" for the cancel');

    // ...but pre-existing text must survive it.
    resetIme();
    imeInput.focus();
    imeCompose('ab');
    imeCommit('kept');
    flush();
    eq(imeInput.value, 'kept', 'committed some text first');
    imeCompose('か');
    imeCompose('かん');
    flush();
    eq(imeInput.value, 'keptかん', 'the preedit is appended provisionally');
    imeCancel();
    flush();
    eq(imeInput.value, 'kept', 'cancel restored the pre-composition value');

    resetIme();
    check(driveAccent() === true, 'the accent driver ran');
    flush();
    eq(imeInput.value, 'é', 'the dead-key composition committed é');
    resetIme();
});

test('the frame loop ran', () => {
    advanceTime(200);
    eq(ship.history.length, 180, 'the thrust strip chart is full-length');
    check(rowVal('shipReadout', 0) !== '', 'ship readout populated');
    shot('main');
});

restoreDefaults();
resize(1920, 1080);
flush();
done('input-lab');
