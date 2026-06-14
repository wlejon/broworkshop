// Listen Lab — tier-3 transcript (Qwen3-ASR, voice-gated), one per stream.
// (load after timeline.js)
import { LL } from "/app/core.js";
    const fs = require('fs');
    const { $txStat, $txLive, $txLiveEn, $txToggle, $txLines,
            FPS, fusionRow, focusRegion, playRegion, logEvent } = LL;

// ── tier-3 transcript — Qwen3-ASR, voice-gated, rolling realtime ──────────────
// The heaviest tier, armed by the cheapest one: bro.sense's energy VAD decides
// WHEN to wake the model. On voice onset we pull the utterance from the stream's
// retained audio (already 16 kHz, the ASR's rate), re-transcribe a rolling
// window every ~350 ms for live partial words, and commit a final line on voice
// end.
//
// We run Qwen3-ASR (52 languages + language ID) rather than an English-only
// model: it transcribes non-English speech in its source language AND tells us
// WHICH language. Its output is the model's native "language <Lang><asr_text>
// transcript" id stream, so realRun() splits the IDS on asrTextId — the marker
// detokenizes to "" so a text split won't do — into a detected-language string
// and the transcript. The language rides the committed line; diarize.js tags the
// speaker and translate.js renders an English line for non-English speech.
//
// EVERY STREAM transcribes its OWN audio — the mic dashboard and each added
// source each get a transcript CONTEXT (ctx) with an independent voice-gated
// lifecycle. The model is single-op (one decode in flight; a second throws), so
// all contexts feed ONE serialized queue (TxQueue) and run back-to-back. Each
// pass fully decodes its window (the ASR is unconditional), so interleaving
// streams never cross-talk. Only the ACTIVE tab's ctx renders into the shared
// transcript panel; a background stream still accumulates committed lines.

const ASR_CANDIDATES = [
    '../../../brosoundml/weights/qwen-asr/0.6B',
    'D:/projects/brosoundml/weights/qwen-asr/0.6B',
];
const TX_PREROLL = 20;         // frames of pre-voice audio to include (~200 ms)
const TX_ROLL    = 35;         // frames between rolling partial passes (~350 ms)

// ── streaming sentence chunker ────────────────────────────────────────────────
// Continuous speech (a news monologue) never falls silent, so the old "commit on
// voice-end" design let one utterance's rolling re-transcribe window grow without
// bound until it blew past the ASR's ~30 s sweet spot and choked. Instead we SEAL
// sentences mid-utterance: when the partial gains a sentence-final boundary with
// more text after it (and the prefix is stable across two passes), we commit that
// sentence as a line and advance the window start past it — so the window stays
// bounded and a monologue becomes a steady stream of sentence lines.
const TX_MAXWIN  = 2200;       // frames (~22 s) — hard window cap, force a soft seal
const TX_SNAP    = 15;         // frames (~150 ms) — radius to snap a cut to a silence dip
const TX_MINSEAL = 6;          // don't seal a "sentence" shorter than this many chars
// A run of text ending in sentence-final punctuation (ASCII + CJK + ellipsis).
const SENT_RE = /[^.!?。！？…]*[.!?。！？…]+/g;

const Transcribe = {
    model: null, tok: null, asrTextId: -1,
    ready: false, enabled: true,
    stubRun: null,             // headless test seam: a synchronous runner for all ctxs
};

// "language Spanish" / "Spanish" → "Spanish"; empty/unknown → "".
function normLang(raw) { return raw ? raw.replace(/^\s*language\s*/i, '').trim() : ''; }
function langIsEnglish(lang) { return !lang || /^en$|engl/i.test(lang); }

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
            if (job.isFinal) finishUtterance(ctx, text, job.a, job.b, info && info.lang);
            else {
                ctx.tx.partial = text;
                if (info && info.lang) ctx.tx.lang = info.lang;
                renderPartial(ctx);
                maybeSealSentences(ctx, text, job.a, job.b);   // chunker: seal completed sentences
            }
        }
        txDrain();
    };
    const runner = Transcribe.stubRun || ctx.run;
    try {
        runner(job.pcm, {
            onToken: (p, lang) => { ctx.tx.partial = p; ctx.tx.lang = lang || ''; renderPartial(ctx); },
            onDone: finish,
        });
    } catch (e) {
        TxQueue.busy = false;
        if (job.isFinal) finishUtterance(ctx, ctx.tx.partial || '', job.a, job.b);
        txDrain();
    }
}

