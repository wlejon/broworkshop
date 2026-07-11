// ── Spatial Paint tab ─────────────────────────────────────────────────
// Per-region axis compositing: render a base, paint a region mask over it,
// pick an axis, and the worker composites base + axis-pushed denoising
// under the mask (two forwards per step).

import { $, VAE_SCALE } from '/app/ui/util.js';

export function initSpatial(ctx) {
  const prefs = ctx.prefs;

  // ── spatial paint state ─────────────────────────────────────────────────
  let spBaseBitmap = null, spBaseOpts = null, spBasePrompt = '';
  let spMaskCanvas = null;    // offscreen, full render resolution, white=painted
  let spDown = false;

  // restore persisted text fields
  if (prefs.spPrompt) $('sp-prompt').value = prefs.spPrompt;
  if (prefs.spSeed != null) $('sp-seed').value = prefs.spSeed;
  if (prefs.spSteps != null) $('sp-steps').value = prefs.spSteps;
  if (prefs.spStrength != null) $('sp-strength').value = prefs.spStrength;

  function spStatus(msg, kind) {
    const el = $('sp-status-text'); el.textContent = msg; el.className = kind || '';
  }

  const spPaintCanvas = $('sp-paint');
  const spPaintCtx = spPaintCanvas.getContext('2d');
  const spResultCanvas = $('sp-result');
  const spResultCtx = spResultCanvas.getContext('2d');

  function redrawSpPaint() {
    const w = spPaintCanvas.width, h = spPaintCanvas.height;
    spPaintCtx.clearRect(0, 0, w, h);
    spPaintCtx.drawImage(spBaseBitmap, 0, 0, w, h);
    spPaintCtx.save();
    spPaintCtx.globalCompositeOperation = 'screen';
    spPaintCtx.globalAlpha = 0.65;
    spPaintCtx.drawImage(spMaskCanvas, 0, 0, w, h);
    spPaintCtx.restore();
  }
  function spPointerToCanvas(e) {
    const rect = spPaintCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width * spPaintCanvas.width,
      y: (e.clientY - rect.top) / rect.height * spPaintCanvas.height,
    };
  }
  function spPaintAt(x, y) {
    const r = +$('sp-brush-radius').value;
    const mctx = spMaskCanvas.getContext('2d');
    mctx.globalCompositeOperation = 'source-over';
    mctx.fillStyle = '#ffffff';
    mctx.globalAlpha = 0.85;
    mctx.beginPath(); mctx.arc(x, y, r, 0, Math.PI * 2); mctx.fill();
    redrawSpPaint();
  }
  spPaintCanvas.addEventListener('pointerdown', (e) => {
    if (!spBaseBitmap) return;
    spDown = true;
    if (spPaintCanvas.setPointerCapture) spPaintCanvas.setPointerCapture(e.pointerId);
    const p = spPointerToCanvas(e); spPaintAt(p.x, p.y);
  });
  spPaintCanvas.addEventListener('pointermove', (e) => {
    if (!spDown || !spBaseBitmap) return;
    const p = spPointerToCanvas(e); spPaintAt(p.x, p.y);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
    spPaintCanvas.addEventListener(ev, () => { spDown = false; });
  });

  function doSpBase() {
    if (!ctx.loaded || ctx.busy) return;
    const prompt = $('sp-prompt').value.trim();
    if (!prompt) { spStatus('enter a prompt', 'err'); return; }
    const opts = {
      width: ctx.roundSize($('width').value), height: ctx.roundSize($('height').value),
      steps: +$('sp-steps').value || 4,
      guidanceScale: +$('guidance').value || ctx.DEFAULTS.guidance,
      seed: +$('sp-seed').value || 0,
      negativePrompt: $('neg-prompt').value.trim(),
    };
    ctx.persist();
    ctx.setBusy(true);
    spStatus('base render…');
    $('sp-timing').textContent = '';
    ctx.client.send({
      type: 'generate', prompt: prompt, negPrompt: opts.negativePrompt, opts: opts,
      band: 1.0, dial: { pregate: 1.0, prescale: 1.0 }, gate: { txtScale: 1.0, imgScale: 1.0 },
      axisControls: {},
      loraScales: ctx.loraScales(),
    }, (err, resp) => {
      ctx.setBusy(false);
      if (err) { spStatus(String(err.message || err), 'err'); return; }
      spBasePrompt = prompt; spBaseOpts = opts;
      spBaseBitmap = resp.bitmap;
      spPaintCanvas.width = resp.width; spPaintCanvas.height = resp.height;
      spMaskCanvas = document.createElement('canvas');
      spMaskCanvas.width = resp.width; spMaskCanvas.height = resp.height;
      redrawSpPaint();
      $('sp-hint').style.display = 'none';
      ctx.refreshButtons();
      spStatus('base rendered · ' + (resp.ms || 0) + ' ms — paint a region, pick an axis, then composite', 'ok');
    });
  }
  function doSpClear() {
    if (!spMaskCanvas) return;
    spMaskCanvas.getContext('2d').clearRect(0, 0, spMaskCanvas.width, spMaskCanvas.height);
    redrawSpPaint();
  }
  function buildSpatialMask(W_lat, H_lat) {
    const off = document.createElement('canvas');
    off.width = W_lat; off.height = H_lat;
    const octx = off.getContext('2d');
    octx.drawImage(spMaskCanvas, 0, 0, spBaseOpts.width, spBaseOpts.height, 0, 0, W_lat, H_lat);
    const id = octx.getImageData(0, 0, W_lat, H_lat);
    const out = new Float32Array(W_lat * H_lat);
    for (let i = 0; i < out.length; i++) out[i] = id.data[4 * i] / 255;
    return out;
  }
  function drawSpResult(bitmap, w, h) {
    if (spResultCanvas.width !== w || spResultCanvas.height !== h) {
      spResultCanvas.width = w; spResultCanvas.height = h;
    }
    spResultCtx.drawImage(bitmap, 0, 0);
    $('sp-result-hint').style.display = 'none';
  }
  function doSpGo() {
    if (!spBaseBitmap || ctx.busy) return;
    const axisName = $('sp-axis').value;
    if (!axisName) { spStatus('pick an axis', 'err'); return; }
    const strength = +$('sp-strength').value;
    const W_lat = spBaseOpts.width / VAE_SCALE, H_lat = spBaseOpts.height / VAE_SCALE;
    const maskData = buildSpatialMask(W_lat, H_lat);
    ctx.persist();
    ctx.setBusy(true);
    spStatus('compositing — two forwards per step…');
    ctx.client.send({
      type: 'spatialRender', basePrompt: spBasePrompt, opts: spBaseOpts,
      axisName: axisName, alpha: strength, maskW: W_lat, maskH: H_lat, maskData: maskData,
      loraScales: ctx.loraScales(),
    }, (err, resp) => {
      ctx.setBusy(false);
      if (err) { spStatus(String(err.message || err), 'err'); return; }
      drawSpResult(resp.bitmap, resp.width, resp.height);
      spStatus('done · ' + (resp.ms || 0) + ' ms', 'ok');
      $('sp-timing').textContent = resp.ms ? resp.ms + ' ms' : '';
    });
  }

  $('sp-strength').addEventListener('input', () => {
    $('sp-strength-val').textContent = (+$('sp-strength').value).toFixed(2);
  });
  $('btn-sp-base').addEventListener('click', doSpBase);
  $('btn-sp-clear').addEventListener('click', doSpClear);
  $('btn-sp-go').addEventListener('click', doSpGo);
  ['sp-prompt', 'sp-seed', 'sp-steps', 'sp-axis', 'sp-strength'].forEach((id) => $(id).addEventListener('change', ctx.persist));

  ctx.onRefreshButtons((busyOrUnloaded) => {
    $('btn-sp-base').disabled = busyOrUnloaded;
    $('btn-sp-go').disabled = busyOrUnloaded || !spBaseBitmap;
  });
  ctx.onPersist((p) => {
    p.spPrompt = $('sp-prompt').value; p.spSeed = $('sp-seed').value; p.spSteps = $('sp-steps').value;
    p.spAxis = $('sp-axis').value; p.spStrength = $('sp-strength').value;
  });
}
