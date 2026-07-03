// Node Forge — generalized multi-curve painter panel widget.
//
// Generalizes rave-lab/lib/curves.js (one draggable contour per latent dim)
// to N curves driven entirely by a panelConfig accessor contract, so this
// file has zero knowledge of RAVE, Kokoro, or any other domain. Kokoro's
// 2-curve F0/energy editor (kokoro-lab/lib/curves.js) is just the N=2 case,
// including its "pitch can't go negative" rule, generalized here into a
// per-curve `clamp` config function instead of a hardcoded name check.
//
// panelConfig contract — all functions take (node) or (node, i):
//   count(node)              -> number of curves
//   label(node, i)            -> string
//   color(node, i)            -> css color string (optional; default palette)
//   get(node, i)              -> the LIVE plain number[] for curve i. Painted
//                                 and button-op edits mutate this array IN
//                                 PLACE (matching rave-lab's row()/origRow()
//                                 pattern) — no separate setter needed. Per
//                                 the save/load contract (plan: widget-owned
//                                 params must be plain arrays, converted
//                                 to/from Float32Array only at the exec
//                                 boundary), this must return a plain array,
//                                 typically node.params.<key>[i].
//   original(node, i)          -> plain number[] ghost baseline, or
//                                 null/undefined to skip drawing one.
//   range(node, i)             -> [mn, mx] fixed vertical frame. If omitted,
//                                 auto-computed from original(node,i) (falling
//                                 back to get(node,i)) with 1.8x headroom
//                                 around the center, same as rave-lab.
//   clamp(node, i, value)      -> optionally constrain a painted value (e.g.
//                                 Kokoro's F0 curve: Math.max(0, value)).
//                                 Optional; identity if omitted.
//
// Every mutation (drag tick or button op) calls ctx.onEdit() — the
// debounced invalidateFrom(node) + runner.continue() path — never
// ctx.onCommit(). A curve edit only ever changes this node's own output;
// there is no structural reason to pay the full-graph clearRun() a plain
// param-form edit takes, and doing so on every brush stroke would defeat
// the entire point of incremental invalidation.
import { Widgets } from "/app/lab/widgets.js";

  const CURVE_W = 1100, CURVE_H = 96, CURVE_PAD = 6;
  const DEFAULT_HUES = [42, 198, 150, 280, 16, 100, 320, 222];

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function defaultColor(i) {
    const h = DEFAULT_HUES[i % DEFAULT_HUES.length];
    return `hsl(${h},70%,64%)`;
  }

  function autoRange(cfg, node, i) {
    const baseline = (cfg.original ? cfg.original(node, i) : null) || cfg.get(node, i);
    let mn = Infinity, mx = -Infinity;
    for (let t = 0; t < baseline.length; t++) {
      const v = baseline[t];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mn === Infinity) { mn = 0; mx = 1; }
    const ctr = (mn + mx) / 2, half = Math.max((mx - mn) / 2, 0.5) * 1.8;
    return [ctr - half, ctr + half];
  }

  function clampVal(cfg, node, i, v) {
    return cfg.clamp ? cfg.clamp(node, i, v) : v;
  }

  function mount(node, def, cfg, ctx) {
    const root = el('div', 'curve-panel');
    const count = cfg.count(node);
    const ranges = [];
    const cells = [];

    function drawCell(i) {
      const cell = cells[i];
      const cv = cell.cv, c2 = cv.getContext('2d'), W = cv.width, H = cv.height, pad = CURVE_PAD;
      const [mn, mx] = ranges[i], range = (mx - mn) || 1;
      c2.clearRect(0, 0, W, H);
      if (mn < 0 && mx > 0) {
        const zy = H - pad - ((0 - mn) / range) * (H - 2 * pad);
        c2.strokeStyle = '#1b2330';
        c2.beginPath(); c2.moveTo(0, zy); c2.lineTo(W, zy); c2.stroke();
      }
      const plot = (d, style, w) => {
        if (!d) return;
        const n = d.length;
        c2.strokeStyle = style; c2.lineWidth = w; c2.beginPath();
        for (let x = 0; x < W; x++) {
          const idx = Math.floor(x * n / W);
          const y = H - pad - ((d[idx] - mn) / range) * (H - 2 * pad);
          x === 0 ? c2.moveTo(x, y) : c2.lineTo(x, y);
        }
        c2.stroke();
      };
      const orig = cfg.original ? cfg.original(node, i) : null;
      if (orig) plot(orig, '#39414f', 1);
      plot(cfg.get(node, i), cell.color, 1.6);

      const d = cfg.get(node, i);
      let mn2 = Infinity, mx2 = -Infinity, delta = 0;
      for (let t = 0; t < d.length; t++) {
        const v = d[t];
        if (v < mn2) mn2 = v;
        if (v > mx2) mx2 = v;
        if (orig) delta += Math.abs(v - orig[t]);
      }
      cell.statsEl.textContent = mn2.toFixed(2) + ' … ' + mx2.toFixed(2) +
        (orig && delta > 1e-4 ? '  ·  Δ' + delta.toFixed(1) : '');
    }

    function applyOp(i, fn) {
      fn();
      drawCell(i);
      ctx.onEdit();
    }

    for (let i = 0; i < count; i++) {
      ranges.push(cfg.range ? cfg.range(node, i) : autoRange(cfg, node, i));
      const color = cfg.color ? cfg.color(node, i) : defaultColor(i);

      const cell = el('div', 'curve-cell');
      const head = el('div', 'curve-head');
      head.appendChild(el('span', 'curve-name', cfg.label(node, i)));
      const stat = el('span', 'curve-stats', '');
      head.appendChild(stat);

      const tools = el('span', 'curve-tools');
      const btn = (label, title, fn) => {
        const b = el('button', 'tinybtn', label);
        b.title = title;
        b.addEventListener('click', () => applyOp(i, fn));
        tools.appendChild(b);
      };
      const origFor = () => cfg.original ? cfg.original(node, i) : null;
      btn('↺', 'reset to original', () => {
        const o = origFor(), d = cfg.get(node, i);
        if (o) for (let t = 0; t < d.length; t++) d[t] = o[t];
      });
      btn('∼', 'smooth', () => {
        const d = cfg.get(node, i), n = d.length, s = d.slice();
        for (let t = 0; t < n; t++) {
          const a = s[Math.max(0, t - 1)], b = s[t], e = s[Math.min(n - 1, t + 1)];
          d[t] = (a + 2 * b + e) / 4;
        }
      });
      btn('─', 'flatten to mean', () => {
        const d = cfg.get(node, i);
        let m = 0; for (let t = 0; t < d.length; t++) m += d[t]; m /= d.length;
        for (let t = 0; t < d.length; t++) d[t] = m;
      });
      btn('⤨', 'invert around mean', () => {
        const d = cfg.get(node, i);
        let m = 0; for (let t = 0; t < d.length; t++) m += d[t]; m /= d.length;
        for (let t = 0; t < d.length; t++) d[t] = clampVal(cfg, node, i, 2 * m - d[t]);
      });
      btn('▲', 'nudge up (+0.5)', () => {
        const d = cfg.get(node, i);
        for (let t = 0; t < d.length; t++) d[t] = clampVal(cfg, node, i, d[t] + 0.5);
      });
      btn('▼', 'nudge down (−0.5)', () => {
        const d = cfg.get(node, i);
        for (let t = 0; t < d.length; t++) d[t] = clampVal(cfg, node, i, d[t] - 0.5);
      });
      head.appendChild(tools);
      cell.appendChild(head);

      const cv = document.createElement('canvas');
      cv.width = CURVE_W; cv.height = CURVE_H; cv.className = 'curve-canvas';
      cell.appendChild(cv);
      root.appendChild(cell);

      cells.push({ cv: cv, statsEl: stat, color: color });
      drawCell(i);

      let paint = null;   // in-progress drag: {lastI, lastV}
      cv.addEventListener('mousedown', (e) => {
        e.preventDefault();
        paint = { lastI: -1, lastV: 0 };
        paintAt(i, cv, e, paint);
      });
      // Test seam: drive a synthetic drag without real mouse events.
      cell._testMouseDown = (e) => { paint = { lastI: -1, lastV: 0 }; paintAt(i, cv, e, paint); };
      cell._testMouseMove = (e) => paintAt(i, cv, e, paint);
      cell._testMouseUp = () => { paint = null; };

      window.addEventListener('mousemove', (e) => { if (paint) paintAt(i, cv, e, paint); });
      window.addEventListener('mouseup', () => { paint = null; });
    }

    function paintAt(i, cv, e, p) {
      if (!p) return;
      const rect = cv.getBoundingClientRect();
      const xf = Math.max(0, Math.min(0.99999, (e.clientX - rect.left) / rect.width));
      const yPix = ((e.clientY - rect.top) / rect.height) * CURVE_H;
      const [mn, mx] = ranges[i];
      const d = cfg.get(node, i), n = d.length, idx = Math.floor(xf * n);
      let v = mn + ((CURVE_H - CURVE_PAD - yPix) / (CURVE_H - 2 * CURVE_PAD)) * ((mx - mn) || 1);
      v = clampVal(cfg, node, i, v);
      if (p.lastI >= 0 && p.lastI !== idx) {
        const a = Math.min(p.lastI, idx), b = Math.max(p.lastI, idx);
        const va = (p.lastI < idx) ? p.lastV : v, vb = (p.lastI < idx) ? v : p.lastV;
        for (let k = a; k <= b; k++) d[k] = va + (vb - va) * ((b === a) ? 0 : (k - a) / (b - a));
      } else {
        d[idx] = v;
      }
      p.lastI = idx; p.lastV = v;
      drawCell(i);
      ctx.onEdit();
    }

    root._cells = cells;   // test seam
    return root;
  }

  Widgets.registerPanel('multi-curve-painter', { mount: mount });
