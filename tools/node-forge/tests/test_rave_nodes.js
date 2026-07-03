// Headless test — the RAVE node set, against a real converted model.
//
// Gated on both bro.tensor's GPU backend and the model directory actually
// existing on disk, same pattern test_new_ops.js uses for bro.tensor.available.
import { Graph } from "/app/lab/graph.js";
import { Runner } from "/app/lab/runner.js";

flush();
advanceTime(200);
flush();

const MODEL_DIR = 'D:/projects/brosoundml-data/rave/magnets_z8';
const _fs = (typeof require === 'function') ? require('fs') : null;
const modelExists = !!(_fs && _fs.existsSync(MODEL_DIR + '/config.json'));

if (!bro.tensor || !bro.tensor.available) {
  console.log('TEST SKIP: no GPU tensor backend');
} else if (!modelExists) {
  console.log('TEST SKIP: no RAVE model at ' + MODEL_DIR);
} else {
  try { bro.tensor.init(); } catch (e) {}

  const G = Graph.create();
  const load = G.addNode('rave-load', 0, 0);
  load.params.dir = MODEL_DIR;
  const source = G.addNode('rave-source', 200, 0);
  source.params.kind = 'harm'; source.params.freq = 220; source.params.secs = 1.0;
  const encode = G.addNode('rave-encode', 400, 0);
  const curve = G.addNode('rave-curve-edit', 600, 0);
  const decode = G.addNode('rave-decode', 800, 0);
  const preview = G.addNode('audio-preview', 1000, 0);

  assert(G.addEdge(load, 0, source, 0) !== null, 'rave-load -> rave-source (model-handle)');
  assert(G.addEdge(load, 0, encode, 0) !== null, 'rave-load -> rave-encode (model-handle)');
  assert(G.addEdge(source, 0, encode, 1) !== null, 'rave-source -> rave-encode (audio-buffer)');
  assert(G.addEdge(encode, 0, curve, 0) !== null, 'rave-encode -> rave-curve-edit (audio-latent-grid)');
  assert(G.addEdge(load, 0, decode, 0) !== null, 'rave-load -> rave-decode (model-handle)');
  assert(G.addEdge(curve, 0, decode, 1) !== null, 'rave-curve-edit -> rave-decode (audio-latent-grid)');
  assert(G.addEdge(decode, 0, preview, 0) !== null, 'rave-decode -> audio-preview (audio-buffer)');

  // cross-domain port-type rejection: an audio-buffer cannot feed a
  // model-handle input, even though both are "just objects" underneath.
  assert(G.addEdge(source, 0, decode, 0) === null,
    'audio-buffer cannot wire into a model-handle port');

  G.propagate();
  for (const n of G.nodes) {
    assert(!n.error, n.type + ' has a shape error: ' + n.error);
  }

  const R = Runner.create(G);
  assert(R.ready(), 'GPU backend ready');
  const t0 = Date.now();
  const ran = R.run();
  console.log('TEST: full run executed', ran, 'nodes in', Date.now() - t0, 'ms');
  assert(ran === 6, 'all 6 nodes executed: ' + ran);

  const rave = load._out[0];
  console.log('TEST: model —', rave.nLatent, 'of', rave.fullLatent, 'latents, sr', rave.sampleRate);
  assert(rave.nLatent > 0, 'loaded model reports a positive latent count');

  const grid1 = curve._out[0];
  assert(grid1.nLatent === rave.nLatent, 'curve-edit output nLatent matches the model');
  assert(curve.params.curves && curve.params.curves.length === rave.nLatent,
    'curve-edit populated node.params.curves as plain arrays, one per latent dim');

  const outBuf1 = decode._out[0];
  assert(outBuf1.samples.length > 0, 'decode produced samples');
  let finite1 = true, peak1 = 0;
  for (let i = 0; i < outBuf1.samples.length; i++) {
    const v = outBuf1.samples[i];
    if (!isFinite(v)) finite1 = false;
    if (Math.abs(v) > peak1) peak1 = Math.abs(v);
  }
  assert(finite1, 'decoded output is all finite');
  assert(peak1 > 1e-4, 'decoded output is not silence: peak=' + peak1);

  // --- the incremental-invalidation regression test ---------------------
  // editing the curve node and re-running via invalidateFrom+continue must
  // NOT re-execute rave-encode (or rave-load/rave-source upstream of it).
  const encodeOutBefore = encode._out;
  const encodeTimeBefore = encode._time;
  const loadOutBefore = load._out;
  const sourceOutBefore = source._out;

  // paint a large, obvious offset into latent dim 0 (usually loudness)
  const d0 = curve.params.curves[0];
  for (let t = 0; t < d0.length; t++) d0[t] += 5.0;

  G.invalidateFrom(curve);
  assert(encode._ran === true, 'invalidateFrom(curve) leaves upstream rave-encode marked ran');
  assert(load._ran === true && source._ran === true, 'invalidateFrom(curve) leaves rave-load/rave-source untouched');

  const done = R.continue();
  console.log('TEST: incremental continue() re-ran', done, 'node(s) after a curve edit');
  assert(done === 3, 'continue() re-ran exactly the edited node and its downstream (curve-edit, decode, audio-preview), not the whole graph: ' + done);

  assert(encode._out === encodeOutBefore, 'rave-encode was NOT re-executed (same cached _out reference)');
  assert(encode._time === encodeTimeBefore, 'rave-encode _time untouched — it did not actually run again');
  assert(load._out === loadOutBefore && source._out === sourceOutBefore,
    'rave-load/rave-source also untouched by the downstream-only re-run');

  const outBuf2 = decode._out[0];
  let same = outBuf2.samples.length === outBuf1.samples.length;
  if (same) {
    let maxDiff = 0;
    for (let i = 0; i < outBuf2.samples.length; i++) maxDiff = Math.max(maxDiff, Math.abs(outBuf2.samples[i] - outBuf1.samples[i]));
    console.log('TEST: max sample difference after the curve edit =', maxDiff.toFixed(5));
    same = maxDiff < 1e-6;
  }
  assert(!same, 'decoded output actually changed after editing the latent curve');

  let finite2 = true;
  for (let i = 0; i < outBuf2.samples.length; i++) if (!isFinite(outBuf2.samples[i])) finite2 = false;
  assert(finite2, 'decoded output after the edit is still all finite');

  console.log('TEST_RAVE_NODES DONE');
}
flush();
