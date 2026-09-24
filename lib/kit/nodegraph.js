// lib/kit/nodegraph.js — a typed node graph: node types, the graph model,
// undoable edits and a dataflow runner (no DOM; the canvas is nodegraph-view.js).
//
//   import { NodeTypes, Graph, graphEdits, Runner } from "/lib/kit/nodegraph.js";
//   const types = new NodeTypes({ compat: { 'audio-buffer': ['audio-buffer'] } });
//   types.define({
//       type: 'gain', label: 'Gain', cat: 'Audio', color: '#34d399',
//       ins: [{ name: 'in', type: 'audio-buffer' }], outs: [{ name: 'out', type: 'audio-buffer' }],
//       exec(ins, params, node) { return [scale(ins[0], params.gain)]; },
//       mount(body, node, graph, api) { ... },   // the card UI (nodegraph-view.js)
//   });
//   const graph = new Graph(types);
//   const edits = graphEdits(graph, history);     // undoable add / remove / connect / move ...
//   const runner = new Runner(graph);
//   edits.add('gain', 100, 80); runner.run();
//
// A node is a plain object: { id, type, x, y, params, collapsed, error } plus
// runtime fields the runner and the node's own code own (_out, _time, _ran,
// and anything `_`-prefixed). Only id / type / x / y / collapsed / params are
// saved, so params must hold JSON-safe values (plain arrays, not typed arrays).
//
// Graph events (graph.on(name, fn) -> off):
//   'change' { kind: 'add' | 'remove' | 'connect' | 'disconnect' | 'move' |
//              'collapse' | 'clear' | 'load', node?, edge? }

// --- node types ------------------------------------------------------------------

/**
 * A registry of node types. opts.compat maps an output port type to the input
 * types it may feed ({ 'audio-buffer': ['audio-buffer'] }); a type with no
 * entry only feeds itself.
 * A type spec: { type, label, cat, color, desc, ins: [{name, type}], outs,
 *   exec(ins, params, node) -> outs, mount(body, node, graph, api), unmount(node) }.
 */
export class NodeTypes {
    constructor(opts) {
        this.defs = {};
        this.cats = [];
        this.compat = Object.assign({}, opts && opts.compat);
    }
    /** Register (or replace) a type; its category joins the palette order. */
    define(spec) {
        if (!spec || !spec.type) throw new Error('nodegraph: a type needs a `type`');
        spec.ins = spec.ins || [];
        spec.outs = spec.outs || [];
        spec.label = spec.label || spec.type;
        spec.color = spec.color || '#7dd3fc';
        this.defs[spec.type] = spec;
        const cat = spec.cat || 'Nodes';
        spec.cat = cat;
        if (this.cats.indexOf(cat) < 0) this.cats.push(cat);
        return spec;
    }
    get(type) { return this.defs[type] || null; }
    list() { return Object.keys(this.defs).map((k) => this.defs[k]); }
    categories() { return this.cats.slice(); }
    byCategory(cat) { return this.list().filter((d) => d.cat === cat); }
    /** Can an output of type `from` feed an input of type `to`? */
    compatible(from, to) {
        const allowed = this.compat[from];
        return allowed ? allowed.indexOf(to) >= 0 : from === to;
    }
}

// --- the graph -------------------------------------------------------------------

export class Graph {
    constructor(types) {
        this.types = types;
        this.nodes = [];
        this.edges = [];
        this._next = 1;
        this._listeners = {};
    }

