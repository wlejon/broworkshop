// The axis bank, through the real UI: a bank slider at +/-2 has to change the
// render, and the same settings twice have to reproduce it exactly.
//
//   CUDA_VISIBLE_DEVICES=0 bro-headless ../broworkshop/demos/qwen-image-lab tests/test_axes.js
//
// The noise floor here is ZERO, not "small": same seed, same settings, same
// bytes (FINDINGS.md's banked prime/stepOnce loop reproduces generate()
// bit-for-bit). So the repeat render is the control, and anything above it is
// the axis.

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

// a clean, fixed scene
$('live').checked = false; $('live').dispatchEvent(new Event('change'));
$('btn-deck-clear').click();
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
  const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  console.log(what + ' · ' + ((Date.now() - t0) / 1000).toFixed(2) + ' s · ' + $('timing').textContent);
  return img;
}
function mse(a, b) {
  let acc = 0, n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) { const d = a.data[i + c] - b.data[i + c]; acc += d * d; n++; }
  }
  return acc / n;
}
// The bank sliders are ordinary control rows keyed by their axis name.
function axisRange(name) {
  const row = document.querySelector('#axis-categories .ctl[data-key="' + name + '"]');
  return row ? row.querySelector('input[type=range]') : null;
}
function setAxis(name, v) {
  const r = axisRange(name);
  assert(r, 'the bank has an axis row for ' + name);
  r.value = String(v);
  r.dispatchEvent(new Event('input'));
  flush();
}

assert(document.querySelectorAll('#axis-categories .ctl').length === 88,
       'the bank built 88 axis sliders');

const base = render('baseline · every axis at zero');
const repeat = render('repeat · the same settings again');
const floor = mse(base, repeat);
console.log('noise floor (same settings twice): mse ' + floor.toFixed(3));
assert(floor < 1e-6, 'the same settings reproduce the render exactly (mse ' + floor.toFixed(4) + ')');

// ── one axis at +2 ────────────────────────────────────────────────────────
setAxis('light.key', 2);
assert(document.querySelectorAll('.deck-chip').length === 1, 'the axis joined the deck');
const plus = render('light.key +2');
const dPlus = mse(base, plus);
console.log('light.key +2 vs baseline: mse ' + dPlus.toFixed(1));
assert(dPlus > 50, 'a bank axis at +2 changed the render (mse ' + dPlus.toFixed(1) +
       ' against a floor of ' + floor.toFixed(4) + ')');

// ── the same axis at -2 is a different picture again ──────────────────────
setAxis('light.key', -2);
const minus = render('light.key -2');
const dMinus = mse(base, minus);
const dSpan = mse(plus, minus);
console.log('light.key -2 vs baseline: mse ' + dMinus.toFixed(1) +
            ' · +2 vs -2: mse ' + dSpan.toFixed(1));
assert(dMinus > 50, 'the axis at -2 changed the render (mse ' + dMinus.toFixed(1) + ')');
assert(dSpan > dPlus, 'the two poles are further apart than either is from neutral');

// ── the stack meter reports what the injection spent ──────────────────────
assert($('deck-stack').classList.contains('show'), 'the stack meter shows with an axis armed');
console.log('stack meter: ' + $('ds-text').textContent);

// ── back to zero renders the baseline again, to the pixel ─────────────────
setAxis('light.key', 0);
assert(document.querySelectorAll('.deck-chip').length === 0, 'the axis left the deck');
const back = render('back at zero');
const dBack = mse(base, back);
console.log('back at zero vs baseline: mse ' + dBack.toFixed(4));
assert(dBack < 1e-6, 'zeroing the axis restores the baseline exactly (mse ' + dBack.toFixed(4) + ')');

// ── the desk: one fader spends many knobs at once ─────────────────────────
// A fader is a direction in the scheduled knob space — text axes AND the
// in-network dials, re-issued per step — so this also exercises the worker's
// port of the research controller.
function faderRange(name) {
  const row = document.querySelector('#desk-rows .ctl[data-key="desk.' + name + '"]');
  return row ? row.querySelector('input[type=range]') : null;
}
const faders = window.__ctx.faderNames();
assert(faders.length >= 6, 'the desk has its faders (' + faders.join(', ') + ')');
const fname = faders.indexOf('warm') >= 0 ? 'warm' : faders[0];
const fr = faderRange(fname);
assert(fr, 'the fader row for ' + fname + ' exists');
fr.value = '2'; fr.dispatchEvent(new Event('input')); flush();
assert(document.querySelectorAll('.deck-chip').length === 1, 'the fader joined the deck');
const desk = render('desk fader "' + fname + '" at +2');
const dDesk = mse(base, desk);
console.log('desk ' + fname + ' +2 vs baseline: mse ' + dDesk.toFixed(1));
assert(dDesk > 50, 'the desk fader changed the render (mse ' + dDesk.toFixed(1) + ')');
assert($('desk-travel').textContent.indexOf(fname) >= 0,
       'the travel readout names what the fader is spending');
assert($('ret-text').textContent.indexOf('retention') >= 0,
       'the retention meter reports against the baseline: ' + $('ret-text').textContent);

fr.value = '0'; fr.dispatchEvent(new Event('input')); flush();
const deskBack = render('desk back at zero');
console.log('desk back at zero vs baseline: mse ' + mse(base, deskBack).toFixed(4));
assert(mse(base, deskBack) < 1e-6, 'zeroing the desk restores the baseline exactly');

console.log('PASS — the bank axes and the desk faders reach the render and come back off it cleanly');
