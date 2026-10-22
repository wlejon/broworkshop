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
//   axis bank (26 named + 391      — CondControl, already generic (setControl /
//     unnamed SAE atoms + minted)    setControlVector), auto-applied at prime()
//   gate scale / gate mask        — attention-gate research hooks
//   reference picture             — same tap mechanism, fed by the vision tower
//   spatial paint compositing     — dual state, latent-level per-step blend
//
// Every technique except the plain axis bank needs a MANUAL step loop (prime
// -> stepOnce* -> decode) instead of the one-shot generate(): the dial needs a
// fresh mod-delta built from krea2TimeMod() every step, and the band dial /
// reference picture need krea2PrimeFromTaps() instead of prime(prompt). So
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
//   main -> load          {modelDir, textEncoderPath?, dictPaths, namedDicts?,
//                           spectrumPath, mouthPath}   (namedDicts: the subset of
//                           dictPaths whose axes carry a UI label; the rest are
//                           unnamed discovered atoms. Absent = all named.)
//        <- loaded        {config, axes, hiddenSize, numLayers, backend,
//                           spectrum, mouth, textEncoder}
//   main -> reloadTextEncoder {modelDir, textEncoderPath?}   (swap the tapped
//                           Qwen3-VL backbone in place; DiT/VAE/axes/LoRAs stay)
//        <- textEncoderReloaded {textEncoder, backend}
//   main -> generate      {prompt, negPrompt, opts, band, dial, gate, gateMask,
//                           gateMaskBand, axisControls, expression, spectrum,
//                           mouth, reference, captureGates}
//        <- done          {bitmap, width, height, ms, gates?, exprNeutral?,
//                           spectrumNote?, referenceNote?}
//   main -> setReference  {pixels, H, W}     (encode + cache the picture)
//        <- referenceSet  {tokens}           (valid vision-token count)
//   main -> clearReference {}
//        <- referenceCleared {}
//   main -> spatialRender {base: <a full generate-shaped message — the
//                           captured render's msg, controls and all>,
//                           axisName, alpha, maskW, maskH, maskData}
//        <- spatialDone   {bitmap, width, height, ms}
//   main -> mintTextAxis  {name, pos, neg}
//        <- mintProgress  {label, done, total}      (interim, several)
//        <- axisMinted    {name, axis, consistency, components, residual, atoms}
//   main -> mintImageAxis {name, a: {pixels,H,W}, b: {pixels,H,W}}
//        <- mintProgress  {label, done, total}      (interim, several)
//        <- axisMinted    {name, axis, components, residual, atoms}
//   main -> registerAxis  {name, axis}       (restore a saved axis — no encodes)
//        <- axisRegistered{name, components, residual, atoms}
//   main -> removeControl {name}
//        <- removed       {name}
//   main -> applyLora     {path, scale}      (attach one runtime LoRA group)
//        <- loraApplied   {index, path}
//   main -> setLoras      {loras: [{path, scale}]}   (rebuild all groups —
//        <- lorasSet      {applied: [{path, scale}], errors: [{path, message}]}
//                          used for remove-one and restore-after-load; bad
//                          files are skipped and reported, the rest apply)
//   errors come back as   <- error {stage, message}

import {
  DIAL_BLOCKS,
  BAKED_BANKS,
  clearEncoderCaches,
  setReferenceRef,
  applyAxisControls,
  loadBankDict,
  buildTaps,
} from '/app/lab/worker-taps.js';
import {
  mintTextAxis,
  mintImageAxis,
  registerAxis,
} from '/app/lab/worker-mint.js';

var pipeline = null;   // native Pipeline handle
var hiddenSize = 0;
var numLayers = 0;
var dictAxes = [];     // the NAMED bank's axis names — the basis minted axes are
                       // decomposed against. Never includes runtime/minted axes,
                       // so the explanation stays stable, and never includes the
                       // unnamed discovered atoms: solving against 400+ near-
                       // dependent directions drove the residual to ~0 (so "% of
                       // it is new" stopped meaning anything) and cost a 400x400
                       // Gram at 6144-d per mint. Those live in discoveredAxes.
