import { lastTrace } from "/app/lib/state.js";
import { el, mkCanvas } from "/app/lib/helpers.js";

export function renderWave(body, s) {
  const W = 1100, H = 120, mid = H / 2;
  const cv = mkCanvas(body, W, H);
  const ctx = cv.getContext('2d');
  const d = s.data, n = d.length, per = Math.max(1, Math.floor(n / W));
  let peak = 1e-6;
  for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  ctx.strokeStyle = '#5aa0e0';
  for (let x = 0; x < W; x++) {
    let lo = 0, hi = 0;
    const s0 = x * per, s1 = Math.min(n, s0 + per);
    for (let i = s0; i < s1; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
    const y0 = mid - (hi / peak) * mid, y1 = mid - (lo / peak) * mid;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1 + 0.5); ctx.stroke();
  }
}

// Diverging colormap: blue (neg) -> dark (0) -> amber (pos).
export function divColor(t) {
  t = t < -1 ? -1 : t > 1 ? 1 : t;
  const base = [14, 18, 24];
  const pos = [235, 150, 70], neg = [90, 175, 255];
  const to = t >= 0 ? pos : neg, m = Math.abs(t);
  return [
    base[0] + (to[0] - base[0]) * m,
    base[1] + (to[1] - base[1]) * m,
    base[2] + (to[2] - base[2]) * m,
  ];
}

// A reference signal (F0 / energy) from the current trace, resampled to width w.
export function getRef(name, w) {
  if (!lastTrace) return null;
  const s = lastTrace.stages.find((x) => x.name === name);
  if (!s) return null;
  const ref = s.data, R = ref.length, out = new Float32Array(w);
  for (let x = 0; x < w; x++) out[x] = ref[Math.floor(x * R / w)];
  return out;
}

// Channel (row) order for a heatmap. 'native' = as stored; 'variance' = most
// active channels first; 'f0'/'energy' = sorted by correlation to that contour,
// so channels that track pitch/energy cluster together. This is the first
// "derived" view: a question-driven reordering of an opaque latent.
export function channelOrder(s, mode) {
  const { h, w, data } = s;
  const idx = Array.from({ length: h }, (_, i) => i);
  if (mode === 'native') return idx;

  const score = new Float64Array(h);
  if (mode === 'variance') {
    for (let c = 0; c < h; c++) {
      const base = c * w; let m = 0;
      for (let x = 0; x < w; x++) m += data[base + x]; m /= w;
      let v = 0; for (let x = 0; x < w; x++) { const dd = data[base + x] - m; v += dd * dd; }
      score[c] = v;
    }
  } else {
    const ref = getRef(mode === 'f0' ? 'F0_pred' : 'N_pred', w);
    if (!ref) return idx;
    let rm = 0; for (let x = 0; x < w; x++) rm += ref[x]; rm /= w;
    let rv = 0; for (let x = 0; x < w; x++) { const dd = ref[x] - rm; rv += dd * dd; }
    rv = Math.sqrt(rv) || 1;
    for (let c = 0; c < h; c++) {
      const base = c * w; let m = 0;
      for (let x = 0; x < w; x++) m += data[base + x]; m /= w;
      let cov = 0, sv = 0;
      for (let x = 0; x < w; x++) { const a = data[base + x] - m; cov += a * (ref[x] - rm); sv += a * a; }
      score[c] = cov / ((Math.sqrt(sv) || 1) * rv);
    }
  }
  idx.sort((a, b) => score[b] - score[a]);
  return idx;
}

export function renderHeat(body, s) {
  // robust z-score scale: subtract the mean, scale by 3σ, clip — so a few
  // outliers no longer crush the bulk to black (the bert_dur / gen_in problem).
  let m = 0; for (let i = 0; i < s.data.length; i++) m += s.data[i]; m /= s.data.length;
  let v = 0; for (let i = 0; i < s.data.length; i++) { const dd = s.data[i] - m; v += dd * dd; }
  const sd = Math.sqrt(v / s.data.length) || 1;

  const dispW = Math.min(s.w, 1100);
  const dispH = Math.max(120, Math.min(s.h, 420));   // give thin stages real height

  // row-ordering control
  const ctrl = el('div', 'heat-ctrl');
  ctrl.appendChild(el('span', 'ctrl-label', 'rows:'));
  const sel = document.createElement('select');
  [['native', 'native'], ['variance', 'by variance'],
   ['f0', 'by F0 corr'], ['energy', 'by energy corr']].forEach(([val, txt]) => {
    const o = document.createElement('option'); o.value = val; o.textContent = txt; sel.appendChild(o);
  });
  ctrl.appendChild(sel);
  body.appendChild(ctrl);

  const cv = mkCanvas(body, dispW, dispH);
  const ctx = cv.getContext('2d');
  const note = el('div', 'axis-note', '');
  body.appendChild(note);

  function draw(mode) {
    const order = channelOrder(s, mode);
    const img = ctx.createImageData(dispW, dispH);
    for (let y = 0; y < dispH; y++) {
      const sc = order[Math.floor(y * s.h / dispH)], base = sc * s.w;
      for (let x = 0; x < dispW; x++) {
        const sx = Math.floor(x * s.w / dispW);
        const c = divColor((s.data[base + sx] - m) / (3 * sd));
        const o = (y * dispW + x) * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    note.textContent = 'rows = ' + s.h + ' (channel' + (mode === 'native' ? '' : ', ' + mode + '-ordered') +
      ')  ·  cols = ' + s.w + '  ·  z-scored: blue below-avg, amber above-avg (μ ' +
      m.toFixed(2) + ' σ ' + sd.toFixed(2) + ')';
  }
  sel.addEventListener('change', () => draw(sel.value));
  draw('native');
}

