// Pure-forward timing for StyleGAN3 synthesize() (warmup + averaged iters) plus a
// short invert per-step number. Tracks the synthesis hot path: ffhqu-256 lands at
// ~97ms/forward on CUDA with the FP16 fast path (modulated conv on WMMA), down
// from ~142ms FP32. GPU only:
//   bro-headless ../broworkshop/demos/stylegan3-lab _synth_prof.js

const DIR = 'D:/projects/brovisionml/weights/stylegan3-r-ffhqu-256';

const g = bro.vision.loadStyleGAN3(DIR, { resolution: 256 });
assert(g && g.numWs > 0, 'loaded');
console.log('device=' + g.device + ' res=' + g.resolution + ' numWs=' + g.numWs);

// One w+ to render repeatedly.
const seed0 = g.generate({ seed: 7, truncation: 0.7, returnLatents: true });
assert(seed0.w && seed0.w.length === g.numWs * g.wDim, 'have w+');
const wplus = seed0.w;

// Warmup (kernel autotune / first-touch alloc).
for (let i = 0; i < 3; i++) g.synthesize(wplus);

const N = 20;
const times = [];
for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    const img = g.synthesize(wplus);
    const dt = Date.now() - t0;
    assert(img && img.width === 256, 'synth image');
    times.push(dt);
}
times.sort((a, b) => a - b);
const sum = times.reduce((a, b) => a + b, 0);
const mean = sum / N;
const median = times[Math.floor(N / 2)];
const min = times[0], max = times[N - 1];
console.log('synthesize() x' + N + ': mean=' + mean.toFixed(1) + 'ms median=' + median +
            'ms min=' + min + 'ms max=' + max + 'ms');

// Also a short invert timing for the per-step cost on current main.
const tgt = g.generate({ seed: 7, truncation: 0.7 });
const IS = 20;
const ti = Date.now();
const rec = g.invert(tgt.image, { steps: IS, lr: 0.1 });
const di = Date.now() - ti;
console.log('invert() ' + IS + ' steps: ' + di + 'ms (' + (di / IS).toFixed(1) + ' ms/step)');

console.log('OK');
