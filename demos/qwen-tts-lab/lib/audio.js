// ═══ audio — clip publish/play + the gapless streaming queue ══════════════════
// bro's AudioContext is clip-based (broaudio): createClip publishes samples to
// the audio thread (lock-free RCU hand-off), playClip triggers a voice. There is
// no sample-accurate clip scheduling, so the stream queue lines chunks up against
// a currentTime accumulator with a small startup cushion — the standard Web-Audio
// streaming pattern. Since Qwen's codec is causal, chunk samples are final, so
// back-to-back clips join without discontinuity (only timing, not content, drifts).

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

// Publish the full utterance as one clip (for ♪ replay), replacing the previous.
function setClip(samples, inRate) {
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
function play() {
  if (clipId < 0 || !audioCtx) return;
  try { audioCtx.playClip(clipId, 1.0, false); } catch (e) { setBadge('audio: ' + e.message, true); }
}

// ═══ WAV export ════════════════════════════════════════════════════════════
// Encode the last published full utterance (native 24 kHz, pre-resample) to a
// mono 16-bit PCM WAV and write it out via a native save dialog.
function encodeWavPCM16(samples, rate) {
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
function wavName(prefix) {
  const t = ($('#text').value || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return prefix + (t ? '-' + t : '') + '.wav';
}
function saveWav() {
  if (!wavSamples || !wavSamples.length) { setBadge('nothing to save — render or stream first', true); return; }
  if (typeof showSaveFileDialog !== 'function') { setBadge('save dialog unavailable in this build', true); return; }
  try {
    const p = showSaveFileDialog('WAV Files|wav', wavName('qwen-tts'));
    if (!p) return;
    const path = /\.wav$/i.test(p) ? p : p + '.wav';
    _fs.writeFileSync(path, encodeWavPCM16(wavSamples, wavRate));
    const secs = (wavSamples.length / wavRate).toFixed(2);
    $('#run-meta').textContent = 'saved ' + secs + 's → ' + path;
  } catch (e) { setBadge('save: ' + e.message, true); }
}

// ── streaming queue ─────────────────────────────────────────────────────────
let _streamNext = -1;        // engine time the next chunk should start at
let _streamTimers = [];      // pending setTimeout ids
let _streamClips = [];       // { clip, pid } for cleanup

function streamReset() {
  streamStop();
  _streamNext = -1;
}

// Queue one decoded chunk for gapless playback.
function streamPush(samples) {
  try {
    const ctx = ensureCtx();
    const buf = resampleTo(samples, lastResult ? lastResult.sampleRate : 24000, ctx.sampleRate || 48000);
    const clip = ctx.createClip(buf, 1);
    const dur = buf.length / (ctx.sampleRate || 48000);
    const now = ctx.currentTime;
    if (_streamNext < now + 0.02) _streamNext = now + 0.12;   // startup / underrun cushion
    const at = _streamNext, delay = Math.max(0, (at - now) * 1000);
    const rec = { clip, pid: -1 };
    _streamClips.push(rec);
    const tid = setTimeout(() => {
      try { rec.pid = ctx.playClip(clip, 1.0, false); } catch (e) {}
    }, delay);
    _streamTimers.push(tid);
    _streamNext += dur;
  } catch (e) { setBadge('stream audio: ' + e.message, true); }
}

function streamStop() {
  for (const t of _streamTimers) { try { clearTimeout(t); } catch (e) {} }
  _streamTimers = [];
  for (const r of _streamClips) {
    try { if (r.pid >= 0) audioCtx.stopPlayback(r.pid); } catch (e) {}
    try { audioCtx.deleteClip(r.clip); } catch (e) {}
  }
  _streamClips = [];
}
