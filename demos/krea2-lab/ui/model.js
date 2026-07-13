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
  function doLoad() {
    const modelDir = $('model-dir').value.trim();
    if (!modelDir) {
      ctx.status('set a Krea 2 directory first', 'err');
      modelSum('no directory set', 'err');
      $('model-details').setAttribute('open', '');
      ctx.switchSection('scene');
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
                  dictPaths: ['assets/axes_turbo.bcd1', 'assets/axes_sae_deck.bcd1'],
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
      modelSum(dirName + ' · ' + (msg.axes || []).length + ' axes ✓', 'ok');
      $('model-details').removeAttribute('open');
      ctx.status(cls + ' ready · ' + (msg.axes || []).length + ' axes' + card, 'ok');
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

  $('btn-load').addEventListener('click', doLoad);
  $('btn-browse-model').addEventListener('click', () => {
    const d = window.showOpenFolderDialog ? window.showOpenFolderDialog($('model-dir').value.trim()) : null;
    if (d) { $('model-dir').value = d; ctx.persist(); }
  });

  ctx.doLoad = doLoad;
}
