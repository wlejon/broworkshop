// child.js — the satellite document.
//
// This runs in a different OS window, in its own JS realm, with its own DOM
// and its own timers. Nothing is shared with the parent app: the only channel
// is structured-clone postMessage over bro.window.parent.
//
// Everything on screen is rendered here, which is the point: the parent's
// capture() thumbnail shows an animation the parent never drew. The face runs
// on this realm's own rAF (the engine's scaled clock, so pausing bro.time in
// the parent freezes it too: one global clock, many documents) and the counter
// on this realm's own setInterval.

import { readout, logView } from "/lib/kit/ui.js";

const face = document.getElementById('face');
const ctx = face.getContext('2d');
const log = logView('#log', { max: 60, time: false });
const stats = readout('#stats', { size: 'size', state: 'state', counts: 'frames / ticks / clicks' });

// State the parent drives over postMessage; `accent` proves delivery visually.
const state = { accent: '#3b82f6', label: 'Satellite', spin: 1.0, ticks: 0, frames: 0, clicks: 0 };

function toParent(msg) {
    // Guarded so the document can also be opened standalone for debugging.
    if (typeof bro !== 'undefined' && bro.window && bro.window.parent) bro.window.parent.postMessage(msg);
}

// --- the live face: a swept arc, an orbiting dot and the tick count ------------

function draw(t) {
    const w = face.width, h = face.height, cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.38;
    const ang = (t * 0.001 * state.spin) % (Math.PI * 2);
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = state.accent;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + ang); ctx.stroke();
    ctx.fillStyle = state.accent;
    ctx.beginPath(); ctx.arc(cx + Math.cos(ang - Math.PI / 2) * r, cy + Math.sin(ang - Math.PI / 2) * r, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8edf5';                     // big enough to read in the parent's thumbnail
    ctx.font = 'bold 26px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(state.ticks), cx, cy);
    state.frames++;
}

function frame(t) {
    draw(t);
    if (state.frames % 15 === 0) refreshStats();
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Own timer, own cadence. Every fifth tick is reported unprompted, so the
// parent's log shows child-initiated traffic, not only replies.
setInterval(() => {
    state.ticks++;
    if (state.ticks % 5 === 0) toParent({ type: 'tick', ticks: state.ticks });
}, 1000);

function refreshStats() {
    stats.set({
        size: `${window.innerWidth} x ${window.innerHeight}   screen ${screen.width}x${screen.height}`,
        state: typeof bro !== 'undefined' && bro.window ? bro.window.state : 'n/a',
        counts: `${state.frames} / ${state.ticks} / ${state.clicks}`,
    });
}

// --- window control from inside this realm ------------------------------------
// The parent handle covers geometry, title, focus, capture and close. Resize
// limits and window state live on this realm's bro.window, so the parent asks
// and we answer with what we read back afterwards, never an echo.

function winReadout() {
    const min = bro.window.getMinSize(), max = bro.window.getMaxSize();
    return {
        state: bro.window.state, borderless: bro.window.borderless, alwaysOnTop: bro.window.alwaysOnTop,
        min: [min.width, min.height], max: [max.width, max.height],
        size: [window.innerWidth, window.innerHeight],
    };
}

const WINCTL = {
    minSize: (d) => bro.window.setMinSize(d.width, d.height),
    maxSize: (d) => bro.window.setMaxSize(d.width, d.height),
    borderless: (d) => { bro.window.borderless = !!d.value; },
    alwaysOnTop: (d) => { bro.window.alwaysOnTop = !!d.value; },
    maximize: () => bro.window.maximize(),
    restore: () => bro.window.restore(),
};

// The transfer-list receipt: checksum what landed so the parent can prove the
// handoff was zero-copy (its buffer is empty) AND lossless (sums agree).
function reportBlob(d) {
    const view = new Uint8Array(d.buf);
    let sum = 0;
    for (let i = 0; i < view.length; i++) sum = (sum + view[i] * (i + 1)) >>> 0;
    log.add(`blob ${view.length} bytes, checksum ${sum}`);
    toParent({
        type: 'blobAck', tag: d.tag, bytes: view.length, checksum: sum,
        first: view.length ? view[0] : -1, last: view.length ? view[view.length - 1] : -1,
    });
}

// --- parent -> child -----------------------------------------------------------

const HANDLERS = {
    accent(d) {
        state.accent = d.color;
        log.add('parent -> accent ' + d.color);
        toParent({ type: 'ack', of: 'accent', color: d.color });
    },
    label(d) {
        state.label = d.text;
        document.getElementById('title').textContent = d.text;
        log.add(`parent -> label "${d.text}"`);
        toParent({ type: 'ack', of: 'label', text: d.text });
    },
    spin(d) {
        state.spin = d.value;
        log.add('parent -> spin ' + d.value.toFixed(2));
        toParent({ type: 'ack', of: 'spin', value: d.value });
    },
    // The stamp is echoed untouched; the parent times it on its own wall clock.
    ping(d) { toParent({ type: 'pong', stamp: d.stamp, ticks: state.ticks }); },
    winctl(d) {
        if (WINCTL[d.op]) WINCTL[d.op](d);
        log.add('winctl ' + d.op);
        toParent({ type: 'winstate', op: d.op, ...winReadout() });
    },
    probeWindow() {
        const surf = {};
        for (const k of ['state', 'borderless', 'alwaysOnTop', 'getPosition', 'setPosition', 'getMinSize',
                         'setMinSize', 'getMaxSize', 'setMaxSize', 'minimize', 'maximize', 'restore',
                         'moveToDisplay', 'getDisplays', 'parent', 'open']) surf[k] = typeof bro.window[k];
        toParent({ type: 'probe', surf });
    },
    blob: reportBlob,
    hello(d) {
        document.getElementById('sub').textContent = 'window id ' + d.id + ' · own realm';
        log.add(`parent -> hello (id ${d.id})`);
        toParent({ type: 'ready', id: d.id, size: [window.innerWidth, window.innerHeight] });
    },
};

window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (d && typeof d === 'object' && HANDLERS[d.type]) HANDLERS[d.type](d);
});

// --- child -> parent -----------------------------------------------------------

// Input is routed per window: this click is hit-tested against this document.
face.addEventListener('click', (ev) => {
    state.clicks++;
    const x = Math.round(ev.offsetX), y = Math.round(ev.offsetY);
    log.add(`click ${x},${y}`);
    toParent({ type: 'click', x, y, clicks: state.clicks });
});

document.getElementById('ping').addEventListener('click', () => {
    toParent({ type: 'nudge', ticks: state.ticks });
    log.add('nudged parent');
});

// window.close() in a secondary realm closes THAT window and fires the parent
// handle's 'close'; it does not quit the app.
document.getElementById('bye').addEventListener('click', () => {
    toParent({ type: 'bye', ticks: state.ticks });
    window.close();
});

window.addEventListener('resize', () => {
    refreshStats();
    toParent({ type: 'resized', width: window.innerWidth, height: window.innerHeight });
});

log.add('satellite booted');
refreshStats();
