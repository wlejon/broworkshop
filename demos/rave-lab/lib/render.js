// ═══ waveforms + pipeline orchestration ══════════════════════════════════════

import { $ } from "/app/lib/state.js";
import { rave, setBadge } from "/app/lib/model.js";
import { publishClip, playClipId } from "/app/lib/audio.js";
import { computeDimRanges, buildCurves } from "/app/lib/curves.js";

export let srcClipId = -1;       // published audio clip for the source (A)
export let outClipId = -1;       // published audio clip for the morph   (B)
export let enc = null;           // { latent:Float32Array, nLatent, frames } — the ORIGINAL encode
export let work = null;          // Float32Array(nLatent*frames) — the editable latent (channel-major)
export let busy = false;         // an encode/decode is in flight (guards the UI)

let srcSamples = null;           // Float32Array — source audio at rave.sampleRate
let lastOut = null;              // Float32Array — most recent decoded waveform (interleaved if stereo)
let outChannels = 1;             // channel count of lastOut (2 when the stereo toggle is on)

let srcWaveCv = null, outWaveCv = null;

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// Min/max-per-column waveform draw (peak envelope), zero line centered.
function drawWave(cv, data, color) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, mid = H / 2;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#1b2330';
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
  if (!data || !data.length) return;
  const n = data.length, per = Math.max(1, Math.floor(n / W));
  let peak = 1e-6;
  for (let i = 0; i < n; i++) { const a = Math.abs(data[i]); if (a > peak) peak = a; }
  ctx.strokeStyle = color;
  for (let x = 0; x < W; x++) {
    let lo = 0, hi = 0;
    const s0 = x * per, s1 = Math.min(n, s0 + per);
    for (let i = s0; i < s1; i++) { const v = data[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const y0 = mid - (hi / peak) * mid, y1 = mid - (lo / peak) * mid;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1 + 0.5); ctx.stroke();
  }
}

// Build the two waveform rows once; later refreshes redraw into these canvases.
function buildWaves() {
  const host = $('#waves');
  host.textContent = '';
  const mk = (label, color) => {
    const row = el('div', 'wave-row');
    row.appendChild(el('span', 'wave-label', label));
    const cv = document.createElement('canvas');
    cv.width = 1100; cv.height = 96;
    row.appendChild(cv);
    host.appendChild(row);
    return cv;
  };
  srcWaveCv = mk('source', '#5aa0e0');
  outWaveCv = mk('morph', '#ffcf6b');
}

// Downmix an interleaved buffer to mono for the envelope draw (no-op if mono).
function toMono(samples, channels) {
  if (!samples || channels <= 1) return samples;
  const nf = Math.floor(samples.length / channels);
  const m = new Float32Array(nf);
  for (let i = 0; i < nf; i++) {
    let s = 0; for (let c = 0; c < channels; c++) s += samples[i * channels + c];
    m[i] = s / channels;
  }
  return m;
}

function refreshWaves() {
  if (!srcWaveCv) buildWaves();
  drawWave(srcWaveCv, srcSamples, '#5aa0e0');
  drawWave(outWaveCv, toMono(lastOut, outChannels), '#ffcf6b');
}

// ── pipeline ─────────────────────────────────────────────────────────────────

// Adopt a new source clip: publish it for monitoring, then encode + decode.
export function setSource(samples, label) {
  if (!rave) { setBadge('load a model first', true); return; }
  srcSamples = samples;
  srcClipId = publishClip(srcClipId, srcSamples);
  $('#btn-play-src').disabled = (srcClipId < 0);
  const secs = (srcSamples.length / rave.sampleRate).toFixed(2);
  $('#src-meta').textContent = `${label} · ${srcSamples.length} samp · ${secs}s`;
  encodeSource();
}

function encodeSource() {
  if (!rave || !srcSamples || busy) return;
  busy = true; setBadge('encoding…');
  try {
    enc = rave.encode(srcSamples);
    work = Float32Array.from(enc.latent);
    computeDimRanges();
    buildCurves();
    $('#curves-head').style.display = '';
    $('#hint').style.display = 'none';
    $('#btn-decode').disabled = false;
    $('#btn-reset').disabled = false;
    setBadge(`encoded · ${enc.nLatent} × ${enc.frames}`);
  } catch (e) { setBadge('encode failed: ' + e.message, true); }
  busy = false;
  runDecode($('#autoplay').checked);
}

// Decode the (possibly edited) latent and publish the morph clip.
export function runDecode(autoplay) {
  if (!rave || !enc || busy) return;
  busy = true; setBadge('decoding…');
  const t0 = Date.now();
  try {
    // Fixed seed so the stochastic branches (noise + the per-channel stereo
    // latent pad) stay reproducible while editing curves — only the latent edits
    // change the morph, not the noise / width draw.
    const stereo = $('#stereo').checked;
    const width = parseFloat($('#width').value);
    const out = rave.decode(work, enc.frames, {
      addNoise: $('#noise').checked,
      seed: 1,
      channels: stereo ? 2 : 1,
      stereoWidth: stereo ? (isFinite(width) ? width : 1.0) : 0,
    });
    lastOut = out.samples;
    outChannels = out.channels || 1;
    outClipId = publishClip(outClipId, lastOut, outChannels);
    $('#btn-play-out').disabled = (outClipId < 0);
    refreshWaves();
    let peak = 0; for (let i = 0; i < lastOut.length; i++) { const a = Math.abs(lastOut[i]); if (a > peak) peak = a; }
    const frames = lastOut.length / outChannels;
    $('#run-meta').textContent = `decode ${Date.now() - t0}ms · ${frames} samp` +
      `${outChannels > 1 ? ' ×' + outChannels : ''} · peak ${peak.toFixed(3)}`;
    setBadge('ready');
  } catch (e) { setBadge('decode failed: ' + e.message, true); }
  busy = false;
  // defer auto-play a few frames so the clip upload lands before we trigger it
  if (autoplay && outClipId >= 0) setTimeout(() => playClipId(outClipId), 60);
}
