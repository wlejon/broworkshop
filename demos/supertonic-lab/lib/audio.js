// ═══ audio — clip publish/play + WAV export ══════════════════════════════════
// bro's AudioContext is clip-based (broaudio): createClip publishes samples to
// the audio thread (lock-free RCU hand-off). Supertonic outputs one full mono
// utterance per synthesis, so there's no streaming queue — just publish the clip
// and play it (resampled to the engine rate; the native buffer is kept for WAV).

import { $ } from "/app/lib/state.js";
import { _fs, encodeWavPCM16 } from "/app/lib/helpers.js";
import { setBadge } from "/app/lib/model.js";

export let audioCtx = null;
export function setAudioCtx(v) { audioCtx = v; }
let clipId = -1;
let wavSamples = null;    // native-rate copy of the last buffer (for WAV export)
let wavRate = 44100;

function ensureCtx() { audioCtx = audioCtx || new AudioContext(); return audioCtx; }

function resampleTo(samples, inRate, outRate) {
  if (Math.abs(outRate - inRate) < 1) return samples;
  const ratio = outRate / inRate, n = Math.floor(samples.length * ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / ratio, j = t | 0, f = t - j;
    const a = samples[j], b = samples[j + 1] !== undefined ? samples[j + 1] : a;
    out[i] = a * (1 - f) + b * f;
  }
  return out;
}

// Publish the utterance as one clip (for ▶ / ♪), replacing the previous.
export function setClip(samples, inRate) {
  try {
    const ctx = ensureCtx();
    const buf = resampleTo(samples, inRate, ctx.sampleRate || 48000);
    if (clipId >= 0) { try { ctx.deleteClip(clipId); } catch (e) {} }
    clipId = ctx.createClip(buf, 1);
    wavSamples = samples;   // keep the native-rate buffer for WAV export (pre-resample)
    wavRate = inRate;
    $('#btn-play').disabled = false;
    $('#btn-save-wav').disabled = false;
  } catch (e) { setBadge('audio: ' + e.message, true); clipId = -1; }
}

export function play() {
  if (clipId < 0 || !audioCtx) return;
  try { audioCtx.playClip(clipId, 1.0, false); } catch (e) { setBadge('audio: ' + e.message, true); }
}

function wavName() {
  const t = ($('#text').value || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return 'supertonic' + (t ? '-' + t : '') + '.wav';
}
export function saveWav() {
  if (!wavSamples || !wavSamples.length) { setBadge('nothing to save — synthesize first', true); return; }
  if (typeof showSaveFileDialog !== 'function') { setBadge('save dialog unavailable in this build', true); return; }
  try {
    const p = showSaveFileDialog('WAV Files|wav', wavName());
    if (!p) return;
    const path = /\.wav$/i.test(p) ? p : p + '.wav';
    _fs.writeFileSync(path, encodeWavPCM16(wavSamples, wavRate));
    const secs = (wavSamples.length / wavRate).toFixed(2);
    $('#run-meta').textContent = 'saved ' + secs + 's → ' + path;
  } catch (e) { setBadge('save: ' + e.message, true); }
}
