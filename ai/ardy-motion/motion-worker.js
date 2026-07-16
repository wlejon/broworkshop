// ARDY Motion worker — owns the native bro.motion pipeline.
//
// A long-lived inference server: load the checkpoints once (an 8B LLM2Vec text
// encoder + the ARDY motion model), then generate many clips. generate() is a
// single synchronous native call — it blocks THIS worker thread, not the main
// thread — so the protocol is plain request/reply and the UI shows a spinner.
//
//   main -> load     {paths}          ->  loaded {device}
//   main -> generate {text, opts}     ->  generated {clip}  (buffers transferred)
//   errors come back as               ->  error {stage, message}

var pipeline = null;

function fail(stage, err) {
  self.postMessage({
    type: 'error',
    stage: stage,
    message: (err && err.message) ? err.message : String(err),
  });
}

function handleLoad(paths) {
  try {
    if (typeof bro === 'undefined' || !bro.motion || !bro.motion.load) {
      throw new Error('bro.motion is not available in this build '
        + '(needs the full profile: BRO_WITH_DIFFUSION + BRO_WITH_LM)');
    }
    bro.motion.init();
    pipeline = bro.motion.load({
      checkpoint: paths.checkpoint,
      textEncoder: paths.textEncoder,
      device: paths.device || 'cuda',
    });
    self.postMessage({ type: 'loaded', device: pipeline.device });
  } catch (e) {
    pipeline = null;
    fail('load', e);
  }
}

function handleGenerate(msg) {
  try {
    if (!pipeline) throw new Error('no pipeline loaded');
    var clip = pipeline.generate(msg.text || '', msg.opts || {});
    // Transfer the per-frame joint buffers back to the main thread zero-copy.
    var transfer = [
      clip.positions.buffer, clip.parents.buffer, clip.footContacts.buffer,
    ];
    self.postMessage({ type: 'generated', clip: clip }, transfer);
  } catch (e) {
    fail('generate', e);
  }
}

self.onmessage = function (e) {
  var msg = e.data || {};
  switch (msg.type) {
    case 'load':     handleLoad(msg.paths); break;
    case 'generate': handleGenerate(msg); break;
    default:         fail('dispatch', new Error('unknown message: ' + msg.type));
  }
};

self.postMessage({ type: 'ready' });
