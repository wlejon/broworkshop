// Mouth-panel test: load the real checkpoint and drive the model-nominated
// mouth articulation axes through the ACTUAL UI — the open slider, then round
// stacked on top, then stacked with a spectrum axis (both baked banks share
// one carrier), then on an animal subject (the axes are baked pooled
// directions from lab/mouth.json, minted on humans and animals alike).
//
//   bro-headless ../broworkshop/demos/krea2-lab tests/test_mouth.js

function $(id) { return document.getElementById(id); }

function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}

assert($('mouth-rows').querySelectorAll('.ctl').length === 3,
       'open + round + teeth rows built');
function mouthRange(key) {
  const row = $('mouth-rows').querySelector('.ctl[data-key="' + key + '"]');
  return row && row.querySelector('input[type=range]');
}
const openRange = mouthRange('open');
const roundRange = mouthRange('round');
const teethRange = mouthRange('teeth');
assert(openRange && roundRange && teethRange, 'all three axes present by key');

console.log('waiting for the model to load…');
assert(pumpUntil(() => !$('btn-generate').disabled ||
                       $('status-text').classList.contains('err'), 600000),
       'model load finished within budget');
assert(!$('status-text').classList.contains('err'),
       'model loaded without error: ' + $('status-text').textContent);

// Neutralize persisted control state — the lab shares its prefs with real
// use, so a manual session's spectrum/mouth/axis/dial values would leak into
// the fixed-seed baselines (and live mode would race the test's own
// generates).
$('live').checked = false;
$('live').dispatchEvent(new Event('change'));
['btn-reset-expr', 'btn-reset-spec', 'btn-reset-mouth', 'btn-reset-axes']
  .forEach((id) => $(id).click());
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

// ── open slider (baked axes — no mint, instant) ───────────────────────────
console.log('open = 2 render…');
setRange(openRange, 2);
const opened = generateAndGrab(180000);
assert($('timing').textContent.indexOf('mouth') >= 0,
       'timing reports the mouth bank: ' + $('timing').textContent);
assert($('timing').textContent.indexOf('open') >= 0,
       'timing names the axis: ' + $('timing').textContent);
const dOpen = meanDiff(base, opened);
console.log('mean |open-base| per channel: ' + dOpen.toFixed(2));
assert(dOpen > 5, 'open changed the render (mean diff ' + dOpen.toFixed(2) + ' > 5)');

// ── round stacked on open (both articulation axes on one carrier) ─────────
console.log('round = -2 (spread) stacked on open render…');
setRange(roundRange, -2);
const spread = generateAndGrab(180000);
assert($('timing').textContent.indexOf('round') >= 0 &&
       $('timing').textContent.indexOf('open') >= 0,
       'timing shows the stacked axes: ' + $('timing').textContent);
const dRound = meanDiff(opened, spread);
console.log('mean |round-open| per channel: ' + dRound.toFixed(2));
assert(dRound > 5, 'round stacked onto open (mean diff ' + dRound.toFixed(2) + ' > 5)');

// ── stacking with the affect spectrum (two banks, one carrier) ────────────
console.log('valence = 2 stacked on the mouth axes…');
const valRange = $('spec-rows').querySelector('.ctl[data-key="valence"] input[type=range]');
setRange(valRange, 2);
const combined = generateAndGrab(180000);
assert($('timing').textContent.indexOf('spectrum') >= 0 &&
       $('timing').textContent.indexOf('mouth') >= 0,
       'both banks in the timing note: ' + $('timing').textContent);
const dComb = meanDiff(spread, combined);
console.log('mean |combined-mouth| per channel: ' + dComb.toFixed(2));
assert(dComb > 5, 'spectrum stacked onto the mouth bank (mean diff ' + dComb.toFixed(2) + ' > 5)');

// ── species transfer: the same baked axes on a dog prompt ─────────────────
console.log('dog prompt, open +2…');
setRange(valRange, 0);
$('btn-reset-mouth').click();
$('prompt').value = 'a close-up photo of a golden retriever dog sitting in a park, looking at the camera, soft light';
const dogBase = generateAndGrab(180000);
setRange(openRange, 2);
const dogOpen = generateAndGrab(180000);
assert($('timing').textContent.indexOf('open') >= 0,
       'dog render used the mouth bank: ' + $('timing').textContent);
const dDog = meanDiff(dogBase, dogOpen);
console.log('mean |dog open - dog base| per channel: ' + dDog.toFixed(2));
assert(dDog > 5, 'open drove an animal subject (mean diff ' + dDog.toFixed(2) + ' > 5)');

// reset leaves a clean state for whoever runs the app next
$('btn-reset-mouth').click();
assert(+openRange.value === 0 && +roundRange.value === 0 && +teethRange.value === 0,
       'reset zeroed the mouth axes');

console.log('PASS: baked mouth axes stack and drive the render end to end, humans and animals');
