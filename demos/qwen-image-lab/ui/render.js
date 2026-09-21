// Render tab: the main view canvas (absolute-scale zoom + pan), seed
// randomize + recent-seed reuse, the render history with save, and the A/B
// toggle against the desk's pinned baseline.

import { $, pixelMse, retention } from '/app/ui/util.js';

export function initRender(ctx) {
  const prefs = ctx.prefs;

  const canvas = $('view');
  const cctx = canvas.getContext('2d');

  const SEED_MAX = 2147483647;
  const SEED_HISTORY_MAX = 10;
  const HISTORY_MAX = 24;
  let seedHistory = Array.isArray(prefs.seedHistory) ? prefs.seedHistory.slice(0, SEED_HISTORY_MAX) : [];
  let history = [];       // [{id, canvas, w, h, seed, steps}], newest first
  let histSeq = 0;
  let lastFrame = null;   // ImageData of the current render
  let showingBaseline = false;

  // ── viewport ────────────────────────────────────────────────────────────
  // viewScale is CSS px per image px, so 1.0 is a true 100% view. A fresh image
  // opens at native size unless it is bigger than the stage.
  let viewW = 512, viewH = 512;
  let viewScale = 1, viewUserZoomed = false, viewPanX = 0, viewPanY = 0;
  let zoomHideTimer = null;

  if (prefs.randSeed != null) $('rand-seed').checked = !!prefs.randSeed;

  function drawInto(src, w, h) {
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (src instanceof ImageData) cctx.putImageData(src, 0, 0);
    else cctx.drawImage(src, 0, 0);
    canvas.style.display = '';
    $('view-hint').style.display = 'none';
    if (w !== viewW || h !== viewH) { viewW = w; viewH = h; resetView(); }
    else applyView();
  }
  function drawBitmap(bitmap, w, h) {
    drawInto(bitmap, w, h);
    lastFrame = cctx.getImageData(0, 0, w, h);
    showingBaseline = false;
    $('ab-note').textContent = '';
    ctx.refreshButtons();
  }

  function fitScale() {
    const wrap = $('canvas-wrap');
    const availW = wrap.clientWidth - 16, availH = wrap.clientHeight - 16;
    if (viewW <= 0 || viewH <= 0 || availW <= 0 || availH <= 0) return 1;
    return Math.min(availW / viewW, availH / viewH);
  }
  const defaultScale = () => Math.min(1, fitScale());
  const minScale = () => Math.min(1, fitScale());
  const maxScale = () => Math.max(1, fitScale()) * 8;
  const clampScale = (s) => Math.max(minScale(), Math.min(maxScale(), s));
  function applyView() {
    const wrap = $('canvas-wrap');
    const s = viewScale;
    const dw = viewW * s, dh = viewH * s;
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
    zoomHideTimer = setInterval(() => {
      z.classList.remove('show'); clearInterval(zoomHideTimer); zoomHideTimer = null;
    }, 1100);
  }

  // ── seed ────────────────────────────────────────────────────────────────
  const randomSeed = () => Math.floor(Math.random() * SEED_MAX);
  function refreshSeedRecent() {
    const sel = $('seed-recent');
    sel.innerHTML = '<option value="">recent…</option>';
    seedHistory.forEach((s) => {
      const o = document.createElement('option');
      o.value = String(s); o.textContent = String(s);
      sel.appendChild(o);
    });
    sel.value = '';
  }
  function recordSeed(seed) {
    if (seedHistory[0] === seed) return;
    seedHistory = seedHistory.filter((s) => s !== seed);
    seedHistory.unshift(seed);
    if (seedHistory.length > SEED_HISTORY_MAX) seedHistory.length = SEED_HISTORY_MAX;
    refreshSeedRecent();
    ctx.persist();
  }
  function reuseSeed(seed) {
    $('seed').value = String(seed);
    $('rand-seed').checked = false;
    recordSeed(seed);
    ctx.persist();
    if (ctx.live && ctx.loaded) ctx.schedule('full');
  }

  // ── history ─────────────────────────────────────────────────────────────
  function refreshHistButtons() {
    const empty = history.length === 0;
    $('btn-hist-clear').disabled = empty;
    $('btn-hist-save-all').disabled = empty;
  }
  function addHistoryEntry(bitmap, w, h, meta) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(bitmap, 0, 0);
    history.unshift({ id: ++histSeq, canvas: c, w: w, h: h, seed: meta.seed, steps: meta.steps,
                      // Every render carries the message that made it and the
                      // rack that built the message: the manifest is written
                      // from these, and "load a manifest" puts them back.
                      msg: meta.msg || null, controls: meta.controls || null,
                      at: meta.at || Date.now() });
    if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
    renderHistory();
  }
  function renderHistory() {
    const list = $('hist-list');
    list.innerHTML = '';
    if (!history.length) {
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
      h.canvas.title = 'click to view';
      h.canvas.onclick = () => {
        drawInto(h.canvas, h.w, h.h);
        ctx.status('viewing history · seed ' + h.seed + ' · ' + h.w + '×' + h.h, 'ok');
      };
      const body = document.createElement('div');
      body.className = 'hist-body';
      const metaRow = document.createElement('div');
      metaRow.className = 'hist-meta';
      const dims = document.createElement('span');
      dims.textContent = h.w + '×' + h.h + ' · ' + h.steps + 'st';
      const seed = document.createElement('span');
      seed.className = 'hist-seed'; seed.textContent = 'seed ' + h.seed;
      seed.title = 'reuse this seed (pins it — turns off randomize)';
      seed.addEventListener('click', () => reuseSeed(h.seed));
      metaRow.appendChild(dims); metaRow.appendChild(seed);
      const actions = document.createElement('div');
      actions.className = 'hist-actions';
      const save = document.createElement('button');
      save.className = 'link'; save.textContent = 'save';
      save.addEventListener('click', () => saveImage(h.canvas, h.w, h.h, h.seed));
      const del = document.createElement('button');
      del.className = 'link hist-del'; del.textContent = 'delete';
      del.addEventListener('click', () => {
        history = history.filter((x) => x.id !== h.id);
        renderHistory();
      });
      actions.appendChild(save); actions.appendChild(del);
      body.appendChild(metaRow); body.appendChild(actions);
      item.appendChild(h.canvas); item.appendChild(body);
      list.appendChild(item);
    });
    refreshHistButtons();
  }

  function saveImage(cnv, w, h, seed) {
    if (typeof window.showSaveFileDialog !== 'function') {
      ctx.status('save dialog unavailable in this build', 'err'); return;
    }
    const name = 'qwen21_' + seed + '_' + w + 'x' + h + '.png';
    const path = window.showSaveFileDialog('PNG Image|png', name);
    if (!path) return;
    try {
      const px = cnv.getContext('2d').getImageData(0, 0, w, h);
      bro.image.encodePngFile(path, px.data, w, h, 4);
      ctx.status('saved ' + path, 'ok');
    } catch (e) {
      ctx.status('save failed: ' + (e.message || e), 'err');
    }
  }
  // ── A/B against the pinned baseline ─────────────────────────────────────
  // The baseline is the desk's: the last render made with every fader at zero,
  // or whatever "pin baseline" pinned. Toggling swaps the canvas and prints
  // what changed, so a control's effect is one click to see and one to undo.
  function toggleAb() {
    const base = ctx.baselineFrame();
    if (!base || !lastFrame) { ctx.status('need a baseline and a render', 'err'); return; }
    if (base.width !== lastFrame.width || base.height !== lastFrame.height) {
      ctx.status('baseline is a different size — re-pin it', 'err'); return;
    }
    showingBaseline = !showingBaseline;
    drawInto(showingBaseline ? base : lastFrame, lastFrame.width, lastFrame.height);
    $('ab-note').textContent = showingBaseline
      ? 'showing the baseline · mse ' + pixelMse(base, lastFrame).toFixed(0) +
        ' · retention ' + retention(base, lastFrame).toFixed(3)
      : 'showing this render';
  }

  $('btn-ab').addEventListener('click', toggleAb);
  $('btn-save').addEventListener('click', () => {
    if (!lastFrame) return;
    saveImage(canvas, lastFrame.width, lastFrame.height, +$('seed').value || 0);
  });
  $('rand-seed').addEventListener('change', ctx.persist);
  $('seed-recent').addEventListener('change', () => {
    const v = $('seed-recent').value;
    if (v !== '') reuseSeed(+v);
    $('seed-recent').value = '';
  });
  $('btn-hist-clear').addEventListener('click', () => { history = []; renderHistory(); });
  refreshSeedRecent();
  renderHistory();

  // ── viewport interactions ───────────────────────────────────────────────
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
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!panning) return;
    if (!(e.buttons & 1)) { endPan(); return; }
    viewPanX = panBaseX + (e.clientX - panStartX);
    viewPanY = panBaseY + (e.clientY - panStartY);
    applyView();
  });
  const endPan = () => { panning = false; canvas.classList.remove('grabbing'); };
  canvas.addEventListener('pointerup', endPan);
  canvas.addEventListener('pointercancel', endPan);
  canvas.addEventListener('dblclick', () => {
    if (Math.abs(viewScale - 1.0) < 0.005) resetView();
    else { viewUserZoomed = true; viewPanX = 0; viewPanY = 0; setScale(1.0); }
  });
  window.addEventListener('resize', () => {
    if (!(ctx.loaded || history.length)) return;
    if (viewUserZoomed) setScale(viewScale); else resetView();
  });

  // Render one message without touching the main canvas or the history — the
  // primitive every strip and grid in the lab is built from (the prefix walk,
  // the explore grid, the spatial composite). It marks the app busy so the
  // deck's Generate cannot race it, and hands back the decoded frame.
  function renderOffscreen(msg, cb) {
    if (!ctx.loaded) { cb(new Error('no model loaded')); return; }
    ctx.setBusy(true);
    const t0 = Date.now();
    ctx.client.send(msg, (err, resp) => {
      ctx.setBusy(false);
      if (err) { cb(err); return; }
      const c = document.createElement('canvas');
      c.width = resp.width; c.height = resp.height;
      c.getContext('2d').drawImage(resp.bitmap, 0, 0);
      cb(null, c.getContext('2d').getImageData(0, 0, resp.width, resp.height),
         resp, Date.now() - t0);
    });
  }

  ctx.renderOffscreen = renderOffscreen;
  ctx.refreshHistory = renderHistory;
  ctx.drawBitmap = drawBitmap;
  ctx.recordSeed = recordSeed;
  ctx.addHistoryEntry = addHistoryEntry;
  ctx.randomSeed = randomSeed;
  ctx.lastFrame = () => lastFrame;
  Object.defineProperty(ctx, 'history', { get: () => history });
  ctx.onRefreshButtons(() => {
    $('btn-save').disabled = !lastFrame;
    $('btn-ab').disabled = !lastFrame || !ctx.baselineFrame();
  });
  ctx.onPersist((p) => {
    p.randSeed = $('rand-seed').checked; p.seedHistory = seedHistory;
  });
}
