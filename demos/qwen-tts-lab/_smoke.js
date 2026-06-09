// Headless smoke for the lab. Like kokoro-lab's smokes, this drives the real
// runtime via the SYNC library APIs — headless can't pace the async event loop
// for a static app (in the windowed runtime the main loop always pumps, so the
// app's async Render/Stream path is fine; the underlying calls are exercised
// here synchronously). We reuse the app's own functions (adaptToVariant,
// renderStages, seedVoice, currentVoice, currentSampling) against live models.
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

// ── designed voice on CustomVoice: pick any map voice → speakerVector slot ────
// The shared voice designer is available in CustomVoice too; choosing a designed
// voice renders it through the slot (speakerVector) instead of a preset token.
console.log('CV-DESIGNED · #designer', $('#designer').style.display,
            '· basis', voiceBasis ? voiceBasis.points.length + ' map pts' : 'none');
assert($('#designer').style.display !== 'none', 'designer shown for customvoice');
assert(!!voiceBasis && voiceBasis.points && voiceBasis.points.length > 100, 'voice basis + map points on customvoice');
assert(cvSource === 'preset' && !!currentVoice().speaker, 'default cv source = preset');
snapToPoint(10);                                    // click a real map voice
assert(cvSource === 'designed', 'designer use → cvSource designed');
const dvoice = currentVoice();
assert(dvoice && dvoice.speakerVector && dvoice.speakerVector.length === 1024, 'currentVoice → speakerVector');
const presetR   = qwen.synthesize(TEXT, { speaker: speakers[0], temperature: 0 });
const designedR = qwen.synthesize(TEXT, { speakerVector: dvoice.speakerVector, temperature: 0 });
const fdz = finite(designedR);
let dpd = 0; const mpd = Math.min(presetR.samples.length, designedR.samples.length, 24000);
for (let i = 0; i < mpd; i++) dpd += Math.abs(presetR.samples[i] - designedR.samples[i]);
console.log('  designed-voice render', fdz.peak.toFixed(3), 'peak · preset↔designed Δ', dpd.toFixed(1));
assert(fdz.bad === 0 && fdz.peak > 0.01, 'designed-voice audio finite + audible');
assert(dpd > 1, 'speakerVector renders a different voice than the preset');
let threwSv = false;
try { qwen.synthesize(TEXT, { speakerVector: new Float32Array(7) }); } catch (e) { threwSv = true; }
assert(threwSv, 'wrong-length speakerVector rejected');
usedPreset();
console.log('  designed-voice verified · preset↔designed Δ', dpd.toFixed(1));

// ── Base: the voice-map designer + designer trace ────────────────────────────
qwen = bro.tts.loadQwen(ROOT + '/0.6B-Base');
variant = qwen.variant;
adaptToVariant();                                   // loads the basis + builds the map
console.log('BASE', variant, '· voiceBasis', voiceBasis ? voiceBasis.k + ' axes / ' + voiceBasis.n + ' actors / ' + voiceBasis.points.length + ' pts' : 'none');
assert(variant === 'base', 'base variant');
assert(!!voiceBasis, 'qwen_voice_basis.json loaded');
assert(sliderCells.length === voiceBasis.k && $('#voice-sliders').children.length === voiceBasis.k, 'fine-tune sliders built per axis');
assert($('#designer').style.display !== 'none' && $('#designer-body').style.display !== 'none', 'designer + map visible');

// neutral seed → designedXvec == the basis mean (all coords 0)
seedVoice('__mean__');
let dmean = 0; for (let d = 0; d < voiceBasis.dim; d++) dmean += Math.abs(designedXvec[d] - voiceBasis.mean[d]);
assert(dmean < 1e-3, 'neutral seed = basis mean');

// slider reconstruction: coord k → mean + coord·std·comp along that axis
coords[0] = 2.0; rebuildDesigned();
let drec = 0; for (let d = 0; d < voiceBasis.dim; d++) drec += Math.abs(designedXvec[d] - (voiceBasis.mean[d] + 2.0 * voiceBasis.std[0] * voiceBasis.comps[0][d]));
assert(drec < 1e-3, 'slider move = mean + coord·std·comp');

// projection round-trip: orthonormal axes → coordsFromXvec ∘ xvecFromCoords = id
for (let k = 0; k < voiceBasis.k; k++) coords[k] = (k % 3) - 1;   // some non-trivial point
const xr = xvecFromCoords(), cr = coordsFromXvec(xr);
let dproj = 0; for (let k = 0; k < voiceBasis.k; k++) dproj += Math.abs(cr[k] - coords[k]);
assert(dproj < 1e-2, 'project(reconstruct(coords)) = coords');
console.log('  reconstruction Δ', drec.toFixed(5), '· round-trip Δ', dproj.toFixed(5));

// the voice map: snapping to a speaker dot sets coords to that real, complete voice
snapToPoint(5);
let dsnap = 0; for (let k = 0; k < voiceBasis.k; k++) dsnap += Math.abs(coords[k] - voiceBasis.points[5][k + 1]);
assert(dsnap < 1e-6, 'snapToPoint = that speaker\'s coords');

// seed a named anchor → a distinct designed voice
seedVoice('__mean__');
const aname = voiceBasis.names[1];
seedVoice(aname);
let danchor = 0; for (let d = 0; d < voiceBasis.dim; d++) danchor += Math.abs(designedXvec[d] - voiceBasis.mean[d]);
assert(danchor > 1, 'anchor seed ≠ neutral');
const cv = currentVoice();
assert(cv && cv.xvector && cv.xvector.length === designedXvec.length, 'currentVoice → xvector');

const rx = qwen.synthesizeFromXvector(TEXT, designedXvec, { language: 'english', trace: true });
f = finite(rx);
console.log('  designer render (' + aname + ')', f.peak.toFixed(3), 'peak ·', (rx.samples.length / rx.sampleRate).toFixed(2) + 's ·', shapes(rx));
assert(f.bad === 0 && f.peak > 0.001, 'designer audio finite');
assert((rx.stages || []).some((s) => s.name === 'codes' && s.h === 16), 'designer codes trace');
lastResult = rx; renderStages(rx);

// two different seeds → audibly different voices (the finer-control payoff)
seedVoice(voiceBasis.names[0]);
const va = qwen.synthesizeFromXvector(TEXT, designedXvec, { language: 'english' });
seedVoice(voiceBasis.names[2]);
const vb = qwen.synthesizeFromXvector(TEXT, designedXvec, { language: 'english' });
let dvoices = 0; const nv = Math.min(va.samples.length, vb.samples.length, 24000);
for (let i = 0; i < nv; i++) dvoices += Math.abs(va.samples[i] - vb.samples[i]);
console.log('  seed', voiceBasis.names[0], '↔', voiceBasis.names[2], 'Δ', dvoices.toFixed(1));
assert(dvoices > 1, 'different seeds → different voices');

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
