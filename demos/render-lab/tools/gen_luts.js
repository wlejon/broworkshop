// gen_luts.js — offline generator for the color-grading LUT strips used by
// the Render Lab HUD.
//
// scene.setColorLUT() takes a FILE PATH, not pixel data: a horizontal
// "neutral strip" image of `size` tiles, each size x size, laid out left to
// right, where the tile index is BLUE, the tile-local x is RED and the
// tile-local y is GREEN (all increasing left-to-right / top-to-bottom).
// A 16-cube LUT is therefore a 256x16 image. That layout means we cannot
// build the LUT at runtime from a typed array — so this script bakes the
// three grades the app offers into 24-bit uncompressed BMPs (stb_image
// decodes BMP, and BMP is the one format we can emit by hand with no
// encoder dependency).
//
// Run once, from the app directory:
//   cd demos/render-lab
//   ../../../bro/build/Release/bro-headless.exe . tools/gen_luts.js
//
// Output: luts/neutral.bmp, luts/warm.bmp, luts/cool.bmp, luts/noir.bmp

const fs = require('fs');

const SIZE = 16;                 // cube side -> 256x16 strip
const W = SIZE * SIZE;
const H = SIZE;

// --- grades ------------------------------------------------------------------
// Each takes linear-ish display-space [0..1] rgb and returns graded rgb.
// LUTs apply AFTER tonemap + gamma, so these operate in display space.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const mix = (a, b, t) => a + (b - a) * t;

const GRADES = {
    // Exact identity — useful as an A/B reference and as a sanity check that
    // the strip layout is right (a neutral strip must be a no-op).
    neutral: (r, g, b) => [r, g, b],

    // Teal shadows / warm highlights — the standard blockbuster grade.
    warm: (r, g, b) => {
        const l = lum(r, g, b);
        const shadow = 1 - clamp01(l * 1.6);       // weight toward darks
        const high = clamp01((l - 0.4) * 1.8);     // weight toward brights
        let nr = r + high * 0.16 - shadow * 0.05;
        let ng = g + high * 0.06 + shadow * 0.02;
        let nb = b - high * 0.10 + shadow * 0.12;
        // Slight S-curve for contrast.
        const s = (v) => clamp01(v * v * (3 - 2 * v) * 0.85 + v * 0.15);
        return [s(clamp01(nr)), s(clamp01(ng)), s(clamp01(nb))];
    },

    // Cold moonlit interior — blue push, crushed reds, lifted blacks.
    cool: (r, g, b) => {
        const l = lum(r, g, b);
        let nr = mix(r, l, 0.35) * 0.82;
        let ng = mix(g, l, 0.20) * 0.94;
        let nb = mix(b, l, 0.05) * 1.15 + 0.04;
        return [clamp01(nr), clamp01(ng), clamp01(nb)];
    },

    // High-contrast desaturated noir.
    noir: (r, g, b) => {
        const l = lum(r, g, b);
        const c = clamp01((l - 0.5) * 1.7 + 0.5);  // hard contrast curve
        const v = mix(l, c, 1.0);
        return [clamp01(v * 1.02), clamp01(v), clamp01(v * 1.06)];
    },
};

// --- 24-bit BMP writer -------------------------------------------------------
// Rows are stored bottom-up (positive biHeight), BGR, each row padded to a
// 4-byte boundary. W*3 = 768 here, already aligned, but the padding math is
// kept general.

function writeBMP(path, width, height, rgbAt) {
    const rowRaw = width * 3;
    const rowPad = (4 - (rowRaw % 4)) % 4;
    const rowSize = rowRaw + rowPad;
    const pixelBytes = rowSize * height;
    const offset = 14 + 40;
    const total = offset + pixelBytes;

    const buf = new Uint8Array(total);
    const dv = new DataView(buf.buffer);

    // BITMAPFILEHEADER
    buf[0] = 0x42; buf[1] = 0x4d;              // "BM"
    dv.setUint32(2, total, true);
    dv.setUint32(10, offset, true);
    // BITMAPINFOHEADER
    dv.setUint32(14, 40, true);                // biSize
    dv.setInt32(18, width, true);
    dv.setInt32(22, height, true);             // positive => bottom-up
    dv.setUint16(26, 1, true);                 // biPlanes
    dv.setUint16(28, 24, true);                // biBitCount
    dv.setUint32(30, 0, true);                 // BI_RGB
    dv.setUint32(34, pixelBytes, true);
    dv.setInt32(38, 2835, true);               // 72 DPI
    dv.setInt32(42, 2835, true);

    for (let y = 0; y < height; ++y) {
        const imgY = height - 1 - y;           // file row 0 = image bottom row
        let o = offset + y * rowSize;
        for (let x = 0; x < width; ++x) {
            const c = rgbAt(x, imgY);
            buf[o++] = c[2];                   // B
            buf[o++] = c[1];                   // G
            buf[o++] = c[0];                   // R
        }
    }
    fs.writeFileSync(path, buf.buffer);
}

// --- bake --------------------------------------------------------------------

const inv = 1 / (SIZE - 1);
for (const [name, grade] of Object.entries(GRADES)) {
    const path = `luts/${name}.bmp`;
    writeBMP(path, W, H, (x, y) => {
        const tile = Math.floor(x / SIZE);
        const r = (x % SIZE) * inv;
        const g = y * inv;
        const b = tile * inv;
        const out = grade(r, g, b);
        return [
            Math.round(clamp01(out[0]) * 255),
            Math.round(clamp01(out[1]) * 255),
            Math.round(clamp01(out[2]) * 255),
        ];
    });
    console.log(`wrote ${path} (${W}x${H}, cube ${SIZE})`);
}
