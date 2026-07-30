// Krea 2 Lab — main thread. Drives the Krea 2 Turbo pipeline (in a worker,
// lab/krea2-worker.js) as a comprehensive showcase of every research-hook
// control krea-research (../krea-research) discovered: AdaLN dials, the deep-
// tap band dial, a conditioning-space control bank (+ user-minted
// axes), attention-gate scale/mask, per-region spatial-paint compositing,
// and the expression panel — contextual per-token fields (sana-research's
// dictionary.py technique on Krea 2's taps seam): a word picker (the field is
// exclusive by construction — one splice per render) driving one strength
// slider.
// The rail is sectioned (scene / face / look / mint / tune) with a pinned
// "deck" at its foot: one chip per non-neutral control across every section
// (click → jump to it, × → neutral), plus Generate — the "what is shaping
// this image" view that a 40-slider instrument otherwise loses.
// The spectrum panel sits on top of that: the four model-nominated affect
// axes (valence/arousal/hostility/surprise sliders) from the round-6
// probe's SVD of ~100 farmed word fields — minted per prompt in the worker,
// and stackable with each other and the expression word.
// The mouth panel is the same baked-bank machinery over lab/mouth.json
// (tools/mint_mouth.js): open/round/teeth articulation axes minted by
// anchor-pole contrast from ~36 mouth-state phrase fields across human AND
// animal subjects, orthogonalized so each slider moves one articulation.
// Plus LoRA adapters (brodiffusion's Krea 2 runtime-adapter path): attach
// .safetensors LoRAs, rescale each live (strengths ride every generate as
// `loraScales`), remove without reloading; the list persists and re-applies
// on every model load.
//
// Krea 2 is a 12.9B flow-matching DiT conditioned on tapped Qwen3-VL-4B hidden
// states, decoded by the Qwen-Image VAE (vae_scale_factor() == 8, patch_size
// == 2 — see brodiffusion/include/brodiffusion/pipeline.h and
// weights/krea-2-turbo/model_index.json). Every technique's native call shape
// is already handled by the worker; this file is the DOM + message wiring.
//
// The UI is split into feature modules under ui/, each an init<Feature>(ctx)
// over the shared ctx built here: state accessors (busy/loaded/live), the
// core persist/buildGenerateMsg/refreshButtons/setBusy functions with hook
// registries the features contribute to, and the control framework
// (ui/controls.js) that attaches buildCtl/refreshDeck/switchSection onto ctx.

import { installSystemMenu } from "/lib/system-menu.js";
import { $ } from "/app/ui/util.js";
import { loadPrefs, savePrefs } from "/app/ui/store.js";
import { createClient } from "/app/ui/client.js";
import { initControls } from "/app/ui/controls.js";
import { initIdentity } from "/app/ui/identity.js";
import { initFace } from "/app/ui/face.js";
import { initTune } from "/app/ui/tune.js";
import { initAxes } from "/app/ui/axes.js";
import { initExplore } from '/app/ui/explore.js';
import { initMint } from "/app/ui/mint.js";
import { initWalk } from "/app/ui/walk.js";
import { initLora } from "/app/ui/lora.js";
import { initGate } from "/app/ui/gate.js";
import { initSpatial } from "/app/ui/spatial.js";
import { initRender } from "/app/ui/render.js";
import { initModel } from "/app/ui/model.js";

