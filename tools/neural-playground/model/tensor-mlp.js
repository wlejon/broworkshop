// The MLP on bro.tensor: weights, optimiser state and activations live on
// the device (CUDA when present); a minibatch is one upload, the batched
// linear/activation kernels forward and back, the fused BCE-with-logits,
// and the optimiser kernels. Only predictions and weights for drawing come
// back to the host.

import { MLP, ADAM, SGD_MOMENTUM } from "./mlp.js";

const T = globalThis.bro && bro.tensor;

/** True when bro.tensor is compiled in (init() before asking, or it reads CPU). */
export function tensorAvailable() {
    try { if (!T) return false; T.init(); return !!T.available; } catch (_) { return false; }
}

const FWD = { tanh: 'tanhForward', relu: 'reluForward', sigmoid: 'sigmoidForward', silu: 'siluForward' };
// tanh / sigmoid backward read the cached output; relu / silu the input.
const BWD = { tanh: ['tanhBackward', 'A'], sigmoid: ['sigmoidBackward', 'A'], relu: ['reluBackward', 'Z'], silu: ['siluBackward', 'Z'] };

function tensor(rows, cols, data) {
    const t = T.createTensor(rows, cols);
    if (data) t.upload(data);
    return t;
}

export class TensorMLP extends MLP {
    get backend() { return 'tensor'; }
    get device() { return 'bro.tensor · ' + (T.backend || '?'); }

    load(layers) {
        T.init();
        this.L = layers.map((l) => {
            const z = () => tensor(l.out, l.in), zb = () => tensor(l.out, 1);
            return {
                in: l.in, out: l.out,
                W: tensor(l.out, l.in, l.W), b: tensor(l.out, 1, l.b),
                dW: z(), dB: zb(), mW: z(), vW: z(), mB: zb(), vB: zb(),
            };
        });
        this.bufs = new Map();          // batch size -> activation buffers
    }

    /** Activation buffers for a batch of B rows, made once per distinct B. */
    buffers(B) {
        let s = this.bufs.get(B);
        if (s) return s;
        const L = this.L;
        s = {
            X: tensor(B, L[0].in), Y: tensor(B, 1), P: tensor(B, 1), loss: tensor(B, 1),
            Z: L.map((l) => tensor(B, l.out)), A: L.map((l) => tensor(B, l.out)),
            dZ: L.map((l) => tensor(B, l.out)), dA: L.map((l) => tensor(B, l.in)),
            host: new Float32Array(B),
        };
        this.bufs.set(B, s);
        return s;
    }

    forwardDevice(s) {
        const last = this.L.length - 1;
        let a = s.X;
        this.L.forEach((l, i) => {
            T.linearForwardBatched(l.W, l.b, a, s.Z[i]);
            if (i < last) { T[FWD[this.activation]](s.Z[i], s.A[i]); a = s.A[i]; }
        });
    }

    predict(X, n) {
        const s = this.buffers(n);
        s.X.upload(X);
        this.forwardDevice(s);
        T.sigmoidForward(s.Z[this.L.length - 1], s.P);
        return s.P.download(s.host).slice(0, n);
    }

    trainBatch(X, y, B, o) {
        const s = this.buffers(B), L = this.L, last = L.length - 1;
        s.X.upload(X);
        s.Y.upload(y);
        this.forwardDevice(s);
        // dLoss/dlogit = (p - y) per sample; / B for the batch mean.
        T.bceWithLogitsFusedBatched(s.Z[last], s.Y, null, 1.0, s.P, s.dZ[last], s.loss);
        T.scaleInplace(s.dZ[last], 1 / B);
        const [bwd, cached] = BWD[this.activation];
        for (let i = last; i >= 0; i--) {
            const l = L[i];
            l.dW.zero(); l.dB.zero();
            T.linearBackwardBatched(l.W, i === 0 ? s.X : s.A[i - 1], s.dZ[i], s.dA[i], l.dW, l.dB);
            if (i > 0) T[bwd](cached === 'A' ? s.A[i - 1] : s.Z[i - 1], s.dA[i], s.dZ[i - 1]);
        }
        for (const l of L) this.stepLayer(l, o);
    }

    stepLayer(l, o) {
        const lr = o.lr, wd = o.weightDecay || 0;
        if (o.optimizer === 'sgd') {
            // sgdStep keeps v = m v + g; scaling g by (1 - m) makes it the EMA.
            T.scaleInplace(l.dW, 1 - SGD_MOMENTUM);
            T.scaleInplace(l.dB, 1 - SGD_MOMENTUM);
            if (wd) T.scaleInplace(l.W, 1 - lr * wd);
            T.sgdStep(l.W, l.dW, l.mW, lr, SGD_MOMENTUM);
            T.sgdStep(l.b, l.dB, l.mB, lr, SGD_MOMENTUM);
            return;
        }
        if (wd && o.optimizer === 'adamw') T.scaleInplace(l.W, 1 - lr * wd);
        else if (wd) T.axpbyInplace(l.dW, l.W, 1, wd);
        T.adamStep(l.W, l.dW, l.mW, l.vW, lr, ADAM.b1, ADAM.b2, ADAM.eps, this.stepCount);
        T.adamStep(l.b, l.dB, l.mB, l.vB, lr, ADAM.b1, ADAM.b2, ADAM.eps, this.stepCount);
    }

    weights() {
        return this.L.map((l) => ({ in: l.in, out: l.out, W: l.W.download(), b: l.b.download() }));
    }
}
