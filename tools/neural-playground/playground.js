// Neural Playground: the page's state, training loop and controls.
//
// mountPlayground() wires the static layout in index.html and returns a
// handle (state, model, data, and the actions the buttons run) that
// main.js publishes as globalThis.neuralPlayground for tests.

import { $, h, clear } from "/lib/kit/dom.js";
import { params } from "/lib/kit/params.js";
import { segmented, readout, toggleButton } from "/lib/kit/ui.js";
import { generateDataset, DATASETS } from "./datasets.js";
import { ACTIVATIONS, OPTIMIZERS } from "./model/mlp.js";
import { JsMLP } from "./model/js-mlp.js";
import { TensorMLP, tensorAvailable } from "./model/tensor-mlp.js";
import { GRID_POINTS, drawBoundary, drawNetwork, drawLoss } from "./view.js";

export const BACKENDS = { tensor: 'bro.tensor', js: 'JS reference' };
const MAX_LAYERS = 5, MAX_NEURONS = 16, EPOCHS_PER_FRAME = 4, HISTORY = 300;

/** A model for `backend` ('tensor' | 'js'). */
export function createModel(backend, sizes, activation, seed) {
    const Cls = backend === 'tensor' ? TensorMLP : JsMLP;
    return new Cls(sizes, activation, seed);
}

