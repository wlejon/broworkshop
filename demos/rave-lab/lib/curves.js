// ═══ the latent curve editor ═════════════════════════════════════════════════
// One editable contour per latent dimension. Dragging reshapes work[]; per-row
// buttons offer the common moves (reset / smooth / flatten / invert / nudge).
// Every edit re-decodes (debounced) so you hear the morph as you go.

import { $ } from "/app/lib/state.js";
import { work, enc, busy, runDecode, el } from "/app/lib/render.js";

let dimRanges = [];         // [mn,mx] per dim — fixed vertical frame for each curve
let curveCells = [];        // per-dim { cv, body, c, statsEl } — canvases persist, redraw in place
export let activePaint = null;     // in-progress curve drag {cv,c,mn,mx,W,H,pad,lastI,lastV}

const DIM_W = 1100, DIM_H = 96, DIM_PAD = 6;

function dimLabel(c) {
  if (c === 0) return 'dim 0 · loudness';
  if (c === 1) return 'dim 1 · pitch';
  return 'dim ' + c + ' · timbre';
}
function dimColor(c) {
  const hues = [42, 198, 150, 280, 16, 100, 320, 222];
  const h = hues[c % hues.length];
  return `hsl(${h},70%,64%)`;
}

function row(c) { return work.subarray(c * enc.frames, (c + 1) * enc.frames); }
function origRow(c) { return enc.latent.subarray(c * enc.frames, (c + 1) * enc.frames); }

// Fixed vertical frame per dim, taken from the ORIGINAL encoded curve with
// headroom so a drag up/down always has somewhere to go and the frame is stable
// across edits.
export function computeDimRanges() {
  dimRanges = [];
  for (let c = 0; c < enc.nLatent; c++) {
    const d = origRow(c);
    let mn = Infinity, mx = -Infinity;
    for (let t = 0; t < d.length; t++) { const v = d[t]; if (v < mn) mn = v; if (v > mx) mx = v; }
    const ctr = (mn + mx) / 2, half = Math.max((mx - mn) / 2, 0.5) * 1.8;
    dimRanges.push([ctr - half, ctr + half]);
  }
}

