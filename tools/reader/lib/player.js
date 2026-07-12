// ═══ playback controller: prefetch pipeline, timing, sleep timer ══════════════
// One sentence = one synthesis = one cached audio clip. While a sentence plays,
// the controller keeps PREFETCH sentences ahead synthesized on the async path
// (bro.tts.synthesize — the model runs ONE op at a time, so this is a strict
// one-in-flight queue). PCM is cached per (engine · voice · speed · text) with
// the clip pre-uploaded to the audio engine at cache-fill time, so advancing
// sentences is instant; jumps and voice changes cancel stale in-flight work.
//
// Speed: Kokoro has a native speaking-rate opt (baked into the PCM → part of
// the cache key). Qwen3-TTS has no rate param — speed rides setPlaybackRate on
// the clip playback instead (pitch shifts with it; the honest option the API
// actually offers).
//
// Word highlight (Kokoro only): synthesize() returns per-phoneme frame counts;
// words are the runs between space tokens in the phoneme stream. We convert
// frames → seconds and drive the highlight off the audio clock.
import { settings, saveSettings } from "/app/lib/state.js";
import { engines, loadEngine, setKokoroVoice } from "/app/lib/engine.js";
import { saveLibrary } from "/app/lib/docs.js";

export const PREFETCH = 3;
const CACHE_MAX = 48;
const SENTENCE_GAP_S = 0.14;    // beat between sentences
const PARAGRAPH_GAP_S = 0.45;   // longer beat at a paragraph break
export const PREVIEW_TEXT = 'The quick brown fox jumps over the lazy dog.';

export let doc = null;      // active library record
export let seg = null;      // { paragraphs, sentences }
export let cur = -1;        // active sentence index
export let playing = false;
export let buffering = false;
export let sleep = { mode: 'off', deadline: 0, label: '' };   // off | min | paragraph

let ctx = null;             // AudioContext — created on first use
let playbackId = -1;
let t0 = 0;                 // audio-clock time the current clip started
let pausedAt = -1;          // elapsed seconds at pause (-1 = not paused mid-clip)
let curDur = 0, curRate = 1, curTimings = null, lastWord = -1;
let ticker = 0;
let gapUntil = -1;          // audio-clock time an inter-sentence gap ends (-1 = none)
let gen = 0;                // bumped on jump/change; stale deferred starts no-op

const cache = new Map();    // key → { samples, sampleRate, clipId, timings }
let inflight = null;        // { key, idx, handle }
let gateWaiters = [];       // callbacks waiting for the model gate (export/preview)
let exporting = false;      // exporter owns the model; prefetch stands down
let previewId = -1;         // playbackId of a running voice preview

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
export function engineName() { return (doc && doc.engine) || settings.engine; }
export function speed() { return (doc && doc.speed) || settings.speed; }
export function kokoroVoiceName() { return (doc && doc.voice) || settings.kokoroVoice; }
export function qwenSpeaker() { return (doc && doc.speaker) || settings.qwenSpeaker; }
function voiceKey() { return engineName() === 'kokoro' ? kokoroVoiceName() : qwenSpeaker(); }
function engineReady() {
  const n = engineName();
  return engines[n].status === 'ready' && (n !== 'kokoro' || !!engines.kokoro.voice);
}
function keyFor(i) {
  const n = engineName();
  const sp = n === 'kokoro' ? speed() : 1;   // qwen speed is playback-rate only
  return n + '|' + voiceKey() + '|' + sp + '|' + seg.sentences[i].text;
}
export function peekCache(i) { return (seg && i >= 0 && i < seg.sentences.length) ? cache.get(keyFor(i)) || null : null; }