// Split a partial into COMPLETE sentences (each ending in sentence punctuation)
// plus the trailing in-progress fragment. `end` is the char offset just past each
// sentence — used to anchor the sentence's audio cut proportionally.
function splitComplete(text) {
    const sentences = [];
    let m;
    SENT_RE.lastIndex = 0;
    while ((m = SENT_RE.exec(text))) {
        sentences.push({ text: m[0].trim(), end: SENT_RE.lastIndex });
    }
    const tailStart = sentences.length ? sentences[sentences.length - 1].end : 0;
    return { sentences, tail: text.slice(tailStart).trim() };
}

// Snap a frame to the lowest-energy (quietest) frame within ±TX_SNAP — sentence
// boundaries land in prosodic dips/breaths even in gapless speech, so cutting
// there avoids slicing a word. Energy is read straight off the retained PCM.
function snapToDip(ctx, a, b, f) {
    const lo = Math.max(a + 1, f - TX_SNAP), hi = Math.min(b - 1, f + TX_SNAP);
    if (hi <= lo) return Math.max(a + 1, Math.min(b, f));
    const pcm = ctx.audio(lo, hi);
    if (!pcm || !pcm.length) return f;
    const spf = pcm.length / (hi - lo);              // samples per frame
    let bestF = f, bestE = Infinity;
    for (let fr = lo; fr < hi; fr++) {
        const s0 = Math.floor((fr - lo) * spf), s1 = Math.floor((fr - lo + 1) * spf);
        let e = 0;
        for (let i = s0; i < s1; i++) e += pcm[i] * pcm[i];
        e /= Math.max(1, s1 - s0);
        if (e < bestE) { bestE = e; bestF = fr; }
    }
    return bestF;
}

// Proportional time anchor for a sentence ending at char `endChar` of `total`,
// over the window [a, b], snapped to the nearest silence dip. Small errors
// self-correct: the next window re-transcribes from the cut, recapturing overlap.
function anchorFrame(ctx, a, b, endChar, total) {
    let f = Math.round(a + (endChar / Math.max(1, total)) * (b - a));
    f = Math.max(a + 1, Math.min(b, f));
    return snapToDip(ctx, a, b, f);
}

// Force a soft seal when the window has run past TX_MAXWIN with no sentence
// punctuation (a long unpunctuated run-on): cut at the quietest frame in the
// latter half of the window and commit the text so far as one line.
function forceSeal(ctx, text, a, b) {
    const T = ctx.tx;
    const mid = Math.round(a + 0.5 * (b - a));
    const cutF = snapToDip(ctx, mid, b, Math.round(a + 0.75 * (b - a)));
    if (cutF <= T.sealedFrame) { T.prevPartial = text; return; }
    commitLine(ctx.st, text.trim(), T.sealedFrame, cutF, T.lang);
    T.sealedFrame = cutF; T.startFrame = cutF;
    ctx.tx.partial = ''; T.prevPartial = '';
    renderPartial(ctx);
}

// The chunker, run after every rolling partial pass. Seal each COMPLETE sentence
// that (a) is followed by more text (so the ASR has moved on past it) and (b) was
// already present in the previous pass (stable across two passes, not a churning
// tail). Each sealed sentence becomes its own committed line; the window start
// advances past the last cut so it stays bounded.
function maybeSealSentences(ctx, text, a, b) {
    const T = ctx.tx;
    if (!text || text.length < TX_MINSEAL) { T.prevPartial = text; return; }
    const { sentences, tail } = splitComplete(text);
    if (!sentences.length) {                          // no boundary yet
        if (b - T.startFrame > TX_MAXWIN) forceSeal(ctx, text, a, b);
        else T.prevPartial = text;
        return;
    }
    // Sentences are "complete" only if there's trailing text after the last one;
    // otherwise the final sentence is still the live fragment — leave it for the
    // next pass (or the voice-end final flush).
    const complete = tail ? sentences : sentences.slice(0, -1);
    const prev = T.prevPartial || '';
    let lastCutF = -1, sealedChars = 0;
    for (const s of complete) {
        if (s.text.length < TX_MINSEAL) { sealedChars = s.end; continue; }
        if (prev.indexOf(s.text) < 0) break;          // not yet confirmed by a 2nd pass
        const cutF = anchorFrame(ctx, a, b, s.end, text.length);
        if (cutF <= T.sealedFrame) { sealedChars = s.end; continue; }
        commitLine(ctx.st, s.text, T.sealedFrame, cutF, T.lang);
        T.sealedFrame = cutF; lastCutF = cutF; sealedChars = s.end;
    }
    if (lastCutF >= 0) {
        T.startFrame = lastCutF;                       // bound the window to post-cut audio
        const remaining = text.slice(sealedChars);
        ctx.tx.partial = remaining;
        T.prevPartial = remaining;
        renderPartial(ctx);
    } else {
        T.prevPartial = text;
    }
}

