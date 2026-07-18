// touch.js — the pointer panel: multi-touch tracking, per-pointer capture, and
// the compat-mouse relationship.
//
// Three things are on show here, and each one is a claim that only a
// MULTI-pointer surface can make:
//
//  1. The visualiser tracks every live contact independently, keyed by
//     pointerId. bro mints touch pointerIds monotonically from 2 (the mouse
//     permanently owns 1) and never reuses a lifted finger's id, so a Map keyed
//     on pointerId is the whole bookkeeping — no slot recycling, no ambiguity
//     about which finger a move belongs to. Each contact gets its own colour
//     and its own trail, so two simultaneous drags draw two separate strokes.
//
//  2. Capture is PER POINTER. setPointerCapture(id) reroutes only that
//     pointer's stream; the visualiser captures every finger it sees, which is
//     what keeps a trail drawing after the finger slides off the canvas. The
//     capture demo below isolates the same mechanism to one element so you can
//     switch it off and watch the drag break at the border.
//
//  3. Touch synthesizes classic mouse events, but only for a clean tap of the
//     primary finger, and only AFTER touchend. The event log interleaves both
//     streams in arrival order, which is the only way to see that a tap is
//     really pointerdown → touchstart → pointerup → touchend → mousedown →
//     mouseup → click, and that a DRAG produces no mouse events at all.

const W = 560, H = 300;

// One colour per concurrent contact. Indexed by arrival order rather than by
// pointerId, so the first finger down is always the same colour regardless of
// how high the monotonic id counter has climbed.
const COLORS = ['#4d9de0', '#6ee79a', '#ffd479', '#e07a5f', '#b07ade', '#5fd6d6'];

export const pointerState = {
    pointers: new Map(),    // pointerId -> live record; the multi-touch truth
    log: [],                // recent raw events, newest last
    downCount: 0,
    cancelCount: 0,
    maxConcurrent: 0,       // high-water mark — proof the panel held N at once
    lastTouchList: 0,       // TouchEvent.touches.length from the last touch event
};

export const captureState = {
    enabled: true,          // the HUD toggle — capture on/off
    captured: false,
    pointerId: null,
    movesTotal: 0,
    movesOutsideBounds: 0,  // THE measurement: moves delivered off-element
    gotEvents: 0,
    lostEvents: 0,
    lastPhase: 'idle',
};

let canvas, ctx, ptrRows = [], logRows = [], summaryEl;
let capTrack, capBox, capEnableEl;
let lastTouchEndAt = -1e9;
let nextColor = 0;

const LOG_ROWS = 14;
const PTR_ROWS = 6;         // fixed pool; six simultaneous fingers is plenty

export function initPointerPanel() {
    canvas = document.getElementById('ptrCanvas');
    ctx = canvas.getContext('2d');
    summaryEl = document.getElementById('ptrSummary');

    // Fixed row pools. Rebuilding either of these per frame would relayout the
    // panel at 60 Hz and render torn — chunk 1 established that the hard way.
    const table = document.getElementById('ptrTable');
    table.innerHTML = '';
    for (let i = 0; i < PTR_ROWS; i++) {
        const row = document.createElement('div');
        row.className = 'prow';
        row.innerHTML = '<span class="swatch"></span><b class="c"></b>';
        table.appendChild(row);
        ptrRows.push({ row, swatch: row.querySelector('.swatch'), text: row.querySelector('.c') });
    }

    const logEl = document.getElementById('ptrLog');
    logEl.innerHTML = '';
    for (let i = 0; i < LOG_ROWS; i++) {
        const row = document.createElement('div');
        row.className = 'lrow';
        row.textContent = '';
        logEl.appendChild(row);
        logRows.push(row);
    }

    // ── the visualiser ──────────────────────────────────────────────────────
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);

    // Touch events run alongside, one per contact transition. We only read the
    // TouchList length — the interesting part is that it agrees with our own
    // pointer Map, which is asserted in the smoke test.
    for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
        canvas.addEventListener(t, (e) => {
            pointerState.lastTouchList = e.touches.length;
            if (t === 'touchend' || t === 'touchcancel') lastTouchEndAt = performance.now();
            note(t, { pointerId: e.changedTouches[0] ? e.changedTouches[0].identifier : -1 },
                 'touch', `${e.touches.length} on surface`);
        });
    }

    // The compat stream. Nothing here drives state — it exists purely so the
    // log can show the synthesis next to the touch events that caused it.
    for (const t of ['mousedown', 'mousemove', 'mouseup', 'click']) {
        canvas.addEventListener(t, (e) => {
            const synth = performance.now() - lastTouchEndAt < 250;
            note(t, e, synth ? 'compat' : 'mouse', synth ? 'synthesized from the tap' : '');
        });
    }

    document.getElementById('ptrClear').addEventListener('click', () => {
        pointerState.log.length = 0;
        pointerState.downCount = 0;
        pointerState.cancelCount = 0;
        pointerState.maxConcurrent = pointerState.pointers.size;
        renderLog();
    });

    initCaptureDemo();
    renderLog();
}

