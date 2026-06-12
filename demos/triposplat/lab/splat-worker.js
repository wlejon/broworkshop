// TripoSplat Lab worker — owns the native pipeline and runs reconstruction.
//
// A long-lived inference server: load the checkpoints once, then reconstruct
// many images. generate() is a single synchronous native call (it blocks this
// worker thread, not the main thread), so the protocol is plain request/reply
// with no per-step streaming — the main thread shows an indeterminate spinner
// and elapsed timer while it runs.
//
//   main -> load     {weights}        ->  loaded {device, backgroundRemoval}
//   main -> generate {image, opts}    ->  generated {cloud}   (buffers transferred)
//   errors come back as               ->  error {stage, message}

var pipeline = null;

function fail(stage, err) {
  self.postMessage({
    type: 'error',
    stage: stage,
    message: (err && err.message) ? err.message : String(err),
  });
}

function handleLoad(weights) {
  try {
    if (typeof bro === 'undefined' || !bro.triposplat) {
      throw new Error('bro.triposplat is not available in this build');
    }
    bro.triposplat.init();
    pipeline = bro.triposplat.load(weights);
    self.postMessage({
      type: 'loaded',
      device: pipeline.device,
      backgroundRemoval: !!pipeline.backgroundRemoval,
    });
  } catch (e) {
    pipeline = null;
    fail('load', e);
  }
}

function handleGenerate(msg) {
  try {
    if (!pipeline) throw new Error('no pipeline loaded');
    // msg.image is { data: Uint8ClampedArray, width, height } — generate()
    // reads it directly (the binding accepts the ImageData shape).
    var cloud = pipeline.generate(msg.image, msg.opts || {});
    // generate() returns a small { cancelled: true } marker when the main
    // thread asked it to abort (bro.triposplat.cancel) — relay, don't transfer.
    if (cloud && cloud.cancelled) { self.postMessage({ type: 'cancelled' }); return; }
    // Transfer the SoA buffers back zero-copy.
    var transfer = [
      cloud.positions.buffer, cloud.scales.buffer, cloud.rotations.buffer,
      cloud.opacities.buffer, cloud.sh.buffer,
    ];
    self.postMessage({ type: 'generated', cloud: cloud }, transfer);
  } catch (e) {
    fail('generate', e);
  }
}

self.onmessage = function (e) {
  var msg = e.data || {};
  switch (msg.type) {
    case 'load':     handleLoad(msg.weights); break;
    case 'generate': handleGenerate(msg); break;
    default:         fail('dispatch', new Error('unknown message: ' + msg.type));
  }
};

self.postMessage({ type: 'ready' });
