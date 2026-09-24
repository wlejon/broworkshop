// kernels.js — the data the pipeline runs on: colour LUTs (bro.image.gradient),
// stencil presets, procedural source fields, and the histogram-equalization
// LUT recipe. No DOM.

/** Gradient LUT names, in menu order. */
export const GRADIENTS = {
    gray: 'grayscale', viridis: 'viridis-ish', magma: 'magma-ish',
    posterize: 'posterize (8-step LUT)', threshold: 'threshold LUT', cyclic: 'cyclic (wrap edge)',
};

// The LUT *shape* alone does the posterize / threshold work: lookup() is the
// same call every time.
export function buildGradient(name, n = 256) {
    switch (name) {
        case 'viridis':
            return bro.image.gradient([
                [0.00, 68, 1, 84], [0.25, 59, 82, 139], [0.50, 33, 145, 140],
                [0.75, 94, 201, 98], [1.00, 253, 231, 37],
            ], n);
        case 'magma':
            return bro.image.gradient([
                [0.00, 0, 0, 4], [0.25, 80, 18, 123], [0.50, 182, 54, 121],
                [0.75, 251, 136, 97], [1.00, 252, 253, 191],
            ], n);
        case 'posterize': {
            // 8 hard steps: a duplicated t at each band edge gives a flat plateau.
            const stops = [], STEPS = 8;
            for (let i = 0; i < STEPS; i++) {
                const v = Math.round((i / (STEPS - 1)) * 255);
                stops.push([i / STEPS, v, v, v], [(i + 1) / STEPS - 1e-4, v, v, v]);
            }
            return bro.image.gradient(stops, n);
        }
        case 'threshold':
            // A step at 0.5: pure binarize via the LUT shape.
            return bro.image.gradient([
                [0.0, 8, 12, 24], [0.5, 8, 12, 24], [0.5, 120, 230, 170], [1.0, 235, 255, 245],
            ], n);
        case 'cyclic':
            // First == last colour so the 'wrap' edge mode tiles seamlessly.
            return bro.image.gradient([
                [0.00, 30, 30, 60], [0.25, 220, 90, 90], [0.50, 240, 230, 120],
                [0.75, 90, 200, 140], [1.00, 30, 30, 60],
            ], n);
        default:
            return bro.image.gradient([[0, 0, 0, 0], [1, 255, 255, 255]], n);
    }
}

/** bro.image.stencil presets; divisor/bias chosen so each gives a sensible field. */
export const STENCILS = {
    box:      { data: new Float32Array(9).fill(1), w: 3, h: 3, divisor: 9, bias: 0, label: 'box blur' },
    gaussian: { data: new Float32Array([1, 2, 1, 2, 4, 2, 1, 2, 1]), w: 3, h: 3, divisor: 16, bias: 0, label: 'gaussian 3×3' },
    sobelX:   { data: new Float32Array([-1, 0, 1, -2, 0, 2, -1, 0, 1]), w: 3, h: 3, divisor: 1, bias: 0, label: 'sobel X' },
    sobelY:   { data: new Float32Array([-1, -2, -1, 0, 0, 0, 1, 2, 1]), w: 3, h: 3, divisor: 1, bias: 0, label: 'sobel Y' },
    sharpen:  { data: new Float32Array([0, -1, 0, -1, 5, -1, 0, -1, 0]), w: 3, h: 3, divisor: 1, bias: 0, label: 'sharpen' },
    emboss:   { data: new Float32Array([-2, -1, 0, -1, 1, 1, 0, 1, 2]), w: 3, h: 3, divisor: 1, bias: 0, label: 'emboss' },
};
/** Stencil menu: the presets plus 'edgemag' (sqrt(sobelX² + sobelY²), composed in pipeline.js). */
export const STENCIL_KERNELS = ['box', 'gaussian', 'sobelX', 'sobelY', 'edgemag', 'sharpen', 'emboss'];

