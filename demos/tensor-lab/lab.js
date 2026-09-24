// Tensor Lab — a freeform node-graph builder for modern neural networks,
// running every op live on the GPU through bro.tensor (brotensor). Wires
// the graph model, canvas editor, execution runner, inspector and palette
// (all under lab/) to the kit's page shell.

import { boot } from "/lib/kit/app.js";
import { ids } from "/lib/kit/dom.js";
import { backendBadge } from "/lib/kit/imagegen.js";
import { Graph } from "/app/lab/graph.js";
import { Runner } from "/app/lab/runner.js";
import { Inspector } from "/app/lab/inspector.js";
import { Editor } from "/app/lab/editor.js";
import { Palette } from "/app/lab/palette.js";
import { Presets } from "/app/lab/presets.js";
import { T5 } from "/app/lab/t5import.js";
import { Ops, fmtNum, fmtMs } from "/app/lab/ops.js";

const DEFAULT_PRESET = 'Transformer Encoder Block';
const STEP_DELAY_MS = 140;           // animated run: one op per tick so the pass is visible

const { status } = boot();
const el = ids('graph', 'palette', 'inspector', 'preset', 'btn-open-t5', 'btn-run', 'btn-step', 'btn-reset',
               'btn-clear', 'stat-nodes', 'stat-params', 'stat-flops', 'stat-time');
const gpu = !!(typeof bro !== 'undefined' && bro.tensor && bro.tensor.available);

const graph = Graph.create();
const runner = Runner.create(graph);
let running = false;

// An edit (wiring, params) invalidates the last run.
function graphChanged() {
    graph.propagate();
    graph.clearRun();
    editor.activeNode = null;
    updateStats();
    inspector.refresh();
}

const inspector = Inspector.create(el.inspector, { onParamChange: graphChanged });
const editor = Editor.create(el.graph, graph, {
    onSelect(sel) { inspector.show(sel); },
    onChange: graphChanged,
});
Palette.create(el.palette, (type) => {
    const node = graph.addNode(type);
    editor.placeNew(node);
    graph.propagate();
    updateStats();
    editor.select(node, null);
});

function updateStats() {
    const s = graph.stats();
    el.statNodes.textContent = s.nodes + (s.nodes === 1 ? ' node' : ' nodes');
    el.statParams.textContent = fmtNum(s.params) + ' params';
    el.statFlops.textContent = fmtNum(s.flops) + ' FLOPs';
    el.statTime.textContent = s.time > 0 ? 'forward ' + fmtMs(s.time) : 'not run';
}

// ---- running -------------------------------------------------------------------

function setRunning(on) {
    running = on;
    el.btnRun.textContent = on ? '■ Running…' : '▶ Run';
    el.btnStep.disabled = on || !gpu;
    el.btnReset.disabled = on;
    el.btnClear.disabled = on;
    el.btnOpenT5.disabled = on;
    el.preset.disabled = on;
}

/** Shape errors and an empty graph stop a run before it starts. */
function checkErrors() {
    graph.propagate();
    const bad = graph.nodes.find((n) => n.error);
    if (bad) {
        editor.select(bad, null);
        status.error(Ops.get(bad.type).label + ': ' + bad.error);
        return false;
    }
    if (!graph.nodes.length) { status.warn('Add some ops first.'); return false; }
    return true;
}

function canRun() {
    if (running) return false;
    if (!runner.ready()) { status.error('GPU backend unavailable.'); return false; }
    return checkErrors();
}

/** The whole forward pass, one op per tick. Resolves when it ends. */
function run() {
    if (!canRun()) return Promise.resolve(false);
    runner.reset();
    setRunning(true);
    status.busy('running…');
    return new Promise((resolve) => {
        const finish = (ok) => {
            setRunning(false);
            editor.activeNode = null;
            updateStats();
            inspector.refresh();
            resolve(ok);
        };
        const tick = () => {
            let node;
            try { node = runner.step(); } catch (err) { status.error(err.message); finish(false); return; }
            if (node === null) { status.ok('Forward pass complete.'); finish(true); return; }
            editor.activeNode = node;
            updateStats();
            setTimeout(tick, STEP_DELAY_MS);
        };
        tick();
    });
}

