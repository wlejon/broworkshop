// The gate capture readout: the effective gates read off the model after a
// render, as four strips of 32 blocks.
//
//   CUDA_VISIBLE_DEVICES=0 bro-headless ../broworkshop/demos/qwen-image-lab tests/test_capture.js
//
// qwenImage21CaptureGates fills two sinks — the mean effective ATTENTION gate
// and the mean effective SwiGLU gate per (block, row) — folded through every
// armed scale, post-tanh delta and mask. The strip is worth having only if it
// answers the question you actually ask of it: did the hook land on the blocks
// I aimed it at, and on the sublayer I aimed it at?
//
// So the test arms a multiplier over the second half of the stack and requires
// the readout to show it there and nowhere else: attn·img halves over blocks
// 16..31, attn·img over 0..15 does not move, attn·txt does not move, and the
// SwiGLU strip does not move. Then it does the same on the mlp side, which is
// what the second sink was added to brodiffusion for — before it, the panel
// could not see a SwiGLU edit at all.

function $(id) { return document.getElementById(id); }
function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

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
  console.log(what + ' · ' + ((Date.now() - t0) / 1000).toFixed(2) + ' s');
  return ctx.lastGates();
}
// The four multipliers are keyed controls; the block band is a modifier on
// them and carries an id only, since it builds no deck chip of its own.
function gateRow(id, v) {
  const r = document.querySelector('.ctl[data-key="' + id + '"] input[type=range]') || $(id);
  assert(r, 'the gate panel has a row for ' + id);
  r.value = String(v); r.dispatchEvent(new Event('input'));
  flush();
}
function band(g, key, lo, hi) {
  return g.slice(lo, hi).map((b) => b[key]);
}

document.querySelector('.tabbtn[data-tab="signals"]').click();
document.querySelector('.secbtn[data-sec="gate"]').click();
flush();
assert(ctx.lastGates() === null, 'no capture before a render');
assert($('sig-gates').textContent.indexOf('capture gates') >= 0,
       'the strip says what would fill it: ' + $('sig-gates').textContent);

// ── an untouched render ───────────────────────────────────────────────────
ctx.setSignals(true, false);
flush();
let msg = ctx.buildGenerateMsg();
assert(msg.captureGates, 'the capture is asked for in the generate message');

const base = render('baseline · capture on, nothing armed');
assert(base, 'the capture came back');
console.log($('sig-gates-legend').textContent);
assert(base.attn.length === 32, '32 blocks of attention gate (got ' + base.attn.length + ')');
assert(base.mlp.length === 32, '32 blocks of SwiGLU gate (got ' + base.mlp.length + ')');
assert(base.cols === base.prefix + base.imgLen,
       'the capture is one column a row: ' + base.prefix + ' prefix + ' + base.imgLen +
       ' image = ' + base.cols);
assert(base.imgLen === 32 * 32, 'a 512² render is 1024 image rows (' + base.imgLen + ')');
assert(document.querySelectorAll('#sig-gates .gate-strip-row').length === 4,
       'four strips: each sublayer against each row class');
assert(document.querySelectorAll('#sig-gates .gate-strip-row')[0]
         .querySelectorAll('.gate-cell').length === 32, 'one cell a block');
assert($('sig-gates-legend').textContent.indexOf('32 blocks') === 0,
       'the legend says what is on screen: ' + $('sig-gates-legend').textContent);

const baseAttnImg = base.attn.map((b) => b.img);
const baseAttnTxt = base.attn.map((b) => b.prefix);
const baseMlpImg = base.mlp.map((b) => b.img);
console.log('untouched · attn·img ' + Math.min.apply(null, baseAttnImg).toFixed(4) + ' … ' +
            Math.max.apply(null, baseAttnImg).toFixed(4) +
            ' · attn·txt ' + Math.min.apply(null, baseAttnTxt).toFixed(4) + ' … ' +
            Math.max.apply(null, baseAttnTxt).toFixed(4) +
            ' · mlp·img ' + Math.min.apply(null, baseMlpImg).toFixed(4) + ' … ' +
            Math.max.apply(null, baseMlpImg).toFixed(4));
