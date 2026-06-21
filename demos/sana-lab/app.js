// Sana Lab — main thread. Drives the Sana pipeline (in a worker) and lets you
// build any number of control axes from words.
//
// Each axis is a direction in Sana's conditioning space, searched for live from
// two word sets: a "from" concept (A) and a "to" concept (B). The worker encodes
// each phrase through Gemma, takes the diff-of-means, MASSIVE-zeros and unit-
// normalizes it, and registers it as a named control axis. Each axis gets a
// strength slider (value = injection norm, A↓ / B↑); Generate applies all the
// active axes at once. At strength 0 an axis is a true no-op.

function $(id) { return document.getElementById(id); }

// ── persisted UI state ─────────────────────────────────────────────────────
const STORE_KEY = 'sana-lab.v2';
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
    load: (modelDir, cb) => send({ type: 'load', modelDir }, cb),
    generate: (prompt, opts, controls, cb) =>
      send({ type: 'generate', prompt, opts, controls }, cb),
    search: (neg, pos, name, cb) => send({ type: 'search', neg, pos, name }, cb),
    remove: (name, cb) => send({ type: 'remove', name }, cb || function () {}),
  };
}

// Split a textarea of words/phrases into a clean list (newline- or comma-
// separated; blanks dropped). Each item is one phrase the encoder sees.
function splitPhrases(text) {
  return (text || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
}

function init() {
  const prefs = loadPrefs();
  const client = createClient();

  let loaded = false;
  let busy = false;
  let axisSeq = prefs.axisSeq || 0;     // monotonic id for unique worker names
  const axes = [];                      // { wname, name, neg, pos, sep, els }

  // Generation defaults (shown as hints; the reset button restores them). Sana's
  // standard recipe: 20 steps, guidance 4.5, 1024² native resolution.
  const DEFAULTS = { seed: 0, steps: 20, guidance: 4.5, size: 1024 };
  // Generous character cap for the prompt fields — comfortably under Sana's
  // 300-token budget for typical text (the model truncates at the token level).
  const MAXCHARS = 1000;

  const canvas = $('view');
  const cctx = canvas.getContext('2d');

  // restore persisted text fields
  if (prefs.modelDir) $('model-dir').value = prefs.modelDir;
  if (prefs.prompt)   $('prompt').value = prefs.prompt;
  if (prefs.negPrompt != null) $('neg-prompt').value = prefs.negPrompt;
  ['seed', 'steps', 'guidance', 'size'].forEach((k) => {
    if (prefs[k] != null) $(k).value = prefs[k];
  });

  function persist() {
    savePrefs({
      modelDir: $('model-dir').value,
      prompt: $('prompt').value,
      negPrompt: $('neg-prompt').value,
      seed: $('seed').value, steps: $('steps').value,
      guidance: $('guidance').value, size: $('size').value,
      axisSeq,
      axes: axes.map((a) => ({
        name: a.name, neg: a.neg, pos: a.pos, sep: a.sep,
        strength: +a.els.strength.value,
      })),
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

  // ── axis rows ──────────────────────────────────────────────────────────
  function refreshHint() {
    $('ctl-hint').textContent = axes.length
      ? 'strength = injection norm · A↓ / B↑ · 0 = no change'
      : (loaded ? 'Add an axis from two word sets.'
                : 'Load a model, then add an axis from two word sets.');
  }

  // Build the UI row for an already-registered axis and track it.
  function addAxisRow(def) {
    const card = document.createElement('div');
    card.className = 'axis-card';

    const head = document.createElement('div');
    head.className = 'axis-head';
    const nm = document.createElement('span');
    nm.className = 'axis-name';
    nm.textContent = def.name;
    nm.title = 'A: ' + def.neg.join(', ') + '  ↔  B: ' + def.pos.join(', ') +
               '  · separation ' + def.sep.toFixed(2);
    const del = document.createElement('button');
    del.className = 'link axis-del';
    del.textContent = '✕';
    del.title = 'Remove this axis';
    head.appendChild(nm);
    head.appendChild(del);

    const row = document.createElement('div');
    row.className = 'ctl-row';
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '-25'; range.max = '25'; range.step = '0.5';
    range.value = String(def.strength || 0);
    const val = document.createElement('span');
    val.className = 'ctl-val';
    function refresh() {
      const v = +range.value;
      val.textContent = (v > 0 ? '+' : '') + v;
      val.classList.toggle('off', v === 0);
    }
    range.addEventListener('input', () => { refresh(); persist(); });
    val.addEventListener('dblclick', () => { range.value = '0'; refresh(); persist(); });
    refresh();
    row.appendChild(range);
    row.appendChild(val);

    card.appendChild(head);
    card.appendChild(row);
    $('axes-host').appendChild(card);

    const rec = { wname: def.wname, name: def.name, neg: def.neg, pos: def.pos,
                  sep: def.sep, els: { card, strength: range, val } };
    axes.push(rec);

    del.addEventListener('click', () => {
      client.remove(rec.wname);
      const i = axes.indexOf(rec);
      if (i >= 0) axes.splice(i, 1);
      card.remove();
      refreshHint();
      persist();
    });
    refreshHint();
    return rec;
  }

  function collectControls() {
    const out = {};
    for (const a of axes) {
      const v = +a.els.strength.value;
      if (v) out[a.wname] = v;
    }
    return out;
  }

  // ── render ─────────────────────────────────────────────────────────────
  function drawBitmap(bitmap, w, h) {
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    cctx.drawImage(bitmap, 0, 0);
    $('view-hint').style.display = 'none';
  }

  // ── actions ────────────────────────────────────────────────────────────
  function setBusy(b) {
    busy = b;
    $('btn-generate').disabled = b || !loaded;
    $('btn-build-axis').disabled = b || !loaded;
    $('btn-load').disabled = b;
  }

  function doLoad() {
    const modelDir = $('model-dir').value.trim();
    if (!modelDir) { status('set a Sana directory first', 'err'); return; }
    persist();
    setBusy(true);
    loaded = false;
    backend('loading…');
    status('loading model — this reads multi-GB weights, give it a moment');
    client.load(modelDir, (err, msg) => {
      setBusy(false);
      if (err) { backend('error', 'err'); status(String(err.message || err), 'err'); return; }
      loaded = true;
      backend(msg.backend === 'cpu' ? 'CPU' : (msg.backend || 'gpu').toUpperCase(),
              msg.backend === 'cpu' ? 'warn' : 'ok');
      const cls = (msg.config && msg.config.modelClass) || 'model';
      status(cls + ' ready', 'ok');
      $('btn-generate').disabled = false;
      $('btn-build-axis').disabled = false;
      refreshHint();
      rebuildSavedAxes();   // re-register any axes from a prior session
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
      negativePrompt: $('neg-prompt').value.trim(),
    };
    const controls = collectControls();
    persist();
    setBusy(true);
    const n = Object.keys(controls).length;
    status('generating' + (n ? ' · ' + n + ' axis' + (n > 1 ? 'es' : '') + ' active' : ' · baseline') + '…');
    $('timing').textContent = '';
    client.generate($('prompt').value, opts, controls, (err, msg) => {
      setBusy(false);
      if (err) { status(String(err.message || err), 'err'); return; }
      drawBitmap(msg.bitmap, msg.width, msg.height);
      status('done', 'ok');
      $('timing').textContent = msg.ms ? (msg.ms + ' ms') : '';
    });
  }

  // Build a new axis from the form's two word sets.
  function doBuildAxis() {
    if (!loaded || busy) return;
    const neg = splitPhrases($('search-neg').value);
    const pos = splitPhrases($('search-pos').value);
    if (!neg.length || !pos.length) {
      status('enter at least one word in each set', 'err'); return;
    }
    const name = $('axis-name').value.trim() ||
                 (neg[0] + ' → ' + pos[0]);
    const wname = 'ax' + (axisSeq++);
    persist();
    setBusy(true);
    status('building axis — encoding ' + (neg.length + pos.length) + ' phrases…');
    client.search(neg, pos, wname, (err, msg) => {
      setBusy(false);
      if (err) { status(String(err.message || err), 'err'); return; }
      addAxisRow({ wname, name, neg, pos, sep: msg.sep, strength: 0 });
      // clear the form for the next axis (keep words handy is less useful than a
      // clean slate once an axis is captured)
      $('axis-name').value = '';
      $('search-neg').value = '';
      $('search-pos').value = '';
      status('axis “' + name + '” added · separation ' + msg.sep.toFixed(2), 'ok');
      persist();
    });
  }

  // Re-register axes saved from a prior session (sequentially — the client
  // serializes requests). Rows appear as each is rebuilt.
  function rebuildSavedAxes() {
    const defs = Array.isArray(prefs.axes) ? prefs.axes.slice() : [];
    let i = 0;
    (function next() {
      if (i >= defs.length) return;
      const d = defs[i++];
      if (!d || !d.neg || !d.pos) { next(); return; }
      const wname = 'ax' + (axisSeq++);
      client.search(d.neg, d.pos, wname, (err, msg) => {
        if (!err) {
          addAxisRow({ wname, name: d.name || (d.neg[0] + ' → ' + d.pos[0]),
                       neg: d.neg, pos: d.pos, sep: msg.sep,
                       strength: +d.strength || 0 });
          persist();
        }
        next();
      });
    })();
  }

  // character counters (entered / max) for the prompt fields
  function bindCounter(taId, countId) {
    const ta = $(taId), out = $(countId);
    function upd() {
      const n = ta.value.length;
      out.textContent = n + ' / ' + MAXCHARS;
      out.classList.toggle('warn', n >= MAXCHARS);
    }
    ta.addEventListener('input', upd);
    upd();
  }
  bindCounter('prompt', 'prompt-count');
  bindCounter('neg-prompt', 'neg-count');

  // ── wire up ──────────────────────────────────────────────────────────────
  $('btn-load').addEventListener('click', doLoad);
  $('btn-generate').addEventListener('click', doGenerate);
  $('btn-build-axis').addEventListener('click', doBuildAxis);
  $('btn-reset-settings').addEventListener('click', () => {
    $('seed').value = DEFAULTS.seed;
    $('steps').value = DEFAULTS.steps;
    $('guidance').value = DEFAULTS.guidance;
    $('size').value = String(DEFAULTS.size);
    persist();
  });
  $('btn-reset-ctl').addEventListener('click', () => {
    for (const a of axes) { a.els.strength.value = '0'; a.els.strength.dispatchEvent(new Event('input')); }
    persist();
  });
  $('btn-browse-model').addEventListener('click', () => {
    const d = window.showOpenFolderDialog
      ? window.showOpenFolderDialog($('model-dir').value.trim()) : null;
    if (d) { $('model-dir').value = d; persist(); }
  });
  ['model-dir', 'prompt', 'neg-prompt', 'seed', 'steps', 'guidance', 'size',
   'axis-name', 'search-neg', 'search-pos']
    .forEach((id) => $(id).addEventListener('change', persist));
  // Cmd/Ctrl+Enter in the prompt generates.
  $('prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doGenerate(); }
  });

  client.onReady(() => {
    status('ready — load a model to begin');
    if ($('model-dir').value.trim()) doLoad();
  });
}

init();
