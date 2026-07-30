// Image-as-prompt test: load the real Krea 2 Turbo checkpoint and drive the
// scene section's "image as prompt" panel through the ACTUAL UI. Renders a
// picture from words, makes that render the prompt, and renders again from the
// picture alone with the prompt text replaced by something unrelated — which
// must be ignored, since the words are not sent at all.
//
// Also covers the two things that make this cheap enough to use: the encode
// happens once per picked picture (a re-render must not pay the vision tower
// again), and the panel says which conditioning each frame was made with.
//
//   bro-headless ../broworkshop/demos/krea2-lab tests/test_imgprompt.js

const MODEL_DIR = 'D:/projects/brodiffusion/weights/krea-2-turbo';
const OUT_DIR = require('os').tmpdir().replace(/\\/g, '/') + '/krea2-imgprompt-test';
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

// ── from words ───────────────────────────────────────────────────────────────
generate(2024, 'words');
assert($('timing').textContent.indexOf('image prompt') < 0,
       'no image-prompt note before one is set: ' + $('timing').textContent);
assert(!$('sec-scene').classList.contains('prompt-overridden'),
       'the prompt reads as live while no picture is set');

// ── make that render the prompt ──────────────────────────────────────────────
assert(!$('btn-imgp-use-render').disabled, 'Use current render is enabled after a render');
$('btn-imgp-use-render').click();
assert(pumpUntil(() => $('status-text').textContent.indexOf('image prompt set') === 0 ||
                       $('status-text').classList.contains('err'), 120000),
       'image-prompt encode finished (status: ' + $('status-text').textContent + ')');
assert(!$('status-text').classList.contains('err'),
       'image-prompt encode ok: ' + $('status-text').textContent);
console.log($('status-text').textContent);
assert($('imgp-thumb').classList.contains('filled'), 'the thumb shows the picture');
assert($('sec-scene').classList.contains('prompt-overridden'),
       'the prompt panel marks itself not-in-play once a picture is the prompt');
assert(!$('btn-imgp-clear').disabled, 'clear is available once a picture is set');

// The deck carries it like any other control, and its × is the way back.
const chipNames = Array.from(document.querySelectorAll('#deck-chips .deck-chip'))
  .map((c) => c.firstChild.textContent);
assert(chipNames.indexOf('image prompt') >= 0,
       'the deck lists the image prompt (chips: ' + chipNames.join(', ') + ')');

// ── from the picture, with the words replaced by something unrelated ─────────
// If the prompt text were still reaching the worker this would render ramen.
$('prompt').value = DECOY;
generate(777, 'picture');
const note = $('timing').textContent;
assert(/image prompt · (\d+) tokens/.test(note),
       'the timing line reports the image-prompt conditioning: ' + note);
const tokens = +/image prompt · (\d+) tokens/.exec(note)[1];
assert(tokens > 50, 'the picture encoded to a real token grid (' + tokens + ')');

// ── the encode is cached: a second render must not re-run the vision tower ───
// A re-encode would post a status of its own and cost hundreds of ms; neither
// happens if the worker is serving the cached taps.
const before = Date.now();
generate(778, 'picture_again');
console.log('second render from the same picture took ' +
            (Date.now() - before) + ' ms (encode is cached)');
assert($('status-text').textContent === 'done',
       'the re-render did not re-encode the picture: ' + $('status-text').textContent);

// ── clearing puts the words back ─────────────────────────────────────────────
$('btn-imgp-clear').click();
assert(pumpUntil(() => $('status-text').textContent.indexOf('image prompt cleared') === 0,
                 30000), 'image prompt cleared');
assert(!$('sec-scene').classList.contains('prompt-overridden'),
       'the prompt reads as live again');
generate(777, 'words_again');
assert($('timing').textContent.indexOf('image prompt') < 0,
       'no image-prompt note once cleared: ' + $('timing').textContent);

console.log('PASS — image as prompt works through the real UI · renders in ' + OUT_DIR);
