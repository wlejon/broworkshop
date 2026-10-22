// Krea 2 Lab worker — axis minting (text pairs, image pairs) and Gram-span
// decomposition against the named control dictionary and discovered SAE atoms.

// The 6 fixed scenes krea-research's mint_text_axis() averages a text-pair
// diff over (axis_factory.py's SCENES[:6]) — robustifies the direction
// against any one scene's incidental content, and yields a consistency score
// (mean pairwise cosine similarity of the per-scene diffs).
export var SCENES = [
  'a red fox sitting in a snowy forest clearing',
  'a portrait of an elderly fisherman with a weathered face',
  'a busy tokyo street with neon signs',
  'a cozy scandinavian living room interior',
  'a still life of pears and a copper kettle on a wooden table',
  'rolling green hills with a lone oak tree',
];

function fusedFor(pipeline, prompt) {
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

export function unitNormalize(v) {
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
export function bankScale(pipeline, dictAxes, discoveredAxes) {
  var any = dictAxes.length ? dictAxes : discoveredAxes;
  if (!any.length || !pipeline.controlVector) return 1.0;
  return pipeline.controlVector(any[0]).scale;
}

// Explain a freshly minted unit direction against the dictionary's NAMED
// bank: per-axis cosine (the bank directions are unit vectors by the BCD1
// format), plus how much of the direction lies OUTSIDE the bank's span.
// The axes aren't orthogonal, so summing squared cosines would overcount —
// project onto the span properly (solve the Gram system) and report
// residual = |axis - proj| as the honest "genuinely its own" fraction.
//
// The span is the ~26 axes a person put a label on, deliberately. The unnamed
// discovered atoms are reported alongside as plain cosines (the three nearest),
// never folded into the span: 400+ near-dependent directions span so much of a
// 6144-d neighbourhood that every mint came back ~0% new, which is not an
// answer, and the Gram they need is O(n^2 * 6144) — half a billion multiply-adds
// per mint, paid again for every saved axis at load. Cosines are O(n * 6144).
//
// Returns null when the engine build lacks pipeline.controlVector().
export function explainAxis(pipeline, dictAxes, discoveredAxes, axis) {
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
  // Gaussian elimination with partial pivoting. n is the named bank (~26), which
  // is what keeps this trivial — see the note above on why the discovered atoms
  // are not in here.
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

  // The unnamed atoms: cosine only, no solve, no contribution to the residual.
  // "Your axis is 0.61 of the way to sae.4037" is a real thing to know — the mint
  // may have rediscovered an atom — but it is a separate statement from "N% of
  // this is outside everything we have a word for".
  var atoms = [];
  for (var i = 0; i < discoveredAxes.length; i++) {
    var adir = pipeline.controlVector(discoveredAxes[i]).dir;
    if (adir.length !== dim) continue;
    var au = unitNormalize(adir), adot = 0;
    for (var c = 0; c < dim; c++) adot += au[c] * axis[c];
    atoms.push({ name: discoveredAxes[i], cos: adot });
  }
  atoms.sort(function (x, y) { return Math.abs(y.cos) - Math.abs(x.cos); });
  if (atoms.length > 3) atoms.length = 3;

  return { components: components, residual: Math.sqrt(1 - explained), atoms: atoms };
}

// Mint a user axis from a text pair, averaged over SCENES for robustness
// (mirrors krea-research's mint_text_axis). Registers live via
// setControlVector — coexists with the loaded dictionary's 18 core axes.
export function mintTextAxis(pipeline, dictAxes, discoveredAxes, msg, fail) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    var name = (msg.name || '').trim(), pos = (msg.pos || '').trim(), neg = (msg.neg || '').trim();
    if (!name || !pos || !neg) throw new Error('need a name and both descriptions');

    var diffs = [], cols = 0;
    var total = SCENES.length * 2;
    for (var i = 0; i < SCENES.length; i++) {
      mintProgress('scene ' + (i + 1) + '/' + SCENES.length + ' · toward', i * 2, total);
      var mp = meanRows(fusedFor(pipeline, SCENES[i] + ', ' + pos));
      mintProgress('scene ' + (i + 1) + '/' + SCENES.length + ' · away', i * 2 + 1, total);
      var mn = meanRows(fusedFor(pipeline, SCENES[i] + ', ' + neg));
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

    pipeline.setControlVector(name, axis, 0.0, bankScale(pipeline, dictAxes, discoveredAxes));
    var explain = explainAxis(pipeline, dictAxes, discoveredAxes, axis);
    self.postMessage({
      type: 'axisMinted', name: name, consistency: consistency, axis: axis,
      components: explain ? explain.components : null,
      residual: explain ? explain.residual : null,
      atoms: explain ? explain.atoms : null,
    });
  } catch (e) {
    fail('mintTextAxis', e);
  }
}

// Mint a user axis from an image pair (toward minus away), through the same
// vision-tower tap path the reference picture uses (mirrors make_image_axis).
export function mintImageAxis(pipeline, dictAxes, discoveredAxes, msg, fail) {
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

    pipeline.setControlVector(name, axis, 0.0, bankScale(pipeline, dictAxes, discoveredAxes));
    var explain = explainAxis(pipeline, dictAxes, discoveredAxes, axis);
    self.postMessage({
      type: 'axisMinted', name: name, axis: axis,
      components: explain ? explain.components : null,
      residual: explain ? explain.residual : null,
      atoms: explain ? explain.atoms : null,
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
export function registerAxis(pipeline, dictAxes, discoveredAxes, msg, fail) {
  try {
    if (!pipeline) throw new Error('no model loaded');
    var name = (msg.name || '').trim();
    if (!name || !msg.axis || !msg.axis.length) throw new Error('need a name and a direction');
    var axis = (msg.axis instanceof Float32Array) ? msg.axis : new Float32Array(msg.axis);
    pipeline.setControlVector(name, axis, 0.0, bankScale(pipeline, dictAxes, discoveredAxes));
    var explain = explainAxis(pipeline, dictAxes, discoveredAxes, axis);
    self.postMessage({
      type: 'axisRegistered', name: name,
      components: explain ? explain.components : null,
      residual: explain ? explain.residual : null,
      atoms: explain ? explain.atoms : null,
    });
  } catch (e) {
    fail('registerAxis', e);
  }
}