// ── the multi-touch visualiser ──────────────────────────────────────────────

function local(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onDown(e) {
    const p = local(e);
    // Capture every finger. This is the per-pointer part of the API that has no
    // single-pointer equivalent: two fingers can be captured by the same
    // element at the same time and their streams stay separate.
    canvas.setPointerCapture(e.pointerId);
    pointerState.pointers.set(e.pointerId, {
        id: e.pointerId,
        type: e.pointerType,
        primary: e.isPrimary,
        pressure: e.pressure,
        x: p.x, y: p.y,
        startX: p.x, startY: p.y,
        color: COLORS[nextColor++ % COLORS.length],
        trail: [{ x: p.x, y: p.y }],
        moves: 0,
    });
    pointerState.downCount++;
    if (pointerState.pointers.size > pointerState.maxConcurrent) {
        pointerState.maxConcurrent = pointerState.pointers.size;
    }
    note('pointerdown', e, 'ptr', '');
}

function onMove(e) {
    const rec = pointerState.pointers.get(e.pointerId);
    if (!rec) return;                       // a move with no live contact: hover
    const p = local(e);
    rec.x = p.x; rec.y = p.y;
    rec.pressure = e.pressure;
    rec.moves++;
    rec.trail.push({ x: p.x, y: p.y });
    if (rec.trail.length > 220) rec.trail.shift();
    // Moves are the noisy ones; log every fourth so the window still shows the
    // structure of a gesture rather than one finger's move spam.
    if (rec.moves % 4 === 1) note('pointermove', e, 'ptr', '');
}

function onUp(e) {
    note('pointerup', e, 'ptr', '');
    pointerState.pointers.delete(e.pointerId);
    if (pointerState.pointers.size === 0) nextColor = 0;
}

function onCancel(e) {
    pointerState.cancelCount++;
    note('pointercancel', e, 'cancel', 'contact aborted — no compat click');
    pointerState.pointers.delete(e.pointerId);
    if (pointerState.pointers.size === 0) nextColor = 0;
}

function note(type, e, kind, extra) {
    pointerState.log.push({
        type, kind,
        id: e.pointerId === undefined ? null : e.pointerId,
        pointerType: e.pointerType || null,
        primary: e.isPrimary,
        x: Math.round(e.clientX || 0), y: Math.round(e.clientY || 0),
        extra: extra || '',
    });
    if (pointerState.log.length > 200) pointerState.log.shift();
    renderLog();
}

function renderLog() {
    const start = Math.max(0, pointerState.log.length - LOG_ROWS);
    for (let i = 0; i < LOG_ROWS; i++) {
        const rec = pointerState.log[start + i];
        const row = logRows[i];
        if (!rec) { row.textContent = ''; row.className = 'lrow'; continue; }
        const id = rec.id === null || rec.id === undefined ? '—' : '#' + rec.id;
        const txt = `${pad(rec.type, 14)} ${pad(id, 4)} ${pad(rec.pointerType || '', 6)} ` +
                    `${rec.x},${rec.y}${rec.extra ? '  ' + rec.extra : ''}`;
        if (row.textContent !== txt) row.textContent = txt;
        const cls = 'lrow ' + rec.kind;
        if (row.className !== cls) row.className = cls;
    }
}

function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

/** Called once per frame from app.js. */
export function tickPointerPanel() {
    drawPointers();
    updatePointerTable();
}

function drawPointers() {
    if (!ctx) return;
    ctx.fillStyle = '#080a0f';
    ctx.fillRect(0, 0, W, H);

    // A faint grid, so the coordinates in the labels have something to read
    // against and an off-canvas trail is obviously off-canvas.
    ctx.strokeStyle = '#131926';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 56) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += 50) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.stroke();

    if (pointerState.pointers.size === 0) {
        ctx.fillStyle = '#394152';
        ctx.font = '12px system-ui';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('touch or click here — every contact is tracked separately', W / 2, H / 2);
        return;
    }

    for (const rec of pointerState.pointers.values()) {
        // trail
        if (rec.trail.length > 1) {
            ctx.strokeStyle = rec.color;
            ctx.globalAlpha = 0.45;
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0; i < rec.trail.length; i++) {
                const p = rec.trail[i];
                if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // contact disc — radius follows pressure so a pressure-reporting
        // digitiser has somewhere to show up
        const r = 16 + rec.pressure * 16;
        ctx.beginPath();
        ctx.arc(rec.x, rec.y, r, 0, Math.PI * 2);
        ctx.fillStyle = rec.color;
        ctx.globalAlpha = 0.16;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = rec.color;
        ctx.lineWidth = rec.primary ? 2.5 : 1;   // primary drawn heavier
        ctx.stroke();

        // crosshair at the exact contact point
        ctx.beginPath();
        ctx.moveTo(rec.x - 5, rec.y); ctx.lineTo(rec.x + 5, rec.y);
        ctx.moveTo(rec.x, rec.y - 5); ctx.lineTo(rec.x, rec.y + 5);
        ctx.stroke();

        // label
        ctx.fillStyle = rec.color;
        ctx.font = '10px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        const lx = Math.min(rec.x + r + 6, W - 150), ly = rec.y - r;
        ctx.fillText(`#${rec.id} ${rec.type}${rec.primary ? ' primary' : ''}`, lx, ly);
        ctx.fillText(`p=${rec.pressure.toFixed(2)} ` +
                     `${Math.round(rec.x)},${Math.round(rec.y)}`, lx, ly + 12);
    }
}

