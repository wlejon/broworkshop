// Inpainting Studio on the real pipeline (GPU): load an SD 1.5 checkpoint
// (the canny ControlNet registers when its weights are present), inpaint a
// masked region step-wise, outpaint a grown border with the canny guide, adopt
// a result as the new base, and estimate a depth map with Depth-Anything.
// Asserts on DOM and state; the images are for the user to judge.
// Run: scripts/validate.sh --ml tools/inpainting-studio

import { check, eq, test, done, waitFor, clickOn, setValue, text, q, shot, skip } from "/lib/kit/test.js";
import { findWeights } from "/lib/kit/weights.js";
import { gpuAvailable } from "/lib/kit/ml.js";
import { studio, prefs, SD15_CANDIDATES, DEPTH_ANNOTATOR, loadScene, expand, setControl } from "/app/lib/app.js";
import { coverage } from "/app/lib/pixels.js";

if (!bro.diffusion || bro.diffusion.available === false || !gpuAvailable()) skip('needs bro.diffusion and a GPU');
if (!findWeights(SD15_CANDIDATES, { probe: 'tokenizer/vocab.json' })) skip('no SD 1.5 weights (' + SD15_CANDIDATES.join(', ') + ')');

const saved = prefs.snapshot();
const stage = () => studio.stage;
const idle = () => !studio.loading && !studio.run && !studio.depthBusy;

try {
    waitFor(() => studio.rpc.isReady, 'worker ready', 30000);
    waitFor(() => !studio.loading, 'auto-load settles', 600000);
    if (!studio.loaded) {
        clickOn(studio.picker.button);
        waitFor(() => !studio.loading, 'model load', 600000);
    }
    test('model loaded', () => {
        check(studio.loaded, 'loaded (error: ' + studio.error + ')');
        check(/CUDA|CPU|METAL|GPU/.test(text('#backend')), 'badge ' + text('#backend'));
        check(/scheduler/.test(text('#model-meta')), 'meta ' + text('#model-meta'));
        check(!studio.panel.generate.disabled, 'Generate enabled');
    });
    const hasCanny = studio.controlnets.indexOf('canny') >= 0;

    // A small square mask over the face, plain inpaint, few steps.
    setControl('none');
    loadScene('portrait');
    const m = stage().mask;
    m.size = 120;
    m.tool = 'brush';
    m.dab(256, 230);
    setValue('[data-field=seed] input', '11');
    setValue('[data-field=steps] input', studio.scheduler === 'lcm' ? '4' : '12');
    setValue('#fillModeSelect', 'original');
    studio.panel.prompt = 'a silver robot face, studio lighting';
    if (!studio.loaded) throw new Error('no model: ' + studio.error);
    clickOn(studio.panel.generate);
    check(!!studio.run, 'run started');
    waitFor(() => !studio.run, 'inpaint', 600000);
    test('inpaint lands in the result view and the gallery', () => {
        check(/^done/.test(text('#status')), 'status ' + text('#status'));
        eq(studio.strip.entries.length, 1, 'gallery');
        eq(studio.stage.view, 'result', 'result view');
        check(!q('#resultCanvas').hidden && q('#result-hint').hidden, 'result shown');
        eq([q('#resultCanvas').width, q('#resultCanvas').height], [512, 512], 'result size');
        check(!q('#btn-adopt').disabled, 'adopt enabled');
        const p = studio.lastParams;
        check(p.coverage > 0.03 && p.coverage < 0.2, 'coverage ' + p.coverage);
        check(!p.opts.controls || p.opts.controls.every((c) => c.scale === 0), 'guide none: every net at scale 0');
    });
    shot('inpaint');

    // Adopt, then outpaint east with the canny guide.
    clickOn('#btn-adopt');
    test('the result becomes the base', () => {
        eq(studio.stage.view, 'composite', 'back to composite');
        eq(coverage(stage().maskBits()), 0, 'mask cleared');
    });
    setControl('canny');
    expand(64, 0);
    setValue('#fillModeSelect', 'blur');
    studio.panel.prompt = 'a neon city skyline at night';
    clickOn(studio.panel.generate);
    waitFor(() => !studio.run, 'outpaint', 600000);
    test('outpaint with the canny guide', () => {
        check(/^done/.test(text('#status')), 'status ' + text('#status'));
        eq([q('#resultCanvas').width, q('#resultCanvas').height], [576, 512], 'grown result');
        eq(studio.strip.entries.length, 2, 'gallery');
        const c = studio.lastParams.opts.controls;
        if (hasCanny) check(c && c[studio.controlnets.indexOf('canny')].scale > 0, 'canny net weighted');
        else check(/no canny/.test(text('#control-note')), 'no canny weights: note ' + text('#control-note'));
    });
    shot('outpaint');

    if (findWeights(DEPTH_ANNOTATOR, { probe: 'config.json' })) {
        setControl('depth');
        waitFor(idle, 'depth map', 300000);
        // ENGINE-ISSUES "brovisionml loaders call to() before load() on CUDA":
        // loadDepth throws on the GPU; the page shows the error and a black map.
        const known = /to\(\) called before load\(\)/.test(text('#status'));
        if (known) {
            console.log('    KNOWN (ENGINE-ISSUES): ' + text('#status'));
            test('depth failure is reported and the guide falls back to black', () => {
                check(q('#status').classList.contains('err'), 'error status');
                eq(stage().pixels(stage().control).data[0], 0, 'black control map');
            });
        } else test('depth guide estimates a depth map', () => {
            check(studio.depth && studio.depth.width > 0, 'depth map (status: ' + text('#status') + ')');
            const d = stage().pixels(stage().control).data;
            let lo = 255, hi = 0;
            for (let i = 0; i < d.length; i += 64) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
            check(hi - lo > 40, 'depth map has range ' + lo + '..' + hi);
            if (studio.controlnets.indexOf('depth') < 0) check(/no depth/.test(text('#control-note')), 'note ' + text('#control-note'));
        });
        clickOn('#views [data-value=control]');
        shot('depth');
    }
} finally {
    prefs.restore(saved);
}
done();
