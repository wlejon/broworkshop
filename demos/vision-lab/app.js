// Vision Lab — application bootstrap.
//
// Drives every bro.vision model from one image: a left-rail model picker +
// param panel, a center image stage, and a right-rail result inspector. The
// seven dense-map annotators share a Load → Run flow (async loaders/inference
// via onReady/onDone); SAM gets the interactive setImage → click/box → segment
// flow plus the automatic "segment everything" generator. The model registry
// (lab/models.js) is the single source of truth; this file is wiring.
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  var U = window.VLab.Util, Models = window.VLab.Models;

  var STORE_KEY = 'vision-lab.v1';
  function loadPrefs() {
    try { return JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function savePrefs(p) {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(p)); }
    catch (e) { /* non-fatal */ }
  }

  function start() {
    if (!$('view') || !window.VLab.Stage || !window.VLab.Sam) {
      requestAnimationFrame(start); return;
    }
    init();
  }

  function init() {
    var prefs = loadPrefs();
    var stage = window.VLab.Stage.create($('view'));
    var samCtl = window.VLab.Sam.create();

    // session state
    var weightsRoot = prefs.weightsRoot ||
      (typeof process !== 'undefined' && process.env && process.env.BRO_VISION_WEIGHTS) ||
      'D:/projects/brovisionml/weights';
    var inputImageData = null;     // { data, width, height } — vision input
    var inputBitmap = null;        // ImageBitmap — drawable
    var imagePath = prefs.imagePath || 'assets/robot-arm.png';
    var selectedId = prefs.selectedId || 'depth';
    var instances = {};            // id -> { model, loadParams }
    var lastResult = null;         // current annotator/sam result
    var busy = false;
    var availability = {};         // id -> bool (model.safetensors present)

    var fs = null;
    try { fs = require('fs'); } catch (e) { fs = null; }

    function status(msg, kind) {
      var el = $('status-text'); el.textContent = msg; el.className = kind || '';
    }
    function setBusy(on, label) {
      busy = on;
      $('progress').classList.toggle('indeterminate', on);
      if (label != null) $('stage-label').textContent = label;
      refreshActions();
    }

    // ── weights availability ─────────────────────────────────────────────
    function probeAvailability() {
      availability = {};
      Models.all.forEach(function (m) {
        var ok = false;
        try { ok = fs && fs.existsSync(weightsRoot + '/' + m.subdir + '/model.safetensors'); }
        catch (e) { ok = false; }
        availability[m.id] = ok;
      });
    }

    // Runtime GPU probe. bro.gpu is always present (CPU-only builds included)
    // and reports the device the vision loaders default to.
    function gpuAvailable() { return !!(window.bro && bro.gpu && bro.gpu.available); }
    function gpuLabel() {
      var b = (window.bro && bro.gpu && bro.gpu.backend) || 'cpu';
      return String(b).toUpperCase();
    }

    // Set the backend badge. `ok` = green (a GPU/CUDA device), else amber.
    function setBackend(label, ok) {
      $('backend').textContent = label;
      $('backend').className = 'badge ' + (ok ? 'ok' : 'bad');
    }

    function shortPath(p) {
      if (!p) return '…';
      var parts = p.replace(/\\/g, '/').split('/');
      return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : p;
    }

    // ── model list ───────────────────────────────────────────────────────
    function buildModelList() {
      var list = $('model-list'); list.innerHTML = '';
      Models.all.forEach(function (m) {
        var item = document.createElement('div');
        item.className = 'model-item' +
          (m.id === selectedId ? ' active' : '') +
          (availability[m.id] ? ' avail' : '') +
          (instances[m.id] ? ' loaded' : '');
        item.title = availability[m.id] ? 'weights present' : 'weights missing';
        var dot = document.createElement('span'); dot.className = 'dot';
        var name = document.createElement('span'); name.className = 'name';
        name.textContent = m.label;
        item.appendChild(dot); item.appendChild(name);
        item.addEventListener('click', function () { selectModel(m.id); });
        list.appendChild(item);
      });
    }

    function model() { return Models.byId(selectedId); }
    function isSam() { return model().group === 'sam'; }

    // ── param panel ──────────────────────────────────────────────────────
    var paramValues = {};   // current values for the selected model's params

    function buildParams() {
      var m = model();
      $('param-title').textContent = m.label;
      $('model-tagline').textContent = m.tagline || '';
      var host = $('params'); host.innerHTML = '';
      paramValues = {};
      (m.params || []).forEach(function (pr) {
        paramValues[pr.key] = pr.default;
        host.appendChild(paramRow(pr));
      });
      if (!m.params || !m.params.length) {
        var none = document.createElement('p');
        none.className = 'muted small';
        none.textContent = 'No parameters.';
        host.appendChild(none);
      }
    }

    function paramRow(pr) {
      var field = document.createElement('div'); field.className = 'field';
      if (pr.type === 'check') {
        var lab = document.createElement('label'); lab.className = 'check';
        var cb = document.createElement('input'); cb.type = 'checkbox';
        cb.checked = !!pr.default;
        cb.addEventListener('change', function () {
          paramValues[pr.key] = cb.checked; onParamChange(pr);
        });
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(' ' + pr.label));
        field.appendChild(lab);
        return field;
      }
      var label = document.createElement('label');
      label.innerHTML = pr.label +
        (pr.type === 'range' ? ' <span class="val">' + pr.default + '</span>' : '');
      var inp = document.createElement('input');
      inp.type = pr.type === 'range' ? 'range' : 'number';
      inp.min = pr.min; inp.max = pr.max; inp.step = pr.step; inp.value = pr.default;
      inp.addEventListener('input', function () {
        var v = parseFloat(inp.value);
        paramValues[pr.key] = v;
        if (pr.type === 'range') label.querySelector('.val').textContent = v;
        onParamChange(pr);
      });
      field.appendChild(label); field.appendChild(inp);
      return field;
    }

    // A non-runtime param edit invalidates the loaded model (its value was
    // baked into the loader); a runtime param (e.g. depth invert) does not.
    function onParamChange(pr) {
      if (pr.runtime) return;
      if (instances[selectedId]) {
        delete instances[selectedId];
        buildModelList();
        status(model().label + ' params changed — reload to apply.', '');
      }
      refreshActions();
    }

    function currentParams() {
      var p = {}; for (var k in paramValues) p[k] = paramValues[k];
      return p;
    }

    // ── selection + mode wiring ──────────────────────────────────────────
    function selectModel(id) {
      if (busy) return;
      selectedId = id; prefs.selectedId = id; savePrefs(prefs);
      buildModelList();
      buildParams();
      stage.clearVectors();
      lastResult = null;
      $('mask-block').classList.add('hidden');
      $('contact-block').classList.add('hidden');
      $('meta').querySelector('tbody').innerHTML = '';
      $('out-thumb').classList.add('hidden');
      $('out-hint').classList.remove('hidden');
      $('out-hint').textContent = 'No result yet.';
      // mode-specific action groups
      var sam = isSam();
      $('annot-actions').classList.toggle('hidden', sam);
      $('runall-actions').classList.toggle('hidden', sam);
      $('sam-actions').classList.toggle('hidden', !sam);
      if (sam) { samCtl.setModel(instances[id] ? instances[id].model : null); buildAmgParams(); }
      stage.setMode('input');
      setViewToggle('input');
      $('view-mode-wrap').classList.add('hidden');
      $('opacity-wrap').classList.add('hidden');
      refreshActions();
    }

    function refreshActions() {
      var have = availability[selectedId];
      var loaded = !!instances[selectedId];
      $('btn-load').disabled = busy || !have || loaded;
      $('btn-load').textContent = loaded ? 'Loaded ✓' : 'Load model';
      if (isSam()) {
        $('btn-setimage').disabled = busy || !loaded || !inputImageData;
        var enc = samCtl.isEncoded();
        $('btn-segment').disabled = busy || !enc || !samCtl.hasPrompts();
        $('btn-sam-clear').disabled = busy || !samCtl.hasPrompts();
        $('btn-everything').disabled = busy || !loaded || !inputImageData;
      } else {
        $('btn-run').disabled = busy || !loaded || !inputImageData;
        $('btn-cancel').disabled = !busy;
        $('btn-runall').disabled = busy || !inputImageData;
      }
    }

    // ── image loading ────────────────────────────────────────────────────
    function loadInputImage(path) {
      try {
        inputImageData = U.fileToImageData(path);
      } catch (e) { status('image load failed: ' + e.message, 'err'); return; }
      imagePath = path; prefs.imagePath = path; savePrefs(prefs);
      $('image-name').textContent = shortPath(path) +
        ' (' + inputImageData.width + '×' + inputImageData.height + ')';
      createImageBitmap(inputImageData).then(function (bmp) {
        if (inputBitmap) inputBitmap.close();
        inputBitmap = bmp;
        stage.setInput(bmp);
        $('view-hint').classList.add('hidden');
      });
      // a new image invalidates SAM's cached embedding
      samCtl.cancelEncode();
      stage.clearVectors();
      refreshActions();
    }

    // ── annotator: Load + Run ────────────────────────────────────────────
    function loadModel() {
      if (busy) return;
      var m = model();
      // Warn on heavy CPU loads — vision models run without a GPU, just slowly.
      if (!gpuAvailable()) {
        status(m.label + ' has no GPU backend — running on CPU will be slow.', 'warn');
      }
      setBusy(true, 'loading ' + m.id + '…');
      status('loading ' + m.label + ' weights…', '');
      var p = currentParams();
      m.load(weightsRoot, p, {
        onReady: function (inst) {
          instances[selectedId] = { model: inst, loadParams: p };
          if (isSam()) samCtl.setModel(inst);
          setBusy(false, 'idle');
          buildModelList();
          // Refresh the badge to the model's ground-truth device — a GPU build
          // still loads on CPU when no CUDA device is present at runtime.
          if (inst && inst.device) {
            setBackend(String(inst.device).toUpperCase(),
                       /cuda|gpu/i.test(inst.device));
          }
          status(m.label + ' ready on ' + inst.device + '.', 'ok');
          refreshActions();
        },
        onError: function (msg) {
          setBusy(false, 'idle');
          status('load failed: ' + msg, 'err');
        },
      });
    }

    function runAnnotator() {
      if (busy) return;
      var m = model();
      var inst = instances[selectedId];
      if (!inst || !inputImageData) return;
      setBusy(true, 'running ' + m.id + '…');
      status('running ' + m.label + '…', '');
      m.run(inst.model, inputImageData, currentParams(), {
        onDone: function (r, info) {
          setBusy(false, 'idle');
          if (info && info.cancelled) { status('cancelled.', ''); return; }
          if (info && info.error) { status('run failed: ' + info.error, 'err'); return; }
          showAnnotatorResult(m, r);
        },
      });
    }

    function showAnnotatorResult(m, r) {
      lastResult = r;
      stage.setResult(r.image);
      stage.setMode('overlay');
      setViewToggle('overlay');
      $('view-mode-wrap').classList.remove('hidden');
      $('opacity-wrap').classList.remove('hidden');
      // vector overlays for MLSD / OpenPose
      if (m.id === 'mlsd') stage.setVectors({ kind: 'mlsd', segments: r.segments });
      else if (m.id === 'openpose') stage.setVectors({ kind: 'pose', bodies: r.bodies });
      else stage.clearVectors();
      drawThumb(r.image);
      fillMeta(m.metadata ? m.metadata(r) : []);
      status(m.label + ' done.', 'ok');
    }

    function drawThumb(bmp) {
      var c = $('out-thumb');
      c.classList.remove('hidden');
      $('out-hint').classList.add('hidden');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
    }

    function fillMeta(rows) {
      var tb = $('meta').querySelector('tbody'); tb.innerHTML = '';
      rows.forEach(function (row) {
        var tr = document.createElement('tr');
        var a = document.createElement('td'); a.textContent = row[0];
        var b = document.createElement('td'); b.textContent = row[1];
        tr.appendChild(a); tr.appendChild(b); tb.appendChild(tr);
      });
    }

    // ── Run all annotators → contact sheet ───────────────────────────────
    function runAll() {
      if (busy || !inputImageData) return;
      var grid = $('contact-grid'); grid.innerHTML = '';
      $('contact-block').classList.remove('hidden');
      var queue = Models.annotators.filter(function (m) { return availability[m.id]; });
      var i = 0;
      setBusy(true, 'contact sheet…');
      (function next() {
        if (i >= queue.length) {
          setBusy(false, 'idle');
          status('contact sheet complete (' + queue.length + ' annotators).', 'ok');
          return;
        }
        var m = queue[i++];
        status('contact sheet: ' + m.label + ' (' + i + '/' + queue.length + ')…', '');
        var p = {}; (m.params || []).forEach(function (pr) { p[pr.key] = pr.default; });
        var ready = instances[m.id]
          ? function (cb) { cb(instances[m.id].model); }
          : function (cb) {
              m.load(weightsRoot, p, { onReady: function (inst) {
                instances[m.id] = { model: inst, loadParams: p }; cb(inst);
              }, onError: function () { cb(null); } });
            };
        ready(function (inst) {
          if (!inst) { next(); return; }
          m.run(inst, inputImageData, p, { onDone: function (r, info) {
            if (r && r.image && !(info && info.error)) addContactCell(grid, m, r.image);
            next();
          } });
        });
      })();
    }

    function addContactCell(grid, m, bmp) {
      var cell = document.createElement('div'); cell.className = 'contact-cell';
      var c = document.createElement('canvas');
      var w = 240, h = Math.round(w * bmp.height / bmp.width);
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      var cap = document.createElement('div'); cap.className = 'cap';
      cap.textContent = m.label;
      cell.appendChild(c); cell.appendChild(cap);
      cell.addEventListener('click', function () { selectModel(m.id); });
      grid.appendChild(cell);
    }

    // ── SAM flow ─────────────────────────────────────────────────────────
    var AMG_PARAMS = [
      { key: 'pointsPerSide', label: 'Points per side', type: 'number', min: 4, max: 64, step: 4, default: 32 },
      { key: 'predIouThresh', label: 'Pred-IoU threshold', type: 'range', min: 0, max: 1, step: 0.01, default: 0.88 },
      { key: 'stabilityThresh', label: 'Stability threshold', type: 'range', min: 0, max: 1, step: 0.01, default: 0.95 },
      { key: 'boxNmsThresh', label: 'Box NMS threshold', type: 'range', min: 0, max: 1, step: 0.01, default: 0.7 },
      { key: 'minMaskRegionArea', label: 'Min region area (px)', type: 'number', min: 0, max: 5000, step: 50, default: 0 },
    ];
    var amgValues = {};
    function buildAmgParams() {
      var host = $('amg-params'); host.innerHTML = ''; amgValues = {};
      AMG_PARAMS.forEach(function (pr) {
        amgValues[pr.key] = pr.default;
        var field = document.createElement('div'); field.className = 'field';
        var label = document.createElement('label');
        label.innerHTML = pr.label +
          (pr.type === 'range' ? ' <span class="val">' + pr.default + '</span>' : '');
        var inp = document.createElement('input');
        inp.type = pr.type === 'range' ? 'range' : 'number';
        inp.min = pr.min; inp.max = pr.max; inp.step = pr.step; inp.value = pr.default;
        inp.addEventListener('input', function () {
          amgValues[pr.key] = parseFloat(inp.value);
          if (pr.type === 'range') label.querySelector('.val').textContent = inp.value;
        });
        field.appendChild(label); field.appendChild(inp); host.appendChild(field);
      });
    }

    function samSetImage() {
      if (busy || !inputImageData) return;
      setBusy(true, 'encoding image…');
      status('SAM: encoding image (ViT pass)…', '');
      stage.setMode('input');
      samCtl.setImage(inputImageData, function (err) {
        setBusy(false, 'idle');
        if (err) { status('SAM encode failed: ' + err.message, 'err'); return; }
        status('SAM ready — click to add prompts.', 'ok');
        refreshActions();
      });
    }

    function refreshSamVectors() {
      var pr = samCtl.prompts();
      stage.setVectors({ kind: 'sam', points: pr.points, labels: pr.labels, box: pr.box });
    }

    function samSegment() {
      if (busy) return;
      try {
        var seg = samCtl.segment($('sam-multimask').checked);
        showSamMasks(seg);
        status('SAM: ' + seg.num + ' mask(s), best IoU ' +
          seg.masks[seg.best].iou.toFixed(3) + '.', 'ok');
      } catch (e) { status('segment failed: ' + e.message, 'err'); }
    }

    var COLORS = ['#4a6cf0','#f0c64a','#4fd06a','#e0556a','#a06af0','#f08a3a','#3ad0c0'];
    function showSamMasks(seg) {
      lastResult = seg;
      $('mask-block').classList.remove('hidden');
      $('mask-count').textContent = '(' + seg.num + ')';
      var host = $('mask-list'); host.innerHTML = '';
      function pick(i) {
        stage.setResult(seg.masks[i].image);
        stage.setMode('overlay');
        setViewToggle('overlay');
        $('view-mode-wrap').classList.remove('hidden');
        $('opacity-wrap').classList.remove('hidden');
        drawThumb(seg.masks[i].image);
        Array.prototype.forEach.call(host.children, function (ch, j) {
          ch.classList.toggle('active', j === i);
        });
        fillMeta([['mask', (i + 1) + ' / ' + seg.num],
                  ['IoU', seg.masks[i].iou.toFixed(4)],
                  ['best', i === seg.best ? 'yes' : 'no']]);
      }
      seg.masks.forEach(function (mk, i) {
        var row = document.createElement('div');
        row.className = 'mask-row' + (i === seg.best ? ' best' : '');
        var sw = document.createElement('span'); sw.className = 'swatch';
        sw.style.background = COLORS[i % COLORS.length];
        var iou = document.createElement('span'); iou.className = 'iou';
        iou.textContent = 'IoU ' + mk.iou.toFixed(3);
        row.appendChild(sw); row.appendChild(iou);
        if (i === seg.best) {
          var t = document.createElement('span'); t.className = 'tagbest';
          t.textContent = 'BEST'; row.appendChild(t);
        }
        row.addEventListener('click', function () { pick(i); });
        host.appendChild(row);
      });
      pick(seg.best);
    }

    function samEverything() {
      if (busy || !inputImageData) return;
      setBusy(true, 'segment everything…');
      status('SAM: segment everything…', '');
      samCtl.segmentEverything(inputImageData, amgValues, function (err, r) {
        setBusy(false, 'idle');
        if (err) { status('segment everything failed: ' + err.message, 'err'); return; }
        showEverything(r);
      });
    }

    function showEverything(r) {
      lastResult = r;
      // Composite every translucent mask overlay onto one bitmap for the stage.
      var c = document.createElement('canvas'); c.width = r.width; c.height = r.height;
      var cx = c.getContext('2d');
      r.masks.forEach(function (mk) { cx.drawImage(mk.image, 0, 0); });
      createImageBitmap(cx.getImageData(0, 0, c.width, c.height)).then(function (bmp) {
        stage.setResult(bmp); stage.setMode('overlay'); setViewToggle('overlay');
        $('view-mode-wrap').classList.remove('hidden');
        $('opacity-wrap').classList.remove('hidden');
        drawThumb(bmp);
      });
      $('mask-block').classList.add('hidden');
      var areas = r.masks.map(function (m) { return m.area; });
      fillMeta([['masks', U.fmtInt(r.masks.length)],
                ['largest area', areas.length ? U.fmtInt(areas[0]) + ' px' : '—'],
                ['map size', r.width + '×' + r.height]]);
      status('SAM: ' + r.masks.length + ' masks (segment everything).', 'ok');
    }

    // ── stage interaction (SAM prompts) ──────────────────────────────────
    var dragStart = null;
    $('view').addEventListener('mousedown', function (e) {
      if (!isSam() || !samCtl.isEncoded() || busy) return;
      var p = stage.toImage(e.offsetX, e.offsetY);
      if (!p) return;
      dragStart = { x: p.x, y: p.y, sx: e.offsetX, sy: e.offsetY, moved: false };
    });
    $('view').addEventListener('mousemove', function (e) {
      if (!dragStart) return;
      var p = stage.toImage(e.offsetX, e.offsetY); if (!p) return;
      if (Math.abs(e.offsetX - dragStart.sx) + Math.abs(e.offsetY - dragStart.sy) > 4)
        dragStart.moved = true;
      if (dragStart.moved) {
        var pr = samCtl.prompts();
        stage.setVectors({ kind: 'sam', points: pr.points, labels: pr.labels,
                           box: [dragStart.x, dragStart.y, p.x, p.y] });
      }
    });
    $('view').addEventListener('mouseup', function (e) {
      if (!dragStart) return;
      var p = stage.toImage(e.offsetX, e.offsetY) ||
              { x: dragStart.x, y: dragStart.y };
      if (dragStart.moved) {
        samCtl.setBox(dragStart.x, dragStart.y, p.x, p.y);
      } else {
        samCtl.addPoint(p.x, p.y, !e.shiftKey);   // Shift = background
      }
      dragStart = null;
      refreshSamVectors();
      refreshActions();
    });

    // ── view-mode toggle ─────────────────────────────────────────────────
    function setViewToggle(mode) {
      Array.prototype.forEach.call(
        $('view-mode-wrap').querySelectorAll('.seg'), function (b) {
          b.classList.toggle('active', b.getAttribute('data-mode') === mode);
        });
    }
    Array.prototype.forEach.call(
      $('view-mode-wrap').querySelectorAll('.seg'), function (b) {
        b.addEventListener('click', function () {
          var m = b.getAttribute('data-mode');
          stage.setMode(m); setViewToggle(m);
        });
      });
    $('opacity').addEventListener('input', function () {
      stage.setOpacity(parseInt($('opacity').value, 10) / 100);
    });

    // ── top-bar buttons ──────────────────────────────────────────────────
    $('btn-image').addEventListener('click', function () {
      if (typeof showOpenFileDialog !== 'function') {
        status('file dialog unavailable in this build', 'err'); return;
      }
      var files = showOpenFileDialog('Image|png;jpg;jpeg');
      if (files && files.length) loadInputImage(files[0]);
    });
    $('btn-weights').addEventListener('click', function () {
      if (typeof showOpenFolderDialog !== 'function') {
        status('folder dialog unavailable in this build', 'err'); return;
      }
      var dirs = showOpenFolderDialog(weightsRoot);
      if (dirs && dirs.length) {
        weightsRoot = dirs[0]; prefs.weightsRoot = weightsRoot; savePrefs(prefs);
        instances = {};
        $('weights-name').textContent = 'weights: ' + shortPath(weightsRoot);
        probeAvailability(); buildModelList(); refreshActions();
        status('weights root set — ' + shortPath(weightsRoot), '');
      }
    });

    $('btn-load').addEventListener('click', loadModel);
    $('btn-run').addEventListener('click', runAnnotator);
    $('btn-runall').addEventListener('click', runAll);
    $('btn-cancel').addEventListener('click', function () { /* sync ops; reserved */ });
    $('btn-setimage').addEventListener('click', samSetImage);
    $('btn-segment').addEventListener('click', samSegment);
    $('btn-sam-clear').addEventListener('click', function () {
      samCtl.clearPrompts(); refreshSamVectors(); refreshActions();
      $('mask-block').classList.add('hidden');
    });
    $('btn-everything').addEventListener('click', samEverything);

    window.addEventListener('resize', function () { stage.redraw(); });

    // ── boot ─────────────────────────────────────────────────────────────
    var version = (window.bro && bro.vision && bro.vision.version) || '';
    $('vision-version').textContent = version ? 'brovisionml ' + version : 'bro.vision';
    // Backend badge from bro.gpu — the runtime device the vision loaders default
    // to (honest even on a GPU build with no CUDA device present). setBackend()
    // in loadModel() refreshes it to a loaded model's ground-truth device.
    // Without a GPU, bro.vision still runs, just slowly on CPU.
    setBackend(gpuLabel(), gpuAvailable());
    $('weights-name').textContent = 'weights: ' + shortPath(weightsRoot);
    if (window.bro && bro.vision) { try { bro.vision.init(); } catch (e) {} }

    probeAvailability();
    buildModelList();
    selectModel(selectedId);
    loadInputImage(imagePath);
    status('Ready. Pick a model and Load.', '');

    // expose for the headless harness
    window.VLabApp = {
      state: function () {
        return { weightsRoot: weightsRoot, selectedId: selectedId,
                 availability: availability, loaded: Object.keys(instances),
                 hasImage: !!inputImageData };
      },
      selectModel: selectModel,
      loadInputImage: loadInputImage,
    };
  }

  start();
})();
