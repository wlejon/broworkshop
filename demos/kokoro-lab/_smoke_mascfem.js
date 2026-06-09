// Headless smoke for the kokoro-lab masc↔fem axis: exercise the real app path —
// loadMascFemBasis -> buildMascFem -> addMascFem in rebuildVoice -> synthesize — and
// confirm the bipolar offset applies and renders finite, audible audio. Sync APIs
// (the static app can't pace async model load headless). Sets the app's own globals.
//   bro-headless ../broworkshop/demos/kokoro-lab ../broworkshop/demos/kokoro-lab/_smoke_mascfem.js
const fs = require('fs');
const MODEL = 'D:/projects/brosoundml/weights/kokoro';
bro.tts.setAssetRoot('D:/projects/brosoundml');
kokoro = bro.tts.loadKokoro(MODEL);
basis = JSON.parse(fs.readFileSync(MODEL + '/voice_basis.json', 'utf8'));
mascFemBasis = JSON.parse(fs.readFileSync(MODEL + '/masc_fem_basis.json', 'utf8'));
coords = new Float64Array(basis.k);                 // neutral designed voice (basis mean)
assert(mascFemBasis.full && mascFemBasis.full.M && mascFemBasis.full.F, 'basis has M/F poles');

buildMascFem();
assert($('#mascfem').style.display !== 'none', 'masc/fem panel visible');

// addMascFem applies a signed offset: style += alpha · full[M]
const dM = mascFemBasis.defaultAlpha.M, fM = mascFemBasis.full.M;
const style = new Float32Array(basis.dim); for (let d = 0; d < basis.dim; d++) style[d] = basis.mean[d];
const before = Float32Array.from(style);
setMfAlpha(dM);
addMascFem(style);
let okM = true; for (let d = 0; d < basis.dim; d++) if (Math.abs(style[d] - (before[d] + dM * fM[d])) > 1e-5) okM = false;
assert(okM, 'addMascFem = style + α·full[M]');
assert(mfVal.textContent.indexOf('masc') >= 0, 'masc readout');
setMfAlpha(-mascFemBasis.defaultAlpha.F);
assert(mfVal.textContent.indexOf('fem') >= 0, 'fem readout');

// end-to-end through the app's own rebuildVoice (styleFromCoords + addTimbre + addMascFem)
const ids = bro.tts.phonemize('Hello there. This is a test of the pipeline.');
function f0render() { const r = kokoro.synthesize(ids, voice); let bad = 0, peak = 0; for (let i = 0; i < r.samples.length; i++) { const a = Math.abs(r.samples[i]); if (!isFinite(a)) bad++; if (a > peak) peak = a; } return { bad, peak, samples: r.samples, sr: r.sampleRate }; }

setMfAlpha(0); rebuildVoice(); const neu = f0render();
assert(neu.bad === 0 && neu.peak > 0.01, 'neutral renders audible');
setMfAlpha(dM); rebuildVoice(); const masc = f0render();
assert(masc.bad === 0 && masc.peak > 0.01, 'masculine renders audible');
setMfAlpha(-mascFemBasis.defaultAlpha.F); rebuildVoice(); const fem = f0render();
assert(fem.bad === 0 && fem.peak > 0.01, 'feminine renders audible');

// the three takes must actually differ (offset reached the audio)
let dnm = 0; const n = Math.min(neu.samples.length, masc.samples.length, 8000);
for (let i = 0; i < n; i++) dnm += Math.abs(neu.samples[i] - masc.samples[i]);
assert(dnm > 1, 'masculine take differs from neutral');
console.log('renders · neutral peak', neu.peak.toFixed(3), '· masc', masc.peak.toFixed(3), '· fem', fem.peak.toFixed(3), '· Δ(neu,masc)', dnm.toFixed(1));

resetMascFem();
assert(mfAlpha === 0, 'reset → neutral');

// leave it on masculine for the screenshot
setMfAlpha(dM); rebuildVoice();
flush();
screenshot('_mf_ui.png');
console.log('masc/fem default · masc', dM, '/ fem', mascFemBasis.defaultAlpha.F, '· σ', mascFemBasis.sigmaFull.M);
console.log('SMOKE OK');
