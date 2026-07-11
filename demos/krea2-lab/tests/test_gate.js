// Gate-paint test: load the real checkpoint and drive the redesigned tab
// through the ACTUAL UI — capture, stroke the paint canvas with simulated
// mouse input (auto-applies on release), read the result through the wipe
// divider, assert the effect is LOCAL to the stroke (the probe-validated
// mid-band default), then sweep strengths and switch depth bands.
//
//   bro-headless ../broworkshop/demos/krea2-lab tests/test_gate.js

function $(id) { return document.getElementById(id); }

function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}

console.log('waiting for the model to load…');
assert(pumpUntil(() => !$('btn-generate').disabled ||
                       $('status-text').classList.contains('err'), 600000),
       'model load finished within budget');
assert(!$('status-text').classList.contains('err'),
       'model loaded without error: ' + $('status-text').textContent);

// Neutralize persisted control state so the fixed-seed renders are pure.
$('live').checked = false;
$('live').dispatchEvent(new Event('change'));
['btn-reset-expr', 'btn-reset-spec', 'btn-reset-mouth', 'btn-reset-axes']
  .forEach((id) => { const b = $(id); if (b) b.click(); });
[['band', '1.0'], ['dial-pregate', '1.0'], ['dial-prescale', '1.0'],
 ['gate-txt', '1.0'], ['gate-img', '1.0']].forEach(([id, v]) => {
  $(id).value = v; $(id).dispatchEvent(new Event('input'));
});

$('prompt').value = 'a studio portrait of a woman with shoulder-length brown hair looking at the camera, plain gray background, soft light';
$('neg-prompt').value = '';
$('width').value = '512';
$('height').value = '512';
$('steps').value = '8';
$('seed').value = '7';
$('guidance').value = '1.0';
$('rand-seed').checked = false;

// ── the gate tab ──────────────────────────────────────────────────────────
document.querySelector('.tabbtn[data-tab="gate"]').click();
flush();
assert($('tab-gate').classList.contains('active'), 'gate tab shows');
assert(!$('btn-gate-capture').disabled, 'capture enabled once loaded');
assert($('btn-gate-sweep').disabled, 'sweep disabled before any paint');
assert($('gate-band').value === 'mid', 'depth defaults to the graceful mid band');
assert(+$('gate-brush-target').min >= 0.4,
       'brush range keeps clear of the starvation cliff (min ' + $('gate-brush-target').min + ')');

function gateStatusIs(prefix) {
  return $('gate-status-text').textContent.indexOf(prefix) === 0;
}
function waitStatus(prefix, budgetMs, what) {
  assert(pumpUntil(() => gateStatusIs(prefix) ||
                         $('gate-status-text').className === 'err', budgetMs),
         what + ' finished within budget (status: ' + $('gate-status-text').textContent + ')');
  assert($('gate-status-text').className !== 'err',
         what + ' ok: ' + $('gate-status-text').textContent);
}

console.log('capturing…');
$('btn-gate-capture').click();
waitStatus('captured', 180000, 'capture');
assert($('gate-hint').style.display === 'none', 'capture hint gone');
assert($('gate-paint').width === 512 && $('gate-paint').height === 512,
       'paint canvas sized to the render');

// ── stroke the face (canvas center) with simulated mouse input ───────────
const rect = $('gate-paint').getBoundingClientRect();
const cx = rect.x + rect.width / 2, cy = rect.y + rect.height * 0.35;
mouseDown(cx, cy);
for (let i = 0; i <= 8; i++) mouseMove(cx - 40 + i * 10, cy + (i % 2) * 12);
mouseUp(cx + 40, cy);
flush();
console.log('stroke released — waiting for the auto-applied render…');
waitStatus('done', 180000, 'auto-apply');
assert(!$('btn-gate-sweep').disabled, 'sweep enabled once painted');
assert($('gate-result-hint').style.display === 'none', 'result hint gone');

// ── read base and painted renders through the wipe divider ───────────────
const resRect = () => $('gate-result').getBoundingClientRect();
function wipeTo(frac) {
  const r = resRect();
  const x = r.x + Math.max(1, Math.min(r.width - 1, frac * r.width));
  mouseDown(x, r.y + r.height / 2);
  mouseUp(x, r.y + r.height / 2);
  flush();
}
function grabResult() {
  return $('gate-result').getContext('2d').getImageData(0, 0, 512, 512);
}
wipeTo(0.999);                     // divider hard right → full base visible
const baseImg = grabResult();
wipeTo(0.001);                     // divider hard left → full painted render
const paintImg = grabResult();

function regionDiff(a, b, x0, y0, x1, y1) {
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * 512 + x) * 4;
      sum += Math.abs(a.data[i] - b.data[i]) +
             Math.abs(a.data[i + 1] - b.data[i + 1]) +
             Math.abs(a.data[i + 2] - b.data[i + 2]);
      n++;
    }
  }
  return sum / n / 3;
}
// stroke centered at (256, 179) with a ~3-token brush → generous inner box,
// and a frame border that should stay near-untouched in the mid band
const inner = regionDiff(baseImg, paintImg, 176, 100, 336, 260);
const border = (regionDiff(baseImg, paintImg, 0, 0, 512, 40) +
                regionDiff(baseImg, paintImg, 0, 472, 512, 512)) / 2;
console.log('stroke-region diff ' + inner.toFixed(2) + ' · border diff ' + border.toFixed(2));
assert(inner > 5, 'the stroke changed its region (mean diff ' + inner.toFixed(2) + ' > 5)');
assert(border < inner * 0.5,
       'the effect stayed local (border ' + border.toFixed(2) + ' < half of ' + inner.toFixed(2) + ')');

// ── depth band reaches the worker: switching re-renders differently ──────
console.log('switching depth to all blocks…');
$('gate-band').value = 'all';
$('gate-band').dispatchEvent(new Event('change'));
waitStatus('done', 180000, 'band re-apply');
wipeTo(0.001);
const allImg = grabResult();
const dBand = regionDiff(paintImg, allImg, 176, 100, 336, 260);
console.log('mid-band vs all-blocks stroke-region diff ' + dBand.toFixed(2));
assert(dBand > 2, 'the depth band changes the render (mean diff ' + dBand.toFixed(2) + ' > 2)');
$('gate-band').value = 'mid';
$('gate-band').dispatchEvent(new Event('change'));
waitStatus('done', 180000, 'band restore');

// ── dose strip: 5 strengths, click one to adopt it ────────────────────────
console.log('sweeping strength — 5 renders…');
$('btn-gate-sweep').click();
waitStatus('sweep done', 600000, 'sweep');
const cells = document.querySelectorAll('#gate-strip .strip-cell');
assert(cells.length === 5, 'five sweep frames (got ' + cells.length + ')');
cells[1].dispatchEvent(new Event('click'));
flush();
assert(gateStatusIs('kept ×0.5'), 'clicking a frame adopts its strength: ' +
       $('gate-status-text').textContent);

// clear leaves a clean slate
$('btn-gate-clear').click();
flush();
assert($('btn-gate-sweep').disabled, 'clear returned the mask to neutral');
assert(document.querySelectorAll('#gate-strip .strip-cell').length === 0, 'strip cleared');

console.log('PASS: gate paint captures, strokes locally, sweeps, and honors the depth band');
