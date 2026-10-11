// decode-worker.js — the batch processor's CPU half, one photo at a time,
// off the page thread so decoding the next photos overlaps the GPU work on
// this one (batch.js keeps a few of these busy). Sharpness is
// bro.vision.wildlife.sharpness (bro.image.sharpness, rounded).
//
//   { cmd: 'decode', id, path, detectSize, sharpSize, thumbSize }
//     -> { id, ok, exif, image: { width, height, channels, pixels } (the
//          detection image, `detectSize` on the long side), source: { width,
//          height }, decodePath, sharp: { width, height } (the sharpness
//          image's size), frame (whole-frame sharpness), thumb: { width,
//          height, luma }, ms: { decode, exif, sharpness, thumb } }
//     The sharpness image (`sharpSize` on the long side) stays here for:
//   { cmd: 'subject', id, box: [x, y, w, h] in source pixels }
//     -> { id, ok, subject (sharpness of the box), ms }   and frees the image.
//   { cmd: 'drop', id } frees it without measuring.
//
// A photo that fails to decode answers { id, ok: false, error }.

const kept = new Map();   // id -> the sharpness image
const wildlife = bro.vision.wildlife;

// Long side `size`, aspect kept, area filter.
function resized(img, size) {
    const s = Math.min(1, size / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
    if (w === img.width && h === img.height) return img;
    const out = new Uint8Array(w * h * img.channels);
    bro.image.resizeU8(out, img.pixels, { srcW: img.width, srcH: img.height, dstW: w, dstH: h,
                                          channels: img.channels, filter: 'area' });
    return { width: w, height: h, channels: img.channels, pixels: out };
}

function lumaThumb(img, size) {
    const t = resized(img, size);
    const n = t.width * t.height, luma = new Uint8Array(n), ch = t.channels, p = t.pixels;
    for (let i = 0; i < n; i++) {
        const j = i * ch;
        luma[i] = ch < 3 ? p[j] : (77 * p[j] + 150 * p[j + 1] + 29 * p[j + 2] + 128) >> 8;
    }
    return { width: t.width, height: t.height, luma };
}

function decode(m) {
    const ms = {};
    let t = Date.now();
    const big = bro.image.decodeScaled(m.path, { width: m.sharpSize, height: m.sharpSize });
    if (!big || !big.width) return { id: m.id, ok: false, stage: 'decode', error: (big && big.error) || 'decode failed' };
    let image = resized(big, m.detectSize);
    // The detection image is transferred away; the kept one must not be it.
    if (image === big) image = { width: big.width, height: big.height, channels: big.channels, pixels: big.pixels.slice() };
    ms.decode = Date.now() - t;
    t = Date.now();
    let exif = null;
    try { exif = bro.image.readExif(m.path); } catch (e) { exif = null; }
    ms.exif = Date.now() - t;
    t = Date.now();
    const frame = wildlife.sharpness(big);
    ms.sharpness = Date.now() - t;
    t = Date.now();
    const thumb = lumaThumb(image, m.thumbSize);
    ms.thumb = Date.now() - t;
    kept.set(m.id, big);
    return {
        id: m.id, ok: true, exif, image, frame, thumb, ms,
        source: { width: big.sourceWidth || big.width, height: big.sourceHeight || big.height },
        decodePath: big.path || null,
        sharp: { width: big.width, height: big.height },
    };
}

function subject(m) {
    const big = kept.get(m.id);
    kept.delete(m.id);
    if (!big) return { id: m.id, ok: false, error: 'no image kept for ' + m.id };
    const t = Date.now();
    const subject = wildlife.sharpness(big, { box: m.box, source: { width: m.sourceWidth, height: m.sourceHeight } });
    return { id: m.id, ok: true, subject, ms: Date.now() - t };
}

self.onmessage = (e) => {
    const m = e.data;
    let reply;
    try {
        if (m.cmd === 'decode') reply = decode(m);
        else if (m.cmd === 'subject') reply = subject(m);
        else if (m.cmd === 'drop') { kept.delete(m.id); return; }
        else reply = { id: m.id, ok: false, error: 'unknown command ' + m.cmd };
    } catch (err) {
        kept.delete(m.id);
        reply = { id: m.id, ok: false, stage: m.cmd, error: String((err && err.message) || err) };
    }
    const transfer = reply.image ? [reply.image.pixels.buffer] : [];
    self.postMessage(reply, transfer);
};
