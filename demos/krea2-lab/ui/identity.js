// Identity panel (scene section): identity transport. Pick a reference image
// — the current render or a file — and its vision-tower tap tokens ride
// alongside the prompt's own conditioning tokens on every generation (the
// worker's `identity` message field + setIdentity cache). The character
// carries across seeds, prompt edits, and axis walks; one strength slider
// scales the injected tokens (1 = the reference verbatim).
//
// The reference is encoded ONCE (setIdentity) and cached in the worker, so a
// strength drag or a re-render costs no re-encode. The main thread keeps the
// pixel tensor and re-sends it after every model load; a file-sourced
// reference also persists by path and restores across app restarts (a
// render-sourced one is session-only — its pixels live nowhere on disk).

import { $ } from '/app/ui/util.js';
import { fileToImageData, capLongSide, toChwFp32, tensorFromCanvas,
         paintThumbInto } from '/app/ui/images.js';

export function initIdentity(ctx) {
  const prefs = ctx.prefs;
  let ref = null;        // {tensor: {pixels,H,W}, path} — path '' for a render
  let refTokens = 0;     // valid vision-token count from the worker's encode
  let strengthCtl = null;

  function identStatus(msg, kind) { ctx.status(msg, kind); }

  function refreshUi() {
    // no reference -> the strength slider has nothing to inject
    strengthCtl.row.style.opacity = ref ? '' : '0.4';
    strengthCtl.row.style.pointerEvents = ref ? '' : 'none';
    strengthCtl.refresh();
    $('btn-ident-clear').disabled = !ref;
  }

  function active() { return !!ref && +strengthCtl.range.value > 0; }

  // One worker encode per picked reference. The client serializes requests,
  // so this queues safely behind an in-flight generation; busy gating on the
  // buttons keeps the common path to one thing at a time anyway.
  function encodeRef(opts) {
    if (!ref || !ctx.loaded) return;
    ctx.setBusy(true);
    identStatus('encoding identity reference (vision tower)…');
    ctx.client.send({
      type: 'setIdentity',
      pixels: ref.tensor.pixels, H: ref.tensor.H, W: ref.tensor.W,
    }, (err, resp) => {
      ctx.setBusy(false);
      if (err) {
        ref = null; refreshUi(); clearThumb();
        identStatus('identity encode failed: ' + (err.message || err), 'err');
        return;
      }
      refTokens = resp.tokens;
      identStatus('identity reference set · ' + resp.tokens + ' tokens', 'ok');
      if (!(opts && opts.silent) && active() && ctx.live) ctx.schedule('full');
      ctx.pump();
    });
  }

  function clearThumb() {
    const thumb = $('ident-thumb');
    const cv = thumb.querySelector('canvas');
    if (cv) cv.remove();
    thumb.classList.remove('filled');
  }

  function setRef(tensor, thumbSrc, sw, sh, path) {
    ref = { tensor: tensor, path: path || '' };
    refTokens = 0;
    paintThumbInto($('ident-thumb'), thumbSrc, sw, sh);
    // picking a reference arms it at "the reference verbatim"
    if (+strengthCtl.range.value === 0) strengthCtl.set(1, { silent: true });
    refreshUi();
    ctx.persist();
    encodeRef();
  }

  function useCurrentRender() {
    const view = $('view');
    if (view.style.display === 'none' || !ctx.history.length) {
      identStatus('render something first — the current render is the reference', 'err');
      return;
    }
    let tensor;
    try { tensor = tensorFromCanvas(view); }
    catch (e) { identStatus('could not read the render: ' + (e.message || e), 'err'); return; }
    setRef(tensor, view, view.width, view.height, '');
  }

  function browseFile() {
    if (typeof showOpenFileDialog !== 'function') {
      identStatus('file dialog unavailable in this build', 'err'); return;
    }
    const files = showOpenFileDialog('Image|png;jpg;jpeg');
    if (!files || !files.length) return;
    const path = files[0];
    let id, tensor;
    try { id = capLongSide(fileToImageData(path), 1024); tensor = toChwFp32(id); }
    catch (e) { identStatus('image load failed: ' + (e.message || e), 'err'); return; }
    setRef(tensor, id, id.width, id.height, path);
  }

  function clearRef() {
    if (!ref) return;
    const wasActive = active();
    ref = null; refTokens = 0;
    clearThumb();
    refreshUi();
    ctx.persist();
    if (ctx.loaded) ctx.client.send({ type: 'clearIdentity' }, () => {});
    identStatus('identity reference cleared', 'ok');
    if (wasActive && ctx.live) ctx.schedule('full');
  }

  // ── strength slider + deck chip ──────────────────────────────────────────
  const strengthInit = Math.max(0, Math.min(2, prefs.identStrength != null ? +prefs.identStrength : 1));
  strengthCtl = ctx.buildCtl({
    label: 'strength', title: '1 = the reference tokens verbatim · scales the injected tokens',
    key: 'ident-strength',
    min: 0, max: 2, step: 0.05, value: strengthInit,
    host: $('ident-strength-row'),
    section: 'scene',
    chip: () => 'identity',
    commit: () => {},
  });
  // Like the expression: the control is only live when a reference is set,
  // and the deck's × keeps the reference (a true no-op at strength 0).
  const entry = ctx.registryLast();
  entry.active = active;

  $('btn-ident-use-render').addEventListener('click', useCurrentRender);
  $('btn-ident-browse').addEventListener('click', browseFile);
  $('btn-ident-clear').addEventListener('click', clearRef);

  // ── hooks ────────────────────────────────────────────────────────────────
  ctx.onGenerateMsg((msg) => {
    msg.identity = active() ? { strength: +strengthCtl.range.value } : null;
  });
  ctx.onPersist((p) => {
    p.identStrength = +strengthCtl.range.value;
    p.identPath = ref ? ref.path : '';
  });
  ctx.onRefreshButtons((busyOrUnloaded) => {
    $('btn-ident-use-render').disabled = busyOrUnloaded;
    $('btn-ident-browse').disabled = busyOrUnloaded;
  });
  // Called by ui/model.js after every successful load: the worker-side cache
  // died with the old pipeline. An in-memory reference re-encodes; otherwise a
  // persisted file path restores across app restarts.
  ctx.restoreIdentity = () => {
    if (ref) { encodeRef({ silent: true }); return; }
    if (!prefs.identPath) return;
    let id, tensor;
    try { id = capLongSide(fileToImageData(prefs.identPath), 1024); tensor = toChwFp32(id); }
    catch (e) {
      identStatus('saved identity reference unreadable: ' + prefs.identPath, 'err');
      return;
    }
    ref = { tensor: tensor, path: prefs.identPath };
    paintThumbInto($('ident-thumb'), id, id.width, id.height);
    refreshUi();
    encodeRef({ silent: true });
  };

  refreshUi();
}
