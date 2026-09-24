// PixArt Lab worker — owns the native PixArt-Sigma pipeline.
//
//   load {modelDir}  -> loaded {config, backend}
//   + the kit's step-wise prime / step / reset (lib/kit/imagegen-worker.js)
//
// Load the multi-GB weights once, then run many generations; the page paces
// the denoising loop one step per request.

import { serveWorker } from "/lib/kit/worker-rpc.js";
import { stepHandlers, loadFamily, backendName } from "/lib/kit/imagegen-worker.js";

let pipeline = null;

serveWorker(Object.assign(stepHandlers(() => pipeline), {
    load(msg) {
        if (pipeline) { try { pipeline.dispose(); } catch (_) {} pipeline = null; }
        pipeline = loadFamily(msg.modelDir, 'PixArt', 'point at a PixArt-Sigma diffusers directory');
        return { type: 'loaded', config: pipeline.config(), backend: backendName() };
    },
}));
