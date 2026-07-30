// Reference picture (scene section): borrow a picture's arrangement.
//
// This replaced two panels — "identity" and "image as prompt" — that were one
// mechanism pretending to be two features. Both fed the DiT the same
// vision-tower taps of the same picture; they differed only in how many rode.
// Turning identity up far enough produced the same render as image-as-prompt,
// and combining them changed nothing, because there was nothing left to differ
// about. One picture, one slider from a trace to the whole thing.
//
// What it transfers is COMPOSITION. Captioning a reference with the same
// Qwen3-VL family Krea 2 taps, under Krea 2's own instruction, and rendering
// from the caption instead reproduces the attributes just as well — wardrobe,
// palette, subject type are all things words say. What survives only through
// the picture is the arrangement: measured layout correlation 0.69 from the
// picture, 0.57 from a 164-token description, 0.25 from a one-line caption.
// It is not an identity control and is no longer named like one: a face does
// not survive a "describe this image" encode at any share.
//
// The picture is encoded ONCE per pick (setReference) and cached in the worker,
// so dragging the share costs no re-encode — the vision tower is ~350 ms. The
// main thread keeps the pixels and re-sends after a model or text-encoder swap;
// a file-sourced picture also persists by path across restarts, a
// render-sourced one is session-only.

import { $ } from '/app/ui/util.js';
import { fileToImageData, capLongSide, toChwFp32, tensorFromCanvas,
         paintThumbInto } from '/app/ui/images.js';

