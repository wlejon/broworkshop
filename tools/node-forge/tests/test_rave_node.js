// RAVE Morph card: model load from the dialog, the initial decode, every
// latent dim in the dialog's curve grid, exec() matching the live path,
// card and dialog curve views staying in sync, a paint re-decoding, and
// delete / undo keeping the model. Needs the magnets_z8 RAVE checkpoint.

import { check, eq, test, done, frames, needWeights, q, setValue, shot } from "/lib/kit/test.js";

const dir = needWeights('RAVE magnets_z8', ['brosoundml-data/rave/magnets_z8'], { probe: 'config.json' });
frames(3);
const F = globalThis.nodeForge;
const node = F.view.addAtCentre('rave');
frames(2);
const card = () => F.view.card(node).root;

test('the card starts empty and asks for a model', () => {
    check(/set a model directory/.test(card().querySelector('.curve-stats').textContent), 'empty caption');
    check(node.params.dir === '' && node.params.kind === 'harm', 'defaults');
});

test('model dir from the dialog: load, encode, decode', () => {
    card().querySelector('.ng-gear').click();
    eq(q('.ng-dialog-backdrop').style.display, 'flex', 'dialog open');
    setValue(q('.ng-dialog-body input[type=text]'), dir);
    frames(3);
    check(!node.error, 'error: ' + node.error);
    check(node._out && node._out[0].samples.length > 0, 'audio out');
    check(/latent/.test(card().querySelector('.ng-badge').textContent), 'badge: ' + card().querySelector('.ng-badge').textContent);
    eq(document.querySelectorAll('.ng-dialog-body .curve-cell').length, node._enc.nLatent, 'one curve per latent dim');
    check(F.project.isDirty(), 'project dirty');
});

test('exec() matches the live path', () => {
    const first = node._out[0].samples;
    eq(F.run(), 1, 'ran one node');
    const again = node._out[0].samples;
    eq(again.length, first.length, 'length');
    for (let i = 0; i < first.length; i += 97) check(Math.abs(again[i] - first[i]) < 1e-5, 'sample ' + i);
});

test('dialog edits show on the card', () => {
    const cell = document.querySelectorAll('.ng-dialog-body .curve-cell')[1];
    const r = cell.querySelector('canvas').getBoundingClientRect();
    cell._testMouseDown({ clientX: r.left + 5, clientY: r.top + 10 });
    cell._testMouseMove({ clientX: r.left + 40, clientY: r.top + 70 });
    cell._testMouseUp();
    frames(6);
    q('.ng-dialog-close').click();
    eq(q('.ng-dialog-backdrop').style.display, 'none', 'dialog closed');
    setValue(card().querySelector('select'), '1');
    check(/Δ/.test(card().querySelector('.curve-cell .curve-stats').textContent), 'card shows the dim-1 edit');
});

test('painting on the card re-decodes', () => {
    const prev = node._out[0].samples;
    const cell = card().querySelector('.curve-cell');
    const r = cell.querySelector('canvas').getBoundingClientRect();
    cell._testMouseDown({ clientX: r.left + 5, clientY: r.top + 10 });
    cell._testMouseMove({ clientX: r.left + 40, clientY: r.top + 60 });
    cell._testMouseUp();
    frames(6);
    check(node._out[0].samples !== prev, 're-decoded');
    check(/s · \d+Hz/.test(card().querySelector('.audio-preview .curve-stats').textContent), 'output caption');
    shot('rave');
});

test('delete, undo: the card comes back with its model', () => {
    const rave = node._rave;
    card().querySelector('.ng-del').click();
    eq(F.graph.nodes.length, 0, 'deleted');
    F.history.undo();
    frames(2);
    eq(F.graph.nodes.length, 1, 'restored');
    check(node._rave === rave, 'model kept');
    check(F.view.card(node).root.querySelectorAll('.curve-cell').length === 1, 'card curve rebuilt');
});

done('node-forge rave');
