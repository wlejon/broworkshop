// Listen Lab — tier-3 transcript (Qwen3-ASR, voice-gated), one per stream.
//
// The heaviest tier, armed by the cheapest one: bro.sense's energy VAD decides
// WHEN to wake the model. On voice onset we pull the utterance from the
// stream's retained audio (already 16 kHz, the ASR's rate), re-transcribe a
// rolling window every ~350 ms for live partial words, and commit a final line
// on voice end.
//
// We run Qwen3-ASR (52 languages + language ID) rather than an English-only
// model: it transcribes non-English speech in its source language AND tells us
// WHICH language. Its output is the model's native "language <Lang><asr_text>
// transcript" id stream, so realRun() splits the IDS on asrTextId (the marker
// detokenizes to "", so a text split won't do) into a detected-language string
// and the transcript. The language rides the committed line; diarize.js tags
// the speaker and translate.js renders an English line for non-English speech
// (both through the hook lists below, which lab.js fills).
//
// EVERY STREAM transcribes its OWN audio: the mic dashboard and each added
// source get a transcript CONTEXT (ctx) with an independent voice-gated
// lifecycle. The model is single-op (one decode in flight; a second throws), so
// all contexts feed ONE serialized queue (TxQueue) and run back-to-back. Each
// pass fully decodes its window (the ASR is unconditional), so interleaving
// streams never cross-talk. Only the ACTIVE tab's ctx renders into the shared
// transcript panel; a background stream still accumulates committed lines.

import { h, clear } from "/lib/kit/dom.js";
import { findWeights } from "/lib/kit/weights.js";
import { D, FPS, app, fusionRow } from "/app/state.js";
import { logEvent, focusRegion } from "/app/ring.js";
import { playRegion } from "/app/detail.js";

const ASR_WEIGHTS = ['brosoundml/weights/qwen-asr/0.6B'];
const TX_PREROLL = 20;         // frames of pre-voice audio to include (~200 ms)
const TX_ROLL    = 35;         // frames between rolling partial passes (~350 ms)

// ── streaming sentence chunker ──────────────────────────────────────────────
// Continuous speech (a news monologue) never falls silent, so a "commit on
// voice-end" design lets one utterance's rolling window grow without bound past
// the ASR's ~30 s sweet spot. Instead we SEAL sentences mid-utterance: when the
// partial gains a sentence-final boundary with more text after it (and the
// prefix is stable across two passes), that sentence commits as a line and the
// window start advances past it, so a monologue becomes a steady stream of lines.
const TX_MAXWIN  = 2200;       // frames (~22 s): hard window cap, force a soft seal
const TX_SNAP    = 15;         // frames (~150 ms): radius to snap a cut to a silence dip
const TX_MINSEAL = 6;          // don't seal a "sentence" shorter than this many chars
const SENT_RE = /[^.!?。！？…]*[.!?。！？…]+/g;

export const Transcribe = {
    model: null, tok: null, asrTextId: -1,
    ready: false, enabled: true,
    stubRun: null,             // test seam: a synchronous runner for all ctxs
};

/** Hooks lab.js fills: (st, line) on every committed line, (st, partial, lang) on every partial. */
export const commitHooks = [];
export const partialHooks = [];

/** "language Spanish" / "Spanish" -> "Spanish"; empty/unknown -> "". */
export function normLang(raw) { return raw ? raw.replace(/^\s*language\s*/i, '').trim() : ''; }
export function langIsEnglish(lang) { return !lang || /^en$|engl/i.test(lang); }

// ── the serialized model queue ──────────────────────────────────────────────
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
                maybeSealSentences(ctx, text, job.a, job.b);
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

/** COMPLETE sentences (with the char offset just past each) + the trailing fragment. */
function splitComplete(text) {
    const sentences = [];
    let m;
    SENT_RE.lastIndex = 0;
    while ((m = SENT_RE.exec(text))) sentences.push({ text: m[0].trim(), end: SENT_RE.lastIndex });
    const tailStart = sentences.length ? sentences[sentences.length - 1].end : 0;
    return { sentences, tail: text.slice(tailStart).trim() };
}

/**
 * Snap a frame to the quietest frame within ±TX_SNAP: sentence boundaries land
 * in prosodic dips even in gapless speech, so cutting there avoids slicing a
 * word. Energy is read straight off the retained PCM.
 */
