// Listen Lab — tier-3 transcript (Parakeet, voice-gated), one per stream.
// (load after timeline.js)
;(function () {
    const LL = globalThis.LL;
    const fs = require('fs');
    const { $txStat, $txLive, $txToggle, $txLines,
            FPS, fusionRow, focusRegion, playRegion, logEvent } = LL;

// ── tier-3 transcript — Parakeet STT, voice-gated, rolling realtime ───────────
// The heaviest tier, armed by the cheapest one: bro.sense's energy VAD decides
// WHEN to wake the model. On voice onset we pull the utterance from the stream's
// retained audio (already 16 kHz, Parakeet's rate), re-transcribe a rolling
// window every ~350 ms for live partial words, and commit a final line on voice
// end.
//
// EVERY STREAM transcribes its OWN audio — the mic dashboard and each added
// source each get a transcript CONTEXT (ctx) with an independent voice-gated
// lifecycle. The model is single-op (one decode in flight; a second throws), so
// all contexts feed ONE serialized queue (TxQueue) and run back-to-back. Each
// pass fully decodes its window (Parakeet is unconditional), so interleaving
// streams never cross-talk. Only the ACTIVE tab's ctx renders into the shared
// transcript panel; a background stream still accumulates committed lines.

const PARA_CANDIDATES = [
    '../../../brosoundml/weights/parakeet/0.6b-v3',
    'D:/projects/brosoundml/weights/parakeet/0.6b-v3',
];
const TX_PREROLL = 20;         // frames of pre-voice audio to include (~200 ms)
const TX_ROLL    = 35;         // frames between rolling partial passes (~350 ms)

const Transcribe = {
    model: null, tok: null,
    ready: false, enabled: true,
    stubRun: null,             // headless test seam: a synchronous runner for all ctxs
};

// ── the serialized model queue ────────────────────────────────────────────────
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
        TxQueue.busy = false;
        if (job.isFinal) finishUtterance(ctx, ctx.tx.partial || '', job.a, job.b);
        txDrain();
    }
}

// Wrap bro.stt's async Parakeet decode into the uniform runner interface; calls
// are serialized by TxQueue so they never overlap.
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

function initTxCtx(ctx) {
    ctx.tx = { active: false, startFrame: 0, lastRunFrame: 0, partial: '' };
    if (!ctx.run) ctx.run = realRun;
    ctx._prev = ctx._prev || null;
    ctx._cur = ctx._cur || null;
    return ctx;
}

// Build the transcript context for a stream: audio plumbing over the stream's
// retained buffer + its ring, and UI routing that only touches the shared panel
// when this stream is the active tab.
function makeTxCtx(st) {
    const ctx = {
        id: 'tx-' + st.id, name: st.label, st, _prev: null, _cur: null,
        audio: (a, b) => st.source.listen.audio(a, b),
        frame: () => st.source.listen.frame(),
        oldest: () => st.ring.oldestFrame(),
        active: () => st.source.listen.info().active,
        onPartial: (partial) => { if (st === LL.active) renderActivePartial(partial); },
        onCommit: (text, a, b) => commitLine(st, text, a, b),
        onStatus: (text, err, live) => { if (st === LL.active) txSetStatus(text, err, live); },
    };
    initTxCtx(ctx);
    return ctx;
}

function txSetStatus(text, err, live) {
    $txStat.textContent = text;
    $txStat.className = 'txstat' + (err ? ' err' : live ? ' live' : '');
    $txToggle.disabled = !Transcribe.ready;
    $txToggle.textContent = Transcribe.enabled ? '⏸' : '▶';
}

const TX_PARTIAL_MAX = 96;

function renderPartial(ctx) {
    ctx.onPartial(ctx.tx.partial);
}

// Render the ACTIVE tab's live partial into the shared transcript panel.
function renderActivePartial(partial) {
    const ctx = LL.active && LL.active.txCtx;
    if (partial) {
        let p = partial;
        if (p.length > TX_PARTIAL_MAX) p = '…' + p.slice(p.length - TX_PARTIAL_MAX);
        $txLive.textContent = p + ' ';
        const cur = document.createElement('span');
        cur.className = 'cur'; cur.textContent = '▌';
        $txLive.appendChild(cur);
    } else if (ctx && ctx.tx.active) {
        $txLive.innerHTML = '<span class="cur">▌</span>';
    } else {
        $txLive.innerHTML = '<span class="ph">— speak; words appear here while voice is active —</span>';
    }
}

const lineKey = (ln) => ln.a + '-' + ln.b;

// Render the ACTIVE tab's committed lines. Each is a timeline index: clicked, it
// scrubs the (active) timeline to where it was said and plays it.
function renderLines() {
    const st = LL.active;
    $txLines.innerHTML = '';
    if (!st) return;
    for (const ln of st.txLines) {
        const row = document.createElement('div');
        row.className = 'txline' +
            (st.playback.active && st.playback.key === lineKey(ln) ? ' playing' : '');
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
            renderLines();
        });
        $txLines.appendChild(row);
    }
}

function finishUtterance(ctx, text, a, b) {
    ctx.tx.active = false;
    ctx.tx.partial = '';
    ctx.onCommit(text, a, b);
    renderPartial(ctx);
    ctx.onStatus('ready · voice-gated', false, false);
}

// Commit a finished utterance to a stream: a replayable transcript line, a
// [heard] fusion row, and a timeline speech marker — all on that stream.
function commitLine(st, text, a, b) {
    if (!text) return;
    st.txLines.unshift({ t: b / FPS, text, a, b });
    while (st.txLines.length > 80) st.txLines.pop();
    fusionRow(st, 'heard', '“' + text + '”');
    logEvent(st, 'speech', text, null, '', null,
             { startFrame: a, endFrame: b, matchedFrames: b - a });
    if (st === LL.active) renderLines();
}

function txKick(ctx, endFrame, isFinal) {
    const T = ctx.tx;
    const a = Math.max(Math.round(T.startFrame), ctx.oldest());
    const b = Math.min(Math.round(endFrame), ctx.frame());
    if (b - a < 1) { if (isFinal) finishUtterance(ctx, '', a, b); return; }
    const pcm = ctx.audio(a, b);
    if (!pcm || !pcm.length) { if (isFinal) finishUtterance(ctx, '', a, b); return; }
    txEnqueue(ctx, pcm, isFinal, a, b);
}

// Edge-driven from the poll loop, once per context. The driver sets
// ctx._prev/_cur (the stream's sensor snapshots) before calling.
function transcribeTick(ctx) {
    if (!Transcribe.ready || !Transcribe.enabled) return;
    const prev = ctx._prev, s = ctx._cur;
    if (!s) return;
    if (!ctx.active()) return;
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

function txReset(ctx) {
    ctx.tx.active = false;
    ctx.tx.partial = '';
    ctx._prev = null; ctx._cur = null;
}

function txMaybeReady() {
    if (!Transcribe.model || !Transcribe.tok) return;
    Transcribe.ready = true;
    fusionRow(LL.active, 'info', 'tier-3 transcript ready — Parakeet ' +
        (Transcribe.model.sampleRate / 1000) + ' kHz, voice-gated · every stream');
    txSetStatus('ready · voice-gated');
    renderActivePartial('');
}

function txLoad() {
    if (Transcribe.stubRun) return;
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
        Transcribe, makeTxCtx, initTxCtx, realRun, txReset,
        txSetStatus, renderPartial, renderActivePartial, renderLines,
        finishUtterance, transcribeTick, txMaybeReady, txLoad,
    });
})();
