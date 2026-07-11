// Krea 2 Lab worker — owns the native Krea 2 pipeline and every research-hook
// control krea-research (../krea-research) discovered, all routed through
// brodiffusion's Krea2-only Pipeline methods (see brodiffusion/include/
// brodiffusion/pipeline.h, "Krea 2 research hooks"). A thin long-lived
// inference server: load the multi-GB weights once, then run many manual
// step-wise generations.
//
// Krea 2 is a 12.9B single-stream flow DiT conditioned on 12 tapped Qwen3-VL-4B
// decoder layers, decoded by the Qwen-Image VAE. Every technique below is a
// documented mechanism from krea-research/ui.py + FINDINGS.md:
//
//   AdaLN dial (pregate/prescale)  — per-step temb_mod delta on blocks [19,28)
//   band dial (literal<->stylized)— scale raw tap layers 7-10 pre-fusion
//   axis bank (18 + user-minted)  — CondControl, already generic (setControl /
//                                   setControlVector), auto-applied at prime()
//   gate scale / gate mask        — attention-gate research hooks
//   image-as-prompt               — same tap mechanism, fed by the vision tower
//   spatial paint compositing     — dual state, latent-level per-step blend
//
// Every technique except the plain axis bank needs a MANUAL step loop (prime
// -> stepOnce* -> decode) instead of the one-shot generate(): the dial needs a
// fresh mod-delta built from krea2TimeMod() every step, and the band dial /
// image-as-prompt need krea2PrimeFromTaps() instead of prime(prompt). So
// runGeneration() below is the one core loop every section (except spatial,
// which needs two states in lockstep) funnels through.
//
// Tensor wire shape used throughout (matches the native binding convention):
//   { rows, cols, data: Float32Array }        — a (rows, cols) tensor
//   { embeds: {...}, mask: {...} }            — a krea2::TextConditioning
//     (embeds is (512*12, 2560) token-major/layer-minor raw taps; mask is
//     (512, 1) row validity)
//
// Message protocol:
//   main -> load          {modelDir, dictPath, spectrumPath, mouthPath}
//        <- loaded        {config, axes, hiddenSize, numLayers, backend,
//                           spectrum, mouth}
//   main -> generate      {prompt, negPrompt, opts, band, dial, gate, gateMask,
//                           gateMaskBand, axisControls, expression, spectrum,
//                           mouth, imagePixels, imageH, imageW, captureGates}
//        <- done          {bitmap, width, height, ms, gates?, exprNeutral?,
//                           spectrumNote?}
//
// `expression` is {adj, alpha} — the contextual per-token field (ported from
// sana-research/dictionary.py, validated on Krea 2 in the emotion-axes probes):
// splice `adj` into the live prompt, splice a MASK-ALIGNED neutral adjective
// into the same slot, diff the raw per-token taps, and prime from
// neutral_taps + alpha * field. alpha 1 == what saying the word does; higher
// extrapolates along the encoder's own displacement (identity drifts at the
// extremes). One field per generation — the splice fixes the tokenization —
// so the main thread sends at most one. Ignored when imagePixels is present
// (image-as-prompt has no text to splice).
//
// `spectrum` is {valence, arousal, hostility, surprise} — the MODEL-NOMINATED
// affect axes, loaded PRE-BAKED from lab/spectrum.json (tools/mint_spectrum.js
// farms ~100 expression-word fields per mint prompt, eigendecomposes, binds
// each axis by anchor-word contrast, pools over the token dimension, and
// averages across three diverse portraits). Each axis is a (12 x 2560)
// per-layer concept direction applied uniformly to EVERY valid token row of
// whatever taps this generation uses — no words, no grammar, no language
// dependence at runtime (round-7 probes: transfers to unseen subjects and a
// Chinese prompt), and it stacks unconditionally with the expression word
// field, the band dial, and image-as-prompt. Calibration: slider 3 ≈ probe
// alpha 5 (full expression); off-manifold drift starts past ~6.
//
// `mouth` is {open, round, teeth} — the same baked-bank mechanism over
// lab/mouth.json (tools/mint_mouth.js farms ~36 mouth-state phrase fields per
// mint prompt across human AND animal subjects, contrasts anchor-pole means,
// pools, averages, orthogonalizes). open = jaw drop, round = pursed<->spread
// lip corners, teeth = bared<->covered; open x round spans the viseme plane.
// mouth.json's gain is calibrated so equal sliders push as hard as the
// spectrum's, and both banks stack on the same carrier.
//   main -> spatialRender {basePrompt, opts, axisName, alpha, maskW, maskH,
//                           maskData}
//        <- spatialDone   {bitmap, width, height, ms}
//   main -> mintTextAxis  {name, pos, neg}
//        <- mintProgress  {label, done, total}      (interim, several)
//        <- axisMinted    {name, axis, consistency, components, residual}
//   main -> mintImageAxis {name, a: {pixels,H,W}, b: {pixels,H,W}}
//        <- mintProgress  {label, done, total}      (interim, several)
//        <- axisMinted    {name, axis, components, residual}
//   main -> registerAxis  {name, axis}       (restore a saved axis — no encodes)
//        <- axisRegistered{name, components, residual}
//   main -> removeControl {name}
//        <- removed       {name}
//   main -> applyLora     {path, scale}      (attach one runtime LoRA group)
//        <- loraApplied   {index, path}
//   main -> setLoras      {loras: [{path, scale}]}   (rebuild all groups —
//        <- lorasSet      {applied: [{path, scale}], errors: [{path, message}]}
//                          used for remove-one and restore-after-load; bad
//                          files are skipped and reported, the rest apply)
//   errors come back as   <- error {stage, message}
//
// Per-LoRA strengths ride each generate message as opts-level `loraScales`
// (index-aligned with the applied groups) and are synced via setLoraScale at
// the top of every generation — no extra round-trip for a slider drag.
//
// axisMinted's `components` explain WHAT the minted direction is made of:
// its cosine against each of the dictionary's 18 named axes (sorted by
// magnitude), plus `residual` — the fraction of the direction that lies
// outside the span of all 18 (i.e. genuinely its own). Both are null when
// the engine build predates pipeline.controlVector().

