// Sana Lab worker — owns the native Sana pipeline and its conditioning-control
// dictionary, and serves one generation at a time.
//
// This is the runtime side of the Sana research lab: the control seam lives in
// brodiffusion (CondControl), wired into the Sana prime path, and surfaced on
// the pipeline as loadControlDictionary / setControl / clearControl /
// controlAxes. The worker is a thin long-lived inference server — load the
// multi-GB weights + the (tiny) BCD1 dictionary once, then generate many times.
//
//   main -> load     {modelDir}              ->  loaded {config, axes, backend}
//   main -> generate {prompt, opts, controls, identityWeight} -> done {bitmap, ...}
//   main -> anchor   {prompt, opts}           ->  anchorSet {bitmap, width, height, ms}
//   main -> clearAnchor {}                    ->  anchorCleared {}
//   main -> search   {neg[], pos[], name}     ->  axisBuilt {name, negN, posN, sep}
//   main -> remove   {name}                   ->  removed {name}
//   errors come back as                       ->  error {stage, message}
//
// The identity anchor is Sana's training-free reference-attention seam: capture
// a neutral portrait's per-step linear-attention summaries once, then every
// generate() adds them back (scaled by identityWeight) so the face stays the
// same person while the prompt + control axes drive expression. Sana only.
//
// `controls` is a plain { axisName: alpha } map. The worker clears the control
// state and re-applies the map before every generation, so a slider at 0 (or
// absent) is a true no-op — the seam adds nothing to the conditioning.

var pipeline = null;     // native Pipeline handle
var axes = [];           // control axis names from the loaded dictionary

// Gemma "massive activation" dims — a handful of huge-norm channels that act as
// an attention sink. The offline axes are built with these zeroed; a live axis
// must zero them too or the injection destabilizes. (sana-research fit_axis.py)
var MASSIVE = [334, 976, 1173, 593, 1304, 1535, 833, 1142, 184];

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

// Hand a decoded RGBA frame back to the main thread as a zero-copy ImageBitmap
// under the given message type (so generate / anchor share one return path).
function respondImage(type, img, ms, stage) {
  var data = new ImageData(img.data, img.width, img.height);
  createImageBitmap(data).then(function (bitmap) {
    self.postMessage({ type: type, bitmap: bitmap, width: img.width,
                       height: img.height, ms: ms }, [bitmap]);
  }).catch(function (e) { fail(stage, e); });
}

function now() {
  return (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : 0;
}

// Apply the {axisName: alpha} control map from scratch: clear, then set the
// nonzero axes, so each run is self-describing (nothing sticky from a prior one).
function applyControls(controls) {
  pipeline.clearControl();
  var active = {}, any = false;
  for (var name in controls) {
    if (!controls.hasOwnProperty(name)) continue;
    var a = +controls[name];
    if (a) { active[name] = a; any = true; }
  }
  if (any) pipeline.setControl(active);
}

// ── generate: apply controls + identity weight, run txt2img, return a bitmap ──
function handleGenerate(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    applyControls(msg.controls || {});
    // Identity injection strength for the armed anchor (0 when none / off). A
    // true no-op at 0, so live sliders that pass 0 cost nothing extra.
    pipeline.setIdentityWeight(+msg.identityWeight || 0);

    var t0 = now();
    var img = pipeline.generate(msg.prompt, msg.opts || {});
    respondImage('done', img, Math.round(now() - t0), 'generate');
  } catch (e) {
    fail('generate', e);
  }
}

// ── anchor: capture a reference identity from one full generation ───────────
// Renders `prompt` with the denoiser recording its per-step attention summaries,
// arms the seam, and hands back the anchor image (e.g. the neutral portrait).
function handleAnchor(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    applyControls({});                 // capture the clean identity, unsteered
    pipeline.setIdentityWeight(0);     // the anchor renders itself, no injection
    var t0 = now();
    var img = pipeline.setIdentityAnchor(msg.prompt, msg.opts || {});
    respondImage('anchorSet', img, Math.round(now() - t0), 'anchor');
  } catch (e) {
    fail('anchor', e);
  }
}

function handleClearAnchor() {
  try {
    if (pipeline) pipeline.clearIdentityAnchor();
    self.postMessage({ type: 'anchorCleared' });
  } catch (e) {
    fail('clearAnchor', e);
  }
}

// ── search: build a control axis from two phrase sets (diff-of-means) ──────
// Encode each phrase, mean its content-token rows (skip BOS), average per set,
// difference the set means, zero the MASSIVE dims, unit-normalize. The result is
// registered as a runtime control axis (`name`, weight 0) the app then drives
// like any other — alpha is the injection norm. This is the Tier-2 recipe the
// offline detail axes use, run live on the user's words.
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
    var neg = (msg.neg || []).filter(function (s) { return s && s.trim(); });
    var pos = (msg.pos || []).filter(function (s) { return s && s.trim(); });
    if (!neg.length || !pos.length)
      throw new Error('need at least one phrase in each set');

    var mneg = setMean(neg), mpos = setMean(pos);
    var cols = mpos.length;
    var v = new Float64Array(cols);
    for (var c = 0; c < cols; c++) v[c] = mpos[c] - mneg[c];
    for (var i = 0; i < MASSIVE.length; i++) if (MASSIVE[i] < cols) v[MASSIVE[i]] = 0;

    var norm = 0;
    for (var k = 0; k < cols; k++) norm += v[k] * v[k];
    norm = Math.sqrt(norm);
    var unit = new Float32Array(cols);
    if (norm > 0) for (var j = 0; j < cols; j++) unit[j] = v[j] / norm;

    // scale 1, weight 0: alpha (set later by the strength slider) is the literal
    // injection norm, so the app's slider matches the offline vet's norm sweep.
    var name = msg.name || 'search';
    pipeline.setControlVector(name, unit, 0.0, 1.0);

    self.postMessage({
      type: 'axisBuilt', name: name,
      negN: neg.length, posN: pos.length, sep: norm,
    });
  } catch (e) {
    fail('search', e);
  }
}

// ── remove: drop a built axis from the pipeline ───────────────────────────
function handleRemove(msg) {
  try {
    if (pipeline && msg.name) pipeline.removeControl(msg.name);
    self.postMessage({ type: 'removed', name: msg.name });
  } catch (e) {
    fail('remove', e);
  }
}

self.onmessage = function (e) {
  var msg = e.data || {};
  switch (msg.type) {
    case 'load':        handleLoad(msg); break;
    case 'generate':    handleGenerate(msg); break;
    case 'anchor':      handleAnchor(msg); break;
    case 'clearAnchor': handleClearAnchor(); break;
    case 'search':      handleSearch(msg); break;
    case 'remove':      handleRemove(msg); break;
    default: fail('dispatch', new Error('unknown message: ' + msg.type));
  }
};

self.postMessage({ type: 'ready' });
