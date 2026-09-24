// Kokoro Voice card: the data root resolves without a hardcoded path, the
// first async synth + trace land, exec() matches the live path, a voice
// slider re-synthesizes, a duration edit re-decodes and pins the prosody,
// VAD emotion re-decodes, and collapse / delete work.

import { check, eq, test, done, frames, needWeights, waitFor, q, shot } from "/lib/kit/test.js";

needWeights('Kokoro data (brosoundml-data)', ['brosoundml-data'], { probe: 'kokoro/voice_basis.json' });
frames(3);
const F = globalThis.nodeForge;
const node = F.view.addAtCentre('kokoro');
frames(2);
const card = () => F.view.card(node).root;
// A dialog section by summary text, opened the way a user does (a summary click).
function section(name) {
    const d = [...q('.ng-dialog-body').querySelectorAll('details')].find((x) => x.querySelector('summary').textContent.includes(name));
    if (!d.hasAttribute('open')) { d.querySelector('summary').click(); frames(1); }
    return d;
}
const changed = (prev) => () => node._out && node._out[0].samples !== prev;

test('loads and speaks', () => {
    check(/brosoundml-data$/.test(node.params.dataRoot), 'data root: ' + node.params.dataRoot);
    waitFor(() => (node._out && node._out[0]) || node.error, 'first synth', 120000, 16);
    check(!node.error, 'error: ' + node.error);
    check(node._out[0].samples.length > 0, 'samples');
    check(node._basis && node._lastTrace, 'basis + trace');
    eq(node.params.coords.length, node._basis.k, 'coords sized to the basis');
    card().querySelector('.ng-gear').click();
    check(section('Voice design').querySelectorAll('.pc input[type=range]').length === node._basis.k, 'voice sliders');
});

test('exec() matches the live path', () => {
    const first = node._out[0].samples;
    eq(F.run(), 1, 'ran');
    eq(node._out[0].samples.length, first.length, 'length');
    for (let i = 0; i < first.length; i += 97) check(Math.abs(node._out[0].samples[i] - first[i]) < 1e-5, 'sample ' + i);
});

test('a voice slider re-synthesizes', () => {
    const sec = section('Voice design');
    const slider = sec.querySelector('.pc input[type=range]');
    slider.value = String(+slider.max * 0.6);
    slider.dispatchEvent(new Event('input'));
    waitFor(changed(node._out[0].samples), 're-synth', 120000, 16);
    check(node.params.coords[0] !== 0, 'coord set');
});

test('a duration edit re-decodes and pins the prosody', () => {
    const sec = section('Prosody');
    waitFor(() => sec.querySelector('.acell'), 'duration cells', 60000, 16);
    const num = sec.querySelector('.acell-num');
    const prev = node._out[0].samples;
    num.value = String(+num.value + 5);
    num.dispatchEvent(new Event('change'));
    waitFor(changed(prev), 're-decode', 120000, 16);
    waitFor(() => node._pinnedEdit, 'pinned edit', 60000, 16);
    check(sec.querySelector('.axis-note').style.display !== 'none', 'pin label shown');
});

test('VAD emotion re-decodes', () => {
    const sec = section('prosody (VAD)');
    const arousal = sec.querySelectorAll('input[type=range]')[1];
    const prev = node._out[0].samples;
    arousal.value = '0.8';
    arousal.dispatchEvent(new Event('input'));
    waitFor(changed(prev), 'emotion decode', 120000, 16);
    eq(node.params.emo.a, 0.8, 'arousal');
    shot('kokoro-dialog');
});

test('close, collapse, delete', () => {
    q('.ng-dialog-close').click();
    eq(q('.ng-dialog-backdrop').style.display, 'none', 'closed');
    card().querySelector('.ng-collapse').click();
    check(node.collapsed, 'collapsed');
    card().querySelector('.ng-collapse').click();
    card().querySelector('.ng-del').click();
    eq([F.graph.nodes.length, document.querySelectorAll('.ng-card').length], [0, 0], 'gone');
});

done('node-forge kokoro');
