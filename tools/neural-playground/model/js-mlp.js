// The plain-JS MLP: the reference the bro.tensor backend is checked against
// (tests/test_model.js), and the fallback in a build without bro.tensor.

import { MLP, ADAM, SGD_MOMENTUM } from "./mlp.js";

function act(x, type) {
    switch (type) {
        case 'relu': return x > 0 ? x : 0;
        case 'tanh': return Math.tanh(x);
        case 'sigmoid': return 1 / (1 + Math.exp(-x));
        case 'silu': return x / (1 + Math.exp(-x));
        default: return x;
    }
}

/** d act / d z, from the pre-activation z and the output a. */
function actGrad(z, a, type) {
    switch (type) {
        case 'relu': return z > 0 ? 1 : 0;
        case 'tanh': return 1 - a * a;
        case 'sigmoid': return a * (1 - a);
        case 'silu': { const s = 1 / (1 + Math.exp(-z)); return s * (1 + z * (1 - s)); }
        default: return 1;
    }
}

export class JsMLP extends MLP {
    get backend() { return 'js'; }
    get device() { return 'JS'; }

    load(layers) {
        this.L = layers.map((l) => ({
            in: l.in, out: l.out, W: l.W.slice(), b: l.b.slice(),
            dW: new Float32Array(l.W.length), dB: new Float32Array(l.out),
            mW: new Float32Array(l.W.length), vW: new Float32Array(l.W.length),
            mB: new Float32Array(l.out), vB: new Float32Array(l.out),
        }));
    }

    /** Forward over n rows of X (n x 2); returns [Z per layer], [A per layer]. */
    forward(X, n) {
        const Z = [], A = [];
        let a = X;
        const last = this.L.length - 1;
        this.L.forEach((l, li) => {
            const z = new Float32Array(n * l.out);
            for (let r = 0; r < n; r++) {
                for (let j = 0; j < l.out; j++) {
                    let s = l.b[j];
                    for (let k = 0; k < l.in; k++) s += a[r * l.in + k] * l.W[j * l.in + k];
                    z[r * l.out + j] = s;
                }
            }
            Z.push(z);
            const out = li === last ? z : z.map((v) => act(v, this.activation));
            A.push(out);
            a = out;
        });
        return { Z, A };
    }

    predict(X, n) {
        const { Z } = this.forward(X, n);
        return Z[Z.length - 1].map((v) => act(v, 'sigmoid'));
    }

    trainBatch(X, y, B, o) {
        const { Z, A } = this.forward(X, B);
        const last = this.L.length - 1;
        // dLoss/dlogit of mean BCE-with-logits.
        let dZ = Z[last].map((z, r) => (act(z, 'sigmoid') - y[r]) / B);
        for (let li = last; li >= 0; li--) {
            const l = this.L[li];
            const aIn = li === 0 ? X : A[li - 1];
            l.dW.fill(0); l.dB.fill(0);
            const dA = new Float32Array(B * l.in);
            for (let r = 0; r < B; r++) {
                for (let j = 0; j < l.out; j++) {
                    const d = dZ[r * l.out + j];
                    l.dB[j] += d;
                    for (let k = 0; k < l.in; k++) {
                        l.dW[j * l.in + k] += d * aIn[r * l.in + k];
                        dA[r * l.in + k] += d * l.W[j * l.in + k];
                    }
                }
            }
            if (li > 0) dZ = dA.map((g, i) => g * actGrad(Z[li - 1][i], A[li - 1][i], this.activation));
        }
        for (const l of this.L) this.stepLayer(l, o);
    }

    stepLayer(l, o) {
        const lr = o.lr, wd = o.weightDecay || 0;
        if (o.optimizer === 'sgd') {
            const m = SGD_MOMENTUM;
            for (let i = 0; i < l.W.length; i++) {
                l.mW[i] = m * l.mW[i] + (1 - m) * l.dW[i];
                l.W[i] = (l.W[i] * (1 - lr * wd)) - lr * l.mW[i];
            }
            for (let i = 0; i < l.out; i++) {
                l.mB[i] = m * l.mB[i] + (1 - m) * l.dB[i];
                l.b[i] -= lr * l.mB[i];
            }
            return;
        }
        const t = this.stepCount, bc1 = 1 - Math.pow(ADAM.b1, t), bc2 = 1 - Math.pow(ADAM.b2, t);
        const adam = (p, g, m, v, i) => {
            m[i] = ADAM.b1 * m[i] + (1 - ADAM.b1) * g;
            v[i] = ADAM.b2 * v[i] + (1 - ADAM.b2) * g * g;
            p[i] -= lr * (m[i] / bc1) / (Math.sqrt(v[i] / bc2) + ADAM.eps);
        };
        for (let i = 0; i < l.W.length; i++) {
            let g = l.dW[i];
            if (o.optimizer === 'adamw') l.W[i] *= 1 - lr * wd;
            else g += wd * l.W[i];
            adam(l.W, g, l.mW, l.vW, i);
        }
        for (let i = 0; i < l.out; i++) adam(l.b, l.dB[i], l.mB, l.vB, i);
    }

    weights() {
        return this.L.map((l) => ({ in: l.in, out: l.out, W: l.W, b: l.b }));
    }
}
