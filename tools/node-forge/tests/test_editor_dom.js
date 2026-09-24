// The graph canvas without models: cards, collapse, the full-controls dialog,
// header drags, wiring through the real port dots (and refusing a type
// mismatch), re-routing, delete, undo / redo of all of it, save/load round
// trips and the runner. Uses test-only node types, so no weights are needed.

import { check, eq, test, done, frames, q, shot, press } from "/lib/kit/test.js";
import { types } from "/app/nodes/types.js";

types.define({
    type: 'test-src', label: 'Test Source', cat: 'Test', color: '#34d399',
    outs: [{ name: 'out', type: 'audio-buffer' }],
    exec() { return [{ samples: new Float32Array([1, 2, 3]), sampleRate: 100, channels: 1 }]; },
    mount(body) { body.textContent = 'test source'; },
});
types.define({
    type: 'test-sink', label: 'Test Sink', cat: 'Test', color: '#f472b6',
    ins: [{ name: 'in', type: 'audio-buffer' }],
    exec(ins) { return [ins[0].samples.length]; },
    mount(body) { body.textContent = 'test sink'; },
});
types.define({
    type: 'test-wrong', label: 'Test Wrong Type', cat: 'Test', color: '#f97316',
    ins: [{ name: 'in', type: 'not-audio' }],
    exec() { return []; },
    mount(body) { body.textContent = 'wrong-type sink'; },
});
let unmounted = 0;
types.define({
    type: 'test-dialog', label: 'Test Dialog', cat: 'Test', color: '#a78bfa',
    exec() { return []; },
    mount(body, node, graph, api) {
        body.textContent = 'mini card';
        api.dialogBody.appendChild(Object.assign(document.createElement('div'), { className: 'test-advanced', textContent: 'full controls' }));
        api.onUnmount(() => { unmounted++; });
    },
});

frames(5);
const F = globalThis.nodeForge;
check(F, 'main.js publishes nodeForge');
const { graph, history, view } = F;

const card = (node) => view.card(node).root;
const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const mouse = (target, type, p) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: p ? p.x : 0, clientY: p ? p.y : 0 }));
function drag(fromEl, to) {
    mouse(fromEl, 'mousedown', center(fromEl));
    mouse(window, 'mousemove', to);
    mouse(window, 'mouseup', to);
    frames(1);
}
const outDot = (n) => card(n).querySelector('.ng-port[data-dir=out]');
const inDot = (n) => card(n).querySelector('.ng-port[data-dir=in]');

const src = F.edits.add('test-src', 100, 100);
const sink = F.edits.add('test-sink', 700, 100);
const wrong = F.edits.add('test-wrong', 700, 300);
frames(2);

test('palette lists every audio node type', () => {
    for (const t of ['rave', 'kokoro', 'qwen']) check(q('#palette').querySelector('.ng-pal-op[data-type="' + t + '"]'), 'palette button ' + t);
});

test('cards follow the graph', () => {
    eq(document.querySelectorAll('.ng-card').length, 3, 'three cards');
    eq(q('#stat-nodes').textContent, '3 nodes', 'status count');
    eq(card(src).querySelector('.ng-title').textContent, 'Test Source', 'title');
});

test('collapse / expand, undoable', () => {
    const btn = card(src).querySelector('.ng-collapse'), body = card(src).querySelector('.ng-body');
    btn.click();
    check(src.collapsed && body.style.display === 'none', 'collapsed');
    history.undo();
    check(!src.collapsed && body.style.display !== 'none', 'undo expands');
    history.redo();
    check(src.collapsed, 'redo collapses');
    btn.click();
    check(!src.collapsed, 'expanded again');
});

test('full-controls dialog', () => {
    check(card(src).querySelector('.ng-gear').style.display === 'none', 'no gear without dialog content');
    const dn = F.edits.add('test-dialog', 100, 420);
    frames(1);
    const gear = card(dn).querySelector('.ng-gear');
    check(gear.style.display !== 'none', 'gear shown');
    gear.click();
    const backdrop = q('.ng-dialog-backdrop');
    eq(backdrop.style.display, 'flex', 'dialog open');
    check(q('.ng-dialog-title').textContent.includes('Test Dialog'), 'dialog title');
    check(q('.ng-dialog-body .test-advanced'), 'dialog hosts the card content');
    check(!card(dn).querySelector('.test-advanced'), 'not on the card');
    mouse(backdrop, 'mousedown', { x: 2, y: 2 });
    eq(backdrop.style.display, 'none', 'backdrop click closes');
    gear.click();
    eq(backdrop.style.display, 'flex', 'reopens');
    press('Escape');
    eq(backdrop.style.display, 'none', 'Escape closes');
    card(dn).querySelector('.ng-del').click();
    eq(unmounted, 1, 'onUnmount ran');
    check(graph.nodes.indexOf(dn) < 0, 'deleted');
});

