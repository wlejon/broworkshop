// player.js — the playback controller: prefetch pipeline, timing, sleep timer.
//
// One sentence = one synthesis = one cached audio clip. While a sentence
// plays, PREFETCH sentences ahead are synthesized on the async path (one in
// flight at a time: the model runs one op at a time). PCM is cached per
// (engine · voice · speed · text) with the clip uploaded at cache-fill time,
// so advancing is instant; jumps and voice changes cancel stale work.
//
// Speed: Kokoro bakes it into the PCM (part of the cache key); Qwen3-TTS has
// no rate param, so speed rides setPlaybackRate on the clip (pitch shifts).
// Word highlight (Kokoro only) runs off per-phoneme durations (tts.js)
// against the audio clock.
//
// Live state is on `ps` (an object, so importers always read current values).
// Views subscribe with onPlayerChange(cb(kind, arg)); kinds: doc, sentence,
// word, state, buffer, params, sleep, error, done.

import { settings, saveSettings } from "./state.js";
import { engines, loadEngine, setKokoroVoice } from "./engine.js";
import { saveLibrary } from "./docs.js";
import { synth } from "./tts.js";

export const PREFETCH = 3;
const CACHE_MAX = 48;
const SENTENCE_GAP_S = 0.14;    // beat between sentences
const PARAGRAPH_GAP_S = 0.45;   // longer beat at a paragraph break
export const PREVIEW_TEXT = 'The quick brown fox jumps over the lazy dog.';

export const ps = {
    doc: null,                  // active library record
    seg: null,                  // { paragraphs, sentences }
    cur: -1,                    // active sentence index
    playing: false,
    buffering: false,
    sleep: { mode: 'off', deadline: 0, label: '' },   // off | min | paragraph
};

let ctx = null;                 // AudioContext, created on first use
let playbackId = -1;
let t0 = 0;                     // audio-clock time the current clip started
let pausedAt = -1;              // elapsed seconds at pause (-1 = not paused mid-clip)
let curDur = 0, curTimings = null, lastWord = -1;
let ticker = 0;
let gapUntil = -1;              // audio-clock time an inter-sentence gap ends (-1 = none)
let gen = 0;                    // bumped on jump/change; stale deferred starts no-op
let saveTimer = 0;

const cache = new Map();        // key -> { samples, sampleRate, clipId, timings }
let inflight = null;            // { key, idx, handle }
let gateWaiters = [];           // callbacks waiting for the model (export / preview)
let exporting = false;          // exporter owns the model; prefetch stands down
let previewId = -1;             // playbackId of a running voice preview

const listeners = [];
export function onPlayerChange(cb) { listeners.push(cb); }
function emit(kind, a) { for (const cb of listeners) { try { cb(kind, a); } catch (e) {} } }

export function audioCtx() {
    if (!ctx) {
        ctx = new AudioContext();
        try { ctx.setLimiterEnabled(true); ctx.setLimiterThreshold(-1.0); } catch (e) {}
    }
    return ctx;
}

// ── effective per-document parameters ────────────────────────────────────────

export function engineName() { return (ps.doc && ps.doc.engine) || settings.engine; }
export function speed() { return (ps.doc && ps.doc.speed) || settings.speed; }
export function kokoroVoiceName() { return (ps.doc && ps.doc.voice) || settings.kokoroVoice; }
export function qwenSpeaker() { return (ps.doc && ps.doc.speaker) || settings.qwenSpeaker; }
/** Playback rate for the current engine (Qwen carries speed here, Kokoro in the PCM). */
export function playbackRate() { return engineName() === 'qwen' ? speed() : 1; }
function voiceKey() { return engineName() === 'kokoro' ? kokoroVoiceName() : qwenSpeaker(); }
function engineReady() {
    const n = engineName();
    return engines[n].status === 'ready' && (n !== 'kokoro' || !!engines.kokoro.voice);
}
function keyFor(i) {
    const n = engineName();
    return n + '|' + voiceKey() + '|' + (n === 'kokoro' ? speed() : 1) + '|' + ps.seg.sentences[i].text;
}
export function peekCache(i) {
    return (ps.seg && i >= 0 && i < ps.seg.sentences.length) ? cache.get(keyFor(i)) || null : null;
}
function syncVoice() { if (engineName() === 'kokoro') setKokoroVoice(kokoroVoiceName()); }

/** synth() with the current engine's voice / speaker / speed. */
export function synthCurrent(text, onDone, timings) {
    return synth(engineName(), text, { speed: speed(), speaker: qwenSpeaker(), timings, onDone });
}

