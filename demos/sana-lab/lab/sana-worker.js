// Sana Lab worker — owns the native Sana pipeline.
//
//   load        {modelDir}      -> loaded {config, backend}
//   anchor      {prompt, opts}  -> anchorSet {bitmap, width, height, ms}
//   clearAnchor {}              -> anchorCleared {}
//   + the kit's prime / step / reset / search / remove (lib/kit/imagegen-worker.js)
//
// The identity anchor is Sana's training-free reference-attention seam:
// setIdentityAnchor renders the anchor prompt once while recording per-step
// linear-attention summaries; prime() then adds them back scaled by the
// identityWeight the page sends, so the face holds while prompt and axes move.
//
// Word axes are Gemma-conditioned, so they zero Gemma's "massive activation"
// channels — a handful of huge-norm attention-sink dims; an injection along
// them destabilises the run (sana-research fit_axis.py).

import { serveWorker } from "/lib/kit/worker-rpc.js";
import { stepHandlers, loadFamily, backendName, applyControls, imageReply } from "/lib/kit/imagegen-worker.js";

const MASSIVE = [334, 976, 1173, 593, 1304, 1535, 833, 1142, 184];

let pipeline = null;
const need = () => { if (!pipeline) throw new Error('no model loaded'); return pipeline; };

serveWorker(Object.assign(stepHandlers(() => pipeline, { zeroDims: MASSIVE }), {
    load(msg) {
        if (pipeline) { try { pipeline.dispose(); } catch (_) {} pipeline = null; }
        pipeline = loadFamily(msg.modelDir, 'Sana', 'the control seams are Gemma-conditioned (Sana only)');
        return { type: 'loaded', config: pipeline.config(), backend: backendName() };
    },
    anchor(msg) {
        const p = need();
        applyControls(p, {});               // capture the clean identity, unsteered
        p.setIdentityWeight(0);             // the anchor renders itself, no injection
        const t0 = Date.now();
        const img = p.setIdentityAnchor(msg.prompt, msg.opts || {});
        return imageReply('anchorSet', img, { ms: Date.now() - t0 });
    },
    clearAnchor() {
        if (pipeline) pipeline.clearIdentityAnchor();
        return { type: 'anchorCleared' };
    },
}));
