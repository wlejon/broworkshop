// child.js — the satellite document.
//
// This runs in a *different OS window*, in its own JS realm, with its own DOM
// tree and its own timers. Nothing here shares memory with the parent app: the
// only channel is structured-clone postMessage over bro.window.parent.
//
// Everything on screen is live-rendered here rather than pushed over from the
// parent, which is the point — the parent's capture() thumbnail of this window
// shows an animation the parent never drew. The canvas is driven by this
// realm's own requestAnimationFrame (so it obeys bro.time like any other
// gameplay clock) and the counter by this realm's own setInterval.

const face = document.getElementById('face');
const ctx = face.getContext('2d');
const logEl = document.getElementById('log');
const statsEl = document.getElementById('stats');
const titleEl = document.getElementById('title');
const subEl = document.getElementById('sub');

// State the parent can drive over postMessage. `accent` proves parent → child
// delivery visually: the parent picks a colour and this realm repaints with it.
const state = {
    accent: '#3b82f6',
    label: 'Satellite',
    spin: 1.0,
    ticks: 0,
    frames: 0,
    clicks: 0,
};

const lines = [];
function log(s) {
    lines.push(s);
    if (lines.length > 60) lines.shift();
    logEl.textContent = lines.join('\n');
    logEl.scrollTop = logEl.scrollHeight;
}

function toParent(msg) {
    // bro.window.parent is only present in a secondary window's realm; guard so
    // the same document can also be opened standalone for debugging.
    if (typeof bro !== 'undefined' && bro.window && bro.window.parent)
        bro.window.parent.postMessage(msg);
}

// --- the live face -----------------------------------------------------------
// A sweeping second hand plus an orbiting satellite dot. Both are functions of
// the rAF timestamp, which is the engine's SCALED clock — so when the parent
// pauses bro.time or drags the timescale slider, this window in a different OS
// window slows down in lockstep. That is a nice second proof: one global clock,
// many documents.

function draw(t) {
    const w = face.width, h = face.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, w, h);

    const cx = w * 0.5, cy = h * 0.5;
    const r = Math.min(w, h) * 0.38;
    const ang = (t * 0.001 * state.spin) % (Math.PI * 2);

    // dial
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // swept arc in the parent-chosen accent
    ctx.strokeStyle = state.accent;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + ang);
    ctx.stroke();

    // orbiting dot
    const dx = cx + Math.cos(ang - Math.PI / 2) * r;
    const dy = cy + Math.sin(ang - Math.PI / 2) * r;
    ctx.fillStyle = state.accent;
    ctx.beginPath();
    ctx.arc(dx, dy, 5, 0, Math.PI * 2);
    ctx.fill();

    // tick count, big and centred, so a thumbnail in the parent is readable
    ctx.fillStyle = '#e8edf5';
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

// Own timer, own cadence — the parent never pokes this.
setInterval(() => {
    state.ticks++;
    // Report every fifth tick so the parent's log shows unsolicited child
    // traffic rather than only replies.
    if (state.ticks % 5 === 0) toParent({ type: 'tick', ticks: state.ticks });
}, 1000);

function refreshStats() {
    const win = (typeof bro !== 'undefined' && bro.window) ? bro.window : null;
    const st = win ? win.state : 'n/a';
    statsEl.textContent =
        `size    ${window.innerWidth} x ${window.innerHeight}\n` +
        `state   ${st}   screen ${screen.width}x${screen.height}\n` +
        `frames  ${state.frames}   ticks ${state.ticks}   clicks ${state.clicks}`;
}

// --- parent → child ----------------------------------------------------------