// ── document lifecycle ───────────────────────────────────────────────────────

export function setDocument(d, s) {
    stopCurrent();
    Object.assign(ps, {
        doc: d, seg: s, playing: false, buffering: false,
        cur: Math.max(0, Math.min(d.pos || 0, s.sentences.length - 1)),
        sleep: { mode: 'off', deadline: 0, label: '' },
    });
    loadEngine(engineName(), () => { syncVoice(); ensurePrefetch(); });
    emit('doc'); emit('sentence'); emit('state');
}

export function closeDocument() {
    pause();
    savePos(true);
    Object.assign(ps, { doc: null, seg: null, cur: -1 });
    emit('doc');
}

function savePos(force) {
    if (!ps.doc) return;
    ps.doc.pos = Math.max(ps.cur, 0);
    if (force || !saveTimer) {
        saveLibrary();
        saveTimer = setTimeout(() => { saveTimer = 0; if (ps.doc) saveLibrary(); }, 2000);
    }
}

// ── transport ────────────────────────────────────────────────────────────────

export function play() {
    if (!ps.seg || !ps.seg.sentences.length || ps.playing) return;
    if (ps.cur < 0) ps.cur = 0;
    ps.playing = true;
    if (pausedAt >= 0 && playbackId >= 0) {          // resume mid-sentence
        try { audioCtx().setPlaybackPlaying(playbackId, true); } catch (e) {}
        t0 = audioCtx().currentTime - pausedAt;
        pausedAt = -1;
        startTicker();
    } else {
        startSentence(ps.cur);
    }
    emit('state');
}

export function pause() {
    if (!ps.playing) return;
    ps.playing = false;
    stopTicker();
    if (playbackId >= 0 && gapUntil < 0) {
        pausedAt = elapsed();
        try { audioCtx().setPlaybackPlaying(playbackId, false); } catch (e) {}
    } else if (gapUntil >= 0) {
        // paused in the beat between sentences: resume starts the NEXT one
        gapUntil = -1;
        if (ps.seg && ps.cur < ps.seg.sentences.length - 1) ps.cur++;
        emit('sentence');
    }
    ps.buffering = false;
    savePos(true);
    emit('state');
}

export function toggle() { if (ps.playing) pause(); else play(); }

export function jumpTo(i, autoplay) {
    if (!ps.seg || i < 0 || i >= ps.seg.sentences.length) return;
    stopCurrent();
    ps.cur = i;
    savePos();
    if (autoplay === undefined ? true : autoplay) {
        ps.playing = true;
        startSentence(i);
    } else {
        ps.playing = false;
        ensurePrefetch();
        emit('sentence');
    }
    emit('state');
}
export function next() { if (ps.seg && ps.cur < ps.seg.sentences.length - 1) jumpTo(ps.cur + 1, ps.playing); }
export function prev() { if (ps.seg && ps.cur > 0) jumpTo(ps.cur - 1, ps.playing); }
export function paragraphStart() {
    if (!ps.seg) return;
    const s = ps.seg.sentences, p = s[Math.max(ps.cur, 0)].para;
    let first = s.findIndex((x) => x.para === p);
    if (first === ps.cur && p > 0) first = s.findIndex((x) => x.para === p - 1);
    jumpTo(first, ps.playing);
}

// ── sentence machinery ───────────────────────────────────────────────────────

function setBuffering(on) { ps.buffering = on; emit('buffer'); }

function startSentence(i) {
    gen++;
    ps.cur = i;
    savePos();
    curTimings = null; lastWord = -1; pausedAt = -1; gapUntil = -1;
    emit('sentence');
    const name = engineName();
    if (engines[name].status !== 'ready') {
        setBuffering(true);
        loadEngine(name, (err) => {
            if (err) { ps.buffering = false; ps.playing = false; emit('buffer'); emit('state'); return; }
            syncVoice();
            if (ps.playing && ps.cur === i) startSentence(i);
        });
        return;
    }
    syncVoice();
    const c = cache.get(keyFor(i));
    if (!c) { setBuffering(true); ensurePrefetch(); return; }   // synth completion starts the clip
    setBuffering(false);
    startClip(c);
    ensurePrefetch();
}

function startClip(c) {
    const a = audioCtx(), rate = playbackRate();
    playbackId = a.playClip(c.clipId, 1.0, false);
    if (rate !== 1) { try { a.setPlaybackRate(playbackId, rate); } catch (e) {} }
    t0 = a.currentTime;
    curDur = (c.samples.length / c.sampleRate) / rate;
    curTimings = c.timings || null;
    startTicker();
}

