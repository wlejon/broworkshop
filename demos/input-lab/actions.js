// actions.js — the action-binding panel.
//
// bro's action layer is what most apps should talk to instead of raw keydown:
// a named action holds a LIST of binding strings, and all four kinds (key,
// mouse button, gamepad button, stick-axis direction) resolve into two queries:
//
//     bro.settings.isActionPressed(name)   -> boolean (digital)
//     bro.settings.getActionStrength(name) -> 0..1    (analog)
//
// Every row shows both, side by side, every frame: a key contributes 0 or 1, a
// trigger its analog value, a stick direction its deadzone-rescaled deflection
// (m - dz) / (1 - dz). You can watch the dot stay binary while the bar sweeps.
//
// Rebinding goes through rebindAction(), the USER layer: it persists to
// .bro_settings.json and outranks defineAction() defaults from then on, so
// "restore default bindings" rebinds back explicitly.

import { h, clear } from "/lib/kit/index.js";
import { padState, BUTTON_NAMES, AXIS_NAMES } from "/app/gamepad.js";

// Prefixed: .bro_settings.json is shared by every bro app, and an unprefixed
// "fire" would collide with a game's binding the moment a user rebinds it here.
export const ACTIONS = [
    { name: 'il_thrust', label: 'thrust', defaults: ['w', 'gamepad:lefty-'], deadzone: 0.15 },
    { name: 'il_brake',  label: 'brake',  defaults: ['s', 'gamepad:lefty+'], deadzone: 0.15 },
    { name: 'il_left',   label: 'turn L', defaults: ['a', 'gamepad:leftx-'], deadzone: 0.15 },
    { name: 'il_right',  label: 'turn R', defaults: ['d', 'gamepad:leftx+'], deadzone: 0.15 },
    { name: 'il_fire',   label: 'fire',   defaults: ['mouse:left', 'gamepad:south'] },
    { name: 'il_aim',    label: 'aim',    defaults: ['mouse:right', 'gamepad:rightx+'] },
    { name: 'il_boost',  label: 'boost',  defaults: [' ', 'gamepad:righttrigger'] },
    { name: 'il_jump',   label: 'jump',   defaults: ['Shift', 'gamepad:north'] },
];

export const actionState = {
    capturing: null,        // { action, slot }  slot -1 = append
    lastBound: null,        // { action, binding }: the last capture that committed
    events: [],             // recent "action" CustomEvents, newest last
    strength: {},           // name -> last polled analog value
    pressed: {},            // name -> last polled digital value
};

const cells = {};           // name -> { binds, dot, fill, num }
let padBaseline = null;     // pad snapshot taken when capture armed

export function initActionPanel() {
    // defineAction is the APP layer: it seeds defaults but loses to a persisted user rebind.
    for (const a of ACTIONS) {
        bro.settings.defineAction(a.name, a.defaults.slice(), a.deadzone !== undefined ? { deadzone: a.deadzone } : undefined);
    }

    const rows = document.getElementById('actionRows');
    rows.appendChild(h('div.ahead', null, h('span.name', null, 'action'),
        h('span.binds', null, 'bindings: click to rebind, right-click to remove'),
        h('span.dot-h'), h('span.bar-h', null, 'strength'), h('span.num')));
    for (const a of ACTIONS) {
        const c = cells[a.name] = {
            binds: h('span.binds#binds_' + a.name),
            dot: h('span.dot', { title: 'isActionPressed' }),
            fill: h('i'),
            num: h('span.num', null, '0.00'),
        };
        rows.appendChild(h('div.arow', null, h('span.name', null, a.label), c.binds, c.dot, h('span.bar', null, c.fill), c.num));
        renderBinds(a.name);
    }

    // The edge stream beside the polled state: events fire only at threshold
    // crossings, while getActionStrength keeps tracking a trigger held at 0.9.
    document.body.addEventListener('action', (e) => {
        const d = e.detail;
        if (!d.action.startsWith('il_')) return;
        actionState.events.push({ action: d.action, phase: d.phase, key: d.key, strength: d.strength, gamepad: d.gamepad });
        if (actionState.events.length > 40) actionState.events.shift();
    });

    document.getElementById('resetBinds').addEventListener('click', restoreDefaults);

    // Installed once and gated on actionState.capturing: add/remove per
    // capture races with the very click that arms it.
    window.addEventListener('keydown', onCaptureKey, true);
    window.addEventListener('mousedown', onCaptureMouse, true);
}

/** Classify a binding string for colour-coding (also the doc of the syntax). */
export function bindKind(s) {
    if (s.startsWith('mouse:')) return 'mouse';
    if (s.startsWith('gamepad:')) return 'pad';
    return 'kb';
}

