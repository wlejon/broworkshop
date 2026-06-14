// Listen Lab — stream-history ring, scrollable timeline, detail panel, playback.
// (load after core.js)
;(function () {
    const LL = globalThis.LL;
    const { $chart, $overview, $detail, $scratch, $tlLive, $tlHover, $phrase,
            status, fusionRow, mkbtn, FPS, playPcm } = LL;

// ── stream history ring + scrollable timeline ─────────────────────────────────
// Every sensor frame the poll loop observes is appended to a columnar ring
// (~10 min). The timeline renders a pan/zoom window over it — level envelope +
// adaptive floor, voice/tonal bands, onset ticks, and the discrete event
// markers (spots, gestures, arm) — so the whole incoming stream stays legible
// and scrollable, not just the last few seconds. Follow mode pins the live
// edge; pan/zoom/overview-drag detaches into scrub.

const CAP = 10 * 60 * FPS;                // ~10 min of frames (FPS from core/LL)
const Stream = {
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

// ── event log (timeline markers + click-inspect targets) ──────────────────────
// Distinct from the text fusion feed: the notable discrete events (a fired
// spot, a fired gesture, an arm moment) tagged with the absolute frame they
// occurred on, so each lands at the right x on the timeline and carries the
// detail a click expands.

const events = [];
let evId = 0;
const EV_CAP = 4000;

// Re-anchor a spotter-axis span onto the shared stream axis (bro.sense frames)
// using the matched duration, so spot markers/regions line up with the
// envelope and the retained audio. Returns a span on the stream axis (or the
// original if we can't read the stream clock).
function toStreamSpan(span, s) {
    if (!span || !(span.matchedFrames > 0) || !s) return span;
    return { startFrame: s.frames - span.matchedFrames + 1, endFrame: s.frames,
             matchedFrames: span.matchedFrames };
}

function logEvent(type, name, conf, kind, detail, span) {
    const s = bro.sense.isActive() ? bro.sense.snapshot() : null;
    // Prefer the matcher's exact reported span (frames axis) for the event's
    // anchor + region; fall back to the current frame when none is given (arm).
    const exact = span && span.startFrame >= 0;
    const ev = {
        id: ++evId, type, name: name || '',
        conf: (conf == null ? null : conf), kind: kind || '',
        frame: exact ? span.endFrame : (s ? s.frames : Stream.newestFrame()),
        t: (exact ? span.endFrame : (s ? s.frames : Stream.newestFrame())) / FPS,
        span: exact ? { a: span.startFrame, b: span.endFrame } : null,
        detail: detail || null,
    };
    events.push(ev);
    while (events.length > EV_CAP) events.shift();
    return ev;
}

// ── tier-1 phoneme stream (bro.kws.posterior) ─────────────────────────────────
// The model's raw per-frame readout — which phoneme PhonemeNet is hearing,
// independent of any template. Stored alongside the sensors in the ring so the
// timeline and detail panel can show what was actually decoded where; class
// labels are learned from the live stream (cls 0 == silence).

const phLabels = { 0: 'sil' };
const PH_CONF = 0.45;          // posterior above which a phoneme counts as heard

// Collapse the ring's per-frame top phoneme over [a,b] into a legible run:
// drop silence/low-confidence frames, merge adjacent duplicates — what the
// model decoded across a span (e.g. the region a spot matched).
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

const View = {
    follow: true,
    span: 10 * FPS,           // visible width, in frames (default 10 s)
    endFrame: 0,              // right edge frame when scrubbing
    hoverFrame: -1,
    selId: -1,                // selected event (detail panel open)
    selRegion: null,          // { a, b } frame span highlighted for the selection
    scratchSel: null,         // { a, b } stream-frame region grabbed for a new clip
};
const SPAN_MIN = 2 * FPS, SPAN_MAX = CAP;

function viewWindow() {
    const end = View.follow ? Stream.newestFrame() : View.endFrame;
    const span = Math.max(SPAN_MIN, Math.min(SPAN_MAX, View.span));
    return { start: end - span, end, span };
}

const MARK = { spot: '#54d68a', gesture: '#c9a6ff', arm: '#c9a6ff', speech: '#36c5d0' };

// Size a canvas's backing store to physical pixels (CSS size × devicePixelRatio)
// so lines/text render crisp on HiDPI displays. Display width stays responsive
// via CSS (calc 100%); the design height is pinned inline. Draw code works in
// logical CSS pixels (_cw/_ch) and each draw resets the DPR transform.
function sizeCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const cssH = canvas._ch || canvas.height;        // fixed design height (200/46)
    const cssW = Math.max(400, canvas.clientWidth || 800);
    // Only re-allocate when the display size or DPR actually changed — this runs
    // every frame, so it self-corrects after boot layout settles or a resize,
    // without leaning on the resize event firing at exactly the right moment.
    if (canvas._cw === cssW && canvas._ch === cssH && canvas._dpr === dpr) return;
    canvas.style.height = cssH + 'px';               // pin display height; backing store scales
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
    const phLaneY = H - 22;       // tier-1 phoneme lane sits below the envelope

    // Reduce visible samples into per-pixel columns: min/max dB envelope, the
    // floor, OR'd flags, and the column's dominant (highest-posterior) phoneme.
    const minDb = new Float32Array(W).fill(999);
    const maxDb = new Float32Array(W).fill(-999);
    const floor = new Float32Array(W).fill(-999);
    const flags = new Uint8Array(W);
    const phCls = new Int16Array(W);
    const phP   = new Float32Array(W);
    const has   = new Uint8Array(W);     // column received at least one frame
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

    // When zoomed in there are more pixel columns than frames, so the scatter
    // above leaves empty columns between samples — the waveform would render as
    // disconnected stripes. Forward-fill interior gaps from the previous column
    // for the continuous layers (envelope, floor, voice/tonal bands, phoneme).
    // Onset (flag bit 4) is momentary, so it is NOT carried — ticks stay sharp.
    let last = -1;
    for (let c = 0; c < W; c++) {
        if (has[c]) { last = c; continue; }
        if (last < 0) continue;          // before the first sample — genuine gap
        minDb[c] = minDb[last]; maxDb[c] = maxDb[last]; floor[c] = floor[last];
        flags[c] = flags[last] & 3;      // carry voice/tonal, drop onset
        phCls[c] = phCls[last]; phP[c] = phP[last];
    }

    // selection region highlight (where the selected event matched)
    if (View.selRegion) {
        const xa = xOf(View.selRegion.a), xb = xOf(View.selRegion.b);
        ctx.fillStyle = 'rgba(201,166,255,.12)';
        ctx.fillRect(xa, 0, Math.max(2, xb - xa), H);
    }
    // scratch-pad selection: a region the user shift-dragged to clip out of the
    // live stream (green, distinct from the purple event highlight) + edges.
    if (View.scratchSel) {
        const xa = xOf(View.scratchSel.a), xb = xOf(View.scratchSel.b);
        ctx.fillStyle = 'rgba(84,214,138,.14)';
        ctx.fillRect(xa, 0, Math.max(2, xb - xa), H);
        ctx.fillStyle = '#54d68a';
        ctx.fillRect(xa - 1, 0, 2, H); ctx.fillRect(xb - 1, 0, 2, H);
    }
    // voice / tonal background bands
    for (let c = 0; c < W; c++) {
        if (flags[c] & 1) { ctx.fillStyle = 'rgba(84,214,138,.10)'; ctx.fillRect(c, 0, 1, H); }
        if (flags[c] & 2) { ctx.fillStyle = 'rgba(106,166,255,.14)'; ctx.fillRect(c, 0, 1, H); }
    }
    // adaptive noise floor
    ctx.strokeStyle = '#5a657a'; ctx.lineWidth = 1; ctx.beginPath();
    let pen = false;
    for (let c = 0; c < W; c++) {
        if (floor[c] < -998) { pen = false; continue; }
        const y = yOf(floor[c]); pen ? ctx.lineTo(c, y) : ctx.moveTo(c, y); pen = true;
    }
    ctx.stroke();
    // dB envelope: min..max fill + max trace
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
    // onset ticks
    ctx.fillStyle = '#ffb454';
    for (let c = 0; c < W; c++) if (flags[c] & 4) ctx.fillRect(c - 1, 0, 2, 9);

    // tier-1 phoneme lane: cyan where the model decodes a phoneme (distinct
    // from the green energy-VAD band — model evidence, not just energy), with
    // labels once the window is zoomed in enough to read them.
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

    // event markers
    for (const ev of events) {
        if (ev.frame < start || ev.frame > end) continue;
        const x = xOf(ev.frame), sel = ev.id === View.selId;
        ctx.fillStyle = MARK[ev.type] || '#888';
        ctx.globalAlpha = sel ? 1 : 0.5;
        ctx.fillRect(x - (sel ? 1 : 0), 0, sel ? 2 : 1, H);
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(x, 13, sel ? 5 : 4, 0, Math.PI * 2); ctx.fill();
    }

    // playback: the region being auditioned (cyan band) + a swept playhead.
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

    // hover cursor + time ticks
    if (View.hoverFrame >= start && View.hoverFrame <= end) {
        const x = xOf(View.hoverFrame);
        ctx.strokeStyle = '#3a455c';
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    drawTimeTicks(ctx, W, H, start, span);
}

function drawTimeTicks(ctx, W, H, start, span) {
    // A handful of mm:ss labels across the window (stream time).
    ctx.font = '9px ui-monospace, monospace';
    const secs = span / FPS;
    const step = secs > 240 ? 60 : secs > 60 ? 20 : secs > 20 ? 5 : 1;   // s between labels
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
    // Nearest event within ~6 px of the cursor frame.
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
let scratchDrag = null;          // { a } anchor frame while shift-dragging a clip region
function onTimelineDown(e) {
    // Shift-drag carves a region out of the live stream (the "scratch pad")
    // instead of panning — release turns it into a new clip.
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
        // A bare shift-click (no real span) just clears any prior selection.
        if (!View.scratchSel || View.scratchSel.b - View.scratchSel.a < FPS / 10) clearScratch();
        else renderScratchBar();
        return;
    }
    if (drag && !drag.moved) {                 // a click, not a drag → select
        const { frame, } = frameAtX($chart, e.clientX);
        const ev = hitEvent(frame, viewWindow().span);
        if (ev) selectEvent(ev); else closeDetail();
    }
    drag = null;
}

// ── scratch pad — turn a grabbed timeline region into a clip ──────────────────
// The timeline already retains ~10 min of raw audio (bro.listen). A shift-drag
// marks a span on the stream axis; this bar lets you audition it and promote it
// to a gesture, which opens straight into the clip editor (trim / volume / tune).

function clearScratch() {
    View.scratchSel = null;
    $scratch.classList.add('hidden');
    $scratch.innerHTML = '';
}

function scratchSpan() {
    // Clamp the dragged region to what's actually retained on the stream axis.
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

    const retained = bro.listen.info().active;
    $scratch.appendChild(mkbtn('▶ Play', () => {
        const sp = scratchSpan();
        if (sp) playRegion(sp);
    }));
    const wav = mkbtn('💾 WAV', () => {
        const sp = scratchSpan();
        if (!sp) { status('selection is no longer on the timeline', true); return; }
        const pcm = bro.listen.audio(sp.a, sp.b);
        LL.exportWav(pcm, bro.listen.info().rate, 'listen-selection.wav');
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
    if (!bro.listen.info().active) { status('stream retention is off — nothing to capture', true); return; }
    const pcm = bro.listen.audio(sp.a, sp.b);
    if (!pcm || !pcm.length) { status('that region is no longer retained', true); return; }
    const name = $phrase.value.trim() || ('clip-' + (++LL.gestureN));
    LL.enrollGestureFromTimeline(name, pcm);   // retains the clip, re-renders, opens its editor
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
    // Keep the frame under the cursor fixed: anchor the right edge.
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

// Matched-region span (frames) for a fired event, to highlight the wave and
// label the detail. The matcher now reports the EXACT span (start..end frames)
// on the events — use it. Older events / arms without a span fall back to an
// estimate from the enrolled length.
function eventRegion(ev) {
    if (ev.span) return { a: ev.span.a, b: ev.span.b };   // exact, from the matcher
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
    if ((ev.type === 'spot' || ev.type === 'arm') && bro.kws.isLoaded()) {
        const v = bro.kws.inspect(ev.name);
        // ~60 ms/phoneme estimate. An arm fires mid-phrase, so span only the
        // states that actually aligned (ev.detail.matched) — spanning the whole
        // template would reach back into pre-phrase silence and the replayed
        // clip would be inaudible.
        const states = ev.type === 'arm' && ev.detail && ev.detail.matched > 0
            ? ev.detail.matched
            : (v ? v.states.length : 10);
        return { a: end - states * 6, b: end };
    }
    return { a: end - 60, b: end };
}

// ── playhead — sweep a marker across the region being auditioned ──────────────
// The clip API has no position query, so we interpolate on wall-clock: playback
// starts immediately, so a marker swept across the played span over the clip's
// duration stays in sync. Drawn on the timeline so clicking a transcript line
// (or a detail ▶) shows WHERE on the stream the audio you're hearing lives.
const Playback = { active: false, a: 0, b: 0, startMs: 0, durMs: 0, key: '' };

function startPlayhead(a, b, durSec, key) {
    Playback.active = true; Playback.a = a; Playback.b = b;
    Playback.startMs = Date.now(); Playback.durMs = Math.max(60, durSec * 1000);
    Playback.key = key || '';
}
// Fraction played [0,1], or -1 when idle. Pure read — deactivation is handled by
// updatePlayback() so drawTimeline can call this every frame without side effects.
function playFrac() {
    if (!Playback.active) return -1;
    return Math.min(1, (Date.now() - Playback.startMs) / Playback.durMs);
}
function updatePlayback() {
    if (Playback.active && Date.now() - Playback.startMs >= Playback.durMs) {
        Playback.active = false;
        LL.renderLines();           // drop the "playing" row highlight when it ends (transcript)
    }
}

// Bring a stream region into view without snapping back to the live edge — used
// when a transcript line is clicked, so the timeline scrubs to where it was said.
function focusRegion(a, b) {
    const margin = Math.max(FPS, (b - a) * 0.6);
    View.span = Math.min(SPAN_MAX, Math.max(SPAN_MIN, (b - a) + 2 * margin));
    setLive(false);
    View.endFrame = Math.min(Stream.newestFrame(), b + margin);
    const span = viewWindow().span;
    if (View.endFrame - span < Stream.oldestFrame()) View.endFrame = Stream.oldestFrame() + span;
}

// Replay retained stream audio for a frame range (bro.listen). Pads the clip a
// little so a short match isn't a clipped blip, and sweeps a playhead across the
// padded span (`key` identifies the transcript row driving it, for highlighting).
function playRegion(region, key) {
    const info = bro.listen.info();
    if (!info.active) { status('audio retention is off', true); return; }
    const pad = Math.round(0.25 * info.frameRate);
    const a = Math.round(region.a) - pad, b = Math.round(region.b) + pad;
    const pcm = bro.listen.audio(a, b);
    if (!pcm || !pcm.length) { status('audio for that region is no longer retained', true); return; }
    playPcm(pcm, info.rate);        // shared clip player (core); host runs at 16 kHz
    startPlayhead(a, b, pcm.length / info.rate, key);
    status('playing ' + (pcm.length / info.rate).toFixed(2) + ' s clip');
}

// Play a raw mono PCM clip (e.g. an enrolled gesture clip or a trimmed
// selection of it) through the same native clip API. rate defaults to the
// gesture/host 16 kHz; the engine resamples to its own rate.
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

    // Matched span — exact from the matcher when available, else estimated.
    // With retention on, a ▶ button replays the exact audio the match fired on.
    if (View.selRegion) {
        const dur = ((View.selRegion.b - View.selRegion.a) / FPS).toFixed(2);
        const span = document.createElement('div');
        span.className = 'drow';
        span.innerHTML = 'matched span: <b>' + dur + ' s</b> · frames ' +
            Math.round(View.selRegion.a) + '–' + Math.round(View.selRegion.b) +
            (ev.span ? '' : ' <span style="color:#6b7686">(estimated)</span>') + ' ';
        const region = View.selRegion;
        if (bro.listen.info().active) {
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
                LL.exportWav(bro.listen.audio(Math.round(region.a), Math.round(region.b)),
                             bro.listen.info().rate, 'listen-' + ev.type + '.wav'));
            span.appendChild(save);
        }
        $detail.appendChild(span);
    }

    // The clip / template it matched.
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
    } else if ((ev.type === 'spot' || ev.type === 'arm') && bro.kws.isLoaded()) {
        const v = bro.kws.inspect(ev.name);
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

    // What the MODEL actually decoded over the matched region (tier-1), from
    // the ring — independent of the template. For a phrase this is the heard
    // phonemes; for a gesture, this is the tell: real phonemes here mean the
    // "non-speech" gesture actually fired on speech (a fuser would veto it).
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
        Stream, events, logEvent, toStreamSpan, decodedOver, phLabels, PH_CONF,
        View, viewWindow, drawStream, sizeCanvas, setLive, hitEvent, frameAtX,
        onTimelineDown, onTimelineMove, onTimelineUp, onTimelineWheel, onOverviewNav,
        renderScratchBar, clearScratch, scratchSpan, scratchToGesture,
        selectEvent, closeDetail, eventRegion, focusRegion,
        playRegion, playSamples, playFrac, Playback, updatePlayback,
    });
})();
