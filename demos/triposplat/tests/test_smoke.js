// TripoSplat Lab: boot resolves the checkpoints and loads them in the worker;
// Generate through the panel (small settings) returns a well-formed cloud and
// puts it in the viewport; background removal runs when BiRefNet is present;
// cancel settles and re-arms; Save .ply writes a file that reloads to the
// same count; the view controls act. The splat is not graded.
//
//   scripts/validate.sh --ml demos/triposplat

import { check, eq, test, done, waitFor, q, text, clickOn, setValue, shot, needWeights } from "/lib/kit/test.js";
import { lab, WEIGHTS } from "/app/lab.js";

for (const k in WEIGHTS) if (!WEIGHTS[k].optional) needWeights(WEIGHTS[k].what, WEIGHTS[k].candidates);
const saved = lab.ui.prefs.snapshot();
const fs = require('fs');

function checkCloud(c, n, tag) {
    const want = Math.floor(n / 32) * 32;
    eq(c.count, want, tag + ': count');
    eq(c.positions.length, c.count * 3, tag + ': positions stride');
    eq(c.rotations.length, c.count * 4, tag + ': rotations stride');
    let badq = 0, badop = 0;
    for (let i = 0; i < c.positions.length; i++) if (!Number.isFinite(c.positions[i])) throw new Error(tag + ': non-finite position');
    for (let i = 0; i < c.count; i++) {
        const r = c.rotations;
        if (Math.abs(Math.hypot(r[i * 4], r[i * 4 + 1], r[i * 4 + 2], r[i * 4 + 3]) - 1) > 1e-2) badq++;
        if (!(c.opacities[i] >= 0 && c.opacities[i] <= 1)) badop++;
    }
    eq(badq, 0, tag + ': unit quaternions');
    eq(badop, 0, tag + ': opacities in [0,1]');
}

// 1. boot
test('weights panel lists every checkpoint', () => eq(document.querySelectorAll('#weights > div').length, Object.keys(WEIGHTS).length));
test('samples gallery + default image', () => check(document.querySelectorAll('#samples .k-thumb').length >= 1 && lab.image && lab.image.width > 0));
waitFor(() => lab.loaded || lab.error, 'pipeline load', 600000);
check(!lab.error, 'loaded: ' + lab.error);
test('device + generate armed', () => check(lab.device && !q('#btn-go').disabled && text('#btn-go') === 'Generate'));
test('bg removal offered iff BiRefNet loaded', () => eq(!q('#bg-remove').disabled, lab.hasBgModel));

// 2. small generate through the panel
setValue('#params label:nth-child(1) input', '4');          // steps
setValue('#params label:nth-child(3) input', '32768');      // gaussians
setValue('#bg-remove', false);
setValue('#seed', '42');
clickOn('#samples .k-thumb:nth-child(1)');
let n = lab.runs;
clickOn('#btn-go');
test('running: button becomes Cancel, inputs locked', () => check(text('#btn-go') === 'Cancel' && q('#btn-open').disabled));
waitFor(() => lab.runs > n, 'generate', 600000);
check(lab.last === 'generated', 'generated: ' + (lab.error || lab.last));
test('cloud well-formed', () => checkCloud(lab.cloud, 32768, 'no-bg'));
test('viewport holds it', () => eq(lab.ui.view.splatCount(), lab.cloud.count));
test('meta + save armed', () => check(/splats/.test(text('#splat-meta')) && !q('#btn-save').disabled));
shot('generated');

// 3. background removal
if (lab.hasBgModel) {
    setValue('#bg-remove', true);
    n = lab.runs;
    clickOn('#btn-go');
    waitFor(() => lab.runs > n, 'generate (BiRefNet)', 600000);
    check(lab.last === 'generated', lab.error || lab.last);
    test('bg-removed cloud well-formed', () => checkCloud(lab.cloud, 32768, 'bg'));
}

// 4. cancel settles and re-arms
setValue('#params label:nth-child(1) input', '30');
n = lab.runs;
clickOn('#btn-go');
clickOn('#btn-go');                                           // Cancel
test('cancelling state', () => check(lab.cancelling || lab.runs > n));
waitFor(() => lab.runs > n, 'cancel', 600000);
test('cancel settled (or the run beat it)', () => check(lab.last === 'cancelled' || lab.last === 'generated', lab.last));
test('re-armed', () => check(text('#btn-go') === 'Generate' && !q('#btn-go').disabled));
console.log('cancel outcome: ' + lab.last);

// 5. .ply export round trip (explicit path: the dialog would block)
const ply = fs.realpathSync('tests/out') + '/triposplat-smoke.ply';
test('save .ply', () => check(lab.ui.savePly(ply) === ply && fs.statSync(ply).size > 0));
test('reloads to the same count', () => {
    const node = lab.ui.view.vp.scene.createGaussianSplat({ path: ply });
    eq(node.splatCount, lab.ui.view.splatCount());
    node.destroy();
});

// 6. view controls
setValue('#vscale', '150');
test('scale readout', () => eq(text('#vscale-val'), '1.50'));
setValue('#vlight', true);
test('light background', () => check(q('#stage').classList.contains('light')));
setValue('#autorotate', false);
test('auto-rotate off', () => check(!lab.ui.view.autoRotate));
clickOn('#btn-reset');
const s0 = q('#seed').value;
clickOn('#btn-rand');
test('random seed', () => check(q('#seed').value !== s0));
shot('light');

lab.ui.prefs.restore(saved);
done('triposplat');