export function mountPlayground(status) {
    const hasTensor = tensorAvailable();
    const state = {
        dataset: 'spiral', noise: 0.10, samples: 250,
        lr: '0.03', activation: 'tanh', optimizer: 'adam', batch: '50', decay: '0.0001',
        backend: hasTensor ? 'tensor' : 'js',
        hidden: [8, 8], playing: false, epoch: 0, history: [],
    };
    const sizes = () => [2, ...state.hidden, 1];
    const trainOpts = () => ({
        lr: parseFloat(state.lr), optimizer: state.optimizer,
        batchSize: parseInt(state.batch, 10), weightDecay: parseFloat(state.decay),
    });

    const pg = {
        state,
        model: createModel(state.backend, sizes(), state.activation),
        data: generateDataset(state.dataset, state.samples, state.noise, 0.75),
        last: null,               // last evaluation { train, test }
    };

    // --- actions ---------------------------------------------------------------------
    function restartHistory() {
        state.epoch = 0;
        state.history = [];
        evaluate();
    }
    pg.rebuild = () => {
        pg.model.rebuild(sizes(), state.activation);
        restartHistory();
    };
    pg.regenerate = () => {
        pg.data = generateDataset(state.dataset, state.samples, state.noise, 0.75);
        restartHistory();
    };
    pg.reset = () => {
        pg.model.reset();
        restartHistory();
    };
    pg.setBackend = (b) => {
        if (b === 'tensor' && !hasTensor) throw new Error('bro.tensor is not in this build');
        state.backend = b;
        pg.model = createModel(b, sizes(), state.activation);
        badge.textContent = pg.model.device;
        restartHistory();
        status.ok('backend: ' + pg.model.device);
    };
    /** Train `n` epochs (no drawing). */
    pg.train = (n) => {
        const o = trainOpts();
        for (let i = 0; i < (n || 1); i++) {
            pg.model.trainEpoch(pg.data.train, o, Math.random);
            state.epoch++;
        }
    };
    function evaluate() {
        const train = pg.model.evaluate(pg.data.train), test = pg.model.evaluate(pg.data.test);
        pg.last = { train, test };
        state.history.push({ epoch: state.epoch, trainLoss: train.loss, testLoss: test.loss, trainAcc: train.accuracy, testAcc: test.accuracy });
        if (state.history.length > HISTORY) state.history.shift();
        render();
        return pg.last;
    }
    pg.evaluate = evaluate;
    pg.step = () => { setPlaying(false); pg.train(1); evaluate(); };
    pg.setPlaying = (on) => setPlaying(on);

    // --- drawing ---------------------------------------------------------------------
    const canvases = { boundary: $('#boundary'), loss: $('#loss'), network: $('#network') };
    function render() {
        const { train, test } = pg.last;
        metrics.set({
            epoch: state.epoch, trainLoss: train.loss.toFixed(4), testLoss: test.loss.toFixed(4),
            trainAcc: (train.accuracy * 100).toFixed(1) + '%',
        });
        metrics.set('testAcc', (test.accuracy * 100).toFixed(1) + '%', true);
        drawBoundary(canvases.boundary, pg.model.predict(GRID_POINTS, GRID_POINTS.length / 2), pg.data);
        drawNetwork(canvases.network, pg.model.layerSizes, pg.model.weights());
        drawLoss(canvases.loss, state.history);
    }
    pg.render = render;

    function renderChips() {
        const box = $('#layer-chips');
        clear(box);
        state.hidden.forEach((n, i) => {
            const bump = (d) => () => {
                const v = state.hidden[i] + d;
                if (v < 1 || v > MAX_NEURONS) return;
                state.hidden[i] = v;
                renderChips();
                pg.rebuild();
            };
            box.appendChild(h('div.np-chip', { dataset: { layer: String(i) } },
                h('span.k-cap', null, 'Hidden ' + (i + 1)),
                h('div.k-row', null,
                    h('button.small', { onclick: bump(-1), dataset: { action: 'dec' } }, '−'),
                    h('b', null, String(n)),
                    h('button.small', { onclick: bump(1), dataset: { action: 'inc' } }, '+'))));
        });
        $('#btn-add-layer').disabled = state.hidden.length >= MAX_LAYERS;
        $('#btn-remove-layer').disabled = state.hidden.length <= 1;
    }
    pg.addLayer = () => {
        if (state.hidden.length >= MAX_LAYERS) return;
        state.hidden.push(6);
        renderChips();
        pg.rebuild();
    };
    pg.removeLayer = () => {
        if (state.hidden.length <= 1) return;
        state.hidden.pop();
        renderChips();
        pg.rebuild();
    };

    // --- controls --------------------------------------------------------------------
    const badge = $('#backend-badge');
    badge.textContent = pg.model.device;
    const metrics = readout('#metrics', {
        epoch: 'Epoch', trainLoss: 'Train loss', testLoss: 'Test loss',
        trainAcc: 'Train accuracy', testAcc: 'Test accuracy',
    });

    pg.datasets = segmented('#datasets', DATASETS, {
        value: state.dataset,
        onChange: (v) => { state.dataset = v; pg.regenerate(); },
    });
    const play = toggleButton('#btn-play', {
        labels: ['▶ Train', '⏸ Pause'],
        onChange: (on) => setPlaying(on),
    });
    function setPlaying(on) {
        state.playing = !!on;
        play.on = state.playing;
    }
    $('#btn-step').addEventListener('click', pg.step);
    $('#btn-reset').addEventListener('click', pg.reset);
    $('#btn-add-layer').addEventListener('click', pg.addLayer);
    $('#btn-remove-layer').addEventListener('click', pg.removeLayer);

    const numOpts = (list) => list.map((v) => [v, v]);
    pg.hyper = params('#hyper', state, {
        lr:         { label: 'learning rate', options: numOpts(['0.001', '0.005', '0.01', '0.03', '0.1', '0.3']) },
        activation: { options: ACTIVATIONS },
        optimizer:  { options: OPTIMIZERS, hint: 'adam: L2 in the gradient · adamw: decoupled decay · sgd: momentum 0.85' },
        batch:      { label: 'batch size', options: [['10', '10'], ['20', '20'], ['50', '50'], ['100', '100'], ['0', 'full batch']] },
        decay:      { label: 'weight decay', options: [['0', 'none'], ['0.0001', '0.0001'], ['0.001', '0.001'], ['0.01', '0.01']] },
        backend:    { options: hasTensor ? BACKENDS : { js: BACKENDS.js }, hint: 'where the network trains; the JS reference is the parity oracle' },
    }, {
        onChange: (key, v) => {
            if (key === 'activation') pg.rebuild();
            else if (key === 'backend') pg.setBackend(v);
        },
    });
    pg.dataParams = params('#data-params', state, {
        noise:   { min: 0, max: 0.5, step: 0.02, fmt: (v) => Math.round(v * 100) + '%' },
        samples: { min: 60, max: 500, step: 20, fmt: (v) => String(v | 0) },
    }, { onChange: () => pg.regenerate() });

    window.addEventListener('keydown', (e) => {
        const t = e.target && e.target.tagName;
        if (e.key !== ' ' || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t || '')) return;
        play.toggle();
        e.preventDefault();
    });

    // --- loop ------------------------------------------------------------------------
    // Several epochs per frame: the sets are small and convergence is the show.
    function frame() {
        if (state.playing) {
            pg.train(EPOCHS_PER_FRAME);
            evaluate();
        }
        requestAnimationFrame(frame);
    }

    renderChips();
    restartHistory();
    requestAnimationFrame(frame);
    if (hasTensor) status.ok('training on ' + pg.model.device + ' — press Train (or space)');
    else status.warn('bro.tensor is not in this build: training on the JS reference');
    return pg;
}
