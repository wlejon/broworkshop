// Krea 2 Lab — main thread. Drives the Krea 2 Turbo pipeline (in a worker,
// lab/krea2-worker.js) as a comprehensive showcase of every research-hook
// control krea-research (../krea-research) discovered: AdaLN dials, the deep-
// tap band dial, an 18-axis conditioning-space control bank (+ user-minted
// axes), attention-gate scale/mask, per-region spatial-paint compositing,
// and the expression panel — contextual per-token fields (sana-research's
// dictionary.py technique on Krea 2's taps seam): named emotion sliders plus
// a custom-word slider, one field per render, exclusive by design.
// The spectrum panel sits on top of that: the four model-nominated affect
// axes (valence/arousal/hostility/surprise sliders) from the round-6
// probe's SVD of ~100 farmed word fields — minted per prompt in the worker,
// and stackable with each other and the expression word.
// Plus LoRA adapters (brodiffusion's Krea 2 runtime-adapter path): attach
// .safetensors LoRAs, rescale each live (strengths ride every generate as
// `loraScales`), remove without reloading; the list persists and re-applies
// on every model load.
//
// Krea 2 is a 12.9B flow-matching DiT conditioned on tapped Qwen3-VL-4B hidden
// states, decoded by the Qwen-Image VAE (vae_scale_factor() == 8, patch_size
// == 2 — see brodiffusion/include/brodiffusion/pipeline.h and
// weights/krea-2-turbo/model_index.json). Every technique's native call shape
// is already handled by the worker; this file is the DOM + message wiring.

import { installSystemMenu } from "/lib/system-menu.js";

function $(id) { return document.getElementById(id); }

// Latent geometry constants (see krea2-worker.js's header + brodiffusion's
// Pipeline::vae_scale_factor() / Krea2Denoiser's patch_size==2 requirement).
// H_lat = height / VAE_SCALE is what PipelineState.latentHeight/latentWidth
// report (the resolution spatialRender's maskData must match). The DiT's
// token grid — and krea2Gates()'s image-row count — is patchified one more
// level down: img_len == (H_lat/PATCH) * (W_lat/PATCH).
const VAE_SCALE = 8;
const PATCH = 2;

// ── persisted UI state ─────────────────────────────────────────────────────
const STORE_KEY = 'krea2-lab.v1';
function loadPrefs() {
  try { return JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}'); }
  catch (e) { return {}; }
}
function savePrefs(p) {
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(p)); }
  catch (e) { /* storage unavailable — non-fatal */ }
}

// Minted axes persist as their actual unit direction (6144 float32, base64 —
// ~32KB per axis). Restoring is then a cheap registerAxis instead of a full
// re-mint, and axes minted from history renders survive restarts too.
function f32ToB64(f) {
  const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  let s = '';
  for (let i = 0; i < u.length; i += 8192) {
    s += String.fromCharCode.apply(null, u.subarray(i, Math.min(i + 8192, u.length)));
  }
  return btoa(s);
}
function b64ToF32(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Float32Array(u.buffer);
}

// ── worker client (one outstanding request at a time) ──────────────────────
function createClient() {
  const worker = new Worker('lab/krea2-worker.js');
  let pending = null, readyCb = null, ready = false, progressCb = null;

  worker.onmessage = function (e) {
    const msg = e.data || {};
    if (msg.type === 'ready') {
      ready = true;
      if (readyCb) { const r = readyCb; readyCb = null; r(); }
      return;
    }
    // Interim progress — reported mid-request, must NOT consume the pending
    // response callback.
    if (msg.type === 'mintProgress') {
      if (progressCb) progressCb(msg);
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
    onProgress: (cb) => { progressCb = cb; },
    send: send,
  };
}

// ── image file -> pixels (synchronous decode, matches vision-lab/triposplat) ──
const APP_BASE = (function () {
  try { return require('fs').realpathSync('.'); } catch (e) { return ''; }
})();
function isAbsolutePath(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.charAt(0) === '/' || p.charAt(0) === '\\';
}
function appPath(p) {
  if (!p || isAbsolutePath(p) || !APP_BASE) return p;
  return APP_BASE + '/' + p;
}
function fileToImageData(path) {
  const img = new Image();
  img.src = appPath(path);                          // sync decode + onload
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) throw new Error('could not decode image: ' + path);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  return cx.getImageData(0, 0, w, h);
}
// Cap the long side at maxSide (Krea 2's vision tower resizes internally —
// this just keeps the upload/JS-side conversion small).
function capLongSide(imageData, maxSide) {
  const w = imageData.width, h = imageData.height;
  const long = Math.max(w, h);
  if (long <= maxSide) return imageData;
  const scale = maxSide / long;
  const nw = Math.max(1, Math.round(w * scale)), nh = Math.max(1, Math.round(h * scale));
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  src.getContext('2d').putImageData(imageData, 0, 0);
  const dst = document.createElement('canvas');
  dst.width = nw; dst.height = nh;
  dst.getContext('2d').drawImage(src, 0, 0, nw, nh);
  return dst.getContext('2d').getImageData(0, 0, nw, nh);
}
// HWC RGBA Uint8ClampedArray -> CHW FP32 [0,1] (krea2EncodeImagePrompt's shape).
function toChwFp32(imageData) {
  const W = imageData.width, H = imageData.height, data = imageData.data;
  const out = new Float32Array(3 * H * W);
  const plane = H * W;
  for (let i = 0; i < plane; i++) {
    out[0 * plane + i] = data[i * 4 + 0] / 255;
    out[1 * plane + i] = data[i * 4 + 1] / 255;
    out[2 * plane + i] = data[i * 4 + 2] / 255;
  }
  return { pixels: out, H: H, W: W };
}
// Same tensor a file would produce, but sourced from an already-rendered canvas
// (the history thumbnails hold full-resolution pixels).
function tensorFromCanvas(cnv) {
  const id = cnv.getContext('2d').getImageData(0, 0, cnv.width, cnv.height);
  return toChwFp32(capLongSide(id, 1024));
}
// Paint the chosen image-pair source into its preview box. Draws into a real
// <canvas> child (faithful in bro) rather than a CSS background-image from a
// data:/file: URL, which didn't render — the box stayed black. `src` is a
// canvas or ImageData; it's letterboxed into a small backing store keyed to the
// box (`.imgpick-thumb` is square via aspect-ratio; object-fit:contain fits it).
function paintMintThumb(which, src, sw, sh) {
  const thumb = $('mint-' + which + '-thumb');
  let cv = thumb.querySelector('canvas');
  if (!cv) { cv = document.createElement('canvas'); thumb.appendChild(cv); }
  const BOX = 160;
  const scale = Math.min(BOX / sw, BOX / sh, 1);
  cv.width = Math.max(1, Math.round(sw * scale));
  cv.height = Math.max(1, Math.round(sh * scale));
  const cx = cv.getContext('2d');
  cx.clearRect(0, 0, cv.width, cv.height);
  if (src instanceof ImageData) {
    const tmp = document.createElement('canvas');
    tmp.width = sw; tmp.height = sh;
    tmp.getContext('2d').putImageData(src, 0, 0);
    cx.drawImage(tmp, 0, 0, cv.width, cv.height);
  } else {
    cx.drawImage(src, 0, 0, cv.width, cv.height);
  }
  thumb.classList.add('filled');
}

