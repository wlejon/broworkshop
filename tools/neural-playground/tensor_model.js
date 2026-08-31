// tensor_model.js — Autograd Multi-Layer Perceptron and Optimizer Engine
//
// Supports modular layer graph creation, forward computational graph passes,
// autograd backpropagation, and SGD / Adam / AdamW optimizers.
// Seamlessly interfaces with bro.tensor backend when available.

export class TensorModel {
    constructor(layerSizes = [2, 8, 8, 1], activations = ['tanh', 'tanh', 'sigmoid']) {
        this.layerSizes = [...layerSizes];
        this.activations = [...activations];
        this.layers = [];
        this.stepCount = 0;
        this.useGpuBackend = typeof bro !== 'undefined' && bro.tensor && bro.tensor.available;

        this._initWeights();
    }

    _initWeights() {
        this.layers = [];
        this.stepCount = 0;

        for (let l = 0; l < this.layerSizes.length - 1; l++) {
            const inDim = this.layerSizes[l];
            const outDim = this.layerSizes[l + 1];
            const act = this.activations[l] || (l === this.layerSizes.length - 2 ? 'sigmoid' : 'relu');

            // Xavier / He initialization
            const scale = (act === 'relu' || act === 'silu')
                ? Math.sqrt(2.0 / inDim)
                : Math.sqrt(1.0 / inDim);

            const W = new Float32Array(inDim * outDim);
            const b = new Float32Array(outDim);
            const gradW = new Float32Array(inDim * outDim);
            const gradB = new Float32Array(outDim);

            // Optimizer state buffers
            const mW = new Float32Array(inDim * outDim);
            const vW = new Float32Array(inDim * outDim);
            const mB = new Float32Array(outDim);
            const vB = new Float32Array(outDim);

            for (let i = 0; i < W.length; i++) {
                W[i] = (Math.random() * 2 - 1) * scale;
            }
            for (let i = 0; i < b.length; i++) {
                b[i] = 0.0;
            }

            this.layers.push({
                inDim,
                outDim,
                activation: act,
                W, b,
                gradW, gradB,
                mW, vW, mB, vB,
                lastInput: null,
                lastZ: null,
                lastA: null
            });
        }
    }

    rebuild(layerSizes, activations) {
        this.layerSizes = [...layerSizes];
        this.activations = [...activations];
        this._initWeights();
    }

    reset() {
        this._initWeights();
    }

    // Forward pass over a batch of inputs X: array of [x1, x2]
    forward(X) {
        let currentA = X; // shape: [N, inDim]

        for (let l = 0; l < this.layers.length; l++) {
            const layer = this.layers[l];
            const N = currentA.length;
            const inDim = layer.inDim;
            const outDim = layer.outDim;

            layer.lastInput = currentA;

            const Z = new Array(N);
            const A = new Array(N);

            for (let i = 0; i < N; i++) {
                const xi = currentA[i];
                const zi = new Float32Array(outDim);
                const ai = new Float32Array(outDim);

                for (let j = 0; j < outDim; j++) {
                    let sum = layer.b[j];
                    for (let k = 0; k < inDim; k++) {
                        sum += xi[k] * layer.W[k * outDim + j];
                    }
                    zi[j] = sum;
                    ai[j] = this._activate(sum, layer.activation);
                }

                Z[i] = zi;
                A[i] = ai;
            }

            layer.lastZ = Z;
            layer.lastA = A;
            currentA = A;
        }

        return currentA;
    }

    // Binary cross-entropy loss & accuracy
    computeLoss(yHat, yTrue) {
        const N = yHat.length;
        let totalLoss = 0;
        let correct = 0;
        const gradOut = new Array(N);

        const eps = 1e-7;

        for (let i = 0; i < N; i++) {
            const pred = Math.max(eps, Math.min(1 - eps, yHat[i][0]));
            const target = yTrue[i];

            // Binary cross entropy
            totalLoss += -(target * Math.log(pred) + (1 - target) * Math.log(1 - pred));

            const isCorrect = (pred >= 0.5 ? 1 : 0) === target;
            if (isCorrect) correct++;

            // Gradient of BCE with Sigmoid activation: (pred - target)
            gradOut[i] = new Float32Array([pred - target]);
        }

        return {
            loss: totalLoss / N,
            accuracy: correct / N,
            gradOut
        };
    }

