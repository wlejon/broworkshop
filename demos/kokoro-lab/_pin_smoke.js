// Verify retained prosody ("pinned" edits) rides from one voice onto another:
// edit F0 + a phoneme's duration on voice A, switch to voice B, and confirm
// reapplyPinnedEdit() reproduces the same intent (timing ratio + contour delta)
// on B's own prediction. Runs in the app's global scope (headless auto-loads
// app.js first), so the app globals + functions are in scope.
//   bro-headless ../broworkshop/demos/kokoro-lab _pin_smoke.js
const _M = 'D:/projects/brosoundml/weights/kokoro';
bro.tts.setAssetRoot('D:/projects/brosoundml');
kokoro = bro.tts.loadKokoro(_M);                         // app global
const _ids = bro.tts.phonemize('Hello there, this is a test.');

// ── voice A: the neutral centroid ──────────────────────────────────────────
const styleA = new Float32Array(basis.dim);
for (let d = 0; d < basis.dim; d++) styleA[d] = basis.mean[d];
voice = kokoro.createVoice(styleA, 'A');
lastTrace = kokoro.synthesizeTraced(_ids, voice);
snapshotPredicted(lastTrace);

// reshape pitch up, and double one phoneme's duration — two real edits
const F0 = lastTrace.stages.find((s) => s.name === 'F0_pred');
for (let i = 0; i < F0.data.length; i++) F0.data[i] = F0.data[i] * 1.2 + 8;
commitEdit();
assert(pinnedEdit, 'F0 edit captured a pin');

const nd = curDur.slice();
let li = -1; for (let i = 0; i < nd.length; i++) if (nd[i] >= 4) { li = i; break; }
assert(li >= 0, 'found a phoneme to lengthen');
const baseFrames = predicted.dur[li];
nd[li] = baseFrames * 2;
commitDuration(nd);
assert(pinnedEdit, 'duration edit kept the pin');
assert(Math.abs(pinnedEdit.durRatio[li] - 2) < 1e-6, 'pin ratio reflects the 2x stretch');
assert(pinnedEdit.dF0.some((v) => Math.abs(v) > 1e-3), 'pin carries a nonzero F0 delta');
console.log('pinned on A · ratio[' + li + ']=' + pinnedEdit.durRatio[li].toFixed(2) +
  ' · |dF0| frames=' + pinnedEdit.dF0.length);

// ── voice B: a different point in style space ───────────────────────────────
const styleB = Float32Array.from(styleA);
for (let i = 0; i < basis.k; i++) {            // push a few axes by ~1.5σ
  const v = basis.comps[i], c = 1.5 * basis.std[i];
  for (let d = 0; d < basis.dim; d++) styleB[d] += c * v[d];
  if (i >= 3) break;
}
voice = kokoro.createVoice(styleB, 'B');
lastTrace = kokoro.synthesizeTraced(_ids, voice);
snapshotPredicted(lastTrace);
const predDurB = Array.from(lastTrace.stages.find((s) => s.name === 'pred_dur').data, (v) => Math.round(v));
assert(predDurB.length === pinnedEdit.durRatio.length, 'B has the same phoneme count');
const predTotalB = predDurB.reduce((a, b) => a + b, 0);

// ride the retained prosody onto B
const ok = reapplyPinnedEdit();
assert(ok === true, 'reapply succeeded on B');
assert($('#run-meta').textContent.indexOf('prosody retained') >= 0, 'run-meta shows the retain label');

// the grabbed phoneme should be ~2x B's *own* predicted frames, not A's
assert(lastTrace.durations[li] === predDurB[li] * 2, 'B phoneme stretched 2x its own prediction');
const newTotalB = curDur.reduce((a, b) => a + b, 0);
assert(newTotalB !== predTotalB, 'B total frames changed from the retimed phoneme');

const audio = lastTrace.stages.find((s) => s.name === 'audio');
assert(audio && audio.data.length > 0 && clipSamples > 0, 'B re-decoded edited audio');
console.log('rode onto B · dur[' + li + '] ' + predDurB[li] + '->' + lastTrace.durations[li] +
  ' · total ' + predTotalB + '->' + newTotalB + ' · clip ' + clipSamples + ' samples');

// clearing drops the pin
clearProsody();
assert(pinnedEdit === null, 'clearProsody dropped the pin');
console.log('PIN_SMOKE OK');
