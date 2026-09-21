// Model panel: load / unload, the loading overlay with its live VRAM meter,
// the release-the-text-encoder button, and the set-and-forget <details>
// summary status.

import { $ } from '/app/ui/util.js';

const DICT = 'assets/axes_qi21_v2.bcd1';
const CONTROLLER = 'assets/controller.json';

export function initModel(ctx) {
  function backend(text, kind) {
    const el = $('backend'); el.textContent = text; el.className = 'badge' + (kind ? ' ' + kind : '');
  }

  // ── loading overlay + live VRAM meter ──────────────────────────────────
  // The worker's loadModel() is one synchronous native call, so it cannot
  // report progress. But the main thread stays live and CUDA VRAM is
  // device-wide, so poll bro.gpu.memoryInfo() here and watch used VRAM climb
  // as the checkpoint streams onto the card.
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

  function modelSum(text, kind) {
    const el = $('model-sum-status');
    el.textContent = text;
    el.className = 'model-sum-status' + (kind ? ' ' + kind : '');
  }
  function teBadge(resident, memo) {
    const el = $('te-state');
    el.textContent = resident ? 'Qwen3-VL-8B resident' : 'released · ' + (memo || 0) + ' memoized';
    el.className = 'badge' + (resident ? '' : ' warn');
    $('btn-release-te').textContent = resident ? 'Release text encoder' : 'Reload text encoder';
  }

  let loadedModelDir = null;

  function doLoad() {
    const modelDir = $('model-dir').value.trim();
    if (!modelDir) {
      ctx.status('set a Qwen-Image 2.1 directory first', 'err');
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
    ctx.status('loading Qwen-Image 2.1 — 7.1B DiT + Qwen3-VL-8B, quantized as it streams in');
    ctx.client.send(ctx.buildLoadMsg({
      type: 'load', modelDir: modelDir,
      quantizeWeights: $('quantize').checked,
      dictPath: DICT, controllerPath: CONTROLLER,
    }), (err, msg) => {
      stopLoadOverlay();
      if (err) {
        ctx.setBusy(false); backend('error', 'err');
        modelSum(String(err.message || err), 'err');
        $('model-details').setAttribute('open', '');
        ctx.status(String(err.message || err), 'err');
        return;
      }
      ctx.setLoaded(true);
      ctx.setBusy(false);
      backend(msg.backend === 'cpu' ? 'CPU' : (msg.backend || 'gpu').toUpperCase(),
              msg.backend === 'cpu' ? 'warn' : 'ok');
      $('backend').title = cardName();
      teBadge(msg.textEncoderResident, 0);
      const dirName = modelDir.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
      modelSum(dirName + ' · ' + (msg.axes || []).length + ' axes · ' +
               ((msg.controller && msg.controller.faders.length) || 0) + ' faders ✓', 'ok');
      $('model-details').removeAttribute('open');
      ctx.status((msg.config && msg.config.modelClass) + ' ready · ' +
                 msg.numLayers + ' blocks · hidden ' + msg.hiddenSize + ' · ' +
                 (msg.ms / 1000).toFixed(1) + ' s to load', 'ok');
      loadedModelDir = modelDir;
      ctx.buildAxisBank(msg.axes || []);
      ctx.applyDesk(msg.controller);
      ctx.announceLoaded(msg);
    });
  }

  function doUnload() {
    ctx.setBusy(true);
    ctx.client.send({ type: 'unload' }, (err) => {
      ctx.setLoaded(false);
      ctx.setBusy(false);
      if (err) { ctx.status(String(err.message || err), 'err'); return; }
      backend('unloaded');
      modelSum('unloaded', 'warn');
      $('model-details').setAttribute('open', '');
      ctx.status('model unloaded — VRAM freed', 'ok');
    });
  }

  // Release: 8.5 GiB back, and prime() keeps working for any prompt the memo
  // has already seen. Pressing it again reloads the backbone in place.
  let teResident = true;
  function doToggleTe() {
    const releasing = teResident;
    ctx.setBusy(true);
    const msg = releasing
      ? { type: 'releaseTextEncoder' }
      : { type: 'reloadTextEncoder', modelDir: loadedModelDir || $('model-dir').value.trim(),
          quantizeWeights: $('quantize').checked };
    ctx.status(releasing ? 'releasing the text encoder…' : 'reloading the text encoder…');
    ctx.client.send(msg, (err, resp) => {
      ctx.setBusy(false);
      if (err) { ctx.status(String(err.message || err), 'err'); return; }
      teResident = !!resp.resident;
      teBadge(teResident, (resp.memo || []).length);
      ctx.status(teResident
        ? 'text encoder resident again'
        : 'text encoder released · ' + (resp.memo || []).length +
          ' prompt(s) still primeable from the memo', 'ok');
    });
  }

  $('btn-load').addEventListener('click', doLoad);
  $('btn-unload').addEventListener('click', doUnload);
  $('btn-release-te').addEventListener('click', doToggleTe);
  $('btn-browse-model').addEventListener('click', () => {
    const d = window.showOpenFolderDialog ? window.showOpenFolderDialog($('model-dir').value.trim()) : null;
    if (d) { $('model-dir').value = d; ctx.persist(); }
  });

  ctx.doLoad = doLoad;
}
