// The render core: one manual prime/stepOnce loop carrying every control
// surface at once.
//
// It has to be a manual loop. The modulation delta is a FRACTION of the
// model's own vector and has to be rebuilt against qwenImage21TimeMod(t) every
// step; the desk re-issues its scheduled knobs per step; the schedule editor's
// lane curves re-aim the other hooks per step; each painted region arms at its
// own step; the x-hat-0 preview reads the latent either side of a step; and a
// spatial region carrying its own axes needs a second state stepped in
// lockstep with the first.
//
// Hooks are re-issued only when their value actually MOVED. Calling
// SetGateScale with the same numbers twice would pay for a prefix re-extract
// and buy nothing.

import {
  geometryOf, maskTensor, modDeltaFor, gateDeltaTensor, normOutTensor,
  gateKeyOf, armGates, clearHooks, conditionEntries, curveAt, scaledFrom,
  armSchedules, xhat0, blendLatents, featherMask,
} from '/app/lab/worker-hooks.js';
import { transferVector, dialsAt, planFor, EMPTY_PLAN } from '/app/lab/worker-desk.js';

// The axis stack: the desk's axis knobs and the user's bank sliders push the
// same directions, so they SUM. Applied before prime() — a setControl after the
// prompt is encoded steers nothing at all.
function applyAxes(pipe, userAxes, deskAxes, budget, extra) {
  pipe.clearControl();
  pipe.setControlBudget(+budget || 0);
  var active = {}, any = false, k;
  for (k in (userAxes || {})) {
    if (!userAxes.hasOwnProperty(k)) continue;
    var a = +userAxes[k];
    if (a) { active[k] = (active[k] || 0) + a; any = true; }
  }
  for (var i = 0; i < (deskAxes || []).length; i++) {
    var nm = deskAxes[i][0], v = +deskAxes[i][1];
    if (v) { active[nm] = (active[nm] || 0) + v; any = true; }
  }
  for (k in (extra || {})) {
    if (!extra.hasOwnProperty(k)) continue;
    var e = +extra[k];
    if (e) { active[k] = (active[k] || 0) + e; any = true; }
  }
  if (any) pipe.setControl(active);
  return { stack: pipe.controlNorm(), names: Object.keys(active) };
}

function primeWith(pipe, msg, opts, images) {
  return images.length ? pipe.qwenImage21PrimeEdit(msg.prompt, images, opts)
                       : pipe.prime(msg.prompt, opts);
}

// A region's per-latent-cell blend weight, feathered so a painted edge fades
// into the base instead of stamping a rectangle of a different picture into
// it. `coverage` is the paint itself (0..1); `cells` is the gate multiplier
// the same stroke carries, and either may be absent.
function regionWeights(r, geo) {
  var w = new Float32Array(geo.imgLen);
  for (var i = 0; i < geo.imgLen; i++) {
    w[i] = r.coverage ? Math.max(0, Math.min(1, +r.coverage[i] || 0)) : 0;
  }
  return featherMask(w, r.wp, r.hp, r.feather === undefined ? 1 : r.feather | 0);
}
function regionGrid(r, geo) {
  if (r.wp * r.hp !== geo.imgLen) {
    throw new Error('region "' + (r.name || '?') + '" is ' + r.wp + 'x' + r.hp + ' (' +
                    (r.wp * r.hp) + ' tokens) but this render\'s grid holds ' + geo.imgLen +
                    ' — re-capture it');
  }
}

