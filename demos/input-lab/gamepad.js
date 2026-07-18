// gamepad.js — the live controller panel.
//
// The Gamepad API is a POLL model: navigator.getGamepads() hands back a fresh
// immutable snapshot per call and old snapshots never mutate. So everything
// here reads once per frame into `pads` and every consumer (the drawing, the
// numeric readouts, the rebind capture in actions.js) works off that one
// snapshot rather than re-polling — otherwise two readers in the same frame
// could disagree about what the stick was doing.
//
// Only connection CHANGES are events (gamepadconnected/gamepaddisconnected);
// those maintain the slot list, which is deliberately sticky: a disconnected
// slot reads null in getGamepads() but stays visible here, greyed out, because
// that null-hole is the API behaviour worth showing.

export const BUTTON_NAMES = [
    'south', 'east', 'west', 'north',
    'leftshoulder', 'rightshoulder', 'lefttrigger', 'righttrigger',
    'back', 'start', 'leftstick', 'rightstick',
    'dpup', 'dpdown', 'dpleft', 'dpright', 'guide',
];

// Human labels for the readout — the standard mapping is device-neutral, so
// the Xbox glyphs are only a hint at what the abstract name means.
const BUTTON_LABELS = [
    'south (A)', 'east (B)', 'west (X)', 'north (Y)',
    'LB', 'RB', 'LT (analog)', 'RT (analog)',
    'back', 'start', 'L3', 'R3',
    'dpad up', 'dpad down', 'dpad left', 'dpad right', 'guide',
];

export const AXIS_NAMES = ['leftx', 'lefty', 'rightx', 'righty'];
const AXIS_LABELS = ['left stick X', 'left stick Y', 'right stick X', 'right stick Y'];

// Slot bookkeeping. `slots` grows monotonically the way getGamepads() does;
// `seen` remembers the id of a device that has since left so the greyed-out
// chip can still name it.
export const padState = {
    pads: [],            // this frame's snapshots, indexed by slot (null = gone)
    slots: [],           // [{index, id, mapping, connected}]
    selected: 0,         // which slot the canvas + rumble controls address
    connectCount: 0,     // bumped by gamepadconnected — tests assert on this
    disconnectCount: 0,
    lastEvent: null,     // {type, index, id}
};

let padListEl, padEmptyEl, padBodyEl, padSummaryEl, canvas, ctx;
let btnReadoutEl, axisReadoutEl, metaReadoutEl, rumStatusEl;

export function initGamepadPanel() {
    padListEl    = document.getElementById('padList');
    padEmptyEl   = document.getElementById('padEmpty');
    padBodyEl    = document.getElementById('padBody');
    padSummaryEl = document.getElementById('padSummary');
    btnReadoutEl = document.getElementById('btnReadout');
    axisReadoutEl= document.getElementById('axisReadout');
    metaReadoutEl= document.getElementById('metaReadout');
    rumStatusEl  = document.getElementById('rumStatus');

    canvas = document.getElementById('padCanvas');
    ctx = canvas.getContext('2d');

    // Pre-build the readout rows once. They are updated by writing textContent
    // into fixed elements every frame; rebuilding this markup at 60 Hz would
    // relayout the panel constantly for no visual gain.
    btnReadoutEl.innerHTML = BUTTON_LABELS.map((l, i) =>
        `<div class="row" id="brow${i}"><span>${i} ${l}</span><b id="bval${i}">0.00</b></div>`).join('');
    axisReadoutEl.innerHTML = AXIS_LABELS.map((l, i) =>
        `<div class="row" id="arow${i}"><span>${i} ${l}</span><b id="aval${i}">+0.00</b></div>`).join('');
    metaReadoutEl.innerHTML =
        `<div class="row"><span>id</span><b id="mId">—</b></div>` +
        `<div class="row"><span>index</span><b id="mIndex">—</b></div>` +
        `<div class="row"><span>mapping</span><b id="mMapping">—</b></div>` +
        `<div class="row"><span>connected</span><b id="mConn">—</b></div>` +
        `<div class="row"><span>timestamp</span><b id="mTs">—</b></div>` +
        `<div class="row"><span>effects</span><b id="mFx">—</b></div>`;

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
    if (!s) { s = { index: gp.index, id: gp.id, mapping: gp.mapping, connected }; padState.slots.push(s); }
    s.id = gp.id; s.mapping = gp.mapping; s.connected = connected;
    padState.slots.sort((a, b) => a.index - b.index);
}

