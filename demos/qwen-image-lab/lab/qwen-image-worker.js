// Qwen-Image Lab worker — owns the native Qwen-Image 2.1 pipeline and every
// control surface qwen-image-research (D:/projects/qwen-image-research) mapped,
// routed through brodiffusion's qwenImage21* research hooks (see
// bro/docs/diffusion-control-api.js section 7).
//
// The model: a 7.1B single-stream flow-matching DiT, hidden 4096, 32 blocks,
// conditioned on Qwen3-VL-8B hidden-state rows, decoded by a 16x RGBA
// autoencoder (latents unpatched — one DiT token per 16x16 px). No CFG:
// guidanceScale 1.0 is the reference recipe, so there is one branch and no
// negative prompt. 40 steps is the reference default; the research desk is
// calibrated at 512^2 / 8.
//
// What each surface is worth, measured (FINDINGS.md / _ROUND2 / _ROUND3):
//
//   conditioning axes  the only surface with real authority — the best minted
//                      text axis moves its readout 25 sigma where the best
//                      in-network dial manages 4.4. Applied to every token row
//                      at prime() time, so they must be set BEFORE priming.
//   control schedule   the same axes with a PER-STEP alpha, which is the one
//                      thing they could not do until the binding landed.
//   prefix slots       the extracted prefix IS the conditioning from step 1
//                      onwards; saving one and blending towards it is a prompt
//                      crossfade below the text encoder entirely.
//   gate scale rows    trim, not steering — except gate.attn.img, the one dial
//                      that still works armed at step 6 of 8 (127% retention).
//   gate mask          the only per-pixel hook. 95% of its pixel change lands
//                      inside a region covering 28% of the frame, and
//                      localisation IMPROVES the later it is armed.
//   mod delta          a fraction of the model's own modulation vector; 97% of
//                      its authority is spent by step 2, but a knob armed late
//                      is a DIFFERENT knob, not a weaker one.
//   gate delta         post-tanh, so it has unit authority on channels a mod
//                      delta cannot move (74% of gate2 sits where tanh' < 0.05).
//   prefix K/V         free mid-denoise and survives a re-extract.
//
// The file is the protocol and the model's lifecycle; the machinery lives
// beside it:
//
//   worker-desk.js         the .bcd1 header and the research desk's port
//   worker-conditioned.js  round 3's prompt block — the desk re-aimed per prompt
//   worker-hooks.js        hook tensors, lane curves, x-hat-0, latent blending
//   worker-mint.js         minting an axis from words or from pictures
//   worker-render.js       the one prime/stepOnce loop that carries all of it
//
// Message protocol:
//   main -> load        {modelDir, quantizeWeights, dictPath, controllerPath,
//                        minted:[{name, scale, dir}]}
//        <- loaded      {config, axes:[{name,scale}], hiddenSize, numLayers,
//                        backend, textEncoderResident, controller, minted:[],
//                        prefixSlots, ms}
//   main -> unload      {}                      <- unloaded {}
//   main -> releaseTextEncoder {}               <- textEncoder {resident, memo}
//   main -> reloadTextEncoder  {modelDir, quantizeWeights}
//                                               <- textEncoder {resident, memo}
//   main -> generate    {prompt, opts, axes, budget, desk, conditioned,
//                        gateRows, gateDelta, gateMask, mod, normOut, prefixKv,
//                        conditionImages, captureGates, schedule, lanes,
//                        regions, x0, prefix}
//        <- done        {bitmap, width, height, ms, msPerStep, steps, textRows,
//                        imgLen, stack, gates?, x0?, slots, vram}
//   main -> mintText    {name, stems, pos, neg}   <- minted {name, scale, dir, ...}
//   main -> mintImage   {name, prompt, imagesA, imagesB}   <- minted {...}
//   main -> dropAxis    {name}                    <- axisDropped {name}
//   main -> savePrefix  {slot, prompt, opts, ...} <- prefixSaved {slot, slots}
//   main -> clearPrefix {}                        <- prefixSaved {slots}
//   main -> conditionDesk {prompt, on}            <- deskConditioned {controller, p, drift}
//   errors come back as <- error {stage, message}

import { readBankHeader, makeDesk, deskInfo } from '/app/lab/worker-desk.js';
import { conditionOn, faderDrift } from '/app/lab/worker-conditioned.js';
import { mintText, mintImage, registerAxis } from '/app/lab/worker-mint.js';
import { renderOnce, savePrefix } from '/app/lab/worker-render.js';
import { conditionEntries } from '/app/lab/worker-hooks.js';

