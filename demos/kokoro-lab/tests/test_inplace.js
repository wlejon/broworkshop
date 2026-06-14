// Stages refresh IN PLACE on re-decode: the canvas the user is editing is left
// untouched (its element survives), while downstream canvases regenerate. Tag
// canvas elements and prove which survive a re-render.
//
// (ESM: the app's former globals are now module exports — read live bindings via
// imports, write the mutable state.js bindings through their putX setters.)
import { kokoro, putKokoro, basis, voice, putVoice, lastTrace, putLastTrace,
         stageCards, activePaint, putActivePaint, protectedStage, putProtectedStage, $ } from "/app/lib/state.js";
import { snapshotPredicted } from "/app/lib/edit.js";
import { renderStages } from "/app/lib/render.js";
// Weights root: defaults to the Windows D: layout; override with BRO_WEIGHTS.
const WROOT = (typeof process !== 'undefined' && process.env.BRO_WEIGHTS) || 'D:/projects';
const _M = WROOT + '/brosoundml/weights/kokoro';
bro.tts.setAssetRoot(WROOT + '/brosoundml');
// Let the app's own async Kokoro load settle before we load ours (device race).
let _wait = 0; while (!kokoro && _wait++ < 6000) advanceTime(16);
putKokoro(bro.tts.loadKokoro(_M));
const _ids = bro.tts.phonemize('Hello there, this is a test.');
const _sty = new Float32Array(basis.dim);
for (let d = 0; d < basis.dim; d++) _sty[d] = basis.mean[d];
putVoice(kokoro.createVoice(_sty, 'ip'));
putLastTrace(kokoro.synthesizeTraced(_ids, voice));
snapshotPredicted(lastTrace);
renderStages(lastTrace.stages);                 // first render = buildStages

const stagesEl = $('#stages');
const card0 = stagesEl.children[0];
card0._sentinel = 0xCA5E;                        // a card element should persist across in-place updates
const f0cv = () => stageCards['F0_pred'].body.querySelector('canvas');
const audcv = () => stageCards['audio'].body.querySelector('canvas');
f0cv()._tag = 0xF0;
audcv()._tag = 0xAA;

// 1) a plain re-render updates in place — cards persist, bodies regenerate
renderStages(lastTrace.stages);
assert(stagesEl.children[0] === card0 && card0._sentinel === 0xCA5E, 'cards persist (no teardown)');
assert(audcv()._tag === undefined, 'downstream canvas regenerated on a normal render');
console.log('in-place: card persisted, downstream canvas regenerated');

// 2) while editing F0, a re-render must NOT touch the F0 canvas
f0cv()._tag = 0xF0;                              // re-tag (it regenerated above)
putActivePaint({ s: lastTrace.stages.find((s) => s.name === 'F0_pred') });
renderStages(lastTrace.stages);
assert(f0cv()._tag === 0xF0, 'edited F0 canvas preserved during a mid-edit render');
assert(audcv()._tag === undefined || audcv()._tag !== 0xF0, 'other stages still regenerated');
putActivePaint(null);
console.log('mid-edit: edited canvas preserved, others regenerated');

// 3) the commit path protects the just-edited stage too (protectedStage)
f0cv()._tag = 0xF0;
putProtectedStage('F0_pred');
renderStages(lastTrace.stages);
assert(f0cv()._tag === 0xF0, 'edited F0 canvas preserved through the commit render');
putProtectedStage(null);
console.log('commit: edited canvas preserved');
console.log('INPLACE_SMOKE OK');
