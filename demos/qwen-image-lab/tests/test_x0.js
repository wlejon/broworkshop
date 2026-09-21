// The x̂0 preview strip: the clean image each step committed to, decoded
// during the render it belongs to.
//
//   CUDA_VISIBLE_DEVICES=0 bro-headless ../broworkshop/demos/qwen-image-lab tests/test_x0.js
//
// The flow-match Euler step is exact, so two consecutive latents recover the
// velocity and with it the model's current guess at the finished picture:
//
//     k = sigma_i / (sigma_{i+1} - sigma_i),   x̂0 = x_i - k * (x_{i+1} - x_i)
//
// Two things follow, and both are asserted rather than assumed. At the LAST
// step sigma_{i+1} is zero, so k is -1 and x̂0 is exactly x_{i+1} — the final
// latent. That thumbnail must therefore be the render itself, to the pixel: a
// sign error or an off-by-one in the sigma index could not survive it. And
// because the estimate is read off latents the loop already has, turning the
// strip on must not change the picture at all — only the VAE decodes cost
// anything.
//
// Earlier thumbnails then have to close on the final frame monotonically,
// which is what makes the strip answer "when did this edit land".

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
// The strip holds bitmaps at render size; draw one out full-size to read it.
function frameOf(f) {
  const cv = document.createElement('canvas');
  cv.width = f.width; cv.height = f.height;
  cv.getContext('2d').drawImage(f.bitmap, 0, 0, f.width, f.height);
  return cv.getContext('2d').getImageData(0, 0, f.width, f.height);
}

console.log('waiting for the model to load…');
assert(pumpUntil(() => !$('btn-generate').disabled ||
                       $('status-text').classList.contains('err'), 600000),
       'model load finished within budget');
assert(!$('status-text').classList.contains('err'),
       'model loaded without error: ' + $('status-text').textContent);

const ctx = window.__ctx;
const STEPS = 8;

$('live').checked = false; $('live').dispatchEvent(new Event('change'));
$('btn-deck-clear').click();
$('btn-cond-clear').click();
$('width').value = '512'; $('height').value = '512';
$('steps').value = String(STEPS); $('seed').value = '7'; $('guidance').value = '1.0';
$('rand-seed').checked = false;
$('prompt').value = 'a stone cottage beside a mountain lake';
$('steps').dispatchEvent(new Event('change'));
flush();

function render(what) {
  const t0 = Date.now();
  $('btn-generate').click();
  const ok = pumpUntil(() => $('status-text').textContent === 'done' ||
                             $('status-text').classList.contains('err'), 180000);
  assert(ok && !$('status-text').classList.contains('err'),
         what + ' rendered ok: ' + $('status-text').textContent);
  const c = $('view');
  const ms = Date.now() - t0;
  console.log(what + ' · ' + (ms / 1000).toFixed(2) + ' s');
  return { img: c.getContext('2d').getImageData(0, 0, c.width, c.height), ms: ms };
}

document.querySelector('.tabbtn[data-tab="signals"]').click();
flush();
assert($('tab-signals').classList.contains('active'), 'the signals tab shows');
assert(ctx.x0Frames().length === 0, 'the strip starts empty');
assert($('sig-x0-strip').textContent.indexOf('x̂0 preview') >= 0,
       'with a line saying what would fill it: ' + $('sig-x0-strip').textContent);

// ── the untouched render, with no preview ─────────────────────────────────
ctx.setSignals(false, false);
flush();
let msg = ctx.buildGenerateMsg();
assert(!msg.x0, 'nothing is asked for while the box is clear');
const plain = render('baseline · no preview');

// ── auto steps ────────────────────────────────────────────────────────────
ctx.setSignals(false, true);
$('sig-x0-steps').value = 'auto';
$('sig-x0-n').value = '4';
$('sig-x0-n').dispatchEvent(new Event('change'));
flush();
const want = ctx.sigWantedSteps();
console.log('auto over ' + STEPS + ' steps, 4 thumbnails: ' + want.join(', '));
assert(want.length === 4, 'four steps were chosen (' + want.join(', ') + ')');
assert(want[want.length - 1] === STEPS - 1,
       'always including the last step — the one that IS the picture');
assert(want.every((v, i) => i === 0 || v > want[i - 1]), 'in order, no repeats');
msg = ctx.buildGenerateMsg();
assert(msg.x0 && msg.x0.steps.length === 4, 'and they ride in the generate message');

const withX0 = render('with four x̂0 decodes');
const frames = ctx.x0Frames();
console.log('strip · ' + frames.length + ' thumbnails · ' + $('sig-timing').textContent);
assert(frames.length === 4, 'four thumbnails came back (got ' + frames.length + ')');
assert(frames.map((f) => f.step).join(',') === want.join(','),
       'at the steps that were asked for (' + frames.map((f) => f.step).join(',') + ')');
assert(document.querySelectorAll('#sig-x0-strip .walk-cell').length === 4,
       'the strip drew a cell each');
assert($('sig-x0-strip').textContent.indexOf('step ' + want[0]) >= 0,
       'labelled by step: ' + $('sig-x0-strip').textContent);
assert(frames[0].width === 512, 'decoded at the render size (' + frames[0].width + ')');

