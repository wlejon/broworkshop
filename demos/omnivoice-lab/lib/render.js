// ═══ render — the cards: waveform · grid · unmask heatmap · steps · confidence ═
// Every frame-aligned card shares one backing width and one left gutter so a
// frame maps to the same x on each (x = GX + f·(W−GX)/T), and the selection /
// cursor overlays line up across them. Cards are persistent: one <canvas> plus
// one overlay each, resized and redrawn in place, never rebuilt.
import { $, NQ, MASK, FPS, current } from "/app/lib/state.js";
import { el, codeColor, stepColor, confColor, clamp, fmtSecs } from "/app/lib/helpers.js";
import { sel, cbs, showChanges, buildGridTools, wireSelectable } from "/app/lib/grid.js";

export const W = 1180, GX = 30;
export const GRID_ROW = 18, HEAT_ROW = 13;
export function frameX(f, T) { return GX + f * (W - GX) / T; }
export function xFrame(x, T) { return clamp(((x - GX) * T / (W - GX)) | 0, 0, T - 1); }
export function frameTime(f) { return f / FPS; }

// ── cards ────────────────────────────────────────────────────────────────────
export const cards = {};
const ORDER = ['audio', 'grid', 'unmask', 'steps', 'confidence'];
function card(name, title, desc) {
  let c = cards[name];
  if (c) return c;
  const wrap = el('div', 'card'); wrap.id = 'card-' + name;
  const head = el('div', 'card-head');
  head.appendChild(el('span', 'card-title', title));
  head.appendChild(el('span', 'card-desc', desc));
  wrap.appendChild(head);
  const body = el('div', 'card-body');
  const tools = el('div', 'card-tools'); tools.style.display = 'none'; body.appendChild(tools);
  const cwrap = el('div', 'canvas-wrap');
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = 40;
  const overlay = document.createElement('canvas'); overlay.className = 'overlay'; overlay.width = W; overlay.height = 40;
  cwrap.appendChild(canvas); cwrap.appendChild(overlay);
  body.appendChild(cwrap);
  const note = el('div', 'axis-note', '');
  body.appendChild(note);
  wrap.appendChild(body);
  // keep the DOM order stable whatever order the cards get created in
  const host = $('#stages');
  const after = ORDER.slice(ORDER.indexOf(name) + 1).map((n) => cards[n]).find(Boolean);
  if (after) host.insertBefore(wrap, after.wrap); else host.appendChild(wrap);
  c = cards[name] = { wrap, body, tools, canvas, ctx: canvas.getContext('2d'), overlay, octx: overlay.getContext('2d'), note, head };
  return c;
}
function size(c, H) {
  if (c.canvas.height !== H) c.canvas.height = H;
  if (c.canvas.width !== W) c.canvas.width = W;
  if (c.overlay.height !== H) c.overlay.height = H;
  if (c.overlay.width !== W) c.overlay.width = W;
  c.ctx.clearRect(0, 0, W, H);
  return c.ctx;
}

// Fill an 8-row cell raster from a colour table (NQ*T entries of [r,g,b] or null).
function drawCells(ctx, T, rowH, colorAt) {
  const H = NQ * rowH;
  ctx.fillStyle = '#0e1218'; ctx.fillRect(0, 0, W, H);
  const cols = new Uint8Array(NQ * T * 3), has = new Uint8Array(NQ * T);
  for (let q = 0; q < NQ; q++) for (let t = 0; t < T; t++) {
    const c = colorAt(q, t); if (!c) continue;
    const i = q * T + t; cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2]; has[i] = 1;
  }
  const img = ctx.createImageData(W - GX, H), d = img.data, cw = (W - GX) / T;
  const tOfX = new Int32Array(W - GX);
  for (let x = 0; x < W - GX; x++) tOfX[x] = Math.min(T - 1, (x / cw) | 0);
  for (let y = 0; y < H; y++) {
    const q = Math.min(NQ - 1, (y / rowH) | 0), base = q * T, row = y * (W - GX);
    const sep = (y % rowH) === rowH - 1;
    for (let x = 0; x < W - GX; x++) {
      const i = base + tOfX[x], o = (row + x) * 4;
      if (has[i]) { d[o] = cols[i * 3]; d[o + 1] = cols[i * 3 + 1]; d[o + 2] = cols[i * 3 + 2]; }
      else { d[o] = 14; d[o + 1] = 18; d[o + 2] = 26; }
      if (sep) { d[o] = (d[o] * 0.6) | 0; d[o + 1] = (d[o + 1] * 0.6) | 0; d[o + 2] = (d[o + 2] * 0.6) | 0; }
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, GX, 0);
  ctx.fillStyle = '#8b94a3'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
  for (let q = 0; q < NQ; q++) ctx.fillText('q' + q, 4, q * rowH + rowH * 0.5 + 3.5);
}

