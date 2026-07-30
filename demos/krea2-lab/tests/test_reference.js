// Reference-picture test: load the real Krea 2 Turbo checkpoint and drive the
// scene section's reference panel through the ACTUAL UI.
//
// This replaced test_identity.js + test_imgprompt.js, which tested one
// mechanism as if it were two features. The assertions that matter now are the
// ones those two missed:
//
//   - the share slider changes the TOKEN COUNT, not a gain. The old dial
//     scaled the copied taps, which the fusion's rmsnorms wash out; it still
//     moved the picture (mean |Δ| 47) because any perturbation sends a 4-step
//     sampler elsewhere, so "the image changed" proved nothing and is not
//     asserted here.
//   - share 100 with an empty prompt is the whole conditioning — the case that
//     used to need a separate image-as-prompt mode.
//   - the encode is cached, so dragging the share is free.
//
//   bro-headless ../broworkshop/demos/krea2-lab tests/test_reference.js

const MODEL_DIR = 'D:/projects/brodiffusion/weights/krea-2-turbo';
const OUT_DIR = require('os').tmpdir().replace(/\\/g, '/') + '/krea2-reference-test';
const PROMPT = 'a lighthouse on a rocky headland under a bright noon sky, photograph';
const DECOY = 'a bowl of ramen on a wooden table, overhead shot';

function $(id) { return document.getElementById(id); }
function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}

require('fs').mkdirSync(OUT_DIR, { recursive: true });

assert($('model-dir').value.trim() === MODEL_DIR,
       '#model-dir defaults to the real checkpoint (got ' + $('model-dir').value + ')');
console.log('waiting for the model to load…');
assert(pumpUntil(() => !$('btn-generate').disabled || $('status-text').classList.contains('err'),
                 600000), 'model load finished within budget');
assert(!$('status-text').classList.contains('err'),
       'model loaded without error: ' + $('status-text').textContent);

if ($('live').checked) $('live').click();
if (!$('btn-deck-clear').disabled) $('btn-deck-clear').click();
$('rand-seed').checked = false;
$('width').value = '512';
$('height').value = '512';
$('steps').value = '4';
$('guidance').value = '1.0';
$('neg-prompt').value = '';
$('prompt').value = PROMPT;

function generate(seed, label) {
  $('seed').value = String(seed);
  $('status-text').textContent = '';
  $('btn-generate').click();
  assert(pumpUntil(() => $('status-text').textContent === 'done' ||
                         $('status-text').classList.contains('err'), 180000),
         label + ': generation finished within budget');
  assert(!$('status-text').classList.contains('err'),
         label + ': completed without error: ' + $('status-text').textContent);
  const view = $('view');
  const img = view.getContext('2d').getImageData(0, 0, view.width, view.height);
  bro.image.encodePngFile(OUT_DIR + '/' + label + '.png', img.data, view.width, view.height, 4);
  console.log(label + ' · ' + $('timing').textContent);
  return img;
}
// "reference · 141 of 402 tokens"
function refTokens() {
  const m = /reference · (\d+) of (\d+) tokens/.exec($('timing').textContent);
  assert(m, 'the timing line carries the reference token count: ' + $('timing').textContent);
  return { took: +m[1], of: +m[2] };
}

// ── no reference: words only ────────────────────────────────────────────────
generate(2024, 'a_words');
assert($('timing').textContent.indexOf('reference') < 0,
       'no reference note before one is picked: ' + $('timing').textContent);

// ── pick the render as the reference ────────────────────────────────────────
assert(!$('btn-ref-use-render').disabled, 'Use current render is enabled after a render');
$('btn-ref-use-render').click();
assert(pumpUntil(() => $('status-text').textContent.indexOf('reference set') === 0 ||
                       $('status-text').classList.contains('err'), 120000),
       'the encode finished (status: ' + $('status-text').textContent + ')');
