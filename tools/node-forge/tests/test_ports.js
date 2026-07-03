// Headless test — typed-port wire-time compatibility.
//
// Asserts Graph.addEdge and the editor's own compatibility check
// (Graph.canConnect, which editor.js's wire-drag hover uses) agree on
// accept/reject, for every case exercised. Also asserts the existing
// cycle-guard and self-loop rejection still work with the new port-type
// check layered in front of them.
import { Graph } from "/app/lab/graph.js";

flush();
advanceTime(100);
flush();

const G = Graph.create();

function reset() { G.nodes.length = 0; G.edges.length = 0; }

// --- tensor -> tensor: compatible -------------------------------------------
reset();
{
  const a = G.addNode('input', 0, 0), b = G.addNode('linear', 200, 0);
  const okAddEdge = G.addEdge(a, 0, b, 0) !== null;
  const okCanConnect = G.canConnect(a, 0, b, 0);
  assert(okAddEdge === true, 'tensor->tensor: addEdge should accept');
  assert(okCanConnect === true, 'tensor->tensor: canConnect should agree (true)');
}

// --- self-loop: rejected regardless of port types ---------------------------
reset();
{
  const a = G.addNode('input', 0, 0);
  assert(G.addEdge(a, 0, a, 0) === null, 'self-loop must be rejected by addEdge');
  assert(G.canConnect(a, 0, a, 0) === false, 'self-loop must be rejected by canConnect');
}

// --- cycle guard still fires alongside the new port-type check -------------
reset();
{
  const a = G.addNode('input', 0, 0), b = G.addNode('relu', 200, 0), c = G.addNode('relu', 400, 0);
  assert(G.addEdge(a, 0, b, 0) !== null, 'a->b should connect');
  assert(G.addEdge(b, 0, c, 0) !== null, 'b->c should connect');
  assert(G.addEdge(c, 0, a, 0) === null, 'c->a would create a cycle — must be rejected');
}

// --- addEdge and canConnect must never disagree, across every op pair ------
// (a regression guard for "compat table checked in addEdge but the editor
// bypasses it somehow" — canConnect is the exact function the editor's
// wire-drag hover uses to color the target port before the drop happens)
reset();
{
  let checked = 0;
  const TYPES = ['input', 'image', 'linear', 'matmul', 'relu', 'add', 'concat'];
  for (const ta of TYPES) {
    for (const tb of TYPES) {
      reset();
      const a = G.addNode(ta, 0, 0), b = G.addNode(tb, 200, 0);
      if (!a || !b) continue;
      const defA = a, defB = b; // ops.js Ops.get is internal to graph.js; use addEdge's own verdict
      const viaAddEdge = G.addEdge(a, 0, b, 0) !== null;
      // re-add cleanly for canConnect (addEdge above may have mutated edges)
      reset();
      const a2 = G.addNode(ta, 0, 0), b2 = G.addNode(tb, 200, 0);
      const viaCanConnect = G.canConnect(a2, 0, b2, 0);
      assert(viaAddEdge === viaCanConnect,
        'addEdge/canConnect disagree for ' + ta + '->' + tb +
        ' (addEdge=' + viaAddEdge + ' canConnect=' + viaCanConnect + ')');
      checked++;
    }
  }
  console.log('TEST: checked', checked, 'op-type pairs, addEdge/canConnect agree on all');
}

flush();
console.log('TEST_PORTS DONE');