// ── the render ─────────────────────────────────────────────────────────────
// `env` is { pipe, hiddenSize, numLayers, ctl, faders, minted }: the live
// pipeline plus the desk in force (global or prompt-conditioned) and the
// runtime axes this session minted.
export function renderOnce(env, msg, onStep) {
  var pipe = env.pipe, H = env.hiddenSize, ctl = env.ctl;
  var opts = Object.assign({}, msg.opts || {});
  var steps = Math.max(1, +opts.steps || 8);
  var images = conditionEntries(msg.conditionImages);
  var lanes = msg.lanes || {};

  clearHooks(pipe);

  // ── the desk ─────────────────────────────────────────────────────────────
  // With a fader lane armed the parameter vector is rebuilt per step, because
  // the lane scales the FADER and not the knob: a fader is a direction through
  // the knob space and scaling it late is not the same instruction as scaling
  // one knob late.
  var deskValues = msg.desk || {};
  var deskOn = !!(ctl && Object.keys(deskValues).length);
  var deskLanes = lanes.desk || null;
  var gen = { steps: steps, width: opts.width, height: opts.height };
  function deskParamAt(i) {
    if (!deskOn) return null;
    if (!deskLanes) return null;
    var v = {};
    for (var k in deskValues) {
      if (!deskValues.hasOwnProperty(k)) continue;
      v[k] = deskValues[k] * (deskLanes[k] ? curveAt(deskLanes[k], i, steps) : 1);
    }
    return transferVector(ctl, v, gen, env.faders);
  }
  var pStatic = deskOn && !deskLanes ? transferVector(ctl, deskValues, gen, env.faders) : null;
  var dials = deskOn ? ctl.j.dials : null;
  function planAt(i) {
    if (!deskOn) return EMPTY_PLAN;
    var p = pStatic || deskParamAt(i);
    return planFor(dials, dialsAt(ctl.lay, p, i, steps));
  }

  // ── the axis stack ───────────────────────────────────────────────────────
  // A scheduled axis is taken OUT of the prime-time stack: a control schedule
  // COMPOSES with whatever setControl() asked for, so leaving it in both would
  // count the flat part of its curve twice.
  var scheduled = {};
  (msg.schedule || []).forEach(function (s) { if (s && s.axis) scheduled[s.axis] = true; });
  var userAxes = {};
  for (var an in (msg.axes || {})) {
    if (msg.axes.hasOwnProperty(an) && !scheduled[an]) userAxes[an] = msg.axes[an];
  }
  var deskAxes = planAt(0).axes.filter(function (a) { return !scheduled[a[0]]; });
  var applied = applyAxes(pipe, userAxes, deskAxes, msg.budget);

  // ── static, target-side hooks ────────────────────────────────────────────
  var gdLane = lanes.gateDelta || null;
  var gd = msg.gateDelta || null;
  if (gd && !gdLane) {
    var t0d = gateDeltaTensor(H, gd);
    if (t0d) pipe.qwenImage21AddGateDelta(t0d, gd.lo | 0, gd.hi | 0, gd.target || 'target');
  }
  // The prefix-KV dial is applied where the cached K/V are READ, so it is
  // free, may be armed before step 0, and survives every re-extract.
  var pkLane = lanes.prefixKv || null;
  var pk = msg.prefixKv;
  if (pk && !pkLane && (pk.k !== 1 || pk.v !== 1) && pk.hi > pk.lo) {
    pipe.qwenImage21AddPrefixKvScale(pk.lo, pk.hi, pk.k, pk.v, null);
  }
  if (msg.captureGates) pipe.qwenImage21CaptureGates(true);
  var nSched = armSchedules(pipe, msg.schedule, steps, env.minted);

  // ── prime ────────────────────────────────────────────────────────────────
  var st = primeWith(pipe, msg, opts, images);
  var geo = geometryOf(pipe, st);

  // The painted brush and every spatial region address the same grid.
  var masks = [];
  var mask = msg.gateMask;
  if (mask && mask.cells && mask.wp && mask.hp) {
    if (mask.wp * mask.hp !== geo.imgLen) {
      throw new Error('the painted mask is ' + mask.wp + 'x' + mask.hp + ' (' +
                      (mask.wp * mask.hp) + ' tokens) but this render\'s grid holds ' +
                      geo.imgLen + ' — re-capture in the Gate Paint tab');
    }
    masks.push({ tensor: maskTensor(geo, mask.cells), lo: mask.lo | 0,
                 hi: mask.hi === undefined ? env.numLayers : mask.hi,
                 which: mask.which || 'both',
                 at: Math.min(Math.max(0, mask.at | 0), steps - 1), armed: false });
  }
  // ── spatial regions ──────────────────────────────────────────────────────
  // Each region carries two things a stroke can mean. Its gate multipliers are
  // a mask, armed at the region's own step — the model's only per-token hook,
  // and free on the image half. Its axes are conditioning, which is global by
  // construction: one axis is added to every token row, so "this axis, but
  // only here" cannot be one render. That half is composited — a second state
  // primed from the same seed, stepped in lockstep, blended back under the
  // region weight after every step, so the join happens inside the denoiser
  // rather than between two finished pictures.
  var variants = [];
  (msg.regions || []).forEach(function (r) {
    if (!r || !r.wp || !r.hp) return;
    regionGrid(r, geo);
    if (r.cells) {
      var any = false;
      for (var i = 0; i < r.cells.length; i++) if (r.cells[i] !== 1) { any = true; break; }
      if (any) {
        masks.push({ tensor: maskTensor(geo, r.cells), lo: r.lo | 0,
                     hi: r.hi === undefined ? env.numLayers : r.hi,
                     which: r.which || 'attn',
                     at: Math.min(Math.max(0, r.at | 0), steps - 1), armed: false });
      }
    }
    if (!r.axes || !Object.keys(r.axes).length) return;
    var w = regionWeights(r, geo);
    var sum = 0;
    for (var k = 0; k < w.length; k++) sum += w[k];
    if (!sum) return;
    applyAxes(pipe, userAxes, deskAxes, msg.budget, r.axes);
    var sv = primeWith(pipe, msg, opts, images);
    variants.push({ state: sv, w: w, name: r.name || 'region' });
  });
  if (variants.length) applyAxes(pipe, userAxes, deskAxes, msg.budget);

  // ── the step loop ────────────────────────────────────────────────────────
  var sigmas = null;
  var x0Want = {};
  if (msg.x0 && msg.x0.steps && msg.x0.steps.length) {
    try { sigmas = pipe.sigmas(); } catch (e) { sigmas = null; }
    msg.x0.steps.forEach(function (s) {
      var i = s | 0;
      if (i >= 0 && i < steps) x0Want[i] = true;
    });
  }
  var x0Frames = [];

  var lastGateKey = null, lastNorm = null, lastGd = null, lastPk = null;
  var userRows = msg.gateRows || null;
  var userMod = (msg.mod && msg.mod.fracs && msg.mod.fracs.some(function (f) { return !!f; }))
                ? msg.mod : null;
  var blends = (msg.prefix && msg.prefix.blend) || null;
  var blended = false;
  var tSteps = (typeof performance !== 'undefined' && performance.now)
               ? performance.now() : Date.now();

  for (var i = 0; i < steps; i++) {
    var t = st.qwenImage21StepTimestep();
    var plan = planAt(i);

    // modulation deltas — rebuilt every step against the model's own vector
    pipe.qwenImage21ClearModDeltas();
    var groups = {};
    for (var key in plan.mods) {
      if (plan.mods.hasOwnProperty(key)) groups[key] = plan.mods[key];
    }
    if (userMod) {
      var mc = curveAt(lanes.mod, i, steps);
      var uk = userMod.lo + ',' + userMod.hi + ',' + (userMod.target || 'target');
      if (!groups[uk]) {
        groups[uk] = { lo: userMod.lo, hi: userMod.hi, target: userMod.target || 'target',
                       fracs: [0, 0, 0, 0] };
      }
      for (var c = 0; c < 4; c++) groups[uk].fracs[c] += (+userMod.fracs[c] || 0) * mc;
    }
    for (var gk in groups) {
      if (!groups.hasOwnProperty(gk)) continue;
      var g = groups[gk];
      var del = modDeltaFor(pipe, H, t, g.fracs, g.target);
      if (del) pipe.qwenImage21AddModDelta(del, g.lo, g.hi, g.target);
    }

    // gate scales — re-issued only when the composite key moves
    var rows = userRows;
    if (rows && lanes.gateRows) {
      var rc = curveAt(lanes.gateRows, i, steps);
      rows = { attnTxt: scaledFrom(1, rows.attnTxt, rc), attnImg: scaledFrom(1, rows.attnImg, rc),
               mlpTxt: scaledFrom(1, rows.mlpTxt, rc), mlpImg: scaledFrom(1, rows.mlpImg, rc),
               lo: rows.lo, hi: rows.hi };
    }
    var gkey = gateKeyOf(plan.gate, rows);
    if (gkey !== lastGateKey) { armGates(pipe, plan.gate, rows); lastGateKey = gkey; }

    // the post-tanh gate delta, when a lane re-aims it per step
    if (gd && gdLane) {
      var gc = curveAt(gdLane, i, steps);
      var gkey2 = gc.toFixed(4);
      if (gkey2 !== lastGd) {
        pipe.qwenImage21ClearGateDeltas();
        var td = gateDeltaTensor(H, { attn: gd.attn * gc, mlp: gd.mlp * gc });
        if (td) pipe.qwenImage21AddGateDelta(td, gd.lo | 0, gd.hi | 0, gd.target || 'target');
        lastGd = gkey2;
      }
    }

    // the prefix-KV dial: the desk's contribution, plus the user's lane
    if (plan.prefixkv && i === 0) {
      pipe.qwenImage21AddPrefixKvScale(plan.prefixkv.lo, plan.prefixkv.hi,
                                       plan.prefixkv.k, plan.prefixkv.v, null);
    }
    if (pk && pkLane && pk.hi > pk.lo) {
      var pc = curveAt(pkLane, i, steps);
      var pkey = pc.toFixed(4);
      if (pkey !== lastPk) {
        pipe.qwenImage21ClearPrefixKvScales();
        pipe.qwenImage21AddPrefixKvScale(pk.lo, pk.hi, scaledFrom(1, pk.k, pc),
                                         scaledFrom(1, pk.v, pc), null);
        lastPk = pkey;
      }
    }

    var nv = (plan.normout || 0) + (+msg.normOut || 0) * curveAt(lanes.normOut, i, steps);
    if (nv !== lastNorm) { pipe.qwenImage21SetNormOutScaleDelta(normOutTensor(H, nv)); lastNorm = nv; }

    // the brushes, each armed at its own step and left armed — the image half
    // of a mask is free mid-denoise and localises BETTER the later it lands
    for (var mi = 0; mi < masks.length; mi++) {
      var mk = masks[mi];
      if (mk.armed || i < mk.at) continue;
      pipe.qwenImage21AddGateMask(mk.tensor, mk.lo, mk.hi, mk.which);
      mk.armed = true;
    }

    var before = x0Want[i] && sigmas && sigmas.length > i + 1 ? st.latent() : null;
    st.stepOnce();
    for (var vi = 0; vi < variants.length; vi++) variants[vi].state.stepOnce();

    // The prefix blend takes effect on the very next step and needs the live
    // prefix to have been EXTRACTED, which step 0 is what does.
    if (blends && !blended && i === 0) {
      for (var bi = 0; bi < blends.length; bi++) {
        var b = blends[bi];
        if (+b.alpha > 0) pipe.qwenImage21BlendPrefixCache(b.slot | 0, Math.min(1, +b.alpha));
      }
      blended = true;
    }

    if (variants.length) {
      var base = st.latent();
      for (var v2 = 0; v2 < variants.length; v2++) {
        blendLatents(base, variants[v2].state.latent(), variants[v2].w, geo.imgLen);
      }
      st.setLatent(base);
      // Push the composite back into every variant too, or each one drifts
      // into its own picture and the blended region stops agreeing with what
      // surrounds it.
      for (var v3 = 0; v3 < variants.length; v3++) variants[v3].state.setLatent(base);
    }

    if (before) {
      var peek = st.clone();
      peek.setLatent(xhat0(sigmas, i, before, st.latent()));
      x0Frames.push({ step: i, img: peek.decode({}) });
    }
    if (onStep) onStep(i, steps);
  }
  var now = (typeof performance !== 'undefined' && performance.now)
            ? performance.now() : Date.now();
  var msPerStep = (now - tSteps) / steps;

  // ── capture readback ─────────────────────────────────────────────────────
  var gates = null;
  if (msg.captureGates) {
    // The full capture is numLayers x (prefix + imgLen); the strip only needs
    // the per-layer mean of each half, so reduce here rather than on the wire.
    var attn = pipe.qwenImage21Gates();
    var mlp = pipe.qwenImage21GatesMlp();
    gates = { cols: attn.cols, prefix: geo.prefix, imgLen: geo.imgLen,
              attn: reduceGates(attn, geo), mlp: reduceGates(mlp, geo) };
    pipe.qwenImage21CaptureGates(false);
  }

  if (msg.prefix && msg.prefix.saveSlot != null) {
    pipe.qwenImage21SavePrefixCache(msg.prefix.saveSlot | 0);
  }

  var img = st.decode({});
  clearHooks(pipe);

  return {
    img: img, geo: geo, applied: applied, gates: gates, x0: x0Frames,
    msPerStep: msPerStep, steps: steps, schedules: nSched,
    regions: masks.length, variants: variants.length,
  };
}

