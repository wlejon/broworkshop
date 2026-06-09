// Headless smoke for the lab. Like kokoro-lab's smokes, this drives the real
// runtime via the SYNC library APIs — headless can't pace the async event loop
// for a static app (in the windowed runtime the main loop always pumps, so the
// app's async Render/Stream path is fine; the underlying calls are exercised
// here synchronously). We reuse the app's own functions (adaptToVariant,
// renderStages, randomVoice, currentVoice, currentSampling) against live models.
const ROOT = 'D:/projects/brosoundml/weights/qwen-tts';
const TEXT = 'Hello there. This is a test of the pipeline.';

function finite(r) {
  let peak = 0, bad = 0;
  for (let i = 0; i < r.samples.length; i++) { const a = Math.abs(r.samples[i]); if (!isFinite(a)) bad++; if (a > peak) peak = a; }
  return { peak, bad };
}
function shapes(r) { return (r.stages || []).map((s) => s.name + ' ' + s.h + 'x' + s.w).join(' | '); }

// ── CustomVoice: speaker palette + sampling + trace ──────────────────────────
qwen = bro.tts.loadQwen(ROOT + '/0.6B-customvoice');
variant = qwen.variant;
adaptToVariant();                                   // builds the speaker panel
const speakers = qwen.speakers();
const optCount = document.querySelectorAll('#speaker option').length;
console.log('CUSTOMVOICE', variant, '· speakers', speakers.length, '·', optCount, 'in <select>');
assert(variant === 'customvoice' && speakers.length > 0, 'customvoice + speakers');
assert(optCount === speakers.length, 'speaker select populated');

let r = qwen.synthesize(TEXT, { speaker: speakers[0], language: 'english', trace: true });
let f = finite(r);
console.log('  greedy render', f.peak.toFixed(3), 'peak ·', (r.samples.length / r.sampleRate).toFixed(2) + 's ·', shapes(r));
assert(f.bad === 0 && f.peak > 0.01, 'greedy audio finite + audible');
assert((r.stages || []).some((s) => s.name === 'codes' && s.h === 16), 'codes 16xF');
assert((r.stages || []).some((s) => s.name === 'c0_confidence' && s.h === 1), 'c0_confidence 1xF');

lastResult = r; renderStages(r);
console.log('  cards drawn:', Object.keys(cards).join(','), '· dom', $('#stages').children.length);
assert($('#stages').children.length >= 3, 'codes + conf + audio cards');

// greedy is deterministic; two temp>0 takes (fixed seeds) differ from greedy & each other
const g2 = qwen.synthesize(TEXT, { speaker: speakers[0], temperature: 0 });
let d0 = 0; for (let i = 0; i < Math.min(4000, r.samples.length); i++) d0 += Math.abs(r.samples[i] - g2.samples[i]);
assert(d0 < 1e-3, 'greedy reproducible');
const s1 = qwen.synthesize(TEXT, { speaker: speakers[0], temperature: 0.9, topP: 0.95, seed: 1 });
const s2 = qwen.synthesize(TEXT, { speaker: speakers[0], temperature: 0.9, topP: 0.95, seed: 2 });
let d12 = 0; const n = Math.min(s1.samples.length, s2.samples.length, 8000);
for (let i = 0; i < n; i++) d12 += Math.abs(s1.samples[i] - s2.samples[i]);
console.log('  sampling: greedy↔greedy', d0.toFixed(4), '· seed1↔seed2', d12.toFixed(1));
assert(d12 > 1, 'different seeds → different takes');

// ── voiceSteer: x-vector-space steering on a CustomVoice preset slot ─────────
// The emotion / masc-fem axes (built from the sibling Base's basis) nudge the
// preset's prefill speaker slot via opts.voiceSteer — the same control the Base
// designer folds into its x-vector, now reaching CustomVoice.
console.log('VOICESTEER · #axes', $('#axes').style.display,
            '·', emotionBasis ? 'emotion' : '—', mascFemBasis ? 'mascfem' : '—');
