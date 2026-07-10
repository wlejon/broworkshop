// Bake the mouth axes: mint model-nominated mouth-articulation directions
// ONCE, offline, and write them to lab/mouth.json as pooled per-layer concept
// directions — the same farming methodology as tools/mint_spectrum.js
// (phrase splice, mask-aligned carrier diff, token pooling), with a
// CONTRAST-OF-MEANS construction instead of PC binding.
//
// Why not eigendecomposition like the spectrum: the mouth phrase cloud's top
// PCs encode shared mouth-imagery CONTENT, not articulation — the v1 PC bake
// had excellent cross-prompt cosines (teeth 0.94) yet its strips drifted into
// bared-teeth comic art and species swaps. mean(pos anchors) − mean(neg
// anchors) cancels everything the two poles share (subject, scene,
// "mouthness") and keeps only what separates them: the articulation.
//
// Per mint prompt: splice ~36 mouth-state phrases onto the subject ("a woman"
// -> "a woman with mouth wide open"), diff per-token taps against a
// token-count-aligned neutral carrier ("with a neutral mouth" — the probe
// showed the modal phrase bucket matches its 4 tokens), contrast anchor-pole
// means, POOL over the token dimension -> a (12 x 2560) direction applied
// uniformly to every token row of ANY prompt. Average across prompts, then
// Gram-Schmidt the axes (round ⟂ open, teeth ⟂ both) so each slider moves
// one articulation without dragging the others.
//
// Two articulation axes (the viseme plane) + teeth:
//   open  — jaw drop:      mouth wide open <-> lips sealed shut
//   round — lip rounding:  pursed/puckered <-> spread wide / grinning
//   teeth — teeth visible: bared teeth     <-> lips covering teeth
//
// Mint prompts span humans AND animals; the per-axis cross-prompt cosines
// (printed, and split human vs animal in meta) are the generalization
// signal — low agreement on a group means the axis did not transfer and the
// bake should be restricted.
//
//   bro-headless <krea2-lab dir> tools/mint_mouth.js
//
// Writes lab/mouth.json: { span, gain, axes: {key: [span floats]}, meta } —
// the same shape as lab/spectrum.json, loaded by the same worker machinery.
// `gain` is scaled so a given slider value pushes each token row by the same
// magnitude as the same spectrum slider value (phrase fields have ~1.8x the
// norm of the spectrum's word fields; without this the mouth sliders would
// run off-manifold long before full deflection).

const fs = require('fs');

const MODEL_DIR = 'D:/projects/brodiffusion/weights/krea-2-turbo';
const OUT = 'D:/projects/broworkshop/demos/krea2-lab/lab/mouth.json';

const CARRIER = 'with a neutral mouth';

// Match the per-row push of the spectrum bank at equal slider values:
// spectrum.json's gain (mean word-field norm / sqrt tokens) is 94.76.
const TARGET_GAIN = 94.76;

const MINT_PROMPTS = [
  { prompt: 'a studio portrait of a woman with shoulder-length brown hair looking at the camera, plain gray background, soft light',
    subject: 'a woman', group: 'human' },
  { prompt: 'a portrait of a young man in a dark sweater, plain background, window light',
    subject: 'a young man', group: 'human' },
  { prompt: 'a portrait of an elderly fisherman with a weathered face, harbor background',
    subject: 'an elderly fisherman', group: 'human' },
  { prompt: 'a close-up photo of a golden retriever dog sitting in a park, looking at the camera, soft light',
    subject: 'a golden retriever dog', group: 'animal' },
  { prompt: 'a close-up photo of a brown horse standing in a green field, overcast light',
    subject: 'a brown horse', group: 'animal' },
  { prompt: 'a close-up photo of a tabby cat sitting on a windowsill, soft light',
    subject: 'a tabby cat', group: 'animal' },
];

