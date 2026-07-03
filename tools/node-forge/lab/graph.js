// Tensor Lab — graph model.
//
// A graph is a DAG of op nodes connected by tensor edges. It owns three
// derived passes that the editor / runner consume:
//   propagate()  walks topo order, runs each op's pure-JS shape() — fills
//                node.shapes / node.error so the editor can draw live dims
//   topo()       Kahn topological sort (null if the graph has a cycle)
//   stats()      aggregate parameter / FLOP totals
//
// Each input port accepts exactly one edge; output ports fan out freely.
import { Ops, portsCompatible } from "/app/lab/ops-registry.js";

  let nextId = 1;
  const uid = (pfx) => pfx + (nextId++);

  function create() {
    const g = {
      nodes: [],
      edges: [],

      // --- mutation -----------------------------------------------------
      addNode(type, x, y) {
        const def = Ops.get(type);
        if (!def) throw new Error('unknown op: ' + type);
        const params = {};
        for (const f of def.params) params[f.key] = f.def;
        const node = {
          id: uid('n'), type: type, x: x || 0, y: y || 0,
          params: params,
          shapes: null,     // [{rows,cols}] per output port once propagated
          inShapes: null,   // [{rows,cols}] per input port
          error: null,      // shape-inference error string
          // runtime (filled by the runner)
          _out: null, _time: 0, _ran: false, _attn: null,
          _w: undefined, _wsig: undefined,
        };
        this.nodes.push(node);
        return node;
      },

      removeNode(node) {
        this.edges = this.edges.filter((e) => e.from.node !== node && e.to.node !== node);
        this.nodes = this.nodes.filter((n) => n !== node);
      },

      // connect; an input port holds only one edge, so replace any existing.
      // Returns null (and makes no change) if the ports' declared types are
      // incompatible or the edge would create a cycle — same rejection
      // shape for both, so callers (editor.js's wire-drop) need only check
      // for a null return, not distinguish why.
      addEdge(fromNode, fromPort, toNode, toPort) {
        if (fromNode === toNode) return null;
        const fromDef = Ops.get(fromNode.type), toDef = Ops.get(toNode.type);
        const fromP = fromDef.outs[fromPort || 0], toP = toDef.ins[toPort || 0];
        if (!fromP || !toP || !portsCompatible(fromP.type, toP.type)) return null;
        this.edges = this.edges.filter((e) => !(e.to.node === toNode && e.to.port === toPort));
        const edge = {
          id: uid('e'),
          from: { node: fromNode, port: fromPort || 0 },
          to: { node: toNode, port: toPort || 0 },
        };
        this.edges.push(edge);
        if (this.topo() === null) {        // would create a cycle — undo
          this.edges.pop();
          return null;
        }
        return edge;
      },

      // can this wire be made? Same check addEdge uses, exposed for the
      // editor to color a drag target before the drop actually happens.
      canConnect(fromNode, fromPort, toNode, toPort) {
        if (fromNode === toNode) return false;
        const fromDef = Ops.get(fromNode.type), toDef = Ops.get(toNode.type);
        const fromP = fromDef.outs[fromPort || 0], toP = toDef.ins[toPort || 0];
        return !!(fromP && toP && portsCompatible(fromP.type, toP.type));
      },

      removeEdge(edge) {
        this.edges = this.edges.filter((e) => e !== edge);
      },

      edgeInto(node, port) {
        return this.edges.find((e) => e.to.node === node && e.to.port === port) || null;
      },

      // --- topology -----------------------------------------------------
      topo() {
        const indeg = new Map(), adj = new Map();
        for (const n of this.nodes) { indeg.set(n, 0); adj.set(n, []); }
        for (const e of this.edges) {
          if (!indeg.has(e.to.node) || !indeg.has(e.from.node)) continue;
          indeg.set(e.to.node, indeg.get(e.to.node) + 1);
          adj.get(e.from.node).push(e.to.node);
        }
        const queue = this.nodes.filter((n) => indeg.get(n) === 0);
        const order = [];
        while (queue.length) {
          const n = queue.shift();
          order.push(n);
          for (const m of adj.get(n)) {
            indeg.set(m, indeg.get(m) - 1);
            if (indeg.get(m) === 0) queue.push(m);
          }
        }
        return order.length === this.nodes.length ? order : null;
      },

      // --- shape inference ---------------------------------------------
      propagate() {
        const order = this.topo();
        for (const n of this.nodes) { n.shapes = null; n.inShapes = null; n.error = null; }
        if (!order) {
          for (const n of this.nodes) n.error = 'cycle in graph';
          return;
        }
        for (const n of order) {
          const def = Ops.get(n.type);
          const ins = [];
          let missing = false;
          for (let p = 0; p < def.ins.length; p++) {
            const e = this.edgeInto(n, p);
            if (!e || !e.from.node.shapes || e.from.node.error) { missing = true; break; }
            ins.push(e.from.node.shapes[e.from.port]);
          }
          n.inShapes = ins;
          if (missing) {
            n.error = def.ins.length ? 'input ' + (ins.length + 1) + ' not connected' : null;
            if (def.ins.length) continue;
          }
          let res;
          try { res = def.shape(ins, n.params); }
          catch (err) { res = String(err && err.message || err); }
          if (typeof res === 'string') { n.error = res; n.shapes = null; }
          else { n.shapes = res; }
        }
      },

      // --- aggregate stats ---------------------------------------------
      stats() {
        let params = 0, flops = 0, time = 0;
        for (const n of this.nodes) {
          if (n.error || !n.inShapes) continue;
          const def = Ops.get(n.type);
          if (def.ins.length && n.inShapes.length < def.ins.length) continue;
          try {
            const s = def.stats(n.inShapes, n.params);
            params += s.params || 0;
            flops += s.flops || 0;
          } catch (e) { /* ignore */ }
          time += n._time || 0;
        }
        return { params: params, flops: flops, time: time, nodes: this.nodes.length };
      },

      // --- run-state ----------------------------------------------------
      clearRun() {
        for (const n of this.nodes) {
          n._out = null; n._time = 0; n._ran = false; n._attn = null;
        }
      },

      // Invalidate only `node` and whatever's reachable FORWARD from it
      // (i.e. downstream consumers), leaving upstream/sibling nodes' cached
      // _out/_ran alone. This is what makes a "paint and hear it live"
      // widget (curve-painter, basis-slider) viable: editing a downstream
      // node must not force an upstream encode/load node to redundantly
      // re-run. clearRun() (full wipe) is still what Reset/a fresh Run use.
      invalidateFrom(node) {
        const adj = new Map();
        for (const n of this.nodes) adj.set(n, []);
        for (const e of this.edges) {
          if (adj.has(e.from.node)) adj.get(e.from.node).push(e.to.node);
        }
        const seen = new Set(), stack = [node];
        while (stack.length) {
          const n = stack.pop();
          if (seen.has(n)) continue;
          seen.add(n);
          n._out = null; n._time = 0; n._ran = false; n._attn = null;
          for (const m of adj.get(n) || []) stack.push(m);
        }
      },

      // --- serialisation ------------------------------------------------
      serialize() {
        return {
          nodes: this.nodes.map((n) => ({
            id: n.id, type: n.type, x: n.x, y: n.y, params: Object.assign({}, n.params),
          })),
          edges: this.edges.map((e) => ({
            from: e.from.node.id, fromPort: e.from.port,
            to: e.to.node.id, toPort: e.to.port,
          })),
        };
      },

      // Reconstruct from serialize()'s output into THIS graph (wipes any
      // current nodes/edges first). Tolerates node entries whose op type no
      // longer exists — skips the node (and any edge touching it) rather
      // than throwing, so one stale/renamed op doesn't brick the whole
      // load. Returns { skipped: [ids] } for the caller to toast.
      deserialize(data) {
        this.nodes.length = 0;
        this.edges.length = 0;
        const idMap = new Map();
        const skipped = [];
        for (const n of (data && data.nodes) || []) {
          if (!Ops.get(n.type)) { skipped.push(n.id); continue; }
          const node = this.addNode(n.type, n.x, n.y);
          Object.assign(node.params, n.params);
          idMap.set(n.id, node);
        }
        for (const e of (data && data.edges) || []) {
          const from = idMap.get(e.from), to = idMap.get(e.to);
          if (from && to) this.addEdge(from, e.fromPort, to, e.toPort);
        }
        return { skipped: skipped };
      },
    };
    return g;
  }

  export const Graph = { create: create };