    on(ev, fn) {
        (this._listeners[ev] || (this._listeners[ev] = [])).push(fn);
        return () => { const a = this._listeners[ev]; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
    }
    emit(ev, payload) {
        for (const fn of (this._listeners[ev] || []).slice()) fn(payload, this);
    }
    _changed(kind, extra) { this.emit('change', Object.assign({ kind }, extra)); }

    _id(prefix) {
        let id;
        do { id = prefix + (this._next++); }
        while (this.nodes.some((n) => n.id === id) || this.edges.some((e) => e.id === id));
        return id;
    }

    /** New node of `type` at world (x, y). opts: { id, params, collapsed }. */
    addNode(type, x, y, opts) {
        if (!this.types.get(type)) throw new Error('nodegraph: unknown node type ' + type);
        const o = opts || {};
        const node = {
            id: o.id && !this.nodeById(o.id) ? o.id : this._id('n'),
            type, x: x || 0, y: y || 0,
            params: Object.assign({}, o.params),
            collapsed: !!o.collapsed,
            error: null,
            _out: null, _time: 0, _ran: false,
        };
        this.nodes.push(node);
        this._changed('add', { node });
        return node;
    }

    /** Put a removed node object back (undo), at `index` when given. */
    insertNode(node, index) {
        if (this.nodes.indexOf(node) >= 0) return node;
        if (index == null || index > this.nodes.length) this.nodes.push(node);
        else this.nodes.splice(index, 0, node);
        this._changed('add', { node });
        return node;
    }

    /** Remove a node and every edge touching it. Returns { index, edges } for undo. */
    removeNode(node) {
        const index = this.nodes.indexOf(node);
        if (index < 0) return null;
        const edges = this.edges.filter((e) => e.from.node === node || e.to.node === node);
        this.edges = this.edges.filter((e) => edges.indexOf(e) < 0);
        this.nodes.splice(index, 1);
        this._changed('remove', { node });
        return { index, edges };
    }

    nodeById(id) { return this.nodes.find((n) => n.id === id) || null; }

    /** Would an edge fromNode.outs[fromPort] -> toNode.ins[toPort] type-check? */
    canConnect(fromNode, fromPort, toNode, toPort) {
        if (!fromNode || !toNode || fromNode === toNode) return false;
        const a = this.types.get(fromNode.type).outs[fromPort || 0];
        const b = this.types.get(toNode.type).ins[toPort || 0];
        return !!(a && b && this.types.compatible(a.type, b.type));
    }

    /**
     * Connect; an input holds one edge, so an existing edge into that port is
     * replaced. Returns { edge, replaced, existing } (existing: that exact
     * edge was already there, nothing changed) or null (no change) when the
     * types do not match or the edge would close a cycle.
     */
    connect(fromNode, fromPort, toNode, toPort) {
        fromPort = fromPort || 0; toPort = toPort || 0;
        if (!this.canConnect(fromNode, fromPort, toNode, toPort)) return null;
        const replaced = this.edgeInto(toNode, toPort);
        if (replaced && replaced.from.node === fromNode && replaced.from.port === fromPort) {
            return { edge: replaced, replaced: null, existing: true };
        }
        const edge = { id: this._id('e'), from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } };
        const kept = this.edges.filter((e) => e !== replaced);
        const prev = this.edges;
        this.edges = kept.concat([edge]);
        if (!this.topo()) { this.edges = prev; return null; }
        this._changed('connect', { edge });
        return { edge, replaced };
    }

    /** connect() returning just the edge (or null). */
    addEdge(fromNode, fromPort, toNode, toPort) {
        const r = this.connect(fromNode, fromPort, toNode, toPort);
        return r ? r.edge : null;
    }

    /** Put a removed edge object back (undo). */
    insertEdge(edge) {
        if (this.edges.indexOf(edge) >= 0) return edge;
        if (this.nodes.indexOf(edge.from.node) < 0 || this.nodes.indexOf(edge.to.node) < 0) return null;
        const clash = this.edgeInto(edge.to.node, edge.to.port);
        if (clash) this.edges = this.edges.filter((e) => e !== clash);
        this.edges.push(edge);
        this._changed('connect', { edge });
        return edge;
    }

    removeEdge(edge) {
        const n = this.edges.length;
        this.edges = this.edges.filter((e) => e !== edge);
        if (this.edges.length !== n) this._changed('disconnect', { edge });
    }

    edgeInto(node, port) {
        return this.edges.find((e) => e.to.node === node && e.to.port === (port || 0)) || null;
    }

    moveNode(node, x, y) {
        node.x = x; node.y = y;
        this._changed('move', { node });
    }

    setCollapsed(node, on) {
        node.collapsed = !!on;
        this._changed('collapse', { node });
    }

    /** Remove everything. Returns the old { nodes, edges } for undo. */
    clear() {
        const old = { nodes: this.nodes, edges: this.edges };
        this.nodes = [];
        this.edges = [];
        this._changed('clear');
        return old;
    }

    /** Swap in whole node / edge arrays (undo of clear). */
    restore(state) {
        this.nodes = state.nodes.slice();
        this.edges = state.edges.slice();
        this._changed('load');
    }

