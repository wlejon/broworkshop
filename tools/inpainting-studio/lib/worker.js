// worker.js — owns the SD1.5 inpainting pipeline (and the depth estimator).
//
//   load  {modelDir, controlnets: [{kind, path}]} -> loaded {config, scheduler, controlnets, backend}
//   depth {weights, imagePath}                    -> depthMap {width, height, gray}
//   + the kit's prime / step / reset (lib/kit/imagegen-worker.js): the page
//     primes with initImagePath + maskImagePath (+ controls) in the opts.
//
// A diffusers-layout SD1.5 checkpoint (text_encoder/ unet/ vae/ tokenizer/)
// builds through createPipeline, as demos/diffusion-lab does; an "lcm" in the
// directory name picks the LCM scheduler. ControlNets register in list order,
// which is the order of opts.controls at prime.

import { serveWorker } from "/lib/kit/worker-rpc.js";
import { stepHandlers, requireDiffusion, backendName } from "/lib/kit/imagegen-worker.js";

const fs = require('fs');
const exists = (p) => { try { return fs.existsSync(p); } catch (_) { return false; } };
const pick = (dir, names) => names.map((n) => dir + '/' + n).find(exists) || null;

let pipeline = null;
let depthModel = null, depthDir = '';

/** Component paths of a diffusers SD1.5 directory; throws naming what is missing. */
function resolveSd15(dir) {
    const vocab = dir + '/tokenizer/vocab.json', merges = dir + '/tokenizer/merges.txt';
    if (!exists(vocab) || !exists(merges)) throw new Error(dir + ': tokenizer/ needs vocab.json and merges.txt');
    const text = pick(dir + '/text_encoder', ['model.fp16.safetensors', 'model.safetensors']);
    const unet = pick(dir + '/unet', ['diffusion_pytorch_model.fp16.safetensors', 'diffusion_pytorch_model.safetensors']);
    const vae = pick(dir + '/vae', ['diffusion_pytorch_model.fp16.safetensors', 'diffusion_pytorch_model.safetensors']);
    const miss = [!text && 'text_encoder', !unet && 'unet', !vae && 'vae'].filter(Boolean);
    if (miss.length) throw new Error(dir + ': no safetensors in ' + miss.join(', '));
    return { vocab, merges, text, unet, vae };
}

serveWorker(Object.assign(stepHandlers(() => pipeline), {
    load(msg) {
        const diffusion = requireDiffusion();
        const dir = String(msg.modelDir).replace(/\\/g, '/').replace(/\/+$/, '');
        const r = resolveSd15(dir);
        if (pipeline) { try { pipeline.dispose(); } catch (_) {} pipeline = null; }
        diffusion.init();
        const scheduler = /lcm/i.test(dir.split('/').pop()) ? 'lcm' : 'ddim';
        const p = diffusion.createPipeline({ vocabPath: r.vocab, mergesPath: r.merges, scheduler,
                                             lcmDistilled: false, quantizeWeights: false });
        p.loadWeights(r.text, r.unet, r.vae);
        const kinds = [];
        for (const cn of msg.controlnets || []) {
            // A diffusers ControlNet dir or the .safetensors file itself.
            const file = /\.safetensors$/i.test(cn.path) ? cn.path
                : pick(cn.path, ['diffusion_pytorch_model.fp16.safetensors', 'diffusion_pytorch_model.safetensors']);
            if (!file) throw new Error(cn.path + ': no ControlNet safetensors');
            p.addControlNet(file);
            kinds.push(cn.kind);
        }
        pipeline = p;
        return { type: 'loaded', config: p.config(), scheduler, controlnets: kinds, backend: backendName() };
    },

    depth(msg) {
        if (!bro.vision || bro.vision.available === false) throw new Error('bro.vision is not in this build');
        if (!depthModel || depthDir !== msg.weights) {
            if (depthModel) { try { depthModel.dispose(); } catch (_) {} }
            depthModel = bro.vision.loadDepth(msg.weights);
            depthDir = msg.weights;
        }
        const d = depthModel.estimate(msg.imagePath);
        return { type: 'depthMap', width: d.width, height: d.height, gray: d.gray, transfer: [d.gray.buffer] };
    },
}));
