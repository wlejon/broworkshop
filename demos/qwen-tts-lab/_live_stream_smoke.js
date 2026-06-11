// Headless smoke for the LIVE STREAMING change (lib/synth.js scheduleLive +
// stream→trace two-pass). Unlike _smoke.js (pure sync APIs), this drives the
// REAL async path: synthesizeStream launches a worker thread; tickAsync (pumped
// by advanceTime) drains onChunk and fires onDone. We wait by stepping virtual
// time in a bounded loop until the worker signals done — the standard headless
// idiom for an async op, capped so a stall can't hang the smoke.
const ROOT = 'D:/projects/brosoundml/weights/qwen-tts';
const TEXT = 'Hello there. This is a test of the streaming pipeline.';

// app.js init() kicks an ASYNC model load (the persisted dir) on a worker thread.
// Its onReady would clobber our variant/qwen mid-test once we start pumping. The
// worker needs real wall-time to finish (advanceTime is CPU-fast, not a sleep), so
// drain on a wall-clock bound: spin the async pump for ~8 s real, by which point
// the load has settled and fired onReady — then we own the state with sync loads.
const _t0 = performance.now();
while (performance.now() - _t0 < 8000) advanceTime(50);
bargeIn();   // drop anything that load queued

// Pump the headless tick until `flag()` is true (or the budget runs out). Each
// advanceTime call ticks the async poll; the worker runs concurrently, so real
// wall-time accrues across iterations and the generation completes.
function pump(flag, label) {
  const t0 = performance.now();                       // wall-clock bound: advanceTime is
  while (performance.now() - t0 < 30000) {             // CPU-fast (no sleep), so iteration
    if (flag()) return true;                           // counts don't track the worker's
    advanceTime(50);                                   // real generation time — wait in
  }                                                    // real seconds instead.
  assert(false, 'timed out waiting for ' + label);
  return false;
}
function finite(s) { let peak = 0, bad = 0; for (let i = 0; i < s.length; i++) { const a = Math.abs(s[i]); if (!isFinite(a)) bad++; if (a > peak) peak = a; } return { peak, bad }; }
function energy(a, b, n) { let d = 0; const m = Math.min(a.length, b.length, n || 24000); for (let i = 0; i < m; i++) d += Math.abs(a[i] - b[i]); return d; }

// One streaming run via the binding directly, pumped to completion. Returns the
// chunk count, first-chunk samples, and the full buffer — proving onChunk fires
// progressively (audio before generation finishes) and onDone delivers the whole.
function streamOnce(model, opts) {
  bargeIn();   // clear any debounced scheduleLive timer so it can't cancel this run mid-pump
  let chunks = 0, firstLen = 0, done = null;
  const o = Object.assign({}, opts, {
    chunkFrames: 8,
    onChunk: (s) => { chunks++; if (!firstLen) firstLen = s.length; },
    onDone: (r, info) => { done = { r, info }; },
  });
  bro.tts.synthesizeStream(model, TEXT, o);
  pump(() => done, 'stream onDone');
  assert(!done.info.error, 'stream error: ' + done.info.error);
  assert(!done.info.cancelled, 'stream not cancelled');
  assert(chunks > 1, 'multiple chunks delivered (progressive)');
  assert(firstLen > 0, 'first chunk had samples before generation finished');
  return { chunks, full: done.r.samples, rate: done.r.sampleRate };
}

// ── CustomVoice: preset, +logitBias, +voiceSteer, +speakerVector all stream ──
qwen = bro.tts.loadQwen(ROOT + '/0.6B-customvoice');
variant = qwen.variant; adaptToVariant();
const spk = qwen.speakers()[0];

const base = streamOnce(qwen, { speaker: spk, temperature: 0, language: 'english' });
let f = finite(base.full);
console.log('CV stream · preset', spk, '·', base.chunks, 'chunks ·', (base.full.length / base.rate).toFixed(2) + 's · peak', f.peak.toFixed(3));
assert(f.bad === 0 && f.peak > 0.01, 'streamed preset audio finite + audible');

// logitBias must reach the streamed Talker (suppress a real code from the take)
const code0 = (() => { const r = qwen.synthesize(TEXT, { speaker: spk, temperature: 0, trace: true }); const c = (r.stages || []).find((s) => s.name === 'codes'); return c ? Math.round(c.data[0]) : 0; })();
const biased = streamOnce(qwen, { speaker: spk, temperature: 0, logitBias: { [code0]: -12 } });
console.log('CV stream · logitBias code', code0, '→ Δ', energy(base.full, biased.full).toFixed(1));
assert(energy(base.full, biased.full) > 1, 'logitBias reaches the streamed take');

// voiceSteer (emotion/masc-fem slot nudge) must reach the streamed prefill slot
if (mascFemBasis) {
  setMfAlpha(mascFemBasis.defaultAlpha.M);
  const vs = voiceSteerVector();
  const steered = streamOnce(qwen, { speaker: spk, temperature: 0, voiceSteer: vs });
  console.log('CV stream · voiceSteer (masc) → Δ', energy(base.full, steered.full).toFixed(1));
  assert(energy(base.full, steered.full) > 1, 'voiceSteer reaches the streamed slot');
  resetMascFem();
}

// speakerVector (designed-voice slot replace) must stream a different voice
snapToPoint(10);
const dv = currentVoice();
assert(dv.speakerVector && dv.speakerVector.length === 1024, 'designed → speakerVector');
const designed = streamOnce(qwen, { speakerVector: dv.speakerVector, temperature: 0 });
console.log('CV stream · speakerVector (designed) → Δ', energy(base.full, designed.full).toFixed(1));
assert(energy(base.full, designed.full) > 1, 'speakerVector streams a designed voice');
usedPreset();

// ── Base: the designed x-vector streams (synthesizeStream xvector path) ───────
qwen = bro.tts.loadQwen(ROOT + '/0.6B-Base');
variant = qwen.variant; adaptToVariant();
seedVoice(voiceBasis.names[1]);
const xv = currentVoice().xvector;
assert(xv && xv.length === designedXvec.length, 'base currentVoice → xvector');
const baseStream = streamOnce(qwen, { xvector: xv, temperature: 0, language: 'english' });
f = finite(baseStream.full);
console.log('BASE stream · designed x-vector ·', baseStream.chunks, 'chunks · peak', f.peak.toFixed(3));
assert(f.bad === 0 && f.peak > 0.001, 'streamed designer x-vector audio finite + audible');

// ── seed reuse: the trace pass reproduces the streamed audio sample-for-sample ─
// The live two-pass pins the stream's resolved seed for the trace render; prove
// that contract at the binding level — same opts+seed ⇒ identical buffer (so the
// drawn trace matches what you heard, even for a sampled take).
const sampled = { speaker: spk, temperature: 0.9, topP: 0.95, seed: 4242 };
qwen = bro.tts.loadQwen(ROOT + '/0.6B-customvoice'); variant = qwen.variant; adaptToVariant();
const streamA = streamOnce(qwen, sampled);
const traceR = qwen.synthesize(TEXT, Object.assign({}, sampled, { trace: true }));   // sync trace pass, same seed
console.log('seed reuse · stream↔trace Δ', energy(streamA.full, traceR.samples, 48000).toFixed(4),
            '· codes', (traceR.stages || []).some((s) => s.name === 'codes' && s.h === 16));
assert(energy(streamA.full, traceR.samples, 48000) < 1e-2, 'same seed ⇒ trace matches the streamed audio');
assert((traceR.stages || []).some((s) => s.name === 'codes' && s.h === 16), 'trace pass yields the 16xF code raster');

console.log('LIVE STREAM SMOKE PASSED');
