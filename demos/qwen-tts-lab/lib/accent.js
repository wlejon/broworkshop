// ═══ ACCENT — a 2-D map over Qwen's language rows (every variant) ══════════════
// Qwen puts the language in ONE prefill position: the codec-embedding row of its
// language token. With English text, another language's row speaks the English
// words with that language's accent, so the space of rows is a space of accents.
// opts.languageVector REPLACES that row with any point, and qwen.languageEmbedding
// hands us each language's row, so the map is built from the model itself (no
// basis file):
//   · PCA over the language rows (N×N Gram, Jacobi) → orthonormal axes, σ-scaled.
//   · the MAP plots each language at its two dominant axes; drag the handle to move
//     those two (the rest held), click a language to snap to its exact row.
//   · fine-tune sliders for every axis, collapsed; `amount` scales the offset from
//     English (1 = the point as placed; >1 pushes further, still intelligible to
//     ~1.5 on 0.6B-Base, audio-research/ACCENT.md).
// At English with amount 1 nothing is sent, so the take is the plain language row.
// Moving anything streams the new accent on a short settle (scheduleLive).

import { $ } from "/app/lib/state.js";
import { el } from "/app/lib/helpers.js";
import { qwen } from "/app/lib/model.js";
import { scheduleLive } from "/app/lib/synth.js";

export let accentBasis = null;   // { names, dim, k, mean, comps, std, range, points, home }
let acoords = null;              // Float64Array(k) — σ-unit position
let amount = 1;
let cells = [], mapCanvas = null, mapCtx = null, dragging = false, wired = false;
const PAD = 18, SNAP_PX = 12;

// Build the basis from the loaded model's language rows. Hides the panel (null
// basis) when the runtime has no languageEmbedding (an older libbro).
export function loadAccentBasis() {
  accentBasis = null; acoords = null; amount = 1;
  if (!qwen || typeof qwen.languageEmbedding !== 'function') return;
  let names = [];
  try { names = qwen.languages() || []; } catch (e) { return; }
  if (names.length < 3) return;
  const rows = names.map((n) => Float64Array.from(qwen.languageEmbedding(n)));
  const N = rows.length, D = rows[0].length;
  const mean = new Float64Array(D);
  for (const r of rows) for (let d = 0; d < D; d++) mean[d] += r[d] / N;
  const X = rows.map((r) => r.map((v, d) => v - mean[d]));
  const G = new Float64Array(N * N);
  for (let i = 0; i < N; i++) for (let j = i; j < N; j++) {
    let s = 0; for (let d = 0; d < D; d++) s += X[i][d] * X[j][d];
    G[i * N + j] = G[j * N + i] = s;
  }
  const { eig, V } = jacobi(G, N);
  const order = [...eig.keys()].sort((a, b) => eig[b] - eig[a]);
  const k = N - 1, comps = [], std = [], range = [];
  const pts = names.map(() => new Float64Array(k));
  for (let a = 0; a < k; a++) {
    const q = order[a], v = new Float64Array(D);
    for (let i = 0; i < N; i++) { const u = V[i * N + q]; for (let d = 0; d < D; d++) v[d] += u * X[i][d]; }
    let nrm = 0; for (let d = 0; d < D; d++) nrm += v[d] * v[d]; nrm = Math.sqrt(nrm) || 1;
    for (let d = 0; d < D; d++) v[d] /= nrm;
    const sd = Math.sqrt(Math.max(0, eig[q]) / N) || 1;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < N; i++) {
      let s = 0; for (let d = 0; d < D; d++) s += X[i][d] * v[d];
      pts[i][a] = s / sd; lo = Math.min(lo, pts[i][a]); hi = Math.max(hi, pts[i][a]);
    }
    comps.push(v); std.push(sd); range.push([lo, hi]);
  }
  const home = Math.max(0, names.indexOf('english'));
  accentBasis = { names, dim: D, k, mean, comps, std, range, points: pts, home };
  acoords = Float64Array.from(pts[home]);
}

// Symmetric eigendecomposition (cyclic Jacobi) of an n×n row-major matrix.
function jacobi(Ain, n) {
  const A = Float64Array.from(Ain), V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i * n + j] * A[i * n + j];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      const apq = A[p * n + q]; if (Math.abs(apq) < 1e-300) continue;
      const phi = 0.5 * Math.atan2(2 * apq, A[q * n + q] - A[p * n + p]);
      const c = Math.cos(phi), s = Math.sin(phi);
      for (let r = 0; r < n; r++) { const x = A[r * n + p], y = A[r * n + q]; A[r * n + p] = c * x - s * y; A[r * n + q] = s * x + c * y; }
      for (let r = 0; r < n; r++) { const x = A[p * n + r], y = A[q * n + r]; A[p * n + r] = c * x - s * y; A[q * n + r] = s * x + c * y; }
      for (let r = 0; r < n; r++) { const x = V[r * n + p], y = V[r * n + q]; V[r * n + p] = c * x - s * y; V[r * n + q] = s * x + c * y; }
    }
  }
  return { eig: Array.from({ length: n }, (_, i) => A[i * n + i]), V };
}

