// 2D binary classification datasets in [-5, 5]².

export const DATASETS = { spiral: 'Spiral', circles: 'Circles', xor: 'XOR', clusters: 'Clusters' };

/**
 * `count` points of `type` with Gaussian `noise`, shuffled and split
 * `trainRatio` / rest. `rng` (default Math.random) makes it reproducible.
 * Returns { train, test, all } where a split is
 * { X: [[x1, x2]], flat: Float32Array(n * 2), y: number[] (0/1) }.
 */
export function generateDataset(type, count = 250, noise = 0.1, trainRatio = 0.7, rng = Math.random) {
    const randn = () => {
        let u = 0, v = 0;
        while (u === 0) u = rng();
        while (v === 0) v = rng();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const gen = GENERATORS[type] || GENERATORS.clusters;
    const pts = gen(count, noise, rng, randn);
    for (let i = pts.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = pts[i]; pts[i] = pts[j]; pts[j] = t;
    }
    const nTrain = Math.floor(pts.length * trainRatio);
    return { train: split(pts.slice(0, nTrain)), test: split(pts.slice(nTrain)), all: pts };
}

function split(pts) {
    const flat = new Float32Array(pts.length * 2);
    pts.forEach((p, i) => { flat[i * 2] = p.x1; flat[i * 2 + 1] = p.x2; });
    return { X: pts.map((p) => [p.x1, p.x2]), flat, y: pts.map((p) => p.label) };
}

const GENERATORS = {
    // Two intertwined spirals, the second offset by pi.
    spiral(count, noise, rng, randn) {
        const out = [], n = Math.floor(count / 2);
        for (let i = 0; i < n; i++) {
            const r = (i / n) * 4.6 + 0.3, th = (i / n) * 1.75 * Math.PI * 2;
            const sx = r * Math.sin(th), sy = r * Math.cos(th);
            out.push({ x1: sx + randn() * noise * 1.2, x2: sy + randn() * noise * 1.2, label: 0 });
            out.push({ x1: -sx + randn() * noise * 1.2, x2: -sy + randn() * noise * 1.2, label: 1 });
        }
        return out;
    },
    // An inner disc (class 1) inside a ring (class 0).
    circles(count, noise, rng, randn) {
        const out = [], n = Math.floor(count / 2);
        const ring = (lo, span, label) => {
            for (let i = 0; i < n; i++) {
                const r = (rng() * span + lo) * 4.8, th = rng() * Math.PI * 2;
                out.push({ x1: r * Math.cos(th) + randn() * noise * 0.8, x2: r * Math.sin(th) + randn() * noise * 0.8, label });
            }
        };
        ring(0.05, 0.45, 1);
        ring(0.6, 0.4, 0);
        return out;
    },
    // Quadrants: class 1 where x1 and x2 share a sign.
    xor(count, noise, rng, randn) {
        const out = [];
        for (let i = 0; i < count; i++) {
            let x1 = (rng() * 2 - 1) * 4.6, x2 = (rng() * 2 - 1) * 4.6;
            x1 += (x1 > 0 ? 0.3 : -0.3) + randn() * noise * 0.8;     // pushed off the axes
            x2 += (x2 > 0 ? 0.3 : -0.3) + randn() * noise * 0.8;
            out.push({ x1, x2, label: x1 * x2 > 0 ? 1 : 0 });
        }
        return out;
    },
    // Two Gaussian blobs.
    clusters(count, noise, rng, randn) {
        const out = [], n = Math.floor(count / 2), sd = 1.1 + noise * 1.5;
        for (let i = 0; i < n; i++) out.push({ x1: -2.2 + randn() * sd, x2: -2.0 + randn() * sd, label: 0 });
        for (let i = 0; i < n; i++) out.push({ x1: 2.2 + randn() * sd, x2: 2.0 + randn() * sd, label: 1 });
        return out;
    },
};
