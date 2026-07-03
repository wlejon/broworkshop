// Node Forge — generalized latent-heatmap probe panel widget.
//
// Generalizes kokoro-lab/lib/heat.js's z-scored diverging-colormap render +
// channel-order-by-variance/correlation-to-a-reference-contour into a plain
// (h, w, data) row-major grid with a caller-supplied map of named reference
// signals (kokoro-lab hardcoded F0_pred/N_pred; here it's whatever the
// caller passes as opts.refs, e.g. {'F0 corr': f0Array, 'energy corr': nArray}).
//
// mount(container, stage, opts) is called directly by a node's own mount()
// (or re-called to refresh in place) — no panel-widget registry.
//   stage: {h, w, data}     row-major h*w Float32Array/number[]
//   opts.refs               optional {label: Float32Array} — each gets a
//                            "by <label>" row-order option, correlating each
//                            channel/row to that (width-w-resampled) contour.

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  // Diverging colormap: blue (neg) -> dark (0) -> amber (pos).
  function divColor(t) {
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

  function resample(ref, w) {
    const R = ref.length, out = new Float32Array(w);
    for (let x = 0; x < w; x++) out[x] = ref[Math.floor(x * R / w)];
    return out;
  }

  function channelOrder(stage, mode, refs) {
    const { h, w, data } = stage;
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
      const ref = refs && refs[mode] ? resample(refs[mode], w) : null;
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

  export function mountHeatmap(container, stage, opts) {
    opts = opts || {};
    container.textContent = '';
    let m = 0; for (let i = 0; i < stage.data.length; i++) m += stage.data[i]; m /= stage.data.length;
    let v = 0; for (let i = 0; i < stage.data.length; i++) { const dd = stage.data[i] - m; v += dd * dd; }
    const sd = Math.sqrt(v / stage.data.length) || 1;

    const dispW = Math.min(stage.w, 1100);
    const dispH = Math.max(90, Math.min(stage.h, 340));

    const ctrl = el('div', 'heat-ctrl');
    ctrl.appendChild(el('span', null, 'rows:'));
    const sel = document.createElement('select');
    sel.className = 'form-input';
    const opt = (val, txt) => { const o = el('option', null, txt); o.value = val; sel.appendChild(o); };
    opt('native', 'native'); opt('variance', 'by variance');
    for (const label in (opts.refs || {})) opt(label, 'by ' + label);
    ctrl.appendChild(sel);
    container.appendChild(ctrl);

    const cv = document.createElement('canvas');
    cv.width = dispW; cv.height = dispH; cv.className = 'heat-canvas';
    container.appendChild(cv);
    const note = el('div', 'axis-note', '');
    container.appendChild(note);

    const ctx = cv.getContext('2d');
    function draw(mode) {
      const order = channelOrder(stage, mode, opts.refs);
      const img = ctx.createImageData(dispW, dispH);
      for (let y = 0; y < dispH; y++) {
        const sc = order[Math.floor(y * stage.h / dispH)], base = sc * stage.w;
        for (let x = 0; x < dispW; x++) {
          const sx = Math.floor(x * stage.w / dispW);
          const c = divColor((stage.data[base + sx] - m) / (3 * sd));
          const o = (y * dispW + x) * 4;
          img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      note.textContent = 'rows = ' + stage.h + (mode === 'native' ? '' : ' (' + mode + '-ordered)') +
        '  ·  cols = ' + stage.w + '  ·  z-scored (μ ' + m.toFixed(2) + ' σ ' + sd.toFixed(2) + ')';
    }
    sel.addEventListener('change', () => draw(sel.value));
    draw('native');
    return container;
  }
