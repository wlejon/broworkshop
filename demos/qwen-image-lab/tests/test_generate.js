// Smoke test: load the real Qwen-Image 2.1 checkpoint and drive ONE
// text-only generation through the ACTUAL UI (prompt field -> Generate button
// -> rendered canvas), not by calling bro.diffusion or the worker directly.
//
//   CUDA_VISIBLE_DEVICES=0 bro-headless ../broworkshop/demos/qwen-image-lab tests/test_generate.js
//
// 512² / 4 steps, well under the app's own 512²/8 explore default, so the
// render is a second or two once the ~17 GiB of INT8 weights are resident.

import { weightPath } from "/lib/kit/weights.js";
const MODEL_DIR = weightPath('brodiffusion/weights/qwen-image-2.1');

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
assert($('model-dir').value.trim() === MODEL_DIR,
       '#model-dir defaults to the real checkpoint (got ' + $('model-dir').value + ')');

// index.html's #model-dir already points at the checkpoint, so the app's own
// client.onReady() -> doLoad() auto-load runs with no click needed. Clicking
// #btn-load here would just bounce off the in-flight request.
console.log('waiting for the model to load — 7.1B DiT + Qwen3-VL-8B, quantized as it streams…');
const t0 = Date.now();
const loadedOk = pumpUntil(
  () => !$('btn-generate').disabled || $('status-text').classList.contains('err'), 600000);
assert(loadedOk, 'model load finished within budget');
assert(!$('status-text').classList.contains('err'),
       'model loaded without error: ' + $('status-text').textContent);
console.log('loaded in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s · ' +
            $('status-text').textContent + ' · backend ' + $('backend').textContent);

// The load reports the bank and the desk — both are what the axes and desk
// panels are built from, so a silent failure there is a silent failure of the
// whole lab.
const axisRows = document.querySelectorAll('#axis-categories .ctl');
assert(axisRows.length === 88,
       'the 88-axis bank built one slider per axis (got ' + axisRows.length + ')');
const faderRows = document.querySelectorAll('#desk-rows .ctl');
assert(faderRows.length >= 6,
       'controller.json built its faders (got ' + faderRows.length + ')');
console.log('bank: ' + axisRows.length + ' axes · desk: ' + faderRows.length + ' faders · ' +
            $('desk-sub').textContent);

// ── drive a plain-prompt generation through the real UI ────────────────────
$('live').checked = false;
$('live').dispatchEvent(new Event('change'));
$('btn-deck-clear').click();          // neutralize whatever a session persisted
$('width').value = '512';
$('height').value = '512';
$('steps').value = '4';
$('seed').value = '7';
$('guidance').value = '1.0';
$('rand-seed').checked = false;
$('prompt').value = 'a stone cottage beside a mountain lake';
flush();

$('btn-generate').click();
console.log('generating…');
const tg = Date.now();
const doneOk = pumpUntil(
  () => $('status-text').textContent === 'done' || $('status-text').classList.contains('err'),
  180000);
assert(doneOk, 'generation finished within budget');
assert(!$('status-text').classList.contains('err'),
       'generation completed without error: ' + $('status-text').textContent);
console.log('rendered in ' + ((Date.now() - tg) / 1000).toFixed(2) + ' s · ' +
            $('timing').textContent);

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

// the timing bar reports the joint-sequence split the hooks address
assert($('timing').textContent.indexOf('s/step') >= 0, 'the timing bar reports s/step');

// the render landed in the history, and the desk adopted it as the baseline
assert(document.querySelectorAll('#hist-list .hist-item').length === 1,
       'the render joined the history');
assert(window.__ctx.baselineFrame(),
       'a render with the desk at zero became the retention baseline');
assert($('ret-text').textContent.indexOf('retention') >= 0 ||
       $('ret-text').textContent.indexOf('baseline') >= 0,
       'the retention meter has something to say: ' + $('ret-text').textContent);

console.log('PASS — qwen-image-lab renders through the real UI');
