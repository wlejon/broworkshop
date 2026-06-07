// ═══ audio I/O ═══════════════════════════════════════════════════════════════
// bro's AudioContext is clip-based (broaudio): publish a Float32 buffer with
// createClip (a lock-free RCU hand-off to the audio thread), then re-trigger it
// with playClip. Publishing and playing in the SAME tick re-uploads before the
// transfer has cycled, so we publish ONCE per source / per decode and let the
// transport buttons just re-trigger the already-published clip. Auto-play after
// a decode is deferred a few frames so the upload lands first.

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

// Publish a mono buffer (at rave.sampleRate) to a clip slot, replacing the old
// one. Returns the new clip id, or -1 on failure.
function publishClip(prevId, samples) {
  try {
    const ctx = ensureCtx();
    const buf = resample(samples, rave ? rave.sampleRate : ctx.sampleRate, ctx.sampleRate || 48000);
    if (prevId >= 0) { try { ctx.deleteClip(prevId); } catch (e) {} }
    return ctx.createClip(buf, 1);
  } catch (e) { setBadge('audio: ' + e.message, true); return -1; }
}

function playClipId(id) {
  if (id < 0 || !audioCtx) return;
  try { audioCtx.playClip(id, 1.0, false); }
  catch (e) { setBadge('audio: ' + e.message, true); }
}

// Decode an audio file off disk to mono Float32 at rave.sampleRate.
function decodeFileToSource(path) {
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
  return resample(mono, dec.sampleRate, rave.sampleRate);
}

// Synthesize a test tone (at rave.sampleRate) — gives the latent something with
// structure to encode when there's no file handy.
function genTone(kind, freq, secs) {
  const sr = rave.sampleRate;
  const n = Math.max(1, Math.floor(secs * sr));
  const out = new Float32Array(n);
  const w = 2 * Math.PI * freq / sr;
  for (let i = 0; i < n; i++) {
    let v = 0;
    if (kind === 'sine') {
      v = Math.sin(w * i);
    } else if (kind === 'harm') {
      v = Math.sin(w * i) + 0.5 * Math.sin(2 * w * i) + 0.25 * Math.sin(3 * w * i)
        + 0.12 * Math.sin(4 * w * i);
    } else if (kind === 'saw') {
      const ph = (i * freq / sr) % 1; v = 2 * ph - 1;
    } else if (kind === 'sweep') {
      const f = freq * Math.pow(8, i / n);                 // up 3 octaves
      v = Math.sin(2 * Math.PI * f * i / sr);
    } else if (kind === 'noise') {
      v = Math.random() * 2 - 1;
    }
    // gentle fade in/out so the encoder sees a clean onset/offset
    const fade = sr * 0.01;
    const g = Math.min(1, i / fade) * Math.min(1, (n - i) / fade);
    out[i] = 0.3 * v * g;
  }
  return out;
}
