// Headless smoke for the kokoro-lab voice designer: exercise the real runtime
// path the sliders drive — basis math -> createVoice -> synthesizeTraced — and
// confirm every seed produces finite, audible audio with the trace stages.
// (KK/BS are renamed off kokoro/basis only to avoid colliding with app.js,
// which the headless runtime auto-loads into the same global scope first.)
//   bro-headless ../broworkshop/demos/kokoro-lab ../broworkshop/demos/kokoro-lab/_smoke_designer.js
const fs = require('fs');
// Weights root: defaults to the Windows D: layout; override with BRO_WEIGHTS
// (e.g. /mnt/d/projects under WSL) to run on other hosts.
const WROOT = (typeof process !== 'undefined' && process.env.BRO_WEIGHTS) || 'D:/projects';
const MODEL = WROOT + '/brosoundml/weights/kokoro';
bro.tts.setAssetRoot(WROOT + '/brosoundml');
const KK = bro.tts.loadKokoro(MODEL);
const BS = JSON.parse(fs.readFileSync(MODEL + '/voice_basis.json', 'utf8'));
assert(BS.k === 20 && BS.dim === 256, 'BS shape');
assert(BS.axisKind && BS.axisKind.filter((x) => x === 'attr').length === 6, 'six attribute axes');
assert(BS.axisName[0] === 'pitch', 'axis 0 is pitch');
const ids = bro.tts.phonemize('Hello there. This is a test of the pipeline.');

function sfc(coords) {
  const { dim, k, mean, comps, std } = BS;
  const s = new Float32Array(dim);
  for (let d = 0; d < dim; d++) s[d] = mean[d];
  for (let i = 0; i < k; i++) { const c = coords[i] * std[i]; if (!c) continue; const v = comps[i]; for (let d = 0; d < dim; d++) s[d] += c * v[d]; }
  return s;
}
function check(label, coords) {
  const v = KK.createVoice(sfc(coords), 'designed');
  const r = KK.synthesizeTraced(ids, v);
  let peak = 0, bad = 0;
  for (let i = 0; i < r.samples.length; i++) { const a = Math.abs(r.samples[i]); if (!isFinite(a)) bad++; if (a > peak) peak = a; }
  assert(bad === 0, label + ': non-finite samples');
  assert(peak > 0.01, label + ': silent (peak ' + peak.toFixed(4) + ')');
  assert(r.stages.length >= 8, label + ': missing trace stages');
  console.log(label.padEnd(16), 'peak', peak.toFixed(3), '·', (r.samples.length / r.sampleRate).toFixed(2) + 's', '·', r.stages.length, 'stages');
}

const z = new Float64Array(BS.k);
check('neutral', z);                                   // centroid
check('af_heart', BS.anchors[BS.names.indexOf('af_heart')]);
check('bm_lewis', BS.anchors[BS.names.indexOf('bm_lewis')]);
// a random in-distribution draw + a hard push on the pitch axis (axis 0)
const rnd = Float64Array.from(BS.range.map(([lo, hi]) => lo + 0.5 * (hi - lo)));
check('mid-range', rnd);
const deep = z.slice(); deep[0] = BS.range[0][0];   // extreme on the pitch axis
check('pitch-extreme', deep);

// voice_bridge.bin loads and applies to a 256-D style of the right scale
const buf = fs.readFileSync(MODEL + '/voice_bridge.bin').buffer;
const iv = new Int32Array(buf, 0, 2); const D = iv[0], M = iv[1];
let off = 8; const xm = new Float32Array(buf, off, D); off += 4 * D; const ym = new Float32Array(buf, off, M); off += 4 * M; const B = new Float32Array(buf, off, D * M);
assert(D === 1024 && M === 256, 'bridge dims');
// apply to xm (zero deviation) -> should return ym; createVoice must render it
const v = KK.createVoice(Float32Array.from(ym), 'bridge_ym');
const r = KK.synthesizeTraced(ids, v);
let bad = 0, peak = 0; for (let i = 0; i < r.samples.length; i++) { const a = Math.abs(r.samples[i]); if (!isFinite(a)) bad++; if (a > peak) peak = a; }
assert(bad === 0 && peak > 0.01, 'bridge ym render');
console.log('bridge ym render  peak', peak.toFixed(3));
console.log('SMOKE OK');