function renderSlotList() {
    padListEl.innerHTML = '';
    for (const s of padState.slots) {
        const el = document.createElement('div');
        el.className = 'padchip' + (s.connected ? (s.index === padState.selected ? ' sel' : '') : ' gone');
        el.textContent = `#${s.index} ${s.id} · ${s.mapping}`;
        if (s.connected) el.addEventListener('click', () => { padState.selected = s.index; renderSlotList(); });
        padListEl.appendChild(el);
    }
    const live = padState.slots.filter((s) => s.connected).length;
    const hasAny = live > 0;
    padEmptyEl.style.display = hasAny ? 'none' : 'block';
    padBodyEl.style.display  = hasAny ? 'block' : 'none';
    padSummaryEl.textContent = hasAny ? `${live} pad${live > 1 ? 's' : ''}` : 'no pad';
    padSummaryEl.className = hasAny ? 'tag live' : 'tag';
}

/** Refresh padState.pads from one poll. Called once at the top of each frame. */
export function pollPads() {
    const raw = navigator.getGamepads();
    padState.pads = Array.prototype.slice.call(raw);
    return padState.pads;
}

/** The snapshot for the currently selected slot, or null. */
export function currentPad() {
    return padState.pads[padState.selected] || null;
}

// ── drawing ─────────────────────────────────────────────────────────────────
//
// A schematic controller rather than an accurate one: every one of the 17
// standard buttons and both sticks need a distinct, labelled hit-spot, which a
// realistic silhouette would fight. The geometry table below is the single
// source of truth for both the fill and the highlight.

const FACE = [   // index -> {x, y} for the four face buttons (south/east/west/north)
    { i: 0, x: 432, y: 196 }, { i: 1, x: 466, y: 166 },
    { i: 2, x: 398, y: 166 }, { i: 3, x: 432, y: 136 },
];
const DPAD = [   // index -> rect
    { i: 12, x: 116, y: 138, w: 26, h: 30 },   // up
    { i: 13, x: 116, y: 196, w: 26, h: 30 },   // down
    { i: 14, x: 84,  y: 170, w: 30, h: 26 },   // left
    { i: 15, x: 144, y: 170, w: 30, h: 26 },   // right
];
const CENTER = [ // back / start / guide
    { i: 8,  x: 246, y: 136, r: 9 },
    { i: 9,  x: 314, y: 136, r: 9 },
    { i: 16, x: 280, y: 118, r: 12 },
];
const STICKS = [ // {ax, ay, button, cx, cy}
    { ax: 0, ay: 1, btn: 10, cx: 210, cy: 252, r: 34 },
    { ax: 2, ay: 3, btn: 11, cx: 356, cy: 252, r: 34 },
];

const OFF = '#1b2230', EDGE = '#2b3444', ON = '#6ee79a', TXT = '#6d7688';

