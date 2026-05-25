// Diffusion Lab worker — owns the native Pipeline and a step-wise
// PipelineState for one generation at a time.
//
// It is a long-lived inference server: load multi-GB weights once, then run
// many generations. The protocol is pure request/response — the main thread
// drives one denoising step per 'step' message, so it controls pacing and
// cancellation just stops asking. The worker never loops or blocks between
// requests.
//
//   main -> load   {spec}            ->  loaded {config, numXAttnBlocks}
//   main -> prime  {prompt,opts}     ->  primed {numSteps, latentW, latentH}
//   main -> step   {ctrl}            ->  stepped {stepIndex, done, bitmap, trace?}
//   main -> reset  {}                ->  (drops the active state)
//   errors come back as              ->  error {stage, message}
//
// `ctrl` is whatever the main thread wants passed to PipelineState.stepOnce()
// — { trace:true } to capture cross-attention, or { attnBias:[...] } to steer
// it. The worker stays policy-free: the main thread owns trace/steer decisions.

var pipeline = null;     // native Pipeline handle
var state = null;        // native PipelineState handle (mid-generation)

function fail(stage, err) {
  self.postMessage({
    type: 'error',
    stage: stage,
    message: (err && err.message) ? err.message : String(err),
  });
}

// ── load: build the pipeline and read its weights ──────────────────────
function handleLoad(spec) {
  try {
    if (typeof bro === 'undefined' || !bro.diffusion) {
      throw new Error('bro.diffusion is not available in this build');
    }
    bro.diffusion.init();

    if (spec.kind !== 'createPipeline') {
      throw new Error('unknown pipeline spec: ' + spec.kind);
    }
    pipeline = bro.diffusion.createPipeline(spec.pipeline);
    var w = spec.weights;
    pipeline.loadWeights(w.text, w.unet, w.vae);

    // Merge any LoRA adapters into the freshly loaded weights. applyLora is
    // stackable and one-way — there is no un-apply — so changing the adapter
    // set always means a full reload from the base weights.
    var loras = spec.loras || [];
    for (var i = 0; i < loras.length; i++) {
      pipeline.applyLora(loras[i].path, loras[i].scale);
    }

    // Register ControlNets in declared order — index matches the position the
    // main thread will use in GenerateOptions.controls at prime time.
    var cns = spec.controlnets || [];
    for (var ci = 0; ci < cns.length; ci++) {
      pipeline.addControlNet(cns[ci].path);
    }
    state = null;

    var tensor = (typeof bro !== 'undefined' && bro.tensor) ? bro.tensor : null;
    self.postMessage({
      type: 'loaded',
      config: pipeline.config(),
      numXAttnBlocks: pipeline.numXAttnBlocks(),
      lorasApplied: loras.length,
      backend: tensor && tensor.available ? (tensor.backend || 'gpu') : 'cpu',
    });
  } catch (e) {
    pipeline = null;
    fail('load', e);
  }
}

// ── prime: encode the prompt, allocate the initial latent ──────────────
function handlePrime(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    state = pipeline.prime(msg.prompt, msg.opts || {});
    self.postMessage({
      type: 'primed',
      numSteps: state.numSteps,
      latentWidth: state.latentWidth,
      latentHeight: state.latentHeight,
    });
  } catch (e) {
    state = null;
    fail('prime', e);
  }
}

// ── step: advance one denoising step, decode a preview ─────────────────
function handleStep(msg) {
  try {
    if (!state) throw new Error('no active generation');
    if (state.done) {
      self.postMessage({ type: 'stepped', done: true, alreadyDone: true,
                         stepIndex: state.stepIndex, numSteps: state.numSteps });
      return;
    }

    var res = state.stepOnce(msg.ctrl);
    var image = state.decode();
    var stepIndex = state.stepIndex;
    var numSteps = state.numSteps;
    var done = state.done;

    // Hand the decoded frame to the engine as an ImageBitmap and transfer it
    // zero-copy. createImageBitmap is async per the web standard; the RGBA→
    // bitmap work is synchronous, so it resolves on the next microtask.
    createImageBitmap(image).then(function (bitmap) {
      var out = {
        type: 'stepped',
        stepIndex: stepIndex,
        numSteps: numSteps,
        done: done,
        bitmap: bitmap,
      };
      var transfer = [bitmap];

      if (res && res.trace) {
        out.trace = res.trace;
        for (var i = 0; i < res.trace.length; i++) {
          if (res.trace[i] && res.trace[i].data) {
            transfer.push(res.trace[i].data.buffer);
          }
        }
      }
      self.postMessage(out, transfer);
    }).catch(function (e) {
      fail('step', e);
    });
  } catch (e) {
    fail('step', e);
  }
}

self.onmessage = function (e) {
  var msg = e.data || {};
  switch (msg.type) {
    case 'load':  handleLoad(msg.spec); break;
    case 'prime': handlePrime(msg); break;
    case 'step':  handleStep(msg); break;
    case 'reset': state = null; break;
    default: fail('dispatch', new Error('unknown message: ' + msg.type));
  }
};

self.postMessage({ type: 'ready' });
