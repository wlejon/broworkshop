// windows.js — the secondary-window panel: open, track, drive and observe real
// OS windows hosting the `child/` app.
//
// Two things are worth calling out, because they are what make this API more
// than "open a popup":
//
//   capture()  returns the child window's actual framebuffer as ImageData. The
//              parent never draws that animation — the child does, in its own
//              realm, on its own timers. Blitting it into a thumbnail here is
//              therefore direct proof that a second document is really being
//              recorded and rendered, not faked.
//
//   postMessage is a structured clone across a realm boundary, delivered at the
//              engine's idle drain. Children are delivered first and the parent
//              second, so a child that replies from inside its own handler
//              completes the round trip within the SAME drain. That is why the
//              latency readout below can show sub-frame numbers.
//
// Rows are built once per child and then mutated in place. Rebuilding the list
// on every geometry poll would wipe whatever the user was typing into a row's
// title or size field.

const listEl = document.getElementById('winList');
const emptyEl = document.getElementById('winEmpty');
const logEl = document.getElementById('msgLog');
const countsEl = document.getElementById('msgCounts');
const pingEl = document.getElementById('pingV');
const winCountEl = document.getElementById('winCount');

const ACCENTS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308',
                 '#a855f7', '#ec4899', '#14b8a6', '#f97316'];

// Live child records. Exported so the smoke test can assert against exactly
// what the panel believes, rather than re-deriving state.
export const children = [];

export const msgStats = {
    sent: 0, received: 0, lastPingMs: null, acks: 0, lastAck: null,
};

const logLines = [];

function log(kind, text) {
    logLines.push({ kind, text });
    if (logLines.length > 120) logLines.shift();
    // One block element per line rather than inline spans with newlines: the
    // direction stays colour-coded and each entry gets its own line without
    // depending on white-space handling inside nested inlines.
    logEl.textContent = '';
    for (const l of logLines) {
        const s = document.createElement('div');
        s.className = l.kind;
        s.textContent = l.text;
        logEl.appendChild(s);
    }
    logEl.scrollTop = logEl.scrollHeight;
}

export function logSys(text) { log('sys', text); }

function refreshCounts() {
    countsEl.textContent = `${msgStats.sent} out / ${msgStats.received} in`;
    winCountEl.textContent = String(children.length);
    emptyEl.style.display = children.length ? 'none' : 'block';
}

// --- opening -----------------------------------------------------------------

let opened = 0;

/**
 * Open one satellite window. Size defaults to the panel's spinners; everything
 * else (title, min size, resizability) comes from child/bro.json, which is the
 * documented precedence: explicit open() options > the child's manifest >
 * engine defaults.
 */
export function openChild(opts) {
    opts = opts || {};
    const w = opts.width || readNum('newW', 360);
    const h = opts.height || readNum('newH', 420);

    // Cascade new windows down-right so several at once are all visible.
    const slot = opened++;
    const win = bro.window.open('child', {
        width: w,
        height: h,
        title: 'Satellite ' + (slot + 1),
        x: 120 + slot * 36,
        y: 120 + slot * 36,
    });

    const rec = {
        win,
        id: win.id,
        title: 'Satellite ' + (slot + 1),
        accent: ACCENTS[slot % ACCENTS.length],
        loaded: false,
        closed: false,
        ticks: 0,
        clicks: 0,
        acks: 0,
        received: 0,
        lastCapture: null,
        row: null,
    };
    children.push(rec);
    buildRow(rec);
    refreshCounts();

    win.addEventListener('load', () => {
        rec.loaded = true;
        log('sys', `window ${rec.id} loaded`);
        // First contact: tell the child who it is, then push the accent that
        // this row owns so each window renders a distinguishable colour.
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
        log('sys', `window ${rec.id} resized to ${ev.width}x${ev.height}`);
        updateRow(rec);
    });

    win.addEventListener('close', () => {
        rec.closed = true;
        const i = children.indexOf(rec);
        if (i >= 0) children.splice(i, 1);
        if (rec.row && rec.row.parentNode) rec.row.parentNode.removeChild(rec.row);
        log('sys', `window ${rec.id} closed`);
        refreshCounts();
    });

    return rec;
}

export function closeAll() {
    // Iterate a copy: the 'close' handler splices `children` as it fires.
    for (const rec of children.slice()) rec.win.close();
}

// --- messaging ---------------------------------------------------------------

/**
 * Post to one child. `transfer` is postMessage's optional transfer list —
 * ArrayBuffers named there are handed over rather than copied, and are DETACHED
 * on this side once the call returns. See transfer.js.
 */
export function post(rec, msg, transfer) {
    msgStats.sent++;
    if (transfer) rec.win.postMessage(msg, transfer);
    else rec.win.postMessage(msg);
    log('out', `-> ${rec.id} ${describe(msg)}`);
    refreshCounts();
    return msg;
}