function elapsed() { return audioCtx().currentTime - t0; }
function startTicker() { stopTicker(); ticker = setInterval(tick, 50); }
function stopTicker() { if (ticker) { clearInterval(ticker); ticker = 0; } }

function tick() {
    if (!ps.playing) return;
    const a = audioCtx();
    if (gapUntil >= 0) {                             // inter-sentence beat
        if (a.currentTime >= gapUntil) { gapUntil = -1; startSentence(ps.cur + 1); }
        return;
    }
    if (playbackId < 0) return;                      // buffering
    const el = elapsed();
    if (curTimings) {
        // timings are source-audio seconds; Kokoro plays at rate 1, so the
        // audio clock maps straight onto them.
        let w = lastWord;
        while (w + 1 < curTimings.length && curTimings[w + 1].s <= el) w++;
        if (w !== lastWord) { lastWord = w; emit('word', w); }
    }
    if (el >= curDur) endOfSentence();
    if (ps.sleep.mode === 'min' && a.currentTime >= ps.sleep.deadline) stopForSleep();
}

function endOfSentence() {
    try { audioCtx().stopPlayback(playbackId); } catch (e) {}
    playbackId = -1;
    const s = ps.seg.sentences, nxt = ps.cur + 1;
    const paraBreak = nxt >= s.length || s[nxt].para !== s[ps.cur].para;
    if (ps.sleep.mode === 'paragraph' && paraBreak) { stopForSleep(); return; }
    if (nxt >= s.length) {                           // finished the document
        ps.playing = false;
        stopTicker();
        ps.doc.pos = 0;                              // next open starts from the top
        saveLibrary();
        emit('state'); emit('done');
        return;
    }
    gapUntil = audioCtx().currentTime + (paraBreak ? PARAGRAPH_GAP_S : SENTENCE_GAP_S);
}

function stopCurrent() {
    gen++;
    stopTicker();
    if (playbackId >= 0) { try { audioCtx().stopPlayback(playbackId); } catch (e) {} }
    playbackId = -1; pausedAt = -1; gapUntil = -1;
    ps.buffering = false;
    curTimings = null; lastWord = -1;
}

// ── sleep timer ──────────────────────────────────────────────────────────────

export function setSleep(mode, minutes) {
    if (mode === 'min') ps.sleep = { mode, deadline: audioCtx().currentTime + minutes * 60, label: minutes + ' min' };
    else if (mode === 'paragraph') ps.sleep = { mode, deadline: 0, label: 'end of ¶' };
    else ps.sleep = { mode: 'off', deadline: 0, label: '' };
    emit('sleep');
}
function stopForSleep() {
    ps.sleep = { mode: 'off', deadline: 0, label: '' };
    pause();
    emit('sleep');
}

// ── voice / engine / speed (per document, falling back to the defaults) ──────

export function setEngine(name) {
    if (ps.doc) ps.doc.engine = name;
    settings.engine = name;
    onParamsChanged();
}
/** Kokoro voice or Qwen speaker, whichever engine is current. */
export function setVoiceName(name) {
    if (engineName() === 'kokoro') {
        if (ps.doc) ps.doc.voice = name;
        settings.kokoroVoice = name;
        setKokoroVoice(name);
    } else {
        if (ps.doc) ps.doc.speaker = name;
        settings.qwenSpeaker = name;
    }
    onParamsChanged();
}
export function setSpeed(v) {
    v = Math.max(0.5, Math.min(3, +v || 1));
    if (ps.doc) ps.doc.speed = v;
    settings.speed = v;
    onParamsChanged();
}
function onParamsChanged() {
    saveSettings();
    if (ps.doc) saveLibrary();
    const wasPlaying = ps.playing;
    stopCurrent();
    emit('params');
    if (!ps.seg) return;
    loadEngine(engineName(), () => { syncVoice(); if (!wasPlaying) ensurePrefetch(); });
    if (wasPlaying) { ps.playing = true; startSentence(Math.max(ps.cur, 0)); }
    else emit('sentence');
    emit('state');
}

// ── prefetch pipeline ────────────────────────────────────────────────────────

function inflightStale() {
    if (!ps.seg || exporting) return true;
    if (inflight.idx < ps.cur || inflight.idx > ps.cur + PREFETCH) return true;
    return inflight.key !== keyFor(inflight.idx);    // voice / speed / engine changed
}

