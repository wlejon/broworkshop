// actions.js — the action-binding panel.
//
// bro's action system is the layer most apps should be talking to instead of
// raw keydown: a named action holds a LIST of binding strings, and all four
// binding kinds resolve into the same two queries —
//
//     bro.settings.isActionPressed(name)   -> boolean (digital)
//     bro.settings.getActionStrength(name) -> 0..1    (analog)
//
// The panel shows both, side by side, for every action every frame. That is
// the whole argument: a key contributes 0 or 1, a trigger contributes its
// analog value, and a stick-axis binding contributes its deadzone-rescaled
// deflection `(m - deadzone) / (1 - deadzone)`. Identical call, different
// curve, and you can watch the dot stay binary while the bar sweeps.
//
// Rebinding goes through rebindAction(), which is the USER layer — it persists
// to .bro_settings.json immediately and outranks the defineAction() defaults
// forever after. "restore default bindings" therefore has to rebind back to
// the defaults explicitly; there is no per-action revert.

import { padState, BUTTON_NAMES, AXIS_NAMES } from '/app/gamepad.js';

// Action names are prefixed because .bro_settings.json is engine-global and
// shared across every bro app — an unprefixed "fire" would collide with a
// game's binding the moment a user rebinds it here.
export const ACTIONS = [
    { name: 'il_thrust', label: 'thrust', defaults: ['w', 'gamepad:lefty-'],        deadzone: 0.15 },
    { name: 'il_brake',  label: 'brake',  defaults: ['s', 'gamepad:lefty+'],        deadzone: 0.15 },
    { name: 'il_left',   label: 'turn L', defaults: ['a', 'gamepad:leftx-'],        deadzone: 0.15 },
    { name: 'il_right',  label: 'turn R', defaults: ['d', 'gamepad:leftx+'],        deadzone: 0.15 },
    { name: 'il_fire',   label: 'fire',   defaults: ['mouse:left', 'gamepad:south'] },
    { name: 'il_aim',    label: 'aim',    defaults: ['mouse:right', 'gamepad:rightx+'] },
    { name: 'il_boost',  label: 'boost',  defaults: [' ', 'gamepad:righttrigger'] },
    { name: 'il_jump',   label: 'jump',   defaults: ['Shift', 'gamepad:north'] },
];

export const actionState = {
    capturing: null,        // {action, slot}  slot -1 = append
    lastBound: null,        // {action, binding} — last capture that committed
    events: [],             // recent "action" CustomEvents, newest last
    strength: {},           // name -> last polled analog value
    pressed: {},            // name -> last polled digital value
};

let captureEl, captureForEl, rowsEl;
let padBaseline = null;     // pad snapshot taken when capture armed

export function initActionPanel() {
    captureEl    = document.getElementById('capture');
    captureForEl = document.getElementById('captureFor');
    rowsEl       = document.getElementById('actionRows');

    // defineAction is the APP layer: it seeds defaults but loses to any
    // persisted user rebind, which is exactly what we want on a relaunch.
    for (const a of ACTIONS) {
        const opts = a.deadzone !== undefined ? { deadzone: a.deadzone } : undefined;
        bro.settings.defineAction(a.name, a.defaults.slice(), opts);
    }

    buildRows();

    // The edge stream, alongside the polled state. Both are shown so the
    // difference is visible: events only fire at the threshold crossing, while
    // getActionStrength keeps tracking a trigger held at 0.9.
    document.body.addEventListener('action', (e) => {
        const d = e.detail;
        if (!d.action.startsWith('il_')) return;
        actionState.events.push({ action: d.action, phase: d.phase, key: d.key,
                                  strength: d.strength, gamepad: d.gamepad });
        if (actionState.events.length > 40) actionState.events.shift();
    });

    document.getElementById('resetBinds').addEventListener('click', restoreDefaults);

    // Capture listeners are installed once and gated on actionState.capturing
    // rather than added/removed per capture — add/remove races with the very
    // click that arms the capture.
    window.addEventListener('keydown', onCaptureKey, true);
    window.addEventListener('mousedown', onCaptureMouse, true);
}

// ── rows ────────────────────────────────────────────────────────────────────

function buildRows() {
    rowsEl.innerHTML =
        '<div class="ahead"><span class="name">action</span>' +
        '<span class="binds">bindings — click to rebind, right-click to remove</span>' +
        '<span class="s1"></span><span class="s2">getActionStrength</span>' +
        '<span class="s3"></span></div>';
    for (const a of ACTIONS) {
        const row = document.createElement('div');
        row.className = 'arow';
        row.innerHTML =
            `<span class="name">${a.label}</span>` +
            `<span class="binds" id="binds_${a.name}"></span>` +
            `<span class="dot" id="dot_${a.name}" title="isActionPressed"></span>` +
            `<span class="bar"><i id="bar_${a.name}"></i></span>` +
            `<span class="num" id="num_${a.name}">0.00</span>`;
        rowsEl.appendChild(row);
    }
    for (const a of ACTIONS) renderBinds(a.name);
}

/** Classify a binding string for colour-coding — also the doc of the syntax. */
export function bindKind(s) {
    if (s.indexOf('mouse:') === 0) return 'mouse';
    if (s.indexOf('gamepad:') === 0) return 'pad';
    return 'kb';
}

