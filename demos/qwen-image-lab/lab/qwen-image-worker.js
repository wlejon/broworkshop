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
// Two binding rules shape the loop below. Block ranges are HALF-OPEN
// [lo, hi). And prefix-side edits (a 'prefix'/'both' delta, a txt gate
// multiplier, any gate mask, edited text rows) only apply on the step that
// EXTRACTS the prefix K/V cache — the binding drops the live cache when one is
// armed or cleared, costing one prefill (+13% on that step). Pure image-side
// dials cost nothing, which is why the gate panel splits txt from img.
//
// Message protocol:
//   main -> load        {modelDir, quantizeWeights, dictPath, controllerPath}
//        <- loaded      {config, axes:[{name,scale}], hiddenSize, numLayers,
//                        backend, textEncoderResident, controller, ms}
//   main -> unload      {}                      <- unloaded {}
//   main -> releaseTextEncoder {}               <- textEncoder {resident, memo}
//   main -> reloadTextEncoder  {modelDir, quantizeWeights}
//                                               <- textEncoder {resident, memo}
//   main -> generate    {prompt, opts, axes, budget, desk, gateRows, gateDelta,
//                        gateMask, mod, normOut, prefixKv, conditionImages,
//                        captureGates}
//        <- done        {bitmap, width, height, ms, msPerStep, steps, textRows,
//                        imgLen, stack, gates?, vram}
//   errors come back as <- error {stage, message}
//
// Everything runs through ONE manual prime/stepOnce loop: the mod delta has to
// be rebuilt against qwenImage21TimeMod(t) every step, the desk re-issues its
// scheduled knobs per step, and the gate mask arms at its own step.

var pipeline = null;      // native Pipeline handle
var hiddenSize = 0;
var numLayers = 0;
var bankAxes = [];        // [{name, scale}] from the .bcd1 header
var ctl = null;           // the loaded controller.json, as a desk

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

// ── the .bcd1 bank header ──────────────────────────────────────────────────
// "BCD1" | i32 n | i32 dim | per axis: i32 name_len | name | f32 scale | dim f32.
// Only the names and scales are read here — the directions are the engine's
// business (loadControlDictionary reads the same file), and skipping them keeps
// this to a few kilobytes of work instead of 1.4 MB of float copying.
function readBankHeader(path) {
  var raw = require('fs').readFileSync(path);
  var u8 = (raw instanceof ArrayBuffer) ? new Uint8Array(raw)
         : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8[0] !== 66 || u8[1] !== 67 || u8[2] !== 68 || u8[3] !== 49) {
    throw new Error(path + ': not a BCD1 bank');
  }
  var n = dv.getInt32(4, true), dim = dv.getInt32(8, true);
  var out = [], o = 12;
  for (var k = 0; k < n; k++) {
    var ln = dv.getInt32(o, true); o += 4;
    var s = '';
    for (var i = 0; i < ln; i++) s += String.fromCharCode(u8[o + i]);
    o += ln;
    var scale = dv.getFloat32(o, true); o += 4;
    o += 4 * dim;                       // skip the direction
    out.push({ name: s, scale: scale });
  }
  return { axes: out, dim: dim };
}

// ── the desk ───────────────────────────────────────────────────────────────
// A port of qwen-image-research/lib/{controller,sched,dials,hooks}.js, cut down
// to what a UI needs: fader positions -> the scheduled parameter vector p ->
// the normalised dial vector at step i -> hook specs.
//
// A fader value of 1.0 means "move this axis by tau * gainCal[fader] sigmas of
// its own readout and leave the other target axes alone". gainCal is the safe
// box re-drawn BY RENDER: the largest amplitude whose +/-2 renders still hold
// their subject. Travel is not monotone in amplitude past that edge — pushing
// harder swaps the picture rather than moving the axis.
//
// The prompt-CONDITIONED path (round 3's `prompt` block, an 8 x 4099 projection
// and a p-indexed Jacobian) is deliberately not ported here: the global
// `virtual` desk is what a file carries for every prompt, and the conditioned
// re-derivation needs an encode plus a pseudo-inverse per prompt change.
function makeDesk(json) {
  var lay = json.schedule
    ? { names: json.schedule.names, index: json.schedule.index,
        sched: json.schedule.sched, nd: json.dials.length, np: json.schedule.np }
    : { names: json.dialNames.slice(), index: json.dialNames.map(function (_, i) { return i; }),
        sched: json.dialNames.map(function () { return 1; }),
        nd: json.dials.length, np: json.dialNames.length };
  return { j: json, lay: lay };
}

