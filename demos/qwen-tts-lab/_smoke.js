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

// ── codec round-trip seam ────────────────────────────────────────────────────
const enc = qwen.encodeAudio(rx.samples.slice(0, 24000 * 2), { sampleRate: rx.sampleRate });
const back = qwen.decodeCodes(enc.codes, enc.numQuantizers, enc.numFrames);
console.log('  codec', enc.numQuantizers + 'x' + enc.numFrames, 'codes →', back.samples.length, 'samples');
assert(enc.numQuantizers === 16 && back.samples.length > 0, 'encode→decode round-trip');

// ── UI render check ──────────────────────────────────────────────────────────
flush();
screenshot('_ui.png');
console.log('ALL SMOKE CHECKS PASSED');