var discoveredAxes = []; // the unnamed SAE atoms — cosines only, never the solve

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
    clearEncoderCaches();
    // Krea 2's FP16 total (DiT ~25GB + Qwen3-VL-4B text/vision ~8.3GB) doesn't
    // fit a single 24GB card. INT8 quantizes BOTH components (loadModel's
    // opts.quantizeWeights, see brodiffusion::Pipeline::ModelDirOptions) down
    // to ~17GB — quantize by default; only skip it if the caller explicitly
    // asks (e.g. a CPU run, or a card with enough VRAM to go FP16).
    var quantize = msg.quantizeWeights !== false;
    // Optional text-encoder override: a Qwen3-VL-4B .gguf (e.g. Q8_0) or another
    // diffusers text_encoder. Empty/absent → the model dir's bundled encoder.
    // The engine keeps the vision tower from the model dir either way, so
    // the reference picture still works with a text-only gguf swapped in.
    var teOpts = { quantizeWeights: quantize };
    if (msg.textEncoderPath) teOpts.textEncoderPath = msg.textEncoderPath;
    var loadedPipeline = bro.diffusion.loadModel(msg.modelDir, teOpts);
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

    // The axis bank is stacked from several dictionaries of different provenance:
    // the word-derived named axes, the verified SAE deck, and the unnamed
    // discovered atoms. The first load replaces, the rest merge, so every axis
    // ends up on one slider list.
    //
    // `msg.namedDicts` lists the dictionaries whose axes carry a UI label (they
    // are the ones in assets/axes_meta.json). Everything else is an unnamed atom.
    // Split here rather than by name prefix: the deck atoms are named sae.NNNN
    // too, so the prefix says nothing about whether a person labelled it. Absent,
    // every dictionary counts as named — the pre-split behaviour.
    var axes = [];
    var dicts = msg.dictPaths || (msg.dictPath ? [msg.dictPath] : []);
    var namedDicts = msg.namedDicts || null;
    // A null-prototype map: axis names come out of a binary file, and a plain
    // object would report "constructor" as already seen.
    var seen = Object.create(null);
    dictAxes = []; discoveredAxes = [];
    for (var d = 0; d < dicts.length; d++) {
      pipeline.loadControlDictionary(dicts[d], { merge: d > 0 });
      axes = pipeline.controlAxes();
      var isNamed = !namedDicts || namedDicts.indexOf(dicts[d]) >= 0;
      for (var i = 0; i < axes.length; i++) {
        if (seen[axes[i]]) continue;
        seen[axes[i]] = true;
        (isNamed ? dictAxes : discoveredAxes).push(axes[i]);
      }
    }

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
      textEncoder: msg.textEncoderPath || null,
    });
  } catch (e) {
    pipeline = null;
    fail('load', e);
  }
}

// ── reload just the text encoder ───────────────────────────────────────────
// Swap the tapped Qwen3-VL-4B backbone in place, keeping the resident DiT/VAE
// (re-reading the ~26GB checkpoint is what makes a full load slow). The engine
// reconstructs only the text model; the control axis bank, LoRAs and minted
// axes ride on the DiT conditioning and survive untouched. Encoder-output
// caches (per-prompt field taps, the reference picture) belong to the OLD
// encoder — clear them so the next render re-encodes against the new one.
function handleReloadTextEncoder(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded — load a model first');
    if (!pipeline.reloadTextEncoder) {
      throw new Error('this engine build has no reloadTextEncoder (rebuild bro)');
    }
    var quantize = msg.quantizeWeights !== false;
    pipeline.reloadTextEncoder(msg.modelDir, msg.textEncoderPath || '',
                               { quantizeWeights: quantize });
    clearEncoderCaches();
    var tensor = (typeof bro !== 'undefined' && bro.tensor) ? bro.tensor : null;
    self.postMessage({
      type: 'textEncoderReloaded',
      textEncoder: msg.textEncoderPath || null,
      backend: tensor && tensor.available ? (tensor.backend || 'gpu') : 'cpu',
    });
  } catch (e) {
    fail('reloadTextEncoder', e);
  }
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
// Every technique funnels through these pieces: prime from either a plain
// prompt or caller-supplied raw taps, optionally rebuild a fresh AdaLN
// mod-delta every step from krea2TimeMod(), step to completion, decode once.
// Gate scale/mask are per-forward (not sigma-dependent) so they are set once
// before priming and left in effect for the whole loop.

