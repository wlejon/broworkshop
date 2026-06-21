// Diffusion Lab worker — owns the native Pipeline and a step-wise
// PipelineState for one generation at a time.
//
// It is a long-lived inference server: load multi-GB weights once, then run
// many generations. The protocol is pure request/response — the main thread
// drives one denoising step per 'step' message, so it controls pacing and
// cancellation just stops asking. The worker never loops or blocks between
// requests.
//
//   main -> load   {spec}                 ->  loaded {config, numXAttnBlocks}
//   main -> prime  {prompt,opts,controls} ->  primed {numSteps, latentW, latentH}
//   main -> step   {ctrl}                 ->  stepped {stepIndex, done, bitmap, trace?}
//   main -> search {neg[],pos[],name}     ->  axisBuilt {name, negN, posN, sep}
//   main -> remove {name}                 ->  removed {name}
//   main -> reset  {}                      ->  (drops the active state)
//   errors come back as                   ->  error {stage, message}
//
// `ctrl` is whatever the main thread wants passed to PipelineState.stepOnce()
// — { trace:true } to capture cross-attention, or { attnBias:[...] } to steer
// it. The worker stays policy-free: the main thread owns trace/steer decisions.
//
// `controls` is a plain { axisName: alpha } map applied to the CONDITIONING just
// before priming (a separate, coarser steering surface than per-token attnBias):
// the worker clears the control state and re-applies the map every prime, so an
// axis at 0 (or absent) is a true no-op. Axes are built live from two word sets
// via 'search' (diff-of-means in CLIP space) — the runtime form of the
// brodiffusion CondControl seam, wired into the SD1.5 prime path.

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

// Apply the conditioning-control map from scratch: clear, then set only the
// nonzero axes. Keeps each generation self-describing — what you see is exactly
// the map sent, nothing sticky from a prior run. No-op on builds without the
// control API.
function applyControls(controls) {
  if (!pipeline || !pipeline.clearControl) return 0;
  pipeline.clearControl();
  var active = {}, n = 0;
  for (var name in (controls || {})) {
    if (!controls.hasOwnProperty(name)) continue;
    var a = +controls[name];
    if (a) { active[name] = a; n++; }
  }
  if (n) pipeline.setControl(active);
  return n;
}

// ── prime: encode the prompt, allocate the initial latent ──────────────
function handlePrime(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    applyControls(msg.controls);
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

// ── search: build a control axis from two word sets (diff-of-means) ─────
// Encode each phrase, mean its content-token rows (skip BOS), average per set,
// difference the set means, unit-normalize, and register as a runtime control
// axis (`name`, weight 0). Alpha (the strength slider) is then the injection
// norm. CLIP-specific recipe (clip-research): NO massive-activation zeroing —
// CLIP has no Gemma-style outlier sink channels — and the brodiffusion SD1.5
// seam steers content rows [1, eos) only.
function meanContent(prompt) {
  var enc = pipeline.encodeConditioning(prompt);   // { rows, cols, data }
  var rows = enc.rows, cols = enc.cols, d = enc.data;
  var out = new Float64Array(cols);
  var n = rows - 1;                                 // rows 1.. are content
  for (var r = 1; r < rows; r++) {
    var off = r * cols;
    for (var c = 0; c < cols; c++) out[c] += d[off + c];
  }
  if (n > 0) for (var k = 0; k < cols; k++) out[k] /= n;
  return out;
}
function setMean(phrases) {
  var sum = null, cols = 0;
  for (var i = 0; i < phrases.length; i++) {
    var m = meanContent(phrases[i]);
    if (!sum) { sum = new Float64Array(m.length); cols = m.length; }
    for (var c = 0; c < cols; c++) sum[c] += m[c];
  }
  for (var k = 0; k < cols; k++) sum[k] /= phrases.length;
  return sum;
}
function handleSearch(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    if (!pipeline.encodeConditioning || !pipeline.setControlVector) {
      throw new Error('this build lacks the conditioning-control API');
    }
    var neg = (msg.neg || []).filter(function (s) { return s && s.trim(); });
    var pos = (msg.pos || []).filter(function (s) { return s && s.trim(); });
    if (!neg.length || !pos.length)
      throw new Error('need at least one phrase in each set');

    var mneg = setMean(neg), mpos = setMean(pos);
    var cols = mpos.length;
    var v = new Float64Array(cols);
    for (var c = 0; c < cols; c++) v[c] = mpos[c] - mneg[c];

    var norm = 0;
    for (var k = 0; k < cols; k++) norm += v[k] * v[k];
    norm = Math.sqrt(norm);
    var unit = new Float32Array(cols);
    if (norm > 0) for (var j = 0; j < cols; j++) unit[j] = v[j] / norm;

    // scale 1, weight 0: the strength slider's alpha is the literal injection
    // norm, set later via the control map.
    var name = msg.name || 'search';
    pipeline.setControlVector(name, unit, 0.0, 1.0);
    self.postMessage({ type: 'axisBuilt', name: name,
                       negN: neg.length, posN: pos.length, sep: norm });
  } catch (e) {
    fail('search', e);
  }
}

function handleRemove(msg) {
  try {
    if (pipeline && pipeline.removeControl && msg.name) {
      pipeline.removeControl(msg.name);
    }
    self.postMessage({ type: 'removed', name: msg.name });
  } catch (e) {
    fail('remove', e);
  }
}

self.onmessage = function (e) {
  var msg = e.data || {};
  switch (msg.type) {
    case 'load':   handleLoad(msg.spec); break;
    case 'prime':  handlePrime(msg); break;
    case 'step':   handleStep(msg); break;
    case 'search': handleSearch(msg); break;
    case 'remove': handleRemove(msg); break;
    case 'reset':  state = null; break;
    default: fail('dispatch', new Error('unknown message: ' + msg.type));
  }
};

self.postMessage({ type: 'ready' });
