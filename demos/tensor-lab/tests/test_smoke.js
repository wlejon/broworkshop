// Tensor Lab smoke test: every preset propagates shapes with no errors and
// runs its whole forward pass on the device. The toolbar's Step / Run / Reset
// work through real clicks, and the Attention Lab preset exposes its per-head
// attention map to the inspector.
//
//   scripts/validate.sh demos/tensor-lab

import { check, eq, test, done, frames, waitFor, clickOn, text, shot, skip } from "/lib/kit/test.js";
import { Presets } from "/app/lab/presets.js";
import { tlab } from "/app/lab.js";

frames(10);
const g = tlab.graph;

test('boots on the default preset', () => {
    check(g.nodes.length > 0 && g.edges.length > 0, g.nodes.length + ' nodes, ' + g.edges.length + ' edges');
    eq(tlab.el.preset.value, 'Transformer Encoder Block', 'preset select');
    check(document.querySelectorAll('#palette .pal-op').length > 20, 'palette filled');
    check(/node/.test(text('#stat-nodes')), 'stats shown');
});

if (!tlab.runner.ready()) skip('bro.tensor has no GPU backend');

for (const p of Presets.list()) {
    test('preset "' + p.name + '" propagates and runs', () => {
        tlab.loadPreset(p.name);
        g.propagate();
        const bad = g.nodes.filter((n) => n.error).map((n) => n.type + ': ' + n.error);
        eq(bad, [], 'shape errors');
        const ran = tlab.runner.run(() => {});
        eq(ran, g.nodes.length, 'ops executed');
    });
}

tlab.loadPreset('Transformer Encoder Block');
test('Step runs one op and selects it', () => {
    clickOn('#btn-step');
    check(/^ran /.test(text('#status')), 'status ' + text('#status'));
    check(tlab.editor.activeNode, 'active node');
});
clickOn('#btn-reset');
clickOn('#btn-run');
waitFor(() => !tlab.running, 'animated run', 60000);
test('Run completes the forward pass', () => {
    check(/Forward pass complete/.test(text('#status')), 'status ' + text('#status'));
    check(g.nodes.every((n) => n._ran), 'every node ran');
});

tlab.loadPreset('Attention Lab');
tlab.runner.run(() => {});
const mha = g.nodes.find((n) => n.type === 'mha');
test('Attention Lab exposes the attention map', () => {
    check(mha && mha._attn, 'mha attention cache');
    check(mha._attn.heads > 0 && mha._attn.seq > 0, mha._attn.heads + ' heads, seq ' + mha._attn.seq);
});
tlab.editor.select(mha, null);
tlab.editor.resize();
tlab.editor.frameAll();
frames(5);
shot('attention');
done('tensor-lab smoke');