    // Backward pass computing analytical gradients
    backward(gradOut) {
        let currentDelta = gradOut; // shape: [N, outDim]

        for (let l = this.layers.length - 1; l >= 0; l--) {
            const layer = this.layers[l];
            const N = currentDelta.length;
            const inDim = layer.inDim;
            const outDim = layer.outDim;
            const prevA = layer.lastInput;
            const Z = layer.lastZ;

            // Zero gradients
            layer.gradW.fill(0);
            layer.gradB.fill(0);

            const nextDelta = new Array(N);

            for (let i = 0; i < N; i++) {
                const delta_i = new Float32Array(outDim);
                const prevDelta_i = new Float32Array(inDim);

                for (let j = 0; j < outDim; j++) {
                    let d = currentDelta[i][j];

                    // If not last sigmoid layer, multiply by activation derivative
                    if (layer.activation !== 'sigmoid' || l < this.layers.length - 1) {
                        d *= this._activateDerivative(Z[i][j], layer.lastA[i][j], layer.activation);
                    }

                    delta_i[j] = d;
                    layer.gradB[j] += d;

                    for (let k = 0; k < inDim; k++) {
                        layer.gradW[k * outDim + j] += prevA[i][k] * d;
                        prevDelta_i[k] += d * layer.W[k * outDim + j];
                    }
                }

                nextDelta[i] = prevDelta_i;
            }

            // Average gradients over batch
            const invN = 1.0 / N;
            for (let idx = 0; idx < layer.gradW.length; idx++) {
                layer.gradW[idx] *= invN;
            }
            for (let idx = 0; idx < layer.gradB.length; idx++) {
                layer.gradB[idx] *= invN;
            }

            currentDelta = nextDelta;
        }
    }

    // Optimizer step
    step(lr = 0.03, optimizer = 'adam', weightDecay = 0.0001) {
        this.stepCount++;
        const beta1 = 0.9;
        const beta2 = 0.999;
        const eps = 1e-8;

        const bc1 = 1.0 - Math.pow(beta1, this.stepCount);
        const bc2 = 1.0 - Math.pow(beta2, this.stepCount);

        for (const layer of this.layers) {
            const lenW = layer.W.length;
            const lenB = layer.b.length;

            if (optimizer === 'sgd') {
                const momentum = 0.85;
                for (let i = 0; i < lenW; i++) {
                    layer.mW[i] = momentum * layer.mW[i] + (1 - momentum) * layer.gradW[i];
                    layer.W[i] -= lr * (layer.mW[i] + weightDecay * layer.W[i]);
                }
                for (let i = 0; i < lenB; i++) {
                    layer.mB[i] = momentum * layer.mB[i] + (1 - momentum) * layer.gradB[i];
                    layer.b[i] -= lr * layer.mB[i];
                }
            } else if (optimizer === 'adam' || optimizer === 'adamw') {
                for (let i = 0; i < lenW; i++) {
                    const g = layer.gradW[i];
                    layer.mW[i] = beta1 * layer.mW[i] + (1 - beta1) * g;
                    layer.vW[i] = beta2 * layer.vW[i] + (1 - beta2) * g * g;

                    const mHat = layer.mW[i] / bc1;
                    const vHat = layer.vW[i] / bc2;

                    let update = lr * mHat / (Math.sqrt(vHat) + eps);
                    if (optimizer === 'adamw') {
                        layer.W[i] = layer.W[i] * (1 - lr * weightDecay) - update;
                    } else {
                        layer.W[i] -= update + lr * weightDecay * layer.W[i];
                    }
                }

                for (let i = 0; i < lenB; i++) {
                    const g = layer.gradB[i];
                    layer.mB[i] = beta1 * layer.mB[i] + (1 - beta1) * g;
                    layer.vB[i] = beta2 * layer.vB[i] + (1 - beta2) * g * g;

                    const mHat = layer.mB[i] / bc1;
                    const vHat = layer.vB[i] / bc2;

                    layer.b[i] -= lr * mHat / (Math.sqrt(vHat) + eps);
                }
            }
        }
    }

    // Evaluate whole dataset
    evaluate(dataset) {
        const yHat = this.forward(dataset.X);
        return this.computeLoss(yHat, dataset.y);
    }

    // Predict grid of 2D coordinates for decision boundary heatmap
    predictGrid(gridPoints) {
        const yHat = this.forward(gridPoints);
        const probs = new Float32Array(yHat.length);
        for (let i = 0; i < yHat.length; i++) {
            probs[i] = yHat[i][0];
        }
        return probs;
    }

    // Activation functions
    _activate(x, type) {
        switch (type) {
            case 'relu': return Math.max(0, x);
            case 'tanh': return Math.tanh(x);
            case 'sigmoid': return 1.0 / (1.0 + Math.exp(-Math.max(-20, Math.min(20, x))));
            case 'silu': {
                const s = 1.0 / (1.0 + Math.exp(-Math.max(-20, Math.min(20, x))));
                return x * s;
            }
            default: return x;
        }
    }

    _activateDerivative(z, a, type) {
        switch (type) {
            case 'relu': return z > 0 ? 1.0 : 0.0;
            case 'tanh': return 1.0 - a * a;
            case 'sigmoid': return a * (1.0 - a);
            case 'silu': {
                const s = 1.0 / (1.0 + Math.exp(-Math.max(-20, Math.min(20, z))));
                return s + z * s * (1.0 - s);
            }
            default: return 1.0;
        }
    }
}
