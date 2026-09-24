// Kit App — exercises lib/kit end to end (layout, params, tabs, toggle, log,
// status) and lib/kit/test.js itself. Run: scripts/validate.sh templates/kit-app
import { check, eq, frames, waitFor, clickOn, setValue, text, q, test, done, shot, throws } from "/lib/kit/test.js";
import { h, fmtBytes, fmtMs } from "/lib/kit/dom.js";
import { weightsRoot, findWeights, weightPath, missingWeights } from "/lib/kit/weights.js";

frames(10);

test('boot: status, log, stats', () => {
    eq(text('#status'), 'running');
    check(q('#status').className === 'ok', 'status styled ok');
    check(q('#log').childElementCount >= 1, 'boot logged');
    check(/\d/.test(text('#stats')), 'stats readouts filled');
});

test('layout: side panel, viewport, statusbar have boxes', () => {
    const side = q('.k-side').getBoundingClientRect();
    const vp = q('.k-viewport').getBoundingClientRect();
    const bar = q('.k-statusbar').getBoundingClientRect();
    check(side.width > 250 && side.height > 200, 'side panel sized');
    check(vp.left >= side.right - 1 && vp.width > 400, 'viewport right of side panel');
    check(bar.bottom <= innerHeight + 1 && bar.top > vp.top, 'statusbar at the bottom');
});

test('params: range builds a row with a readout; input updates state + log', () => {
    const rows = document.querySelectorAll('#params .k-field');
    eq(rows.length, 4, 'four param rows');
    const range = rows[2].querySelector('input[type=range]');
    eq(rows[2].querySelector('.k-val').textContent, '200°', 'hue readout');
    const before = q('#log').childElementCount;
    setValue(range, 90);
    eq(rows[2].querySelector('.k-val').textContent, '90°', 'readout follows');
    check(q('#log').childElementCount === before + 1, 'onChange logged');
});

test('bindControl: select round-trips its value', () => {
    setValue('#shape', 'square');
    check(/shape = square/.test(q('#log').lastElementChild.textContent), 'select change seen');
});

test('tabs switch panes', () => {
    clickOn('[data-tab=about]');
    check(q('[data-pane=about]').hidden === false && q('[data-pane=params]').hidden === true, 'about shown');
    clickOn('[data-tab=params]');
    check(q('[data-pane=params]').hidden === false, 'params back');
});

test('toggle button pauses the loop', () => {
    clickOn('#pause');
    eq(text('#pause'), 'Resume');
    check(q('#pause').classList.contains('active'), 'active class');
    eq(text('#status'), 'paused');
    clickOn('#run');
    eq(text('#pause'), 'Pause');
});

test('dom helpers', () => {
    const el = h('button.small.primary#x', { title: 'hi', dataset: { k: 'v' }, style: { color: 'red' } }, 'go', 1, null);
    eq([el.id, el.className, el.title, el.dataset.k, el.textContent], ['x', 'small primary', 'hi', 'v', 'go1']);
    eq(fmtBytes(1536), '1.5 KB');
    eq(fmtMs(2500), '2.50 s');
});

test('weights: root is absolute, relative resolves under it, misses are null', () => {
    const root = weightsRoot();
    check(/^([A-Za-z]:)?\//.test(root), 'absolute root: ' + root);
    eq(weightPath('brolm/weights/x'), root + '/brolm/weights/x');
    eq(findWeights(['no/such/weights-dir']), null);
    check(/BRO_WEIGHTS/.test(missingWeights('x', ['a'])), 'miss message says how to fix');
    check(findWeights([bro.appDir.replace(/\\/g, '/')], { probe: 'bro.json' }) !== null, 'absolute + probe hit');
});

test('test helpers: waitFor and throws', () => {
    let n = 0;
    setTimeout(() => { n = 1; }, 100);
    waitFor(() => n === 1, 'timer', 2000);
    throws(() => waitFor(() => false, 'never', 50), /timed out/);
});

shot('main');
done('kit-app');
