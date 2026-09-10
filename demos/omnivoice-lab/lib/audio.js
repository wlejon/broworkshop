// ═══ audio — clip publish / play / stop / WAV export ══════════════════════════
// bro's AudioContext is clip-based (broaudio): createClip publishes samples to
// the audio thread (lock-free RCU hand-off), playClip triggers playback. One
// clip is published per take shown; ♪ re-triggers it; a span plays through
// setPlaybackRegion on the same clip (frames map proportionally onto the
// resampled buffer, so no re-upload).
import { $, current, SPF } from "/app/lib/state.js";
import { _fs, resampleTo, setBadge, saveFile, slug } from "/app/lib/helpers.js";

export let audioCtx = null;
let clipId = -1;          // the published clip (the current take)
let clipLen = 0;          // its length at the context rate
let playId = -1;          // the last playback id (for stop)
let wavSamples = null;    // native-rate copy for WAV export
let wavRate = 24000;

function ensureCtx() { audioCtx = audioCtx || new AudioContext(); return audioCtx; }

export function setClip(samples, inRate) {
  try {
    const ctx = ensureCtx();
    const buf = resampleTo(samples, inRate, ctx.sampleRate || 48000);
    if (clipId >= 0) { try { ctx.deleteClip(clipId); } catch (e) {} }
    clipId = ctx.createClip(buf, 1);
    clipLen = buf.length;
    wavSamples = samples; wavRate = inRate;
    $('#btn-play').disabled = false;
    $('#btn-save-wav').disabled = false;
  } catch (e) { setBadge('audio: ' + e.message, true); clipId = -1; clipLen = 0; }
}
export function play() {
  if (clipId < 0 || !audioCtx) return;
  try { playId = audioCtx.playClip(clipId, 1.0, false); } catch (e) { setBadge('audio: ' + e.message, true); }
}
// Play frames [f0, f1) of the current clip.
export function playSpan(f0, f1) {
  if (clipId < 0 || !audioCtx || !current) return;
  const T = current.numFrames || 1;
  const a = Math.floor(f0 / T * clipLen), b = Math.max(a + 1, Math.floor(f1 / T * clipLen));
  try { playId = audioCtx.playClip(clipId, 1.0, false); audioCtx.setPlaybackRegion(playId, a, b); }
  catch (e) { setBadge('audio: ' + e.message, true); }
}
export function stop() {
  if (playId >= 0 && audioCtx) { try { audioCtx.stopPlayback(playId); } catch (e) {} playId = -1; }
}
// The playback in flight (-1 = none), for the transport's state and tests.
export function playbackId() { return playId; }
// Publish any buffer (a take from the strip) and play it, without making it current.
export function playSamples(samples, rate) { setClip(samples, rate); play(); }

// Decode a file through the audio context: { samples (mono), sampleRate } or null.
export function decodeFile(path) {
  const ctx = ensureCtx();
  const dec = ctx.decodeAudioFile(path);
  if (!dec || !dec.samples || !dec.samples.length) return null;
  const ch = dec.channels || 1;
  let s = dec.samples;
  if (ch > 1) {
    const n = Math.floor(s.length / ch), m = new Float32Array(n);
    for (let i = 0; i < n; i++) { let a = 0; for (let c = 0; c < ch; c++) a += s[i * ch + c]; m[i] = a / ch; }
    s = m;
  }
  return { samples: s, sampleRate: dec.sampleRate || 24000 };
}

// ═══ WAV export ═══════════════════════════════════════════════════════════════
export function encodeWavPCM16(samples, rate) {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  let p = 0;
  const w32 = (v) => { dv.setUint32(p, v, true); p += 4; };
  const w16 = (v) => { dv.setUint16(p, v, true); p += 2; };
  const ws = (s) => { for (let i = 0; i < s.length; i++) dv.setUint8(p++, s.charCodeAt(i)); };
  ws('RIFF'); w32(36 + n * 2); ws('WAVE');
  ws('fmt '); w32(16); w16(1); w16(1); w32(rate); w32(rate * 2); w16(2); w16(16);
  ws('data'); w32(n * 2);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true); p += 2;
  }
  return new Uint8Array(buf);
}
// Save a take (or the current clip) through the native save dialog (user click only).
export function saveWavOf(take) {
  const samples = take ? take.samples : wavSamples, rate = take ? take.sampleRate : wavRate;
  if (!samples || !samples.length) { setBadge('nothing to save — generate first', true); return; }
  const p = saveFile('WAV Files|wav', 'omnivoice-' + slug(take ? take.text : $('#text').value) + '.wav');
  if (!p) return;
  try {
    const path = /\.wav$/i.test(p) ? p : p + '.wav';
    _fs.writeFileSync(path, encodeWavPCM16(samples, rate));
    $('#run-meta').textContent = 'saved ' + (samples.length / rate).toFixed(2) + 's → ' + path;
  } catch (e) { setBadge('save: ' + e.message, true); }
}
export function saveWav() { saveWavOf(null); }
// Samples per frame at the codec rate, for callers mapping frames to audio.
export const SAMPLES_PER_FRAME = SPF;
