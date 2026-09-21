// The prompt-conditioned desk — round 3's `prompt` block of controller.json,
// ported from qwen-image-research/lib/{pfeat,controller,linalg}.js.
//
// Round 2's conclusion was that a fader's per-image inconsistency is a
// shortfall of AUTHORITY and of scene knowledge, not a mis-scaling: no
// per-image gain fixes it, because the forward model has no scene input and
// structurally cannot know which picture it is standing in front of. Round 3's
// answer is to give it one. The whole of it is computed from the thing the
// pipeline already has before it steps — the prompt's own conditioning rows:
//
//   pool(rows)  ->  [ mean-pooled hidden state (4096) ; nRows ;
//                     mean row norm ; std of row norms ]        (4099-d)
//   p = M * that + c                                            (8-d)
//   J(p) = W0 + Σ p_j W_j                                       (nFeat x np)
//   virtual = regularised right pseudo-inverse of the target rows of J
//
// So the faders are a function of the prompt, in one encode and one matrix
// product — no render, no calibration pass, nothing for the caller to do. The
// global `virtual` block the file also carries is what a desk means for every
// prompt at once; this is what it means for THIS one.
//
// The inverse is the same one 64_fit3.js derives the global desk with, so a
// conditioned fader and a global fader differ only in the Jacobian they were
// built from — which is the point of porting it rather than approximating it.

// Gauss-Jordan with partial pivoting: A (n x n), B (n x m) -> A^-1 B.
function solve(A, B, n, m) {
  var a = Float64Array.from(A), b = Float64Array.from(B);
  for (var c = 0; c < n; c++) {
    var piv = c, best = Math.abs(a[c * n + c]);
    for (var r = c + 1; r < n; r++) {
      var v = Math.abs(a[r * n + c]);
      if (v > best) { best = v; piv = r; }
    }
    if (best < 1e-12) throw new Error('singular matrix at column ' + c);
    if (piv !== c) {
      for (var k = 0; k < n; k++) { var t = a[c * n + k]; a[c * n + k] = a[piv * n + k]; a[piv * n + k] = t; }
      for (var k2 = 0; k2 < m; k2++) { var t2 = b[c * m + k2]; b[c * m + k2] = b[piv * m + k2]; b[piv * m + k2] = t2; }
    }
    var d = a[c * n + c];
    for (var k3 = 0; k3 < n; k3++) a[c * n + k3] /= d;
    for (var k4 = 0; k4 < m; k4++) b[c * m + k4] /= d;
    for (var r2 = 0; r2 < n; r2++) {
      if (r2 === c) continue;
      var f = a[r2 * n + c];
      if (!f) continue;
      for (var k5 = 0; k5 < n; k5++) a[r2 * n + k5] -= f * a[c * n + k5];
      for (var k6 = 0; k6 < m; k6++) b[r2 * m + k6] -= f * b[c * m + k6];
    }
  }
  return b;
}

// A^T (A A^T + lambda*tr/t * I)^-1 — the minimum-norm right inverse, ridged
// relative to the Gram matrix's own trace so `lambda` means the same thing
// whatever scale the readouts happen to be in.
function pinvRight(A, t, d, lambda) {
  var G = new Float64Array(t * t);
  for (var i = 0; i < t; i++) {
    for (var j = 0; j < t; j++) {
      var s = 0;
      for (var k = 0; k < d; k++) s += A[i * d + k] * A[j * d + k];
      G[i * t + j] = s;
    }
  }
  var tr = 0;
  for (var q = 0; q < t; q++) tr += G[q * t + q];
  var lam = lambda * (tr / t || 1);
  for (var q2 = 0; q2 < t; q2++) G[q2 * t + q2] += lam;
  var eye = new Float64Array(t * t);
  for (var q3 = 0; q3 < t; q3++) eye[q3 * t + q3] = 1;
  var Gi = solve(G, eye, t, t);
  var V = new Float64Array(d * t);
  for (var kk = 0; kk < d; kk++) {
    for (var jj = 0; jj < t; jj++) {
      var acc = 0;
      for (var ii = 0; ii < t; ii++) acc += A[ii * d + kk] * Gi[ii * t + jj];
      V[kk * t + jj] = acc;
    }
  }
  return V;
}

