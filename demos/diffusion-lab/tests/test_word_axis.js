// Diffusion Lab word-axis end-to-end test (loads weights — heavier).
// Exercises the EXACT pipeline-construction path the worker uses (createPipeline
// + loadWeights + LCM-LoRA), builds an "age" word-axis via the same diff-of-means
// recipe as lab/diffusion-worker.js, and asserts the conditioning-control seam
// steers an SD1.5-LCM generation:
//   - encodeConditioning is CLIP-width (768)
//   - baseline vs steered (same seed) DIFFER   -> seam wired through this path
//   - alpha 0 == baseline                       -> zero is a true no-op
//
//   bro-headless demos/diffusion-lab tests/test_word_axis.js
import { Profiles } from "/app/lab/profiles.js";

(function () {
  var fails = 0;
  function ok(name, cond, extra) {
    console.log((cond ? 'PASS ' : 'FAIL ') + name +
      (extra != null ? ' (' + extra + ')' : ''));
    if (!cond) fails++;
  }
  function done() {
    console.log(fails === 0 ? '\nWORD-AXIS E2E PASSED'
                            : '\n' + fails + ' FAILURE(S)');
  }

  if (typeof bro === 'undefined' || !bro.diffusion) {
    console.log('SKIP (bro.diffusion unavailable)'); return;
  }
  var fs = require('fs');
  var WROOT = (typeof process !== 'undefined' && process.env &&
               process.env.BRO_WEIGHTS) || 'D:/projects';
  var modelDir = WROOT + '/brodiffusion/weights/sd15';
  var lcmLora = WROOT + '/brodiffusion/weights/lcm-lora-sdv1-5/' +
                'pytorch_lora_weights.safetensors';
  if (!fs.existsSync(modelDir + '/tokenizer/vocab.json')) {
    console.log('SKIP (no sd15 weights at ' + modelDir + ')'); return;
  }

  bro.diffusion.init();
  var det = Profiles.detect(modelDir);
  var spec = det.profile.buildSpec(det, 'lcm', false);
  var pipe = bro.diffusion.createPipeline(spec.pipeline);
  pipe.loadWeights(spec.weights.text, spec.weights.unet, spec.weights.vae);
  if (fs.existsSync(lcmLora)) pipe.applyLora(lcmLora, 1.0);
  console.log('pipeline ready (' + (pipe.config().modelClass || '?') + ', lcm)');

  // diff-of-means age axis — the worker's recipe (skip BOS, no MASSIVE).
  function meanContent(p) {
    var e = pipe.encodeConditioning(p);
    ok('encodeConditioning width 768', e.cols === 768, e.cols);
    var rows = e.rows, cols = e.cols, d = e.data, out = new Float64Array(cols), n = rows - 1;
    for (var r = 1; r < rows; r++) { var o = r * cols; for (var c = 0; c < cols; c++) out[c] += d[o + c]; }
    if (n > 0) for (var k = 0; k < cols; k++) out[k] /= n;
    return out;
  }
  function setMean(ps) {
    var sum = null, cols = 0;
    for (var i = 0; i < ps.length; i++) { var m = meanContent(ps[i]); if (!sum) { sum = new Float64Array(m.length); cols = m.length; } for (var c = 0; c < cols; c++) sum[c] += m[c]; }
    for (var k = 0; k < cols; k++) sum[k] /= ps.length;
    return sum;
  }
  var mA = setMean(['a young person', 'a child', 'a youthful face']);
  var mB = setMean(['an old person', 'an elderly man', 'a wrinkled aged face']);
  var cols = mA.length, v = new Float64Array(cols), nrm = 0;
  for (var c = 0; c < cols; c++) { v[c] = mB[c] - mA[c]; nrm += v[c] * v[c]; }
  nrm = Math.sqrt(nrm);
  var unit = new Float32Array(cols);
  for (var c2 = 0; c2 < cols; c2++) unit[c2] = v[c2] / nrm;
  console.log('age axis separation = ' + nrm.toFixed(2));
  pipe.setControlVector('age', unit, 0.0, 1.0);

  var prompt = 'a portrait photo of a person';
  var opts = { width: 512, height: 512, steps: 6, guidanceScale: 1.0, seed: 1234, negativePrompt: '' };

  // Step-wise render to the final frame (the worker's prime + stepOnce loop).
  function render(controls) {
    pipe.clearControl();
    if (controls) pipe.setControl(controls);
    var st = pipe.prime(prompt, opts);
    var img = null;
    while (!st.done) { st.stepOnce(); img = st.decode(); }
    return img;
  }
  function meanAbsDiff(a, b) {
    var n = Math.min(a.length, b.length), s = 0;
    for (var i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
    return s / n;
  }

  var base = render(null);
  var steer = render({ age: 30.0 });
  var zero = render({ age: 0.0 });
  var dSteer = meanAbsDiff(base.data, steer.data);
  var dZero = meanAbsDiff(base.data, zero.data);
  console.log('mean|Δpixel| baseline vs steered(+30) = ' + dSteer.toFixed(2));
  console.log('mean|Δpixel| baseline vs alpha0        = ' + dZero.toFixed(3));
  ok('control steers the image (lab createPipeline path)', dSteer > 2.0, dSteer.toFixed(2));
  ok('alpha 0 is a true no-op', dZero < 0.01, dZero.toFixed(3));
  done();
})();
