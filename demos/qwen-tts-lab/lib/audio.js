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
    $('#btn-play').disabled = false;
  } catch (e) { setBadge('audio: ' + e.message, true); clipId = -1; }
}
function play() {
  if (clipId < 0 || !audioCtx) return;
  try { audioCtx.playClip(clipId, 1.0, false); } catch (e) { setBadge('audio: ' + e.message, true); }
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