function renderBinds(name) {
    const host = document.getElementById('binds_' + name);
    if (!host) return;
    host.innerHTML = '';
    const keys = bro.settings.getActionKeys(name) || [];
    keys.forEach((k, i) => {
        const chip = document.createElement('span');
        chip.className = 'bind ' + bindKind(k);
        chip.textContent = k === ' ' ? '"Space"' : k;
        chip.addEventListener('click', (e) => { e.stopPropagation(); arm(name, i); });
        chip.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const next = (bro.settings.getActionKeys(name) || []).slice();
            next.splice(i, 1);
            bro.settings.rebindAction(name, next);
            renderBinds(name);
        });
        host.appendChild(chip);
    });
    const add = document.createElement('span');
    add.className = 'bind add';
    add.textContent = '+ add';
    add.addEventListener('click', (e) => { e.stopPropagation(); arm(name, -1); });
    host.appendChild(add);
}

// ── capture ─────────────────────────────────────────────────────────────────

function arm(name, slot) {
    actionState.capturing = { action: name, slot };
    // Freeze what the pad is already doing, so a stick already held at full
    // deflection doesn't instantly "capture" itself.
    padBaseline = snapshotPad();
    captureEl.classList.add('on');
    const a = ACTIONS.find((x) => x.name === name);
    captureForEl.textContent = (a ? a.label : name) + (slot === -1 ? ' (new binding)' : ` (slot ${slot})`);
    for (const chip of rowsEl.querySelectorAll('.bind')) chip.classList.remove('arming');
    const host = document.getElementById('binds_' + name);
    const chips = host.querySelectorAll('.bind');
    const target = slot === -1 ? chips[chips.length - 1] : chips[slot];
    if (target) target.classList.add('arming');
}

function disarm() {
    actionState.capturing = null;
    padBaseline = null;
    captureEl.classList.remove('on');
    for (const chip of rowsEl.querySelectorAll('.bind')) chip.classList.remove('arming');
}

/** Commit a captured binding string into the armed slot. Exported for tests. */
export function commitBinding(binding) {
    const cap = actionState.capturing;
    if (!cap) return false;
    const keys = (bro.settings.getActionKeys(cap.action) || []).slice();
    if (cap.slot === -1) keys.push(binding);
    else keys[cap.slot] = binding;
    // Deduplicate: the same string twice in one action is dead weight and
    // makes getActionKeys() lie about how many distinct inputs are bound.
    const seen = [];
    for (const k of keys) if (seen.indexOf(k) === -1) seen.push(k);
    bro.settings.rebindAction(cap.action, seen);
    actionState.lastBound = { action: cap.action, binding };
    const name = cap.action;
    disarm();
    renderBinds(name);
    return true;
}

function onCaptureKey(e) {
    if (!actionState.capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { disarm(); return; }
    commitBinding(e.key);
}

const MOUSE_BUTTONS = ['mouse:left', 'mouse:middle', 'mouse:right', 'mouse:x1', 'mouse:x2'];

function onCaptureMouse(e) {
    if (!actionState.capturing) return;
    e.preventDefault();
    e.stopPropagation();
    const b = MOUSE_BUTTONS[e.button];
    if (b) commitBinding(b);
}

function snapshotPad() {
    const gp = padState.pads[padState.selected];
    if (!gp) return null;
    return {
        buttons: gp.buttons.map((b) => b.pressed),
        axes: gp.axes.slice(),
    };
}

// Gamepads have no DOM event for button presses — the API is poll-only — so
// capture has to diff this frame's snapshot against the baseline taken when
// the slot was armed. Axes need a deliberately high threshold (0.6) so a
// resting stick with drift never binds itself.
const AXIS_CAPTURE_THRESHOLD = 0.6;

export function pollCapture() {
    if (!actionState.capturing || !padBaseline) return;
    const gp = padState.pads[padState.selected];
    if (!gp) return;
    for (let i = 0; i < gp.buttons.length; i++) {
        if (gp.buttons[i].pressed && !padBaseline.buttons[i]) {
            commitBinding('gamepad:' + (BUTTON_NAMES[i] || i));
            return;
        }
    }
    for (let i = 0; i < gp.axes.length && i < AXIS_NAMES.length; i++) {
        const v = gp.axes[i], base = padBaseline.axes[i] || 0;
        if (Math.abs(v) >= AXIS_CAPTURE_THRESHOLD && Math.abs(v - base) > 0.2) {
            commitBinding('gamepad:' + AXIS_NAMES[i] + (v > 0 ? '+' : '-'));
            return;
        }
    }
}

// ── per-frame state ─────────────────────────────────────────────────────────

export function tickActionPanel() {
    pollCapture();
    for (const a of ACTIONS) {
        const s = bro.settings.getActionStrength(a.name);
        const p = bro.settings.isActionPressed(a.name);
        actionState.strength[a.name] = s;
        actionState.pressed[a.name] = p;
        const dot = document.getElementById('dot_' + a.name);
        const bar = document.getElementById('bar_' + a.name);
        const num = document.getElementById('num_' + a.name);
        if (dot) dot.className = 'dot' + (p ? ' on' : '');
        if (bar) bar.style.width = Math.round(Math.max(0, Math.min(1, s)) * 100) + '%';
        if (num) num.textContent = s.toFixed(2);
    }
}

export function restoreDefaults() {
    for (const a of ACTIONS) {
        bro.settings.rebindAction(a.name, a.defaults.slice());
        renderBinds(a.name);
    }
}

/** Read one action's analog strength — the ship's only input channel. */
export function strength(name) { return bro.settings.getActionStrength(name); }
