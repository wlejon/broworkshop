// Diffusion Lab — application bootstrap.
//
// Drives bro.diffusion through the step-wise prime()/stepOnce()/decode()
// API the binding was built for: a worker owns the pipeline, the main
// thread paces one denoising step per animation frame, stores every frame
// for scrubbing, and renders captured cross-attention as a heatmap.
(function () {
  'use strict';

  var DLab = window.DLab;
  function $(id) { return document.getElementById(id); }

  // ── persisted UI state ───────────────────────────────────────────────
  var STORE_KEY = 'diffusion-lab.v1';
  function loadPrefs() {
    try { return JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function savePrefs(p) {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(p)); }
    catch (e) { /* storage unavailable — non-fatal */ }
  }

  function start() {
    if (!$('view')) { requestAnimationFrame(start); return; }
    init();
  }

  function init() {
    var prefs = loadPrefs();

    var viewport = DLab.Viewport.create($('view'));
    var client = DLab.Client.create();

    // session state
    var detected = null;     // resolved profile (from Profiles.detect)
    var tokenizer = null;    // CLIP tokenizer for the loaded model
    var loaded = false;      // weights resident in the worker
    var caps = null;
    var runToken = 0;        // bumped to abandon an in-flight generation
    var running = false;

    var frames = [];         // { stepIndex, image } per denoising step
    var finalTrace = null;   // trace of the finished image
    var latentW = 0, latentH = 0;
    var lastPrompt = '';

    // ── status helpers ─────────────────────────────────────────────────
    function status(msg, kind) {
      var el = $('status-text');
      el.textContent = msg;
      el.className = kind || '';
    }

    var attention = DLab.Attention.create($('tokens'), {
      onSelect: function () {
        $('overlay-on').checked = true;
        refreshOverlay();
      },
    });

    // ── prefill from saved preferences ─────────────────────────────────
    if (prefs.prompt) $('prompt').value = prefs.prompt;
    if (prefs.neg) $('neg').value = prefs.neg;
    if (prefs.steps) $('steps').value = prefs.steps;
    if (prefs.cfg) $('cfg').value = prefs.cfg;
    if (prefs.width) $('width').value = prefs.width;
    if (prefs.height) $('height').value = prefs.height;
    if (prefs.seed != null) $('seed').value = prefs.seed;
    if (prefs.scheduler) $('scheduler').value = prefs.scheduler;

    // ── backend badge ──────────────────────────────────────────────────
    var badge = $('backend');
    var gpu = !!(window.bro && bro.tensor && bro.tensor.available);
    badge.textContent = gpu ? 'GPU' : 'CPU';
    badge.classList.add(gpu ? 'ok' : 'bad');
    if (window.bro && bro.diffusion && bro.diffusion.version) {
      $('diff-version').textContent = 'brodiffusion ' + bro.diffusion.version;
    }
    if (!gpu) {
      status('CPU backend — generation will be slow; an LCM model helps.', '');
    }

    // ── open a model directory ─────────────────────────────────────────
    function openModel() {
      if (running) return;
      if (typeof showOpenFolderDialog !== 'function') {
        status('folder dialog unavailable in this build', 'err');
        return;
      }
      var dirs = showOpenFolderDialog(prefs.modelDir || null);
      if (!dirs || !dirs.length) return;
      adoptModel(dirs[0]);
    }

    function adoptModel(dir) {
      try {
        detected = DLab.Profiles.detect(dir);
        tokenizer = DLab.Tokenizer.create(
          DLab.Profiles.readText(detected.vocabPath),
          DLab.Profiles.readText(detected.mergesPath));
      } catch (e) {
        detected = null;
        tokenizer = null;
        status('cannot use that folder: ' + e.message, 'err');
        return;
      }
      loaded = false;
      caps = detected.caps;
      $('model-name').textContent = detected.name;
      $('model-name').classList.remove('muted');
      $('btn-load').disabled = false;
      $('btn-generate').disabled = true;
      prefs.modelDir = dir;
      savePrefs(prefs);
      status(detected.profile.label + ' detected — sampler suggestion: ' +
        detected.suggestedScheduler.toUpperCase() + '. Click Load weights.', '');
    }

    // ── load weights into the worker pipeline ──────────────────────────
    function loadWeights() {
      if (running || !detected) return;
      var sel = $('scheduler').value;
      var scheduler = sel === 'auto' ? detected.suggestedScheduler : sel;
      var spec = detected.profile.buildSpec(detected, scheduler);

      setBusy(true);
      status('loading weights — this reads multi-GB files, please wait…', '');
      $('btn-load').disabled = true;

      client.load(spec, function (err, info) {
        setBusy(false);
        if (err) {
          status('load failed: ' + err.message, 'err');
          $('btn-load').disabled = false;
          return;
        }
        loaded = true;
        var cfg = info.config || {};
        // Nudge the step count if it's clearly wrong for the sampler —
        // LCM resolves in a handful of steps, DDIM needs a couple dozen.
        var steps = parseFloat($('steps').value);
        if (scheduler === 'lcm' && (!(steps > 0) || steps > 12)) {
          $('steps').value = 6;
        } else if (scheduler === 'ddim' && (!(steps > 0) || steps < 15)) {
          $('steps').value = 25;
        }
        status('ready — ' + (cfg.modelClass || 'model') + ' · ' +
          (cfg.scheduler || scheduler) + ' · ' +
          (info.backend || '?') + ' · ' +
          info.numXAttnBlocks + ' cross-attention blocks', 'ok');
        $('btn-generate').disabled = false;
        $('btn-load').disabled = false;
      });
    }

    // ── generation ─────────────────────────────────────────────────────
    function readOpts() {
      function num(id, dflt) {
        var v = parseFloat($(id).value);
        return isFinite(v) ? v : dflt;
      }
      function mult8(v) { return Math.max(64, Math.round(v / 8) * 8); }
      return {
        width: mult8(num('width', 512)),
        height: mult8(num('height', 512)),
        steps: Math.max(1, Math.round(num('steps', 6))),
        guidanceScale: num('cfg', 7.5),
        negativePrompt: $('neg').value || '',
        seed: Math.max(0, Math.round(num('seed', 0))),
      };
    }

    function generate() {
      if (running || !loaded) return;
      var prompt = $('prompt').value.trim();
      if (!prompt) { status('enter a prompt first', 'err'); return; }

      var opts = readOpts();
      lastPrompt = prompt;
      var trace = $('trace').checked;
      var token = ++runToken;

      // persist inputs
      prefs.prompt = prompt;
      prefs.neg = opts.negativePrompt;
      prefs.steps = opts.steps;
      prefs.cfg = opts.guidanceScale;
      prefs.width = opts.width;
      prefs.height = opts.height;
      prefs.seed = opts.seed;
      prefs.scheduler = $('scheduler').value;
      savePrefs(prefs);

      // reset run state — release the previous run's frame bitmaps eagerly
      // rather than waiting on GC.
      for (var fi = 0; fi < frames.length; fi++) {
        if (frames[fi].bitmap) frames[fi].bitmap.close();
      }
      frames = [];
      finalTrace = null;
      attention.clear();
      $('block').textContent = '';
      $('scrub').disabled = true;
      $('scrub').max = 0;
      $('scrub').value = 0;
      viewport.setOverlay(null);
      setBusy(true);
      status('encoding prompt…', '');

      client.prime(prompt, opts, trace, function (err, info) {
        if (err || token !== runToken) {
          if (err) status('prime failed: ' + err.message, 'err');
          if (token === runToken) setBusy(false);
          return;
        }
        latentW = info.latentWidth;
        latentH = info.latentHeight;
        $('progress-bar').style.width = '0%';
        stepLoop(token, info.numSteps);
      });
    }

    function stepLoop(token, numSteps) {
      if (token !== runToken) return;       // cancelled
      client.step(function (err, msg) {
        if (token !== runToken) return;     // cancelled mid-step
        if (err) {
          status('step failed: ' + err.message, 'err');
          finishRun();
          return;
        }
        if (msg.bitmap) {
          frames.push({ stepIndex: msg.stepIndex, bitmap: msg.bitmap });
          viewport.setImage(msg.bitmap);
        }
        if (msg.trace) finalTrace = msg.trace;

        var done = msg.done;
        var idx = msg.stepIndex || frames.length;
        $('progress-bar').style.width =
          Math.round(100 * idx / numSteps) + '%';
        $('step-label').textContent = done
          ? 'done · ' + numSteps + ' steps'
          : 'step ' + idx + ' / ' + numSteps;

        if (done) { completeRun(numSteps); return; }
        // The worker round-trip is itself the async yield — the main thread
        // is idle (and the canvas repaints) while the worker computes — so
        // the loop drives itself directly without depending on rAF.
        stepLoop(token, numSteps);
      });
    }

    function completeRun(numSteps) {
      finishRun();
      status('generated ' + numSteps + ' steps · seed ' +
        readOpts().seed, 'ok');

      // wire the step scrubber over the stored trajectory
      if (frames.length) {
        $('scrub').disabled = false;
        $('scrub').max = frames.length - 1;
        $('scrub').value = frames.length - 1;
      }
      // build the attention inspector
      buildAttention();
    }

    function finishRun() {
      running = false;
      setBusy(false);
    }

    function cancel() {
      if (!running) return;
      runToken++;
      client.reset();
      finishRun();
      status('cancelled', '');
      $('step-label').textContent = 'idle';
    }

    // ── attention inspector ────────────────────────────────────────────
    function buildAttention() {
      var blockSel = $('block');
      blockSel.textContent = '';
      if (!finalTrace || !tokenizer) {
        attention.clear();
        return;
      }
      var enc = tokenizer.encodeContext(lastPrompt);
      attention.setTokens(enc);

      var opts = DLab.Attention.blockOptions(finalTrace, latentW, latentH);
      for (var i = 0; i < opts.length; i++) {
        var o = document.createElement('option');
        o.value = String(opts[i].value);
        o.textContent = opts[i].label;
        blockSel.appendChild(o);
      }
    }

    function refreshOverlay() {
      var onLastFrame =
        $('scrub').disabled || +$('scrub').value === frames.length - 1;
      var idx = attention.activeIndex();
      if (!$('overlay-on').checked || !finalTrace || idx < 0 || !onLastFrame) {
        viewport.setOverlay(null);
        return;
      }
      var sel = $('block').value;
      var blockSel = sel === 'avg' ? 'avg' : (parseInt(sel, 10) || 0);
      var grid = DLab.Attention.computeHeatmap(
        finalTrace, idx, blockSel, latentW, latentH);
      viewport.setOverlay(grid, +$('opacity').value / 100);
    }

    // ── busy / control gating ──────────────────────────────────────────
    function setBusy(on) {
      running = on;
      $('btn-generate').disabled = on || !loaded;
      $('btn-cancel').disabled = !on;
      $('btn-open').disabled = on;
      $('btn-load').disabled = on || !detected;
      $('view-hint').style.display =
        viewport.hasImage() || on ? 'none' : 'block';
    }

    // ── wiring ─────────────────────────────────────────────────────────
    $('btn-open').addEventListener('click', openModel);
    $('btn-load').addEventListener('click', loadWeights);
    $('btn-generate').addEventListener('click', generate);
    $('btn-cancel').addEventListener('click', cancel);
    $('btn-rand').addEventListener('click', function () {
      $('seed').value = Math.floor(Math.random() * 1e9);
    });

    $('scrub').addEventListener('input', function () {
      var i = +$('scrub').value;
      if (frames[i]) {
        viewport.setImage(frames[i].bitmap);
        $('step-label').textContent =
          'step ' + frames[i].stepIndex + ' / ' + frames.length;
      }
      refreshOverlay();
    });

    $('overlay-on').addEventListener('change', refreshOverlay);
    $('block').addEventListener('change', refreshOverlay);
    window.addEventListener('resize', function () { viewport.resize(); });
    $('opacity').addEventListener('input', function () {
      $('op-val').textContent = $('opacity').value + '%';
      viewport.setOpacity(+$('opacity').value / 100);
    });

    // ── initial state ──────────────────────────────────────────────────
    $('view-hint').style.display = 'block';
    if (prefs.modelDir) {
      status('last model: ' + prefs.modelDir +
        ' — click Open model to re-select, or Load if unchanged.', '');
    }

    // debug / headless test handle
    window.DLabApp = {
      adoptModel: adoptModel,
      loadWeights: loadWeights,
      generate: generate,
      viewport: viewport,
      state: function () {
        return { loaded: loaded, running: running, frames: frames.length,
                 hasTrace: !!finalTrace };
      },
    };
  }

  if (document.readyState === 'complete' ||
      document.readyState === 'interactive') {
    start();
  } else {
    window.addEventListener('load', start);
  }
})();
