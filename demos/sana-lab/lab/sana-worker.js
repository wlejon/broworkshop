// Sana Lab worker — owns the native Sana pipeline and its conditioning-control
// dictionary, and serves one generation at a time.
//
// This is the runtime side of the Sana research lab: the control seam lives in
// brodiffusion (CondControl), wired into the Sana prime path, and surfaced on
// the pipeline as loadControlDictionary / setControl / clearControl /
// controlAxes. The worker is a thin long-lived inference server — load the
// multi-GB weights + the (tiny) BCD1 dictionary once, then generate many times.
//
//   main -> load     {modelDir, dictPath}     ->  loaded {config, axes, backend}
//   main -> generate {prompt, opts, controls} ->  done {bitmap, width, height, ms}
//   errors come back as                       ->  error {stage, message}
//
// `controls` is a plain { axisName: alpha } map. The worker clears the control
// state and re-applies the map before every generation, so a slider at 0 (or
// absent) is a true no-op — the seam adds nothing to the conditioning.

var pipeline = null;     // native Pipeline handle
var axes = [];           // control axis names from the loaded dictionary

function fail(stage, err) {
  self.postMessage({
    type: 'error',
    stage: stage,
    message: (err && err.message) ? err.message : String(err),
  });
}

// ── load: build the pipeline, read weights, attach the control dictionary ──
function handleLoad(msg) {
  try {
    if (typeof bro === 'undefined' || !bro.diffusion) {
      throw new Error('bro.diffusion is not available in this build');
    }

    pipeline = bro.diffusion.loadModel(msg.modelDir);
    var cfg = pipeline.config();
    if (cfg.modelClass !== 'Sana') {
      throw new Error('expected a Sana model, got ' + cfg.modelClass +
                      ' — the control dictionary is Gemma-conditioned (Sana only)');
    }

    axes = [];
    if (msg.dictPath) {
      pipeline.loadControlDictionary(msg.dictPath);
      axes = pipeline.controlAxes();
    }

    var tensor = (typeof bro !== 'undefined' && bro.tensor) ? bro.tensor : null;
    self.postMessage({
      type: 'loaded',
      config: cfg,
      axes: axes,
      backend: tensor && tensor.available ? (tensor.backend || 'gpu') : 'cpu',
    });
  } catch (e) {
    pipeline = null;
    fail('load', e);
  }
}

// ── generate: apply the control map, run one-shot txt2img, return a bitmap ──
function handleGenerate(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');

    // Re-apply the control surface from scratch every run: clear, then set only
    // the nonzero axes. This keeps each generation self-describing — what you
    // see is exactly the map you sent, nothing sticky from a prior run.
    pipeline.clearControl();
    var controls = msg.controls || {};
    var active = {};
    var any = false;
    for (var name in controls) {
      if (!controls.hasOwnProperty(name)) continue;
      var a = +controls[name];
      if (a) { active[name] = a; any = true; }
    }
    if (any) pipeline.setControl(active);

    var t0 = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : 0;
    var img = pipeline.generate(msg.prompt, msg.opts || {});
    var ms = t0 ? Math.round((typeof performance !== 'undefined'
      ? performance.now() : 0) - t0) : 0;

    // Hand the decoded RGBA frame back as a zero-copy ImageBitmap.
    var data = new ImageData(img.data, img.width, img.height);
    createImageBitmap(data).then(function (bitmap) {
      self.postMessage({
        type: 'done',
        bitmap: bitmap,
        width: img.width,
        height: img.height,
        ms: ms,
      }, [bitmap]);
    }).catch(function (e) { fail('generate', e); });
  } catch (e) {
    fail('generate', e);
  }
}

self.onmessage = function (e) {
  var msg = e.data || {};
  switch (msg.type) {
    case 'load':     handleLoad(msg); break;
    case 'generate': handleGenerate(msg); break;
    default: fail('dispatch', new Error('unknown message: ' + msg.type));
  }
};

self.postMessage({ type: 'ready' });