// ── the preview changes nothing ───────────────────────────────────────────
console.log('preview render vs plain render: mse ' + mse(plain.img, withX0.img).toFixed(4));
assert(mse(plain.img, withX0.img) < 1e-6,
       'asking for the estimate does not disturb the render, to the pixel');
console.log('cost of four decodes: ' + (withX0.ms - plain.ms) + ' ms (' +
            plain.ms + ' → ' + withX0.ms + ')');
assert(withX0.ms > plain.ms,
       'though the decodes are not free (' + plain.ms + ' → ' + withX0.ms + ' ms)');

// ── the last thumbnail IS the render ──────────────────────────────────────
const last = frameOf(frames[frames.length - 1]);
const dLast = mse(last, withX0.img);
console.log('last x̂0 vs the finished render: mse ' + dLast.toFixed(6));
assert(dLast < 1e-6,
       'at the final step sigma is zero, k is -1 and x̂0 is the final latent — so the last ' +
       'thumbnail is the render itself (mse ' + dLast.toFixed(6) + ')');

// ── and the earlier ones close on it ──────────────────────────────────────
const dists = frames.map((f) => mse(frameOf(f), withX0.img));
console.log('distance to the finished render, per thumbnail: ' +
            frames.map((f, i) => 'step ' + f.step + ' ' + dists[i].toFixed(1)).join(' · '));
assert(dists[0] > 20, 'the first estimate is not the answer yet (' + dists[0].toFixed(1) + ')');
assert(dists.every((v, i) => i === 0 || v < dists[i - 1]),
       'every step brings the estimate closer, which is what makes the strip readable as ' +
       'time (' + dists.map((v) => v.toFixed(1)).join(' > ') + ')');

// ── an explicit step list ─────────────────────────────────────────────────
$('sig-x0-steps').value = '0, 3, 7';
$('sig-x0-steps').dispatchEvent(new Event('change'));
flush();
const explicit = ctx.sigWantedSteps();
assert(explicit.join(',') === '0,3,7', 'an explicit list is honoured (' + explicit.join(',') + ')');
$('sig-x0-steps').value = '0, 3, 99';
$('sig-x0-steps').dispatchEvent(new Event('change'));
assert(ctx.sigWantedSteps().join(',') === '0,3',
       'a step past the end is dropped rather than sent (' + ctx.sigWantedSteps().join(',') + ')');
$('sig-x0-steps').value = '0, 3, 7';
$('sig-x0-steps').dispatchEvent(new Event('change'));
flush();

const three = render('three named steps');
const f3 = ctx.x0Frames();
assert(f3.length === 3, 'three thumbnails (got ' + f3.length + ')');
assert(f3[0].step === 0, 'including step 0 — the first thing the model committed to');
const d0 = mse(frameOf(f3[0]), three.img);
console.log('step 0 estimate vs the finished render: mse ' + d0.toFixed(1));
assert(d0 > dists[0],
       'and it is further off than any later one (' + d0.toFixed(1) + ' > ' +
       dists[0].toFixed(1) + ')');

// ── clicking a thumbnail arms a control at that step ──────────────────────
assert($('sig-arm').options.length >= 1, 'there is something to arm');
assert($('sig-arm').options[0].value === 'mask', 'the gate brush is the default target');
$('gp-at').value = '0';
const cells = document.querySelectorAll('#sig-x0-strip .walk-cell');
cells[1].click();
flush();
console.log('clicked the step ' + f3[1].step + ' thumbnail · ' + $('sig-status').textContent);
assert(+$('gp-at').value === f3[1].step,
       'the brush moved to that step (' + $('gp-at').value + ')');
assert(cells[1].classList.contains('pick'), 'and the thumbnail is marked as the pick');
assert($('sig-status').textContent.indexOf('step ' + f3[1].step) > 0,
       'the status says what was armed: ' + $('sig-status').textContent);

// a spatial region is an arm target too
const r = ctx.spatialAdd('probe');
ctx.refreshDeck();
flush();
const opts = [];
for (let i = 0; i < $('sig-arm').options.length; i++) opts.push($('sig-arm').options[i].value);
assert(opts.indexOf('region:' + r.id) >= 0,
       'a spatial region joins the arm targets (' + opts.join(', ') + ')');
$('sig-arm').value = 'region:' + r.id;
cells[2].click();
flush();
assert(r.at === f3[2].step,
       'and clicking arms THAT region at the step (' + r.at + ' vs ' + f3[2].step + ')');
$('btn-sp-clear').click();
flush();

// ── off again ─────────────────────────────────────────────────────────────
// Including the brush's arm step, which clicking a thumbnail moved and the
// prefs remember — a test that leaves the app somewhere else is a test that
// breaks the next one.
$('gp-at').value = '4';
$('gp-at').dispatchEvent(new Event('change'));
ctx.setSignals(false, false);
flush();
msg = ctx.buildGenerateMsg();
assert(!msg.x0, 'the preview is off');
const after = render('after the preview was switched off');
assert(mse(plain.img, after.img) < 1e-6, 'and the render is the baseline again');

console.log('PASS — the estimate is exact at the tail, free to the picture, and closes ' +
            'monotonically');