export function drawPad() {
    const gp = currentPad();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#080a0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!gp) return;

    const b = gp.buttons;
    const pressed = (i) => b[i] && b[i].pressed;

    // Body outline — purely orientation for the eye.
    ctx.strokeStyle = '#1e2531';
    ctx.lineWidth = 2;
    roundRect(60, 100, 440, 190, 60);
    ctx.stroke();

    // Triggers first (top row): drawn as fill bars because they are the one
    // pair of buttons whose `value` is genuinely continuous.
    drawTrigger(6, 96, 34, 'LT', b[6]);
    drawTrigger(7, 372, 34, 'RT', b[7]);

    // Shoulders.
    drawRect(4, 96, 72, 92, 20, 'LB', pressed(4));
    drawRect(5, 372, 72, 92, 20, 'RB', pressed(5));

    // D-pad.
    for (const d of DPAD) drawRect(d.i, d.x, d.y, d.w, d.h, '', pressed(d.i));

    // Face buttons.
    const faceLabel = ['A', 'B', 'X', 'Y'];
    for (const f of FACE) drawCircle(f.x, f.y, 16, faceLabel[f.i], pressed(f.i));

    // back / start / guide.
    for (const c of CENTER) drawCircle(c.x, c.y, c.r, '', pressed(c.i));
    label('back', 246, 160); label('start', 314, 160);

    // Sticks: ring plus a knob offset by the axis pair. The knob is the direct
    // visual of axes[] and moves continuously, which is the contrast with the
    // binary face buttons right next to it.
    for (const s of STICKS) {
        const x = gp.axes[s.ax] || 0, y = gp.axes[s.ay] || 0;
        ctx.strokeStyle = EDGE; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2); ctx.stroke();
        // crosshair
        ctx.strokeStyle = '#161c27';
        ctx.beginPath();
        ctx.moveTo(s.cx - s.r, s.cy); ctx.lineTo(s.cx + s.r, s.cy);
        ctx.moveTo(s.cx, s.cy - s.r); ctx.lineTo(s.cx, s.cy + s.r);
        ctx.stroke();
        // knob
        const kx = s.cx + x * (s.r - 10), ky = s.cy + y * (s.r - 10);
        ctx.strokeStyle = '#3d5a80'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(s.cx, s.cy); ctx.lineTo(kx, ky); ctx.stroke();
        drawCircle(kx, ky, 11, '', pressed(s.btn));
    }

    // Live numbers under the sticks so the picture and the values agree.
    ctx.fillStyle = TXT; ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(fmt(gp.axes[0]) + ', ' + fmt(gp.axes[1]), 210, 302);
    ctx.fillText(fmt(gp.axes[2]) + ', ' + fmt(gp.axes[3]), 356, 302);
}

function fmt(v) { v = v || 0; return (v >= 0 ? '+' : '') + v.toFixed(2); }

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawRect(i, x, y, w, h, text, on) {
    ctx.fillStyle = on ? ON : OFF;
    ctx.strokeStyle = on ? ON : EDGE;
    ctx.lineWidth = 1;
    roundRect(x, y, w, h, 4);
    ctx.fill(); ctx.stroke();
    if (text) {
        ctx.fillStyle = on ? '#0d1016' : TXT;
        ctx.font = '11px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, x + w / 2, y + h / 2);
    }
}

function drawCircle(x, y, r, text, on) {
    ctx.fillStyle = on ? ON : OFF;
    ctx.strokeStyle = on ? ON : EDGE;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    if (text) {
        ctx.fillStyle = on ? '#0d1016' : TXT;
        ctx.font = '11px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y);
    }
}

// A trigger draws its analog value as a fill level, not an on/off state.
function drawTrigger(i, x, y, text, btn) {
    const v = btn ? btn.value : 0;
    const w = 92, h = 22;
    ctx.fillStyle = OFF; ctx.strokeStyle = btn && btn.pressed ? ON : EDGE;
    roundRect(x, y, w, h, 4); ctx.fill(); ctx.stroke();
    if (v > 0) {
        ctx.save();
        roundRect(x, y, w, h, 4); ctx.clip();
        ctx.fillStyle = '#2f7d52';
        ctx.fillRect(x, y, w * v, h);
        ctx.restore();
    }
    ctx.fillStyle = '#b9c2d4';
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text + ' ' + v.toFixed(2), x + w / 2, y + h / 2);
}

function label(text, x, y) {
    ctx.fillStyle = TXT; ctx.font = '9px system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
}

// ── numeric readouts ────────────────────────────────────────────────────────

export function updateReadouts() {
    const gp = currentPad();
    for (let i = 0; i < BUTTON_NAMES.length; i++) {
        const b = gp ? gp.buttons[i] : null;
        const row = document.getElementById('brow' + i);
        const val = document.getElementById('bval' + i);
        if (!row) continue;
        row.className = 'row' + (b && b.pressed ? ' on' : '');
        val.textContent = b ? b.value.toFixed(2) : '0.00';
    }
    for (let i = 0; i < AXIS_NAMES.length; i++) {
        const v = gp ? (gp.axes[i] || 0) : 0;
        document.getElementById('arow' + i).className = 'row' + (Math.abs(v) > 0.1 ? ' on' : '');
        document.getElementById('aval' + i).textContent = fmt(v);
    }
    setText('mId', gp ? gp.id : '—');
    setText('mIndex', gp ? String(gp.index) : '—');
    setText('mMapping', gp ? gp.mapping : '—');
    setText('mConn', gp ? String(gp.connected) : '—');
    setText('mTs', gp ? String(Math.round(gp.timestamp)) : '—');
    setText('mFx', gp && gp.vibrationActuator ? gp.vibrationActuator.effects.join(', ') : '—');
}