function init() {
  const prefs = loadPrefs();
  const client = createClient();

  let loaded = false;
  let busy = false;
  let live = prefs.live != null ? prefs.live : true;

  // Generation defaults (shown as hints; the reset button restores them).
  // steps 8 / guidance 1.0 are Krea 2 Turbo's own recipe: ui.py's dial_column()
  // radios steps at [4,8,12] (default 8); guidance 1.0 disables CFG, matching
  // Turbo's intended no-CFG mode (see brodiffusion/include/brodiffusion/
  // dit/krea2.h's CFG-convention comment: Raw g=4.5 -> guidance 5.5, Turbo
  // g=0 -> guidance 1.0).
  const DEFAULTS = { seed: 0, steps: 8, guidance: 1.0, width: 1024, height: 1024 };
  const SIZE_MIN = 256, SIZE_MAX = 2048, SIZE_MULT = 16;   // Krea 2: /8 VAE × /2 patch = /16
  const roundSize = (n) => Math.max(SIZE_MIN, Math.min(SIZE_MAX,
    Math.round((+n || DEFAULTS.width) / SIZE_MULT) * SIZE_MULT));
  const MAXCHARS = 1000;
  const PREVIEW_STEPS = 4;
  const PREVIEW_SIZE = 512;

  const canvas = $('view');
  const cctx = canvas.getContext('2d');

  // ── axis dictionary + minted axes ─────────────────────────────────────
  let axesMeta = {};          // { key: {category,label,order} } from assets/axes_meta.json
  let coreAxisEls = {};       // { key: {range, val} }
  let mintedAxes = [];        // [{name, kind:'text'|'image', pos, neg, aPath, bPath, consistency}]
  // Per-minted-axis "use" strength (what its slider sits at; 0 = off). Keyed by
  // axis name so it survives re-rendering the manager list and deleting other
  // axes. Migrated from the old 3-slot model's {name,strength} entries.
  let axisStrengths = {};
  if (prefs.axisStrengths && typeof prefs.axisStrengths === 'object') {
    axisStrengths = Object.assign({}, prefs.axisStrengths);
  } else if (Array.isArray(prefs.slots)) {
    prefs.slots.forEach((s) => { if (s && s.name) axisStrengths[s.name] = +s.strength || 0; });
  }
  let mintImgA = null, mintImgB = null;   // {tensor:{pixels,H,W}, path}
  // Which render (history id) currently fills each slot, so the Image Axis
  // gallery can badge the picked cells. null = a browsed file (no history id).
  let mintSelId = { a: null, b: null };

  // ── expression field state ─────────────────────────────────────────────
  // The contextual per-token field (worker's `expression` message field):
  // splice the adjective into the live prompt, diff against a mask-aligned
  // neutral, extrapolate. One field per render (the splice fixes the
  // tokenization), so the sliders are EXCLUSIVE — moving one zeroes the rest.
  // alpha 1 == what saying the word does; identity drifts at the top end.
  const EXPRESSIONS = [
    { key: 'happiness', label: 'happiness', adj: 'joyfully smiling' },
    { key: 'laughter',  label: 'laughter',  adj: 'laughing' },
    { key: 'sadness',   label: 'sadness',   adj: 'sad' },
    { key: 'crying',    label: 'crying',    adj: 'crying' },
    { key: 'anger',     label: 'anger',     adj: 'furious' },
    { key: 'fear',      label: 'fear',      adj: 'terrified' },
    { key: 'surprise',  label: 'surprise',  adj: 'astonished' },
    { key: 'disgust',   label: 'disgust',   adj: 'disgusted' },
    { key: 'smirk',     label: 'smirk',     adj: 'smirking' },
    { key: 'wink',      label: 'wink',      adj: 'winking' },
  ];
  let exprStrengths = (prefs.exprStrengths && typeof prefs.exprStrengths === 'object')
    ? Object.assign({}, prefs.exprStrengths) : {};
  let exprRows = {};   // key -> {range, refresh} incl. 'custom'

  // ── spectrum state (model-nominated affect axes; worker mints per prompt) ─
  const SPECTRUM_KEYS = ['valence', 'arousal', 'hostility', 'surprise'];
  const SPEC_RANGE = 3;
  const specState = { valence: 0, arousal: 0, hostility: 0, surprise: 0 };
  if (prefs.specState && typeof prefs.specState === 'object') {
    SPECTRUM_KEYS.forEach((k) => {
      const v = +prefs.specState[k] || 0;
      specState[k] = Math.max(-SPEC_RANGE, Math.min(SPEC_RANGE, v));
    });
  }
  let specRows = {};   // valence/arousal/hostility/surprise -> {range, refresh}

  // ── LoRA adapters ──────────────────────────────────────────────────────
  // {path, scale} per applied LoRA, in pipeline group order. This list is
  // authoritative (persisted here); the worker rebuilds the pipeline's
  // runtime groups from it after every model load. Strengths ride each
  // generate message as `loraScales` (synced worker-side per generation),
  // so a strength slider needs no worker round-trip of its own.
  let loras = Array.isArray(prefs.loras)
    ? prefs.loras.filter((l) => l && l.path)
        .map((l) => ({ path: l.path, scale: typeof l.scale === 'number' ? l.scale : 1 }))
    : [];

  // ── gate paint state ───────────────────────────────────────────────────
  let gateCapture = null;     // {rows,cols,text_seq,img_len,gridW,gridH,heatNorm,msgUsed}
  let gateMaskValues = null;  // Float32Array(gridW*gridH), 1.0 = untouched
  let gateDown = false;

  // ── spatial paint state ─────────────────────────────────────────────────
  let spBaseBitmap = null, spBaseOpts = null, spBasePrompt = '';
  let spMaskCanvas = null;    // offscreen, full render resolution, white=painted
  let spDown = false;

  // ── seed randomize + render history ──────────────────────────────────────
  const SEED_MAX = 2147483647;   // int32 range — Krea 2's Philox seed
  const SEED_HISTORY_MAX = 10;   // "recent seeds" dropdown depth
  const HISTORY_MAX = 24;        // rendered-image thumbnails kept on the right
  let seedHistory = Array.isArray(prefs.seedHistory) ? prefs.seedHistory.slice(0, SEED_HISTORY_MAX) : [];
  let history = [];              // [{id, canvas, w, h, seed, steps, width, height}], newest first
  let histSeq = 0;               // stable per-entry id (history index shifts as it grows)

  // ── main-canvas viewport (absolute-scale zoom + pan) ──────────────────────
  // viewScale is CSS px per image px, so 1.0 is a true 100% (1:1) view. A fresh
  // image opens at native size unless it's bigger than the stage, in which case
  // it opens fit-to-stage (defaultScale). You can zoom out only to that default
  // (no shrinking-image-with-black-margin) and in well past 100%.
  let viewW = 512, viewH = 512;  // current image backing dims
  let viewScale = 1;             // absolute display scale (1 = 100%, native pixels)
  let viewUserZoomed = false;    // true once the user wheel/dbl-clicks off the default
  let viewPanX = 0, viewPanY = 0;
  let zoomHideTimer = null;

  // restore persisted text fields
  if (prefs.modelDir) $('model-dir').value = prefs.modelDir;
  if (prefs.prompt)   $('prompt').value = prefs.prompt;
  if (prefs.negPrompt != null) $('neg-prompt').value = prefs.negPrompt;
  ['seed', 'steps', 'guidance'].forEach((k) => {
    if (prefs[k] != null) $(k).value = prefs[k];
  });
  // width/height replaced the old square `size` select — migrate legacy prefs.
  const legacySize = prefs.size != null ? +prefs.size : null;
  if (prefs.width != null) $('width').value = prefs.width; else if (legacySize) $('width').value = legacySize;
  if (prefs.height != null) $('height').value = prefs.height; else if (legacySize) $('height').value = legacySize;
  if (prefs.dialPregate != null) $('dial-pregate').value = prefs.dialPregate;
  if (prefs.dialPrescale != null) $('dial-prescale').value = prefs.dialPrescale;
  if (prefs.band != null) $('band').value = prefs.band;
  if (prefs.gateTxt != null) $('gate-txt').value = prefs.gateTxt;
  if (prefs.gateImg != null) $('gate-img').value = prefs.gateImg;
  if (prefs.randSeed != null) $('rand-seed').checked = !!prefs.randSeed;
  if (prefs.spPrompt) $('sp-prompt').value = prefs.spPrompt;
  if (prefs.spSeed != null) $('sp-seed').value = prefs.spSeed;
  if (prefs.spSteps != null) $('sp-steps').value = prefs.spSteps;
  if (prefs.spStrength != null) $('sp-strength').value = prefs.spStrength;
  $('live').checked = live;

  function persist() {
    const axisBank = {};
    for (const k in coreAxisEls) if (coreAxisEls.hasOwnProperty(k)) axisBank[k] = +coreAxisEls[k].range.value;
    savePrefs({
      modelDir: $('model-dir').value,
      prompt: $('prompt').value,
      negPrompt: $('neg-prompt').value,
      seed: $('seed').value, steps: $('steps').value,
      guidance: $('guidance').value,
      width: $('width').value, height: $('height').value,
      live: live,
      dialPregate: $('dial-pregate').value, dialPrescale: $('dial-prescale').value,
      band: $('band').value,
      gateTxt: $('gate-txt').value, gateImg: $('gate-img').value,
      axisBank: axisBank,
      axisStrengths: axisStrengths,
      exprStrengths: exprStrengths,
      exprCustomAdj: $('expr-custom-adj').value,
      specState: specState,
      mintedAxes: mintedAxes.map((m) => ({
        name: m.name, kind: m.kind, pos: m.pos, neg: m.neg, aPath: m.aPath, bPath: m.bPath,
        dir: m.dir, consistency: m.consistency,
      })),
      spPrompt: $('sp-prompt').value, spSeed: $('sp-seed').value, spSteps: $('sp-steps').value,
      spAxis: $('sp-axis').value, spStrength: $('sp-strength').value,
      randSeed: $('rand-seed').checked, seedHistory: seedHistory,
      loras: loras.map((l) => ({ path: l.path, scale: +l.scale })),
    });
  }

  function status(msg, kind) {
    const el = $('status-text'); el.textContent = msg; el.className = kind || '';
  }
  function gateStatus(msg, kind) {
    const el = $('gate-status-text'); el.textContent = msg; el.className = kind || '';
  }
  function spStatus(msg, kind) {
    const el = $('sp-status-text'); el.textContent = msg; el.className = kind || '';
  }
  function backend(text, kind) {
    const el = $('backend'); el.textContent = text; el.className = 'badge' + (kind ? ' ' + kind : '');
  }

  // ── tabs ─────────────────────────────────────────────────────────────────
  function switchTab(name) {
    document.querySelectorAll('.tabbtn').forEach((b) =>
      b.classList.toggle('active', b.getAttribute('data-tab') === name));
    document.querySelectorAll('.tabpanel').forEach((p) =>
      p.classList.toggle('active', p.id === 'tab-' + name));
  }
  document.querySelectorAll('.tabbtn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
  });

  // ── axis bank UI (built once from assets/axes_meta.json) ───────────────
  function buildAxisBank(meta) {
    const names = Object.keys(meta).sort((a, b) => meta[a].order - meta[b].order);
    const cats = []; const byCat = {};
    names.forEach((k) => {
      const cat = meta[k].category;
      if (!byCat[cat]) { byCat[cat] = []; cats.push(cat); }
      byCat[cat].push(k);
    });
    const host = $('axis-categories');
    host.innerHTML = '';
    coreAxisEls = {};
    cats.forEach((cat) => {
      const det = document.createElement('details');
      det.className = 'axis-cat-group';
      // details.open has no IDL reflection binding in bro's DOM — the CSS rule
      // (details:not([open]) > *:not(summary)) reads the attribute, so set that
      // directly. Matches krea-research ui.py's default-open accordion.
      if (cat === 'Color') det.setAttribute('open', '');
      const sum = document.createElement('summary');
      sum.className = 'ctl-cat'; sum.textContent = cat;
      det.appendChild(sum);
      const body = document.createElement('div');
      body.className = 'axis-cat-body';
      byCat[cat].forEach((k) => { body.appendChild(buildAxisRow(k, meta[k].label)); });
      det.appendChild(body);
      host.appendChild(det);
    });
  }
  // ── press-and-hold ± steppers ──────────────────────────────────────────
  // A single click nudges a range input by its own step (0.01 — the finest,
  // exact increase a slider drag can't reliably hit); holding starts fine and
  // ramps up to a fast steady sweep. onStep fires after every value change
  // (mirrors the slider's 'input'); onSettle fires once on release (mirrors
  // 'change'), so the live-preview / full-render cadence matches dragging.
  function makeStepper(range, sign, onStep, onSettle) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ctl-step';
    btn.textContent = sign > 0 ? '+' : '−';   // real minus, not hyphen
    btn.title = (sign > 0 ? 'increase' : 'decrease') + ' — click for one fine step, hold to ramp';
    const step = +range.step || 0.01;
    const lo = +range.min, hi = +range.max;
    let timer = 0, ticks = 0, moved = false;
    function nudge(mult) {
      let v = +range.value + sign * step * mult;
      v = Math.max(lo, Math.min(hi, v));
      v = Math.round(v / step) * step;             // snap to grid, kill fp drift
      if (v === +range.value) return;
      range.value = String(v);
      moved = true;
      onStep();
    }
    function stop() {
      if (!timer) return;
      clearInterval(timer); timer = 0; ticks = 0;
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('mouseup', stop);
      if (moved) { moved = false; if (onSettle) onSettle(); }
    }
    function start(e) {
      if (e && e.preventDefault) e.preventDefault();
      if (timer) return;
      moved = false;
      nudge(1);                                    // one fine step on press
      ticks = 0;
      timer = setInterval(() => {
        ticks++;
        // fine for the first ~0.3s, then accelerate toward a fast sweep
        const mult = ticks < 7 ? 1 : Math.min(25, 1 + (ticks - 6) * 0.7);
        nudge(mult);
      }, 45);
      // End the hold on release ANYWHERE — pointer/mouse up bubble to window,
      // so this fires even if the cursor drifts off the tiny button mid-hold.
      window.addEventListener('pointerup', stop);
      window.addEventListener('mouseup', stop);
    }
    // pointerdown is the primary path; mousedown is a fallback for any build
    // that doesn't synthesize pointer events (start() guards against firing
    // twice for the same press via the `timer` check).
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('mousedown', start);
    return btn;
  }
  function buildAxisRow(key, label) {
    const row = document.createElement('div');
    row.className = 'ctl-row stepped';
    const nm = document.createElement('span');
    nm.className = 'ctl-name'; nm.textContent = label; nm.title = key;
    const range = document.createElement('input');
    range.type = 'range'; range.min = '-6'; range.max = '6'; range.step = '0.01'; range.value = '0';
    const val = document.createElement('span');
    val.className = 'ctl-val off'; val.textContent = '0';
    function refresh() {
      const v = +range.value;
      val.textContent = (v > 0 ? '+' : '') + v.toFixed(2);
      val.classList.toggle('off', v === 0);
    }
    range.addEventListener('input', () => { refresh(); persist(); if (live) schedule('preview'); });
    range.addEventListener('change', () => { if (live) schedule('full'); });
    val.addEventListener('dblclick', () => { range.value = '0'; refresh(); persist(); if (live) schedule('full'); });
    const onStep = () => { refresh(); persist(); if (live) schedule('preview'); };
    const onSettle = () => { if (live) schedule('full'); };
    const minus = makeStepper(range, -1, onStep, onSettle);
    const plus = makeStepper(range, +1, onStep, onSettle);
    row.appendChild(nm); row.appendChild(minus); row.appendChild(range); row.appendChild(plus); row.appendChild(val);
    coreAxisEls[key] = { range: range, val: val };
    return row;
  }

  // ── "your axes" — a managed list of every minted axis ──────────────────
  // Each minted axis is its own row: name (click to inspect), a use-strength
  // slider (0 = off), and a delete button. This replaces the old 3-slot picker
  // so an axis can be turned off (slider to 0) or removed entirely at a glance —
  // and there's no artificial 3-at-once cap.
  function renderAxisManager() {
    const host = $('user-slots');
    host.innerHTML = '';
    if (mintedAxes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'axis-mine-empty';
      empty.textContent = 'No minted axes yet — mint one below to add your own control.';
      host.appendChild(empty);
      refreshSpAxisOptions();
      return;
    }
    mintedAxes.forEach((m) => {
      const row = document.createElement('div');
      row.className = 'axis-mine-row';
      const nm = document.createElement('button');
      nm.type = 'button'; nm.className = 'axis-mine-name';
      nm.textContent = m.name;
      nm.title = 'inspect what "' + m.name + '" is made of';
      nm.addEventListener('click', () => showAxisInspector(m));
      const range = document.createElement('input');
      range.type = 'range'; range.min = '-6'; range.max = '6'; range.step = '0.01';
      range.value = String(+axisStrengths[m.name] || 0);
      const val = document.createElement('span');
      val.className = 'ctl-val';
      function refresh() {
        const v = +range.value;
        val.textContent = (v > 0 ? '+' : '') + v.toFixed(2);
        val.classList.toggle('off', v === 0);
      }
      refresh();
      range.addEventListener('input', () => { axisStrengths[m.name] = +range.value; refresh(); persist(); });
      range.addEventListener('change', () => { if (live) schedule('full'); });
      val.addEventListener('dblclick', () => {
        range.value = '0'; axisStrengths[m.name] = 0; refresh(); persist(); if (live) schedule('full');
      });
      const onStep = () => { axisStrengths[m.name] = +range.value; refresh(); persist(); };
      const onSettle = () => { if (live) schedule('full'); };
      const minus = makeStepper(range, -1, onStep, onSettle);
      const plus = makeStepper(range, +1, onStep, onSettle);
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'axis-mine-del';
      del.textContent = '×'; del.title = 'delete "' + m.name + '"';
      del.addEventListener('click', () => removeMintedAxis(m.name));
      row.appendChild(nm); row.appendChild(minus); row.appendChild(range); row.appendChild(plus); row.appendChild(val); row.appendChild(del);
      host.appendChild(row);
    });
    refreshSpAxisOptions();
  }
  // Remove a minted axis entirely: drop it from the registry + persisted state,
  // and if it was active, re-render so its effect disappears. The worker's
  // registered vector is left in place (harmless — applyAxisControls only injects
  // axes named in the per-generation control map, and we stop naming it).
  function removeMintedAxis(name) {
    const i = mintedAxes.findIndex((m) => m.name === name);
    if (i < 0) return;
    const wasActive = !!(+axisStrengths[name]);
    mintedAxes.splice(i, 1);
    delete axisStrengths[name];
    if (lastMinted && lastMinted.name === name) {
      lastMinted = null;
      $('axis-inspect').style.display = 'none';
    }
    renderAxisManager();
    refreshButtons();
    persist();
    if (wasActive && live) schedule('full');
  }
  function refreshSpAxisOptions() {
    const sel = $('sp-axis');
    const cur = sel.value;
    sel.innerHTML = '';
    const validValues = [];
    Object.keys(axesMeta).sort((a, b) => axesMeta[a].order - axesMeta[b].order).forEach((k) => {
      const o = document.createElement('option'); o.value = k; o.textContent = axesMeta[k].label + ' (' + k + ')';
      sel.appendChild(o);
      validValues.push(k);
    });
    mintedAxes.forEach((m) => {
      const o = document.createElement('option'); o.value = m.name; o.textContent = m.name + ' (yours)';
      sel.appendChild(o);
      validValues.push(m.name);
    });
    sel.value = validValues.indexOf(cur) >= 0 ? cur : (validValues[0] || '');
  }

  function collectAxisControls() {
    const out = {};
    for (const k in coreAxisEls) {
      if (!coreAxisEls.hasOwnProperty(k)) continue;
      const v = +coreAxisEls[k].range.value;
      if (v) out[k] = v;
    }
    mintedAxes.forEach((m) => {
      const v = +(axisStrengths[m.name] || 0);
      if (v) out[m.name] = (out[m.name] || 0) + v;
    });
    return out;
  }

  // ── expression panel ─────────────────────────────────────────────────────
  function zeroOtherExpressions(activeKey) {
    for (const k in exprRows) {
      if (!exprRows.hasOwnProperty(k) || k === activeKey) continue;
      if (+exprRows[k].range.value !== 0) {
        exprRows[k].range.value = '0';
        exprRows[k].refresh();
      }
      if (k === 'custom') delete exprStrengths.custom;
      else delete exprStrengths[k];
    }
  }
  function buildExpressionRow(key, label, host) {
    const row = document.createElement('div');
    row.className = 'ctl-row stepped';
    const nm = document.createElement('span');
    nm.className = 'ctl-name'; nm.textContent = label;
    nm.title = key === 'custom' ? 'your word, spliced into the prompt'
      : 'field for "' + EXPRESSIONS.find((e) => e.key === key).adj + '"';
    const range = document.createElement('input');
    range.type = 'range'; range.min = '0'; range.max = '5'; range.step = '0.05';
    range.value = String(+exprStrengths[key] || 0);
    const val = document.createElement('span');
    val.className = 'ctl-val';
    function refresh() {
      const v = +range.value;
      val.textContent = v.toFixed(2);
      val.classList.toggle('off', v === 0);
    }
    refresh();
    function commit() {
      const v = +range.value;
      if (v) { exprStrengths[key] = v; zeroOtherExpressions(key); }
      else delete exprStrengths[key];
      refresh(); persist();
    }
    range.addEventListener('input', commit);
    range.addEventListener('change', () => { if (live) schedule('full'); });
    val.addEventListener('dblclick', () => {
      range.value = '0'; commit(); if (live) schedule('full');
    });
    const onStep = commit;
    const onSettle = () => { if (live) schedule('full'); };
    const minus = makeStepper(range, -1, onStep, onSettle);
    const plus = makeStepper(range, +1, onStep, onSettle);
    row.appendChild(nm); row.appendChild(minus); row.appendChild(range);
    row.appendChild(plus); row.appendChild(val);
    host.appendChild(row);
    exprRows[key] = { range: range, refresh: refresh };
  }
  function buildExpressionPanel() {
    const host = $('expr-rows');
    host.innerHTML = '';
    exprRows = {};
    EXPRESSIONS.forEach((e) => buildExpressionRow(e.key, e.label, host));
    buildExpressionRow('custom', 'custom', $('expr-custom-row'));
    if (prefs.exprCustomAdj) $('expr-custom-adj').value = prefs.exprCustomAdj;
    $('expr-custom-adj').addEventListener('change', () => {
      persist();
      if ((+exprStrengths.custom || 0) && live) schedule('full');
    });
    $('btn-reset-expr').addEventListener('click', () => {
      let any = false;
      for (const k in exprRows) {
        if (!exprRows.hasOwnProperty(k)) continue;
        if (+exprRows[k].range.value !== 0) any = true;
        exprRows[k].range.value = '0';
        exprRows[k].refresh();
      }
      exprStrengths = {};
      persist();
      if (any && live) schedule('full');
    });
  }
  buildExpressionPanel();
  // The single active expression for a generate message (exclusivity makes
  // "strongest wins" trivial, but stay robust to hand-edited prefs).
  function activeExpression() {
    let best = null, bestA = 0;
    EXPRESSIONS.forEach((e) => {
      const a = +exprStrengths[e.key] || 0;
      if (a > bestA) { bestA = a; best = { adj: e.adj, alpha: a }; }
    });
    const ca = +exprStrengths.custom || 0;
    const cadj = $('expr-custom-adj').value.trim();
    if (ca > bestA && cadj) best = { adj: cadj, alpha: ca };
    return best;
  }

  // ── spectrum panel — valence/arousal/hostility/surprise sliders ──────────
  // The four model-nominated affect axes stack (they share one carrier in the
  // worker), so unlike the expression rows there is no exclusivity here.
  function buildSpectrumRow(key, host) {
    const row = document.createElement('div');
    row.className = 'ctl-row stepped';
    const nm = document.createElement('span');
    nm.className = 'ctl-name'; nm.textContent = key;
    nm.title = 'model-nominated affect axis — stacks with the other axes and the expression word';
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(-SPEC_RANGE); range.max = String(SPEC_RANGE); range.step = '0.05';
    range.value = String(specState[key] || 0);
    const val = document.createElement('span');
    val.className = 'ctl-val';
    function refresh() {
      const v = +range.value;
      val.textContent = v.toFixed(2);
      val.classList.toggle('off', v === 0);
    }
    refresh();
    function commit() { specState[key] = +range.value; refresh(); persist(); }
    range.addEventListener('input', commit);
    range.addEventListener('change', () => { if (live) schedule('full'); });
    val.addEventListener('dblclick', () => {
      range.value = '0'; commit(); if (live) schedule('full');
    });
    const onSettle = () => { if (live) schedule('full'); };
    const minus = makeStepper(range, -1, commit, onSettle);
    const plus = makeStepper(range, +1, commit, onSettle);
    row.appendChild(nm); row.appendChild(minus); row.appendChild(range);
    row.appendChild(plus); row.appendChild(val);
    host.appendChild(row);
    specRows[key] = { range: range, refresh: refresh };
  }
  function buildSpectrumPanel() {
    SPECTRUM_KEYS.forEach((k) => buildSpectrumRow(k, $('spec-rows')));
    $('btn-reset-spec').addEventListener('click', () => {
      const any = SPECTRUM_KEYS.some((k) => specState[k] !== 0);
      SPECTRUM_KEYS.forEach((k) => { specState[k] = 0; });
      for (const k in specRows) {
        if (!specRows.hasOwnProperty(k)) continue;
        specRows[k].range.value = '0';
        specRows[k].refresh();
      }
      persist();
      if (any && live) schedule('full');
    });
  }
  buildSpectrumPanel();
  // The baked axes ship as lab/spectrum.json; without it the worker rejects
  // spectrum renders, so gray the panel out instead of surfacing the error.
  function setSpectrumAvailable(ok) {
    $('spec-panel').classList.toggle('spec-disabled', !ok);
    if (!ok) $('spec-hint').textContent = 'no lab/spectrum.json — bake it with tools/mint_spectrum.js';
  }
  function activeSpectrum() {
    if (!SPECTRUM_KEYS.some((k) => specState[k] !== 0)) return null;
    return { valence: specState.valence, arousal: specState.arousal,
             hostility: specState.hostility, surprise: specState.surprise };
  }

  // ── LoRA panel ───────────────────────────────────────────────────────────
  // One row per applied LoRA: filename, a strength slider (0 = off, dblclick
  // the value to zero it), and × to remove. Strength changes are free (they
  // ride the next generate message); add/remove are worker requests because
  // they read the safetensors file / rebuild the group list.
  function loraStatus(msg, kind) {
    const el = $('lora-status');
    el.textContent = msg;
    el.className = 'hint' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
  }
  function loraBasename(p) {
    return String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  }
  function renderLoraList() {
    const host = $('lora-list');
    host.innerHTML = '';
    loras.forEach((l, i) => {
      const row = document.createElement('div');
      row.className = 'axis-mine-row';
      const nm = document.createElement('span');
      nm.className = 'axis-mine-name';
      nm.textContent = loraBasename(l.path);
      nm.title = l.path;
      const range = document.createElement('input');
      range.type = 'range'; range.min = '-2'; range.max = '2'; range.step = '0.05';
      range.value = String(l.scale);
      const val = document.createElement('span');
      val.className = 'ctl-val';
      function refresh() {
        const v = +range.value;
        val.textContent = (v > 0 ? '+' : '') + v.toFixed(2);
        val.classList.toggle('off', v === 0);
      }
      refresh();
      range.addEventListener('input', () => { l.scale = +range.value; refresh(); persist(); });
      range.addEventListener('change', () => { if (live) schedule('full'); });
      val.addEventListener('dblclick', () => {
        range.value = '0'; l.scale = 0; refresh(); persist(); if (live) schedule('full');
      });
      const onStep = () => { l.scale = +range.value; refresh(); persist(); };
      const onSettle = () => { if (live) schedule('full'); };
      const minus = makeStepper(range, -1, onStep, onSettle);
      const plus = makeStepper(range, +1, onStep, onSettle);
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'axis-mine-del';
      del.textContent = '×'; del.title = 'remove "' + loraBasename(l.path) + '"';
      del.addEventListener('click', () => removeLora(i));
      row.appendChild(nm); row.appendChild(minus); row.appendChild(range);
      row.appendChild(plus); row.appendChild(val); row.appendChild(del);
      host.appendChild(row);
    });
  }
  function reportLoraOutcome(resp, okMsg) {
    if (resp && resp.errors && resp.errors.length) {
      loraStatus(resp.errors.map((e) => loraBasename(e.path) + ': ' + e.message).join(' · '), 'err');
    } else {
      loraStatus(okMsg, 'ok');
    }
  }
  function addLora() {
    if (!loaded || busy) return;
    if (typeof window.showOpenFileDialog !== 'function') {
      loraStatus('file dialog unavailable in this build', 'err'); return;
    }
    const files = window.showOpenFileDialog('LoRA safetensors|safetensors');
    if (!files || !files.length) return;
    const path = files[0];
    setBusy(true);
    loraStatus('applying ' + loraBasename(path) + '…');
    client.send({ type: 'applyLora', path: path, scale: 1.0 }, (err) => {
      setBusy(false);
      if (err) { loraStatus(String(err.message || err), 'err'); pump(); return; }
      loras.push({ path: path, scale: 1.0 });
      renderLoraList();
      persist();
      loraStatus('applied ' + loraBasename(path), 'ok');
      if (live) schedule('full');
      pump();
    });
  }
  // Remove-one rebuilds the whole group list (group indices are apply-order,
  // so dropping one from the middle shifts the rest — the worker re-applies
  // the remaining files and reports back what actually stuck).
  function removeLora(i) {
    if (!loaded || busy) return;
    const next = loras.filter((_, j) => j !== i);
    setBusy(true);
    loraStatus('rebuilding LoRA set…');
    client.send({ type: 'setLoras', loras: next }, (err, resp) => {
      setBusy(false);
      if (err) { loraStatus(String(err.message || err), 'err'); pump(); return; }
      loras = resp.applied || [];
      renderLoraList();
      persist();
      reportLoraOutcome(resp, 'removed');
      if (live) schedule('full');
      pump();
    });
  }
  // Re-apply the persisted list after a model load (the pipeline's groups
  // die with the old model). Missing/bad files are skipped and reported;
  // the list shrinks to what actually applied.
  function restoreLoras(done) {
    if (!loras.length) { renderLoraList(); done(); return; }
    loraStatus('re-applying ' + loras.length + ' LoRA' + (loras.length === 1 ? '' : 's') + '…');
    client.send({ type: 'setLoras', loras: loras }, (err, resp) => {
      if (err) { loraStatus(String(err.message || err), 'err'); done(); return; }
      loras = resp.applied || [];
      renderLoraList();
      persist();
      reportLoraOutcome(resp, loras.length + ' LoRA' + (loras.length === 1 ? '' : 's') + ' re-applied');
      done();
    });
  }

  // ── render (Render tab) ──────────────────────────────────────────────────
  function drawBitmap(bitmap, w, h) {
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    cctx.drawImage(bitmap, 0, 0);
    canvas.style.display = '';   // revealed on first render (hidden at boot)
    $('view-hint').style.display = 'none';
    // Reset the viewport to fit when the image dimensions change; keep the
    // user's zoom/pan across same-size re-renders (so A/B'ing a control holds
    // the framing). This is also what fixes non-square display: the canvas is
    // sized/positioned in JS from its true w×h, not clamped by CSS.
    if (w !== viewW || h !== viewH) { viewW = w; viewH = h; resetView(); }
    else applyView();
  }

  // ── main-canvas viewport: absolute-scale zoom + pan ─────────────────────────
  function fitScale() {
    const wrap = $('canvas-wrap');
    const availW = wrap.clientWidth - 16, availH = wrap.clientHeight - 16;
    if (viewW <= 0 || viewH <= 0 || availW <= 0 || availH <= 0) return 1;
    return Math.min(availW / viewW, availH / viewH);
  }
  // Default = native size, but never larger than fits the stage. Zoom-out floor
  // is that default; zoom-in ceiling is a generous multiple of native size.
  function defaultScale() { return Math.min(1, fitScale()); }
  function minScale() { return Math.min(1, fitScale()); }
  function maxScale() { return Math.max(1, fitScale()) * 8; }
  const clampScale = (s) => Math.max(minScale(), Math.min(maxScale(), s));
  function applyView() {
    const wrap = $('canvas-wrap');
    const s = viewScale;
    const dw = viewW * s, dh = viewH * s;
    canvas.style.width = dw + 'px';
    canvas.style.height = dh + 'px';
    canvas.style.left = ((wrap.clientWidth - dw) / 2 + viewPanX) + 'px';
    canvas.style.top = ((wrap.clientHeight - dh) / 2 + viewPanY) + 'px';
    showZoom(s);
  }
  function setScale(s) { viewScale = clampScale(s); applyView(); }
  function resetView() { viewScale = defaultScale(); viewUserZoomed = false; viewPanX = 0; viewPanY = 0; applyView(); }
  function showZoom(s) {
    const z = $('view-zoom');
    z.textContent = Math.round(s * 100) + '%';
    z.classList.add('show');
    if (zoomHideTimer) clearInterval(zoomHideTimer);
    // setTimeout isn't guaranteed here; use a one-shot interval tick.
    zoomHideTimer = setInterval(() => { z.classList.remove('show'); clearInterval(zoomHideTimer); zoomHideTimer = null; }, 1100);
  }

  // ── seed: randomize + recent-seed reuse ────────────────────────────────────
  const randomSeed = () => Math.floor(Math.random() * SEED_MAX);
  function refreshSeedRecent() {
    const sel = $('seed-recent');
    sel.innerHTML = '<option value="">recent…</option>';
    seedHistory.forEach((s) => {
      const o = document.createElement('option');
      o.value = String(s); o.textContent = String(s);
      sel.appendChild(o);
    });
    sel.value = '';   // keep it a picker, not a value display
  }
  function recordSeed(seed) {
    if (seedHistory[0] === seed) return;         // dedup consecutive
    seedHistory = seedHistory.filter((s) => s !== seed);
    seedHistory.unshift(seed);
    if (seedHistory.length > SEED_HISTORY_MAX) seedHistory.length = SEED_HISTORY_MAX;
    refreshSeedRecent();
    persist();
  }

  // ── render history (right rail) ────────────────────────────────────────────
  function refreshHistButtons() {
    const empty = history.length === 0;
    $('btn-hist-clear').disabled = empty;
    $('btn-hist-save-all').disabled = empty;
  }
  function addHistoryEntry(bitmap, w, h, meta) {
    // Retain the full-resolution pixels (the canvas is the thumbnail, CSS-scaled)
    // so "save" writes the real render, not a downscaled preview.
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(bitmap, 0, 0);
    history.unshift({ id: ++histSeq, canvas: c, w: w, h: h, seed: meta.seed, steps: meta.steps,
                      width: meta.width, height: meta.height });
    if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
    renderHistory();
  }
  function renderHistory() {
    const list = $('hist-list');
    list.innerHTML = '';
    if (history.length === 0) {
      const e = document.createElement('div');
      e.className = 'hist-empty'; e.textContent = 'Rendered images collect here.';
      list.appendChild(e);
      refreshHistButtons();
      return;
    }
    history.forEach((h) => {
      const item = document.createElement('div');
      item.className = 'hist-item';
      h.canvas.className = 'hist-thumb';
      h.canvas.title = 'click to view in the render tab';
      // onclick (not addEventListener): renderHistory() re-runs on every render
      // and reuses these persistent canvas nodes — assignment avoids stacking
      // duplicate handlers.
      h.canvas.onclick = () => {
        drawBitmap(h.canvas, h.w, h.h);
        status('viewing history · seed ' + h.seed + ' · ' + h.width + '×' + h.height, 'ok');
      };
      const body = document.createElement('div');
      body.className = 'hist-body';
      const metaRow = document.createElement('div');
      metaRow.className = 'hist-meta';
      const dims = document.createElement('span');
      dims.textContent = h.width + '×' + h.height + ' · ' + h.steps + 'st';
      const seed = document.createElement('span');
      seed.className = 'hist-seed'; seed.textContent = 'seed ' + h.seed;
      seed.title = 'reuse this seed (pins it — turns off randomize)';
      seed.addEventListener('click', () => reuseSeed(h.seed));
      metaRow.appendChild(dims); metaRow.appendChild(seed);
      const actions = document.createElement('div');
      actions.className = 'hist-actions';
      const save = document.createElement('button');
      save.className = 'link'; save.textContent = 'save';
      save.addEventListener('click', () => saveHistoryImage(h));
      const del = document.createElement('button');
      del.className = 'link hist-del'; del.textContent = 'delete';
      del.title = 'remove this render from history';
      del.addEventListener('click', () => deleteHistoryEntry(h.id));
      actions.appendChild(save); actions.appendChild(del);
      body.appendChild(metaRow); body.appendChild(actions);
      item.appendChild(h.canvas); item.appendChild(body);
      list.appendChild(item);
    });
    refreshHistButtons();
    renderMintGallery();
  }
  // ── Image Axis tab: pick a toward/away pair from a gallery of your renders ──
  // Replaces the old size/seed dropdowns (useless when every render shares a
  // size and seed) with a visual grid — you recognise the picture, not a label.
  const GALLERY_THUMB = 132;
  function renderMintGallery() {
    const grid = $('mint-gallery');
    if (!grid) return;
    grid.innerHTML = '';
    if (history.length === 0) {
      const e = document.createElement('div');
      e.className = 'mint-gallery-empty';
      e.textContent = 'Renders you make collect here — generate a few, then pick a pair.';
      grid.appendChild(e);
      return;
    }
    history.forEach((h) => {
      const cell = document.createElement('div');
      cell.className = 'mint-cell';
      const isA = mintSelId.a === h.id, isB = mintSelId.b === h.id;
      if (isA) cell.classList.add('sel-a');
      if (isB) cell.classList.add('sel-b');

      const cv = document.createElement('canvas');
      const scale = Math.min(GALLERY_THUMB / h.w, GALLERY_THUMB / h.h, 1);
      cv.width = Math.max(1, Math.round(h.w * scale));
      cv.height = Math.max(1, Math.round(h.h * scale));
      cv.getContext('2d').drawImage(h.canvas, 0, 0, cv.width, cv.height);
      cell.appendChild(cv);

      if (isA || isB) {
        const badge = document.createElement('div');
        badge.className = 'mint-cell-badge ' + (isA ? 'pos' : 'neg');
        badge.textContent = isA ? 'toward' : 'away';
        cell.appendChild(badge);
      }

      const btns = document.createElement('div');
      btns.className = 'mint-cell-btns';
      const bA = document.createElement('button');
      bA.className = 'mc-toward' + (isA ? ' on' : ''); bA.textContent = 'toward';
      bA.title = 'use as the “toward” (slider +) image';
      bA.addEventListener('click', () => useHistoryForMint('a', h.id));
      const bB = document.createElement('button');
      bB.className = 'mc-away' + (isB ? ' on' : ''); bB.textContent = 'away';
      bB.title = 'use as the “away” (slider −) image';
      bB.addEventListener('click', () => useHistoryForMint('b', h.id));
      btns.appendChild(bA); btns.appendChild(bB);
      cell.appendChild(btns);

      grid.appendChild(cell);
    });
  }
  function imgAxisStatus(msg, kind) {
    const el = $('imgaxis-status-text');
    if (!el) return;
    el.textContent = msg;
    el.className = kind === 'err' ? 'err' : kind === 'ok' ? 'ok' : '';
  }
  // Feedback for image-pair minting lands in both the rail hint and the tab's
  // own status bar, so it's visible wherever the user is looking.
  function mintImgStatus(msg, kind) { mintStatus(msg, kind); imgAxisStatus(msg, kind); }
  // Draw the eye to the name field (right next to the Mint button) when a mint
  // is blocked for want of a name — the bottom status bar is too far to notice.
  function flagMintName() {
    const el = $('mint-image-name');
    if (!el) return;
    el.focus();
    el.classList.remove('flash-err');
    // Force reflow so re-adding the class restarts the animation on repeat clicks.
    void el.offsetWidth;
    el.classList.add('flash-err');
  }
  function useHistoryForMint(which, id) {
    const h = history.find((e) => e.id === +id);
    if (!h) return;
    let tensor;
    try { tensor = tensorFromCanvas(h.canvas); }
    catch (e) { mintImgStatus('could not use that render: ' + (e.message || e), 'err'); return; }
    paintMintThumb(which, h.canvas, h.w, h.h);
    // No file path — this pixel source is a render. Fine: the minted axis
    // persists as its saved direction, not its source images.
    if (which === 'a') mintImgA = { tensor: tensor, path: '' };
    else mintImgB = { tensor: tensor, path: '' };
    mintSelId[which] = h.id;
    renderMintGallery();
    mintImgStatus((which === 'a' ? 'toward' : 'away') + ' ← render · seed ' + h.seed +
      (mintImgA && mintImgB ? ' · ready to mint' : ''), 'ok');
    refreshButtons();
  }
  function clearMintSlot(which) {
    if (which === 'a') mintImgA = null; else mintImgB = null;
    mintSelId[which] = null;
    const thumb = $('mint-' + which + '-thumb');
    const cv = thumb && thumb.querySelector('canvas');
    if (cv) cv.remove();
    if (thumb) thumb.classList.remove('filled');
    renderMintGallery();
    imgAxisStatus(mintImgA || mintImgB ? 'pick the other image to mint an axis'
                                       : 'pick a toward + away image to mint an axis');
    refreshButtons();
  }
  function reuseSeed(seed) {
    $('seed').value = String(seed);
    $('rand-seed').checked = false;
    recordSeed(seed);
    persist();
    if (live && loaded) schedule('full');
  }
  function saveHistoryImage(h) {
    if (typeof window.showSaveFileDialog !== 'function') {
      status('save dialog unavailable in this build', 'err'); return;
    }
    const name = 'krea2_' + h.seed + '_' + h.width + 'x' + h.height + '.png';
    const path = window.showSaveFileDialog('PNG Image|png', name);
    if (!path) return;   // cancelled
    try {
      const px = h.canvas.getContext('2d').getImageData(0, 0, h.w, h.h);
      bro.image.encodePngFile(path, px.data, h.w, h.h, 4);
      status('saved ' + path, 'ok');
    } catch (e) {
      status('save failed: ' + (e.message || e), 'err');
    }
  }
  function saveAllHistory() {
    if (typeof window.showOpenFolderDialog !== 'function') {
      status('folder dialog unavailable in this build', 'err'); return;
    }
    const dir = window.showOpenFolderDialog('');
    if (!dir) return;
    const sep = dir.indexOf('\\') >= 0 ? '\\' : '/';
    let n = 0;
    for (let i = history.length - 1; i >= 0; i--) {   // oldest first, natural order
      const h = history[i];
      try {
        const px = h.canvas.getContext('2d').getImageData(0, 0, h.w, h.h);
        bro.image.encodePngFile(dir + sep + 'krea2_' + h.seed + '_' + h.width + 'x' + h.height + '.png',
                                px.data, h.w, h.h, 4);
        n++;
      } catch (e) { /* skip a bad entry, keep going */ }
    }
    status('saved ' + n + ' image' + (n === 1 ? '' : 's') + ' to ' + dir, n ? 'ok' : 'err');
  }
  function deleteHistoryEntry(id) {
    history = history.filter((h) => h.id !== id);
    // Drop it from the mint pair too if it was one of the chosen images.
    ['a', 'b'].forEach((which) => { if (mintSelId[which] === id) clearMintSlot(which); });
    renderHistory();
  }
  function clearHistory() {
    history = [];
    if (mintSelId.a != null) clearMintSlot('a');
    if (mintSelId.b != null) clearMintSlot('b');
    renderHistory();
  }

  function refreshButtons() {
    const busyOrUnloaded = busy || !loaded;
    $('btn-generate').disabled = busyOrUnloaded;
    $('btn-load').disabled = busy;
    $('btn-lora-add').disabled = busyOrUnloaded;
    $('btn-mint-text').disabled = busyOrUnloaded;
    $('btn-mint-image').disabled = busyOrUnloaded || !mintImgA || !mintImgB;
    $('btn-axis-sweep').disabled = busyOrUnloaded || !lastMinted;
    $('btn-gate-capture').disabled = busyOrUnloaded;
    $('btn-gate-apply').disabled = busyOrUnloaded || !gateCapture;
    $('btn-sp-base').disabled = busyOrUnloaded;
    $('btn-sp-go').disabled = busyOrUnloaded || !spBaseBitmap;
  }
  function setBusy(b) { busy = b; refreshButtons(); }

  // ── loading overlay + live VRAM meter ──────────────────────────────────
  // The worker's loadModel() is one synchronous native call, so it can't report
  // progress. But the main thread stays live and CUDA VRAM is device-wide, so we
  // poll bro.gpu.memoryInfo() here and watch used VRAM climb as the checkpoint
  // streams onto the card. (On a CPU build there is no VRAM to show — we say so.)
  let vramTimer = null;
  const gpu = () => (typeof bro !== 'undefined' && bro.gpu) ? bro.gpu : null;
  function cardName() {
    const g = gpu();
    if (!g) return 'GPU';
    return (g.deviceName && g.deviceName()) || (g.backend ? g.backend.toUpperCase() : 'GPU');
  }
  function updateVram() {
    const g = gpu();
    const fill = $('vram-fill'), nums = $('vram-nums'), note = $('vram-note');
    const mem = g && g.memoryInfo ? g.memoryInfo() : null;
    if (!mem || !mem.totalBytes) {
      nums.textContent = 'no VRAM meter';
      note.textContent = 'loading on ' + (g && g.backend ? g.backend.toUpperCase() : 'CPU');
      fill.style.width = '0%';
      return;
    }
    const gb = (b) => (b / 1e9).toFixed(1);
    const used = mem.totalBytes - mem.freeBytes;
    const pct = Math.max(0, Math.min(100, used / mem.totalBytes * 100));
    fill.style.width = pct.toFixed(1) + '%';
    nums.textContent = gb(used) + ' / ' + gb(mem.totalBytes) + ' GB';
    note.textContent = gb(mem.freeBytes) + ' GB free · ' + pct.toFixed(0) + '% used';
  }
  function startLoadOverlay() {
    $('vram-card').textContent = cardName();
    $('load-overlay').classList.add('show');
    updateVram();
    if (vramTimer) clearInterval(vramTimer);
    vramTimer = setInterval(updateVram, 200);
  }
  function stopLoadOverlay() {
    if (vramTimer) { clearInterval(vramTimer); vramTimer = null; }
    $('load-overlay').classList.remove('show');
  }

  function doLoad() {
    const modelDir = $('model-dir').value.trim();
    if (!modelDir) { status('set a Krea 2 directory first', 'err'); return; }
    persist();
    setBusy(true);
    loaded = false;
    backend('loading…');
    startLoadOverlay();
    status('loading model — this reads ~26GB of weights, give it a moment');
    client.send({ type: 'load', modelDir: modelDir, dictPath: 'assets/axes_turbo.bcd1',
                  spectrumPath: 'lab/spectrum.json' }, (err, msg) => {
      stopLoadOverlay();
      if (err) { setBusy(false); backend('error', 'err'); status(String(err.message || err), 'err'); return; }
      loaded = true;
      setSpectrumAvailable(!!msg.spectrum);
      setBusy(false);
      backend(msg.backend === 'cpu' ? 'CPU' : (msg.backend || 'gpu').toUpperCase(),
              msg.backend === 'cpu' ? 'warn' : 'ok');
      $('backend').title = cardName();
      const cls = (msg.config && msg.config.modelClass) || 'model';
      const card = msg.backend === 'cpu' ? '' : ' · ' + cardName();
      status(cls + ' ready · ' + (msg.axes || []).length + ' axes' + card, 'ok');
      // Chain the two sequential restore passes (the client serializes one
      // request at a time): saved LoRAs first, then saved minted axes.
      restoreLoras(() => rebuildMintedAxes());
    });
  }

  // Generation opts from the form. 'preview' trades quality for a fast live-drag
  // frame (sana-lab's schedule/pump convention); Generate always runs 'full'.
  function genOpts(quality) {
    const preview = quality === 'preview';
    let w = roundSize($('width').value);
    let h = roundSize($('height').value);
    const fieldSteps = +$('steps').value || DEFAULTS.steps;
    // Preview: scale the whole frame down under PREVIEW_SIZE, keeping aspect.
    if (preview && Math.max(w, h) > PREVIEW_SIZE) {
      const s = PREVIEW_SIZE / Math.max(w, h);
      w = roundSize(w * s); h = roundSize(h * s);
    }
    const steps = preview ? Math.min(fieldSteps, PREVIEW_STEPS) : fieldSteps;
    return {
      width: w, height: h, steps: steps,
      guidanceScale: +$('guidance').value || DEFAULTS.guidance,
      seed: +$('seed').value || 0,
    };
  }
  function buildGenerateMsg(quality) {
    return {
      type: 'generate',
      prompt: $('prompt').value,
      negPrompt: $('neg-prompt').value.trim(),
      opts: genOpts(quality),
      band: +$('band').value,
      dial: { pregate: +$('dial-pregate').value, prescale: +$('dial-prescale').value },
      gate: { txtScale: +$('gate-txt').value, imgScale: +$('gate-img').value },
      axisControls: collectAxisControls(),
      expression: activeExpression(),
      spectrum: activeSpectrum(),
      loraScales: loras.map((l) => +l.scale),
    };
  }

  // Latest-wins render scheduler (sana-lab's pattern): dragging any dial/band/
  // axis/gate slider coalesces to its final value; a 'full' request upgrades a
  // queued 'preview' so releasing a slider always lands a clean frame.
  let pendingQuality = null;
  function schedule(quality) {
    if (!loaded) return;
    // No live low-res preview. It rendered a downscaled, 4-step throwaway frame
    // while dragging and then swapped in the real one — two visibly different
    // images per change, which read as confusing (and the downscale is what put
    // a size-mismatched frame on the canvas). Live mode now lands ONE full-quality
    // frame when a control settles (the slider 'change' event), nothing mid-drag.
    if (quality !== 'full') return;
    pendingQuality = 'full';
    pump();
  }
  function pump() {
    if (busy || !loaded || !pendingQuality) return;
    const quality = pendingQuality;
    pendingQuality = null;
    runGenerate(quality);
  }
  function runGenerate(quality) {
    persist();
    setBusy(true);
    const msg = buildGenerateMsg(quality);
    status((quality === 'preview' ? 'preview' : 'generating') + ' · ' +
           msg.opts.width + '×' + msg.opts.height + ' · ' + msg.opts.steps + ' steps…');
    $('timing').textContent = '';
    const usedSeed = msg.opts.seed;
    client.send(msg, (err, resp) => {
      setBusy(false);
      if (err) { status(String(err.message || err), 'err'); pump(); return; }
      drawBitmap(resp.bitmap, resp.width, resp.height);
      // Only full-quality frames are keepers — previews (live slider scrubs) are
      // throwaway, and downscaled, so they never enter the history or seed log.
      if (quality === 'full') {
        recordSeed(usedSeed);
        addHistoryEntry(resp.bitmap, resp.width, resp.height,
                        { seed: usedSeed, steps: msg.opts.steps, width: resp.width, height: resp.height });
      }
      status(quality === 'preview' ? 'preview' : 'done', 'ok');
      $('timing').textContent = (resp.ms ? resp.ms + ' ms' : '') +
        (resp.exprNeutral ? ' · field vs “' + resp.exprNeutral + '”' : '') +
        (resp.spectrumNote ? ' · ' + resp.spectrumNote : '') +
        (quality === 'preview' ? ' · preview' : '');
      pump();
    });
  }
  // Explicit Generate: with randomize on, roll a fresh seed first (control-driven
  // re-renders keep the current seed so a slider's effect is A/B-comparable).
  function doGenerate() {
    if ($('rand-seed').checked) { $('seed').value = String(randomSeed()); persist(); }
    schedule('full');
  }

  // ── AdaLN dials / band / gate scale — shared live-preview wiring ────────
  function wireLiveSlider(id, valId, fmt, neutral) {
    const range = $(id), val = $(valId);
    function refresh() { val.textContent = fmt(+range.value); }
    range.addEventListener('input', () => { refresh(); persist(); if (live) schedule('preview'); });
    range.addEventListener('change', () => { if (live) schedule('full'); });
    val.addEventListener('dblclick', () => { range.value = String(neutral); refresh(); persist(); if (live) schedule('full'); });
    refresh();
  }
  const fmt2 = (v) => v.toFixed(2);
  const fmt1 = (v) => v.toFixed(1);
  wireLiveSlider('dial-pregate', 'dial-pregate-val', fmt2, 1.0);
  wireLiveSlider('dial-prescale', 'dial-prescale-val', fmt2, 1.0);
  wireLiveSlider('band', 'band-val', fmt1, 1.0);
  wireLiveSlider('gate-txt', 'gate-txt-val', fmt2, 1.0);
  wireLiveSlider('gate-img', 'gate-img-val', fmt2, 1.0);
  $('gate-brush-target').addEventListener('input', () => {
    $('gate-brush-target-val').textContent = (+$('gate-brush-target').value).toFixed(2);
  });
  $('sp-strength').addEventListener('input', () => {
    $('sp-strength-val').textContent = (+$('sp-strength').value).toFixed(2);
  });

  // ── mint your own axis ───────────────────────────────────────────────────
  function mintStatus(msg, kind) {
    const el = $('mint-status');
    el.textContent = msg;
    el.className = 'hint' + (kind === 'err' ? ' err' : kind === 'warn' ? ' warn' : '');
  }
  // Interim minting progress (the worker posts a message before each encode).
  client.onProgress((p) => {
    $('mint-progress').classList.add('show');
    $('mint-progress-fill').style.width =
      Math.round((p.done / Math.max(1, p.total)) * 100) + '%';
    mintStatus('minting · ' + p.label);
  });
  function mintProgressDone() {
    $('mint-progress').classList.remove('show');
    $('mint-progress-fill').style.width = '0%';
  }
  function addMintedAxis(def) {
    const existing = mintedAxes.findIndex((m) => m.name === def.name);
    if (existing >= 0) mintedAxes[existing] = def; else mintedAxes.push(def);
    renderAxisManager();
    persist();
  }

  // ── minted-axis readout: what the direction is made of ──────────────────
  // Signed cosine bars against the 18 named bank axes + the span residual
  // ("how much of it is genuinely its own"), computed by the worker at mint
  // time. Answers "what did the mint actually pick out of these images?"
  // without guessing from slider sweeps.
  let lastMinted = null;   // the def currently shown in the inspector
  function showAxisInspector(def) {
    lastMinted = def;
    $('axis-inspect').style.display = '';
    $('axis-inspect-name').textContent = def.name;
    const bars = $('axis-inspect-bars');
    bars.innerHTML = '';
    const strip = $('axis-sweep-strip');
    strip.innerHTML = ''; strip.classList.remove('show');
    const note = $('axis-inspect-note');
    if (def.components && def.components.length) {
      def.components.slice(0, 6).forEach((c) => {
        const row = document.createElement('div'); row.className = 'axis-bar-row';
        const nm = document.createElement('span'); nm.className = 'axis-bar-name';
        nm.textContent = (axesMeta[c.name] && axesMeta[c.name].label) || c.name;
        nm.title = c.name;
        const track = document.createElement('div'); track.className = 'axis-bar-track';
        const fill = document.createElement('div');
        fill.className = 'axis-bar-fill ' + (c.cos >= 0 ? 'pos' : 'neg');
        fill.style.width = Math.min(50, Math.abs(c.cos) * 50) + '%';
        track.appendChild(fill);
        const val = document.createElement('span'); val.className = 'axis-bar-val';
        val.textContent = (c.cos > 0 ? '+' : '') + c.cos.toFixed(2);
        row.appendChild(nm); row.appendChild(track); row.appendChild(val);
        bars.appendChild(row);
      });
      // residual² is the energy fraction outside the whole 18-axis span —
      // the honest "not any named thing" number (the axes aren't orthogonal,
      // so per-axis cosines alone would overcount).
      const own = Math.round(def.residual * def.residual * 100);
      note.textContent = 'overlap with the named axes (top 6 of 18) · ' + own +
        '% of it is new, outside all 18' +
        (def.kind === 'text' && def.consistency != null
          ? ' · consistency ' + def.consistency.toFixed(2) : '');
    } else {
      note.textContent = 'no decomposition — this engine build predates ' +
        'pipeline.controlVector(); rebuild and re-mint to see what the axis is made of';
    }
    refreshButtons();
  }

  // ── isolation sweep: SEE what the axis does, everything else neutral ────
  // 5 small renders at alpha −6…+6 with the same prompt/seed and every other
  // control zeroed — a probe strip, the ground truth for "what does this
  // axis move". Click a frame to view it full-size on the render tab.
  const SWEEP_ALPHAS = [-6, -3, 0, 3, 6];
  const SWEEP_SIZE = 384;
  function doAxisSweep() {
    if (!loaded || busy || !lastMinted) return;
    const name = lastMinted.name;
    let w = roundSize($('width').value), h = roundSize($('height').value);
    const s = SWEEP_SIZE / Math.max(w, h);
    if (s < 1) { w = roundSize(w * s); h = roundSize(h * s); }
    const prompt = $('prompt').value.trim() || 'a red fox sitting in a snowy forest clearing';
    const seed = +$('seed').value || 0;
    const steps = +$('steps').value || DEFAULTS.steps;
    const strip = $('axis-sweep-strip');
    strip.innerHTML = ''; strip.classList.add('show');
    const cells = SWEEP_ALPHAS.map((a) => {
      const cell = document.createElement('div'); cell.className = 'cell';
      const cv = document.createElement('canvas');
      cv.width = 1; cv.height = 1;
      const lb = document.createElement('div'); lb.className = 'cell-label';
      lb.textContent = (a > 0 ? '+' : '') + a;
      cell.appendChild(cv); cell.appendChild(lb);
      strip.appendChild(cell);
      return cv;
    });
    setBusy(true);
    let i = 0;
    (function next() {
      if (i >= SWEEP_ALPHAS.length) {
        setBusy(false);
        mintStatus('sweep of "' + name + '" · seed ' + seed + ' · click a frame to view', 'ok');
        pump();
        return;
      }
      const alpha = SWEEP_ALPHAS[i];
      const cv = cells[i];
      mintStatus('sweep ' + (i + 1) + '/' + SWEEP_ALPHAS.length + ' · ' + name +
                 ' = ' + (alpha > 0 ? '+' : '') + alpha + '…');
      const ac = {};
      if (alpha) ac[name] = alpha;
      client.send({
        type: 'generate', prompt: prompt, negPrompt: '',
        opts: { width: w, height: h, steps: steps,
                guidanceScale: +$('guidance').value || DEFAULTS.guidance, seed: seed },
        band: 1.0, dial: { pregate: 1.0, prescale: 1.0 },
        gate: { txtScale: 1.0, imgScale: 1.0 },
        axisControls: ac,
      }, (err, resp) => {
        if (err) { setBusy(false); mintStatus('sweep failed: ' + (err.message || err), 'err'); return; }
        cv.width = resp.width; cv.height = resp.height;
        cv.getContext('2d').drawImage(resp.bitmap, 0, 0);
        cv.title = name + ' = ' + (alpha > 0 ? '+' : '') + alpha + ' · click to view';
        cv.onclick = () => {
          drawBitmap(cv, resp.width, resp.height);
          status('sweep frame · ' + name + ' = ' + (alpha > 0 ? '+' : '') + alpha, 'ok');
        };
        i++;
        next();
      });
    })();
  }
  $('btn-axis-sweep').addEventListener('click', doAxisSweep);

  function doMintText() {
    if (!loaded || busy) return;
    const name = $('mint-text-name').value.trim();
    const pos = $('mint-text-pos').value.trim();
    const neg = $('mint-text-neg').value.trim();
    if (!name || !pos || !neg) { mintStatus('need a name and both descriptions', 'err'); return; }
    setBusy(true);
    mintStatus('minting "' + name + '" — averaging over 6 scenes…');
    client.send({ type: 'mintTextAxis', name: name, pos: pos, neg: neg }, (err, resp) => {
      setBusy(false);
      mintProgressDone();
      if (err) { mintStatus(String(err.message || err), 'err'); return; }
      const def = { name: resp.name, kind: 'text', pos: pos, neg: neg,
                    consistency: resp.consistency, dir: f32ToB64(resp.axis),
                    components: resp.components, residual: resp.residual };
      addMintedAxis(def);
      showAxisInspector(def);
      const low = resp.consistency < 0.8;
      mintStatus('minted "' + resp.name + '" · consistency ' + resp.consistency.toFixed(2) +
                 (low ? ' (low — the two descriptions may not name one clean direction)' : ''),
                 low ? 'warn' : 'ok');
      $('mint-text-name').value = ''; $('mint-text-pos').value = ''; $('mint-text-neg').value = '';
    });
  }
  function pickMintImage(which) {
    if (typeof showOpenFileDialog !== 'function') { mintImgStatus('file dialog unavailable in this build', 'err'); return; }
    const files = showOpenFileDialog('Image|png;jpg;jpeg');
    if (!files || !files.length) return;
    const path = files[0];
    let id, tensor;
    try { id = capLongSide(fileToImageData(path), 1024); tensor = toChwFp32(id); }
    catch (e) { mintImgStatus('image load failed: ' + e.message, 'err'); return; }
    paintMintThumb(which, id, id.width, id.height);
    if (which === 'a') mintImgA = { tensor: tensor, path: path };
    else mintImgB = { tensor: tensor, path: path };
    mintSelId[which] = null;   // a browsed file isn't one of the gallery renders
    renderMintGallery();
    mintImgStatus((which === 'a' ? 'toward' : 'away') + ' ← file' +
      (mintImgA && mintImgB ? ' · ready to mint' : ''), 'ok');
    refreshButtons();
  }
  function doMintImage() {
    if (!loaded || busy || !mintImgA || !mintImgB) return;
    const name = $('mint-image-name').value.trim();
    if (!name) { flagMintName(); mintImgStatus('name the axis first', 'err'); return; }
    setBusy(true);
    mintImgStatus('minting "' + name + '" from the image pair…');
    client.send({
      type: 'mintImageAxis', name: name,
      a: { pixels: mintImgA.tensor.pixels, H: mintImgA.tensor.H, W: mintImgA.tensor.W },
      b: { pixels: mintImgB.tensor.pixels, H: mintImgB.tensor.H, W: mintImgB.tensor.W },
    }, (err, resp) => {
      setBusy(false);
      mintProgressDone();
      if (err) { mintImgStatus(String(err.message || err), 'err'); return; }
      const def = { name: resp.name, kind: 'image', aPath: mintImgA.path, bPath: mintImgB.path,
                    dir: f32ToB64(resp.axis),
                    components: resp.components, residual: resp.residual };
      addMintedAxis(def);
      showAxisInspector(def);
      mintImgStatus('minted "' + resp.name + '" — added to the axis bank', 'ok');
      $('mint-image-name').value = '';
    });
  }
  // Re-register axes saved from a prior session (sequentially — the client
  // serializes requests). Each saved axis carries its minted direction, so
  // restore is a cheap registerAxis — zero encodes at load. Legacy entries
  // without a saved direction are dropped; re-mint by hand if still wanted.
  function rebuildMintedAxes() {
    const defs = Array.isArray(prefs.mintedAxes) ? prefs.mintedAxes.slice() : [];
    mintedAxes = [];
    let i = 0;
    (function next() {
      if (i >= defs.length) {
        mintProgressDone();
        renderAxisManager();   // per-axis strengths come from axisStrengths (name-keyed)
        return;
      }
      const d = defs[i++];
      if (!d || !d.name || !d.dir) { next(); return; }
      let axis;
      try { axis = b64ToF32(d.dir); }
      catch (e) { next(); return; }
      client.send({ type: 'registerAxis', name: d.name, axis: axis }, (err, resp) => {
        if (!err) addMintedAxis({ name: d.name, kind: d.kind, pos: d.pos, neg: d.neg,
                                  aPath: d.aPath, bPath: d.bPath, dir: d.dir,
                                  consistency: d.consistency,
                                  components: resp.components, residual: resp.residual });
        next();
      });
    })();
  }

  // ── Gate Paint tab ────────────────────────────────────────────────────
  const gateCanvas = $('gate-heatmap');
  const gateCtx = gateCanvas.getContext('2d');
  const gateResultCanvas = $('gate-result');
  const gateResultCtx = gateResultCanvas.getContext('2d');

  function computeHeatmapMean() {
    const rows = gateCapture.rows, cols = gateCapture.cols, data = gateCapture.data;
    const img_len = gateCapture.img_len, text_seq = gateCapture.text_seq;
    const out = new Float64Array(img_len);
    for (let r = 0; r < rows; r++) {
      const off = r * cols + text_seq;
      for (let i = 0; i < img_len; i++) out[i] += data[off + i];
    }
    for (let i = 0; i < img_len; i++) out[i] /= rows;
    // min-max normalize to 0..1 for display
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < img_len; i++) { if (out[i] < lo) lo = out[i]; if (out[i] > hi) hi = out[i]; }
    const span = (hi - lo) || 1;
    const norm = new Float32Array(img_len);
    for (let i = 0; i < img_len; i++) norm[i] = (out[i] - lo) / span;
    return norm;
  }

  function renderGateCanvas() {
    const gridW = gateCapture.gridW, gridH = gateCapture.gridH;
    const img = gateCtx.createImageData(gridW, gridH);
    for (let i = 0; i < gridW * gridH; i++) {
      const g = Math.round(30 + gateCapture.heatNorm[i] * 180);
      const pv = gateMaskValues[i];
      let r = g, gg = g, b = g;
      if (pv !== 1.0) {
        const t = Math.max(-1, Math.min(1, pv - 1.0));   // <0 suppress (blue), >0 amplify (orange)
        if (t < 0) { r = Math.round(g * (1 + t)); gg = Math.round(g * (1 + t)); b = Math.min(255, g + Math.round(-t * 180)); }
        else { r = Math.min(255, g + Math.round(t * 180)); gg = Math.round(g * (1 - t * 0.4)); b = Math.round(g * (1 - t)); }
      }
      img.data[4 * i + 0] = r; img.data[4 * i + 1] = gg; img.data[4 * i + 2] = b; img.data[4 * i + 3] = 255;
    }
    gateCtx.putImageData(img, 0, 0);
  }

  function gatePointerToGrid(e) {
    const rect = gateCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width * gateCapture.gridW,
      y: (e.clientY - rect.top) / rect.height * gateCapture.gridH,
    };
  }
  function gatePaintAt(x, y) {
    const r = +$('gate-brush-radius').value;
    const target = +$('gate-brush-target').value;
    const gridW = gateCapture.gridW, gridH = gateCapture.gridH;
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(gridW - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(gridH - 1, Math.ceil(y + r));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx + 0.5 - x, dy = yy + 0.5 - y;
        if (dx * dx + dy * dy <= r * r) gateMaskValues[yy * gridW + xx] = target;
      }
    }
    renderGateCanvas();
  }
  gateCanvas.addEventListener('pointerdown', (e) => {
    if (!gateCapture) return;
    gateDown = true;
    if (gateCanvas.setPointerCapture) gateCanvas.setPointerCapture(e.pointerId);
    gatePaintAt(gatePointerToGrid(e).x, gatePointerToGrid(e).y);
  });
  gateCanvas.addEventListener('pointermove', (e) => {
    if (!gateDown || !gateCapture) return;
    const p = gatePointerToGrid(e); gatePaintAt(p.x, p.y);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
    gateCanvas.addEventListener(ev, () => { gateDown = false; });
  });

  function drawGateResult(bitmap, w, h) {
    if (gateResultCanvas.width !== w || gateResultCanvas.height !== h) {
      gateResultCanvas.width = w; gateResultCanvas.height = h;
    }
    gateResultCtx.drawImage(bitmap, 0, 0);
    $('gate-result-hint').style.display = 'none';
  }

  function doGateCapture() {
    if (!loaded || busy) return;
    const msg = buildGenerateMsg('full');
    msg.captureGates = true;
    persist();
    setBusy(true);
    gateStatus('capturing gates — one full render…');
    $('gate-timing').textContent = '';
    client.send(msg, (err, resp) => {
      setBusy(false);
      if (err) { gateStatus(String(err.message || err), 'err'); return; }
      const H_lat = msg.opts.height / VAE_SCALE, W_lat = msg.opts.width / VAE_SCALE;
      const gridH = Math.round(H_lat / PATCH), gridW = Math.round(W_lat / PATCH);
      const img_len = gridW * gridH;
      const gates = resp.gates;
      const text_seq = gates.cols - img_len;
      gateCapture = {
        rows: gates.rows, cols: gates.cols, data: gates.data,
        text_seq: text_seq, img_len: img_len, gridW: gridW, gridH: gridH, msgUsed: msg,
      };
      gateCapture.heatNorm = computeHeatmapMean();
      gateMaskValues = new Float32Array(gridW * gridH).fill(1.0);
      gateCanvas.width = gridW; gateCanvas.height = gridH;
      renderGateCanvas();
      drawGateResult(resp.bitmap, resp.width, resp.height);
      $('gate-hint').style.display = 'none';
      refreshButtons();
      gateStatus('captured · text_seq ' + text_seq + ' · img_len ' + img_len + ' (' + gridW + '×' + gridH + ') · ' +
                 (resp.ms || 0) + ' ms', 'ok');
    });
  }
  function doGateClear() {
    if (!gateCapture) return;
    gateMaskValues.fill(1.0);
    renderGateCanvas();
  }
  function doGateApply() {
    if (!gateCapture || busy) return;
    const flat = new Float32Array(gateCapture.text_seq + gateCapture.img_len);
    flat.fill(1.0);
    for (let i = 0; i < gateMaskValues.length; i++) flat[gateCapture.text_seq + i] = gateMaskValues[i];
    const msg = Object.assign({}, gateCapture.msgUsed);
    msg.captureGates = false;
    msg.gateMask = flat;
    setBusy(true);
    gateStatus('applying gate mask…');
    client.send(msg, (err, resp) => {
      setBusy(false);
      if (err) { gateStatus(String(err.message || err), 'err'); return; }
      drawGateResult(resp.bitmap, resp.width, resp.height);
      gateStatus('done · ' + (resp.ms || 0) + ' ms', 'ok');
      $('gate-timing').textContent = resp.ms ? resp.ms + ' ms' : '';
    });
  }

  // ── Spatial Paint tab ─────────────────────────────────────────────────
  const spPaintCanvas = $('sp-paint');
  const spPaintCtx = spPaintCanvas.getContext('2d');
  const spResultCanvas = $('sp-result');
  const spResultCtx = spResultCanvas.getContext('2d');

  function redrawSpPaint() {
    const w = spPaintCanvas.width, h = spPaintCanvas.height;
    spPaintCtx.clearRect(0, 0, w, h);
    spPaintCtx.drawImage(spBaseBitmap, 0, 0, w, h);
    spPaintCtx.save();
    spPaintCtx.globalCompositeOperation = 'screen';
    spPaintCtx.globalAlpha = 0.65;
    spPaintCtx.drawImage(spMaskCanvas, 0, 0, w, h);
    spPaintCtx.restore();
  }
  function spPointerToCanvas(e) {
    const rect = spPaintCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width * spPaintCanvas.width,
      y: (e.clientY - rect.top) / rect.height * spPaintCanvas.height,
    };
  }
  function spPaintAt(x, y) {
    const r = +$('sp-brush-radius').value;
    const mctx = spMaskCanvas.getContext('2d');
    mctx.globalCompositeOperation = 'source-over';
    mctx.fillStyle = '#ffffff';
    mctx.globalAlpha = 0.85;
    mctx.beginPath(); mctx.arc(x, y, r, 0, Math.PI * 2); mctx.fill();
    redrawSpPaint();
  }
  spPaintCanvas.addEventListener('pointerdown', (e) => {
    if (!spBaseBitmap) return;
    spDown = true;
    if (spPaintCanvas.setPointerCapture) spPaintCanvas.setPointerCapture(e.pointerId);
    const p = spPointerToCanvas(e); spPaintAt(p.x, p.y);
  });
  spPaintCanvas.addEventListener('pointermove', (e) => {
    if (!spDown || !spBaseBitmap) return;
    const p = spPointerToCanvas(e); spPaintAt(p.x, p.y);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
    spPaintCanvas.addEventListener(ev, () => { spDown = false; });
  });

  function doSpBase() {
    if (!loaded || busy) return;
    const prompt = $('sp-prompt').value.trim();
    if (!prompt) { spStatus('enter a prompt', 'err'); return; }
    const opts = {
      width: roundSize($('width').value), height: roundSize($('height').value),
      steps: +$('sp-steps').value || 4,
      guidanceScale: +$('guidance').value || DEFAULTS.guidance,
      seed: +$('sp-seed').value || 0,
      negativePrompt: $('neg-prompt').value.trim(),
    };
    persist();
    setBusy(true);
    spStatus('base render…');
    $('sp-timing').textContent = '';
    client.send({
      type: 'generate', prompt: prompt, negPrompt: opts.negativePrompt, opts: opts,
      band: 1.0, dial: { pregate: 1.0, prescale: 1.0 }, gate: { txtScale: 1.0, imgScale: 1.0 },
      axisControls: {},
      loraScales: loras.map((l) => +l.scale),
    }, (err, resp) => {
      setBusy(false);
      if (err) { spStatus(String(err.message || err), 'err'); return; }
      spBasePrompt = prompt; spBaseOpts = opts;
      spBaseBitmap = resp.bitmap;
      spPaintCanvas.width = resp.width; spPaintCanvas.height = resp.height;
      spMaskCanvas = document.createElement('canvas');
      spMaskCanvas.width = resp.width; spMaskCanvas.height = resp.height;
      redrawSpPaint();
      $('sp-hint').style.display = 'none';
      refreshButtons();
      spStatus('base rendered · ' + (resp.ms || 0) + ' ms — paint a region, pick an axis, then composite', 'ok');
    });
  }
  function doSpClear() {
    if (!spMaskCanvas) return;
    spMaskCanvas.getContext('2d').clearRect(0, 0, spMaskCanvas.width, spMaskCanvas.height);
    redrawSpPaint();
  }
  function buildSpatialMask(W_lat, H_lat) {
    const off = document.createElement('canvas');
    off.width = W_lat; off.height = H_lat;
    const octx = off.getContext('2d');
    octx.drawImage(spMaskCanvas, 0, 0, spBaseOpts.width, spBaseOpts.height, 0, 0, W_lat, H_lat);
    const id = octx.getImageData(0, 0, W_lat, H_lat);
    const out = new Float32Array(W_lat * H_lat);
    for (let i = 0; i < out.length; i++) out[i] = id.data[4 * i] / 255;
    return out;
  }
  function drawSpResult(bitmap, w, h) {
    if (spResultCanvas.width !== w || spResultCanvas.height !== h) {
      spResultCanvas.width = w; spResultCanvas.height = h;
    }
    spResultCtx.drawImage(bitmap, 0, 0);
    $('sp-result-hint').style.display = 'none';
  }
  function doSpGo() {
    if (!spBaseBitmap || busy) return;
    const axisName = $('sp-axis').value;
    if (!axisName) { spStatus('pick an axis', 'err'); return; }
    const strength = +$('sp-strength').value;
    const W_lat = spBaseOpts.width / VAE_SCALE, H_lat = spBaseOpts.height / VAE_SCALE;
    const maskData = buildSpatialMask(W_lat, H_lat);
    persist();
    setBusy(true);
    spStatus('compositing — two forwards per step…');
    client.send({
      type: 'spatialRender', basePrompt: spBasePrompt, opts: spBaseOpts,
      axisName: axisName, alpha: strength, maskW: W_lat, maskH: H_lat, maskData: maskData,
      loraScales: loras.map((l) => +l.scale),
    }, (err, resp) => {
      setBusy(false);
      if (err) { spStatus(String(err.message || err), 'err'); return; }
      drawSpResult(resp.bitmap, resp.width, resp.height);
      spStatus('done · ' + (resp.ms || 0) + ' ms', 'ok');
      $('sp-timing').textContent = resp.ms ? resp.ms + ' ms' : '';
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
    $('width').value = String(DEFAULTS.width);
    $('height').value = String(DEFAULTS.height);
    syncSize();
    persist();
  });
  $('btn-reset-axes').addEventListener('click', () => {
    for (const k in coreAxisEls) {
      if (!coreAxisEls.hasOwnProperty(k)) continue;
      coreAxisEls[k].range.value = '0';
      coreAxisEls[k].range.dispatchEvent(new Event('input'));
    }
    persist();
  });
  $('btn-browse-model').addEventListener('click', () => {
    const d = window.showOpenFolderDialog ? window.showOpenFolderDialog($('model-dir').value.trim()) : null;
    if (d) { $('model-dir').value = d; persist(); }
  });
  ['model-dir', 'prompt', 'neg-prompt', 'seed', 'steps', 'guidance', 'width', 'height']
    .forEach((id) => $(id).addEventListener('change', persist));

  // ── seed randomize + recent + history controls ─────────────────────────────
  $('rand-seed').addEventListener('change', persist);
  $('seed-recent').addEventListener('change', () => {
    const v = $('seed-recent').value;
    if (v !== '') reuseSeed(+v);
    $('seed-recent').value = '';
  });
  $('btn-hist-clear').addEventListener('click', clearHistory);
  $('btn-hist-save-all').addEventListener('click', saveAllHistory);
  refreshSeedRecent();
  renderHistory();

  // ── main-canvas viewport interactions: wheel zoom, drag pan, dbl-click fit ──
  // Wheel = plain zoom in/out about the image centre; drag does all repositioning.
  $('canvas-wrap').addEventListener('wheel', (e) => {
    e.preventDefault();
    viewUserZoomed = true;
    setScale(viewScale * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
  });
  let panning = false, panStartX = 0, panStartY = 0, panBaseX = 0, panBaseY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    panning = true; panStartX = e.clientX; panStartY = e.clientY;
    panBaseX = viewPanX; panBaseY = viewPanY;
    canvas.classList.add('grabbing');
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!panning) return;
    viewPanX = panBaseX + (e.clientX - panStartX);
    viewPanY = panBaseY + (e.clientY - panStartY);
    applyView();
  });
  const endPan = () => { panning = false; canvas.classList.remove('grabbing'); };
  canvas.addEventListener('pointerup', endPan);
  canvas.addEventListener('pointercancel', endPan);
  // Double-click toggles between an exact 100% (1:1) view and the default
  // fit-to-stage framing, so native-pixel viewing is always one gesture away.
  canvas.addEventListener('dblclick', () => {
    if (Math.abs(viewScale - 1.0) < 0.005) { resetView(); }
    else { viewUserZoomed = true; viewPanX = 0; viewPanY = 0; setScale(1.0); }
  });
  window.addEventListener('resize', () => {
    if (!(loaded || history.length)) return;
    // At the default framing, keep tracking the stage size; once the user has
    // zoomed, preserve their absolute scale (just re-clamp to the new bounds).
    if (viewUserZoomed) setScale(viewScale); else resetView();
  });

  // ── size: width × height, aspect presets, swap ─────────────────────────────
  function syncSize() {
    const w = roundSize($('width').value), h = roundSize($('height').value);
    const mp = (w * h / 1e6).toFixed(2);
    $('size-note').textContent = '· ' + mp + ' MP';
    // Highlight a preset chip when the current size matches it exactly.
    const chips = $('ratio-chips').querySelectorAll('button');
    for (const c of chips) {
      const cw = +c.dataset.w, ch = +c.dataset.h;
      c.classList.toggle('active', (cw === w && ch === h) || (ch === w && cw === h));
    }
  }
  function applySize(w, h, full) {
    $('width').value = roundSize(w);
    $('height').value = roundSize(h);
    syncSize(); persist();
    if (live) schedule(full ? 'full' : 'preview');
  }
  $('width').addEventListener('input', syncSize);
  $('height').addEventListener('input', syncSize);
  // Normalize to the /16 grid only once the user commits (change), not mid-type.
  $('width').addEventListener('change', () => applySize($('width').value, $('height').value, true));
  $('height').addEventListener('change', () => applySize($('width').value, $('height').value, true));
  $('btn-swap-size').addEventListener('click', () => applySize($('height').value, $('width').value, true));
  $('ratio-chips').querySelectorAll('button').forEach((c) => {
    c.addEventListener('click', () => {
      // Second click on the active chip flips its orientation.
      const w = +c.dataset.w, h = +c.dataset.h;
      if (c.classList.contains('active') && +$('width').value !== h) applySize(h, w, true);
      else applySize(w, h, true);
    });
  });
  syncSize();
  $('prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doGenerate(); }
  });
  $('live').addEventListener('change', () => {
    live = $('live').checked; persist();
    if (live) schedule('full');
  });

  $('btn-lora-add').addEventListener('click', addLora);

  $('btn-mint-text').addEventListener('click', doMintText);
  $('btn-mint-image').addEventListener('click', doMintImage);
  $('btn-mint-pick-a').addEventListener('click', () => pickMintImage('a'));
  $('btn-mint-pick-b').addEventListener('click', () => pickMintImage('b'));
  $('btn-mint-clear-a').addEventListener('click', () => clearMintSlot('a'));
  $('btn-mint-clear-b').addEventListener('click', () => clearMintSlot('b'));
  $('btn-goto-imgaxis').addEventListener('click', () => switchTab('imgaxis'));

  $('btn-gate-capture').addEventListener('click', doGateCapture);
  $('btn-gate-clear').addEventListener('click', doGateClear);
  $('btn-gate-apply').addEventListener('click', doGateApply);

  $('btn-sp-base').addEventListener('click', doSpBase);
  $('btn-sp-clear').addEventListener('click', doSpClear);
  $('btn-sp-go').addEventListener('click', doSpGo);
  ['sp-prompt', 'sp-seed', 'sp-steps', 'sp-axis', 'sp-strength'].forEach((id) => $(id).addEventListener('change', persist));

  // ── boot ─────────────────────────────────────────────────────────────────
  renderAxisManager();
  renderLoraList();   // persisted entries show immediately; applied on load
  refreshButtons();
  canvas.style.display = 'none';   // no empty canvas box until the first render
  fetch('assets/axes_meta.json').then((r) => r.json()).then((meta) => {
    axesMeta = meta;
    buildAxisBank(meta);
    refreshSpAxisOptions();
    // axis-bank sliders now exist — restore any persisted values
    if (prefs.axisBank) {
      for (const k in prefs.axisBank) {
        if (coreAxisEls[k]) { coreAxisEls[k].range.value = prefs.axisBank[k]; coreAxisEls[k].range.dispatchEvent(new Event('input')); }
      }
    }
  }).catch((e) => { status('failed to load axes_meta.json: ' + e.message, 'err'); });

  client.onReady(() => {
    status('ready — load a model to begin');
    if ($('model-dir').value.trim()) doLoad();
  });
}

installSystemMenu();
init();
