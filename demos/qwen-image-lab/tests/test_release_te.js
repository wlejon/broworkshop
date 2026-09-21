// Releasing the text encoder, through the real UI.
//
//   CUDA_VISIBLE_DEVICES=0 bro-headless ../broworkshop/demos/qwen-image-lab tests/test_release_te.js
//
// The Qwen3-VL-8B backbone is ~8.5 GiB and completely idle from prime()
// onwards, so releasing it is what buys a bigger canvas on a 24 GB card. The
// recipe the library documents is: render (or encode) every prompt you need,
// release, then prime freely — an already-encoded prompt still primes from the
// 8-entry memo, and an unseen one is refused by name. Both halves are checked
// here, including that the refusal is a legible message rather than a throw
// from inside the pipeline.

function $(id) { return document.getElementById(id); }
function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}
function render(what, budget) {
  $('btn-generate').click();
  const ok = pumpUntil(() => $('status-text').textContent === 'done' ||
                             $('status-text').classList.contains('err'), budget || 300000);
  assert(ok, what + ' settled within budget');
  console.log(what + ' · ' + $('status-text').textContent);
  return !$('status-text').classList.contains('err');
}

console.log('waiting for the model to load…');
assert(pumpUntil(() => !$('btn-generate').disabled ||
                       $('status-text').classList.contains('err'), 600000),
       'model load finished within budget');
assert(!$('status-text').classList.contains('err'),
       'model loaded without error: ' + $('status-text').textContent);

$('live').checked = false; $('live').dispatchEvent(new Event('change'));
$('btn-deck-clear').click();
$('btn-cond-clear').click();
$('width').value = '512'; $('height').value = '512';
$('steps').value = '4'; $('seed').value = '7'; $('rand-seed').checked = false;
$('prompt').value = 'a stone cottage beside a mountain lake';
flush();

assert($('te-state').textContent.indexOf('resident') >= 0,
       'the encoder starts resident: ' + $('te-state').textContent);
assert(render('the prompt, with the encoder resident'), 'the first render works');

// ── release ───────────────────────────────────────────────────────────────
const gpu = (typeof bro !== 'undefined' && bro.gpu && bro.gpu.memoryInfo) ? bro.gpu : null;
const before = gpu ? gpu.memoryInfo().freeBytes : 0;
$('btn-release-te').click();
assert(pumpUntil(() => $('te-state').textContent.indexOf('released') >= 0 ||
                       $('status-text').classList.contains('err'), 120000),
       'the release settled');
assert(!$('status-text').classList.contains('err'),
       'release reported no error: ' + $('status-text').textContent);
const after = gpu ? gpu.memoryInfo().freeBytes : 0;
console.log('te state: ' + $('te-state').textContent +
            (gpu ? ' · freed ' + ((after - before) / 1e9).toFixed(2) + ' GB' : ''));
assert($('btn-release-te').textContent.indexOf('Reload') >= 0,
       'the button now offers to reload it');

// the memoized prompt still primes
assert(render('the same prompt, encoder released'), 'a memoized prompt still renders');

// an unseen one is refused, by name, before anything is spent
$('prompt').value = 'a lighthouse at dawn over a black sea';
flush();
assert(!render('an unseen prompt, encoder released'), 'an unseen prompt is refused');
assert($('status-text').textContent.indexOf('memo') >= 0,
       'the refusal says why: ' + $('status-text').textContent);

// ── reload, and the unseen prompt works ───────────────────────────────────
$('btn-release-te').click();
assert(pumpUntil(() => $('te-state').textContent.indexOf('resident') >= 0 ||
                       $('status-text').classList.contains('err'), 300000),
       'the reload settled');
assert(!$('status-text').classList.contains('err'),
       'reload reported no error: ' + $('status-text').textContent);
assert(render('the unseen prompt, encoder back'), 'the new prompt renders once the encoder is back');

console.log('PASS — the text encoder releases, the memo keeps priming, and the reload restores it');
