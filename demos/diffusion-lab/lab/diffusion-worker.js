// Diffusion Lab worker — owns the SD1.5 Pipeline built from a profile spec.
//
//   load {spec} -> loaded {config, numXAttnBlocks, lorasApplied, backend}
//   + the kit's prime / step / reset / search / remove (lib/kit/imagegen-worker.js)
//
// `spec` comes from lab/profiles.js buildSpec() plus the lab's adapter lists:
// { kind: 'createPipeline', pipeline, weights: {text, unet, vae},
//   loras: [{path, scale}], controlnets: [{path}] }.
//
// The page sends each step's `ctrl` ({ trace: true } to capture
// cross-attention, { attnBias } to steer it) and asks for a decoded preview
// every step, which is what makes the trajectory scrubbable. Word axes use the
// CLIP recipe: no massive-activation zeroing (CLIP has no outlier sink
// channels), and brodiffusion's SD1.5 seam steers content rows only.

import { serveWorker } from "/lib/kit/worker-rpc.js";
import { stepHandlers, requireDiffusion, backendName } from "/lib/kit/imagegen-worker.js";

let pipeline = null;

serveWorker(Object.assign(stepHandlers(() => pipeline), {
    load(msg) {
        const spec = msg.spec;
        const diffusion = requireDiffusion();
        if (spec.kind !== 'createPipeline') throw new Error('unknown pipeline spec: ' + spec.kind);
        if (pipeline) { try { pipeline.dispose(); } catch (_) {} pipeline = null; }
        diffusion.init();
        const p = diffusion.createPipeline(spec.pipeline);
        const w = spec.weights;
        p.loadWeights(w.text, w.unet, w.vae);
        // LoRA merges into the loaded weights and cannot be undone, so a
        // changed adapter set always means a reload from the base weights.
        const loras = spec.loras || [];
        for (const l of loras) p.applyLora(l.path, l.scale);
        // ControlNets register in list order: index i is opts.controls[i] at prime.
        for (const cn of spec.controlnets || []) p.addControlNet(cn.path);
        pipeline = p;
        return { type: 'loaded', config: p.config(), numXAttnBlocks: p.numXAttnBlocks(),
                 lorasApplied: loras.length, backend: backendName() };
    },
}));
