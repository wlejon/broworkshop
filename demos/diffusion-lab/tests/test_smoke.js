// Diffusion Lab smoke test: the lab boots, the CLIP tokenizer matches the real
// vocab, profile detection resolves every component, the attention heatmap
// and steering math are right, and the img2img / ControlNet options reach the
// GenerateOptions bag. Loads no model weights.
//
//   scripts/validate.sh --ml demos/diffusion-lab

import { check, eq, near, test, done } from "/lib/kit/test.js";
import { findWeights } from "/lib/kit/weights.js";
import { Tokenizer } from "/app/lab/tokenizer.js";
import { Profiles } from "/app/lab/profiles.js";
import { Attention } from "/app/lab/attention.js";
import { dlab, prefs } from "/app/lab.js";

const saved = prefs.snapshot();
const fs = require('fs');

try {
    test('lab boots', () => {
        check(dlab.panel && dlab.axes && dlab.strip && dlab.insp && dlab.adapters, 'handle parts');
        check(document.querySelector('.k-gen'), 'generate panel rendered');
        check(document.querySelectorAll('[data-field]').length === 5, 'five settings fields');
        check(dlab.panel.generate.disabled, 'Generate disabled before a load');
    });

    const modelDir = findWeights(['brodiffusion/weights/sd15', 'brodiffusion/weights/lcm-dreamshaper'], { probe: 'tokenizer/vocab.json' });
    if (!modelDir) {
        console.log('SKIP tokenizer/profile checks (no SD1.5 weights under the weights root)');
    } else {
        test('tokenizer matches the real CLIP vocab', () => {
            const base = modelDir + '/tokenizer/';
            const tk = Tokenizer.create(fs.readFileSync(base + 'vocab.json', 'utf-8'), fs.readFileSync(base + 'merges.txt', 'utf-8'));
            eq(tk.vocabCount(), 49408, 'vocab count');
            const enc = tk.encodeContext('a fox in autumn leaves');
            eq(enc.ids.length, 77, 'context length');
            eq(enc.ids[0], 49406, 'BOS at slot 0');
            check(enc.tokens.length >= 5, 'content tokens ' + enc.tokens.length);
            eq(enc.ids[enc.eosIndex], 49407, 'EOS at content end');
            eq(enc.tokens[0].contextIndex, 1, 'first content slot');
        });
        test('profile detection resolves the components', () => {
            const det = Profiles.detect(modelDir);
            eq(det.profileId, 'sd15', 'profile');
            check(/unet/.test(det.weights.unet) && /vae/.test(det.weights.vae), 'unet / vae weights');
            const spec = det.profile.buildSpec(det, 'ddim');
            eq(spec.pipeline.scheduler, 'ddim', 'scheduler');
            eq(spec.pipeline.quantizeWeights, false, 'quantize defaults off');
            const q = det.profile.buildSpec(det, 'lcm', true);
            check(q.pipeline.quantizeWeights && q.pipeline.scheduler === 'lcm', 'quantize flag honoured');
            // LCM sampling on a vanilla checkpoint is the LCM-LoRA workflow; the
            // checkpoint, not the sampler, decides the cond_proj path.
            check(!q.pipeline.lcmDistilled && !spec.pipeline.lcmDistilled, 'lcmDistilled decoupled from scheduler');
        });
        test('the default model is adopted and the prompt tokenized', () => {
            check(dlab.state().detected, 'detected');
            check(document.querySelectorAll('#tokens .tok').length > 0, 'token chips');
        });
    }

    test('attention heatmap math', () => {
        const trace = [{ Lq: 256, Lk: 77, data: new Float32Array(256 * 77) }];
        trace[0].data[5 * 77 + 3] = 1.0;                        // query 5 attends to token 3
        const hm = Attention.computeHeatmap(trace, 3, 0, 16, 16);
        check(hm && hm.w === 16 && hm.h === 16, 'dims 16x16');
        eq(hm.values[5], 1, 'peak at q=5');
        const opts = Attention.blockOptions(trace, 16, 16);
        check(opts.length === 2 && opts[0].value === 'avg', 'block options');
        // Contrastive normalisation cancels a signal shared across content tokens.
        const ct = [{ Lq: 4, Lk: 77, data: new Float32Array(4 * 77) }];
        const setw = (qi, k, v) => { ct[0].data[qi * 77 + k] = v; };
        setw(0, 3, 0.8); setw(1, 3, 0.8); setw(2, 3, 0.5); setw(3, 3, 0.1);
        setw(0, 5, 0.8); setw(1, 5, 0.8); setw(2, 5, 0.1); setw(3, 5, 0.1);
        const raw = Attention.computeHeatmap(ct, 3, 0, 2, 2);
        check(raw.values[0] === 1 && raw.values[2] < 1, 'raw column peaks on the shared signal');
        const con = Attention.computeHeatmap(ct, 3, 0, 2, 2, [3, 5]);
        check(con.values[2] === 1 && con.values[0] === 0, 'contrastive column peaks on the token-specific query');
    });

    test('attnBias construction', () => {
        const shapes = [{ Lq: 4, Lk: 77 }, { Lq: 256, Lk: 77 }];
        const bias = Attention.buildAttnBias({ 3: 2, 10: -1.5 }, shapes);
        eq(bias.length, 2, 'layer count');
        check(bias[0].Lq === 4 && bias[0].Lk === 77, 'layer shape');
        check(bias[0].data[3] === 2 && bias[0].data[3 * 77 + 3] === 2, 'boost token 3 in every query');
        eq(bias[1].data[5 * 77 + 10], -1.5, 'suppress token 10');
        check(bias[0].data[0] === 0 && bias[0].data[77 + 4] === 0, 'other columns zero');
        const oob = Attention.buildAttnBias({ 99: 3 }, shapes);
        check(oob[0].data[3] === 0 && oob[1].data[40] === 0, 'out-of-range token ignored');
    });

    test('img2img / inpaint / ControlNet options', () => {
        dlab.setInitImage('');
        const base = dlab.readOpts();
        check(base.initImagePath === undefined && base.controls === undefined, 'clean baseline');
        eq(base.width % 8, 0, 'width snapped to 8');

        dlab.setInitImage('/tmp/seed.png');
        dlab.setStrength(0.55);
        dlab.setVaeSample(true);
        const i2i = dlab.readOpts();
        eq(i2i.initImagePath, '/tmp/seed.png', 'initImagePath');
        near(i2i.strength, 0.55, 1e-6, 'strength');
        eq(i2i.vaeEncodeSample, true, 'vaeEncodeSample');
        check(i2i.maskImagePath === undefined, 'no mask until picked');
        check(/seed\.png/.test(document.getElementById('init-path').textContent), 'init path shown');

        dlab.setMaskImage('/tmp/mask.png');
        eq(dlab.readOpts().maskImagePath, '/tmp/mask.png', 'maskImagePath');
        dlab.setInitImage('');
        const cleared = dlab.readOpts();
        check(cleared.initImagePath === undefined && cleared.maskImagePath === undefined, 'clearing init drops the mask');

        // A fresh ControlNet (no Load) is stale: controls are withheld and the run refused.
        dlab.addControlNetPath('/tmp/cn1.safetensors', { image: '/tmp/pose.png', scale: 0.8, endStep: 0.5 });
        dlab.addControlNetPath('/tmp/cn2.safetensors', { image: '/tmp/depth.png', scale: 1.2, startStep: 0.5 });
        check(dlab.readOpts().controls === undefined, 'controls suppressed while stale');
        const s = dlab.state();
        check(s.controlnets === 2 && s.cnLoaded === 0, 'tracked: ' + s.controlnets + '/' + s.cnLoaded);
        check(/ControlNet set changed/.test(dlab.adapters.problem()), 'run refused while stale');
        check(!document.getElementById('cn-stale').hidden, 'stale marker shown');
        eq(document.querySelectorAll('#cn-list .cn-row').length, 2, 'two ControlNet rows');
    });
} finally {
    prefs.restore(saved);
}
done('diffusion-lab smoke');
