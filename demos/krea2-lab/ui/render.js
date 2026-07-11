// Render tab: the main view canvas (absolute-scale zoom + pan viewport),
// seed randomize + recent-seed reuse, the render-history rail, and the
// width × height size fields with aspect presets.

import { $ } from '/app/ui/util.js';

export function initRender(ctx) {
  const prefs = ctx.prefs;

  const canvas = $('view');
  const cctx = canvas.getContext('2d');

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

  if (prefs.randSeed != null) $('rand-seed').checked = !!prefs.randSeed;

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
    // Clamp the pan so at least a sliver of the image always stays inside
    // the stage — an image dragged (or glitched) fully out of view is
    // unrecoverable by mouse.
    const MARGIN = 48;
    const maxPanX = Math.max(0, (wrap.clientWidth + dw) / 2 - MARGIN);
    const maxPanY = Math.max(0, (wrap.clientHeight + dh) / 2 - MARGIN);
    viewPanX = Math.max(-maxPanX, Math.min(maxPanX, viewPanX));
    viewPanY = Math.max(-maxPanY, Math.min(maxPanY, viewPanY));
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
    ctx.persist();
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
        ctx.status('viewing history · seed ' + h.seed + ' · ' + h.width + '×' + h.height, 'ok');
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
      const exemplar = document.createElement('button');
      exemplar.className = 'link'; exemplar.textContent = 'exemplar';
      exemplar.title = 'add this render to the identity model (Identity Search tab)';
      exemplar.addEventListener('click', () => {
        if (ctx.addIdentityExemplar) ctx.addIdentityExemplar(h.canvas, h.w, h.h);
      });
      const del = document.createElement('button');
      del.className = 'link hist-del'; del.textContent = 'delete';
      del.title = 'remove this render from history';
      del.addEventListener('click', () => deleteHistoryEntry(h.id));
      actions.appendChild(save); actions.appendChild(exemplar); actions.appendChild(del);
      body.appendChild(metaRow); body.appendChild(actions);
      item.appendChild(h.canvas); item.appendChild(body);
      list.appendChild(item);
    });
    refreshHistButtons();
    ctx.renderMintGallery();
  }
  function reuseSeed(seed) {
    $('seed').value = String(seed);
    $('rand-seed').checked = false;
    recordSeed(seed);
    ctx.persist();
    if (ctx.live && ctx.loaded) ctx.schedule('full');
  }
  function saveHistoryImage(h) {
    if (typeof window.showSaveFileDialog !== 'function') {
      ctx.status('save dialog unavailable in this build', 'err'); return;
    }
    const name = 'krea2_' + h.seed + '_' + h.width + 'x' + h.height + '.png';
    const path = window.showSaveFileDialog('PNG Image|png', name);
    if (!path) return;   // cancelled
    try {
      const px = h.canvas.getContext('2d').getImageData(0, 0, h.w, h.h);
      bro.image.encodePngFile(path, px.data, h.w, h.h, 4);
      ctx.status('saved ' + path, 'ok');
    } catch (e) {
      ctx.status('save failed: ' + (e.message || e), 'err');
    }
  }
  function saveAllHistory() {
    if (typeof window.showOpenFolderDialog !== 'function') {
      ctx.status('folder dialog unavailable in this build', 'err'); return;
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
    ctx.status('saved ' + n + ' image' + (n === 1 ? '' : 's') + ' to ' + dir, n ? 'ok' : 'err');
  }
  function deleteHistoryEntry(id) {
    history = history.filter((h) => h.id !== id);
    // Drop it from the mint pair too if it was one of the chosen images.
    ['a', 'b'].forEach((which) => { if (ctx.mintSelId[which] === id) ctx.clearMintSlot(which); });
    renderHistory();
  }
  function clearHistory() {
    history = [];
    if (ctx.mintSelId.a != null) ctx.clearMintSlot('a');
    if (ctx.mintSelId.b != null) ctx.clearMintSlot('b');
    renderHistory();
  }

  $('btn-reset-settings').addEventListener('click', () => {
    $('seed').value = ctx.DEFAULTS.seed;
    $('steps').value = ctx.DEFAULTS.steps;
    $('guidance').value = ctx.DEFAULTS.guidance;
    $('width').value = String(ctx.DEFAULTS.width);
    $('height').value = String(ctx.DEFAULTS.height);
    syncSize();
    ctx.persist();
  });

  // ── seed randomize + recent + history controls ─────────────────────────────
  $('rand-seed').addEventListener('change', ctx.persist);
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
    if (e.button !== 0) return;
    panning = true; panStartX = e.clientX; panStartY = e.clientY;
    panBaseX = viewPanX; panBaseY = viewPanY;
    canvas.classList.add('grabbing');
    // Pointer capture keeps the drag's move/up events coming here even when
    // the cursor leaves the canvas — without it a release off-canvas left
    // `panning` latched and every later hover move dragged the image.
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!panning) return;
    // Self-heal: no button held means the release never reached us.
    if (!(e.buttons & 1)) { endPan(); return; }
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
    if (!(ctx.loaded || history.length)) return;
    // At the default framing, keep tracking the stage size; once the user has
    // zoomed, preserve their absolute scale (just re-clamp to the new bounds).
    if (viewUserZoomed) setScale(viewScale); else resetView();
  });

  // ── size: width × height, aspect presets, swap ─────────────────────────────
  function syncSize() {
    const w = ctx.roundSize($('width').value), h = ctx.roundSize($('height').value);
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
    $('width').value = ctx.roundSize(w);
    $('height').value = ctx.roundSize(h);
    syncSize(); ctx.persist();
    if (ctx.live) ctx.schedule(full ? 'full' : 'preview');
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

  ctx.drawBitmap = drawBitmap;
  ctx.recordSeed = recordSeed;
  ctx.addHistoryEntry = addHistoryEntry;
  ctx.randomSeed = randomSeed;
  Object.defineProperty(ctx, 'history', { get: () => history });
  ctx.onPersist((p) => {
    p.randSeed = $('rand-seed').checked; p.seedHistory = seedHistory;
  });
}
