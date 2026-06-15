// Headless smoke for Sortformer Lab — drives the app's own module state through
// the load → streaming-session feed → timeline loop, on a real speech clip.
//
// Run (GPU) against the app dir from the bro repo root:
//   bro-headless ../broworkshop/demos/sortformer-lab tests/test_smoke.js
//
// Needs the converted checkpoint (SORTFORMER_DIR env to override) and a 16 kHz
// mono speech clip (SORTFORMER_WAV env to override).
//
// ESM: the app's app.js is mounted at /app/, so importing its exports gives the
// SAME instances the app initialized.
import { state, defaultModelDir, loadModel, feedWindow, clearTimeline } from "/app/app.js";

function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) { sleep(20); }
  return pred();
}

const env = (typeof process !== 'undefined' && process.env) ? process.env : {};
const MODEL_DIR = env.SORTFORMER_DIR || defaultModelDir();
const WAV = env.SORTFORMER_WAV ||
  'D:/projects/brosoundml/weights/qwen-tts-hello-there-this-is-a-test-of-th.wav';

// ── 1. load the model ────────────────────────────────────────────────────────
loadModel(MODEL_DIR);
assert(pumpUntil(() => state.model || document.querySelector('#backend').classList.contains('err'), 300000),
       'model load finished');
assert(!document.querySelector('#backend').classList.contains('err'),
       'model loaded without error: ' + document.querySelector('#backend').textContent);
assert(state.model.loaded && state.model.sampleRate === 16000, 'sortformer handle loaded @ 16 kHz');
assert(state.model.numSpeakers === 4, 'model reports 4 speakers');
console.log('model: spks=' + state.model.numSpeakers + ' frameSeconds=' + state.model.frameSeconds +
            ' enc=' + state.model.fcDModel + ' head=' + state.model.tfDModel);

// ── 2. decode a real 16 kHz mono clip ────────────────────────────────────────
const ctx = new AudioContext();
const dec = ctx.decodeAudioFile(WAV);
assert(dec && dec.samples && dec.numFrames, 'decoded the test WAV');
// downmix + resample to 16 kHz mono
const ch = dec.channels || 1, nf = dec.numFrames, sr = dec.sampleRate || 16000;
let mono = new Float32Array(nf);
for (let i = 0; i < nf; i++) { let s = 0; for (let c = 0; c < ch; c++) s += dec.samples[i * ch + c]; mono[i] = s / ch; }
if (Math.abs(sr - 16000) > 1) {
  const ratio = 16000 / sr, n = Math.floor(mono.length * ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / ratio, j = t | 0, f = t - j; const a = mono[j], b = mono[j + 1] !== undefined ? mono[j + 1] : a; out[i] = a * (1 - f) + b * f; }
  mono = out;
}
console.log('clip: ' + (mono.length / 16000).toFixed(2) + ' s @ 16 kHz');

// ── 3. drive the streaming session window-by-window (the lab's live path) ────
state.session = state.model.createSession();
clearTimeline();
state.session = state.model.createSession();   // clearTimeline reset the (now stale) session

const WIN = 16000;     // 1 s windows, like the live tick
let maxProb = 0, totalEmitted = 0;
for (let off = 0; off < mono.length; off += WIN) {
  const win = mono.subarray(off, Math.min(off + WIN, mono.length));
  const d = feedWindow(win);
  assert(d && d.numSpeakers === 4, 'feed returned a 4-speaker result');
  for (let i = 0; i < d.probs.length; i++) {
    const p = d.probs[i];
    assert(p >= 0 && p <= 1, 'prob in [0,1]');
    if (p > maxProb) maxProb = p;
  }
  totalEmitted += d.numFrames;
}
console.log('emitted ' + totalEmitted + ' diarization frames; max activity ' + maxProb.toFixed(3));
assert(totalEmitted > 0, 'streaming feed emitted frames');
assert(state.frames.length > 0, 'timeline accumulated frames');
assert(state.totalFrames === totalEmitted, 'timeline frame count matches emissions');
// clean speech should light up at least one speaker
assert(maxProb > 0.3, 'detected speaker activity on the speech clip (max ' + maxProb.toFixed(3) + ')');

// ── 4. reset clears state ────────────────────────────────────────────────────
clearTimeline();
assert(state.frames.length === 0 && state.totalFrames === 0, 'clear emptied the timeline');

console.log('SORTFORMER-LAB SMOKE OK');