var pipeline = null;      // native Pipeline handle
var hiddenSize = 0;
var numLayers = 0;
var bankAxes = [];        // [{name, scale}] from the .bcd1 header
var ctl = null;           // the loaded controller.json, as a desk
var condFaders = null;    // the prompt-conditioned fader set, when one is on
var condPrompt = null;
var minted = {};          // { name: {dir, scale} } — this session's own axes

function fail(stage, err) {
  self.postMessage({
    type: 'error',
    stage: stage,
    message: (err && err.message) ? err.message : String(err),
  });
}
function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}
function env() {
  return { pipe: pipeline, hiddenSize: hiddenSize, numLayers: numLayers,
           ctl: ctl, faders: condFaders, minted: minted };
}

// ── load ───────────────────────────────────────────────────────────────────
function handleLoad(msg) {
  try {
    if (typeof bro === 'undefined' || !bro.diffusion) {
      throw new Error('bro.diffusion is not available in this build');
    }
    var t0 = now();
    // Free the old model's VRAM BEFORE building the new one — 17 GiB twice
    // does not fit a 24 GB card.
    if (pipeline) {
      try { if (pipeline.dispose) pipeline.dispose(); } catch (e) { /* ignore */ }
      pipeline = null;
    }
    // INT8 DiT + INT8 text encoder is ~17 GiB resident. BF16 does not fit
    // 1024^2 on 24 GB, so quantize unless the caller explicitly says not to.
    var quantize = msg.quantizeWeights !== false;
    var loaded = bro.diffusion.loadModel(msg.modelDir, { quantizeWeights: quantize });
    // loadModel returns { cancelled: true } when the process is shutting down
    // mid-load; there is no window left to answer.
    if (!loaded || loaded.cancelled) { pipeline = null; return; }
    pipeline = loaded;
    var cfg = pipeline.config();
    if (cfg.modelClass !== 'QwenImage21') {
      throw new Error('expected a Qwen-Image 2.1 model, got ' + cfg.modelClass);
    }
    hiddenSize = pipeline.qwenImage21HiddenSize();
    numLayers = pipeline.qwenImage21NumLayers();

    bankAxes = [];
    if (msg.dictPath) {
      var hdr = readBankHeader(msg.dictPath);
      var dim = pipeline.qwenImage21TextHiddenDim();
      if (hdr.dim !== dim) {
        throw new Error('bank dim ' + hdr.dim + ' does not match the encoder width ' + dim);
      }
      pipeline.loadControlDictionary(msg.dictPath);
      pipeline.setControlBudget(0);
      bankAxes = hdr.axes;
    }

    ctl = null;
    condFaders = null;
    condPrompt = null;
    if (msg.controllerPath) {
      var json = JSON.parse(require('fs').readFileSync(msg.controllerPath, 'utf8'));
      ctl = makeDesk(json);
    }

    // A minted axis survives a reload because the direction does: the bank is
    // reloaded from disk (which drops every runtime axis) and each saved one is
    // registered again on top.
    minted = {};
    var mintedOut = [];
    (msg.minted || []).forEach(function (m) {
      try {
        var f = registerAxis(pipeline, m.name, m.dir, m.scale);
        minted[m.name] = { dir: f, scale: +m.scale || 1 };
        mintedOut.push({ name: m.name, scale: +m.scale || 1 });
      } catch (e) { /* a saved axis of the wrong width is dropped, not fatal */ }
    });

    var tensor = (typeof bro !== 'undefined' && bro.tensor) ? bro.tensor : null;
    self.postMessage({
      type: 'loaded',
      config: cfg,
      axes: bankAxes,
      hiddenSize: hiddenSize,
      numLayers: numLayers,
      backend: tensor && tensor.available ? (tensor.backend || 'gpu') : 'cpu',
      textEncoderResident: teResident(),
      controller: ctl ? deskInfo(ctl) : null,
      minted: mintedOut,
      prefixSlots: prefixSlots(),
      ms: Math.round(now() - t0),
      vram: vramInfo(),
    });
  } catch (e) {
    pipeline = null;
    fail('load', e);
  }
}

