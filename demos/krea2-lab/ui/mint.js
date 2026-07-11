// Mint your own axis: text-pair and image-pair minting, the minted-axis
// readout/inspector, the isolation sweep, and the Image Axis tab (gallery of
// your renders, toward/away pair slots, mint-from-image). Minted axes land in
// the axis bank via ctx.addMintedAxis (ui/axes.js owns the list).

import { $, f32ToB64 } from '/app/ui/util.js';
import { fileToImageData, capLongSide, toChwFp32, tensorFromCanvas,
         paintMintThumb } from '/app/ui/images.js';

export function initMint(ctx) {
  let mintImgA = null, mintImgB = null;   // {tensor:{pixels,H,W}, path}
  // Which render (history id) currently fills each slot, so the Image Axis
  // gallery can badge the picked cells. null = a browsed file (no history id).
  let mintSelId = { a: null, b: null };

  // ── mint your own axis ───────────────────────────────────────────────────
  function mintStatus(msg, kind) {
    const el = $('mint-status');
    el.textContent = msg;
    el.className = 'hint' + (kind === 'err' ? ' err' : kind === 'warn' ? ' warn' : '');
  }
  // Interim minting progress (the worker posts a message before each encode).
  ctx.client.onProgress((p) => {
    $('mint-progress').classList.add('show');
    $('mint-progress-fill').style.width =
      Math.round((p.done / Math.max(1, p.total)) * 100) + '%';
    mintStatus('minting · ' + p.label);
  });
  function mintProgressDone() {
    $('mint-progress').classList.remove('show');
    $('mint-progress-fill').style.width = '0%';
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
        nm.textContent = (ctx.axesMeta[c.name] && ctx.axesMeta[c.name].label) || c.name;
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
    ctx.refreshButtons();
  }

  // ── isolation sweep: SEE what the axis does, everything else neutral ────
  // 5 small renders at alpha −6…+6 with the same prompt/seed and every other
  // control zeroed — a probe strip, the ground truth for "what does this
  // axis move". Click a frame to view it full-size on the render tab.
  const SWEEP_ALPHAS = [-6, -3, 0, 3, 6];
  const SWEEP_SIZE = 384;
  function doAxisSweep() {
    if (!ctx.loaded || ctx.busy || !lastMinted) return;
    const name = lastMinted.name;
    let w = ctx.roundSize($('width').value), h = ctx.roundSize($('height').value);
    const s = SWEEP_SIZE / Math.max(w, h);
    if (s < 1) { w = ctx.roundSize(w * s); h = ctx.roundSize(h * s); }
    const prompt = $('prompt').value.trim() || 'a red fox sitting in a snowy forest clearing';
    const seed = +$('seed').value || 0;
    const steps = +$('steps').value || ctx.DEFAULTS.steps;
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
    ctx.setBusy(true);
    let i = 0;
    (function next() {
      if (i >= SWEEP_ALPHAS.length) {
        ctx.setBusy(false);
        mintStatus('sweep of "' + name + '" · seed ' + seed + ' · click a frame to view', 'ok');
        ctx.pump();
        return;
      }
      const alpha = SWEEP_ALPHAS[i];
      const cv = cells[i];
      mintStatus('sweep ' + (i + 1) + '/' + SWEEP_ALPHAS.length + ' · ' + name +
                 ' = ' + (alpha > 0 ? '+' : '') + alpha + '…');
      const ac = {};
      if (alpha) ac[name] = alpha;
      ctx.client.send({
        type: 'generate', prompt: prompt, negPrompt: '',
        opts: { width: w, height: h, steps: steps,
                guidanceScale: +$('guidance').value || ctx.DEFAULTS.guidance, seed: seed },
        band: 1.0, dial: { pregate: 1.0, prescale: 1.0 },
        gate: { txtScale: 1.0, imgScale: 1.0 },
        axisControls: ac,
      }, (err, resp) => {
        if (err) { ctx.setBusy(false); mintStatus('sweep failed: ' + (err.message || err), 'err'); return; }
        cv.width = resp.width; cv.height = resp.height;
        cv.getContext('2d').drawImage(resp.bitmap, 0, 0);
        cv.title = name + ' = ' + (alpha > 0 ? '+' : '') + alpha + ' · click to view';
        cv.onclick = () => {
          ctx.drawBitmap(cv, resp.width, resp.height);
          ctx.status('sweep frame · ' + name + ' = ' + (alpha > 0 ? '+' : '') + alpha, 'ok');
        };
        i++;
        next();
      });
    })();
  }
  $('btn-axis-sweep').addEventListener('click', doAxisSweep);

  function doMintText() {
    if (!ctx.loaded || ctx.busy) return;
    const name = $('mint-text-name').value.trim();
    const pos = $('mint-text-pos').value.trim();
    const neg = $('mint-text-neg').value.trim();
    if (!name || !pos || !neg) { mintStatus('need a name and both descriptions', 'err'); return; }
    ctx.setBusy(true);
    mintStatus('minting "' + name + '" — averaging over 6 scenes…');
    ctx.client.send({ type: 'mintTextAxis', name: name, pos: pos, neg: neg }, (err, resp) => {
      ctx.setBusy(false);
      mintProgressDone();
      if (err) { mintStatus(String(err.message || err), 'err'); return; }
      const def = { name: resp.name, kind: 'text', pos: pos, neg: neg,
                    consistency: resp.consistency, dir: f32ToB64(resp.axis),
                    components: resp.components, residual: resp.residual };
      ctx.addMintedAxis(def);
      showAxisInspector(def);
      const low = resp.consistency < 0.8;
      mintStatus('minted "' + resp.name + '" · consistency ' + resp.consistency.toFixed(2) +
                 (low ? ' (low — the two descriptions may not name one clean direction)' : ''),
                 low ? 'warn' : 'ok');
      $('mint-text-name').value = ''; $('mint-text-pos').value = ''; $('mint-text-neg').value = '';
    });
  }

  // ── Image Axis tab: pick a toward/away pair from a gallery of your renders ──
  // Replaces the old size/seed dropdowns (useless when every render shares a
  // size and seed) with a visual grid — you recognise the picture, not a label.
  const GALLERY_THUMB = 132;
  function renderMintGallery() {
    const grid = $('mint-gallery');
    if (!grid) return;
    grid.innerHTML = '';
    if (ctx.history.length === 0) {
      const e = document.createElement('div');
      e.className = 'mint-gallery-empty';
      e.textContent = 'Renders you make collect here — generate a few, then pick a pair.';
      grid.appendChild(e);
      return;
    }
    ctx.history.forEach((h) => {
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
    const h = ctx.history.find((e) => e.id === +id);
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
    ctx.refreshButtons();
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
    ctx.refreshButtons();
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
    ctx.refreshButtons();
  }
  function doMintImage() {
    if (!ctx.loaded || ctx.busy || !mintImgA || !mintImgB) return;
    const name = $('mint-image-name').value.trim();
    if (!name) { flagMintName(); mintImgStatus('name the axis first', 'err'); return; }
    ctx.setBusy(true);
    mintImgStatus('minting "' + name + '" from the image pair…');
    ctx.client.send({
      type: 'mintImageAxis', name: name,
      a: { pixels: mintImgA.tensor.pixels, H: mintImgA.tensor.H, W: mintImgA.tensor.W },
      b: { pixels: mintImgB.tensor.pixels, H: mintImgB.tensor.H, W: mintImgB.tensor.W },
    }, (err, resp) => {
      ctx.setBusy(false);
      mintProgressDone();
      if (err) { mintImgStatus(String(err.message || err), 'err'); return; }
      const def = { name: resp.name, kind: 'image', aPath: mintImgA.path, bPath: mintImgB.path,
                    dir: f32ToB64(resp.axis),
                    components: resp.components, residual: resp.residual };
      ctx.addMintedAxis(def);
      showAxisInspector(def);
      mintImgStatus('minted "' + resp.name + '" — added to the axis bank', 'ok');
      $('mint-image-name').value = '';
    });
  }

  $('btn-mint-text').addEventListener('click', doMintText);
  $('btn-mint-image').addEventListener('click', doMintImage);
  $('btn-mint-pick-a').addEventListener('click', () => pickMintImage('a'));
  $('btn-mint-pick-b').addEventListener('click', () => pickMintImage('b'));
  $('btn-mint-clear-a').addEventListener('click', () => clearMintSlot('a'));
  $('btn-mint-clear-b').addEventListener('click', () => clearMintSlot('b'));
  $('btn-goto-imgaxis').addEventListener('click', () => ctx.switchTab('imgaxis'));

  ctx.showAxisInspector = showAxisInspector;
  // Called by ui/axes.js when a minted axis is deleted.
  ctx.dropInspectedAxis = (name) => {
    if (lastMinted && lastMinted.name === name) {
      lastMinted = null;
      $('axis-inspect').style.display = 'none';
    }
  };
  ctx.mintProgressDone = mintProgressDone;
  ctx.renderMintGallery = renderMintGallery;
  ctx.clearMintSlot = clearMintSlot;
  ctx.mintSelId = mintSelId;
  ctx.onRefreshButtons((busyOrUnloaded) => {
    $('btn-mint-text').disabled = busyOrUnloaded;
    $('btn-mint-image').disabled = busyOrUnloaded || !mintImgA || !mintImgB;
    $('btn-axis-sweep').disabled = busyOrUnloaded || !lastMinted;
  });
}