// early(u) = max(0, 1-2u), mid(u) = 1-|2u-1|, late(u) = max(0, 2u-1).
// A partition of unity, which is why a static (round-1) desk is exactly the
// scheduled desk whose three coefficients are equal.
function basisAt(u) {
  return [Math.max(0, 1 - 2 * u), 1 - Math.abs(2 * u - 1), Math.max(0, 2 * u - 1)];
}

// Fader positions -> the flat scheduled parameter vector, clamped to the box.
function paramVector(desk, values) {
  var j = desk.j, lay = desk.lay;
  var gc = j.gainCal;
  var gOf = function (n) {
    return (gc === undefined || gc === null) ? 1
         : (typeof gc === 'number') ? gc
         : (gc[n] === undefined ? 1 : gc[n]);
  };
  var p = new Float64Array(lay.np);
  var vs = j.virtual || [];
  for (var k = 0; k < vs.length; k++) {
    var vd = vs[k];
    var a = +(values[vd.name] || 0);
    if (!a) continue;
    a = Math.max(-2, Math.min(2, a)) * gOf(vd.name);
    for (var i = 0; i < p.length; i++) p[i] += a * vd.v[i];
  }
  for (var q = 0; q < p.length; q++) p[q] = Math.max(-1, Math.min(1, p[q]));
  return p;
}

// The step-count / resolution correction for a render that is not the one the
// desk was fitted at. Round 3 measured 1024^2/8 keeping 98% of the fitting
// configuration's travel and 512^2/40 keeping 70%, and found no correction that
// recovers it — so the shipped file has stepGamma 0 and this is the identity.
function transferVector(desk, values, gen) {
  var p = paramVector(desk, values);
  var T = desk.j.transfer;
  if (!T || !gen) return p;
  var n = gen.steps || T.fitSteps || 8;
  var gs = Math.pow((T.fitSteps || 8) / n, T.stepGamma || 0);
  var gr = (T.resGain && T.resGain[(gen.width || 512) + 'x' + (gen.height || 512)]) || 1;
  if (gs === 1 && gr === 1) return p;
  var lay = desk.lay, out = Float64Array.from(p);
  for (var q = 0; q < lay.nd; q++) {
    var g = (desk.j.dials[q].kind === 'axis' ? 1 : gs) * gr;
    if (g === 1) continue;
    for (var b = 0; b < lay.sched[q]; b++) out[lay.index[q] + b] *= g;
  }
  return out;
}

function dialsAt(lay, p, i, n) {
  var B = basisAt(n > 1 ? i / (n - 1) : 0);
  var d = new Float64Array(lay.nd);
  for (var q = 0; q < lay.nd; q++) {
    var o = lay.index[q];
    if (lay.sched[q] === 1) d[q] = p[o] || 0;
    else d[q] = (p[o] || 0) * B[0] + (p[o + 1] || 0) * B[1] + (p[o + 2] || 0) * B[2];
  }
  return d;
}

// Bounds may be ASYMMETRIC: every one-sided knob on this model is one-sided the
// same way — attenuating something the network produced is safe, amplifying it
// is out of distribution.
function boundOf(k, s) {
  if (s >= 0) return k.boundPos === undefined ? k.bound : k.boundPos;
  return k.boundNeg === undefined ? k.bound : k.boundNeg;
}