function setText(id, s) { const el = document.getElementById(id); if (el) el.textContent = s; }

// ── rumble ──────────────────────────────────────────────────────────────────
//
// playEffect() resolves as soon as the effect is handed to SDL — it does NOT
// wait out the duration — so a ramp has to be sequenced by the app. rampTimer
// exists so a second ramp (or a reset) cancels the first rather than
// interleaving with it.

let rampTimer = null;

export const rumbleLog = [];   // exported for the smoke test

function initRumble() {
    bindSlider('rumStrong', 'rumStrongV', (v) => v.toFixed(2));
    bindSlider('rumWeak',   'rumWeakV',   (v) => v.toFixed(2));
    bindSlider('rumDur',    'rumDurV',    (v) => String(Math.round(v)));

    document.getElementById('rumPlay').addEventListener('click', () => {
        play({
            duration: +document.getElementById('rumDur').value,
            strongMagnitude: +document.getElementById('rumStrong').value,
            weakMagnitude: +document.getElementById('rumWeak').value,
        });
    });
    document.getElementById('rumTick').addEventListener('click', () =>
        play({ duration: 40, strongMagnitude: 0.0, weakMagnitude: 0.45 }));
    document.getElementById('rumThud').addEventListener('click', () =>
        play({ duration: 320, strongMagnitude: 1.0, weakMagnitude: 0.2 }));
    document.getElementById('rumRamp').addEventListener('click', () => ramp());
    document.getElementById('rumStop').addEventListener('click', () => stop());
}

function bindSlider(id, outId, fmtFn) {
    const el = document.getElementById(id), out = document.getElementById(outId);
    const sync = () => { out.textContent = fmtFn(+el.value); };
    el.addEventListener('input', sync);
    sync();
}

/** Fire one dual-rumble effect on the selected pad. Exported for tests. */
export function play(params) {
    const gp = currentPad();
    if (!gp || !gp.vibrationActuator) { setStatus('no pad — nothing to rumble'); return null; }
    rumbleLog.push({ kind: 'play', params });
    setStatus(`playEffect strong=${params.strongMagnitude.toFixed(2)} ` +
              `weak=${params.weakMagnitude.toFixed(2)} ${Math.round(params.duration)}ms`);
    const p = gp.vibrationActuator.playEffect('dual-rumble', params);
    if (p && p.then) p.then((r) => setStatus('→ ' + r));
    return p;
}

/** Twelve chained pulses climbing 0 → 1. Exported for tests. */
export function ramp(steps, stepMs) {
    steps = steps || 12; stepMs = stepMs || 55;
    stopRamp();
    let i = 0;
    rumbleLog.push({ kind: 'ramp', steps });
    const tick = () => {
        if (i >= steps) { rampTimer = null; stop(); return; }
        const m = (i + 1) / steps;
        const gp = currentPad();
        if (gp && gp.vibrationActuator) {
            gp.vibrationActuator.playEffect('dual-rumble',
                { duration: stepMs + 10, strongMagnitude: m, weakMagnitude: m * 0.5 });
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

function setStatus(s) { if (rumStatusEl) rumStatusEl.textContent = s; }

/** Called once per frame from app.js after pollPads(). */
export function tickGamepadPanel() {
    // The slot list is event-driven, but a disconnect that arrives before the
    // panel initialised (or a pad that was already present at startup) would
    // otherwise never show, so reconcile against the poll once per frame.
    let dirty = false;
    for (let i = 0; i < padState.pads.length; i++) {
        const gp = padState.pads[i];
        if (gp && !padState.slots.some((s) => s.index === i && s.connected)) {
            noteSlot(gp, true); dirty = true;
        }
    }
    if (dirty) renderSlotList();
    drawPad();
    updateReadouts();
}
