// Sana Lab — main thread. Drives the Sana pipeline (in a worker) and turns its
// conditioning-control dictionary into live sliders.
//
// The interesting part of this app is the control rail: every axis the loaded
// BCD1 dictionary reports (controlAxes()) becomes a slider, grouped by category
// (the prefix before the dot — "bird", "flower", ...). Moving a slider sets that
// axis's alpha; Generate re-applies the whole map and renders. alpha is in the
// dictionary's natural units — the lab vetted clean actuation in roughly ±3, so
// that's the slider range. At 0 the seam is a true no-op.

function $(id) { return document.getElementById(id); }

// ── persisted UI state ─────────────────────────────────────────────────────
const STORE_KEY = 'sana-lab.v1';
function loadPrefs() {
  try { return JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}'); }
  catch (e) { return {}; }
}
function savePrefs(p) {
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(p)); }
  catch (e) { /* storage unavailable — non-fatal */ }
}

// ── worker client (one outstanding request at a time) ──────────────────────
function createClient() {
  const worker = new Worker('lab/sana-worker.js');
  let pending = null, readyCb = null, ready = false;

  worker.onmessage = function (e) {
    const msg = e.data || {};
    if (msg.type === 'ready') {
      ready = true;
      if (readyCb) { const r = readyCb; readyCb = null; r(); }
      return;
    }
    const cb = pending; pending = null;
    if (!cb) return;
    if (msg.type === 'error') cb(new Error('[' + msg.stage + '] ' + msg.message), null);
    else cb(null, msg);
  };

  function send(message, cb) {
    if (pending) { cb(new Error('worker busy'), null); return; }
    pending = cb;
    worker.postMessage(message);
  }
  return {
    onReady: (cb) => { if (ready) cb(); else readyCb = cb; },
    load: (modelDir, dictPath, cb) =>
      send({ type: 'load', modelDir, dictPath }, cb),
    generate: (prompt, opts, controls, cb) =>
      send({ type: 'generate', prompt, opts, controls }, cb),
  };
}

