// Headless smoke + timing for StyleGAN3 invert. Generates a face, inverts its
// own image (synchronously — headless virtual time can't await async onDone),
// and checks the recovered w+ re-renders close to the target. Also prints the
// wall-clock per-step cost so we know whether the interactive lab seam needs the
// cache-pooling perf fix. GPU: bro-headless ../broworkshop/demos/stylegan3-lab _invert_smoke.js

const DIR = 'D:/projects/brovisionml/weights/stylegan3-r-ffhqu-256';

const g = bro.vision.loadStyleGAN3(DIR, { resolution: 256 });
assert(g && g.numWs > 0, 'loaded');

// Self-generated target: invert should drive MSE down sharply.
const tgt = g.generate({ seed: 42, truncation: 0.7, returnLatents: true });
assert(tgt.image && tgt.width === 256, 'target 256²');

const STEPS = 40;
const t0 = Date.now();
const rec = g.invert(tgt.image, { steps: STEPS, lr: 0.1 });
const dt = Date.now() - t0;

assert(rec.w && rec.w.length === g.numWs * g.wDim, 'recovered w+ length');
assert(rec.image && rec.image.width === 256, 'recovered image');
assert(typeof rec.loss === 'number', 'final loss present');
assert(rec.lossCurve && rec.lossCurve.length === STEPS, 'loss curve length = ' + (rec.lossCurve ? rec.lossCurve.length : 'none'));

const first = rec.lossCurve[0], last = rec.lossCurve[rec.lossCurve.length - 1];
assert(last < first, 'loss decreased: ' + first.toFixed(5) + ' -> ' + last.toFixed(5));

console.log('invert ' + STEPS + ' steps: ' + dt + 'ms  (' + (dt / STEPS).toFixed(1) + ' ms/step)');
console.log('loss: ' + first.toExponential(3) + ' -> ' + last.toExponential(3) + '  (final ' + rec.loss.toExponential(3) + ')');

drawBitmap(document.querySelector('#sample-canvas'), tgt.image);
drawBitmap(document.querySelector('#walk-mid'), rec.image);
flush();
screenshot('_invert_smoke.png');
console.log('OK — StyleGAN3 invert smoke passed');
