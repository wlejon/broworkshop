// Several painted regions at once, each with its own settings, in one render.
//
//   CUDA_VISIBLE_DEVICES=0 bro-headless ../broworkshop/demos/qwen-image-lab tests/test_spatial.js
//
// Two claims, and they are about two different routes into the model.
//
// A region's GATE MULTIPLIER is a per-token mask — the model's only spatial
// hook. The binding keeps a list of them, so N regions are N masks in ONE
// render: two regions pulling opposite ways have to change their own halves of
// the frame and leave the band between them comparatively alone, at no extra
// pass.
//
// A region's AXIS is conditioning, which is global by construction: one axis
// is added to every token row, so "this axis, but only here" cannot be a
// single forward. The worker primes a second state from the same seed, steps
// it in lockstep and blends its latent back under the region's feathered
// weight after every step. That is a real second pass of the DiT, and the test
// asserts the cost as well as the effect — a panel that hid it would be lying
// about what the button does.

function $(id) { return document.getElementById(id); }
function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}
// Mean absolute difference over a pixel box — localisation wants "how much
// changed HERE", not a whole-frame number.
function bandDiff(a, b, x0, y0, x1, y1) {
  let acc = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.width + x) * 4;
      for (let c = 0; c < 3; c++) { acc += Math.abs(a.data[i + c] - b.data[i + c]); n++; }
    }
  }
  return n ? acc / n : 0;
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
$('steps').value = '8'; $('seed').value = '7'; $('guidance').value = '1.0';
$('rand-seed').checked = false;
$('prompt').value = 'a stone cottage beside a mountain lake';
flush();

function spStatusIs(prefix) { return $('sp-status-text').textContent.indexOf(prefix) === 0; }
function waitSp(prefix, budget, what) {
  assert(pumpUntil(() => spStatusIs(prefix) || $('sp-status-text').className === 'err', budget),
         what + ' finished within budget (' + $('sp-status-text').textContent + ')');
  assert($('sp-status-text').className !== 'err',
         what + ' ok: ' + $('sp-status-text').textContent);
}

document.querySelector('.tabbtn[data-tab="spatial"]').click();
document.querySelector('.secbtn[data-sec="spatial"]').click();
flush();
assert($('tab-spatial').classList.contains('active'), 'the spatial tab shows');
assert(ctx.spatialRegions().length === 0, 'no regions before a capture');

// ── capture ───────────────────────────────────────────────────────────────
console.log('capturing the base render…');
ctx.spatialCapture();
waitSp('captured', 300000, 'the capture');
const grid = ctx.spatialGrid();
console.log('token grid ' + grid.wp + '×' + grid.hp);
assert(grid.wp === 32 && grid.hp === 32,
       'a 512² render is a 32×32 token grid (got ' + grid.wp + '×' + grid.hp + ')');
assert(ctx.spatialRegions().length === 1, 'the capture opened a first region');
assert($('sp-hint').style.display === 'none', 'the paint hint stood down');
const base = ctx.spatialBase();
assert(base && base.width === 512, 'the base frame is held for comparison');

// ── two regions, painted as bands, pulling opposite ways ──────────────────
// Left third and right third, with a four-cell gap between them so there is
// an untouched band to measure against.
const A = ctx.spatialRegions()[0];
A.name = 'left';
ctx.spatialSelect(A.id);
let n = ctx.spatialPaintCells(0, 0, 12, 32);
console.log('region A painted ' + n + ' tokens');
assert(n === 12 * 32, 'the left band is painted (' + n + ' tokens)');

const B = ctx.spatialAdd('right');
n = ctx.spatialPaintCells(20, 0, 32, 32);
assert(n === 12 * 32, 'the right band is painted too (' + n + ' tokens)');
assert(ctx.spatialRegions().length === 2, 'two regions now');
assert($('sp-count').textContent.indexOf('2 region') === 0,
       'the rail counts them: ' + $('sp-count').textContent);

// A cell belongs to one region — painting into it takes it off the others.
const overlap = (() => {
  let k = 0;
  for (let i = 0; i < A.coverage.length; i++) if (A.coverage[i] && B.coverage[i]) k++;
  return k;
})();
assert(overlap === 0, 'the two regions share no token (' + overlap + ')');

A.amount = 1.45; B.amount = 0.55;
A.at = 2; B.at = 2;
A.lo = 16; A.hi = 32; B.lo = 16; B.hi = 32;
A.which = 'attn'; B.which = 'attn';
ctx.spatialSelect(A.id);
flush();

let msg = ctx.buildGenerateMsg();
assert(msg.regions && msg.regions.length === 2, 'both regions ride in the generate message');
assert(msg.regions[0].cells.length === 32 * 32, 'each carries a cell a token');
assert(!msg.regions[0].axes && !msg.regions[1].axes, 'neither asks for an axis yet');
const chips = [];
document.querySelectorAll('.deck-chip').forEach((c) => chips.push(c.textContent));
assert(chips.join('|').indexOf('region') >= 0, 'the rack wears a deck chip: ' + chips.join(' | '));

console.log('rendering two gate-only regions…');
let t0 = Date.now();
ctx.spatialRender();
waitSp('done', 300000, 'the two-region render');
const msGate = Date.now() - t0;
const two = ctx.spatialResult();
assert(two, 'the result canvas holds a frame');
console.log('two gate regions · ' + (msGate / 1000).toFixed(2) + ' s · ' +
            $('sp-timing').textContent);
assert($('sp-timing').textContent.indexOf('states') < 0,
       'a gate-only rack is one render, and the timing says so: ' + $('sp-timing').textContent);

