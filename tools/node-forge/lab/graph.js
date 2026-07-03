// Node Forge — graph model.
//
// A graph is a DAG of comprehensive, self-contained node cards connected by
// typed edges (mostly audio-buffer, for chaining a lab's output into another
// card). It owns:
//   topo()          Kahn topological sort (null if the graph has a cycle)
//   clearRun() / invalidateFrom(node)   run-state management (see below)
//   serialize()/deserialize()           save/load
//
// There is no shape-inference pass — these are hand-built UI cards, not
// tensor ops with matrix dims to propagate. A node's validity is whatever
// its own exec()/mount() decides and reports via node.error.
import { Nodes, portsCompatible } from "/app/lab/node-registry.js";

  let nextId = 1;
  const uid = (pfx) => pfx + (nextId++);

  function create() {
    const g = {
      nodes: [],
      edges: [],

      // --- mutation -----------------------------------------------------
      addNode(type, x, y) {
        const def = Nodes.get(type);
        if (!def) throw new Error('unknown node type: ' + type);
        const node = {
          id: uid('n'), type: type, x: x || 0, y: y || 0,
          params: {},
          error: null,
          collapsed: false,          // whole-card collapse-to-titlebar
          // runtime (filled by the runner / a node's own live-preview path)
          _out: null, _time: 0, _ran: false,
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
      // incompatible or the edge would create a cycle.
      addEdge(fromNode, fromPort, toNode, toPort) {
        if (fromNode === toNode) return null;
        const fromDef = Nodes.get(fromNode.type), toDef = Nodes.get(toNode.type);
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
        const fromDef = Nodes.get(fromNode.type), toDef = Nodes.get(toNode.type);
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

      // --- run-state ----------------------------------------------------
      clearRun() {
        for (const n of this.nodes) { n._out = null; n._time = 0; n._ran = false; }
      },

      // Invalidate only `node` and whatever's reachable FORWARD from it
      // (i.e. downstream consumers), leaving upstream/sibling nodes' cached
      // _out/_ran alone. This is what makes a node's own live-preview loop
      // (async synth onDone, a curve/slider edit) cheap: it never forces an
      // upstream/sibling card to redundantly recompute. clearRun() (full
      // wipe) is still what Reset/a fresh Run use.
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
          n._out = null; n._time = 0; n._ran = false;
          for (const m of adj.get(n) || []) stack.push(m);
        }
      },

      // --- serialisation ------------------------------------------------
      serialize() {
        return {
          nodes: this.nodes.map((n) => ({
            id: n.id, type: n.type, x: n.x, y: n.y, collapsed: !!n.collapsed,
            params: Object.assign({}, n.params),
          })),
          edges: this.edges.map((e) => ({
            from: e.from.node.id, fromPort: e.from.port,
            to: e.to.node.id, toPort: e.to.port,
          })),
        };
      },

      // Reconstruct from serialize()'s output into THIS graph (wipes any
      // current nodes/edges first). Tolerates node entries whose type no
      // longer exists — skips the node (and any edge touching it) rather
      // than throwing. Returns { skipped: [ids] } for the caller to toast.
      deserialize(data) {
        this.nodes.length = 0;
        this.edges.length = 0;
        const idMap = new Map();
        const skipped = [];
        for (const n of (data && data.nodes) || []) {
          if (!Nodes.get(n.type)) { skipped.push(n.id); continue; }
          const node = this.addNode(n.type, n.x, n.y);
          Object.assign(node.params, n.params);
          node.collapsed = !!n.collapsed;
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
