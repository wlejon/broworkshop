// Node Forge — generic DOM-card editor mechanics: card build/collapse/drag/
// delete, wire connect + reject through the real port-dot DOM elements, and
// a graph serialize()/deserialize() round trip. Uses two tiny test-only node
// types (registered here, not in nodes/) so this suite never depends on a
// real model/asset being present — it's exercising lab/editor.js and
// lab/graph.js, not any particular audio lab.
import { def } from "/app/lab/node-registry.js";

def({
  type: 'test-src', label: 'Test Source', cat: 'Test', color: '#34d399',
  ins: [], outs: [{ name: 'out', type: 'audio-buffer' }],
  exec() { return [{ samples: new Float32Array([1, 2, 3]), sampleRate: 100, channels: 1 }]; },
  mount(body) { body.textContent = 'test source'; },
});
def({
  type: 'test-sink', label: 'Test Sink', cat: 'Test', color: '#f472b6',
  ins: [{ name: 'in', type: 'audio-buffer' }], outs: [],
  exec(ins) { return []; },
  mount(body) { body.textContent = 'test sink'; },
});
def({
  type: 'test-wrong', label: 'Test Wrong Type', cat: 'Test', color: '#f97316',
  ins: [{ name: 'in', type: 'not-audio' }], outs: [],
  exec() { return []; },
  mount(body) { body.textContent = 'test wrong-type sink'; },
});

advanceTime(50);
flush();
const app = window.LabApp;
assert(app, 'LabApp handle missing');

const src = app.graph.addNode('test-src');
const sink = app.graph.addNode('test-sink');
const wrong = app.graph.addNode('test-wrong');
src.x = 100; src.y = 100;
sink.x = 500; sink.y = 100;
wrong.x = 500; wrong.y = 260;
app.editor.draw(0);
advanceTime(16);
flush();

const cards = document.querySelectorAll('.node-card');
assert(cards.length === 3, 'expected 3 cards, got ' + cards.length);

// ── collapse / expand ──────────────────────────────────────────────────────
const srcCard = [...cards].find((c) => c.querySelector('.node-title').textContent === 'Test Source');
const collapseBtn = srcCard.querySelector('.node-collapse');
const body = srcCard.querySelector('.node-body');
assert(body.style.display !== 'none', 'body should start expanded');
collapseBtn.click();
assert(src.collapsed === true, 'collapse did not set node.collapsed');
assert(body.style.display === 'none', 'body should be hidden once collapsed');
collapseBtn.click();
assert(src.collapsed === false, 'expand did not clear node.collapsed');
assert(body.style.display !== 'none', 'body should be visible once expanded');
console.log('OK: collapse/expand toggles node.collapsed + body visibility');

// ── header drag repositions the node in world space ────────────────────────
const header = srcCard.querySelector('.node-header');
const x0 = src.x, y0 = src.y;
const hr = header.getBoundingClientRect();
header.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: hr.left + 10, clientY: hr.top + 8 }));
window.dispatchEvent(new MouseEvent('mousemove', { clientX: hr.left + 10 + 120, clientY: hr.top + 8 + 40 }));
window.dispatchEvent(new MouseEvent('mouseup', {}));
app.editor.draw(0);
assert(src.x !== x0 || src.y !== y0, 'header drag did not move the node');
console.log('OK: header drag moves the node (' + x0.toFixed(0) + ',' + y0.toFixed(0) + ') -> (' + src.x.toFixed(0) + ',' + src.y.toFixed(0) + ')');

// ── wire connect: drag from src's out dot to sink's in dot ─────────────────
function findCardByTitle(title) { return [...document.querySelectorAll('.node-card')].find((c) => c.querySelector('.node-title').textContent === title); }
const outDot = findCardByTitle('Test Source').querySelector('.port-dot[data-dir=out]');
const sinkInDot = findCardByTitle('Test Sink').querySelector('.port-dot[data-dir=in]');
assert(outDot && sinkInDot, 'expected port dots on both cards');
const outR = outDot.getBoundingClientRect(), inR = sinkInDot.getBoundingClientRect();
outDot.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: outR.left + 5, clientY: outR.top + 5 }));
window.dispatchEvent(new MouseEvent('mousemove', { clientX: inR.left + 5, clientY: inR.top + 5 }));
window.dispatchEvent(new MouseEvent('mouseup', { clientX: inR.left + 5, clientY: inR.top + 5 }));
assert(app.graph.edges.length === 1, 'expected 1 edge after a valid wire drag, got ' + app.graph.edges.length);
assert(app.graph.edges[0].from.node === src && app.graph.edges[0].to.node === sink, 'edge endpoints wrong');
console.log('OK: dragging out-dot -> in-dot creates an edge through the real DOM');

// ── wire reject: incompatible port type refuses the connection ─────────────
assert(!app.graph.canConnect(src, 0, wrong, 0), 'canConnect should refuse audio-buffer -> not-audio');
const beforeEdgeCount = app.graph.edges.length;
const wrongInDot = findCardByTitle('Test Wrong Type').querySelector('.port-dot[data-dir=in]');
const wrongR = wrongInDot.getBoundingClientRect();
outDot.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: outR.left + 5, clientY: outR.top + 5 }));
window.dispatchEvent(new MouseEvent('mousemove', { clientX: wrongR.left + 5, clientY: wrongR.top + 5 }));
window.dispatchEvent(new MouseEvent('mouseup', { clientX: wrongR.left + 5, clientY: wrongR.top + 5 }));
assert(app.graph.edges.length === beforeEdgeCount, 'a type-incompatible drag should not add an edge');
console.log('OK: a type-incompatible wire drag is rejected (edge count unchanged)');

