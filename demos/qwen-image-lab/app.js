// Qwen-Image Lab — main thread. Drives the Qwen-Image 2.1 pipeline (in a
// worker, lab/qwen-image-worker.js) across the control surfaces
// qwen-image-research mapped over 4,000-odd renders:
//
//   axes    the 88-axis minted conditioning bank (axes_qi21_v2.bcd1) — the one
//           surface with real authority (25 sigma against 4.4 for the best
//           in-network dial), applied to every token row at prime() time.
//   desk    controller.json's fitted faders: labelled sliders that move one
//           perceptual axis and leave the others alone, each spending a little
//           of 29 scheduled knob parameters, held inside the safe box its
//           gainCal draws by render.
//   gate    the post-tanh residual gates — four independent multipliers over a
//           block band, a post-tanh delta that reaches past what tanh allows,
//           and the per-token mask, painted on the render itself.
//   tune    the modulation delta (a fraction of the model's own vector), the
//           norm_out scale, and the prefix K/V dial.
//   scene   prompt, seed, size (512²/8 explore, 1024²/40 final), and the edit
//           path — condition images through the vision tower AND the 16x
//           autoencoder, with the prompt saying what to change.
//
// The rail is sectioned with a pinned "deck" at its foot: one chip per
// non-neutral control across every section (click → jump to it, × → neutral),
// plus Generate — the "what is shaping this image" view that a rack of sliders
// otherwise loses.
//
// The UI is split into feature modules under ui/, each an init<Feature>(ctx)
// over the shared ctx built here: state accessors (busy/loaded/live), the core
// persist/buildGenerateMsg/refreshButtons/setBusy functions with hook
// registries the features contribute to, and the control framework
// (ui/controls.js) that attaches buildCtl/refreshDeck/switchSection onto ctx.

import { installSystemMenu } from "/lib/system-menu.js";
import { $ } from "/app/ui/util.js";
import { loadPrefs, savePrefs } from "/app/ui/store.js";
import { createClient } from "/app/ui/client.js";
import { initControls } from "/app/ui/controls.js";
import { initScene } from "/app/ui/scene.js";
import { initAxes } from "/app/ui/axes.js";
import { initDesk } from "/app/ui/desk.js";
import { initGate } from "/app/ui/gate.js";
import { initTune } from "/app/ui/tune.js";
import { initRender } from "/app/ui/render.js";
import { initModel } from "/app/ui/model.js";

