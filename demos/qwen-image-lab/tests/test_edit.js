// The edit path, through the real UI: a condition image has to change what the
// same prompt renders, and it has to hold the picture it was given.
//
//   CUDA_VISIBLE_DEVICES=0 bro-headless ../broworkshop/demos/qwen-image-lab tests/test_edit.js
//
// A condition image enters the model twice — the vision tower fills the
// template's <|image_pad|> rows (so the prompt is ABOUT the picture) and the
// 16x autoencoder puts its latents in the joint sequence (so the pixels are
// there). Both routes the UI offers are exercised: "use current render", which
// sends planar CHW floats, and a typed path, which sends {path}.

const fs = require('fs');
const FIXTURE = 'D:/projects/broworkshop/demos/qwen-image-lab/tests/.cond_fixture.png';

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

$('live').checked = false; $('live').dispatchEvent(new Event('change'));
$('btn-deck-clear').click();
$('btn-cond-clear').click();
$('width').value = '512'; $('height').value = '512';
$('steps').value = '4'; $('seed').value = '7'; $('guidance').value = '1.0';
$('rand-seed').checked = false;
flush();

function render(what) {
  const t0 = Date.now();
  $('btn-generate').click();
  const ok = pumpUntil(() => $('status-text').textContent === 'done' ||
                             $('status-text').classList.contains('err'), 300000);
  assert(ok && !$('status-text').classList.contains('err'),
         what + ' rendered ok: ' + $('status-text').textContent);
  const c = $('view');
  console.log(what + ' · ' + ((Date.now() - t0) / 1000).toFixed(2) + ' s · ' +
              c.width + '×' + c.height + ' · ' + $('timing').textContent);
  return c.getContext('2d').getImageData(0, 0, c.width, c.height);
}

// ── the picture to edit ───────────────────────────────────────────────────
$('prompt').value = 'a stone cottage beside a mountain lake';
flush();
const base = render('the source picture · text only');

// ── the same edit prompt, with and without the picture ────────────────────
$('prompt').value = 'make the sky a vivid orange sunset';
flush();
const textOnly = render('edit prompt · text only (no condition image)');

assert(!$('btn-cond-use-render').disabled, '"use current render" is live once something is rendered');
$('btn-cond-use-render').click();
flush();
assert($('cond-list').querySelectorAll('.cond-item').length === 1,
       'the canvas joined the condition list');
let chips = [];
document.querySelectorAll('.deck-chip').forEach((c) => chips.push(c.textContent));
assert(chips.join('|').indexOf('edit · 1 image') >= 0,
       'the condition image wears a deck chip: ' + chips.join(' | '));
const msg = window.__ctx.buildGenerateMsg();
assert(msg.conditionImages && msg.conditionImages.length === 1 && msg.conditionImages[0].pixels,
       'the generate message carries planar CHW pixels');

const edited = render('edit prompt · with the condition image');

const dEdit = mse(textOnly, edited);
const dBaseText = mse(base, textOnly);
const dBaseEdit = mse(base, edited);
console.log('edited vs text-only: mse ' + dEdit.toFixed(1));
console.log('vs the source picture — text only: ' + dBaseText.toFixed(1) +
            ' · edited: ' + dBaseEdit.toFixed(1));
assert(dEdit > 50, 'the condition image changed the render (mse ' + dEdit.toFixed(1) + ')');
// Note what the numbers do NOT say: at 4 steps an edit is not pixel-anchored to
// its source — both renders sit about as far from it. The condition image is
// conditioning, not a starting latent, so "held the picture" is not a claim
// this test makes.

// Removing the picture has to put the text-only render back exactly — an edit
// that leaked into later generations would be a stuck prefix cache.
$('btn-cond-clear').click();
flush();
assert(document.querySelectorAll('.deck-chip').length === 0, 'the condition chip left the deck');
const cleared = render('edit prompt · condition image removed again');
const dCleared = mse(textOnly, cleared);
console.log('after removing the image vs the text-only render: mse ' + dCleared.toFixed(4));
assert(dCleared < 1e-6,
       'removing the condition image reproduces the text-only render exactly (mse ' +
       dCleared.toFixed(4) + ')');

// ── the typed-path route, and the derived canvas ──────────────────────────
// Write the source render out and feed it back as a file, which is the other
// shape a condition entry takes.
bro.image.encodePngFile(FIXTURE, base.data, base.width, base.height, 4);
$('cond-path').value = FIXTURE;
$('btn-cond-add').click();
flush();
assert($('cond-list').querySelectorAll('.cond-item').length === 1, 'the typed path was added');
const msg2 = window.__ctx.buildGenerateMsg();
assert(msg2.conditionImages[0].path === FIXTURE, 'the message carries the path, not pixels');

// With "derive" on, width/height must be ABSENT and the canvas comes from the
// image's aspect at outputResolution.
$('cond-derive').checked = true;
$('cond-derive').dispatchEvent(new Event('change'));
$('cond-outres').value = '512';
$('cond-outres').dispatchEvent(new Event('change'));
flush();
const msg3 = window.__ctx.buildGenerateMsg();
assert(msg3.opts.width === undefined && msg3.opts.outputResolution === 512,
       'a derived canvas sends outputResolution and no width/height');
const derived = render('the same picture as a file · derived canvas');
assert($('view').width === 512 && $('view').height === 512,
       'a square source at outputResolution 512 derived a 512x512 canvas (got ' +
       $('view').width + 'x' + $('view').height + ')');
assert(mse(textOnly, derived) > 50, 'the file-sourced condition image reached the model too');

// tidy up: the fixture is a test artifact, not an asset
$('cond-derive').checked = false;
$('cond-derive').dispatchEvent(new Event('change'));
$('btn-cond-clear').click();
flush();
try { fs.unlinkSync(FIXTURE); } catch (e) { console.log('could not remove the fixture: ' + e.message); }

console.log('PASS — condition images reach the model through both UI routes');
