// Identity-transport test: load the real Krea 2 Turbo checkpoint and drive the
// identity panel through the ACTUAL UI — render a character at seed A, click
// "Use current render" to make it the identity reference, then render seed B
// with the identity riding and again with it cleared. Asserts the mechanics
// (encode lands, note reaches the timing line, renders complete) and that the
// injected tokens actually change the seed-B image. Saves all three renders to
// the OS temp dir for eyeball verification of the actual transport quality.
//
//   bro-headless ../broworkshop/demos/krea2-lab tests/test_identity.js

const MODEL_DIR = 'D:/projects/brodiffusion/weights/krea-2-turbo';
const OUT_DIR = require('os').tmpdir().replace(/\\/g, '/') + '/krea2-identity-test';
const SEED_A = 12345, SEED_B = 67890;
const PROMPT = 'a young prince with golden hair in an ornate dark coat walking a ' +
               'stone path through an autumn forest, storybook illustration';

function $(id) { return document.getElementById(id); }

function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}

require('fs').mkdirSync(OUT_DIR, { recursive: true });

// ── load ─────────────────────────────────────────────────────────────────────
assert($('model-dir').value.trim() === MODEL_DIR,
       '#model-dir defaults to the real checkpoint (got ' + $('model-dir').value + ')');
console.log('waiting for the model to load…');
assert(pumpUntil(() => !$('btn-generate').disabled || $('status-text').classList.contains('err'),
                 600000), 'model load finished within budget');
assert(!$('status-text').classList.contains('err'),
       'model loaded without error: ' + $('status-text').textContent);

// Deterministic driving: no live auto-renders, no seed randomization, and
// every persisted control (axis walk, expression, dials…) back to neutral —
// prefs from an interactive session would otherwise leak into the renders.
if ($('live').checked) $('live').click();
if (!$('btn-deck-clear').disabled) $('btn-deck-clear').click();
$('rand-seed').checked = false;
$('width').value = '512';
$('height').value = '512';
$('steps').value = '4';
$('guidance').value = '1.0';
$('prompt').value = PROMPT;
$('neg-prompt').value = '';

function generate(seed, label) {
  $('seed').value = String(seed);
  $('status-text').textContent = '';
  $('btn-generate').click();
  console.log('generating ' + label + ' (seed ' + seed + ')…');
  assert(pumpUntil(() => $('status-text').textContent === 'done' ||
                         $('status-text').classList.contains('err'), 180000),
         label + ': generation finished within budget');
  assert(!$('status-text').classList.contains('err'),
         label + ': completed without error: ' + $('status-text').textContent);
  const view = $('view');
  const img = view.getContext('2d').getImageData(0, 0, view.width, view.height);
  bro.image.encodePngFile(OUT_DIR + '/' + label + '.png', img.data, view.width, view.height, 4);
  console.log(label + ' · ' + $('timing').textContent + ' · saved ' + OUT_DIR + '/' + label + '.png');
  return img;
}

// ── seed A: the reference character ─────────────────────────────────────────
generate(SEED_A, 'base_A');

// ── make it the identity reference ───────────────────────────────────────────
assert(!$('btn-ident-use-render').disabled, 'Use current render is enabled after a render');
$('btn-ident-use-render').click();
assert(pumpUntil(() => $('status-text').textContent.indexOf('identity reference set') === 0 ||
                       $('status-text').classList.contains('err'), 120000),
       'identity encode finished within budget (status: ' + $('status-text').textContent + ')');
assert(!$('status-text').classList.contains('err'),
       'identity encode ok: ' + $('status-text').textContent);
console.log($('status-text').textContent);
assert($('ident-thumb').classList.contains('filled'), 'identity thumb shows the reference');
const strengthRange = $('ident-strength-row').querySelector('input[type=range]');
assert(strengthRange && +strengthRange.value === 1, 'strength armed at 1 (got ' +
       (strengthRange && strengthRange.value) + ')');

// ── seed B with the identity riding ──────────────────────────────────────────
const withIdent = generate(SEED_B, 'ident_B');
assert($('timing').textContent.indexOf('identity ×1.00') >= 0,
       'timing line reports the identity injection: ' + $('timing').textContent);

// ── seed B bare (reference cleared) ──────────────────────────────────────────
$('btn-ident-clear').click();
assert(pumpUntil(() => $('status-text').textContent.indexOf('identity reference cleared') === 0,
                 30000), 'identity cleared');
const bare = generate(SEED_B, 'base_B');
assert($('timing').textContent.indexOf('identity') < 0,
       'no identity note once cleared: ' + $('timing').textContent);

// ── the injection must actually move the image ───────────────────────────────
assert(withIdent.data.length === bare.data.length, 'comparable frames');
let diff = 0, nonzero = 0;
for (let i = 0; i < bare.data.length; i += 4) {
  diff += Math.abs(withIdent.data[i] - bare.data[i]) +
          Math.abs(withIdent.data[i + 1] - bare.data[i + 1]) +
          Math.abs(withIdent.data[i + 2] - bare.data[i + 2]);
  if (bare.data[i] | bare.data[i + 1] | bare.data[i + 2]) nonzero++;
}
const meanDiff = diff / (bare.data.length / 4 * 3);
console.log('non-black pixels (bare): ' + nonzero + ' · mean |Δ| ident vs bare: ' +
            meanDiff.toFixed(2));
assert(nonzero > (bare.data.length / 4) / 100, 'bare render is (nearly) all black');
assert(meanDiff > 2, 'identity injection changed the seed-B render (mean |Δ| ' +
       meanDiff.toFixed(2) + ')');

console.log('PASS — identity transport works through the real UI · renders in ' + OUT_DIR);
