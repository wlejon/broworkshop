// Prefix-cache slots, through the real UI: save one prompt's extracted prefix,
// prime a second prompt, and blend the live cache towards the saved one.
//
//   CUDA_VISIBLE_DEVICES=0 bro-headless ../broworkshop/demos/qwen-image-lab tests/test_prefix.js
//
// The claim under test is the one that makes slots worth having: from step 1
// onwards the extracted prefix IS the conditioning, so replacing it wholesale
// mid-denoise has to move the picture away from the prompt that was primed and
// towards the one the cache came from — with no re-encode, no vision tower and
// no txt_in.
//
// How far it moves depends on the step count, and the test measures that
// rather than assuming it. The blend lands after step 0, because step 0 is
// what EXTRACTS the prefix; and step 0 of a flow-match schedule is the step
// that settles the composition. Measured here at 512²: at 4 steps the swap is
// worth an MSE of 5 against a prompt-to-prompt distance of 1119, at 8 steps
// 93, at 20 steps 367 of 1972. So it is a real dial that gets stronger the
// longer the run — which is the opposite of every in-network hook in this lab
// — and the test runs at 8 steps where both ends of that are visible.
//
// Both prompts are chosen to tokenize to the same length, because a blend
// between two different layouts throws rather than mis-aligning — and the test
// asserts the lengths matched rather than assuming it.

function $(id) { return document.getElementById(id); }
function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}
function mse(a, b) {
  let acc = 0, n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) { const d = a.data[i + c] - b.data[i + c]; acc += d * d; n++; }
  }
  return acc / n;
}

console.log('waiting for the model to load…');
assert(pumpUntil(() => !$('btn-generate').disabled ||
                       $('status-text').classList.contains('err'), 600000),
       'model load finished within budget');
assert(!$('status-text').classList.contains('err'),
       'model loaded without error: ' + $('status-text').textContent);

const ctx = window.__ctx;
// Both encode to 17 rows — checked below, not assumed.
const PROMPT_A = 'a lighthouse at dawn over a black sea';
const PROMPT_B = 'a bowl of oranges on a wooden kitchen table';

$('live').checked = false; $('live').dispatchEvent(new Event('change'));
$('btn-deck-clear').click();
$('btn-cond-clear').click();
$('width').value = '512'; $('height').value = '512';
$('steps').value = '8'; $('seed').value = '7'; $('guidance').value = '1.0';
$('rand-seed').checked = false;
flush();

function setPrompt(p) { $('prompt').value = p; $('prompt').dispatchEvent(new Event('change')); flush(); }
function render(what) {
  const t0 = Date.now();
  $('btn-generate').click();
  const ok = pumpUntil(() => $('status-text').textContent === 'done' ||
                             $('status-text').classList.contains('err'), 180000);
  assert(ok && !$('status-text').classList.contains('err'),
         what + ' rendered ok: ' + $('status-text').textContent);
  const c = $('view');
  console.log(what + ' · ' + ((Date.now() - t0) / 1000).toFixed(2) + ' s');
  return c.getContext('2d').getImageData(0, 0, c.width, c.height);
}
function waitIdle(budget) {
  return pumpUntil(() => !ctx.busy, budget || 300000);
}

document.querySelector('.secbtn[data-sec="prefix"]').click();
flush();
assert($('sec-prefix').classList.contains('active'), 'the prefix section shows');
const slots0 = ctx.prefixSlots();
assert(slots0.length === 4, 'the binding reports four slots (got ' + slots0.length + ')');
assert(!slots0.some((s) => s.valid), 'they start empty');
assert(document.querySelectorAll('#pfx-slots .pfx-slot').length === 4,
       'one card a slot');

// ── the two prompts, and their renders ────────────────────────────────────
setPrompt(PROMPT_A);
const frameA = render('prompt A · ' + PROMPT_A);
setPrompt(PROMPT_B);
const frameB = render('prompt B · ' + PROMPT_B);
const dAB = mse(frameA, frameB);
console.log('A vs B: mse ' + dAB.toFixed(1));
assert(dAB > 20, 'the two prompts render differently to begin with (mse ' + dAB.toFixed(1) + ')');

// ── save each prompt's prefix ─────────────────────────────────────────────
function saveInto(slot, prompt) {
  setPrompt(prompt);
  $('pfx-save-slot').value = String(slot);
  const t0 = Date.now();
  ctx.savePrefixSlot();
  assert(waitIdle(), 'the save finished within budget');
  assert(!$('status-text').classList.contains('err'),
         'saved slot ' + slot + ': ' + $('status-text').textContent);
  console.log('slot ' + slot + ' ← "' + prompt + '" · ' +
              ((Date.now() - t0) / 1000).toFixed(2) + ' s · ' + $('status-text').textContent);
  return ctx.prefixSlots()[slot];
}
const s0 = saveInto(0, PROMPT_A);
const s1 = saveInto(1, PROMPT_B);
assert(s0.valid && s1.valid, 'both slots report valid');
assert(s0.rows === s1.rows,
       'the two prompts tokenize to the same prefix length, which is what a blend needs (' +
       s0.rows + ' vs ' + s1.rows + ')');
assert($('pfx-slots-note').textContent.indexOf('2 / 4') === 0,
       'the panel counts them: ' + $('pfx-slots-note').textContent);

