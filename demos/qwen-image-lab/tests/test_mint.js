// Minting an axis, through the real UI: the v2 recipe run on words typed into
// the panel, registered live, driven like a bank axis, and taken off again.
//
//   CUDA_VISIBLE_DEVICES=0 bro-headless ../broworkshop/demos/qwen-image-lab tests/test_mint.js
//
// The bar the mint itself has to clear is cross-scene consistency: the mean
// pairwise cosine of the per-(stem, phrasing) pole differences, measured
// before a single pixel is rendered. The bar the RENDER has to clear is the
// same one every axis test here uses — the noise floor at a fixed seed is
// zero, so anything above it is the axis and zeroing it has to come back to
// the pixel.

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

$('live').checked = false; $('live').dispatchEvent(new Event('change'));
$('btn-deck-clear').click();
$('btn-cond-clear').click();
$('width').value = '512'; $('height').value = '512';
$('steps').value = '4'; $('seed').value = '7'; $('guidance').value = '1.0';
$('rand-seed').checked = false;
$('prompt').value = 'a stone cottage beside a mountain lake';
flush();

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

// ── mint a text axis from a prompt pair ───────────────────────────────────
document.querySelector('.secbtn[data-sec="mint"]').click();
flush();
assert($('sec-mint').classList.contains('active'), 'the mint section shows');
assert(!$('btn-mint').disabled, 'mint is live once a model is loaded');

const NAME = 'test.brass';
$('mint-name').value = NAME;
$('mint-pos').value = 'lit by warm brass lamplight';
$('mint-neg').value = 'lit by cold blue moonlight';
$('mint-stems').checked = true;
flush();

console.log('minting ' + NAME + ' — 12 stems × 1 phrasing × 2 poles = 24 encodes…');
const tMint = Date.now();
$('btn-mint').click();
assert(pumpUntil(() => $('mint-status').textContent.indexOf('minted ' + NAME) === 0 ||
                       $('mint-status').className.indexOf('err') >= 0, 600000),
       'the mint finished within budget (' + $('mint-status').textContent + ')');
assert($('mint-status').className.indexOf('err') < 0,
       'the mint succeeded: ' + $('mint-status').textContent);
console.log('mint took ' + ((Date.now() - tMint) / 1000).toFixed(1) + ' s · ' +
            $('mint-status').textContent);

const defs = ctx.mintedDefs().filter((d) => d.name === NAME);
assert(defs.length === 1, 'the axis is in the minted set');
const def = defs[0];
assert(def.scale > 60 && def.scale < 200,
       'the bank scale lands where the v2 bank\'s did — 0.15 × the mean token norm, 121.256 there ' +
       '(got ' + def.scale.toFixed(3) + ')');
assert(def.consistency > 0.15,
       'the axis means the same thing across the 12 stems (consistency ' +
       def.consistency.toFixed(3) + ')');
console.log('consistency ' + def.consistency.toFixed(3) + ' (raw ' +
            def.consistencyRaw.toFixed(3) + ') · scale ' + def.scale.toFixed(3) +
            ' · sinks ' + (def.sink || []).length);
assert(def.consistency >= def.consistencyRaw - 1e-6,
       'suppressing the sink dimensions did not make the axis less consistent (' +
       def.consistencyRaw.toFixed(3) + ' → ' + def.consistency.toFixed(3) + ')');

// the inspector says what the direction already was
assert($('mint-inspect').style.display !== 'none', 'the inspector opened');
assert($('mint-inspect-bars').querySelectorAll('.axis-bar-row').length > 0,
       'the direction is decomposed against the registered vocabulary');
const top = (def.components || [])[0];
console.log('nearest named axis: ' + (top ? top.name + ' ' + top.cos.toFixed(3) : 'none'));

// ── it is a control now ───────────────────────────────────────────────────
const row = document.querySelector('#mint-rows .ctl[data-key="' + NAME + '"]');
assert(row, 'the minted axis built a control row');
const range = row.querySelector('input[type=range]');

const base = render('baseline · the minted axis at zero');
const repeat = render('repeat');
assert(mse(base, repeat) < 1e-6, 'the noise floor is still zero with a runtime axis registered');