assert(!$('status-text').classList.contains('err'),
       'encode ok: ' + $('status-text').textContent);
console.log($('status-text').textContent);
assert($('ref-thumb').classList.contains('filled'), 'the thumb shows the picture');
assert(!$('btn-ref-clear').disabled, 'clear is available once a picture is set');

const shareCtl = $('ref-share-row').querySelector('input[type=range]');
assert(shareCtl && +shareCtl.value > 0, 'picking a picture arms the share (got ' +
       (shareCtl && shareCtl.value) + ')');
// The panel states the token count BEFORE rendering — the number was previously
// only discoverable from the timing line after the fact.
assert(/\d+ of \d+ tokens ride/.test($('ref-note').textContent),
       'the panel says how many tokens will ride: ' + $('ref-note').textContent);

// The deck carries it, and its × is the way back.
const chipNames = Array.from(document.querySelectorAll('#deck-chips .deck-chip'))
  .map((c) => c.firstChild.textContent);
assert(chipNames.indexOf('reference') >= 0,
       'the deck lists the reference (chips: ' + chipNames.join(', ') + ')');

// ── the share is a token count, and it scales ───────────────────────────────
function atShare(v, label) {
  shareCtl.value = String(v);
  shareCtl.dispatchEvent(new Event('input'));
  generate(777, label);
  return refTokens();
}
const lo = atShare(20, 'b_share20');
const hi = atShare(80, 'c_share80');
console.log('share 20 -> ' + lo.took + ' tokens · share 80 -> ' + hi.took +
            ' · the picture has ' + hi.of);
assert(lo.of === hi.of, 'the reference token count is a property of the picture');
assert(Math.abs(lo.took / lo.of - 0.20) < 0.02,
       'share 20 rides ~20% of the picture (' + lo.took + '/' + lo.of + ')');
assert(Math.abs(hi.took / hi.of - 0.80) < 0.02,
       'share 80 rides ~80% of the picture (' + hi.took + '/' + hi.of + ')');

// The panel's pre-render estimate has to match what the worker actually did.
assert($('ref-note').textContent.indexOf(hi.took + ' of ' + hi.of) === 0,
       'the panel predicted the token count it got: ' + $('ref-note').textContent);

// ── the encode is cached: changing the share must not re-run the tower ──────
assert($('status-text').textContent === 'done',
       'a share change did not re-encode the picture: ' + $('status-text').textContent);

// ── share 100 + no prompt = the picture is the whole conditioning ───────────
// This is what used to require a separate image-as-prompt mode. The prompt is
// set to something unrelated first, then emptied, so a stale prompt reaching
// the worker would show up as ramen.
$('prompt').value = DECOY;
$('prompt').dispatchEvent(new Event('input'));
const withDecoy = atShare(100, 'd_share100_decoy');
assert(withDecoy.took === withDecoy.of,
       'share 100 rides the whole picture (' + withDecoy.took + '/' + withDecoy.of + ')');
$('prompt').value = '';
$('prompt').dispatchEvent(new Event('input'));
assert($('sec-scene').classList.contains('prompt-quiet'),
       'the panel says the picture is the whole conditioning at 100% with no prompt');
generate(777, 'e_picture_only');
assert(refTokens().took === withDecoy.of, 'the whole picture still rides with no prompt');

// ── clearing puts the words back ────────────────────────────────────────────
$('prompt').value = PROMPT;
$('prompt').dispatchEvent(new Event('input'));
$('btn-ref-clear').click();
assert(pumpUntil(() => $('status-text').textContent.indexOf('reference cleared') === 0,
                 30000), 'reference cleared');
assert(!$('sec-scene').classList.contains('prompt-quiet'), 'the prompt reads as live again');
generate(2024, 'f_words_again');
assert($('timing').textContent.indexOf('reference') < 0,
       'no reference note once cleared: ' + $('timing').textContent);

console.log('PASS — the reference picture works through the real UI · renders in ' + OUT_DIR);
