// Minting — a conditioning axis built here, in this session, from words or
// from pictures.
//
// The recipe is qwen-image-research's, unchanged, because a direction minted a
// different way is not comparable with the 88 in the bank: 12 neutral scene
// stems x 2 phrasings a pole, the paired pole difference per (stem, phrasing),
// attention-sink dimensions suppressed, mean, unit direction, and a bank scale
// of 0.15 x the mean token norm measured on this run's own encodes
// (scripts/60_mint_v2.js, lib/axesv2.js).
//
// Why the sink suppression is not optional: Qwen3-VL has massive-activation
// dimensions whose magnitude tracks sequence CONTENT, so they do not cancel in
// a paired difference when the two poles tokenize to different lengths. The
// residue dwarfs the real signal — in the v2 mint a handful of dimensions
// carried tens of percent of all axis energy. The rule is the one the script
// uses: a dimension holding more than 50x the uniform share of the pole
// difference energy is a sink and is zeroed before the mean.
//
// A minted axis is registered with setControlVector(), so it is in
// controlAxes() and drives through setControl(), the stack budget and the
// control schedule exactly as a bank axis does. loadControlDictionary() is
// bank-level and would drop it; nothing here calls that.

function pooledRows(e) {
  var D = e.cols;
  var o = new Float64Array(D);
  for (var r = 0; r < e.rows; r++) {
    for (var c = 0; c < D; c++) o[c] += e.data[r * e.cols + c] / e.rows;
  }
  return o;
}

function meanTokenNorm(e) {
  var D = e.cols, acc = 0;
  for (var r = 0; r < e.rows; r++) {
    var q = 0;
    for (var c = 0; c < D; c++) { var v = e.data[r * e.cols + c]; q += v * v; }
    acc += Math.sqrt(q);
  }
  return acc / e.rows;
}

function sub(a, b) {
  var o = new Float64Array(a.length);
  for (var i = 0; i < a.length; i++) o[i] = a[i] - b[i];
  return o;
}

// The dimensions carrying more than `factor` x the uniform share of the
// population's energy — the mint script's rule, with the population being
// every per-(stem, phrasing) pole difference.
function sinkDims(pop, D, factor) {
  var energy = new Float64Array(D), total = 0;
  for (var i = 0; i < pop.length; i++) {
    var d = pop[i];
    for (var c = 0; c < D; c++) { var v = d[c] * d[c]; energy[c] += v; total += v; }
  }
  if (!total) return [];
  var expected = total / D;
  var out = [];
  for (var c2 = 0; c2 < D; c2++) if (energy[c2] > factor * expected) out.push(c2);
  out.sort(function (a, b) { return energy[b] - energy[a]; });
  return out.map(function (c3) {
    return { dim: c3, share: energy[c3] / total, times: energy[c3] / expected };
  });
}

// Mean pairwise cosine of the population — the mint's own bar, answering
// "does this axis mean the same thing in every scene it was measured in"
// before a single pixel is rendered.
function coherence(pop) {
  if (pop.length < 2) return 1;
  var s = 0, n = 0;
  for (var i = 0; i < pop.length; i++) {
    for (var j = i + 1; j < pop.length; j++) {
      var dot = 0, na = 0, nb = 0;
      for (var c = 0; c < pop[i].length; c++) {
        var a = pop[i][c], b = pop[j][c];
        dot += a * b; na += a * a; nb += b * b;
      }
      na = Math.sqrt(na) * Math.sqrt(nb);
      if (na) { s += dot / na; n++; }
    }
  }
  return n ? s / n : 1;
}