function init() {
  const prefs = loadPrefs();
  const client = createClient();

  let loaded = false;
  let busy = false;
  let live = prefs.live != null ? prefs.live : true;

  // Generation defaults (shown as hints; the reset button restores them).
  // steps 8 / guidance 1.0 are Krea 2 Turbo's own recipe: ui.py's dial_column()
  // radios steps at [4,8,12] (default 8); guidance 1.0 disables CFG, matching
  // Turbo's intended no-CFG mode (see brodiffusion/include/brodiffusion/
  // dit/krea2.h's CFG-convention comment: Raw g=4.5 -> guidance 5.5, Turbo
  // g=0 -> guidance 1.0).
  const DEFAULTS = { seed: 0, steps: 8, guidance: 1.0, width: 1024, height: 1024 };
  const SIZE_MIN = 256, SIZE_MAX = 2048, SIZE_MULT = 16;   // Krea 2: /8 VAE × /2 patch = /16
  const roundSize = (n) => Math.max(SIZE_MIN, Math.min(SIZE_MAX,
    Math.round((+n || DEFAULTS.width) / SIZE_MULT) * SIZE_MULT));
  const MAXCHARS = 1000;
  const PREVIEW_STEPS = 4;
  const PREVIEW_SIZE = 512;

  // restore persisted text fields (feature modules restore their own below)
  if (prefs.modelDir) $('model-dir').value = prefs.modelDir;
  if (prefs.textEncoder != null) $('text-encoder').value = prefs.textEncoder;
  if (prefs.prompt)   $('prompt').value = prefs.prompt;
  if (prefs.negPrompt != null) $('neg-prompt').value = prefs.negPrompt;
  ['seed', 'steps', 'guidance'].forEach((k) => {
    if (prefs[k] != null) $(k).value = prefs[k];
  });
  // width/height replaced the old square `size` select — migrate legacy prefs.
  const legacySize = prefs.size != null ? +prefs.size : null;
  if (prefs.width != null) $('width').value = prefs.width; else if (legacySize) $('width').value = legacySize;
  if (prefs.height != null) $('height').value = prefs.height; else if (legacySize) $('height').value = legacySize;
  // (dial/band/gate prefs are applied when their rows are built in ui/tune.js)
  $('live').checked = live;

  // ── shared context: state accessors, cores, and feature hook registries ──
  // Feature modules contribute through the on* registries: persist() builds
  // the base prefs object then each hook adds its keys; buildGenerateMsg()
  // likewise for the worker message; refreshButtons() runs the base buttons
  // then per-feature ones; setBusy(false) drains the idle hooks.
  const persistHooks = [], generateMsgHooks = [], refreshButtonsHooks = [], idleHooks = [];
  const ctx = {
    client: client, prefs: prefs,
    DEFAULTS: DEFAULTS, roundSize: roundSize,
    get busy() { return busy; },
    get loaded() { return loaded; },
    get live() { return live; },
    setBusy: setBusy,
    setLoaded: (b) => { loaded = b; },
    persist: persist, status: status,
    schedule: schedule, pump: pump,
    buildGenerateMsg: buildGenerateMsg, refreshButtons: refreshButtons,
    onPersist: (fn) => persistHooks.push(fn),
    onGenerateMsg: (fn) => generateMsgHooks.push(fn),
    onRefreshButtons: (fn) => refreshButtonsHooks.push(fn),
    onIdle: (fn) => idleHooks.push(fn),
  };

  function persist() {
    const p = {
      modelDir: $('model-dir').value,
      textEncoder: $('text-encoder').value,
      prompt: $('prompt').value,
      negPrompt: $('neg-prompt').value,
      seed: $('seed').value, steps: $('steps').value,
      guidance: $('guidance').value,
      width: $('width').value, height: $('height').value,
      live: live,
    };
    persistHooks.forEach((fn) => fn(p));
    savePrefs(p);
    // persist() runs on every committed control change, so it is the one
    // choke point where "what's active" can have moved — refresh the deck.
    ctx.refreshDeck();
  }

  function status(msg, kind) {
    const el = $('status-text'); el.textContent = msg; el.className = kind || '';
  }

  function refreshButtons() {
    const busyOrUnloaded = busy || !loaded;
    $('btn-generate').disabled = busyOrUnloaded;
    $('btn-load').disabled = busy;
    refreshButtonsHooks.forEach((fn) => fn(busyOrUnloaded));
  }
  function setBusy(b) {
    busy = b; refreshButtons();
    if (!b) idleHooks.forEach((fn) => fn());
  }

  // Generation opts from the form. 'preview' trades quality for a fast live-drag
  // frame (sana-lab's schedule/pump convention); Generate always runs 'full'.
  function genOpts(quality) {
    const preview = quality === 'preview';
    let w = roundSize($('width').value);
    let h = roundSize($('height').value);
    const fieldSteps = +$('steps').value || DEFAULTS.steps;
    // Preview: scale the whole frame down under PREVIEW_SIZE, keeping aspect.
    if (preview && Math.max(w, h) > PREVIEW_SIZE) {
      const s = PREVIEW_SIZE / Math.max(w, h);
      w = roundSize(w * s); h = roundSize(h * s);
    }
    const steps = preview ? Math.min(fieldSteps, PREVIEW_STEPS) : fieldSteps;
    return {
      width: w, height: h, steps: steps,
      guidanceScale: +$('guidance').value || DEFAULTS.guidance,
      seed: +$('seed').value || 0,
    };
  }
  function buildGenerateMsg(quality) {
    const msg = {
      type: 'generate',
      prompt: $('prompt').value,
      negPrompt: $('neg-prompt').value.trim(),
      opts: genOpts(quality),
    };
    // features append their fields (band/dial/gate, axisControls, expression,
    // spectrum, mouth, loraScales) — same final shape the worker always got
    generateMsgHooks.forEach((fn) => fn(msg));
    return msg;
  }

  // Latest-wins render scheduler (sana-lab's pattern): dragging any dial/band/
  // axis/gate slider coalesces to its final value; a 'full' request upgrades a
  // queued 'preview' so releasing a slider always lands a clean frame.
  let pendingQuality = null;
  function schedule(quality) {
    if (!loaded) return;
    // No live low-res preview. It rendered a downscaled, 4-step throwaway frame
    // while dragging and then swapped in the real one — two visibly different
    // images per change, which read as confusing (and the downscale is what put
    // a size-mismatched frame on the canvas). Live mode now lands ONE full-quality
    // frame when a control settles (the slider 'change' event), nothing mid-drag.
    if (quality !== 'full') return;
    pendingQuality = 'full';
    pump();
  }
  function pump() {
    if (busy || !loaded || !pendingQuality) return;
    const quality = pendingQuality;
    pendingQuality = null;
    runGenerate(quality);
  }
  function runGenerate(quality) {
    persist();
    setBusy(true);
    const msg = buildGenerateMsg(quality);
    status((quality === 'preview' ? 'preview' : 'generating') + ' · ' +
           msg.opts.width + '×' + msg.opts.height + ' · ' + msg.opts.steps + ' steps…');
    $('timing').textContent = '';
    const usedSeed = msg.opts.seed;
    client.send(msg, (err, resp) => {
      setBusy(false);
      if (err) { status(String(err.message || err), 'err'); pump(); return; }
      ctx.drawBitmap(resp.bitmap, resp.width, resp.height);
      // Only full-quality frames are keepers — previews (live slider scrubs) are
      // throwaway, and downscaled, so they never enter the history or seed log.
      if (quality === 'full') {
        ctx.recordSeed(usedSeed);
        ctx.addHistoryEntry(resp.bitmap, resp.width, resp.height,
                            { seed: usedSeed, steps: msg.opts.steps, width: resp.width, height: resp.height });
      }
      status(quality === 'preview' ? 'preview' : 'done', 'ok');
      if (ctx.setStackMeter) ctx.setStackMeter(resp.stack);
      $('timing').textContent = (resp.ms ? resp.ms + ' ms' : '') +
        (resp.exprNeutral ? ' · field vs “' + resp.exprNeutral + '”' : '') +
        (resp.spectrumNote ? ' · ' + resp.spectrumNote : '') +
        (resp.identityNote ? ' · ' + resp.identityNote : '') +
        (quality === 'preview' ? ' · preview' : '');
      pump();
    });
  }
  // Explicit Generate: with randomize on, roll a fresh seed first (control-driven
  // re-renders keep the current seed so a slider's effect is A/B-comparable).
  function doGenerate() {
    if ($('rand-seed').checked) { $('seed').value = String(ctx.randomSeed()); persist(); }
    schedule('full');
  }

  // ── feature modules ──────────────────────────────────────────────────────
  // Order matters: controls first (everything builds rows through ctx.buildCtl),
  // then the panel build order fixes the deck's chip order (identity →
  // expression → spectrum → mouth → tune dials; the axis bank joins async
  // after boot).
  initControls(ctx);
  initIdentity(ctx);
  initFace(ctx);
  initTune(ctx);
  initAxes(ctx);
  initExplore(ctx);
  initMint(ctx);
  initWalk(ctx);
  initLora(ctx);
  initGate(ctx);
  initSpatial(ctx);

  // character counters (entered / max) for the prompt fields
  function bindCounter(taId, countId) {
    const ta = $(taId), out = $(countId);
    function upd() {
      const n = ta.value.length;
      out.textContent = n + ' / ' + MAXCHARS;
      out.classList.toggle('warn', n >= MAXCHARS);
    }
    ta.addEventListener('input', upd);
    upd();
  }
  bindCounter('prompt', 'prompt-count');
  bindCounter('neg-prompt', 'neg-count');

  // ── wire up ──────────────────────────────────────────────────────────────
  $('btn-generate').addEventListener('click', doGenerate);
  ['model-dir', 'text-encoder', 'prompt', 'neg-prompt', 'seed', 'steps', 'guidance', 'width', 'height']
    .forEach((id) => $(id).addEventListener('change', persist));
  $('prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doGenerate(); }
  });
  $('live').addEventListener('change', () => {
    live = $('live').checked; persist();
    if (live) schedule('full');
  });

  // Test seam: headless tests need to assert that a slider actually reaches the
  // generate call, not merely that a row appeared in the DOM.
  window.__ctx = ctx;

  initRender(ctx);
  initModel(ctx);

  // ── boot ─────────────────────────────────────────────────────────────────
  ctx.switchSection(ctx.activeSection);   // restore the last-open rail section
  ctx.renderAxisManager();
  ctx.renderLoraList();   // persisted entries show immediately; applied on load
  refreshButtons();
  $('view').style.display = 'none';   // no empty canvas box until the first render
  fetch('assets/axes_meta.json').then((r) => r.json()).then((meta) => {
    ctx.applyAxesMeta(meta);
  }).catch((e) => { status('failed to load axes_meta.json: ' + e.message, 'err'); });

  client.onReady(() => {
    status('ready — load a model to begin');
    if ($('model-dir').value.trim()) ctx.doLoad();
  });
}

installSystemMenu();
init();
