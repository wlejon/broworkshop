// Diffusion Lab: drives the UI end to end on the LCM Dreamshaper weights
// that lib/kit/weights.js finds. It loads, generates with attention capture,
// scrubs the trajectory, opens the attention overlay, runs a steered and an
// axis-driven render, then cancels one. Asserts on DOM and lab state only;
// the images are the user's to judge.
//
//   scripts/validate.sh --ml demos/diffusion-lab

import { check, eq, waitFor, clickOn, setValue, text, shot, test, done, needWeights } from "/lib/kit/test.js";
import { dlab, prefs } from "/app/lab.js";

const dir = needWeights('LCM Dreamshaper', ['brodiffusion/weights/lcm-dreamshaper'], { probe: 'unet' });
const saved = prefs.snapshot();
const st = () => dlab.state();
const idle = (what, ms) => waitFor(() => !st().busy && !st().running && !st().loading, what, ms || 300000);

try {
    waitFor(() => dlab.rpc.isReady, 'worker ready', 30000);
    idle('auto-load settles', 600000);
    if (dlab.picker.path !== dir) { dlab.picker.path = dir; dlab.adoptModel(dir); }
    setValue('#scheduler', 'auto');
    setValue('#int8', false);
    if (!st().loaded) {
        clickOn(dlab.picker.button);
        idle('model load', 600000);
    }
    test('model loaded', () => {
        check(st().loaded, 'loaded (error: ' + st().error + ')');
        eq(st().scheduler, 'lcm', 'auto sampler picks LCM for an LCM checkpoint');
        check(st().traceCapable, 'trace capable');
        check(!dlab.panel.generate.disabled, 'Generate enabled');
        check(/ready/.test(text('#status')), 'status ' + text('#status'));
    });

    while (dlab.axes.axes.length) clickOn(dlab.axes.axes[0].card.querySelector('button'));
    setValue('[data-field=steps] input', '4');
    setValue('[data-field=width] input', '256');
    setValue('[data-field=height] input', '256');
    setValue('[data-field=seed] input', '7');
    setValue('#trace', true);
    dlab.panel.prompt = 'a red fox sitting in autumn leaves';
    dlab.insp.promptChanged(dlab.panel.prompt);

    const before = st().images;
    clickOn(dlab.panel.generate);
    idle('traced render');
    test('traced render', () => {
        check(/^generated 4 steps/.test(text('#status')), 'status ' + text('#status'));
        eq(st().frames, 4, 'one decoded frame per step');
        check(st().hasTrace, 'trace aggregated');
        eq(st().images, before + 1, 'final image in the gallery');
        check(!dlab.el.scrub.disabled, 'scrubber enabled');
        check(document.querySelectorAll('#block option').length > 1, 'layer picker filled');
    });

    const fox = dlab.insp.encoding.tokens.find((t) => /fox/.test(t.text));
    clickOn(document.querySelectorAll('#tokens .tok')[fox.contextIndex]);
    waitFor(() => dlab.view.overlay, 'overlay drawn', 10000);
    test('selecting a token shows its heatmap', () => {
        check(document.getElementById('overlay-on').checked, 'overlay switched on');
        check(!document.getElementById('steer-ctl').hidden, 'steering controls shown');
        check(/fox/.test(text('#steer-tok')), 'steer token ' + text('#steer-tok'));
    });
    shot('overlay');

    setValue('#scrub', '0');
    test('scrubbing back hides the overlay', () => {
        check(!dlab.view.overlay, 'no overlay on an early frame');
        check(/step 1 \//.test(dlab.bar.text), 'label ' + dlab.bar.text);
        check(dlab.view.image === dlab.frames[0].bitmap, 'first frame shown');
    });
    setValue('#scrub', '3');
    waitFor(() => dlab.view.overlay, 'overlay back on the last frame', 10000);

    setValue('#steer-bias', '2');
    clickOn(dlab.panel.generate);
    idle('steered render');
    test('steered render', () => {
        check(/^generated/.test(text('#status')), 'status ' + text('#status'));
        check(/steering 1 token/.test(dlab.strip.selected.meta.title), 'title ' + dlab.strip.selected.meta.title);
        check(st().hasTrace, 'trace kept for a steered run');
    });
    clickOn('#steer-clear');

    dlab.axes.inputs.from.value = 'a young person';
    dlab.axes.inputs.to.value = 'an old person';
    dlab.axes.inputs.name.value = 'age';
    clickOn(dlab.axes.buildButton);
    idle('axis build', 120000);
    setValue(dlab.axes.axes[0].range, '20');
    clickOn(dlab.panel.generate);
    idle('axis render');
    test('word axis render', () => {
        eq(st().axes, 1, 'one axis');
        check(/1 axis/.test(dlab.strip.selected.meta.title), 'title ' + dlab.strip.selected.meta.title);
    });

    clickOn(dlab.strip.entries[2].el);
    test('an older gallery image hides the current overlay', () => {
        check(dlab.view.image === dlab.strip.entries[2].bitmap, 'gallery image shown');
        check(!dlab.view.overlay, 'no overlay on another run');
    });

    setValue('[data-field=steps] input', '40');
    const n = st().images;
    clickOn(dlab.panel.generate);
    waitFor(() => /step [1-9]/.test(dlab.bar.text), 'first step', 120000);
    clickOn(dlab.panel.cancel);
    idle('cancel', 60000);
    test('cancel stops the run', () => {
        check(/cancelled/.test(text('#status')), 'status ' + text('#status'));
        eq(st().images, n, 'no gallery image from a cancelled run');
        check(!dlab.panel.generate.disabled, 'Generate enabled again');
    });
    shot('after-cancel');
} finally {
    prefs.restore(saved);
}
done('diffusion-lab generate');
