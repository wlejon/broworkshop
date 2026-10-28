// The ground as the render shows it: squares of the land fixed on the body,
// read off the last render (their pixels' mean light, or the square
// resampled into a tile): what ladder.js measures the land's look by,
// height after height.

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a) => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));

// The pixels' sRGB to linear, and back.
export const LIN = new Float64Array(256);
for (let k = 0; k < 256; k++) {
    const c = k / 255;
    LIN[k] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export const toSrgb = (l) => {
    l = Math.max(0, Math.min(1, l));
    return Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055));
};

// The view as of the last render: body points to the screen's pixels
// (null behind the eye), from the scene's matrices (column-major) and the
// place frame's map from the body's (three points' images: it moves when
// the place re-anchors). The screen's y the way projectLocal has it.
export function viewProjection(scene, W, H) {
    const o = scene.toPlace([0, 0, 0]);
    const ex = sub(scene.toPlace([1e6, 0, 0]), o), ey = sub(scene.toPlace([0, 1e6, 0]), o), ez = sub(scene.toPlace([0, 0, 1e6]), o);
    const toPlace = (b) => [o[0] + (ex[0] * b[0] + ey[0] * b[1] + ez[0] * b[2]) / 1e6,
                            o[1] + (ex[1] * b[0] + ey[1] * b[1] + ez[1] * b[2]) / 1e6,
                            o[2] + (ex[2] * b[0] + ey[2] * b[1] + ez[2] * b[2]) / 1e6];
    const V = scene.viewMatrix, P = scene.projectionMatrix;
    const M = new Float64Array(16);
    for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++) {
            let s = 0;
            for (let k = 0; k < 4; k++) s += P[k * 4 + r] * V[c * 4 + k];
            M[c * 4 + r] = s;
        }
    let flip = true;
    const clip = (p) => {
        const w = M[3] * p[0] + M[7] * p[1] + M[11] * p[2] + M[15];
        if (w <= 1e-6) return null;
        return [(M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12]) / w, (M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13]) / w];
    };
    // (A point before the eye, up and to the right, ours against projectLocal's.)
    {
        const I = invertRigid(V);
        const p = [0, 1, 2].map((j) => I[12 + j] - 10 * I[8 + j] + 3 * I[j] + 2 * I[4 + j]);
        const ref = scene.projectLocal(p[0], p[1], p[2]);
        const q = clip(p);
        if (ref && q) flip = Math.abs((0.5 - 0.5 * q[1]) * H - ref.y) < Math.abs((0.5 + 0.5 * q[1]) * H - ref.y);
    }
    const project = (b) => {
        const q = clip(toPlace(b));
        return q ? [(q[0] * 0.5 + 0.5) * W, (flip ? 0.5 - 0.5 * q[1] : 0.5 + 0.5 * q[1]) * H] : null;
    };
    return { toPlace, project };
}
// (A view matrix's inverse: its rotation transposed, its translation turned back.)
function invertRigid(V) {
    const I = new Float64Array(16);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) I[c * 4 + r] = V[r * 4 + c];
    for (let r = 0; r < 3; r++) I[12 + r] = -(I[r] * V[12] + I[4 + r] * V[13] + I[8 + r] * V[14]);
    I[15] = 1;
    return I;
}

// A square of the ground on the body: `at` its middle (a body point on the
// ground), `size` metres a side, its axes e1 and e2 square to the up there.
export function groundSquare(at, size) {
    const c = unit(at);
    const e1 = unit(cross(c, Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), e2 = cross(c, e1);
    return { at, size, e1, e2 };
}
const pointOf = (sq, u, v) => add(sq.at, add(mul(sq.e1, (u - 0.5) * sq.size), mul(sq.e2, (v - 0.5) * sq.size)));

// The square read off image `im` (scene.toImageData()) through `view`
// (viewProjection): its mean linear colour over n x n points, its span in
// pixels; null if under `whole` of it is on the screen.
export function readSquare(im, view, sq, n, whole = 0.9) {
    const px = im.data, iw = im.width, ih = im.height;
    let r = 0, g = 0, b = 0, k = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let a = 0; a < n; a++)
        for (let c = 0; c < n; c++) {
            const q = view.project(pointOf(sq, (a + 0.5) / n, (c + 0.5) / n));
            if (!q) continue;
            const x = Math.floor(q[0]), y = Math.floor(q[1]);
            if (x < 0 || y < 0 || x >= iw || y >= ih) continue;
            const o = (y * iw + x) * 4;
            r += LIN[px[o]]; g += LIN[px[o + 1]]; b += LIN[px[o + 2]]; k++;
            minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]);
            minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]);
        }
    if (k < whole * n * n) return null;
    return { r: r / k, g: g / k, b: b / k, span: Math.max(maxX - minX, maxY - minY) * n / Math.max(n - 1, 1) };
}

