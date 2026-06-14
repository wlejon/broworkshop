// Listen Lab — tier-3 transcript (Parakeet, voice-gated) + transcript ownership.
// (load after timeline.js)
;(function () {
    const LL = globalThis.LL;
    const fs = require('fs');
    const { $txStat, $txLive, $txToggle, $txLines,
            FPS, fusionRow, Stream, Playback, focusRegion, playRegion, logEvent } = LL;

// ── tier-3 transcript — Parakeet STT, voice-gated, rolling realtime ───────────
// The heaviest tier, armed by the cheapest one: bro.sense's energy VAD decides
// WHEN to wake the model. On voice onset we pull the utterance straight from the
// retained shared stream (bro.listen.audio — already 16 kHz, Parakeet's rate, no
// extra tap or buffer), re-transcribe a rolling window every ~350 ms for live
// partial words, and commit a final line when voice ends. Parakeet is a TDT
// transducer — streaming-shaped and faster than realtime — so each pass is
// cheap; VAD-gating keeps it dormant in silence and bounds every utterance, so
// the rolling re-runs never grow without limit. One model call is in flight at a
// time (busy-gated, no overlap), so we never trip bro.stt's single-op rule.

const PARA_CANDIDATES = [
    '../../../brosoundml/weights/parakeet/0.6b-v3',
    'D:/projects/brosoundml/weights/parakeet/0.6b-v3',
];
const TX_PREROLL = 20;         // frames of pre-voice audio to include (~200 ms)
const TX_ROLL    = 35;         // frames between rolling partial passes (~350 ms)

const Transcribe = {
    model: null, tok: null,
    ready: false, enabled: true, busy: false,
    active: false,             // inside a voiced utterance
    startFrame: 0,             // utterance start, on the shared stream/sense axis
    lastRunFrame: 0,           // frame the last rolling pass was kicked at
    pendingFinal: null,        // an end frame queued behind an in-flight pass
    partial: '',               // live partial text for the current utterance
    lines: [],                 // committed { t, text, a, b }
    // The model runner — (pcm, { onToken(partialText), onDone(text, info) }).
    // Real path decodes Parakeet ids incrementally; the headless test swaps in a
    // synchronous stub so the VAD-gated lifecycle is testable without the 2.4 GB
    // model load (the real path is exercised by the app + parakeet-lab).
    run: null,
    // Parakeet is single-op: only ONE source is transcribed at a time. `source`
    // is the current owner — an adapter exposing audio()/frame()/oldest()/
    // active() over a stream plus onPartial/onCommit/onStatus UI routing. The
    // primary mic dashboard owns it by default (PrimarySource); a stream card
    // can take it over (and hand it back) via its transcript toggle.
    source: null,
};

// The primary mic dashboard as a transcript source: pulls from the shared
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
Transcribe.source = PrimarySource;     // the primary mic owns transcript by default

// Wrap bro.stt's async Parakeet decode into the uniform runner interface:
// accumulate emitted ids, decode the running prefix to text on each token, and
// hand the committed transcript back on done.
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

function txSetStatus(text, err, live) {
    $txStat.textContent = text;
    $txStat.className = 'txstat' + (err ? ' err' : live ? ' live' : '');
    $txToggle.disabled = !Transcribe.ready;
    $txToggle.textContent = Transcribe.enabled ? '⏸' : '▶';
}

// The live partial is held to ONE line: keep the TAIL (newest words) so a long
// in-progress utterance doesn't wrap and shove the panel around (that growth was
// the "lines clobber each other" the list seemed to do).
const TX_PARTIAL_MAX = 96;

// Render the current owner's partial. The transcriber is a singleton, so this
// routes through whichever source owns it (primary panel or a stream card).
function renderPartial() {
    (Transcribe.source || PrimarySource).onPartial(Transcribe.partial);
}

function primaryRenderPartial(partial) {
    if (partial) {
        let p = partial;
        if (p.length > TX_PARTIAL_MAX) p = '…' + p.slice(p.length - TX_PARTIAL_MAX);
        $txLive.textContent = p + ' ';
        const cur = document.createElement('span');
        cur.className = 'cur'; cur.textContent = '▌';
        $txLive.appendChild(cur);
    } else if (Transcribe.active) {
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

// Commit a finished utterance: a transcript line (replayable), a [heard] fusion
// row, and a speech marker on the timeline (click it to inspect / replay, and to
// see what the phoneme model decoded over the SAME span — a cross-check).
function finishUtterance(text, a, b) {
    Transcribe.active = false;
    Transcribe.partial = '';
    (Transcribe.source || PrimarySource).onCommit(text, a, b);
    renderPartial();
    (Transcribe.source || PrimarySource).onStatus('ready · voice-gated', false, false);
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

// Run one transcription pass over [startFrame, endFrame] of the retained stream.
// Serialized on Transcribe.busy: a rolling pass that arrives while one is in
// flight is dropped (partials are best-effort); a final commit is queued
// (pendingFinal) and kicked the moment the current pass frees up, so the line is
// never lost.
function txKick(endFrame, isFinal) {
    const src = Transcribe.source || PrimarySource;
    if (Transcribe.busy) { if (isFinal) Transcribe.pendingFinal = endFrame; return; }
    const a = Math.max(Math.round(Transcribe.startFrame), src.oldest());
    const b = Math.min(Math.round(endFrame), src.frame());
    if (b - a < 1) { if (isFinal) finishUtterance('', a, b); return; }
    const pcm = src.audio(a, b);
    if (!pcm || !pcm.length) { if (isFinal) finishUtterance('', a, b); return; }
    Transcribe.busy = true;
    let done = false;
    const finish = (text, info) => {
        if (done) return;
        done = true;
        Transcribe.busy = false;
        if (Transcribe.pendingFinal != null) {
            const pf = Transcribe.pendingFinal; Transcribe.pendingFinal = null;
            txKick(pf, true);
            return;                 // this (rolling/cancelled) result yields to the final
        }
        if (info && info.cancelled) return;
        if (isFinal) finishUtterance(text, a, b);
        else { Transcribe.partial = text; renderPartial(); }
    };
    try {
        Transcribe.run(pcm, {
            onToken: (p) => { Transcribe.partial = p; renderPartial(); },
            onDone: finish,
        });
    } catch (e) {
        // bro.stt rejects a second in-flight op — treat as a skip; queue the final.
        Transcribe.busy = false;
        if (isFinal) finishUtterance(Transcribe.partial || '', a, b);
    }
}

// Edge-driven from the poll loop: voice onset arms an utterance, rolling passes
// stream partial words while voice holds, voice offset commits the final line.
function transcribeTick(prev, s, src) {
    if (!Transcribe.ready || !Transcribe.enabled) return;
    if (!s) return;
    if (!src.active()) return;                     // needs the retained stream
    const rising = s.voice && (!prev || !prev.voice);
    const falling = prev && prev.voice && !s.voice;
    if (rising) {
        Transcribe.active = true;
        Transcribe.startFrame = Math.max(src.oldest(), s.frames - TX_PREROLL);
        Transcribe.lastRunFrame = s.frames;
        Transcribe.partial = '';
        renderPartial();
        txSetStatus('listening…', false, true);
    }
    if (Transcribe.active && s.voice && s.frames - Transcribe.lastRunFrame >= TX_ROLL) {
        Transcribe.lastRunFrame = s.frames;
        txKick(s.frames, false);
    }
    if (falling && Transcribe.active) txKick(s.frames, true);
}

function txMaybeReady() {
    if (!Transcribe.model || !Transcribe.tok) return;
    Transcribe.ready = true;
    fusionRow('info', 'tier-3 transcript ready — Parakeet ' +
        (Transcribe.model.sampleRate / 1000) + ' kHz, voice-gated');
    txSetStatus('ready · voice-gated');
    renderPartial();
}

// Load Parakeet + its tokenizer (both async, non-blocking — the dashboard stays
// live during the weight upload). Independent of the PhonemeNet checkpoint: the
// transcript tier needs only bro.sense (voice VAD) + the retained stream.
function txLoad() {
    if (Transcribe.run) return;     // a runner is already installed (e.g. a test stub)
    let dir = null;
    for (const p of PARA_CANDIDATES) {
        try { if (fs.existsSync(p + '/config.json')) { dir = fs.realpathSync(p); break; } }
        catch (e) { /* next candidate */ }
    }
    if (!dir) { txSetStatus('Parakeet weights not found — transcript off', true); return; }
    Transcribe.run = realRun;
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

// ── transcript ownership (single-op) ──────────────────────────────────────────
// Parakeet is one model: only one source transcribes at a time. A stream taking
// transcript steals it from whoever held it (the primary, or another stream).

function setTranscriptOwner(src) {
    if (Transcribe.source === src) return;
    Transcribe.active = false;
    Transcribe.partial = '';
    Transcribe.source = src;
    src._prev = null; src._cur = null;        // don't fire on a stale falling edge
    const onPrimary = src === PrimarySource;
    $txToggle.disabled = !Transcribe.ready || !onPrimary;
    if (onPrimary) {
        renderPartial();
        txSetStatus(Transcribe.ready ? 'ready · voice-gated' : '…');
    } else {
        // Hand-off note in the rich panel; the stream card drives the partials.
        $txLive.innerHTML = '<span class="ph">— transcript handed to stream “' +
            src.name + '” —</span>';
        $txStat.textContent = 'on stream “' + src.name + '”';
        $txStat.className = 'txstat';
    }
}

    Object.assign(LL, {
        Transcribe, PrimarySource, realRun, txSetStatus, renderPartial, renderLines,
        finishUtterance, transcribeTick, txMaybeReady, txLoad, setTranscriptOwner,
    });
})();
