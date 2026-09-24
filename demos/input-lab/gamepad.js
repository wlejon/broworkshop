// gamepad.js — the live controller panel.
//
// The Gamepad API is a POLL model: navigator.getGamepads() hands back fresh
// immutable snapshots per call. Everything here reads ONE snapshot per frame
// into padState.pads, and every consumer (the drawing, the readouts, the
// rebind capture in actions.js) works off it, so two readers in one frame can
// never disagree about what the stick was doing.
//
// Only connection CHANGES are events; those maintain the slot list, which is
// sticky on purpose: a disconnected slot reads null in getGamepads() but stays
// listed, greyed out, because that null hole is API behaviour worth showing.

import { h, clear, readout } from "/lib/kit/index.js";
import { drawPad } from "/app/pad-draw.js";

export const BUTTON_NAMES = [
    'south', 'east', 'west', 'north',
    'leftshoulder', 'rightshoulder', 'lefttrigger', 'righttrigger',
    'back', 'start', 'leftstick', 'rightstick',
    'dpup', 'dpdown', 'dpleft', 'dpright', 'guide',
];
// The standard mapping is device-neutral; the Xbox glyphs are only a hint.
const BUTTON_LABELS = [
    'south (A)', 'east (B)', 'west (X)', 'north (Y)', 'LB', 'RB', 'LT (analog)', 'RT (analog)',
    'back', 'start', 'L3', 'R3', 'dpad up', 'dpad down', 'dpad left', 'dpad right', 'guide',
];
export const AXIS_NAMES = ['leftx', 'lefty', 'rightx', 'righty'];
const AXIS_LABELS = ['left stick X', 'left stick Y', 'right stick X', 'right stick Y'];

export const padState = {
    pads: [],            // this frame's snapshots, indexed by slot (null = gone)
    slots: [],           // [{ index, id, mapping, connected }]
    selected: 0,         // which slot the canvas + rumble controls address
    connectCount: 0,
    disconnectCount: 0,
    lastEvent: null,     // { type, index, id }
};

let canvas, btnRo, axisRo, metaRo, rumStatusEl;

export function initGamepadPanel() {
    canvas = document.getElementById('padCanvas');
    btnRo = readout('#btnReadout', BUTTON_LABELS.map((l, i) => i + ' ' + l));
    axisRo = readout('#axisReadout', AXIS_LABELS.map((l, i) => i + ' ' + l));
    metaRo = readout('#metaReadout', { id: 'id', index: 'index', mapping: 'mapping',
                                       connected: 'connected', ts: 'timestamp', fx: 'effects' });
    rumStatusEl = document.getElementById('rumStatus');

    window.addEventListener('gamepadconnected', (e) => {
        padState.connectCount++;
        padState.lastEvent = { type: 'connected', index: e.gamepad.index, id: e.gamepad.id };
        noteSlot(e.gamepad, true);
        padState.selected = e.gamepad.index;
        renderSlotList();
    });
    window.addEventListener('gamepaddisconnected', (e) => {
        padState.disconnectCount++;
        padState.lastEvent = { type: 'disconnected', index: e.gamepad.index, id: e.gamepad.id };
        noteSlot(e.gamepad, false);
        renderSlotList();
    });

    initRumble();
    pollPads();
    renderSlotList();
}

function noteSlot(gp, connected) {
    let s = padState.slots.find((x) => x.index === gp.index);
    if (!s) { s = { index: gp.index }; padState.slots.push(s); }
    Object.assign(s, { id: gp.id, mapping: gp.mapping, connected });
    padState.slots.sort((a, b) => a.index - b.index);
}

function renderSlotList() {
    const list = clear(document.getElementById('padList'));
    for (const s of padState.slots) {
        list.appendChild(h('span.k-chip.padchip', {
            class: s.connected ? (s.index === padState.selected ? 'on' : null) : 'gone',
            onclick: s.connected ? () => { padState.selected = s.index; renderSlotList(); } : null,
        }, `#${s.index} ${s.id} · ${s.mapping}`));
    }
    const live = padState.slots.filter((s) => s.connected).length;
    document.getElementById('padEmpty').hidden = live > 0;
    document.getElementById('padBody').hidden = live === 0;
    const sum = document.getElementById('padSummary');
    sum.textContent = live ? `${live} pad${live > 1 ? 's' : ''}` : 'no pad';
    sum.classList.toggle('on', live > 0);
}

/** Refresh padState.pads from one poll. Called once at the top of each frame. */
export function pollPads() {
    padState.pads = Array.prototype.slice.call(navigator.getGamepads());
    return padState.pads;
}

/** The snapshot for the selected slot, or null. */
export function currentPad() {
    return padState.pads[padState.selected] || null;
}