// ── document lifecycle ───────────────────────────────────────────────────────
export function setDocument(d, s) {
  stopCurrent();
  doc = d; seg = s;
  cur = Math.max(0, Math.min(d.pos || 0, s.sentences.length - 1));
  playing = false; buffering = false;
  sleep = { mode: 'off', deadline: 0, label: '' };
  loadEngine(engineName(), () => { syncVoice(); ensurePrefetch(); });
  emit('doc'); emit('sentence'); emit('state');
}
export function closeDocument() {
  pause();
  savePos(true);
  doc = null; seg = null; cur = -1;
  emit('doc');
}
function savePos(force) {
  if (!doc) return;
  doc.pos = Math.max(cur, 0);
  if (force || !savePos._t) {
    saveLibrary();
    savePos._t = setTimeout(() => { savePos._t = 0; if (doc) saveLibrary(); }, 2000);
  }
}
function syncVoice() { if (engineName() === 'kokoro') setKokoroVoice(kokoroVoiceName()); }

// ── transport ────────────────────────────────────────────────────────────────
export function play() {
  if (!seg || !seg.sentences.length || playing) return;
  if (cur < 0) cur = 0;
  playing = true;
  if (pausedAt >= 0 && playbackId >= 0) {          // resume mid-sentence
    try { audioCtx().setPlaybackPlaying(playbackId, true); } catch (e) {}
    t0 = audioCtx().currentTime - pausedAt;
    pausedAt = -1;
    startTicker();
  } else {
    startSentence(cur);
  }
  emit('state');
}
export function pause() {
  if (!playing) return;
  playing = false;
  stopTicker();
  if (playbackId >= 0 && gapUntil < 0) {
    pausedAt = elapsed();
    try { audioCtx().setPlaybackPlaying(playbackId, false); } catch (e) {}
  } else if (gapUntil >= 0) {
    // paused in the beat between sentences — resume starts the NEXT sentence
    gapUntil = -1;
    if (seg && cur < seg.sentences.length - 1) cur++;
    emit('sentence');
  }
  buffering = false;
  savePos(true);
  emit('state');
}
export function toggle() { playing ? pause() : play(); }

export function jumpTo(i, autoplay) {
  if (!seg || i < 0 || i >= seg.sentences.length) return;
  stopCurrent();
  cur = i;
  savePos();
  if (autoplay === undefined ? true : autoplay) {
    playing = true;
    startSentence(i);
  } else {
    playing = false;
    ensurePrefetch();
    emit('sentence');
  }
  emit('state');
}
export function next() { if (seg && cur < seg.sentences.length - 1) jumpTo(cur + 1, playing); }
export function prev() { if (seg && cur > 0) jumpTo(cur - 1, playing); }
export function paragraphStart() {
  if (!seg) return;
  const p = seg.sentences[Math.max(cur, 0)].para;
  let first = seg.sentences.findIndex((s) => s.para === p);
  if (first === cur && p > 0) first = seg.sentences.findIndex((s) => s.para === p - 1);
  jumpTo(first, playing);
}

// ── sentence machinery ───────────────────────────────────────────────────────
function startSentence(i) {
  gen++;
  cur = i;
  savePos();
  curTimings = null; lastWord = -1; pausedAt = -1; gapUntil = -1;
  emit('sentence');
  const name = engineName();
  if (engines[name].status !== 'ready') {
    buffering = true; emit('buffer');
    loadEngine(name, (err) => {
      if (err) { buffering = false; playing = false; emit('buffer'); emit('state'); return; }
      syncVoice();
      if (playing && cur === i) startSentence(i);
    });
    return;
  }
  syncVoice();
  const c = cache.get(keyFor(i));
  if (!c) {
    buffering = true; emit('buffer');
    ensurePrefetch();                              // synth completion starts the clip
    return;
  }
  buffering = false; emit('buffer');
  startClip(c);
  ensurePrefetch();
}

function startClip(c) {
  const a = audioCtx();
  curRate = engineName() === 'qwen' ? speed() : 1;
  playbackId = a.playClip(c.clipId, 1.0, false);
  if (curRate !== 1) { try { a.setPlaybackRate(playbackId, curRate); } catch (e) {} }
  t0 = a.currentTime;
  curDur = (c.samples.length / c.sampleRate) / curRate;
  curTimings = c.timings || null;
  startTicker();
}

