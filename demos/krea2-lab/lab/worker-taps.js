// Krea 2 Lab worker — raw tap conditioning helpers:
//   - stack budget + axis control application
//   - deep-tap band dial (layers 7-10)
//   - contextual per-token expression field (mask-aligned neutral splice)
//   - model-nominated baked axis banks (affect spectrum + mouth)
//   - reference picture vision-token tap merge

// Deep-tap band dial: krea-research's literal<->stylized control scales these
// 4 (of 12) tapped decoder layers before fusion (ui.py's BAND).
export var BAND_LAYERS = [7, 8, 9, 10];
// AdaLN dial block range (ui.py's DIAL_BLOCKS) — the last 9 of 28 body blocks.
export var DIAL_BLOCKS = [19, 28];

var fieldCache = {};
var fieldCacheCount = 0;
var referenceRef = null; // the cached reference picture: {taps: {embeds, mask},
                         // tokens} from setReference's vision-tower encode
                         // (~125 MB — one at a time). Cleared on model load.

export function clearEncoderCaches() {
  fieldCache = {};
  fieldCacheCount = 0;
  referenceRef = null;
}

export function setReferenceRef(ref) {
  referenceRef = ref;
}

// The stack budget, in alpha units — how much TOTAL axis injection the scene
// can absorb before the injection, rather than the prompt, is what gets drawn.
// Every axis is added to every token row, so what reaches the denoiser is the
// SUM of the stack: ten sliders at +2 push twice as hard as one at +10, and the
// deck happily lets you do it. Probe strips (a person-free sunset-cliff prompt,
// ten axes stacked, the sum renormalized and swept) put the cliff at roughly
//   |v| ~ 13*band - 1     alpha units
// — past it any scene turns into dramatic crowds. The band dial belongs in the
// rule because it scales the PROMPT's own deep taps: at band 0.5 the cliff is
// ~5.5, at 1.0 it is ~12. Above 1.0 the headroom stops growing, so the factor
// is capped. Hold the stack at 90% of the measured cliff.
export function controlBudget(band) {
  var b = Math.min(+band || 1.0, 1.0);
  return 0.9 * Math.max(2.0, 13 * b - 1);
}

// Apply the {axisName: alpha} control map from scratch (mirrors sana-lab):
// clear, then set the nonzero axes, so a slider at 0/absent is a true no-op.
// Baked into the state's fused conditioning at prime() time (task C's wiring)
// — safe to clear again right after priming. The engine holds the stack to the
// budget by scaling every active axis by one common factor, so the dialled-in
// mix survives; we return what it cost so the deck can show a meter.
export function applyAxisControls(pipeline, map, band) {
  pipeline.clearControl();
  pipeline.setControlBudget(controlBudget(band));
  var any = false, active = {};
  for (var name in map) {
    if (!map.hasOwnProperty(name)) continue;
    var a = +map[name];
    if (a) { active[name] = a; any = true; }
  }
  if (any) pipeline.setControl(active);
  return pipeline.controlNorm();   // {norm, budget, clamped, scale}
}