function renderBinds(name) {
    const host = clear(cells[name].binds);
    const keys = bro.settings.getActionKeys(name) || [];
    keys.forEach((k, i) => {
        host.appendChild(h('span.bind.' + bindKind(k), {
            onclick: (e) => { e.stopPropagation(); arm(name, i); },
            oncontextmenu: (e) => {
                e.preventDefault();
                const next = (bro.settings.getActionKeys(name) || []).slice();
                next.splice(i, 1);
                bro.settings.rebindAction(name, next);
                renderBinds(name);
            },
        }, k === ' ' ? '"Space"' : k));
    });
    host.appendChild(h('span.bind.add', { onclick: (e) => { e.stopPropagation(); arm(name, -1); } }, '+ add'));
}

// ── capture ─────────────────────────────────────────────────────────────────

function setArming(name, slot) {
    for (const chip of document.querySelectorAll('#actionRows .bind')) chip.classList.remove('arming');
    if (!name) return;
    const chips = cells[name].binds.querySelectorAll('.bind');
    const target = slot === -1 ? chips[chips.length - 1] : chips[slot];
    if (target) target.classList.add('arming');
}

function arm(name, slot) {
    actionState.capturing = { action: name, slot };
    // Freeze what the pad already does, so a stick held at full deflection
    // does not instantly capture itself.
    padBaseline = snapshotPad();
    const a = ACTIONS.find((x) => x.name === name);
    document.getElementById('captureFor').textContent = (a ? a.label : name) + (slot === -1 ? ' (new binding)' : ` (slot ${slot})`);
    document.getElementById('capture').hidden = false;
    setArming(name, slot);
}

function disarm() {
    actionState.capturing = null;
    padBaseline = null;
    document.getElementById('capture').hidden = true;
    setArming(null);
}

/** Commit a captured binding string into the armed slot (the seam the UI uses). */
export function commitBinding(binding) {
    const cap = actionState.capturing;
    if (!cap) return false;
    const keys = (bro.settings.getActionKeys(cap.action) || []).slice();
    if (cap.slot === -1) keys.push(binding);
    else keys[cap.slot] = binding;
    // The same string twice in one action is dead weight.
    bro.settings.rebindAction(cap.action, [...new Set(keys)]);
    actionState.lastBound = { action: cap.action, binding };
    disarm();
    renderBinds(cap.action);
    return true;
}

function onCaptureKey(e) {
    if (!actionState.capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') disarm();
    else commitBinding(e.key);
}

const MOUSE_BUTTONS = ['mouse:left', 'mouse:middle', 'mouse:right', 'mouse:x1', 'mouse:x2'];

function onCaptureMouse(e) {
    if (!actionState.capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (MOUSE_BUTTONS[e.button]) commitBinding(MOUSE_BUTTONS[e.button]);
}

function snapshotPad() {
    const gp = padState.pads[padState.selected];
    return gp ? { buttons: gp.buttons.map((b) => b.pressed), axes: gp.axes.slice() } : null;
}

// Gamepads have no DOM event for presses (the API is poll-only), so capture
// diffs this frame's snapshot against the baseline. Axes need a high threshold
// (0.6) so a resting stick with drift never binds itself.
const AXIS_CAPTURE_THRESHOLD = 0.6;

function pollCapture() {
    if (!actionState.capturing || !padBaseline) return;
    const gp = padState.pads[padState.selected];
    if (!gp) return;
    for (let i = 0; i < gp.buttons.length; i++) {
        if (gp.buttons[i].pressed && !padBaseline.buttons[i]) { commitBinding('gamepad:' + (BUTTON_NAMES[i] || i)); return; }
    }
    for (let i = 0; i < gp.axes.length && i < AXIS_NAMES.length; i++) {
        const v = gp.axes[i];
        if (Math.abs(v) >= AXIS_CAPTURE_THRESHOLD && Math.abs(v - (padBaseline.axes[i] || 0)) > 0.2) {
            commitBinding('gamepad:' + AXIS_NAMES[i] + (v > 0 ? '+' : '-'));
            return;
        }
    }
}

export function tickActionPanel() {
    pollCapture();
    for (const a of ACTIONS) {
        const s = bro.settings.getActionStrength(a.name);
        const p = bro.settings.isActionPressed(a.name);
        actionState.strength[a.name] = s;
        actionState.pressed[a.name] = p;
        const c = cells[a.name];
        c.dot.classList.toggle('on', p);
        c.fill.style.width = Math.round(Math.max(0, Math.min(1, s)) * 100) + '%';
        const txt = s.toFixed(2);
        if (c.num.textContent !== txt) c.num.textContent = txt;
    }
}

export function restoreDefaults() {
    for (const a of ACTIONS) {
        bro.settings.rebindAction(a.name, a.defaults.slice());
        renderBinds(a.name);
    }
}

/** One action's analog strength: the ship's only input channel. */
export function strength(name) { return bro.settings.getActionStrength(name); }
