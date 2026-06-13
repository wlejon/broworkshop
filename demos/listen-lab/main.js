// Listen Lab — the listening stack on one dashboard.
//
// Jonny-architecture demo: listening is a STACK of sensors fused into a
// consensus signal, not one model. This app runs two tiers of it live on the
// shared listen host (one mic tap, one PCEN front-end, one PhonemeNet
// forward) and fuses their evidence in a single poll loop:
//
//   tier-0  bro.sense.snapshot()  — model-free DSP, 10 ms latency: level,
//           energy VAD, spectral-flux onsets, autocorrelation tonality.
//   tier-2  bro.kws.progress()    — per-template Viterbi alignment as it
//           accumulates: prefix depth + the SAME geometric-mean confidence
//           the firing threshold tests, readable mid-word.
//
// The fusion feed shows the consensus story: voice starts (counter delta),
// transients, sustained tones, "phrase is 5/7 deep above threshold — a
// confirmation tier would arm HERE, seconds before onSpot", and finally the
// completed spot itself, annotated with the tier-0 context it fired in.
//
// Rhythm gestures: ● Record captures raw mic PCM via bro.mic (its own tap —
// independent of the listen host) and enrolls it with enrollGaps, so internal
// silence becomes TIMED gap states: click·gap·click is the template, and a
// re-performance at the wrong tempo is an illegal path, not a low score.
//
// Headless note: no live mic — test.js drives the same shared stream through
// bro.kws.feed() (one stream: it advances bro.sense too) and enrolls rhythm
// templates through the listenLab.enrollRhythm seam.

const fs = require('fs');

const WEIGHT_CANDIDATES = [
    '../../../brosoundml/weights/phoneme/english.bpm',
    '../../../brosoundml/build-cuda/english.bpm',
    'D:/projects/brosoundml/weights/phoneme/english.bpm',
    'D:/projects/brosoundml/build-cuda/english.bpm',
];

const $ = (sel) => document.querySelector(sel);
const $dbBig = $('#dbBig'), $levelFill = $('#levelFill'), $floorMark = $('#floorMark');
const $levelSmall = $('#levelSmall');
const $voiceDot = $('#voiceDot'), $voiceTxt = $('#voiceTxt'), $voiceSmall = $('#voiceSmall');
const $onsetDot = $('#onsetDot'), $onsetTxt = $('#onsetTxt');
const $tonalDot = $('#tonalDot'), $tonalTxt = $('#tonalTxt'), $tonalSmall = $('#tonalSmall');
const $chart = $('#chart'), $feed = $('#feed');
const $overview = $('#overview'), $detail = $('#detail');
const $tlLive = $('#tlLive'), $tlSpan = $('#tlSpan'), $tlHover = $('#tlHover');
const $phrase = $('#phrase'), $enroll = $('#enroll'), $record = $('#record');
const $threshold = $('#threshold'), $coverage = $('#coverage'), $listen = $('#listen');
const $tmpls = $('#tmpls'), $noTmpls = $('#noTmpls');
const $gestures = $('#gestures'), $noGest = $('#noGest');
const $status = $('#status'), $streamT = $('#streamT'), $spotCount = $('#spotCount');

let kwsReady = false;
let listening = false;
let recording = false;
let spots = 0;
let gestureN = 0;
const rhythmNames = {};        // name -> true for templates enrolled with gaps

function status(text, isErr) {
    $status.textContent = text;
    $status.className = isErr ? 'err' : '';
}

// ── fusion feed ──────────────────────────────────────────────────────────────

function fusionRow(kind, text) {
    const row = document.createElement('div');
    row.className = 'row';
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    row.innerHTML = '<span class="t">' + hh + ':' + mm + ':' + ss + '</span>' +
        '<span class="kind ' + kind + '">' + kind + '</span><span class="txt"></span>';
    row.querySelector('.txt').textContent = text;
    $feed.insertBefore(row, $feed.firstChild);
    while ($feed.children.length > 200) $feed.removeChild($feed.lastChild);
}

// ── tier-0 sensor cards ──────────────────────────────────────────────────────

const dbPct = (db) => Math.max(0, Math.min(100, (db + 80) / 80 * 100));