// lib/pfeat.js pool(): the 4099-d scene feature, computed the one way both the
// dataset script and the runtime use. A prompt feature computed two different
// ways is a silent train/serve skew whose symptom is a fader that verifies and
// then misbehaves.
export function poolRows(e) {
  var D = e.cols;
  var o = new Float64Array(D + 3);
  var sn = 0, sn2 = 0;
  for (var r = 0; r < e.rows; r++) {
    var q = 0;
    for (var c = 0; c < D; c++) {
      var v = e.data[r * e.cols + c];
      o[c] += v / e.rows;
      q += v * v;
    }
    var n = Math.sqrt(q);
    sn += n; sn2 += n * n;
  }
  var m = sn / e.rows;
  o[D] = e.rows;
  o[D + 1] = m;
  o[D + 2] = Math.sqrt(Math.max(sn2 / e.rows - m * m, 0));
  return o;
}

export function projectP(spec, x) {
  var k = spec.c.length;
  var o = new Float64Array(k);
  for (var i = 0; i < k; i++) {
    var Mi = spec.M[i];
    var s = spec.c[i];
    for (var d = 0; d < Mi.length; d++) s += Mi[d] * x[d];
    o[i] = s;
  }
  return o;
}

// J(p) = W[0] + Σ p_j W[j], as nFeat rows of np.
function jacAt(json, lay, p) {
  var W = json.prompt.W, nf = json.featNames.length, np = lay.np;
  var J = [];
  for (var k = 0; k < nf; k++) {
    var r = new Float64Array(np);
    for (var q = 0; q < np; q++) {
      var v = W[0][k * np + q];
      for (var j = 0; j < p.length; j++) v += p[j] * W[j + 1][k * np + q];
      r[q] = v;
    }
    J.push(r);
  }
  return J;
}

function dialsFrom(json, lay, J) {
  var PB = json.prompt, FN = json.featNames, np = lay.np;
  var T = PB.targets.length;
  var A = new Float64Array(T * np);
  for (var i = 0; i < T; i++) {
    var k = FN.indexOf(PB.targets[i].feat), sg = PB.targets[i].sign;
    for (var q = 0; q < np; q++) A[i * np + q] = sg * J[k][q];
  }
  var V = pinvRight(A, T, np, PB.lambda);
  var out = [];
  for (var j = 0; j < T; j++) {
    var v = new Float64Array(np);
    for (var q2 = 0; q2 < np; q2++) v[q2] = V[q2 * T + j];
    var fi = FN.indexOf(PB.targets[j].feat);
    var gain = 0;
    for (var q3 = 0; q3 < np; q3++) gain += A[j * np + q3] * v[q3];
    gain *= json.featScale[fi];
    var scale = gain !== 0 ? PB.tau / gain : 0;
    var peak = 0;
    for (var q4 = 0; q4 < np; q4++) { v[q4] *= scale; peak = Math.max(peak, Math.abs(v[q4])); }
    var clipped = false;
    // The same box the global fit is held in: no single parameter may reach
    // its bound at slider +/-2, or the fader stops being linear where the UI
    // says it still is.
    if (2 * peak > 1) {
      var sc = 1 / (2 * peak);
      for (var q5 = 0; q5 < np; q5++) v[q5] *= sc;
      clipped = true;
    }
    out.push({ name: PB.targets[j].name, feat: PB.targets[j].feat,
               sign: PB.targets[j].sign, v: v, clipped: clipped });
  }
  return out;
}

// One encode's rows -> the fader set for that prompt. `rows` is whatever
// qwenImage21EncodePrompt(prompt).embeds returned (or, once the text encoder
// has been released, rows already in hand — pooling is all this needs).
export function conditionOn(desk, rows) {
  var j = desk.j;
  if (!j.prompt) return null;
  var p = projectP(j.prompt, poolRows(rows));
  var J = jacAt(j, desk.lay, p);
  return { p: Array.from(p), faders: dialsFrom(j, desk.lay, J) };
}

// How far the conditioned fader set has moved from the global one, per fader:
// the cosine of the two parameter directions and the ratio of their lengths.
// This is what the panel prints — "the desk re-aimed by this much for this
// prompt" — and is the only honest way to see a conditioned desk work without
// a render.
export function faderDrift(globalFaders, condFaders) {
  var byName = {};
  globalFaders.forEach(function (g) { byName[g.name] = g.v; });
  return condFaders.map(function (c) {
    var g = byName[c.name];
    if (!g) return { name: c.name, cos: 0, ratio: 0 };
    var dot = 0, na = 0, nb = 0;
    for (var i = 0; i < c.v.length; i++) {
      var a = c.v[i], b = g[i];
      dot += a * b; na += a * a; nb += b * b;
    }
    na = Math.sqrt(na); nb = Math.sqrt(nb);
    return { name: c.name, cos: (na && nb) ? dot / (na * nb) : 0,
             ratio: nb ? na / nb : 0, clipped: !!c.clipped };
  });
}
