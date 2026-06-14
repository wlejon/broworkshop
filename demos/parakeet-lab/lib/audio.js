// ═══ audio I/O ═══════════════════════════════════════════════════════════════
// bro's AudioContext is clip-based (broaudio): publish a Float32 buffer with
// createClip (a lock-free RCU hand-off to the audio thread), then re-trigger it
// with playClip. The source clip is published once per record/load and the
// play button just re-triggers it.
//
// Mic capture goes through bro.mic with samples:true — broaudio owns the
// resampler (mic rate → 16 kHz), optional AGC, and fixed-size chunk slicing;
// each onChunk hands us 160 samples (10 ms) of ready-to-transcribe PCM that we
// accumulate until the recording stops.

import { $, TARGET_RATE } from "/app/lib/state.js";
import { setBadge } from "/app/lib/model.js";
import { setSource } from "/app/lib/transcribe.js";

let audioCtx = null;         // broaudio context (lazy)
let recChunks = [];          // Float32Array chunks accumulated while recording
export let recording = false;       // mic capture in progress

function ensureCtx() {
  audioCtx = audioCtx || new AudioContext();
  return audioCtx;
}

// Linear-resample a mono buffer between rates (good enough for monitoring).
function resample(samples, inRate, outRate) {
  if (!samples || Math.abs(inRate - outRate) < 1) return samples;
  const ratio = outRate / inRate, n = Math.floor(samples.length * ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / ratio, j = t | 0, f = t - j;
    const a = samples[j], b = (samples[j + 1] !== undefined) ? samples[j + 1] : a;
    out[i] = a * (1 - f) + b * f;
  }
  return out;
}

// Publish the 16 kHz source as a clip at the context rate, replacing the old
// one. Returns the new clip id, or -1 on failure.
export function publishClip(prevId, samples) {
  try {
    const ctx = ensureCtx();
    const buf = resample(samples, TARGET_RATE, ctx.sampleRate || 48000);
    if (prevId >= 0) { try { ctx.deleteClip(prevId); } catch (e) {} }
    return ctx.createClip(buf, 1);
  } catch (e) { setBadge('audio: ' + e.message, true); return -1; }
}

export function playClipId(id) {
  if (id < 0 || !audioCtx) return;
  try { audioCtx.playClip(id, 1.0, false); }
  catch (e) { setBadge('audio: ' + e.message, true); }
}

// Decode an audio file off disk to mono Float32 @ 16 kHz.
export function decodeFileToSource(path) {
  const ctx = ensureCtx();
  const dec = ctx.decodeAudioFile(path);
  if (!dec || !dec.samples || !dec.numFrames) return null;
  const ch = dec.channels || 1, nf = dec.numFrames;
  let mono;
  if (ch === 1) {
    mono = dec.samples.length === nf ? dec.samples : dec.samples.subarray(0, nf);
  } else {                                   // downmix interleaved → mono
    mono = new Float32Array(nf);
    for (let i = 0; i < nf; i++) {
      let s = 0; for (let c = 0; c < ch; c++) s += dec.samples[i * ch + c];
      mono[i] = s / ch;
    }
  }
  return resample(mono, dec.sampleRate, TARGET_RATE);
}

// ── mic recording ─────────────────────────────────────────────────────────────

function setMicLevel(p) {
  $('#miclevel-fill').style.width = Math.min(100, p * 130) + '%';
}

// Start accumulating mic audio. opts.live=false lets a headless script drive
// the tap via bro.mic.feed() instead of the recording device.
export function startRecording(opts) {
  if (recording) return;
  recChunks = [];
  recording = true;
  bro.mic.start({
    chunkFrames: 160,            // 10 ms @ 16 kHz
    targetRate:  TARGET_RATE,
    agc:         true,
    samples:     true,           // each chunk carries its raw PCM
    live:        !(opts && opts.live === false),
    onChunk: (c) => {
      if (!recording) return;
      recChunks.push(c.samples);
      setMicLevel(c.peak);
    },
  });
  $('#btn-record').textContent = '■ stop';
  $('#btn-record').classList.add('recording');
  setBadge('recording… speak, then stop');
}

// Stop the mic and hand the utterance to setSource. Returns the sample count.
export function stopRecording() {
  if (!recording) return 0;
  recording = false;
  bro.mic.stop();
  setMicLevel(0);
  $('#btn-record').textContent = '● record';
  $('#btn-record').classList.remove('recording');

  let n = 0;
  for (const c of recChunks) n += c.length;
  if (n === 0) { setBadge('no audio captured', true); return 0; }
  const out = new Float32Array(n);
  let off = 0;
  for (const c of recChunks) { out.set(c, off); off += c.length; }
  recChunks = [];
  setSource(out, 'mic ' + (n / TARGET_RATE).toFixed(1) + 's');
  return n;
}