function snapToDip(ctx, a, b, f) {
    const lo = Math.max(a + 1, f - TX_SNAP), hi = Math.min(b - 1, f + TX_SNAP);
    if (hi <= lo) return Math.max(a + 1, Math.min(b, f));
    const pcm = ctx.audio(lo, hi);
    if (!pcm || !pcm.length) return f;
    const spf = pcm.length / (hi - lo);
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

/** Proportional time anchor for a sentence ending at char `endChar` of `total`, snapped to a dip. */
function anchorFrame(ctx, a, b, endChar, total) {
    let f = Math.round(a + (endChar / Math.max(1, total)) * (b - a));
    f = Math.max(a + 1, Math.min(b, f));
    return snapToDip(ctx, a, b, f);
}

/** Past TX_MAXWIN with no punctuation: cut at the quietest late frame, commit the text so far. */
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

/**
 * The chunker, run after every rolling partial pass. Seal each COMPLETE
 * sentence that (a) is followed by more text and (b) was already present in
 * the previous pass. Each becomes its own committed line; the window start
 * advances past the last cut so it stays bounded.
 */
export function maybeSealSentences(ctx, text, a, b) {
    const T = ctx.tx;
    if (!text || text.length < TX_MINSEAL) { T.prevPartial = text; return; }
    const { sentences, tail } = splitComplete(text);
    if (!sentences.length) {
        if (b - T.startFrame > TX_MAXWIN) forceSeal(ctx, text, a, b);
        else T.prevPartial = text;
        return;
    }
    // Without trailing text the last sentence is still the live fragment.
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
        T.startFrame = lastCutF;
        const remaining = text.slice(sealedChars);
        ctx.tx.partial = remaining;
        T.prevPartial = remaining;
        renderPartial(ctx);
    } else {
        T.prevPartial = text;
    }
}

/**
 * bro.stt's async Qwen3-ASR decode behind the uniform runner interface
 * (serialized by TxQueue). Split the id stream on asrTextId: the language
 * prefix and the transcript decode separately, and the post-marker partial
 * streams as it grows.
 */
function realRun(pcm, cb) {
    const ids = [];
    let cut = -1, liveLang = '';
    return bro.stt.transcribe(Transcribe.model, pcm, {
        onToken: (id) => {
            ids.push(id);
            if (cut < 0 && id === Transcribe.asrTextId) {
                cut = ids.length;
                liveLang = cut > 1 ? Transcribe.tok.decode(ids.slice(0, cut - 1)).trim() : '';
            }
            if (cb.onToken && cut >= 0 && ids.length > cut) {
                cb.onToken(Transcribe.tok.decode(ids.slice(cut)).trim(), liveLang);
            }
        },
        onDone: (res, info) => {
            const arr = res ? Array.from(res) : ids;
            const ci = arr.indexOf(Transcribe.asrTextId);
            const lang = ci > 0 ? Transcribe.tok.decode(arr.slice(0, ci)).trim() : '';
            const text = ci >= 0 ? Transcribe.tok.decode(arr.slice(ci + 1)).trim() : Transcribe.tok.decode(arr).trim();
            if (cb.onDone) cb.onDone(text, Object.assign({}, info || {}, { lang }));
        },
    });
}

/**
 * The transcript context for a stream: audio plumbing over its retained
 * buffer + ring, and UI routing that only touches the shared panel when this
 * stream is the active tab.
 */
export function makeTxCtx(st) {
    return {
        id: 'tx-' + st.id, name: st.label, st, _prev: null, _cur: null, run: realRun,
        tx: { active: false, startFrame: 0, lastRunFrame: 0, partial: '', lang: '', sealedFrame: 0, prevPartial: '' },
        audio: (a, b) => st.source.listen.audio(a, b),
        frame: () => st.source.listen.frame(),
        oldest: () => st.ring.oldestFrame(),
        active: () => st.source.listen.info().active,
        onPartial: (partial, lang) => {
            if (st === app.active) renderActivePartial(partial);
            for (const fn of partialHooks) fn(st, partial, lang);
        },
        onCommit: (text, a, b, lang) => commitLine(st, text, a, b, lang),
        onStatus: (text, err, live) => { if (st === app.active) txSetStatus(text, err, live); },
    };
}

export function txSetStatus(text, err, live) {
    D.txStat.textContent = text;
    D.txStat.className = 'txstat' + (err ? ' err' : live ? ' live' : '');
    D.txToggle.disabled = !Transcribe.ready;
    D.txToggle.textContent = Transcribe.enabled ? '⏸' : '▶';
}

const TX_PARTIAL_MAX = 96;

function renderPartial(ctx) { ctx.onPartial(ctx.tx.partial, ctx.tx.lang); }

/** The active tab's live English line under the streaming partial ("…" while pending). */
export function renderActiveLiveEn(text, pending) {
    clear(D.txLiveEn);
    if (!text) return;
    D.txLiveEn.appendChild(document.createTextNode('→ ' + text + ' '));
    if (pending) D.txLiveEn.appendChild(h('span.tlcur', null, '…'));
}

/** The active tab's live partial in the shared transcript panel. */
export function renderActivePartial(partial) {
    const ctx = app.active && app.active.txCtx;
    clear(D.txLive);
    if (partial) {
        const p = partial.length > TX_PARTIAL_MAX ? '…' + partial.slice(partial.length - TX_PARTIAL_MAX) : partial;
        D.txLive.appendChild(document.createTextNode(p + ' '));
        D.txLive.appendChild(h('span.cur', null, '▌'));
    } else if (ctx && ctx.tx.active) {
        D.txLive.appendChild(h('span.cur', null, '▌'));
    } else {
        D.txLive.appendChild(h('span.ph', null, '— speak; words appear here while voice is active —'));
    }
    if (!partial) renderActiveLiveEn('');
}

const lineKey = (ln) => ln.a + '-' + ln.b;