function updatePointerTable() {
    const list = Array.from(pointerState.pointers.values());
    for (let i = 0; i < PTR_ROWS; i++) {
        const r = ptrRows[i], rec = list[i];
        if (!rec) {
            if (r.text.textContent !== '') r.text.textContent = '';
            r.swatch.style.background = 'transparent';
            continue;
        }
        const txt = `#${rec.id}  ${rec.type}  ${rec.primary ? 'primary' : 'secondary'}  ` +
                    `p=${rec.pressure.toFixed(2)}  ${Math.round(rec.x)},${Math.round(rec.y)}  ` +
                    `${rec.trail.length} pts`;
        if (r.text.textContent !== txt) r.text.textContent = txt;
        r.swatch.style.background = rec.color;
    }
    const s = `${pointerState.pointers.size} live · peak ${pointerState.maxConcurrent} · ` +
              `TouchList ${pointerState.lastTouchList}`;
    if (summaryEl.textContent !== s) summaryEl.textContent = s;
}

// ── pointer capture demo ────────────────────────────────────────────────────
//
// One draggable box. With capture ON the drag survives leaving the box, because
// every subsequent pointermove for that id is routed to the box no matter what
// the hit test says. With capture OFF the moves go to whatever is under the
// cursor and the box stops following — same code, one call removed.

