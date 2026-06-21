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
//   main -> generate {prompt, opts, controls} ->  done {bitmap, width, height, ms}
//   main -> search   {neg[], pos[], name}     ->  axisBuilt {name, negN, posN, sep}
//   main -> remove   {name}                   ->  removed {name}
//   errors come back as                       ->  error {stage, message}
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
    case 'load':     handleLoad(msg); break;
    case 'generate': handleGenerate(msg); break;
    case 'search':   handleSearch(msg); break;
    case 'remove':   handleRemove(msg); break;
    default: fail('dispatch', new Error('unknown message: ' + msg.type));
  }
};

self.postMessage({ type: 'ready' });
