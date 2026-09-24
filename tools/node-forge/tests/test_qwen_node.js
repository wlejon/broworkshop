// Qwen TTS card across all three checkpoint variants: the default
// CustomVoice checkpoint resolves without a hardcoded path, the first synth
// + trace land, exec() matches the live path at greedy sampling, a designed
// voice takes over the speaker slot, a delivery dial and a steer bias
// re-synthesize, the trace cards render, and VoiceDesign / Base mount.

import { check, eq, test, done, frames, needWeights, waitFor, q, shot } from "/lib/kit/test.js";

const root = needWeights('Qwen3-TTS checkpoints', ['brosoundml/weights/qwen-tts'], { probe: '0.6B-customvoice/config.json' });
frames(3);
const F = globalThis.nodeForge;
const node = F.view.addAtCentre('qwen');
frames(2);
const card = () => F.view.card(node).root;
// A dialog section by summary text, opened the way a user does (a summary click).
function section(name) {
    const d = [...q('.ng-dialog-body').querySelectorAll('details')].find((x) => x.querySelector('summary').textContent.includes(name));
    if (!d.open) { d.querySelector('summary').click(); frames(1); }
    check(d.open, `section ${name} opened`);
    return d;
}
const changed = (n, prev) => () => n._out && n._out[0].samples !== prev;

test('CustomVoice loads and speaks', () => {
    check(/0\.6B-customvoice$/.test(node.params.modelDir), 'model dir: ' + node.params.modelDir);
    waitFor(() => (node._out && node._out[0]) || node.error, 'first synth', 180000, 16);
    check(!node.error, 'error: ' + node.error);
    eq(node._variant, 'customvoice', 'variant');
    check(node._voiceBasis, 'voice basis via the sibling 0.6B-Base');
    check(card().querySelector('button.active').textContent === 'cv', 'cv chip active');
    card().querySelector('.ng-gear').click();
});

test('exec() matches the live path at greedy sampling', () => {
    const first = node._out[0].samples;
    eq(F.run(), 1, 'ran');
    eq(node._out[0].samples.length, first.length, 'length');
    for (let i = 0; i < first.length; i += 97) check(Math.abs(node._out[0].samples[i] - first[i]) < 1e-5, 'sample ' + i);
});

test('a voice-design slider switches to the designed voice', () => {
    const sec = section('Voice design');
    const slider = sec.querySelector('.basis-sliders input[type=range]');
    const prev = node._out[0].samples;
    slider.value = String(+slider.max * 0.6);
    slider.dispatchEvent(new Event('input'));
    waitFor(changed(node, prev), 're-synth', 180000, 16);
    eq(node.params.cvSource, 'designed', 'cvSource');
});

test('delivery: temperature re-synthesizes', () => {
    const sec = section('Delivery');
    const temp = sec.querySelector('.dial input[type=range]');
    const prev = node._out[0].samples;
    temp.value = '0.8';
    temp.dispatchEvent(new Event('input'));
    waitFor(changed(node, prev), 'sampled re-synth', 300000, 16);
    eq(node.params.sampling.temperature, 0.8, 'temperature');
    check(/sampling · seed/.test(sec.querySelector('.axis-note').textContent), 'delivery note');
});

test('steer: a logit bias re-synthesizes', () => {
    const sec = section('Steer');
    sec.querySelector('input[type=number]').value = '5';
    const prev = node._out[0].samples;
    [...sec.querySelectorAll('button')].find((b) => b.textContent.includes('bias')).click();
    waitFor(changed(node, prev), 'steered re-synth', 300000, 16);
    eq(Object.keys(node.params.steer), ['5'], 'steer recorded');
    check(sec.querySelector('.steer-entry'), 'steer row');
});

test('trace cards', () => {
    const sec = section('Pipeline trace');
    check(sec.querySelectorAll('.trace-card').length >= 2, 'codes + audio cards');
    shot('qwen-dialog');
    q('.ng-dialog-close').click();
    card().querySelector('.ng-del').click();
    eq(F.graph.nodes.length, 0, 'deleted');
});

function mountVariant(name, variant, withBasis) {
    const n = F.view.addAtCentre('qwen', { modelDir: root + '/' + name });
    waitFor(() => (n._out && n._out[0]) || n.error, name + ' synth', 180000, 16);
    check(!n.error, name + ': ' + n.error);
    eq(n._variant, variant, 'variant');
    eq(!!n._voiceBasis, withBasis, 'basis');
    return n;
}

test('VoiceDesign mounts without a basis', () => { mountVariant('1.7B-voicedesign', 'voicedesign', false); });
test('Base mounts with its designer basis', () => {
    const b = mountVariant('0.6B-Base', 'base', true);
    eq(b.params.coords.length, b._voiceBasis.k, 'coords sized to k');
});

done('node-forge qwen');