    // --- topology + run state ----------------------------------------------------

    /** Nodes in dependency order (Kahn), or null when there is a cycle. */
    topo() {
        const indeg = new Map(), adj = new Map();
        for (const n of this.nodes) { indeg.set(n, 0); adj.set(n, []); }
        for (const e of this.edges) {
            if (!indeg.has(e.to.node) || !indeg.has(e.from.node)) continue;
            indeg.set(e.to.node, indeg.get(e.to.node) + 1);
            adj.get(e.from.node).push(e.to.node);
        }
        const queue = this.nodes.filter((n) => indeg.get(n) === 0), order = [];
        while (queue.length) {
            const n = queue.shift();
            order.push(n);
            for (const m of adj.get(n)) {
                indeg.set(m, indeg.get(m) - 1);
                if (indeg.get(m) === 0) queue.push(m);
            }
        }
        return order.length === this.nodes.length ? order : null;
    }

    /** Forget every node's computed output. */
    clearRun() {
        for (const n of this.nodes) { n._out = null; n._time = 0; n._ran = false; }
    }

    /** Forget `node`'s output and everything downstream of it (upstream stays cached). */
    invalidateFrom(node) {
        const seen = new Set(), stack = [node];
        while (stack.length) {
            const n = stack.pop();
            if (seen.has(n)) continue;
            seen.add(n);
            n._out = null; n._time = 0; n._ran = false;
            for (const e of this.edges) if (e.from.node === n) stack.push(e.to.node);
        }
    }

    // --- save / load ---------------------------------------------------------------

    serialize() {
        return {
            nodes: this.nodes.map((n) => ({
                id: n.id, type: n.type, x: n.x, y: n.y, collapsed: !!n.collapsed,
                params: Object.assign({}, n.params),
            })),
            edges: this.edges.map((e) => ({
                from: e.from.node.id, fromPort: e.from.port, to: e.to.node.id, toPort: e.to.port,
            })),
        };
    }

    /**
     * Replace the graph with serialize() output. Nodes of unknown types (and
     * their edges) are skipped. Returns { skipped: [ids] }.
     */
    deserialize(data) {
        const nodes = [], edges = [], byId = new Map(), skipped = [];
        this.nodes = nodes; this.edges = edges;
        for (const d of (data && data.nodes) || []) {
            if (!this.types.get(d.type)) { skipped.push(d.id); continue; }
            const node = {
                id: d.id && !byId.has(d.id) ? d.id : this._id('n'), type: d.type, x: d.x || 0, y: d.y || 0,
                params: Object.assign({}, d.params), collapsed: !!d.collapsed, error: null,
                _out: null, _time: 0, _ran: false,
            };
            nodes.push(node);
            byId.set(d.id, node);
        }
        for (const d of (data && data.edges) || []) {
            const from = byId.get(d.from), to = byId.get(d.to);
            if (from && to && this.canConnect(from, d.fromPort, to, d.toPort) && !this.edgeInto(to, d.toPort || 0)) {
                edges.push({ id: this._id('e'), from: { node: from, port: d.fromPort || 0 }, to: { node: to, port: d.toPort || 0 } });
            }
        }
        if (!this.topo()) this.edges = [];
        this._changed('load');
        return { skipped };
    }
}

// --- undoable edits ----------------------------------------------------------------

/**
 * Structural edits recorded on a History (lib/history.js); with no history
 * they just apply. Every method returns what the graph call returned.
 *   add(type, x, y, opts)         remove(node)
 *   connect(from, fp, to, tp)     disconnect(edge)
 *   rewire(edge, to, tp)          move the input end of an edge (null: drop it)
 *   move(node, x0, y0)            record a finished drag (node already at its new spot)
 *   collapse(node, on)            clear()
 */
