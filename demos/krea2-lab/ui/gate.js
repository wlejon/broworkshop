// ── Gate Paint tab ────────────────────────────────────────────────────
// Paint the model's own attention-output gate directly on the captured
// render. Defaults live in the graceful regime the gate-probe strips
// found: mid blocks [19,28) at values 0.5..1.2 stay local, smooth, and
// monotonic; full depth below ~0.5 starves the painted tokens to a flat
// void that contaminates the whole frame (kept available as "all · harsh").

import { $, VAE_SCALE, PATCH } from '/app/ui/util.js';

export function initGate(ctx) {
  // ── gate paint state ───────────────────────────────────────────────────
  let gateCapture = null;      // {rows,cols,data,text_seq,img_len,gridW,gridH,
                               //  heatNorm,msgUsed,baseBitmap,baseW,baseH}
  let gateMaskValues = null;   // Float32Array(gridW*gridH), 1.0 = untouched
  let gateDown = false;
  let gateStrokeDirty = false; // mask changed since the last applied render
  let gateResultBitmap = null; // last painted render (wipes against base)
  let gateWipe = 0.45;         // divider position, 0..1 of result width
  let gatePendingApply = false;

  function gateStatus(msg, kind) {
    const el = $('gate-status-text'); el.textContent = msg; el.className = kind || '';
  }

  const gatePaintCanvas = $('gate-paint');
  const gatePaintCtx = gatePaintCanvas.getContext('2d');
  const gateResultCanvas = $('gate-result');
  const gateResultCtx = gateResultCanvas.getContext('2d');
  const gateTintCanvas = document.createElement('canvas');  // grid-sized heat+stroke tint
  const gateTintCtx = gateTintCanvas.getContext('2d');
  const GATE_MASK_MIN = 0.4, GATE_MASK_MAX = 1.25;   // sweep clamp — past this the probe cliffs

  function hasGatePaint() {
    if (!gateCapture || !gateMaskValues) return false;
    for (let i = 0; i < gateMaskValues.length; i++)
      if (gateMaskValues[i] !== 1.0) return true;
    return false;
  }

  // Rows of the captured per-block gate means the current depth band covers —
  // the heat overlay shows the blocks the mask will actually multiply.
  function gateBandRows() {
    const rows = gateCapture.rows;
    const band = $('gate-band').value;
    if (band === 'early') return [0, Math.min(8, rows)];
    if (band === 'all') return [0, rows];
    return [Math.min(19, rows - 1), rows];
  }
  function computeHeatmapMean() {
    const cols = gateCapture.cols, data = gateCapture.data;
    const img_len = gateCapture.img_len, text_seq = gateCapture.text_seq;
    const band = gateBandRows();
    const out = new Float64Array(img_len);
    for (let r = band[0]; r < band[1]; r++) {
      const off = r * cols + text_seq;
      for (let i = 0; i < img_len; i++) out[i] += data[off + i];
    }
    for (let i = 0; i < img_len; i++) out[i] /= (band[1] - band[0]) || 1;
    // Percentile remap for display: 0 at the median, 1 at p95. Min-max left
    // the whole image mid-high (an amber wash) — this keeps the glow on the
    // genuinely hottest regions whatever the distribution's shape.
    const sorted = Float64Array.from(out).sort();
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const span = (p95 - p50) || 1;
    const norm = new Float32Array(img_len);
    for (let i = 0; i < img_len; i++) {
      norm[i] = Math.max(0, Math.min(1, (out[i] - p50) / span));
    }
    return norm;
  }

  // The paint surface: the captured render, an optional amber heat tint
  // (bright where the model writes hard), and the strokes (blue = drain,
  // orange = boost). Tints live on a grid-sized canvas upscaled with
  // smoothing so the token grid reads as soft regions, not blocks.
  function renderGatePaint() {
    if (!gateCapture) return;
    const gridW = gateCapture.gridW, gridH = gateCapture.gridH;
    gatePaintCtx.drawImage(gateCapture.baseBitmap, 0, 0);
    const img = gateTintCtx.createImageData(gridW, gridH);
    const showHeat = $('gate-heat-toggle').checked;
    for (let i = 0; i < gridW * gridH; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      if (showHeat) {
        r = 255; g = 190; b = 90;
        a = Math.pow(gateCapture.heatNorm[i], 1.5) * 0.45;
      }
      const pv = gateMaskValues[i];
      if (pv !== 1.0) {                       // strokes win over heat
        const t = pv - 1.0;
        a = Math.min(1, Math.abs(t) / (t < 0 ? 0.5 : 0.2)) * 0.6;
        if (t < 0) { r = 90; g = 150; b = 255; }
        else { r = 235; g = 150; b = 60; }
      }
      img.data[4 * i + 0] = r; img.data[4 * i + 1] = g; img.data[4 * i + 2] = b;
      img.data[4 * i + 3] = Math.round(a * 255);
    }
    gateTintCtx.putImageData(img, 0, 0);
    gatePaintCtx.imageSmoothingEnabled = true;
    gatePaintCtx.drawImage(gateTintCanvas, 0, 0, gateCapture.baseW, gateCapture.baseH);
  }

  // The result pane wipes base (left) against the painted render (right).
  function renderGateResult() {
    if (!gateCapture) return;
    const w = gateCapture.baseW, h = gateCapture.baseH;
    if (gateResultCanvas.width !== w || gateResultCanvas.height !== h) {
      gateResultCanvas.width = w; gateResultCanvas.height = h;
    }
    gateResultCtx.drawImage(gateCapture.baseBitmap, 0, 0);
    if (!gateResultBitmap) return;
    const wx = Math.round(Math.max(0, Math.min(1, gateWipe)) * w);
    if (wx < w) {
      gateResultCtx.drawImage(gateResultBitmap, wx, 0, w - wx, h, wx, 0, w - wx, h);
    }
    gateResultCtx.fillStyle = 'rgba(255,255,255,0.75)';
    gateResultCtx.fillRect(Math.max(0, wx - 1), 0, 2, h);
    $('gate-result-hint').style.display = 'none';
  }
  let gateWipeDown = false;
  function gateWipeTo(e) {
    const rect = gateResultCanvas.getBoundingClientRect();
    gateWipe = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    renderGateResult();
  }
  gateResultCanvas.addEventListener('pointerdown', (e) => {
    if (!gateResultBitmap) return;
    gateWipeDown = true;
    if (gateResultCanvas.setPointerCapture) gateResultCanvas.setPointerCapture(e.pointerId);
    gateWipeTo(e);
  });
  gateResultCanvas.addEventListener('pointermove', (e) => { if (gateWipeDown) gateWipeTo(e); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
    gateResultCanvas.addEventListener(ev, () => { gateWipeDown = false; });
  });

  function gatePointerToGrid(e) {
    const rect = gatePaintCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width * gateCapture.gridW,
      y: (e.clientY - rect.top) / rect.height * gateCapture.gridH,
    };
  }
  // Feathered airbrush: blend each covered token toward the brush value,
  // falling off to nothing at the rim (repeat passes deepen the stroke).
  function gatePaintAt(x, y) {
    const r = +$('gate-brush-radius').value;
    const target = +$('gate-brush-target').value;
    const gridW = gateCapture.gridW, gridH = gateCapture.gridH;
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(gridW - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(gridH - 1, Math.ceil(y + r));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx + 0.5 - x, dy = yy + 0.5 - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > r) continue;
        const w = Math.pow(1 - d / r, 1.5);
        const i = yy * gridW + xx;
        gateMaskValues[i] += (target - gateMaskValues[i]) * w;
      }
    }
    gateStrokeDirty = true;
    renderGatePaint();
  }
  gatePaintCanvas.addEventListener('pointerdown', (e) => {
    if (!gateCapture) return;
    gateDown = true;
    if (gatePaintCanvas.setPointerCapture) gatePaintCanvas.setPointerCapture(e.pointerId);
    const p = gatePointerToGrid(e); gatePaintAt(p.x, p.y);
  });
  gatePaintCanvas.addEventListener('pointermove', (e) => {
    if (!gateDown || !gateCapture) return;
    const p = gatePointerToGrid(e); gatePaintAt(p.x, p.y);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
    gatePaintCanvas.addEventListener(ev, () => {
      if (!gateDown) return;
      gateDown = false;
      // the stroke is the gesture — render it without a separate Apply
      if (gateStrokeDirty) doGateApply();
      ctx.refreshButtons();
    });
  });

  function doGateCapture() {
    if (!ctx.loaded || ctx.busy) return;
    const msg = ctx.buildGenerateMsg('full');
    msg.captureGates = true;
    ctx.persist();
    ctx.setBusy(true);
    gateStatus('capturing gates — one full render…');
    $('gate-timing').textContent = '';
    ctx.client.send(msg, (err, resp) => {
      ctx.setBusy(false);
      if (err) { gateStatus(String(err.message || err), 'err'); return; }
      const H_lat = msg.opts.height / VAE_SCALE, W_lat = msg.opts.width / VAE_SCALE;
      const gridH = Math.round(H_lat / PATCH), gridW = Math.round(W_lat / PATCH);
      const img_len = gridW * gridH;
      const gates = resp.gates;
      const text_seq = gates.cols - img_len;
      gateCapture = {
        rows: gates.rows, cols: gates.cols, data: gates.data,
        text_seq: text_seq, img_len: img_len, gridW: gridW, gridH: gridH, msgUsed: msg,
        baseBitmap: resp.bitmap, baseW: resp.width, baseH: resp.height,
      };
      gateCapture.heatNorm = computeHeatmapMean();
      gateMaskValues = new Float32Array(gridW * gridH).fill(1.0);
      gateStrokeDirty = false;
      gateResultBitmap = null;
      gatePaintCanvas.width = resp.width; gatePaintCanvas.height = resp.height;
      gateTintCanvas.width = gridW; gateTintCanvas.height = gridH;
      clearGateStrip();
      renderGatePaint();
      renderGateResult();
      $('gate-hint').style.display = 'none';
      ctx.refreshButtons();
      gateStatus('captured a ' + gridW + '×' + gridH + ' gate grid · stroke the image to paint it', 'ok');
    });
  }
  function doGateClear() {
    if (!gateCapture) return;
    gateMaskValues.fill(1.0);
    gateStrokeDirty = false;
    gateResultBitmap = null;
    clearGateStrip();
    renderGatePaint();
    renderGateResult();
    ctx.refreshButtons();
    gateStatus('paint cleared', 'ok');
  }

  // Scale a grid mask's deviation from neutral by k, clamped clear of the
  // starvation cliff the probes found below ~0.4.
  function scaledGateMask(src, k) {
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) {
      out[i] = Math.max(GATE_MASK_MIN,
               Math.min(GATE_MASK_MAX, 1 + (src[i] - 1) * k));
    }
    return out;
  }
  function buildGateMaskMsg(gridVals) {
    const flat = new Float32Array(gateCapture.text_seq + gateCapture.img_len);
    flat.fill(1.0);
    for (let i = 0; i < gridVals.length; i++) flat[gateCapture.text_seq + i] = gridVals[i];
    const msg = Object.assign({}, gateCapture.msgUsed);
    msg.captureGates = false;
    msg.gateMask = flat;
    msg.gateMaskBand = $('gate-band').value;
    return msg;
  }
  function doGateApply() {
    if (!gateCapture) return;
    if (ctx.busy) { gatePendingApply = true; return; }
    gateStrokeDirty = false;
    ctx.setBusy(true);
    gateStatus('rendering the painted mask…');
    ctx.client.send(buildGateMaskMsg(gateMaskValues), (err, resp) => {
      ctx.setBusy(false);
      if (err) { gateStatus(String(err.message || err), 'err'); return; }
      gateResultBitmap = resp.bitmap;
      renderGateResult();
      gateStatus('done · drag the result divider to compare', 'ok');
      $('gate-timing').textContent = resp.ms ? resp.ms + ' ms' : '';
    });
  }

  // Dose strip: the current strokes at five strengths, weakest to strongest.
  // Click a frame to keep that strength (the mask rescales to match).
  const GATE_SWEEP = [0.25, 0.5, 1.0, 1.5, 2.0];
  function clearGateStrip() {
    $('gate-strip').innerHTML = '';
    $('gate-strip').classList.remove('show');
  }
  function doGateSweep() {
    if (!hasGatePaint() || ctx.busy) return;
    const snapshot = gateMaskValues.slice();
    const strip = $('gate-strip');
    strip.innerHTML = '';
    strip.classList.add('show');
    const cells = GATE_SWEEP.map((k) => {
      const cell = document.createElement('div');
      cell.className = 'strip-cell';
      const cv = document.createElement('canvas');
      cv.width = gateCapture.baseW; cv.height = gateCapture.baseH;
      const label = document.createElement('span');
      label.className = 'strip-label';
      label.textContent = '×' + k;
      cell.appendChild(cv);
      cell.appendChild(label);
      strip.appendChild(cell);
      return { k: k, cell: cell, cv: cv, bitmap: null };
    });
    function adopt(c) {
      if (ctx.busy) return;
      gateMaskValues.set(scaledGateMask(snapshot, c.k));
      cells.forEach((o) => o.cell.classList.toggle('sel', o === c));
      gateResultBitmap = c.bitmap;
      renderGatePaint();
      renderGateResult();
      gateStatus('kept ×' + c.k + ' — painting continues from here', 'ok');
    }
    ctx.setBusy(true);
    let idx = 0;
    gateStatus('sweeping stroke strength — 5 renders…');
    (function next() {
      if (idx >= cells.length) {
        ctx.setBusy(false);
        gateStatus('sweep done · click a frame to keep that strength', 'ok');
        return;
      }
      const c = cells[idx++];
      ctx.client.send(buildGateMaskMsg(scaledGateMask(snapshot, c.k)), (err, resp) => {
        if (err) { ctx.setBusy(false); gateStatus(String(err.message || err), 'err'); return; }
        c.bitmap = resp.bitmap;
        c.cv.getContext('2d').drawImage(resp.bitmap, 0, 0);
        c.cell.addEventListener('click', () => adopt(c));
        gateStatus('sweeping stroke strength — ' + idx + '/5…');
        next();
      });
    })();
  }

  $('gate-brush-target').addEventListener('input', () => {
    $('gate-brush-target-val').textContent = (+$('gate-brush-target').value).toFixed(2);
  });
  $('btn-gate-capture').addEventListener('click', doGateCapture);
  $('btn-gate-clear').addEventListener('click', doGateClear);
  $('btn-gate-sweep').addEventListener('click', doGateSweep);
  $('gate-heat-toggle').addEventListener('change', () => { if (gateCapture) renderGatePaint(); });
  $('gate-band').addEventListener('change', () => {
    if (!gateCapture) return;
    gateCapture.heatNorm = computeHeatmapMean();  // heat tracks the band the mask touches
    renderGatePaint();
    if (hasGatePaint()) doGateApply();            // re-render strokes at the new depth
  });

  ctx.onRefreshButtons((busyOrUnloaded) => {
    $('btn-gate-capture').disabled = busyOrUnloaded;
    $('btn-gate-sweep').disabled = busyOrUnloaded || !hasGatePaint();
  });
  ctx.onIdle(() => {
    // a stroke finished while a render was in flight — apply it now
    if (gatePendingApply) { gatePendingApply = false; doGateApply(); }
  });
}
