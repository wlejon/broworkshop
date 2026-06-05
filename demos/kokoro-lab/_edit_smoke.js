// Exercise the app's prosody-edit path deterministically (no async synth):
// reuse app.js's own globals + functions, reshape the F0 contour, and run the
// real commitEdit() / resetSignal(). Runs in the app's global scope (headless
// auto-loads app.js first), so kokoro/voice/lastTrace/commitEdit are in scope.
//   bro-headless ../broworkshop/demos/kokoro-lab _edit_smoke.js
const _M = 'D:/projects/brosoundml/weights/kokoro';
bro.tts.setAssetRoot('D:/projects/brosoundml');
kokoro = bro.tts.loadKokoro(_M);                         // app global
const _ids = bro.tts.phonemize('Hello there, this is a test.');
const _sty = new Float32Array(basis.dim);
for (let d = 0; d < basis.dim; d++) _sty[d] = basis.mean[d];
voice = kokoro.createVoice(_sty, 'edit');                // app global
lastTrace = kokoro.synthesizeTraced(_ids, voice);        // app global
snapshotPredicted(lastTrace);

const F0 = lastTrace.stages.find((s) => s.name === 'F0_pred');
const base = Float32Array.from(F0.data);
assert(F0 && base.length > 0, 'have an F0 contour');

// reshape: push pitch up — exactly what a drag does, mutating the stage in place
for (let i = 0; i < F0.data.length; i++) F0.data[i] = F0.data[i] * 1.25 + 5;
commitEdit();
assert(edited === true, 'edit committed (edited flag set)');
assert(clipId >= 0 && clipSamples > 0, 'edit produced an audio clip');
console.log('edit: clip', clipSamples, 'samples · run-meta:', $('#run-meta').textContent);

// the back-half stages should have been re-decoded (audio stage refreshed; its
// length is the 24 kHz model output, before setClip resamples to the ctx rate)
const audio = lastTrace.stages.find((s) => s.name === 'audio');
assert(audio && audio.data.length > 0, 'audio stage refreshed from the re-decode');

// reset restores the predicted contour exactly
resetSignal('F0_pred');
let restored = 0;
for (let i = 0; i < F0.data.length; i++) if (Math.abs(F0.data[i] - base[i]) < 1e-6) restored++;
assert(restored === F0.data.length, 'reset restored F0 to the prediction');
console.log('reset ok ·', restored, '/', F0.data.length, 'frames restored');
console.log('EDIT_SMOKE OK');