export function ensurePrefetch() {
    if (!ps.seg || exporting || !engineReady()) return;
    if (inflight) {
        if (inflightStale()) { try { inflight.handle.cancel(); } catch (e) {} }
        return;                                        // its onDone re-enters
    }
    const from = Math.max(ps.cur, 0);
    const to = Math.min(from + PREFETCH, ps.seg.sentences.length - 1);
    for (let i = from; i <= to; i++) {
        const key = keyFor(i);
        if (cache.has(key)) { touch(key); continue; }
        synthesizeSentence(i, key);
        return;
    }
}

function synthesizeSentence(i, key) {
    const done = (r, info, timings) => {
        inflight = null;
        if (info.error) emit('error', 'synthesize: ' + info.error);
        else if (!info.cancelled) fillCache(key, r, timings);
        // A buffering play waits on exactly this sentence: start it, deferred
        // a few frames so the clip upload lands.
        if (ps.playing && ps.buffering && ps.seg && ps.cur === i && cache.has(keyFor(ps.cur))) {
            setBuffering(false);
            const myGen = ++gen;
            setTimeout(() => {
                if (ps.playing && gen === myGen && playbackId < 0) startClip(cache.get(keyFor(ps.cur)));
            }, 60);
        }
        flushGate();
        ensurePrefetch();
    };
    try {
        const handle = synthCurrent(ps.seg.sentences[i].text, done, true);
        if (!handle) { fillSilence(key); ensurePrefetch(); return; }   // nothing pronounceable
        inflight = { key, idx: i, handle };
    } catch (err) {
        inflight = null;
        emit('error', 'synthesize: ' + err.message);
    }
}

function fillCache(key, r, timings) {
    let clipId = -1;
    try { clipId = audioCtx().createClip(r.samples, 1, r.sampleRate); }
    catch (e) { emit('error', 'audio: ' + e.message); return; }
    cache.set(key, { samples: r.samples, sampleRate: r.sampleRate, clipId, timings: timings || null });
    while (cache.size > CACHE_MAX) {
        const k = cache.keys().next().value, c = cache.get(k);
        cache.delete(k);
        if (c.clipId >= 0) { try { audioCtx().deleteClip(c.clipId); } catch (e) {} }
    }
}
function fillSilence(key) {                          // a short beat
    const sr = 24000;
    fillCache(key, { samples: new Float32Array(sr / 5), sampleRate: sr }, null);
}
function touch(key) { const c = cache.get(key); if (c) { cache.delete(key); cache.set(key, c); } }

// ── the model gate (export and preview share the one in-flight slot) ─────────

function flushGate() { for (const cb of gateWaiters.splice(0)) { try { cb(); } catch (e) {} } }

/** Stop playback and prefetch, then cb() once the model is free. Pair with releaseModel(). */
export function acquireModel(cb) {
    exporting = true;
    pause();
    if (inflight) { try { inflight.handle.cancel(); } catch (e) {} gateWaiters.push(cb); }
    else cb();
}
export function releaseModel() {
    exporting = false;
    ensurePrefetch();
}

// ── voice preview ────────────────────────────────────────────────────────────
// Speaks a sample sentence with the CURRENT engine / voice / speed without
// touching document playback.

export function previewVoice(done) {
    const name = engineName();
    const finish = (err) => { if (done) done(err); };
    if (engines[name].status !== 'ready') {
        emit('buffer');
        loadEngine(name, (err) => { if (err) finish(err); else previewVoice(done); });
        return;
    }
    syncVoice();
    pause();
    if (previewId >= 0) { try { audioCtx().stopPlayback(previewId); } catch (e) {} previewId = -1; }
    const run = () => {
        const onDone = (r, info) => {
            flushGate();
            if (info.cancelled || info.error) { finish(info.error || 'cancelled'); ensurePrefetch(); return; }
            const a = audioCtx(), rate = playbackRate();
            let clip = -1;
            try { clip = a.createClip(r.samples, 1, r.sampleRate); } catch (ex) { finish(ex.message); return; }
            setTimeout(() => {                         // let the clip upload land
                previewId = a.playClip(clip, 1.0, false);
                if (rate !== 1) { try { a.setPlaybackRate(previewId, rate); } catch (ex) {} }
            }, 60);
            const ms = 1000 * (r.samples.length / r.sampleRate) / rate;
            setTimeout(() => { try { a.deleteClip(clip); } catch (ex) {} previewId = -1; }, ms + 800);
            finish(null);
            ensurePrefetch();
        };
        try { synthCurrent(PREVIEW_TEXT, onDone, false); } catch (err) { finish(err.message); }
    };
    if (inflight) { try { inflight.handle.cancel(); } catch (e) {} gateWaiters.push(run); }
    else run();
}