var pipeline = null;   // native Pipeline handle
var hiddenSize = 0;
var numLayers = 0;
var dictAxes = [];     // the loaded dictionary's axis names (the named bank
                       // minted axes are decomposed against — never includes
                       // runtime/minted axes, so the explanation stays stable)

// The 6 fixed scenes krea-research's mint_text_axis() averages a text-pair
// diff over (axis_factory.py's SCENES[:6]) — robustifies the direction
// against any one scene's incidental content, and yields a consistency score
// (mean pairwise cosine similarity of the per-scene diffs).
var SCENES = [
  'a red fox sitting in a snowy forest clearing',
  'a portrait of an elderly fisherman with a weathered face',
  'a busy tokyo street with neon signs',
  'a cozy scandinavian living room interior',
  'a still life of pears and a copper kettle on a wooden table',
  'rolling green hills with a lone oak tree',
];

// Deep-tap band dial: krea-research's literal<->stylized control scales these
// 4 (of 12) tapped decoder layers before fusion (ui.py's BAND).
var BAND_LAYERS = [7, 8, 9, 10];
// AdaLN dial block range (ui.py's DIAL_BLOCKS) — the last 9 of 28 body blocks.
var DIAL_BLOCKS = [19, 28];

function fail(stage, err) {
  self.postMessage({
    type: 'error',
    stage: stage,
    message: (err && err.message) ? err.message : String(err),
  });
}

function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
}

// ── load ─────────────────────────────────────────────────────────────────
function handleLoad(msg) {
  try {
    if (typeof bro === 'undefined' || !bro.diffusion) {
      throw new Error('bro.diffusion is not available in this build');
    }
    // Free a previously-loaded model's VRAM BEFORE building the new one. Without
    // this the old (~17GB) and new pipelines coexist during loadModel and OOM a
    // 24GB card. dispose() is the engine's deterministic free (GC of the wrapper
    // is too late); guarded for older builds that lack it.
    if (pipeline) {
      try { if (pipeline.dispose) pipeline.dispose(); } catch (e) { /* ignore */ }
      pipeline = null;
    }
    // Encoder-output caches belong to the old pipeline — a different model
    // would silently serve its predecessor's taps.
    fieldCache = {}; fieldCacheCount = 0;
    // Krea 2's FP16 total (DiT ~25GB + Qwen3-VL-4B text/vision ~8.3GB) doesn't
    // fit a single 24GB card. INT8 quantizes BOTH components (loadModel's
    // opts.quantizeWeights, see brodiffusion::Pipeline::ModelDirOptions) down
    // to ~17GB — quantize by default; only skip it if the caller explicitly
    // asks (e.g. a CPU run, or a card with enough VRAM to go FP16).
    var quantize = msg.quantizeWeights !== false;
    var loadedPipeline = bro.diffusion.loadModel(msg.modelDir, { quantizeWeights: quantize });
    // loadModel returns { cancelled: true } (not a Pipeline) when the process is
    // shutting down mid-load (window close / Ctrl+C / teardown). Bail silently —
    // there is no window left to receive a reply, and touching it as a Pipeline
    // would throw.
    if (!loadedPipeline || loadedPipeline.cancelled) { pipeline = null; return; }
    pipeline = loadedPipeline;
    var cfg = pipeline.config();
    if (cfg.modelClass !== 'Krea2') {
      throw new Error('expected a Krea 2 model, got ' + cfg.modelClass);
    }
    hiddenSize = pipeline.krea2HiddenSize();
    numLayers  = pipeline.krea2NumLayers();

    var axes = [];
    if (msg.dictPath) {
      pipeline.loadControlDictionary(msg.dictPath);
      axes = pipeline.controlAxes();
    }
    dictAxes = axes.slice();

    // Baked axis banks — each optional; its panel is disabled without it.
    var bankPaths = { spectrum: msg.spectrumPath, mouth: msg.mouthPath };
    for (var bankName in bankPaths) {
      if (!bankPaths.hasOwnProperty(bankName)) continue;
      try { loadBankDict(bankName, bankPaths[bankName]); }
      catch (e) {
        BAKED_BANKS[bankName].dict = null;
        console.log(bankName + ' dict unavailable: ' + ((e && e.message) || e));
      }
    }

    var tensor = (typeof bro !== 'undefined' && bro.tensor) ? bro.tensor : null;
    self.postMessage({
      type: 'loaded',
      config: cfg,
      axes: axes,
      hiddenSize: hiddenSize,
      numLayers: numLayers,
      backend: tensor && tensor.available ? (tensor.backend || 'gpu') : 'cpu',
      spectrum: !!BAKED_BANKS.spectrum.dict,
      mouth: !!BAKED_BANKS.mouth.dict,
    });
  } catch (e) {
    pipeline = null;
    fail('load', e);
  }
}

