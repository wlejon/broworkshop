// Spectrum-panel test: load the real checkpoint and drive the model-nominated
// affect axes through the ACTUAL UI — the hostility slider, then the
// valence×arousal pad via real hit-tested mouse input, then stacked with an
// expression word field. The first spectrum render mints the axes in the
// worker (~100 encodes + SVD); later renders reuse the per-prompt cache.
//
//   bro-headless ../broworkshop/demos/krea2-lab tests/test_spectrum.js

function $(id) { return document.getElementById(id); }

function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}

assert($('spec-pad'), 'spectrum pad exists');
assert($('spec-dot'), 'spectrum dot exists');
assert($('spec-rows').querySelectorAll('.ctl-row').length === 2,
       'hostility + surprise rows built');

console.log('waiting for the model to load…');
assert(pumpUntil(() => !$('btn-generate').disabled ||
                       $('status-text').classList.contains('err'), 600000),
       'model load finished within budget');
assert(!$('status-text').classList.contains('err'),
       'model loaded without error: ' + $('status-text').textContent);

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

// ── hostility slider: first spectrum render, includes the in-worker mint ──
console.log('hostility = 2 render (mints the spectrum — ~100 encodes + SVD)…');
const hostRange = $('spec-rows').querySelectorAll('.ctl-row')[0].querySelector('input[type=range]');
setRange(hostRange, 2);
const hostile = generateAndGrab(300000);
assert($('timing').textContent.indexOf('spectrum') >= 0,
       'timing reports the spectrum: ' + $('timing').textContent);
assert($('timing').textContent.indexOf('hostility') >= 0,
       'timing names the axis: ' + $('timing').textContent);
const dHost = meanDiff(base, hostile);
console.log('mean |hostility-base| per channel: ' + dHost.toFixed(2));
assert(dHost > 5, 'hostility changed the render (mean diff ' + dHost.toFixed(2) + ' > 5)');

// ── the pad, via real hit-tested input: valence +2, arousal +2 ────────────
// Scroll the rail so the pad is on screen, then press at the pad point that
// maps to (nx, ny) for the target values. Cache hit — no second mint.
const pad = $('spec-pad');
let r = pad.getBoundingClientRect();
if (r.top < 0 || r.bottom > window.innerHeight) {
  $('rail').scrollTop += r.top - 120;
  flush();
  r = pad.getBoundingClientRect();
}
assert(r.top >= 0 && r.bottom <= window.innerHeight, 'pad scrolled into view');
const px = r.left + ((2 / 3 + 1) / 2) * r.width;    // valence +2 -> nx 5/6
const py = r.top + ((1 - 2 / 3) / 2) * r.height;    // arousal +2 -> ny 1/6
mouseDown(px, py);
mouseUp(px, py);
const vVal = +$('spec-valence-val').textContent;
const aVal = +$('spec-arousal-val').textContent;
console.log('pad set valence ' + vVal + ', arousal ' + aVal);
assert(Math.abs(vVal - 2) < 0.2 && Math.abs(aVal - 2) < 0.2,
       'pad drag landed near (+2, +2), got (' + vVal + ', ' + aVal + ')');

console.log('valence+arousal (stacked on hostility) render…');
const elated = generateAndGrab(180000);
assert($('timing').textContent.indexOf('valence') >= 0 &&
       $('timing').textContent.indexOf('hostility') >= 0,
       'timing shows the stacked axes: ' + $('timing').textContent);
const dPad = meanDiff(hostile, elated);
console.log('mean |pad-hostility| per channel: ' + dPad.toFixed(2));
assert(dPad > 5, 'pad axes changed the render (mean diff ' + dPad.toFixed(2) + ' > 5)');

// ── stacking with an expression word field (same token grid) ─────────────
console.log('adding expression anger = 1.5 on top…');
const angerRange = $('expr-rows').querySelectorAll('.ctl-row')[4].querySelector('input[type=range]');
setRange(angerRange, 1.5);
const combined = generateAndGrab(180000);
assert($('timing').textContent.indexOf('field vs') >= 0,
       'word field rode the spectrum carrier: ' + $('timing').textContent);
assert($('timing').textContent.indexOf('spectrum') >= 0,
       'spectrum still active: ' + $('timing').textContent);
const dComb = meanDiff(elated, combined);
console.log('mean |combined-pad| per channel: ' + dComb.toFixed(2));
assert(dComb > 5, 'word field stacked onto the spectrum (mean diff ' + dComb.toFixed(2) + ' > 5)');

// reset leaves a clean state for whoever runs the app next
setRange(angerRange, 0);
$('btn-reset-spec').click();
assert(+$('spec-valence-val').textContent === 0 && +hostRange.value === 0,
       'reset zeroed the spectrum');

console.log('PASS: spectrum panel mints, stacks, and drives the render end to end');