function updateSensorCards(s, ph) {
    $dbBig.textContent = (s.db <= -90 ? '−∞' : s.db.toFixed(1)) + ' dB';
    $levelFill.style.width = dbPct(s.db).toFixed(0) + '%';
    $floorMark.style.left = dbPct(s.noiseFloorDb).toFixed(0) + '%';
    $levelSmall.textContent = 'floor ' + s.noiseFloorDb.toFixed(0) +
        ' dB · snr +' + Math.max(0, s.snrDb).toFixed(0) + ' dB';

    $voiceDot.className = 'dot' + (s.voice ? ' on' : '');
    $voiceTxt.textContent = s.voice ? 'voice' : 'quiet';
    $voiceSmall.textContent = (s.voice
        ? 'run ' + (s.voiceFrames / 100).toFixed(1) + ' s · events ' + s.voiceEvents
        : 'events ' + s.voiceEvents) +
        (ph ? ' · /' + ph.label + '/' : '');

    // Onset is true only on its trigger frame; hold the dot lit briefly via
    // the last-event frame index instead of trying to catch that one frame.
    $onsetDot.className = 'dot onset' + (s.frames - s.lastOnsetFrame < 15 ? ' on' : '');
    $onsetTxt.textContent = String(s.onsets);

    $tonalDot.className = 'dot tonal' + (s.tonal ? ' on' : '');
    $tonalTxt.textContent = s.tonal ? Math.round(s.dominantHz) + ' Hz' : '—';
    $tonalSmall.textContent = 'periodicity ' + s.periodicity.toFixed(2) +
        (s.tonal ? ' · run ' + (s.tonalFrames / 100).toFixed(1) + ' s' : '');

    $streamT.textContent = s.t.toFixed(1) + ' s';
}

// ── stream history ring + scrollable timeline ─────────────────────────────────
// Every sensor frame the poll loop observes is appended to a columnar ring
// (~10 min). The timeline renders a pan/zoom window over it — level envelope +
// adaptive floor, voice/tonal bands, onset ticks, and the discrete event
// markers (spots, gestures, arm) — so the whole incoming stream stays legible
// and scrollable, not just the last few seconds. Follow mode pins the live
// edge; pan/zoom/overview-drag detaches into scrub.

const FPS = 100;                          // sensor frame rate (10 ms hop)
const CAP = 10 * 60 * FPS;                // ~10 min of frames
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
};
const SPAN_MIN = 2 * FPS, SPAN_MAX = CAP;

function viewWindow() {
    const end = View.follow ? Stream.newestFrame() : View.endFrame;
    const span = Math.max(SPAN_MIN, Math.min(SPAN_MAX, View.span));
    return { start: end - span, end, span };
}

const MARK = { spot: '#54d68a', gesture: '#c9a6ff', arm: '#c9a6ff' };

// Size a canvas's backing store to physical pixels (CSS size × devicePixelRatio)
// so lines/text render crisp on HiDPI displays. Display width stays responsive
// via CSS (calc 100%); the design height is pinned inline. Draw code works in
// logical CSS pixels (_cw/_ch) and each draw resets the DPR transform.
function sizeCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const cssH = canvas._ch || canvas.height;        // fixed design height (200/46)
    canvas.style.height = cssH + 'px';               // pin display height; backing store scales
    const cssW = Math.max(400, canvas.clientWidth || 800);
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
        any = true;
    }
    if (!any) return;

    // selection region highlight (where the selected event matched)
    if (View.selRegion) {
        const xa = xOf(View.selRegion.a), xb = xOf(View.selRegion.b);
        ctx.fillStyle = 'rgba(201,166,255,.12)';
        ctx.fillRect(xa, 0, Math.max(2, xb - xa), H);
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
        if (ev.type !== 'spot' && ev.type !== 'gesture') continue;
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

function drawStream() { drawTimeline(); drawOverview(); }

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
function onTimelineDown(e) {
    drag = { x: e.clientX, end0: viewWindow().end, moved: false };
}
function onTimelineMove(e) {
    onTimelineHover(e);
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
    if (drag && !drag.moved) {                 // a click, not a drag → select
        const { frame, } = frameAtX($chart, e.clientX);
        const ev = hitEvent(frame, viewWindow().span);
        if (ev) selectEvent(ev); else closeDetail();
    }
    drag = null;
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
        if (v) return { a: end - v.states.length * 6, b: end };   // ~60 ms/phoneme est.
    }
    return { a: end - 60, b: end };
}

