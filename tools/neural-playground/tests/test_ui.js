// The page: controls drive the state, training moves the metrics, layers
// add and remove, datasets switch, and the backend badge tells the truth.

import { check, eq, test, done, frames, clickOn, q, setValue, shot, press } from "/lib/kit/test.js";

frames(5);
const pg = globalThis.neuralPlayground;
check(pg, 'main.js publishes the playground');
const text = (sel) => q(sel).textContent.trim();
const metric = (label) => [...q('#metrics').children].find((r) => r.firstChild.textContent === label).lastChild.textContent;

// Builds without the AI tower report bro.tensor as { available: false }; the
// page then boots on (and only offers) the JS reference backend.
const HAS_TENSOR = !!(bro.tensor && bro.tensor.available);

test('boots on bro.tensor (or the JS reference without it) with an honest badge', () => {
    if (HAS_TENSOR) {
        eq(pg.state.backend, 'tensor', 'default backend');
        check(/^bro\.tensor · /.test(text('#backend-badge')), 'badge: ' + text('#backend-badge'));
        eq(pg.model.backend, 'tensor', 'model backend');
    } else {
        eq(pg.state.backend, 'js', 'default backend without bro.tensor');
        eq(text('#backend-badge'), 'JS', 'badge');
        const sel = q('#hyper').querySelectorAll('select');
        eq([...sel[sel.length - 1].options].map((o) => o.value), ['js'], 'only the JS backend is offered');
    }
    eq(metric('Epoch'), '0', 'epoch 0');
});

test('Train runs epochs and lowers the loss', () => {
    setValue(q('#hyper select'), '0.1');                     // learning rate
    eq(pg.state.lr, '0.1', 'lr bound');
    const loss0 = pg.last.train.loss;
    clickOn('#btn-play');
    check(pg.state.playing && q('#btn-play').classList.contains('active'), 'playing');
    frames(40);
    clickOn('#btn-play');
    check(!pg.state.playing, 'paused');
    check(pg.state.epoch >= 40, 'epochs: ' + pg.state.epoch);
    eq(metric('Epoch'), String(pg.state.epoch), 'epoch readout');
    check(pg.last.train.loss < loss0, 'loss ' + loss0 + ' -> ' + pg.last.train.loss);
    shot('trained');
});

test('Step trains exactly one epoch; Reset clears', () => {
    const e = pg.state.epoch;
    clickOn('#btn-step');
    eq(pg.state.epoch, e + 1, 'one epoch');
    clickOn('#btn-reset');
    eq(pg.state.epoch, 0, 'reset epoch');
    eq(pg.state.history.length, 1, 'history restarted');
});

test('layers: add, remove, neuron chips', () => {
    clickOn('#btn-add-layer');
    eq(pg.model.layerSizes, [2, 8, 8, 6, 1], 'layer added');
    eq(q('#layer-chips').children.length, 3, 'three chips');
    clickOn('.np-chip[data-layer="0"] button[data-action="inc"]');
    eq(pg.model.layerSizes[1], 9, 'neuron added');
    clickOn('#btn-remove-layer');
    clickOn('#btn-remove-layer');
    eq(pg.model.layerSizes, [2, 9, 1], 'layers removed');
    check(q('#btn-remove-layer').disabled, 'cannot remove the last hidden layer');
});

test('dataset switch and sample count regenerate the data', () => {
    clickOn('#datasets button[data-value="xor"]');
    eq(pg.state.dataset, 'xor', 'dataset');
    check(q('#datasets button[data-value="xor"]').classList.contains('active'), 'segment active');
    setValue(q('#data-params').querySelectorAll('input')[1], 400);
    eq(pg.data.train.y.length + pg.data.test.y.length, 400, 'sample count');
});

test('JS reference backend switch, and space toggles training', () => {
    const sel = q('#hyper').querySelectorAll('select');
    setValue(sel[sel.length - 1], 'js');
    eq(pg.model.backend, 'js', 'backend switched');
    eq(text('#backend-badge'), 'JS', 'badge');
    clickOn('#boundary');                  // focus leaves the controls
    press('Space');
    frames(3);
    check(pg.state.playing, 'space starts training');
    press('Space');
    check(!pg.state.playing, 'space pauses');
    if (HAS_TENSOR) {
        setValue(sel[sel.length - 1], 'tensor');
        eq(pg.model.backend, 'tensor', 'back on bro.tensor');
    }
});

done('neural-playground ui');
