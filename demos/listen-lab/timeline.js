// Listen Lab — per-stream history ring, scrollable timeline, detail, playback.
// (load after core.js)
//
// Every stream (the mic = tab #0, plus any added source) owns its OWN dashboard
// state: a history ring, an event log, a view window, a playback cursor, and a
// phoneme-label table. This module provides the FACTORIES for that state
// (makeRing/makeView/makePlayback) and the draw/interaction code that renders
// whichever stream is active. `bindTimeline(st)` repoints the module's working
// references (Stream/events/View/Playback/phLabels/SRC) at the active stream, so
// the existing single-stream draw code renders the active tab unchanged. Per-
// stream UPDATES (logEvent, ring.push) take an explicit `st` instead, so a
// background stream keeps accumulating history while another tab is shown.
import { LL } from "/app/core.js";
    const { $chart, $overview, $detail, $scratch, $tlLive, $tlHover, $phrase,
            status, fusionRow, mkbtn, FPS, playPcm } = LL;

const CAP = 10 * 60 * FPS;                // ~10 min of frames (FPS from core/LL)

// A fresh stream-history ring. Columnar (~10 min); the timeline renders a
// pan/zoom window over it — level envelope + adaptive floor, voice/tonal bands,
// onset ticks, the tier-1 phoneme lane, and discrete event markers.
function makeRing() {
    return {
        frame: new Float64Array(CAP),
        db:    new Float32Array(CAP),
        floor: new Float32Array(CAP),
        peak:  new Float32Array(CAP),
        domHz: new Float32Array(CAP),
        flags: new Uint8Array(CAP),           // bit0 voice · bit1 tonal · bit2 onset
        phCls: new Int16Array(CAP),           // tier-1: top phoneme class (0 = silence)
        phP:   new Float32Array(CAP),         //         its posterior
        head: 0, count: 0,
        push(prev, s, ph) {
            const i = this.head;
            this.frame[i] = s.frames;
            this.db[i] = s.db; this.floor[i] = s.noiseFloorDb;
            this.peak[i] = s.peak; this.domHz[i] = s.tonal ? s.dominantHz : 0;
            this.flags[i] = (s.voice ? 1 : 0) | (s.tonal ? 2 : 0) |
                ((prev && s.onsets > prev.onsets) ? 4 : 0);
            this.phCls[i] = ph ? ph.cls : 0;
            this.phP[i] = ph ? ph.p : 0;
            this.head = (i + 1) % CAP;
            this.count = Math.min(this.count + 1, CAP);
        },
        slot(i) { return (this.head - this.count + i + CAP) % CAP; },   // logical→slot
        newestFrame() { return this.count ? this.frame[this.slot(this.count - 1)] : 0; },
        oldestFrame() { return this.count ? this.frame[this.slot(0)] : 0; },
        // Nearest stored sample to an absolute frame (linear; the ring is small).
        nearest(f) {
            let bi = -1, bd = Infinity;
            for (let i = 0; i < this.count; i++) {
                const sl = this.slot(i), d = Math.abs(this.frame[sl] - f);
                if (d < bd) { bd = d; bi = sl; }
            }
            return bi;
        },
    };
}

const PH_CONF = 0.45;          // posterior above which a phoneme counts as heard

function makeView() {
    return {
        follow: true,
        span: 10 * FPS,           // visible width, in frames (default 10 s)
        endFrame: 0,              // right edge frame when scrubbing
        hoverFrame: -1,
        selId: -1,                // selected event (detail panel open)
        selRegion: null,          // { a, b } frame span highlighted for the selection
        scratchSel: null,         // { a, b } stream-frame region grabbed for a new clip
    };
}

const Playback0 = () => ({ active: false, a: 0, b: 0, startMs: 0, durMs: 0, key: '' });
function makePlayback() { return Playback0(); }

// ── working references for the ACTIVE stream (repointed by bindTimeline) ───────
let Stream   = makeRing();
let events   = [];
let View     = makeView();
let Playback = makePlayback();
let phLabels = { 0: 'sil' };
let SRC      = null;            // active stream's source (sense/kws/gesture/listen)

