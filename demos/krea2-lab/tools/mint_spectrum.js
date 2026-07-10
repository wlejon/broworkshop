// Bake the spectrum: mint the model-nominated affect axes ONCE, offline,
// and write them to lab/spectrum.json as pooled per-layer concept directions.
//
// Words are scaffolding for the mint only. Per mint prompt: splice ~100
// expression words onto the subject, diff per-token taps against a 'calm'
// carrier, center, eigendecompose (Gram + Jacobi), bind each axis to the PC
// that best separates its anchor words. Then POOL each axis field over the
// token dimension -> a (12 x 2560) direction that applies uniformly to every
// token row of ANY prompt (any subject, any language) — verified in the
// round-7 emotion probes: transfers to unseen subjects and a Chinese prompt;
// usable envelope ~alpha 5-6 before off-manifold drift.
//
// Averaging over three diverse mint prompts reduces single-prompt bias.
//
//   bro-headless <krea2-lab dir> tools/mint_spectrum.js
//
// Writes lab/spectrum.json: { span, gain, axes: {key: [span floats]}, meta }.
// The worker applies row += slider * SLIDER_GAIN * gain * axes[key].

const fs = require('fs');

const MODEL_DIR = 'D:/projects/brodiffusion/weights/krea-2-turbo';
const OUT = 'D:/projects/broworkshop/demos/krea2-lab/lab/spectrum.json';

// Each mint prompt names its subject phrase so the splice needs no grammar
// heuristics at bake time (runtime never splices at all).
const MINT_PROMPTS = [
  { prompt: 'a studio portrait of a woman with shoulder-length brown hair looking at the camera, plain gray background, soft light',
    subject: 'a woman' },
  { prompt: 'a portrait of a young man in a dark sweater, plain background, window light',
    subject: 'a young man' },
  { prompt: 'a portrait of an elderly fisherman with a weathered face, harbor background',
    subject: 'an elderly fisherman' },
];

const WORDS = [
  'happy', 'joyful', 'cheerful', 'gleeful', 'delighted', 'elated', 'ecstatic',
  'euphoric', 'content', 'serene', 'peaceful', 'smiling', 'laughing',
  'grinning', 'beaming', 'amused', 'playful', 'mischievous', 'smirking',
  'winking', 'flirtatious', 'proud', 'confident', 'smug', 'hopeful',
  'excited', 'thrilled', 'surprised', 'astonished', 'amazed', 'shocked',
  'startled', 'awestruck', 'curious', 'confused', 'puzzled', 'bewildered',
  'skeptical', 'suspicious', 'doubtful', 'bored', 'tired', 'sleepy',
  'exhausted', 'weary', 'sad', 'unhappy', 'gloomy', 'melancholy',
  'sorrowful', 'mournful', 'grieving', 'crying', 'tearful', 'weeping',
  'heartbroken', 'devastated', 'disappointed', 'hurt', 'lonely', 'wistful',
  'pensive', 'thoughtful', 'worried', 'anxious', 'nervous', 'tense',
  'stressed', 'afraid', 'scared', 'fearful', 'terrified', 'horrified',
  'panicked', 'annoyed', 'irritated', 'frustrated', 'angry', 'furious',
  'enraged', 'livid', 'outraged', 'bitter', 'resentful', 'contemptuous',
  'scornful', 'disgusted', 'revolted', 'nauseated', 'embarrassed',
  'ashamed', 'guilty', 'shy', 'bashful', 'pained', 'agonized', 'defiant',
  'determined', 'fierce', 'stern', 'grim', 'solemn',
];
const AXES = [
  { key: 'valence',
    pos: ['happy', 'cheerful', 'joyful', 'smiling'],
    neg: ['sad', 'crying', 'grieving', 'devastated'] },
  { key: 'arousal',
    pos: ['excited', 'ecstatic', 'enraged', 'terrified'],
    neg: ['bored', 'tired', 'sleepy', 'weary'] },
  { key: 'hostility',
    pos: ['angry', 'furious', 'outraged', 'fierce'],
    neg: ['crying', 'grieving', 'hurt', 'peaceful'] },
  { key: 'surprise',
    pos: ['surprised', 'astonished', 'shocked', 'amazed'],
    neg: ['grim', 'stern', 'solemn', 'bitter'] },
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
function jacobiEigen(A, n) {
  const V = [];
  for (let i = 0; i < n; i++) { V.push(new Float64Array(n)); V[i][i] = 1; }
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
    if (off < 1e-9) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-12) continue;
      const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = A[k][p], akq = A[k][q];
        A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = A[p][k], aqk = A[q][k];
        A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => A[b][b] - A[a][a]);
  return { values: order.map(i => Math.max(0, A[i][i])),
           vectors: order.map(i => Float64Array.from({ length: n }, (_, k) => V[k][i])) };
}

