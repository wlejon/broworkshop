// The explore grid and the 1-D walk.
//
//   CUDA_VISIBLE_DEVICES=0 bro-headless ../broworkshop/demos/qwen-image-lab tests/test_explore.js
//
// A grid is not a special render path: every cell is the message the Generate
// button would send, with one or two control values overridden and the size
// cut down. That is the claim worth asserting, because it is what makes
// "adopt this cell" honest — so the test adopts a walk frame's value, renders
// it through the ordinary path at the same size and step count, and requires
// the two to match to the pixel.
//
// The walk carries round 3's collapse bar. Travel is NOT monotone in amplitude
// past a fader's calibrated edge: push harder and the picture swaps rather
// than the axis moving, and the CLIP probes that certified the round-2 desk
// could not see it happen. A retention number under every frame can, and the
// strip marks everything under 0.71.

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
const PX = 256, STEPS = 4;

$('live').checked = false; $('live').dispatchEvent(new Event('change'));
$('btn-deck-clear').click();
$('btn-cond-clear').click();
$('width').value = String(PX); $('height').value = String(PX);
$('steps').value = String(STEPS); $('seed').value = '7'; $('guidance').value = '1.0';
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
function axisRow(name) {
  const row = document.querySelector('#axis-categories .ctl[data-key="' + name + '"]');
  assert(row, 'the bank has a row for ' + name);
  return row.querySelector('input[type=range]');
}
function setAxis(name, v) {
  const r = axisRow(name);
  r.value = String(v); r.dispatchEvent(new Event('input'));
  flush();
}
function waitIdle(budget) { return pumpUntil(() => !ctx.busy, budget || 600000); }

const ROW = 'light.key', COL = 'gate-attn-img';

document.querySelector('.tabbtn[data-tab="explore"]').click();
flush();
assert($('tab-explore').classList.contains('active'), 'the explore tab shows');
assert($('btn-ex-stop').disabled, 'stop is dark while nothing is running');

// ── the pickers offer armed controls first ────────────────────────────────
setAxis(ROW, 1);
flush();
const first = $('ex-row').options[0];
console.log('first offered row control: ' + first.textContent);
assert(first.textContent.indexOf('●') === 0,
       'an armed control is offered first, marked (' + first.textContent + ')');
assert(first.value === ROW, 'and it is the one that is armed (' + first.value + ')');
setAxis(ROW, 0);
flush();

// ── a 2×2 grid over two controls ──────────────────────────────────────────
ctx.explorePick(ROW, COL);
$('ex-n').value = '2';
$('ex-size').value = String(PX);
$('ex-steps').value = String(STEPS);
$('ex-row-lo').value = '-2'; $('ex-row-hi').value = '2';
$('ex-col-lo').value = '0.7'; $('ex-col-hi').value = '1.3';
['ex-n', 'ex-size', 'ex-steps'].forEach((id) => $(id).dispatchEvent(new Event('change')));
flush();
assert($('ex-row').value === ROW && $('ex-col').value === COL,
       'both axes of the grid are chosen');

console.log('rendering a 2×2 grid over ' + ROW + ' × ' + COL + ' at ' + PX + '²/' + STEPS + '…');
let t0 = Date.now();
ctx.exploreGrid();
assert(pumpUntil(() => ctx.exploreCells().length >= 4 || $('ex-status').className === 'err',
                 600000),
       'the grid finished: ' + $('ex-status').textContent);
assert($('ex-status').className !== 'err', 'without error: ' + $('ex-status').textContent);
const cells = ctx.exploreCells();
console.log('grid · ' + cells.length + ' cells in ' + ((Date.now() - t0) / 1000).toFixed(1) +
            ' s · ' + $('ex-timing').textContent + ' · ' + $('ex-status').textContent);
assert(cells.length === 4, 'four cells (got ' + cells.length + ')');
assert($('ex-hint').style.display === 'none', 'the hint stood down');
const labels = cells.map((c) => c.querySelector('.ex-label').textContent);
console.log('cell labels: ' + labels.join(' | '));
assert(labels[0] === '-2.00 · 0.70', 'the first cell is the low corner (' + labels[0] + ')');
assert(labels[3] === '2.00 · 1.30', 'the last is the high corner (' + labels[3] + ')');
assert($('ex-timing').textContent.indexOf('ms / cell') > 0,
       'the timing is per cell: ' + $('ex-timing').textContent);

// the corners are different pictures — the grid is spanning something
function cellPixels(cell) {
  const cv = cell.querySelector('canvas');
  return cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
}
const dCorner = mse(cellPixels(cells[0]), cellPixels(cells[3]));
console.log('low corner vs high corner: mse ' + dCorner.toFixed(1));
assert(dCorner > 20, 'the two corners are different pictures (' + dCorner.toFixed(1) + ')');

