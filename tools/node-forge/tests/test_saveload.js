// Headless test — Graph.serialize()/deserialize() round trip.
import { Graph } from "/app/lab/graph.js";

flush();
advanceTime(50);
flush();

const G = Graph.create();

// --- basic round trip, non-default params, edges preserved ------------------
{
  G.nodes.length = 0; G.edges.length = 0;
  const a = G.addNode('input', 10, 20), b = G.addNode('linear', 300, 20);
  a.params.rows = 64; a.params.cols = 99; a.params.fill = 'ramp';
  b.params.out = 77; b.params.bias = false;
  G.addEdge(a, 0, b, 0);

  const snap = G.serialize();
  const res = G.deserialize(snap);
  assert(res.skipped.length === 0, 'clean round trip skips nothing');
  assert(G.nodes.length === 2, 'node count restored');
  const a2 = G.nodes.find((n) => n.type === 'input');
  const b2 = G.nodes.find((n) => n.type === 'linear');
  assert(a2.params.rows === 64 && a2.params.cols === 99 && a2.params.fill === 'ramp',
    'input node params restored: ' + JSON.stringify(a2.params));
  assert(b2.params.out === 77 && b2.params.bias === false,
    'linear node params restored: ' + JSON.stringify(b2.params));
  assert(G.edges.length === 1, 'edge count restored');
  assert(G.edges[0].from.node === a2 && G.edges[0].to.node === b2,
    'edge endpoints correctly id-remapped to the NEW node objects');

  // re-serializing the reloaded graph must match the original snapshot
  // (ids differ by construction — addNode mints fresh ids — so compare
  // structurally: same shape/edge topology, same params, ignoring ids).
  const snap2 = G.deserialize(snap) && G.serialize();
  assert(JSON.stringify(snap2.nodes.map((n) => [n.type, n.params])) ===
         JSON.stringify(snap.nodes.map((n) => [n.type, n.params])),
    'node type+params sequence stable across repeated round trips');
}

// --- unknown/removed op type: skipped, not thrown, graph left usable -------
{
  G.nodes.length = 0; G.edges.length = 0;
  const bad = {
    nodes: [
      { id: 'n1', type: 'totally-not-a-real-op', x: 0, y: 0, params: {} },
      { id: 'n2', type: 'input', x: 0, y: 0, params: { rows: 8, cols: 8, fill: 'zeros' } },
    ],
    edges: [{ from: 'n1', fromPort: 0, to: 'n2', toPort: 0 }],
  };
  const res = G.deserialize(bad);
  assert(res.skipped.length === 1 && res.skipped[0] === 'n1',
    'unknown op type is skipped and reported, not thrown');
  assert(G.nodes.length === 1 && G.nodes[0].type === 'input',
    'the valid sibling node still loads');
  assert(G.edges.length === 0,
    'the edge touching the skipped node is dropped, not left dangling');
}

// --- widget-owned params must survive a real JSON round trip ---------------
// (the footgun the plan calls out: a raw Float32Array in node.params would
// serialize via JSON.stringify as a numeric-keyed plain object and silently
// corrupt on reload — plain number[]/number[][] must not.)
{
  G.nodes.length = 0; G.edges.length = 0;
  const n = G.addNode('input', 0, 0);
  n.params.__curve = [0.1, 0.2, 0.3, -0.4];       // simulate a widget-owned plain array
  n.params.__curves2d = [[0, 1], [2, 3]];          // simulate a multi-curve config

  const snap = G.serialize();
  const wire = JSON.parse(JSON.stringify(snap));   // exactly what Project.saveTo/openPath do
  G.nodes.length = 0; G.edges.length = 0;
  G.deserialize(wire);
  const n2 = G.nodes[0];
  assert(Array.isArray(n2.params.__curve), 'curve param comes back as a real array, not a {0:.., 1:..} object');
  assert(n2.params.__curve.length === 4 && n2.params.__curve[3] === -0.4,
    'curve array values survive the JSON round trip: ' + JSON.stringify(n2.params.__curve));
  assert(Array.isArray(n2.params.__curves2d) && Array.isArray(n2.params.__curves2d[0]),
    'nested array (multi-curve) params also survive');

  // demonstrate the actual footgun so this test documents WHY the plain-
  // array rule exists: a Float32Array param does NOT survive JSON.stringify.
  const n3 = G.addNode('input', 0, 0);
  n3.params.__badCurve = new Float32Array([0.1, 0.2, 0.3]);
  const snap3 = G.serialize();
  const wire3 = JSON.parse(JSON.stringify(snap3));
  const restored = wire3.nodes.find((x) => x.id === n3.id);
  assert(!Array.isArray(restored.params.__badCurve),
    'documenting the footgun: a Float32Array param round-trips as a plain {0:..,1:..} object, ' +
    'NOT an array — this is why widget code must store plain number[] in node.params');
}

flush();
console.log('TEST_SAVELOAD DONE');
