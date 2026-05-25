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
    ok('spec quantize defaults off', spec.pipeline.quantizeWeights === false);
    var qspec = det.profile.buildSpec(det, 'lcm', true);
    ok('spec quantize flag honoured',
       qspec.pipeline.quantizeWeights === true &&
       qspec.pipeline.scheduler === 'lcm');
    // The sampler and the U-Net architecture are independent: picking the LCM
    // scheduler must NOT flip lcmDistilled (that would force the cond_proj
    // path onto a vanilla checkpoint). LCM scheduler on vanilla SD1.5 is the
    // LCM-LoRA workflow; brodiffusion's load_weights auto-detects cond_proj.
    ok('lcmDistilled decoupled from scheduler',
       qspec.pipeline.lcmDistilled === false &&
       spec.pipeline.lcmDistilled === false);
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

    // contrastive normalisation: a "work" signal shared across content tokens
    // is cancelled, leaving the token-specific bump. tokens 3 and 5 both spike
    // on queries 0,1 (the detailed region) — the token-agnostic signal; token
    // 3 alone also rises on query 2.
    var ct = [{ Lq: 4, Lk: 77, data: new Float32Array(4 * 77) }];
    function setw(q, kk, v) { ct[0].data[q * 77 + kk] = v; }
    setw(0, 3, 0.8); setw(1, 3, 0.8); setw(2, 3, 0.5); setw(3, 3, 0.1);
    setw(0, 5, 0.8); setw(1, 5, 0.8); setw(2, 5, 0.1); setw(3, 5, 0.1);
    var raw = DLab.Attention.computeHeatmap(ct, 3, 0, 2, 2);
    ok('raw column peaks on the shared work signal',
       raw && raw.values[0] === 1 && raw.values[2] < 1,
       raw ? raw.values[2] : 'null');
    var con = DLab.Attention.computeHeatmap(ct, 3, 0, 2, 2, [3, 5]);
    ok('contrastive column peaks on the token-specific query',
       con && con.values[2] === 1 && con.values[0] === 0,
       con ? con.values[0] + '/' + con.values[2] : 'null');
  } catch (e) {
    ok('heatmap test', false, e.message);
  }

  // ── attention steering: attnBias construction ─────────────────────────
  try {
    var shapes = [{ Lq: 4, Lk: 77 }, { Lq: 256, Lk: 77 }];
    var bias = DLab.Attention.buildAttnBias({ 3: 2, 10: -1.5 }, shapes);
    ok('attnBias layer count', bias.length === 2);
    ok('attnBias layer shape', bias[0].Lq === 4 && bias[0].Lk === 77);
    ok('attnBias boosts token 3 in every query',
       bias[0].data[0 * 77 + 3] === 2 && bias[0].data[3 * 77 + 3] === 2);
    ok('attnBias suppresses token 10', bias[1].data[5 * 77 + 10] === -1.5);
    ok('attnBias leaves other columns zero',
       bias[0].data[0] === 0 && bias[0].data[1 * 77 + 4] === 0);
    var empty = DLab.Attention.buildAttnBias({}, shapes);
    ok('attnBias empty map is all zero',
       empty[0].data[3] === 0 && empty[1].data[10] === 0);
    var oob = DLab.Attention.buildAttnBias({ 99: 3 }, shapes);
    ok('attnBias ignores out-of-range token',
       oob[0].data[3] === 0 && oob[1].data[40] === 0);
  } catch (e) {
    ok('attnBias test', false, e.message);
  }

  // ── img2img + ControlNet opts plumbing ────────────────────────────────
  try {
    var app = window.DLabApp;
    ok('app exposes readOpts', typeof app.readOpts === 'function');
    ok('app exposes setInitImage', typeof app.setInitImage === 'function');
    ok('app exposes addControlNetPath',
       typeof app.addControlNetPath === 'function');

    // Baseline — clean opts have no init/mask/controls fields.
    app.setInitImage('');
    var baseOpts = app.readOpts();
    ok('baseline opts have no initImagePath',
       baseOpts.initImagePath === undefined);
    ok('baseline opts have no controls', baseOpts.controls === undefined);

    // img2img path
    app.setInitImage('/tmp/seed.png');
    app.setStrength(0.55);
    app.setVaeSample(true);
    var i2i = app.readOpts();
    ok('initImagePath set', i2i.initImagePath === '/tmp/seed.png');
    ok('strength forwarded', Math.abs(i2i.strength - 0.55) < 1e-6,
       i2i.strength);
    ok('vaeEncodeSample forwarded', i2i.vaeEncodeSample === true);
    ok('mask absent when not picked', i2i.maskImagePath === undefined);

    // Inpaint path
    app.setMaskImage('/tmp/mask.png');
    var ip = app.readOpts();
    ok('maskImagePath set when init present',
       ip.maskImagePath === '/tmp/mask.png');

    // Clearing init must also clear mask (the binding rejects mask-only).
    app.setInitImage('');
    var cleared = app.readOpts();
    ok('clearing init drops mask too',
       cleared.initImagePath === undefined &&
       cleared.maskImagePath === undefined);

    // ControlNets — opts.controls only attached once registered count
    // matches the UI list, so a fresh add (no Load) suppresses it.
    app.addControlNetPath('/tmp/cn1.safetensors',
      { image: '/tmp/pose.png', scale: 0.8, startStep: 0, endStep: 0.5 });
    app.addControlNetPath('/tmp/cn2.safetensors',
      { image: '/tmp/depth.png', scale: 1.2, startStep: 0.5, endStep: 1 });
    var staleOpts = app.readOpts();
    ok('controls suppressed while stale (not loaded)',
       staleOpts.controls === undefined);
    var st = app.state();
    ok('controlnets tracked in state',
       st.controlnets === 2 && st.cnLoaded === 0);
  } catch (e) {
    ok('opts plumbing test', false, e.message);
  }

  console.log(fails === 0
    ? '\nALL SMOKE TESTS PASSED'
    : '\n' + fails + ' FAILURE(S)');
})();
