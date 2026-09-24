// windows.js — the secondary-window panel: open, track, drive and observe real
// OS windows hosting the `child/` app.
//
// Two things make this more than "open a popup":
//
//   capture()    returns the child window's actual framebuffer. The parent
//                never draws that animation; the child does, in its own realm,
//                on its own timers. The row thumbnail is therefore direct
//                proof that a second document is recorded and rendered.
//
//   postMessage  a structured clone across a realm boundary, delivered at the
//                engine's idle drain. Children are delivered before the parent,
//                so a child replying from inside its handler completes the
//                round trip within the SAME drain (sub-frame latency).
//
// Rows are built once per child and mutated in place: rebuilding on every
// geometry poll would wipe whatever the user is typing into a row's fields.

import { h, logView } from "/lib/kit/index.js";

export const ACCENTS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308',
                        '#a855f7', '#ec4899', '#14b8a6', '#f97316'];

/** Live child records, exactly what the panel believes (tests assert on it). */
export const children = [];

export const msgStats = { sent: 0, received: 0, lastPingMs: null, acks: 0, lastAck: null };

let log = null;               // kit logView over #msgLog, made in bindWindowPanel
const observers = [];         // other panels watching child traffic (transfer.js)
const pendingPings = new Map();
let opened = 0;

export function logSys(text) { if (log) log.add(text, 'sys'); }
function logIn(text) { if (log) log.add(text, 'in'); }

/** Watch every message a child posts: fn(rec, data). Keeps imports one-way. */
export function observeChildMessages(fn) { observers.push(fn); return fn; }

function refreshCounts() {
    document.getElementById('msgCounts').textContent = `${msgStats.sent} out / ${msgStats.received} in`;
    document.getElementById('winCount').textContent = String(children.length);
    document.getElementById('winEmpty').hidden = children.length > 0;
}

// --- opening -----------------------------------------------------------------

function readNum(id, dflt) {
    const v = parseInt(document.getElementById(id).value, 10);
    return Number.isFinite(v) ? v : dflt;
}

/**
 * Open one satellite window. Size defaults to the panel's spinners; the rest
 * (min size, resizability) comes from child/bro.json: explicit open() options
 * beat the child's manifest, which beats the engine defaults.
 */
export function openChild(opts) {
    const o = opts || {};
    const slot = opened++;
    const title = 'Satellite ' + (slot + 1);
    const win = bro.window.open('child', {
        width: o.width || readNum('newW', 360),
        height: o.height || readNum('newH', 420),
        title,
        x: 120 + slot * 36,          // cascade so several at once stay visible
        y: 120 + slot * 36,
    });

    const rec = {
        win, id: win.id, title,
        accent: ACCENTS[slot % ACCENTS.length],
        loaded: false, closed: false,
        ticks: 0, clicks: 0, acks: 0, received: 0,
        lastAck: null, lastClick: undefined, lastCapture: null, winState: null,
        borderless: false, onTop: false,
    };
    children.push(rec);
    buildRow(rec);
    refreshCounts();

    win.addEventListener('load', () => {
        rec.loaded = true;
        logSys(`window ${rec.id} loaded`);
        // First contact: who it is, then the accent this row owns.
        post(rec, { type: 'hello', id: rec.id });
        post(rec, { type: 'accent', color: rec.accent });
        updateRow(rec);
    });
    win.addEventListener('message', (ev) => {
        msgStats.received++;
        rec.received++;
        onChildMessage(rec, ev.data);
        refreshCounts();
    });
    win.addEventListener('resize', (ev) => {
        logSys(`window ${rec.id} resized to ${ev.width}x${ev.height}`);
        updateRow(rec);
    });
    win.addEventListener('close', () => {
        rec.closed = true;
        const i = children.indexOf(rec);
        if (i >= 0) children.splice(i, 1);
        if (rec.row) rec.row.remove();
        logSys(`window ${rec.id} closed`);
        refreshCounts();
    });
    return rec;
}

export function closeAll() {
    for (const rec of children.slice()) rec.win.close();   // 'close' splices
}

// --- messaging ---------------------------------------------------------------

function describe(msg) {
    const show = (v) => (ArrayBuffer.isView(v) ? `${v.constructor.name}(${v.length})` : `${v}`);
    const bits = Object.keys(msg).filter((k) => k !== 'type').slice(0, 3).map((k) => `${k}=${show(msg[k])}`);
    return msg.type + (bits.length ? ' ' + bits.join(' ') : '');
}

/**
 * Post to one child. `transfer` is postMessage's transfer list: ArrayBuffers
 * named there are handed over rather than copied (see transfer.js).
 */
export function post(rec, msg, transfer) {
    msgStats.sent++;
    if (transfer) rec.win.postMessage(msg, transfer);
    else rec.win.postMessage(msg);
    if (log) log.add(`-> ${rec.id} ${describe(msg)}`, 'out');
    refreshCounts();
    return msg;
}