/** Execute the next op and jump the inspector to it; past the end, reset. */
function stepOnce() {
    if (!canRun()) return null;
    let node;
    try { node = runner.step(); } catch (err) { status.error(err.message); return null; }
    if (node === null) {
        runner.reset();
        editor.activeNode = null;
        status.set('Graph complete — reset. Step again to replay.');
        updateStats();
        inspector.refresh();
        return null;
    }
    editor.activeNode = node;
    editor.select(node, null);
    status.set('ran ' + Ops.get(node.type).label);
    updateStats();
    return node;
}

function resetRun() {
    if (running) return;
    runner.reset();
    editor.activeNode = null;
    updateStats();
    inspector.refresh();
    status.set('Run state cleared.');
}

function clearGraph() {
    if (running) return;
    graph.nodes.length = 0;
    graph.edges.length = 0;
    editor.select(null, null);
    graph.propagate();
    updateStats();
    status.set('Canvas cleared.');
}

// ---- presets + T5 --------------------------------------------------------------

function showNewGraph() {
    runner.reset();
    editor.activeNode = null;
    editor.select(null, null);
    editor.resize();
    editor.frameAll();
    updateStats();
}

function loadPreset(name) {
    if (!name || running) return;
    Presets.load(name, graph);
    el.preset.value = name;
    showNewGraph();
    const p = Presets.list().find((x) => x.name === name);
    if (p) status.set(p.desc);
}

function openT5() {
    if (running) return;
    if (!gpu) { status.error('GPU backend unavailable.'); return; }
    if (typeof showOpenFileDialog !== 'function') { status.error('file dialog unavailable'); return; }
    const paths = showOpenFileDialog('T5 checkpoint|safetensors');
    if (!paths || !paths.length) return;
    let cfg;
    try {
        cfg = T5.importEncoder(T5.open(paths[0]), graph, { layers: 2, seqLen: 16 });
    } catch (e) {
        status.error('T5 import failed: ' + ((e && e.message) || e));
        return;
    }
    showNewGraph();
    status.ok('T5 loaded — ' + cfg.builtLayers + ' of ' + cfg.layers + ' encoder layers · d_model ' +
              cfg.dModel + ' · ' + cfg.heads + ' heads');
}

// ---- wiring --------------------------------------------------------------------

el.btnRun.addEventListener('click', run);
el.btnStep.addEventListener('click', stepOnce);
el.btnReset.addEventListener('click', resetRun);
el.btnClear.addEventListener('click', clearGraph);
el.btnOpenT5.addEventListener('click', openT5);
for (const p of Presets.list()) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    el.preset.appendChild(opt);
}
el.preset.addEventListener('change', () => loadPreset(el.preset.value));

const badge = backendBadge('#backend');
if (gpu) {
    try { bro.tensor.init(); } catch (_) { /* surfaced on run */ }
    badge.set(String(bro.tensor.backend || 'gpu'));
} else {
    badge.set('no GPU backend', 'err');
    el.btnRun.disabled = true;
}
setRunning(false);

if (typeof ResizeObserver === 'function') new ResizeObserver(() => editor.resize()).observe(el.graph);
else window.addEventListener('resize', () => editor.resize());
const frame = (now) => { editor.draw(now || 0); requestAnimationFrame(frame); };
requestAnimationFrame(frame);

editor.resize();
loadPreset(DEFAULT_PRESET);
inspector.show(null);
if (!gpu) status.warn('bro.tensor has no GPU backend — shapes still propagate, but ops cannot run.');

/** Live state for tests and the console. */
export const tlab = {
    graph, editor, runner, inspector, status, el,
    run, stepOnce, resetRun, clearGraph, loadPreset,
    get running() { return running; },
};
