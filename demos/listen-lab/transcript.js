// Listen Lab — tier-3 transcript (Parakeet, voice-gated), concurrent per stream.
// (load after timeline.js)
;(function () {
    const LL = globalThis.LL;
    const fs = require('fs');
    const { $txStat, $txLive, $txToggle, $txLines,
            FPS, fusionRow, Stream, Playback, focusRegion, playRegion, logEvent } = LL;

// ── tier-3 transcript — Parakeet STT, voice-gated, rolling realtime ───────────
// The heaviest tier, armed by the cheapest one: bro.sense's energy VAD decides
// WHEN to wake the model. On voice onset we pull the utterance straight from the
// retained stream (already 16 kHz, Parakeet's rate, no extra tap), re-transcribe
// a rolling window every ~350 ms for live partial words, and commit a final line
// when voice ends. Parakeet is a TDT transducer — streaming-shaped and faster
// than realtime — so each pass is cheap; VAD-gating keeps it dormant in silence
// and bounds every utterance, so the rolling re-runs never grow without limit.
//
// CONCURRENCY: the mic dashboard and every stream each transcribe their OWN
// audio at the same time. Each gets an independent transcript CONTEXT (ctx) with
// its own voice-gated lifecycle and partial/commit state. The model itself is
// single-op (one decode in flight at a time — a second concurrent call throws),
// so all contexts feed ONE serialized queue (TxQueue): jobs run back-to-back,
// never overlapping. Each pass fully decodes its window (Parakeet is
// unconditional), so interleaving contexts never cross-talks. This replaces the
// old single-owner model where a second stream "stole" the transcriber (and a
// stuck busy-flag on the hand-off left BOTH streams unable to transcribe).

const PARA_CANDIDATES = [
    '../../../brosoundml/weights/parakeet/0.6b-v3',
    'D:/projects/brosoundml/weights/parakeet/0.6b-v3',
];
const TX_PREROLL = 20;         // frames of pre-voice audio to include (~200 ms)
const TX_ROLL    = 35;         // frames between rolling partial passes (~350 ms)

// Shared transcript runtime: the loaded model + tokenizer + global ready/enable
// flags. `lines` is the PRIMARY (mic) dashboard's committed transcript — the
// rich panel renders it; stream contexts surface their commits on their own UI.
const Transcribe = {
    model: null, tok: null,
    ready: false, enabled: true,
    lines: [],                 // primary committed { t, text, a, b }
    stubRun: null,             // headless test seam: a synchronous runner for all ctxs
};

// ── the serialized model queue ────────────────────────────────────────────────
// One in-flight decode at a time across ALL contexts. Rolling (partial) jobs for
// a context collapse to the latest (partials are best-effort); final jobs always
// run so no committed line is lost.
const TxQueue = { q: [], busy: false };

function txEnqueue(ctx, pcm, isFinal, a, b) {
    const job = { ctx, pcm, isFinal, a, b };
    if (!isFinal) {
        const i = TxQueue.q.findIndex((j) => j.ctx === ctx && !j.isFinal);
        if (i >= 0) { TxQueue.q[i] = job; txDrain(); return; }
    }
    TxQueue.q.push(job);
    txDrain();
}

function txDrain() {
    if (TxQueue.busy || !TxQueue.q.length) return;
    const job = TxQueue.q.shift();
    const ctx = job.ctx;
    TxQueue.busy = true;
    let done = false;
    const finish = (text, info) => {
        if (done) return;
        done = true;
        TxQueue.busy = false;
        if (!(info && info.cancelled)) {
            if (job.isFinal) finishUtterance(ctx, text, job.a, job.b);
            else { ctx.tx.partial = text; renderPartial(ctx); }
        }
        txDrain();
    };
    const runner = Transcribe.stubRun || ctx.run;
    try {
        runner(job.pcm, {
            onToken: (p) => { ctx.tx.partial = p; renderPartial(ctx); },
            onDone: finish,
        });
    } catch (e) {
        // A model that rejects (e.g. an unexpected second in-flight op) — drop to
        // a best-effort commit and keep the queue moving.
        TxQueue.busy = false;
        if (job.isFinal) finishUtterance(ctx, ctx.tx.partial || '', job.a, job.b);
        txDrain();
    }
}

// Wrap bro.stt's async Parakeet decode into the uniform runner interface:
// accumulate emitted ids, decode the running prefix on each token, hand the
// committed transcript back on done. Each ctx gets its own runner bound to the
// shared model; calls are serialized by TxQueue so they never overlap.
function realRun(pcm, cb) {
    const acc = [];
    return bro.stt.transcribe(Transcribe.model, pcm, {
        onToken: (id) => {
            acc.push(id);
            if (cb.onToken) cb.onToken(Transcribe.tok.decode(acc).trim());
        },
        onDone: (res, info) => {
            const text = (res && res.tokenIds && res.tokenIds.length)
                ? Transcribe.tok.decode(res.tokenIds).trim() : '';
            if (cb.onDone) cb.onDone(text, info || {});
        },
    });
}

// Attach a fresh voice-gated transcript state to a context (the primary mic, or
// a stream). A ctx supplies the audio plumbing — audio(a,b)/frame()/oldest()/
// active() — plus UI routing (onPartial/onCommit/onStatus); this adds the
// lifecycle state + the model runner. _prev/_cur are the driver's sensor
// snapshots (set each frame before transcribeTick).
function initTxCtx(ctx) {
    ctx.tx = { active: false, startFrame: 0, lastRunFrame: 0, partial: '' };
    if (!ctx.run) ctx.run = realRun;
    ctx._prev = ctx._prev || null;
    ctx._cur = ctx._cur || null;
    return ctx;
}

// The primary mic dashboard as a transcript context: pulls from the shared
// default stream (bro.listen + bro.sense) and routes output to the rich
// transcript panel (lines list, timeline speech markers, [heard] feed rows).
const PrimarySource = {
    id: 'primary', name: 'mic', _prev: null, _cur: null,
    audio: (a, b) => bro.listen.audio(a, b),
    frame: () => bro.listen.frame(),
    oldest: () => Stream.oldestFrame(),
    active: () => bro.listen.info().active,
    onPartial: primaryRenderPartial,
    onCommit: primaryCommitLine,
    onStatus: (text, err, live) => txSetStatus(text, err, live),
};
initTxCtx(PrimarySource);

function txSetStatus(text, err, live) {
    $txStat.textContent = text;
    $txStat.className = 'txstat' + (err ? ' err' : live ? ' live' : '');
    $txToggle.disabled = !Transcribe.ready;
    $txToggle.textContent = Transcribe.enabled ? '⏸' : '▶';
}

// The live partial is held to ONE line: keep the TAIL (newest words) so a long
// in-progress utterance doesn't wrap and shove the panel around.
const TX_PARTIAL_MAX = 96;

// Render a context's partial through whichever UI it owns.
function renderPartial(ctx) {
    ctx.onPartial(ctx.tx.partial);
}

function primaryRenderPartial(partial) {
    if (partial) {
        let p = partial;
        if (p.length > TX_PARTIAL_MAX) p = '…' + p.slice(p.length - TX_PARTIAL_MAX);
        $txLive.textContent = p + ' ';
        const cur = document.createElement('span');
        cur.className = 'cur'; cur.textContent = '▌';
        $txLive.appendChild(cur);
    } else if (PrimarySource.tx.active) {
        $txLive.innerHTML = '<span class="cur">▌</span>';
    } else {
        $txLive.innerHTML = '<span class="ph">— speak; words appear here while voice is active —</span>';
    }
}

const lineKey = (ln) => ln.a + '-' + ln.b;

// Each committed line is the INDEX into the timeline: a single ellipsized row
// that, clicked, scrubs the timeline to where it was said and plays it with a
// swept playhead. The row driving the current playback is highlighted.
function renderLines() {
    $txLines.innerHTML = '';
    for (const ln of Transcribe.lines) {
        const row = document.createElement('div');
        row.className = 'txline' +
            (Playback.active && Playback.key === lineKey(ln) ? ' playing' : '');
        row.title = 'jump to the timeline and play';
        const mm = Math.floor(ln.t / 60), ss = Math.floor(ln.t % 60);
        const t = document.createElement('span');
        t.className = 'tt'; t.textContent = mm + ':' + String(ss).padStart(2, '0');
        const tx = document.createElement('span');
        tx.className = 'tx'; tx.textContent = ln.text;
        row.append(t, tx);
        row.addEventListener('click', () => {
            focusRegion(ln.a, ln.b);
            playRegion({ a: ln.a, b: ln.b }, lineKey(ln));
            renderLines();          // reflect the new playing row immediately
        });
        $txLines.appendChild(row);
    }
}

// Commit a finished utterance for a context: clear the partial, route the text
// to the ctx's UI, and reset the live partial.
function finishUtterance(ctx, text, a, b) {
    ctx.tx.active = false;
    ctx.tx.partial = '';
    ctx.onCommit(text, a, b);
    renderPartial(ctx);
    ctx.onStatus('ready · voice-gated', false, false);
}

// Primary owner: a replayable transcript line + a timeline speech marker + a
// [heard] fusion row (the rich panel). a/b are on the shared stream axis.
function primaryCommitLine(text, a, b) {
    if (!text) return;
    Transcribe.lines.unshift({ t: b / FPS, text, a, b });
    while (Transcribe.lines.length > 80) Transcribe.lines.pop();
    fusionRow('heard', '“' + text + '”');
    logEvent('speech', text, null, '', null,
             { startFrame: a, endFrame: b, matchedFrames: b - a });
    renderLines();
}

// Queue one transcription pass over [startFrame, endFrame] of the ctx's retained
// stream. A rolling pass is collapsed (best-effort); a final commit is always
// queued so the line is never lost.
function txKick(ctx, endFrame, isFinal) {
    const T = ctx.tx;
    const a = Math.max(Math.round(T.startFrame), ctx.oldest());
    const b = Math.min(Math.round(endFrame), ctx.frame());
    if (b - a < 1) { if (isFinal) finishUtterance(ctx, '', a, b); return; }
    const pcm = ctx.audio(a, b);
    if (!pcm || !pcm.length) { if (isFinal) finishUtterance(ctx, '', a, b); return; }
    txEnqueue(ctx, pcm, isFinal, a, b);
}

// Edge-driven from the poll loop, ONCE PER CONTEXT: voice onset arms an
// utterance, rolling passes stream partial words while voice holds, voice offset
// commits the final line. The driver sets ctx._prev/_cur before calling.
function transcribeTick(ctx) {
    if (!Transcribe.ready || !Transcribe.enabled) return;
    const prev = ctx._prev, s = ctx._cur;
    if (!s) return;
    if (!ctx.active()) return;                      // needs the retained stream
    const T = ctx.tx;
    const rising = s.voice && (!prev || !prev.voice);
    const falling = prev && prev.voice && !s.voice;
    if (rising) {
        T.active = true;
        T.startFrame = Math.max(ctx.oldest(), s.frames - TX_PREROLL);
        T.lastRunFrame = s.frames;
        T.partial = '';
        renderPartial(ctx);
        ctx.onStatus('listening…', false, true);
    }
    if (T.active && s.voice && s.frames - T.lastRunFrame >= TX_ROLL) {
        T.lastRunFrame = s.frames;
        txKick(ctx, s.frames, false);
    }
    if (falling && T.active) txKick(ctx, s.frames, true);
}

// Stop driving a context's transcript (toggle off / stream removed): drop any
// in-progress utterance so a stale falling edge never commits later.
function txReset(ctx) {
    ctx.tx.active = false;
    ctx.tx.partial = '';
    ctx._prev = null; ctx._cur = null;
}

function txMaybeReady() {
    if (!Transcribe.model || !Transcribe.tok) return;
    Transcribe.ready = true;
    fusionRow('info', 'tier-3 transcript ready — Parakeet ' +
        (Transcribe.model.sampleRate / 1000) + ' kHz, voice-gated');
    txSetStatus('ready · voice-gated');
    renderPartial(PrimarySource);
}

// Load Parakeet + its tokenizer (both async, non-blocking — the dashboard stays
// live during the weight upload). Independent of the PhonemeNet checkpoint: the
// transcript tier needs only bro.sense (voice VAD) + the retained stream.
function txLoad() {
    if (Transcribe.stubRun) return;   // a test stub is installed — don't load the model
    let dir = null;
    for (const p of PARA_CANDIDATES) {
        try { if (fs.existsSync(p + '/config.json')) { dir = fs.realpathSync(p); break; } }
        catch (e) { /* next candidate */ }
    }
    if (!dir) { txSetStatus('Parakeet weights not found — transcript off', true); return; }
    txSetStatus('loading Parakeet…');
    try {
        bro.stt.loadParakeet(dir, {
            onReady: (m) => { Transcribe.model = m; txMaybeReady(); },
            onError: (e) => txSetStatus('Parakeet load failed: ' + e, true),
        });
        bro.stt.loadParakeetTokenizer(dir + '/tokenizer.json', {
            onReady: (t) => { Transcribe.tok = t; txMaybeReady(); },
            onError: (e) => txSetStatus('Parakeet tokenizer failed: ' + e, true),
        });
    } catch (e) {
        txSetStatus('Parakeet load failed: ' + (e.message || e), true);
    }
}

    Object.assign(LL, {
        Transcribe, PrimarySource, realRun, initTxCtx, txReset,
        txSetStatus, renderPartial, renderLines,
        finishUtterance, transcribeTick, txMaybeReady, txLoad,
    });
})();
