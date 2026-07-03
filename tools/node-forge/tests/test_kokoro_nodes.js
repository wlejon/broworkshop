// Headless test — the Kokoro node set, against a real converted model.
//
// Gated on bro.tensor's GPU backend and the model/data directories actually
// existing on disk, same pattern test_rave_nodes.js uses.
import { Graph } from "/app/lab/graph.js";
import { Runner } from "/app/lab/runner.js";

flush();
advanceTime(200);
flush();

const DATA_ROOT = 'D:/projects/brosoundml-data';
const MODEL_DIR = DATA_ROOT + '/kokoro';
const VOICE_FILE = MODEL_DIR + '/voices/af_heart.bin';
const BASIS_FILE = MODEL_DIR + '/voice_basis.json';
const _fs = (typeof require === 'function') ? require('fs') : null;
const ready = !!(_fs && _fs.existsSync(MODEL_DIR + '/config.json') &&
  _fs.existsSync(VOICE_FILE) && _fs.existsSync(BASIS_FILE) &&
  _fs.existsSync(DATA_ROOT + '/g2p/lexicon_en_us.bin'));

if (!bro.tensor || !bro.tensor.available) {
  console.log('TEST SKIP: no GPU tensor backend');
} else if (!ready) {
  console.log('TEST SKIP: Kokoro model/voice/basis/phonemizer assets not found under ' + DATA_ROOT);
} else {
  try { bro.tensor.init(); } catch (e) {}

  const G = Graph.create();
  const load = G.addNode('kokoro-load', 0, 0);
  load.params.dir = MODEL_DIR; load.params.dataRoot = DATA_ROOT;
  const basis = G.addNode('kokoro-basis', 0, 150);
  basis.params.path = BASIS_FILE;
  const design = G.addNode('kokoro-voice-design', 200, 75);
  const text = G.addNode('kokoro-text', 200, 250);
  text.params.text = 'Hello, Bro.';
  const synth = G.addNode('kokoro-synthesize', 400, 100);
  const prosody = G.addNode('kokoro-prosody-edit', 600, 200);
  const redecode = G.addNode('kokoro-redecode', 800, 200);
  const previewA = G.addNode('audio-preview', 600, 0);
  const previewB = G.addNode('audio-preview', 1000, 200);

  assert(G.addEdge(load, 0, design, 0) !== null, 'kokoro-load -> kokoro-voice-design (model-handle)');
  assert(G.addEdge(basis, 0, design, 1) !== null, 'kokoro-basis -> kokoro-voice-design (voice-basis)');
  assert(G.addEdge(load, 0, text, 0) !== null, 'kokoro-load -> kokoro-text (model-handle)');
  assert(G.addEdge(load, 0, synth, 0) !== null, 'kokoro-load -> kokoro-synthesize (model-handle)');
  assert(G.addEdge(design, 0, synth, 1) !== null, 'kokoro-voice-design -> kokoro-synthesize (voice-handle)');
  assert(G.addEdge(text, 0, synth, 2) !== null, 'kokoro-text -> kokoro-synthesize (phoneme-ids)');
  assert(G.addEdge(synth, 0, previewA, 0) !== null, 'kokoro-synthesize audio -> audio-preview');
  assert(G.addEdge(synth, 1, prosody, 0) !== null, 'kokoro-synthesize trace -> kokoro-prosody-edit');
  assert(G.addEdge(load, 0, redecode, 0) !== null, 'kokoro-load -> kokoro-redecode (model-handle)');
  assert(G.addEdge(design, 0, redecode, 1) !== null, 'kokoro-voice-design -> kokoro-redecode (voice-handle)');
  assert(G.addEdge(prosody, 0, redecode, 2) !== null, 'kokoro-prosody-edit -> kokoro-redecode (edited trace)');
  assert(G.addEdge(redecode, 0, previewB, 0) !== null, 'kokoro-redecode audio -> audio-preview');

  // cross-domain port-type rejection
  assert(G.addEdge(basis, 0, synth, 1) === null, 'voice-basis cannot wire into a voice-handle port');
  assert(G.addEdge(text, 0, design, 1) === null, 'phoneme-ids cannot wire into a voice-basis port');

  G.propagate();
  for (const n of G.nodes) assert(!n.error, n.type + ' has a shape error: ' + n.error);

  const R = Runner.create(G);
  assert(R.ready(), 'GPU backend ready');
  const t0 = Date.now();
  const ran = R.run();
  console.log('TEST: full run executed', ran, 'nodes in', Date.now() - t0, 'ms');
  assert(ran === 9, 'all 9 nodes executed: ' + ran);

  const kokoro = load._out[0];
  console.log('TEST: model — nTokens', kokoro.nTokens, 'styleDim', kokoro.styleDim, 'hiddenDim', kokoro.hiddenDim);
  const basisData = basis._out[0];
  console.log('TEST: basis — k =', basisData.k, ', ', basisData.names.length, 'named presets');
  assert(design.params.coords && design.params.coords.length === basisData.k,
    'kokoro-voice-design populated node.params.coords sized to the basis');

  const audioA = previewA._buf;
  assert(audioA && audioA.samples.length > 0, 'kokoro-synthesize produced audio');
  let finiteA = true, peakA = 0;
  for (let i = 0; i < audioA.samples.length; i++) {
    if (!isFinite(audioA.samples[i])) finiteA = false;
    peakA = Math.max(peakA, Math.abs(audioA.samples[i]));
  }
  assert(finiteA, 'synthesized audio is all finite');
  assert(peakA > 1e-4, 'synthesized audio is not silence: peak=' + peakA);

  assert(prosody.params.f0 && prosody.params.f0.length > 0, 'kokoro-prosody-edit populated node.params.f0');
  assert(prosody.params.energy && prosody.params.energy.length > 0, 'kokoro-prosody-edit populated node.params.energy');

  const audioB1 = previewB._buf;
  assert(audioB1 && audioB1.samples.length > 0, 'kokoro-redecode produced audio');

  // --- incremental-invalidation regression test ---------------------------
  const synthOutBefore = synth._out;
  const designOutBefore = design._out;
  const loadOutBefore = load._out;
  const basisOutBefore = basis._out;
  const textOutBefore = text._out;

  // paint a large, obvious offset into the pitch (F0) contour
  const f0 = prosody.params.f0;
  for (let t = 0; t < f0.length; t++) f0[t] += 40.0;

  G.invalidateFrom(prosody);
  assert(synth._ran === true, 'invalidateFrom(prosody) leaves upstream kokoro-synthesize marked ran');
  assert(design._ran === true && load._ran === true && basis._ran === true && text._ran === true,
    'invalidateFrom(prosody) leaves every other upstream node untouched');

  const done = R.continue();
  console.log('TEST: incremental continue() re-ran', done, 'node(s) after a prosody edit');
  assert(done === 3, 'continue() re-ran exactly prosody-edit, redecode, and its audio-preview: ' + done);

  assert(synth._out === synthOutBefore, 'kokoro-synthesize was NOT re-executed (same cached _out reference)');
  assert(design._out === designOutBefore && load._out === loadOutBefore &&
    basis._out === basisOutBefore && text._out === textOutBefore,
    'kokoro-load/basis/text/voice-design all untouched by the downstream-only re-run');

  const audioB2 = previewB._buf;
  let same = audioB2.samples.length === audioB1.samples.length;
  if (same) {
    let maxDiff = 0;
    for (let i = 0; i < audioB2.samples.length; i++) maxDiff = Math.max(maxDiff, Math.abs(audioB2.samples[i] - audioB1.samples[i]));
    console.log('TEST: max sample difference after the prosody edit =', maxDiff.toFixed(5));
    same = maxDiff < 1e-6;
  }
  assert(!same, 'redecoded audio actually changed after editing the pitch contour');
  let finiteB2 = true;
  for (let i = 0; i < audioB2.samples.length; i++) if (!isFinite(audioB2.samples[i])) finiteB2 = false;
  assert(finiteB2, 'redecoded audio after the edit is still all finite');

  // --- the simpler named-voice path (kokoro-voice), sanity-checked separately
  const G2 = Graph.create();
  const load2 = G2.addNode('kokoro-load', 0, 0);
  load2.params.dir = MODEL_DIR; load2.params.dataRoot = DATA_ROOT;
  const voice2 = G2.addNode('kokoro-voice', 200, 0);
  voice2.params.path = VOICE_FILE;
  const text2 = G2.addNode('kokoro-text', 200, 150);
  text2.params.text = 'A quick check of the named voice path.';
  const synth2 = G2.addNode('kokoro-synthesize', 400, 75);
  const preview2 = G2.addNode('audio-preview', 600, 75);
  G2.addEdge(load2, 0, voice2, 0);
  G2.addEdge(load2, 0, text2, 0);
  G2.addEdge(load2, 0, synth2, 0);
  G2.addEdge(voice2, 0, synth2, 1);
  G2.addEdge(text2, 0, synth2, 2);
  G2.addEdge(synth2, 0, preview2, 0);
  G2.propagate();
  for (const n of G2.nodes) assert(!n.error, 'named-voice graph: ' + n.type + ' has a shape error: ' + n.error);
  const R2 = Runner.create(G2);
  const ran2 = R2.run();
  assert(ran2 === 5, 'named-voice graph runs end to end: ' + ran2);
  assert(preview2._buf && preview2._buf.samples.length > 0, 'named-voice path produced audio');

  console.log('TEST_KOKORO_NODES DONE');
}
flush();