/**
 * The active tab's committed lines. Each is a timeline index: clicked, it
 * scrubs the timeline to where it was said and plays it.
 */
export function renderLines() {
    const st = app.active;
    clear(D.txLines);
    if (!st) return;
    for (const ln of st.txLines) {
        const playing = st.playback.active && st.playback.key === lineKey(ln);
        const mm = Math.floor(ln.t / 60), ss = Math.floor(ln.t % 60);
        D.txLines.appendChild(h('div.txline' + (playing ? '.playing' : ''), {
            title: 'jump to the timeline and play',
            onclick: () => {
                focusRegion(ln.a, ln.b);
                playRegion({ a: ln.a, b: ln.b }, lineKey(ln));
                renderLines();
            },
        },
            h('span.tt', null, mm + ':' + String(ss).padStart(2, '0')),
            ln.speaker ? h('span.spk.spk' + ((ln.speaker - 1) % 6), null, 'S' + ln.speaker) : null,
            !langIsEnglish(ln.lang) ? h('span.lang', null, ln.lang) : null,
            h('span.tx', null, ln.text),
            ln.en ? h('span.txen' + (ln.refined ? '.refined' : ''), null, '→ ' + ln.en)
                : ln.enPending ? h('span.txen.pending', null, '→ translating…') : null));
    }
}

function finishUtterance(ctx, text, a, b, lang) {
    ctx.tx.active = false;
    ctx.tx.partial = '';
    ctx.onCommit(text, a, b, lang);
    renderPartial(ctx);
    ctx.onStatus('ready · voice-gated', false, false);
}

/**
 * Commit a finished utterance to a stream: a replayable transcript line, a
 * [heard] feed row and a timeline speech marker. The commit hooks
 * (diarization, translation) fill in `speaker` and `en` asynchronously.
 */
function commitLine(st, text, a, b, lang) {
    if (!text) return;
    // Pure-symbol fragments ("。", "—") are ASR noise between turns: drop them.
    const core = text.replace(/[\s　-〿！-･ -⁯!-\/:-@]+/g, '');
    if (!core) return;
    const meaningful = core.length >= 2;
    let langN = normLang(lang);
    // Per-stream STICKY language: short/odd utterances otherwise flip-flop. Once
    // a dominant foreign language has 2+ meaningful votes, snap foreign labels to it.
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
    logEvent(st, 'speech', text, null, '', null, { startFrame: a, endFrame: b, matchedFrames: b - a });
    for (const fn of commitHooks) fn(st, line);
    if (st === app.active) renderLines();
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

/** Edge-driven from the poll loop, once per context (the driver sets ctx._prev/_cur). */
export function transcribeTick(ctx) {
    if (!Transcribe.ready || !Transcribe.enabled) return;
    const prev = ctx._prev, s = ctx._cur;
    if (!s || !ctx.active()) return;
    const T = ctx.tx;
    const rising = s.voice && (!prev || !prev.voice);
    const falling = prev && prev.voice && !s.voice;
    if (rising) {
        T.active = true;
        T.startFrame = Math.max(ctx.oldest(), s.frames - TX_PREROLL);
        T.sealedFrame = T.startFrame;
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

export function txReset(ctx) {
    ctx.tx.active = false;
    ctx.tx.partial = '';
    ctx.tx.prevPartial = '';
    ctx._prev = null; ctx._cur = null;
}

function txMaybeReady() {
    if (!Transcribe.model || !Transcribe.tok) return;
    Transcribe.asrTextId = Transcribe.model.asrTextId;
    Transcribe.ready = true;
    fusionRow(app.active, 'info', 'tier-3 transcript ready — Qwen3-ASR ' +
        (Transcribe.model.sampleRate / 1000) + ' kHz, 52-language + language ID · every stream');
    txSetStatus('ready · voice-gated');
    renderActivePartial('');
}

/** Load Qwen3-ASR (async) + its BPE tokenizer (sync, small). */
export function txLoad() {
    if (Transcribe.stubRun) return;
    const dir = findWeights(ASR_WEIGHTS, { probe: 'config.json' });
    if (!dir) { txSetStatus('Qwen3-ASR weights not found — transcript off', true); return; }
    txSetStatus('loading Qwen3-ASR…');
    try {
        bro.stt.loadQwenAsr(dir, {
            onReady: (m) => { Transcribe.model = m; txMaybeReady(); },
            onError: (e) => txSetStatus('Qwen3-ASR load failed: ' + e, true),
        });
        Transcribe.tok = bro.lm.loadTokenizer({ vocabPath: dir + '/vocab.json', mergesPath: dir + '/merges.txt' });
        txMaybeReady();
    } catch (e) {
        txSetStatus('Qwen3-ASR load failed: ' + (e.message || e), true);
    }
}

/** Test seam: a synchronous runner stands in for the model on every stream. */
export function installTranscriber(runFn) {
    Transcribe.stubRun = runFn;
    Transcribe.ready = true;
    Transcribe.enabled = true;
    if (!Transcribe.tok) Transcribe.tok = { decode: () => '' };
    txSetStatus('ready · voice-gated (stub)');
    renderActivePartial('');
}