// Mint phrases — every one tokenizes to the carrier's 4 extra tokens on the
// probe prompts (probe_mint_phrases: the tokenizer treats the suffix phrase
// identically across subjects), so nearly all survive the mask-alignment
// filter on every mint prompt; mismatches are skipped like the spectrum
// mint's non-aligned words. Non-anchor phrases still matter: they feed the
// mean-field norm (gain) and the reported anchor-pole separation baseline.
const PHRASES = [
  // open pole
  'with mouth wide open', 'with mouth gaping open', 'with jaw dropped open',
  'with jaws agape', 'with mouth hanging open',
  // closed pole
  'with the mouth closed', 'with mouth firmly closed', 'with lips pressed together',
  'with lips sealed shut', 'with lips squeezed shut', 'tight-lipped',
  // round / pursed pole
  'with lips pursed', 'with pursed lips', 'with puckered lips', 'with pouting lips',
  'whistling softly',
  // spread pole
  'with a broad grin', 'with lips stretched wide', 'snarling fiercely',
  // teeth pole
  'with teeth bared', 'with gritted teeth', 'with clenched teeth',
  'with exposed front teeth', 'with visible white teeth', 'gritting the teeth',
  'flashing bared teeth', 'baring sharp teeth', 'baring the teeth',
  // in-between / enrichment (parted, tongue, misc articulation)
  'with lips slightly parted', 'with mouth slightly open', 'with mouth half open',
  'with slightly parted lips', 'with tongue sticking out', 'sticking the tongue out',
  'biting the lower lip', 'with a bitten lip',
];

const AXES = [
  { key: 'open',
    pos: ['with mouth wide open', 'with mouth gaping open', 'with jaw dropped open', 'with jaws agape', 'with mouth hanging open'],
    neg: ['with the mouth closed', 'with mouth firmly closed', 'with lips pressed together', 'with lips sealed shut', 'with lips squeezed shut'] },
  { key: 'round',
    pos: ['with lips pursed', 'with pursed lips', 'with puckered lips', 'with pouting lips'],
    neg: ['with a broad grin', 'with lips stretched wide'] },
  { key: 'teeth',
    pos: ['with teeth bared', 'with gritted teeth', 'flashing bared teeth', 'baring the teeth', 'with visible white teeth'],
    neg: ['with lips sealed shut', 'with lips pressed together', 'with pouting lips', 'with lips pursed'] },
];

console.log('loading Krea 2 Turbo (INT8)…');
const pipeline = bro.diffusion.loadModel(MODEL_DIR, { quantizeWeights: true });
assert(pipeline && !pipeline.cancelled, 'model loaded');

