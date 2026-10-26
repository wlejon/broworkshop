// Headless check of the accent map (lib/accent.js) against a live CustomVoice
// checkpoint, through the app's own modules (sync loads, as test_smoke.js does).
//   · the map builds from qwen.languageEmbedding rows and shows for the variant;
//   · at English with amount 1 the lab sends no override;
//   · snapping to a language yields exactly that language's row, and English text
//     with that row as opts.languageVector is the same take as selecting it;
//   · a point between languages, pushed past 1×, renders finite audio.
// Run: bro-headless ../broworkshop/demos/qwen-tts-lab tests/test_accent.js
import { $ } from "/app/lib/state.js";
import { setQwen, setVariant, adaptToVariant, qwen } from "/app/lib/model.js";
import {
  accentBasis, accentVector, snapAccent, moveAccentTo, setAccentAmount, resetAccent, accentSummary,
} from "/app/lib/accent.js";
import { weightsRoot } from "/lib/kit/weights.js";

const DIR = weightsRoot() + '/brosoundml/weights/qwen-tts/0.6B-customvoice';
const TEXT = 'The farmer parked his car near the old barn after dark.';

setQwen(bro.tts.loadQwen(DIR));
setVariant(qwen.variant);
adaptToVariant();

const b = accentBasis;
assert(!!b, 'accent basis built from languageEmbedding');
console.log('ACCENT', b.names.join(','), '· axes', b.k, '· dim', b.dim);
assert(b.names.indexOf('english') >= 0 && b.names.indexOf('german') >= 0, 'english + german rows');
assert($('#accent').style.display !== 'none', 'accent panel shown');
assert(document.querySelectorAll('#accent-sliders .pc').length === b.k, 'one fine-tune slider per axis');

resetAccent();
assert(accentVector() === null, 'at english, amount 1: no override sent');

snapAccent('german');
const v = accentVector(), row = qwen.languageEmbedding('german');
let mx = 0; for (let d = 0; d < row.length; d++) mx = Math.max(mx, Math.abs(v[d] - row[d]));
console.log('  snap german:', accentSummary(), '· max|row Δ|', mx.toExponential(2));
assert(mx < 1e-4, 'snapped point reconstructs the language row');

// English text + german's row == selecting german (same seed, same sampler draw).
// Pass the exact row: the test is about the seam, the lab's reconstruction is above.
const spk = qwen.speakers()[0];
const base = { speaker: spk, temperature: 0.7, topP: 0.95, seed: 7 };
const de = qwen.synthesize(TEXT, Object.assign({ language: 'german' }, base));
const viaRow = qwen.synthesize(TEXT, Object.assign({ language: 'english', languageVector: row }, base));
const en = qwen.synthesize(TEXT, Object.assign({ language: 'english' }, base));
const same = (a, c) => a.samples.length === c.samples.length && a.samples.every((x, i) => x === c.samples[i]);
console.log('  takes: german', (de.samples.length / de.sampleRate).toFixed(2) + 's · via row',
            (viaRow.samples.length / viaRow.sampleRate).toFixed(2) + 's · english',
            (en.samples.length / en.sampleRate).toFixed(2) + 's');
assert(same(de, viaRow), 'languageVector = german row reproduces selecting german');
assert(!same(de, en), 'german row differs from plain english');

// between russian and japanese, pushed to 1.5x: finite, audible
snapAccent('russian');
const ru = Float64Array.from(accentBasis.points[accentBasis.names.indexOf('russian')]);
const ja = accentBasis.points[accentBasis.names.indexOf('japanese')];
moveAccentTo((ru[0] + ja[0]) / 2, (ru[1] + ja[1]) / 2);
setAccentAmount(1.5);
const mid = qwen.synthesize(TEXT, Object.assign({ language: 'english', languageVector: accentVector() }, base));
let peak = 0, bad = 0;
for (const s of mid.samples) { if (!isFinite(s)) bad++; else peak = Math.max(peak, Math.abs(s)); }
console.log('  between russian/japanese 1.5x:', accentSummary(), '·', (mid.samples.length / mid.sampleRate).toFixed(2) + 's peak', peak.toFixed(3));
assert(bad === 0 && peak > 0.01, 'a blended accent renders finite audio');

flush();
screenshot('accent_panel.png');
console.log('PASS accent map');
