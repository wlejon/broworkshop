// Node Forge — application bootstrap.
//
// A node-graph canvas where each node is a comprehensive, hand-built DOM UI
// (see lab/node-registry.js) rather than a generic op with an auto-form —
// one card per audio lab (nodes/rave-node.js, nodes/kokoro-node.js,
// nodes/qwen-node.js), not a decomposed pipeline of atomic ops. There is no
// sidebar Inspector: a node's controls live on the card itself, always
// visible, collapsible per-section via native <details>.
import { Graph } from "/app/lab/graph.js";
import { Runner } from "/app/lab/runner.js";
import { Editor } from "/app/lab/editor.js";
import { Palette } from "/app/lab/palette.js";
import { Presets } from "/app/lab/presets.js";
import { Nodes } from "/app/lab/node-registry.js";
import "/app/nodes/rave-node.js";               // registers the RAVE node type
import "/app/nodes/kokoro-node.js";              // registers the Kokoro node type
import "/app/nodes/qwen-node.js";                // registers the Qwen-TTS node type
import "/lib/project.js";                       // attaches global Project
import { installSystemMenu } from "/lib/system-menu.js";

  function $(id) { return document.getElementById(id); }

  function start() {
    const stage = $('stage');
    if (!stage) { requestAnimationFrame(start); return; }
    init(stage);
  }

  function init(stage) {
    const graph = Graph.create();
    const runner = Runner.create(graph);

    // debounced incremental re-run driven by a node's own live-preview loop
    // (its async synth/decode onDone) — see lab/node-registry.js's mount()
    // contract. Only the invalidated node's downstream subgraph re-executes;
    // the node itself already updated its own _out directly, so this mainly
    // exists to keep any WIRED downstream node (future: a mixer, scene
    // audio) in sync, plus the dirty flag / status bar.
    let invalidateTimer = 0;
    function scheduleContinue(node, out, time) {
      graph.invalidateFrom(node);
      // the live path already computed this node's fresh result — restore
      // it right away so only genuinely-stale downstream nodes are left for
      // the debounced continue() below, and node._out is never left null.
      if (out !== undefined) { node._out = out; node._ran = true; node._time = time || 0; }
      updateStatus();
      proj.markDirty();
      clearTimeout(invalidateTimer);
      invalidateTimer = setTimeout(() => {
        if (!runner.ready()) return;
        try { runner.continue(); } catch (err) { /* surfaced via node.error */ }
        updateStatus();
      }, 40);
    }

    const editor = Editor.create(stage, graph, {
      onChange() {
        updateStatus();
        proj.markDirty();
      },
      onInvalidate(node, out, time) { scheduleContinue(node, out, time); },
    });

    Palette.create($('palette'), (type) => {
      const node = graph.addNode(type);
      editor.placeNew(node);
      editor.draw(0);
      updateStatus();
      proj.markDirty();
    });

    // --- status bar -----------------------------------------------------
    function updateStatus() {
      $('stat-nodes').textContent = graph.nodes.length + (graph.nodes.length === 1 ? ' node' : ' nodes');
      const t = graph.nodes.reduce((s, n) => s + (n._time || 0), 0);
      $('stat-time').textContent = t > 0 ? 'last run ' + t.toFixed(1) + ' ms' : 'not run';
    }

    // --- transient toast --------------------------------------------------
    let toastTimer = 0;
    function toast(msg) {
      const t = $('toast');
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
    }

    // --- run controls -----------------------------------------------------
    function runAll() {
      if (!runner.ready()) { toast('GPU backend unavailable.'); return; }
      if (!graph.nodes.length) { toast('Add a node first.'); return; }
      try {
        const n = runner.run();
        toast('Ran ' + n + ' node(s).');
      } catch (err) { toast(String(err && err.message || err)); }
      updateStatus();
    }
    $('btn-run').addEventListener('click', runAll);
    $('btn-reset').addEventListener('click', () => {
      runner.reset();
      updateStatus();
      toast('Run state cleared.');
    });
    $('btn-clear').addEventListener('click', () => {
      graph.nodes.length = 0;
      graph.edges.length = 0;
      editor.select(null);
      editor.draw(0);
      updateStatus();
      toast('Canvas cleared.');
      proj.markDirty();
    });

    // --- presets ----------------------------------------------------------
    const presetSel = $('preset');
    for (const p of Presets.list()) {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      presetSel.appendChild(opt);
    }
    function loadPreset(name) {
      if (!name) return;
      Presets.load(name, graph);
      runner.reset();
      editor.select(null);
      editor.resize();
      editor.draw(0);
      editor.frameAll();
      updateStatus();
      const p = Presets.list().find((x) => x.name === name);
      if (p) toast(p.desc);
      proj.markDirty();
    }
    presetSel.addEventListener('change', () => loadPreset(presetSel.value));

    // --- project (save/load) ----------------------------------------------
    const proj = new Project({
      app: 'node-forge',
      schema: 1,
      serialize: () => graph.serialize(),
      deserialize: (data) => {
        const res = graph.deserialize(data);
        if (res.skipped.length) {
          toast(res.skipped.length + ' node(s) skipped — unknown type(s).');
        }
      },
      onNew: () => { graph.nodes.length = 0; graph.edges.length = 0; },
    });
    function afterLoadOrNew() {
      runner.reset();
      editor.select(null);
      editor.resize();
      editor.draw(0);
      editor.frameAll();
      updateStatus();
      updateFileStatus();
    }
    function updateFileStatus() {
      $('file-status').textContent = proj.name + (proj.isDirty() ? ' *' : '');
    }
    proj.on('change', updateFileStatus);
    proj.on('new', afterLoadOrNew);
    proj.on('loaded', afterLoadOrNew);
    $('btn-new').addEventListener('click', () => proj.new());
    $('btn-open').addEventListener('click', () => proj.open());
    $('btn-save').addEventListener('click', () => {
      if (proj.save() || proj.saveAs()) toast('Saved.');
    });
    $('btn-save-as').addEventListener('click', () => {
      if (proj.saveAs()) toast('Saved.');
    });
    updateFileStatus();

    // --- backend badge ------------------------------------------------------
    const badge = $('backend');
    if (bro.tensor && bro.tensor.available) {
      try { bro.tensor.init(); } catch (e) { /* surfaced on run */ }
      badge.textContent = 'GPU · ' + String(bro.tensor.backend || 'gpu').toUpperCase();
      badge.classList.add('ok');
    } else {
      badge.textContent = 'NO GPU BACKEND';
      badge.classList.add('bad');
      $('btn-run').disabled = true;
      toast('No GPU backend — nodes will report an error when they try to load a model.');
    }

    // --- resize + render loop -----------------------------------------------
    window.addEventListener('resize', () => { editor.resize(); });
    function frame(now) {
      editor.draw(now || 0);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // --- initial scene --------------------------------------------------------
    editor.resize();
    updateStatus();

    // debug / test handle
    window.LabApp = { graph: graph, editor: editor, runner: runner, proj: proj };
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    start();
  } else {
    window.addEventListener('load', start);
  }

  installSystemMenu();