// ── overlays: selection · cursor · re-roll mask + changes ────────────────────
let cursorFrame = -1;
let liveT = 0;
export function setCursor(f, info) {
  cursorFrame = f;
  const r = $('#readout');
  if (f < 0) r.textContent = current ? current.name + ' · ' + current.numFrames + ' frames · hover the grid to read a cell · drag to select a span' : 'generate a take, then hover the grid to read a cell';
  else r.textContent = 'frame ' + f + ' · t = ' + frameTime(f).toFixed(2) + ' s' + (info || '');
  redrawOverlays();
}
export function redrawOverlays() {
  if (!current) return;
  const T = current.numFrames;
  for (const name of ['audio', 'grid', 'unmask', 'confidence']) {
    const c = cards[name]; if (!c) continue;
    const H = c.overlay.height, o = c.octx;
    o.clearRect(0, 0, W, H);
    const rowH = name === 'grid' ? GRID_ROW : HEAT_ROW;
    // the re-roll mask outline + dimming of the unchanged masked cells (grid only)
    if (name === 'grid' && current.masked) {
      const m = current.masked, ch = current.changed;
      o.fillStyle = 'rgba(0,0,0,0.55)';
      for (let q = 0; q < NQ; q++) {
        let t = 0;
        while (t < T) {
          if (!m[q * T + t]) { t++; continue; }
          let t1 = t; while (t1 < T && m[q * T + t1]) t1++;
          o.strokeStyle = 'rgba(255,216,106,0.9)'; o.lineWidth = 1;
          o.strokeRect(frameX(t, T) + 0.5, q * rowH + 0.5, frameX(t1, T) - frameX(t, T) - 1, rowH - 1);
          if (showChanges && ch) for (let k = t; k < t1; k++) if (!ch[q * T + k]) o.fillRect(frameX(k, T), q * rowH + 1, frameX(k + 1, T) - frameX(k, T), rowH - 2);
          t = t1;
        }
      }
    }
    // segment boundaries (chained / chunked takes)
    if (current.segments && current.segments.length > 1) {
      o.strokeStyle = 'rgba(127,212,166,0.7)'; o.setLineDash([3, 3]); o.lineWidth = 1;
      let off = 0;
      for (let i = 0; i < current.segments.length - 1; i++) {
        off += current.segments[i].frames;
        const x = Math.round(frameX(off, T)) + 0.5;
        o.beginPath(); o.moveTo(x, 0); o.lineTo(x, H); o.stroke();
      }
      o.setLineDash([]);
    }
    // the selection
    if (sel) {
      const a = frameX(sel.t0, T), b = frameX(sel.t1, T);
      o.fillStyle = 'rgba(143,208,255,0.18)';
      if (name === 'grid' || name === 'unmask' || name === 'confidence') {
        for (let q = 0; q < NQ; q++) if (cbs[q] || name !== 'grid') o.fillRect(a, q * rowH, b - a, rowH);
      } else o.fillRect(a, 0, b - a, H);
      o.strokeStyle = 'rgba(143,208,255,0.85)'; o.lineWidth = 1; o.strokeRect(a + 0.5, 0.5, b - a - 1, H - 1);
    }
    // the cursor column
    if (cursorFrame >= 0 && cursorFrame < T) {
      const x = frameX(cursorFrame, T), bw = Math.max(2, frameX(cursorFrame + 1, T) - x);
      o.fillStyle = 'rgba(255,255,255,0.12)'; o.fillRect(x, 0, bw, H);
      o.strokeStyle = 'rgba(255,216,106,0.9)'; o.strokeRect(x + 0.5, 0.5, bw - 1, H - 1);
    }
  }
}

// ── the cards for a take ─────────────────────────────────────────────────────
export function renderTake(take) {
  liveT = 0;
  renderWave(take);
  renderGrid(take);
  renderUnmask(take);
  renderSteps(take);
  renderConfidence(take);
  cursorFrame = -1;
  setCursor(-1);
}