// left band (x < 192), gap (x 200..320), right band (x > 320)
const dLeft = bandDiff(base, two, 0, 0, 180, 512);
const dGap = bandDiff(base, two, 204, 0, 308, 512);
const dRight = bandDiff(base, two, 332, 0, 512, 512);
console.log('gate regions · left ' + dLeft.toFixed(2) + ' · gap ' + dGap.toFixed(2) +
            ' · right ' + dRight.toFixed(2));
assert(dLeft > 1.5, 'the left region changed its own band (' + dLeft.toFixed(2) + ')');
assert(dRight > 1.5, 'the right region changed its own band (' + dRight.toFixed(2) + ')');
assert(dGap < 0.6 * Math.min(dLeft, dRight),
       'and the untouched band between them moved less than either (' + dGap.toFixed(2) +
       ' < 0.6 × ' + Math.min(dLeft, dRight).toFixed(2) + ')');

// ── the two regions really are carrying different settings ────────────────
// Swap them and the frame has to change: if `which`/`amount` were being read
// once for the whole rack, a swap would be a no-op.
A.amount = 0.55; B.amount = 1.45;
flush();
console.log('swapping the two multipliers…');
ctx.spatialRender();
waitSp('done', 300000, 'the swapped render');
const swapped = ctx.spatialResult();
const dSwap = bandDiff(two, swapped, 0, 0, 512, 512);
console.log('swapped vs original: mean |Δ| ' + dSwap.toFixed(2));
assert(dSwap > 1, 'each region carries its own settings (' + dSwap.toFixed(2) + ')');
A.amount = 1.45; B.amount = 0.55;
flush();

// ── a region with an axis of its own ──────────────────────────────────────
// This is the expensive half: conditioning is global, so the worker primes a
// second state and blends it back under the region weight every step.
const AXIS = 'light.key';
ctx.spatialSelect(A.id);
$('sp-axis').value = AXIS;
$('sp-axis').dispatchEvent(new Event('change'));
A.axisAmount = 4;
flush();
assert(A.axis === AXIS, 'region A carries ' + AXIS);
msg = ctx.buildGenerateMsg();
assert(msg.regions[0].axes && msg.regions[0].axes[AXIS] === 4,
       'the axis rides on the region, not on the render');
assert(!msg.regions[1].axes, 'and only on that region');

console.log('rendering with a per-region axis — a second lockstep state…');
t0 = Date.now();
ctx.spatialRender();
waitSp('done', 300000, 'the composited render');
const msAxis = Date.now() - t0;
const axed = ctx.spatialResult();
console.log('with a region axis · ' + (msAxis / 1000).toFixed(2) + ' s · ' +
            $('sp-timing').textContent + ' (gate-only was ' + (msGate / 1000).toFixed(2) + ' s)');
assert($('sp-timing').textContent.indexOf('2 states') >= 0,
       'the panel reports the second state: ' + $('sp-timing').textContent);
assert(msAxis > 1.4 * msGate,
       'and it costs a second pass of the DiT rather than being free (' +
       (msAxis / msGate).toFixed(2) + '× the gate-only render)');

const aLeft = bandDiff(two, axed, 0, 0, 180, 512);
const aGap = bandDiff(two, axed, 204, 0, 308, 512);
const aRight = bandDiff(two, axed, 332, 0, 512, 512);
console.log('region axis · left ' + aLeft.toFixed(2) + ' · gap ' + aGap.toFixed(2) +
            ' · right ' + aRight.toFixed(2));
assert(aLeft > 2, 'the axis landed in its own region (' + aLeft.toFixed(2) + ')');
assert(aLeft > 1.5 * aRight,
       'and it landed THERE rather than across the frame, which is the whole point of ' +
       'compositing a global control (' + aLeft.toFixed(2) + ' vs ' + aRight.toFixed(2) + ')');

// ── feather ───────────────────────────────────────────────────────────────
// The blend weight is feathered past the painted edge, so the join is a fade
// rather than a stamped rectangle. Turning it off has to change the seam.
A.feather = 0;
flush();
ctx.spatialRender();
waitSp('done', 300000, 'the unfeathered render');
const hard = ctx.spatialResult();
const seam = bandDiff(axed, hard, 176, 0, 224, 512);
const far = bandDiff(axed, hard, 0, 0, 96, 512);
console.log('feather off · at the seam ' + seam.toFixed(2) + ' · deep inside ' + far.toFixed(2));
assert(seam > 0.3, 'the feather setting is felt at the seam (' + seam.toFixed(2) + ')');
A.feather = 1;
flush();

// ── taking it off ─────────────────────────────────────────────────────────
$('sp-axis').value = '';
$('sp-axis').dispatchEvent(new Event('change'));
flush();
assert(!A.axis, 'the axis came off the region');
msg = ctx.buildGenerateMsg();
assert(msg.regions.every((r) => !r.axes), 'and out of the message');

$('btn-sp-wipe').click();
flush();
assert(ctx.spatialRegions()[0].coverage.every((v) => !v), 'wiping clears the selected region only');
assert(ctx.spatialRegions()[1].coverage.some((v) => v), 'the other region kept its paint');

$('btn-sp-clear').click();
flush();
assert(ctx.spatialRegions().length === 0, 'clearing drops every region');
msg = ctx.buildGenerateMsg();
assert(!msg.regions, 'and the message carries none');
assert(document.querySelectorAll('.deck-chip').length === 0, 'the deck is empty again');

console.log('PASS — several regions in one render, and a per-region axis composited at the ' +
            'cost it announces');