function bindTimeline(st) {
    Stream = st.ring;
    events = st.events;
    View = st.view;
    Playback = st.playback;
    phLabels = st.phLabels;
    SRC = st.source;
}

const SPAN_MIN = 2 * FPS, SPAN_MAX = CAP;

// ── event log (timeline markers + click-inspect targets) ──────────────────────

let evId = 0;
const EV_CAP = 4000;

// Re-anchor a spotter-axis span onto the shared stream axis (bro.sense frames)
// using the matched duration, so spot markers/regions line up with the
// envelope and the retained audio.
function toStreamSpan(span, s) {
    if (!span || !(span.matchedFrames > 0) || !s) return span;
    return { startFrame: s.frames - span.matchedFrames + 1, endFrame: s.frames,
             matchedFrames: span.matchedFrames };
}

// Log a discrete event onto a SPECIFIC stream's timeline (not necessarily the
// active one). Uses the stream's own sense clock + ring for the anchor.
function logEvent(st, type, name, conf, kind, detail, span) {
    const s = st.source.sense.isActive() ? st.source.sense.snapshot() : null;
    const exact = span && span.startFrame >= 0;
    const anchor = exact ? span.endFrame : (s ? s.frames : st.ring.newestFrame());
    const ev = {
        id: ++evId, type, name: name || '',
        conf: (conf == null ? null : conf), kind: kind || '',
        frame: anchor,
        t: anchor / FPS,
        span: exact ? { a: span.startFrame, b: span.endFrame } : null,
        detail: detail || null,
    };
    st.events.push(ev);
    while (st.events.length > EV_CAP) st.events.shift();
    return ev;
}

// ── tier-1 phoneme stream (bro.kws.posterior) ─────────────────────────────────
// Collapse the active ring's per-frame top phoneme over [a,b] into a legible
// run: drop silence/low-confidence frames, merge adjacent duplicates.
function decodedOver(a, b) {
    const out = [];
    let last = -1;
    for (let i = 0; i < Stream.count; i++) {
        const sl = Stream.slot(i), f = Stream.frame[sl];
        if (f < a || f > b) continue;
        const cls = Stream.phCls[sl];
        if (cls === 0 || Stream.phP[sl] < PH_CONF) { last = -1; continue; }
        if (cls === last) continue;
        out.push(phLabels[cls] || ('#' + cls));
        last = cls;
    }
    return out;
}

// ── view + interaction ────────────────────────────────────────────────────────

function viewWindow() {
    const end = View.follow ? Stream.newestFrame() : View.endFrame;
    const span = Math.max(SPAN_MIN, Math.min(SPAN_MAX, View.span));
    return { start: end - span, end, span };
}

const MARK = { spot: '#54d68a', gesture: '#c9a6ff', arm: '#c9a6ff', speech: '#36c5d0' };

// Size a canvas's backing store to physical pixels so lines/text render crisp on
// HiDPI displays. Draw code works in logical CSS pixels (_cw/_ch).
function sizeCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const cssH = canvas._ch || canvas.height;        // fixed design height (200/46)
    const cssW = Math.max(400, canvas.clientWidth || 800);
    if (canvas._cw === cssW && canvas._ch === cssH && canvas._dpr === dpr) return;
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas._cw = cssW; canvas._ch = cssH; canvas._dpr = dpr;
}

