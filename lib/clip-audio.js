// clip-audio.js — shared audio I/O for node-forge's audio domain nodes
// (RAVE, Kokoro, ...): WAV/file decode, tone synthesis, AudioContext clip
// publish/play, and a peak-envelope waveform draw.
//
// Generalizes rave-lab/lib/audio.js + render.js's drawWave: the original
// hardcoded a module-level `rave` handle for its sample rate; every
// function here takes sampleRate explicitly instead, since node-forge's
// graph can host multiple model domains (RAVE at 48kHz, Kokoro at 24kHz,
// ...) with no single implicit "the model".
//
// bro's AudioContext is clip-based (broaudio): publish a Float32 buffer
// with createClip (a lock-free RCU hand-off to the audio thread), then
// re-trigger it with playClip. Publish once per buffer and let repeat
// "play" calls just re-trigger the already-published clip.
//
// Do NOT add to lib/audio.js — that's the unrelated game-SFX bus (square/
// triangle/sine blips for arcade menu feedback), not this.

  let audioCtx = null;

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

  // Publish a clip to a slot, replacing any previous one there. `samples` is
  // mono, or interleaved when channels === 2 (samples[t*2 + c]), at
  // `sourceRate` Hz. Resamples to the AudioContext's rate, uploads, returns
  // the new clip id (or -1 on failure). Deletes prevId first if >= 0.
  function publishClip(prevId, samples, channels, sourceRate) {
    channels = channels || 1;
    try {
      const ctx = ensureCtx();
      const inRate = sourceRate || ctx.sampleRate, outRate = ctx.sampleRate || 48000;
      let buf;
      if (channels === 1) {
        buf = resample(samples, inRate, outRate);
      } else {
        const nf = Math.floor(samples.length / channels);
        const planes = [];
        for (let c = 0; c < channels; c++) {
          const p = new Float32Array(nf);
          for (let i = 0; i < nf; i++) p[i] = samples[i * channels + c];
          planes.push(resample(p, inRate, outRate));
        }
        const onf = planes[0].length;
        buf = new Float32Array(onf * channels);
        for (let c = 0; c < channels; c++)
          for (let i = 0; i < onf; i++) buf[i * channels + c] = planes[c][i];
      }
      if (prevId >= 0) { try { ctx.deleteClip(prevId); } catch (e) {} }
      return ctx.createClip(buf, channels);
    } catch (e) { return -1; }
  }

  function playClipId(id) {
    if (id < 0) return;
    try { ensureCtx().playClip(id, 1.0, false); } catch (e) {}
  }

  // Decode an audio file off disk to mono Float32 at targetRate Hz.
  function decodeFileToSource(path, targetRate) {
    const ctx = ensureCtx();
    const dec = ctx.decodeAudioFile(path);
    if (!dec || !dec.samples || !dec.numFrames) return null;
    const ch = dec.channels || 1, nf = dec.numFrames;
    let mono;
    if (ch === 1) {
      mono = dec.samples.length === nf ? dec.samples : dec.samples.subarray(0, nf);
    } else {
      mono = new Float32Array(nf);
      for (let i = 0; i < nf; i++) {
        let s = 0; for (let c = 0; c < ch; c++) s += dec.samples[i * ch + c];
        mono[i] = s / ch;
      }
    }
    return resample(mono, dec.sampleRate, targetRate);
  }

  // Synthesize a test tone at `sampleRate` Hz — gives an encoder something
  // with structure when there's no file handy.
  function genTone(kind, freq, secs, sampleRate) {
    const sr = sampleRate;
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
        const f = freq * Math.pow(8, i / n);
        v = Math.sin(2 * Math.PI * f * i / sr);
      } else if (kind === 'noise') {
        v = Math.random() * 2 - 1;
      }
      const fade = sr * 0.01;
      const g = Math.min(1, i / fade) * Math.min(1, (n - i) / fade);
      out[i] = 0.3 * v * g;
    }
    return out;
  }

  // Downmix an interleaved buffer to mono for a peak-envelope draw (no-op if
  // already mono).
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

  // Min/max-per-column waveform draw (peak envelope), zero line centered.
  function drawWaveform(canvas, data, channels, color) {
    const mono = toMono(data, channels || 1);
    const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, mid = H / 2;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#1b2330';
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
    if (!mono || !mono.length) return;
    const n = mono.length, per = Math.max(1, Math.floor(n / W));
    let peak = 1e-6;
    for (let i = 0; i < n; i++) { const a = Math.abs(mono[i]); if (a > peak) peak = a; }
    ctx.strokeStyle = color || '#5aa0e0';
    for (let x = 0; x < W; x++) {
      let lo = 0, hi = 0;
      const s0 = x * per, s1 = Math.min(n, s0 + per);
      for (let i = s0; i < s1; i++) { const v = mono[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      const y0 = mid - (hi / peak) * mid, y1 = mid - (lo / peak) * mid;
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1 + 0.5); ctx.stroke();
    }
  }

  export const ClipAudio = {
    ensureCtx: ensureCtx,
    publishClip: publishClip,
    playClipId: playClipId,
    decodeFileToSource: decodeFileToSource,
    genTone: genTone,
    drawWaveform: drawWaveform,
  };
