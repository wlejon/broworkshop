// PixArt Lab — drives the UI end to end: load PixArt-Sigma (the weights
// found through lib/kit/weights.js), generate a small image, cancel a run
// mid-flight, generate again. Asserts on DOM and lab state only; the images
// themselves are for the user to judge.
//
//   scripts/validate.sh --ml demos/pixart-lab

import { check, waitFor, clickOn, setValue, text, shot, test, done } from "/lib/kit/test.js";
import { weightsRoot } from "/lib/kit/weights.js";
import { pixart, prefs } from "/app/lab.js";

const saved = prefs.snapshot();
const st = () => pixart.state();

try {
    waitFor(() => pixart.rpc.isReady, 'worker ready', 30000);
    test('default model path resolves under the weights root', () => {
        check(/pixart-sigma/.test(pixart.picker.path), 'path ' + pixart.picker.path);
        check(pixart.picker.path.startsWith(weightsRoot()), 'under ' + weightsRoot());
    });

    // A previous session's auto-load may be under way; let it settle first.
    waitFor(() => !st().loading, 'auto-load settles', 600000);
    if (!st().loaded) {
        clickOn(pixart.picker.button);
        waitFor(() => !st().loading, 'model load', 600000);
    }
    test('model loaded', () => {
        check(st().loaded, 'loaded (error: ' + st().error + ')');
        check(st().modelClass === 'PixArt', 'modelClass ' + st().modelClass);
        check(/PixArt ready/.test(text('#status')), 'status ' + text('#status'));
        check(/CUDA|CPU|METAL|GPU/.test(text('#backend')), 'badge ' + text('#backend'));
        check(!pixart.panel.generate.disabled, 'Generate enabled');
    });

    setValue('[data-field=size] select', '512');
    setValue('[data-field=steps] input', '4');
    setValue('[data-field=seed] input', '7');
    pixart.panel.prompt = 'a lighthouse on a rocky coast at dawn';
    clickOn(pixart.panel.generate);
    check(st().running, 'run started');
    waitFor(() => !st().running, 'generation', 300000);
    test('generation lands in the view and the gallery', () => {
        check(/^done/.test(text('#status')), 'status ' + text('#status'));
        check(st().images === 1, 'gallery has 1 image, got ' + st().images);
        check(pixart.view.hasImage(), 'view shows the image');
        check(pixart.view.image.width === 512 && pixart.view.image.height === 512, '512² image');
        check(/done · 4 steps/.test(pixart.bar.text), 'bar ' + pixart.bar.text);
        check(/seed 7/.test(pixart.strip.selected.meta.label), 'entry labelled with its seed');
    });
    shot('generated');

    // Cancel mid-run: nothing reaches the gallery, and the next run still works.
    setValue('[data-field=steps] input', '30');
    clickOn(pixart.panel.generate);
    waitFor(() => /step [1-9]/.test(pixart.bar.text), 'first step', 120000);
    check(!pixart.panel.cancel.disabled, 'Cancel enabled while running');
    clickOn(pixart.panel.cancel);
    waitFor(() => !st().running, 'cancel settles', 60000);
    test('cancel stops the run', () => {
        check(/cancelled/.test(text('#status')), 'status ' + text('#status'));
        check(st().images === 1, 'no new gallery image');
        check(pixart.panel.cancel.disabled, 'Cancel disabled again');
    });

    setValue('[data-field=steps] input', '2');
    clickOn(pixart.panel.generate);
    waitFor(() => !st().running, 'generation after cancel', 300000);
    test('a run after cancel completes', () => {
        check(/^done/.test(text('#status')), 'status ' + text('#status'));
        check(st().images === 2, 'gallery has 2 images');
    });

    // The gallery selects an earlier image back into the view.
    const first = pixart.strip.entries[1];
    clickOn(first.el);
    test('gallery click shows that image', () => check(pixart.view.image === first.bitmap));
} finally {
    prefs.restore(saved);
}
done('pixart-lab');
