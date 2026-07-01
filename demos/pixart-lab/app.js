// PixArt Lab — main thread. Drives the PixArt-Sigma pipeline (in a worker) as a
// clean text-to-image bench: prompt + negative prompt, seed / steps / guidance /
// size, one-shot generate.
//
// PixArt-Sigma is auto-detected by brodiffusion from the diffusers model dir and
// runs the model-agnostic Pipeline — the same generate() surface SD / Sana use.
// There is no conditioning-control axis seam here (it is wired for Sana and SD1.5
// only, not PixArt's T5 branch).

import { installSystemMenu } from "/lib/system-menu.js";

function $(id) { return document.getElementById(id); }

// ── persisted UI state ─────────────────────────────────────────────────────
const STORE_KEY = 'pixart-lab.v1';
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
  const worker = new Worker('lab/pixart-worker.js');
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
    generate: (prompt, opts, cb) => send({ type: 'generate', prompt, opts }, cb),
  };
}

function init() {
  const prefs = loadPrefs();
  const client = createClient();

  let loaded = false;
  let busy = false;

  // Generation defaults (shown as hints; the reset button restores them). PixArt-
  // Sigma's standard recipe: 20 steps, guidance 4.5, 1024² native resolution.
  const DEFAULTS = { seed: 0, steps: 20, guidance: 4.5, size: 1024 };
  const MAXCHARS = 1000;

  const canvas = $('view');
  const cctx = canvas.getContext('2d');

  // restore persisted fields
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
    $('btn-load').disabled = b;
  }

  function doLoad() {
    const modelDir = $('model-dir').value.trim();
    if (!modelDir) { status('set a PixArt directory first', 'err'); return; }
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
    });
  }

  function doGenerate() {
    if (!loaded || busy) return;
    const size = +$('size').value;
    const opts = {
      width: size, height: size,
      steps: +$('steps').value || 20,
      guidanceScale: +$('guidance').value || 4.5,
      seed: +$('seed').value || 0,
      negativePrompt: $('neg-prompt').value.trim(),
    };
    persist();
    setBusy(true);
    status('generating…');
    $('timing').textContent = '';
    client.generate($('prompt').value, opts, (err, msg) => {
      setBusy(false);
      if (err) { status(String(err.message || err), 'err'); return; }
      drawBitmap(msg.bitmap, msg.width, msg.height);
      status('done', 'ok');
      $('timing').textContent = msg.ms ? (msg.ms + ' ms') : '';
    });
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
  $('btn-reset-settings').addEventListener('click', () => {
    $('seed').value = DEFAULTS.seed;
    $('steps').value = DEFAULTS.steps;
    $('guidance').value = DEFAULTS.guidance;
    $('size').value = String(DEFAULTS.size);
    persist();
  });
  $('btn-browse-model').addEventListener('click', () => {
    const d = window.showOpenFolderDialog
      ? window.showOpenFolderDialog($('model-dir').value.trim()) : null;
    if (d) { $('model-dir').value = d; persist(); }
  });
  ['model-dir', 'prompt', 'neg-prompt', 'seed', 'steps', 'guidance', 'size']
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

installSystemMenu();
init();
