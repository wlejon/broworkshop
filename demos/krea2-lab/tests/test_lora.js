// E2E test for krea2-lab's LoRA panel: restore-on-load, live strength
// rescale, and removal — driven through the ACTUAL UI against the real
// Krea 2 Turbo checkpoint, with a synthetic (random rank-4) LoRA whose only
// job is to visibly, deterministically perturb the output.
//
// Recipe (from D:/projects/bro):
//
//   cp ../broworkshop/demos/krea2-lab/.storage.json /tmp/krea2_storage.bak   # keep your prefs!
//   ./build/Release/bro-headless.exe ../broworkshop/demos/example \
//       ../broworkshop/demos/krea2-lab/tests/seed_lora_test.js
//   ./build/Release/bro-headless.exe ../broworkshop/demos/krea2-lab \
//       tests/test_lora.js
//   cp /tmp/krea2_storage.bak ../broworkshop/demos/krea2-lab/.storage.json   # restore
//
// Checks:
//   1. the seeded LoRA is re-applied on model load and shows one panel row
//   2. render at scale 1 differs from render at scale 0 (slider drag)
//   3. render after removing the LoRA (x) is identical to the scale-0 render
//      (an attached-but-zeroed adapter must be a true no-op)

function $(id) { return document.getElementById(id); }

function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}

function statusIs(s) { return $('status-text').textContent === s; }
function statusErr() { return $('status-text').classList.contains('err'); }

function grabCanvas() {
  const c = $('view');
  return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
}
function diffCount(a, b, tol) {
  assert(a.length === b.length, 'comparable frames');
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > tol) n++;
  return n;
}
function generateAndGrab(label) {
  $('btn-generate').click();
  assert(pumpUntil(() => !statusIs('done') || statusErr(), 10000),
         label + ': generation started');
  assert(pumpUntil(() => statusIs('done') || statusErr(), 180000),
         label + ': generation finished within budget');
  assert(!statusErr(), label + ': no error — ' + $('status-text').textContent);
  return grabCanvas();
}

// ── model load + LoRA restore ────────────────────────────────────────────────
assert($('lora-list'), 'LoRA panel exists');
assert($('btn-lora-add'), 'Add LoRA button exists');

console.log('waiting for the model to load — this reads ~26GB of weights…');
assert(pumpUntil(() => !$('btn-generate').disabled || statusErr(), 600000),
       'model load finished within budget');
assert(!statusErr(), 'model loaded without error: ' + $('status-text').textContent);

console.log('waiting for the seeded LoRA to re-apply…');
assert(pumpUntil(() => $('lora-status').textContent.indexOf('re-applied') >= 0 ||
                       $('lora-status').classList.contains('err'), 120000),
       'LoRA restore finished');
assert(!$('lora-status').classList.contains('err'),
       'LoRA restored without error: ' + $('lora-status').textContent);
assert($('lora-list').children.length === 1,
       'one LoRA row in the panel (got ' + $('lora-list').children.length + ')');
const row = $('lora-list').children[0];
const slider = row.querySelector('input[type=range]');
assert(slider && +slider.value === 1, 'restored at scale 1 (got ' + (slider && slider.value) + ')');
console.log('restored: ' + $('lora-status').textContent);

// ── scale 1 vs scale 0 must differ ──────────────────────────────────────────
const withLora = generateAndGrab('scale-1 render');

slider.value = '0';
slider.dispatchEvent(new Event('input'));
slider.dispatchEvent(new Event('change'));   // live is off — no auto render
const zeroed = generateAndGrab('scale-0 render');

const dOn = diffCount(withLora, zeroed, 2);
console.log('scale 1 vs scale 0: ' + dOn + ' differing bytes');
assert(dOn > withLora.length / 100, 'the LoRA visibly changes the render');

// ── removing the LoRA must equal the zeroed render ──────────────────────────
row.querySelector('.axis-mine-del').click();
assert(pumpUntil(() => !$('btn-generate').disabled &&
                       $('lora-list').children.length === 0, 60000),
       'LoRA removed (panel row gone)');
console.log('removed: ' + $('lora-status').textContent);

const removed = generateAndGrab('post-remove render');
const dOff = diffCount(zeroed, removed, 1);
console.log('scale 0 vs removed: ' + dOff + ' differing bytes');
assert(dOff === 0, 'a zeroed adapter is a true no-op (' + dOff + ' bytes differ)');

console.log('PASS — krea2-lab LoRA panel: restore, rescale, and removal all work');
