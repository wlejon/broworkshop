// lib/kit/nodegraph-view.js — the canvas for a nodegraph.js Graph: DOM node
// cards on a pan / zoom stage, bezier wires, port-to-port wiring, a shared
// "full controls" dialog, and a palette of node types.
//
//   <link rel="stylesheet" href="/lib/kit/nodegraph.css">
//   import { graphView, nodePalette } from "/lib/kit/nodegraph-view.js";
//   const view = graphView('#stage', graph, {
//       edits,                                   // graphEdits(graph, history): undoable changes
//       onChange: () => project.markDirty(),     // any structural edit
//       onInvalidate: (node, out, ms) => ...,    // a card recomputed its own output
//   });
//   nodePalette('#palette', graph.types, { onAdd: (type) => view.addAtCentre(type) });
//
// Each node type's mount(body, node, graph, api) builds the card's UI once.
// `api`:
//   invalidate(node?, out?, ms?)  the card changed its output (live edit): calls
//                                 opts.onInvalidate so downstream nodes rerun
//   markDirty()                   a param changed (calls opts.onChange)
//   setBadge(text, isError)       the small status chip in the card header
//                                 (also sets / clears node.error)
//   dialogBody                    a detached element; whatever the card puts in
//                                 it is shown in the shared dialog (the header
//                                 gear opens it, Escape / backdrop closes it)
//   onDialogToggle(fn(open))      called when this card's dialog opens / closes
//   onUnmount(fn)                 cleanup when the card goes (delete, load, new)
// The type's unmount(node) is also called then.
//
// Mouse: drag empty space to pan, wheel to zoom, drag a header to move, drag
// an output dot to an input dot to wire (dragging an input dot re-routes or
// drops its wire), click a card then Delete to remove it.

import { h, trackDrag } from "./dom.js";

const $el = (x) => {
    if (typeof x !== 'string') return x;
    const found = document.querySelector(x);
    if (!found) throw new Error('kit: no element matches ' + x);
    return found;
};

const COLORS = {
    bg: '#0d1018', grid: 'rgba(255,255,255,0.035)',
    wire: 'rgba(150,165,190,0.5)', live: '#5e9bd6', pulse: '186,230,253',
    drag: '#fbbf24', ok: '#4ade80', bad: '#ef4444',
};

function isTextTarget(t) {
    const tag = (t && t.tagName) || '';
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}

/**
 * Mount the graph canvas into `stage` (a positioned element, e.g. .k-viewport).
 * opts: { edits, onChange(), onInvalidate(node, out, ms), loop = true,
 *         minZoom = 0.3, maxZoom = 2.4 }.
 * Returns the view handle (see the bottom of this function).
 */
