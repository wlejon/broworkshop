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
    generate: (prompt, opts, controls, identityWeight, cb) =>
      send({ type: 'generate', prompt, opts, controls, identityWeight }, cb),
    anchor: (prompt, opts, cb) => send({ type: 'anchor', prompt, opts }, cb),
    clearAnchor: (cb) => send({ type: 'clearAnchor' }, cb || function () {}),
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

  // Identity anchor (Sana's reference-attention seam) + the live render loop.
  const anchor = { armed: false, els: null };
  let live = prefs.live || false;       // auto-render on slider drag
  // Latest-wins render scheduler: a slider change marks the desired quality
  // ('preview' = few steps, fast; 'full' = the steps setting). pump() fires one
  // generation at a time; whatever was requested while busy runs next (drags
  // coalesce — see the kokoro-lab pattern). 'full' always beats a queued 'preview'.
  let pendingQuality = null;
  const PREVIEW_STEPS = 8;

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
      live,
      anchorPrompt: $('anchor-prompt').value,
      identityWeight: anchor.els ? +anchor.els.weight.value : 0,
      axisSeq,
      axes: axes.map((a) => ({
        name: a.name, neg: a.neg, pos: a.pos, sep: a.sep,
        strength: +a.els.strength.value,
      })),
    });
  }

  // Current identity injection strength (0 when no anchor armed = a true no-op).
  function identityWeight() {
    return anchor.armed && anchor.els ? +anchor.els.weight.value : 0;
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
    range.addEventListener('input', () => {
      refresh(); persist(); if (live) schedule('preview');
    });
    range.addEventListener('change', () => { if (live) schedule('full'); });
    val.addEventListener('dblclick', () => {
      range.value = '0'; refresh(); persist(); if (live) schedule('full');
    });
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

  // Generation opts from the form. quality 'preview' caps steps for a fast,
  // coalesced live frame; 'full' uses the steps setting.
  function genOpts(quality) {
    const size = +$('size').value;
    const steps = +$('steps').value || 20;
    return {
      width: size, height: size,
      steps: quality === 'preview' ? Math.min(steps, PREVIEW_STEPS) : steps,
      guidanceScale: +$('guidance').value || 4.5,
      seed: +$('seed').value || 0,
      negativePrompt: $('neg-prompt').value.trim(),
    };
  }

  // Latest-wins render scheduler. schedule() records the desired quality; pump()
  // runs one generation at a time and, on completion, fires whatever was queued
  // meanwhile — so dragging a slider coalesces to its final value. A 'full'
  // request upgrades a queued 'preview', so releasing a slider lands a clean frame.
  function schedule(quality) {
    if (!loaded) return;
    if (quality === 'full' || pendingQuality !== 'full') pendingQuality = quality;
    pump();
  }

  function pump() {
    if (busy || !loaded || !pendingQuality) return;
    const quality = pendingQuality;
    pendingQuality = null;
    runGenerate(quality);
  }

  function runGenerate(quality) {
    const controls = collectControls();
    const iw = identityWeight();
    persist();
    setBusy(true);
    const bits = [];
    if (iw) bits.push('identity ' + iw.toFixed(1));
    const n = Object.keys(controls).length;
    if (n) bits.push(n + ' axis' + (n > 1 ? 'es' : ''));
    status((quality === 'preview' ? 'preview' : 'generating') +
           (bits.length ? ' · ' + bits.join(' · ') : ' · baseline') + '…');
    $('timing').textContent = '';
    client.generate($('prompt').value, genOpts(quality), controls, iw, (err, msg) => {
      setBusy(false);
      if (err) { status(String(err.message || err), 'err'); pump(); return; }
      drawBitmap(msg.bitmap, msg.width, msg.height);
      status(quality === 'preview' ? 'preview' : 'done', 'ok');
      $('timing').textContent =
        (msg.ms ? msg.ms + ' ms' : '') + (quality === 'preview' ? ' · preview' : '');
      pump();   // run whatever was requested while this was in flight
    });
  }

  // The Generate button always renders at full quality.
  function doGenerate() { schedule('full'); }

  // ── identity anchor ──────────────────────────────────────────────────────
  // Capture a reference identity from one full render of the anchor prompt, then
  // arm the seam. Subsequent generations inject it (scaled by the weight slider)
  // so the subject stays the same person while the prompt + axes drive expression.
  function doCaptureAnchor() {
    if (!loaded || busy) return;
    const prompt = $('anchor-prompt').value.trim();
    if (!prompt) { status('enter an anchor prompt first', 'err'); return; }
    persist();
    setBusy(true);
    status('capturing identity anchor — one full render…');
    client.anchor(prompt, genOpts('full'), (err, msg) => {
      setBusy(false);
      if (err) { status(String(err.message || err), 'err'); return; }
      drawAnchorThumb(msg.bitmap, msg.width, msg.height);
      anchor.armed = true;
      anchor.els.weight.disabled = false;
      anchor.els.clear.disabled = false;
      $('identity-host').classList.add('armed');
      refreshAnchorHint();
      status('identity anchor captured · ' + (msg.ms ? msg.ms + ' ms' : ''), 'ok');
    });
  }

  function doClearAnchor() {
    client.clearAnchor();
    anchor.armed = false;
    anchor.els.weight.disabled = true;
    anchor.els.clear.disabled = true;
    if (anchor.els.thumbCtx) {
      anchor.els.thumbCtx.clearRect(0, 0, anchor.els.thumb.width, anchor.els.thumb.height);
    }
    $('identity-host').classList.remove('armed');
    refreshAnchorHint();
    persist();
    status('identity anchor cleared', 'ok');
  }

  function drawAnchorThumb(bitmap, w, h) {
    const c = anchor.els.thumb;
    const ctx = anchor.els.thumbCtx;
    ctx.clearRect(0, 0, c.width, c.height);
    // contain the square render into the thumb box
    const s = Math.min(c.width / w, c.height / h);
    const dw = w * s, dh = h * s;
    ctx.drawImage(bitmap, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
  }

  function refreshAnchorHint() {
    $('identity-hint').textContent = anchor.armed
      ? 'weight = identity pull · push an expression axis and the face holds'
      : 'Capture a neutral portrait to hold its identity across edits.';
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

  // ── identity anchor wiring ───────────────────────────────────────────────
  anchor.els = {
    weight: $('identity-weight'),
    clear: $('btn-clear-anchor'),
    thumb: $('anchor-thumb'),
    thumbCtx: $('anchor-thumb').getContext('2d'),
  };
  if (prefs.anchorPrompt) $('anchor-prompt').value = prefs.anchorPrompt;
  if (prefs.identityWeight != null) anchor.els.weight.value = prefs.identityWeight;
  anchor.els.weight.disabled = true;   // until an anchor is captured
  anchor.els.clear.disabled = true;
  refreshAnchorHint();
  anchor.els.weight.addEventListener('input', () => {
    persist(); if (live) schedule('preview');
  });
  anchor.els.weight.addEventListener('change', () => { if (live) schedule('full'); });
  $('btn-capture-anchor').addEventListener('click', doCaptureAnchor);
  $('btn-clear-anchor').addEventListener('click', doClearAnchor);

  // ── live toggle ──────────────────────────────────────────────────────────
  const liveBox = $('live');
  liveBox.checked = live;
  liveBox.addEventListener('change', () => {
    live = liveBox.checked;
    persist();
    if (live) schedule('full');   // catch up to the current sliders
  });

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
   'axis-name', 'search-neg', 'search-pos', 'anchor-prompt']
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
