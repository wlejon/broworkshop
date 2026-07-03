// Tensor Lab — inspector panel.
//
// The right-hand pane. For a selected node it shows the live config form
// and the cost estimate; for a selected node *or* wire that already carries
// a value it visualises the tensor four ways — value heatmap, histogram,
// summary stats, and (for attention ops) the per-head attention matrix.
import { Ops, fmtNum, fmtMs } from "/app/lab/ops-registry.js";
import { Shape } from "/app/lab/shape.js";
import { Widgets } from "/app/lab/widgets.js";

  // ---- colour maps -----------------------------------------------------
  function lerp(a, b, t) { return a + (b - a) * t; }
  // diverging map for signed activations: blue -> dark -> amber
  function diverging(t) {
    if (t < 0) {
      const u = Math.min(1, -t);
      return [lerp(20, 56, u), lerp(24, 132, u), lerp(33, 230, u)];
    }
    const u = Math.min(1, t);
    return [lerp(20, 250, u), lerp(24, 158, u), lerp(33, 44, u)];
  }
  // sequential map for probabilities 0..1
  function sequential(t) {
    t = Math.max(0, Math.min(1, t));
    const stops = [
      [9, 12, 30], [37, 73, 110], [33, 145, 140], [160, 205, 90], [253, 240, 140],
    ];
    const f = t * (stops.length - 1), i = Math.min(stops.length - 2, f | 0), u = f - i;
    return [
      lerp(stops[i][0], stops[i + 1][0], u),
      lerp(stops[i][1], stops[i + 1][1], u),
      lerp(stops[i][2], stops[i + 1][2], u),
    ];
  }

  // ---- heatmap drawing -------------------------------------------------
  function drawHeatmap(canvas, data, rows, cols, mode) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#0d1018';
    ctx.fillRect(0, 0, W, H);
    if (!data || !data.length) return;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const amax = Math.max(Math.abs(mn), Math.abs(mx)) || 1;
    const dc = Math.min(cols, 240), dr = Math.min(rows, 170);
    const cw = W / dc, ch = H / dr;
    for (let r = 0; r < dr; r++) {
      const sr = (r / dr * rows) | 0;
      for (let c = 0; c < dc; c++) {
        const sc = (c / dc * cols) | 0;
        const v = data[sr * cols + sc];
        let col;
        if (mode === 'prob') col = sequential((v - mn) / ((mx - mn) || 1));
        else col = diverging(v / amax);
        ctx.fillStyle = 'rgb(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ')';
        ctx.fillRect(c * cw, r * ch, cw + 1, ch + 1);
      }
    }
  }

  function drawHistogram(canvas, data) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#0d1018';
    ctx.fillRect(0, 0, W, H);
    if (!data || !data.length) return;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const BINS = 48, bins = new Float64Array(BINS);
    const span = (mx - mn) || 1;
    for (let i = 0; i < data.length; i++) {
      let b = ((data[i] - mn) / span * BINS) | 0;
      if (b < 0) b = 0; if (b >= BINS) b = BINS - 1;
      bins[b]++;
    }
    let peak = 0;
    for (let i = 0; i < BINS; i++) peak = Math.max(peak, bins[i]);
    const bw = W / BINS;
    for (let i = 0; i < BINS; i++) {
      const h = (bins[i] / (peak || 1)) * (H - 18);
      const col = diverging((mn + (i + 0.5) / BINS * span) / (Math.max(Math.abs(mn), Math.abs(mx)) || 1));
      ctx.fillStyle = 'rgb(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ')';
      ctx.fillRect(i * bw + 0.5, H - 14 - h, bw - 1, h);
    }
    ctx.fillStyle = '#5b6577';
    ctx.font = '9px monospace';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText(mn.toFixed(3), 2, H - 2);
    ctx.textAlign = 'right';
    ctx.fillText(mx.toFixed(3), W - 2, H - 2);
  }

  function statsOf(data) {
    let mn = Infinity, mx = -Infinity, sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      sum += v;
    }
    const mean = sum / data.length;
    let varr = 0;
    for (let i = 0; i < data.length; i++) {
      const d = data[i] - mean;
      varr += d * d;
    }
    return { min: mn, max: mx, mean: mean, std: Math.sqrt(varr / data.length), count: data.length };
  }

  // ---- DOM helpers -----------------------------------------------------
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function create(panel, cb) {
    cb = cb || {};
    const state = { tab: 'heatmap', head: 0 };

    function kv(label, value) {
      const row = el('div', 'kv-row');
      row.appendChild(el('span', 'kv-k', label));
      row.appendChild(el('span', 'kv-v', value));
      return row;
    }

    // build the config form for a node
    function buildForm(node, def) {
      const form = el('div', 'form');
      if (!def.params.length) {
        form.appendChild(el('div', 'form-empty', 'No parameters.'));
        return form;
      }
      for (const f of def.params) {
        const row = el('div', 'form-row');
        row.appendChild(el('label', 'form-label', f.label));
        Widgets.getField(f.type).mount(row, node, f, { commit: (raw) => commit(node, f, raw) });
        form.appendChild(row);
      }
      return form;
    }

    // mount an op's custom panel widget (curve painter, basis slider+map,
    // ...), if its def() declares one. Returns null when the op has none —
    // the overwhelming majority today, since only a handful of models need
    // more than the generic scalar form above.
    function buildPanel(node, def) {
      if (!def.panel) return null;
      const widget = Widgets.getPanel(def.panel);
      if (!widget) return null;
      const sec = el('div', 'insp-section');
      sec.appendChild(el('div', 'insp-sec-title', def.panelLabel || 'Control'));
      const panelConfig = typeof def.panelConfig === 'function'
        ? def.panelConfig(node, def) : def.panelConfig;
      sec.appendChild(widget.mount(node, def, panelConfig, {
        // live edit tick (e.g. one frame of a paint drag) — incremental,
        // debounced re-run of just this node's downstream subgraph.
        onEdit() { if (cb.onWidgetEdit) cb.onWidgetEdit(node); },
        // gesture settled — same full propagate()+clearRun() path a plain
        // param-form edit already takes.
        onCommit() { if (cb.onParamChange) cb.onParamChange(); },
      }));
      return sec;
    }

    function commit(node, f, raw) {
      let v = raw;
      if (f.type === 'int') { v = parseInt(raw, 10) | 0; }
      else if (f.type === 'float') { v = parseFloat(raw); }
      if ((f.type === 'int' || f.type === 'float') && !isFinite(v)) v = f.def;
      if (f.min != null && v < f.min) v = f.min;
      if (f.max != null && v > f.max) v = f.max;
      node.params[f.key] = v;
      if (cb.onParamChange) cb.onParamChange();
    }

    // a tensor visualiser block (tabs + canvas + stats)
    function buildTensorView(getData, mode, titleText) {
      const sec = el('div', 'insp-section');
      sec.appendChild(el('div', 'insp-sec-title', titleText));
      const tabs = el('div', 'tabs');
      ['heatmap', 'histogram', 'stats'].forEach((name) => {
        const t = el('button', 'tab' + (state.tab === name ? ' on' : ''), name);
        t.addEventListener('click', () => { state.tab = name; render(); });
        tabs.appendChild(t);
      });
      sec.appendChild(tabs);

      let data;
      try { data = getData(); }
      catch (err) {
        sec.appendChild(el('div', 'viz-note', 'download failed: ' + err.message));
        return sec;
      }
      const d = data.array, rows = data.rows, cols = data.cols;

      if (state.tab === 'stats') {
        const s = statsOf(d);
        const box = el('div', 'kv');
        box.appendChild(kv('shape', rows + ' × ' + cols));
        box.appendChild(kv('count', fmtNum(s.count)));
        box.appendChild(kv('mean', s.mean.toFixed(5)));
        box.appendChild(kv('std', s.std.toFixed(5)));
        box.appendChild(kv('min', s.min.toFixed(5)));
        box.appendChild(kv('max', s.max.toFixed(5)));
        sec.appendChild(box);
      } else {
        const cv = el('canvas', 'viz-canvas');
        cv.width = 292; cv.height = state.tab === 'heatmap' ? 200 : 140;
        sec.appendChild(cv);
        if (state.tab === 'heatmap') {
          drawHeatmap(cv, d, rows, cols, mode);
          sec.appendChild(el('div', 'viz-note',
            'rows × cols = ' + rows + ' × ' + cols +
            (mode === 'prob' ? '  ·  bright = high probability' : '  ·  amber + / blue −')));
        } else {
          drawHistogram(cv, d);
          sec.appendChild(el('div', 'viz-note', 'value distribution · ' + fmtNum(d.length) + ' elements'));
        }
      }
      return sec;
    }

    // attention-matrix block for an MHA node
    function buildAttnView(node) {
      const at = node._attn;
      const sec = el('div', 'insp-section');
      sec.appendChild(el('div', 'insp-sec-title', 'Attention matrix'));
      if (state.head >= at.heads) state.head = 0;
      const hd = el('div', 'heads');
      for (let h = 0; h < at.heads; h++) {
        const b = el('button', 'head' + (state.head === h ? ' on' : ''), 'H' + h);
        b.addEventListener('click', () => { state.head = h; render(); });
        hd.appendChild(b);
      }
      sec.appendChild(hd);
      const cv = el('canvas', 'viz-canvas');
      const sz = Math.min(264, at.seq > 0 ? 264 : 264);
      cv.width = sz; cv.height = sz;
      sec.appendChild(cv);
      try {
        const full = at.tensor.download();
        const S = at.seq, h = state.head;
        const sub = new Float32Array(S * S);
        for (let i = 0; i < S * S; i++) sub[i] = full[h * S * S + i];
        drawHeatmap(cv, sub, S, S, 'prob');
        sec.appendChild(el('div', 'viz-note',
          'head ' + h + '  ·  row = query token, col = key token  ·  ' + S + ' × ' + S));
      } catch (err) {
        sec.appendChild(el('div', 'viz-note', 'attention unavailable: ' + err.message));
      }
      return sec;
    }

    // ---- main render ---------------------------------------------------
    let current = { node: null, edge: null };

    function render() {
      panel.innerHTML = '';
      const sel = current;

      if (!sel.node && !sel.edge) {
        const e = el('div', 'insp-empty');
        e.innerHTML =
          '<div class="insp-empty-icon">⬡</div>' +
          '<p>Select a node to edit its config, or a wire to inspect the ' +
          'tensor flowing through it.</p>' +
          '<p class="dim">Add ops from the palette · drag port-to-port to wire · ' +
          'Run or Step to execute on the GPU.</p>';
        panel.appendChild(e);
        return;
      }

      // --- edge selected: show the tensor on the wire -------------------
      if (sel.edge) {
        const e = sel.edge, src = e.from.node;
        const head = el('div', 'insp-head');
        head.style.borderColor = '#fde68a';
        head.appendChild(el('div', 'insp-cat', 'WIRE'));
        head.appendChild(el('h2', null, 'Tensor'));
        head.appendChild(el('p', 'insp-desc',
          Ops.get(src.type).label + ' → ' + Ops.get(e.to.node.type).label));
        panel.appendChild(head);
        if (src._out && src._out[e.from.port]) {
          panel.appendChild(buildTensorView(() => {
            const t = src._out[e.from.port];
            return { array: t.download(), rows: t.rows, cols: t.cols };
          }, 'value', 'Values'));
        } else {
          panel.appendChild(el('div', 'viz-note pad', 'Run the graph to populate this wire.'));
        }
        return;
      }

      // --- node selected ------------------------------------------------
      const n = sel.node, def = Ops.get(n.type);
      const head = el('div', 'insp-head');
      head.style.borderColor = def.color;
      head.appendChild(el('div', 'insp-cat', def.cat.toUpperCase()));
      head.appendChild(el('h2', null, def.label));
      head.appendChild(el('p', 'insp-desc', def.desc));
      panel.appendChild(head);

      const cfg = el('div', 'insp-section');
      cfg.appendChild(el('div', 'insp-sec-title', 'Config'));
      cfg.appendChild(buildForm(n, def));
      panel.appendChild(cfg);

      const panelSec = buildPanel(n, def);
      if (panelSec) panel.appendChild(panelSec);

      // cost block
      const cost = el('div', 'insp-section');
      cost.appendChild(el('div', 'insp-sec-title', 'Cost'));
      const box = el('div', 'kv');
      box.appendChild(kv('output', n.shapes && n.shapes[0]
        ? Shape.label(n.shapes[0])
        : (n.error ? 'invalid' : '—')));
      let st = null;
      if (!n.error && n.inShapes && n.inShapes.length >= def.ins.length) {
        try { st = def.stats(n.inShapes, n.params); } catch (e) { st = null; }
      }
      box.appendChild(kv('params', st ? fmtNum(st.params) : '—'));
      box.appendChild(kv('FLOPs', st ? fmtNum(st.flops) : '—'));
      box.appendChild(kv('GPU time', n._ran ? fmtMs(n._time) : 'not run'));
      cost.appendChild(box);
      if (n.error) cost.appendChild(el('div', 'insp-err', '⚠ ' + n.error));
      panel.appendChild(cost);

      // attention (before generic tensor view — it's the headline)
      if (n._attn && n._attn.tensor) panel.appendChild(buildAttnView(n));

      // output tensor view
      if (n._out && n._out[0]) {
        panel.appendChild(buildTensorView(() => {
          const t = n._out[0];
          return { array: t.download(), rows: t.rows, cols: t.cols };
        }, n.type === 'softmax' ? 'prob' : 'value', 'Output'));
      } else {
        panel.appendChild(el('div', 'viz-note pad',
          bro.tensor && bro.tensor.available
            ? 'Run or Step to compute this node.'
            : 'GPU backend unavailable — values cannot be computed.'));
      }
    }

    return {
      show(sel) {
        if (sel && (sel.node !== current.node || sel.edge !== current.edge)) {
          state.tab = 'heatmap';
          state.head = 0;
        }
        current = { node: sel ? sel.node : null, edge: sel ? sel.edge : null };
        render();
      },
      refresh() { render(); },
    };
  }

  export const Inspector = { create: create };