// ── adopting a cell writes both controls ──────────────────────────────────
assert(+axisRow(ROW).value === 0, 'the axis is at zero before adopting');
cells[3].click();
flush();
console.log('adopted: ' + $('ex-status').textContent);
assert(+axisRow(ROW).value === 2, 'adopting set the row control (' + axisRow(ROW).value + ')');
const colRange = document.querySelector('.ctl[data-key="' + COL + '"] input[type=range]');
assert(Math.abs(+colRange.value - 1.3) < 1e-6,
       'and the column control (' + colRange.value + ')');
assert(cells[3].classList.contains('pick'), 'the adopted cell is marked');
assert(document.querySelectorAll('.deck-chip').length === 2, 'both landed on the deck');
$('btn-deck-clear').click();
flush();

// ── the 1-D walk, with the retention meter ────────────────────────────────
// Swept well past the bank's safe range, because what the strip is for is
// seeing the picture stop being the same picture.
ctx.explorePick(ROW, '');
$('ex-n').value = '2';           // the walk doubles it
$('ex-row-lo').value = '0'; $('ex-row-hi').value = '8';
$('ex-n').dispatchEvent(new Event('change'));
flush();
console.log('walking ' + ROW + ' from 0 to 8 in 4 frames…');
t0 = Date.now();
ctx.exploreWalk();
assert(pumpUntil(() => ctx.exploreFrames().length >= 4 || $('ex-status').className === 'err',
                 600000),
       'the walk finished: ' + $('ex-status').textContent);
const walk = ctx.exploreFrames();
console.log('walk · ' + walk.length + ' frames in ' + ((Date.now() - t0) / 1000).toFixed(1) +
            ' s · ' + $('ex-status').textContent);
assert(walk.length === 4, 'four frames (got ' + walk.length + ')');
assert(walk[0].v === 0 && walk[3].v === 8, 'from 0 to 8 (' +
       walk.map((f) => f.v).join(', ') + ')');
console.log('retention per frame: ' +
            walk.map((f) => f.v.toFixed(2) + ' → ' + f.ret.toFixed(3)).join(' · '));
assert(Math.abs(walk[0].ret - 1) < 1e-9, 'the first frame is the reference (ret ' +
       walk[0].ret.toFixed(3) + ')');
assert(walk[3].ret < walk[0].ret, 'and the picture went somewhere (' +
       walk[3].ret.toFixed(3) + ')');
assert(walk.every((f, i) => i === 0 || f.ret <= walk[i - 1].ret + 1e-6),
       'retention falls monotonically along this sweep (' +
       walk.map((f) => f.ret.toFixed(3)).join(' ≥ ') + ')');

const under = walk.filter((f) => f.ret < 0.71).length;
const marked = document.querySelectorAll('#ex-walk .walk-ret.under').length;
console.log('frames below the 0.71 bar: ' + under);
assert(marked === under, 'every collapsed frame is marked in the strip (' + marked + ' of ' +
       under + ')');
assert($('ex-status').textContent.indexOf(under + ' below the 0.71 bar') > 0,
       'and the status counts them: ' + $('ex-status').textContent);
assert(under > 0,
       ROW + ' pushed to +8 leaves the picture behind — which is exactly what the bar is ' +
       'for (' + walk.map((f) => f.ret.toFixed(3)).join(' ') + ')');

// ── what a frame shows is what adopting it gives you ──────────────────────
// The walk renders at ex-size / ex-steps through the ordinary generate path,
// so adopting a value and pressing Generate at that size has to reproduce the
// frame exactly.
const pickIdx = 2;
const strip = document.querySelectorAll('#ex-walk .walk-cell');
strip[pickIdx].querySelector('canvas').click();
flush();
assert(+axisRow(ROW).value === walk[pickIdx].v,
       'clicking a walk frame adopts its value (' + axisRow(ROW).value + ')');
const adopted = render('the adopted frame, rendered the ordinary way');
const dAdopt = mse(adopted, walk[pickIdx].frame);
console.log('adopted render vs the walk frame it came from: mse ' + dAdopt.toFixed(6));
assert(adopted.width === walk[pickIdx].frame.width, 'at the same size');
assert(dAdopt < 1e-6,
       'a cell is the ordinary render path with one value overridden — adopting it gives ' +
       'back exactly what was on screen (mse ' + dAdopt.toFixed(6) + ')');

setAxis(ROW, 0);
flush();
assert(document.querySelectorAll('.deck-chip').length === 0, 'the deck is clear again');

console.log('PASS — a grid over two controls, a walk with the collapse bar, and adoption ' +
            'that reproduces the thumbnail');
