// Headless smoke for the Cluster Diarization Lab — drives the app's own module
// through load → diarize on a real two-female clip, asserting the two similar
// voices are separated into 2 speakers (the case Sortformer's 4-slot head
// collapses to 1).
//
// Run (GPU) from the bro repo root:
//   bro-headless ../broworkshop/demos/cluster-diar-lab \
//       ../broworkshop/demos/cluster-diar-lab/tests/test_smoke.js
//
// Needs the Sortformer checkpoint, the speaker-encoder artifact (with
// xvector_mean.f32), and the Kokoro sample clips (KOKORO_DIR env to override).

import { state, defaultSortDir, defaultEncDir, loadModel, diarizeBuffer, clearTimeline }
  from "/app/app.js";

const fs = require('fs');
const env = (typeof process !== 'undefined' && process.env) ? process.env : {};
const KOKORO = env.KOKORO_DIR || 'D:/projects/brosoundml/weights/kokoro/out';

function pumpUntil(pred, ms) {
  const t0 = Date.now();
  while (!pred() && Date.now() - t0 < ms) sleep(20);
  return pred();
}

// Read a 16-bit PCM WAV (any rate / channels), downmix to mono, linear-resample
// to 16 kHz. Raw read — NOT decodeAudioFile — to avoid the context-rate round
// trip that blurs the speaker margin.
function readWav16k(path) {
  const buf = fs.readFileSync(path);
  const u8 = new Uint8Array(buf.buffer || buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let off = 12, ch = 1, rate = 16000, dataOff = 44, dataLen = u8.length - 44;
  while (off + 8 <= u8.length) {
    const id = String.fromCharCode(u8[off], u8[off+1], u8[off+2], u8[off+3]);
    const sz = dv.getUint32(off + 4, true);
    if (id === 'fmt ') { ch = dv.getUint16(off+10, true); rate = dv.getUint32(off+12, true); }
    else if (id === 'data') { dataOff = off + 8; dataLen = sz; break; }
    off += 8 + sz + (sz & 1);
  }
  const n = Math.floor(dataLen / 2 / ch);
  let mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += dv.getInt16(dataOff + (i*ch + c)*2, true);
    mono[i] = s / ch / 32768;
  }
  if (Math.abs(rate - 16000) > 1) {
    const r = 16000 / rate, m = Math.floor(mono.length * r), o = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const t = i / r, j = t | 0, f = t - j;
      const a = mono[j], b = mono[j+1] !== undefined ? mono[j+1] : a;
      o[i] = a*(1-f) + b*f;
    }
    mono = o;
  }
  return mono;
}

// ── 1. load ──────────────────────────────────────────────────────────────────
loadModel(defaultSortDir(), defaultEncDir());
assert(pumpUntil(() => state.model || document.querySelector('#backend').classList.contains('err'), 300000),
       'model load finished');
assert(!document.querySelector('#backend').classList.contains('err'),
       'models loaded: ' + document.querySelector('#backend').textContent);
assert(state.model.loaded, 'cluster diarizer loaded');

// ── 2. build a clean two-female clip (Bella + Emma, alternating turns) ────────
const A = ['af_bella/synth_0.wav', 'af_bella/synth_2.wav'];
const B = ['bf_emma/synth_0.wav',  'bf_emma/synth_2.wav'];
const gap = new Float32Array(Math.floor(0.4 * 16000));
const parts = [];
for (let k = 0; k < 2; k++) {
  parts.push(readWav16k(KOKORO + '/' + A[k]), gap);
  parts.push(readWav16k(KOKORO + '/' + B[k]), gap);
}
let total = 0; for (const p of parts) total += p.length;
const clip = new Float32Array(total);
let o = 0; for (const p of parts) { clip.set(p, o); o += p.length; }
console.log('clip ' + (clip.length / 16000).toFixed(2) + ' s, two female voices');

// ── 3. sync diarize → expect 2 speakers ──────────────────────────────────────
const d = state.model.diarize({ samples: clip, sampleRate: 16000 }, { clusterThreshold: 0.40 });
console.log('sync diarize: numSpeakers=' + d.numSpeakers + ' numFrames=' + d.numFrames);
assert(d.numSpeakers === 2, 'two similar female voices → 2 speakers (got ' + d.numSpeakers + ')');

// ── 4. async path through the app's render loop ───────────────────────────────
clearTimeline();
diarizeBuffer(clip);
assert(pumpUntil(() => state.result && !state.busy, 60000), 'async diarizeBuffer completed');
assert(state.result.numSpeakers === 2, 'app render path → 2 speakers (got ' + state.result.numSpeakers + ')');
assert(document.querySelectorAll('#speakers .spk').length === 2, 'two speaker chips rendered');

console.log('CLUSTER-DIAR-LAB SMOKE OK');
