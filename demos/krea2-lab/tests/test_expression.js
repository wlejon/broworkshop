// Expression-panel test: load the real checkpoint, render the same portrait
// with the anger slider at 0 and at 2 through the ACTUAL UI, and assert the
// two frames differ substantially (the per-token field engaged) while the
// worker reported the mask-aligned neutral it diffed against.
//
//   bro-headless ../broworkshop/demos/krea2-lab tests/test_expression.js

function $(id) { return document.getElementById(id); }

function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}

assert($('expr-words'), 'expression panel exists');
const chips = $('expr-words').querySelectorAll('.word-chip');
assert(chips.length === 10, 'ten expression word chips built (got ' + chips.length + ')');
assert($('expr-strength-row').querySelectorAll('.ctl').length === 1, 'strength row built');
function exprChip(label) {
  for (let i = 0; i < chips.length; i++) {
    if (chips[i].textContent === label) return chips[i];
  }
  return null;
}
function exprStrengthRange() {
  return $('expr-strength-row').querySelector('input[type=range]');
}

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

// Deterministic setup through the form.
$('prompt').value = 'a studio portrait of a woman with shoulder-length brown hair looking at the camera, plain gray background, soft light';
$('neg-prompt').value = '';
$('width').value = '512';
$('height').value = '512';
$('steps').value = '8';
$('seed').value = '7';
$('guidance').value = '1.0';
$('rand-seed').checked = false;

function generateAndGrab() {
  $('status-text').textContent = 'test-pending';
  $('btn-generate').click();
  assert(pumpUntil(() => $('status-text').textContent === 'done' ||
                         $('status-text').classList.contains('err'), 180000),
         'generation finished within budget');
  assert(!$('status-text').classList.contains('err'),
         'generation ok: ' + $('status-text').textContent);
  const view = $('view');
  return view.getContext('2d').getImageData(0, 0, view.width, view.height);
}

// Drive the expression exactly as a user would: click the word chip (the
// picker is a radio — the field is exclusive by construction), then set the
// single strength slider through DOM events so the app's own handlers
// (selection, persist, message build) run.
function setExpression(label, value) {
  const chip = exprChip(label);
  if (!chip.classList.contains('sel')) chip.click();
  const range = exprStrengthRange();
  range.value = String(value);
  range.dispatchEvent(new Event('input'));
  // no 'change' dispatch — the test clicks Generate itself (live-mode races
  // would double-render)
}

console.log('baseline render (no expression)…');
const base = generateAndGrab();

console.log('anger = 2 render…');
setExpression('anger', 2);
const angry = generateAndGrab();
assert($('timing').textContent.indexOf('field vs') >= 0,
       'worker reported the field neutral: ' + $('timing').textContent);

// Switching to a SECOND emotion builds a second field on top of the first
// one's cache — this is the sequence that OOM'd the worker's 256 MB QuickJS
// heap (each raw-taps buffer is a 63 MB Float32Array; the engine limit is
// now 4 GB). Exclusivity rides along: picking happiness must drop anger.
console.log('happiness = 2 render (second field)…');
setExpression('happiness', 2);
assert(!exprChip('anger').classList.contains('sel'),
       'picking happiness deselected anger (exclusive picker)');
assert(exprChip('happiness').classList.contains('sel'), 'happiness selected');
const happy = generateAndGrab();
assert($('timing').textContent.indexOf('field vs') >= 0,
       'second field reported its neutral: ' + $('timing').textContent);
$('btn-reset-expr').click();                 // back to none

// The two frames must differ substantially — the field engaged.
assert(base.width === angry.width && base.height === angry.height, 'same dims');
let sum = 0;
const n = base.data.length;
for (let i = 0; i < n; i += 4) {
  sum += Math.abs(base.data[i] - angry.data[i]) +
         Math.abs(base.data[i + 1] - angry.data[i + 1]) +
         Math.abs(base.data[i + 2] - angry.data[i + 2]);
}
const meanDiff = sum / (n / 4) / 3;
console.log('mean |diff| per channel: ' + meanDiff.toFixed(2));
assert(meanDiff > 5, 'expression changed the render (mean diff ' + meanDiff.toFixed(2) + ' > 5)');

// And the second field must differ from the first — both engaged.
let sum2 = 0;
for (let i = 0; i < n; i += 4) {
  sum2 += Math.abs(happy.data[i] - angry.data[i]) +
          Math.abs(happy.data[i + 1] - angry.data[i + 1]) +
          Math.abs(happy.data[i + 2] - angry.data[i + 2]);
}
const meanDiff2 = sum2 / (n / 4) / 3;
console.log('mean |happy-angry| per channel: ' + meanDiff2.toFixed(2));
assert(meanDiff2 > 5, 'second expression changed the render (mean diff ' + meanDiff2.toFixed(2) + ' > 5)');

console.log('PASS: expression panel drives the per-token field end to end');