// Other panels (transfer.js) need to see child traffic without windows.js
// having to import them back — which would be a cycle. A plain observer list
// keeps the dependency one-way.
const observers = [];
export function observeChildMessages(fn) { observers.push(fn); return fn; }

/**
 * Drive one of the child's own window properties BY PROXY.
 *
 * The parent-side handle covers geometry, title, focus, capture and close — but
 * resize limits and window state are not on it at all. Those live on the child
 * realm's own `bro.window`, scoped to that window. So the parent asks and the
 * child applies, and the child answers with what SDL reports afterwards rather
 * than with an echo of the request. `rec.winState` therefore holds measured
 * values: a limit the platform refused would read back wrong here.
 */
export function winctl(rec, op, extra) {
    return post(rec, Object.assign({ type: 'winctl', op }, extra || {}));
}

export function broadcast(msg) {
    for (const rec of children) post(rec, msg);
    return children.length;
}

/**
 * Ping every child and measure the round trip against the WALL clock
 * (Date.now(), which bro.time never touches) so the number stays honest even
 * at 0.1x timescale.
 */
export function pingAll() {
    const stamp = Date.now();
    pendingPings.set(stamp, { sent: stamp, replies: 0, expected: children.length });
    broadcast({ type: 'ping', stamp });
    return stamp;
}

const pendingPings = new Map();

function onChildMessage(rec, d) {
    if (!d || typeof d !== 'object') return;
    for (const fn of observers) fn(rec, d);

    switch (d.type) {
        case 'winstate':
            // The child applied a window op to itself and read the result back
            // out of SDL. Store what it actually got, not what we asked for.
            rec.winState = d;
            log('in', `<- ${rec.id} ${d.op}: min ${d.min[0]}x${d.min[1]}  ` +
                      `max ${d.max[0]}x${d.max[1]}  state ${d.state}`);
            updateRow(rec);
            break;
        case 'blobAck':
            // transfer.js logs this one in its own panel.
            break;
        case 'pong': {
            const p = pendingPings.get(d.stamp);
            const ms = Date.now() - d.stamp;
            msgStats.lastPingMs = ms;
            if (p) {
                p.replies++;
                if (p.replies >= p.expected) pendingPings.delete(d.stamp);
            }
            pingEl.textContent = `latency ${ms} ms`;
            log('in', `<- ${rec.id} pong (${ms} ms, ticks ${d.ticks})`);
            break;
        }
        case 'ready':
            log('in', `<- ${rec.id} ready at ${d.size[0]}x${d.size[1]}`);
            break;
        case 'ack':
            // Keep the whole ack: it echoes the payload the child actually
            // received, which is the only way this side can prove the clone
            // arrived intact rather than merely arrived.
            rec.acks++;
            rec.lastAck = d;
            msgStats.acks++;
            msgStats.lastAck = d;
            log('in', `<- ${rec.id} ack ${d.of}`);
            break;
        case 'tick':
            rec.ticks = d.ticks;
            log('in', `<- ${rec.id} tick ${d.ticks}`);
            updateRow(rec);
            break;
        case 'click':
            rec.clicks = d.clicks;
            rec.lastClick = { x: d.x, y: d.y };
            log('in', `<- ${rec.id} click at ${d.x},${d.y}`);
            updateRow(rec);
            break;
        case 'nudge':
            log('in', `<- ${rec.id} nudge (ticks ${d.ticks})`);
            // Answer a nudge with a fresh accent, so the user can see the
            // parent driving the child's content from the child's own button.
            rec.accent = ACCENTS[(ACCENTS.indexOf(rec.accent) + 1) % ACCENTS.length];
            post(rec, { type: 'accent', color: rec.accent });
            break;
        case 'resized':
            log('in', `<- ${rec.id} resized ${d.width}x${d.height}`);
            break;
        case 'bye':
            log('in', `<- ${rec.id} self-closing`);
            break;
        default:
            log('in', `<- ${rec.id} ${describe(d)}`);
    }
}

function describe(msg) {
    const keys = Object.keys(msg).filter((k) => k !== 'type');
    const bits = keys.slice(0, 3).map((k) => `${k}=${msg[k]}`);
    return msg.type + (bits.length ? ' ' + bits.join(' ') : '');
}

// --- capture -----------------------------------------------------------------

// One scratch canvas, reused: capture() hands back window-sized ImageData and
// we only ever want a thumbnail of it.
const scratch = document.createElement('canvas');
const sctx = scratch.getContext('2d');

/**
 * Grab the child's pixels and blit them into its row's thumbnail.
 * Returns the raw ImageData-shaped object (or null if the window is gone), so
 * the smoke test can assert on real bytes.
 */