// Wrap bro.stt's async Qwen3-ASR decode into the uniform runner interface; calls
// are serialized by TxQueue so they never overlap. The generated id stream is
// "language <Lang> <asr_text> transcript…" — split on asrTextId (the marker
// detokenizes to ""), decode the language prefix and the transcript separately,
// and stream the post-marker partial as it grows.
function realRun(pcm, cb) {
    const ids = [];
    let cut = -1;                                   // index just past asrTextId in `ids`
    let liveLang = '';                              // detected language, known once the marker passes
    return bro.stt.transcribe(Transcribe.model, pcm, {
        onToken: (id) => {
            ids.push(id);
            if (cut < 0 && id === Transcribe.asrTextId) {
                cut = ids.length;                   // marker is ids[cut-1]; language is ids[0..cut-2]
                liveLang = cut > 1 ? Transcribe.tok.decode(ids.slice(0, cut - 1)).trim() : '';
            }
            if (cb.onToken && cut >= 0 && ids.length > cut)
                cb.onToken(Transcribe.tok.decode(ids.slice(cut)).trim(), liveLang);
        },
        onDone: (res, info) => {
            const arr = res ? Array.from(res) : ids;
            const ci = arr.indexOf(Transcribe.asrTextId);
            const lang = ci > 0 ? Transcribe.tok.decode(arr.slice(0, ci)).trim() : '';
            const text = ci >= 0 ? Transcribe.tok.decode(arr.slice(ci + 1)).trim()
                                 : Transcribe.tok.decode(arr).trim();
            if (cb.onDone) cb.onDone(text, Object.assign({}, info || {}, { lang }));
        },
    });
}

function initTxCtx(ctx) {
    ctx.tx = { active: false, startFrame: 0, lastRunFrame: 0, partial: '', lang: '',
               sealedFrame: 0, prevPartial: '' };
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
        onPartial: (partial, lang) => {
            if (st === LL.active) renderActivePartial(partial);
            // Live streaming translation: hand the growing partial + its detected
            // language to the translator, which updates the live English line.
            if (LL.onLivePartial) LL.onLivePartial(st, partial, lang);
        },
        onCommit: (text, a, b, lang) => commitLine(st, text, a, b, lang),
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
    ctx.onPartial(ctx.tx.partial, ctx.tx.lang);
}

// Render the ACTIVE tab's live English translation under the streaming partial.
// translate.js calls this as coalesced partial translations land; cleared on
// commit/voice-end. `pending` shows a faint cursor while the first pass runs.
function renderActiveLiveEn(text, pending) {
    if (!$txLiveEn) return;
    if (text) {
        $txLiveEn.textContent = '→ ' + text + ' ';
        if (pending) {
            const c = document.createElement('span');
            c.className = 'tlcur'; c.textContent = '…';
            $txLiveEn.appendChild(c);
        }
    } else {
        $txLiveEn.textContent = '';
    }
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
    if (!partial) renderActiveLiveEn('');     // no live transcript → no live translation
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
        row.appendChild(t);
        if (ln.speaker) {                                  // diarized speaker chip
            const sp = document.createElement('span');
            sp.className = 'spk spk' + ((ln.speaker - 1) % 6);
            sp.textContent = 'S' + ln.speaker;
            row.appendChild(sp);
        }
        if (!langIsEnglish(ln.lang)) {                     // detected-language badge
            const lg = document.createElement('span');
            lg.className = 'lang'; lg.textContent = ln.lang;
            row.appendChild(lg);
        }
        const tx = document.createElement('span');
        tx.className = 'tx'; tx.textContent = ln.text;
        row.appendChild(tx);
        if (ln.en) {                                       // English translation line
            const en = document.createElement('span');
            en.className = 'txen' + (ln.refined ? ' refined' : '');
            en.textContent = '→ ' + ln.en;
            row.appendChild(en);
        } else if (ln.enPending) {                          // queued for translation
            const en = document.createElement('span');
            en.className = 'txen pending'; en.textContent = '→ translating…';
            row.appendChild(en);
        }
        row.addEventListener('click', () => {
            focusRegion(ln.a, ln.b);
            playRegion({ a: ln.a, b: ln.b }, lineKey(ln));
            renderLines();
        });
        $txLines.appendChild(row);
    }
}

