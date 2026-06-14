// Diffusion Lab — application bootstrap.
//
// Drives bro.diffusion through the step-wise prime()/stepOnce()/decode()
// API the binding was built for: a worker owns the pipeline, the main
// thread paces one denoising step per worker round-trip, stores every
// frame for scrubbing, and renders — or steers — cross-attention.
import { Tokenizer } from "/app/lab/tokenizer.js";
import { Profiles } from "/app/lab/profiles.js";
import { Client } from "/app/lab/client.js";
import { Viewport } from "/app/lab/viewport.js";
import { Attention } from "/app/lab/attention.js";

  const DLab = { Tokenizer, Profiles, Client, Viewport, Attention };
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
    var aggTrace = null;     // per-step cross-attention, meaned over the run
    var traceSteps = 0;      // number of steps folded into aggTrace
    var traceShapes = null;  // [{Lq,Lk}] per layer — learned from step 0
    var latentW = 0, latentH = 0;

    var biasMap = {};        // contextIndex -> steering bias (logit offset)
    var currentEnc = null;   // last tokenization of the prompt textarea
    var promptTimer = 0;     // debounce handle for live re-tokenization
    var runTrace = false;    // capture cross-attention for the active run
    var runBias = false;     // the active run has steering applied
    var runBiasMap = {};     // biasMap snapshot taken at generate() time
    var loras = [];          // [{path, scale}] LoRA adapters to merge at load
    var traceCapable = true; // false once an INT8-quantized model is loaded

    // img2img / inpaint + ControlNet — see plan in dfa38f0 binding commit.
    // The CN list is sticky on the pipeline (registered at load time); its
    // length must match cfg.numControlNets at prime time. Per-row image /
    // scale / window are runtime knobs (no reload needed). Init/mask images
    // are runtime too.
    var controlnets = [];    // [{path, image, scale, startStep, endStep}]
    var cnLoadedCount = 0;   // controlnets registered on the live pipeline
    var initImage = '';
    var initStrength = 0.8;
    var vaeSample = false;
    var maskImage = '';

    // ── status helpers ─────────────────────────────────────────────────
    function status(msg, kind) {
      var el = $('status-text');
      el.textContent = msg;
      el.className = kind || '';
    }

    var attention = DLab.Attention.create($('tokens'), {
      onSelect: function () {
        syncSteerPanel();
        if (aggTrace) $('overlay-on').checked = true;
        refreshOverlay();
      },
    });

    // ── live prompt tokenization ───────────────────────────────────────
    // Token chips exist as soon as a model is adopted, so the prompt can be
    // inspected and steered before the first generation — not only after.
    function buildTokenChips() {
      if (!tokenizer) { attention.clear(); currentEnc = null; return; }
      currentEnc = tokenizer.encodeContext($('prompt').value);
      attention.setTokens(currentEnc);
      for (var k in biasMap) {
        if (biasMap.hasOwnProperty(k)) attention.setBias(+k, biasMap[k]);
      }
      syncSteerPanel();
    }

    function labelFor(contextIndex) {
      if (!currentEnc) return '?';
      if (contextIndex === currentEnc.bosIndex) return '[start]';
      if (contextIndex === currentEnc.eosIndex) return '[end]';
      var t = currentEnc.tokens;
      for (var i = 0; i < t.length; i++) {
        if (t[i].contextIndex === contextIndex) return t[i].text || '·';
      }
      return '?';
    }

    function fmtBias(v) {
      if (!v) return 'neutral';
      return (v > 0 ? '+' + v + ' · boost' : v + ' · suppress');
    }

    // Reflect the active token's steering state in the steering panel.
    function syncSteerPanel() {
      var idx = attention.activeIndex();
      var has = idx >= 0 && currentEnc != null;
      $('steer-empty').classList.toggle('hidden', has);
      $('steer-ctl').classList.toggle('hidden', !has);
      if (!has) return;
      var v = biasMap[idx] || 0;
      $('steer-tok').textContent = labelFor(idx);
      $('steer-bias').value = v;
      $('steer-val').textContent = $('steer-bias').disabled
        ? 'unavailable · INT8' : fmtBias(v);
    }

    // ── prefill from saved preferences ─────────────────────────────────
    if (prefs.prompt) $('prompt').value = prefs.prompt;
    if (prefs.neg) $('neg').value = prefs.neg;
    if (prefs.steps) $('steps').value = prefs.steps;
    if (prefs.cfg) $('cfg').value = prefs.cfg;
    if (prefs.width) $('width').value = prefs.width;
    if (prefs.height) $('height').value = prefs.height;
    if (prefs.seed != null) $('seed').value = prefs.seed;
    if (prefs.scheduler) $('scheduler').value = prefs.scheduler;
    if (prefs.int8) $('int8').checked = true;
    if (prefs.loras && prefs.loras.length) {
      loras = prefs.loras.filter(function (l) { return l && l.path; });
    }
    if (prefs.controlnets && prefs.controlnets.length) {
      controlnets = prefs.controlnets
        .filter(function (c) { return c && c.path; })
        .map(function (c) {
          return {
            path: c.path,
            image: c.image || '',
            scale: isFinite(c.scale) ? c.scale : 1,
            startStep: isFinite(c.startStep) ? c.startStep : 0,
            endStep: isFinite(c.endStep) ? c.endStep : 1,
          };
        });
    }
    if (typeof prefs.initImage === 'string') initImage = prefs.initImage;
    if (isFinite(prefs.initStrength)) initStrength = prefs.initStrength;
    if (prefs.vaeSample) vaeSample = true;
    if (typeof prefs.maskImage === 'string') maskImage = prefs.maskImage;

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
      // INT8 quantization is a GPU-only path — it has no effect on CPU.
      $('int8').checked = false;
      $('int8').disabled = true;
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
      biasMap = {};
      attention.setActive(-1);
      buildTokenChips();
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
      var spec = detected.profile.buildSpec(
        detected, scheduler, $('int8').checked);
      spec.loras = loras;
      spec.controlnets = controlnets.map(function (c) { return { path: c.path }; });

      setBusy(true);
      var extras = [];
      if (loras.length) extras.push(loras.length + ' LoRA');
      if (controlnets.length) extras.push(controlnets.length + ' ControlNet');
      status(extras.length
        ? 'loading weights + ' + extras.join(' + ') + ' — please wait…'
        : 'loading weights — this reads multi-GB files, please wait…', '');
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
        cnLoadedCount = cfg.numControlNets || 0;
        clearCnStale();
        // Nudge the step count if it's clearly wrong for the sampler —
        // LCM resolves in a handful of steps, DDIM needs a couple dozen.
        var steps = parseFloat($('steps').value);
        if (scheduler === 'lcm' && (!(steps > 0) || steps > 12)) {
          $('steps').value = 6;
        } else if (scheduler === 'ddim' && (!(steps > 0) || steps < 15)) {
          $('steps').value = 25;
        }

        // An INT8-quantized U-Net can't run trace mode — brodiffusion's
        // traced cross-attention is FP16-only — so capture and steering go
        // dark for this model. cfg.quantizeWeights reflects what actually
        // happened (it's a no-op on the CPU backend).
        traceCapable = !cfg.quantizeWeights;
        $('trace').disabled = !traceCapable;
        $('steer-bias').disabled = !traceCapable;
        if (!traceCapable) $('trace').checked = false;

        var ready = 'ready — ' + (cfg.modelClass || 'model') + ' · ' +
          (cfg.scheduler || scheduler) + ' · ' + (info.backend || '?') +
          ' · ' + info.numXAttnBlocks + ' cross-attention blocks' +
          (info.lorasApplied ? ' · ' + info.lorasApplied + ' LoRA' : '') +
          (cnLoadedCount ? ' · ' + cnLoadedCount + ' ControlNet' : '');
        if (!traceCapable) ready += ' — INT8: capture & steering off';
        status(ready, 'ok');
        $('btn-generate').disabled = false;
        $('btn-load').disabled = false;
      });
    }

    // ── LoRA adapters ──────────────────────────────────────────────────
    function loraName(p) {
      var parts = String(p).split(/[\\/]/);
      return parts[parts.length - 1] || p;
    }

    function persistLoras() {
      prefs.loras = loras;
      savePrefs(prefs);
    }

    // A LoRA change only takes effect at load time (applyLora merges into the
    // base weights and cannot be undone). If weights are already resident,
    // mark them stale and point the user back at Load weights.
    function markLoraStale() {
      if (!loaded || running) return;
      loaded = false;
      $('btn-generate').disabled = true;
      $('btn-load').disabled = !detected;
      status('LoRA set changed — click Load weights to apply.', '');
    }

    function renderLoraList() {
      var list = $('lora-list');
      list.textContent = '';
      if (!loras.length) {
        var hint = document.createElement('p');
        hint.className = 'muted small';
        hint.textContent = 'None — the base model runs unmodified.';
        list.appendChild(hint);
        return;
      }
      loras.forEach(function (lora, i) {
        var row = document.createElement('div');
        row.className = 'lora-row';

        var name = document.createElement('div');
        name.className = 'lora-name';
        name.textContent = loraName(lora.path);
        name.title = lora.path;

        var scale = document.createElement('input');
        scale.className = 'lora-scale';
        scale.type = 'number';
        scale.step = '0.05';
        scale.value = lora.scale;
        scale.title = 'Adapter strength';
        scale.addEventListener('change', function () {
          var v = parseFloat(scale.value);
          loras[i].scale = isFinite(v) ? v : 1;
          scale.value = loras[i].scale;
          persistLoras();
          markLoraStale();
        });

        var del = document.createElement('button');
        del.className = 'lora-del';
        del.textContent = '✕';
        del.title = 'Remove adapter';
        del.addEventListener('click', function () {
          loras.splice(i, 1);
          renderLoraList();
          persistLoras();
          markLoraStale();
        });

        row.appendChild(name);
        row.appendChild(scale);
        row.appendChild(del);
        list.appendChild(row);
      });
    }

    function addLora() {
      if (running) return;
      if (typeof showOpenFileDialog !== 'function') {
        status('file dialog unavailable in this build', 'err');
        return;
      }
      var files = showOpenFileDialog('LoRA weights|safetensors', true);
      if (!files || !files.length) return;
      for (var i = 0; i < files.length; i++) {
        loras.push({ path: files[i], scale: 1 });
      }
      renderLoraList();
      persistLoras();
      markLoraStale();
    }

    // ── ControlNets + init / mask images ───────────────────────────────
    function baseName(p) {
      var parts = String(p).split(/[\\/]/);
      return parts[parts.length - 1] || p;
    }

    function persistInitMask() {
      prefs.initImage = initImage;
      prefs.initStrength = initStrength;
      prefs.vaeSample = vaeSample;
      prefs.maskImage = maskImage;
      savePrefs(prefs);
    }

    function persistControlnets() {
      prefs.controlnets = controlnets;
      savePrefs(prefs);
    }

    // A ControlNet add/remove only takes effect at load time (add_controlnet
    // ingests model weights, like applyLora). Per-row image/scale/window are
    // runtime — they don't touch the pipeline until prime time.
    function markCnStale() {
      if (running) return;
      $('cn-stale').classList.toggle('hidden',
        controlnets.length === cnLoadedCount);
      if (!loaded) return;
      if (controlnets.length === cnLoadedCount) return;
      loaded = false;
      $('btn-generate').disabled = true;
      $('btn-load').disabled = !detected;
      status('ControlNet set changed — click Load weights to apply.', '');
    }
    function clearCnStale() { $('cn-stale').classList.add('hidden'); }

    function refreshInitSummary() {
      $('init-path').textContent = initImage ? baseName(initImage) : 'none';
      $('init-path').title = initImage || '';
      $('mask-path').textContent = maskImage ? baseName(maskImage) : 'none';
      $('mask-path').title = maskImage || '';
      $('strength-val').textContent = initStrength.toFixed(2);
      $('strength').value = initStrength;
      $('vae-sample').checked = vaeSample;
    }

    function renderCnList() {
      var list = $('cn-list');
      list.textContent = '';
      if (!controlnets.length) {
        var hint = document.createElement('p');
        hint.className = 'muted small';
        hint.textContent = 'None — add one to condition generation on a ' +
          'pose / depth / canny image.';
        list.appendChild(hint);
        return;
      }
      controlnets.forEach(function (cn, i) {
        var row = document.createElement('div');
        row.className = 'cn-row';

        var head = document.createElement('div');
        head.className = 'cn-row-head';
        var name = document.createElement('div');
        name.className = 'cn-name';
        name.textContent = baseName(cn.path);
        name.title = cn.path;
        var del = document.createElement('button');
        del.className = 'cn-del icon';
        del.type = 'button';
        del.textContent = '✕';
        del.title = 'Remove ControlNet';
        del.addEventListener('click', function () {
          if (running) return;
          controlnets.splice(i, 1);
          renderCnList();
          persistControlnets();
          markCnStale();
        });
        head.appendChild(name);
        head.appendChild(del);
        row.appendChild(head);

        // Control image
        var imgField = document.createElement('div');
        imgField.className = 'cn-field';
        var imgLabel = document.createElement('label');
        imgLabel.textContent = 'Control image';
        imgField.appendChild(imgLabel);
        var pickRow = document.createElement('div');
        pickRow.className = 'pick-row';
        var pickBtn = document.createElement('button');
        pickBtn.type = 'button';
        pickBtn.textContent = 'Pick…';
        var pickPath = document.createElement('span');
        pickPath.className = 'cn-image-path muted small';
        pickPath.textContent = cn.image ? baseName(cn.image) : 'none';
        pickPath.title = cn.image || '';
        pickBtn.addEventListener('click', function () {
          if (running) return;
          if (typeof showOpenFileDialog !== 'function') {
            status('file dialog unavailable in this build', 'err');
            return;
          }
          var files = showOpenFileDialog('Control image|png;jpg;jpeg');
          if (!files || !files.length) return;
          cn.image = files[0];
          pickPath.textContent = baseName(cn.image);
          pickPath.title = cn.image;
          persistControlnets();
        });
        pickRow.appendChild(pickBtn);
        pickRow.appendChild(pickPath);
        imgField.appendChild(pickRow);
        row.appendChild(imgField);

        // Scale slider
        var scaleField = document.createElement('div');
        scaleField.className = 'cn-field';
        var scaleLabel = document.createElement('label');
        var scaleVal = document.createElement('span');
        scaleVal.className = 'muted';
        scaleVal.textContent = cn.scale.toFixed(2);
        scaleLabel.textContent = 'Scale ';
        scaleLabel.appendChild(scaleVal);
        var scaleIn = document.createElement('input');
        scaleIn.type = 'range';
        scaleIn.min = '0';
        scaleIn.max = '2';
        scaleIn.step = '0.05';
        scaleIn.value = cn.scale;
        scaleIn.addEventListener('input', function () {
          var v = parseFloat(scaleIn.value);
          cn.scale = isFinite(v) ? v : 1;
          scaleVal.textContent = cn.scale.toFixed(2);
          persistControlnets();
        });
        scaleField.appendChild(scaleLabel);
        scaleField.appendChild(scaleIn);
        row.appendChild(scaleField);

        // Step window
        var winField = document.createElement('div');
        winField.className = 'cn-field cn-window';
        var winLabel = document.createElement('label');
        winLabel.textContent = 'Window';
        var startIn = document.createElement('input');
        startIn.type = 'number';
        startIn.min = '0'; startIn.max = '1'; startIn.step = '0.05';
        startIn.value = cn.startStep;
        var dash = document.createElement('span');
        dash.textContent = '—';
        var endIn = document.createElement('input');
        endIn.type = 'number';
        endIn.min = '0'; endIn.max = '1'; endIn.step = '0.05';
        endIn.value = cn.endStep;
        function commitWindow() {
          var s = parseFloat(startIn.value);
          var e = parseFloat(endIn.value);
          cn.startStep = isFinite(s) ? Math.max(0, Math.min(1, s)) : 0;
          cn.endStep   = isFinite(e) ? Math.max(0, Math.min(1, e)) : 1;
          startIn.value = cn.startStep;
          endIn.value = cn.endStep;
          persistControlnets();
        }
        startIn.addEventListener('change', commitWindow);
        endIn.addEventListener('change', commitWindow);
        winField.appendChild(winLabel);
        winField.appendChild(startIn);
        winField.appendChild(dash);
        winField.appendChild(endIn);
        row.appendChild(winField);

        list.appendChild(row);
      });
    }

    function addControlNet() {
      if (running) return;
      if (typeof showOpenFileDialog !== 'function') {
        status('file dialog unavailable in this build', 'err');
        return;
      }
      var files = showOpenFileDialog('ControlNet weights|safetensors', true);
      if (!files || !files.length) return;
      for (var i = 0; i < files.length; i++) {
        controlnets.push({
          path: files[i], image: '', scale: 1, startStep: 0, endStep: 1,
        });
      }
      renderCnList();
      persistControlnets();
      markCnStale();
      $('cn-section').open = true;
    }

    function pickInitImage() {
      if (running) return;
      if (typeof showOpenFileDialog !== 'function') {
        status('file dialog unavailable in this build', 'err');
        return;
      }
      var files = showOpenFileDialog('Image|png;jpg;jpeg');
      if (!files || !files.length) return;
      initImage = files[0];
      refreshInitSummary();
      persistInitMask();
    }

    function pickMaskImage() {
      if (running) return;
      if (!initImage) {
        status('mask requires an init image — pick one first', 'err');
        return;
      }
      if (typeof showOpenFileDialog !== 'function') {
        status('file dialog unavailable in this build', 'err');
        return;
      }
      var files = showOpenFileDialog('Mask image|png;jpg;jpeg');
      if (!files || !files.length) return;
      maskImage = files[0];
      refreshInitSummary();
      persistInitMask();
    }

    // ── generation ─────────────────────────────────────────────────────
    function readOpts() {
      function num(id, dflt) {
        var v = parseFloat($(id).value);
        return isFinite(v) ? v : dflt;
      }
      function mult8(v) { return Math.max(64, Math.round(v / 8) * 8); }
      var opts = {
        width: mult8(num('width', 512)),
        height: mult8(num('height', 512)),
        steps: Math.max(1, Math.round(num('steps', 6))),
        guidanceScale: num('cfg', 7.5),
        negativePrompt: $('neg').value || '',
        seed: Math.max(0, Math.round(num('seed', 0))),
      };
      if (initImage) {
        opts.initImagePath = initImage;
        opts.strength = initStrength;
        opts.vaeEncodeSample = vaeSample;
        if (maskImage) opts.maskImagePath = maskImage;
      }
      // Only attach controls when the registered count matches the UI list —
      // otherwise the lab is mid-reconfiguration and prime() would throw a
      // count-mismatch from brodiffusion. markCnStale already surfaces this.
      if (controlnets.length && controlnets.length === cnLoadedCount) {
        opts.controls = controlnets.map(function (c) {
          return {
            imagePath: c.image,
            scale: c.scale,
            startStep: c.startStep,
            endStep: c.endStep,
          };
        });
      }
      return opts;
    }

    function generate() {
      if (running || !loaded) return;
      var prompt = $('prompt').value.trim();
      if (!prompt) { status('enter a prompt first', 'err'); return; }

      // Mask without an init image is unsupported by brodiffusion.
      if (maskImage && !initImage) {
        status('mask requires an init image', 'err'); return;
      }
      if (controlnets.length !== cnLoadedCount) {
        status('ControlNet set changed — click Load weights to apply.', 'err');
        return;
      }
      for (var ci = 0; ci < controlnets.length; ci++) {
        if (!controlnets[ci].image) {
          status('ControlNet ' + (ci + 1) + ' has no control image', 'err');
          return;
        }
      }

      var opts = readOpts();
      var token = ++runToken;

      // Snapshot the steering map so mid-run prompt edits can't change it.
      // Steering needs the per-layer trace to apply, so a steered run always
      // captures cross-attention even if the capture box is unchecked.
      // An INT8 model can't trace at all, so both go off there.
      runBias = false;
      runBiasMap = {};
      if (traceCapable) {
        for (var bk in biasMap) {
          if (!biasMap.hasOwnProperty(bk)) continue;
          runBiasMap[bk] = biasMap[bk];
          runBias = true;
        }
      }
      runTrace = traceCapable && ($('trace').checked || runBias);

      // persist inputs
      prefs.prompt = prompt;
      prefs.neg = opts.negativePrompt;
      prefs.steps = opts.steps;
      prefs.cfg = opts.guidanceScale;
      prefs.width = opts.width;
      prefs.height = opts.height;
      prefs.seed = opts.seed;
      prefs.scheduler = $('scheduler').value;
      prefs.int8 = $('int8').checked;
      savePrefs(prefs);

      // reset run state — release the previous run's frame bitmaps eagerly
      // rather than waiting on GC.
      for (var fi = 0; fi < frames.length; fi++) {
        if (frames[fi].bitmap) frames[fi].bitmap.close();
      }
      frames = [];
      aggTrace = null;
      traceSteps = 0;
      traceShapes = null;
      // Token chips stay (they track the prompt, not the run); only the
      // trace-derived overlay controls reset.
      $('block').textContent = '';
      $('block').disabled = true;
      $('overlay-on').disabled = true;
      $('overlay-on').checked = false;
      $('opacity').disabled = true;
      $('scrub').disabled = true;
      $('scrub').max = 0;
      $('scrub').value = 0;
      viewport.setOverlay(null);
      setBusy(true);
      status(runBias ? 'encoding prompt — steering ' +
        Object.keys(runBiasMap).length + ' token(s)…' : 'encoding prompt…', '');

      client.prime(prompt, opts, function (err, info) {
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

      // Choose this step's control object. Step 0 can only trace — the U-Net's
      // per-layer query counts aren't known until a trace comes back; from
      // step 1 on, a steered run sends the attnBias built from those shapes.
      var ctrl, transfer = null;
      if (runBias && traceShapes) {
        var bias = DLab.Attention.buildAttnBias(runBiasMap, traceShapes);
        ctrl = { attnBias: bias };
        transfer = [];
        for (var bi = 0; bi < bias.length; bi++) {
          transfer.push(bias[bi].data.buffer);
        }
      } else if (runTrace) {
        ctrl = { trace: true };
      }

      client.step(ctrl, transfer, function (err, msg) {
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
        if (msg.trace) {
          accumulateTrace(msg.trace);
          if (!traceShapes) {
            traceShapes = msg.trace.map(function (t) {
              return { Lq: t.Lq, Lk: t.Lk };
            });
          }
        }

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

    // Fold one step's cross-attention trace into the running aggregate.
    // brodiffusion traces a single step at a time; the overlay should show
    // where a token shaped the image across the *whole* trajectory. Diffuse,
    // composition-scale concepts (sky, ocean, ambient light) are placed in
    // the first few steps, so a final-step-only trace misses them. Each
    // step's per-layer maps are summed in; completeRun() divides by the step
    // count to recover the mean.
    function accumulateTrace(trace) {
      if (!aggTrace) {
        aggTrace = trace.map(function (t) {
          return { Lq: t.Lq, Lk: t.Lk, data: Float32Array.from(t.data) };
        });
        traceSteps = 1;
        return;
      }
      for (var bi = 0; bi < trace.length && bi < aggTrace.length; bi++) {
        var src = trace[bi].data, dst = aggTrace[bi].data;
        var n = Math.min(src.length, dst.length);
        for (var di = 0; di < n; di++) dst[di] += src[di];
      }
      traceSteps++;
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
      // Recover the per-step mean from the summed trace, so aggTrace holds a
      // genuine averaged attention map rather than a step-count-scaled sum.
      if (aggTrace && traceSteps > 1) {
        for (var bi = 0; bi < aggTrace.length; bi++) {
          var d = aggTrace[bi].data;
          for (var di = 0; di < d.length; di++) d[di] /= traceSteps;
        }
      }
      // build the attention inspector
      buildAttention();
      refreshOverlay();
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
    // After a run: populate the layer dropdown and enable the overlay
    // controls. Token chips already track the prompt (buildTokenChips) and
    // carry their steering badges, so they are left untouched here.
    function buildAttention() {
      var blockSel = $('block');
      blockSel.textContent = '';
      if (!aggTrace) return;
      var opts = DLab.Attention.blockOptions(aggTrace, latentW, latentH);
      for (var i = 0; i < opts.length; i++) {
        var o = document.createElement('option');
        o.value = String(opts[i].value);
        o.textContent = opts[i].label;
        blockSel.appendChild(o);
      }
      blockSel.disabled = false;
      $('overlay-on').disabled = false;
      $('opacity').disabled = false;
    }

    function refreshOverlay() {
      var onLastFrame =
        $('scrub').disabled || +$('scrub').value === frames.length - 1;
      var idx = attention.activeIndex();
      if (!$('overlay-on').checked || !aggTrace || idx < 0 || !onLastFrame) {
        viewport.setOverlay(null);
        return;
      }
      var sel = $('block').value;
      var blockSel = sel === 'avg' ? 'avg' : (parseInt(sel, 10) || 0);
      // Content-token columns drive blockColumn's contrastive baseline — the
      // real prompt words, excluding BOS/EOS/padding. currentEnc tracks the
      // prompt that produced the live trace (a prompt edit clears the trace).
      var contentCols = currentEnc
        ? currentEnc.tokens.map(function (t) { return t.contextIndex; })
        : null;
      var grid = DLab.Attention.computeHeatmap(
        aggTrace, idx, blockSel, latentW, latentH, contentCols);
      viewport.setOverlay(grid, +$('opacity').value / 100);
    }

    // ── busy / control gating ──────────────────────────────────────────
    function setBusy(on) {
      running = on;
      $('btn-generate').disabled = on || !loaded;
      $('btn-cancel').disabled = !on;
      $('btn-open').disabled = on;
      $('btn-load').disabled = on || !detected;
      $('btn-lora-add').disabled = on;
      $('cn-add').disabled = on;
      $('init-pick').disabled = on;
      $('init-clear').disabled = on;
      $('mask-pick').disabled = on;
      $('mask-clear').disabled = on;
      $('strength').disabled = on;
      $('vae-sample').disabled = on;
      $('prompt').disabled = on;
      $('neg').disabled = on;
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
    $('btn-lora-add').addEventListener('click', addLora);

    // ── ControlNet + init/mask wiring ──────────────────────────────────
    $('cn-add').addEventListener('click', addControlNet);
    $('init-pick').addEventListener('click', pickInitImage);
    $('init-clear').addEventListener('click', function () {
      if (running) return;
      initImage = '';
      maskImage = '';        // mask without init is invalid; clear together
      refreshInitSummary();
      persistInitMask();
    });
    $('mask-pick').addEventListener('click', pickMaskImage);
    $('mask-clear').addEventListener('click', function () {
      if (running) return;
      maskImage = '';
      refreshInitSummary();
      persistInitMask();
    });
    $('strength').addEventListener('input', function () {
      initStrength = parseFloat($('strength').value);
      if (!isFinite(initStrength)) initStrength = 0.8;
      $('strength-val').textContent = initStrength.toFixed(2);
      persistInitMask();
    });
    $('vae-sample').addEventListener('change', function () {
      vaeSample = $('vae-sample').checked;
      persistInitMask();
    });

    // Live re-tokenization — debounced so chips track the prompt as you type.
    // A prompt edit invalidates the steering map (token indices shift) and
    // any captured trace (its K columns no longer line up).
    $('prompt').addEventListener('input', function () {
      if (promptTimer) clearTimeout(promptTimer);
      promptTimer = setTimeout(function () {
        promptTimer = 0;
        biasMap = {};
        attention.setActive(-1);
        aggTrace = null;
        traceSteps = 0;
        $('block').textContent = '';
        $('block').disabled = true;
        $('overlay-on').disabled = true;
        $('overlay-on').checked = false;
        $('opacity').disabled = true;
        viewport.setOverlay(null);
        buildTokenChips();
      }, 300);
    });

    $('steer-bias').addEventListener('input', function () {
      var idx = attention.activeIndex();
      if (idx < 0) return;
      var v = parseFloat($('steer-bias').value) || 0;
      if (v) biasMap[idx] = v; else delete biasMap[idx];
      $('steer-val').textContent = fmtBias(v);
      attention.setBias(idx, v);
    });

    $('steer-clear').addEventListener('click', function () {
      for (var k in biasMap) {
        if (biasMap.hasOwnProperty(k)) attention.setBias(+k, 0);
      }
      biasMap = {};
      syncSteerPanel();
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
    renderLoraList();
    renderCnList();
    refreshInitSummary();
    // Auto-expand sections that already have content, so a returning user
    // sees their previous setup at a glance.
    if (initImage || maskImage) $('init-section').open = true;
    if (controlnets.length) $('cn-section').open = true;
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
      // Add a LoRA by path — the dialog-free equivalent of the Add LoRA
      // button, for headless scripting.
      addLoraPath: function (path, scale) {
        loras.push({ path: path, scale: scale == null ? 1 : scale });
        renderLoraList();
        persistLoras();
        markLoraStale();
      },
      // Headless-equivalent of the file-picker wiring — drive the new options
      // by path without a dialog. Returns nothing; readOpts() reflects state.
      setInitImage: function (path) {
        initImage = path || '';
        if (!initImage) maskImage = '';
        refreshInitSummary();
        persistInitMask();
      },
      setMaskImage: function (path) {
        maskImage = path || '';
        refreshInitSummary();
        persistInitMask();
      },
      setStrength: function (v) {
        initStrength = isFinite(v) ? v : 0.8;
        refreshInitSummary();
        persistInitMask();
      },
      setVaeSample: function (on) {
        vaeSample = !!on;
        refreshInitSummary();
        persistInitMask();
      },
      addControlNetPath: function (path, opts) {
        opts = opts || {};
        controlnets.push({
          path: path,
          image: opts.image || '',
          scale: isFinite(opts.scale) ? opts.scale : 1,
          startStep: isFinite(opts.startStep) ? opts.startStep : 0,
          endStep: isFinite(opts.endStep) ? opts.endStep : 1,
        });
        renderCnList();
        persistControlnets();
        markCnStale();
      },
      readOpts: readOpts,
      state: function () {
        return { loaded: loaded, running: running, frames: frames.length,
                 hasTrace: !!aggTrace, loras: loras.length,
                 controlnets: controlnets.length,
                 cnLoaded: cnLoadedCount,
                 initImage: initImage, maskImage: maskImage };
      },
    };
  }

  if (document.readyState === 'complete' ||
      document.readyState === 'interactive') {
    start();
  } else {
    window.addEventListener('load', start);
  }