assert($('#axes').style.display !== 'none', 'axes panel shown for customvoice');
assert(!!mascFemBasis || !!emotionBasis, 'a steering basis resolved from the sibling Base');
if (mascFemBasis) {
  assert($('#mascfem').style.display !== 'none', 'masc/fem panel visible on customvoice');
  setMfAlpha(mascFemBasis.defaultAlpha.M);            // push masculine
  const vs = voiceSteerVector();
  assert(vs && vs.length === mascFemBasis.full.M.length, 'voiceSteer sized to the basis dim');
  // the steer must REACH the model: same greedy decode, slot nudged → audio differs
  const base    = qwen.synthesize(TEXT, { speaker: speakers[0], temperature: 0 });
  const steered = qwen.synthesize(TEXT, { speaker: speakers[0], temperature: 0, voiceSteer: vs });
  const fs = finite(steered);
  const m = Math.min(base.samples.length, steered.samples.length, 24000);
  let dd = 0; for (let i = 0; i < m; i++) dd += Math.abs(base.samples[i] - steered.samples[i]);
  console.log('  steer Δ over', m, 'samples =', dd.toFixed(1), '· peak', fs.peak.toFixed(3));
  assert(fs.bad === 0 && fs.peak > 0.01, 'steered audio finite + audible');
  assert(dd > 1, 'voiceSteer reaches the model (audio changed)');
  // a zero steer is a strict no-op (added to the slot, contributes nothing)
  const noop = qwen.synthesize(TEXT, { speaker: speakers[0], temperature: 0, voiceSteer: new Float32Array(vs.length) });
  let dz = 0; for (let i = 0; i < m; i++) dz += Math.abs(base.samples[i] - noop.samples[i]);
  assert(dz < 1e-3, 'zero steer = no-op');
  // a wrong-length steer is rejected, not silently misread
  let threw = false;
  try { qwen.synthesize(TEXT, { speaker: speakers[0], voiceSteer: new Float32Array(7) }); } catch (e) { threw = true; }
  assert(threw, 'wrong-length voiceSteer rejected');
  resetMascFem();
  console.log('  voiceSteer verified · Δ', dd.toFixed(1), '· zero-noop', dz.toFixed(4));
}

// ── Base: the x-vector designer + designer trace ─────────────────────────────
qwen = bro.tts.loadQwen(ROOT + '/0.6B-Base');
variant = qwen.variant;
adaptToVariant();                                   // builds the designer panel
console.log('BASE', variant);
assert(variant === 'base', 'base variant');
randomVoice();                                      // embeds a noise burst → anchor → blend
assert(designedXvec && designedXvec.length > 0, 'random x-vector designed');
const cv = currentVoice();
assert(cv && cv.xvector && cv.xvector.length === designedXvec.length, 'currentVoice → xvector');
console.log('  designed x-vector', designedXvec.length + '-D · anchors', anchors.length);

// blend math: a second anchor at equal weight = the mean of the two
addAnchor('b', Float32Array.from(anchors[0].xvec, (v) => v + 1));
anchorW[0] = 1; anchorW[1] = 1; recomputeBlend();
let okmix = true;
for (let i = 0; i < designedXvec.length; i++) if (Math.abs(designedXvec[i] - (anchors[0].xvec[i] + anchors[1].xvec[i]) / 2) > 1e-4) okmix = false;
assert(okmix, 'blend = weighted mean of anchors');

const rx = qwen.synthesizeFromXvector(TEXT, designedXvec, { language: 'english', trace: true });
f = finite(rx);
console.log('  designer render', f.peak.toFixed(3), 'peak ·', (rx.samples.length / rx.sampleRate).toFixed(2) + 's ·', shapes(rx));
assert(f.bad === 0 && f.peak > 0.001, 'designer audio finite');
assert((rx.stages || []).some((s) => s.name === 'codes' && s.h === 16), 'designer codes trace');
lastResult = rx; renderStages(rx);

// ── masculine↔feminine basis: bipolar x-vector offset ────────────────────────
console.log('MASC↔FEM', mascFemBasis ? 'basis loaded' : 'no basis');
if (mascFemBasis) {
  assert($('#mascfem').style.display !== 'none', 'masc/fem panel visible');
  const dM = mascFemBasis.defaultAlpha.M, fm = mascFemBasis.full.M;
  setMfAlpha(dM);                                    // push masculine
  const xv = currentVoice().xvector;
  let okM = true;
  for (let i = 0; i < designedXvec.length; i++) if (Math.abs(xv[i] - (designedXvec[i] + dM * fm[i])) > 1e-4) okM = false;
  assert(okM, 'applyMascFem = designed + α·full[M]');
  assert(mascFemSummary().indexOf('masculine') >= 0, 'masc summary');
  setMfAlpha(-mascFemBasis.defaultAlpha.F);          // push feminine (negative α)
  assert(mascFemSummary().indexOf('feminine') >= 0, 'fem summary');
  resetMascFem();
  assert(mfAlpha === 0 && currentVoice().xvector === designedXvec, 'reset → neutral (no offset)');
  console.log('  masc/fem verified · default masc', dM, '/ fem', mascFemBasis.defaultAlpha.F);
}

// ── codec round-trip seam ────────────────────────────────────────────────────
const enc = qwen.encodeAudio(rx.samples.slice(0, 24000 * 2), { sampleRate: rx.sampleRate });
const back = qwen.decodeCodes(enc.codes, enc.numQuantizers, enc.numFrames);
console.log('  codec', enc.numQuantizers + 'x' + enc.numFrames, 'codes →', back.samples.length, 'samples');
assert(enc.numQuantizers === 16 && back.samples.length > 0, 'encode→decode round-trip');

// ── UI render check ──────────────────────────────────────────────────────────
flush();
screenshot('_ui.png');
console.log('ALL SMOKE CHECKS PASSED');
