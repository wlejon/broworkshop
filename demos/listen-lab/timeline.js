// Listen Lab — the scrollable timeline (~10 min) and its overview strip.
//
// The chart renders a pan/zoom window over the active stream's history ring:
// level envelope + adaptive floor, voice/tonal bands, onset ticks, the tier-1
// phoneme lane, event markers, the selection / scratch regions and the
// playhead. Drag scrubs, the wheel zooms, a click inspects the nearest marker,
// shift-drag grabs a region into the scratch bar (play / WAV / make a gesture).
// The overview under it shows the whole ring; drag it to jump.

import { h, clear } from "/lib/kit/dom.js";
import { fitCanvas } from "/lib/kit/gauges.js";
import { D, FPS, app, status, exportWav, btn } from "/app/state.js";
import {
    cur, PH_CONF, SPAN_MIN, SPAN_MAX, viewWindow, setLive, clampScrub, fmtFrame,
} from "/app/ring.js";
import { selectEvent, closeDetail, playFrac, playRegion } from "/app/detail.js";
import { enrollGestureFromTimeline } from "/app/gestures.js";

const CHART_H = 200, OVERVIEW_H = 46;
const MARK = { spot: '#54d68a', gesture: '#c9a6ff', arm: '#c9a6ff', speech: '#36c5d0' };
let chartW = 400, overviewW = 400;

const yOfDb = (db, H, top, bottom) => (1 - Math.max(0, Math.min(1, (db + 80) / 80))) * (H - top - bottom) + top;

// ── the chart ───────────────────────────────────────────────────────────────

/** Bin the visible frames into one column per pixel. */
function binColumns(R, W, start, end, xOf) {
    const c = {
        minDb: new Float32Array(W).fill(999), maxDb: new Float32Array(W).fill(-999),
        floor: new Float32Array(W).fill(-999), flags: new Uint8Array(W),
        phCls: new Int16Array(W), phP: new Float32Array(W), any: false,
    };
    const has = new Uint8Array(W);
    for (let i = 0; i < R.count; i++) {
        const sl = R.slot(i), f = R.frame[sl];
        if (f < start || f > end) continue;
        const x = Math.max(0, Math.min(W - 1, Math.floor(xOf(f))));
        const db = R.db[sl];
        if (db < c.minDb[x]) c.minDb[x] = db;
        if (db > c.maxDb[x]) c.maxDb[x] = db;
        c.floor[x] = R.floor[sl];
        c.flags[x] |= R.flags[sl];
        if (R.phCls[sl] > 0 && R.phP[sl] > c.phP[x]) { c.phP[x] = R.phP[sl]; c.phCls[x] = R.phCls[sl]; }
        has[x] = 1;
        c.any = true;
    }
    // Hold the last sample across empty columns (a zoomed-in window).
    let last = -1;
    for (let x = 0; x < W; x++) {
        if (has[x]) { last = x; continue; }
        if (last < 0) continue;
        c.minDb[x] = c.minDb[last]; c.maxDb[x] = c.maxDb[last]; c.floor[x] = c.floor[last];
        c.flags[x] = c.flags[last] & 3;
        c.phCls[x] = c.phCls[last]; c.phP[x] = c.phP[last];
    }
    return c;
}

function strokeSeries(ctx, W, vals, yOf) {
    ctx.beginPath();
    let pen = false;
    for (let x = 0; x < W; x++) {
        if (vals[x] < -998) { pen = false; continue; }
        const y = yOf(vals[x]);
        if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        pen = true;
    }
    ctx.stroke();
}

