// Tensor Lab — node-graph editor.
//
// A pannable / zoomable canvas that draws the graph and handles every
// freeform-edit gesture: add (from the palette), drag nodes, wire ports,
// select, delete. World space is in graph coordinates; the view transform
// maps it to the canvas.
(function () {
  'use strict';
  const Lab = (window.Lab = window.Lab || {});

  const NW = 188;          // node width
  const HEAD = 30;         // header height
  const PROW = 23;         // per-port row height
  const PORT_R = 6;        // port hit/draw radius

  function create(canvas, graph, cb) {
    const ctx = canvas.getContext('2d');
    cb = cb || {};
    const view = { x: 80, y: 80, scale: 1 };
    let mode = 'idle';
    let drag = null;        // mode-specific scratch
    let wire = null;        // { fromNode, fromPort, cursor:{x,y} }
    const sel = { node: null, edge: null };
    const ed = {
      view: view, sel: sel,
      activeNode: null,     // node currently executing (run highlight)
    };

    // --- geometry ---------------------------------------------------------
    function geom(n) {
      const def = Lab.Ops.get(n.type);
      const rows = Math.max(def.ins.length, def.outs.length, 1);
      const h = HEAD + 14 + rows * PROW + 26;
      const g = { x: n.x, y: n.y, w: NW, h: h, ins: [], outs: [] };
      for (let i = 0; i < def.ins.length; i++)
        g.ins.push({ x: n.x, y: n.y + HEAD + 16 + i * PROW });
      for (let j = 0; j < def.outs.length; j++)
        g.outs.push({ x: n.x + NW, y: n.y + HEAD + 16 + j * PROW });
      return g;
    }

    // --- coordinate transforms -------------------------------------------
    function toWorld(sx, sy) {
      return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
    }
    function mousePos(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function bez(p0, c0, c1, p1, t) {
      const u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      return {
        x: a * p0.x + b * c0.x + c * c1.x + d * p1.x,
        y: a * p0.y + b * c0.y + c * c1.y + d * p1.y,
      };
    }
    function edgeCurve(e) {
      const a = geom(e.from.node).outs[e.from.port];
      const b = geom(e.to.node).ins[e.to.port];
      const dx = Math.max(60, Math.abs(b.x - a.x) * 0.5);
      return { p0: a, c0: { x: a.x + dx, y: a.y }, c1: { x: b.x - dx, y: b.y }, p1: b };
    }

    // --- hit testing ------------------------------------------------------
    function pick(w) {
      for (let i = graph.nodes.length - 1; i >= 0; i--) {
        const n = graph.nodes[i], g = geom(n);
        for (let p = 0; p < g.outs.length; p++)
          if (dist(w, g.outs[p]) < PORT_R + 5)
            return { kind: 'outport', node: n, port: p };
        for (let p = 0; p < g.ins.length; p++)
          if (dist(w, g.ins[p]) < PORT_R + 5)
            return { kind: 'inport', node: n, port: p };
        if (w.x >= g.x && w.x <= g.x + g.w && w.y >= g.y && w.y <= g.y + g.h)
          return { kind: 'node', node: n };
      }
      for (let i = graph.edges.length - 1; i >= 0; i--) {
        const e = graph.edges[i], c = edgeCurve(e);
        for (let t = 0; t <= 1.0001; t += 0.04) {
          if (dist(w, bez(c.p0, c.c0, c.c1, c.p1, t)) < 7)
            return { kind: 'edge', edge: e };
        }
      }
      return { kind: 'empty' };
    }
    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

    // --- selection --------------------------------------------------------
    function select(node, edge) {
      sel.node = node || null;
      sel.edge = edge || null;
      if (cb.onSelect) cb.onSelect(sel);
    }

    // --- mouse handlers ---------------------------------------------------
    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();   // don't let the press start a text selection
      const m = mousePos(e), w = toWorld(m.x, m.y);
      const hit = pick(w);
      if (hit.kind === 'outport') {
        mode = 'wire';
        wire = { fromNode: hit.node, fromPort: hit.port, cursor: w };
      } else if (hit.kind === 'inport') {
        // grab the existing wire on this input port for re-routing
        const e0 = graph.edgeInto(hit.node, hit.port);
        if (e0) {
          graph.removeEdge(e0);
          mode = 'wire';
          wire = { fromNode: e0.from.node, fromPort: e0.from.port, cursor: w };
          if (cb.onChange) cb.onChange();
        } else {
          mode = 'pan';
          drag = { sx: m.x, sy: m.y, vx: view.x, vy: view.y };
        }
      } else if (hit.kind === 'node') {
        select(hit.node, null);
        mode = 'dragNode';
        drag = { node: hit.node, ox: w.x - hit.node.x, oy: w.y - hit.node.y, moved: false };
      } else if (hit.kind === 'edge') {
        select(null, hit.edge);
        mode = 'idle';
      } else {
        select(null, null);
        mode = 'pan';
        drag = { sx: m.x, sy: m.y, vx: view.x, vy: view.y };
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      const m = mousePos(e), w = toWorld(m.x, m.y);
      if (mode === 'pan') {
        view.x = drag.vx + (m.x - drag.sx);
        view.y = drag.vy + (m.y - drag.sy);
      } else if (mode === 'dragNode') {
        drag.node.x = w.x - drag.ox;
        drag.node.y = w.y - drag.oy;
        drag.moved = true;
      } else if (mode === 'wire') {
        wire.cursor = w;
      }
    });

    function endDrag(e) {
      if (mode === 'wire' && wire) {
        const m = mousePos(e), w = toWorld(m.x, m.y);
        const hit = pick(w);
        if (hit.kind === 'inport') {
          graph.addEdge(wire.fromNode, wire.fromPort, hit.node, hit.port);
          if (cb.onChange) cb.onChange();
        }
      }
      mode = 'idle';
      drag = null;
      wire = null;
    }
    canvas.addEventListener('mouseup', endDrag);
    canvas.addEventListener('mouseleave', endDrag);

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const m = mousePos(e), w = toWorld(m.x, m.y);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      view.scale = Math.min(2.4, Math.max(0.3, view.scale * factor));
      view.x = m.x - w.x * view.scale;
      view.y = m.y - w.y * view.scale;
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (sel.node) { graph.removeNode(sel.node); select(null, null); if (cb.onChange) cb.onChange(); }
      else if (sel.edge) { graph.removeEdge(sel.edge); select(null, null); if (cb.onChange) cb.onChange(); }
    });

    // --- drawing ----------------------------------------------------------
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function drawGrid() {
      const step = 32;
      const x0 = -view.x / view.scale, y0 = -view.y / view.scale;
      const x1 = x0 + canvas.width / view.scale, y1 = y0 + canvas.height / view.scale;
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.lineWidth = 1 / view.scale;
      ctx.beginPath();
      for (let x = Math.floor(x0 / step) * step; x < x1; x += step) {
        ctx.moveTo(x, y0); ctx.lineTo(x, y1);
      }
      for (let y = Math.floor(y0 / step) * step; y < y1; y += step) {
        ctx.moveTo(x0, y); ctx.lineTo(x1, y);
      }
      ctx.stroke();
    }

    function drawEdge(e, now) {
      const c = edgeCurve(e);
      const live = e.from.node._ran && !e.from.node.error;
      const selected = sel.edge === e;
      ctx.beginPath();
      ctx.moveTo(c.p0.x, c.p0.y);
      ctx.bezierCurveTo(c.c0.x, c.c0.y, c.c1.x, c.c1.y, c.p1.x, c.p1.y);
      ctx.lineWidth = selected ? 3.4 : 2.2;
      ctx.strokeStyle = selected ? '#fde68a' : live ? '#5e9bd6' : 'rgba(150,165,190,0.5)';
      ctx.stroke();
      // arrowhead
      const tip = bez(c.p0, c.c0, c.c1, c.p1, 1);
      const pre = bez(c.p0, c.c0, c.c1, c.p1, 0.96);
      const ang = Math.atan2(tip.y - pre.y, tip.x - pre.x);
      ctx.fillStyle = selected ? '#fde68a' : live ? '#5e9bd6' : 'rgba(150,165,190,0.7)';
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - 9 * Math.cos(ang - 0.4), tip.y - 9 * Math.sin(ang - 0.4));
      ctx.lineTo(tip.x - 9 * Math.cos(ang + 0.4), tip.y - 9 * Math.sin(ang + 0.4));
      ctx.closePath();
      ctx.fill();
      // flowing data pulses on computed edges
      if (live) {
        for (let k = 0; k < 3; k++) {
          const t = ((now / 1100) + k / 3) % 1;
          const pt = bez(c.p0, c.c0, c.c1, c.p1, t);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 3, 0, 6.2832);
          ctx.fillStyle = 'rgba(186,230,253,' + (0.9 - Math.abs(t - 0.5)) + ')';
          ctx.fill();
        }
      }
    }

    function drawNode(n, now) {
      const def = Lab.Ops.get(n.type), g = geom(n);
      const selected = sel.node === n;
      const active = ed.activeNode === n;
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      roundRect(g.x + 3, g.y + 5, g.w, g.h, 9);
      ctx.fill();
      // body
      ctx.fillStyle = '#1b2130';
      roundRect(g.x, g.y, g.w, g.h, 9);
      ctx.fill();
      // header
      ctx.save();
      roundRect(g.x, g.y, g.w, g.h, 9);
      ctx.clip();
      ctx.fillStyle = def.color;
      ctx.fillRect(g.x, g.y, g.w, HEAD);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(g.x, g.y, g.w, HEAD);
      ctx.restore();
      // border
      let border = '#2c3447';
      if (n.error) border = '#ef4444';
      if (selected) border = '#fde68a';
      if (active) border = '#7dd3fc';
      ctx.lineWidth = (selected || active) ? 2.6 : 1.4;
      ctx.strokeStyle = border;
      roundRect(g.x, g.y, g.w, g.h, 9);
      ctx.stroke();
      if (active) {
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = 'rgba(125,211,252,' + (0.35 + 0.35 * Math.sin(now / 130)) + ')';
        roundRect(g.x - 3, g.y - 3, g.w + 6, g.h + 6, 11);
        ctx.stroke();
      }
      // title
      ctx.fillStyle = '#0c1018';
      ctx.font = 'bold 13px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(def.label, g.x + 12, g.y + HEAD / 2 + 1);
      // ports
      ctx.font = '11px sans-serif';
      for (let p = 0; p < g.ins.length; p++) {
        const pt = g.ins[p], connected = !!graph.edgeInto(n, p);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, PORT_R, 0, 6.2832);
        ctx.fillStyle = connected ? '#7dd3fc' : '#3b4458';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#0c1018';
        ctx.stroke();
        ctx.fillStyle = '#9aa6bd';
        ctx.textAlign = 'left';
        ctx.fillText(def.ins[p], pt.x + 11, pt.y);
      }
      for (let p = 0; p < g.outs.length; p++) {
        const pt = g.outs[p];
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, PORT_R, 0, 6.2832);
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#0c1018';
        ctx.stroke();
        ctx.fillStyle = '#9aa6bd';
        ctx.textAlign = 'right';
        ctx.fillText(def.outs[p], pt.x - 11, pt.y);
      }
      // shape / status line
      const fy = g.y + g.h - 26;
      ctx.textAlign = 'center';
      if (n.error) {
        ctx.fillStyle = '#fca5a5';
        ctx.font = '10px sans-serif';
        ctx.fillText(clip(n.error, 30), g.x + g.w / 2, fy + 6);
      } else if (n.shapes && n.shapes[0]) {
        const lbl = Lab.Shape.label(n.shapes[0]);
        ctx.fillStyle = '#e8edf6';
        ctx.font = (lbl.length > 11 ? 'bold 11px monospace' : 'bold 14px monospace');
        ctx.fillText(lbl, g.x + g.w / 2, fy);
        if (n._ran) {
          ctx.fillStyle = '#7dd3fc';
          ctx.font = '10px sans-serif';
          ctx.fillText(Lab.fmtMs(n._time), g.x + g.w / 2, fy + 15);
        } else {
          ctx.fillStyle = '#5b6577';
          ctx.font = '10px sans-serif';
          ctx.fillText(def.cat, g.x + g.w / 2, fy + 15);
        }
      }
    }

    function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

    function draw(now) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#0d1018';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
      drawGrid();
      for (const e of graph.edges) drawEdge(e, now);
      if (wire) {
        const a = geom(wire.fromNode).outs[wire.fromPort];
        const dx = Math.max(60, Math.abs(wire.cursor.x - a.x) * 0.5);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.bezierCurveTo(a.x + dx, a.y, wire.cursor.x - dx, wire.cursor.y,
          wire.cursor.x, wire.cursor.y);
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = '#fbbf24';
        ctx.stroke();
      }
      for (const n of graph.nodes) drawNode(n, now);
    }

    // --- public helpers ---------------------------------------------------
    function resize() {
      const p = canvas.parentNode;
      let w = canvas.clientWidth || (p && p.clientWidth) || 0;
      let h = canvas.clientHeight || (p && p.clientHeight) || 0;
      canvas.width = Math.max(320, w || 900);
      canvas.height = Math.max(240, h || 600);
    }

    function frameAll() {
      if (!graph.nodes.length) { view.x = 80; view.y = 80; view.scale = 1; return; }
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const n of graph.nodes) {
        const g = geom(n);
        x0 = Math.min(x0, g.x); y0 = Math.min(y0, g.y);
        x1 = Math.max(x1, g.x + g.w); y1 = Math.max(y1, g.y + g.h);
      }
      const pad = 70;
      const sx = canvas.width / (x1 - x0 + pad * 2);
      const sy = canvas.height / (y1 - y0 + pad * 2);
      view.scale = Math.min(1.3, Math.max(0.35, Math.min(sx, sy)));
      view.x = (canvas.width - (x1 + x0) * view.scale) / 2;
      view.y = (canvas.height - (y1 + y0) * view.scale) / 2;
    }

    // place a freshly-added node near the centre of the current view
    function placeNew(node) {
      const c = toWorld(canvas.width / 2, canvas.height / 2);
      node.x = c.x - NW / 2 + (Math.random() * 60 - 30);
      node.y = c.y - 50 + (Math.random() * 60 - 30);
    }

    ed.draw = draw;
    ed.resize = resize;
    ed.frameAll = frameAll;
    ed.placeNew = placeNew;
    ed.select = select;
    return ed;
  }

  Lab.Editor = { create: create };
})();