export function broadcast(msg) {
    for (const rec of children) post(rec, msg);
    return children.length;
}

/**
 * Drive one of the child's own window properties by proxy. Resize limits and
 * window state are not on the parent handle; they live on the child realm's
 * bro.window. The child applies the op and answers with what it reads back,
 * so rec.winState holds measured values, never an echo.
 */
export function winctl(rec, op, extra) {
    return post(rec, Object.assign({ type: 'winctl', op }, extra || {}));
}

/** Ping every child; the round trip is timed on the WALL clock (bro.time never touches Date.now). */
export function pingAll() {
    const stamp = Date.now();
    pendingPings.set(stamp, { replies: 0, expected: children.length });
    broadcast({ type: 'ping', stamp });
    return stamp;
}

const NEXT_ACCENT = (c) => ACCENTS[(ACCENTS.indexOf(c) + 1) % ACCENTS.length];

function onChildMessage(rec, d) {
    if (!d || typeof d !== 'object') return;
    for (const fn of observers) fn(rec, d);

    switch (d.type) {
        case 'winstate':
            rec.winState = d;
            logIn(`<- ${rec.id} ${d.op}: min ${d.min[0]}x${d.min[1]}  max ${d.max[0]}x${d.max[1]}  state ${d.state}`);
            updateRow(rec);
            break;
        case 'blobAck':
            break;                                  // transfer.js logs it
        case 'pong': {
            const ms = Date.now() - d.stamp;
            msgStats.lastPingMs = ms;
            const p = pendingPings.get(d.stamp);
            if (p && ++p.replies >= p.expected) pendingPings.delete(d.stamp);
            document.getElementById('pingV').textContent = `latency ${ms} ms`;
            logIn(`<- ${rec.id} pong (${ms} ms, ticks ${d.ticks})`);
            break;
        }
        case 'ready':
            logIn(`<- ${rec.id} ready at ${d.size[0]}x${d.size[1]}`);
            break;
        case 'ack':
            // The ack echoes the payload the child received: proof the clone
            // arrived intact, not merely that something arrived.
            rec.acks++;
            rec.lastAck = d;
            msgStats.acks++;
            msgStats.lastAck = d;
            logIn(`<- ${rec.id} ack ${d.of}`);
            break;
        case 'tick':
            rec.ticks = d.ticks;
            logIn(`<- ${rec.id} tick ${d.ticks}`);
            updateRow(rec);
            break;
        case 'click':
            rec.clicks = d.clicks;
            rec.lastClick = { x: d.x, y: d.y };
            logIn(`<- ${rec.id} click at ${d.x},${d.y}`);
            updateRow(rec);
            break;
        case 'nudge':
            // Answer the child's own button with a fresh accent: the parent
            // driving the child's content, triggered from the child.
            logIn(`<- ${rec.id} nudge (ticks ${d.ticks})`);
            rec.accent = NEXT_ACCENT(rec.accent);
            post(rec, { type: 'accent', color: rec.accent });
            break;
        case 'resized':
            logIn(`<- ${rec.id} resized ${d.width}x${d.height}`);
            break;
        case 'bye':
            logIn(`<- ${rec.id} self-closing`);
            break;
        default:
            logIn(`<- ${rec.id} ${describe(d)}`);
    }
}

// --- capture -----------------------------------------------------------------

const scratch = document.createElement('canvas');
const sctx = scratch.getContext('2d');

/**
 * Grab the child's pixels into its row thumbnail. Returns the raw
 * { width, height, data } record (null once the window is gone).
 */
export function captureChild(rec) {
    const shot = rec.win.capture();
    if (!shot) return null;
    rec.lastCapture = { width: shot.width, height: shot.height, bytes: shot.data.length };

    // capture() is a plain record; rehydrate an ImageData for putImageData.
    scratch.width = shot.width;
    scratch.height = shot.height;
    const img = sctx.createImageData(shot.width, shot.height);
    img.data.set(shot.data);
    sctx.putImageData(img, 0, 0);

    const t = rec.thumb, tc = t.getContext('2d');
    tc.clearRect(0, 0, t.width, t.height);
    const s = Math.min(t.width / shot.width, t.height / shot.height);   // letterbox
    const dw = shot.width * s, dh = shot.height * s;
    tc.drawImage(scratch, (t.width - dw) / 2, (t.height - dh) / 2, dw, dh);
    return shot;
}

export function captureAll() {
    let n = 0;
    for (const rec of children) if (captureChild(rec)) n++;
    return n;
}

// --- per-child row -----------------------------------------------------------

const numIn = (value) => h('input', { type: 'number', value: String(value) });
const btn = (label, onclick, title) => h('button.small', { onclick, title }, label);

