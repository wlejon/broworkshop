// Image as prompt (scene section): a picture REPLACES the words. The reference
// is encoded through Krea 2's own Qwen3-VL vision tower under the same fixed
// "describe the image" template a text prompt gets, tapped at the same 12
// decoder layers, and the resulting tokens become the whole conditioning —
// where identity transport injects a slice of them alongside the prompt's own.
// Same mechanism, opposite proportion: this reproduces a reference, identity
// carries a character into a scene you wrote.
//
// Encoded ONCE per picked reference (setImagePrompt) and cached in the worker,
// so a seed roll, an axis drag or a re-render costs no re-encode — the vision
// tower is ~350 ms, which would otherwise be a quarter of every frame. The
// main thread keeps the pixels and re-sends after a model or text-encoder swap
// (the cache dies with the old encoder); a file-sourced reference also persists
// by path across restarts, a render-sourced one is session-only.
//
// While it is set the prompt text is not sent — the panel says so and the
// prompt field dims — and the expression field is inert for the same reason
// (there are no words to splice an adjective into). Everything that operates
// on token rows rather than on language still applies: the axis bank, the
// baked spectrum/mouth banks, the band dial, and identity transport, which
// merges into this carrier's free slots exactly as it does a prompt's.

import { $ } from '/app/ui/util.js';
import { fileToImageData, capLongSide, toChwFp32, tensorFromCanvas,
         paintThumbInto } from '/app/ui/images.js';

export function initImagePrompt(ctx) {
  const prefs = ctx.prefs;
  let ref = null;      // {tensor: {pixels,H,W}, path} — path '' for a render
  let tokens = 0;      // valid vision-token count from the worker's encode

  function active() { return !!ref; }

  function refreshUi() {
    $('btn-imgp-clear').disabled = !ref;
    // The prompt is still editable — it is what you come back to when the
    // image prompt is cleared — but it is visibly not in play.
    $('sec-scene').classList.toggle('prompt-overridden', !!ref);
    $('imgp-note').textContent = ref
      ? (tokens ? 'the picture is the prompt · ' + tokens + ' tokens'
                : 'encoding…')
      : 'pick a picture to render from it instead of from words';
    if (ctx.refreshDeck) ctx.refreshDeck();
  }

  function clearThumb() {
    const cv = $('imgp-thumb').querySelector('canvas');
    if (cv) cv.remove();
    $('imgp-thumb').classList.remove('filled');
  }

  function encodeRef(opts) {
    if (!ref || !ctx.loaded) return;
    ctx.setBusy(true);
    ctx.status('encoding image prompt (vision tower)…');
    ctx.client.send({
      type: 'setImagePrompt',
      pixels: ref.tensor.pixels, H: ref.tensor.H, W: ref.tensor.W,
    }, (err, resp) => {
      ctx.setBusy(false);
      if (err) {
        ref = null; clearThumb(); refreshUi();
        ctx.status('image prompt failed: ' + (err.message || err), 'err');
        return;
      }
      tokens = resp.tokens;
      refreshUi();
      ctx.status('image prompt set · ' + resp.tokens + ' tokens', 'ok');
      if (!(opts && opts.silent) && ctx.live) ctx.schedule('full');
      ctx.pump();
    });
  }

  function setRef(tensor, thumbSrc, sw, sh, path) {
    ref = { tensor: tensor, path: path || '' };
    tokens = 0;
    paintThumbInto($('imgp-thumb'), thumbSrc, sw, sh);
    refreshUi();
    ctx.persist();
    encodeRef();
  }

  function useCurrentRender() {
    const view = $('view');
    if (view.style.display === 'none' || !ctx.history.length) {
      ctx.status('render something first — the current render becomes the prompt', 'err');
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
    ref = null; tokens = 0;
    clearThumb();
    refreshUi();
    ctx.persist();
    if (ctx.loaded) ctx.client.send({ type: 'clearImagePrompt' }, () => {});
    ctx.status('image prompt cleared — back to the prompt text', 'ok');
    if (!(opts && opts.silent) && ctx.live) ctx.schedule('full');
  }

  $('btn-imgp-use-render').addEventListener('click', useCurrentRender);
  $('btn-imgp-browse').addEventListener('click', browseFile);
  $('btn-imgp-clear').addEventListener('click', () => clearRef());

  // ── deck ─────────────────────────────────────────────────────────────────
  // Not a slider, but it changes what the model is told more than any slider
  // does, so it belongs on the deck — and its × puts the words back.
  ctx.registerEntry({
    section: 'scene',
    active: active,
    value: () => (ref ? 1 : 0),
    chip: () => 'image prompt',
    chipValue: () => (tokens ? tokens + ' tok' : 'on'),
    zero: (opts) => clearRef(opts),
    reveal: () => ctx.revealControl('scene', $('imgp-panel')),
  });

  // ── hooks ────────────────────────────────────────────────────────────────
  ctx.onGenerateMsg((msg) => { msg.imagePrompt = active(); });
  ctx.onPersist((p) => { p.imgPromptPath = ref ? ref.path : ''; });
  ctx.onRefreshButtons((busyOrUnloaded) => {
    $('btn-imgp-use-render').disabled = busyOrUnloaded;
    $('btn-imgp-browse').disabled = busyOrUnloaded;
  });
  // Called by ui/model.js after every load / text-encoder swap: the worker-side
  // taps came from an encoder that no longer exists.
  ctx.restoreImagePrompt = () => {
    if (ref) { encodeRef({ silent: true }); return; }
    if (!prefs.imgPromptPath) return;
    let id, tensor;
    try { id = capLongSide(fileToImageData(prefs.imgPromptPath), 1024); tensor = toChwFp32(id); }
    catch (e) {
      ctx.status('saved image prompt unreadable: ' + prefs.imgPromptPath, 'err');
      return;
    }
    ref = { tensor: tensor, path: prefs.imgPromptPath };
    paintThumbInto($('imgp-thumb'), id, id.width, id.height);
    refreshUi();
    encodeRef({ silent: true });
  };

  refreshUi();
}