// Scale the 4 deep-tap band layers across every token slot of a raw-taps
// buffer, in place. Filler (invalid) token rows get scaled too — harmless,
// encode_text() drops them by mask before fusion.
export function scaleBand(embeds, band) {
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
export function spliceAdjective(prompt, adj) {
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
export function expressionField(pipeline, prompt, adj) {
  var key = prompt + '\u0000' + adj;
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
export function expressionTaps(pipeline, prompt, adj, alpha) {
  var f = expressionField(pipeline, prompt, adj);
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
export var BAKED_BANKS = {
  spectrum: { keys: ['valence', 'arousal', 'hostility', 'surprise'], dict: null },
  mouth:    { keys: ['open', 'round', 'teeth'], dict: null },
};
// Slider→alpha calibration: full deflection (3) lands at the probe-verified
// full-expression point (pooled alpha ~5); off-manifold drift starts past ~6.
var BAKED_SLIDER_GAIN = 5 / 3;

export function loadBankDict(name, path) {
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
// or a reference picture's taps — with no words or language involved.
export function applyBank(taps, name, values) {
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
export function activeBaked(msg) {
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

// ── the reference picture ──────────────────────────────────────
// Copy an evenly-spread subsample of the cached reference's vision-token tap
// blocks (each token is a contiguous 12-layer span of the embeds buffer) into
// the carrier's free (mask-0) slots, and mark those slots valid. `share` is the
// fraction of the reference's own tokens that ride: 0.35 means the model is
// told about roughly a third of the picture, 1.0 means all of it, and with an
// empty prompt 1.0 IS "render this picture" — there is no separate mode.
//
// Even spread, not the first N: a partial share should be a lower-resolution
// look at the whole picture, not its top strip.
//
// The carrier's mask is replaced with a copy first — expressionTaps hands out
// its CACHED field mask by reference, and extending that in place would poison
// every later use of the cached field.
export function mergeReference(taps, share) {
  if (!referenceRef) {
    throw new Error('no reference picture set — pick one in the reference panel first');
  }
  var slots = taps.mask.rows;
  var span = (taps.embeds.rows / slots) * taps.embeds.cols;   // floats per token
  var ref = referenceRef.taps;
  var refSpan = (ref.embeds.rows / ref.mask.rows) * ref.embeds.cols;
  if (refSpan !== span) {
    throw new Error('reference tap shape mismatch — re-pick the picture');
  }
  taps.mask = { rows: taps.mask.rows, cols: taps.mask.cols, data: taps.mask.data.slice() };
  var free = [], src = [];
  for (var t = 0; t < slots; t++) if (taps.mask.data[t] === 0) free.push(t);
  for (var t = 0; t < ref.mask.rows; t++) if (ref.mask.data[t] !== 0) src.push(t);
  if (!src.length) throw new Error('the reference encoded to zero valid tokens');
  if (!free.length) {
    throw new Error('the prompt fills all ' + slots + ' token slots — no room for the reference');
  }
  var take = Math.min(Math.max(1, Math.round(share * src.length)),
                      src.length, free.length);
  var dstData = taps.embeds.data, refData = ref.embeds.data;
  for (var i = 0; i < take; i++) {
    var s = src[Math.floor(i * src.length / take)];
    var d = free[i];
    var dstTok = dstData.subarray(d * span, (d + 1) * span);
    // dstTok = 0*dstTok + 1*refTok — a copy at C++ speed; the filler rows
    // being overwritten hold garbage, so wa must be 0, not 1.
    bro.image.combine(dstTok, dstTok, refData.subarray(s * span, (s + 1) * span),
                      { op: 'wsum', wa: 0, wb: 1 });
    taps.mask.data[d] = 1;
  }
  return { take: take, of: src.length };
}

// Raw taps for this generation, or null to let prime(prompt) do the encode
// (+ auto cond_control) internally. Image-as-prompt, the expression field,
// the baked banks, the band dial, and the reference picture all need the
// raw-taps path; the plain axis bank alone does not.
export function buildTaps(pipeline, msg) {
  var band = (msg.band == null) ? 1.0 : +msg.band;
  var expr = (msg.expression && msg.expression.adj && +msg.expression.alpha)
    ? msg.expression : null;
  var baked = activeBaked(msg);
  var refPic = (msg.reference && +msg.reference.share) ? msg.reference : null;
  var taps;
  if (expr) {
    taps = expressionTaps(pipeline, msg.prompt, String(expr.adj), +expr.alpha);
  } else if (baked || band !== 1.0 || refPic) {
    taps = pipeline.krea2EncodePromptTaps(msg.prompt);
  } else {
    return null;
  }
  // The reference's tokens join the carrier first, so the banks and band below
  // treat them as part of the conditioning like any other token.
  if (refPic) {
    var took = mergeReference(taps, +refPic.share);
    taps.referenceNote = 'reference · ' + took.take + ' of ' + took.of + ' tokens';
  }
  // Baked axes are per-row uniform: they stack on whatever taps this
  // generation uses — plain prompt or expression carrier —
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
