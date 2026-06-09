// ═══ audio ═════════════════════════════════════════════════════════════════
// bro's AudioContext is clip-based (broaudio), not Web Audio createBuffer.
//
// Threading note: createClip publishes the samples to the audio thread (a
// lock-free RCU hand-off), playClip triggers playback. Doing both in the same
// tick on every press re-uploads the buffer and fires it before the transfer
// has cycled — and leaks a clip per press. So we upload ONCE per synthesis
// (setClip, in run()'s onDone) and let Play just re-trigger the already-published
// clip; the auto-play after a run is deferred a few frames so the upload lands.
function setClip(samples, inRate) {
  try {
    audioCtx = audioCtx || new AudioContext();
    const outRate = audioCtx.sampleRate || 48000;
    let buf;
    if (Math.abs(outRate - inRate) < 1) {
      buf = samples;
    } else {
      const ratio = outRate / inRate, n = Math.floor(samples.length * ratio);
      buf = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / ratio, j = t | 0, f = t - j;
        buf[i] = samples[j] * (1 - f) + (samples[j + 1] !== undefined ? samples[j + 1] : samples[j]) * f;
      }
    }
    if (clipId >= 0) { try { audioCtx.deleteClip(clipId); } catch (e) {} }
    clipId = audioCtx.createClip(buf, 1);
    clipSamples = buf.length;
    wavSamples = samples;   // keep the native-rate buffer for WAV export (pre-resample)
    wavRate = inRate;
    $('#btn-play').disabled = false;
    $('#btn-save-wav').disabled = false;
  } catch (e) { setBadge('audio: ' + e.message, true); clipId = -1; clipSamples = 0; }
}
function play() {
  if (clipId < 0 || !audioCtx) return;
  try { audioCtx.playClip(clipId, 1.0, false); }
  catch (e) { setBadge('audio: ' + e.message, true); }
}

// ═══ WAV export ════════════════════════════════════════════════════════════
// Encode the last-heard buffer (the exact samples last published to setClip, so
// prosody edits are captured too) to a mono 16-bit PCM WAV and write it out.
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
  if (!wavSamples || !wavSamples.length) { setBadge('nothing to save — run a synthesis first', true); return; }
  if (typeof showSaveFileDialog !== 'function') { setBadge('save dialog unavailable in this build', true); return; }
  try {
    const p = showSaveFileDialog('WAV Files|wav', wavName('kokoro'));
    if (!p) return;
    const path = /\.wav$/i.test(p) ? p : p + '.wav';
    _fs.writeFileSync(path, encodeWavPCM16(wavSamples, wavRate));
    const secs = (wavSamples.length / wavRate).toFixed(2);
    $('#run-meta').textContent = 'saved ' + secs + 's → ' + path;
  } catch (e) { setBadge('save: ' + e.message, true); }
}

// ═══ small helpers ═════════════════════════════════════════════════════════
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function mkCanvas(body, w, h) {
  const wrap = el('div', 'canvas-wrap');
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ov = el('div', 'flow-hl');
  wrap.appendChild(cv); wrap.appendChild(ov);
  body.appendChild(wrap);
  cv._overlay = ov;   // retrieved by renderStages to drive the flow highlight
  return cv;
}
function stats(d) {
  let mn = Infinity, mx = -Infinity, sum = 0;
  for (let i = 0; i < d.length; i++) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
  return { mn, mx, mean: d.length ? sum / d.length : 0 };
}