function renderWave(take) {
  const c = card('audio', 'audio', 'the take\'s waveform on the frame axis — 24 kHz mono · drag to select a span');
  const H = 110, mid = H / 2, ctx = size(c, H), d = take.samples, n = d.length, T = take.numFrames;
  ctx.fillStyle = '#0e1218'; ctx.fillRect(0, 0, W, H);
  let peak = 1e-6; for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  const span = W - GX;
  ctx.strokeStyle = take.kind === 'reroll' ? '#e0b45a' : take.kind === 'chain' ? '#7fd4a6' : '#5aa0e0';
  for (let x = 0; x < span; x++) {
    let lo = 0, hi = 0; const s0 = Math.floor(x * n / span), s1 = Math.max(s0 + 1, Math.floor((x + 1) * n / span));
    for (let i = s0; i < s1 && i < n; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
    ctx.beginPath(); ctx.moveTo(GX + x, mid - (hi / peak) * (mid - 4)); ctx.lineTo(GX + x, mid - (lo / peak) * (mid - 4) + 0.5); ctx.stroke();
  }
  // second ticks
  ctx.fillStyle = '#5f6878'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
  for (let s = 0; s * FPS < T; s++) { const x = frameX(s * FPS, T); ctx.fillRect(x, H - 8, 1, 8); ctx.fillText(s + 's', x + 2, H - 1); }
  if (take.segments) {
    let off = 0; ctx.fillStyle = '#7fd4a6';
    for (const sg of take.segments) { ctx.fillText((sg.text || '').slice(0, 28), frameX(off, T) + 3, 11); off += sg.frames; }
  }
  const per = n / T;
  c.note.textContent = n + ' samples · ' + fmtSecs(n, take.sampleRate) + ' · ' + T + ' frames · ' + per.toFixed(1) + ' samples/frame' +
    (take.exact ? ' (decodeCodes: exactly 960, frame-aligned)' : ' (pipeline: silence-trimmed, faded, padded — alignment approximate)') +
    ' · peak ' + peak.toFixed(3);
  if (!c.wired) { wireSelectable(c.canvas, 0); c.wired = true; }
}

function renderGrid(take) {
  const c = card('grid', 'token grid', NQ + ' codebooks × T frames, colour = code id · row 0 is the semantic codebook (it unmasks first), 1–7 the acoustic ones · drag a span + tick codebooks, then re-roll');
  if (!c.toolsBuilt) { buildGridTools(c.tools); c.tools.style.display = 'flex'; c.toolsBuilt = true; }
  const T = take.numFrames, ctx = size(c, NQ * GRID_ROW), codes = take.codes;
  drawCells(ctx, T, GRID_ROW, (q, t) => { const v = codes[q * T + t]; return v >= 0 && v < MASK ? codeColor(v) : [40, 40, 50]; });
  let note = T + ' frames × ' + NQ + ' = ' + (NQ * T) + ' cells';
  if (take.rerollInfo) {
    const ri = take.rerollInfo;
    note += ' · re-roll (' + ri.preset + ', seed ' + ri.seed + '): ' + ri.changed + ' of ' + ri.masked + ' masked cells changed (' + (100 * ri.changed / Math.max(1, ri.masked)).toFixed(0) + '%)' +
            (ri.leaked ? ' · ' + ri.leaked + ' changed OUTSIDE the mask' : ' · nothing outside the mask changed') + ' · dimmed = masked but came back the same';
  }
  c.note.textContent = note;
  if (!c.wired) { wireSelectable(c.canvas, GRID_ROW); c.wired = true; }
}

function renderUnmask(take) {
  const c = card('unmask', 'unmask order', 'the step each cell committed at (dark blue = first, white = last; grey = kept by the init grid) · watch it fill in live during a generation');
  const T = take.numFrames, ctx = size(c, NQ * HEAT_ROW), st = take.unmaskStep, N = Math.max(1, (take.params && take.params.numSteps) || 1);
  if (!st) { c.note.textContent = 'no unmask trace on this take'; return; }
  let kept = 0, maxStep = 0;
  for (let i = 0; i < st.length; i++) { if (st[i] < 0) kept++; else if (st[i] > maxStep) maxStep = st[i]; }
  const den = Math.max(1, Math.max(maxStep, N - 1));
  drawCells(ctx, T, HEAT_ROW, (q, t) => { const s = st[q * T + t]; return s < 0 ? [70, 72, 84] : stepColor(s / den); });
  // per-row: mean commit step, to show the layer penalty ordering
  const rows = [];
  for (let q = 0; q < NQ; q++) { let s = 0, n = 0; for (let t = 0; t < T; t++) { const v = st[q * T + t]; if (v >= 0) { s += v; n++; } } rows.push(n ? (s / n).toFixed(1) : '—'); }
  c.note.textContent = N + ' steps · t-shift ' + (take.params.tShift != null ? take.params.tShift : '?') + ' · layer penalty ' + take.params.layerPenalty +
    ' · mean commit step per codebook: ' + rows.join(' / ') + (kept ? ' · ' + kept + ' cells kept (init)' : '');
  if (!c.wired) { wireSelectable(c.canvas, HEAT_ROW); c.wired = true; }
}

function renderSteps(take) {
  const c = card('steps', 'schedule', 'cells committed per step (bars — the t-shift warp shapes this) and the mean commit score of those cells (line) · LM / codec timings');
  const H = 120, ctx = size(c, H), segs = take.stepStats || [];
  ctx.fillStyle = '#0e1218'; ctx.fillRect(0, 0, W, H);
  let total = 0; for (const s of segs) total += s.length;
  if (!total) { c.note.textContent = 'no step trace on this take'; return; }
  let maxU = 1, lo = Infinity, hi = -Infinity;
  for (const s of segs) for (const st of s) { if (st.committed > maxU) maxU = st.committed; if (st.meanScore === st.meanScore) { if (st.meanScore < lo) lo = st.meanScore; if (st.meanScore > hi) hi = st.meanScore; } }
  if (!(hi > lo)) { lo = lo === Infinity ? 0 : lo - 1; hi = lo + 2; }
  const gap = 8, bw = (W - GX - gap * segs.length) / total;
  let x = GX;
  ctx.font = '10px sans-serif';
  segs.forEach((s, si) => {
    let px = null, py = null;
    for (const st of s) {
      const h = Math.max(1, st.committed / maxU * (H - 22));
      ctx.fillStyle = 'rgba(90,160,224,0.75)'; ctx.fillRect(x, H - 12 - h, Math.max(1, bw - 1), h);
      if (st.meanScore === st.meanScore) {
        const y = H - 12 - (st.meanScore - lo) / (hi - lo) * (H - 22);
        ctx.strokeStyle = '#ffd86a'; ctx.beginPath();
        if (px != null) { ctx.moveTo(px, py); ctx.lineTo(x + bw / 2, y); ctx.stroke(); }
        ctx.fillStyle = '#ffd86a'; ctx.fillRect(x + bw / 2 - 1, y - 1, 3, 3);
        px = x + bw / 2; py = y;
      }
      x += bw;
    }
    ctx.fillStyle = '#5f6878'; ctx.textAlign = 'right';
    ctx.fillText((segs.length > 1 ? 'seg ' + (si + 1) + ' · ' : '') + s.length + ' steps →', x - 3, H - 2);
    x += gap;
  });
  ctx.fillStyle = '#8b94a3'; ctx.textAlign = 'left';
  ctx.fillText('cells / step (bars) · mean commit score (line)', GX + 4, 10);
  ctx.fillText('max ' + maxU, 2, 22); ctx.fillText('0', 2, H - 12);
  const p = take.params || {};
  c.note.textContent = 'steps ' + p.numSteps + ' · t-shift ' + p.tShift + ' · guidance ' + p.guidanceScale + ' · position T ' + p.positionTemperature +
    ' · class T ' + p.classTemperature + ' · gumbel ' + (p.gumbelNoise ? 'on' : 'off') + ' · seed ' + p.seed +
    ' · LM ' + (take.lmSeconds || 0).toFixed(2) + ' s' + (take.codecSeconds ? ' · codec ' + take.codecSeconds.toFixed(2) + ' s' : '') +
    ' · wall ' + take.wallMs + ' ms' + (p.numSteps && take.lmSeconds ? ' · ' + (1000 * take.lmSeconds / p.numSteps / segs.length).toFixed(0) + ' ms/step' : '') +
    ' · mean score range ' + lo.toFixed(2) + ' … ' + hi.toFixed(2);
}

// The raw confidence the model committed each cell with: max CFG log-prob,
// before the layer penalty and before the position-temperature Gumbel noise.
// That is the honest "where did it hedge" signal — the unmask *score* is not,
// because subtracting codebook × layer_penalty makes every row live on its own
// scale, which the old per-codebook normalisation then papered over (it made
// each row look equally uncertain by construction). One global scale over the
// whole grid, and the actual log-prob on hover.
let confGrid = null, confT = 0;
function renderConfidence(take) {
  const c = card('confidence', 'commit confidence', 'the model\'s raw confidence at each cell when it committed — max CFG log-prob, no layer penalty, no noise (red = hedged, green = sure; one scale for the whole grid) · hover for the value · the re-roll seam: hedged cells are where a re-roll roams');
  const T = take.numFrames, ctx = size(c, NQ * HEAT_ROW), cf = take.commitConfidence;
  confGrid = null; confT = T;
  if (!cf) { c.note.textContent = 'no confidence grid on this take'; return; }
  confGrid = cf;
  let lo = Infinity, hi = -Infinity, n = 0, sum = 0;
  for (let i = 0; i < NQ * T; i++) { const v = cf[i]; if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; sum += v; n++; } }
  const rng = hi - lo;
  drawCells(ctx, T, HEAT_ROW, (q, t) => {
    const v = cf[q * T + t];
    if (v !== v) return [70, 72, 84];
    return confColor(rng > 0 ? (v - lo) / rng : 0.5);
  });
  // per-codebook means, to show that the raw confidence does NOT fall away by
  // codebook the way the penalised score does
  const rows = [];
  for (let q = 0; q < NQ; q++) {
    let s = 0, k = 0;
    for (let t = 0; t < T; t++) { const v = cf[q * T + t]; if (v === v) { s += v; k++; } }
    rows.push(k ? (s / k).toFixed(2) : '—');
  }
  c.note.textContent = n
    ? 'raw max CFG log-prob · scale ' + lo.toFixed(2) + ' (hedged) … ' + hi.toFixed(2) + ' (sure) · mean ' +
      (sum / n).toFixed(2) + ' · mean per codebook: ' + rows.join(' / ')
    : 'no finite confidence values on this take';
  if (!c.wired) { wireSelectable(c.canvas, HEAT_ROW); c.wired = true; }
  // The shared hover readout (grid.js) reports the unmask score; append this
  // card's own number after it, so the two are never confused.
  if (!c.confHover) {
    c.confHover = true;
    c.canvas.addEventListener('mousemove', (ev) => {
      if (!confGrid || !current) return;
      const r = c.canvas.getBoundingClientRect();
      const x = (ev.clientX - r.left) * (c.canvas.width / (r.width || c.canvas.width));
      const y = (ev.clientY - r.top) * (c.canvas.height / (r.height || c.canvas.height));
      if (x < GX) return;
      const q = clamp((y / HEAT_ROW) | 0, 0, NQ - 1), f = xFrame(x, confT);
      const v = confGrid[q * confT + f];
      $('#readout').textContent += ' · confidence ' + (v === v ? v.toFixed(3) : '—');
    });
  }
}

