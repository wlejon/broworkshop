// Scalar fields, the 2D marching-squares table, and per-slice analysis for
// the isosurface viz. Nothing here touches the DOM or the scene.

export const ALGOS = ['marchingCubes', 'dualContour', 'surfaceNets'];
export const FIELDS = ['sphere', 'torus', 'noise', 'gyroid'];

/** An n³ signed field (x fastest, then y, then z); negative = inside. */
export function buildField(kind, n, seed) {
    const field = new Float32Array(n * n * n);
    const half = (n - 1) * 0.5;
    const r = half * 0.7;
    if (kind === 'noise') {
        const base = FastNoise.Simplex();
        base.set('Feature Scale', 1);         // frequency = features per unit (default is ~100 units)
        const fbm = FastNoise.FractalFBm();
        fbm.set('Source', base);
        fbm.set('Octaves', 3);
        for (let z = 0; z < n; z++) {
            const slice = fbm.genUniformGrid2D(0, z * 13, n, n, 0.06, seed);
            for (let i = 0; i < n * n; i++) {
                const dx = (i % n) - half, dy = ((i / n) | 0) - half, dz = z - half;
                field[z * n * n + i] = (Math.sqrt(dx * dx + dy * dy + dz * dz) - r) * 0.4 - slice[i] * 1.6;
            }
        }
        return field;
    }
    for (let z = 0; z < n; z++) {
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                const dx = x - half, dy = y - half, dz = z - half;
                let v;
                if (kind === 'sphere') {
                    v = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
                } else if (kind === 'torus') {
                    const R = r * 0.7, tr = r * 0.3;
                    const q = Math.sqrt(dx * dx + dz * dz) - R;
                    v = Math.sqrt(q * q + dy * dy) - tr;
                } else {            // gyroid clipped to a sphere
                    const k = 0.45;
                    const g = Math.sin(dx * k) * Math.cos(dy * k) + Math.sin(dy * k) * Math.cos(dz * k)
                            + Math.sin(dz * k) * Math.cos(dx * k);
                    v = Math.max(g, Math.sqrt(dx * dx + dy * dy + dz * dz) - r);
                }
                field[z * n * n + y * n + x] = v;
            }
        }
    }
    return field;
}

// Cell corners: bit 0 = (0,0), 1 = (1,0), 2 = (1,1), 3 = (0,1), set when inside.
// Edges: 0 = bottom (00→10), 1 = right (10→11), 2 = top (11→01), 3 = left (01→00).
// Each entry lists edge pairs, one segment per pair.
export const MSQ_TABLE = [
    [], [3, 0], [0, 1], [3, 1], [1, 2], [3, 2, 1, 0], [0, 2], [3, 2],
    [2, 3], [2, 0], [1, 0, 3, 2], [2, 1], [1, 3], [1, 0], [0, 3], [],
];

/** Where the zero crossing sits between samples a and b, as a fraction from a. */
export function lerpT(a, b) {
    const denom = a - b;
    return Math.abs(denom) < 1e-9 ? 0.5 : a / denom;
}

/** One colour per marching-squares case (hue ring over the 14 mixed cases). */
export const CASE_COLOR = Array.from({ length: 16 }, (_, i) =>
    i === 0 ? '#1c1c22' : i === 15 ? '#22221c' : 'hsl(' + (((i - 1) / 14) * 360).toFixed(0) + ', 80%, 62%)');

/** CASE_COLOR as linear-ish [r, g, b] in 0..1 for the 3D wire. */
export const CASE_RGB = CASE_COLOR.map(cssToRgb);

/** Wire colour of the dual algorithms. */
export const DUAL_RGB = { dualContour: [1.0, 0.62, 0.83], surfaceNets: [0.65, 0.88, 1.0] };