function init() {
  const prefs = loadPrefs();
  const client = createClient();

  let loaded = false;
  let busy = false;
  let live = prefs.live != null ? prefs.live : false;

  // 2.1's own recipe: 40 steps, guidance 1.0 (true_cfg 1.0 — no CFG, one
  // branch, no negative prompt). The lab opens at the research configuration
  // instead, 512²/8, because that is where the desk is calibrated and a render
  // costs 2.5 s rather than 28.
  const DEFAULTS = { seed: 7, steps: 8, guidance: 1.0, width: 512, height: 512 };
  const SIZE_MIN = 256, SIZE_MAX = 2048, SIZE_MULT = 32;
  const roundSize = (n) => Math.max(SIZE_MIN, Math.min(SIZE_MAX,
    Math.round((+n || DEFAULTS.width) / SIZE_MULT) * SIZE_MULT));
  const MAXCHARS = 1000;

  if (prefs.modelDir) $('model-dir').value = prefs.modelDir;
  if (prefs.quantize != null) $('quantize').checked = !!prefs.quantize;
  if (prefs.prompt) $('prompt').value = prefs.prompt;
  ['seed', 'steps', 'guidance'].forEach((k) => {
    if (prefs[k] != null) $(k).value = prefs[k];
  });
  if (prefs.width != null) $('width').value = prefs.width;
  if (prefs.height != null) $('height').value = prefs.height;
  $('live').checked = live;

  // ── shared context: state accessors, cores, and feature hook registries ──
  const persistHooks = [], generateMsgHooks = [], refreshButtonsHooks = [],
        idleHooks = [], renderHooks = [];
  const ctx = {
    client: client, prefs: prefs,
    DEFAULTS: DEFAULTS, roundSize: roundSize, SIZE_MULT: SIZE_MULT,
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
    // Every full render is announced here: the retention meter, the A/B
    // baseline and the gate tab's result pane all read the same frame.
    onRender: (fn) => renderHooks.push(fn),
  };

  function persist() {
    const p = {
      modelDir: $('model-dir').value,
      quantize: $('quantize').checked,
      prompt: $('prompt').value,
      seed: $('seed').value, steps: $('steps').value,
      guidance: $('guidance').value,
      width: $('width').value, height: $('height').value,
      live: live,
    };
    persistHooks.forEach((fn) => fn(p));
    savePrefs(p);
    // persist() runs on every committed control change, so it is the one choke
    // point where "what's active" can have moved — refresh the deck.
    ctx.refreshDeck();
  }

  function status(msg, kind) {
    const el = $('status-text'); el.textContent = msg; el.className = kind || '';
  }

  function refreshButtons() {
    const busyOrUnloaded = busy || !loaded;
    $('btn-generate').disabled = busyOrUnloaded;
    $('btn-load').disabled = busy;
    $('btn-unload').disabled = busyOrUnloaded;
    $('btn-release-te').disabled = busyOrUnloaded;
    refreshButtonsHooks.forEach((fn) => fn(busyOrUnloaded));
  }
  function setBusy(b) {
    busy = b; refreshButtons();
    if (!b) idleHooks.forEach((fn) => fn());
  }

  function genOpts() {
    const steps = Math.max(1, +$('steps').value || DEFAULTS.steps);
    const opts = {
      steps: steps,
      guidanceScale: +$('guidance').value || DEFAULTS.guidance,
      seed: +$('seed').value || 0,
    };
    // With condition images the canvas may be derived from the last image's
    // aspect instead — in which case width/height must be ABSENT, not zero.
    if (ctx.deriveSize && ctx.deriveSize()) opts.outputResolution = ctx.outputResolution();
    else { opts.width = roundSize($('width').value); opts.height = roundSize($('height').value); }
    return opts;
  }
  function buildGenerateMsg() {
    const msg = { type: 'generate', prompt: $('prompt').value, opts: genOpts() };
    // features append their fields (axes, budget, desk, gateRows, gateDelta,
    // gateMask, mod, normOut, prefixKv, conditionImages)
    generateMsgHooks.forEach((fn) => fn(msg));
    return msg;
  }

  // Latest-wins render scheduler: dragging a slider coalesces to its final
  // value, and only a settled control (the 'change' event) asks for a frame —
  // a 512²/8 render is 2.5 s, so there is no mid-drag preview to be had.
  let pendingQuality = null;
  function schedule(quality) {
    if (!loaded) return;
    if (quality !== 'full') return;
    pendingQuality = 'full';
    pump();
  }
  function pump() {
    if (busy || !loaded || !pendingQuality) return;
    pendingQuality = null;
    runGenerate();
  }
  function runGenerate() {
    persist();
    setBusy(true);
    const msg = buildGenerateMsg();
    const size = msg.opts.width
      ? msg.opts.width + '×' + msg.opts.height
      : 'derived @ ' + msg.opts.outputResolution;
    status('generating · ' + size + ' · ' + msg.opts.steps + ' steps…');
    $('timing').textContent = '';
    const usedSeed = msg.opts.seed;
    client.send(msg, (err, resp) => {
      setBusy(false);
      if (err) { status(String(err.message || err), 'err'); pump(); return; }
      ctx.drawBitmap(resp.bitmap, resp.width, resp.height);
      ctx.recordSeed(usedSeed);
      ctx.addHistoryEntry(resp.bitmap, resp.width, resp.height,
                          { seed: usedSeed, steps: msg.opts.steps,
                            width: resp.width, height: resp.height });
      status('done', 'ok');
      ctx.setStackMeter(resp.stack);
      $('timing').textContent =
        (resp.ms ? resp.ms + ' ms' : '') +
        (resp.msPerStep ? ' · ' + (resp.msPerStep / 1000).toFixed(2) + ' s/step' : '') +
        (resp.textRows != null ? ' · ' + resp.textRows + ' prefix rows + ' + resp.imgLen + ' tokens' : '');
      if (resp.vram && resp.vram.totalBytes) {
        $('peak-vram').textContent =
          (resp.vram.usedBytes / 1e9).toFixed(1) + ' / ' +
          (resp.vram.totalBytes / 1e9).toFixed(1) + ' GB VRAM';
      }
      const frame = ctx.lastFrame();
      renderHooks.forEach((fn) => fn(frame, msg, resp));
      pump();
    });
  }
  // Explicit Generate: with randomize on, roll a fresh seed first (control-
  // driven re-renders keep the seed, which is what makes a slider A/B-able).
  function doGenerate() {
    if ($('rand-seed').checked) { $('seed').value = String(ctx.randomSeed()); persist(); }
    schedule('full');
  }

  // ── feature modules ──────────────────────────────────────────────────────
  // Order matters: controls first (everything builds rows through
  // ctx.buildCtl), then the panel build order fixes the deck's chip order.
  initControls(ctx);
  initScene(ctx);
  initAxes(ctx);
  initDesk(ctx);
  initGate(ctx);
  initTune(ctx);

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

  // ── wire up ──────────────────────────────────────────────────────────────
  $('btn-generate').addEventListener('click', doGenerate);
  ['model-dir', 'prompt', 'seed', 'steps', 'guidance', 'width', 'height']
    .forEach((id) => $(id).addEventListener('change', persist));
  $('quantize').addEventListener('change', persist);
  $('prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doGenerate(); }
  });
  $('live').addEventListener('change', () => {
    live = $('live').checked; persist();
    if (live) schedule('full');
  });

  // Test seam: headless tests assert that a slider actually reaches the
  // generate call, not merely that a row appeared in the DOM.
  window.__ctx = ctx;

  initRender(ctx);
  initModel(ctx);

  // ── boot ─────────────────────────────────────────────────────────────────
  ctx.switchSection(ctx.activeSection);
  ctx.buildAxisBank([]);     // the bank list is empty until a model load lands
  refreshButtons();
  $('view').style.display = 'none';   // no empty canvas box until the first render

  client.onReady(() => {
    status('ready — load a model to begin');
    if ($('model-dir').value.trim()) ctx.doLoad();
  });
}

installSystemMenu();
init();