// Per layer: the mean over the prefix columns and the mean over the image
// columns, which is what a 32-row strip can actually show. Also the min over
// the image half, because a mask's whole job is to pull SOME rows down and the
// mean hides that.
function reduceGates(raw, geo) {
  var out = [];
  for (var r = 0; r < raw.rows; r++) {
    var o = r * raw.cols, sp = 0, si = 0, lo = Infinity, hi = -Infinity;
    for (var c = 0; c < geo.prefix && c < raw.cols; c++) sp += raw.data[o + c];
    for (var c2 = geo.prefix; c2 < raw.cols; c2++) {
      var v = raw.data[o + c2];
      si += v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    out.push({
      prefix: geo.prefix ? sp / geo.prefix : 0,
      img: geo.imgLen ? si / geo.imgLen : 0,
      imgMin: isFinite(lo) ? lo : 0,
      imgMax: isFinite(hi) ? hi : 0,
    });
  }
  return out;
}

// Prime, take the one step that extracts the prefix K/V, and deep-copy it into
// a slot. The extracted prefix IS the conditioning as far as every step after
// the first is concerned, so a slot is a prompt frozen BELOW the text encoder:
// blending towards it later costs no re-encoding, no vision tower and no
// txt_in — just a lerp over cached K/V that lands on the very next step.
export function savePrefix(env, msg) {
  var pipe = env.pipe;
  var opts = Object.assign({}, msg.opts || {});
  var images = conditionEntries(msg.conditionImages);
  clearHooks(pipe);
  applyAxes(pipe, msg.axes, [], msg.budget);
  var st = primeWith(pipe, msg, opts, images);
  var geo = geometryOf(pipe, st);
  st.stepOnce();
  pipe.qwenImage21SavePrefixCache(msg.slot | 0);
  clearHooks(pipe);
  return { slot: msg.slot | 0, prefixRows: geo.prefix, imgLen: geo.imgLen };
}
