// Listening harness for the Tier-1 emotion basis (contrastive directions).
// Self-contained: loads Kokoro + the emotion/voice basis directly (own var names,
// no app-global collisions), builds the neutral centroid voice, then renders the
// SAME sentence neutral + once per emotion at its calibrated default α and at a
// stronger push, writing 24 kHz WAVs to ./output for A/B.
//   bro-headless ../broworkshop/demos/kokoro-lab _emotion_clips.js
(function () {
const _path = require('path');
const _fs = require('fs');
const _ROOT = 'D:/projects/brosoundml';
const _MODEL = _ROOT + '/weights/kokoro';
const _OUT = _path.join(__dirname, 'output');
if (!_fs.existsSync(_OUT)) { _fs.mkdirSync(_OUT, { recursive: true }); }
const _TEXT = "I really did not expect this to happen today.";
const _STRONG = 1.8;            // second pass multiplier on default α
function writeWav16(path, samples, sampleRate) {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  dv.setUint32(0, 0x52494646, false); dv.setUint32(4, 36 + n * 2, true);
  dv.setUint32(8, 0x57415645, false); dv.setUint32(12, 0x666d7420, false);
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  dv.setUint32(36, 0x64617461, false); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { let s = samples[i]; if (s > 1) s = 1; if (s < -1) s = -1; dv.setInt16(44 + i * 2, Math.round(s * 32767), true); }
  _fs.writeFileSync(path, new Uint8Array(buf));
}

bro.tts.setAssetRoot(_ROOT);
const _k = bro.tts.loadKokoro(_MODEL);
const _vb = JSON.parse(_fs.readFileSync(_MODEL + '/voice_basis.json', 'utf-8'));
const _eb = JSON.parse(_fs.readFileSync(_MODEL + '/emotion_basis.json', 'utf-8'));
const _ids = bro.tts.phonemize(_TEXT);
console.log('method:', _eb.method);
console.log('text  :', JSON.stringify(_TEXT), '·', _ids.length, 'phonemes\n');

// neutral centroid style, and a helper to render style -> wav
function neutralStyle() { const s = new Float32Array(_vb.dim); for (let d = 0; d < _vb.dim; d++) s[d] = _vb.mean[d]; return s; }
function render(name, style) {
  const v = _k.createVoice(style, name);
  const out = _k.synthesize(_ids, v, {});
  const p = _OUT + '/' + name + '.wav';
  writeWav16(p, out.samples, out.sampleRate);
  console.log('  wrote', (name + '.wav').padEnd(22), (out.samples.length / out.sampleRate).toFixed(2) + 's');
}

render('00_neutral', neutralStyle());
for (const pass of [['', 1], ['_strong', _STRONG]]) {
  const [suffix, mult] = pass;
  for (const e of _eb.emotions) {
    const a = (_eb.defaultAlpha[e] || 2) * mult;
    const s = neutralStyle(); const dir = _eb.full[e];
    for (let d = 0; d < s.length; d++) s[d] += a * dir[d];
    render(_eb.label[e] + '_' + e + suffix, s);
  }
}
console.log('\nclips in', _OUT);
console.log('EMOTION_CLIPS OK');
})();
