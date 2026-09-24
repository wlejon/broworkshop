// Node Forge: the page. A node-graph canvas (kit nodegraph) whose nodes are
// whole audio labs on a card (nodes/), with undoable structural edits,
// Run / Reset / Clear, and save / open through lib/project.js.
//
// mountForge() boots the kit shell and returns the handle main.js publishes
// as globalThis.nodeForge (tests drive the app through it).

import { History } from "/lib/kit/history.js";
import { Project } from "/lib/kit/project.js";
import { $ } from "/lib/kit/dom.js";
import { boot } from "/lib/kit/app.js";
import { documentCommands } from "/lib/kit/editor.js";
import { Graph, graphEdits, Runner } from "/lib/kit/nodegraph.js";
import { graphView, nodePalette } from "/lib/kit/nodegraph-view.js";
import { types } from "./nodes/index.js";

const PALETTE_HINT = 'Click to add. Drag a card by its header to move it, drag port → port to wire, ' +
    'click a card then Delete to remove it. ⚙ opens a card\'s full controls; ▾ collapses it.';

/** bro.tensor's probe doubles as "will these models run on the GPU". */
export function gpuReady() {
    return !!(typeof bro !== 'undefined' && bro.tensor && bro.tensor.available);
}

export function mountForge() {
    const graph = new Graph(types);
    const history = new History({ limit: 200 });
    const edits = graphEdits(graph, history);
    const runner = new Runner(graph, { ready: gpuReady });
    const project = new Project({
        app: 'node-forge', schema: 1, history,
        serialize: () => graph.serialize(),
        deserialize: (data) => {
            const res = graph.deserialize(data);
            if (res.skipped.length) status.warn(res.skipped.length + ' node(s) skipped — unknown type(s).');
        },
        onNew: () => graph.clear(),
    });
    const doc = documentCommands({
        history, project,
        undoButton: '#btn-undo', redoButton: '#btn-redo',
        after: (cmd, ok) => {
            if (!ok) return;
            if (cmd === 'save' || cmd === 'saveAs') status.ok('Saved ' + project.name + '.');
            updateStats();
        },
    });
    const { status } = boot({ menu: doc.menu });

    // A card recomputed its own output (a live edit): keep that result, forget
    // everything downstream, and rerun just that part shortly after.
    let continueTimer = 0;
    function onInvalidate(node, out, ms) {
        graph.invalidateFrom(node);
        if (out !== undefined) { node._out = out; node._ran = true; node._time = ms || 0; node.error = null; }
        updateStats();
        clearTimeout(continueTimer);
        continueTimer = setTimeout(() => {
            if (!runner.ready()) return;
            try { runner.continue(); } catch (e) { /* reported on the failing node's card */ }
            updateStats();
        }, 40);
    }

    const view = graphView('#stage', graph, {
        edits,
        onChange: () => { project.markDirty(); updateStats(); },
        onInvalidate,
    });
    nodePalette('#palette', types, { onAdd: (type) => view.addAtCentre(type), hint: PALETTE_HINT });

    // --- status ------------------------------------------------------------------------
    const statNodes = $('#stat-nodes'), statTime = $('#stat-time'), fileStatus = $('#file-status');
    function updateStats() {
        const n = graph.nodes.length;
        statNodes.textContent = n + (n === 1 ? ' node' : ' nodes');
        const t = graph.nodes.reduce((s, x) => s + (x._time || 0), 0);
        statTime.textContent = graph.nodes.some((x) => x._ran) ? 'last run ' + t.toFixed(1) + ' ms' : 'not run';
    }
    const updateFile = () => { fileStatus.textContent = project.name + (project.isDirty() ? ' *' : ''); };
    project.on('change', updateFile);
    graph.on('change', updateStats);
    for (const ev of ['new', 'loaded']) {
        project.on(ev, () => { runner.reset(); view.frameAll(); updateStats(); });
    }

    // --- run controls ------------------------------------------------------------------
    const forge = {
        graph, types, history, edits, runner, project, view, status, commands: doc,
        run() {
            if (!runner.ready()) { status.warn('No GPU backend.'); return 0; }
            if (!graph.nodes.length) { status.warn('Add a node first.'); return 0; }
            let n = 0;
            try { n = runner.run(); status.ok('Ran ' + n + ' node(s).'); }
            catch (e) { status.error(e); }
            updateStats();
            return n;
        },
        reset() { runner.reset(); updateStats(); status.set('Run state cleared.'); },
        clear() {
            if (!graph.nodes.length) return;
            edits.clear();
            project.markDirty();
            updateStats();
            status.set('Canvas cleared (Ctrl+Z brings it back).');
        },
    };
    $('#btn-run').addEventListener('click', forge.run);
    $('#btn-reset').addEventListener('click', forge.reset);
    $('#btn-clear').addEventListener('click', forge.clear);
    $('#btn-fit').addEventListener('click', () => view.frameAll());
    for (const [id, cmd] of [['#btn-new', 'new'], ['#btn-open', 'open'], ['#btn-save', 'save'], ['#btn-save-as', 'saveAs']]) {
        $(id).addEventListener('click', () => doc[cmd]());
    }

    // --- backend badge -------------------------------------------------------------------
    const badge = $('#backend');
    if (gpuReady()) {
        try { bro.tensor.init(); } catch (e) { /* reported when a model loads */ }
        badge.textContent = 'GPU · ' + String(bro.tensor.backend || 'gpu').toUpperCase();
        badge.classList.add('ok');
        status.set('Add a node from the palette. Each card is a whole lab; ⚙ opens its full controls.');
    } else {
        badge.textContent = 'NO GPU BACKEND';
        badge.classList.add('warn');
        $('#btn-run').disabled = true;
        status.warn('No GPU backend: nodes report an error when they load a model.');
    }

    updateFile();
    updateStats();
    return forge;
}
