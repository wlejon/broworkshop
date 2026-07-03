// Node Forge — application bootstrap.
//
// A freeform node-graph builder generalized from tensor-lab: op packs
// register into lab/ops-registry.js (ops/tensor-ops.js today; ops/rave-ops.js
// and ops/kokoro-ops.js join in Milestone 1b), ports carry a declared type
// checked at wire time, and ops can supply a custom inspector panel widget
// (lab/widgets.js) instead of the generic scalar param form.
import { Graph } from "/app/lab/graph.js";
import { Runner } from "/app/lab/runner.js";
import { Inspector } from "/app/lab/inspector.js";
import { Editor } from "/app/lab/editor.js";
import { Palette } from "/app/lab/palette.js";
import { Presets } from "/app/lab/presets.js";
import { T5 } from "/app/lab/t5import.js";
import { Ops, fmtNum, fmtMs } from "/app/lab/ops-registry.js";
import "/app/ops/tensor-ops.js";               // registers the tensor op pack
import "/app/ops/rave-ops.js";                 // registers the RAVE op pack
import "/app/widgets/curve-painter.js";        // registers the 'multi-curve-painter' panel widget
import "/app/widgets/basis-slider-map.js";     // registers the 'basis-slider-map' panel widget
import "/app/widgets/audio-preview.js";        // registers the 'audio-preview' panel widget
import "/lib/project.js";                       // attaches global Project
import { installSystemMenu } from "/lib/system-menu.js";

  function $(id) { return document.getElementById(id); }

  function start() {
    const canvas = $('graph');
    if (!canvas) { requestAnimationFrame(start); return; }
    init(canvas);
  }

  function init(canvas) {
    const graph = Graph.create();
    const runner = Runner.create(graph);

    // debounced incremental re-run driven by a widget's live-edit ticks
    // (curve-painter drag, basis-slider drag) — see lab/widgets.js's
    // onEdit()/onCommit() contract. Only the edited node's downstream
    // subgraph re-executes; upstream nodes (e.g. an encode/load node) keep
    // their cached output.
    let widgetEditTimer = 0;
    function scheduleContinue(node) {
      graph.invalidateFrom(node);
      updateStatus();
      clearTimeout(widgetEditTimer);
      widgetEditTimer = setTimeout(() => {
        if (!runner.ready()) return;
        try { runner.continue(); }
        catch (err) { /* surfaced via node.error on the next propagate() */ }
        updateStatus();
        inspector.refresh();
      }, 40);
    }

    const inspector = Inspector.create($('inspector'), {
      onParamChange() {
        graph.propagate();
        graph.clearRun();
        editor.activeNode = null;
        updateStatus();
        inspector.refresh();
        proj.markDirty();
      },
      onWidgetEdit(node) {
        graph.propagate();
        scheduleContinue(node);
        proj.markDirty();
      },
    });

    const editor = Editor.create(canvas, graph, {
      onSelect(sel) { inspector.show(sel); },
      onChange() {
        graph.propagate();
        graph.clearRun();
        editor.activeNode = null;
        updateStatus();
        inspector.refresh();
        proj.markDirty();
      },
    });

    Palette.create($('palette'), (type) => {
      const node = graph.addNode(type);
      editor.placeNew(node);
      graph.propagate();
      updateStatus();
      editor.select(node, null);
      proj.markDirty();
    });

    // --- status bar -----------------------------------------------------
    function updateStatus() {
      const s = graph.stats();
      $('stat-nodes').textContent = s.nodes + (s.nodes === 1 ? ' node' : ' nodes');
      $('stat-params').textContent = fmtNum(s.params) + ' params';
      $('stat-flops').textContent = fmtNum(s.flops) + ' FLOPs';
      $('stat-time').textContent = s.time > 0 ? 'forward ' + fmtMs(s.time) : 'not run';
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
    let running = false;
    function setRunUI(on) {
      running = on;
      $('btn-run').textContent = on ? '■ Running…' : '▶ Run';
      $('btn-run').classList.toggle('busy', on);
      $('btn-step').disabled = on;
      $('btn-reset').disabled = on;
    }

    function checkErrors() {
      graph.propagate();
      for (const n of graph.nodes) {
        if (n.error) {
          editor.select(n, null);
          toast(Ops.get(n.type).label + ': ' + n.error);
          return false;
        }
      }
      if (!graph.nodes.length) { toast('Add some ops first.'); return false; }
      return true;
    }

    // animated run — executes one op per tick so the forward pass is visible
    function animatedRun() {
      if (running) return;
      if (!runner.ready()) { toast('GPU backend unavailable.'); return; }
      if (!checkErrors()) return;
      runner.reset();
      setRunUI(true);
      const tick = () => {
        let node;
        try { node = runner.step(); }
        catch (err) { toast(err.message); finishRun(); return; }
        if (node === null) { finishRun(); toast('Forward pass complete.'); return; }
        editor.activeNode = node;
        updateStatus();
        setTimeout(tick, 140);
      };
      tick();
    }
    function finishRun() {
      setRunUI(false);
      editor.activeNode = null;
      updateStatus();
      inspector.refresh();
    }

    function stepOnce() {
      if (running) return;
      if (!runner.ready()) { toast('GPU backend unavailable.'); return; }
      if (!checkErrors()) return;
      let node;
      try { node = runner.step(); }
      catch (err) { toast(err.message); return; }
      if (node === null) {
        runner.reset();
        editor.activeNode = null;
        toast('Graph complete — reset. Step again to replay.');
        updateStatus();
        inspector.refresh();
        return;
      }
      editor.activeNode = node;
      editor.select(node, null);   // jump the inspector to the op that just ran
      updateStatus();
    }

    $('btn-run').addEventListener('click', animatedRun);
    $('btn-step').addEventListener('click', stepOnce);
    $('btn-reset').addEventListener('click', () => {
      if (running) return;
      runner.reset();
      editor.activeNode = null;
      updateStatus();
      inspector.refresh();
      toast('Run state cleared.');
    });
    $('btn-clear').addEventListener('click', () => {
      if (running) return;
      graph.nodes.length = 0;
      graph.edges.length = 0;
      editor.select(null, null);
      graph.propagate();
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
      editor.activeNode = null;
      editor.select(null, null);
      editor.resize();
      editor.frameAll();
      updateStatus();
      const p = Presets.list().find((x) => x.name === name);
      if (p) toast(p.desc);
      proj.markDirty();
    }
    presetSel.addEventListener('change', () => loadPreset(presetSel.value));

    // --- T5 importer --------------------------------------------------------
    function openT5() {
      if (running) return;
      if (!bro.tensor || !bro.tensor.available) { toast('GPU backend unavailable.'); return; }
      let paths;
      try { paths = showOpenFileDialog('T5 checkpoint|safetensors'); }
      catch (e) { toast('file dialog unavailable'); return; }
      if (!paths || !paths.length) return;
      let cfg;
      try {
        const file = T5.open(paths[0]);
        cfg = T5.importEncoder(file, graph, { layers: 2, seqLen: 16 });
      } catch (e) {
        toast('T5 import failed: ' + (e && e.message || e));
        return;
      }
      runner.reset();
      editor.activeNode = null;
      editor.select(null, null);
      editor.resize();
      editor.frameAll();
      updateStatus();
      toast('T5 loaded — ' + cfg.builtLayers + ' of ' + cfg.layers +
        ' encoder layers · d_model ' + cfg.dModel + ' · ' + cfg.heads + ' heads');
      proj.markDirty();
    }
    $('btn-open-t5').addEventListener('click', openT5);

    // --- project (save/load) ----------------------------------------------
    const proj = new Project({
      app: 'node-forge',
      schema: 1,
      serialize: () => graph.serialize(),
      deserialize: (data) => {
        const res = graph.deserialize(data);
        if (res.skipped.length) {
          toast(res.skipped.length + ' node(s) skipped — unknown op type(s).');
        }
      },
      onNew: () => { graph.nodes.length = 0; graph.edges.length = 0; },
    });
    function afterLoadOrNew() {
      graph.propagate();
      runner.reset();
      editor.activeNode = null;
      editor.select(null, null);
      editor.resize();
      editor.frameAll();
      updateStatus();
      inspector.refresh();
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
      $('btn-step').disabled = true;
      toast('bro.tensor has no GPU backend — shapes still propagate, but ops cannot run.');
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
    inspector.show(null);
    updateStatus();

    // debug / test handle
    window.LabApp = { graph: graph, editor: editor, runner: runner, inspector: inspector, proj: proj };
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    start();
  } else {
    window.addEventListener('load', start);
  }

  installSystemMenu();