function buildRow(rec) {
    const title = h('input', { type: 'text', value: rec.title });
    const w = numIn(360), hh = numIn(420), x = numIn(120), y = numIn(120);
    const mnW = numIn(260), mnH = numIn(300), mxW = numIn(900), mxH = numIn(700);

    rec.thumb = h('canvas.thumb', { width: 84, height: 98 });
    rec.headEl = h('div.head');
    rec.geoEl = h('div.geo');

    rec.row = h('div.win-row', null, rec.thumb, h('div.k-col.k-grow', null,
        rec.headEl, rec.geoEl,
        h('div.k-row.ctl', null,
            title, btn('title', () => {
                rec.title = title.value;
                rec.win.setTitle(rec.title);
                post(rec, { type: 'label', text: rec.title });
                updateRow(rec);
            }),
            w, hh, btn('resize', () => { rec.win.setSize(+w.value | 0, +hh.value | 0); updateRow(rec); }),
            x, y, btn('move', () => { rec.win.setPosition(+x.value | 0, +y.value | 0); updateRow(rec); }),
            btn('capture', () => captureChild(rec)),
            btn('focus', () => rec.win.focus()),
            btn('close', () => rec.win.close())),
        // The surface NOT on the parent handle, driven through the child's own
        // bro.window (see winctl).
        h('div.k-row.ctl', null,
            h('span.dim', null, 'in-child:'),
            mnW, mnH, btn('min size', () => winctl(rec, 'minSize', { width: +mnW.value | 0, height: +mnH.value | 0 })),
            mxW, mxH, btn('max size', () => winctl(rec, 'maxSize', { width: +mxW.value | 0, height: +mxH.value | 0 })),
            btn('clear', () => {
                winctl(rec, 'minSize', { width: 0, height: 0 });
                winctl(rec, 'maxSize', { width: 0, height: 0 });
            }),
            btn('borderless', () => { rec.borderless = !rec.borderless; winctl(rec, 'borderless', { value: rec.borderless }); }),
            btn('on top', () => { rec.onTop = !rec.onTop; winctl(rec, 'alwaysOnTop', { value: rec.onTop }); }),
            btn('maximize', () => winctl(rec, 'maximize')),
            btn('restore', () => winctl(rec, 'restore')))));

    document.getElementById('winList').appendChild(rec.row);
    updateRow(rec);
}

function updateRow(rec) {
    if (!rec.headEl || rec.closed) return;
    rec.headEl.textContent = `#${rec.id}  ${rec.title}${rec.loaded ? '' : '  (loading)'}`;
    const size = rec.win.getSize(), pos = rec.win.getPosition();
    const cap = rec.lastCapture ? `cap ${rec.lastCapture.width}x${rec.lastCapture.height}` : 'cap —';
    // The second line appears only once the child has reported its own state.
    const ws = rec.winState;
    rec.geoEl.textContent =
        `${size.width}x${size.height} @ ${pos.x},${pos.y}   ticks ${rec.ticks}  clicks ${rec.clicks}  ` +
        `msgs ${rec.received}  ${cap}` +
        (ws ? `\nchild reports: min ${ws.min[0]}x${ws.min[1]}  max ${ws.max[0]}x${ws.max[1]}  ${ws.state}` +
              (ws.borderless ? '  borderless' : '') + (ws.alwaysOnTop ? '  on-top' : '') : '');
}

/** Poll geometry for every row: the user can drag windows and there is no move event. */
export function refreshRows() {
    for (const rec of children) updateRow(rec);
}

// --- panel wiring ------------------------------------------------------------

export function bindWindowPanel() {
    log = logView('#msgLog', { max: 120, time: false });

    document.getElementById('openWin').addEventListener('click', () => openChild());
    document.getElementById('openThree').addEventListener('click', () => { for (let i = 0; i < 3; i++) openChild(); });
    document.getElementById('closeAll').addEventListener('click', closeAll);

    // Accent swatches repaint every open satellite: the clearest visible
    // parent -> child proof.
    const sw = document.getElementById('swatches');
    for (const c of ACCENTS) {
        sw.appendChild(h('button.small.swatch', {
            title: c, style: { background: c, borderColor: c },
            onclick: () => { for (const rec of children) { rec.accent = c; post(rec, { type: 'accent', color: c }); } },
        }));
    }

    document.getElementById('sendLabel').addEventListener('click', () => {
        const text = document.getElementById('labelInput').value;
        for (const rec of children) { rec.title = text; post(rec, { type: 'label', text }); }
    });

    const spin = document.getElementById('spin');
    spin.addEventListener('input', () => {
        const v = spin.value / 100;
        document.getElementById('spinV').textContent = v.toFixed(2) + '×';
        broadcast({ type: 'spin', value: v });
    });

    document.getElementById('ping').addEventListener('click', pingAll);

    refreshCounts();
    logSys('ready — open a window to begin');
}
