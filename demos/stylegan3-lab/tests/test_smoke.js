// StyleGAN3 Lab — the lab's modules and the bro.vision generator path, driven
// synchronously (no onDone → the call runs inline). tests/test_ui.js drives the
// async queue through the UI. Needs the ffhqu-256 checkpoint + GPU (tagged ml).
import { check, eq, test, done, q, shot } from "/lib/kit/test.js";
import { requireWeights } from "/lib/kit/weights.js";
import { lerpW, mixW, toRGBA, drawBitmap, wKey } from "/app/lib/helpers.js";
import { CHECKPOINTS } from "/app/lib/model.js";

const DIR = requireWeights('StyleGAN3 ffhqu-256', ['brovisionml/weights/stylegan3-r-ffhqu-256'],
                           { probe: 'model.safetensors' });

test('lab DOM wired', () => {
    for (const s of ['#sample-canvas', '#walk-mid', '#mix-result', '#grid-out', '#psi', '#mix-k',
                     '#panel-invert', '#inv-target', '#inv-recovered', '#inv-loss', '#btn-invert']) {
        check(document.querySelector(s), 'DOM present: ' + s);
    }
    eq(document.querySelectorAll('#seams [data-tab]').length, 5);
    check(CHECKPOINTS.every((c) => !/^[A-Za-z]:|^\//.test(c)), 'checkpoint candidates are relative');
});

test('W+ math', () => {
    const a = new Float32Array([0, 0, 1, 1]);   // 2 rows × wDim 2
    const b = new Float32Array([2, 2, 3, 3]);
    eq(Array.from(lerpW(a, b, 0.5)), [1, 1, 2, 2]);
    eq(Array.from(mixW(a, b, 1, 2, 2)), [0, 0, 3, 3], 'row 0 from a, row 1 from b');
    eq(Array.from(mixW(a, b, 0, 2, 2)), [2, 2, 3, 3], 'k = 0: all from b');
    eq(wKey(3, 0.7, -1), '3|0.7|-1');
    const rgba = toRGBA({ width: 2, height: 1, channels: 3, data: new Uint8Array([1, 2, 3, 4, 5, 6]) });
    eq(Array.from(rgba.data), [1, 2, 3, 255, 4, 5, 6, 255]);
});

const g = bro.vision.loadStyleGAN3(DIR, { resolution: 256 });
let r, r2, s, sm;

test('load + generate: z → image + w+', () => {
    check(g && g.numWs > 0 && g.wDim > 0, 'loaded: numWs=' + g.numWs + ' wDim=' + g.wDim);
    r = g.generate({ seed: 42, truncation: 0.7, returnLatents: true });
    eq([r.width, r.height, r.channels], [256, 256, 3]);
    eq(r.data.length, 256 * 256 * 3);
    eq(r.w.length, g.numWs * g.wDim);
    eq(r.seed, 42);
    const again = g.generate({ seed: 42, truncation: 0.7 });
    check(again.data.every((v, i) => v === r.data[i]), 'same seed → same image');
});

test('synthesize: edited w+ (walk + mix) → image', () => {
    r2 = g.generate({ seed: 7, returnLatents: true });
    s = g.synthesize(lerpW(r.w, r2.w, 0.5));
    eq(s.width, 256);
    sm = g.synthesize(mixW(r.w, r2.w, Math.floor(g.numWs / 2), g.numWs, g.wDim));
    check(sm.image, 'style-mixed image');
    const s0 = g.synthesize(r.w);
    let diff = 0;
    for (let i = 0; i < s0.data.length; i += 97) diff += Math.abs(s0.data[i] - r.data[i]);
    check(diff < s0.data.length / 97 * 2, 'synthesize(generate().w) reproduces the image');
});

test('invert: RGBA target → w+, resume from initW, edit the result', () => {
    const target = toRGBA(r);
    const inv = g.invert(target, { steps: 30, lr: 0.1 });
    eq(inv.w.length, g.numWs * g.wDim);
    eq(inv.lossCurve.length, 30);
    check(inv.loss < inv.lossCurve[0], 'loss fell ' + inv.lossCurve[0].toExponential(2) + ' → ' + inv.loss.toExponential(2));
    const inv2 = g.invert(target, { steps: 30, lr: 0.1, initW: inv.w });
    check(inv2.lossCurve[0] < inv.lossCurve[0] * 0.5, 'initW resume starts low (chunked inversion)');
    const edited = g.synthesize(mixW(inv2.w, r2.w, Math.floor(g.numWs / 2), g.numWs, g.wDim));
    check(edited.image, 'recovered w+ edits like any latent');
});

drawBitmap(q('#sample-canvas'), r.image);
drawBitmap(q('#walk-mid'), s.image);
drawBitmap(q('#mix-result'), sm.image);
flush();
shot('smoke');
done('stylegan3-lab smoke');
