// Tensor Lab — execution engine.
//
// Walks the graph in topological order and runs each op's real bro.tensor
// GPU call. Every op is timed with a sync()-bracketed clock so the per-node
// numbers reflect actual kernel cost. Supports a full run() or single
// step() for watching the forward pass unfold one op at a time.
(function () {
  'use strict';
  const Lab = (window.Lab = window.Lab || {});

  const clock = (typeof performance !== 'undefined' && performance.now)
    ? () => performance.now() : () => Date.now();

  function create(graph) {
    const T = bro.tensor;

    function ready() { return !!(T && T.available); }

    // execute a single node: gather inputs, time the kernel, store outputs
    function runNode(n) {
      const def = Lab.Ops.get(n.type);
      const ins = [];
      for (let p = 0; p < def.ins.length; p++) {
        const e = graph.edgeInto(n, p);
        if (!e || !e.from.node._out) throw new Error('input ' + (p + 1) + ' has no value');
        ins.push(e.from.node._out[e.from.port]);
      }
      T.sync();
      const t0 = clock();
      const out = def.exec(T, ins, n.params, n);
      T.sync();
      n._time = clock() - t0;
      n._out = out;
      n._ran = true;
      n.error = null;
    }

    // the next node ready to run (all dependencies already executed)
    function nextNode(order) {
      for (const n of order) {
        if (n._ran) continue;
        const def = Lab.Ops.get(n.type);
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

      // run one op; returns the executed node, or null when the graph is done
      step() {
        if (!ready()) throw new Error('bro.tensor GPU backend unavailable');
        graph.propagate();
        const order = graph.topo();
        if (!order) throw new Error('graph has a cycle');
        const n = nextNode(order);
        if (!n) return null;
        if (n.error) throw new Error(n.type + ': ' + n.error);
        try { runNode(n); }
        catch (err) { n.error = String(err && err.message || err); throw err; }
        return n;
      },

      // run the whole graph; onProgress(node, doneCount, total) per node
      run(onProgress) {
        if (!ready()) throw new Error('bro.tensor GPU backend unavailable');
        graph.propagate();
        const order = graph.topo();
        if (!order) throw new Error('graph has a cycle');
        for (const n of order) {
          if (n.error) throw new Error(Lab.Ops.get(n.type).label + ': ' + n.error);
        }
        graph.clearRun();
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

  Lab.Runner = { create: create };
})();
