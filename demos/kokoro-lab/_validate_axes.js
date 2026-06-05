// End-to-end check that each supervised attribute axis actually moves its
// attribute THROUGH the model — not just in the offline regression. For each
// axis we push it to its - and + realizable extreme (others held at 0), run the
// real traced synthesis, and read the model's own F0/energy/duration contours
// plus waveform stats. A passing axis moves its metric in the expected direction.
//   bro-headless ../broworkshop/demos/kokoro-lab _validate_axes.js
const fs = require('fs');
const MODEL = 'D:/projects/brosoundml/weights/kokoro';
bro.tts.setAssetRoot('D:/projects/brosoundml');
const KK = bro.tts.loadKokoro(MODEL);
const BS = JSON.parse(fs.readFileSync(MODEL + '/voice_basis.json', 'utf8'));
const ids = bro.tts.phonemize('The quick brown fox jumps over the lazy dog.');

function sfc(coords) {
  const { dim, k, mean, comps, std } = BS;
  const s = new Float32Array(dim);
  for (let d = 0; d < dim; d++) s[d] = mean[d];
  for (let i = 0; i < k; i++) { const c = coords[i] * std[i]; if (!c) continue; const v = comps[i]; for (let d = 0; d < dim; d++) s[d] += c * v[d]; }
  return s;
}
const mean = (d) => { let s = 0; for (let i = 0; i < d.length; i++) s += d[i]; return s / d.length; };
const std = (d) => { const m = mean(d); let v = 0; for (let i = 0; i < d.length; i++) { const x = d[i] - m; v += x * x; } return Math.sqrt(v / d.length); };
const rms = (d) => { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length); };
const zcr = (d) => { let c = 0; for (let i = 1; i < d.length; i++) if ((d[i] < 0) !== (d[i - 1] < 0)) c++; return c / d.length; };

function render(coords) {
  const v = KK.createVoice(sfc(coords), 'designed');
  const r = KK.synthesizeTraced(ids, v);
  const st = (n) => { const s = r.stages.find((x) => x.name === n); return s ? s.data : new Float32Array(1); };
  const f0 = st('F0_pred'), n = st('N_pred');
  // F0 mean over voiced (>40 Hz) frames only — silence frames sit near 0
  const voiced = []; for (let i = 0; i < f0.length; i++) if (f0[i] > 40) voiced.push(f0[i]);
  return {
    pitch: voiced.length ? mean(voiced) : 0,
    pitchVar: voiced.length ? std(voiced) : 0,
    energy: mean(n),
    frames: r.durations.reduce((a, b) => a + b, 0),   // total duration (pace inverse)
    volume: rms(r.samples),
    brightness: zcr(r.samples),
  };
}

// axis index -> which measured metric it should move, and the expected sign of
// the change as the slider goes - to + (regression points toward higher attr).
const METRIC = { pitch: 'pitch', brightness: 'brightness', pace: 'frames', energy: 'energy', volume: 'volume', 'pitch-var': 'pitchVar' };
const SIGN = { pitch: +1, brightness: +1, pace: -1, energy: +1, volume: +1, 'pitch-var': +1 };  // pace+ = faster = fewer frames

console.log('axis        metric        −σ        +σ      Δ%    dir  ok');
let pass = 0, total = 0;
for (let k = 0; k < BS.k; k++) {
  if (BS.axisKind[k] !== 'attr') continue;
  const name = BS.axisName[k], metric = METRIC[name];
  const lo = BS.range[k][0], hi = BS.range[k][1];
  const cm = new Float64Array(BS.k); cm[k] = lo;     // − extreme
  const cp = new Float64Array(BS.k); cp[k] = hi;     // + extreme
  const a = render(cm)[metric], b = render(cp)[metric];
  const dpct = 100 * (b - a) / (Math.abs(a) || 1);
  const expect = SIGN[name];
  const ok = Math.sign(b - a) === expect && Math.abs(dpct) > 3;
  pass += ok; total++;
  console.log(
    name.padEnd(11), metric.padEnd(11),
    a.toFixed(2).padStart(8), b.toFixed(2).padStart(8),
    (dpct >= 0 ? '+' : '') + dpct.toFixed(0) + '%',
    (expect > 0 ? 'up ' : 'dn '), ok ? 'YES' : 'no');
}
console.log('\n' + pass + '/' + total + ' attribute axes move their metric in the expected direction & magnitude');