// ── shared helpers ───────────────────────────────────────────────────────

// Apply the {axisName: alpha} control map from scratch (mirrors sana-lab):
// clear, then set the nonzero axes, so a slider at 0/absent is a true no-op.
// Baked into the state's fused conditioning at prime() time (task C's wiring)
// — safe to clear again right after priming.
function applyAxisControls(map) {
  pipeline.clearControl();
  var any = false, active = {};
  for (var name in map) {
    if (!map.hasOwnProperty(name)) continue;
    var a = +map[name];
    if (a) { active[name] = a; any = true; }
  }
  if (any) pipeline.setControl(active);
}

// Scale the 4 deep-tap band layers across every token slot of a raw-taps
// buffer, in place. Filler (invalid) token rows get scaled too — harmless,
// encode_text() drops them by mask before fusion.
function scaleBand(embeds, band) {
  if (band === 1.0) return;
  var cols = embeds.cols, data = embeds.data;
  var slots = embeds.rows / 12;
  for (var t = 0; t < slots; t++) {
    for (var bi = 0; bi < BAND_LAYERS.length; bi++) {
      var off = (t * 12 + BAND_LAYERS[bi]) * cols;
      for (var c = 0; c < cols; c++) data[off + c] *= band;
    }
  }
}

// ── contextual per-token expression field ────────────────────────────────
// Splice an adjective as a modifier before the SUBJECT noun (sana
// dictionary.py's validated "a … {adj} woman" form). The subject is the
// article phrase after the last "of" in the first clause ("a studio portrait
// of a woman with…" → the woman, not the portrait — and never a later
// article like "…looking at the camera"), else the first article phrase
// ("the chef in a kitchen" → the chef). Falls back to a leading modifier.
function spliceAdjective(prompt, adj) {
  var head = prompt.split(',')[0];
  var re = /\b(?:of\s+)?(a|an|the)\s+/gi;
  var m, first = null, lastOf = null;
  while ((m = re.exec(head)) !== null) {
    if (!first) first = m;
    if (/^of\s/i.test(m[0])) lastOf = m;
  }
  var pick = lastOf || first;
  if (!pick) return adj + ' ' + prompt;
  var at = pick.index + pick[0].length;
  return prompt.slice(0, at) + adj + ' ' + prompt.slice(at);
}

// Neutral candidates tried in order until one tokenizes to the same mask as
// the expression splice (the row-alignment requirement). Multi-word entries
// at the end catch longer adjectives.
var NEUTRAL_POOL = ['calm', 'neutral', 'serious', 'relaxed', 'placid',
                    'composed', 'expressionless', 'unsmiling', 'stoic',
                    'blank', 'plain', 'quiet', 'still', 'very calm',
                    'quite calm', 'calm and still', 'perfectly calm and still'];

