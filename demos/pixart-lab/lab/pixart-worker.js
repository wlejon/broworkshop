// PixArt Lab worker — owns the native PixArt-Sigma pipeline and serves one
// generation at a time.
//
// PixArt-Sigma is a ~0.6B DiT (AdaLN-single) with a T5-XXL text frontend and the
// SDXL KL-VAE. brodiffusion auto-detects the family from the diffusers model dir,
// so the whole model rides the model-agnostic Pipeline surface — no PixArt-
// specific JS binding. The worker is a thin long-lived inference server: load the
// multi-GB weights once, then generate many times.
//
//   main -> load     {modelDir}        ->  loaded {config, backend}
//   main -> generate {prompt, opts}    ->  done {bitmap, width, height, ms}
//   errors come back as                ->  error {stage, message}
//
// Unlike sana-lab there is no conditioning-control axis seam here: brodiffusion
// wires CondControl into the Sana and SD1.5 prime paths only, not PixArt's T5
// branch (see brodiffusion src/pipeline.cpp prime()). This lab is a clean
// text-to-image bench for the PixArt path.

var pipeline = null;     // native Pipeline handle

function fail(stage, err) {
  self.postMessage({
    type: 'error',
    stage: stage,
    message: (err && err.message) ? err.message : String(err),
  });
}

// ── load: build the pipeline from a diffusers model dir ────────────────────
function handleLoad(msg) {
  try {
    if (typeof bro === 'undefined' || !bro.diffusion) {
      throw new Error('bro.diffusion is not available in this build');
    }

    pipeline = bro.diffusion.loadModel(msg.modelDir);
    var cfg = pipeline.config();
    if (cfg.modelClass !== 'PixArt') {
      throw new Error('expected a PixArt model, got ' + cfg.modelClass +
                      ' — point at a PixArt-Sigma diffusers directory');
    }

    var tensor = (typeof bro !== 'undefined' && bro.tensor) ? bro.tensor : null;
    self.postMessage({
      type: 'loaded',
      config: cfg,
      backend: tensor && tensor.available ? (tensor.backend || 'gpu') : 'cpu',
    });
  } catch (e) {
    pipeline = null;
    fail('load', e);
  }
}

// ── generate: run one-shot txt2img, return a bitmap ────────────────────────
function handleGenerate(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');

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
