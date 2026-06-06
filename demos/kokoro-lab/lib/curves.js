// Draw a contour into its canvas from s.data, fixed [mn,mx] vertical range.
function drawCurve(cv, s, color, mn, mx) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, pad = 6;
  const d = s.data, n = d.length, range = (mx - mn) || 1;
  ctx.clearRect(0, 0, W, H);
  if (mn < 0 && mx > 0) {                       // zero baseline if it's in range
    const zy = H - pad - ((0 - mn) / range) * (H - 2 * pad);
    ctx.strokeStyle = '#222b38'; ctx.beginPath(); ctx.moveTo(0, zy); ctx.lineTo(W, zy); ctx.stroke();
  }
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let x = 0; x < W; x++) {
    const i = Math.floor(x * n / W);
    const y = H - pad - ((d[i] - mn) / range) * (H - 2 * pad);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// F0_pred / N_pred are editable: drag to reshape the pitch / energy contour,
// then re-decode just the back half. Range is padded with upward headroom so a
// drag has somewhere to go; the drawn span is frozen for the duration of a card.
// Editable contour range: padded with upward headroom so a drag has somewhere to
// go. Recomputed from the current data on every draw / grab, so it stays correct
// even after the contour was reshaped in place.
function curveRange(s) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < s.data.length; i++) { const v = s.data[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  mn = Math.min(0, mn); mx = mx * 1.35 + (mx <= 0 ? 1 : 0);
  if (mn === mx) { mn -= 1; mx += 1; }
  return [mn, mx];
}

function renderCurve(body, s, color) {
  const W = 1100, H = 130, pad = 6;
  const cv = mkCanvas(body, W, H);
  const editable = (s.name === 'F0_pred' || s.name === 'N_pred');
  let mn, mx;
  if (editable) { [mn, mx] = curveRange(s); }
  else {
    mn = Infinity; mx = -Infinity;
    for (let i = 0; i < s.data.length; i++) { const v = s.data[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mn === mx) { mn -= 1; mx += 1; }
  }
  drawCurve(cv, s, color, mn, mx);

  const note = el('div', 'axis-note',
    (editable ? 'drag to reshape · ' : '') +
    'range ' + mn.toFixed(1) + ' … ' + mx.toFixed(1) + ' over ' + s.data.length + ' frames');
  if (editable) {
    const reset = el('span', 'curve-reset', '↺ reset');
    reset.addEventListener('click', () => resetSignal(s.name));
    note.appendChild(reset);
    cv.addEventListener('mousedown', (e) => {
      if (synthBusy || !lastTrace) return;
      e.preventDefault();                            // don't start a text selection
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = 0; }   // don't let a queued slider render fire mid-edit
      const [cmn, cmx] = curveRange(s);              // fresh range for the current contour
      activePaint = { cv, s, color, mn: cmn, mx: cmx, W, H, pad, lastI: -1, lastV: 0 };
      paintAt(e);
    });
  }
  body.appendChild(note);
}

// Map a mouse position onto (frame index, value) and paint it, linearly filling
// from the last painted column so a sweep draws a continuous contour.
function paintAt(e) {
  const p = activePaint; if (!p) return;
  const rect = p.cv.getBoundingClientRect();
  const xf = Math.max(0, Math.min(0.99999, (e.clientX - rect.left) / rect.width));
  const yPix = ((e.clientY - rect.top) / rect.height) * p.H;
  const n = p.s.data.length, i = Math.floor(xf * n);
  let v = p.mn + ((p.H - p.pad - yPix) / (p.H - 2 * p.pad)) * ((p.mx - p.mn) || 1);
  if (p.s.name === 'F0_pred') v = Math.max(0, v);     // pitch can't go negative
  if (p.lastI >= 0 && p.lastI !== i) {
    const a = Math.min(p.lastI, i), b = Math.max(p.lastI, i);
    const va = (p.lastI < i) ? p.lastV : v, vb = (p.lastI < i) ? v : p.lastV;
    for (let k = a; k <= b; k++) p.s.data[k] = va + (vb - va) * ((b === a) ? 0 : (k - a) / (b - a));
  } else { p.s.data[i] = v; }
  p.lastI = i; p.lastV = v;
  drawCurve(p.cv, p.s, p.color, p.mn, p.mx);
}

// Finish a drag: re-decode from the edited contours. (Installed once in init.)
function onPaintUp() {
  if (!activePaint) return;
  const name = activePaint.s.name;
  activePaint = null;
  protectedStage = name;  // keep the contour the user drew intact through the commit's re-render
  commitEdit();
  protectedStage = null;
}

