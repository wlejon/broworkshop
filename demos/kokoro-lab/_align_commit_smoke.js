// pred_dur commit smoke — real model. Synthesize a real trace, render the full
// pipeline, edit the timing, and drive the actual debounced commit (commitDurWork
// -> commitDuration -> decodeFrom). Confirms the edit re-decodes to NEW audio and
// the editable cells survive the protected re-render with all heat stages present.
//   bro-headless ../broworkshop/demos/kokoro-lab ../broworkshop/demos/kokoro-lab/_align_commit_smoke.js
const _M = 'D:/projects/brosoundml/weights/kokoro';
bro.tts.setAssetRoot('D:/projects/brosoundml');
kokoro = bro.tts.loadKokoro(_M);
const _ids = bro.tts.phonemize('Hello there, this is a test.');
const _sty = new Float32Array(basis.dim);
for (let d = 0; d < basis.dim; d++) _sty[d] = basis.mean[d];
voice = kokoro.createVoice(_sty, 'commit');
lastTrace = kokoro.synthesizeTraced(_ids, voice);
snapshotPredicted(lastTrace);
renderStages(lastTrace.stages);

const cells = stageCards['pred_dur'].body.querySelectorAll('.acell');
const L = cells.length;
assert(L > 0 && L === durWork.length, 'cells built from the real pred_dur (' + L + ')');
assert(stageCards['pred_dur'].body.querySelector('canvas') === null, 'pred_dur is cells, not a canvas');
const _audio = () => lastTrace.stages.find((s) => s.name === 'audio').data;  // re-decoded waveform
const _before = _audio().length;
cells[0]._tag = 0xC0FFEE;

// double the first phoneme's frames, then run the real (debounced) commit now
durWork[0] = durWork[0] * 2 + 4;
updateAlignCell(cells, 0);
assert(synthBusy === false, 'model idle before commit');
commitDurWork();                                       // synchronous decodeFrom under the hood

assert(_audio().length !== _before, 're-timed: audio length changed (' +
       _before + ' -> ' + _audio().length + ')');
let _bad = 0, _peak = 0;
const _a = _audio();
for (let i = 0; i < _a.length; i++) {
  const v = Math.abs(_a[i]); if (!isFinite(v)) _bad++; if (v > _peak) _peak = v;
}
assert(_bad === 0 && _peak > 0.01, 'commit produced finite, audible audio (peak ' + _peak.toFixed(3) + ')');

const cellsAfter = stageCards['pred_dur'].body.querySelectorAll('.acell');
assert(cellsAfter[0]._tag === 0xC0FFEE, 'edited cells survived the commit re-render');
assert((cellsAfter[0]._input.value | 0) === durWork[0], 'cell shows the committed frame count');
assert(Math.round(lastTrace.durations[0]) === durWork[0], 'trace durations match the edit');
console.log('commit: re-decoded to new audio, cells preserved, durations applied');
console.log('ALIGN_COMMIT_SMOKE OK');
