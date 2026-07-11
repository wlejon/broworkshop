// Spectrum-panel test: load the real checkpoint and drive the model-nominated
// affect axes through the ACTUAL UI — the hostility slider, then valence +
// arousal stacked on top, then stacked with an expression word field, then on
// a Chinese prompt (the axes are baked pooled directions from
// lab/spectrum.json — no words or language at runtime).
//
//   bro-headless ../broworkshop/demos/krea2-lab tests/test_spectrum.js

function $(id) { return document.getElementById(id); }

function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}

assert($('spec-rows').querySelectorAll('.ctl').length === 4,
       'valence + arousal + hostility + surprise rows built');
function specRange(name) {
  const row = $('spec-rows').querySelector('.ctl[data-key="' + name + '"]');
  return row && row.querySelector('input[type=range]');
}
assert(specRange('valence') && specRange('arousal') &&
       specRange('hostility') && specRange('surprise'),
       'all four axes present by name');

console.log('waiting for the model to load…');
assert(pumpUntil(() => !$('btn-generate').disabled ||
                       $('status-text').classList.contains('err'), 600000),
       'model load finished within budget');
assert(!$('status-text').classList.contains('err'),
       'model loaded without error: ' + $('status-text').textContent);

// Neutralize persisted control state — the lab shares its prefs with real
// use, so a manual session's spectrum/axis/dial values would leak into the
// fixed-seed baselines (and live mode would race the test's own generates).
$('live').checked = false;
$('live').dispatchEvent(new Event('change'));
['btn-reset-expr', 'btn-reset-spec', 'btn-reset-axes'].forEach((id) => $(id).click());
[['band', '1.0'], ['dial-pregate', '1.0'], ['dial-prescale', '1.0'],
 ['gate-txt', '1.0'], ['gate-img', '1.0']].forEach(([id, v]) => {
  $(id).value = v; $(id).dispatchEvent(new Event('input'));
});

$('prompt').value = 'a studio portrait of a woman with shoulder-length brown hair looking at the camera, plain gray background, soft light';
$('neg-prompt').value = '';
$('width').value = '512';
$('height').value = '512';
$('steps').value = '8';
$('seed').value = '7';
$('guidance').value = '1.0';
$('rand-seed').checked = false;

function generateAndGrab(budgetMs) {
  $('status-text').textContent = 'test-pending';
  $('btn-generate').click();
  assert(pumpUntil(() => $('status-text').textContent === 'done' ||
                         $('status-text').classList.contains('err'), budgetMs),
         'generation finished within budget');
  assert(!$('status-text').classList.contains('err'),
         'generation ok: ' + $('status-text').textContent);
  const view = $('view');
  return view.getContext('2d').getImageData(0, 0, view.width, view.height);
}
function meanDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    sum += Math.abs(a.data[i] - b.data[i]) +
           Math.abs(a.data[i + 1] - b.data[i + 1]) +
           Math.abs(a.data[i + 2] - b.data[i + 2]);
  }
  return sum / (a.data.length / 4) / 3;
}
function setRange(range, value) {
  range.value = String(value);
  range.dispatchEvent(new Event('input'));
}

console.log('baseline render…');
const base = generateAndGrab(180000);

// ── hostility slider (baked axes — no mint, instant) ─────────────────────
console.log('hostility = 2 render…');
const hostRange = specRange('hostility');
setRange(hostRange, 2);
const hostile = generateAndGrab(180000);
assert($('timing').textContent.indexOf('spectrum') >= 0,
       'timing reports the spectrum: ' + $('timing').textContent);
assert($('timing').textContent.indexOf('hostility') >= 0,
       'timing names the axis: ' + $('timing').textContent);
const dHost = meanDiff(base, hostile);
console.log('mean |hostility-base| per channel: ' + dHost.toFixed(2));
assert(dHost > 5, 'hostility changed the render (mean diff ' + dHost.toFixed(2) + ' > 5)');

// ── valence + arousal sliders, stacked on hostility ───────────────────────
const valRange = specRange('valence');
const aroRange = specRange('arousal');
setRange(valRange, 2);
setRange(aroRange, 2);
console.log('valence+arousal (stacked on hostility) render…');
const elated = generateAndGrab(180000);
assert($('timing').textContent.indexOf('valence') >= 0 &&
       $('timing').textContent.indexOf('hostility') >= 0,
       'timing shows the stacked axes: ' + $('timing').textContent);
const dStack = meanDiff(hostile, elated);
console.log('mean |valence+arousal-hostility| per channel: ' + dStack.toFixed(2));
assert(dStack > 5, 'stacked axes changed the render (mean diff ' + dStack.toFixed(2) + ' > 5)');

// ── stacking with an expression word field (same token grid) ─────────────
console.log('adding expression anger = 1.5 on top…');
const chips = $('expr-words').querySelectorAll('.word-chip');
for (let i = 0; i < chips.length; i++) {
  if (chips[i].textContent === 'anger' && !chips[i].classList.contains('sel')) chips[i].click();
}
setRange($('expr-strength-row').querySelector('input[type=range]'), 1.5);
const combined = generateAndGrab(180000);
assert($('timing').textContent.indexOf('field vs') >= 0,
       'word field rode the spectrum carrier: ' + $('timing').textContent);
assert($('timing').textContent.indexOf('spectrum') >= 0,
       'spectrum still active: ' + $('timing').textContent);
const dComb = meanDiff(elated, combined);
console.log('mean |combined-stack| per channel: ' + dComb.toFixed(2));
assert(dComb > 5, 'word field stacked onto the spectrum (mean diff ' + dComb.toFixed(2) + ' > 5)');

// ── language-agnostic: the same baked axes on a Chinese prompt ────────────
console.log('zh prompt, valence +2…');
$('btn-reset-expr').click();
$('btn-reset-spec').click();
$('prompt').value = '一位棕色齐肩发女子的摄影棚人像，纯灰色背景，柔和的光线';
const zhBase = generateAndGrab(180000);
setRange(valRange, 2);                             // valence +2, arousal 0
const zhVal = generateAndGrab(180000);
assert($('timing').textContent.indexOf('valence') >= 0,
       'zh render used the spectrum: ' + $('timing').textContent);
const dZh = meanDiff(zhBase, zhVal);
console.log('mean |zh valence - zh base| per channel: ' + dZh.toFixed(2));
assert(dZh > 5, 'spectrum drove a non-English prompt (mean diff ' + dZh.toFixed(2) + ' > 5)');

// reset leaves a clean state for whoever runs the app next
$('btn-reset-spec').click();
assert(+valRange.value === 0 && +hostRange.value === 0,
       'reset zeroed the spectrum');

console.log('PASS: baked spectrum stacks and drives the render end to end, any language');