let dragOffX = 0, dragOffY = 0;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function initCaptureDemo() {
    capTrack = document.getElementById('capTrack');
    capBox = document.getElementById('capBox');
    capEnableEl = document.getElementById('capEnable');

    capEnableEl.addEventListener('change', () => {
        captureState.enabled = capEnableEl.checked;
        setCapPhase(captureState.enabled ? 'capture enabled' : 'capture DISABLED');
    });

    capBox.addEventListener('pointerdown', (e) => {
        const b = capBox.getBoundingClientRect();
        dragOffX = e.clientX - b.left;
        dragOffY = e.clientY - b.top;
        captureState.pointerId = e.pointerId;
        captureState.movesTotal = 0;
        captureState.movesOutsideBounds = 0;
        if (captureState.enabled) capBox.setPointerCapture(e.pointerId);
        setCapPhase(captureState.enabled
            ? `captured #${e.pointerId} (${e.pointerType})`
            : `dragging #${e.pointerId} WITHOUT capture`);
        e.preventDefault();
    });

    capBox.addEventListener('pointermove', (e) => {
        if (captureState.pointerId !== e.pointerId) return;
        captureState.movesTotal++;
        // The measurement that proves capture is doing something: is this move
        // arriving at the box while the pointer is outside the box's own rect?
        const b = capBox.getBoundingClientRect();
        const outside = e.clientX < b.left || e.clientX > b.right ||
                        e.clientY < b.top || e.clientY > b.bottom;
        if (outside) captureState.movesOutsideBounds++;
        // The box is clamped to its track. That is not cosmetic: a box that
        // chased the pointer indefinitely would stay under it and could never
        // demonstrate anything, because the pointer would never be outside its
        // bounds. Pinned at the edge, it keeps receiving moves from a pointer
        // that is demonstrably somewhere else — which is the entire claim.
        const t = capTrack.getBoundingClientRect();
        capBox.style.left = clamp(e.clientX - t.left - dragOffX, 0, t.width - b.width) + 'px';
        capBox.style.top = clamp(e.clientY - t.top - dragOffY, 0, t.height - b.height) + 'px';
        updateCapReadout(outside);
    });

    capBox.addEventListener('pointerup', (e) => {
        if (captureState.pointerId !== e.pointerId) return;
        setCapPhase(`released #${e.pointerId} — capture auto-released on pointerup`);
        captureState.pointerId = null;
    });

    // gotpointercapture / lostpointercapture fire on the holder, and are the
    // only direct evidence the engine acted on the request.
    capBox.addEventListener('gotpointercapture', (e) => {
        captureState.captured = true;
        captureState.gotEvents++;
        setCapPhase(`gotpointercapture #${e.pointerId}`);
    });
    capBox.addEventListener('lostpointercapture', (e) => {
        captureState.captured = false;
        captureState.lostEvents++;
        setCapPhase(`lostpointercapture #${e.pointerId}`);
    });

    setCapPhase('idle');
}

function setCapPhase(s) {
    captureState.lastPhase = s;
    const el = document.getElementById('capPhase');
    if (el && el.textContent !== s) el.textContent = s;
    updateCapReadout(false);
}

function updateCapReadout(outside) {
    setVal('capHeld', captureState.captured ? 'yes' : 'no');
    setVal('capId', captureState.pointerId === null ? '—' : '#' + captureState.pointerId);
    setVal('capMoves', String(captureState.movesTotal));
    setVal('capOutside', String(captureState.movesOutsideBounds));
    setVal('capWhere', outside ? 'OUTSIDE the element' : 'inside');
}

function setVal(id, s) {
    const el = document.getElementById(id);
    if (el && el.textContent !== s) el.textContent = s;
}