// The square resampled into a t x t tile of one value a texel, `f(data, o)`
// at each of s x s pixels over it (o the pixel's byte offset), their mean;
// texels off the screen NaN.
export function squareValues(im, view, sq, t, f, s = 2) {
    const px = im.data, iw = im.width, ih = im.height;
    const out = new Float64Array(t * t);
    for (let y = 0; y < t; y++)
        for (let x = 0; x < t; x++) {
            let v = 0, k = 0;
            for (let j = 0; j < s; j++)
                for (let i = 0; i < s; i++) {
                    const q = view.project(pointOf(sq, (x + (i + 0.5) / s) / t, 1 - (y + (j + 0.5) / s) / t));
                    if (!q) continue;
                    const X = Math.floor(q[0]), Y = Math.floor(q[1]);
                    if (X < 0 || Y < 0 || X >= iw || Y >= ih) continue;
                    v += f(px, (Y * iw + X) * 4); k++;
                }
            out[y * t + x] = k ? v / k : NaN;
        }
    return out;
}

// A tile as an n x n grid of how much cloud each block shows: its texels'
// whiteness (least channel over the most), which cloud has from above and
// from below alike (white tops, grey bases) and the blue sky, the sea and
// the land have not. The same column of air seen over the deck and under
// it, set side by side.
export function tileCloud(tile, t, n) {
    const b = t / n, out = new Float64Array(n * n);
    for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
            let s = 0, k = 0;
            for (let j = y * b; j < (y + 1) * b; j++)
                for (let i = x * b; i < (x + 1) * b; i++) {
                    const o = (j * t + i) * 3;
                    if (Number.isNaN(tile[o])) continue;
                    const hi = Math.max(tile[o], tile[o + 1], tile[o + 2]);
                    s += hi > 0 ? Math.min(tile[o], tile[o + 1], tile[o + 2]) / hi : 0;
                    k++;
                }
            out[y * n + x] = k ? s / k : NaN;
        }
    return out;
}

// A tile (squareTile's, t x t) as an n x n grid of its blocks' light: the
// mean linear luma of each t/n square block, in stops (NaN where a block
// has no texel on the screen). What a coarser view would draw there, read
// off a finer one.
export function tileGrid(tile, t, n) {
    const b = t / n, out = new Float64Array(n * n);
    for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
            let s = 0, k = 0;
            for (let j = y * b; j < (y + 1) * b; j++)
                for (let i = x * b; i < (x + 1) * b; i++) {
                    const o = (j * t + i) * 3;
                    if (Number.isNaN(tile[o])) continue;
                    s += 0.2126 * tile[o] + 0.7152 * tile[o + 1] + 0.0722 * tile[o + 2];
                    k++;
                }
            out[y * n + x] = k ? Math.log2(Math.max(s / k, 1e-9)) : NaN;
        }
    return out;
}

// Two grids of the same ground (tileGrid's) compared, each with its mean
// taken out: what is left is the ground's pattern at that band. `r` their
// correlation (1 the same pattern, 0 none of it kept), `sa` and `sb` each
// one's spread (stops: a pattern washed out has a smaller one), `d` the rms
// of their difference (stops). null with under half the blocks in both.
export function compareGrids(a, b) {
    let n = 0, ma = 0, mb = 0;
    for (let k = 0; k < a.length; k++) if (!Number.isNaN(a[k]) && !Number.isNaN(b[k])) { ma += a[k]; mb += b[k]; n++; }
    if (n < a.length / 2) return null;
    ma /= n; mb /= n;
    let saa = 0, sbb = 0, sab = 0, dd = 0;
    for (let k = 0; k < a.length; k++) {
        if (Number.isNaN(a[k]) || Number.isNaN(b[k])) continue;
        const x = a[k] - ma, y = b[k] - mb;
        saa += x * x; sbb += y * y; sab += x * y; dd += (x - y) ** 2;
    }
    return { r: sab / Math.sqrt(Math.max(saa * sbb, 1e-12)), sa: Math.sqrt(saa / n), sb: Math.sqrt(sbb / n), d: Math.sqrt(dd / n) };
}

// The square resampled into a t x t tile (linear RGB, three floats a texel,
// each the mean of s x s points over it); texels off the screen NaN.
export function squareTile(im, view, sq, t, s = 2) {
    const px = im.data, iw = im.width, ih = im.height;
    const out = new Float64Array(t * t * 3);
    for (let y = 0; y < t; y++)
        for (let x = 0; x < t; x++) {
            let r = 0, g = 0, b = 0, k = 0;
            for (let j = 0; j < s; j++)
                for (let i = 0; i < s; i++) {
                    const q = view.project(pointOf(sq, (x + (i + 0.5) / s) / t, 1 - (y + (j + 0.5) / s) / t));
                    if (!q) continue;
                    const X = Math.floor(q[0]), Y = Math.floor(q[1]);
                    if (X < 0 || Y < 0 || X >= iw || Y >= ih) continue;
                    const o = (Y * iw + X) * 4;
                    r += LIN[px[o]]; g += LIN[px[o + 1]]; b += LIN[px[o + 2]]; k++;
                }
            const o = (y * t + x) * 3;
            out[o] = k ? r / k : NaN;
            out[o + 1] = k ? g / k : NaN;
            out[o + 2] = k ? b / k : NaN;
        }
    return out;
}