function masksEqual(a, b) {
  if (a.rows !== b.rows || a.cols !== b.cols || a.data.length !== b.data.length) return false;
  for (var i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

// Cache of built fields keyed by prompt+adj — a field costs 2+ encodes
// (~0.2-1 s), a slider drag re-uses it for free. Cleared wholesale when it
// grows past a handful of entries (each is ~125 MB of taps at 512 slots).
var fieldCache = {};
var fieldCacheCount = 0;
function expressionField(prompt, adj) {
  var key = prompt + ' ' + adj;
  if (fieldCache[key]) return fieldCache[key];
  var te = pipeline.krea2EncodePromptTaps(spliceAdjective(prompt, adj));
  var tn = null, neutral = null;
  for (var i = 0; i < NEUTRAL_POOL.length; i++) {
    var cand = pipeline.krea2EncodePromptTaps(spliceAdjective(prompt, NEUTRAL_POOL[i]));
    if (masksEqual(cand.mask, te.mask)) { tn = cand; neutral = NEUTRAL_POOL[i]; break; }
  }
  if (!tn) {
    throw new Error('expression "' + adj + '": no token-aligned neutral found — ' +
                    'try a different word for it');
  }
  var base = tn.embeds.data;
  var field = new Float32Array(base.length);
  var ed = te.embeds.data;
  for (var c = 0; c < base.length; c++) field[c] = ed[c] - base[c];
  if (fieldCacheCount >= 4) { fieldCache = {}; fieldCacheCount = 0; }
  fieldCacheCount++;
  fieldCache[key] = {
    rows: tn.embeds.rows, cols: tn.embeds.cols,
    base: base, field: field, mask: tn.mask, neutral: neutral,
  };
  return fieldCache[key];
}

// The neutral-carrier taps with the field applied at `alpha`. Fresh buffer
// every call — scaleBand mutates its input in place and must not corrupt the
// cached base.
function expressionTaps(prompt, adj, alpha) {
  var f = expressionField(prompt, adj);
  var edited = new Float32Array(f.base.length);
  for (var c = 0; c < f.base.length; c++) edited[c] = f.base[c] + alpha * f.field[c];
  return {
    embeds: { rows: f.rows, cols: f.cols, data: edited },
    mask: f.mask,
    neutral: f.neutral,
  };
}

// ── model-nominated baked axis banks (affect spectrum + mouth) ────────────
// dst += w * src at C++ speed (bro.image kernel).
function axpy(dst, src, w) {
  bro.image.combine(dst, dst, src, { op: 'wsum', wa: 1, wb: w });
}

// Each bank's JSON (lab/spectrum.json from tools/mint_spectrum.js,
// lab/mouth.json from tools/mint_mouth.js) is { span, gain, axes: {key:
// [span floats]} }. Each axis is a unit per-layer direction pooled from a
// farmed word/phrase field cloud and averaged across diverse mint prompts;
// `gain` is the calibrated per-row push (mean field norm / sqrt(token count)
// of the mint prompts). A generate message carries one {key: slider} object
// per bank, under the bank's name.
var BAKED_BANKS = {
  spectrum: { keys: ['valence', 'arousal', 'hostility', 'surprise'], dict: null },
  mouth:    { keys: ['open', 'round', 'teeth'], dict: null },
};
// Slider→alpha calibration: full deflection (3) lands at the probe-verified
// full-expression point (pooled alpha ~5); off-manifold drift starts past ~6.
var BAKED_SLIDER_GAIN = 5 / 3;

function loadBankDict(name, path) {
  var bank = BAKED_BANKS[name];
  bank.dict = null;
  if (!path) return;
  var raw = JSON.parse(require('fs').readFileSync(path, 'utf8'));
  var axes = {};
  for (var i = 0; i < bank.keys.length; i++) {
    var k = bank.keys[i];
    if (!raw.axes[k] || raw.axes[k].length !== raw.span) {
      throw new Error(name + ' dict: bad axis "' + k + '"');
    }
    axes[k] = new Float32Array(raw.axes[k]);
  }
  bank.dict = { span: raw.span, gain: raw.gain, axes: axes };
}

// Add one bank's active axes to every valid token row of `taps`, in place,
// and return the timing-bar note. The pooled directions are per-row uniform,
// so this works on ANY token grid — prompt taps, an expression-field carrier,
// or image-as-prompt taps — with no words or language involved.
function applyBank(taps, name, values) {
  var dict = BAKED_BANKS[name].dict;
  var span = dict.span;
  var slots = taps.mask.rows;
  var parts = [];
  var bankKeys = BAKED_BANKS[name].keys;
  for (var i = 0; i < bankKeys.length; i++) {
    var key = bankKeys[i];
    if (!values.hasOwnProperty(key)) continue;
    var s = values[key] * BAKED_SLIDER_GAIN * dict.gain;
    var vec = dict.axes[key];
    for (var t = 0; t < slots; t++) {
      if (taps.mask.data[t] === 0) continue;
      axpy(taps.embeds.data.subarray(t * span, (t + 1) * span), vec, s);
    }
    parts.push(key + (values[key] > 0 ? ' +' : ' ') + values[key].toFixed(2));
  }
  return name + ' ' + parts.join(', ');
}

// The active {bankName: {axisKey: alpha}} subset of a generate message's
// baked-bank fields (msg.spectrum / msg.mouth), or null when every axis of
// every bank is zero/absent.
function activeBaked(msg) {
  var out = null;
  for (var name in BAKED_BANKS) {
    if (!BAKED_BANKS.hasOwnProperty(name) || !msg[name]) continue;
    var bank = BAKED_BANKS[name];
    var act = null;
    for (var i = 0; i < bank.keys.length; i++) {
      var k = bank.keys[i];
      var a = +msg[name][k] || 0;
      if (a) { if (!act) act = {}; act[k] = a; }
    }
    if (!act) continue;
    if (!bank.dict) {
      throw new Error(name + ' axes need lab/' + name + '.json — run tools/mint_' + name + '.js');
    }
    if (!out) out = {};
    out[name] = act;
  }
  return out;
}

// Raw taps for this generation, or null to let prime(prompt) do the encode
// (+ auto cond_control) internally. Image-as-prompt, the expression field,
// the baked banks, and the band dial all need the raw-taps path; the plain
// axis bank alone does not.
function buildTaps(msg) {
  var band = (msg.band == null) ? 1.0 : +msg.band;
  var expr = (msg.expression && msg.expression.adj && +msg.expression.alpha)
    ? msg.expression : null;
  var baked = activeBaked(msg);
  var taps;
  if (msg.imagePixels) {
    taps = pipeline.krea2EncodeImagePrompt(msg.imagePixels, msg.imageH, msg.imageW);
  } else if (expr) {
    taps = expressionTaps(msg.prompt, String(expr.adj), +expr.alpha);
  } else if (baked || band !== 1.0) {
    taps = pipeline.krea2EncodePromptTaps(msg.prompt);
  } else {
    return null;
  }
  // Baked axes are per-row uniform: they stack on whatever taps this
  // generation uses — plain prompt, expression carrier, or image-as-prompt —
  // and every active bank stacks on the same carrier.
  if (baked) {
    var notes = [];
    for (var name in baked) {
      if (baked.hasOwnProperty(name)) notes.push(applyBank(taps, name, baked[name]));
    }
    taps.note = notes.join(' · ');
  }
  scaleBand(taps.embeds, band);
  return taps;
}

// { data: Float32Array(text_seq+img_len) } | null -> the {rows,cols,data}
// shape krea2SetGateMask expects, or null to clear.
function gateMaskTensor(flat) {
  if (!flat || !flat.length) return null;
  return { rows: flat.length, cols: 1, data: flat };
}

// Which DiT blocks a painted gate mask multiplies. The gate-probe strips
// found full-depth masking cliffs hard — by ~0.5 the painted region starves
// to a flat void that contaminates the whole frame — while the DIAL_BLOCKS
// band stays local, smooth, and monotonic across the 0.5..1.2 range.
function gateMaskBlocks(band) {
  if (band === 'early') return [0, 8];
  if (band === 'all') return [0, numLayers];
  return DIAL_BLOCKS;                       // 'mid' — the graceful default
}

// Sync per-LoRA-group strengths from a generate message's `loraScales` array
// (index-aligned with the applied groups). Cheap native calls — no file IO.
// Messages without the field leave the scales as last set.
function syncLoraScales(scales) {
  if (!scales || !pipeline.setLoraScale) return;
  var n = Math.min(scales.length, pipeline.numLoras ? pipeline.numLoras() : 0);
  for (var i = 0; i < n; i++) pipeline.setLoraScale(i, +scales[i] || 0);
}

// ── the shared manual generation loop ───────────────────────────────────
// Every technique but spatial compositing funnels through this: prime from
// either a plain prompt or caller-supplied raw taps, optionally rebuild a
// fresh AdaLN mod-delta every step from krea2TimeMod(), step to completion,
// decode once. Gate scale/mask are per-forward (not sigma-dependent) so they
// are set once before priming and left in effect for the whole loop.
function runGeneration(msg, onDone) {
  syncLoraScales(msg.loraScales);
  applyAxisControls(msg.axisControls || {});

  var gate = msg.gate;
  pipeline.krea2SetGateScale(gate ? gate.txtScale : 1.0, gate ? gate.imgScale : 1.0,
                             0, numLayers);
  var maskBlocks = gateMaskBlocks(msg.gateMaskBand);
  pipeline.krea2SetGateMask(gateMaskTensor(msg.gateMask), maskBlocks[0], maskBlocks[1]);
  pipeline.krea2CaptureGates(!!msg.captureGates);

  var taps = buildTaps(msg);
  // NB: krea2PrimeFromTaps(embeds, mask, opts, uncondEmbeds?, uncondMask?) —
  // opts is the 3rd arg. Passing it 5th (as uncondMask) silently drops width/
  // height and the render falls back to the 512² default (the size field is
  // ignored whenever the band dial / image-prompt engages this taps path).
  var state = taps
    ? pipeline.krea2PrimeFromTaps(taps.embeds, taps.mask, msg.opts)
    : pipeline.prime(msg.prompt, msg.opts);

  var dial = msg.dial;
  var dialActive = dial && (dial.pregate !== 1.0 || dial.prescale !== 1.0);
  while (!state.done) {
    if (dialActive) {
      var t = state.krea2StepTimestep();
      var tm = pipeline.krea2TimeMod(t);
      var d = new Float32Array(6 * hiddenSize);
      var mod = tm.mod.data;
      for (var h = 0; h < hiddenSize; h++) {
        d[0 * hiddenSize + h] = (dial.prescale - 1.0) * mod[0 * hiddenSize + h];
        d[2 * hiddenSize + h] = (dial.pregate  - 1.0) * mod[2 * hiddenSize + h];
      }
      pipeline.krea2SetModDelta({ rows: 1, cols: 6 * hiddenSize, data: d },
                                DIAL_BLOCKS[0], DIAL_BLOCKS[1]);
    }
    state.stepOnce();
  }
  if (dialActive) pipeline.krea2SetModDelta(null, DIAL_BLOCKS[0], DIAL_BLOCKS[1]);

  var gates = msg.captureGates ? pipeline.krea2Gates() : null;
  var img = state.decode({});
  onDone(img, gates, taps);
}

function respondImage(type, img, ms, extra) {
  var data = new ImageData(img.data, img.width, img.height);
  createImageBitmap(data).then(function (bitmap) {
    var out = { type: type, bitmap: bitmap, width: img.width, height: img.height, ms: ms };
    if (extra) for (var k in extra) out[k] = extra[k];
    self.postMessage(out, [bitmap]);
  }).catch(function (e) { fail(type, e); });
}

// ── generate: sections 1-6 (prompt/dials/band/axes/gates/image-prompt) ──
function handleGenerate(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    var t0 = now();
    var opts = Object.assign({}, msg.opts || {}, { negativePrompt: msg.negPrompt || '' });
    runGeneration(Object.assign({}, msg, { opts: opts }), function (img, gates, taps) {
      var extra = {};
      if (gates) extra.gates = gates;
      if (taps && taps.neutral) extra.exprNeutral = taps.neutral;
      if (taps && taps.note) extra.spectrumNote = taps.note;
      respondImage('done', img, Math.round(now() - t0), extra);
    });
  } catch (e) {
    fail('generate', e);
  }
}

// ── spatial: dual-state lockstep stepping with a per-step latent blend ──
// Approximates krea-research's shared-latent dual forward (render_core's
// v = v*(1-m) + v_alt*m) one level up: both states start from the identical
// seeded latent, step independently under their own conditioning, and after
// each step the two latents are blended by `maskData` and pushed back into
// BOTH states — so the next step's forward sees the composited latent under
// each conditioning, re-synchronizing every step exactly as the shared-`x`
// reference loop does. `maskData` must already be resized to the state's own
// (latentHeight, latentWidth) grid — the main thread owns that resize.
function handleSpatialRender(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    var t0 = now();

    syncLoraScales(msg.loraScales);
    pipeline.clearControl();
    var stateBase = pipeline.prime(msg.basePrompt, msg.opts);
    pipeline.setControl(msg.axisName, msg.alpha);
    var stateAlt = pipeline.prime(msg.basePrompt, msg.opts);
    pipeline.clearControl();

    var H = stateBase.latentHeight, W = stateBase.latentWidth;
    var mask = msg.maskData;
    if (!mask || mask.length !== H * W) {
      throw new Error('spatialRender: maskData must have length latentHeight*latentWidth (' +
                      H + 'x' + W + ')');
    }

    while (!stateBase.done) {
      stateBase.stepOnce();
      stateAlt.stepOnce();
      var a = stateBase.latent(), b = stateAlt.latent();
      var plane = H * W;
      var C = a.length / plane;
      var blended = new Float32Array(a.length);
      for (var c = 0; c < C; c++) {
        var base = c * plane;
        for (var i = 0; i < plane; i++) {
          var m = mask[i];
          blended[base + i] = a[base + i] * (1 - m) + b[base + i] * m;
        }
      }
      stateBase.setLatent(blended);
      stateAlt.setLatent(blended);
    }

    var img = stateBase.decode({});
    respondImage('spatialDone', img, Math.round(now() - t0));
  } catch (e) {
    fail('spatialRender', e);
  }
}

