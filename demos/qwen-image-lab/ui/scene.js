// Scene panel: the size fields with the two research presets, and the
// condition-image slots that turn a text render into an edit.
//
// A condition image enters the model twice — through the Qwen3-VL vision tower
// (the chat template reserves a run of <|image_pad|> rows per image, so the
// prompt resolves against what the encoder saw) and through the 16x RGBA
// autoencoder (whose latents join the DiT's joint sequence and carry the
// pixels). The joint sequence is [text | image0 | ... | target], and text and
// condition rows both modulate from t = 0, so the WHOLE prefix caches exactly
// as a text-only one does.

import { $, toChwFp32, fileToImageData, paintThumbInto } from '/app/ui/util.js';

export function initScene(ctx) {
  const prefs = ctx.prefs;

  // ── size ────────────────────────────────────────────────────────────────
  function syncSize() {
    const w = ctx.roundSize($('width').value), h = ctx.roundSize($('height').value);
    $('size-note').textContent = '· ' + (w * h / 1e6).toFixed(2) + ' MP';
    const steps = +$('steps').value;
    $('preset-chips').querySelectorAll('button').forEach((c) => {
      c.classList.toggle('active', +c.dataset.w === w && +c.dataset.h === h && +c.dataset.steps === steps);
    });
    $('ratio-chips').querySelectorAll('button').forEach((c) => {
      const cw = +c.dataset.w, ch = +c.dataset.h;
      c.classList.toggle('active', (cw === w && ch === h) || (ch === w && cw === h));
    });
  }
  function applySize(w, h, steps) {
    $('width').value = ctx.roundSize(w);
    $('height').value = ctx.roundSize(h);
    if (steps) $('steps').value = String(steps);
    syncSize(); ctx.persist();
    if (ctx.live) ctx.schedule('full');
  }
  $('width').addEventListener('input', syncSize);
  $('height').addEventListener('input', syncSize);
  $('steps').addEventListener('input', syncSize);
  $('width').addEventListener('change', () => applySize($('width').value, $('height').value));
  $('height').addEventListener('change', () => applySize($('width').value, $('height').value));
  $('btn-swap-size').addEventListener('click', () => applySize($('height').value, $('width').value));
  $('preset-chips').querySelectorAll('button').forEach((c) => {
    c.addEventListener('click', () => applySize(+c.dataset.w, +c.dataset.h, +c.dataset.steps));
  });
  $('ratio-chips').querySelectorAll('button').forEach((c) => {
    c.addEventListener('click', () => {
      const w = +c.dataset.w, h = +c.dataset.h;
      // Second click on the active chip flips its orientation.
      if (c.classList.contains('active') && +$('width').value !== h) applySize(h, w);
      else applySize(w, h);
    });
  });
  $('btn-reset-settings').addEventListener('click', () => {
    $('seed').value = ctx.DEFAULTS.seed;
    $('steps').value = ctx.DEFAULTS.steps;
    $('guidance').value = ctx.DEFAULTS.guidance;
    applySize(ctx.DEFAULTS.width, ctx.DEFAULTS.height);
  });

  // ── condition images ────────────────────────────────────────────────────
  // [{id, path?, pixels?, width, height, label}] in chat-template order.
  let conds = [];
  let seq = 0;

  if (prefs.condDerive != null) $('cond-derive').checked = !!prefs.condDerive;
  if (prefs.condOutRes != null) $('cond-outres').value = prefs.condOutRes;

  function renderConds() {
    const host = $('cond-list');
    host.innerHTML = '';
    if (!conds.length) {
      const e = document.createElement('div');
      e.className = 'cond-empty';
      e.textContent = 'Text only — add a picture to edit it instead.';
      host.appendChild(e);
    } else {
      conds.forEach((c, i) => {
        const item = document.createElement('div');
        item.className = 'cond-item';
        const thumb = document.createElement('div');
        thumb.className = 'imgpick-thumb cond-thumb';
        if (c.thumb) paintThumbInto(thumb, c.thumb, c.width, c.height);
        const body = document.createElement('div');
        body.className = 'cond-body';
        const nm = document.createElement('div');
        nm.className = 'cond-name';
        nm.textContent = (i + 1) + '. ' + c.label;
        nm.title = c.path || 'from the canvas';
        const dims = document.createElement('div');
        dims.className = 'dim';
        dims.textContent = c.width + '×' + c.height;
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'link';
        del.textContent = 'remove';
        del.addEventListener('click', () => removeCond(c.id));
        body.appendChild(nm); body.appendChild(dims); body.appendChild(del);
        item.appendChild(thumb); item.appendChild(body);
        host.appendChild(item);
      });
    }
    $('btn-cond-clear').disabled = conds.length === 0;
    ctx.refreshDeck();
  }

  function addPath(path) {
    if (!path) return;
    let img;
    try { img = fileToImageData(path); }
    catch (e) { ctx.status(String(e.message || e), 'err'); return; }
    conds.push({ id: ++seq, path: path, width: img.width, height: img.height,
                 label: path.replace(/[\\/]+$/, '').split(/[\\/]/).pop(), thumb: img });
    renderConds(); ctx.persist();
    if (ctx.live) ctx.schedule('full');
  }
  function addCanvas(imageData, label) {
    const t = toChwFp32(imageData);
    conds.push({ id: ++seq, pixels: t.pixels, width: t.width, height: t.height,
                 channels: 3, label: label || 'current render', thumb: imageData });
    renderConds(); ctx.persist();
    if (ctx.live) ctx.schedule('full');
  }
  function removeCond(id) {
    conds = conds.filter((c) => c.id !== id);
    renderConds(); ctx.persist();
    if (ctx.live) ctx.schedule('full');
  }

  $('btn-cond-add').addEventListener('click', () => {
    addPath($('cond-path').value.trim());
    $('cond-path').value = '';
  });
  $('cond-path').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('btn-cond-add').click(); }
  });
  $('btn-cond-browse').addEventListener('click', () => {
    if (!window.showOpenFileDialog) { ctx.status('file dialog unavailable in this build', 'err'); return; }
    const picked = window.showOpenFileDialog('Image|png;jpg;jpeg;webp;bmp');
    if (picked && picked.length) addPath(picked[0]);
  });
  $('btn-cond-use-render').addEventListener('click', () => {
    const frame = ctx.lastFrame();
    if (!frame) { ctx.status('render something first', 'err'); return; }
    addCanvas(frame, 'render ' + frame.width + '×' + frame.height);
  });
  $('btn-cond-clear').addEventListener('click', () => {
    if (!conds.length) return;
    conds = [];
    renderConds(); ctx.persist();
    if (ctx.live) ctx.schedule('full');
  });
  $('cond-derive').addEventListener('change', () => {
    ctx.persist();
    if (ctx.live) ctx.schedule('full');
  });
  $('cond-outres').addEventListener('change', () => {
    ctx.persist();
    if (ctx.live && $('cond-derive').checked) ctx.schedule('full');
  });

  // The condition images are not a slider, but they change what the model is
  // told — so they wear a deck chip like everything else.
  ctx.registerEntry({
    section: 'scene',
    active: () => conds.length > 0,
    chip: () => conds.length === 1 ? 'edit · 1 image' : 'edit · ' + conds.length + ' images',
    chipValue: () => '',
    zero: (opts) => {
      conds = []; renderConds(); ctx.persist();
      if ((!opts || !opts.silent) && ctx.live) ctx.schedule('full');
    },
    reveal: () => ctx.switchSection('scene'),
  });

  ctx.onRefreshButtons((busyOrUnloaded) => {
    $('btn-cond-use-render').disabled = busyOrUnloaded || !ctx.lastFrame();
  });
  ctx.onPersist((p) => {
    p.condPaths = conds.filter((c) => c.path).map((c) => c.path);
    p.condDerive = $('cond-derive').checked;
    p.condOutRes = $('cond-outres').value;
  });
  ctx.onGenerateMsg((msg) => {
    if (!conds.length) return;
    msg.conditionImages = conds.map((c) => (c.path
      ? { path: c.path }
      : { pixels: c.pixels, width: c.width, height: c.height, channels: c.channels || 3 }));
  });

  ctx.deriveSize = () => $('cond-derive').checked && conds.length > 0;
  ctx.outputResolution = () => +$('cond-outres').value || 1024;
  ctx.conditionCount = () => conds.length;
  ctx.addConditionPath = addPath;     // test seam: the same path the + button takes

  // restore persisted condition paths (pixels-only entries do not persist —
  // they were a canvas, and the canvas is gone)
  (Array.isArray(prefs.condPaths) ? prefs.condPaths : []).forEach((p) => {
    try {
      const img = fileToImageData(p);
      conds.push({ id: ++seq, path: p, width: img.width, height: img.height,
                   label: p.replace(/[\\/]+$/, '').split(/[\\/]/).pop(), thumb: img });
    } catch (e) { /* the file moved — drop it silently */ }
  });
  renderConds();
  syncSize();
}
