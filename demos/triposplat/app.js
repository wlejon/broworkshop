// TripoSplat Lab — single image → 3D Gaussian Splat, reconstructed on-device.
//
// The whole pipeline (DINOv3 + Flux.2 VAE encoders → flow-matching DiT → octree
// Gaussian decoder, with optional BiRefNet background removal) runs through
// bro.triposplat inside a Worker, so the UI stays live while it computes. This
// file is the conductor: pick an image, set parameters, ask the worker to
// reconstruct, hand the returned cloud to the viewport, and offer a .ply export.
//
// Weights live in the sibling repos' download dirs (scripts/download-triposplat.sh
// in brodiffusion + brovisionml). Edit WEIGHTS if yours are elsewhere.
(function () {
  'use strict';

  var WEIGHTS = {
    dinov3:   'D:/projects/brovisionml/weights/triposplat/clip_vision/dino_v3_vit_h.safetensors',
    vae:      'D:/projects/brodiffusion/weights/triposplat/vae/flux2-vae.safetensors',
    flow:     'D:/projects/brodiffusion/weights/triposplat/diffusion_models/triposplat_fp16.safetensors',
    decoder:  'D:/projects/brodiffusion/weights/triposplat/vae/triposplat_vae_decoder_fp16.safetensors',
    birefnet: 'D:/projects/brovisionml/weights/triposplat/background_removal/birefnet.safetensors',
  };

  var SAMPLES = [
    { name: 'Portrait',  url: 'samples/portrait.png' },
    { name: 'Robot arm', url: 'samples/robot-arm.png' },
  ];

  var $ = function (id) { return document.getElementById(id); };

  // The app's absolute dir — `new Image().src` resolves against a process-global
  // base, so anchor relative sample paths to the real app dir for a reliable
  // decode in both windowed and headless runs.
  var APP_BASE = '';
  try { APP_BASE = require('fs').realpathSync('.'); } catch (e) { APP_BASE = ''; }
  function appPath(p) {
    if (!p) return p;
    if (/^[a-zA-Z]:[\\/]/.test(p) || p.charAt(0) === '/' || p.charAt(0) === '\\') return p;
    return APP_BASE ? APP_BASE + '/' + p : p;
  }
  function fileExists(p) {
    try { return require('fs').existsSync(appPath(p)); } catch (e) { return true; }
  }

  // Decode an image file to ImageData { data, width, height }. Synchronous —
  // the engine decodes Image.src inline and the canvas readback is immediate.
  function fileToImageData(path) {
    var img = new Image();
    img.src = appPath(path);
    var w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error('could not decode image: ' + path);
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.getContext('2d').getImageData(0, 0, w, h);
  }

  function baseName(p) {
    var parts = String(p).split(/[\\/]/);
    return parts[parts.length - 1] || p;
  }

  // ── persisted UI state ─────────────────────────────────────────────────
  var STORE_KEY = 'triposplat-lab.v1';
  function loadPrefs() {
    try { return JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function savePrefs(p) {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (e) { /* non-fatal */ }
  }

  function start() {
    if (!$('view')) { requestAnimationFrame(start); return; }
    init();
  }

  function init() {
    var prefs = loadPrefs();
    var viewport = TSLab.Viewport.create($('view'));
    var client = TSLab.Client.create();

    var loaded = false;        // weights resident in the worker
    var running = false;
    var hasBgModel = false;    // pipeline carries a BiRefNet matte model
    var current = null;        // { data, width, height, label } source image
    var timerRAF = 0, t0 = 0;

    function status(msg, kind) {
      var el = $('status-text');
      el.textContent = msg;
      el.className = kind || '';
    }

    // ── backend badge ──────────────────────────────────────────────────
    var gpu = !!(window.bro && bro.gpu && bro.gpu.available);
    var badge = $('device');
    badge.textContent = gpu ? (bro.gpu.backend ? bro.gpu.backend.toUpperCase() : 'GPU') : 'CPU';
    badge.classList.add(gpu ? 'ok' : 'bad');

    // ── prefill controls from prefs ─────────────────────────────────────
    if (prefs.steps) $('steps').value = prefs.steps;
    if (prefs.cfg)   $('cfg').value = prefs.cfg;
    if (prefs.ng)    $('ng').value = prefs.ng;
    if (prefs.seed != null) $('seed').value = prefs.seed;
    if (prefs.shift) $('shift').value = prefs.shift;
    if (prefs.autorotate === false) $('autorotate').checked = false;
    if (prefs.light) { $('vlight').checked = true; $('stage').classList.add('light'); }
    if (prefs.scale) $('vscale').value = prefs.scale;
    syncLabels();
    viewport.setAutoRotate($('autorotate').checked);
    viewport.setScale(parseInt($('vscale').value, 10) / 100);

    function syncLabels() {
      $('vSteps').textContent = $('steps').value;
      $('vCfg').textContent = (parseInt($('cfg').value, 10) / 10).toFixed(1);
      $('vNg').textContent = parseInt($('ng').value, 10).toLocaleString();
      $('vShift').textContent = (parseInt($('shift').value, 10) / 10).toFixed(1);
    }

    // ── samples gallery ─────────────────────────────────────────────────
    var sampleEls = {};
    function buildSamples() {
      var box = $('samples');
      box.textContent = '';
      sampleEls = {};
      SAMPLES.forEach(function (s) {
        if (!fileExists(s.url)) return;
        var el = document.createElement('div');
        el.className = 's';
        el.title = s.name;
        el.style.backgroundImage = 'url(' + s.url + ')';
        el.addEventListener('click', function () { selectImage(s.url, s.name); });
        box.appendChild(el);
        sampleEls[s.url] = el;
      });
    }

    function markSelected(key) {
      for (var k in sampleEls) {
        if (sampleEls.hasOwnProperty(k)) sampleEls[k].classList.toggle('sel', k === key);
      }
    }

    // ── image selection ─────────────────────────────────────────────────
    function selectImage(path, label) {
      var img;
      try { img = fileToImageData(path); }
      catch (e) { status('image load failed: ' + e.message, 'err'); return; }
      current = { data: img.data, width: img.width, height: img.height,
                  label: label || baseName(path) };
      $('thumb').style.backgroundImage = 'url(' + appPath(path).replace(/\\/g, '/') + ')';
      markSelected(path);
      prefs.image = path; savePrefs(prefs);
      $('stat-info').textContent = current.label + ' · ' + img.width + '×' + img.height;
      refreshActions();
    }

    // ── load weights into the worker ────────────────────────────────────
    function boot() {
      buildSamples();

      // Restore the last image, else the first available sample.
      var want = prefs.image && fileExists(prefs.image) ? prefs.image : null;
      if (!want) { for (var i = 0; i < SAMPLES.length; i++) { if (fileExists(SAMPLES[i].url)) { want = SAMPLES[i].url; break; } } }
      if (want) selectImage(want, baseName(want));

      // Drop birefnet from the request if its file is absent — the pipeline
      // still loads, background removal just won't be offered.
      var weights = {};
      for (var k in WEIGHTS) { if (WEIGHTS.hasOwnProperty(k)) weights[k] = WEIGHTS[k]; }
      if (weights.birefnet && !fileExists(weights.birefnet)) delete weights.birefnet;

      status('Loading models (DINOv3 + VAE + flow + decoder' +
        (weights.birefnet ? ' + BiRefNet' : '') + ')…');
      client.onReady(function () {
        client.load(weights, function (err, info) {
          if (err) {
            status('Load failed: ' + err.message, 'err');
            $('view-hint').textContent = 'Model load failed — see status bar.';
            return;
          }
          loaded = true;
          hasBgModel = !!info.backgroundRemoval;
          badge.textContent = info.device || badge.textContent;
          // BiRefNet on by default when available (best for casual photos).
          $('bg-remove').disabled = !hasBgModel;
          $('bg-remove').checked = hasBgModel &&
            (prefs.bgRemove == null ? true : !!prefs.bgRemove);
          $('bg-row').title = hasBgModel
            ? 'Isolate the subject with BiRefNet before reconstruction'
            : 'BiRefNet weights not found — background removal unavailable';
          $('view-hint').textContent = 'Click Generate to reconstruct.';
          status('Models ready on ' + info.device + '. Pick an image and Generate.', 'ok');
          refreshActions();
        });
      });
    }

    // ── generation ──────────────────────────────────────────────────────
    function readOpts() {
      return {
        seed: Math.max(0, parseInt($('seed').value, 10) || 0),
        steps: parseInt($('steps').value, 10),
        guidanceScale: parseInt($('cfg').value, 10) / 10,
        numGaussians: parseInt($('ng').value, 10),
        shift: parseInt($('shift').value, 10) / 10,
        removeBackground: hasBgModel && $('bg-remove').checked,
      };
    }

    function startTimer() {
      t0 = performance.now();
      function frame() {
        $('elapsed').textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's';
        timerRAF = requestAnimationFrame(frame);
      }
      frame();
    }
    function stopTimer() { if (timerRAF) cancelAnimationFrame(timerRAF); timerRAF = 0; }

    function generate() {
      if (running || !loaded || !current) return;
      var opts = readOpts();

      // persist inputs
      prefs.steps = +$('steps').value; prefs.cfg = +$('cfg').value;
      prefs.ng = +$('ng').value; prefs.seed = opts.seed; prefs.shift = +$('shift').value;
      prefs.bgRemove = $('bg-remove').checked;
      savePrefs(prefs);

      setBusy(true);
      $('view-hint').textContent = '';
      $('spinner').classList.remove('hidden');
      startTimer();
      status('Reconstructing ' + opts.numGaussians.toLocaleString() +
        ' Gaussians (' + opts.steps + ' steps' +
        (opts.removeBackground ? ', BiRefNet' : '') + ')…');

      // Transfer a throwaway copy so `current` stays intact for re-runs.
      var copy = {
        data: new Uint8ClampedArray(current.data),
        width: current.width, height: current.height,
      };
      client.generate(copy, opts, function (err, msg) {
        stopTimer();
        $('spinner').classList.add('hidden');
        setBusy(false);
        if (err) { status('Generate failed: ' + err.message, 'err'); return; }
        var cloud = msg.cloud;
        viewport.setCloud(cloud);
        var dt = ((performance.now() - t0) / 1000).toFixed(1);
        $('btn-save').disabled = false;
        status(cloud.count.toLocaleString() + ' Gaussians · ' + dt + 's · seed ' + opts.seed, 'ok');
        $('stat-info').textContent = (current.label || 'image') + ' → ' +
          cloud.count.toLocaleString() + ' splats';
      });
    }

    // ── export ──────────────────────────────────────────────────────────
    function savePly() {
      if (!viewport.hasCloud()) return;
      if (typeof showSaveFileDialog !== 'function') {
        status('save dialog unavailable in this build', 'err'); return;
      }
      var def = (current && current.label ? current.label.replace(/\.[^.]+$/, '') : 'splat') + '.ply';
      var path = showSaveFileDialog('Gaussian Splat|ply', def);
      if (!path) return;
      try {
        viewport.savePly(path);
        status('Saved ' + viewport.splatCount().toLocaleString() + ' splats → ' + baseName(path), 'ok');
      } catch (e) {
        status('Save failed: ' + e.message, 'err');
      }
    }

    // ── busy gating ─────────────────────────────────────────────────────
    function setBusy(on) {
      running = on;
      refreshActions();
      $('btn-open').disabled = on;
      $('steps').disabled = $('cfg').disabled = $('ng').disabled = on;
      $('seed').disabled = $('btn-rand').disabled = $('shift').disabled = on;
      $('bg-remove').disabled = on || !hasBgModel;
      var box = $('samples');
      box.style.pointerEvents = on ? 'none' : 'auto';
      box.style.opacity = on ? '.5' : '1';
    }
    function refreshActions() {
      $('btn-go').disabled = running || !loaded || !current;
      $('btn-save').disabled = running || !viewport.hasCloud();
    }

    // ── open + drag/drop ────────────────────────────────────────────────
    function openImage() {
      if (running) return;
      if (typeof showOpenFileDialog !== 'function') {
        status('file dialog unavailable in this build', 'err'); return;
      }
      var files = showOpenFileDialog('Images|png;jpg;jpeg;webp');
      if (files && files.length) selectImage(files[0], baseName(files[0]));
    }

    var stage = $('stage');
    stage.addEventListener('dragover', function (e) { e.preventDefault(); });
    stage.addEventListener('drop', function (e) {
      e.preventDefault();
      if (running) return;
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      var f = files[0];
      var p = (f.path || f.name || '').replace(/\\/g, '/');
      if (p) selectImage(p, baseName(p));
    });

    // ── wiring ──────────────────────────────────────────────────────────
    $('steps').oninput = $('cfg').oninput = $('ng').oninput = $('shift').oninput = syncLabels;
    $('btn-open').addEventListener('click', openImage);
    $('btn-go').addEventListener('click', generate);
    $('btn-save').addEventListener('click', savePly);
    $('btn-rand').addEventListener('click', function () {
      $('seed').value = Math.floor(Math.random() * 1e9);
    });
    $('autorotate').addEventListener('change', function () {
      viewport.setAutoRotate($('autorotate').checked);
      prefs.autorotate = $('autorotate').checked; savePrefs(prefs);
    });
    $('btn-reset').addEventListener('click', function () { viewport.reset(); });
    $('vscale').addEventListener('input', function () {
      viewport.setScale(parseInt($('vscale').value, 10) / 100);
      prefs.scale = +$('vscale').value; savePrefs(prefs);
    });
    $('vlight').addEventListener('change', function () {
      stage.classList.toggle('light', $('vlight').checked);
      prefs.light = $('vlight').checked; savePrefs(prefs);
    });

    refreshActions();
    boot();

    // Headless test handle — drive the lab without dialogs/worker timing races.
    window.TSLabApp = {
      selectImage: selectImage,
      generate: generate,
      readOpts: readOpts,
      viewport: viewport,
      state: function () {
        return { loaded: loaded, running: running, hasBgModel: hasBgModel,
                 hasCloud: viewport.hasCloud(), splatCount: viewport.splatCount(),
                 image: current ? current.label : null };
      },
    };
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') start();
  else window.addEventListener('load', start);
})();