// The language row for the current point: mean + Σ cₖ·stdₖ·compₖ, then pushed by
// `amount` along the offset from English. Null at English with amount 1 (no
// override, so the selected language's own row is used).
export function accentVector() {
  const b = accentBasis; if (!b) return null;
  if (amount === 1 && atPoint(b.home)) return null;
  const at = (c) => {
    const x = Float64Array.from(b.mean);
    for (let a = 0; a < b.k; a++) { const s = c[a] * b.std[a]; if (s) for (let d = 0; d < b.dim; d++) x[d] += s * b.comps[a][d]; }
    return x;
  };
  const p = at(acoords), h = at(b.points[b.home]), out = new Float32Array(b.dim);
  for (let d = 0; d < b.dim; d++) out[d] = h[d] + amount * (p[d] - h[d]);
  return out;
}
function atPoint(i) {
  const p = accentBasis.points[i];
  for (let a = 0; a < accentBasis.k; a++) if (Math.abs(acoords[a] - p[a]) > 1e-9) return false;
  return true;
}

// "russian 100%" / "between german + spanish · 1.30×" for the meta line.
export function accentSummary() {
  const b = accentBasis; if (!b) return '';
  let best = 0, bd = Infinity;
  for (let i = 0; i < b.names.length; i++) {
    let s = 0; for (let a = 0; a < b.k; a++) { const d = acoords[a] - b.points[i][a]; s += d * d; }
    if (s < bd) { bd = s; best = i; }
  }
  const where = bd < 1e-9 ? b.names[best] : 'near ' + b.names[best];
  return where + (amount !== 1 ? ' · ' + amount.toFixed(2) + '×' : '');
}

// ── the map ──────────────────────────────────────────────────────────────────
function dom(a) { const [lo, hi] = accentBasis.range[a]; const p = 0.22 * (hi - lo || 1); return [lo - p, hi + p]; }
function toPx(c0, c1) {
  const W = mapCanvas.width, H = mapCanvas.height, [x0, x1] = dom(0), [y0, y1] = dom(1);
  return [PAD + (c0 - x0) / (x1 - x0 || 1) * (W - 2 * PAD), H - PAD - (c1 - y0) / (y1 - y0 || 1) * (H - 2 * PAD)];
}
function fromPx(px, py) {
  const W = mapCanvas.width, H = mapCanvas.height, [x0, x1] = dom(0), [y0, y1] = dom(1);
  return [x0 + (px - PAD) / (W - 2 * PAD || 1) * (x1 - x0), y0 + (H - PAD - py) / (H - 2 * PAD || 1) * (y1 - y0)];
}

export function drawAccentMap() {
  if (!mapCtx || !accentBasis) return;
  const b = accentBasis, W = mapCanvas.width, H = mapCanvas.height, ctx = mapCtx;
  ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, W, H);
  const [hx0, hy0] = toPx(b.points[b.home][0], b.points[b.home][1]);
  const [hx, hy] = toPx(acoords[0], acoords[1]);
  // the line from English to the handle: the accent offset `amount` scales
  ctx.strokeStyle = '#2a3446'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(hx0, hy0); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.font = '10px sans-serif';
  // languages close on the two map axes can sit far apart on the others, so their
  // dots may crowd: nudge each label down past any label already placed over it
  const placed = [];
  for (let i = 0; i < b.names.length; i++) {
    const [px, py] = toPx(b.points[i][0], b.points[i][1]);
    ctx.fillStyle = i === b.home ? '#7fd4ff' : '#ffd166';
    ctx.beginPath(); ctx.arc(px, py, 4, 0, 6.2832); ctx.fill();
    const w = ctx.measureText(b.names[i]).width;
    let ly = py + 3;
    for (let moved = true; moved;) {
      moved = false;
      for (const r of placed)
        if (px + 6 < r.x + r.w && r.x < px + 6 + w && Math.abs(ly - r.y) < 11) { ly = r.y + 11; moved = true; }
    }
    placed.push({ x: px + 6, y: ly, w });
    if (ly !== py + 3) {   // tie a moved label back to its dot
      ctx.strokeStyle = '#2a3446'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px + 3, py + 2); ctx.lineTo(px + 6, ly - 3); ctx.stroke();
    }
    ctx.fillStyle = '#8b96a8'; ctx.fillText(b.names[i], px + 6, ly);
  }
  ctx.strokeStyle = '#0b0e14'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(hx, hy, 6.5, 0, 6.2832); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(hx, hy, 5, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hx, hy, 8.5, 0, 6.2832); ctx.stroke();
}