export function captureChild(rec) {
    const shot = rec.win.capture();
    if (!shot) return null;
    rec.lastCapture = { width: shot.width, height: shot.height, bytes: shot.data.length };

    scratch.width = shot.width;
    scratch.height = shot.height;
    // capture() returns a plain {width,height,data} record, so rehydrate a real
    // ImageData before putImageData will take it.
    const img = sctx.createImageData(shot.width, shot.height);
    img.data.set(shot.data);
    sctx.putImageData(img, 0, 0);

    const t = rec.thumb;
    if (t) {
        const tc = t.getContext('2d');
        tc.clearRect(0, 0, t.width, t.height);
        // Letterbox rather than stretch: window aspect ratios vary once the
        // user starts resizing rows.
        const s = Math.min(t.width / shot.width, t.height / shot.height);
        const dw = shot.width * s, dh = shot.height * s;
        tc.drawImage(scratch, (t.width - dw) / 2, (t.height - dh) / 2, dw, dh);
    }
    return shot;
}

export function captureAll() {
    let n = 0;
    for (const rec of children) if (captureChild(rec)) n++;
    return n;
}

// --- per-child row -----------------------------------------------------------

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

function buildRow(rec) {
    const row = el('div', 'item');

    const thumb = document.createElement('canvas');
    thumb.className = 'thumb';
    thumb.width = 84; thumb.height = 98;
    row.appendChild(thumb);
    rec.thumb = thumb;

    const body = el('div', 'body');
    const head = el('div', 'head');
    body.appendChild(head);
    const geo = el('div', 'geo');
    body.appendChild(geo);

    const ctl = el('div', 'ctl');

    const titleIn = document.createElement('input');
    titleIn.type = 'text';
    titleIn.value = rec.title;
    const setTitleBtn = el('button', 'tiny', 'title');
    setTitleBtn.addEventListener('click', () => {
        rec.title = titleIn.value;
        rec.win.setTitle(rec.title);
        post(rec, { type: 'label', text: rec.title });
        updateRow(rec);
    });

    const wIn = document.createElement('input'); wIn.type = 'number'; wIn.value = 360;
    const hIn = document.createElement('input'); hIn.type = 'number'; hIn.value = 420;
    const sizeBtn = el('button', 'tiny', 'resize');
    sizeBtn.addEventListener('click', () => {
        rec.win.setSize(+wIn.value | 0, +hIn.value | 0);
        updateRow(rec);
    });

    const xIn = document.createElement('input'); xIn.type = 'number'; xIn.value = 120;
    const yIn = document.createElement('input'); yIn.type = 'number'; yIn.value = 120;
    const moveBtn = el('button', 'tiny', 'move');
    moveBtn.addEventListener('click', () => {
        rec.win.setPosition(+xIn.value | 0, +yIn.value | 0);
        updateRow(rec);
    });

    const capBtn = el('button', 'tiny', 'capture');
    capBtn.addEventListener('click', () => captureChild(rec));

    const focusBtn = el('button', 'tiny', 'focus');
    focusBtn.addEventListener('click', () => rec.win.focus());

    const closeBtn = el('button', 'tiny', 'close');
    closeBtn.addEventListener('click', () => rec.win.close());

    ctl.appendChild(titleIn); ctl.appendChild(setTitleBtn);
    ctl.appendChild(wIn); ctl.appendChild(hIn); ctl.appendChild(sizeBtn);
    ctl.appendChild(xIn); ctl.appendChild(yIn); ctl.appendChild(moveBtn);
    ctl.appendChild(capBtn); ctl.appendChild(focusBtn); ctl.appendChild(closeBtn);
    body.appendChild(ctl);

    // Second control row: the surface that is NOT on the parent handle and has
    // to be driven through the child's own bro.window (see winctl).
    const ctl2 = el('div', 'ctl');
    const tag = el('span', 'sublbl', 'in-child:');
    ctl2.appendChild(tag);

    const mnW = document.createElement('input'); mnW.type = 'number'; mnW.value = 260;
    const mnH = document.createElement('input'); mnH.type = 'number'; mnH.value = 300;
    const minBtn = el('button', 'tiny', 'min size');
    minBtn.addEventListener('click', () =>
        winctl(rec, 'minSize', { width: +mnW.value | 0, height: +mnH.value | 0 }));

    const mxW = document.createElement('input'); mxW.type = 'number'; mxW.value = 900;
    const mxH = document.createElement('input'); mxH.type = 'number'; mxH.value = 700;
    const maxBtn = el('button', 'tiny', 'max size');
    maxBtn.addEventListener('click', () =>
        winctl(rec, 'maxSize', { width: +mxW.value | 0, height: +mxH.value | 0 }));

    const clearLim = el('button', 'tiny', 'clear');
    clearLim.addEventListener('click', () => {
        winctl(rec, 'minSize', { width: 0, height: 0 });
        winctl(rec, 'maxSize', { width: 0, height: 0 });
    });

    const blBtn = el('button', 'tiny', 'borderless');
    blBtn.addEventListener('click', () => {
        rec.borderless = !rec.borderless;
        winctl(rec, 'borderless', { value: rec.borderless });
    });
    const topBtn = el('button', 'tiny', 'on top');
    topBtn.addEventListener('click', () => {
        rec.onTop = !rec.onTop;
        winctl(rec, 'alwaysOnTop', { value: rec.onTop });
    });
    const maxiBtn = el('button', 'tiny', 'maximize');
    maxiBtn.addEventListener('click', () => winctl(rec, 'maximize'));
    const restBtn = el('button', 'tiny', 'restore');
    restBtn.addEventListener('click', () => winctl(rec, 'restore'));

    ctl2.appendChild(mnW); ctl2.appendChild(mnH); ctl2.appendChild(minBtn);
    ctl2.appendChild(mxW); ctl2.appendChild(mxH); ctl2.appendChild(maxBtn);
    ctl2.appendChild(clearLim);
    ctl2.appendChild(blBtn); ctl2.appendChild(topBtn);
    ctl2.appendChild(maxiBtn); ctl2.appendChild(restBtn);
    body.appendChild(ctl2);

    row.appendChild(body);
    listEl.appendChild(row);
    rec.row = row;
    rec.headEl = head;
    rec.geoEl = geo;
    updateRow(rec);
}

