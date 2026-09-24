// RAVE Lab: boot autoloads a converted RAVE model; a tone encodes into one
// curve per latent dim and decodes; a curve op and a real mouse drag on a
// curve change the morph; reset restores the encode; the noise / stereo
// toggles decode through the UI (seeded, so reproducible; width 0 collapses
// stereo). Skips when no RAVE model is on this machine.
//
//   scripts/validate.sh --ml demos/rave-lab

import { check, test, done, waitFor, q, text, clickOn, setValue, shot, needWeights } from "/lib/kit/test.js";
import { saveWav } from "/lib/kit/audio.js";
import { lab, RAVE } from "/app/lab.js";

needWeights('RAVE model', RAVE, { probe: 'config.json' });

const sum = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d; };
const lr = (s) => { let d = 0; for (let i = 0; i < s.length; i += 2) d += Math.abs(s[i] - s[i + 1]); return d; };
function waitDecode(n, msg) { waitFor(() => lab.decodes > n || lab.error, msg, 30000); check(!lab.error, lab.error); }

// 1. model
waitFor(() => lab.rave || lab.error, 'model load', 120000);
check(!lab.error, 'model loaded: ' + lab.error);
const r = lab.rave;
test('model meta shown', () => check(/latents/.test(lab.ui.row.metaEl.textContent)));
test('preset list lists the loaded model', () => check(q('#preset').options.length >= 1 && !q('#preset').disabled));
test('source buttons enabled', () => check(!q('#btn-tone').disabled && !q('#btn-loadfile').disabled));

// 2. tone → encode → decode, through the toolbar
q('#autoplay').checked = false;
setValue('#tone-secs', '1.0');
let n = lab.decodes;
clickOn('#btn-tone');
waitDecode(n, 'tone decode');
const enc = lab.enc;
test('encode grid', () => check(enc.nLatent === r.nLatent && enc.frames > 0 && lab.work.length === enc.nLatent * enc.frames));
test('one curve cell per latent dim', () => check(document.querySelectorAll('#curves .curve-cell').length === enc.nLatent));
test('decode length = frames × ratio', () => check(lab.out.samples.length === enc.frames * r.totalRatio));
test('curves header shown, hint hidden', () => check(!q('#curves-head').hidden && q('#hint').hidden));
test('morph controls enabled', () => check(!q('#btn-play-out').disabled && !q('#btn-save').disabled && !q('#btn-reset').disabled));
test('src meta', () => check(/Hz/.test(text('#src-meta'))));
shot('encoded');

// 3. a per-row op (nudge dim 0 up) re-decodes to a different morph
let before = Float32Array.from(lab.out.samples);
n = lab.decodes;
clickOn('.curve-cell[data-dim="0"] .curve-tools button:nth-child(5)');
waitDecode(n, 'nudge decode');
test('nudge edited dim 0', () => check(sum(lab.work.subarray(0, enc.frames), enc.latent.subarray(0, enc.frames)) > 0));
test('nudge changed the morph', () => check(sum(lab.out.samples, before) > 0));

// 4. a real drag across dim 1 through the input pipeline
const cv = q('.curve-cell[data-dim="1"] canvas').getBoundingClientRect();
const row1 = () => lab.work.subarray(enc.frames, 2 * enc.frames);
const row1Before = Float32Array.from(row1());
n = lab.decodes;
mouseMove(cv.left + cv.width * 0.1, cv.top + cv.height * 0.2);
mouseDown(cv.left + cv.width * 0.1, cv.top + cv.height * 0.2, 0);
for (let k = 1; k <= 8; k++) mouseMove(cv.left + cv.width * (0.1 + 0.1 * k), cv.top + cv.height * (0.2 + 0.07 * k));
mouseUp(cv.left + cv.width * 0.9, cv.top + cv.height * 0.76, 0);
flush();
waitDecode(n, 'drag decode');
test('drag repainted dim 1', () => check(sum(row1(), row1Before) > 0));
test('drag stats show a delta', () => check(/Δ/.test(q('.curve-cell[data-dim="1"] .curve-stats').textContent)));
shot('edited');

// 5. reset all restores the encode exactly
n = lab.decodes;
clickOn('#btn-reset');
waitDecode(n, 'reset decode');
test('reset restored the latent', () => check(sum(lab.work, enc.latent) === 0));
const det = Float32Array.from(lab.out.samples);

// 6. noise: changes the morph; the fixed seed reproduces it
n = lab.decodes;
setValue('#noise', true);
waitDecode(n, 'noise decode');
const noisy = Float32Array.from(lab.out.samples);
test('noise changes the morph', () => check(sum(noisy, det) > 0));
n = lab.decodes;
clickOn('#btn-decode');
waitDecode(n, 're-decode');
test('same seed reproduces the noisy morph', () => check(sum(lab.out.samples, noisy) === 0));
setValue('#noise', false);

// 7. stereo: 2 interleaved decorrelated channels; width 0 collapses
n = lab.decodes;
setValue('#stereo', true);
waitDecode(n, 'stereo decode');
test('stereo decode is 2 channels', () => check(lab.out.channels === 2 && lab.out.samples.length === det.length * 2));
test('stereo channels decorrelated', () => check(lr(lab.out.samples) > 0));
test('run meta says stereo', () => check(/stereo/.test(text('#run-meta'))));
n = lab.decodes;
setValue('#width', '0');
waitDecode(n, 'width 0 decode');
test('width 0 collapses to identical channels', () => check(lr(lab.out.samples) === 0));
setValue('#stereo', false);

// 8. playback + save through the UI (save to a path: the dialog would block)
clickOn('#btn-play-out');
test('morph plays', () => check(!lab.error));
const out = 'tests/out/rave-lab-morph.wav';
const saved = saveWav(lab.out.samples, r.sampleRate, { path: out });
test('morph saves as wav', () => check(saved && require('fs').existsSync(saved)));

done('rave-lab');