assert(baseAttnImg.every((v) => v !== 0), 'every block reported a gate');
assert(Math.max.apply(null, baseAttnImg) - Math.min.apply(null, baseAttnImg) < 1e-4,
       'with nothing armed all 32 blocks report the same number, because one modulation ' +
       'vector drives the whole stack — the strip is a picture of what an armed hook did, ' +
       'not of per-block structure');
assert(base.attn[0].imgMin <= base.attn[0].img,
       'the strip also carries the lowest single image row, which is where a mask shows up ' +
       'before it shows up in a mean');

// ── an attention multiplier over the second half of the stack ─────────────
gateRow('gate-lo', 16);
gateRow('gate-hi', 32);
gateRow('gate-attn-img', 0.5);
flush();
msg = ctx.buildGenerateMsg();
assert(msg.gateRows && msg.gateRows.lo === 16 && msg.gateRows.hi === 32,
       'the band rides with the multiplier');

const halved = render('attn · img rows ×0.5 over blocks [16, 32)');
const loRatio = mean(band(halved.attn, 'img', 0, 16)) / mean(band(base.attn, 'img', 0, 16));
const hiRatio = mean(band(halved.attn, 'img', 16, 32)) / mean(band(base.attn, 'img', 16, 32));
const txtRatio = mean(band(halved.attn, 'prefix', 16, 32)) / mean(band(base.attn, 'prefix', 16, 32));
const mlpRatio = mean(band(halved.mlp, 'img', 16, 32)) / mean(band(base.mlp, 'img', 16, 32));
console.log('attn·img ×0.5 over [16,32) · blocks 0-15 ×' + loRatio.toFixed(3) +
            ' · blocks 16-31 ×' + hiRatio.toFixed(3) +
            ' · attn·txt 16-31 ×' + txtRatio.toFixed(3) +
            ' · mlp·img 16-31 ×' + mlpRatio.toFixed(3));
assert(hiRatio > 0.35 && hiRatio < 0.65,
       'the readout shows the halving where it was aimed (×' + hiRatio.toFixed(3) + ')');
assert(Math.abs(loRatio - 1) < 0.05,
       'and not in the blocks below the band (×' + loRatio.toFixed(3) + ')');
assert(Math.abs(txtRatio - 1) < 0.05,
       'nor on the text rows, which the dial did not name (×' + txtRatio.toFixed(3) + ')');
assert(Math.abs(mlpRatio - 1) < 0.15,
       'nor on the SwiGLU gate, which is a different sublayer (×' + mlpRatio.toFixed(3) + ')');

// ── the same thing on the SwiGLU side ─────────────────────────────────────
// The second sink exists for this: before it, qwenImage21Gates reported the
// attention gate only and a mlp edit was invisible to the panel.
gateRow('gate-attn-img', 1);
gateRow('gate-mlp-img', 0.5);
flush();
const mlpHalved = render('mlp · img rows ×0.5 over blocks [16, 32)');
const mHi = mean(band(mlpHalved.mlp, 'img', 16, 32)) / mean(band(base.mlp, 'img', 16, 32));
const mLo = mean(band(mlpHalved.mlp, 'img', 0, 16)) / mean(band(base.mlp, 'img', 0, 16));
const mAttn = mean(band(mlpHalved.attn, 'img', 16, 32)) / mean(band(base.attn, 'img', 16, 32));
console.log('mlp·img ×0.5 over [16,32) · blocks 0-15 ×' + mLo.toFixed(3) +
            ' · blocks 16-31 ×' + mHi.toFixed(3) + ' · attn·img 16-31 ×' + mAttn.toFixed(3));
assert(mHi > 0.35 && mHi < 0.65,
       'the SwiGLU strip shows its own halving (×' + mHi.toFixed(3) + ')');