// population -> { dir (unit Float32Array), sink, consistency }
function buildAxis(pop, D, sinkFactor) {
  var sink = sinkDims(pop, D, sinkFactor === undefined ? 50 : sinkFactor);
  var clean = pop.map(function (d) {
    var o = Float64Array.from(d);
    for (var i = 0; i < sink.length; i++) o[sink[i].dim] = 0;
    return o;
  });
  var dir = new Float64Array(D);
  for (var k = 0; k < clean.length; k++) {
    for (var c = 0; c < D; c++) dir[c] += clean[k][c] / clean.length;
  }
  var q = 0;
  for (var c2 = 0; c2 < D; c2++) q += dir[c2] * dir[c2];
  var rawNorm = Math.sqrt(q) || 1;
  var unit = new Float32Array(D);
  for (var c3 = 0; c3 < D; c3++) unit[c3] = dir[c3] / rawNorm;
  return { dir: unit, sink: sink, rawNorm: rawNorm,
           consistency: coherence(clean), consistencyRaw: coherence(pop) };
}

// Signed cosine against every axis already registered — bank or runtime. "What
// did the mint actually pick out?" answered against the named vocabulary,
// instead of guessed at from slider sweeps.
function decompose(pipe, dir, limit) {
  var out = [];
  var names;
  try { names = pipe.controlAxes(); } catch (e) { return out; }
  for (var i = 0; i < names.length; i++) {
    var v;
    try { v = pipe.controlVector(names[i]); } catch (e) { continue; }
    var dot = 0, nb = 0;
    for (var c = 0; c < dir.length; c++) { dot += dir[c] * v.dir[c]; nb += v.dir[c] * v.dir[c]; }
    nb = Math.sqrt(nb);
    if (nb) out.push({ name: names[i], cos: dot / nb });
  }
  out.sort(function (a, b) { return Math.abs(b.cos) - Math.abs(a.cos); });
  return out.slice(0, limit || 6);
}

// ── text minting ───────────────────────────────────────────────────────────
// `spec` is { name, stems[], pos[], neg[] }: every stem crossed with every
// phrasing index, one paired difference each. A "prompt + suffix list" mint is
// the same shape with one stem, the bare prompt as the negative pole and each
// suffix as a positive phrasing — which is why there is one implementation.
export function mintText(pipe, spec, progress) {
  var D = pipe.qwenImage21TextHiddenDim();
  var stems = (spec.stems && spec.stems.length) ? spec.stems : [''];
  var pos = spec.pos || [], neg = spec.neg || [];
  if (!pos.length || !neg.length) throw new Error('a mint needs both poles');
  var k = Math.min(pos.length, neg.length);
  var total = stems.length * k * 2;
  var done = 0;
  var pop = [];
  var normAcc = 0, normN = 0;
  for (var si = 0; si < stems.length; si++) {
    for (var pi = 0; pi < k; pi++) {
      var ep = pipe.qwenImage21EncodePrompt(stems[si] + pos[pi]).embeds;
      done++;
      if (progress) progress(done, total, stems[si] + pos[pi]);
      var en = pipe.qwenImage21EncodePrompt(stems[si] + neg[pi]).embeds;
      done++;
      if (progress) progress(done, total, stems[si] + neg[pi]);
      pop.push(sub(pooledRows(ep), pooledRows(en)));
      // The bank scale is re-derived from this run's own encodes rather than
      // copied from a log, exactly as the mint script does it.
      if (normN < 12) { normAcc += meanTokenNorm(ep); normN++; }
      if (normN < 12) { normAcc += meanTokenNorm(en); normN++; }
    }
  }
  var built = buildAxis(pop, D, spec.sinkFactor);
  var scale = 0.15 * (normAcc / Math.max(1, normN));
  return finish(pipe, spec.name, built, scale, D, pop.length, 'text');
}

