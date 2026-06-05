// Validate kokoro.decodeFrom: feeding a trace's own asr/F0/N back in unedited
// must reproduce synthesize's audio exactly (identity), and editing F0 must
// change the audio while staying finite. Proves the re-injection boundary.
//   bro-headless ../broworkshop/demos/kokoro-lab _decode_roundtrip.js
const fs = require('fs');
const MODEL = 'D:/projects/brosoundml/weights/kokoro';
bro.tts.setAssetRoot('D:/projects/brosoundml');
const KK = bro.tts.loadKokoro(MODEL);
const BS = JSON.parse(fs.readFileSync(MODEL + '/voice_basis.json', 'utf8'));
const ids = bro.tts.phonemize('The quick brown fox jumps over the lazy dog.');

// neutral centroid voice
const style = new Float32Array(BS.dim);
for (let d = 0; d < BS.dim; d++) style[d] = BS.mean[d];
const v = KK.createVoice(style, 'rt');

const r = KK.synthesizeTraced(ids, v);
const stage = (n) => r.stages.find((s) => s.name === n);
const asr = stage('asr'), F0s = stage('F0_pred'), Ns = stage('N_pred'), ph = stage('phonemes');
const nph = ph.w;                                  // BOS/EOS-wrapped phoneme count
const total = asr.w;
console.log('phonemes', nph, '· total frames', total, '· asr', asr.h + 'x' + asr.w,
            '· F0', F0s.data.length, '· N', Ns.data.length, '· audio', r.samples.length);
assert(asr.data.length === KK.hiddenDim * total, 'asr is hidden*total');
assert(F0s.data.length === 2 * total && Ns.data.length === 2 * total, 'F0/N are 2*total');

// 1. identity: same inputs -> same audio
const r2 = KK.decodeFrom(v, asr.data, F0s.data, Ns.data, nph);
assert(r2.samples.length === r.samples.length, 'identity: same sample count');
let maxd = 0; for (let i = 0; i < r.samples.length; i++) maxd = Math.max(maxd, Math.abs(r.samples[i] - r2.samples[i]));
console.log('identity max |Δsample| =', maxd.toExponential(2));
assert(maxd < 1e-4, 'decodeFrom reproduces synthesize (identity)');

// 2. edit: push F0 up 20% -> audio must change, stay finite & audible
const F0up = Float32Array.from(F0s.data, (x) => x * 1.2);
const r3 = KK.decodeFrom(v, asr.data, F0up, Ns.data, nph);
let bad = 0, peak = 0, diff = 0;
for (let i = 0; i < r3.samples.length; i++) { const a = Math.abs(r3.samples[i]); if (!isFinite(a)) bad++; if (a > peak) peak = a; diff += Math.abs(r3.samples[i] - r.samples[i]); }
diff /= r3.samples.length;
console.log('F0×1.2: peak', peak.toFixed(3), '· mean |Δ| vs original', diff.toExponential(2));
assert(bad === 0 && peak > 0.01, 'edited audio finite & audible');
assert(diff > 1e-3, 'editing F0 actually changed the audio');

// 3. edit energy (N) down -> changes audio too
const Ndn = Float32Array.from(Ns.data, (x) => x * 0.5);
const r4 = KK.decodeFrom(v, asr.data, F0s.data, Ndn, nph);
let d4 = 0; for (let i = 0; i < r4.samples.length; i++) d4 += Math.abs(r4.samples[i] - r.samples[i]);
console.log('N×0.5: mean |Δ| vs original', (d4 / r4.samples.length).toExponential(2));
assert(d4 / r4.samples.length > 1e-4, 'editing N changed the audio');

console.log('DECODE_FROM OK');
