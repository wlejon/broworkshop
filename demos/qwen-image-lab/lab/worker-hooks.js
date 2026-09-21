// The hook tensors and the per-step arming rules — everything between "the
// UI asked for this" and "the binding is holding it".
//
// Two binding rules shape all of it. Block ranges are HALF-OPEN [lo, hi). And
// prefix-side edits (a 'prefix'/'both' mod delta, a txt gate multiplier, any
// gate mask, edited text rows, a control schedule whose alpha moved) only
// apply on the step that EXTRACTS the prefix K/V cache — the binding drops the
// live cache when one is armed or cleared, costing one prefill (+13% on that
// step). Pure image-side dials cost nothing, which is why the gate panel
// splits txt from img.

export const LATENT_CHANNELS = 64;

// The joint-sequence geometry of a primed state, read off the LIVE state
// rather than assumed: the prefix length is whatever this prompt (and its
// condition images) tokenized to, and the packed latent is (imgLen, 64), so
// its row count is the image-token count — including on a derived canvas,
// where nothing on this side knows the render size until decode().
export function geometryOf(pipe, st) {
  var prefix = pipe.qwenImage21TextRows(false).rows;
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
export function maskTensor(geo, cells) {
  var data = new Float32Array(geo.L);
  for (var i = 0; i < geo.prefix; i++) data[i] = 1;
  for (var k = 0; k < geo.imgLen; k++) {
    var v = cells[k];
    data[geo.prefix + k] = (v === undefined || v === null) ? 1 : v;
  }
  return { rows: 1, cols: geo.L, data: data };
}

// The (1, 4H) modulation delta for this step, as a FRACTION of that chunk's own
// value: chunk norms run 21 (gate1) to 189 (gate2), so an absolute add would
// mean four different things in four places. The delta lands BEFORE the tanh.
export function modDeltaFor(pipe, H, timestep, fracs, target) {
  var m = pipe.qwenImage21TimeMod(timestep);
  var src = (target === 'prefix') ? m.modPrefix : m.modTarget;
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

// [attn | mlp] halves of a (1, 2H) post-tanh gate delta.
export function gateDeltaTensor(H, g) {
  if (!g || (!g.attn && !g.mlp)) return null;
  var d = { rows: 1, cols: 2 * H, data: new Float32Array(2 * H) };
  if (g.attn) d.data.fill(g.attn, 0, H);
  if (g.mlp) d.data.fill(g.mlp, H, 2 * H);
  return d;
}

export function normOutTensor(H, v) {
  if (!v) return null;
  var d = { rows: 1, cols: H, data: new Float32Array(H) };
  d.data.fill(v);
  return d;
}

// The four independent post-tanh gate multipliers, composed from the desk's
// rank-1 (attn, mlp) x (txt, img) plan and the user's four rows. Bindings
// multiply per (sublayer, row set), so the two are armed as separate slots and
// only re-issued when their key moves — re-issuing a txt-side factor for the
// same numbers would pay for a prefix re-extract and buy nothing.
export function gateKeyOf(deskGate, rows) {
  var g = deskGate || { attn: 1, mlp: 1, txt: 1, img: 1, lo: 0, hi: 0 };
  var r = rows || { attnTxt: 1, attnImg: 1, mlpTxt: 1, mlpImg: 1, lo: 0, hi: 0 };
  return [g.attn, g.mlp, g.txt, g.img, g.lo, g.hi,
          r.attnTxt, r.attnImg, r.mlpTxt, r.mlpImg, r.lo, r.hi].join(',');
}

export function armGates(pipe, deskGate, rows) {
  pipe.qwenImage21ClearGateScales();
  if (deskGate && deskGate.hi > deskGate.lo) {
    pipe.qwenImage21AddGateScale(deskGate.attn, deskGate.mlp, deskGate.txt,
                                 deskGate.img, deskGate.lo, deskGate.hi);
  }
  if (rows && rows.hi > rows.lo &&
      (rows.attnTxt !== 1 || rows.attnImg !== 1 || rows.mlpTxt !== 1 || rows.mlpImg !== 1)) {
    pipe.qwenImage21AddGateScaleRows(rows.attnTxt, rows.attnImg, rows.mlpTxt,
                                     rows.mlpImg, rows.lo, rows.hi);
  }
}

export function clearHooks(pipe) {
  pipe.qwenImage21ClearModDeltas();
  pipe.qwenImage21ClearGateScales();
  pipe.qwenImage21ClearGateDeltas();
  pipe.qwenImage21ClearGateMasks();
  pipe.qwenImage21ClearPrefixKvScales();
  pipe.qwenImage21ClearControlSchedules();
  pipe.qwenImage21SetNormOutScaleDelta(null);
  pipe.clearControl();
}

// Condition-image entries: a path string, or {pixels, width, height, channels}
// with planar CHW floats in [0,1] — the shapes GenerateOptions.conditionImages
// takes. The UI sends whichever it has.
export function conditionEntries(list) {
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

// ── the schedule editor's curves ───────────────────────────────────────────
// A lane curve is one coefficient per step, and what it multiplies depends on
// what the control's neutral is: a gate multiplier rides on 1 and a delta on
// 0, so a curve at 0 has to mean "this control is off at this step" in both
// cases. Hence two readings of the same array.
export function curveAt(curve, i, steps) {
  if (!curve || !curve.length) return 1;
  if (curve.length === steps) return +curve[i] || 0;
  // A curve authored at a different step count is resampled, so changing the
  // step count re-times the shape instead of truncating it.
  var u = steps > 1 ? i / (steps - 1) : 0;
  var x = u * (curve.length - 1);
  var a = Math.floor(x), b = Math.min(curve.length - 1, a + 1), f = x - a;
  return (+curve[a] || 0) * (1 - f) + (+curve[b] || 0) * f;
}
export function scaledFrom(neutral, value, c) {
  return neutral + (value - neutral) * c;
}

// ── control schedules ──────────────────────────────────────────────────────
// qwenImage21{Set,Add}ControlSchedule re-applies a conditioning axis with a
// per-step alpha DURING the denoise: at step s the positive rows become
// txt_in(primedEmbeds + Σ_k alpha_k[s] * scale_k * dir_k). It composes with
// whatever setControl() already asked for, which is exactly why an axis that
// carries a curve must be taken OUT of the prime-time stack — otherwise the
// flat part of its curve is counted twice.
//
// A minted axis is registered as a runtime axis and so has a name like any
// other, but the explicit-vector form is the honest spelling for one: the
// direction and its natural unit travel with the schedule rather than being
// looked up, which is what a lab that mints an axis mid-session wants.
export function armSchedules(pipe, list, steps, minted) {
  pipe.qwenImage21ClearControlSchedules();
  var n = 0;
  for (var i = 0; i < (list || []).length; i++) {
    var s = list[i];
    var alpha = new Float32Array(steps);
    var any = false;
    for (var k = 0; k < steps; k++) {
      var v = (+s.value || 0) * curveAt(s.curve, k, steps);
      alpha[k] = v;
      if (v) any = true;
    }
    if (!any) continue;
    var lo = Math.max(0, s.lo | 0);
    var hi = (s.hi === undefined || s.hi === null || s.hi < 0) ? steps : Math.min(steps, s.hi | 0);
    if (hi <= lo) continue;
    var m = minted && minted[s.axis];
    if (m) pipe.qwenImage21AddControlSchedule(m.dir, alpha, lo, hi, m.scale);
    else pipe.qwenImage21AddControlSchedule(s.axis, alpha, lo, hi);
    n++;
  }
  return n;
}

// ── the x-hat-0 preview ────────────────────────────────────────────────────
// The flow-match Euler step is exact, so two consecutive latent snapshots
// recover the model's velocity and with it the clean-image estimate this step
// committed to — for free, with no extra forward pass:
//
//     k = sigma[i] / (sigma[i+1] - sigma[i]),   xhat0 = x_i - k * (x_{i+1} - x_i)
//
// Decoding it says WHEN an edit lands rather than only whether it did.
export function xhat0(sigmas, i, before, after) {
  var s0 = sigmas[i], s1 = sigmas[i + 1];
  var den = s1 - s0;
  if (!den) return Float32Array.from(after);
  var k = s0 / den;
  var out = new Float32Array(before.length);
  for (var j = 0; j < before.length; j++) out[j] = before[j] - k * (after[j] - before[j]);
  return out;
}

// ── per-region latent compositing ──────────────────────────────────────────
// The conditioning axes are global: they are added to every token row, so
// "this axis, but only here" cannot be one render. Two states primed from the
// same seed share their init noise, so stepping them in lockstep and blending
// their latents under the region mask after every step composites the two
// trajectories rather than two finished pictures — no seam, because the blend
// is back in the denoiser before the next step reads it.
//
// The latent is NCHW-flat: index = c * (hLat*wLat) + cell. The mask is one
// weight per latent cell, which is the same grid a gate mask addresses (the
// VAE is 16x and the DiT consumes the latent unpatched).
export function blendLatents(base, variant, mask, cells) {
  var planes = base.length / cells;
  for (var c = 0; c < planes; c++) {
    var off = c * cells;
    for (var k = 0; k < cells; k++) {
      var m = mask[k];
      if (!m) continue;
      var i = off + k;
      base[i] = base[i] * (1 - m) + variant[i] * m;
    }
  }
  return base;
}

// A box blur over the region grid, so a painted edge fades into the base
// instead of stamping a rectangle of a different picture into it.
export function featherMask(cells, wp, hp, radius) {
  var r = Math.max(0, radius | 0);
  if (!r) return Float32Array.from(cells);
  var tmp = new Float32Array(wp * hp), out = new Float32Array(wp * hp);
  for (var y = 0; y < hp; y++) {
    for (var x = 0; x < wp; x++) {
      var s = 0, n = 0;
      for (var dx = -r; dx <= r; dx++) {
        var xx = x + dx;
        if (xx < 0 || xx >= wp) continue;
        s += cells[y * wp + xx]; n++;
      }
      tmp[y * wp + x] = s / n;
    }
  }
  for (var x2 = 0; x2 < wp; x2++) {
    for (var y2 = 0; y2 < hp; y2++) {
      var s2 = 0, n2 = 0;
      for (var dy = -r; dy <= r; dy++) {
        var yy = y2 + dy;
        if (yy < 0 || yy >= hp) continue;
        s2 += tmp[yy * wp + x2]; n2++;
      }
      out[y2 * wp + x2] = s2 / n2;
    }
  }
  return out;
}