function drawTimeline() {
    const ctx = $chart.getContext('2d');
    const W = $chart._cw, H = $chart._ch;
    ctx.setTransform($chart._dpr, 0, 0, $chart._dpr, 0, 0);
    ctx.fillStyle = '#0d1016';
    ctx.fillRect(0, 0, W, H);
    if (!Stream.count) return;
    const { start, end, span } = viewWindow();
    const xOf = (f) => (f - start) / span * W;
    const yOf = (db) => (1 - Math.max(0, Math.min(1, (db + 80) / 80))) * (H - 26) + 6;
    const phLaneY = H - 22;

    const minDb = new Float32Array(W).fill(999);
    const maxDb = new Float32Array(W).fill(-999);
    const floor = new Float32Array(W).fill(-999);
    const flags = new Uint8Array(W);
    const phCls = new Int16Array(W);
    const phP   = new Float32Array(W);
    const has   = new Uint8Array(W);
    let any = false;
    for (let i = 0; i < Stream.count; i++) {
        const sl = Stream.slot(i), f = Stream.frame[sl];
        if (f < start || f > end) continue;
        const c = Math.max(0, Math.min(W - 1, Math.floor(xOf(f))));
        const db = Stream.db[sl];
        if (db < minDb[c]) minDb[c] = db;
        if (db > maxDb[c]) maxDb[c] = db;
        floor[c] = Stream.floor[sl];
        flags[c] |= Stream.flags[sl];
        if (Stream.phCls[sl] > 0 && Stream.phP[sl] > phP[c]) {
            phP[c] = Stream.phP[sl]; phCls[c] = Stream.phCls[sl];
        }
        has[c] = 1;
        any = true;
    }
    if (!any) return;

    let last = -1;
    for (let c = 0; c < W; c++) {
        if (has[c]) { last = c; continue; }
        if (last < 0) continue;
        minDb[c] = minDb[last]; maxDb[c] = maxDb[last]; floor[c] = floor[last];
        flags[c] = flags[last] & 3;
        phCls[c] = phCls[last]; phP[c] = phP[last];
    }

    if (View.selRegion) {
        const xa = xOf(View.selRegion.a), xb = xOf(View.selRegion.b);
        ctx.fillStyle = 'rgba(201,166,255,.12)';
        ctx.fillRect(xa, 0, Math.max(2, xb - xa), H);
    }
    if (View.scratchSel) {
        const xa = xOf(View.scratchSel.a), xb = xOf(View.scratchSel.b);
        ctx.fillStyle = 'rgba(84,214,138,.14)';
        ctx.fillRect(xa, 0, Math.max(2, xb - xa), H);
        ctx.fillStyle = '#54d68a';
        ctx.fillRect(xa - 1, 0, 2, H); ctx.fillRect(xb - 1, 0, 2, H);
    }
    for (let c = 0; c < W; c++) {
        if (flags[c] & 1) { ctx.fillStyle = 'rgba(84,214,138,.10)'; ctx.fillRect(c, 0, 1, H); }
        if (flags[c] & 2) { ctx.fillStyle = 'rgba(106,166,255,.14)'; ctx.fillRect(c, 0, 1, H); }
    }
    ctx.strokeStyle = '#5a657a'; ctx.lineWidth = 1; ctx.beginPath();
    let pen = false;
    for (let c = 0; c < W; c++) {
        if (floor[c] < -998) { pen = false; continue; }
        const y = yOf(floor[c]); pen ? ctx.lineTo(c, y) : ctx.moveTo(c, y); pen = true;
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(139,224,174,.16)';
    for (let c = 0; c < W; c++) {
        if (maxDb[c] < -998) continue;
        const yhi = yOf(maxDb[c]), ylo = yOf(minDb[c]);
        ctx.fillRect(c, yhi, 1, Math.max(1, ylo - yhi));
    }
    ctx.strokeStyle = '#8be0ae'; ctx.beginPath(); pen = false;
    for (let c = 0; c < W; c++) {
        if (maxDb[c] < -998) { pen = false; continue; }
        const y = yOf(maxDb[c]); pen ? ctx.lineTo(c, y) : ctx.moveTo(c, y); pen = true;
    }
    ctx.stroke();
    ctx.fillStyle = '#ffb454';
    for (let c = 0; c < W; c++) if (flags[c] & 4) ctx.fillRect(c - 1, 0, 2, 9);

    const showPhLabels = span <= 18 * FPS;
    if (showPhLabels) { ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'left'; }
    let prevPh = -1;
    for (let c = 0; c < W; c++) {
        if (phCls[c] <= 0 || phP[c] < PH_CONF) { prevPh = -1; continue; }
        ctx.fillStyle = '#36c5d0';
        ctx.fillRect(c, phLaneY, 1, 5);
        if (showPhLabels && phCls[c] !== prevPh) {
            ctx.fillStyle = '#9fe7ef';
            ctx.fillText(phLabels[phCls[c]] || ('#' + phCls[c]), c + 1, phLaneY - 1);
        }
        prevPh = phCls[c];
    }

    for (const ev of events) {
        if (ev.frame < start || ev.frame > end) continue;
        const x = xOf(ev.frame), sel = ev.id === View.selId;
        ctx.fillStyle = MARK[ev.type] || '#888';
        ctx.globalAlpha = sel ? 1 : 0.5;
        ctx.fillRect(x - (sel ? 1 : 0), 0, sel ? 2 : 1, H);
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(x, 13, sel ? 5 : 4, 0, Math.PI * 2); ctx.fill();
    }

    const frac = playFrac();
    if (frac >= 0) {
        const xa = xOf(Playback.a), xb = xOf(Playback.b);
        ctx.fillStyle = 'rgba(54,197,208,.10)';
        ctx.fillRect(xa, 0, Math.max(2, xb - xa), H);
        const ph = Playback.a + frac * (Playback.b - Playback.a);
        if (ph >= start && ph <= end) {
            const x = xOf(ph);
            ctx.strokeStyle = '#36c5d0'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
            ctx.fillStyle = '#36c5d0';
            ctx.beginPath(); ctx.moveTo(x - 4, 0); ctx.lineTo(x + 4, 0); ctx.lineTo(x, 7); ctx.closePath(); ctx.fill();
            ctx.lineWidth = 1;
        }
    }

    if (View.hoverFrame >= start && View.hoverFrame <= end) {
        const x = xOf(View.hoverFrame);
        ctx.strokeStyle = '#3a455c';
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    drawTimeTicks(ctx, W, H, start, span);
}

function drawTimeTicks(ctx, W, H, start, span) {
    ctx.font = '9px ui-monospace, monospace';
    const secs = span / FPS;
    const step = secs > 240 ? 60 : secs > 60 ? 20 : secs > 20 ? 5 : 1;
    const sStart = start / FPS;
    const first = Math.ceil(sStart / step) * step;
    for (let s = first; s <= (start + span) / FPS; s += step) {
        const x = (s * FPS - start) / span * W;
        ctx.fillStyle = '#1d2330'; ctx.fillRect(x, H - 11, 1, 6);
        const mm = Math.floor(s / 60), ss = Math.floor(s % 60);
        ctx.fillStyle = '#5a657a';
        ctx.fillText(mm + ':' + String(ss).padStart(2, '0'), x + 2, H - 2);
    }
}

function drawOverview() {
    const ctx = $overview.getContext('2d');
    const W = $overview._cw, H = $overview._ch;
    ctx.setTransform($overview._dpr, 0, 0, $overview._dpr, 0, 0);
    ctx.fillStyle = '#0a0c11'; ctx.fillRect(0, 0, W, H);
    if (!Stream.count) return;
    const f0 = Stream.oldestFrame(), f1 = Stream.newestFrame();
    const fspan = Math.max(1, f1 - f0);
    const yOf = (db) => (1 - Math.max(0, Math.min(1, (db + 80) / 80))) * (H - 4) + 2;
    ctx.strokeStyle = '#3c5a47'; ctx.lineWidth = 1; ctx.beginPath();
    let pen = false;
    for (let i = 0; i < Stream.count; i++) {
        const sl = Stream.slot(i);
        const x = (Stream.frame[sl] - f0) / fspan * W, y = yOf(Stream.db[sl]);
        pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true;
    }
    ctx.stroke();
    for (const ev of events) {
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

function drawStream() {
    sizeCanvas($chart);
    sizeCanvas($overview);
    drawTimeline();
    drawOverview();
}

// ── timeline interaction ──────────────────────────────────────────────────────

function frameAtX(canvas, clientX) {
    const r = canvas.getBoundingClientRect();
    const mx = (clientX - r.left) / r.width * canvas._cw;
    const { start, span } = viewWindow();
    return { frame: start + mx / canvas._cw * span, mx };
}

function setLive(on) {
    View.follow = on;
    $tlLive.classList.toggle('active', on);
}

function hitEvent(frame, span) {
    const tolFrames = span / $chart._cw * 7;
    let best = null, bd = tolFrames;
    for (const ev of events) {
        const d = Math.abs(ev.frame - frame);
        if (d <= bd) { bd = d; best = ev; }
    }
    return best;
}

function onTimelineHover(e) {
    const { frame } = frameAtX($chart, e.clientX);
    View.hoverFrame = frame;
    const sl = Stream.nearest(frame);
    if (sl < 0) { $tlHover.textContent = '—'; return; }
    const t = Stream.frame[sl] / FPS;
    const mm = Math.floor(t / 60), ss = (t % 60).toFixed(1);
    const fl = Stream.flags[sl];
    $tlHover.textContent =
        mm + ':' + ss.padStart(4, '0') + ' · ' + Stream.db[sl].toFixed(1) + ' dB' +
        (fl & 1 ? ' · voice' : '') + (fl & 2 ? ' · ' + Math.round(Stream.domHz[sl]) + ' Hz' : '') +
        (fl & 4 ? ' · onset' : '');
}

let drag = null;
let scratchDrag = null;
function onTimelineDown(e) {
    if (e.shiftKey) {
        const { frame } = frameAtX($chart, e.clientX);
        scratchDrag = { a: frame };
        View.scratchSel = { a: frame, b: frame };
        renderScratchBar();
        return;
    }
    drag = { x: e.clientX, end0: viewWindow().end, moved: false };
}
function onTimelineMove(e) {
    onTimelineHover(e);
    if (scratchDrag) {
        const { frame } = frameAtX($chart, e.clientX);
        View.scratchSel = { a: Math.min(scratchDrag.a, frame), b: Math.max(scratchDrag.a, frame) };
        renderScratchBar();
        return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 2) drag.moved = true;
    const { span } = viewWindow();
    const r = $chart.getBoundingClientRect();
    setLive(false);
    View.endFrame = drag.end0 - dx / r.width * span;
    clampScrub();
}
function onTimelineUp(e) {
    if (scratchDrag) {
        scratchDrag = null;
        if (!View.scratchSel || View.scratchSel.b - View.scratchSel.a < FPS / 10) clearScratch();
        else renderScratchBar();
        return;
    }
    if (drag && !drag.moved) {
        const { frame, } = frameAtX($chart, e.clientX);
        const ev = hitEvent(frame, viewWindow().span);
        if (ev) selectEvent(ev); else closeDetail();
    }
    drag = null;
}

// ── scratch pad — turn a grabbed timeline region into a clip ──────────────────

function clearScratch() {
    View.scratchSel = null;
    $scratch.classList.add('hidden');
    $scratch.innerHTML = '';
}

function scratchSpan() {
    if (!View.scratchSel) return null;
    const a = Math.max(Stream.oldestFrame(), Math.round(View.scratchSel.a));
    const b = Math.min(Stream.newestFrame(), Math.round(View.scratchSel.b));
    return b > a ? { a, b } : null;
}

function renderScratchBar() {
    const sel = View.scratchSel;
    if (!sel) { clearScratch(); return; }
    $scratch.classList.remove('hidden');
    $scratch.innerHTML = '';
    const dur = (sel.b - sel.a) / FPS;
    const label = document.createElement('span');
    label.className = 'slabel sgrow';
    label.innerHTML = 'timeline selection <b>' + dur.toFixed(2) + ' s</b> · frames ' +
        Math.round(sel.a) + '–' + Math.round(sel.b);
    $scratch.appendChild(label);

    const retained = SRC.listen.info().active;
    $scratch.appendChild(mkbtn('▶ Play', () => {
        const sp = scratchSpan();
        if (sp) playRegion(sp);
    }));
    const wav = mkbtn('💾 WAV', () => {
        const sp = scratchSpan();
        if (!sp) { status('selection is no longer on the timeline', true); return; }
        const pcm = SRC.listen.audio(sp.a, sp.b);
        LL.exportWav(pcm, SRC.listen.info().rate, 'listen-selection.wav');
    });
    wav.disabled = !retained;
    wav.title = retained ? 'save this selection to a .wav file' : 'stream retention is off';
    $scratch.appendChild(wav);
    const make = mkbtn('✚ Gesture from selection', scratchToGesture);
    make.className = 'smake';
    make.disabled = !retained || !LL.kwsReady;
    make.title = !retained ? 'stream retention is off'
        : !LL.kwsReady ? 'the listen host is still loading'
        : 'enroll this slice of the timeline as a new gesture and open it for editing';
    $scratch.appendChild(make);
    const x = mkbtn('×', clearScratch);
    x.className = 'sx'; x.title = 'clear selection';
    $scratch.appendChild(x);
}

function scratchToGesture() {
    const sp = scratchSpan();
    if (!sp) { status('selection is no longer on the timeline', true); return; }
    if (!LL.kwsReady) { status('gestures need the listen host (still loading)', true); return; }
    if (!SRC.listen.info().active) { status('stream retention is off — nothing to capture', true); return; }
    const pcm = SRC.listen.audio(sp.a, sp.b);
    if (!pcm || !pcm.length) { status('that region is no longer retained', true); return; }
    const name = $phrase.value.trim() || ('clip-' + (++LL.gestureN));
    LL.enrollGestureFromTimeline(name, pcm);
    $phrase.value = '';
    clearScratch();
    status('made gesture "' + name + '" from ' + ((sp.b - sp.a) / FPS).toFixed(2) +
        ' s of the timeline — trim / set volume / tune below');
}
function onTimelineWheel(e) {
    e.preventDefault();
    const { frame } = frameAtX($chart, e.clientX);
    const factor = e.deltaY > 0 ? 1.25 : 0.8;
    const oldSpan = viewWindow().span;
    View.span = Math.max(SPAN_MIN, Math.min(SPAN_MAX, oldSpan * factor));
    setLive(false);
    const { span } = viewWindow();
    const fracFromRight = (viewWindow().end - frame) / oldSpan;
    View.endFrame = frame + fracFromRight * span;
    clampScrub();
}
function clampScrub() {
    const newest = Stream.newestFrame(), oldest = Stream.oldestFrame();
    const span = viewWindow().span;
    if (View.endFrame >= newest) setLive(true);
    else if (View.endFrame - span < oldest) View.endFrame = oldest + span;
}

function onOverviewNav(e) {
    if (!Stream.count) return;
    const r = $overview.getBoundingClientRect();
    const frac = (e.clientX - r.left) / r.width;
    const f0 = Stream.oldestFrame(), f1 = Stream.newestFrame();
    const center = f0 + frac * (f1 - f0);
    setLive(false);
    View.endFrame = center + viewWindow().span / 2;
    clampScrub();
}

// ── detail panel — click a marker to see what fired, where, and the clip ──────

function sensorContextAt(frame) {
    const sl = Stream.nearest(frame);
    if (sl < 0) return '';
    const fl = Stream.flags[sl];
    return Stream.db[sl].toFixed(1) + ' dB · floor ' + Stream.floor[sl].toFixed(0) + ' dB' +
        (fl & 1 ? ' · voice' : ' · quiet') +
        (fl & 2 ? ' · tonal ' + Math.round(Stream.domHz[sl]) + ' Hz' : '') +
        (fl & 4 ? ' · onset' : '');
}

function chip(text, gap) {
    const c = document.createElement('span');
    c.className = 'dchip' + (gap ? ' gap' : '');
    c.textContent = text;
    return c;
}

function eventRegion(ev) {
    if (ev.span) return { a: ev.span.a, b: ev.span.b };
    const end = ev.frame;
    if (ev.type === 'gesture') {
        const v = bro.gesture.inspect(ev.name);
        if (v) {
            const ms = v.kind === 'tone'
                ? v.toneMs
                : v.intervalsMs.reduce((a, b) => a + b, 0);
            return { a: end - ms / 10, b: end };
        }
    }
    if ((ev.type === 'spot' || ev.type === 'arm') && SRC.kws.isLoaded()) {
        const v = SRC.kws.inspect(ev.name);
        const states = ev.type === 'arm' && ev.detail && ev.detail.matched > 0
            ? ev.detail.matched
            : (v ? v.states.length : 10);
        return { a: end - states * 6, b: end };
    }
    return { a: end - 60, b: end };
}

// ── playhead — sweep a marker across the region being auditioned ──────────────

function startPlayhead(a, b, durSec, key) {
    Playback.active = true; Playback.a = a; Playback.b = b;
    Playback.startMs = Date.now(); Playback.durMs = Math.max(60, durSec * 1000);
    Playback.key = key || '';
}
function playFrac() {
    if (!Playback.active) return -1;
    return Math.min(1, (Date.now() - Playback.startMs) / Playback.durMs);
}
function updatePlayback() {
    if (Playback.active && Date.now() - Playback.startMs >= Playback.durMs) {
        Playback.active = false;
        LL.renderLines();
    }
}

function focusRegion(a, b) {
    const margin = Math.max(FPS, (b - a) * 0.6);
    View.span = Math.min(SPAN_MAX, Math.max(SPAN_MIN, (b - a) + 2 * margin));
    setLive(false);
    View.endFrame = Math.min(Stream.newestFrame(), b + margin);
    const span = viewWindow().span;
    if (View.endFrame - span < Stream.oldestFrame()) View.endFrame = Stream.oldestFrame() + span;
}

function playRegion(region, key) {
    const info = SRC.listen.info();
    if (!info.active) { status('audio retention is off', true); return; }
    const pad = Math.round(0.25 * (info.frameRate || info.rate || 16000));
    const a = Math.round(region.a) - pad, b = Math.round(region.b) + pad;
    const pcm = SRC.listen.audio(a, b);
    if (!pcm || !pcm.length) { status('audio for that region is no longer retained', true); return; }
    playPcm(pcm, info.rate);
    startPlayhead(a, b, pcm.length / info.rate, key);
    status('playing ' + (pcm.length / info.rate).toFixed(2) + ' s clip');
}

function playSamples(pcm, rate) {
    if (!pcm || !pcm.length) { status('nothing to play', true); return; }
    playPcm(pcm, rate || 16000);
    status('playing ' + (pcm.length / (rate || 16000)).toFixed(2) + ' s clip');
}

function selectEvent(ev) {
    View.selId = ev.id;
    View.selRegion = eventRegion(ev);
    $detail.classList.remove('hidden');
    $detail.innerHTML = '';

    const hdr = document.createElement('div');
    hdr.className = 'dhdr';
    hdr.innerHTML = '<span class="dkind ' + ev.type + '">' + ev.type + '</span>' +
        '<span class="dname"></span>' +
        (ev.conf != null ? '<span class="dconf">conf ' + ev.conf.toFixed(3) + '</span>' : '') +
        '<button class="dclose">×</button>';
    hdr.querySelector('.dname').textContent = ev.name + (ev.kind ? ' (' + ev.kind + ')' : '');
    hdr.querySelector('.dclose').addEventListener('click', closeDetail);
    $detail.appendChild(hdr);

    const when = document.createElement('div');
    when.className = 'drow';
    const tt = ev.t, mm = Math.floor(tt / 60), ss = (tt % 60).toFixed(1);
    when.innerHTML = 'at <b>' + mm + ':' + ss.padStart(4, '0') + '</b> · ' +
        sensorContextAt(ev.frame);
    $detail.appendChild(when);

    if (View.selRegion) {
        const dur = ((View.selRegion.b - View.selRegion.a) / FPS).toFixed(2);
        const span = document.createElement('div');
        span.className = 'drow';
        span.innerHTML = 'matched span: <b>' + dur + ' s</b> · frames ' +
            Math.round(View.selRegion.a) + '–' + Math.round(View.selRegion.b) +
            (ev.span ? '' : ' <span style="color:#6b7686">(estimated)</span>') + ' ';
        const region = View.selRegion;
        if (SRC.listen.info().active) {
            const play = document.createElement('button');
            play.className = 'dplay';
            play.textContent = '▶ play';
            play.title = 'replay the retained audio for this region';
            play.addEventListener('click', () => playRegion(region));
            span.appendChild(play);
            const save = document.createElement('button');
            save.className = 'dplay';
            save.textContent = '💾 wav';
            save.title = 'save this region to a .wav file';
            save.addEventListener('click', () =>
                LL.exportWav(SRC.listen.audio(Math.round(region.a), Math.round(region.b)),
                             SRC.listen.info().rate, 'listen-' + ev.type + '.wav'));
            span.appendChild(save);
        }
        $detail.appendChild(span);
    }

    if (ev.type === 'gesture') {
        const v = bro.gesture.inspect(ev.name);
        const row = document.createElement('div');
        row.className = 'drow';
        row.innerHTML = v
            ? (v.kind === 'tone'
                ? 'tone template · <b>' + Math.round(v.toneHz) + ' Hz</b> · ' + Math.round(v.toneMs) + ' ms'
                : 'rhythm template · <b>' + (v.intervalsMs.length + 1) + ' taps</b> · ' +
                  v.intervalsMs.map((m) => Math.round(m)).join('/') + ' ms')
            : '(template removed)';
        $detail.appendChild(row);
    } else if ((ev.type === 'spot' || ev.type === 'arm') && SRC.kws.isLoaded()) {
        const v = SRC.kws.inspect(ev.name);
        if (v) {
            const lbl = document.createElement('div');
            lbl.className = 'drow';
            lbl.innerHTML = 'decoded as <b>' + v.states.length + '</b> ' +
                (v.hasGaps ? 'rhythm states' : 'phonemes') + ':';
            $detail.appendChild(lbl);
            const chips = document.createElement('div');
            chips.className = 'dchips';
            for (const st of v.states) {
                chips.appendChild(st.gap
                    ? chip('gap ' + Math.round(st.gapLo * v.frameMs) + '–' +
                           Math.round(st.gapHi * v.frameMs) + ' ms', true)
                    : chip(st.label, false));
            }
            $detail.appendChild(chips);
        }
    }

    if (View.selRegion) {
        const heard = decodedOver(View.selRegion.a, View.selRegion.b);
        const row = document.createElement('div');
        row.className = 'drow';
        if (heard.length) {
            row.innerHTML = 'model heard here: ';
            const seq = document.createElement('span');
            seq.className = 'dchips';
            seq.style.display = 'inline-flex';
            for (const lbl of heard) seq.appendChild(chip(lbl, false));
            row.appendChild(seq);
            if (ev.type === 'gesture')
                row.appendChild(Object.assign(document.createElement('div'), {
                    className: 'drow',
                    textContent: '⚠ phonemes present — this non-speech match overlaps speech',
                }));
        } else {
            row.innerHTML = 'model heard here: <b>no phonemes</b> (non-speech)';
        }
        $detail.appendChild(row);
    }
}

function closeDetail() {
    View.selId = -1; View.selRegion = null;
    $detail.classList.add('hidden');
}

    Object.assign(LL, {
        makeRing, makeView, makePlayback, bindTimeline,
        logEvent, toStreamSpan, decodedOver, PH_CONF,
        viewWindow, drawStream, sizeCanvas, setLive, hitEvent, frameAtX,
        onTimelineDown, onTimelineMove, onTimelineUp, onTimelineWheel, onOverviewNav,
        renderScratchBar, clearScratch, scratchSpan, scratchToGesture,
        selectEvent, closeDetail, eventRegion, focusRegion,
        playRegion, playSamples, playFrac, updatePlayback,
        // active-stream accessors for the seam/test (read the bound references).
        activeRing: () => Stream, activeEvents: () => events,
        activeView: () => View, activePlayback: () => Playback,
        activePhLabels: () => phLabels,
    });
