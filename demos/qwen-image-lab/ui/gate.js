// The gate section and the Gate Paint tab.
//
// Every block has two gated residuals — the attention sublayer's and the
// SwiGLU's — and every one of them passes through tanh. Three hooks sit on
// that value:
//
//   scale rows   four independent post-tanh multipliers, one per (sublayer,
//                row set) pair. attnImg is the single most useful dial on the
//                model and the only one that still works armed late (127% of
//                its step-0 effect at step 6 of 8). The txt multipliers are
//                prefix-side: moving one re-extracts the prefix K/V cache.
//   delta        a post-tanh ADD, which has unit authority on every channel —
//                including the 74% of the gate2 chunk where tanh' < 0.05 and a
//                modulation delta can do nothing. A gate above 1 is not
//                reachable any other way.
//   mask         one multiplier per JOINT-SEQUENCE row, i.e. per 16x16 pixel
//                square of the canvas. The model's only spatial hook: 95% of
//                its pixel change lands inside a region covering 28% of the
//                frame, and localisation improves the later it is armed
//                (0.82 -> 0.95 from step 0 to step 6). The image half is free
//                mid-denoise; the text half only lands on the extract step.

import { $, retention, pixelMse } from '/app/ui/util.js';

export function initGate(ctx) {
  const prefs = ctx.prefs;
  const G = (k, d) => (prefs.gate && prefs.gate[k] != null ? +prefs.gate[k] : d);

  // ── the four multipliers ────────────────────────────────────────────────
  const rows = {};
  const mk = (id, label, title) => ctx.buildCtl({
    label: label, title: title, id: id, key: id, lane: 'gateRows',
    min: 0, max: 2, step: 0.05, neutral: 1.0,
    value: G(id, 1.0),
    host: $('gate-rows'), section: 'gate',
    commit: () => {},
  });
  rows.attnTxt = mk('gate-attn-txt', 'attn · txt rows',
    'the attention gate on the t=0 rows (text / condition images) — prefix-side, re-extracts');
  rows.attnImg = mk('gate-attn-img', 'attn · img rows',
    'the attention gate on the sampled-t rows — restyles without redirecting, and the only dial that survives being armed late');
  rows.mlpTxt = mk('gate-mlp-txt', 'mlp · txt rows',
    'the SwiGLU gate on the t=0 rows — prefix-side, re-extracts');
  rows.mlpImg = mk('gate-mlp-img', 'mlp · img rows',
    'the SwiGLU gate on the sampled-t rows');

  // The band is a modifier on the multipliers above, not a control of its own,
  // so it builds no deck chip.
  const band = {
    lo: ctx.buildCtl({ label: 'first block', id: 'gate-lo', min: 0, max: 31, step: 1,
                       neutral: 0, decimals: 0, value: G('gate-lo', 0),
                       host: $('gate-band-rows'), commit: () => {} }),
    hi: ctx.buildCtl({ label: 'one past the last', id: 'gate-hi', min: 1, max: 32, step: 1,
                       neutral: 32, decimals: 0, value: G('gate-hi', 32),
                       host: $('gate-band-rows'), commit: () => {} }),
  };

  // ── the post-tanh delta ─────────────────────────────────────────────────
  const delta = {
    attn: ctx.buildCtl({ label: 'attn gate delta', id: 'gd-attn', key: 'gd-attn',
                         lane: 'gateDelta',
                         title: 'added to the effective attention gate, after the tanh and after every scale',
                         min: -0.5, max: 0.5, step: 0.01, value: G('gd-attn', 0),
                         host: $('gate-delta-rows'), section: 'gate', commit: () => {} }),
    mlp: ctx.buildCtl({ label: 'mlp gate delta', id: 'gd-mlp', key: 'gd-mlp',
                        lane: 'gateDelta',
                        title: 'added to the effective SwiGLU gate — the channels a mod delta cannot move',
                        min: -0.5, max: 0.5, step: 0.01, value: G('gd-mlp', 0),
                        host: $('gate-delta-rows'), section: 'gate', commit: () => {} }),
  };

  // ── the mask's block band ───────────────────────────────────────────────
  // The screen's default is [16, 32) armed at step 4.
  const maskBand = {
    lo: ctx.buildCtl({ label: 'mask first block', id: 'mask-lo', min: 0, max: 31, step: 1,
                       neutral: 16, decimals: 0, value: G('mask-lo', 16),
                       host: $('gate-mask-rows'), commit: () => {} }),
    hi: ctx.buildCtl({ label: 'mask one past last', id: 'mask-hi', min: 1, max: 32, step: 1,
                       neutral: 32, decimals: 0, value: G('mask-hi', 32),
                       host: $('gate-mask-rows'), commit: () => {} }),
  };

  $('btn-reset-gate').addEventListener('click', () => {
    let any = false;
    [rows.attnTxt, rows.attnImg, rows.mlpTxt, rows.mlpImg].forEach((h) => {
      if (h.value !== 1) any = true;
      h.set(1, { silent: true });
    });
    [delta.attn, delta.mlp].forEach((h) => {
      if (h.value !== 0) any = true;
      h.set(0, { silent: true });
    });
    if (any && ctx.live) ctx.schedule('full');
  });

  // ── the painted mask ────────────────────────────────────────────────────
  let cells = null;        // Float32Array(wp*hp) of multipliers, 1 = untouched
  let grid = { wp: 0, hp: 0, width: 0, height: 0 };
  let baseFrame = null;    // ImageData of the captured render
  let painting = false;

  const paint = $('gp-paint'), result = $('gp-result'), baseCv = $('gp-base');

  function maskActive() {
    if (!cells) return false;
    for (let i = 0; i < cells.length; i++) if (cells[i] !== 1) return true;
    return false;
  }
  function paintedCount() {
    let n = 0;
    if (cells) for (let i = 0; i < cells.length; i++) if (cells[i] !== 1) n++;
    return n;
  }

  function gpStatus(text, kind) {
    const el = $('gp-status-text'); el.textContent = text; el.className = kind || '';
  }

  function setBase(frame) {
    baseFrame = frame;
    grid = { wp: Math.floor(frame.width / 16), hp: Math.floor(frame.height / 16),
             width: frame.width, height: frame.height };
    cells = new Float32Array(grid.wp * grid.hp).fill(1);
    [paint, result, baseCv].forEach((c) => { c.width = frame.width; c.height = frame.height; });
    baseCv.getContext('2d').putImageData(frame, 0, 0);
    redrawOverlay();
    $('gp-hint').style.display = 'none';
    $('gp-result-hint').style.display = '';
    result.getContext('2d').clearRect(0, 0, result.width, result.height);
    ctx.refreshDeck();
  }

  function redrawOverlay() {
    if (!baseFrame) return;
    const c = paint.getContext('2d');
    c.putImageData(baseFrame, 0, 0);
    for (let y = 0; y < grid.hp; y++) {
      for (let x = 0; x < grid.wp; x++) {
        const v = cells[y * grid.wp + x];
        if (v === 1) continue;
        const a = Math.min(0.55, Math.abs(v - 1) * 0.8);
        c.fillStyle = v > 1 ? 'rgba(255,150,40,' + a + ')' : 'rgba(60,150,255,' + a + ')';
        c.fillRect(x * 16, y * 16, 16, 16);
      }
    }
  }

  function cellAt(clientX, clientY) {
    const r = paint.getBoundingClientRect();
    const x = (clientX - r.x) * (paint.width / r.width);
    const y = (clientY - r.y) * (paint.height / r.height);
    return { cx: Math.floor(x / 16), cy: Math.floor(y / 16) };
  }
  function stroke(clientX, clientY) {
    if (!cells) return;
    const { cx, cy } = cellAt(clientX, clientY);
    const rad = +$('gp-radius').value || 1;
    const amt = +$('gp-amount').value;
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= grid.wp || y >= grid.hp) continue;
        if (dx * dx + dy * dy > rad * rad) continue;
        cells[y * grid.wp + x] = amt;
      }
    }
    redrawOverlay();
  }

  paint.addEventListener('pointerdown', (e) => {
    if (!cells) return;
    painting = true;
    if (paint.setPointerCapture) { try { paint.setPointerCapture(e.pointerId); } catch (_) {} }
    stroke(e.clientX, e.clientY);
  });
  paint.addEventListener('pointermove', (e) => { if (painting) stroke(e.clientX, e.clientY); });
  function endStroke() {
    if (!painting) return;
    painting = false;
    ctx.persist();
    ctx.refreshDeck();
    if (maskActive()) renderMasked();
  }
  paint.addEventListener('pointerup', endStroke);
  paint.addEventListener('pointercancel', endStroke);

  $('gp-amount').addEventListener('input', () => {
    $('gp-amount-val').textContent = (+$('gp-amount').value).toFixed(2);
  });
  $('gp-amount-val').textContent = (+$('gp-amount').value).toFixed(2);
  ['gp-which', 'gp-at'].forEach((id) => $(id).addEventListener('change', () => {
    ctx.persist();
    if (maskActive()) renderMasked();
  }));
  $('btn-gp-clear').addEventListener('click', () => {
    if (!cells) return;
    cells.fill(1);
    redrawOverlay();
    ctx.persist();
    ctx.refreshDeck();
    gpStatus('paint cleared');
  });

  // ── capture / render ────────────────────────────────────────────────────
  // Both go through the same generate message the rail builds, so the base and
  // the masked render differ in exactly one thing.
  function sendRender(withMask, label, cb) {
    if (!ctx.loaded) { gpStatus('load a model first', 'err'); return; }
    ctx.setBusy(true);
    gpStatus(label + '…');
    $('gp-timing').textContent = '';
    const msg = ctx.buildGenerateMsg();
    if (!withMask) delete msg.gateMask;
    const t0 = Date.now();
    ctx.client.send(msg, (err, resp) => {
      ctx.setBusy(false);
      if (err) { gpStatus(String(err.message || err), 'err'); return; }
      const c = document.createElement('canvas');
      c.width = resp.width; c.height = resp.height;
      c.getContext('2d').drawImage(resp.bitmap, 0, 0);
      const frame = c.getContext('2d').getImageData(0, 0, resp.width, resp.height);
      $('gp-timing').textContent = (Date.now() - t0) + ' ms' +
        (resp.textRows != null ? ' · ' + resp.textRows + ' + ' + resp.imgLen + ' rows' : '');
      cb(frame, resp);
    });
  }

  function doCapture() {
    sendRender(false, 'capturing the base render', (frame) => {
      setBase(frame);
      gpStatus('captured · ' + grid.wp + '×' + grid.hp + ' token grid — paint a region');
    });
  }
  function renderMasked() {
    if (!maskActive()) return;
    // A mask is a grid of tokens, so it only fits the render it was captured
    // on. (With a derived canvas the size fields say nothing — the worker's
    // own length check is the backstop there.)
    if (!ctx.deriveSize() &&
        (grid.width !== ctx.roundSize($('width').value) ||
         grid.height !== ctx.roundSize($('height').value))) {
      gpStatus('the render size changed — capture again', 'err');
      return;
    }
    sendRender(true, 'rendering the painted mask', (frame) => {
      result.getContext('2d').putImageData(frame, 0, 0);
      $('gp-result-hint').style.display = 'none';
      const r = baseFrame ? retention(baseFrame, frame) : 0;
      const m = baseFrame ? pixelMse(baseFrame, frame) : 0;
      gpStatus('done · ' + paintedCount() + ' of ' + cells.length + ' tokens masked · ' +
               'mse ' + m.toFixed(0) + ' · retention ' + r.toFixed(3), 'ok');
    });
  }

  $('btn-gp-capture').addEventListener('click', doCapture);

  ctx.registerEntry({
    section: 'gate',
    active: () => maskActive(),
    chip: () => 'mask · ' + paintedCount() + ' tokens',
    chipValue: () => (+$('gp-amount').value).toFixed(2),
    zero: (opts) => {
      if (!cells) return;
      cells.fill(1); redrawOverlay(); ctx.persist();
      if ((!opts || !opts.silent) && ctx.live) ctx.schedule('full');
    },
    reveal: () => { ctx.switchTab('gate'); ctx.switchSection('gate'); },
  });

  ctx.onRefreshButtons((busyOrUnloaded) => {
    $('btn-gp-capture').disabled = busyOrUnloaded;
  });
  ctx.onPersist((p) => {
    p.gate = {
      'gate-attn-txt': rows.attnTxt.value, 'gate-attn-img': rows.attnImg.value,
      'gate-mlp-txt': rows.mlpTxt.value, 'gate-mlp-img': rows.mlpImg.value,
      'gate-lo': band.lo.value, 'gate-hi': band.hi.value,
      'gd-attn': delta.attn.value, 'gd-mlp': delta.mlp.value,
      'mask-lo': maskBand.lo.value, 'mask-hi': maskBand.hi.value,
    };
    p.gpWhich = $('gp-which').value;
    p.gpAt = $('gp-at').value;
    p.gpAmount = $('gp-amount').value;
  });
  ctx.onGenerateMsg((msg) => {
    const lo = Math.min(band.lo.value, band.hi.value - 1), hi = band.hi.value;
    if (rows.attnTxt.value !== 1 || rows.attnImg.value !== 1 ||
        rows.mlpTxt.value !== 1 || rows.mlpImg.value !== 1) {
      msg.gateRows = { attnTxt: rows.attnTxt.value, attnImg: rows.attnImg.value,
                       mlpTxt: rows.mlpTxt.value, mlpImg: rows.mlpImg.value, lo: lo, hi: hi };
    }
    if (delta.attn.value || delta.mlp.value) {
      msg.gateDelta = { attn: delta.attn.value, mlp: delta.mlp.value,
                        lo: lo, hi: hi, target: 'target' };
    }
    if (maskActive()) {
      msg.gateMask = {
        cells: Array.from(cells), wp: grid.wp, hp: grid.hp,
        which: $('gp-which').value,
        at: Math.max(0, +$('gp-at').value || 0),
        lo: Math.min(maskBand.lo.value, maskBand.hi.value - 1), hi: maskBand.hi.value,
      };
    }
  });

  // restore the tab's own widgets
  if (prefs.gpWhich) $('gp-which').value = prefs.gpWhich;
  if (prefs.gpAt != null) $('gp-at').value = prefs.gpAt;
  if (prefs.gpAmount != null) {
    $('gp-amount').value = prefs.gpAmount;
    $('gp-amount-val').textContent = (+prefs.gpAmount).toFixed(2);
  }

  // Test + convenience seams.
  ctx.gateCapture = doCapture;
  ctx.gateGrid = () => grid;
  ctx.gateCells = () => cells;
  ctx.gateBase = () => baseFrame;
}