function init() {
  const prefs = loadPrefs();
  const client = createClient();

  let axes = [];           // axis names from the loaded dictionary
  let loaded = false;
  let busy = false;
  const sliders = {};      // axisName -> { range, num, get(), set(v) }

  const canvas = $('view');
  const cctx = canvas.getContext('2d');

  // restore persisted text fields
  if (prefs.modelDir) $('model-dir').value = prefs.modelDir;
  if (prefs.dictPath) $('dict-path').value = prefs.dictPath;
  if (prefs.prompt)   $('prompt').value = prefs.prompt;
  ['seed', 'steps', 'guidance', 'size'].forEach((k) => {
    if (prefs[k] != null) $(k).value = prefs[k];
  });

  function persist() {
    savePrefs({
      modelDir: $('model-dir').value,
      dictPath: $('dict-path').value,
      prompt: $('prompt').value,
      seed: $('seed').value, steps: $('steps').value,
      guidance: $('guidance').value, size: $('size').value,
      controls: collectControls(),
    });
  }

  function status(msg, kind) {
    const el = $('status-text');
    el.textContent = msg;
    el.className = kind || '';
  }
  function backend(text, kind) {
    const el = $('backend');
    el.textContent = text;
    el.className = 'badge' + (kind ? ' ' + kind : '');
  }

  // ── control rail ─────────────────────────────────────────────────────────
  // Build one slider per axis, grouped by the category prefix. Slider value is
  // alpha in natural units; ±3 brackets the vetted actuation range.
  function buildControls() {
    const host = $('controls-host');
    host.innerHTML = '';
    for (const k in sliders) delete sliders[k];

    if (!axes.length) {
      $('ctl-hint').textContent = loaded
        ? 'This model has no control dictionary loaded.'
        : 'Load a model to populate the control axes.';
      return;
    }
    $('ctl-hint').textContent =
      'alpha in the dictionary’s natural units · 0 = no change';

    // group by prefix before the first dot
    const groups = {};
    axes.forEach((name) => {
      const dot = name.indexOf('.');
      const cat = dot > 0 ? name.slice(0, dot) : 'general';
      (groups[cat] = groups[cat] || []).push(name);
    });

    const saved = (prefs.controls && typeof prefs.controls === 'object')
      ? prefs.controls : {};

    Object.keys(groups).sort().forEach((cat) => {
      const sec = document.createElement('div');
      sec.className = 'ctl-group';
      const h = document.createElement('div');
      h.className = 'ctl-cat';
      h.textContent = cat;
      sec.appendChild(h);

      groups[cat].forEach((name) => {
        const dot = name.indexOf('.');
        const short = dot > 0 ? name.slice(dot + 1) : name;

        const row = document.createElement('div');
        row.className = 'ctl-row';

        const label = document.createElement('span');
        label.className = 'ctl-name';
        label.textContent = short;

        const range = document.createElement('input');
        range.type = 'range';
        range.min = '-3'; range.max = '3'; range.step = '0.05';
        range.value = String(+saved[name] || 0);

        const num = document.createElement('span');
        num.className = 'ctl-val';

        function refresh() {
          const v = +range.value;
          num.textContent = (v > 0 ? '+' : '') + v.toFixed(2);
          num.classList.toggle('off', v === 0);
        }
        range.addEventListener('input', () => { refresh(); persist(); });
        // double-click the value to recenter
        num.addEventListener('dblclick', () => {
          range.value = '0'; refresh(); persist();
        });
        refresh();

        row.appendChild(label);
        row.appendChild(range);
        row.appendChild(num);
        sec.appendChild(row);

        sliders[name] = {
          get: () => +range.value,
          set: (v) => { range.value = String(v); refresh(); },
        };
      });
      host.appendChild(sec);
    });
  }

  function collectControls() {
    const out = {};
    for (const name in sliders) {
      const v = sliders[name].get();
      if (v) out[name] = v;
    }
    return out;
  }

  // ── render ─────────────────────────────────────────────────────────────
  function drawBitmap(bitmap, w, h) {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    cctx.drawImage(bitmap, 0, 0);
    $('view-hint').style.display = 'none';
  }

  // ── actions ──────────────────────────────────────────────────────────────
  function setBusy(b) {
    busy = b;
    $('btn-generate').disabled = b || !loaded;
    $('btn-load').disabled = b;
  }

  function doLoad() {
    const modelDir = $('model-dir').value.trim();
    const dictPath = $('dict-path').value.trim();
    if (!modelDir) { status('set a Sana directory first', 'err'); return; }
    persist();
    setBusy(true);
    loaded = false;
    backend('loading…');
    status('loading model — this reads multi-GB weights, give it a moment');
    client.load(modelDir, dictPath, (err, msg) => {
      setBusy(false);
      if (err) {
        backend('error', 'err');
        status(String(err.message || err), 'err');
        return;
      }
      loaded = true;
      axes = msg.axes || [];
      backend(msg.backend === 'cpu' ? 'CPU' : (msg.backend || 'gpu').toUpperCase(),
              msg.backend === 'cpu' ? 'warn' : 'ok');
      const cls = (msg.config && msg.config.modelClass) || 'model';
      status(cls + ' ready · ' + axes.length + ' control axes', 'ok');
      buildControls();
      $('btn-generate').disabled = false;
    });
  }

  function doGenerate() {
    if (!loaded || busy) return;
    const size = +$('size').value;
    const opts = {
      width: size, height: size,
      steps: +$('steps').value || 20,
      guidance: +$('guidance').value || 4.5,
      seed: +$('seed').value || 0,
    };
    const controls = collectControls();
    persist();
    setBusy(true);
    const nctl = Object.keys(controls).length;
    status('generating' + (nctl ? ' · ' + nctl + ' axis' + (nctl > 1 ? 'es' : '') + ' active' : ' · baseline') + '…');
    $('timing').textContent = '';
    client.generate($('prompt').value, opts, controls, (err, msg) => {
      setBusy(false);
      if (err) { status(String(err.message || err), 'err'); return; }
      drawBitmap(msg.bitmap, msg.width, msg.height);
      status('done', 'ok');
      $('timing').textContent = msg.ms ? (msg.ms + ' ms') : '';
    });
  }

  // ── wire up ────────────────────────────────────────────────────────────
  $('btn-load').addEventListener('click', doLoad);
  $('btn-generate').addEventListener('click', doGenerate);
  $('btn-reset-ctl').addEventListener('click', () => {
    for (const name in sliders) sliders[name].set(0);
    persist();
  });
  $('btn-browse-model').addEventListener('click', () => {
    const d = window.showOpenFolderDialog
      ? window.showOpenFolderDialog($('model-dir').value.trim()) : null;
    if (d) { $('model-dir').value = d; persist(); }
  });
  $('btn-browse-dict').addEventListener('click', () => {
    const f = window.showOpenFileDialog
      ? window.showOpenFileDialog('Control dictionary|bcd1') : null;
    if (f) { $('dict-path').value = f; persist(); }
  });
  ['model-dir', 'dict-path', 'prompt', 'seed', 'steps', 'guidance', 'size']
    .forEach((id) => $(id).addEventListener('change', persist));
  // Cmd/Ctrl+Enter in the prompt generates.
  $('prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doGenerate(); }
  });

  client.onReady(() => {
    status('ready — load a model to begin');
    // Auto-load if a model dir is remembered and looks absolute.
    const md = $('model-dir').value.trim();
    if (md) doLoad();
  });
}

init();
