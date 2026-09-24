// ARDY Motion worker — owns the native bro.motion pipeline.
//
// A long-lived inference server: load the checkpoints once (an 8B LLM2Vec text
// encoder + the ARDY motion model), then generate many clips. generate() is a
// single synchronous native call; it blocks THIS thread, not the page.
//
//   load     { checkpoint, textEncoder, device } -> loaded { device }
//   generate { text, opts }                      -> generated { clip }  (buffers transferred)

import { serveWorker } from "/lib/kit/worker-rpc.js";

let pipeline = null;

serveWorker({
    load(msg) {
        if (typeof bro === 'undefined' || !bro.motion || !bro.motion.load) {
            throw new Error('bro.motion is not available in this build (needs the full profile: BRO_WITH_DIFFUSION + BRO_WITH_LM)');
        }
        pipeline = null;
        bro.motion.init();
        pipeline = bro.motion.load({ checkpoint: msg.checkpoint, textEncoder: msg.textEncoder, device: msg.device || 'cuda' });
        return { type: 'loaded', device: pipeline.device };
    },
    generate(msg) {
        if (!pipeline) throw new Error('no pipeline loaded');
        const t0 = Date.now();
        const clip = pipeline.generate(msg.text || '', msg.opts || {});
        return {
            type: 'generated', clip, ms: Date.now() - t0,
            transfer: [clip.positions.buffer, clip.parents.buffer, clip.footContacts.buffer],
        };
    },
});
