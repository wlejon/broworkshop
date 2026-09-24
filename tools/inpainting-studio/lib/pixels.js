// pixels.js — pure ImageData helpers: the binary mask, "masked content" fill
// modes applied to the init image before it is VAE-encoded, and the canny
// (Sobel) annotator for the edge ControlNet. No DOM, so tests call them directly.

/** Pixels whose mask alpha passes this count as "repaint". */
export const MASK_ALPHA = 30;

/** Uint8Array(w*h): 1 where the mask overlay's alpha > MASK_ALPHA. */
export function maskBits(maskImage) {
    const d = maskImage.data, n = maskImage.width * maskImage.height;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = d[i * 4 + 3] > MASK_ALPHA ? 1 : 0;
    return out;
}

/** Fraction of pixels marked for repaint. */
export function coverage(bits) {
    let n = 0;
    for (let i = 0; i < bits.length; i++) n += bits[i];
    return bits.length ? n / bits.length : 0;
}

/** The mask as the native loader wants it: white = repaint, black = keep (RGBA). */
export function maskToRgba(bits, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        const v = bits[i] ? 255 : 0;
        out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
        out[i * 4 + 3] = 255;
    }
    return out;
}

// ── fill modes ───────────────────────────────────────────────────────────────

export const FILL_MODES = {
    original: 'Original content',
    blur: 'Blurred surroundings',
    noise: 'Gaussian noise',
    color: 'Mean border colour',
};

// One 1D box pass of radius r over `len` samples starting at `base`, `step`
// apart (running sums, clamped window), for each of the 3 channels.
function boxLine(src, dst, base, step, len, r) {
    for (let c = 0; c < 3; c++) {
        let sum = 0, n = 0;
        for (let k = 0; k <= Math.min(len - 1, r); k++) { sum += src[base + k * step + c]; n++; }
        for (let x = 0; x < len; x++) {
            dst[base + x * step + c] = sum / n;
            const add = x + r + 1, drop = x - r;
            if (add < len) { sum += src[base + add * step + c]; n++; }
            if (drop >= 0) { sum -= src[base + drop * step + c]; n--; }
        }
    }
}

function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h * 3), out = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) boxLine(src, tmp, y * w * 3, 3, w, r);
    for (let x = 0; x < w; x++) boxLine(tmp, out, x * 3, w * 3, h, r);
    return out;
}

/**
 * A copy of `image` (ImageData-like) with the masked pixels replaced per
 * `mode` (FILL_MODES). `seed` makes the noise repeatable.
 */
export function fillMasked(image, bits, mode, seed) {
    const w = image.width, h = image.height, src = image.data;
    const out = new Uint8ClampedArray(src);
    if (mode === 'original') return { width: w, height: h, data: out };
    if (mode === 'noise') {
        let s = (seed >>> 0) || 1;
        const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
        for (let i = 0; i < w * h; i++) {
            if (!bits[i]) continue;
            for (let c = 0; c < 3; c++) {
                const g = (rnd() + rnd() + rnd() - 1.5) * 2;       // ~N(0, 1)
                out[i * 4 + c] = 128 + g * 60;
            }
        }
    } else if (mode === 'color') {
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                if (bits[i]) continue;
                const edge = (x > 0 && bits[i - 1]) || (x < w - 1 && bits[i + 1]) ||
                             (y > 0 && bits[i - w]) || (y < h - 1 && bits[i + w]);
                if (!edge) continue;
                r += src[i * 4]; g += src[i * 4 + 1]; b += src[i * 4 + 2]; n++;
            }
        }
        const m = n ? [r / n, g / n, b / n] : [128, 128, 128];
        for (let i = 0; i < w * h; i++) if (bits[i]) { out[i * 4] = m[0]; out[i * 4 + 1] = m[1]; out[i * 4 + 2] = m[2]; }
    } else if (mode === 'blur') {
        // Blur the unmasked surroundings into the hole: masked pixels start
        // at the mean, then a wide blur repeatedly pulls in the edges.
        const rgb = new Float32Array(w * h * 3);
        for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = src[i * 4 + c];
        let cur = rgb;
        for (let pass = 0; pass < 3; pass++) {
            const bl = boxBlur(cur, w, h, 12);
            for (let i = 0; i < w * h; i++) if (bits[i]) for (let c = 0; c < 3; c++) cur[i * 3 + c] = bl[i * 3 + c];
        }
        for (let i = 0; i < w * h; i++) if (bits[i]) for (let c = 0; c < 3; c++) out[i * 4 + c] = cur[i * 3 + c];
    }
    return { width: w, height: h, data: out };
}

// ── annotators ───────────────────────────────────────────────────────────────

/** White-on-black Sobel edge map (the canny ControlNet's input). */
export function edgeMap(image, threshold) {
    const w = image.width, h = image.height, s = image.data, t = threshold == null ? 45 : threshold;
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) lum[i] = s[i * 4] * 0.299 + s[i * 4 + 1] * 0.587 + s[i * 4 + 2] * 0.114;
    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) out[i * 4 + 3] = 255;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const gx = -lum[i - w - 1] + lum[i - w + 1] - 2 * lum[i - 1] + 2 * lum[i + 1] - lum[i + w - 1] + lum[i + w + 1];
            const gy = -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1] + lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1];
            if (gx * gx + gy * gy > t * t) out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 255;
        }
    }
    return { width: w, height: h, data: out };
}

/** Grey bytes (w*h) as opaque RGBA. */
export function grayToRgba(gray, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = gray[i]; out[i * 4 + 3] = 255; }
    return out;
}