function setMint(v) {
  range.value = String(v);
  range.dispatchEvent(new Event('input'));
  flush();
}

setMint(3);
assert(document.querySelectorAll('.deck-chip').length === 1, 'the minted axis joined the deck');
let msg = ctx.buildGenerateMsg();
assert(msg.axes && msg.axes[NAME] === 3,
       'the minted axis rides in the same axis map the bank sliders do');
const plus = render(NAME + ' +3');
const dPlus = mse(base, plus);
console.log(NAME + ' +3 vs baseline: mse ' + dPlus.toFixed(1));
assert(dPlus > 40, 'a minted axis at +3 changed the render (mse ' + dPlus.toFixed(1) + ')');

setMint(-3);
const minus = render(NAME + ' -3');
const dSpan = mse(plus, minus);
console.log(NAME + ' -3 vs baseline: mse ' + mse(base, minus).toFixed(1) +
            ' · +3 vs -3: mse ' + dSpan.toFixed(1));
assert(dSpan > dPlus, 'the two poles are further apart than either is from neutral');

setMint(0);
const back = render('back at zero');
assert(mse(base, back) < 1e-6,
       'zeroing the minted axis restores the baseline exactly (mse ' + mse(base, back).toFixed(4) + ')');

// ── it survives a reload of the bank ──────────────────────────────────────
// loadControlDictionary is bank-level and drops every runtime axis; the load
// message carries the saved directions back.
const loadMsg = ctx.buildLoadMsg({ type: 'load' });
assert(loadMsg.minted && loadMsg.minted.some((m) => m.name === NAME),
       'the load message carries the minted direction so a reload can restore it');
const carried = loadMsg.minted.filter((m) => m.name === NAME)[0];
assert(carried.dir.length === 4096,
       'the saved direction is the encoder\'s full width (got ' + carried.dir.length + ')');

// ── mint from a picture ───────────────────────────────────────────────────
// The image rows the vision tower filled, against the text rows of the same
// prompt — a direction in the same space the text axes live in.
$('btn-cond-use-render').click();
flush();
assert(ctx.conditionCount() === 1, 'the current render is a condition image');
const INAME = 'test.seen';
$('mint-name').value = INAME;
console.log('minting ' + INAME + ' from the vision tower\'s rows…');
const tImg = Date.now();
$('btn-mint-image').click();
assert(pumpUntil(() => $('mint-status').textContent.indexOf('minted ' + INAME) === 0 ||
                       $('mint-status').className.indexOf('err') >= 0, 300000),
       'the image mint finished (' + $('mint-status').textContent + ')');
assert($('mint-status').className.indexOf('err') < 0,
       'the image mint succeeded: ' + $('mint-status').textContent);
const idef = ctx.mintedDefs().filter((d) => d.name === INAME)[0];
assert(idef, 'the image axis is in the minted set');
assert(idef.kind === 'image', 'it is recorded as an image mint');
assert(idef.scale > 60, 'it carries a bank scale (' + idef.scale.toFixed(3) + ')');
console.log('image mint · ' + ((Date.now() - tImg) / 1000).toFixed(1) + ' s · scale ' +
            idef.scale.toFixed(3) + ' · consistency ' + idef.consistency.toFixed(3));

$('btn-cond-clear').click();
flush();

// ── delete ────────────────────────────────────────────────────────────────
[NAME, INAME].forEach((n) => {
  const r = document.querySelector('#mint-rows .ctl[data-key="' + n + '"]');
  assert(r, 'a row for ' + n);
  r.querySelector('.mine-del').click();
  assert(pumpUntil(() => !document.querySelector('#mint-rows .ctl[data-key="' + n + '"]'), 30000),
         n + ' left the panel');
});
assert(ctx.mintedNames().length === 0, 'both minted axes are gone');
assert(document.querySelectorAll('.deck-chip').length === 0, 'and off the deck');

const after = render('after the axes were dropped');
assert(mse(base, after) < 1e-6, 'dropping a runtime axis leaves the baseline untouched');

console.log('PASS — an axis minted here behaves as a bank axis and comes off cleanly');