export function graphEdits(graph, history) {
    const rec = (label, doFn, undoFn) => { if (history) history.record(label, doFn, undoFn); };
    const tx = (label, fn) => (history ? history.transaction(label, fn) : fn());
    const edits = {
        add(type, x, y, opts) {
            const node = graph.addNode(type, x, y, opts);
            rec('Add ' + graph.types.get(type).label, () => graph.insertNode(node), () => graph.removeNode(node));
            return node;
        },
        remove(node) {
            const r = graph.removeNode(node);
            if (!r) return null;
            rec('Delete ' + graph.types.get(node.type).label, () => graph.removeNode(node), () => {
                graph.insertNode(node, r.index);
                for (const e of r.edges) graph.insertEdge(e);
            });
            return r;
        },
        connect(from, fromPort, to, toPort) {
            const r = graph.connect(from, fromPort, to, toPort);
            if (!r || r.existing) return r;
            rec('Connect', () => { if (r.replaced) graph.removeEdge(r.replaced); graph.insertEdge(r.edge); },
                () => { graph.removeEdge(r.edge); if (r.replaced) graph.insertEdge(r.replaced); });
            return r;
        },
        disconnect(edge) {
            if (graph.edges.indexOf(edge) < 0) return;
            graph.removeEdge(edge);
            rec('Disconnect', () => graph.removeEdge(edge), () => graph.insertEdge(edge));
        },
        rewire(edge, to, toPort) {
            return tx('Rewire', () => {
                edits.disconnect(edge);
                return to ? edits.connect(edge.from.node, edge.from.port, to, toPort) : null;
            });
        },
        move(node, x0, y0) {
            const x1 = node.x, y1 = node.y;
            if (x0 === x1 && y0 === y1) return;
            rec('Move', () => graph.moveNode(node, x1, y1), () => graph.moveNode(node, x0, y0));
        },
        collapse(node, on) {
            const was = !!node.collapsed;
            if (was === !!on) return;
            graph.setCollapsed(node, on);
            rec(on ? 'Collapse' : 'Expand', () => graph.setCollapsed(node, on), () => graph.setCollapsed(node, was));
        },
        clear() {
            if (!graph.nodes.length) return;
            const old = graph.clear();
            rec('Clear', () => graph.clear(), () => graph.restore(old));
        },
    };
    return edits;
}

// --- running -------------------------------------------------------------------------

const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/**
 * Runs the graph's exec() functions in dependency order. A node runs once
 * every input is wired to a node that already ran; a node with an unwired
 * input never runs. opts.ready() gates run/step/continue (e.g. a GPU check).
 */
export class Runner {
    constructor(graph, opts) {
        this.graph = graph;
        this._ready = (opts && opts.ready) || (() => true);
    }
    ready() { return !!this._ready(); }
    reset() { this.graph.clearRun(); }

    _inputs(n) {
        const def = this.graph.types.get(n.type), ins = [];
        for (let p = 0; p < def.ins.length; p++) {
            const e = this.graph.edgeInto(n, p);
            if (!e || !e.from.node._out) throw new Error('input ' + (p + 1) + ' has no value');
            ins.push(e.from.node._out[e.from.port]);
        }
        return ins;
    }
    _runNode(n) {
        const def = this.graph.types.get(n.type);
        const t0 = clock();
        try {
            n._out = def.exec(this._inputs(n), n.params, n);
        } catch (err) {
            n.error = String((err && err.message) || err);
            throw err;
        }
        n._time = clock() - t0;
        n._ran = true;
        n.error = null;
    }
    _next(order) {
        for (const n of order) {
            if (n._ran) continue;
            const def = this.graph.types.get(n.type);
            let ok = true;
            for (let p = 0; p < def.ins.length && ok; p++) {
                const e = this.graph.edgeInto(n, p);
                ok = !!(e && e.from.node._ran);
            }
            if (ok) return n;
        }
        return null;
    }
    _order() {
        if (!this.ready()) throw new Error('runner not ready');
        const order = this.graph.topo();
        if (!order) throw new Error('graph has a cycle');
        return order;
    }

    /** Run one ready node; returns it, or null when nothing is left. */
    step() {
        const n = this._next(this._order());
        if (n) this._runNode(n);
        return n;
    }
    /** Recompute everything. Returns how many nodes ran. */
    run(onProgress) {
        this.graph.clearRun();
        return this.continue(onProgress);
    }
    /** Run whatever has no output yet (after invalidateFrom), keeping cached results. */
    continue(onProgress) {
        const order = this._order();
        let done = 0, n;
        while ((n = this._next(order)) !== null) {
            this._runNode(n);
            done++;
            if (onProgress) onProgress(n, done, order.length);
        }
        return done;
    }
}