// Draw one contour: zero baseline, the original encoded curve as a faint ghost,
// then the current (edited) curve bright on top.
function drawDim(cv, c) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, pad = DIM_PAD;
  const [mn, mx] = dimRanges[c], range = (mx - mn) || 1;
  ctx.clearRect(0, 0, W, H);
  if (mn < 0 && mx > 0) {                       // zero baseline
    const zy = H - pad - ((0 - mn) / range) * (H - 2 * pad);
    ctx.strokeStyle = '#1b2330'; ctx.beginPath(); ctx.moveTo(0, zy); ctx.lineTo(W, zy); ctx.stroke();
  }
  const plot = (d, style, w) => {
    const n = d.length;
    ctx.strokeStyle = style; ctx.lineWidth = w; ctx.beginPath();
    for (let x = 0; x < W; x++) {
      const i = Math.floor(x * n / W);
      const y = H - pad - ((d[i] - mn) / range) * (H - 2 * pad);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  plot(origRow(c), '#39414f', 1);               // ghost of the encoded latent
  plot(row(c), dimColor(c), 1.6);               // current edited contour
}

function dimStats(c) {
  const d = row(c), o = origRow(c);
  let mn = Infinity, mx = -Infinity, delta = 0;
  for (let t = 0; t < d.length; t++) {
    const v = d[t]; if (v < mn) mn = v; if (v > mx) mx = v;
    delta += Math.abs(v - o[t]);
  }
  return `${mn.toFixed(2)} … ${mx.toFixed(2)}` + (delta > 1e-4 ? ` · Δ${delta.toFixed(1)}` : '');
}

function redrawDim(c) {
  const cell = curveCells[c]; if (!cell) return;
  drawDim(cell.cv, c);
  cell.statsEl.textContent = dimStats(c);
}

// ── per-dim edit ops (everything but the freehand drag) ──────────────────────
function opReset(c)   { row(c).set(origRow(c)); }
function opFlatten(c) { const d = row(c); let m = 0; for (let t = 0; t < d.length; t++) m += d[t]; m /= d.length; d.fill(m); }
function opInvert(c)  { const d = row(c); let m = 0; for (let t = 0; t < d.length; t++) m += d[t]; m /= d.length; for (let t = 0; t < d.length; t++) d[t] = 2 * m - d[t]; }
function opSmooth(c)  {
  const d = row(c), n = d.length, s = Float32Array.from(d);
  for (let t = 0; t < n; t++) {
    const a = s[Math.max(0, t - 1)], b = s[t], e = s[Math.min(n - 1, t + 1)];
    d[t] = (a + 2 * b + e) / 4;
  }
}
function opNudge(c, dv) { const d = row(c); for (let t = 0; t < d.length; t++) d[t] += dv; }

function applyOp(c, fn) {
  if (!enc || busy) return;
  fn();
  redrawDim(c);
  scheduleDecode();
}

let _decTimer = 0;
function scheduleDecode() {
  if (_decTimer) clearTimeout(_decTimer);
  _decTimer = setTimeout(() => { _decTimer = 0; runDecode($('#autoplay').checked); }, 40);
}

// ── build the grid ───────────────────────────────────────────────────────────
export function buildCurves() {
  const host = $('#curves');
  host.textContent = '';
  curveCells = [];
  for (let c = 0; c < enc.nLatent; c++) {
    const cell = el('div', 'curve-cell');
    const head = el('div', 'curve-head');
    head.appendChild(el('span', 'curve-name', dimLabel(c)));
    const stat = el('span', 'curve-stats', '');
    head.appendChild(stat);
    const tools = el('span', 'curve-tools');
    const btn = (label, title, fn) => {
      const b = el('button', 'tinybtn', label); b.title = title;
      b.addEventListener('click', () => applyOp(c, fn));
      tools.appendChild(b);
    };
    btn('↺', 'reset to encoded', () => opReset(c));
    btn('∼', 'smooth', () => opSmooth(c));
    btn('─', 'flatten to mean', () => opFlatten(c));
    btn('⤨', 'invert around mean', () => opInvert(c));
    btn('▲', 'nudge up (+0.5)', () => opNudge(c, 0.5));
    btn('▼', 'nudge down (−0.5)', () => opNudge(c, -0.5));
    head.appendChild(tools);
    cell.appendChild(head);

    const cv = document.createElement('canvas');
    cv.width = DIM_W; cv.height = DIM_H; cv.className = 'curve-canvas';
    cell.appendChild(cv);
    host.appendChild(cell);

    curveCells.push({ cv, body: cell, c, statsEl: stat });
    drawDim(cv, c);
    stat.textContent = dimStats(c);

    cv.addEventListener('mousedown', (e) => {
      if (busy || !enc) return;
      e.preventDefault();
      if (_decTimer) { clearTimeout(_decTimer); _decTimer = 0; }
      const [mn, mx] = dimRanges[c];
      activePaint = { cv, c, mn, mx, W: DIM_W, H: DIM_H, pad: DIM_PAD, lastI: -1, lastV: 0 };
      paintAt(e);
    });
  }
}

// Map mouse → (frame index, value), painting a continuous sweep into work[].
export function paintAt(e) {
  const p = activePaint; if (!p) return;
  const rect = p.cv.getBoundingClientRect();
  const xf = Math.max(0, Math.min(0.99999, (e.clientX - rect.left) / rect.width));
  const yPix = ((e.clientY - rect.top) / rect.height) * p.H;
  const d = row(p.c), n = d.length, i = Math.floor(xf * n);
  const v = p.mn + ((p.H - p.pad - yPix) / (p.H - 2 * p.pad)) * ((p.mx - p.mn) || 1);
  if (p.lastI >= 0 && p.lastI !== i) {                 // fill the gap since last column
    const a = Math.min(p.lastI, i), b = Math.max(p.lastI, i);
    const va = (p.lastI < i) ? p.lastV : v, vb = (p.lastI < i) ? v : p.lastV;
    for (let k = a; k <= b; k++) d[k] = va + (vb - va) * ((b === a) ? 0 : (k - a) / (b - a));
  } else { d[i] = v; }
  p.lastI = i; p.lastV = v;
  redrawDim(p.c);
}

// Finish a drag: re-decode the edited latent.
export function onPaintUp() {
  if (!activePaint) return;
  activePaint = null;
  runDecode($('#autoplay').checked);
}

export function resetAll() {
  if (!enc) return;
  work.set(enc.latent);
  for (let c = 0; c < enc.nLatent; c++) redrawDim(c);
  runDecode(false);
}
