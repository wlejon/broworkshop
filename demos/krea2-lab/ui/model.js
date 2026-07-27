// Model panel: the doLoad flow, the loading overlay with its live VRAM meter,
// the set-and-forget <details> summary status, and the backend badge.

import { $ } from '/app/ui/util.js';

export function initModel(ctx) {
  function backend(text, kind) {
    const el = $('backend'); el.textContent = text; el.className = 'badge' + (kind ? ' ' + kind : '');
  }

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

  // The model panel is set-and-forget: its <details> summary carries the
  // status, and the body folds away once a load lands (reopens on error).
  function modelSum(text, kind) {
    const el = $('model-sum-status');
    el.textContent = text;
    el.className = 'model-sum-status' + (kind ? ' ' + kind : '');
  }
  // What is currently resident, so "Load model" can swap just the text encoder
  // when the Krea 2 directory hasn't changed (the DiT/VAE are identical from
  // the same dir — only the tapped backbone can differ).
  let loadedModelDir = null, loadedTextEncoder = null, loadedAxes = 0;

  function doLoad() {
    const modelDir = $('model-dir').value.trim();
    if (!modelDir) {
      ctx.status('set a Krea 2 directory first', 'err');
      modelSum('no directory set', 'err');
      $('model-details').setAttribute('open', '');
      ctx.switchSection('scene');
      return;
    }
    const textEncoder = $('text-encoder').value.trim();
    // Fast path: same dir already resident → reload only the text encoder.
    if (ctx.loaded && loadedModelDir === modelDir) {
      doReloadTextEncoder(modelDir, textEncoder);
      return;
    }
    ctx.persist();
    ctx.setBusy(true);
    ctx.setLoaded(false);
    backend('loading…');
    modelSum('loading…');
    startLoadOverlay();
    ctx.status('loading model — this reads ~26GB of weights, give it a moment');
    ctx.client.send({ type: 'load', modelDir: modelDir,
                  textEncoderPath: textEncoder || undefined,
                  // Every dictionary becomes a live axis; `namedDicts` says which
                  // of them a person put LABELS on (they are the ones in
                  // assets/axes_meta.json). The worker decomposes minted axes
                  // against the named bank only — the 391 unnamed atoms would
                  // swamp the span and make "how much of this is new" meaningless.
                  dictPaths: ['assets/axes_turbo.bcd1', 'assets/axes_sae_deck.bcd1',
                              'assets/axes_sae_all.bcd1'],
                  namedDicts: ['assets/axes_turbo.bcd1', 'assets/axes_sae_deck.bcd1'],
                  spectrumPath: 'lab/spectrum.json', mouthPath: 'lab/mouth.json' }, (err, msg) => {
      stopLoadOverlay();
      if (err) {
        ctx.setBusy(false); backend('error', 'err');
        modelSum(String(err.message || err), 'err');
        $('model-details').setAttribute('open', '');
        ctx.status(String(err.message || err), 'err');
        return;
      }
      ctx.setLoaded(true);
      ctx.setSpectrumAvailable(!!msg.spectrum);
      ctx.setMouthAvailable(!!msg.mouth);
      ctx.setBusy(false);
      backend(msg.backend === 'cpu' ? 'CPU' : (msg.backend || 'gpu').toUpperCase(),
              msg.backend === 'cpu' ? 'warn' : 'ok');
      $('backend').title = cardName();
      const cls = (msg.config && msg.config.modelClass) || 'model';
      const card = msg.backend === 'cpu' ? '' : ' · ' + cardName();
      const dirName = modelDir.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
      const teName = msg.textEncoder
        ? ' · TE ' + String(msg.textEncoder).replace(/[\\/]+$/, '').split(/[\\/]/).pop()
        : '';
      modelSum(dirName + teName + ' · ' + (msg.axes || []).length + ' axes ✓', 'ok');
      $('model-details').removeAttribute('open');
      ctx.status(cls + ' ready · ' + (msg.axes || []).length + ' axes' + card, 'ok');
      loadedModelDir = modelDir;
      loadedTextEncoder = textEncoder;
      loadedAxes = (msg.axes || []).length;
      // Chain the sequential restore passes (the client serializes one
      // request at a time): saved LoRAs first, then saved minted axes, then
      // the identity reference (its worker-side cache died with the old
      // pipeline; rebuildMintedAxes only enqueues sends, so the identity
      // encode queues FIFO behind them).
      ctx.restoreLoras(() => {
        ctx.rebuildMintedAxes();
        ctx.restoreIdentity();
      });
    });
  }

  // Swap just the tapped Qwen3-VL-4B backbone — the engine keeps the ~25GB
  // DiT/VAE resident, so this is seconds not half a minute. Control axes,
  // LoRAs and minted axes survive; only the identity reference is re-encoded
  // (its taps came from the old backbone).
  function doReloadTextEncoder(modelDir, textEncoder) {
    ctx.persist();
    ctx.setBusy(true);
    backend('swapping…');
    modelSum('swapping text encoder…');
    startLoadOverlay();
    ctx.status('reloading text encoder — the DiT stays resident, this is quick');
    ctx.client.send({ type: 'reloadTextEncoder', modelDir: modelDir,
                      textEncoderPath: textEncoder || undefined }, (err, msg) => {
      stopLoadOverlay();
      if (err) {
        ctx.setBusy(false); backend('error', 'err');
        modelSum(String(err.message || err), 'err');
        $('model-details').setAttribute('open', '');
        ctx.status(String(err.message || err), 'err');
        return;
      }
      loadedTextEncoder = textEncoder;
      ctx.setBusy(false);
      backend(msg.backend === 'cpu' ? 'CPU' : (msg.backend || 'gpu').toUpperCase(),
              msg.backend === 'cpu' ? 'warn' : 'ok');
      $('backend').title = cardName();
      const dirName = modelDir.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
      const teName = msg.textEncoder
        ? ' · TE ' + String(msg.textEncoder).replace(/[\\/]+$/, '').split(/[\\/]/).pop()
        : ' · bundled TE';
      modelSum(dirName + teName + ' · ' + loadedAxes + ' axes ✓', 'ok');
      $('model-details').removeAttribute('open');
      ctx.status('text encoder swapped' + (msg.textEncoder ? teName : ' · bundled'), 'ok');
      // The reference image's taps came from the old backbone — re-encode it.
      ctx.restoreIdentity();
    });
  }

  $('btn-load').addEventListener('click', doLoad);
  $('btn-browse-model').addEventListener('click', () => {
    const d = window.showOpenFolderDialog ? window.showOpenFolderDialog($('model-dir').value.trim()) : null;
    if (d) { $('model-dir').value = d; ctx.persist(); }
  });

  // Text-encoder override: pick a .gguf / .safetensors file (the common case).
  // A diffusers text_encoder directory can be typed/pasted into the field.
  // Both dialogs return an array of paths (empty on cancel).
  $('btn-browse-te').addEventListener('click', () => {
    if (!window.showOpenFileDialog) return;
    const picked = window.showOpenFileDialog('Text encoder|gguf;safetensors');
    if (picked && picked.length) { $('text-encoder').value = picked[0]; ctx.persist(); }
  });
  $('btn-clear-te').addEventListener('click', () => {
    $('text-encoder').value = ''; ctx.persist();
  });

  ctx.doLoad = doLoad;
}
