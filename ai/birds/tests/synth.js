// Synthetic photos for the birds tests: deterministic RGB textures and JPEGs
// carrying a fake EXIF capture time (no real photos in tests).

const fs = require('fs');

/**
 * w x h RGB: soft blobs plus fine grain from `seed`, box-blurred `blur` times
 * (0 = sharp; each pass softens it further).
 */
export function texture(w, h, seed, blur) {
    let s = (seed * 2654435761) >>> 0 || 1;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const blobs = [];
    for (let i = 0; i < 24; i++) blobs.push({ x: rnd() * w, y: rnd() * h, r: 8 + rnd() * 40, c: [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5] });
    let px = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const c = [0.5, 0.45, 0.4];
        for (const b of blobs) {
            const g = Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (b.r * b.r));
            for (let k = 0; k < 3; k++) c[k] += 0.6 * g * b.c[k];
        }
        const grain = (rnd() - 0.5) * 0.25;
        for (let k = 0; k < 3; k++) px[(y * w + x) * 3 + k] = Math.max(0, Math.min(255, Math.round((c[k] + grain) * 255)));
    }
    for (let p = 0; p < (blur || 0); p++) {
        const out = new Uint8Array(px.length);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) {
            let sum = 0, n = 0;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
                const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy));
                sum += px[(yy * w + xx) * 3 + k]; n++;
            }
            out[(y * w + x) * 3 + k] = Math.round(sum / n);
        }
        px = out;
    }
    return px;
}

// A little-endian TIFF block: IFD0 { Make, ExifIFD } -> Exif IFD
// { DateTimeOriginal, OffsetTimeOriginal?, SubSecTimeOriginal? }.
function exifBlock(e) {
    const ascii = (str) => { const b = new Uint8Array(str.length + 1); for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i); return b; };
    const make = ascii('Synthetic'), date = ascii(e.date);
    const exifTags = [[0x9003, date]];
    if (e.offset) exifTags.push([0x9011, ascii(e.offset)]);
    if (e.subsec) exifTags.push([0x9291, ascii(e.subsec)]);
    const ifd0At = 8, ifd0Size = 2 + 2 * 12 + 4;
    const makeAt = ifd0At + ifd0Size;
    const exifAt = makeAt + make.length;
    const exifSize = 2 + exifTags.length * 12 + 4;
    let dataAt = exifAt + exifSize;
    const total = dataAt + exifTags.reduce((n, [, v]) => n + (v.length > 4 ? v.length : 0), 0);
    const buf = new Uint8Array(total), dv = new DataView(buf.buffer);
    buf[0] = 0x49; buf[1] = 0x49; dv.setUint16(2, 42, true); dv.setUint32(4, ifd0At, true);
    const entry = (at, tag, type, count, value) => {
        dv.setUint16(at, tag, true); dv.setUint16(at + 2, type, true);
        dv.setUint32(at + 4, count, true); dv.setUint32(at + 8, value, true);
    };
    dv.setUint16(ifd0At, 2, true);
    entry(ifd0At + 2, 0x010f, 2, make.length, makeAt);
    entry(ifd0At + 14, 0x8769, 4, 1, exifAt);
    dv.setUint32(ifd0At + 26, 0, true);
    buf.set(make, makeAt);
    dv.setUint16(exifAt, exifTags.length, true);
    exifTags.forEach(([tag, v], i) => {
        const at = exifAt + 2 + i * 12;
        if (v.length > 4) {
            entry(at, tag, 2, v.length, dataAt);
            buf.set(v, dataAt);
            dataAt += v.length;
        } else {
            entry(at, tag, 2, v.length, 0);
            buf.set(v, at + 8);
        }
    });
    dv.setUint32(exifAt + 2 + exifTags.length * 12, 0, true);
    return buf;
}

/**
 * Write `rgb` (w x h RGB) as a JPEG at `path`, with an EXIF APP1 when `exif`
 * is given: { date: 'YYYY:MM:DD HH:MM:SS', subsec?: '25', offset?: '-05:00' }.
 */
export function writeExifJpeg(path, rgb, w, h, exif) {
    const jpg = bro.image.encodeJpeg(rgb, w, h, 3, 92);
    if (!jpg) throw new Error('encodeJpeg failed');
    let bytes = jpg;
    if (exif) {
        const tiff = exifBlock(exif);
        const len = 2 + 6 + tiff.length;
        const app1 = new Uint8Array(4 + 6 + tiff.length);
        app1.set([0xff, 0xe1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]);
        app1.set(tiff, 10);
        bytes = new Uint8Array(jpg.length + app1.length);
        bytes.set(jpg.subarray(0, 2));
        bytes.set(app1, 2);
        bytes.set(jpg.subarray(2), 2 + app1.length);
    }
    fs.writeFileSync(path, bytes);
}
