// ═══ Invert — image → W+, the reverse seam ════════════════════════════════════
// Every other seam runs latent→image; this one runs the other way. gan.invert
// recovers the W+ that best reproduces a target by Adam descent through the
// frozen synthesis. It's slow (hundreds of synthesis passes), so we run it in
// CHUNKS, feeding each chunk's recovered w+ back as the next chunk's start
// (opts.initW): the face refines live on screen instead of freezing for a
// minute, and the loss curve grows as it goes. The recovered w+ then pins into
// the Walk/Mix A/B anchors — invert a real face, then morph or style-mix it like
// any sampled latent. That round trip (image → latent → edit) is the payoff.

import { $, S } from "/app/lib/state.js";
import { curPsi, curCutoff } from "/app/lib/model.js";
import { runOne, runSeq, buildImg, setBadge } from "/app/lib/engine.js";
import { drawBitmap } from "/app/lib/helpers.js";
import { showSeam } from "/app/app.js";

// invTargetData, invW and invCurve live on the shared state object (state.js)
// so model.js can reset them when a new checkpoint loads.

const INV_CHUNK = 25;       // steps per async op — small enough to refine visibly

// Adopt a source ImageBitmap as the target: stretch it onto a model-resolution
// canvas (the binding requires an exact resolution match) and grab the pixels.
export function setInvTarget(bmp) {
  if (!bmp) return;
  const R = S.META.resolution;
  const cv = $('#inv-target');
  cv.width = R; cv.height = R;
  const cx = cv.getContext('2d');
  cx.drawImage(bmp, 0, 0, R, R);
  S.invTargetData = cx.getImageData(0, 0, R, R);   // RGBA { data, width, height }
  S.invW = null; S.invCurve = [];
  drawLossCurve(S.invCurve);
  const rc = $('#inv-recovered'); rc.getContext('2d').clearRect(0, 0, rc.width, rc.height);
  $('#inv-meta').textContent = 'target ' + R + '² — press invert';
}

// Source A: generate a face from a seed and invert it (a clean round-trip that
// proves the recovery — the recovered face should match the generated one).
export function invFromSeed() {
  if (!S.gan) return;
  const seed = parseInt($('#inv-seed').value, 10) || 0;
  runOne('inv target', buildImg(seed, curPsi(), curCutoff()), function (r) {
    setInvTarget(r.image);
  });
}

// Source B: decode an image file (Image.src decodes synchronously via broimage),
// then adopt it as the target. Any size — setInvTarget resizes to the model res.
export function invFromFile() {
  if (typeof showOpenFileDialog !== 'function') { setBadge('file dialog unavailable', true); return; }
  const files = showOpenFileDialog('Image|png;jpg;jpeg;bmp');
  if (!files || !files.length) return;
  try {
    const img = new Image();
    img.src = files[0];
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error('could not decode ' + files[0]);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0);
    createImageBitmap(c.getImageData(0, 0, w, h)).then(setInvTarget);
  } catch (e) { setBadge('load failed: ' + e.message, true); }
}

// Run the inversion as a chain of chunks, each resuming from the last result's
// w+. onStep places the partial face + extends the loss curve; the latest-wins
// engine means pressing invert again (or switching seams) cleanly supersedes it.
export function runInvert() {
  if (!S.gan) return;
  if (!S.invTargetData) { setBadge('pick a target first (from seed / load image)', true); return; }
  const total = Math.max(INV_CHUNK, parseInt($('#inv-steps').value, 10) || 200);
  const lr   = parseFloat($('#inv-lr').value)  || 0.05;
  const regW = parseFloat($('#inv-reg').value) || 0;

  S.invW = null; S.invCurve = [];
  const nChunks = Math.ceil(total / INV_CHUNK);
  const steps = [];
  for (let c = 0; c < nChunks; c++) {
    const n = Math.min(INV_CHUNK, total - c * INV_CHUNK);
    steps.push(invChunk(n, lr, regW));     // reads invW lazily when pumped
  }
  runSeq('invert', steps,
    function (i, r) {
      S.invW = r.w;
      drawBitmap($('#inv-recovered'), r.image);
      for (let k = 0; k < r.lossCurve.length; k++) S.invCurve.push(r.lossCurve[k]);
      drawLossCurve(S.invCurve);
      $('#inv-meta').textContent =
        'step ' + S.invCurve.length + '/' + total + ' · mse ' + r.loss.toExponential(2);
    },
    function () { setBadge('inverted · mse ' + (S.invW ? S.invCurve[S.invCurve.length - 1].toExponential(2) : '?') + ' · → A/B to edit'); });
}

// One chunk: `n` Adam steps starting from the current recovered w+ (or w_avg on
// the first chunk, when invW is still null).
export function invChunk(n, lr, regW) {
  return function (onDone) {
    const opts = { steps: n, lr: lr, regW: regW, onDone: onDone };
    if (S.invW) opts.initW = S.invW;
    return S.gan.invert(S.invTargetData, opts);
  };
}

// Pin the recovered latent into a Walk/Mix anchor, then jump to Walk to edit it.
export function sendInvTo(which) {
  if (!S.invW) { setBadge('invert a target first', true); return; }
  if (which === 'a') S.pinnedA = S.invW; else S.pinnedB = S.invW;
  S.walkWA = S.walkWB = S.mixWA = S.mixWB = null;
  setBadge('inverted latent → ' + which.toUpperCase() + ' · edit it in Walk / Mix');
  showSeam('walk');
}

// Min-max loss sparkline (log-domain — inversion loss spans orders of magnitude).
export function drawLossCurve(curve) {
  const cv = $('#inv-loss'); if (!cv) return;
  const R = S.META.resolution || 256;
  if (cv.width !== R) cv.width = R;
  if (cv.height !== R) cv.height = R;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#0c0d10'; cx.fillRect(0, 0, R, R);
  if (curve.length < 2) return;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < curve.length; i++) {
    const v = Math.log(Math.max(curve[i], 1e-9));
    if (v < lo) lo = v; if (v > hi) hi = v;
  }
  const span = (hi - lo) || 1, pad = 6;
  cx.strokeStyle = '#54c7ff'; cx.lineWidth = 2; cx.beginPath();
  for (let i = 0; i < curve.length; i++) {
    const v = Math.log(Math.max(curve[i], 1e-9));
    const x = pad + (i / (curve.length - 1)) * (R - 2 * pad);
    const y = pad + (1 - (v - lo) / span) * (R - 2 * pad);
    if (i === 0) cx.moveTo(x, y); else cx.lineTo(x, y);
  }
  cx.stroke();
}

// Seam refresh: never auto-runs inversion (it's expensive) — just repaint what's
// there so switching back to Invert shows the last target / result.
export function refreshInvert() {
  drawLossCurve(S.invCurve);
  if (!S.invTargetData) $('#inv-meta').textContent = 'pick a target — from a seed or a file';
}
