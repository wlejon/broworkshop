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

// ── the frame loop actually ran ─────────────────────────────────────────────

advanceTime(200);
assert(ship.history.length === 180, 'the thrust strip chart is full-length');

restoreDefaults();
console.log('input-lab smoke test: all assertions passed');