function teResident() {
  try { return !!pipeline.qwenImage21TextEncoderResident(); }
  catch (e) { return true; }
}
function memoized() {
  try { return pipeline.qwenImage21MemoizedPrompts(); }
  catch (e) { return []; }
}
function prefixSlots() {
  try {
    var n = pipeline.qwenImage21PrefixSlots(), out = [];
    for (var i = 0; i < n; i++) out.push(!!pipeline.qwenImage21PrefixSlotValid(i));
    return out;
  } catch (e) { return []; }
}
function vramInfo() {
  try {
    var m = (typeof bro !== 'undefined' && bro.gpu && bro.gpu.memoryInfo) ? bro.gpu.memoryInfo() : null;
    if (!m || !m.totalBytes) return null;
    return { usedBytes: m.totalBytes - m.freeBytes, totalBytes: m.totalBytes };
  } catch (e) { return null; }
}

function handleUnload() {
  try {
    if (pipeline) {
      try { if (pipeline.dispose) pipeline.dispose(); } catch (e) { /* ignore */ }
    }
    pipeline = null;
    self.postMessage({ type: 'unloaded', vram: vramInfo() });
  } catch (e) {
    fail('unload', e);
  }
}

// The 8.5 GiB Qwen3-VL-8B backbone is idle from prime() onwards. Releasing it
// is what buys a bigger canvas on a 24 GB card; a prompt already in the 8-entry
// memo still primes, an unseen one throws until the encoder is reloaded.
function handleReleaseTextEncoder() {
  try {
    if (!pipeline) throw new Error('no model loaded');
    pipeline.qwenImage21ReleaseTextEncoder();
    self.postMessage({ type: 'textEncoder', resident: teResident(), memo: memoized(),
                       vram: vramInfo() });
  } catch (e) {
    fail('releaseTextEncoder', e);
  }
}
function handleReloadTextEncoder(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    pipeline.qwenImage21ReloadTextEncoder(msg.modelDir, msg.textEncoderPath || '',
                                          { quantizeWeights: msg.quantizeWeights !== false });
    self.postMessage({ type: 'textEncoder', resident: teResident(), memo: memoized(),
                       vram: vramInfo() });
  } catch (e) {
    fail('reloadTextEncoder', e);
  }
}

// ── the prompt-conditioned desk ────────────────────────────────────────────
// One encode and one matrix product re-derive the fader directions for THIS
// prompt. It is idempotent per prompt, so generate() can ask for it on every
// render and pay for it only when the words changed.
function ensureConditioned(prompt, want) {
  if (!ctl || !ctl.j.prompt) { condFaders = null; condPrompt = null; return null; }
  if (!want) { condFaders = null; condPrompt = null; return null; }
  if (condPrompt === prompt && condFaders) return null;
  var rows = pipeline.qwenImage21EncodePrompt(prompt).embeds;
  var out = conditionOn(ctl, rows);
  condFaders = out.faders;
  condPrompt = prompt;
  return out;
}

function handleConditionDesk(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    if (!ctl) throw new Error('no controller.json loaded');
    if (!ctl.j.prompt) throw new Error('this desk has no prompt block — it is round 1 or 2');
    var out = msg.on === false ? null : (ensureConditioned(msg.prompt, true) ||
                                         { p: [], faders: condFaders });
    if (msg.on === false) { condFaders = null; condPrompt = null; }
    self.postMessage({
      type: 'deskConditioned',
      on: msg.on !== false,
      prompt: msg.prompt,
      p: out ? out.p : null,
      controller: deskInfo(ctl, condFaders),
      drift: condFaders ? faderDrift(ctl.j.virtual, condFaders) : null,
    });
  } catch (e) {
    fail('conditionDesk', e);
  }
}

// ── generate ───────────────────────────────────────────────────────────────
function handleGenerate(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    var t0 = now();
    var images = conditionEntries(msg.conditionImages);

    // A released text encoder still primes a prompt the 8-entry memo has seen;
    // anything else throws, so say so before spending the prime.
    if (!teResident()) {
      if (images.length) {
        throw new Error('the text encoder is released — condition images need the ' +
                        'vision tower. Reload it in the model panel.');
      }
      if (memoized().indexOf(msg.prompt) < 0) {
        throw new Error('the text encoder is released and this prompt is not in the ' +
                        'memo — reload the encoder, or render a memoized prompt.');
      }
      if (msg.conditioned) {
        throw new Error('the conditioned desk needs one encode of this prompt — ' +
                        'reload the text encoder.');
      }
    }
    if (ctl && ctl.j.prompt) ensureConditioned(msg.prompt, !!msg.conditioned);
    else condFaders = null;

    var r = renderOnce(env(), msg);
    respondFrames('done', r.img, r.x0, Math.round(now() - t0), {
      msPerStep: Math.round(r.msPerStep),
      steps: r.steps,
      stack: r.applied.stack,
      axes: r.applied.names,
      textRows: r.geo.prefix,
      imgLen: r.geo.imgLen,
      gates: r.gates,
      schedules: r.schedules,
      variants: r.variants,
      slots: prefixSlots(),
      conditioned: !!condFaders,
      vram: vramInfo(),
    });
  } catch (e) {
    try { if (pipeline) pipeline.qwenImage21CaptureGates(false); } catch (e2) { /* ignore */ }
    fail('generate', e);
  }
}