// Prime one step-wise state for a generate-shaped message: bake its axis
// controls into the fused conditioning (applied at prime; cleared right
// after — the state keeps its own copy), and take the raw-taps path when any
// technique needs it. Since brodiffusion carries the prepared conditioning
// ON the state (PipelineState.prepared), states primed here can be stepped
// interleaved — each denoises under its own conditioning.
function primeState(msg) {
  var stack = applyAxisControls(pipeline, msg.axisControls || {}, msg.band);
  var taps = buildTaps(pipeline, msg);
  // NB: krea2PrimeFromTaps(embeds, mask, opts, uncondEmbeds?, uncondMask?) —
  // opts is the 3rd arg. Passing it 5th (as uncondMask) silently drops width/
  // height and the render falls back to the 512² default (the size field is
  // ignored whenever the band dial / image-prompt engages this taps path).
  var state = taps
    ? pipeline.krea2PrimeFromTaps(taps.embeds, taps.mask, msg.opts)
    : pipeline.prime(msg.prompt, msg.opts);
  pipeline.clearControl();
  return { state: state, taps: taps, stack: stack };
}

// Install this step's AdaLN mod-delta for the dial (pregate/prescale) on the
// DIAL_BLOCKS band. Model-global: every forward until the next set sees it,
// which is exactly right for lockstep dual-state stepping too (both states
// run the same step, hence the same timestep).
function applyDialDelta(dial, t) {
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

function dialFor(msg) {
  var dial = msg.dial;
  return (dial && (dial.pregate !== 1.0 || dial.prescale !== 1.0)) ? dial : null;
}

// Gate scale/mask + capture flag — per-forward model state, set once before
// priming and left in effect for the whole loop.
function applyGateState(msg) {
  var gate = msg.gate;
  pipeline.krea2SetGateScale(gate ? gate.txtScale : 1.0, gate ? gate.imgScale : 1.0,
                             0, numLayers);
  var maskBlocks = gateMaskBlocks(msg.gateMaskBand);
  pipeline.krea2SetGateMask(gateMaskTensor(msg.gateMask), maskBlocks[0], maskBlocks[1]);
  pipeline.krea2CaptureGates(!!msg.captureGates);
}

function runGeneration(msg, onDone) {
  syncLoraScales(msg.loraScales);
  applyGateState(msg);

  var ps = primeState(msg);
  var state = ps.state, taps = ps.taps;

  var dial = dialFor(msg);
  while (!state.done) {
    if (dial) applyDialDelta(dial, state.krea2StepTimestep());
    state.stepOnce();
  }
  if (dial) pipeline.krea2SetModDelta(null, DIAL_BLOCKS[0], DIAL_BLOCKS[1]);

  var gates = msg.captureGates ? pipeline.krea2Gates() : null;
  var img = state.decode({});
  onDone(img, gates, taps, ps.stack);
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
    runGeneration(Object.assign({}, msg, { opts: opts }), function (img, gates, taps, stack) {
      var extra = {};
      if (gates) extra.gates = gates;
      if (taps && taps.neutral) extra.exprNeutral = taps.neutral;
      if (taps && taps.note) extra.spectrumNote = taps.note;
      if (taps && taps.referenceNote) extra.referenceNote = taps.referenceNote;
      if (stack) extra.stack = stack;   // {norm, budget, clamped, scale}
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
// reference loop does.
//
// `maskData` must already be resized to the state's own (latentHeight,
// latentWidth) grid — the main thread owns that resize.
function handleSpatialRender(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    if (!msg.base) throw new Error('spatialRender: missing base message');
    var t0 = now();

    var baseMsg = Object.assign({}, msg.base, {
      opts: Object.assign({}, msg.base.opts || {},
                          { negativePrompt: msg.base.negPrompt || '' }),
      captureGates: false,
    });
    var altControls = Object.assign({}, baseMsg.axisControls || {});
    altControls[msg.axisName] = (+altControls[msg.axisName] || 0) + (+msg.alpha || 0);
    var altMsg = Object.assign({}, baseMsg, { axisControls: altControls });

    syncLoraScales(baseMsg.loraScales);
    applyGateState(baseMsg);

    var stateBase = primeState(baseMsg).state;
    var stateAlt  = primeState(altMsg).state;

    var H = stateBase.latentHeight, W = stateBase.latentWidth;
    var mask = msg.maskData;
    if (!mask || mask.length !== H * W) {
      throw new Error('spatialRender: maskData must have length latentHeight*latentWidth (' +
                      H + 'x' + W + ')');
    }

    var dial = dialFor(baseMsg);
    while (!stateBase.done) {
      if (dial) applyDialDelta(dial, stateBase.krea2StepTimestep());
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
    if (dial) pipeline.krea2SetModDelta(null, DIAL_BLOCKS[0], DIAL_BLOCKS[1]);

    var img = stateBase.decode({});
    respondImage('spatialDone', img, Math.round(now() - t0));
  } catch (e) {
    fail('spatialRender', e);
  }
}

// ── axis minting ─────────────────────────────────────────────────────────
function handleMintTextAxis(msg) {
  mintTextAxis(pipeline, dictAxes, discoveredAxes, msg, fail);
}

function handleMintImageAxis(msg) {
  mintImageAxis(pipeline, dictAxes, discoveredAxes, msg, fail);
}

function handleRegisterAxis(msg) {
  registerAxis(pipeline, dictAxes, discoveredAxes, msg, fail);
}

// ── the reference picture ────────────────────────────────────────────────
// One encode when the picture is picked; every later generate merges a share
// of the cached taps for free, so dragging the share slider costs no re-encode
// (the vision tower is ~350 ms — a quarter of a frame). The main thread owns
// the pixels and re-sends after a model or text-encoder load, since the cache
// dies with the encoder that produced it.
function handleSetReference(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    if (!msg.pixels || !msg.H || !msg.W) throw new Error('setReference: missing pixels/H/W');
    var taps = pipeline.krea2EncodeImagePrompt(msg.pixels, msg.H, msg.W);
    var tokens = 0;
    for (var t = 0; t < taps.mask.rows; t++) if (taps.mask.data[t] !== 0) tokens++;
    setReferenceRef({ taps: taps, tokens: tokens });
    self.postMessage({ type: 'referenceSet', tokens: tokens });
  } catch (e) {
    setReferenceRef(null);
    fail('setReference', e);
  }
}

function handleClearReference() {
  setReferenceRef(null);
  self.postMessage({ type: 'referenceCleared' });
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
    case 'reloadTextEncoder': handleReloadTextEncoder(msg); break;
    case 'generate':       handleGenerate(msg); break;
    case 'spatialRender':  handleSpatialRender(msg); break;
    case 'mintTextAxis':   handleMintTextAxis(msg); break;
    case 'mintImageAxis':  handleMintImageAxis(msg); break;
    case 'registerAxis':   handleRegisterAxis(msg); break;
    case 'setReference':   handleSetReference(msg); break;
    case 'clearReference': handleClearReference(); break;
    case 'removeControl':  handleRemoveControl(msg); break;
    case 'applyLora':      handleApplyLora(msg); break;
    case 'setLoras':       handleSetLoras(msg); break;
    default: fail('dispatch', new Error('unknown message: ' + msg.type));
  }
};

self.postMessage({ type: 'ready' });