function finishUtterance(ctx, text, a, b, lang) {
    ctx.tx.active = false;
    ctx.tx.partial = '';
    ctx.onCommit(text, a, b, lang);
    renderPartial(ctx);
    ctx.onStatus('ready · voice-gated', false, false);
}

// Commit a finished utterance to a stream: a replayable transcript line, a
// [heard] fusion row, and a timeline speech marker — all on that stream. The
// line carries the detected language; diarize.js fills in `speaker` and
// translate.js fills in `en` (the English translation) asynchronously, each
// re-rendering when its result lands.
function commitLine(st, text, a, b, lang) {
    if (!text) return;
    // Strip whitespace + CJK/ASCII punctuation to gauge real content. Pure-symbol
    // fragments ("。", "—") are ASR noise between turns — drop them entirely so
    // they don't get a spurious line, language badge, or translation.
    const core = text.replace(/[\s　-〿！-･ -⁯!-\/:-@]+/g, '');
    if (!core) return;
    const meaningful = core.length >= 2;
    let langN = normLang(lang);
    // Per-stream STICKY language: short/odd utterances otherwise flip-flop (a
    // one-syllable grunt in a Japanese stream gets tagged Chinese). Vote with
    // meaningful foreign utterances; once a dominant foreign language is
    // established (≥2 votes), snap every foreign label on this stream to it.
    if (!langIsEnglish(langN)) {
        st.langVotes = st.langVotes || {};
        if (meaningful) st.langVotes[langN] = (st.langVotes[langN] || 0) + 1;
        let dom = '', best = 0;
        for (const k in st.langVotes) if (st.langVotes[k] > best) { best = st.langVotes[k]; dom = k; }
        if (dom && best >= 2) langN = dom;
    }
    const line = { t: b / FPS, text, a, b, lang: langN, speaker: 0, en: null };
    st.txLines.unshift(line);
    while (st.txLines.length > 80) st.txLines.pop();
    fusionRow(st, 'heard', (langIsEnglish(langN) ? '' : '[' + langN + '] ') + '“' + text + '”');
    logEvent(st, 'speech', text, null, '', null,
             { startFrame: a, endFrame: b, matchedFrames: b - a });
    if (LL.assignSpeaker) LL.assignSpeaker(st, line);     // tier-3.5: diarization
    if (LL.maybeTranslate) LL.maybeTranslate(st, line);   // tier-3.5: translation
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
        T.sealedFrame = T.startFrame;     // chunker: nothing sealed yet this utterance
        T.prevPartial = '';
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
    ctx.tx.prevPartial = '';
    ctx._prev = null; ctx._cur = null;
}

function txMaybeReady() {
    if (!Transcribe.model || !Transcribe.tok) return;
    Transcribe.asrTextId = Transcribe.model.asrTextId;
    Transcribe.ready = true;
    fusionRow(LL.active, 'info', 'tier-3 transcript ready — Qwen3-ASR ' +
        (Transcribe.model.sampleRate / 1000) + ' kHz, 52-language + language ID · every stream');
    txSetStatus('ready · voice-gated');
    renderActivePartial('');
}

function txLoad() {
    if (Transcribe.stubRun) return;
    let dir = null;
    for (const p of ASR_CANDIDATES) {
        try { if (fs.existsSync(p + '/config.json')) { dir = fs.realpathSync(p); break; } }
        catch (e) { /* next candidate */ }
    }
    if (!dir) { txSetStatus('Qwen3-ASR weights not found — transcript off', true); return; }
    txSetStatus('loading Qwen3-ASR…');
    try {
        bro.stt.loadQwenAsr(dir, {
            onReady: (m) => { Transcribe.model = m; txMaybeReady(); },
            onError: (e) => txSetStatus('Qwen3-ASR load failed: ' + e, true),
        });
        // The Qwen BPE tokenizer ships with the ASR checkpoint (vocab.json +
        // merges.txt); bro.lm's loader reads it. It is small — load it sync.
        Transcribe.tok = bro.lm.loadTokenizer({
            vocabPath:  dir + '/vocab.json',
            mergesPath: dir + '/merges.txt',
        });
        txMaybeReady();
    } catch (e) {
        txSetStatus('Qwen3-ASR load failed: ' + (e.message || e), true);
    }
}

    Object.assign(LL, {
        Transcribe, makeTxCtx, initTxCtx, realRun, txReset,
        txSetStatus, renderPartial, renderActivePartial, renderActiveLiveEn, renderLines,
        finishUtterance, transcribeTick, txMaybeReady, txLoad,
        normLang, langIsEnglish, maybeSealSentences,
    });