function elapsed() { return audioCtx().currentTime - t0; }
function startTicker() { stopTicker(); ticker = setInterval(tick, 50); }
function stopTicker() { if (ticker) { clearInterval(ticker); ticker = 0; } }

function tick() {
  if (!playing) return;
  const a = audioCtx();
  if (gapUntil >= 0) {                             // inter-sentence beat
    if (a.currentTime >= gapUntil) { gapUntil = -1; startSentence(cur + 1); }
    return;
  }
  if (playbackId < 0) return;                      // buffering
  const el = elapsed();
  if (curTimings) {
    // timings are in source-audio seconds; Kokoro plays at rate 1 (speed is
    // baked into the PCM) so the audio clock maps straight onto them.
    let w = lastWord;
    while (w + 1 < curTimings.length && curTimings[w + 1].s <= el) w++;
    if (w !== lastWord) { lastWord = w; emit('word', w); }
  }
  if (el >= curDur) endOfSentence();
  if (sleep.mode === 'min' && a.currentTime >= sleep.deadline) stopForSleep();
}

function endOfSentence() {
  try { audioCtx().stopPlayback(playbackId); } catch (e) {}
  playbackId = -1;
  const nxt = cur + 1;
  const paraBreak = nxt >= seg.sentences.length || seg.sentences[nxt].para !== seg.sentences[cur].para;
  if (sleep.mode === 'paragraph' && paraBreak) { stopForSleep(); return; }
  if (nxt >= seg.sentences.length) {               // finished the document
    playing = false;
    stopTicker();
    doc.pos = 0;                                   // next open starts from the top
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
  buffering = false;
  curTimings = null; lastWord = -1;
}

// ── sleep timer ──────────────────────────────────────────────────────────────
export function setSleep(mode, minutes) {
  if (mode === 'min') {
    sleep = { mode, deadline: audioCtx().currentTime + minutes * 60, label: minutes + ' min' };
  } else if (mode === 'paragraph') {
    sleep = { mode, deadline: 0, label: 'end of ¶' };
  } else {
    sleep = { mode: 'off', deadline: 0, label: '' };
  }
  emit('sleep');
}
function stopForSleep() {
  sleep = { mode: 'off', deadline: 0, label: '' };
  pause();
  emit('sleep');
}

// ── voice / engine / speed changes (per-document, falling back to defaults) ──
export function setEngine(name) {
  if (doc) doc.engine = name;
  settings.engine = name;
  onParamsChanged();
}
export function setVoiceName(name) {              // kokoro voice or qwen speaker
  if (engineName() === 'kokoro') {
    if (doc) doc.voice = name;
    settings.kokoroVoice = name;
    setKokoroVoice(name);
  } else {
    if (doc) doc.speaker = name;
    settings.qwenSpeaker = name;
  }
  onParamsChanged();
}
export function setSpeed(v) {
  v = Math.max(0.5, Math.min(3, +v || 1));
  if (doc) doc.speed = v;
  settings.speed = v;
  onParamsChanged();
}
function onParamsChanged() {
  saveSettings();
  if (doc) saveLibrary();
  const wasPlaying = playing;
  stopCurrent();
  emit('params');
  if (!seg) return;
  loadEngine(engineName(), () => { syncVoice(); if (!wasPlaying) ensurePrefetch(); });
  if (wasPlaying) { playing = true; startSentence(Math.max(cur, 0)); }
  else emit('sentence');
  emit('state');
}

// ── prefetch pipeline ────────────────────────────────────────────────────────
function inflightStale() {
  if (!inflight) return false;
  if (!seg || exporting) return true;
  if (inflight.idx < cur || inflight.idx > cur + PREFETCH) return true;
  return inflight.key !== keyFor(inflight.idx);    // voice/speed/engine changed
}
export function ensurePrefetch() {
  if (!seg || exporting || !engineReady()) return;
  if (inflight) {
    if (inflightStale()) { try { inflight.handle.cancel(); } catch (e) {} }
    return;                                        // onDone re-enters
  }
  const from = Math.max(cur, 0);
  const to = Math.min(from + PREFETCH, seg.sentences.length - 1);
  for (let i = from; i <= to; i++) {
    const key = keyFor(i);
    if (cache.has(key)) { touch(key); continue; }
    synthesizeSentence(i, key);
    return;
  }
}

function synthesizeSentence(i, key) {
  const name = engineName();
  const e = engines[name];
  const text = seg.sentences[i].text;
  const done = (r, info, timings) => {
    inflight = null;
    if (info.error) emit('error', 'synthesize: ' + info.error);
    else if (!info.cancelled) fillCache(key, r, timings);
    // a buffering play waits on exactly this sentence — start it (deferred a few
    // frames so the clip upload lands; see kokoro-lab's threading note)
    if (playing && buffering && seg && cur === i && cache.has(keyFor(cur))) {
      buffering = false; emit('buffer');
      const myGen = ++gen;
      setTimeout(() => {
        if (playing && gen === myGen && playbackId < 0) { startClip(cache.get(keyFor(cur))); }
      }, 60);
    }
    flushGate();
    ensurePrefetch();
  };
  try {
    if (name === 'kokoro') {
      const ids = bro.tts.phonemize(text);
      if (!ids || !ids.length) { fillSilence(key); ensurePrefetch(); return; }
      inflight = {
        key, idx: i,
        handle: bro.tts.synthesize(e.model, ids, e.voice, {
          speed: speed(),
          onDone: (r, info) => {
            let tm = null;
            if (!info.cancelled && !info.error) { try { tm = kokoroWordTimings(text, ids, r); } catch (ex) {} }
            done(r, info, tm);
          },
        }),
      };
    } else {
      inflight = {
        key, idx: i,
        handle: bro.tts.synthesize(e.model, text, {
          speaker: qwenSpeaker(), language: 'english',
          onDone: (r, info) => done(r, info, null),
        }),
      };
    }
  } catch (err) {
    // model momentarily busy (shouldn't happen — one-in-flight) or a real error
    inflight = null;
    emit('error', 'synthesize: ' + err.message);
  }
}

function fillCache(key, r, timings) {
  let clipId = -1;
  try { clipId = audioCtx().createClip(r.samples, 1, r.sampleRate); }
  catch (e) { emit('error', 'audio: ' + e.message); return; }
  cache.set(key, { samples: r.samples, sampleRate: r.sampleRate, clipId, timings: timings || null });
  evict();
}
function fillSilence(key) {                        // unpronounceable sentence → short beat
  const sr = 24000;
  fillCache(key, { samples: new Float32Array(sr / 5), sampleRate: sr }, null);
}
function touch(key) { const c = cache.get(key); if (c) { cache.delete(key); cache.set(key, c); } }
function evict() {
  while (cache.size > CACHE_MAX) {
    const k = cache.keys().next().value;
    const c = cache.get(k);
    cache.delete(k);
    if (c.clipId >= 0) { try { audioCtx().deleteClip(c.clipId); } catch (e) {} }
  }
}

// ── word timing from Kokoro durations ────────────────────────────────────────
// durations = per-phoneme frame counts, BOS + ids + EOS wrapped. Output sample
// count is a fixed multiple of the summed frames; words are the id runs between
// space tokens. Returns [{ s, e }] seconds per whitespace word of `text`
// (proportional mapping when the model's word count disagrees with the text's).
function kokoroWordTimings(text, ids, r) {
  const model = engines.kokoro.model;
  let space = -1;
  try { space = model.vocab()[' ']; } catch (e) { return null; }
  const dur = r.durations;
  if (!dur || dur.length !== ids.length + 2) return null;
  let total = 0;
  for (let k = 0; k < dur.length; k++) total += dur[k];
  if (!total) return null;
  const spf = r.samples.length / total / r.sampleRate;   // seconds per frame
  const groups = [];
  let f = dur[0], g = null;                              // skip BOS frames
  for (let k = 0; k < ids.length; k++) {
    const frames = dur[k + 1];
    if (ids[k] === space) g = null;
    else {
      if (!g) { g = { s: f * spf, e: 0 }; groups.push(g); }
      g.e = (f + frames) * spf;
    }
    f += frames;
  }
  const words = text.split(/\s+/).filter(Boolean);
  if (!groups.length || !words.length) return null;
  const t = words.map(() => null);
  for (let gi = 0; gi < groups.length; gi++) {
    const wi = Math.min(words.length - 1, Math.floor(gi * words.length / groups.length));
    if (!t[wi]) t[wi] = { s: groups[gi].s, e: groups[gi].e };
    else t[wi].e = groups[gi].e;
  }
  for (let wi = 0; wi < t.length; wi++)
    if (!t[wi]) t[wi] = t[wi - 1] ? { s: t[wi - 1].e, e: t[wi - 1].e } : { s: 0, e: 0 };
  return t;
}

// ── model gate (export / preview share the single in-flight slot) ────────────
function flushGate() {
  const q = gateWaiters.splice(0);
  for (const cb of q) { try { cb(); } catch (e) {} }
}
export function acquireModel(cb) {
  exporting = true;
  pause();
  if (inflight) {
    try { inflight.handle.cancel(); } catch (e) {}
    gateWaiters.push(cb);
  } else cb();
}
export function releaseModel() {
  exporting = false;
  ensurePrefetch();
}

// ── voice preview ────────────────────────────────────────────────────────────
// Speaks a fixed sample sentence with the CURRENT engine/voice/speed, without
// touching document playback state.
export function previewVoice(done) {
  const name = engineName();
  if (engines[name].status !== 'ready') {
    emit('buffer');
    loadEngine(name, (err) => { if (err) { done && done(err); } else previewVoice(done); });
    return;
  }
  syncVoice();
  pause();
  if (previewId >= 0) { try { audioCtx().stopPlayback(previewId); } catch (e) {} previewId = -1; }
  const run = () => {
    const e = engines[name];
    const onDone = (r, info) => {
      flushGate();
      if (info.cancelled || info.error) { done && done(info.error || 'cancelled'); ensurePrefetch(); return; }
      const a = audioCtx();
      let clip = -1;
      try { clip = a.createClip(r.samples, 1, r.sampleRate); } catch (ex) { done && done(ex.message); return; }
      setTimeout(() => {                            // let the clip upload land
        previewId = a.playClip(clip, 1.0, false);
        if (name === 'qwen' && speed() !== 1) { try { a.setPlaybackRate(previewId, speed()); } catch (ex) {} }
      }, 60);
      const ms = 1000 * (r.samples.length / r.sampleRate) / (name === 'qwen' ? speed() : 1);
      setTimeout(() => { try { a.deleteClip(clip); } catch (ex) {} previewId = -1; }, ms + 800);
      done && done(null);
      ensurePrefetch();
    };
    try {
      if (name === 'kokoro') {
        const ids = bro.tts.phonemize(PREVIEW_TEXT);
        bro.tts.synthesize(e.model, ids, e.voice, { speed: speed(), onDone });
      } else {
        bro.tts.synthesize(e.model, PREVIEW_TEXT, { speaker: qwenSpeaker(), language: 'english', onDone });
      }
    } catch (err) { done && done(err.message); }
  };
  if (inflight) { try { inflight.handle.cancel(); } catch (e) {} gateWaiters.push(run); }
  else run();
}