function nearest(px, py) {
  let bi = -1, bd = SNAP_PX * SNAP_PX;
  accentBasis.points.forEach((p, i) => {
    const [x, y] = toPx(p[0], p[1]), d = (x - px) * (x - px) + (y - py) * (y - py);
    if (d < bd) { bd = d; bi = i; }
  });
  return bi;
}
function evPx(ev) {
  const r = mapCanvas.getBoundingClientRect();
  return [(ev.clientX - r.left) * (mapCanvas.width / (r.width || mapCanvas.width)),
          (ev.clientY - r.top) * (mapCanvas.height / (r.height || mapCanvas.height))];
}

// Snap every axis to a language's exact row, or move only the two map axes.
export function snapAccent(name) {
  const i = accentBasis.names.indexOf(name); if (i < 0) return;
  acoords = Float64Array.from(accentBasis.points[i]); changed();
}
export function moveAccentTo(c0, c1) { acoords[0] = c0; acoords[1] = c1; changed(); }
export function setAccentAmount(v) { amount = v; const r = $('#accent-amount'); if (r) r.value = String(v); changed(); }
export function resetAccent() { amount = 1; if (accentBasis) acoords = Float64Array.from(accentBasis.points[accentBasis.home]); changed(); }

function changed() {
  for (let a = 0; a < cells.length; a++) { cells[a]._range.value = String(acoords[a]); cells[a]._val.textContent = acoords[a].toFixed(2); }
  const av = $('#accent-amount-val'); if (av) av.textContent = amount.toFixed(2) + '×';
  const r = $('#accent-amount'); if (r) r.value = String(amount);
  drawAccentMap();
  const m = $('#accent-meta'); if (m) m.textContent = accentBasis ? accentSummary() : '';
}

// ── build the panel ──────────────────────────────────────────────────────────
export function buildAccent() {
  const sec = $('#accent'); if (!sec) return;
  cells = [];
  if (!accentBasis) { sec.style.display = 'none'; return; }
  sec.style.display = 'flex';
  mapCanvas = $('#accent-map'); mapCtx = mapCanvas ? mapCanvas.getContext('2d') : null;
  if (mapCanvas && !wired) {
    wired = true;
    mapCanvas.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      const [px, py] = evPx(ev), i = nearest(px, py);
      if (i >= 0) { snapAccent(accentBasis.names[i]); dragging = false; }
      else { dragging = true; moveAccentTo(...fromPx(px, py)); }
      scheduleLive();
    });
    document.addEventListener('mousemove', (ev) => {
      if (!dragging) return;
      moveAccentTo(...fromPx(...evPx(ev))); scheduleLive();
    });
    document.addEventListener('mouseup', () => { dragging = false; });
    $('#accent-amount').addEventListener('input', (e) => { setAccentAmount(+e.target.value); scheduleLive(); });
    $('#btn-accent-reset').addEventListener('click', () => { resetAccent(); scheduleLive(); });
  }
  const root = $('#accent-sliders'); root.textContent = '';
  for (let a = 0; a < accentBasis.k; a++) {
    const cell = el('div', 'pc' + (a < 2 ? ' lead' : ''));
    const head = el('div', 'pc-head');
    head.appendChild(el('span', 'pc-name', 'A' + (a + 1)));
    head.appendChild(el('span', 'pc-hint', a < 2 ? 'map ' + (a === 0 ? 'x' : 'y') : ''));
    const val = el('span', 'pc-val', '0.00'); head.appendChild(val);
    cell.appendChild(head);
    const r = document.createElement('input'); r.type = 'range';
    const [lo, hi] = accentBasis.range[a];
    r.min = (lo * 1.3).toFixed(3); r.max = (hi * 1.3).toFixed(3); r.step = '0.01';
    r.addEventListener('input', () => { acoords[a] = +r.value; changed(); scheduleLive(); });
    cell.appendChild(r); cell._range = r; cell._val = val;
    cells.push(cell); root.appendChild(cell);
  }
  changed();
}