// The normalised dial vector -> a plan the binding can hold. Mod deltas are
// grouped by (lo, hi, target) — the multi-slot API lets several coexist, and
// deltas covering the same block sum.
function planFor(dials, d) {
  var plan = { mods: {}, gate: null, prefixkv: null, normout: 0, axes: [] };
  for (var i = 0; i < dials.length; i++) {
    var k = dials[i], u = d[i] || 0;
    var v = u * boundOf(k, u);
    if (!v) continue;
    if (k.kind === 'mod') {
      var tgt = k.target || 'target';
      var key = k.lo + ',' + k.hi + ',' + tgt;
      if (!plan.mods[key]) plan.mods[key] = { lo: k.lo, hi: k.hi, target: tgt, fracs: [0, 0, 0, 0] };
      plan.mods[key].fracs[k.chunk] += v;
    } else if (k.kind === 'gate') {
      if (!plan.gate) plan.gate = { lo: k.lo, hi: k.hi, attn: 1, mlp: 1, txt: 1, img: 1 };
      // `which` picks the sublayer and `side` the row set; both are separate
      // multipliers on the same call, so one dial multiplies two of the four.
      plan.gate[k.which] *= 1 + v;
      plan.gate[k.side] *= 1 + v;
    } else if (k.kind === 'pkv') {
      if (!plan.prefixkv) plan.prefixkv = { lo: k.lo, hi: k.hi, k: 1, v: 1 };
      plan.prefixkv[k.mode] *= 1 + v;
    } else if (k.kind === 'normout') {
      plan.normout += v;
    } else if (k.kind === 'axis') {
      plan.axes.push([k.axis, v]);
    }
  }
  return plan;
}

// The (1, 4H) modulation delta for this step, as a FRACTION of that chunk's own
// value: chunk norms run 21 (gate1) to 189 (gate2), so an absolute add would
// mean four different things in four places. The delta lands BEFORE the tanh.
function modDeltaFor(timestep, fracs, target) {
  var m = pipeline.qwenImage21TimeMod(timestep);
  var src = (target === 'prefix') ? m.modPrefix : m.modTarget;
  var H = hiddenSize;
  var d = { rows: 1, cols: 4 * H, data: new Float32Array(4 * H) };
  var any = false;
  for (var c = 0; c < 4; c++) {
    var f = fracs[c] || 0;
    if (!f) continue;
    any = true;
    for (var i = c * H; i < (c + 1) * H; i++) d.data[i] = f * src.data[i];
  }
  return any ? d : null;
}

function clearHooks() {
  pipeline.qwenImage21ClearModDeltas();
  pipeline.qwenImage21ClearGateScales();
  pipeline.qwenImage21ClearGateDeltas();
  pipeline.qwenImage21ClearGateMasks();
  pipeline.qwenImage21ClearPrefixKvScales();
  pipeline.qwenImage21ClearControlSchedules();
  pipeline.qwenImage21SetNormOutScaleDelta(null);
  pipeline.clearControl();
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
    if (msg.controllerPath) {
      var json = JSON.parse(require('fs').readFileSync(msg.controllerPath, 'utf8'));
      ctl = makeDesk(json);
    }

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
      ms: Math.round(now() - t0),
      vram: vramInfo(),
    });
  } catch (e) {
    pipeline = null;
    fail('load', e);
  }
}

// What the UI needs to draw the desk: the fader names in panel order, what a
// slider of 1.0 is worth on each (tau * gainCal, which the file carries as
// tauEffective), and which knobs each fader actually spends.
function deskInfo(desk) {
  var j = desk.j, lay = desk.lay;
  var faders = (j.virtual || []).map(function (v) {
    // The three knobs this fader leans on hardest, by |coefficient|, named by
    // the knob rather than by its schedule slot.
    var byKnob = {};
    for (var q = 0; q < lay.nd; q++) {
      var s = 0;
      for (var b = 0; b < lay.sched[q]; b++) s += Math.abs(v.v[lay.index[q] + b] || 0);
      byKnob[j.dials[q].name] = s / lay.sched[q];
    }
    var top = Object.keys(byKnob).sort(function (a, b) { return byKnob[b] - byKnob[a]; })
                    .slice(0, 3)
                    .filter(function (n) { return byKnob[n] > 1e-4; });
    return {
      name: v.name, feat: v.feat, sign: v.sign, clipped: !!v.clipped,
      gain: (j.gainCal && typeof j.gainCal === 'object' && j.gainCal[v.name] !== undefined)
            ? j.gainCal[v.name] : (typeof j.gainCal === 'number' ? j.gainCal : 1),
      tau: (j.tauEffective && j.tauEffective[v.name] !== undefined)
           ? j.tauEffective[v.name] : (j.tau || 0),
      knobs: top,
    };
  });
  return {
    version: j.version || 1, model: j.model || 'ridge', bank: j.bank || null,
    scheduled: !!j.schedule, conditioned: !!j.prompt,
    fitSteps: (j.transfer && j.transfer.fitSteps) || 8,
    knobs: j.dials.map(function (d) { return d.name; }),
    faders: faders,
  };
}