// ── blend the live prefix all the way to A, while priming B ───────────────
setPrompt(PROMPT_B);
$('pfx-a').value = '0'; $('pfx-a').dispatchEvent(new Event('change'));
$('pfx-b').value = '1'; $('pfx-b').dispatchEvent(new Event('change'));
flush();

const aRow = document.querySelector('#pfx-blend-rows .ctl[data-key="pfx.a"] input[type=range]');
const bRow = document.querySelector('#pfx-blend-rows .ctl[data-key="pfx.b"] input[type=range]');
assert(aRow && bRow, 'the two blend sliders exist');
function setBlend(a, b) {
  aRow.value = String(a); aRow.dispatchEvent(new Event('input'));
  bRow.value = String(b); bRow.dispatchEvent(new Event('input'));
  flush();
}

setBlend(1, 0);
assert(document.querySelectorAll('.deck-chip').length === 1, 'the blend joined the deck');
let msg = ctx.buildGenerateMsg();
assert(msg.prefix && msg.prefix.blend.length === 1 && msg.prefix.blend[0].slot === 0,
       'the generate message carries the blend');
const blendA = render('prompt B, prefix fully blended to A');

const toA = mse(blendA, frameA), toB = mse(blendA, frameB);
console.log('prefix→A render: mse to A ' + toA.toFixed(1) + ' · mse to B ' + toB.toFixed(1) +
            ' · A↔B ' + dAB.toFixed(1) + ' · moved ' +
            (100 * (1 - toA / dAB)).toFixed(1) + '% of the way to A');
assert(toB > 20,
       'swapping the cache changed the render materially, against a same-settings floor of 0 (' +
       toB.toFixed(1) + ')');
assert(toA < dAB,
       'and it moved TOWARDS the prompt the cache came from (' +
       toA.toFixed(1) + ' < ' + dAB.toFixed(1) + ')');

// ── half-way ──────────────────────────────────────────────────────────────
setBlend(1, 0.5);
msg = ctx.buildGenerateMsg();
assert(msg.prefix.blend.length === 2 && msg.prefix.blend[1].slot === 1,
       'A then B is two blends, in order');
const half = render('half-way from A back to B');
const hA = mse(half, blendA), hB = mse(half, frameB);
console.log('half-way: mse to the A-blend ' + hA.toFixed(1) + ' · to B ' + hB.toFixed(1));
assert(hA > 1 && hB > 1, 'half-way is neither end');

// ── back to neutral reproduces the plain B render, to the pixel ───────────
setBlend(0, 0);
assert(document.querySelectorAll('.deck-chip').length === 0, 'the blend left the deck');
const plain = render('blend at zero');
console.log('blend at zero vs the original B render: mse ' + mse(frameB, plain).toFixed(4));
assert(mse(frameB, plain) < 1e-6, 'a zero blend is a no-op to the pixel');

// ── the walk strip ────────────────────────────────────────────────────────
// A slot's layout is its prefix length AND its target grid, so the walk has to
// run at the size the slots were saved at — the test asserts that rather than
// asking for a cheaper strip the binding would reject.
$('pfx-walk-n').value = '3'; $('pfx-walk-n').dispatchEvent(new Event('input'));
flush();
assert(!$('pfx-walk-px'), 'there is no frame-size control, because a slot carries its grid');
assert(ctx.prefixSlots()[0].width === 512,
       'the slot records the size it was taken at (' + ctx.prefixSlots()[0].width + ')');
console.log('rendering a 3-frame walk from slot 0 to slot 1 at 512²…');
const tWalk = Date.now();
ctx.prefixWalk();
assert(pumpUntil(() => ctx.prefixWalkFrames().length >= 3 ||
                       $('status-text').classList.contains('err'), 300000),
       'the walk finished: ' + $('status-text').textContent);
const frames = ctx.prefixWalkFrames();
console.log('walk · ' + frames.length + ' frames in ' +
            ((Date.now() - tWalk) / 1000).toFixed(1) + ' s · status: ' +
            $('status-text').textContent);
assert(frames.length === 3, 'three frames (got ' + frames.length + '): ' +
       $('status-text').textContent);
assert(frames[0].t === 0 && Math.abs(frames[2].t - 1) < 1e-9, 'the walk runs t = 0 → 1');
assert(frames[0].frame.width === 512, 'the walk renders at the slots\' size');
const dWalk = mse(frames[0].frame, frames[2].frame);
console.log('walk endpoints: mse ' + dWalk.toFixed(1));
assert(dWalk > 20, 'the two ends of the walk are different pictures (mse ' + dWalk.toFixed(1) + ')');
assert(document.querySelectorAll('#pfx-strip .walk-cell').length === 3,
       'the strip drew a cell a frame');
assert($('pfx-strip').textContent.indexOf('ret') >= 0, 'with a retention readout on each');

// ── the panel says what re-extracts ───────────────────────────────────────
const help = $('pfx-help').textContent;
assert(help.indexOf('TEXT half') >= 0 && help.indexOf('IMAGE half') >= 0,
       'the help text states the cache re-extract rules');

// ── clearing frees them ───────────────────────────────────────────────────
$('btn-pfx-clear').click();
assert(waitIdle(60000), 'the clear finished');
assert(!ctx.prefixSlots().some((s) => s.valid), 'every slot is empty again');
assert($('pfx-slots-note').textContent.indexOf('0 / 4') === 0,
       'and the panel says so: ' + $('pfx-slots-note').textContent);

console.log('PASS — a saved prefix steers a different prompt, blends, walks and frees');