// ── serialize()/deserialize() round trip preserves nodes + the edge ────────
const saved = app.graph.serialize();
assert(saved.nodes.length === 3 && saved.edges.length === 1, 'serialize() should capture 3 nodes + 1 edge');
app.graph.nodes.length = 0; app.graph.edges.length = 0;
const res = app.graph.deserialize(saved);
assert(res.skipped.length === 0, 'deserialize() unexpectedly skipped known node types');
assert(app.graph.nodes.length === 3, 'deserialize() should restore 3 nodes');
assert(app.graph.edges.length === 1, 'deserialize() should restore 1 edge');
console.log('OK: serialize()/deserialize() round trip preserves nodes + edges');

// ── Run: exec() sync path across a wired pair. test-wrong's required input
// port was never wired (its only wiring attempt was correctly rejected
// above), so it can never become topologically "ready" — run() should
// execute exactly the connected src->sink pair and leave it un-run, not
// throw. ─────────────────────────────────────────────────────────────────
const n = app.runner.run();
assert(n === 2, 'expected 2 nodes to run (the wired pair), got ' + n);
const srcNode = app.graph.nodes.find((x) => x.type === 'test-src');
const wrongNode = app.graph.nodes.find((x) => x.type === 'test-wrong');
assert(srcNode._ran && srcNode._out && srcNode._out[0].samples.length === 3, 'test-src did not produce its exec() output');
assert(!wrongNode._ran, 'test-wrong has an unconnected required input — it should never become ready to run');
console.log('OK: runner.run() executes the wired pair and correctly stalls a node with an unconnected required input');

// ── widget-owned params must survive a real JSON round trip (the footgun a
// node's own mount() must avoid: a raw typed array in node.params serializes
// via JSON.stringify as a numeric-keyed plain object and silently corrupts
// on reload — every widget in nodes/ stores plain number[]/number[][], e.g.
// rave-node.js's params.curves, kokoro-node.js's params.coords/emo/timbre,
// qwen-node.js's params.coords/emoAlpha/steer). ─────────────────────────────
{
  const t = app.graph.addNode('test-src');
  t.params.__curve = [0.1, 0.2, 0.3, -0.4];
  const snap = app.graph.serialize();
  const wire = JSON.parse(JSON.stringify(snap));   // exactly what Project.saveTo/openPath do
  const restored = wire.nodes.find((x) => x.id === t.id);
  assert(Array.isArray(restored.params.__curve) && restored.params.__curve.length === 4 && restored.params.__curve[3] === -0.4,
    'plain-array param must survive a JSON round trip: ' + JSON.stringify(restored.params.__curve));

  t.params.__badCurve = new Float32Array([0.1, 0.2, 0.3]);
  const snap2 = app.graph.serialize();
  const wire2 = JSON.parse(JSON.stringify(snap2));
  const restored2 = wire2.nodes.find((x) => x.id === t.id);
  assert(!Array.isArray(restored2.params.__badCurve),
    'documenting the footgun: a typed-array param round-trips as a plain {0:..,1:..} object, ' +
    'NOT an array — this is why widget code must store plain number[] in node.params');
  console.log('OK: plain-array params survive JSON round trip; typed-array params demonstrably do not (by design constraint)');
}

// ── dragging (pan/card/wire) suppresses text selection page-wide ───────────
// Fresh DOM lookups throughout: deserialize() above rebuilt every card from
// scratch, so the src/sink/header/outDot bindings from earlier in this file
// point at detached elements no longer tracked by editor.js's card map.
{
  assert(!document.body.classList.contains('nf-dragging'), 'should not be dragging yet');
  const liveHeader = findCardByTitle('Test Source').querySelector('.node-header');
  const hr2 = liveHeader.getBoundingClientRect();
  liveHeader.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: hr2.left + 10, clientY: hr2.top + 8 }));
  assert(document.body.classList.contains('nf-dragging'), 'nf-dragging should be set during a card drag');
  window.dispatchEvent(new MouseEvent('mouseup', {}));
  assert(!document.body.classList.contains('nf-dragging'), 'nf-dragging should clear on mouseup');

  const stage = document.getElementById('stage');
  stage.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 20, clientY: 20 }));
  assert(document.body.classList.contains('nf-dragging'), 'nf-dragging should be set during a stage pan');
  window.dispatchEvent(new MouseEvent('mouseup', {}));
  assert(!document.body.classList.contains('nf-dragging'), 'nf-dragging should clear after a pan');

  const liveOutDot = findCardByTitle('Test Source').querySelector('.port-dot[data-dir=out]');
  const outR2 = liveOutDot.getBoundingClientRect();
  liveOutDot.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: outR2.left + 5, clientY: outR2.top + 5 }));
  assert(document.body.classList.contains('nf-dragging'), 'nf-dragging should be set during a wire drag');
  window.dispatchEvent(new MouseEvent('mouseup', {}));
  assert(!document.body.classList.contains('nf-dragging'), 'nf-dragging should clear after a wire drag');
  console.log('OK: pan/card/wire drags all toggle body.nf-dragging (suppresses text selection)');
}

// ── delete removes both the node and its card ───────────────────────────────
app.editor.draw(0);
const delTargets = [...document.querySelectorAll('.node-card')];
for (const c of delTargets) c.querySelector('.node-del').click();
assert(app.graph.nodes.length === 0, 'all nodes should be removed');
assert(document.querySelectorAll('.node-card').length === 0, 'all cards should be removed from the DOM');
console.log('OK: delete removes node + card for every node');

console.log('ALL EDITOR DOM CHECKS PASSED');
