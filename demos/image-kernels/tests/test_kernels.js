// bro.image verbs against hand-computed references on tiny known buffers,
// plus the GPU path. Run: scripts/validate.sh demos/image-kernels
import { check, eq, near, test, done } from "/lib/kit/test.js";
import { buildGradient, buildEqLut, kernelMatrixText, STENCILS } from "/app/kernels.js";

const close = (a, b, eps) => a.length === b.length && Array.from(a).every((v, i) => Math.abs(v - b[i]) <= (eps || 1e-4));
const ramp16 = () => { const f = bro.image.alloc(4, 4, 1); for (let i = 0; i < 16; i++) f[i] = i; return f; };

test('alloc: dtype + size', () => {
    eq(bro.image.alloc(4, 3, 2).length, 24);
    eq(bro.image.alloc(2, 2, 1).constructor.name, 'Float32Array');
    eq(bro.image.alloc(2, 2, 4, 'uint8c').constructor.name, 'Uint8ClampedArray');
    eq(bro.image.alloc(2, 2, 1, 'uint16').constructor.name, 'Uint16Array');
    eq(bro.image.alloc(2, 2, 1, 'int32').constructor.name, 'Int32Array');
});

test('reduce: minmax / sum / mean / histogram / stride', () => {
    const f = ramp16();
    eq(bro.image.reduce(f, 'minmax'), { min: 0, max: 15 });
    eq(bro.image.reduce(f, 'sum'), 120);
    eq(bro.image.reduce(f, 'mean'), 7.5);
    const hist = bro.image.reduce(f, 'histogram', { bins: 4, lo: 0, hi: 15 });
    eq(hist.constructor.name, 'Uint32Array');
    // Half-open interval: the value exactly at `hi` is not counted.
    eq(Array.from(hist), [4, 4, 4, 3]);
    eq(bro.image.reduce(f, 'minmax', { stride: 2 }).max, 14);
});

test('map: affine / sqrt / abs / pow / clamp', () => {
    const dst = bro.image.alloc(4, 1, 1);
    bro.image.map(dst, new Float32Array([0, 1, 4, 9]), { op: 'affine', a: 2, b: 1 });
    check(close(dst, [1, 3, 9, 19]), 'affine 2x+1');
    bro.image.map(dst, new Float32Array([0, 1, 4, 9]), { op: 'sqrt' });
    check(close(dst, [0, 1, 2, 3]), 'sqrt');
    bro.image.map(dst, new Float32Array([-2, -1, 3, -4]), { op: 'abs' });
    check(close(dst, [2, 1, 3, 4]), 'abs');
    bro.image.map(dst, new Float32Array([1, 2, 3, 4]), { op: 'pow', exp: 2 });
    check(close(dst, [1, 4, 9, 16]), 'pow');
    bro.image.map(dst, new Float32Array([-1, 0.5, 2, 0.9]), { op: 'affine', a: 1, b: 0, clamp: [0, 1] });
    check(close(dst, [0, 0.5, 1, 0.9]), 'affine clamp');
});

test('combine: add / sub / mul / min / max / lerp / wsum', () => {
    const a = new Float32Array([0, 1, 2, 3]), b = new Float32Array([10, 10, 10, 10]), d = bro.image.alloc(4, 1, 1);
    const cases = [
        [{ op: 'add' }, [10, 11, 12, 13]], [{ op: 'sub' }, [-10, -9, -8, -7]], [{ op: 'mul' }, [0, 10, 20, 30]],
        [{ op: 'min' }, [0, 1, 2, 3]], [{ op: 'max' }, [10, 10, 10, 10]],
        [{ op: 'lerp', t: 0.5 }, [5, 5.5, 6, 6.5]], [{ op: 'wsum', wa: 2, wb: 1 }, [10, 12, 14, 16]],
    ];
    for (const [spec, want] of cases) {
        bro.image.combine(d, a, b, spec);
        check(close(d, want), spec.op + ': ' + Array.from(d));
    }
});