window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || typeof d !== 'object') return;

    if (d.type === 'accent') {
        state.accent = d.color;
        log('parent -> accent ' + d.color);
        toParent({ type: 'ack', of: 'accent', color: d.color });
    } else if (d.type === 'label') {
        state.label = d.text;
        titleEl.textContent = d.text;
        log('parent -> label "' + d.text + '"');
        toParent({ type: 'ack', of: 'label', text: d.text });
    } else if (d.type === 'spin') {
        state.spin = d.value;
        log('parent -> spin ' + d.value.toFixed(2));
        toParent({ type: 'ack', of: 'spin', value: d.value });
    } else if (d.type === 'ping') {
        // Round-trip probe. We echo the parent's stamp untouched; the parent
        // does the arithmetic against its own wall clock.
        toParent({ type: 'pong', stamp: d.stamp, ticks: state.ticks });
    } else if (d.type === 'winctl') {
        // The parent's handle owns geometry, title and focus — but NOT resize
        // limits or window state. Those live on the child realm's own
        // bro.window, scoped to this window. So per-child min/max is done by
        // asking the child to do it to itself, and the reply carries the values
        // read straight back out of SDL.
        applyWinCtl(d);
    } else if (d.type === 'probeWindow') {
        const surf = {};
        for (const k of ['state', 'borderless', 'alwaysOnTop', 'getPosition',
                         'setPosition', 'getMinSize', 'setMinSize', 'getMaxSize',
                         'setMaxSize', 'minimize', 'maximize', 'restore',
                         'moveToDisplay', 'getDisplays', 'parent', 'open'])
            surf[k] = typeof bro.window[k];
        toParent({ type: 'probe', surf });
    } else if (d.type === 'blob') {
        // Transfer-list receipt: report the bytes we actually got, so the
        // parent can prove the payload survived a zero-copy handoff.
        reportBlob(d);
    } else if (d.type === 'hello') {
        subEl.textContent = 'window id ' + d.id + ' · own realm';
        log('parent -> hello (id ' + d.id + ')');
        toParent({ type: 'ready', id: d.id, size: [window.innerWidth, window.innerHeight] });
    }
});

// --- window control from inside this realm -----------------------------------
//
// A secondary window's handle (parent side) covers geometry, title, focus,
// capture and close. Resize LIMITS and window STATE are not on the handle at
// all — they live on this realm's own bro.window, which is scoped to this
// window. So the parent drives them by proxy: it posts a winctl, we apply it
// here, and we send back what SDL reports afterwards rather than what was asked
// for. A limit the platform refused would therefore show up as a mismatch.

function winReadout() {
    const min = bro.window.getMinSize();
    const max = bro.window.getMaxSize();
    return {
        state: bro.window.state,
        borderless: bro.window.borderless,
        alwaysOnTop: bro.window.alwaysOnTop,
        min: [min.width, min.height],
        max: [max.width, max.height],
        size: [window.innerWidth, window.innerHeight],
    };
}

function applyWinCtl(d) {
    switch (d.op) {
        case 'minSize':   bro.window.setMinSize(d.width, d.height); break;
        case 'maxSize':   bro.window.setMaxSize(d.width, d.height); break;
        case 'borderless': bro.window.borderless = !!d.value; break;
        case 'alwaysOnTop': bro.window.alwaysOnTop = !!d.value; break;
        case 'maximize':  bro.window.maximize(); break;
        case 'restore':   bro.window.restore(); break;
    }
    log('winctl ' + d.op);
    toParent({ type: 'winstate', op: d.op, ...winReadout() });
}

// --- transfer-list receipt ---------------------------------------------------
//
// The parent hands us an ArrayBuffer through postMessage's transfer list, which
// DETACHES it on the sending side — the parent's buffer goes to byteLength 0
// while ours arrives with the bytes intact. We checksum what landed here so the
// parent can assert the handoff was zero-copy AND lossless, not just one or the
// other.

function reportBlob(d) {
    const view = new Uint8Array(d.buf);
    let sum = 0;
    for (let i = 0; i < view.length; i++) sum = (sum + view[i] * (i + 1)) >>> 0;
    log(`blob ${view.length} bytes, checksum ${sum}`);
    toParent({
        type: 'blobAck', tag: d.tag,
        bytes: view.length, checksum: sum,
        first: view.length ? view[0] : -1,
        last: view.length ? view[view.length - 1] : -1,
    });
}

// --- child → parent ----------------------------------------------------------

face.addEventListener('click', (ev) => {
    state.clicks++;
    // Input is routed per window: this click was handled entirely by this
    // document, against its own hit test and focus.
    const x = Math.round(ev.offsetX), y = Math.round(ev.offsetY);
    log('click ' + x + ',' + y);
    toParent({ type: 'click', x, y, clicks: state.clicks });
});

document.getElementById('ping').addEventListener('click', () => {
    toParent({ type: 'nudge', ticks: state.ticks });
    log('nudged parent');
});

// window.close() in a secondary window's realm closes THAT window and fires the
// parent handle's 'close' event — it does not quit the app.
document.getElementById('bye').addEventListener('click', () => {
    toParent({ type: 'bye', ticks: state.ticks });
    window.close();
});

window.addEventListener('resize', () => {
    refreshStats();
    toParent({ type: 'resized', width: window.innerWidth, height: window.innerHeight });
});

log('satellite booted');
refreshStats();