assert(Math.abs(mLo - 1) < 0.05, 'in its own band only (×' + mLo.toFixed(3) + ')');
assert(Math.abs(mAttn - 1) < 0.15,
       'and the attention strip is not standing in for it (×' + mAttn.toFixed(3) + ')');

// ── a painted mask shows up in the minimum before the mean ────────────────
gateRow('gate-mlp-img', 1);
flush();
document.querySelector('.tabbtn[data-tab="gate"]').click();
flush();
const painted = ctx.gateCells ? true : false;
assert(painted, 'the gate paint panel exposes its cells');
$('btn-gp-capture').click();
assert(pumpUntil(() => $('gp-status-text').textContent.indexOf('captured') === 0 ||
                       $('gp-status-text').className === 'err', 300000),
       'the paint base captured: ' + $('gp-status-text').textContent);
// The brush defaults to 1.30 — more texture. Pull it down instead, so the
// painted rows have to appear BELOW everything else in the readout.
$('gp-amount').value = '0.4';
$('gp-amount').dispatchEvent(new Event('input'));
flush();
const rect = $('gp-paint').getBoundingClientRect();
mouseDown(rect.x + rect.width / 2, rect.y + rect.height / 2);
for (let i = -2; i <= 2; i++) mouseMove(rect.x + rect.width / 2 + i * 6,
                                        rect.y + rect.height / 2 + i * 6);
mouseUp(rect.x + rect.width / 2, rect.y + rect.height / 2);
flush();
assert(pumpUntil(() => !ctx.busy, 300000), 'the masked render settled');
const cells = ctx.gateCells();
const nPainted = cells.filter((v) => v !== 1).length;
console.log('painted ' + nPainted + ' of ' + cells.length + ' tokens');
assert(nPainted > 10, 'the stroke painted something (' + nPainted + ')');

document.querySelector('.tabbtn[data-tab="signals"]').click();
flush();
const masked = render('with the painted mask armed');
const maskedMean = mean(band(masked.attn, 'img', 16, 32));
const baseMean = mean(band(base.attn, 'img', 16, 32));
const maskedMin = Math.min.apply(null, band(masked.attn, 'imgMin', 16, 32));
const baseMin = Math.min.apply(null, band(base.attn, 'imgMin', 16, 32));
console.log('mask armed · mean over the image rows ' + baseMean.toFixed(4) + ' → ' +
            maskedMean.toFixed(4) + ' (×' + (maskedMean / baseMean).toFixed(3) + ') · ' +
            'lowest single row ' + baseMin.toFixed(4) + ' → ' + maskedMin.toFixed(4) +
            ' (×' + (maskedMin / baseMin).toFixed(3) + ')');
assert(maskedMin < baseMin * 0.6,
       'the lowest single row falls to about the brush setting — a mask that touches ' +
       nPainted + ' of ' + cells.length + ' tokens is visible there first (×' +
       (maskedMin / baseMin).toFixed(3) + ')');
assert(maskedMin / baseMin < maskedMean / baseMean - 0.2,
       'and it falls much further than the mean does, which is why the legend prints it (' +
       (maskedMin / baseMin).toFixed(3) + ' vs ' + (maskedMean / baseMean).toFixed(3) + ')');
assert($('sig-gates-legend').textContent.indexOf('lowest single attn·img row') > 0,
       'the legend names it: ' + $('sig-gates-legend').textContent);

// ── off again ─────────────────────────────────────────────────────────────
// The brush amount and the block band are remembered between sessions, so put
// them back: a test that leaves the app somewhere else breaks the next one.
$('btn-gp-clear').click();
$('gp-amount').value = '1.3';
$('gp-amount').dispatchEvent(new Event('input'));
gateRow('gate-lo', 0);
gateRow('gate-hi', 32);
ctx.setSignals(false, false);
flush();
msg = ctx.buildGenerateMsg();
assert(!msg.captureGates, 'the capture is off');

console.log('PASS — the strip shows an armed hook on the blocks, sublayer and rows it named');
