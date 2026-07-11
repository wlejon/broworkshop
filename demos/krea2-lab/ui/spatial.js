// ── Spatial Paint tab ─────────────────────────────────────────────────
// Per-region axis compositing: capture the CURRENT render (your prompt,
// seed, and every active control — same message Generate sends), stroke a
// region on it, pick an axis + strength, and the worker re-renders with two
// lockstep denoising states — base vs base-with-the-axis-pushed — blending
// their latents under the painted mask every step. The axis moves only
// where painted; everywhere else stays the captured render.
//
// Interaction mirrors Gate Paint: a stroke re-renders on release, the
// result pane wipes base against composite, strength/axis changes re-render
// the current mask.

import { $, VAE_SCALE } from '/app/ui/util.js';

export function initSpatial(ctx) {
  const prefs = ctx.prefs;

  let spCapture = null;        // {msgUsed, baseBitmap, baseW, baseH}
  let spMaskCanvas = null;     // offscreen at render resolution; ALPHA = mask
  let spDown = false;
  let spPainted = false;       // any stroke since the last clear
  let spStrokeDirty = false;   // mask changed since the last composite
  let spResultBitmap = null;   // last composite (wipes against base)
  let spWipe = 0.45;           // divider position, 0..1 of result width
  let spPendingApply = false;

  if (prefs.spStrength != null) $('sp-strength').value = prefs.spStrength;

  function spStatus(msg, kind) {
    const el = $('sp-status-text'); el.textContent = msg; el.className = kind || '';
  }

  const spPaintCanvas = $('sp-paint');
  const spPaintCtx = spPaintCanvas.getContext('2d');
  const spResultCanvas = $('sp-result');
  const spResultCtx = spResultCanvas.getContext('2d');

  // Stroke color — the alpha channel doubles as the region mask, so paint
  // in a solid accent and overlay it translucently. (The old white 'screen'
  // overlay vanished on light images.)
  const SP_BRUSH = 'rgba(240, 168, 96, 1)';

  function redrawSpPaint() {
    if (!spCapture) return;
    const w = spPaintCanvas.width, h = spPaintCanvas.height;
    spPaintCtx.clearRect(0, 0, w, h);
    spPaintCtx.drawImage(spCapture.baseBitmap, 0, 0, w, h);
    spPaintCtx.save();
    spPaintCtx.globalAlpha = 0.5;
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
    mctx.fillStyle = SP_BRUSH;
    mctx.beginPath(); mctx.arc(x, y, r, 0, Math.PI * 2); mctx.fill();
    spPainted = true;
    spStrokeDirty = true;
    redrawSpPaint();
  }
  spPaintCanvas.addEventListener('pointerdown', (e) => {
    if (!spCapture) return;
    spDown = true;
    if (spPaintCanvas.setPointerCapture) spPaintCanvas.setPointerCapture(e.pointerId);
    const p = spPointerToCanvas(e); spPaintAt(p.x, p.y);
  });
  spPaintCanvas.addEventListener('pointermove', (e) => {
    if (!spDown || !spCapture) return;
    const p = spPointerToCanvas(e); spPaintAt(p.x, p.y);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
    spPaintCanvas.addEventListener(ev, () => {
      if (!spDown) return;
      spDown = false;
      // the stroke is the gesture — composite without a separate button
      if (spStrokeDirty) doSpApply();
      ctx.refreshButtons();
    });
  });

  // The result pane wipes base (left) against the composite (right).
  function renderSpResult() {
    if (!spCapture) return;
    const w = spCapture.baseW, h = spCapture.baseH;
    if (spResultCanvas.width !== w || spResultCanvas.height !== h) {
      spResultCanvas.width = w; spResultCanvas.height = h;
    }
    spResultCtx.drawImage(spCapture.baseBitmap, 0, 0);
    if (!spResultBitmap) return;
    const wx = Math.round(Math.max(0, Math.min(1, spWipe)) * w);
    if (wx < w) {
      spResultCtx.drawImage(spResultBitmap, wx, 0, w - wx, h, wx, 0, w - wx, h);
    }
    spResultCtx.fillStyle = 'rgba(255,255,255,0.75)';
    spResultCtx.fillRect(Math.max(0, wx - 1), 0, 2, h);
    $('sp-result-hint').style.display = 'none';
  }
  let spWipeDown = false;
  function spWipeTo(e) {
    const rect = spResultCanvas.getBoundingClientRect();
    spWipe = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    renderSpResult();
  }
  spResultCanvas.addEventListener('pointerdown', (e) => {
    if (!spResultBitmap) return;
    spWipeDown = true;
    if (spResultCanvas.setPointerCapture) spResultCanvas.setPointerCapture(e.pointerId);
    spWipeTo(e);
  });
  spResultCanvas.addEventListener('pointermove', (e) => { if (spWipeDown) spWipeTo(e); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
    spResultCanvas.addEventListener(ev, () => { spWipeDown = false; });
  });

  // Capture = one full render of the CURRENT scene (identical message to
  // Generate — controls, dials, gates, LoRAs, seed). The composite's base
  // state re-primes from this same message, so what you paint on is exactly
  // what the un-painted region keeps.
  function doSpCapture() {
    if (!ctx.loaded || ctx.busy) return;
    const msg = ctx.buildGenerateMsg('full');
    ctx.persist();
    ctx.setBusy(true);
    spStatus('capturing the current render…');
    $('sp-timing').textContent = '';
    ctx.client.send(msg, (err, resp) => {
      ctx.setBusy(false);
      if (err) { spStatus(String(err.message || err), 'err'); return; }
      spCapture = { msgUsed: msg, baseBitmap: resp.bitmap,
                    baseW: resp.width, baseH: resp.height };
      spPaintCanvas.width = resp.width; spPaintCanvas.height = resp.height;
      spMaskCanvas = document.createElement('canvas');
      spMaskCanvas.width = resp.width; spMaskCanvas.height = resp.height;
      spPainted = false; spStrokeDirty = false;
      spResultBitmap = null;
      redrawSpPaint();
      renderSpResult();
      $('sp-hint').style.display = 'none';
      ctx.refreshButtons();
      spStatus('captured · stroke a region — the axis will apply only there', 'ok');
    });
  }
  function doSpClear() {
    if (!spMaskCanvas) return;
    spMaskCanvas.getContext('2d').clearRect(0, 0, spMaskCanvas.width, spMaskCanvas.height);
    spPainted = false; spStrokeDirty = false;
    spResultBitmap = null;
    redrawSpPaint();
    renderSpResult();
    spStatus('paint cleared', 'ok');
  }
  // Downscale the painted mask to the latent grid; the stroke alpha IS the
  // blend weight (1 = fully the axis state, 0 = fully base).
  function buildSpatialMask(W_lat, H_lat) {
    const off = document.createElement('canvas');
    off.width = W_lat; off.height = H_lat;
    const octx = off.getContext('2d');
    octx.drawImage(spMaskCanvas, 0, 0, spMaskCanvas.width, spMaskCanvas.height,
                   0, 0, W_lat, H_lat);
    const id = octx.getImageData(0, 0, W_lat, H_lat);
    const out = new Float32Array(W_lat * H_lat);
    for (let i = 0; i < out.length; i++) out[i] = id.data[4 * i + 3] / 255;
    return out;
  }
  function doSpApply() {
    if (!spCapture || !spPainted) return;
    if (ctx.busy) { spPendingApply = true; return; }
    const axisName = $('sp-axis').value;
    if (!axisName) { spStatus('pick an axis', 'err'); return; }
    const strength = +$('sp-strength').value;
    if (!strength) { spStatus('strength is 0 — nothing to push', 'err'); return; }
    const opts = spCapture.msgUsed.opts;
    const W_lat = opts.width / VAE_SCALE, H_lat = opts.height / VAE_SCALE;
    const maskData = buildSpatialMask(W_lat, H_lat);
    spStrokeDirty = false;
    ctx.persist();
    ctx.setBusy(true);
    spStatus('compositing — two lockstep renders…');
    ctx.client.send({
      type: 'spatialRender', base: spCapture.msgUsed,
      axisName: axisName, alpha: strength,
      maskW: W_lat, maskH: H_lat, maskData: maskData,
    }, (err, resp) => {
      ctx.setBusy(false);
      if (err) { spStatus(String(err.message || err), 'err'); return; }
      spResultBitmap = resp.bitmap;
      renderSpResult();
      spStatus('done · drag the result divider to compare', 'ok');
      $('sp-timing').textContent = resp.ms ? resp.ms + ' ms' : '';
    });
  }

  $('sp-strength').addEventListener('input', () => {
    const v = +$('sp-strength').value;
    $('sp-strength-val').textContent = (v > 0 ? '+' : '') + v.toFixed(2);
  });
  // A settled strength / a different axis re-renders the current mask, so
  // the sliders read as live controls, not staged inputs.
  $('sp-strength').addEventListener('change', () => { ctx.persist(); doSpApply(); });
  $('sp-axis').addEventListener('change', () => { ctx.persist(); doSpApply(); });
  $('btn-sp-capture').addEventListener('click', doSpCapture);
  $('btn-sp-clear').addEventListener('click', doSpClear);

  ctx.onRefreshButtons((busyOrUnloaded) => {
    $('btn-sp-capture').disabled = busyOrUnloaded;
  });
  ctx.onIdle(() => {
    // a stroke finished while a render was in flight — composite it now
    if (spPendingApply) { spPendingApply = false; doSpApply(); }
  });
  ctx.onPersist((p) => {
    p.spAxis = $('sp-axis').value; p.spStrength = $('sp-strength').value;
  });

  // strength label reflects the restored pref
  const v0 = +$('sp-strength').value;
  $('sp-strength-val').textContent = (v0 > 0 ? '+' : '') + v0.toFixed(2);
}
