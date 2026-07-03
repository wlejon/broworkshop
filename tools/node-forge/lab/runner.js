// Node Forge — execution engine.
//
// Walks the graph in topological order and runs each node's deterministic
// exec() — the sync recompute path used by Run/Step/tests/save-load. A
// node's own live interaction (dragging a slider/curve) does NOT go through
// here; it calls the model directly and asynchronously, then tells the
// graph it changed via invalidateFrom + a debounced continue() (see
// app.js's api.invalidate). This engine is what makes that "only the
// downstream subgraph re-runs" property hold for the deterministic path too.
import { Nodes } from "/app/lab/node-registry.js";

  const clock = (typeof performance !== 'undefined' && performance.now)
    ? () => performance.now() : () => Date.now();

  function create(graph) {
    // bro.tensor.available is the documented general-purpose "will an ML
    // model run on GPU" probe (docs/gpu-api.js) — used here as the umbrella
    // gate even though individual nodes talk to bro.rave/bro.tts, both of
    // which land on the same CUDA backend bro.tensor reports.
    function ready() { return !!(bro.tensor && bro.tensor.available); }

    function runNode(n) {
      const def = Nodes.get(n.type);
      const ins = [];
      for (let p = 0; p < def.ins.length; p++) {
        const e = graph.edgeInto(n, p);
        if (!e || !e.from.node._out) throw new Error('input ' + (p + 1) + ' has no value');
        ins.push(e.from.node._out[e.from.port]);
      }
      const t0 = clock();
      const out = def.exec(ins, n.params, n);
      n._time = clock() - t0;
      n._out = out;
      n._ran = true;
      n.error = null;
    }

    // the next node ready to run (all dependencies already executed)
    function nextNode(order) {
      for (const n of order) {
        if (n._ran) continue;
        const def = Nodes.get(n.type);
        let ok = true;
        for (let p = 0; p < def.ins.length; p++) {
          const e = graph.edgeInto(n, p);
          if (!e || !e.from.node._ran) { ok = false; break; }
        }
        if (ok) return n;
      }
      return null;
    }

    return {
      ready: ready,

      reset() { graph.clearRun(); },

      // run one node; returns the executed node, or null when the graph is done
      step() {
        if (!ready()) throw new Error('GPU backend unavailable');
        const order = graph.topo();
        if (!order) throw new Error('graph has a cycle');
        const n = nextNode(order);
        if (!n) return null;
        try { runNode(n); }
        catch (err) { n.error = String(err && err.message || err); throw err; }
        return n;
      },

      // run the whole graph; onProgress(node, doneCount, total) per node
      run(onProgress) {
        graph.clearRun();
        return this.continue(onProgress);
      },

      // like run(), but does NOT clearRun() first — resumes from whatever
      // nodes are already _ran (typically after graph.invalidateFrom(node)
      // wiped just the downstream-of-an-edit subset).
      continue(onProgress) {
        if (!ready()) throw new Error('GPU backend unavailable');
        const order = graph.topo();
        if (!order) throw new Error('graph has a cycle');
        let done = 0;
        let n;
        while ((n = nextNode(order)) !== null) {
          try { runNode(n); }
          catch (err) { n.error = String(err && err.message || err); throw err; }
          done++;
          if (onProgress) onProgress(n, done, order.length);
        }
        return done;
      },
    };
  }

  export const Runner = { create: create };