export function initReference(ctx) {
  const prefs = ctx.prefs;
  let ref = null;      // {tensor: {pixels,H,W}, path} — path '' for a render
  let tokens = 0;      // valid vision-token count from the worker's encode
  let shareCtl = null;

  // Enough of the picture for its arrangement to come through while the prompt
  // still leads. Below ~15% the reference stops showing up; at 100% with a
  // prompt still set the picture brings its own scene and the prompt becomes a
  // prop, which is only what you want when the prompt is empty.
  const DEFAULT_SHARE = 35;

  function share() { return shareCtl ? +shareCtl.range.value : 0; }
  function active() { return !!ref && share() > 0; }

  function riding() {
    // What the worker will actually copy, so the panel can say it before the
    // render rather than after.
    return tokens ? Math.max(1, Math.round((share() / 100) * tokens)) : 0;
  }

  function refreshUi() {
    shareCtl.row.style.opacity = ref ? '' : '0.4';
    shareCtl.row.style.pointerEvents = ref ? '' : 'none';
    shareCtl.refresh();
    $('btn-ref-clear').disabled = !ref;
    $('ref-note').textContent = !ref
      ? 'pick a picture to borrow its arrangement'
      : (!tokens ? 'encoding…'
                 : riding() + ' of ' + tokens + ' tokens ride alongside your prompt');
    // At full share with no prompt left to speak for itself, the picture IS the
    // conditioning — worth saying, since that is the "render this picture" case.
    $('sec-scene').classList.toggle('prompt-quiet',
      !!ref && share() >= 100 && !$('prompt').value.trim());
    if (ctx.refreshDeck) ctx.refreshDeck();
  }

  function clearThumb() {
    const cv = $('ref-thumb').querySelector('canvas');
    if (cv) cv.remove();
    $('ref-thumb').classList.remove('filled');
  }

  function encodeRef(opts) {
    if (!ref || !ctx.loaded) return;
    ctx.setBusy(true);
    ctx.status('encoding the reference (vision tower)…');
    ctx.client.send({
      type: 'setReference',
      pixels: ref.tensor.pixels, H: ref.tensor.H, W: ref.tensor.W,
    }, (err, resp) => {
      ctx.setBusy(false);
      if (err) {
        ref = null; clearThumb(); refreshUi();
        ctx.status('reference failed: ' + (err.message || err), 'err');
        return;
      }
      tokens = resp.tokens;
      refreshUi();
      ctx.status('reference set · ' + resp.tokens + ' tokens', 'ok');
      if (!(opts && opts.silent) && active() && ctx.live) ctx.schedule('full');
      ctx.pump();
    });
  }

  function setRef(tensor, thumbSrc, sw, sh, path) {
    ref = { tensor: tensor, path: path || '' };
    tokens = 0;
    paintThumbInto($('ref-thumb'), thumbSrc, sw, sh);
    if (share() === 0) shareCtl.set(DEFAULT_SHARE, { silent: true });
    refreshUi();
    ctx.persist();
    encodeRef();
  }

  function useCurrentRender() {
    const view = $('view');
    if (view.style.display === 'none' || !ctx.history.length) {
      ctx.status('render something first — the current render becomes the reference', 'err');
      return;
    }
    let tensor;
    try { tensor = tensorFromCanvas(view); }
    catch (e) { ctx.status('could not read the render: ' + (e.message || e), 'err'); return; }
    setRef(tensor, view, view.width, view.height, '');
  }

  function browseFile() {
    if (typeof showOpenFileDialog !== 'function') {
      ctx.status('file dialog unavailable in this build', 'err'); return;
    }
    const files = showOpenFileDialog('Image|png;jpg;jpeg');
    if (!files || !files.length) return;
    const path = files[0];
    let id, tensor;
    try { id = capLongSide(fileToImageData(path), 1024); tensor = toChwFp32(id); }
    catch (e) { ctx.status('image load failed: ' + (e.message || e), 'err'); return; }
    setRef(tensor, id, id.width, id.height, path);
  }

  function clearRef(opts) {
    if (!ref) return;
    const wasActive = active();
    ref = null; tokens = 0;
    clearThumb();
    refreshUi();
    ctx.persist();
    if (ctx.loaded) ctx.client.send({ type: 'clearReference' }, () => {});
    ctx.status('reference cleared', 'ok');
    if (wasActive && !(opts && opts.silent) && ctx.live) ctx.schedule('full');
  }

  // ── share slider + deck chip ─────────────────────────────────────────────
  const shareInit = Math.max(0, Math.min(100,
    prefs.refShare != null ? +prefs.refShare : DEFAULT_SHARE));
  shareCtl = ctx.buildCtl({
    label: 'share of the picture',
    title: 'what fraction of the reference’s tokens ride alongside your prompt — ' +
           'more picture means more of its arrangement, and past ~60% it starts ' +
           'bringing its own scene',
    key: 'ref-share',
    min: 0, max: 100, step: 1, decimals: 0, value: shareInit,
    host: $('ref-share-row'),
    section: 'scene',
    chip: () => 'reference',
    commit: () => { refreshUi(); },
  });
  // Only live once a picture is set; the deck's × keeps the picture (share 0 is
  // a true no-op), matching how every other zeroed control behaves.
  const entry = ctx.registryLast();
  entry.active = active;

  $('btn-ref-use-render').addEventListener('click', useCurrentRender);
  $('btn-ref-browse').addEventListener('click', browseFile);
  $('btn-ref-clear').addEventListener('click', () => clearRef());
  $('prompt').addEventListener('input', refreshUi);

  // ── hooks ────────────────────────────────────────────────────────────────
  ctx.onGenerateMsg((msg) => {
    msg.reference = active() ? { share: share() / 100 } : null;
  });
  ctx.onPersist((p) => {
    p.refShare = share();
    p.refPath = ref ? ref.path : '';
  });
  ctx.onRefreshButtons((busyOrUnloaded) => {
    $('btn-ref-use-render').disabled = busyOrUnloaded;
    $('btn-ref-browse').disabled = busyOrUnloaded;
  });
  // Called by ui/model.js after every load / text-encoder swap: the cached taps
  // came from an encoder that no longer exists.
  ctx.restoreReference = () => {
    if (ref) { encodeRef({ silent: true }); return; }
    if (!prefs.refPath) return;
    let id, tensor;
    try { id = capLongSide(fileToImageData(prefs.refPath), 1024); tensor = toChwFp32(id); }
    catch (e) {
      ctx.status('saved reference unreadable: ' + prefs.refPath, 'err');
      return;
    }
    ref = { tensor: tensor, path: prefs.refPath };
    paintThumbInto($('ref-thumb'), id, id.width, id.height);
    refreshUi();
    encodeRef({ silent: true });
  };

  refreshUi();
}
