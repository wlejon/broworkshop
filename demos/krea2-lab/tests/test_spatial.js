// Spatial-paint test: load the real checkpoint and drive the reworked tab
// through the ACTUAL UI — capture the current render, stroke a region with
// simulated mouse input (auto-composites on release), read base vs composite
// through the wipe divider, and assert the axis applied ONLY inside the
// painted region. This is the regression test for the bug where both
// dual-loop states stepped under the same (axis-pushed) conditioning and the
// mask did nothing — the whole frame changed identically.
//
//   bro-headless ../broworkshop/demos/krea2-lab tests/test_spatial.js

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

$('prompt').value = 'a red fox sitting in a snowy forest clearing, morning light';
$('neg-prompt').value = '';
$('width').value = '512';
$('height').value = '512';
$('steps').value = '8';
$('seed').value = '7';
$('guidance').value = '1.0';
$('rand-seed').checked = false;

// ── the spatial tab ───────────────────────────────────────────────────────
document.querySelector('.tabbtn[data-tab="spatial"]').click();
flush();
assert($('tab-spatial').classList.contains('active'), 'spatial tab shows');
assert(!$('btn-sp-capture').disabled, 'capture enabled once loaded');

// A strong, unmistakable axis for the region push.
const axisSel = $('sp-axis');
assert(axisSel.options.length > 0, 'axis dropdown is populated');
let axisKey = 'rendering.graphic';
if (![...axisSel.options].some((o) => o.value === axisKey)) axisKey = axisSel.options[0].value;
axisSel.value = axisKey;
$('sp-strength').value = '5';
$('sp-strength').dispatchEvent(new Event('input'));

function spStatusIs(prefix) {
  return $('sp-status-text').textContent.indexOf(prefix) === 0;
}
function waitStatus(prefix, budgetMs, what) {
  assert(pumpUntil(() => spStatusIs(prefix) ||
                         $('sp-status-text').className === 'err', budgetMs),
         what + ' finished within budget (status: ' + $('sp-status-text').textContent + ')');
  assert($('sp-status-text').className !== 'err',
         what + ' ok: ' + $('sp-status-text').textContent);
}

console.log('capturing the current render…');
$('btn-sp-capture').click();
waitStatus('captured', 180000, 'capture');
assert($('sp-hint').style.display === 'none', 'capture hint gone');
assert($('sp-paint').width === 512 && $('sp-paint').height === 512,
       'paint canvas sized to the render');

// ── stroke the LEFT-CENTER region with simulated mouse input ─────────────
const rect = $('sp-paint').getBoundingClientRect();
const sx = rect.x + rect.width * 0.25, sy = rect.y + rect.height * 0.5;
mouseDown(sx, sy);
for (let i = 0; i <= 6; i++) mouseMove(sx - 24 + i * 8, sy + (i % 2) * 16);
mouseUp(sx + 24, sy);
flush();
console.log('stroke released — waiting for the auto-composite (two renders)…');
waitStatus('done', 360000, 'auto-composite');
assert($('sp-result-hint').style.display === 'none', 'result hint gone');

// ── read base and composite through the wipe divider ─────────────────────
const resRect = () => $('sp-result').getBoundingClientRect();
function wipeTo(frac) {
  const r = resRect();
  const x = r.x + Math.max(1, Math.min(r.width - 1, frac * r.width));
  mouseDown(x, r.y + r.height / 2);
  mouseUp(x, r.y + r.height / 2);
  flush();
}
function grabResult() {
  return $('sp-result').getContext('2d').getImageData(0, 0, 512, 512);
}
wipeTo(0.999);                     // divider hard right → full base visible
const baseImg = grabResult();
wipeTo(0.001);                     // divider hard left → full composite
const compImg = grabResult();

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
// Stroke centered at (128, 256) with a 48px brush → generous inner box; the
// right half must stay near the base (this is the mask-efficacy assertion).
const inner = regionDiff(baseImg, compImg, 64, 192, 208, 320);
const outer = regionDiff(baseImg, compImg, 320, 64, 496, 448);
console.log('painted-region diff ' + inner.toFixed(2) + ' · far-region diff ' + outer.toFixed(2));
assert(inner > 5, 'the axis changed the painted region (mean diff ' + inner.toFixed(2) + ' > 5)');
assert(outer < inner * 0.5,
       'the effect stayed inside the mask (far ' + outer.toFixed(2) + ' < half of ' + inner.toFixed(2) + ')');

// ── strength is live: a settled slider re-composites the current mask ────
console.log('re-compositing at a different strength…');
$('sp-strength').value = '-5';
$('sp-strength').dispatchEvent(new Event('input'));
$('sp-strength').dispatchEvent(new Event('change'));
waitStatus('done', 360000, 'strength re-composite');
wipeTo(0.001);
const negImg = grabResult();
const dStrength = regionDiff(compImg, negImg, 64, 192, 208, 320);
console.log('+5 vs −5 painted-region diff ' + dStrength.toFixed(2));
assert(dStrength > 5, 'strength direction changes the composite (mean diff ' +
       dStrength.toFixed(2) + ' > 5)');

// clear leaves a clean slate
$('btn-sp-clear').click();
flush();
assert(spStatusIs('paint cleared'), 'clear reported: ' + $('sp-status-text').textContent);

console.log('PASS: spatial paint captures, composites locally, and strength is live');