// ── axis minting ─────────────────────────────────────────────────────────

function fusedFor(prompt) {
  var taps = pipeline.krea2EncodePromptTaps(prompt);
  return pipeline.krea2EncodeText(taps.embeds, taps.mask);
}

// Mean over EVERY row — Krea 2's fused conditioning has no BOS row to skip
// (unlike Gemma/CLIP, where row 0 is protected; see cond_control.h).
function meanRows(fused) {
  var rows = fused.rows, cols = fused.cols, d = fused.data;
  var out = new Float64Array(cols);
  for (var r = 0; r < rows; r++) {
    var off = r * cols;
    for (var c = 0; c < cols; c++) out[c] += d[off + c];
  }
  for (var c = 0; c < cols; c++) out[c] /= rows;
  return out;
}

function unitNormalize(v) {
  var n = 0;
  for (var c = 0; c < v.length; c++) n += v[c] * v[c];
  n = Math.sqrt(n) || 1e-9;
  var out = new Float32Array(v.length);
  for (var c = 0; c < v.length; c++) out[c] = v[c] / n;
  return out;
}

// Interim progress for the long minting encodes (the UI shows a bar).
function mintProgress(label, done, total) {
  self.postMessage({ type: 'mintProgress', label: label, done: done, total: total });
}

// Minted axes must inject at the SAME calibrated magnitude as the bank.
// The dictionary bakes scale = 0.15 x mean fused token norm (~46 for Krea 2
// Turbo) so "slider 1.0 means the same relative push everywhere", and
// krea-research's ui.py applies USER axes with that same AXIS_SCALE
// (apply_axes, line 131). Registering minted axes with scale 1.0 made every
// mint ~46x weaker than a bank axis — a flat sweep, an invisible slider.
// Read the calibration off any dictionary axis at runtime; 1.0 only if
// there's no dictionary or the engine predates controlVector().
function bankScale() {
  if (!dictAxes.length || !pipeline.controlVector) return 1.0;
  return pipeline.controlVector(dictAxes[0]).scale;
}