export function kernelLabel(name) {
    return STENCILS[name] ? STENCILS[name].label : 'edge magnitude';
}

/** The kernel as a small matrix + divisor, for the stencil card. */
export function kernelMatrixText(name) {
    if (name === 'edgemag') return 'sqrt(sobelX² + sobelY²)\n(2 stencil + map/combine)';
    const k = STENCILS[name];
    if (!k) return '';
    const rows = [];
    for (let y = 0; y < k.h; y++) {
        const row = [];
        for (let x = 0; x < k.w; x++) row.push(String(k.data[y * k.w + x]).padStart(3));
        rows.push(row.join(' '));
    }
    return rows.join('\n') + '\n÷' + k.divisor;
}

// ---------------------------------------------------------------------------
// Source fields. The noise kinds go through FastNoise's C++ grid fill; the
// test patterns are per-pixel JS, so pipeline.js caches them and only
// regenerates a source that is dynamic AND animating.
// ---------------------------------------------------------------------------

export const SOURCES = {
    fbm: 'FBm noise (FastNoise)', simplex: 'Simplex (FastNoise)',
    radial: 'radial test pattern', gradient: 'gradient test pattern', checker: 'checker + ramp',
};
export const DYNAMIC_SOURCES = new Set(['fbm', 'simplex']);

let noise = null;
function noiseNodes() {
    if (noise) return noise;
    const simplex = FastNoise.create('Simplex');
    const fbm = FastNoise.create('FractalFBm');
    fbm.set('Source', FastNoise.create('Simplex'));
    fbm.set('Octaves', 6);
    fbm.set('Gain', 0.5);
    fbm.set('Lacunarity', 2.0);
    return (noise = { simplex, fbm });
}

export function fillSource(dst, kind, w, h, t) {
    if (kind === 'fbm') {
        noiseNodes().fbm.genUniformGrid2DInto(dst, t * 12, 0, w, h, 0.012, 1337);
    } else if (kind === 'simplex') {
        noiseNodes().simplex.genUniformGrid2DInto(dst, t * 12, 0, w, h, 0.02, 7);
    } else if (kind === 'radial') {
        const cx = w / 2, cy = h / 2, maxR = Math.hypot(cx, cy);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            dst[y * w + x] = 0.5 + 0.5 * Math.sin(Math.hypot(x - cx, y - cy) / maxR * 22 - t * 4);
        }
    } else if (kind === 'gradient') {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            dst[y * w + x] = (x / (w - 1)) * 0.5 + (y / (h - 1)) * 0.5;
        }
    } else if (kind === 'checker') {
        const cell = Math.max(4, (w / 16) | 0);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const c = ((x / cell | 0) + (y / cell | 0)) & 1;
            dst[y * w + x] = c ? x / (w - 1) : 1 - x / (w - 1);
        }
    }
}

/**
 * Histogram-equalization LUT (RGBA8, grayscale) from the field's histogram
 * over [lo, hi]: the normalized CDF, starting at the first non-empty bin so no
 * output range is wasted. Writes into `out` (256*4 bytes) when given.
 */
export function buildEqLut(src, lo, hi, out) {
    const BINS = 256;
    const lut = out || new Uint8Array(BINS * 4);
    const hist = bro.image.reduce(src, 'histogram', { bins: BINS, lo, hi });
    let total = 0, cdfMin = 0;
    for (let i = 0; i < BINS; i++) total += hist[i];
    for (let i = 0; i < BINS; i++) if (hist[i] > 0) { cdfMin = hist[i]; break; }
    const denom = Math.max(1, total - cdfMin);
    let cum = 0;
    for (let i = 0; i < BINS; i++) {
        cum += hist[i];
        const v = Math.max(0, Math.min(255, Math.round(((cum - cdfMin) / denom) * 255)));
        lut[i * 4] = v; lut[i * 4 + 1] = v; lut[i * 4 + 2] = v; lut[i * 4 + 3] = 255;
    }
    return lut;
}
