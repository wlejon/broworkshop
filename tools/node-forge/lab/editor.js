// Node Forge — DOM-card graph editor.
//
// Each node is a REAL DOM card (built once by its node type's mount()), not a
// canvas-drawn box. A single CSS transform on #nodes-layer handles pan/zoom
// for every card at once (world px -> screen px), so a card's on-canvas
// position is just plain `left/top` in world units. Wires are drawn on a
// plain screen-space overlay canvas each frame by reading each port dot's
// live getBoundingClientRect() — this sidesteps all analytic port-geometry
// math (and, unlike the old canvas renderer, a card's height can change
// freely at runtime — a <details> opening, a trace growing another stage —
// without the wire layer needing to know why).
import { Nodes } from "/app/lab/node-registry.js";

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function create(stage, graph, cb) {
    cb = cb || {};
    const layer = el('div'); layer.id = 'nodes-layer';
    const wireCanvas = document.createElement('canvas'); wireCanvas.id = 'wire-canvas';
    const gridCanvas = document.createElement('canvas'); gridCanvas.id = 'grid-canvas';
    stage.appendChild(gridCanvas);
    stage.appendChild(wireCanvas);
    stage.appendChild(layer);
    const wctx = wireCanvas.getContext('2d');
    const gctx = gridCanvas.getContext('2d');

    const view = { x: 80, y: 80, scale: 1 };
    const cards = new Map();      // node -> {root, header, body, badge, ins:[dot], outs:[dot]}
    let focused = null;
    let wireDrag = null;          // { fromNode, fromPort, screen:{x,y}, hoverDot }
    let panDrag = null;           // { sx, sy, vx, vy }
    let cardDrag = null;          // { node, ox, oy } world-space grab offset

    const ed = { view: view, activeNode: null };

    // --- coordinate transforms ---------------------------------------------
    function applyTransform() {
      layer.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')';
    }
    function toWorld(sx, sy) {
      return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
    }
    function stagePos(e) {
      const r = stage.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    // --- focus (Delete-key convenience, not a "selection" concept) ---------
    function setFocus(node) {
      if (focused && cards.has(focused)) cards.get(focused).root.classList.remove('focused');
      focused = node || null;
      if (focused && cards.has(focused)) cards.get(focused).root.classList.add('focused');
    }

    function removeCardFor(node) {
      const c = cards.get(node);
      if (!c) return;
      const def = Nodes.get(node.type);
      if (def.unmount) { try { def.unmount(node); } catch (e) {} }
      c.root.remove();
      cards.delete(node);
    }

    function change() { if (cb.onChange) cb.onChange(); }

    // --- card construction (once per node) ----------------------------------
    function buildCard(node) {
      const def = Nodes.get(node.type);
      const root = el('div', 'node-card');
      root.style.borderTopColor = def.color;

      const header = el('div', 'node-header');
      const collapseBtn = el('button', 'node-collapse', node.collapsed ? '▸' : '▾');
      collapseBtn.title = 'Collapse/expand';
      header.appendChild(collapseBtn);
      header.appendChild(el('span', 'node-title', def.label));
      const badge = el('span', 'node-badge', '');
      header.appendChild(badge);
      header.appendChild(el('span', 'grow'));
      const delBtn = el('button', 'node-del', '✕');
      delBtn.title = 'Remove this node';
      header.appendChild(delBtn);
      root.appendChild(header);

      const ports = el('div', 'node-ports');
      const insWrap = el('div', 'node-ports-in');
      const outsWrap = el('div', 'node-ports-out');
      const inDots = [], outDots = [];
      def.ins.forEach((p, i) => {
        const row = el('div', 'port-row');
        const dot = el('span', 'port-dot'); dot.dataset.dir = 'in'; dot.dataset.port = String(i);
        row.appendChild(dot); row.appendChild(el('span', 'port-label', p.name));
        insWrap.appendChild(row); inDots.push(dot);
      });
      def.outs.forEach((p, i) => {
        const row = el('div', 'port-row port-row-out');
        row.appendChild(el('span', 'port-label', p.name));
        const dot = el('span', 'port-dot'); dot.dataset.dir = 'out'; dot.dataset.port = String(i);
        row.appendChild(dot); outsWrap.appendChild(row); outDots.push(dot);
      });
      ports.appendChild(insWrap); ports.appendChild(outsWrap);
      root.appendChild(ports);

      const body = el('div', 'node-body');
      root.appendChild(body);
      body.style.display = node.collapsed ? 'none' : '';
      ports.style.display = node.collapsed ? 'none' : '';

      layer.appendChild(root);
      const c = { root: root, header: header, body: body, badge: badge, ins: inDots, outs: outDots };
      cards.set(node, c);

      collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        node.collapsed = !node.collapsed;
        collapseBtn.textContent = node.collapsed ? '▸' : '▾';
        body.style.display = node.collapsed ? 'none' : '';
        ports.style.display = node.collapsed ? 'none' : '';
        change();
      });
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        graph.removeNode(node);
        removeCardFor(node);
        if (focused === node) setFocus(null);
        change();
      });

      // card drag — mousedown on the header (not its buttons) moves the node
      header.addEventListener('mousedown', (e) => {
        if (e.target === collapseBtn || e.target === delBtn) return;
        e.preventDefault();
        setFocus(node);
        const w = toWorld(e.clientX - stage.getBoundingClientRect().left, e.clientY - stage.getBoundingClientRect().top);
        cardDrag = { node: node, ox: w.x - node.x, oy: w.y - node.y };
      });
      body.addEventListener('mousedown', () => setFocus(node));

      // port wiring
      inDots.forEach((dot, i) => {
        dot.addEventListener('mousedown', (e) => {
          e.preventDefault(); e.stopPropagation();
          const existing = graph.edgeInto(node, i);
          if (existing) {
            graph.removeEdge(existing);
            wireDrag = { fromNode: existing.from.node, fromPort: existing.from.port, screen: stagePos(e), hoverDot: null };
            change();
          }
        });
      });
      outDots.forEach((dot, i) => {
        dot.addEventListener('mousedown', (e) => {
          e.preventDefault(); e.stopPropagation();
          wireDrag = { fromNode: node, fromPort: i, screen: stagePos(e), hoverDot: null };
        });
      });

      const api = {
        invalidate(n) { if (cb.onInvalidate) cb.onInvalidate(n || node); },
        markDirty() { if (cb.onChange) cb.onChange(); },
        setBadge(text, isErr) {
          badge.textContent = text || '';
          badge.classList.toggle('err', !!isErr);
        },
      };
      try { def.mount(body, node, graph, api); }
      catch (e) { body.appendChild(el('div', 'node-mount-error', 'mount failed: ' + (e && e.message || e))); }
      return c;
    }

    function syncCards() {
      for (const n of graph.nodes) if (!cards.has(n)) buildCard(n);
      for (const n of Array.from(cards.keys())) if (graph.nodes.indexOf(n) === -1) removeCardFor(n);
      for (const n of graph.nodes) {
        const c = cards.get(n);
        c.root.style.left = n.x + 'px';
        c.root.style.top = n.y + 'px';
      }
    }

    // --- stage-level mouse handling -----------------------------------------
    stage.addEventListener('mousedown', (e) => {
      if (e.target !== stage && e.target !== gridCanvas && e.target !== wireCanvas) return;
      setFocus(null);
      const p = stagePos(e);
      panDrag = { sx: p.x, sy: p.y, vx: view.x, vy: view.y };
    });

    window.addEventListener('mousemove', (e) => {
      if (panDrag) {
        const p = stagePos(e);
        view.x = panDrag.vx + (p.x - panDrag.sx);
        view.y = panDrag.vy + (p.y - panDrag.sy);
        applyTransform();
      } else if (cardDrag) {
        const p = stagePos(e), w = toWorld(p.x, p.y);
        cardDrag.node.x = w.x - cardDrag.ox;
        cardDrag.node.y = w.y - cardDrag.oy;
        const c = cards.get(cardDrag.node);
        c.root.style.left = cardDrag.node.x + 'px';
        c.root.style.top = cardDrag.node.y + 'px';
      } else if (wireDrag) {
        wireDrag.screen = stagePos(e);
        wireDrag.hoverDot = dotUnder(e.clientX, e.clientY, 'in');
      }
    });

    function dotUnder(clientX, clientY, dir) {
      const el2 = document.elementFromPoint(clientX, clientY);
      if (!el2 || !el2.classList || !el2.classList.contains('port-dot')) return null;
      if (dir && el2.dataset.dir !== dir) return null;
      for (const [node, c] of cards) {
        const list = dir === 'out' ? c.outs : c.ins;
        const i = list.indexOf(el2);
        if (i !== -1) return { node: node, port: i, el: el2 };
      }
      return null;
    }

    window.addEventListener('mouseup', (e) => {
      if (wireDrag) {
        const hit = dotUnder(e.clientX, e.clientY, 'in');
        if (hit) { graph.addEdge(wireDrag.fromNode, wireDrag.fromPort, hit.node, hit.port); change(); }
        wireDrag = null;
      }
      panDrag = null;
      cardDrag = null;
    });

    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = stagePos(e), w = toWorld(p.x, p.y);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      view.scale = Math.min(2.4, Math.max(0.3, view.scale * factor));
      view.x = p.x - w.x * view.scale;
      view.y = p.y - w.y * view.scale;
      applyTransform();
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (!focused) return;
      graph.removeNode(focused);
      removeCardFor(focused);
      setFocus(null);
      change();
    });

    // --- wire drawing (screen-space, from live DOM port-dot rects) ---------
    function dotCenter(dot) {
      const r = dot.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      return { x: r.left + r.width / 2 - sr.left, y: r.top + r.height / 2 - sr.top };
    }
    function bez(p0, c0, c1, p1, t) {
      const u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      return { x: a * p0.x + b * c0.x + c * c1.x + d * p1.x, y: a * p0.y + b * c0.y + c * c1.y + d * p1.y };
    }
    function curveOf(a, b) {
      const dx = Math.max(60, Math.abs(b.x - a.x) * 0.5);
      return { p0: a, c0: { x: a.x + dx, y: a.y }, c1: { x: b.x - dx, y: b.y }, p1: b };
    }
    function strokeCurve(c, color, width) {
      wctx.lineWidth = width; wctx.strokeStyle = color;
      wctx.beginPath();
      wctx.moveTo(c.p0.x, c.p0.y);
      wctx.bezierCurveTo(c.c0.x, c.c0.y, c.c1.x, c.c1.y, c.p1.x, c.p1.y);
      wctx.stroke();
    }

    function drawGrid() {
      const w = gridCanvas.width, h = gridCanvas.height, step = 32 * view.scale;
      gctx.clearRect(0, 0, w, h);
      gctx.fillStyle = '#0d1018'; gctx.fillRect(0, 0, w, h);
      if (step < 6) return;
      gctx.strokeStyle = 'rgba(255,255,255,0.035)'; gctx.lineWidth = 1;
      gctx.beginPath();
      const ox = view.x % step, oy = view.y % step;
      for (let x = ox; x < w; x += step) { gctx.moveTo(x, 0); gctx.lineTo(x, h); }
      for (let y = oy; y < h; y += step) { gctx.moveTo(0, y); gctx.lineTo(w, y); }
      gctx.stroke();
    }

    function drawWires(now) {
      wctx.clearRect(0, 0, wireCanvas.width, wireCanvas.height);
      for (const e of graph.edges) {
        const fc = cards.get(e.from.node), tc = cards.get(e.to.node);
        if (!fc || !tc || !fc.outs[e.from.port] || !tc.ins[e.to.port]) continue;
        const curve = curveOf(dotCenter(fc.outs[e.from.port]), dotCenter(tc.ins[e.to.port]));
        const live = e.from.node._ran && !e.from.node.error;
        strokeCurve(curve, live ? '#5e9bd6' : 'rgba(150,165,190,0.5)', 2.2);
        if (live) {
          for (let k = 0; k < 3; k++) {
            const t = ((now / 1100) + k / 3) % 1;
            const pt = bez(curve.p0, curve.c0, curve.c1, curve.p1, t);
            wctx.beginPath(); wctx.arc(pt.x, pt.y, 3, 0, 6.2832);
            wctx.fillStyle = 'rgba(186,230,253,' + (0.9 - Math.abs(t - 0.5)) + ')';
            wctx.fill();
          }
        }
      }
      if (wireDrag) {
        const fc = cards.get(wireDrag.fromNode);
        if (fc && fc.outs[wireDrag.fromPort]) {
          const a = dotCenter(fc.outs[wireDrag.fromPort]);
          const ok = wireDrag.hoverDot && graph.canConnect(wireDrag.fromNode, wireDrag.fromPort, wireDrag.hoverDot.node, wireDrag.hoverDot.port);
          const b = wireDrag.hoverDot ? dotCenter(wireDrag.hoverDot.el) : wireDrag.screen;
          strokeCurve(curveOf(a, b), wireDrag.hoverDot ? (ok ? '#4ade80' : '#ef4444') : '#fbbf24', 2.4);
        }
      }
    }

    function draw(now) {
      syncCards();
      drawGrid();
      drawWires(now || 0);
    }

    // --- public helpers ------------------------------------------------------
    function resize() {
      const w = stage.clientWidth || 900, h = stage.clientHeight || 600;
      gridCanvas.width = w; gridCanvas.height = h;
      wireCanvas.width = w; wireCanvas.height = h;
    }

    function frameAll() {
      if (!graph.nodes.length) { view.x = 80; view.y = 80; view.scale = 1; applyTransform(); return; }
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const n of graph.nodes) {
        const c = cards.get(n);
        const w = c ? c.root.offsetWidth / view.scale : 260;
        const h = c ? c.root.offsetHeight / view.scale : 120;
        x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
        x1 = Math.max(x1, n.x + w); y1 = Math.max(y1, n.y + h);
      }
      const pad = 70, sw = wireCanvas.width, sh = wireCanvas.height;
      const sx = sw / (x1 - x0 + pad * 2), sy = sh / (y1 - y0 + pad * 2);
      view.scale = Math.min(1.2, Math.max(0.35, Math.min(sx, sy)));
      view.x = (sw - (x1 + x0) * view.scale) / 2;
      view.y = (sh - (y1 + y0) * view.scale) / 2;
      applyTransform();
    }

    function placeNew(node) {
      const c = toWorld(wireCanvas.width / 2, wireCanvas.height / 2);
      node.x = c.x - 130 + (Math.random() * 60 - 30);
      node.y = c.y - 40 + (Math.random() * 60 - 30);
    }

    function select(node) { setFocus(node); }   // kept for app.js callers (Step/T5 removed); now just focuses

    ed.draw = draw;
    ed.resize = resize;
    ed.frameAll = frameAll;
    ed.placeNew = placeNew;
    ed.select = select;
    applyTransform();
    return ed;
  }

  export const Editor = { create: create };