// Explain a freshly minted unit direction against the dictionary's named
// bank: per-axis cosine (the bank directions are unit vectors by the BCD1
// format), plus how much of the direction lies OUTSIDE the bank's span.
// The axes aren't orthogonal, so summing squared cosines would overcount —
// project onto the span properly (solve the 18x18 Gram system) and report
// residual = |axis - proj| as the honest "genuinely its own" fraction.
// Returns null when the engine build lacks pipeline.controlVector().
function explainAxis(axis) {
  if (!pipeline.controlVector || !dictAxes.length) return null;
  var n = dictAxes.length, dim = axis.length;
  var units = [], keptNames = [];
  for (var i = 0; i < n; i++) {
    var dir = pipeline.controlVector(dictAxes[i]).dir;
    if (dir.length !== dim) continue;   // stale dict vs runtime dim mismatch
    units.push(unitNormalize(dir));
    keptNames.push(dictAxes[i]);
  }
  n = units.length;
  if (!n) return null;

  var b = new Float64Array(n);          // b_i = <u_i, axis>  (= cosine)
  for (var i = 0; i < n; i++) {
    var dot = 0;
    for (var c = 0; c < dim; c++) dot += units[i][c] * axis[c];
    b[i] = dot;
  }
  // Gram matrix (symmetric — fill the lower triangle, mirror the upper) +
  // Gaussian elimination with partial pivoting (n is 18, this is trivial).
  var M = [];
  for (var i = 0; i < n; i++) M.push(new Float64Array(n));
  for (var i = 0; i < n; i++) {
    for (var j = 0; j <= i; j++) {
      var dot = 0;
      for (var c = 0; c < dim; c++) dot += units[i][c] * units[j][c];
      M[i][j] = dot; M[j][i] = dot;
    }
  }
  var coef = new Float64Array(b);
  for (var col = 0; col < n; col++) {
    var piv = col;
    for (var r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) { coef[col] = 0; continue; }
    if (piv !== col) {
      var tr = M[piv]; M[piv] = M[col]; M[col] = tr;
      var tb = coef[piv]; coef[piv] = coef[col]; coef[col] = tb;
    }
    for (var r = col + 1; r < n; r++) {
      var f = M[r][col] / M[col][col];
      if (!f) continue;
      for (var c2 = col; c2 < n; c2++) M[r][c2] -= f * M[col][c2];
      coef[r] -= f * coef[col];
    }
  }
  for (var col = n - 1; col >= 0; col--) {
    if (Math.abs(M[col][col]) < 1e-12) continue;
    var s = coef[col];
    for (var c2 = col + 1; c2 < n; c2++) s -= M[col][c2] * coef[c2];
    coef[col] = s / M[col][col];
  }
  // |proj|^2 = b . coef (axis is unit), clamp for float noise.
  var explained = 0;
  for (var i = 0; i < n; i++) explained += b[i] * coef[i];
  explained = Math.max(0, Math.min(1, explained));

  var components = [];
  for (var i = 0; i < n; i++) components.push({ name: keptNames[i], cos: b[i] });
  components.sort(function (x, y) { return Math.abs(y.cos) - Math.abs(x.cos); });
  return { components: components, residual: Math.sqrt(1 - explained) };
}