// ── minting ────────────────────────────────────────────────────────────────
function handleMint(msg, kind) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    if (!msg.name) throw new Error('a minted axis needs a name');
    var t0 = now();
    var progress = function (done, total, label) {
      self.postMessage({ type: 'progress', done: done, total: total, label: label });
    };
    var out = kind === 'image' ? mintImage(pipeline, msg, progress)
                               : mintText(pipeline, msg, progress);
    minted[out.name] = { dir: out.dir, scale: out.scale };
    self.postMessage({
      type: 'minted', name: out.name, scale: out.scale, dim: out.dim,
      kind: out.kind, samples: out.samples,
      consistency: out.consistency, consistencyRaw: out.consistencyRaw,
      rawNorm: out.rawNorm, sink: out.sink, components: out.components,
      dir: out.dir, ms: Math.round(now() - t0),
    });
  } catch (e) {
    fail('mint', e);
  }
}

function handleDropAxis(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    pipeline.removeControl(msg.name);
    delete minted[msg.name];
    self.postMessage({ type: 'axisDropped', name: msg.name });
  } catch (e) {
    fail('dropAxis', e);
  }
}

// ── prefix slots ───────────────────────────────────────────────────────────
function handleSavePrefix(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    var t0 = now();
    var out = savePrefix(env(), msg);
    self.postMessage({ type: 'prefixSaved', slot: out.slot, prefixRows: out.prefixRows,
                       imgLen: out.imgLen, prompt: msg.prompt,
                       width: out.width, height: out.height,
                       slots: prefixSlots(), ms: Math.round(now() - t0) });
  } catch (e) {
    fail('savePrefix', e);
  }
}
function handleClearPrefix() {
  try {
    if (!pipeline) throw new Error('no model loaded');
    pipeline.qwenImage21ClearPrefixSlots();
    self.postMessage({ type: 'prefixSaved', slot: -1, slots: prefixSlots() });
  } catch (e) {
    fail('clearPrefix', e);
  }
}

// ── replies ────────────────────────────────────────────────────────────────
// One postMessage carrying the render plus however many x-hat-0 previews the
// timeline asked for, every bitmap transferred rather than copied.
function respondFrames(type, img, x0, ms, extra) {
  var pending = [{ img: img }].concat(x0 || []);
  var bitmaps = [];
  var chain = Promise.resolve();
  pending.forEach(function (p) {
    chain = chain.then(function () {
      return createImageBitmap(new ImageData(p.img.data, p.img.width, p.img.height))
        .then(function (b) { bitmaps.push({ bitmap: b, step: p.step, w: p.img.width, h: p.img.height }); });
    });
  });
  chain.then(function () {
    var head = bitmaps[0];
    var out = { type: type, bitmap: head.bitmap, width: head.w, height: head.h, ms: ms };
    if (extra) for (var k in extra) out[k] = extra[k];
    var transfer = [head.bitmap];
    if (bitmaps.length > 1) {
      out.x0 = bitmaps.slice(1).map(function (b) {
        transfer.push(b.bitmap);
        return { step: b.step, bitmap: b.bitmap, width: b.w, height: b.h };
      });
    }
    self.postMessage(out, transfer);
  }).catch(function (e) { fail(type, e); });
}

self.onmessage = function (e) {
  var msg = e.data || {};
  switch (msg.type) {
    case 'load':                handleLoad(msg); break;
    case 'unload':              handleUnload(); break;
    case 'releaseTextEncoder':  handleReleaseTextEncoder(); break;
    case 'reloadTextEncoder':   handleReloadTextEncoder(msg); break;
    case 'generate':            handleGenerate(msg); break;
    case 'mintText':            handleMint(msg, 'text'); break;
    case 'mintImage':           handleMint(msg, 'image'); break;
    case 'dropAxis':            handleDropAxis(msg); break;
    case 'savePrefix':          handleSavePrefix(msg); break;
    case 'clearPrefix':         handleClearPrefix(); break;
    case 'conditionDesk':       handleConditionDesk(msg); break;
    default: fail('dispatch', new Error('unknown message: ' + msg.type));
  }
};

self.postMessage({ type: 'ready' });
