// ── LoRA panel ───────────────────────────────────────────────────────────
// One row per applied LoRA: filename, a strength slider (0 = off, dblclick
// the value to zero it), and × to remove. Strength changes are free (they
// ride the next generate message); add/remove are worker requests because
// they read the safetensors file / rebuild the group list.

import { $ } from '/app/ui/util.js';

export function initLora(ctx) {
  // {path, scale} per applied LoRA, in pipeline group order. This list is
  // authoritative (persisted here); the worker rebuilds the pipeline's
  // runtime groups from it after every model load. Strengths ride each
  // generate message as `loraScales` (synced worker-side per generation),
  // so a strength slider needs no worker round-trip of its own.
  let loras = Array.isArray(ctx.prefs.loras)
    ? ctx.prefs.loras.filter((l) => l && l.path)
        .map((l) => ({ path: l.path, scale: typeof l.scale === 'number' ? l.scale : 1 }))
    : [];

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
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'axis-mine-del';
      del.textContent = '×'; del.title = 'remove "' + loraBasename(l.path) + '"';
      del.addEventListener('click', () => removeLora(i));
      // An adapter isn't a dial — its resting state is applied (1.0), and it
      // lives in the scene section, so it stays off the deck (no `section`).
      ctx.buildCtl({
        label: loraBasename(l.path), title: l.path,
        min: -2, max: 2, step: 0.05, neutral: 0,
        value: l.scale,
        host: host,
        headBtns: [del],
        commit: (v) => { l.scale = v; },
      });
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
    if (!ctx.loaded || ctx.busy) return;
    if (typeof window.showOpenFileDialog !== 'function') {
      loraStatus('file dialog unavailable in this build', 'err'); return;
    }
    const files = window.showOpenFileDialog('LoRA safetensors|safetensors');
    if (!files || !files.length) return;
    const path = files[0];
    ctx.setBusy(true);
    loraStatus('applying ' + loraBasename(path) + '…');
    ctx.client.send({ type: 'applyLora', path: path, scale: 1.0 }, (err) => {
      ctx.setBusy(false);
      if (err) { loraStatus(String(err.message || err), 'err'); ctx.pump(); return; }
      loras.push({ path: path, scale: 1.0 });
      renderLoraList();
      ctx.persist();
      loraStatus('applied ' + loraBasename(path), 'ok');
      if (ctx.live) ctx.schedule('full');
      ctx.pump();
    });
  }
  // Remove-one rebuilds the whole group list (group indices are apply-order,
  // so dropping one from the middle shifts the rest — the worker re-applies
  // the remaining files and reports back what actually stuck).
  function removeLora(i) {
    if (!ctx.loaded || ctx.busy) return;
    const next = loras.filter((_, j) => j !== i);
    ctx.setBusy(true);
    loraStatus('rebuilding LoRA set…');
    ctx.client.send({ type: 'setLoras', loras: next }, (err, resp) => {
      ctx.setBusy(false);
      if (err) { loraStatus(String(err.message || err), 'err'); ctx.pump(); return; }
      loras = resp.applied || [];
      renderLoraList();
      ctx.persist();
      reportLoraOutcome(resp, 'removed');
      if (ctx.live) ctx.schedule('full');
      ctx.pump();
    });
  }
  // Re-apply the persisted list after a model load (the pipeline's groups
  // die with the old model). Missing/bad files are skipped and reported;
  // the list shrinks to what actually applied.
  function restoreLoras(done) {
    if (!loras.length) { renderLoraList(); done(); return; }
    loraStatus('re-applying ' + loras.length + ' LoRA' + (loras.length === 1 ? '' : 's') + '…');
    ctx.client.send({ type: 'setLoras', loras: loras }, (err, resp) => {
      if (err) { loraStatus(String(err.message || err), 'err'); done(); return; }
      loras = resp.applied || [];
      renderLoraList();
      ctx.persist();
      reportLoraOutcome(resp, loras.length + ' LoRA' + (loras.length === 1 ? '' : 's') + ' re-applied');
      done();
    });
  }

  $('btn-lora-add').addEventListener('click', addLora);

  ctx.renderLoraList = renderLoraList;
  ctx.restoreLoras = restoreLoras;
  ctx.loraScales = () => loras.map((l) => +l.scale);
  ctx.onRefreshButtons((busyOrUnloaded) => {
    $('btn-lora-add').disabled = busyOrUnloaded;
  });
  ctx.onPersist((p) => {
    p.loras = loras.map((l) => ({ path: l.path, scale: +l.scale }));
  });
  ctx.onGenerateMsg((msg) => {
    msg.loraScales = loras.map((l) => +l.scale);
  });
}