const sign = (v) => { v = v || 0; return (v >= 0 ? '+' : '') + v.toFixed(2); };

function updateReadouts() {
    const gp = currentPad();
    for (let i = 0; i < BUTTON_NAMES.length; i++) {
        const b = gp ? gp.buttons[i] : null;
        btnRo.set(i, b ? b.value.toFixed(2) : '0.00', !!(b && b.pressed));
    }
    for (let i = 0; i < AXIS_NAMES.length; i++) {
        const v = gp ? gp.axes[i] || 0 : 0;
        axisRo.set(i, sign(v), Math.abs(v) > 0.1);
    }
    metaRo.set({
        id: gp ? gp.id : '—',
        index: gp ? gp.index : '—',
        mapping: gp ? gp.mapping : '—',
        connected: gp ? gp.connected : '—',
        ts: gp ? Math.round(gp.timestamp) : '—',
        fx: gp && gp.vibrationActuator ? gp.vibrationActuator.effects.join(', ') : '—',
    });
}

// ── rumble ──────────────────────────────────────────────────────────────────
// playEffect() resolves once the effect is handed to SDL, not after its
// duration, so a ramp is sequenced by the app; a second ramp or a reset
// cancels the first rather than interleaving with it.

let rampTimer = null;
export const rumbleLog = [];

function setStatus(s) { rumStatusEl.textContent = s; }

function initRumble() {
    const val = (id) => +document.getElementById(id).value;
    for (const [id, dp] of [['rumStrong', 2], ['rumWeak', 2], ['rumDur', 0]]) {
        const el = document.getElementById(id), out = document.getElementById(id + 'V');
        const sync = () => { out.textContent = (+el.value).toFixed(dp); };
        el.addEventListener('input', sync);
        sync();
    }
    const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
    on('rumPlay', () => play({ duration: val('rumDur'), strongMagnitude: val('rumStrong'), weakMagnitude: val('rumWeak') }));
    on('rumTick', () => play({ duration: 40, strongMagnitude: 0.0, weakMagnitude: 0.45 }));
    on('rumThud', () => play({ duration: 320, strongMagnitude: 1.0, weakMagnitude: 0.2 }));
    on('rumRamp', () => ramp());
    on('rumStop', () => stop());
}

/** Fire one dual-rumble effect on the selected pad. */
export function play(params) {
    const gp = currentPad();
    if (!gp || !gp.vibrationActuator) { setStatus('no pad — nothing to rumble'); return null; }
    rumbleLog.push({ kind: 'play', params });
    setStatus(`playEffect strong=${params.strongMagnitude.toFixed(2)} weak=${params.weakMagnitude.toFixed(2)} ` +
              `${Math.round(params.duration)}ms`);
    const p = gp.vibrationActuator.playEffect('dual-rumble', params);
    if (p && p.then) p.then((r) => setStatus('→ ' + r));
    return p;
}

/** Chained pulses climbing 0 → 1. */
export function ramp(steps, stepMs) {
    steps = steps || 12;
    stepMs = stepMs || 55;
    stopRamp();
    let i = 0;
    rumbleLog.push({ kind: 'ramp', steps });
    const tick = () => {
        if (i >= steps) { rampTimer = null; stop(); return; }
        const m = (i + 1) / steps;
        const gp = currentPad();
        if (gp && gp.vibrationActuator) {
            gp.vibrationActuator.playEffect('dual-rumble', { duration: stepMs + 10, strongMagnitude: m, weakMagnitude: m * 0.5 });
        }
        setStatus(`ramp ${i + 1}/${steps} — ${m.toFixed(2)}`);
        i++;
        rampTimer = setTimeout(tick, stepMs);
    };
    tick();
    return steps;
}

function stopRamp() { if (rampTimer !== null) { clearTimeout(rampTimer); rampTimer = null; } }

/** reset() on the selected pad, cancelling any ramp in flight. */
export function stop() {
    stopRamp();
    const gp = currentPad();
    if (!gp || !gp.vibrationActuator) { setStatus('no pad'); return null; }
    rumbleLog.push({ kind: 'reset' });
    setStatus('reset() — motors stopped');
    return gp.vibrationActuator.reset();
}

/** Once per frame, after pollPads(). */
export function tickGamepadPanel() {
    // A pad present before the panel initialised never fired an event here;
    // reconcile against the poll.
    let dirty = false;
    for (let i = 0; i < padState.pads.length; i++) {
        const gp = padState.pads[i];
        if (gp && !padState.slots.some((s) => s.index === i && s.connected)) { noteSlot(gp, true); dirty = true; }
    }
    if (dirty) renderSlotList();
    drawPad(canvas, currentPad());
    updateReadouts();
}