// Mint one prompt's pooled per-layer axes. Returns {pooled: {key: f32(SPAN)},
// gain, kept} — pooled vectors unit-normalized and anchor-oriented.
function mintPrompt(mp) {
  const splice = (adj) => mp.prompt.replace(mp.subject,
    mp.subject.split(' ')[0] + ' ' + adj + ' ' + mp.subject.split(' ').slice(1).join(' '));
  const carrier = pipeline.krea2EncodePromptTaps(splice('calm'));
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
  const fields = [], words = [];
  let normSum = 0;
  for (const w of WORDS) {
    const te = pipeline.krea2EncodePromptTaps(splice(w));
    if (!masksEqual(te.mask, carrier.mask)) continue;
    const f = compact(te.embeds.data);
    axpy(f, carrierC, -1);
    normSum += Math.sqrt(dotf(f, f));
    fields.push(f); words.push(w);
  }
  const N = fields.length;
  assert(N >= 24, 'enough aligned words for "' + mp.subject + '" (got ' + N + ')');
  const meanNorm = normSum / N;
  const mean = new Float32Array(D);
  for (let i = 0; i < N; i++) axpy(mean, fields[i], 1 / N);
  for (let i = 0; i < N; i++) axpy(fields[i], mean, -1);
  const G = [];
  for (let i = 0; i < N; i++) G.push(new Float64Array(N));
  for (let i = 0; i < N; i++) for (let j = 0; j <= i; j++) {
    const s = dotf(fields[i], fields[j]); G[i][j] = s; G[j][i] = s;
  }
  const eig = jacobiEigen(G, N);
  const wordIndex = {};
  for (let i = 0; i < N; i++) wordIndex[words[i]] = i;
  const taken = {}, pooled = {}, binding = [];
  for (const ax of AXES) {
    let bestK = -1, bestS = 0;
    for (let k = 0; k < Math.min(8, N); k++) {
      if (taken[k]) continue;
      const sv = Math.sqrt(eig.values[k]);
      const mc = (list) => {
        let s = 0, n = 0;
        for (const w of list) { const wi = wordIndex[w]; if (wi != null) { s += eig.vectors[k][wi] * sv; n++; } }
        return n ? s / n : 0;
      };
      const sc = mc(ax.pos) - mc(ax.neg);
      if (Math.abs(sc) > Math.abs(bestS)) { bestS = sc; bestK = k; }
    }
    taken[bestK] = true;
    const f = new Float32Array(D);
    for (let i = 0; i < N; i++) if (eig.vectors[bestK][i]) axpy(f, fields[i], eig.vectors[bestK][i]);
    const p = new Float32Array(SPAN);
    for (let vi = 0; vi < validSlots.length; vi++) {
      axpy(p, f.subarray(vi * SPAN, (vi + 1) * SPAN), 1 / validSlots.length);
    }
    const n2 = Math.sqrt(dotf(p, p)) || 1e-9;
    bro.image.map(p, p, { op: 'affine', a: (bestS < 0 ? -1 : 1) / n2, b: 0 });
    pooled[ax.key] = p;
    binding.push(ax.key + '=PC' + bestK);
  }
  console.log('  "' + mp.subject + '": ' + N + ' words, ' + binding.join(' '));
  return { pooled: pooled, gain: meanNorm / Math.sqrt(validSlots.length), span: SPAN, words: N };
}

const t0 = Date.now();
const mints = MINT_PROMPTS.map((mp, i) => {
  console.log('mint ' + (i + 1) + '/' + MINT_PROMPTS.length + '…');
  return mintPrompt(mp);
});
const SPAN = mints[0].span;

// Average the unit directions across mint prompts, re-normalize; report the
// cross-prompt agreement (cosine to the mean) — low agreement on an axis
// means it did NOT generalize and the bake should be treated with suspicion.
const out = { span: SPAN, gain: mints.reduce((s, m) => s + m.gain, 0) / mints.length, axes: {}, meta: {} };
for (const ax of AXES) {
  const avg = new Float32Array(SPAN);
  for (const m of mints) axpy(avg, m.pooled[ax.key], 1 / mints.length);
  const n2 = Math.sqrt(dotf(avg, avg)) || 1e-9;
  bro.image.map(avg, avg, { op: 'affine', a: 1 / n2, b: 0 });
  const cos = mints.map(m => dotf(avg, m.pooled[ax.key]).toFixed(3));
  console.log(ax.key + ': cross-prompt cosine to mean [' + cos.join(', ') + ']');
  out.axes[ax.key] = Array.from(avg);
  out.meta[ax.key] = { crossPromptCos: cos.map(Number) };
}
out.meta.mintPrompts = MINT_PROMPTS.map(m => m.prompt);
out.meta.wordsPerMint = mints.map(m => m.words);
out.meta.mintedMs = Date.now() - t0;

fs.writeFileSync(OUT, JSON.stringify(out));
console.log('wrote ' + OUT + ' (' + (fs.statSync(OUT).size / 1024 / 1024).toFixed(1) + ' MB) in ' +
            ((Date.now() - t0) / 1000).toFixed(0) + 's');
console.log('ALL DONE');
