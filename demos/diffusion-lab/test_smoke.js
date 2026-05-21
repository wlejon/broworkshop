// Diffusion Lab smoke test — verifies modules parse, the app bootstraps,
// the CLIP tokenizer matches the real vocab, profile detection works, and
// the attention heatmap math is correct. Does NOT load model weights.
//
//   bro-headless demos/diffusion-lab test_smoke.js
(function () {
  var fails = 0;
  function ok(name, cond, extra) {
    console.log((cond ? 'PASS ' : 'FAIL ') + name +
      (extra != null ? ' (' + extra + ')' : ''));
    if (!cond) fails++;
  }

  // ── modules + bootstrap ───────────────────────────────────────────────
  ok('DLab namespace', !!window.DLab);
  ok('Tokenizer module', !!(window.DLab && DLab.Tokenizer));
  ok('Profiles module', !!(window.DLab && DLab.Profiles));
  ok('Client module', !!(window.DLab && DLab.Client));
  ok('Viewport module', !!(window.DLab && DLab.Viewport));
  ok('Attention module', !!(window.DLab && DLab.Attention));
  ok('app bootstrapped (DLabApp)', !!window.DLabApp);

  // ── tokenizer against the real CLIP vocab ─────────────────────────────
  // Skips gracefully when the brodiffusion sibling weights aren't present.
  var fs = require('fs');
  var modelDir = 'D:/projects/brodiffusion/weights/sd15';
  var haveWeights = false;
  try { haveWeights = fs.existsSync(modelDir + '/tokenizer/vocab.json'); }
  catch (e) { haveWeights = false; }

  if (!haveWeights) {
    console.log('SKIP tokenizer/profile checks (no sd15 weights at ' +
      modelDir + ')');
  } else try {
    var base = modelDir + '/tokenizer/';
    var tk = DLab.Tokenizer.create(
      fs.readFileSync(base + 'vocab.json', 'utf-8'),
      fs.readFileSync(base + 'merges.txt', 'utf-8'));
    ok('vocab count 49408', tk.vocabCount() === 49408, tk.vocabCount());
    var enc = tk.encodeContext('a fox in autumn leaves');
    ok('context length 77', enc.ids.length === 77, enc.ids.length);
    ok('BOS at slot 0', enc.ids[0] === 49406, enc.ids[0]);
    ok('content tokens', enc.tokens.length >= 5, enc.tokens.length);
    console.log('  tokens: ' +
      enc.tokens.map(function (t) { return t.text; }).join(' | '));
    ok('EOS at content end', enc.ids[enc.eosIndex] === 49407, enc.ids[enc.eosIndex]);
    ok('first content slot is 1', enc.tokens[0].contextIndex === 1);
  } catch (e) {
    ok('tokenizer test', false, e.message);
  }

  // ── profile detection ─────────────────────────────────────────────────
  if (haveWeights) try {
    var det = DLab.Profiles.detect(modelDir);
    ok('detect sd15 profile', det.profileId === 'sd15');
    ok('resolved unet weight', /unet/.test(det.weights.unet), det.weights.unet);
    ok('resolved vae weight', /vae/.test(det.weights.vae));
    var spec = det.profile.buildSpec(det, 'ddim');
    ok('spec scheduler ddim', spec.pipeline.scheduler === 'ddim');
  } catch (e) {
    ok('profile detect', false, e.message);
  }

  // ── attention heatmap math ────────────────────────────────────────────
  try {
    var trace = [{ Lq: 256, Lk: 77, data: new Float32Array(256 * 77) }];
    trace[0].data[5 * 77 + 3] = 1.0;          // query 5 attends to token 3
    var hm = DLab.Attention.computeHeatmap(trace, 3, 0, 16, 16);
    ok('heatmap dims 16x16', hm && hm.w === 16 && hm.h === 16);
    ok('heatmap peak at q=5', hm && hm.values[5] === 1.0,
       hm ? hm.values[5] : 'null');
    var opts = DLab.Attention.blockOptions(trace, 16, 16);
    ok('block options', opts.length === 2 && opts[0].value === 'avg');
  } catch (e) {
    ok('heatmap test', false, e.message);
  }

  console.log(fails === 0
    ? '\nALL SMOKE TESTS PASSED'
    : '\n' + fails + ' FAILURE(S)');
})();
