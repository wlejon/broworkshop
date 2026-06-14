// pred_dur async re-decode smoke — real model. Synthesize a real trace, render
// the pipeline, edit the timing, and drive the async pump (requestDuration ->
// pumpDuration -> bro.tts.decodeFrom on a background thread). Ticks virtual time
// until the decode lands, then confirms it re-decoded to NEW audio with the
// editable cells preserved (settle re-render) and the durations applied.
//   bro-headless ../broworkshop/demos/kokoro-lab ../broworkshop/demos/kokoro-lab/_align_commit_smoke.js
//
// Reuse the model the app's own init() loads (async) rather than loading a second
// one — two concurrent loads race brotensor's device default. Wait for it first.
//
// (ESM: the app's former globals are now module exports — read live bindings via
// imports, write the mutable state.js bindings through their putX setters.)
import { kokoro, voice, basis, lastTrace, putLastTrace, stageCards, synthBusy } from "/app/lib/state.js";
import { snapshotPredicted } from "/app/lib/edit.js";
import { renderStages } from "/app/lib/render.js";
import { durWork, durPending, updateAlignCell, requestDuration } from "/app/lib/align.js";
let _w = 0;
while ((!kokoro || !voice || !basis) && _w++ < 4000) advanceTime(16);
assert(kokoro && voice && basis, 'app finished loading its Kokoro model + voice');

const _ids = bro.tts.phonemize('Hello there, this is a test.');
putLastTrace(kokoro.synthesizeTraced(_ids, voice));
snapshotPredicted(lastTrace);                          // sets curDur — the pump needs it
renderStages(lastTrace.stages);

const cells = stageCards['pred_dur'].body.querySelectorAll('.acell');
const L = cells.length;
assert(L > 0 && L === durWork.length, 'cells built from the real pred_dur (' + L + ')');
assert(stageCards['pred_dur'].body.querySelector('canvas') === null, 'pred_dur is cells, not a canvas');
const _audio = () => lastTrace.stages.find((s) => s.name === 'audio').data;
const _before = _audio().length;
cells[0]._tag = 0xC0FFEE;

// double the first phoneme's frames, then request the async re-decode
durWork[0] = durWork[0] * 2 + 4;
updateAlignCell(cells, 0);
const _target = durWork[0];
assert(synthBusy === false, 'model idle before the edit');
requestDuration();                                     // launches bro.tts.decodeFrom on a bg thread
assert(synthBusy === true, 'pump claimed the model (decode in flight, JS thread free)');

// latest-wins: a SECOND edit while the first decode is still running must not
// block or throw — it just queues, and gets decoded after the first lands.
durWork[1] = durWork[1] * 3 + 2;
updateAlignCell(cells, 1);
const _target1 = durWork[1];
requestDuration();
assert(durPending === true, 'an edit during a decode queues (latest-wins), does not block');
assert(synthBusy === true, 'still the first decode in flight — the edit did not start a second');

// tick virtual time until the whole chain (first decode, then the queued one) drains
let _t = 0;
while ((synthBusy || durPending) && _t++ < 2500) advanceTime(16);
assert(!synthBusy && !durPending, 'the async chain drained (both decodes done within budget)');

assert(_audio().length !== _before, 're-timed: audio length changed (' +
       _before + ' -> ' + _audio().length + ')');
let _bad = 0, _peak = 0; const _a = _audio();
for (let i = 0; i < _a.length; i++) {
  const v = Math.abs(_a[i]); if (!isFinite(v)) _bad++; if (v > _peak) _peak = v;
}
assert(_bad === 0 && _peak > 0.01, 'decode produced finite, audible audio (peak ' + _peak.toFixed(3) + ')');

const cellsAfter = stageCards['pred_dur'].body.querySelectorAll('.acell');
assert(cellsAfter[0]._tag === 0xC0FFEE, 'edited cells survived the settle re-render');
assert((cellsAfter[0]._input.value | 0) === _target, 'cell shows the committed frame count');
assert(Math.round(lastTrace.durations[0]) === _target, 'first edit applied to the durations');
assert(Math.round(lastTrace.durations[1]) === _target1, 'queued (latest) edit also applied');
console.log('async commit: re-decoded off-thread, latest-wins chain drained, cells preserved');
console.log('ALIGN_COMMIT_SMOKE OK');
