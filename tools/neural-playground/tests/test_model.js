// The bro.tensor MLP against the JS reference: same init, same batches,
// every optimiser and activation, weights must track; and both learn.

import { check, near, test, done, skip } from "/lib/kit/test.js";
import { generateDataset } from "/app/datasets.js";
import { mulberry32, initLayers, bceStats } from "/app/model/mlp.js";
import { JsMLP } from "/app/model/js-mlp.js";
import { TensorMLP, tensorAvailable } from "/app/model/tensor-mlp.js";

if (!tensorAvailable()) skip('bro.tensor is not in this build');

const data = generateDataset('spiral', 200, 0.1, 0.75, mulberry32(3));

function maxDiff(a, b) {
    let d = 0;
    a.forEach((l, i) => {
        for (let k = 0; k < l.W.length; k++) d = Math.max(d, Math.abs(l.W[k] - b[i].W[k]));
        for (let k = 0; k < l.b.length; k++) d = Math.max(d, Math.abs(l.b[k] - b[i].b[k]));
    });
    return d;
}

test('init: He scale before relu, sqrt(1/in) otherwise; zero biases', () => {
    const L = initLayers([2, 16, 1], 'relu', mulberry32(1));
    check(L[0].W.every((v) => Math.abs(v) <= 1 + 1e-6), 'relu layer within sqrt(2/2)');
    check(L[1].W.every((v) => Math.abs(v) <= Math.sqrt(1 / 16) + 1e-6), 'output within sqrt(1/16)');
    check(L.every((l) => l.b.every((v) => v === 0)), 'zero biases');
});

test('bceStats', () => {
    const s = bceStats([0.9, 0.2, 0.6], [1, 0, 0]);
    near(s.accuracy, 2 / 3, 1e-9, 'accuracy');
    near(s.loss, -(Math.log(0.9) + Math.log(0.8) + Math.log(0.4)) / 3, 1e-6, 'loss');
});

for (const activation of ['tanh', 'relu', 'silu', 'sigmoid']) {
    for (const optimizer of ['adam', 'adamw', 'sgd']) {
        test(`parity ${activation} / ${optimizer}`, () => {
            const js = new JsMLP([2, 8, 6, 1], activation, 42);
            const gpu = new TensorMLP([2, 8, 6, 1], activation, 42);
            near(maxDiff(js.weights(), gpu.weights()), 0, 1e-7, 'same init');
            const o = { lr: 0.03, optimizer, batchSize: 32, weightDecay: 0.001 };
            for (let e = 0; e < 5; e++) {
                js.trainEpoch(data.train, o, mulberry32(100 + e));
                gpu.trainEpoch(data.train, o, mulberry32(100 + e));
            }
            const d = maxDiff(js.weights(), gpu.weights());
            check(d < 2e-3, 'weights diverged by ' + d);
            const pj = js.predict(data.test.flat, data.test.y.length), pg = gpu.predict(data.test.flat, data.test.y.length);
            let dp = 0;
            for (let i = 0; i < pj.length; i++) dp = Math.max(dp, Math.abs(pj[i] - pg[i]));
            check(dp < 2e-3, 'predictions diverged by ' + dp);
        });
    }
}

test('bro.tensor learns XOR', () => {
    const xor = generateDataset('xor', 300, 0.05, 0.75, mulberry32(9));
    const m = new TensorMLP([2, 8, 8, 1], 'tanh', 5);
    const before = m.evaluate(xor.test);
    const o = { lr: 0.03, optimizer: 'adam', batchSize: 50, weightDecay: 0.0001 };
    const rng = mulberry32(1);
    for (let e = 0; e < 150; e++) m.trainEpoch(xor.train, o, rng);
    const after = m.evaluate(xor.test);
    check(after.loss < before.loss * 0.5, 'loss ' + before.loss.toFixed(3) + ' -> ' + after.loss.toFixed(3));
    check(after.accuracy > 0.9, 'test accuracy ' + after.accuracy);
});

test('full batch and a ragged last batch', () => {
    const m = new TensorMLP([2, 4, 1], 'relu', 2);
    m.trainEpoch(data.train, { lr: 0.01, optimizer: 'sgd', batchSize: 0, weightDecay: 0 }, mulberry32(1));
    m.trainEpoch(data.train, { lr: 0.01, optimizer: 'sgd', batchSize: 64, weightDecay: 0 }, mulberry32(2));
    const s = m.evaluate(data.train);
    check(Number.isFinite(s.loss), 'finite loss');
});

done('neural-playground model');
