// TripoSplat Lab worker — owns the native pipeline.
//
// Load the checkpoints once, then reconstruct many images. generate() is one
// synchronous native call that blocks THIS thread, so a cancel cannot arrive
// as a message: the page flips the native flag with bro.triposplat.cancel()
// and generate() returns a { cancelled: true } marker.
//
//   load     { weights }        -> loaded { device, backgroundRemoval }
//   generate { image, opts }    -> generated { cloud, ms } (buffers transferred) | cancelled

import { serveWorker } from "/lib/kit/worker-rpc.js";

let pipeline = null;

serveWorker({
    load(msg) {
        if (typeof bro === 'undefined' || !bro.triposplat) throw new Error('bro.triposplat is not available in this build');
        pipeline = null;
        bro.triposplat.init();
        pipeline = bro.triposplat.load(msg.weights);
        return { type: 'loaded', device: pipeline.device, backgroundRemoval: !!pipeline.backgroundRemoval };
    },
    generate(msg) {
        if (!pipeline) throw new Error('no pipeline loaded');
        const t0 = Date.now();
        const cloud = pipeline.generate(msg.image, msg.opts || {});
        if (cloud && cloud.cancelled) return { type: 'cancelled' };
        return {
            type: 'generated', cloud, ms: Date.now() - t0,
            transfer: [cloud.positions.buffer, cloud.scales.buffer, cloud.rotations.buffer, cloud.opacities.buffer, cloud.sh.buffer],
        };
    },
});