// Mint a user axis from a text pair, averaged over SCENES for robustness
// (mirrors krea-research's mint_text_axis). Registers live via
// setControlVector — coexists with the loaded dictionary's 18 core axes.
function handleMintTextAxis(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    var name = (msg.name || '').trim(), pos = (msg.pos || '').trim(), neg = (msg.neg || '').trim();
    if (!name || !pos || !neg) throw new Error('need a name and both descriptions');

    var diffs = [], cols = 0;
    var total = SCENES.length * 2;
    for (var i = 0; i < SCENES.length; i++) {
      mintProgress('scene ' + (i + 1) + '/' + SCENES.length + ' · toward', i * 2, total);
      var mp = meanRows(fusedFor(SCENES[i] + ', ' + pos));
      mintProgress('scene ' + (i + 1) + '/' + SCENES.length + ' · away', i * 2 + 1, total);
      var mn = meanRows(fusedFor(SCENES[i] + ', ' + neg));
      cols = mp.length;
      var diff = new Float64Array(cols);
      for (var c = 0; c < cols; c++) diff[c] = mp[c] - mn[c];
      diffs.push(diff);
    }

    // consistency: mean pairwise cosine similarity of the per-scene unit
    // directions (low => the two descriptions may not name one clean axis).
    var units = diffs.map(unitNormalize);
    var simSum = 0, simN = 0;
    for (var i = 0; i < units.length; i++) {
      for (var j = i + 1; j < units.length; j++) {
        var dot = 0;
        for (var c = 0; c < cols; c++) dot += units[i][c] * units[j][c];
        simSum += dot; simN++;
      }
    }
    var consistency = simN ? simSum / simN : 1;

    var mean = new Float64Array(cols);
    for (var i = 0; i < diffs.length; i++) {
      for (var c = 0; c < cols; c++) mean[c] += diffs[i][c];
    }
    for (var c = 0; c < cols; c++) mean[c] /= diffs.length;
    var axis = unitNormalize(mean);

    pipeline.setControlVector(name, axis, 0.0, bankScale());
    var explain = explainAxis(axis);
    self.postMessage({
      type: 'axisMinted', name: name, consistency: consistency, axis: axis,
      components: explain ? explain.components : null,
      residual: explain ? explain.residual : null,
    });
  } catch (e) {
    fail('mintTextAxis', e);
  }
}