function updateRow(rec) {
    if (!rec.headEl) return;
    rec.headEl.textContent = '';
    const id = el('span', 'id', `#${rec.id}`);
    rec.headEl.appendChild(id);
    rec.headEl.appendChild(document.createTextNode(
        `  ${rec.title}  ${rec.loaded ? '' : '(loading)'}`));

    const size = rec.win.getSize();
    const pos = rec.win.getPosition();
    const cap = rec.lastCapture
        ? `cap ${rec.lastCapture.width}x${rec.lastCapture.height}`
        : 'cap —';
    // The second line only appears once the child has actually reported its own
    // window state back, so an absent line means "never asked", not "unknown".
    const ws = rec.winState;
    rec.geoEl.textContent =
        `${size.width}x${size.height} @ ${pos.x},${pos.y}   ` +
        `ticks ${rec.ticks}  clicks ${rec.clicks}  msgs ${rec.received}  ${cap}` +
        (ws ? `\nchild reports: min ${ws.min[0]}x${ws.min[1]}  ` +
              `max ${ws.max[0]}x${ws.max[1]}  ${ws.state}` +
              `${ws.borderless ? '  borderless' : ''}` +
              `${ws.alwaysOnTop ? '  on-top' : ''}`
            : '');
}

/** Poll geometry for every live row — windows can be dragged and resized by
 *  the user, and there is no event for a move. */
export function refreshRows() {
    for (const rec of children) updateRow(rec);
}

function readNum(id, dflt) {
    const v = parseInt(document.getElementById(id).value, 10);
    return Number.isFinite(v) ? v : dflt;
}

// --- panel wiring ------------------------------------------------------------

export function bindWindowPanel() {
    document.getElementById('openWin').addEventListener('click', () => openChild());
    document.getElementById('openThree').addEventListener('click', () => {
        for (let i = 0; i < 3; i++) openChild();
    });
    document.getElementById('closeAll').addEventListener('click', closeAll);

    // Accent swatches: parent drives child content. Clicking one repaints every
    // open satellite, which is the clearest visible parent -> child proof.
    const sw = document.getElementById('swatches');
    for (const c of ACCENTS) {
        const b = document.createElement('button');
        b.className = 'tiny';
        b.style.background = c;
        b.style.borderColor = c;
        b.textContent = ' ';
        b.title = c;
        b.addEventListener('click', () => {
            for (const rec of children) { rec.accent = c; post(rec, { type: 'accent', color: c }); }
        });
        sw.appendChild(b);
    }

    document.getElementById('sendLabel').addEventListener('click', () => {
        const text = document.getElementById('labelInput').value;
        for (const rec of children) { rec.title = text; post(rec, { type: 'label', text }); }
    });

    const spin = document.getElementById('spin');
    const spinV = document.getElementById('spinV');
    spin.addEventListener('input', () => {
        const v = spin.value / 100;
        spinV.textContent = v.toFixed(2) + '×';
        broadcast({ type: 'spin', value: v });
    });

    document.getElementById('ping').addEventListener('click', pingAll);

    refreshCounts();
    log('sys', 'ready — open a window to begin');
}
