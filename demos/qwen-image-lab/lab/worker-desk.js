// The desk, ported out of qwen-image-research/lib/{controller,sched,dials}.js
// and cut down to what a UI needs: fader positions -> the scheduled parameter
// vector p -> the normalised dial vector at step i -> a plan the bindings can
// hold. Plus the .bcd1 bank header, because both live on the "what did the
// research file say" side of the worker.
//
// A fader value of 1.0 means "move this axis by tau * gainCal[fader] sigmas of
// its own readout and leave the other target axes alone". gainCal is the safe
// box re-drawn BY RENDER: the largest amplitude whose +/-2 renders still hold
// their subject. Travel is not monotone in amplitude past that edge — pushing
// harder swaps the picture rather than moving the axis.
//
// The prompt-CONDITIONED path (round 3's `prompt` block) lives beside this in
// worker-conditioned.js: it re-derives `virtual` from the prompt's own
// conditioning rows, and everything below takes whichever fader set it is
// handed.

// ── the .bcd1 bank header ──────────────────────────────────────────────────
// "BCD1" | i32 n | i32 dim | per axis: i32 name_len | name | f32 scale | dim f32.
// Only the names and scales are read here — the directions are the engine's
// business (loadControlDictionary reads the same file), and skipping them keeps
// this to a few kilobytes of work instead of 1.4 MB of float copying.
export function readBankHeader(path) {
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

export function makeDesk(json) {
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
export function basisAt(u) {
  return [Math.max(0, 1 - 2 * u), 1 - Math.abs(2 * u - 1), Math.max(0, 2 * u - 1)];
}

function gainOf(j, n) {
  var gc = j.gainCal;
  return (gc === undefined || gc === null) ? 1
       : (typeof gc === 'number') ? gc
       : (gc[n] === undefined ? 1 : gc[n]);
}

// Fader positions -> the flat scheduled parameter vector, clamped to the box.
// `faders` is the fader set in force — the file's global `virtual`, or the
// prompt-conditioned re-derivation of it.
export function paramVector(desk, values, faders) {
  var j = desk.j, lay = desk.lay;
  var p = new Float64Array(lay.np);
  var vs = faders || j.virtual || [];
  for (var k = 0; k < vs.length; k++) {
    var vd = vs[k];
    var a = +(values[vd.name] || 0);
    if (!a) continue;
    a = Math.max(-2, Math.min(2, a)) * gainOf(j, vd.name);
    for (var i = 0; i < p.length; i++) p[i] += a * vd.v[i];
  }
  for (var q = 0; q < p.length; q++) p[q] = Math.max(-1, Math.min(1, p[q]));
  return p;
}

// The step-count / resolution correction for a render that is not the one the
// desk was fitted at. Round 3 measured 1024^2/8 keeping 98% of the fitting
// configuration's travel and 512^2/40 keeping 70%, and found no correction that
// recovers it — so the shipped file has stepGamma 0 and this is the identity.
export function transferVector(desk, values, gen, faders) {
  var p = paramVector(desk, values, faders);
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

export function dialsAt(lay, p, i, n) {
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
export function planFor(dials, d) {
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

export const EMPTY_PLAN = { mods: {}, gate: null, prefixkv: null, normout: 0, axes: [] };

// What the UI needs to draw the desk: the fader names in panel order, what a
// slider of 1.0 is worth on each (tau * gainCal, which the file carries as
// tauEffective), and which knobs each fader actually spends.
export function deskInfo(desk, faders) {
  var j = desk.j, lay = desk.lay;
  var vs = faders || j.virtual || [];
  var out = vs.map(function (v) {
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
      gain: gainOf(j, v.name),
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
    faders: out,
  };
}
