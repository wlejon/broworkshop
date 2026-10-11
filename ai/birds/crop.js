// crop.js — frame the subject of a wildlife photo for the species classifier.
//
// A bird is often a small part of the frame, and CLIP sees 224 x 224 pixels,
// so classifying the whole photo mostly classifies the branch. Until a
// detector exists this finds the subject with BiRefNet's salient-object
// matte (bro.vision.loadBirefnet): the box around the matte's confident
// pixels, grown by a margin and squared so the classifier's centre crop keeps
// all of it. A matte with nothing confident in it, or only specks, falls back
// to the whole frame (species.js then takes the centre square).
//
//   import { loadSubjectCropper } from "/app/crop.js";
//   const cropper = loadSubjectCropper({ weightsPath });   // birefnet.safetensors
//   const { image, box, method } = cropper.crop(decoded);  // method 'saliency' | 'full'

/** Square box around `alpha` > `threshold`, grown by `margin`, or null. */
export function subjectBox(alpha, w, h, opts) {
    const o = opts || {};
    const thr = o.threshold == null ? 0.5 : o.threshold;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, count = 0;
    for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
            if (alpha[row + x] > thr) {
                count++;
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }
    // Specks are not a subject: below minArea of the frame, trust nothing.
    if (x1 < 0 || count < (o.minArea == null ? 0.002 : o.minArea) * w * h) return null;
    const margin = o.margin == null ? 0.15 : o.margin;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const side = Math.min(Math.max(w, h), Math.round(Math.max(bw, bh) * (1 + 2 * margin)));
    const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
    const sw = Math.min(side, w), sh = Math.min(side, h);
    const x = Math.round(Math.min(Math.max(cx - sw / 2, 0), w - sw));
    const y = Math.round(Math.min(Math.max(cy - sh / 2, 0), h - sh));
    return { x, y, w: sw, h: sh, coverage: count / (w * h) };
}

function toRgba(img) {
    const ch = img.channels || 4;
    const src = img.data || img.pixels;
    if (ch === 4) return src;
    const rgba = new Uint8Array(img.width * img.height * 4);
    bro.image.rgbToRgba(rgba, src, img.width * img.height, 255);
    return rgba;
}

/**
 * @param {{weightsPath:string, modelSize?:number, device?:string}} opts
 * @returns {{crop(img, opts?): {image, box, method}, dispose()}}
 */
export function loadSubjectCropper(opts) {
    const o = opts || {};
    const net = bro.vision.loadBirefnet(o.weightsPath,
        { device: o.device || 'gpu', modelSize: o.modelSize || 1024 });
    return {
        crop(img, copts) {
            const data = toRgba(img);
            const w = img.width, h = img.height;
            const frame = { width: w, height: h, data };
            const cut = net.removeBackground(frame);
            const box = subjectBox(cut.alpha, cut.width, cut.height, copts);
            if (!box) return { image: frame, box: { x: 0, y: 0, w, h }, method: 'full' };
            // The matte comes back at the input size; scale in case it is not.
            const sx = w / cut.width, sy = h / cut.height;
            const b = { x: Math.round(box.x * sx), y: Math.round(box.y * sy),
                        w: Math.round(box.w * sx), h: Math.round(box.h * sy) };
            const out = new Uint8Array(b.w * b.h * 4);
            bro.image.cropU8(out, data, { srcW: w, srcH: h, channels: 4, x: b.x, y: b.y, w: b.w, h: b.h });
            return { image: { width: b.w, height: b.h, data: out },
                     box: Object.assign(b, { coverage: box.coverage }), method: 'saliency' };
        },
        dispose() { net.dispose(); },
    };
}