// Replay retained stream audio for a frame range (bro.listen). Pads the clip a
// little so a short match isn't a clipped blip.
let audioCtx = null;
function playRegion(region) {
    const info = bro.listen.info();
    if (!info.active) { status('audio retention is off', true); return; }
    const pad = Math.round(0.25 * info.frameRate);
    const pcm = bro.listen.audio(Math.round(region.a) - pad, Math.round(region.b) + pad);
    if (!pcm || !pcm.length) { status('audio for that region is no longer retained', true); return; }
    if (!audioCtx) audioCtx = new AudioContext();
    const buf = audioCtx.createBuffer(1, pcm.length, info.rate);
    buf.getChannelData(0).set(pcm);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    src.start();
    status('playing ' + (pcm.length / info.rate).toFixed(2) + ' s clip');
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

// ── tier-0 event edges → fusion feed ─────────────────────────────────────────

let tonalAnnounced = false;

function emitTier0Events(prev, s) {
    if (s.voiceEvents > prev.voiceEvents)
        fusionRow('voice', 'voice started (snr +' + Math.max(0, s.snrDb).toFixed(0) + ' dB)');
    if (!s.voice && prev.voice)
        fusionRow('voice', 'voice ended after ' + (prev.voiceFrames / 100).toFixed(1) + ' s');
    if (s.onsets > prev.onsets) {
        const n = s.onsets - prev.onsets;
        fusionRow('onset', n === 1 ? 'transient' : n + ' transients');
    }
    if (s.tonal && s.tonalFrames >= 30 && !tonalAnnounced) {
        tonalAnnounced = true;
        fusionRow('tonal', 'sustained tone ~' + Math.round(s.dominantHz) +
            ' Hz (periodicity ' + s.periodicity.toFixed(2) + ')');
    }
    if (!s.tonal) tonalAnnounced = false;
}

// ── tier-2 template rows (bro.kws.progress) ──────────────────────────────────

const tmplRows = {};           // name -> { root, fill, meta }
let lastGeneration = -1;
const armState = {};           // name -> announced "arming" for the current attempt
const lastCompletions = {};

function rebuildTemplateRows(p) {
    Object.keys(tmplRows).forEach((k) => { tmplRows[k].root.remove(); delete tmplRows[k]; });
    $noTmpls.style.display = p.templates.length ? 'none' : '';
    for (const t of p.templates) {
        const root = document.createElement('div');
        root.className = 'tmpl';
        root.innerHTML =
            '<div class="trow"><span class="tname"></span>' +
            (rhythmNames[t.name] ? '<span class="badge">rhythm</span>' : '') +
            '<button class="tok" title="show the decoded token sequence">⋯</button>' +
            '<button class="rm">×</button></div>' +
            '<div class="tbar"><div class="tfill"></div></div>' +
            '<span class="tmeta"></span>';
        root.querySelector('.tname').textContent = t.name;
        root.querySelector('.tok').addEventListener('click', (e) => toggleTokens(t.name, root, e.target));
        root.querySelector('.rm').addEventListener('click', () => withMutableSpotter(() => {
            bro.kws.remove(t.name);
            delete rhythmNames[t.name];
        }));
        $tmpls.appendChild(root);
        tmplRows[t.name] = { root, fill: root.querySelector('.tfill'), meta: root.querySelector('.tmeta') };
        lastCompletions[t.name] = t.completions;
    }
    $listen.disabled = !kwsReady || p.templates.length === 0;
}

function updateTemplateRows(p, s) {
    if (p.generation !== lastGeneration) {
        lastGeneration = p.generation;
        rebuildTemplateRows(p);
    }
    for (const t of p.templates) {
        const row = tmplRows[t.name];
        if (!row) continue;
        row.fill.style.width = (t.progress * 100).toFixed(0) + '%';
        row.meta.textContent = t.matched + '/' + t.length +
            ' · conf ' + t.confidence.toFixed(2) + ' · fires ' + t.completions;
        if (t.completions > (lastCompletions[t.name] || 0)) flashRow(t.name);
        lastCompletions[t.name] = t.completions;

        // The fusion moment: most of a template has aligned and its partial
        // confidence is already in threshold territory — this is where a
        // heavier tier (streaming STT confirmation) would spin up, seconds
        // before any onSpot fires.
        if (!armState[t.name] && t.matched < t.length && t.progress >= 0.5) {
            armState[t.name] = true;
            fusionRow('arm', '"' + t.name + '" ' + t.matched + '/' + t.length +
                ' aligned @ conf ' + t.confidence.toFixed(2) +
                (s && s.voice ? ' · voice live' : '') +
                ' — confirmation tier would arm here');
            logEvent('arm', t.name, t.confidence, '',
                { matched: t.matched, length: t.length });
        } else if (armState[t.name] && t.progress < 0.3) {
            armState[t.name] = false;
        }
    }
}

function flashRow(name) {
    const row = tmplRows[name];
    if (!row) return;
    row.root.classList.add('fired');
    // Re-look-up at expiry: a template-set rebuild may have replaced (and
    // detached) this row in the meantime.
    setTimeout(() => { if (tmplRows[name] === row) row.root.classList.remove('fired'); }, 600);
}

// ── token panel — bro.kws.inspect: see (and edit) what a template became ──────
// A phrase enrolled as "what is the first" is really the phoneme sequence
// [W AH T · IH Z · DH AH · F ER S T]; a recorded click gesture is whatever
// garbage phonemes the speech model decoded plus its timed gaps. Showing that
// makes both the suffix-firing and the "sounds don't work" problems legible —
// and for a plain phrase the user can drop tokens and re-enroll the trimmed
// sequence (enrollFromClasses), the intuitive clip edit.

function toggleTokens(name, root, btn) {
    const existing = root.querySelector('.tokens');
    if (existing) { existing.remove(); btn.classList.remove('open'); return; }
    const view = bro.kws.inspect(name);
    if (!view) { status('inspect: no template "' + name + '"', true); return; }
    btn.classList.add('open');

    const panel = document.createElement('div');
    panel.className = 'tokens';
    // A working copy of the editable token list (sound states only; gaps are
    // shown but not editable — re-enroll goes through enrollFromClasses, which
    // can't carry timed gaps).
    let edited = view.states.map((s) => ({ ...s }));

    function render() {
        panel.innerHTML = '';
        const chips = document.createElement('div');
        chips.className = 'chips';
        edited.forEach((s, i) => {
            const chip = document.createElement('span');
            chip.className = 'chip' + (s.gap ? ' gap' : '');
            chip.textContent = s.gap
                ? 'gap ' + Math.round(s.gapLo * view.frameMs) + '–' +
                  Math.round(s.gapHi * view.frameMs) + ' ms'
                : s.label;
            // Editable only for plain (non-rhythm) phrases.
            if (!s.gap && !view.hasGaps) {
                const x = document.createElement('button');
                x.className = 'x';
                x.textContent = '×';
                x.title = 'drop this token';
                x.addEventListener('click', () => { edited.splice(i, 1); render(); });
                chip.appendChild(x);
            }
            chips.appendChild(chip);
        });
        panel.appendChild(chips);

        if (view.hasGaps) {
            const hint = document.createElement('span');
            hint.className = 'tokhint';
            hint.textContent = 'rhythm template — speech tokens are approximate; ' +
                'the timed gaps carry the gesture';
            panel.appendChild(hint);
        } else {
            const acts = document.createElement('div');
            acts.className = 'tokedit';
            const apply = document.createElement('button');
            apply.textContent = 'apply edit';
            const changed = edited.length !== view.states.length;
            apply.disabled = !changed || edited.length === 0;
            apply.addEventListener('click', () => withMutableSpotter(() => {
                const cls = edited.filter((s) => !s.gap).map((s) => s.cls);
                bro.kws.enrollFromClasses(name, cls, phrasePolicy());
                status('edited "' + name + '" → ' + cls.length + ' tokens');
                fusionRow('info', 'edited "' + name + '" to ' + cls.length + ' tokens');
            }));
            const reset = document.createElement('button');
            reset.textContent = 'reset';
            reset.disabled = !changed;
            reset.addEventListener('click', () => { edited = view.states.map((s) => ({ ...s })); render(); });
            acts.append(apply, reset);
            panel.appendChild(acts);
        }
    }
    render();
    root.appendChild(panel);
}

// ── the poll loop — ONE place fuses every tier ───────────────────────────────

let lastS = null;

function tick() {
    const s = bro.sense.isActive() ? bro.sense.snapshot() : null;
    // tier-1: the live top phoneme, cached and ring-stored alongside the sensors.
    let ph = null;
    if (kwsReady && bro.kws.isLoaded()) {
        const post = bro.kws.posterior(1);
        if (post && post.top.length) {
            const top = post.top[0];
            phLabels[top.cls] = top.label;
            if (top.cls !== 0 && top.p >= PH_CONF) ph = top;
        }
    }
    if (s) {
        updateSensorCards(s, ph);
        if (!lastS || s.frames > lastS.frames) Stream.push(lastS, s, ph);
        if (lastS) emitTier0Events(lastS, s);
        lastS = s;
    }
    if (kwsReady && bro.kws.isLoaded()) {
        const p = bro.kws.progress();
        if (p) updateTemplateRows(p, s);
    }
    drawStream();
    requestAnimationFrame(tick);
}

// ── enroll / record / listen ─────────────────────────────────────────────────

// Template mutators share the spotter's feed thread, so they're rejected while
// listening; bounce the live session around any mutation.
function withMutableSpotter(fn) {
    const wasListening = listening;
    if (wasListening) stopListening();
    try { fn(); }
    catch (e) { status(String(e.message || e), true); }
    if (wasListening && bro.kws.templates().length) startListening();
    $listen.disabled = !kwsReady || bro.kws.templates().length === 0;
}

// A typed phrase carries minCoverage: a completion must have at least that
// fraction of its phonemes ACTUALLY heard (not riding the emission floor), so
// "what is the first" no longer fires on just "first" with the head floored.
function phrasePolicy() {
    return { threshold: +$threshold.value, minCoverage: +$coverage.value };
}

function enrollPhrase() {
    const text = $phrase.value.trim();
    if (!text || !kwsReady) return;
    withMutableSpotter(() => {
        const len = bro.kws.enroll(text, bro.tts.phonemize(text), phrasePolicy());
        status('enrolled "' + text + '" (' + len + ' phoneme classes)');
        fusionRow('info', 'enrolled phrase "' + text + '" (' + len + ' classes)');
        $phrase.value = '';
    });
}

// Gesture enrollment (tier-0, non-speech): a recorded click rhythm or whistle
// goes to bro.gesture, which matches on SensorHub onsets/pitch — NOT the speech
// model, which only hears such sounds as garbage phonemes. The clip is
// classified into a rhythm (onset intervals) or a tone (sustained pitch).
const gestRows = {};            // name -> { root }
let gesturesListening = false;

function gestureSummary(v) {
    if (!v) return '';
    if (v.kind === 'tone')
        return 'tone · ' + Math.round(v.toneHz) + ' Hz · ' + Math.round(v.toneMs) + ' ms';
    const taps = v.intervalsMs.length + 1;
    return 'rhythm · ' + taps + ' taps · ' +
        v.intervalsMs.map((m) => Math.round(m)).join('/') + ' ms';
}

function renderGestureRows() {
    Object.keys(gestRows).forEach((k) => { gestRows[k].root.remove(); delete gestRows[k]; });
    const names = bro.gesture.templates();
    $noGest.style.display = names.length ? 'none' : '';
    for (const name of names) {
        const v = bro.gesture.inspect(name);
        const root = document.createElement('div');
        root.className = 'gest';
        root.innerHTML = '<span class="gname"></span>' +
            '<span class="gkind ' + (v ? v.kind : '') + '">' + (v ? v.kind : '?') + '</span>' +
            '<span class="gmeta"></span><button class="rm">×</button>';
        root.querySelector('.gname').textContent = name;
        root.querySelector('.gmeta').textContent = gestureSummary(v);
        root.querySelector('.rm').addEventListener('click',
            () => withMutableGesture(() => bro.gesture.remove(name)));
        $gestures.appendChild(root);
        gestRows[name] = { root };
    }
}

function flashGesture(name) {
    const row = gestRows[name];
    if (!row) return;
    row.root.classList.add('fired');
    setTimeout(() => { if (gestRows[name] === row) row.root.classList.remove('fired'); }, 600);
}

function startGestureListening() {
    if (gesturesListening) return;
    bro.gesture.listen({
        onGesture: (name, confidence, kind, span) => {
            spots++;
            $spotCount.textContent = String(spots);
            fusionRow('spot', 'gesture "' + name + '" (' + kind + ') @ conf ' + confidence.toFixed(3));
            logEvent('gesture', name, confidence, kind, null, span);
            flashGesture(name);
        },
    });
    gesturesListening = true;
}

function stopGestureListening() {
    bro.gesture.stop();
    gesturesListening = false;
}

// Gesture mutators share the matcher's feed thread — bounce the session around
// any change, mirroring withMutableSpotter.
function withMutableGesture(fn) {
    const was = gesturesListening;
    if (was) stopGestureListening();
    try { fn(); }
    catch (e) { status(String(e.message || e), true); }
    renderGestureRows();
    if (bro.gesture.templates().length) startGestureListening();
}

function enrollGesture(name, clip) {
    if (!kwsReady) return;   // boot also brings up bro.sense, which gestures need
    withMutableGesture(() => {
        bro.gesture.enrollFromAudio(name, clip, {});
        const v = bro.gesture.inspect(name);
        status('enrolled gesture "' + name + '" (' + gestureSummary(v) + ')');
        fusionRow('info', 'enrolled gesture "' + name + '" — ' + gestureSummary(v) +
            ' (' + (clip.length / bro.gesture.sampleRate()).toFixed(1) + ' s clip)');
    });
}

// ● Record: capture raw (no-AGC) mic PCM at the spotter rate via bro.mic —
// its own broaudio tap, so it runs happily alongside the live listen host.
let recChunks = [];

function toggleRecord() {
    if (!kwsReady) return;
    if (!recording) {
        recChunks = [];
        try {
            bro.mic.start({
                chunkFrames: 160, targetRate: bro.kws.sampleRate(), agc: false, samples: true,
                onChunk: (c) => { if (c.samples) recChunks.push(c.samples.slice()); },
            });
        } catch (e) { status('mic: ' + (e.message || e), true); return; }
        recording = true;
        $record.textContent = '■ Stop';
        $record.classList.add('rec');
        status('recording — perform the gesture (clicks, taps, a rhythm), then Stop');
    } else {
        bro.mic.stop();
        recording = false;
        $record.textContent = '● Record';
        $record.classList.remove('rec');
        let n = 0;
        for (const c of recChunks) n += c.length;
        if (n < bro.kws.sampleRate() / 10) { status('recording too short, discarded', true); return; }
        const clip = new Float32Array(n);
        let o = 0;
        for (const c of recChunks) { clip.set(c, o); o += c.length; }
        recChunks = [];
        enrollGesture($phrase.value.trim() || ('gesture-' + (++gestureN)), clip);
        $phrase.value = '';
    }
}

function startListening() {
    bro.kws.listen({
        onSpot: (name, confidence, span) => {
            spots++;
            $spotCount.textContent = String(spots);
            const s = bro.sense.isActive() ? bro.sense.snapshot() : null;
            fusionRow('spot', '"' + name + '" completed @ conf ' + confidence.toFixed(3) +
                (s && s.voice ? ' · voice run ' + (s.voiceFrames / 100).toFixed(1) + ' s' : ''));
            // The matcher reports the span on the SPOTTER's frame axis; the
            // timeline + retention run on the shared STREAM axis (bro.sense /
            // host frames), which diverges from the spotter's once the spotter
            // joins after sense (live mic). Re-anchor on the stream axis using
            // the axis-independent matched DURATION ending ~now (the fire just
            // happened): start = now − matchedFrames. Gestures already report on
            // the sense axis, so only spots need this.
            logEvent('spot', name, confidence, '', null, toStreamSpan(span, s));
            flashRow(name);
            armState[name] = false;
        },
    });
    listening = true;
    $listen.textContent = 'Stop';
    $listen.classList.add('active');
}

function stopListening() {
    bro.kws.stop();
    listening = false;
    $listen.textContent = 'Listen';
    $listen.classList.remove('active');
}

$enroll.addEventListener('click', enrollPhrase);
$phrase.addEventListener('keydown', (e) => { if (e.key === 'Enter') enrollPhrase(); });
$record.addEventListener('click', toggleRecord);
$listen.addEventListener('click', () => (listening ? stopListening() : startListening()));

// ── boot ─────────────────────────────────────────────────────────────────────

(function boot() {
    sizeCanvas($chart);
    sizeCanvas($overview);
    window.addEventListener('resize', () => {
        sizeCanvas($chart); sizeCanvas($overview);
        drawStream();
    });

    // Timeline interaction: drag to pan, wheel to zoom, click a marker to
    // inspect, Live to re-pin the edge, overview to scrub the full history.
    $chart.addEventListener('mousedown', onTimelineDown);
    window.addEventListener('mousemove', onTimelineMove);
    window.addEventListener('mouseup', onTimelineUp);
    $chart.addEventListener('wheel', onTimelineWheel, { passive: false });
    $chart.addEventListener('mouseleave', () => { View.hoverFrame = -1; });
    $tlLive.addEventListener('click', () => { setLive(true); });
    let ovDrag = false;
    $overview.addEventListener('mousedown', (e) => { ovDrag = true; onOverviewNav(e); });
    window.addEventListener('mousemove', (e) => { if (ovDrag) onOverviewNav(e); });
    window.addEventListener('mouseup', () => { ovDrag = false; });

    // Keep the visible span label in sync with the view each frame.
    setInterval(() => {
        const secs = viewWindow().span / FPS;
        $tlSpan.textContent = (secs >= 60 ? (secs / 60).toFixed(1) + ' min' : secs.toFixed(1) + ' s') +
            (View.follow ? '' : ' · scrubbing');
    }, 100);

    // Tier-0 first: model-free, always available, no weights needed.
    bro.sense.start({});
    fusionRow('info', 'tier-0 sensors live (level / voice / onset / tonality)');

    // Retain ~10 min of the raw shared stream so a matched region can be
    // replayed from the detail panel (opt-in; ~38 MB). Source-agnostic — it
    // captures whatever feeds the host, mic or otherwise.
    bro.listen.retain(600);
    fusionRow('info', 'stream retention on — ' +
        (bro.listen.info().seconds / 60).toFixed(0) + ' min of raw audio kept');

    // require('fs') resolves relative paths against the app dir, but the C++
    // loader resolves against the process CWD — hand it an absolute path.
    let weights = null;
    for (const p of WEIGHT_CANDIDATES) {
        try { if (fs.existsSync(p)) { weights = fs.realpathSync(p); break; } }
        catch (e) { /* next candidate */ }
    }
    if (!weights) {
        status('tier-0 only — no PhonemeNet checkpoint found (' + WEIGHT_CANDIDATES.join(', ') + ')', true);
        $enroll.disabled = $record.disabled = $listen.disabled = true;
        requestAnimationFrame(tick);
        return;
    }
    try {
        bro.kws.load({ weights, threshold: +$threshold.value });
        kwsReady = true;
    } catch (e) {
        status('kws load failed: ' + (e.message || e), true);
        $enroll.disabled = $record.disabled = $listen.disabled = true;
        requestAnimationFrame(tick);
        return;
    }

    // Seed one phrase template and go live — the dashboard is the demo.
    withMutableSpotter(() => {
        bro.kws.enroll('hello there', bro.tts.phonemize('hello there'), phrasePolicy());
    });
    startListening();
    fusionRow('info', 'tier-2 spotter live on the shared host (template "hello there")');
    status('listening — speak, click, whistle; enroll phrases or record a rhythm gesture');

    requestAnimationFrame(tick);
})();

// Headless test seam: the gesture-enroll path (no live mic to record from)
// plus the timeline internals (history ring, event log, click-to-inspect) so
// the scrollback/marker/detail behaviour is testable without mouse events.
globalThis.listenLab = {
    enrollGesture,
    Stream, events, View, phLabels,
    selectEvent, closeDetail, decodedOver,
};
