// StyleGAN3 Lab — the live app through its real async job queue: every seam is
// driven by its buttons, and each wait is on the queue draining (engine busy()),
// not on a sleep. Needs the ffhqu-256 checkpoint + GPU (tagged ml):
//   scripts/validate.sh --ml demos/stylegan3-lab
import { check, eq, test, done, waitFor, frames, q, text, clickOn, setValue, shot } from "/lib/kit/test.js";
import { requireWeights } from "/lib/kit/weights.js";
import { S } from "/app/lib/state.js";
import { busy } from "/app/lib/engine.js";

const DIR = requireWeights('StyleGAN3 ffhqu-256', ['brovisionml/weights/stylegan3-r-ffhqu-256'],
                           { probe: 'model.safetensors' });
const LONG = 180000;
const settle = (what) => {
    waitFor(() => !busy(), what, LONG);
    check(!q('#status').classList.contains('err'), what + ': ' + text('#status'));
};
const painted = (sel, n) => { const c = q(sel); return c.width === n && c.height === n; };

test('boot resolves a checkpoint through weights.js', () => {
    check(q('#model-dir').value.length > 0, 'model dir filled: ' + q('#model-dir').value);
    check(!/D:\//.test(q('#model-dir').placeholder), 'no hardcoded path in the page');
});

test('load the ffhqu-256 checkpoint; config read from the name', () => {
    q('#model-dir').value = DIR;
    setValue('#resolution', '512');          // wrong on purpose: the change reloads, the name wins
    eq(q('#resolution').value, '256');
    eq(q('#variant').value, 'r');
    waitFor(() => S.gan, 'model ready', LONG);
    settle('initial sample');
    eq(S.META.resolution, 256);
    check(/256² · config-R/.test(text('#model-meta')), 'meta: ' + text('#model-meta'));
    eq(+q('#cutoff').max, S.META.numWs, 'cutoff sized to numWs');
});

test('sample: seed → image, → A/B', () => {
    setValue('#seed', '7');
    settle('sample');
    check(painted('#sample-canvas', 256), 'sample canvas at model res');
    eq(text('#sample-meta'), 'seed 7 · ψ 0.70 · cutoff all');
    eq(S.lastSample.seed, 7);
    clickOn('#btn-to-a');
    eq([q('#walk-a').value, q('#mix-a').value], ['7', '7']);
    frames(2);
    shot('sample');
});

test('walk: anchors, live midpoint, strip', () => {
    clickOn('#seam-walk');
    check(!q('#panel-walk').hidden && q('#panel-sample').hidden, 'walk panel shown');
    settle('walk anchors + midpoint');
    check(S.walkWA && S.walkWB, 'both anchors mapped');
    check(/^t = 0\.50/.test(text('#walk-meta')), 'midpoint rendered: ' + text('#walk-meta'));
    setValue('#walk-t', '0.25');
    settle('walk t');
    check(/^t = 0\.25/.test(text('#walk-meta')), 'midpoint follows t');
    setValue('#walk-steps', '5');
    clickOn('#btn-walk-strip');
    settle('walk strip');
    eq(q('#walk-strip').children.length, 5);
    check(painted('#walk-strip canvas:last-child', 256), 'strip cells drawn');
    frames(2);
    shot('walk');
});

test('latest wins: re-seeding mid-flight still maps the newest anchors', () => {
    setValue('#walk-a', '55');
    setValue('#walk-b', '66');
    settle('walk re-issue');
    check(S.walkWA && S.walkWB, 're-issued anchors mapped');
});

test('mix: crossover rows', () => {
    clickOn('#seam-mix');
    settle('mix sources + result');
    check(S.mixWA && S.mixWB, 'both sources mapped');
    eq(text('#mix-meta'), 'coarse 0–7 from A · fine 8–' + (S.META.numWs - 1) + ' from B');
    setValue('#mix-k', '0');
    settle('mix k=0');
    eq(text('#mix-meta'), 'all rows from B');
    eq(text('#mix-k-val'), '0');
    setValue('#mix-k', '8');
    settle('mix k=8');
    frames(2);
    shot('mix');
});

test('grid: 3×3 page, paging, click → sample', () => {
    clickOn('#seam-grid');
    setValue('#grid-size', '3');
    settle('grid');
    eq(q('#grid-out').children.length, 9);
    check(painted('#grid-out canvas:last-child', 256), 'last tile drawn');
    frames(2);
    shot('grid');
    clickOn('#btn-grid-next');
    eq(q('#grid-base').value, '9');
    settle('grid page');
    eq(q('#grid-out').firstChild.dataset.seed, '9');
    clickOn('#grid-out canvas:nth-child(2)');
    eq(S.seam, 'sample');
    eq(q('#seed').value, '10');
    settle('grid → sample');
});

test('invert: from seed, chunked Adam, loss falls, → A pins into Walk', () => {
    clickOn('#seam-invert');
    check(/pick a target/.test(text('#inv-meta')), 'asks for a target');
    clickOn('#btn-inv-from-seed');
    settle('inversion target');
    check(S.invTargetData && S.invTargetData.width === 256, 'target captured at model res (RGBA)');
    eq(S.invTargetData.data.length, 256 * 256 * 4);
    setValue('#inv-steps', '50');
    clickOn('#btn-invert');
    settle('invert 2 chunks');
    eq(S.invCurve.length, 50, 'loss curve spans both chunks');
    check(S.invCurve[49] < S.invCurve[0], 'loss fell: ' + S.invCurve[0] + ' → ' + S.invCurve[49]);
    check(/^step 50\/50 · mse /.test(text('#inv-meta')), 'meta: ' + text('#inv-meta'));
    check(S.invW && S.invW.length === S.META.numWs * S.META.wDim, 'recovered w+');
    frames(2);
    shot('invert');
    clickOn('#btn-inv-to-a');
    eq(S.pinnedA, S.invW);
    eq(S.seam, 'walk');
    settle('walk from pinned A');
    eq(S.walkWA, S.invW, 'walk anchor A is the recovered latent');
});

test('ψ change invalidates cached anchors and re-renders', () => {
    setValue('#psi', '0.5');
    eq(text('#psi-val'), '0.50');
    settle('walk after ψ');
    check(S.walkWA && S.walkWB, 'anchors re-mapped');
    setValue('#cutoff', '4');
    eq(text('#cutoff-val'), '4');
    settle('walk after cutoff');
});

done('stylegan3-lab ui');
