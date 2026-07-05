// Smoke test for krea2-lab: load the real Krea 2 Turbo checkpoint and drive
// ONE plain-prompt generation through the ACTUAL UI (prompt field -> Generate
// button -> rendered canvas) — not by calling bro.diffusion / the worker
// directly. Run headless (GPU; loads a real ~26GB checkpoint, budget several
// minutes for the load):
//
//   bro-headless ../broworkshop/demos/krea2-lab tests/test_generate.js
//
// Kept a lightweight 4-step / 512^2 render (well under the app's own 1024²/8-
// step defaults) so the actual generation is fast once the model is resident.

const MODEL_DIR = 'D:/projects/brodiffusion/weights/krea-2-turbo';

function $(id) { return document.getElementById(id); }

function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}

assert($('model-dir'), 'model-dir field exists');
assert($('prompt'), 'prompt field exists');
assert($('btn-generate'), 'generate button exists');
assert($('view'), 'render canvas exists');

// index.html's #model-dir already defaults to MODEL_DIR, so the app's own
// client.onReady() -> doLoad() auto-load kicks in with no click needed. Don't
// click #btn-load ourselves: the worker client accepts only one outstanding
// request, so a second, redundant load click while the real one is in flight
// would just bounce off a "worker busy" error and could look like a (false)
// load failure to this test.
assert($('model-dir').value.trim() === MODEL_DIR,
       '#model-dir defaults to the real checkpoint (got ' + $('model-dir').value + ')');

console.log('waiting for the model to load — this reads ~26GB of weights…');
const loadedOk = pumpUntil(
  () => !$('btn-generate').disabled || $('status-text').classList.contains('err'),
  600000);   // 10 min budget
assert(loadedOk, 'model load finished within budget');
assert(!$('status-text').classList.contains('err'),
       'model loaded without error: ' + $('status-text').textContent);
console.log('load status: ' + $('status-text').textContent + ' · backend: ' + $('backend').textContent);

// ── drive a plain-prompt generation through the real UI ─────────────────────
$('size').value = '512';
$('steps').value = '4';
$('seed').value = '0';
$('guidance').value = '1.0';
$('prompt').value = 'a red fox sitting in a snowy forest clearing at dawn, cinematic lighting';
$('neg-prompt').value = '';

$('btn-generate').click();

console.log('generating…');
const doneOk = pumpUntil(
  () => $('status-text').textContent === 'done' || $('status-text').classList.contains('err'),
  180000);   // 3 min budget
assert(doneOk, 'generation finished within budget');
assert(!$('status-text').classList.contains('err'),
       'generation completed without error: ' + $('status-text').textContent);
console.log('generate status: ' + $('status-text').textContent + ' · timing: ' + $('timing').textContent);

// ── assert the canvas actually has a rendered, non-blank frame ──────────────
const canvas = $('view');
assert(canvas.width === 512 && canvas.height === 512,
       'canvas sized to the requested 512x512 (got ' + canvas.width + 'x' + canvas.height + ')');

const img = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
let nonzero = 0;
for (let i = 0; i < img.data.length; i += 4) {
  if (img.data[i] | img.data[i + 1] | img.data[i + 2]) nonzero++;
}
console.log('non-black pixels: ' + nonzero + ' / ' + (canvas.width * canvas.height));
assert(nonzero > (canvas.width * canvas.height) / 100, 'rendered frame is (nearly) all black');

console.log('PASS — krea2-lab Generate path works through the real UI');