function drawTimeline() {
    const { ctx, w: W, h: H } = fitCanvas(D.chart, { height: CHART_H, minWidth: 400 });
    chartW = W;
    ctx.fillStyle = '#0d1016';
    ctx.fillRect(0, 0, W, H);
    const R = cur.ring, V = cur.view;
    if (!R.count) return;
    const { start, end, span } = viewWindow();
    const xOf = (f) => (f - start) / span * W;
    const yOf = (db) => yOfDb(db, H, 6, 20);
    const phLaneY = H - 22;
    const c = binColumns(R, W, start, end, xOf);
    if (!c.any) return;

    const band = (sel, fill, edge) => {
        const xa = xOf(sel.a), xb = xOf(sel.b);
        ctx.fillStyle = fill;
        ctx.fillRect(xa, 0, Math.max(2, xb - xa), H);
        if (edge) { ctx.fillStyle = edge; ctx.fillRect(xa - 1, 0, 2, H); ctx.fillRect(xb - 1, 0, 2, H); }
    };
    if (V.selRegion) band(V.selRegion, 'rgba(201,166,255,.12)');
    if (V.scratchSel) band(V.scratchSel, 'rgba(84,214,138,.14)', '#54d68a');
    for (let x = 0; x < W; x++) {
        if (c.flags[x] & 1) { ctx.fillStyle = 'rgba(84,214,138,.10)'; ctx.fillRect(x, 0, 1, H); }
        if (c.flags[x] & 2) { ctx.fillStyle = 'rgba(106,166,255,.14)'; ctx.fillRect(x, 0, 1, H); }
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#5a657a';
    strokeSeries(ctx, W, c.floor, yOf);
    ctx.fillStyle = 'rgba(139,224,174,.16)';
    for (let x = 0; x < W; x++) {
        if (c.maxDb[x] < -998) continue;
        const yhi = yOf(c.maxDb[x]), ylo = yOf(c.minDb[x]);
        ctx.fillRect(x, yhi, 1, Math.max(1, ylo - yhi));
    }
    ctx.strokeStyle = '#8be0ae';
    strokeSeries(ctx, W, c.maxDb, yOf);
    ctx.fillStyle = '#ffb454';
    for (let x = 0; x < W; x++) if (c.flags[x] & 4) ctx.fillRect(x - 1, 0, 2, 9);

    // Tier-1 phoneme lane, labelled when zoomed in enough to read.
    const labels = span <= 18 * FPS;
    if (labels) { ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'left'; }
    let prevPh = -1;
    for (let x = 0; x < W; x++) {
        if (c.phCls[x] <= 0 || c.phP[x] < PH_CONF) { prevPh = -1; continue; }
        ctx.fillStyle = '#36c5d0';
        ctx.fillRect(x, phLaneY, 1, 5);
        if (labels && c.phCls[x] !== prevPh) {
            ctx.fillStyle = '#9fe7ef';
            ctx.fillText(cur.phLabels[c.phCls[x]] || ('#' + c.phCls[x]), x + 1, phLaneY - 1);
        }
        prevPh = c.phCls[x];
    }

    for (const ev of cur.events) {
        if (ev.frame < start || ev.frame > end) continue;
        const x = xOf(ev.frame), sel = ev.id === V.selId;
        ctx.fillStyle = MARK[ev.type] || '#888';
        ctx.globalAlpha = sel ? 1 : 0.5;
        ctx.fillRect(x - (sel ? 1 : 0), 0, sel ? 2 : 1, H);
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(x, 13, sel ? 5 : 4, 0, Math.PI * 2); ctx.fill();
    }

    const frac = playFrac();
    if (frac >= 0) {
        const P = cur.playback;
        band(P, 'rgba(54,197,208,.10)');
        const ph = P.a + frac * (P.b - P.a);
        if (ph >= start && ph <= end) {
            const x = xOf(ph);
            ctx.strokeStyle = '#36c5d0'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
            ctx.fillStyle = '#36c5d0';
            ctx.beginPath(); ctx.moveTo(x - 4, 0); ctx.lineTo(x + 4, 0); ctx.lineTo(x, 7); ctx.closePath(); ctx.fill();
            ctx.lineWidth = 1;
        }
    }

    if (V.hoverFrame >= start && V.hoverFrame <= end) {
        const x = xOf(V.hoverFrame);
        ctx.strokeStyle = '#3a455c';
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    drawTimeTicks(ctx, W, H, start, span);
}

function drawTimeTicks(ctx, W, H, start, span) {
    ctx.font = '9px ui-monospace, monospace';
    const secs = span / FPS;
    const step = secs > 240 ? 60 : secs > 60 ? 20 : secs > 20 ? 5 : 1;
    const first = Math.max(0, Math.ceil(start / FPS / step) * step);   // no ticks before t = 0
    for (let s = first; s <= (start + span) / FPS; s += step) {
        const x = (s * FPS - start) / span * W;
        ctx.fillStyle = '#1d2330'; ctx.fillRect(x, H - 11, 1, 6);
        ctx.fillStyle = '#5a657a';
        ctx.fillText(fmtFrame(s * FPS, 0), x + 2, H - 2);
    }
}

function drawOverview() {
    const { ctx, w: W, h: H } = fitCanvas(D.overview, { height: OVERVIEW_H, minWidth: 400 });
    overviewW = W;
    ctx.fillStyle = '#0a0c11'; ctx.fillRect(0, 0, W, H);
    const R = cur.ring;
    if (!R.count) return;
    const f0 = R.oldestFrame(), f1 = R.newestFrame();
    const fspan = Math.max(1, f1 - f0);
    ctx.strokeStyle = '#3c5a47'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < R.count; i++) {
        const sl = R.slot(i);
        const x = (R.frame[sl] - f0) / fspan * W, y = yOfDb(R.db[sl], H, 2, 2);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
    for (const ev of cur.events) {
        if (ev.type !== 'spot' && ev.type !== 'gesture' && ev.type !== 'speech') continue;
        ctx.fillStyle = MARK[ev.type];
        ctx.fillRect((ev.frame - f0) / fspan * W, 0, 1, H);
    }
    const { start, end } = viewWindow();
    const xa = (start - f0) / fspan * W, xb = (end - f0) / fspan * W;
    ctx.fillStyle = 'rgba(106,166,255,.10)';
    ctx.fillRect(xa, 0, Math.max(2, xb - xa), H);
    ctx.strokeStyle = '#6aa6ff';
    ctx.strokeRect(Math.max(0.5, xa), 0.5, Math.max(2, xb - xa), H - 1);
}

export function drawStream() {
    drawTimeline();
    drawOverview();
}

/** "10.0 s" / "1.5 min" (+ scrubbing) for the span readout. */
export function spanLabel() {
    const secs = viewWindow().span / FPS;
    return (secs >= 60 ? (secs / 60).toFixed(1) + ' min' : secs.toFixed(1) + ' s') +
        (cur.view.follow ? '' : ' · scrubbing');
}

// ── interaction ─────────────────────────────────────────────────────────────

function frameAtX(clientX) {
    const r = D.chart.getBoundingClientRect();
    const { start, span } = viewWindow();
    return start + (clientX - r.left) / Math.max(1, r.width) * span;
}

function hitEvent(frame, span) {
    let best = null, bd = span / chartW * 7;
    for (const ev of cur.events) {
        const d = Math.abs(ev.frame - frame);
        if (d <= bd) { bd = d; best = ev; }
    }
    return best;
}

function onHover(e) {
    const frame = frameAtX(e.clientX), R = cur.ring;
    cur.view.hoverFrame = frame;
    const sl = R.nearest(frame);
    if (sl < 0) { D.tlHover.textContent = '—'; return; }
    const fl = R.flags[sl];
    D.tlHover.textContent = fmtFrame(R.frame[sl]) + ' · ' + R.db[sl].toFixed(1) + ' dB' +
        (fl & 1 ? ' · voice' : '') + (fl & 2 ? ' · ' + Math.round(R.domHz[sl]) + ' Hz' : '') +
        (fl & 4 ? ' · onset' : '');
}

let drag = null, scratchDrag = null, ovDrag = false;

function onDown(e) {
    if (e.shiftKey) {
        const frame = frameAtX(e.clientX);
        scratchDrag = { a: frame };
        cur.view.scratchSel = { a: frame, b: frame };
        renderScratchBar();
        return;
    }
    drag = { x: e.clientX, end0: viewWindow().end, moved: false };
}

function onMove(e) {
    if (ovDrag) { onOverviewNav(e); return; }
    onHover(e);
    if (scratchDrag) {
        const frame = frameAtX(e.clientX);
        cur.view.scratchSel = { a: Math.min(scratchDrag.a, frame), b: Math.max(scratchDrag.a, frame) };
        renderScratchBar();
        return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 2) drag.moved = true;
    const r = D.chart.getBoundingClientRect();
    const { span } = viewWindow();
    setLive(false);
    cur.view.endFrame = drag.end0 - dx / Math.max(1, r.width) * span;
    clampScrub();
}

function onUp(e) {
    ovDrag = false;
    if (scratchDrag) {
        scratchDrag = null;
        const s = cur.view.scratchSel;
        if (!s || s.b - s.a < FPS / 10) clearScratch(); else renderScratchBar();
        return;
    }
    if (drag && !drag.moved) {
        const ev = hitEvent(frameAtX(e.clientX), viewWindow().span);
        if (ev) selectEvent(ev); else closeDetail();
    }
    drag = null;
}

function onWheel(e) {
    e.preventDefault();
    const frame = frameAtX(e.clientX);
    const oldSpan = viewWindow().span;
    const fracFromRight = (viewWindow().end - frame) / oldSpan;
    cur.view.span = Math.max(SPAN_MIN, Math.min(SPAN_MAX, oldSpan * (e.deltaY > 0 ? 1.25 : 0.8)));
    setLive(false);
    cur.view.endFrame = frame + fracFromRight * viewWindow().span;
    clampScrub();
}

function onOverviewNav(e) {
    const R = cur.ring;
    if (!R.count) return;
    const r = D.overview.getBoundingClientRect();
    const frac = (e.clientX - r.left) / Math.max(1, r.width);
    const f0 = R.oldestFrame(), f1 = R.newestFrame();
    setLive(false);
    cur.view.endFrame = f0 + frac * (f1 - f0) + viewWindow().span / 2;
    clampScrub();
}

/** Wire the chart + overview mouse handling (once, at boot). */
export function bindTimelineInput() {
    D.chart.addEventListener('mousedown', onDown);
    D.chart.addEventListener('wheel', onWheel, { passive: false });
    D.chart.addEventListener('mouseleave', () => { cur.view.hoverFrame = -1; });
    D.overview.addEventListener('mousedown', (e) => { ovDrag = true; onOverviewNav(e); });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    D.tlLive.addEventListener('click', () => setLive(true));
}

// ── scratch pad: turn a grabbed timeline region into a clip ─────────────────

export function clearScratch() {
    cur.view.scratchSel = null;
    D.scratch.classList.add('hidden');
    clear(D.scratch);
}

/** The scratch selection clamped to the retained ring, or null. */
export function scratchSpan() {
    const s = cur.view.scratchSel;
    if (!s) return null;
    const a = Math.max(cur.ring.oldestFrame(), Math.round(s.a));
    const b = Math.min(cur.ring.newestFrame(), Math.round(s.b));
    return b > a ? { a, b } : null;
}

export function renderScratchBar() {
    const sel = cur.view.scratchSel, src = cur.src;
    if (!sel) { clearScratch(); return; }
    D.scratch.classList.remove('hidden');
    clear(D.scratch);
    const retained = src.listen.info().active;
    D.scratch.append(
        h('span.slabel.sgrow', null, 'timeline selection ', h('b', null, ((sel.b - sel.a) / FPS).toFixed(2) + ' s'),
          ' · frames ' + Math.round(sel.a) + '–' + Math.round(sel.b)),
        btn('▶ Play', () => { const sp = scratchSpan(); if (sp) playRegion(sp); }),
        btn('💾 WAV', () => {
            const sp = scratchSpan();
            if (!sp) { status('selection is no longer on the timeline', true); return; }
            exportWav(src.listen.audio(sp.a, sp.b), src.listen.info().rate, 'listen-selection.wav');
        }, { disabled: !retained, title: retained ? 'save this selection to a .wav file' : 'stream retention is off' }),
        btn('✚ Gesture from selection', scratchToGesture, {
            className: 'smake', disabled: !retained || !app.kwsReady,
            title: !retained ? 'stream retention is off'
                : !app.kwsReady ? 'the listen host is still loading'
                : 'enroll this slice of the timeline as a new gesture and open it for editing',
        }),
        btn('×', clearScratch, { className: 'sx', title: 'clear selection' }));
}

export function scratchToGesture() {
    const sp = scratchSpan(), src = cur.src;
    if (!sp) { status('selection is no longer on the timeline', true); return; }
    if (!app.kwsReady) { status('gestures need the listen host (still loading)', true); return; }
    if (!src.listen.info().active) { status('stream retention is off — nothing to capture', true); return; }
    const pcm = src.listen.audio(sp.a, sp.b);
    if (!pcm || !pcm.length) { status('that region is no longer retained', true); return; }
    const name = D.phrase.value.trim() || ('clip-' + (++app.gestureN));
    enrollGestureFromTimeline(name, pcm);
    D.phrase.value = '';
    clearScratch();
    status('made gesture "' + name + '" from ' + ((sp.b - sp.a) / FPS).toFixed(2) +
        ' s of the timeline — trim / set volume / tune below');
}
