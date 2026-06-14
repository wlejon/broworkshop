// Exercise the Tier 0 VAD emotion path deterministically (no UI drag): reuse
// app.js's own globals + functions, set a valence/arousal/dominance point, run
// the real applyEmotion() / resetEmotion(), and check the prosody moved the way
// the transforms say it should. Runs in the app's global scope (headless
// auto-loads app.js first), so kokoro/voice/EMO/applyEmotion are all in scope.
//   bro-headless ../broworkshop/demos/kokoro-lab _emotion_smoke.js
//
// (ESM: the app's former globals are now module exports — read live bindings via
// imports, write the mutable state.js bindings through their putX setters.)
import { kokoro, putKokoro, basis, voice, putVoice, lastTrace, putLastTrace,
         predicted, edited, clipId, clipSamples, curDur, pinnedEdit } from "/app/lib/state.js";
import { snapshotPredicted } from "/app/lib/edit.js";
import { EMO, applyEmotion, resetEmotion } from "/app/lib/emotion.js";
// Weights root: defaults to the Windows D: layout; override with BRO_WEIGHTS.
const WROOT = (typeof process !== 'undefined' && process.env.BRO_WEIGHTS) || 'D:/projects';
const _M = WROOT + '/brosoundml/weights/kokoro';
bro.tts.setAssetRoot(WROOT + '/brosoundml');
// Let the app's own async Kokoro load settle before we load ours (device race).
let _wait = 0; while (!kokoro && _wait++ < 6000) advanceTime(16);
putKokoro(bro.tts.loadKokoro(_M));                          // app global
const _ids = bro.tts.phonemize('Hello there, this is a test of emotion.');
const _sty = new Float32Array(basis.dim);
for (let d = 0; d < basis.dim; d++) _sty[d] = basis.mean[d];
putVoice(kokoro.createVoice(_sty, 'emo'));                  // app global
putLastTrace(kokoro.synthesizeTraced(_ids, voice));         // app global
snapshotPredicted(lastTrace);

// mean of the VOICED part of an F0 contour (Hz), and the total frame count.
const voicedMean = (a) => { let s = 0, n = 0; for (let i = 0; i < a.length; i++) if (a[i] > 1e-3) { s += a[i]; n++; } return n ? s / n : 0; };
const energyMean = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; };

const f0_0 = voicedMean(predicted.F0);
const n_0  = energyMean(predicted.N);
const total0 = predicted.dur.reduce((a, b) => a + b, 0);
assert(f0_0 > 0 && total0 > 0, 'have a baseline prediction');
console.log('baseline · F0', f0_0.toFixed(1), 'Hz · energy', n_0.toFixed(4), '· frames', total0);

// ── excited (high arousal): pitch up, louder, faster ────────────────────────
EMO.v = 0.2; EMO.a = 0.8; EMO.d = 0.0;
applyEmotion();
assert(edited === true, 'emotion committed (edited flag set)');
assert(clipId >= 0 && clipSamples > 0, 'emotion produced an audio clip');
const audio = lastTrace.stages.find((s) => s.name === 'audio');
assert(audio && audio.data.length > 0, 'audio stage refreshed from the re-decode');

const F0e = lastTrace.stages.find((s) => s.name === 'F0_pred');
const Ne  = lastTrace.stages.find((s) => s.name === 'N_pred');
const f0_e = voicedMean(F0e.data);
const n_e  = energyMean(Ne.data);
const total_e = curDur.reduce((a, b) => a + b, 0);
console.log('excited  · F0', f0_e.toFixed(1), 'Hz · energy', n_e.toFixed(4), '· frames', total_e);
assert(f0_e > f0_0 * 1.02, 'arousal raised the pitch');
assert(n_e  > n_0  * 1.02, 'arousal raised the energy');
assert(total_e < total0,   'arousal shortened the timing (faster)');
assert(pinnedEdit, 'emotion is pinned (rides onto other voices)');

// ── calm (low arousal): pitch down, quieter, slower ─────────────────────────
EMO.v = 0.0; EMO.a = -0.7; EMO.d = 0.1;
applyEmotion();
const f0_c = voicedMean(lastTrace.stages.find((s) => s.name === 'F0_pred').data);
const total_c = curDur.reduce((a, b) => a + b, 0);
console.log('calm     · F0', f0_c.toFixed(1), 'Hz · frames', total_c);
assert(f0_c < f0_0 * 0.99, 'low arousal lowered the pitch vs prediction');
assert(total_c > total0,   'low arousal lengthened the timing (slower)');
// non-compounding: re-deriving from a different point did not stack on the last
assert(f0_c < f0_e, 'calm pitch is below excited (recomputed from prediction, no compounding)');

// ── neutral: drop the emotion, back to the model's own prosody ──────────────
resetEmotion();
assert(!pinnedEdit, 'neutral cleared the pinned emotion');
assert(EMO.v === 0 && EMO.a === 0 && EMO.d === 0, 'neutral zeroed the axes');
console.log('EMOTION_SMOKE OK');