// ── live: the unmask heatmap filling in during a generation ──────────────────
let liveSteps = 0, liveLabel = '', liveKeep = null;
export function beginLive(T, numSteps, label, keep) {
  liveT = T; liveSteps = numSteps; liveLabel = label; liveKeep = keep || null;
  const c = card('unmask', 'unmask order', 'the step each cell committed at (dark blue = first, white = last; grey = kept by the init grid) · watch it fill in live during a generation');
  if (T > 0) {
    const ctx = size(c, NQ * HEAT_ROW);
    drawCells(ctx, T, HEAT_ROW, (q, t) => liveKeep && liveKeep[q * T + t] ? [70, 72, 84] : null);
    c.octx.clearRect(0, 0, W, c.overlay.height);
  }
  c.note.textContent = label + ' · waiting for step 1 / ' + numSteps + '…';
  $('#readout').textContent = label + ' · ' + T + ' frames · ' + numSteps + ' steps';
}
export function liveStep(rec, s) {
  const c = cards.unmask; if (!c) return;
  const g = rec.cur, T = g.T, N = Math.max(1, s.numSteps);
  if (liveT !== T) { liveT = T; size(c, NQ * HEAT_ROW); }
  const ctx = c.ctx;
  drawCells(ctx, T, HEAT_ROW, (q, t) => {
    const i = q * T + t;
    if (rec.keep && rec.segs.length === 1 && rec.keep[i]) return [70, 72, 84];
    const st = g.unmask[i];
    return st < 0 ? null : stepColor(st / Math.max(1, N - 1));
  });
  const st = g.stats[g.stats.length - 1];
  // A chunked synthesize restarts `step` at 0 per chunk, so the step object's
  // own chunk index places the boundary exactly — no inferring it from step 0.
  const nch = s.numChunks || 1;
  const segNote = nch > 1 ? 'chunk ' + ((s.chunk | 0) + 1) + ' / ' + nch + ' · '
                          : (rec.segs.length > 1 ? 'segment ' + rec.segs.length + ' · ' : '');
  c.note.textContent = liveLabel + ' · ' + segNote + 'step ' + (s.step + 1) + ' / ' + N + ' · +' + s.unmasked + ' cells · ' + st.masked + ' still masked' +
    (st.meanScore === st.meanScore ? ' · mean commit score ' + st.meanScore.toFixed(2) : '');
  $('#readout').textContent = c.note.textContent;
}
export function liveDone() { liveT = 0; if (current) setCursor(-1); }
