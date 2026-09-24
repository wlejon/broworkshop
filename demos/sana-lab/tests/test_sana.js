// Sana Lab — drives the UI end to end on the Sana weights lib/kit/weights.js
// finds: load, a baseline render, a word axis, the identity anchor (steps
// lock, reference pane, held renders), live re-rendering from a slider, and
// cancel. Asserts on DOM and lab state; the images are the user's to judge.
//
//   scripts/validate.sh --ml demos/sana-lab

import { check, waitFor, clickOn, setValue, text, shot, test, done } from "/lib/kit/test.js";
import { weightsRoot } from "/lib/kit/weights.js";
import { sana, prefs } from "/app/lab.js";

const saved = prefs.snapshot();
const st = () => sana.state();
const idle = (what, ms) => waitFor(() => !st().busy && !st().running && !st().pending, what, ms || 300000);

try {
    waitFor(() => sana.rpc.isReady, 'worker ready', 30000);
    test('default model path resolves under the weights root', () => {
        check(/sana/i.test(sana.picker.path), 'path ' + sana.picker.path);
        check(sana.picker.path.startsWith(weightsRoot()), 'under ' + weightsRoot());
    });
    waitFor(() => !st().loading, 'auto-load settles', 600000);
    if (!st().loaded) {
        clickOn(sana.picker.button);
        waitFor(() => !st().loading, 'model load', 600000);
    }
    idle('saved axes restore');
    test('model loaded', () => {
        check(st().loaded, 'loaded (error: ' + st().error + ')');
        check(st().modelClass === 'Sana', 'modelClass ' + st().modelClass);
        check(!sana.panel.generate.disabled, 'Generate enabled');
        check(!sana.axes.buildButton.disabled, 'Add axis enabled');
    });

    // Start from a clean slate: no live mode, no axes, small fast renders.
    if (st().live) { sana.liveBox.checked = false; sana.liveBox.dispatchEvent(new Event('change')); }
    while (sana.axes.axes.length) clickOn(sana.axes.axes[0].card.querySelector('button'));
    setValue('[data-field=size] select', '512');
    setValue('[data-field=steps] input', '4');
    setValue('[data-field=seed] input', '3');
    sana.panel.prompt = 'a portrait photo of a woman';

    const before = st().images;
    clickOn(sana.panel.generate);
    idle('baseline render');
    test('baseline render reaches the gallery', () => {
        check(/^done/.test(text('#status')), 'status ' + text('#status'));
        check(st().images === before + 1, 'one new gallery image');
        check(/512² · 4 steps/.test(text('#gen-sub')), 'sub ' + text('#gen-sub'));
        check(sana.view.hasImage(), 'view shows it');
    });

    sana.axes.inputs.from.value = 'neutral expression, calm face';
    sana.axes.inputs.to.value = 'a big joyful smile, laughing';
    sana.axes.inputs.name.value = 'smile';
    clickOn(sana.axes.buildButton);
    idle('axis build', 120000);
    test('word axis built', () => {
        check(st().axes === 1, 'one axis card');
        check(/axis "smile" added/.test(text('#status')), 'status ' + text('#status'));
    });
    setValue(sana.axes.axes[0].range, '12');
    clickOn(sana.panel.generate);
    idle('steered render');
    test('steered render names the active axis', () => {
        check(/^done/.test(text('#status')), 'status ' + text('#status'));
        check(/1 axis/.test(sana.strip.selected.meta.title), 'entry title ' + sana.strip.selected.meta.title);
    });

    el('#anchor-prompt').value = 'a portrait photo of a woman, neutral expression, plain studio background';
    clickOn('#capture');
    idle('anchor capture');
    test('anchor arms the identity seam', () => {
        check(st().armed, 'armed');
        check(st().anchorSteps === 4, 'anchor steps ' + st().anchorSteps);
        check(!sana.el.refPane.hidden, 'reference pane shown');
        check(sana.refView.hasImage(), 'reference image drawn');
        check(q('[data-field=steps] input').disabled, 'steps locked');
        check(/locked/.test(text('[data-field=steps]')), 'lock note');
        check(!sana.el.clearAnchor.disabled, 'clear enabled');
    });
    shot('anchored');

    clickOn(sana.panel.generate);
    idle('held render');
    test('held render', () => {
        check(/held/.test(text('#gen-sub')), 'sub ' + text('#gen-sub'));
        check(/identity \d\.\d/.test(sana.strip.selected.meta.title), 'title ' + sana.strip.selected.meta.title);
    });

    // live: a slider drag queues a preview, the release a full render.
    sana.liveBox.checked = true;
    sana.liveBox.dispatchEvent(new Event('change'));
    idle('live catch-up render');
    const renders = st().renders, images = st().images;
    setValue(sana.axes.axes[0].range, '-8');      // input -> preview, change -> full
    idle('live renders');
    test('live mode re-renders from the slider', () => {
        check(st().renders > renders, 'rendered again');
        check(st().images === images + 1, 'exactly one full render reached the gallery');
        check(/^done/.test(text('#status')), 'ends on the full render: ' + text('#status'));
    });
    sana.liveBox.checked = false;
    sana.liveBox.dispatchEvent(new Event('change'));

    clickOn('#clear-anchor');
    waitFor(() => !st().armed, 'anchor cleared', 30000);
    test('clearing the anchor unlocks steps and hides the reference', () => {
        check(sana.el.refPane.hidden, 'reference pane hidden');
        check(!q('[data-field=steps] input').disabled, 'steps unlocked');
    });

    setValue('[data-field=steps] input', '40');
    const n = st().images;
    clickOn(sana.panel.generate);
    waitFor(() => /step [1-9]/.test(sana.bar.text), 'first step', 120000);
    clickOn(sana.panel.cancel);
    idle('cancel', 60000);
    test('cancel stops the run', () => {
        check(/cancelled/.test(text('#status')), 'status ' + text('#status'));
        check(st().images === n, 'no gallery image from a cancelled run');
    });
} finally {
    prefs.restore(saved);
}
done('sana-lab');

function q(sel) { return document.querySelector(sel); }
function el(sel) { return q(sel); }
