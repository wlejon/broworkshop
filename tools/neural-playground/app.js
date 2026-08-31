// app.js — Main application orchestration for Neural Playground
import { generateDataset } from './datasets.js';
import { TensorModel } from './tensor_model.js';
import { Visualizer } from './visualizer.js';

window.addEventListener('DOMContentLoaded', () => {
    // Canvas elements
    const boundaryCanvas = document.getElementById('boundaryCanvas');
    const networkCanvas = document.getElementById('networkCanvas');
    const lossCanvas = document.getElementById('lossCanvas');

    // UI Buttons & Selectors
    const btnPlay = document.getElementById('btnPlay');
    const btnStep = document.getElementById('btnStep');
    const btnReset = document.getElementById('btnReset');
    const btnAddLayer = document.getElementById('btnAddLayer');
    const btnRemoveLayer = document.getElementById('btnRemoveLayer');
    const layerChipsContainer = document.getElementById('layerChips');

    const datasetButtons = document.querySelectorAll('.btn-ds');
    const sliderNoise = document.getElementById('sliderNoise');
    const sliderSamples = document.getElementById('sliderSamples');
    const lblNoise = document.getElementById('lblNoise');
    const lblSamples = document.getElementById('lblSamples');

    const selLr = document.getElementById('selLr');
    const selActivation = document.getElementById('selActivation');
    const selOptimizer = document.getElementById('selOptimizer');
    const selBatchSize = document.getElementById('selBatchSize');
    const selDecay = document.getElementById('selDecay');

    const metricEpoch = document.getElementById('metricEpoch');
    const metricTrainLoss = document.getElementById('metricTrainLoss');
    const metricTestLoss = document.getElementById('metricTestLoss');
    const metricAccuracy = document.getElementById('metricAccuracy');
    const backendBadge = document.getElementById('backendBadge');

    // State
    let currentDatasetType = 'spiral';
    let noise = 0.10;
    let sampleCount = 250;
    let isPlaying = false;
    let epoch = 0;

    // Architecture config: [input(2), hidden1(8), hidden2(8), output(1)]
    let hiddenSizes = [8, 8];
    let activation = 'tanh';

    // Model & Visualizer
    let model = new TensorModel([2, ...hiddenSizes, 1], [activation, activation, 'sigmoid']);
    const visualizer = new Visualizer(boundaryCanvas, networkCanvas, lossCanvas);
    let dataset = generateDataset(currentDatasetType, sampleCount, noise, 0.75);

    // Update backend badge
    if (typeof bro !== 'undefined' && bro.tensor && bro.tensor.available) {
        backendBadge.textContent = 'bro.tensor GPU';
        backendBadge.style.color = '#00ffaa';
    } else {
        backendBadge.textContent = 'bro.tensor CPU';
    }

    function renderUI() {
        renderLayerChips();
        visualizer.renderDecisionBoundary(model, dataset);
        visualizer.renderNetworkGraph(model);
        visualizer.renderLossChart();
    }

    function renderLayerChips() {
        layerChipsContainer.innerHTML = '';
        hiddenSizes.forEach((size, idx) => {
            const chip = document.createElement('div');
            chip.className = 'layer-chip';
            chip.innerHTML = `
                <div class="layer-chip-title">Hidden ${idx + 1}</div>
                <div class="layer-chip-controls">
                    <button class="btn-chip" data-action="dec" data-idx="${idx}">-</button>
                    <span>${size}</span>
                    <button class="btn-chip" data-action="inc" data-idx="${idx}">+</button>
                </div>
            `;
            layerChipsContainer.appendChild(chip);
        });

        // Add event listeners to chip buttons
        layerChipsContainer.querySelectorAll('.btn-chip').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(btn.dataset.idx, 10);
                const action = btn.dataset.action;
                if (action === 'inc' && hiddenSizes[idx] < 16) {
                    hiddenSizes[idx]++;
                } else if (action === 'dec' && hiddenSizes[idx] > 1) {
                    hiddenSizes[idx]--;
                }
                rebuildNetwork();
            });
        });
    }

    function rebuildNetwork() {
        const layerSizes = [2, ...hiddenSizes, 1];
        const acts = hiddenSizes.map(() => activation);
        acts.push('sigmoid');
        model.rebuild(layerSizes, acts);
        epoch = 0;
        metricEpoch.textContent = '0';
        visualizer.resetLossHistory();
        evaluateAndRender();
    }

    function refreshDataset() {
        dataset = generateDataset(currentDatasetType, sampleCount, noise, 0.75);
        epoch = 0;
        metricEpoch.textContent = '0';
        visualizer.resetLossHistory();
        evaluateAndRender();
    }

    function trainStep() {
        const lr = parseFloat(selLr.value);
        const optimizer = selOptimizer.value;
        const batchSizeVal = parseInt(selBatchSize.value, 10);
        const weightDecay = parseFloat(selDecay.value);

        const trainX = dataset.train.X;
        const trainY = dataset.train.y;
        const N = trainX.length;

        // Determine batching
        const batchSize = batchSizeVal === 0 ? N : Math.min(batchSizeVal, N);

        // Shuffle indices
        const indices = Array.from({ length: N }, (_, i) => i);
        for (let i = N - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
        }

        // Run mini-batches
        for (let start = 0; start < N; start += batchSize) {
            const batchIdxs = indices.slice(start, Math.min(N, start + batchSize));
            const bX = batchIdxs.map(i => trainX[i]);
            const bY = batchIdxs.map(i => trainY[i]);

            const yHat = model.forward(bX);
            const { gradOut } = model.computeLoss(yHat, bY);
            model.backward(gradOut);
            model.step(lr, optimizer, weightDecay);
        }

        epoch++;
    }

    function evaluateAndRender() {
        const trainEval = model.evaluate(dataset.train);
        const testEval = model.evaluate(dataset.test);

        metricEpoch.textContent = String(epoch);
        metricTrainLoss.textContent = trainEval.loss.toFixed(4);
        metricTestLoss.textContent = testEval.loss.toFixed(4);
        metricAccuracy.textContent = `${(testEval.accuracy * 100).toFixed(1)}%`;

        visualizer.recordLoss(epoch, trainEval.loss, testEval.loss, trainEval.accuracy, testEval.accuracy);
        visualizer.renderDecisionBoundary(model, dataset);
        visualizer.renderNetworkGraph(model);
        visualizer.renderLossChart();
    }

    // Play / Pause Loop
    function loop() {
        if (!isPlaying) return;

        // Perform multiple training steps per frame for fast convergence
        for (let s = 0; s < 4; s++) {
            trainStep();
        }

        evaluateAndRender();
        requestAnimationFrame(loop);
    }

    btnPlay.addEventListener('click', () => {
        isPlaying = !isPlaying;
        if (isPlaying) {
            btnPlay.textContent = '⏸ PAUSE';
            btnPlay.classList.add('playing');
            requestAnimationFrame(loop);
        } else {
            btnPlay.textContent = '▶ TRAIN';
            btnPlay.classList.remove('playing');
        }
    });

    btnStep.addEventListener('click', () => {
        if (isPlaying) {
            isPlaying = false;
            btnPlay.textContent = '▶ TRAIN';
            btnPlay.classList.remove('playing');
        }
        trainStep();
        evaluateAndRender();
    });

    btnReset.addEventListener('click', () => {
        model.reset();
        epoch = 0;
        metricEpoch.textContent = '0';
        visualizer.resetLossHistory();
        evaluateAndRender();
    });

    // Dataset pickers
    datasetButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            datasetButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentDatasetType = btn.dataset.dataset;
            refreshDataset();
        });
    });

    // Noise and Sample sliders
    sliderNoise.addEventListener('input', () => {
        noise = parseFloat(sliderNoise.value);
        lblNoise.textContent = `${Math.round(noise * 100)}%`;
    });
    sliderNoise.addEventListener('change', refreshDataset);

    sliderSamples.addEventListener('input', () => {
        sampleCount = parseInt(sliderSamples.value, 10);
        lblSamples.textContent = String(sampleCount);
    });
    sliderSamples.addEventListener('change', refreshDataset);

    // Activation changes
    selActivation.addEventListener('change', () => {
        activation = selActivation.value;
        rebuildNetwork();
    });

    // Layer Addition & Removal
    btnAddLayer.addEventListener('click', () => {
        if (hiddenSizes.length < 5) {
            hiddenSizes.push(6);
            rebuildNetwork();
        }
    });

    btnRemoveLayer.addEventListener('click', () => {
        if (hiddenSizes.length > 1) {
            hiddenSizes.pop();
            rebuildNetwork();
        }
    });

    // Keyboard Shortcuts (Space = Play/Pause)
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && e.target === document.body) {
            btnPlay.click();
            e.preventDefault();
        }
    });

    // Initial render
    renderUI();
    evaluateAndRender();
});
