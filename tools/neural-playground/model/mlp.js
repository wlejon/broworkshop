// What both MLP backends share: initialisation, the epoch driver
// (shuffle + minibatches), evaluation, and the optimiser semantics.
//
// A network is [2, ...hidden, 1]: hidden layers use the chosen activation,
// the output is one logit trained with binary cross-entropy (sigmoid +
// BCE, fused). Weights are (out, in) row-major, W[j * in + k], the layout
// bro.tensor's batched linears use, so both backends and the view agree.
//
// Optimisers (lr, weight decay wd; W only, never biases):
//   adam   Adam with L2: g += wd * W before the moments.
//   adamw  decoupled: W *= (1 - lr * wd), then plain Adam.
//   sgd    momentum as an EMA: v = m v + (1 - m) g; W -= lr v; W *= (1 - lr wd).

export const ACTIVATIONS = { tanh: 'Tanh', relu: 'ReLU', silu: 'SiLU', sigmoid: 'Sigmoid' };
export const OPTIMIZERS = { adam: 'Adam', adamw: 'AdamW', sgd: 'SGD (momentum)' };
export const ADAM = { b1: 0.9, b2: 0.999, eps: 1e-8 };
export const SGD_MOMENTUM = 0.85;

/** Deterministic PRNG (mulberry32) returning floats in [0, 1). */
export function mulberry32(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Host-side initial weights for `sizes` ([2, ..., 1]): uniform in ±s with
 * s = sqrt(2 / in) (He) before relu/silu, sqrt(1 / in) otherwise; zero biases.
 */
export function initLayers(sizes, activation, rng) {
    const layers = [];
    for (let l = 0; l < sizes.length - 1; l++) {
        const nIn = sizes[l], nOut = sizes[l + 1];
        const last = l === sizes.length - 2;
        const s = !last && (activation === 'relu' || activation === 'silu') ? Math.sqrt(2 / nIn) : Math.sqrt(1 / nIn);
        const W = new Float32Array(nIn * nOut);
        for (let i = 0; i < W.length; i++) W[i] = (rng() * 2 - 1) * s;
        layers.push({ in: nIn, out: nOut, W, b: new Float32Array(nOut) });
    }
    return layers;
}

/** Mean BCE and accuracy of probabilities `p` against 0/1 labels `y`. */
export function bceStats(p, y) {
    const eps = 1e-7;
    let loss = 0, correct = 0;
    for (let i = 0; i < y.length; i++) {
        const q = Math.max(eps, Math.min(1 - eps, p[i]));
        loss -= y[i] ? Math.log(q) : Math.log(1 - q);
        if ((q >= 0.5 ? 1 : 0) === y[i]) correct++;
    }
    return { loss: loss / Math.max(1, y.length), accuracy: correct / Math.max(1, y.length) };
}

/**
 * Base class. A backend implements load(layers), trainBatch(X, y, B, opts),
 * predict(X, n) -> Float32Array of probabilities, weights() -> host layers,
 * plus `backend` and `device` strings.
 */
export class MLP {
    constructor(sizes, activation, seed) {
        this.sizes = sizes.slice();
        this.activation = activation;
        this.seed = seed == null ? 1 : seed;
        this.reset();
    }

    get layerSizes() { return this.sizes; }

    rebuild(sizes, activation) {
        this.sizes = sizes.slice();
        this.activation = activation;
        this.reset();
    }

    /** Fresh weights; a new seed each call unless `seed` is given. */
    reset(seed) {
        if (seed != null) this.seed = seed;
        this.stepCount = 0;
        this.load(initLayers(this.sizes, this.activation, mulberry32(this.seed++)));
    }

    /**
     * One pass over `split` ({ flat: Float32Array(n*2), y: 0/1[] }) in
     * shuffled minibatches. opts: { lr, optimizer, batchSize (0 = full),
     * weightDecay }. `rng` drives the shuffle.
     */
    trainEpoch(split, opts, rng) {
        const n = split.y.length;
        if (!n) return;
        const B = opts.batchSize > 0 ? Math.min(opts.batchSize, n) : n;
        const order = new Int32Array(n);
        for (let i = 0; i < n; i++) order[i] = i;
        for (let i = n - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const t = order[i]; order[i] = order[j]; order[j] = t;
        }
        for (let start = 0; start < n; start += B) {
            const m = Math.min(B, n - start);
            const X = new Float32Array(m * 2), y = new Float32Array(m);
            for (let r = 0; r < m; r++) {
                const i = order[start + r];
                X[r * 2] = split.flat[i * 2];
                X[r * 2 + 1] = split.flat[i * 2 + 1];
                y[r] = split.y[i];
            }
            this.stepCount++;
            this.trainBatch(X, y, m, opts);
        }
    }

    /** { loss, accuracy } over a split. */
    evaluate(split) {
        return bceStats(this.predict(split.flat, split.y.length), split.y);
    }
}