export function graphView(stage, graph, opts) {
    stage = $el(stage);
    const o = Object.assign({ loop: true, minZoom: 0.3, maxZoom: 2.4 }, opts);
    const types = graph.types;
    const edits = o.edits || null;

    const gridCanvas = h('canvas.ng-grid');
    const wireCanvas = h('canvas.ng-wires');
    const layer = h('div.ng-layer');
    stage.classList.add('ng-stage');
    stage.append(gridCanvas, wireCanvas, layer);
    const gctx = gridCanvas.getContext('2d'), wctx = wireCanvas.getContext('2d');

    const view = { x: 80, y: 80, scale: 1 };
    const cards = new Map();       // node -> card record
    let focused = null;
    let wire = null;               // { fromNode, fromPort, lifted, screen, hover }
    let placeCount = 0;

    const changed = () => { if (o.onChange) o.onChange(); };

    // --- edits (undoable when opts.edits is given) ------------------------------------
    const doRemove = (node) => (edits ? edits.remove(node) : graph.removeNode(node));
    const doCollapse = (node, on) => (edits ? edits.collapse(node, on) : graph.setCollapsed(node, on));
    const doConnect = (a, ap, b, bp) => (edits ? edits.connect(a, ap, b, bp) : graph.connect(a, ap, b, bp));
    const doRewire = (edge, to, tp) => {
        if (edits) return edits.rewire(edge, to, tp);
        graph.removeEdge(edge);
        return to ? graph.connect(edge.from.node, edge.from.port, to, tp) : null;
    };
    const doMove = (node, x0, y0) => { if (edits) edits.move(node, x0, y0); else graph.moveNode(node, node.x, node.y); };

    // --- coordinates ------------------------------------------------------------------
    function applyTransform() {
        layer.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')';
    }
    function stagePos(e) {
        const r = stage.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    const toWorld = (sx, sy) => ({ x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale });
    const dragging = (on) => document.body.classList.toggle('ng-dragging', on);

    // --- the shared dialog --------------------------------------------------------------
    // No native <dialog> in bro: a fixed backdrop on document.body, so the
    // layer's pan / zoom transform never applies to it.
    let dlg = null, dialogNode = null;
    function ensureDialog() {
        if (dlg) return dlg;
        const title = h('span.ng-dialog-title');
        const close = h('button.ng-dialog-close', { title: 'Close', onclick: closeDialog }, '✕');
        const host = h('div.ng-dialog-body');
        const panel = h('div.ng-dialog', { onmousedown: (e) => e.stopPropagation() },
            h('div.ng-dialog-head', null, title, h('span.k-spacer'), close), host);
        const backdrop = h('div.ng-dialog-backdrop', {
            onmousedown: (e) => { if (e.target === backdrop) closeDialog(); },
        }, panel);
        document.body.appendChild(backdrop);
        dlg = { backdrop, panel, title, host };
        return dlg;
    }
    function openDialog(node) {
        const c = cards.get(node);
        if (!c || !c.dialogBody.childElementCount) return;
        const d = ensureDialog();
        if (dialogNode && dialogNode !== node) closeDialog();
        const def = types.get(node.type);
        d.title.textContent = def.label + ' — full controls';
        d.panel.style.borderTopColor = def.color;
        d.host.appendChild(c.dialogBody);
        d.backdrop.style.display = 'flex';
        dialogNode = node;
        if (c.onDialogToggle) c.onDialogToggle(true);
    }
    function closeDialog() {
        if (!dlg || !dialogNode) return;
        dlg.backdrop.style.display = 'none';
        const node = dialogNode;
        dialogNode = null;
        const c = cards.get(node);
        if (c) {
            if (c.dialogBody.parentNode) c.dialogBody.remove();
            if (c.onDialogToggle) c.onDialogToggle(false);
        }
    }

    // --- focus --------------------------------------------------------------------------
    function setFocus(node) {
        if (focused && cards.has(focused)) cards.get(focused).root.classList.remove('focused');
        focused = node || null;
        if (focused && cards.has(focused)) cards.get(focused).root.classList.add('focused');
    }

    // --- cards --------------------------------------------------------------------------
    function buildCard(node) {
        const def = types.get(node.type);
        const collapse = h('button.ng-collapse', { title: 'Collapse / expand' });
        const badge = h('span.ng-badge');
        const gear = h('button.ng-gear', { title: 'Full controls', style: { display: 'none' } }, '⚙');
        const del = h('button.ng-del', { title: 'Remove this node' }, '✕');
        const header = h('div.ng-header', null, collapse, h('span.ng-title', null, def.label), badge, h('span.k-spacer'), gear, del);
        const ins = def.ins.map((p, i) => h('span.ng-port', { dataset: { dir: 'in', port: String(i) }, title: p.type }));
        const outs = def.outs.map((p, i) => h('span.ng-port', { dataset: { dir: 'out', port: String(i) }, title: p.type }));
        const ports = h('div.ng-ports', null,
            h('div.ng-ports-in', null, def.ins.map((p, i) => h('div.ng-port-row', null, ins[i], h('span', null, p.name)))),
            h('div.ng-ports-out', null, def.outs.map((p, i) => h('div.ng-port-row.out', null, h('span', null, p.name), outs[i]))));
        const body = h('div.ng-body');
        const root = h('div.ng-card', { style: { borderTopColor: def.color }, dataset: { type: node.type, id: node.id } }, header, ports, body);
        const c = { node, root, header, body, ports, badge, collapse, gear, ins, outs, dialogBody: h('div'), onDialogToggle: null, cleanup: [] };
        cards.set(node, c);
        layer.appendChild(root);
        syncCollapsed(c);

        collapse.addEventListener('click', (e) => { e.stopPropagation(); doCollapse(node, !node.collapsed); changed(); });
        gear.addEventListener('click', (e) => { e.stopPropagation(); openDialog(node); });
        del.addEventListener('click', (e) => { e.stopPropagation(); remove(node); });

        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            e.preventDefault();
            setFocus(node);
            const p = stagePos(e), w = toWorld(p.x, p.y);
            const grab = { ox: w.x - node.x, oy: w.y - node.y, x0: node.x, y0: node.y };
            dragging(true);
            trackDrag((ev) => {
                const q = stagePos(ev), ww = toWorld(q.x, q.y);
                node.x = ww.x - grab.ox; node.y = ww.y - grab.oy;
                place(c);
            }, () => {
                dragging(false);
                if (node.x !== grab.x0 || node.y !== grab.y0) { doMove(node, grab.x0, grab.y0); changed(); }
            });
        });
        body.addEventListener('mousedown', () => setFocus(node));

        ins.forEach((dot, i) => dot.addEventListener('mousedown', (e) => {
            e.preventDefault(); e.stopPropagation();
            const edge = graph.edgeInto(node, i);
            if (edge) beginWire(e, edge.from.node, edge.from.port, edge);
        }));
        outs.forEach((dot, i) => dot.addEventListener('mousedown', (e) => {
            e.preventDefault(); e.stopPropagation();
            beginWire(e, node, i, null);
        }));

        const api = {
            invalidate(n, out, ms) { if (o.onInvalidate) o.onInvalidate(n || node, out, ms); },
            markDirty: changed,
            setBadge(text, isErr) {
                badge.textContent = text || '';
                badge.title = text || '';
                badge.classList.toggle('err', !!isErr);
                node.error = isErr ? (text || 'error') : null;
            },
            dialogBody: c.dialogBody,
            onDialogToggle(fn) { c.onDialogToggle = fn; },
            onUnmount(fn) { c.cleanup.push(fn); },
        };
        try { def.mount && def.mount(body, node, graph, api); }
        catch (e) { body.appendChild(h('div.ng-mount-error', null, 'mount failed: ' + ((e && e.message) || e))); }
        gear.style.display = c.dialogBody.childElementCount ? '' : 'none';
        place(c);
        return c;
    }

    function syncCollapsed(c) {
        c.collapse.textContent = c.node.collapsed ? '▸' : '▾';
        c.body.style.display = c.node.collapsed ? 'none' : '';
        c.ports.style.display = c.node.collapsed ? 'none' : '';
    }
    function place(c) {
        c.root.style.left = c.node.x + 'px';
        c.root.style.top = c.node.y + 'px';
    }
    function dropCard(node) {
        const c = cards.get(node);
        if (!c) return;
        if (dialogNode === node) closeDialog();
        for (const fn of c.cleanup) { try { fn(); } catch (e) { /* keep tearing down */ } }
        const def = types.get(node.type);
        if (def && def.unmount) { try { def.unmount(node); } catch (e) { /* ditto */ } }
        c.root.remove();
        cards.delete(node);
        if (focused === node) focused = null;
    }
    function sync() {
        for (const n of Array.from(cards.keys())) if (graph.nodes.indexOf(n) < 0) dropCard(n);
        for (const n of graph.nodes) {
            const c = cards.get(n) || buildCard(n);
            place(c);
            syncCollapsed(c);
        }
    }
    const offGraph = graph.on('change', sync);

    function remove(node) {
        doRemove(node);
        if (cards.has(node)) dropCard(node);
        changed();
    }

    // --- wiring -------------------------------------------------------------------------
    function beginWire(e, fromNode, fromPort, lifted) {
        wire = { fromNode, fromPort, lifted, screen: stagePos(e), hover: null };
        dragging(true);
        trackDrag((ev) => {
            wire.screen = stagePos(ev);
            wire.hover = dotUnder(ev.clientX, ev.clientY);
        }, (ev) => {
            const w = wire;
            wire = null;
            dragging(false);
            const hit = dotUnder(ev.clientX, ev.clientY);
            if (w.lifted) {
                if (hit && hit.node === w.lifted.to.node && hit.port === w.lifted.to.port) return;
                doRewire(w.lifted, hit ? hit.node : null, hit ? hit.port : 0);
                changed();
            } else if (hit) {
                if (doConnect(w.fromNode, w.fromPort, hit.node, hit.port)) changed();
            }
        });
    }

    // Hit-test the known input dots by rect (no elementFromPoint in bro's DOM).
    function dotUnder(cx, cy) {
        if (cx == null || cy == null) return null;
        for (const [node, c] of cards) {
            for (let i = 0; i < c.ins.length; i++) {
                const dot = c.ins[i];
                if (dot.offsetParent === null) continue;
                const r = dot.getBoundingClientRect();
                if (cx >= r.left - 3 && cx <= r.right + 3 && cy >= r.top - 3 && cy <= r.bottom + 3) return { node, port: i, el: dot };
            }
        }
        return null;
    }

    // --- stage input --------------------------------------------------------------------
    stage.addEventListener('mousedown', (e) => {
        if (e.target !== stage && e.target !== gridCanvas && e.target !== wireCanvas && e.target !== layer) return;
        setFocus(null);
        const p = stagePos(e), v0 = { x: view.x, y: view.y };
        dragging(true);
        trackDrag((ev) => {
            const q = stagePos(ev);
            view.x = v0.x + q.x - p.x;
            view.y = v0.y + q.y - p.y;
            applyTransform();
        }, () => dragging(false));
    });
    stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const p = stagePos(e);
        zoomAt(p.x, p.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
    function zoomAt(sx, sy, factor) {
        const w = toWorld(sx, sy);
        view.scale = Math.min(o.maxZoom, Math.max(o.minZoom, view.scale * factor));
        view.x = sx - w.x * view.scale;
        view.y = sy - w.y * view.scale;
        applyTransform();
    }
    const onKey = (e) => {
        if (e.key === 'Escape' && dialogNode) { closeDialog(); return; }
        if ((e.key === 'Delete' || e.key === 'Backspace') && focused && !dialogNode && !isTextTarget(e.target)) {
            remove(focused);
            e.preventDefault();
        }
    };
    window.addEventListener('keydown', onKey);
    const onResize = () => resize();
    window.addEventListener('resize', onResize);

    // --- drawing ------------------------------------------------------------------------
    function dotCenter(dot) {
        const r = dot.getBoundingClientRect(), s = stage.getBoundingClientRect();
        return { x: r.left + r.width / 2 - s.left, y: r.top + r.height / 2 - s.top };
    }
    function curveOf(a, b) {
        const dx = Math.max(60, Math.abs(b.x - a.x) * 0.5);
        return [a, { x: a.x + dx, y: a.y }, { x: b.x - dx, y: b.y }, b];
    }
    function bez(c, t) {
        const u = 1 - t, k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
        return { x: k0 * c[0].x + k1 * c[1].x + k2 * c[2].x + k3 * c[3].x, y: k0 * c[0].y + k1 * c[1].y + k2 * c[2].y + k3 * c[3].y };
    }
    function stroke(c, color, width) {
        wctx.lineWidth = width; wctx.strokeStyle = color;
        wctx.beginPath();
        wctx.moveTo(c[0].x, c[0].y);
        wctx.bezierCurveTo(c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y);
        wctx.stroke();
    }
    function drawGrid() {
        const w = gridCanvas.width, hh = gridCanvas.height, step = 32 * view.scale;
        gctx.fillStyle = COLORS.bg;
        gctx.fillRect(0, 0, w, hh);
        if (step < 6) return;
        gctx.strokeStyle = COLORS.grid; gctx.lineWidth = 1;
        gctx.beginPath();
        for (let x = view.x % step; x < w; x += step) { gctx.moveTo(x, 0); gctx.lineTo(x, hh); }
        for (let y = view.y % step; y < hh; y += step) { gctx.moveTo(0, y); gctx.lineTo(w, y); }
        gctx.stroke();
    }
    function drawWires(now) {
        wctx.clearRect(0, 0, wireCanvas.width, wireCanvas.height);
        for (const e of graph.edges) {
            if (wire && wire.lifted === e) continue;
            const fc = cards.get(e.from.node), tc = cards.get(e.to.node);
            if (!fc || !tc || !fc.outs[e.from.port] || !tc.ins[e.to.port]) continue;
            const c = curveOf(dotCenter(fc.outs[e.from.port]), dotCenter(tc.ins[e.to.port]));
            const live = e.from.node._ran && !e.from.node.error;
            stroke(c, live ? COLORS.live : COLORS.wire, 2.2);
            if (!live) continue;
            for (let k = 0; k < 3; k++) {
                const t = ((now / 1100) + k / 3) % 1, p = bez(c, t);
                wctx.beginPath(); wctx.arc(p.x, p.y, 3, 0, 6.2832);
                wctx.fillStyle = 'rgba(' + COLORS.pulse + ',' + (0.9 - Math.abs(t - 0.5)) + ')';
                wctx.fill();
            }
        }
        if (wire) {
            const fc = cards.get(wire.fromNode);
            if (fc && fc.outs[wire.fromPort]) {
                const a = dotCenter(fc.outs[wire.fromPort]);
                const hv = wire.hover;
                const ok = hv && graph.canConnect(wire.fromNode, wire.fromPort, hv.node, hv.port);
                stroke(curveOf(a, hv ? dotCenter(hv.el) : wire.screen), hv ? (ok ? COLORS.ok : COLORS.bad) : COLORS.drag, 2.4);
            }
        }
    }
    function draw(now) {
        sync();
        drawGrid();
        drawWires(now || 0);
    }
    function resize() {
        const w = stage.clientWidth || 900, hh = stage.clientHeight || 600;
        if (gridCanvas.width !== w || gridCanvas.height !== hh) {
            gridCanvas.width = wireCanvas.width = w;
            gridCanvas.height = wireCanvas.height = hh;
        }
    }

    let raf = 0;
    function frame(now) {
        resize();
        draw(now || 0);
        raf = requestAnimationFrame(frame);
    }

    // --- placement ----------------------------------------------------------------------
    function frameAll() {
        resize();
        if (!graph.nodes.length) { view.x = 80; view.y = 80; view.scale = 1; applyTransform(); return; }
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const n of graph.nodes) {
            const c = cards.get(n);
            const w = c ? c.root.offsetWidth : 360, hh = c ? c.root.offsetHeight : 120;
            x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
            x1 = Math.max(x1, n.x + w); y1 = Math.max(y1, n.y + hh);
        }
        const pad = 70, sw = wireCanvas.width, sh = wireCanvas.height;
        view.scale = Math.min(1.2, Math.max(0.35, Math.min(sw / (x1 - x0 + pad * 2), sh / (y1 - y0 + pad * 2))));
        view.x = (sw - (x1 + x0) * view.scale) / 2;
        view.y = (sh - (y1 + y0) * view.scale) / 2;
        applyTransform();
    }
    /** A free spot near the middle of the visible stage (successive calls cascade). */
    function centreSpot() {
        resize();
        const c = toWorld(wireCanvas.width / 2, wireCanvas.height / 2);
        const k = placeCount++ % 6;
        return { x: Math.round(c.x - 180 + k * 28), y: Math.round(c.y - 60 + k * 28) };
    }
    function placeNew(node) {
        const p = centreSpot();
        node.x = p.x; node.y = p.y;
        const c = cards.get(node);
        if (c) place(c);
    }

    applyTransform();
    resize();
    sync();
    if (o.loop) raf = requestAnimationFrame(frame);

    return {
        view,
        /** The card record for a node: { root, header, body, badge, gear, ins, outs, dialogBody }. */
        card: (node) => cards.get(node) || null,
        get focused() { return focused; },
        focus: setFocus,
        get dialogNode() { return dialogNode; },
        openDialog, closeDialog,
        /** Add a node of `type` near the centre of the view (undoable with opts.edits). */
        addAtCentre(type, params) {
            const p = centreSpot();
            const node = edits ? edits.add(type, p.x, p.y, { params }) : graph.addNode(type, p.x, p.y, { params });
            setFocus(node);
            changed();
            return node;
        },
        remove,
        placeNew, frameAll, resize, draw, sync, zoomAt,
        toWorld,
        dispose() {
            cancelAnimationFrame(raf);
            offGraph();
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', onResize);
            closeDialog();
            for (const n of Array.from(cards.keys())) dropCard(n);
            if (dlg) dlg.backdrop.remove();
            gridCanvas.remove(); wireCanvas.remove(); layer.remove();
        },
    };
}

/**
 * The node-type list: types grouped by category, one button each.
 * opts: { onAdd(type), title = 'Nodes', hint }. Returns { el, rebuild() }.
 */
export function nodePalette(target, types, opts) {
    const host = $el(target);
    const o = opts || {};
    function rebuild() {
        while (host.firstChild) host.removeChild(host.firstChild);
        host.classList.add('ng-palette');
        host.appendChild(h('h2', null, o.title || 'Nodes'));
        for (const cat of types.categories()) {
            const defs = types.byCategory(cat).filter((d) => !d.hidden);
            if (!defs.length) continue;
            host.appendChild(h('div.ng-pal-cat', null, cat));
            for (const def of defs) {
                host.appendChild(h('button.ng-pal-op', {
                    title: def.desc || def.label, dataset: { type: def.type },
                    onclick: () => { if (o.onAdd) o.onAdd(def.type); },
                }, h('span.ng-pal-dot', { style: { background: def.color } }), h('span', null, def.label)));
            }
        }
        if (o.hint) host.appendChild(h('p.k-note.ng-pal-hint', null, o.hint));
    }
    rebuild();
    return { el: host, rebuild };
}
