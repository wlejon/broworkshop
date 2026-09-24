// Vision Lab: every model found under the brovisionml weights root is loaded
// and (when it loads) run through the UI on the sample image; results reach
// the stage, thumbnail and metadata; SAM's encode / point / box / segment /
// segment-everything flow runs through real stage clicks; Run all fills the
// contact sheet with every annotator. Outputs are not graded. Every model
// must load on the default device. Skips without the weights.
//
//   scripts/validate.sh --ml demos/vision-lab

import { check, eq, test, done, waitFor, q, text, clickOn, setValue, shot, needWeights } from "/lib/kit/test.js";
import { lab } from "/app/lab.js";
import { MODELS, ANNOTATORS, byId, VISION_ROOT } from "/app/lab/models.js";

needWeights('brovisionml weights', VISION_ROOT, { probe: 'triposplat/background_removal/birefnet.safetensors' });
const saved = lab.ui.prefs.snapshot();

waitFor(() => lab.bitmap, 'input bitmap', 10000);
test('weights root found; every model present', () => {
    for (const m of MODELS) check(lab.avail[m.id], m.id + ' weights at ' + lab.root + '/' + m.probe);
});
test('input image decoded', () => check(lab.image.width > 1 && /robot-arm/.test(text('#image-meta'))));
test('model list', () => eq(document.querySelectorAll('#model-list .model-item').length, MODELS.length));

const loaded = [];
function loadThroughUi(id) {
    clickOn('#model-list .model-item[data-id="' + id + '"]');
    check(lab.selected === id, 'selected ' + id);
    clickOn('#btn-load');
    waitFor(() => !lab.busy, id + ' load', 300000);
    if (lab.instances[id]) { loaded.push(id); return true; }
    const err = lab.errors[id] || '(none)';
    check(/load failed/.test(text('#status')) && text('#status').includes(err), id + ': the UI shows the load error');
    check(q('#model-list .model-item[data-id="' + id + '"]').classList.contains('failed'), id + ': marked failed in the list');
    throw new Error(id + ' failed to load: ' + err);
}

// 1. each annotator: load; run the ones that load
for (const m of ANNOTATORS) {
    if (!loadThroughUi(m.id)) continue;
    test(m.id + ': Load button shows loaded', () => check(/Loaded/.test(text('#btn-load')) && !q('#btn-run').disabled));
    const n = lab.runs;
    clickOn('#btn-run');
    waitFor(() => lab.runs > n, m.id + ' run', 300000);
    check(!/failed/.test(text('#status')), m.id + ' run: ' + text('#status'));
    test(m.id + ': result on stage + thumbnail + metadata', () => {
        check(lab.result && lab.result.image && lab.result.image.width > 0);
        check(!q('#out-thumb').hidden && document.querySelectorAll('#meta > div').length >= 2);
        eq(lab.ui.view.value, 'overlay');
    });
    shot(m.id);
}

// 2. view modes + opacity on the last result
if (loaded.length) {
    clickOn('#view-mode button[data-value="output"]');
    test('view: output', () => eq(lab.ui.view.value, 'output'));
    setValue('#opacity', '40');
    test('opacity readout', () => eq(text('#opacity-val'), '40%'));
    clickOn('#view-mode button[data-value="overlay"]');
}

// 3. a loader param unloads; a runtime one does not
if (lab.instances.rembg) {
    clickOn('#model-list .model-item[data-id="rembg"]');
    setValue('#params input', '512');
    test('loader param change unloads BiRefNet', () => check(!lab.instances.rembg && /Load again/.test(text('#status'))));
}

// 4. SAM through real stage input
if (loadThroughUi('sam')) {
    let n = lab.runs;
    clickOn('#btn-setimage');
    waitFor(() => lab.runs > n, 'SAM encode', 300000);
    check(lab.ui.sam.isEncoded(), 'SAM encoded: ' + text('#status'));
    const r = q('#view').getBoundingClientRect();
    click(r.left + r.width * 0.5, r.top + r.height * 0.5, 0);
    flush();
    test('a click adds a foreground point', () => eq(lab.ui.sam.prompts().points.length, 1));
    clickOn('#btn-segment');
    test('multimask: 3 masks, best marked', () => check(lab.result.num === 3 && q('#mask-list .best')));
    // a box by drag
    mouseMove(r.left + r.width * 0.3, r.top + r.height * 0.3);
    mouseDown(r.left + r.width * 0.3, r.top + r.height * 0.3, 0);
    mouseMove(r.left + r.width * 0.6, r.top + r.height * 0.7);
    mouseUp(r.left + r.width * 0.6, r.top + r.height * 0.7, 0);
    flush();
    test('a drag sets a box', () => check(lab.ui.sam.prompts().box));
    setValue('#sam-multimask', false);
    clickOn('#btn-segment');
    test('single mask', () => eq(lab.result.num, 1));
    setValue('#amg-params input', '8');
    n = lab.runs;
    clickOn('#btn-everything');
    waitFor(() => lab.runs > n, 'segment everything', 300000);
    test('segment everything: masks', () => check(lab.result.masks && /masks/.test(text('#status'))));
    shot('sam');
}

// 5. run all → contact sheet: one cell per annotator that loads
let n = lab.runs;
clickOn('#model-list .model-item[data-id="depth"]');
clickOn('#btn-runall');
waitFor(() => lab.runs > n, 'run all', 600000);
test('contact sheet = every annotator', () => {
    const want = ANNOTATORS.map((m) => m.id);
    eq(lab.contact.join(','), want.join(','));
    eq(document.querySelectorAll('#contact-grid .contact-cell').length, want.length);
    check(!/failed to load/.test(text('#status')), 'no load failures: ' + text('#status'));
});
shot('contact');

// 6. switching images resets the result
setValue('#image-sel', 'assets/scene.png');
test('image switch', () => check(/scene/.test(text('#image-meta')) && !lab.result));

console.log('loaded: ' + loaded.join(', '));
lab.ui.prefs.restore(saved);
done('vision-lab');