let dotScratch = null;
function dotf(a, b) {
  if (!dotScratch || dotScratch.length !== a.length) dotScratch = new Float32Array(a.length);
  bro.image.combine(dotScratch, a, b, { op: 'mul' });
  return bro.image.reduce(dotScratch, 'sum');
}
function axpy(dst, src, w) { bro.image.combine(dst, dst, src, { op: 'wsum', wa: 1, wb: w }); }
function masksEqual(a, b) {
  if (a.rows !== b.rows || a.cols !== b.cols) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

// Mint one prompt's pooled per-layer axes by anchor-pole contrast. Returns
// {pooled: {key: f32(SPAN)}, gain, span, phrases} — pooled vectors
// unit-normalized, oriented pos-positive by construction.
function mintPrompt(mp) {
  const splice = (ph) => mp.prompt.replace(mp.subject, mp.subject + ' ' + ph);
  const carrier = pipeline.krea2EncodePromptTaps(splice(CARRIER));
  const COLS = carrier.embeds.cols, SPAN = 12 * COLS;
  const validSlots = [];
  for (let t = 0; t < carrier.mask.rows; t++) if (carrier.mask.data[t] !== 0) validSlots.push(t);
  const D = validSlots.length * SPAN;
  const compact = (full) => {
    const out = new Float32Array(D);
    for (let vi = 0; vi < validSlots.length; vi++) {
      out.set(full.subarray(validSlots[vi] * SPAN, validSlots[vi] * SPAN + SPAN), vi * SPAN);
    }
    return out;
  };
  const carrierC = compact(carrier.embeds.data);
  const fieldByPhrase = {};
  let normSum = 0, N = 0;
  for (const ph of PHRASES) {
    const te = pipeline.krea2EncodePromptTaps(splice(ph));
    if (!masksEqual(te.mask, carrier.mask)) continue;
    const f = compact(te.embeds.data);
    axpy(f, carrierC, -1);
    normSum += Math.sqrt(dotf(f, f));
    fieldByPhrase[ph] = f; N++;
  }
  assert(N >= 20, 'enough aligned phrases for "' + mp.subject + '" (got ' + N + ')');
  const meanNorm = normSum / N;

  const pooled = {};
  for (const ax of AXES) {
    const pos = ax.pos.filter((p) => fieldByPhrase[p]);
    const neg = ax.neg.filter((p) => fieldByPhrase[p]);
    assert(pos.length >= 2 && neg.length >= 2,
           ax.key + ' anchors survive alignment for "' + mp.subject + '"');
    // contrast of anchor-pole means — shared content cancels
    const dir = new Float32Array(D);
    for (const p of pos) axpy(dir, fieldByPhrase[p], 1 / pos.length);
    for (const p of neg) axpy(dir, fieldByPhrase[p], -1 / neg.length);
    // pool over tokens -> per-layer direction
    const p = new Float32Array(SPAN);
    for (let vi = 0; vi < validSlots.length; vi++) {
      axpy(p, dir.subarray(vi * SPAN, (vi + 1) * SPAN), 1 / validSlots.length);
    }
    const n2 = Math.sqrt(dotf(p, p)) || 1e-9;
    bro.image.map(p, p, { op: 'affine', a: 1 / n2, b: 0 });
    pooled[ax.key] = p;
  }
  console.log('  "' + mp.subject + '": ' + N + ' phrases aligned');
  return { pooled: pooled, gain: meanNorm / Math.sqrt(validSlots.length), span: SPAN, phrases: N };
}

const t0 = Date.now();
const mints = MINT_PROMPTS.map((mp, i) => {
  console.log('mint ' + (i + 1) + '/' + MINT_PROMPTS.length + ' (' + mp.group + ')…');
  return mintPrompt(mp);
});
const SPAN = mints[0].span;

// Average the unit directions across mint prompts, re-normalize; report the
// cross-prompt agreement (cosine to the mean), split by group — low agreement
// on the animal prompts means the axis did NOT generalize across species.
const rawGain = mints.reduce((s, m) => s + m.gain, 0) / mints.length;
const out = { span: SPAN, gain: 0, axes: {}, meta: {} };
const avgAxes = {};
for (const ax of AXES) {
  const avg = new Float32Array(SPAN);
  for (const m of mints) axpy(avg, m.pooled[ax.key], 1 / mints.length);
  const n2 = Math.sqrt(dotf(avg, avg)) || 1e-9;
  bro.image.map(avg, avg, { op: 'affine', a: 1 / n2, b: 0 });
  const cos = mints.map(m => dotf(avg, m.pooled[ax.key]));
  const groupCos = { human: [], animal: [] };
  MINT_PROMPTS.forEach((mp, i) => groupCos[mp.group].push(+cos[i].toFixed(3)));
  console.log(ax.key + ': cross-prompt cosine to mean  human [' + groupCos.human.join(', ') +
              ']  animal [' + groupCos.animal.join(', ') + ']');
  avgAxes[ax.key] = avg;
  out.meta[ax.key] = { crossPromptCos: cos.map(c => +c.toFixed(3)), groupCos: groupCos };
}

// Inter-axis overlap before orthogonalization (diagnostic), then Gram-Schmidt
// in mint order (open kept intact; round ⟂ open; teeth ⟂ open, round) and
// re-normalize, so stacked sliders don't drag each other.
const order = AXES.map(a => a.key);
for (let i = 0; i < order.length; i++) {
  for (let j = i + 1; j < order.length; j++) {
    console.log('overlap ' + order[i] + '·' + order[j] + ' = ' +
                dotf(avgAxes[order[i]], avgAxes[order[j]]).toFixed(3));
  }
}
for (let i = 0; i < order.length; i++) {
  const v = avgAxes[order[i]];
  for (let j = 0; j < i; j++) axpy(v, avgAxes[order[j]], -dotf(v, avgAxes[order[j]]));
  const kept = Math.sqrt(dotf(v, v));
  bro.image.map(v, v, { op: 'affine', a: 1 / (kept || 1e-9), b: 0 });
  out.meta[order[i]].keptAfterOrtho = +kept.toFixed(3);
  if (i > 0) console.log(order[i] + ': kept ' + (kept * 100).toFixed(0) + '% after orthogonalization');
  out.axes[order[i]] = Array.from(v);
}

// Calibrate: same slider value == same per-row push as the spectrum bank.
out.gain = TARGET_GAIN;
out.meta.rawGain = +rawGain.toFixed(3);
out.meta.mintPrompts = MINT_PROMPTS.map(m => m.prompt);
out.meta.carrier = CARRIER;
out.meta.phrasesPerMint = mints.map(m => m.phrases);
out.meta.construction = 'anchor-pole contrast of means, cross-prompt average, Gram-Schmidt (open, round, teeth)';
out.meta.mintedMs = Date.now() - t0;

fs.writeFileSync(OUT, JSON.stringify(out));
console.log('wrote ' + OUT + ' (' + (fs.statSync(OUT).size / 1024 / 1024).toFixed(1) + ' MB) in ' +
            ((Date.now() - t0) / 1000).toFixed(0) + 's');
console.log('ALL DONE');