// Mint a user axis from an image pair (toward minus away), through the same
// vision-tower tap path image-as-prompt uses (mirrors make_image_axis).
function handleMintImageAxis(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    var name = (msg.name || '').trim();
    if (!name || !msg.a || !msg.b) throw new Error('need a name and both images');

    mintProgress('encoding "toward" image (vision tower)', 0, 4);
    var ta = pipeline.krea2EncodeImagePrompt(msg.a.pixels, msg.a.H, msg.a.W);
    mintProgress('encoding "away" image (vision tower)', 1, 4);
    var tb = pipeline.krea2EncodeImagePrompt(msg.b.pixels, msg.b.H, msg.b.W);
    mintProgress('fusing "toward" conditioning', 2, 4);
    var ma = meanRows(pipeline.krea2EncodeText(ta.embeds, ta.mask));
    mintProgress('fusing "away" conditioning', 3, 4);
    var mb = meanRows(pipeline.krea2EncodeText(tb.embeds, tb.mask));
    var cols = ma.length;
    var diff = new Float64Array(cols);
    for (var c = 0; c < cols; c++) diff[c] = ma[c] - mb[c];
    var axis = unitNormalize(diff);

    pipeline.setControlVector(name, axis, 0.0, bankScale());
    var explain = explainAxis(axis);
    self.postMessage({
      type: 'axisMinted', name: name, axis: axis,
      components: explain ? explain.components : null,
      residual: explain ? explain.residual : null,
    });
  } catch (e) {
    fail('mintImageAxis', e);
  }
}

// Re-register a previously minted axis from its saved unit direction — a
// plain setControlVector at bank scale, zero encodes. This is what load-time
// restore uses: the saved vector IS the axis, so re-deriving it every launch
// (12 encodes per text axis, impossible for history-sourced image pairs) was
// pure waste. explainAxis reruns here so the inspector's decomposition always
// reflects the currently loaded dictionary.
function handleRegisterAxis(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    var name = (msg.name || '').trim();
    if (!name || !msg.axis || !msg.axis.length) throw new Error('need a name and a direction');
    var axis = (msg.axis instanceof Float32Array) ? msg.axis : new Float32Array(msg.axis);
    pipeline.setControlVector(name, axis, 0.0, bankScale());
    var explain = explainAxis(axis);
    self.postMessage({
      type: 'axisRegistered', name: name,
      components: explain ? explain.components : null,
      residual: explain ? explain.residual : null,
    });
  } catch (e) {
    fail('registerAxis', e);
  }
}

function handleRemoveControl(msg) {
  try {
    if (pipeline && msg.name) pipeline.removeControl(msg.name);
    self.postMessage({ type: 'removed', name: msg.name });
  } catch (e) {
    fail('removeControl', e);
  }
}

// ── LoRA adapters ────────────────────────────────────────────────────────
// The main thread's {path, scale} list is authoritative (it persists it);
// the pipeline's runtime groups are rebuilt from it. applyLora appends one
// group; setLoras rebuilds them all (remove-one, restore-after-load).

function handleApplyLora(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    if (!pipeline.applyLora) throw new Error('this engine build has no LoRA support');
    pipeline.applyLora(msg.path, msg.scale == null ? 1.0 : +msg.scale);
    self.postMessage({ type: 'loraApplied',
                       index: pipeline.numLoras ? pipeline.numLoras() - 1 : 0,
                       path: msg.path });
  } catch (e) {
    fail('applyLora', e);
  }
}

function handleSetLoras(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    if (!pipeline.clearLoras) throw new Error('this engine build has no LoRA support');
    pipeline.clearLoras();
    var applied = [], errors = [];
    (msg.loras || []).forEach(function (l) {
      try {
        pipeline.applyLora(l.path, l.scale == null ? 1.0 : +l.scale);
        applied.push({ path: l.path, scale: l.scale == null ? 1.0 : +l.scale });
      } catch (e) {
        errors.push({ path: l.path,
                      message: (e && e.message) ? e.message : String(e) });
      }
    });
    // `applied` is the new group order — a skipped file shifts later indices
    // down, so the main thread replaces its list with exactly this.
    self.postMessage({ type: 'lorasSet', applied: applied, errors: errors });
  } catch (e) {
    fail('setLoras', e);
  }
}

self.onmessage = function (e) {
  var msg = e.data || {};
  switch (msg.type) {
    case 'load':           handleLoad(msg); break;
    case 'generate':       handleGenerate(msg); break;
    case 'spatialRender':  handleSpatialRender(msg); break;
    case 'mintTextAxis':   handleMintTextAxis(msg); break;
    case 'mintImageAxis':  handleMintImageAxis(msg); break;
    case 'registerAxis':   handleRegisterAxis(msg); break;
    case 'removeControl':  handleRemoveControl(msg); break;
    case 'applyLora':      handleApplyLora(msg); break;
    case 'setLoras':       handleSetLoras(msg); break;
    default: fail('dispatch', new Error('unknown message: ' + msg.type));
  }
};

self.postMessage({ type: 'ready' });
