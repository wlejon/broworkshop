// StyleGAN3 invert: recover a generated face's own latent and check it
// re-renders close to the target, plus the input contract (RGBA at model
// resolution; an ImageBitmap or a wrong size is rejected). Prints per-step
// cost. Needs the ffhqu-256 checkpoint + GPU (tagged ml).
import { check, eq, test, done, throws, q, shot } from "/lib/kit/test.js";
import { requireWeights } from "/lib/kit/weights.js";
import { toRGBA, drawBitmap } from "/app/lib/helpers.js";

const DIR = requireWeights('StyleGAN3 ffhqu-256', ['brovisionml/weights/stylegan3-r-ffhqu-256'],
                           { probe: 'model.safetensors' });
const g = bro.vision.loadStyleGAN3(DIR, { resolution: 256 });
const tgt = g.generate({ seed: 42, truncation: 0.7, returnLatents: true });
const STEPS = 40;
let rec;

test('input contract', () => {
    throws(() => g.invert(tgt.image, { steps: 1 }), null, 'an ImageBitmap is rejected');
    const small = { width: 128, height: 128, data: new Uint8ClampedArray(128 * 128 * 4) };
    throws(() => g.invert(small, { steps: 1 }), null, 'a non-model-resolution image is rejected');
});

test('self-inversion drives MSE down', () => {
    const t0 = Date.now();
    rec = g.invert(toRGBA(tgt), { steps: STEPS, lr: 0.1 });
    const dt = Date.now() - t0;
    eq(rec.w.length, g.numWs * g.wDim);
    eq(rec.image.width, 256);
    eq(typeof rec.loss, 'number');
    eq(rec.lossCurve.length, STEPS);
    const first = rec.lossCurve[0], last = rec.lossCurve[STEPS - 1];
    check(last < first * 0.8, 'loss fell: ' + first.toExponential(3) + ' → ' + last.toExponential(3));
    console.log('  invert ' + STEPS + ' steps: ' + dt + ' ms (' + (dt / STEPS).toFixed(1) + ' ms/step)');
});

test('the recovered image resembles the target', () => {
    let err = 0;
    for (let i = 0; i < tgt.data.length; i++) err += Math.abs(tgt.data[i] - rec.data[i]);
    const mae = err / tgt.data.length;
    check(mae < 40, 'mean abs error ' + mae.toFixed(1) + ' / 255');
});

drawBitmap(q('#sample-canvas'), tgt.image);
drawBitmap(q('#walk-mid'), rec.image);
flush();
shot('invert');
done('stylegan3-lab invert');
