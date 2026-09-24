// Timing for StyleGAN3 synthesize() (warmup + averaged iterations) plus the
// per-step cost of a short invert. Tracks the synthesis hot path (ffhqu-256 was
// ~97 ms/forward on CUDA with the FP16 WMMA path, ~142 ms FP32). GPU only, and
// not a test (validate.sh does not run tools/):
//   bro-headless demos/stylegan3-lab demos/stylegan3-lab/tools/synth_prof.js

import { requireWeights } from "/lib/kit/weights.js";
import { toRGBA } from "/app/lib/helpers.js";

const DIR = requireWeights('StyleGAN3 ffhqu-256', ['brovisionml/weights/stylegan3-r-ffhqu-256'],
                           { probe: 'model.safetensors' });
const g = bro.vision.loadStyleGAN3(DIR, { resolution: 256 });
console.log('device=' + g.device + ' res=' + g.resolution + ' numWs=' + g.numWs);

const wplus = g.generate({ seed: 7, truncation: 0.7, returnLatents: true }).w;
for (let i = 0; i < 3; i++) g.synthesize(wplus);            // warmup: autotune, first-touch alloc

const N = 20, times = [];
for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    g.synthesize(wplus);
    times.push(Date.now() - t0);
}
times.sort((a, b) => a - b);
const mean = times.reduce((a, b) => a + b, 0) / N;
console.log('synthesize() x' + N + ': mean=' + mean.toFixed(1) + 'ms median=' + times[N >> 1] +
            'ms min=' + times[0] + 'ms max=' + times[N - 1] + 'ms');

const tgt = toRGBA(g.generate({ seed: 7, truncation: 0.7 }));
const IS = 20, ti = Date.now();
g.invert(tgt, { steps: IS, lr: 0.1 });
const di = Date.now() - ti;
console.log('invert() ' + IS + ' steps: ' + di + 'ms (' + (di / IS).toFixed(1) + ' ms/step)');