// ── image minting ──────────────────────────────────────────────────────────
// qwenImage21EncodePromptImages runs the vision tower and hands back the
// PRE-DROP sequence: `imagePadMask` marks which rows the tower filled, so the
// image rows and the text rows of one encode are separable in the same space
// the text axes live in.
//
// With one image set the axis is "what the picture adds to what the words say"
// — the image rows against the text rows of the same prompt. With two it is an
// ordinary diff of means between two sets of pictures, which is the cleaner
// axis when both poles exist as images.
function imageRowsOf(e) {
  var D = e.cols, img = [], txt = new Float64Array(D), nTxt = 0;
  for (var r = 0; r < e.embedsRows; r++) {
    if (e.pad[r]) {
      var row = new Float64Array(D);
      for (var c = 0; c < D; c++) row[c] = e.data[r * D + c];
      img.push(row);
    } else {
      for (var c2 = 0; c2 < D; c2++) txt[c2] += e.data[r * D + c2];
      nTxt++;
    }
  }
  if (nTxt) for (var c3 = 0; c3 < D; c3++) txt[c3] /= nTxt;
  return { img: img, txt: txt, nTxt: nTxt };
}
function encodeWithImages(pipe, prompt, images) {
  var e = pipe.qwenImage21EncodePromptImages(prompt, images);
  return { data: e.embeds.data, cols: e.embeds.cols, embedsRows: e.embeds.rows,
           pad: e.imagePadMask, embeds: e.embeds };
}

export function mintImage(pipe, spec, progress) {
  var D = pipe.qwenImage21TextHiddenDim();
  if (!spec.imagesA || !spec.imagesA.length) throw new Error('a picture is required');
  if (progress) progress(0, spec.imagesB && spec.imagesB.length ? 2 : 1, 'vision tower · A');
  var A = encodeWithImages(pipe, spec.prompt || '', spec.imagesA);
  var ra = imageRowsOf(A);
  if (!ra.img.length) {
    throw new Error('the encode reported no image rows — the vision tower saw nothing');
  }
  var pop = [];
  if (spec.imagesB && spec.imagesB.length) {
    if (progress) progress(1, 2, 'vision tower · B');
    var B = encodeWithImages(pipe, spec.prompt || '', spec.imagesB);
    var rb = imageRowsOf(B);
    if (!rb.img.length) throw new Error('the B encode reported no image rows');
    var ma = new Float64Array(D), mb = new Float64Array(D);
    for (var i = 0; i < ra.img.length; i++) for (var c = 0; c < D; c++) ma[c] += ra.img[i][c] / ra.img.length;
    for (var j = 0; j < rb.img.length; j++) for (var c2 = 0; c2 < D; c2++) mb[c2] += rb.img[j][c2] / rb.img.length;
    // Every row of each pole against the other pole's mean: a population with
    // the same shape the text mint's is, so the sink rule reads the same way.
    for (var i2 = 0; i2 < ra.img.length; i2++) pop.push(sub(ra.img[i2], mb));
    for (var j2 = 0; j2 < rb.img.length; j2++) pop.push(sub(ma, rb.img[j2]));
  } else {
    for (var i3 = 0; i3 < ra.img.length; i3++) pop.push(sub(ra.img[i3], ra.txt));
  }
  var built = buildAxis(pop, D, spec.sinkFactor);
  var scale = 0.15 * meanTokenNorm(A.embeds);
  if (progress) progress(1, 1, 'minted');
  return finish(pipe, spec.name, built, scale, D, pop.length, 'image');
}

// ── registration ───────────────────────────────────────────────────────────

function finish(pipe, name, built, scale, D, samples, kind) {
  // Decompose BEFORE registering, or the axis turns up as its own best match.
  var cos = decompose(pipe, built.dir, 6);
  pipe.setControlVector(name, built.dir, 0, scale);
  return {
    name: name, scale: scale, dim: D, kind: kind, samples: samples,
    consistency: built.consistency, consistencyRaw: built.consistencyRaw,
    rawNorm: built.rawNorm,
    sink: built.sink.slice(0, 8),
    components: cos,
    dir: built.dir,
  };
}

// Re-register a saved axis after a model load — the pipeline is new, the
// direction is not.
export function registerAxis(pipe, name, dir, scale) {
  var D = pipe.qwenImage21TextHiddenDim();
  var f = (dir instanceof Float32Array) ? dir : Float32Array.from(dir);
  if (f.length !== D) {
    throw new Error('minted axis ' + name + ' is ' + f.length + ' wide, the encoder is ' + D);
  }
  pipe.setControlVector(name, f, 0, +scale || 1);
  return f;
}
