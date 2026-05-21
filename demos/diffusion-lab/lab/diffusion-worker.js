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
//   main -> prime  {prompt,opts,trace}-> primed {numSteps, latentW, latentH}
//   main -> step   {}                ->  stepped {stepIndex, done, image, trace?}
//   main -> reset  {}                ->  (drops the active state)
//   errors come back as              ->  error {stage, message}

var pipeline = null;     // native Pipeline handle
var state = null;        // native PipelineState handle (mid-generation)
var traceOn = false;     // capture cross-attention for the active generation

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
    state = null;

    var tensor = (typeof bro !== 'undefined' && bro.tensor) ? bro.tensor : null;
    self.postMessage({
      type: 'loaded',
      config: pipeline.config(),
      numXAttnBlocks: pipeline.numXAttnBlocks(),
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
    traceOn = !!msg.trace;
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
function handleStep() {
  try {
    if (!state) throw new Error('no active generation');
    if (state.done) {
      self.postMessage({ type: 'stepped', done: true, alreadyDone: true,
                         stepIndex: state.stepIndex, numSteps: state.numSteps });
      return;
    }

    var ctrl = traceOn ? { trace: true } : undefined;
    var res = state.stepOnce(ctrl);
    var image = state.decode();

    var out = {
      type: 'stepped',
      stepIndex: state.stepIndex,
      numSteps: state.numSteps,
      done: state.done,
      image: image,
    };
    var transfer = [image.data.buffer];

    if (res && res.trace) {
      out.trace = res.trace;
      for (var i = 0; i < res.trace.length; i++) {
        if (res.trace[i] && res.trace[i].data) {
          transfer.push(res.trace[i].data.buffer);
        }
      }
    }
    self.postMessage(out, transfer);
  } catch (e) {
    fail('step', e);
  }
}

self.onmessage = function (e) {
  var msg = e.data || {};
  switch (msg.type) {
    case 'load':  handleLoad(msg.spec); break;
    case 'prime': handlePrime(msg); break;
    case 'step':  handleStep(); break;
    case 'reset': state = null; break;
    default: fail('dispatch', new Error('unknown message: ' + msg.type));
  }
};

self.postMessage({ type: 'ready' });