test('header drag moves a card; undo puts it back', () => {
    const header = card(src).querySelector('.ng-header');
    const p = center(header);
    drag(header, { x: p.x + 120, y: p.y + 40 });
    check(Math.abs(src.x - 220) < 1 && Math.abs(src.y - 140) < 1, 'moved to ' + src.x + ',' + src.y);
    history.undo();
    eq([src.x, src.y], [100, 100], 'undo move');
    check(card(src).style.left === '100px', 'card follows undo');
    history.redo();
    check(Math.abs(src.x - 220) < 1, 'redo move');
});

test('wire through the port dots; a type mismatch is refused', () => {
    drag(outDot(src), center(inDot(sink)));
    eq(graph.edges.length, 1, 'one edge');
    check(graph.edges[0].from.node === src && graph.edges[0].to.node === sink, 'endpoints');
    check(!graph.canConnect(src, 0, wrong, 0), 'canConnect refuses');
    drag(outDot(src), center(inDot(wrong)));
    eq(graph.edges.length, 1, 'mismatch refused');
    history.undo();
    eq(graph.edges.length, 0, 'undo connect');
    history.redo();
    eq(graph.edges.length, 1, 'redo connect');
});

test('dragging an input dot off drops the wire (undoable)', () => {
    drag(inDot(sink), { x: 5, y: 5 });
    eq(graph.edges.length, 0, 'wire dropped');
    history.undo();
    eq(graph.edges.length, 1, 'undo restores it');
});

test('delete restores node, card and wires on undo', () => {
    card(sink).querySelector('.ng-del').click();
    check(graph.nodes.indexOf(sink) < 0 && graph.edges.length === 0, 'node and wire gone');
    eq(document.querySelectorAll('.ng-card').length, 2, 'card gone');
    history.undo();
    check(graph.nodes.indexOf(sink) >= 0 && graph.edges.length === 1, 'node and wire back');
    eq(document.querySelectorAll('.ng-card').length, 3, 'card back');
});

test('Delete key removes the focused card', () => {
    mouse(card(wrong).querySelector('.ng-body'), 'mousedown', center(card(wrong)));
    check(view.focused === wrong && card(wrong).classList.contains('focused'), 'focused');
    press('Delete');
    check(graph.nodes.indexOf(wrong) < 0, 'removed');
    history.undo();
    check(graph.nodes.indexOf(wrong) >= 0, 'undo');
});

test('run: the wired pair runs, a node with an open input waits', () => {
    const n = F.run();
    eq(n, 2, 'nodes run');
    check(src._out[0].samples.length === 3 && sink._out[0] === 3, 'values flowed');
    check(!wrong._ran, 'open input never runs');
    check(/^last run/.test(q('#stat-time').textContent), 'time shown');
    F.reset();
    check(!src._ran, 'reset');
});

test('serialize / deserialize round trip', () => {
    const saved = JSON.parse(JSON.stringify(graph.serialize()));
    eq([saved.nodes.length, saved.edges.length], [3, 1], 'saved');
    graph.deserialize(saved);
    frames(1);
    eq([graph.nodes.length, graph.edges.length], [3, 1], 'restored');
    eq(document.querySelectorAll('.ng-card').length, 3, 'cards rebuilt');
    eq(graph.nodes.map((n) => n.id), saved.nodes.map((n) => n.id), 'ids kept');
    const res = graph.deserialize({ nodes: saved.nodes.concat([{ id: 'zz', type: 'gone', x: 0, y: 0, params: {} }]), edges: saved.edges });
    eq(res.skipped, ['zz'], 'unknown type skipped');
});

test('params must be plain arrays to survive a save', () => {
    const t = graph.nodes[0];
    t.params.curve = [0.1, 0.2, -0.4];
    t.params.bad = new Float32Array([1, 2]);
    const back = JSON.parse(JSON.stringify(graph.serialize())).nodes[0].params;
    eq(back.curve, [0.1, 0.2, -0.4], 'plain array');
    check(!Array.isArray(back.bad), 'a typed array does not come back as an array');
    delete t.params.curve; delete t.params.bad;
});

test('drags suppress text selection', () => {
    const [a] = graph.nodes;
    const header = card(a).querySelector('.ng-header');
    mouse(header, 'mousedown', center(header));
    check(document.body.classList.contains('ng-dragging'), 'during card drag');
    mouse(window, 'mouseup', center(header));
    check(!document.body.classList.contains('ng-dragging'), 'after');
    mouse(q('#stage'), 'mousedown', { x: 400, y: 700 });
    check(document.body.classList.contains('ng-dragging'), 'during pan');
    mouse(window, 'mouseup', { x: 400, y: 700 });
    check(!document.body.classList.contains('ng-dragging'), 'after pan');
});

test('clear, and undo it', () => {
    F.view.frameAll();
    frames(2);
    shot('graph');
    F.clear();
    eq([graph.nodes.length, document.querySelectorAll('.ng-card').length], [0, 0], 'cleared');
    history.undo();
    eq([graph.nodes.length, graph.edges.length], [3, 1], 'undo clear');
    eq(document.querySelectorAll('.ng-card').length, 3, 'cards back');
});

done('node-forge editor');