function teResident() {
  try { return !!pipeline.qwenImage21TextEncoderResident(); }
  catch (e) { return true; }
}
function memoized() {
  try { return pipeline.qwenImage21MemoizedPrompts(); }
  catch (e) { return []; }
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

// ── generate ───────────────────────────────────────────────────────────────

// The axis stack: the desk's axis knobs and the user's bank sliders push the
// same directions, so they SUM. Applied before prime() — a setControl after the
// prompt is encoded steers nothing at all.
function applyAxes(userAxes, deskAxes, budget) {
  pipeline.clearControl();
  pipeline.setControlBudget(+budget || 0);
  var active = {}, any = false;
  var k;
  for (k in (userAxes || {})) {
    if (!userAxes.hasOwnProperty(k)) continue;
    var a = +userAxes[k];
    if (a) { active[k] = (active[k] || 0) + a; any = true; }
  }
  for (var i = 0; i < (deskAxes || []).length; i++) {
    var nm = deskAxes[i][0], v = +deskAxes[i][1];
    if (v) { active[nm] = (active[nm] || 0) + v; any = true; }
  }
  if (any) pipeline.setControl(active);
  return { stack: pipeline.controlNorm(), names: Object.keys(active) };
}

// The joint-sequence geometry of a primed state, read off the LIVE state
// rather than assumed: the prefix length is whatever this prompt (and its
// condition images) tokenized to, and the packed latent is (imgLen, 64), so
// its row count is the image-token count — including on a derived canvas,
// where nothing on this side knows the render size until decode().
var LATENT_CHANNELS = 64;
function geometryOf(st) {
  var prefix = pipeline.qwenImage21TextRows(false).rows;
  var lat = st.latent();
  var imgLen = lat.length / LATENT_CHANNELS;
  if (!Number.isInteger(imgLen)) {
    throw new Error('latent length ' + lat.length + ' is not a multiple of ' +
                    LATENT_CHANNELS + ' channels');
  }
  return { prefix: prefix, imgLen: imgLen, L: prefix + imgLen };
}

// A wp*hp grid of per-token multipliers -> the joint-order tensor the binding
// wants: prefix rows first (left at 1 — this brush is a spatial argument),
// then the image tokens row-major.
function maskTensor(geo, cells) {
  var data = new Float32Array(geo.L);
  for (var i = 0; i < geo.prefix; i++) data[i] = 1;
  for (var k = 0; k < geo.imgLen; k++) {
    var v = cells[k];
    data[geo.prefix + k] = (v === undefined || v === null) ? 1 : v;
  }
  return { rows: 1, cols: geo.L, data: data };
}

// The four independent post-tanh gate multipliers, composed from the desk's
// rank-1 (attn, mlp) x (txt, img) plan and the user's four rows. Bindings
// multiply per (sublayer, row set), so the two are armed as separate slots and
// only re-issued when their key moves — re-issuing a txt-side factor for the
// same numbers would pay for a prefix re-extract and buy nothing.
function gateKeyOf(deskGate, rows) {
  var g = deskGate || { attn: 1, mlp: 1, txt: 1, img: 1, lo: 0, hi: 0 };
  var r = rows || { attnTxt: 1, attnImg: 1, mlpTxt: 1, mlpImg: 1, lo: 0, hi: 0 };
  return [g.attn, g.mlp, g.txt, g.img, g.lo, g.hi,
          r.attnTxt, r.attnImg, r.mlpTxt, r.mlpImg, r.lo, r.hi].join(',');
}
function armGates(deskGate, rows) {
  pipeline.qwenImage21ClearGateScales();
  if (deskGate && deskGate.hi > deskGate.lo) {
    pipeline.qwenImage21AddGateScale(deskGate.attn, deskGate.mlp, deskGate.txt,
                                     deskGate.img, deskGate.lo, deskGate.hi);
  }
  if (rows && rows.hi > rows.lo &&
      (rows.attnTxt !== 1 || rows.attnImg !== 1 || rows.mlpTxt !== 1 || rows.mlpImg !== 1)) {
    pipeline.qwenImage21AddGateScaleRows(rows.attnTxt, rows.attnImg, rows.mlpTxt,
                                         rows.mlpImg, rows.lo, rows.hi);
  }
}

// [attn | mlp] halves of a (1, 2H) post-tanh gate delta.
function gateDeltaTensor(g) {
  if (!g || (!g.attn && !g.mlp)) return null;
  var H = hiddenSize;
  var d = { rows: 1, cols: 2 * H, data: new Float32Array(2 * H) };
  if (g.attn) d.data.fill(g.attn, 0, H);
  if (g.mlp) d.data.fill(g.mlp, H, 2 * H);
  return d;
}

function normOutTensor(v) {
  if (!v) return null;
  var d = { rows: 1, cols: hiddenSize, data: new Float32Array(hiddenSize) };
  d.data.fill(v);
  return d;
}

// Condition-image entries: a path string, or {pixels, width, height, channels}
// with planar CHW floats in [0,1] — the shapes GenerateOptions.conditionImages
// takes. The UI sends whichever it has.
function conditionEntries(list) {
  var out = [];
  for (var i = 0; i < (list || []).length; i++) {
    var c = list[i];
    if (!c) continue;
    if (typeof c === 'string') out.push(c);
    else if (c.path) out.push({ path: c.path });
    else if (c.pixels) {
      out.push({ pixels: c.pixels, width: c.width, height: c.height,
                 channels: c.channels || 3 });
    }
  }
  return out;
}

function handleGenerate(msg) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    var t0 = now();
    var opts = Object.assign({}, msg.opts || {});
    var steps = Math.max(1, +opts.steps || 8);
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
    }

    clearHooks();

    // ── the desk, and the axis stack ────────────────────────────────────
    var deskValues = msg.desk || {};
    var p = null, dials = null;
    if (ctl && Object.keys(deskValues).length) {
      p = transferVector(ctl, deskValues, { steps: steps, width: opts.width, height: opts.height });
      dials = ctl.j.dials;
    }
    // Axis knobs are conditioning-side: read them off step 0's dial vector
    // (u = 0 there under either schedule definition) and apply once, before
    // priming.
    var deskAxes = [];
    if (p) deskAxes = planFor(dials, dialsAt(ctl.lay, p, 0, steps)).axes;
    var applied = applyAxes(msg.axes, deskAxes, msg.budget);

    // ── static, target-side hooks: armed once, cheap ────────────────────
    var gd = gateDeltaTensor(msg.gateDelta);
    if (gd) {
      pipeline.qwenImage21AddGateDelta(gd, msg.gateDelta.lo | 0, msg.gateDelta.hi | 0,
                                       msg.gateDelta.target || 'target');
    }
    // The prefix-KV dial is applied where the cached K/V are READ, so it is
    // free, may be armed before step 0, and survives every re-extract.
    var pk = msg.prefixKv;
    if (pk && (pk.k !== 1 || pk.v !== 1) && pk.hi > pk.lo) {
      pipeline.qwenImage21AddPrefixKvScale(pk.lo, pk.hi, pk.k, pk.v, null);
    }
    if (msg.captureGates) pipeline.qwenImage21CaptureGates(true);

    // ── prime ────────────────────────────────────────────────────────────
    var st = images.length
      ? pipeline.qwenImage21PrimeEdit(msg.prompt, images, opts)
      : pipeline.prime(msg.prompt, opts);

    // With condition images and no explicit size the canvas is derived from the
    // last image's aspect at outputResolution, so the render's true dimensions
    // are whatever decode() reports — nothing here assumes opts.width/height.
    var geo = geometryOf(st);
    var maskT = null;
    var mask = msg.gateMask;
    if (mask && mask.cells && mask.wp && mask.hp) {
      if (mask.wp * mask.hp !== geo.imgLen) {
        throw new Error('the painted mask is ' + mask.wp + 'x' + mask.hp + ' (' +
                        (mask.wp * mask.hp) + ' tokens) but this render\'s grid holds ' +
                        geo.imgLen + ' — re-capture in the Gate Paint tab');
      }
      maskT = maskTensor(geo, mask.cells);
    }

    // ── the step loop ────────────────────────────────────────────────────
    var lastGateKey = null, lastNorm = null;
    var userRows = msg.gateRows || null;
    var userMod = (msg.mod && msg.mod.fracs && msg.mod.fracs.some(function (f) { return !!f; }))
                  ? msg.mod : null;
    var tSteps = now();
    var maskArmed = false;
    // A brush armed past the last step would silently do nothing; hold it at
    // the final step instead, which is also the direction localisation likes.
    var maskAt = mask ? Math.min(Math.max(0, mask.at | 0), steps - 1) : 0;
    for (var i = 0; i < steps; i++) {
      var t = st.qwenImage21StepTimestep();
      var plan = p ? planFor(dials, dialsAt(ctl.lay, p, i, steps))
                   : { mods: {}, gate: null, prefixkv: null, normout: 0, axes: [] };

      // modulation deltas — rebuilt every step against the model's own vector
      pipeline.qwenImage21ClearModDeltas();
      var groups = {};
      for (var key in plan.mods) {
        if (plan.mods.hasOwnProperty(key)) groups[key] = plan.mods[key];
      }
      if (userMod) {
        var uk = userMod.lo + ',' + userMod.hi + ',' + (userMod.target || 'target');
        if (!groups[uk]) {
          groups[uk] = { lo: userMod.lo, hi: userMod.hi, target: userMod.target || 'target',
                         fracs: [0, 0, 0, 0] };
        }
        for (var c = 0; c < 4; c++) groups[uk].fracs[c] += +userMod.fracs[c] || 0;
      }
      for (var gk in groups) {
        if (!groups.hasOwnProperty(gk)) continue;
        var g = groups[gk];
        var del = modDeltaFor(t, g.fracs, g.target);
        if (del) pipeline.qwenImage21AddModDelta(del, g.lo, g.hi, g.target);
      }

      // gate scales — re-issued only when the composite key moves
      var gkey = gateKeyOf(plan.gate, userRows);
      if (gkey !== lastGateKey) { armGates(plan.gate, userRows); lastGateKey = gkey; }

      // the desk's prefix-KV contribution is a dial like the user's
      if (plan.prefixkv && i === 0) {
        pipeline.qwenImage21AddPrefixKvScale(plan.prefixkv.lo, plan.prefixkv.hi,
                                             plan.prefixkv.k, plan.prefixkv.v, null);
      }

      var nv = (plan.normout || 0) + (+msg.normOut || 0);
      if (nv !== lastNorm) { pipeline.qwenImage21SetNormOutScaleDelta(normOutTensor(nv)); lastNorm = nv; }

      // the brush, armed at its own step and left armed — the image half of a
      // mask is free mid-denoise and localises BETTER the later it lands
      if (maskT && !maskArmed && i >= maskAt) {
        pipeline.qwenImage21AddGateMask(maskT, mask.lo | 0, mask.hi === undefined ? numLayers : mask.hi,
                                        mask.which || 'both');
        maskArmed = true;
      }

      st.stepOnce();
    }
    var msPerStep = (now() - tSteps) / steps;

    var gates = null;
    if (msg.captureGates) {
      // The full capture is numLayers x (prefix + imgLen); the UI only needs the
      // per-layer mean effective gate, so reduce here rather than on the wire.
      var raw = pipeline.qwenImage21Gates();
      var perLayer = [];
      for (var r = 0; r < raw.rows; r++) {
        var s = 0;
        for (var cc = 0; cc < raw.cols; cc++) s += raw.data[r * raw.cols + cc];
        perLayer.push(s / raw.cols);
      }
      gates = { layers: perLayer, cols: raw.cols };
      pipeline.qwenImage21CaptureGates(false);
    }

    var img = st.decode({});
    clearHooks();

    respondImage('done', img, Math.round(now() - t0), {
      msPerStep: Math.round(msPerStep),
      steps: steps,
      stack: applied.stack,
      axes: applied.names,
      textRows: geo.prefix,
      imgLen: geo.imgLen,
      gates: gates,
      vram: vramInfo(),
    });
  } catch (e) {
    try { if (pipeline) clearHooks(); } catch (e2) { /* ignore */ }
    fail('generate', e);
  }
}

function respondImage(type, img, ms, extra) {
  var data = new ImageData(img.data, img.width, img.height);
  createImageBitmap(data).then(function (bitmap) {
    var out = { type: type, bitmap: bitmap, width: img.width, height: img.height, ms: ms };
    if (extra) for (var k in extra) out[k] = extra[k];
    self.postMessage(out, [bitmap]);
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
    default: fail('dispatch', new Error('unknown message: ' + msg.type));
  }
};

self.postMessage({ type: 'ready' });