test('stencil: box blur spike, sobel on a ramp, flat field, bias', () => {
    const W = 5, H = 5, out = bro.image.alloc(W, H, 1);
    const spike = bro.image.alloc(W, H, 1); spike[12] = 9;
    bro.image.stencil(out, spike, STENCILS.box, { srcW: W, srcH: H, edge: 'clamp', divisor: 9 });
    near(out[12], 1, 1e-4, 'centre');
    check([11, 13, 7, 17].every((i) => Math.abs(out[i] - 1) < 1e-4), '4-neighbours');
    near(out[0], 0, 1e-4, 'far cell');

    // f(x, y) = x: interior sobelX = (-1+3) + 2(-1+3) + (-1+3) = 8.
    const ramp = bro.image.alloc(W, H, 1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ramp[y * W + x] = x;
    const edges = bro.image.alloc(W, H, 1);
    bro.image.stencil(edges, ramp, STENCILS.sobelX, { srcW: W, srcH: H, edge: 'clamp' });
    near(edges[2 * W + 2], 8, 1e-4, 'sobelX (2,2)');
    near(edges[1 * W + 2], 8, 1e-4, 'sobelX (2,1)');
    const flat = bro.image.alloc(W, H, 1).fill(3);
    bro.image.stencil(edges, flat, STENCILS.sobelX, { srcW: W, srcH: H, edge: 'clamp' });
    near(edges[12], 0, 1e-4, 'flat field');
    bro.image.stencil(out, bro.image.alloc(W, H, 1), STENCILS.box, { srcW: W, srcH: H, edge: 'zero', divisor: 9, bias: 5 });
    near(out[12], 5, 1e-4, 'bias');
});

test('resample: nearest blocks, identity, interleaved channels', () => {
    const src = new Float32Array([1, 2, 3, 4]), dst = bro.image.alloc(4, 4, 1);
    bro.image.resample(dst, src, { srcW: 2, srcH: 2, dstW: 4, dstH: 4, channels: 1, filter: 'nearest' });
    check(close(dst.subarray(0, 4), [1, 1, 2, 2]) && close(dst.subarray(12, 16), [3, 3, 4, 4]), 'nearest');
    const same = bro.image.alloc(2, 2, 1);
    bro.image.resample(same, src, { srcW: 2, srcH: 2, dstW: 2, dstH: 2, channels: 1, filter: 'bilinear' });
    check(close(same, [1, 2, 3, 4]), 'identity');
    const rg = bro.image.alloc(4, 1, 2);
    bro.image.resample(rg, new Float32Array([1, 100, 2, 200]), { srcW: 2, srcH: 1, dstW: 4, dstH: 1, channels: 2, filter: 'nearest' });
    check(rg[0] === 1 && rg[1] === 100 && rg[6] === 2 && rg[7] === 200, 'pairs kept');
});

test('gradient: endpoints, midpoint, default alpha, stepped LUT', () => {
    const lut = buildGradient('gray');
    eq(lut.length, 1024);
    eq([lut[0], lut[1], lut[2], lut[3]], [0, 0, 0, 255]);
    eq([lut[1020], lut[1021], lut[1022]], [255, 255, 255]);
    check(lut[512] >= 126 && lut[512] <= 129, 'midpoint ~127: ' + lut[512]);
    const step = buildGradient('threshold');
    eq([step[64 * 4], step[127 * 4], step[129 * 4] >= 120], [8, 8, true], 'hard step at 0.5');
    const post = buildGradient('posterize');
    const levels = new Set(); for (let i = 0; i < 256; i++) levels.add(post[i * 4]);
    eq(levels.size, 8, 'posterize has 8 levels');
    const cyc = buildGradient('cyclic');
    eq([cyc[0], cyc[1], cyc[2]], [cyc[1020], cyc[1021], cyc[1022]], 'cyclic ends match');
});

test('lookup: min → black, max → white, opaque, wrap ≠ clamp', () => {
    const lut = buildGradient('gray'), rgba = new Uint8ClampedArray(64);
    bro.image.lookup(rgba, ramp16(), lut, { lo: 0, hi: 15 });
    eq([rgba[0], rgba[1], rgba[2], rgba[3]], [0, 0, 0, 255]);
    eq([rgba[60], rgba[61], rgba[62], rgba[63]], [255, 255, 255, 255]);
    const w2 = new Float32Array([0, 1.9]), rc = new Uint8ClampedArray(8), rw = new Uint8ClampedArray(8);
    bro.image.lookup(rc, w2, lut, { lo: 0, hi: 1, edge: 'clamp' });
    bro.image.lookup(rw, w2, lut, { lo: 0, hi: 1, edge: 'wrap' });
    check(rc[4] !== rw[4], 'wrap differs from clamp');
});

test('gpu.colormap / gpu.fbm2D draw pixels', () => {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    const gl = cv.getContext('webgl2');
    check(!!gl, 'webgl2');
    const lut = buildGradient('gray'), fld = bro.image.alloc(64, 64, 1);
    for (let i = 0; i < fld.length; i++) fld[i] = (i % 64) / 63;
    bro.image.gpu.colormap(cv, fld, lut, { autoRange: true, ema: 0.5, srcW: 64, srcH: 64 });
    bro.image.gpu.colormap(cv, fld, lut, { autoRange: true, srcW: 64, srcH: 64, viewRect: { x: 4, y: 0, w: 56, h: 64 } });
    bro.image.gpu.fbm2D(cv, lut, { frequency: 0.05, octaves: 4, gain: 0.5, lacunarity: 2, seed: 1337, autoRange: true });
    bro.image.gpu.fbm2D(cv, lut, { regenerate: false, autoRange: true, viewRect: { x: 2, y: 0, w: 60, h: 64 } });
    bro.image.gpu.colormap(cv, fld, lut, { lo: 0, hi: 1, srcW: 64, srcH: 64 });
    const px = new Uint8Array(64 * 64 * 4);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // The ramp comes through in order (non-decreasing, brighter on the right).
    const at = (x) => px[(32 * 64 + x) * 4];
    let mono = true;
    for (let x = 1; x < 64; x++) if (at(x) < at(x - 1)) mono = false;
    check(mono && at(63) > at(0), 'ramp colorized in order: ' + at(0) + ' .. ' + at(63));
    // With lo 0 / hi 1 over a 0..1 ramp the edges are black and white.
    check(at(0) < 8 && at(63) > 225, 'full ramp: ' + at(0) + ' .. ' + at(63));
});

test('histogram-eq LUT: monotonic, stretches a squeezed field to 255', () => {
    const f = bro.image.alloc(16, 16, 1);
    for (let i = 0; i < 256; i++) f[i] = (i / 256) * 0.3;    // all in [0, 0.3)
    const lut = buildEqLut(f, 0, 1);
    let mono = true;
    for (let i = 1; i < 256; i++) if (lut[i * 4] < lut[(i - 1) * 4]) mono = false;
    check(mono, 'monotonic');
    eq(lut[255 * 4], 255);
    check(lut[80 * 4] === 255, 'already saturated just past 0.3');
});

test('kernel matrix text', () => {
    eq(kernelMatrixText('sobelX'), ' -1   0   1\n -2   0   2\n -1   0   1\n÷1');
    check(/sqrt/.test(kernelMatrixText('edgemag')), 'edgemag explains itself');
});

done('image-kernels kernels');