/** 'hsl(h, s%, l%)' or '#rrggbb' to [r, g, b] in 0..1. */
export function cssToRgb(str) {
    if (str.startsWith('hsl')) {
        const m = str.match(/hsl\((-?[\d.]+),\s*(-?[\d.]+)%?,\s*(-?[\d.]+)%?\)/);
        if (!m) return [1, 1, 1];
        const hh = parseFloat(m[1]) / 360, s = parseFloat(m[2]) / 100, l = parseFloat(m[3]) / 100;
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
        const ch = (t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        return [ch(hh + 1 / 3), ch(hh), ch(hh - 1 / 3)];
    }
    if (str.startsWith('#')) {
        const v = parseInt(str.slice(1), 16);
        return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
    }
    return [1, 1, 1];
}

export function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
export function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

// Micro-steps per algorithm; ms at 1x speed.
export const PHASES = {
    marchingCubes: [
        { id: 'highlight', ms: 120 }, { id: 'classify', ms: 180 },
        { id: 'lookup', ms: 220 }, { id: 'emit', ms: 260 },
    ],
    surfaceNets: [
        { id: 'highlight', ms: 100 }, { id: 'classify', ms: 140 }, { id: 'crossings', ms: 180 },
        { id: 'average', ms: 260 }, { id: 'place', ms: 160 }, { id: 'thread', ms: 180 },
    ],
    dualContour: [
        { id: 'highlight', ms: 100 }, { id: 'classify', ms: 140 }, { id: 'crossings', ms: 160 },
        { id: 'normals', ms: 200 }, { id: 'constraints', ms: 240 }, { id: 'solve', ms: 240 },
        { id: 'thread', ms: 180 },
    ],
};

/**
 * One z slice of the field, analysed: signed values (field - iso), central
 * difference gradients, the marching-squares case of every cell, the
 * scan-order list of active cells, and each active cell's edge crossings
 * as flat [u, v, nx, ny, edge] tuples in cell-local coordinates.
 */
export function analyseSlice(field, n, z, iso) {
    const signed = new Float32Array(n * n);
    const gradX = new Float32Array(n * n), gradY = new Float32Array(n * n);
    const cases = new Uint8Array((n - 1) * (n - 1));
    const start = z * n * n;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n * n; i++) {
        const v = field[start + i];
        signed[i] = v - iso;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
    }
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const i = y * n + x;
            const xl = x > 0 ? signed[i - 1] : signed[i], xr = x < n - 1 ? signed[i + 1] : signed[i];
            gradX[i] = (xr - xl) / (x > 0 && x < n - 1 ? 2 : 1);
            const yu = y > 0 ? signed[i - n] : signed[i], yd = y < n - 1 ? signed[i + n] : signed[i];
            gradY[i] = (yd - yu) / (y > 0 && y < n - 1 ? 2 : 1);
        }
    }
    const order = [];
    const cellPts = new Array((n - 1) * (n - 1)).fill(null);
    for (let y = 0; y < n - 1; y++) {
        for (let x = 0; x < n - 1; x++) {
            const i00 = y * n + x, i10 = i00 + 1, i01 = i00 + n, i11 = i01 + 1;
            const v00 = signed[i00], v10 = signed[i10], v11 = signed[i11], v01 = signed[i01];
            const code = (v00 < 0 ? 1 : 0) | (v10 < 0 ? 2 : 0) | (v11 < 0 ? 4 : 0) | (v01 < 0 ? 8 : 0);
            const ci = y * (n - 1) + x;
            cases[ci] = code;
            if (code === 0 || code === 15) continue;
            order.push(ci);
            const pts = [];
            const push = (u, v, edge) => {
                const gx = (gradX[i00] * (1 - u) + gradX[i10] * u) * (1 - v) + (gradX[i01] * (1 - u) + gradX[i11] * u) * v;
                const gy = (gradY[i00] * (1 - u) + gradY[i10] * u) * (1 - v) + (gradY[i01] * (1 - u) + gradY[i11] * u) * v;
                const m = Math.hypot(gx, gy) || 1;
                pts.push(u, v, gx / m, gy / m, edge);
            };
            if ((v00 < 0) !== (v10 < 0)) push(lerpT(v00, v10), 0, 0);
            if ((v10 < 0) !== (v11 < 0)) push(1, lerpT(v10, v11), 1);
            if ((v01 < 0) !== (v11 < 0)) push(lerpT(v01, v11), 1, 2);
            if ((v00 < 0) !== (v01 < 0)) push(0, lerpT(v00, v01), 3);
            cellPts[ci] = pts;
        }
    }
    return { n, z, iso, signed, gradX, gradY, cases, order, cellPts, mn, mx };
}

/**
 * The four edge crossing points of cell (cx, cy) in grid coordinates, flat
 * [x0,y0, x1,y1, x2,y2, x3,y3] by edge index (MSQ_TABLE's edges).
 */
export function edgePoints(slice, cx, cy) {
    const n = slice.n, s = slice.signed;
    const v00 = s[cy * n + cx], v10 = s[cy * n + cx + 1];
    const v11 = s[(cy + 1) * n + cx + 1], v01 = s[(cy + 1) * n + cx];
    return [
        cx + lerpT(v00, v10), cy,
        cx + 1, cy + lerpT(v10, v11),
        cx + lerpT(v01, v11), cy + 1,
        cx, cy + lerpT(v00, v01),
    ];
}

/**
 * The dual vertex of a cell from its crossings, cell-local {u, v}.
 * surfaceNets: the crossings' centroid. dualContour: the least-squares
 * intersection of the tangent lines (the 2D QEF), clamped to the cell,
 * falling back to the centroid when the normals are near parallel.
 */
export function solveVertex(algo, pts) {
    if (!pts || pts.length === 0) return null;
    const k = pts.length / 5;
    let su = 0, sv = 0;
    for (let i = 0; i < pts.length; i += 5) { su += pts[i]; sv += pts[i + 1]; }
    if (algo === 'surfaceNets') return { u: su / k, v: sv / k };
    let a = 0, b = 0, d = 0, bx = 0, by = 0;
    for (let i = 0; i < pts.length; i += 5) {
        const nx = pts[i + 2], ny = pts[i + 3];
        const rhs = nx * pts[i] + ny * pts[i + 1];
        a += nx * nx; b += nx * ny; d += ny * ny;
        bx += nx * rhs; by += ny * rhs;
    }
    const det = a * d - b * b;
    if (Math.abs(det) < 1e-6) return { u: su / k, v: sv / k };
    return {
        u: Math.max(0, Math.min(1, (d * bx - b * by) / det)),
        v: Math.max(0, Math.min(1, (a * by - b * bx) / det)),
    };
}
