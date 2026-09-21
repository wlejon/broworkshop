// The per-token gate mask, painted through the real UI: capture, stroke the
// render with simulated mouse input, and assert the effect is LOCAL to the
// stroke.
//
//   CUDA_VISIBLE_DEVICES=0 bro-headless ../broworkshop/demos/qwen-image-lab tests/test_gate.js
//
// The mask addresses the joint sequence — text rows first, then image tokens
// row-major, one row per 16x16 px — and a mask of the wrong length now throws
// instead of being skipped, which is what makes this measurable at all. The
// defaults under test are the screened ones: blocks [16, 32), armed at step 4
// of 8, on the attention sublayer.

function $(id) { return document.getElementById(id); }
function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}
function regionDiff(a, b, x0, y0, x1, y1) {
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.width + x) * 4;
      sum += Math.abs(a.data[i] - b.data[i]) +
             Math.abs(a.data[i + 1] - b.data[i + 1]) +
             Math.abs(a.data[i + 2] - b.data[i + 2]);
      n++;
    }
  }
  return n ? sum / n / 3 : 0;
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
$('steps').value = '8'; $('seed').value = '7'; $('guidance').value = '1.0';
$('rand-seed').checked = false;
$('prompt').value = 'a stone cottage beside a mountain lake';
flush();

// ── the Gate Paint tab ────────────────────────────────────────────────────
document.querySelector('.tabbtn[data-tab="gate"]').click();
flush();
assert($('tab-gate').classList.contains('active'), 'the gate tab shows');
assert(!$('btn-gp-capture').disabled, 'capture is live once a model is loaded');
assert($('gp-which').value === 'attn',
       'the sublayer defaults to attn — the half a late edit survives');
assert(+$('gp-at').value === 4, 'the brush arms at step 4 by default');

function gpStatusIs(prefix) { return $('gp-status-text').textContent.indexOf(prefix) === 0; }
function waitGp(prefix, budgetMs, what) {
  assert(pumpUntil(() => gpStatusIs(prefix) || $('gp-status-text').className === 'err', budgetMs),
         what + ' finished within budget (status: ' + $('gp-status-text').textContent + ')');
  assert($('gp-status-text').className !== 'err',
         what + ' ok: ' + $('gp-status-text').textContent);
}

console.log('capturing the base render…');
$('btn-gp-capture').click();
waitGp('captured', 300000, 'capture');
assert($('gp-hint').style.display === 'none', 'the capture hint is gone');
assert($('gp-paint').width === 512 && $('gp-base').width === 512,
       'the paint canvases are sized to the render');
const grid = window.__ctx.gateGrid();
assert(grid.wp === 32 && grid.hp === 32,
       'a 512² render is a 32x32 token grid (got ' + grid.wp + 'x' + grid.hp + ')');

// ── stroke the middle of the frame ────────────────────────────────────────
const rect = $('gp-paint').getBoundingClientRect();
const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
mouseDown(cx, cy);
for (let i = -3; i <= 3; i++) mouseMove(cx + i * 6, cy + (i % 2) * 6);
mouseUp(cx, cy);
flush();
const painted = (() => {
  const cells = window.__ctx.gateCells();
  let n = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] !== 1) n++;
  return n;
})();
console.log('painted ' + painted + ' of ' + (grid.wp * grid.hp) + ' tokens');
assert(painted > 20 && painted < grid.wp * grid.hp * 0.45,
       'the stroke painted a region, not the frame (' + painted + ' tokens)');
let chips = [];
document.querySelectorAll('.deck-chip').forEach((c) => chips.push(c.textContent));
assert(chips.join('|').indexOf('mask') >= 0, 'the mask wears a deck chip: ' + chips.join(' | '));

console.log('stroke released — waiting for the masked render…');
waitGp('done', 300000, 'the masked render');

const base = $('gp-base').getContext('2d').getImageData(0, 0, 512, 512);
const out = $('gp-result').getContext('2d').getImageData(0, 0, 512, 512);

// the stroke sits in the middle ~128px; the frame's top and bottom bands are
// outside it by four token rows or more
const inner = regionDiff(base, out, 176, 176, 336, 336);
const border = (regionDiff(base, out, 0, 0, 512, 48) +
                regionDiff(base, out, 0, 464, 512, 512)) / 2;
console.log('stroke-region diff ' + inner.toFixed(2) + ' · border diff ' + border.toFixed(2) +
            ' · ratio ' + (border > 0 ? (inner / border).toFixed(2) : '∞'));
assert(inner > 1.5, 'the mask changed its own region (mean diff ' + inner.toFixed(2) + ')');
assert(border < inner * 0.6,
       'the effect stayed local (border ' + border.toFixed(2) + ' < 0.6 × ' + inner.toFixed(2) + ')');

// ── the sublayer selector reaches the worker ──────────────────────────────
console.log('switching the mask to both sublayers…');
$('gp-which').value = 'both';
$('gp-which').dispatchEvent(new Event('change'));
waitGp('done', 300000, 'the both-sublayer render');
const both = $('gp-result').getContext('2d').getImageData(0, 0, 512, 512);
const dWhich = regionDiff(out, both, 176, 176, 336, 336);
console.log('attn vs both, inside the stroke: ' + dWhich.toFixed(2));
assert(dWhich > 0.5, 'the sublayer selector changes the render (diff ' + dWhich.toFixed(2) + ')');
$('gp-which').value = 'attn';

// ── clearing the paint takes the mask off the deck ────────────────────────
$('btn-gp-clear').click();
flush();
assert(document.querySelectorAll('.deck-chip').length === 0, 'clearing the paint emptied the deck');
const msg = window.__ctx.buildGenerateMsg();
assert(!msg.gateMask, 'a cleared mask is absent from the generate message');

console.log('PASS — the gate mask paints, localises, and comes off cleanly');
