// detect.js — find the animals in a wildlife photo with OWLv2.
//
// OWLv2 (bro.vision.loadOwlv2, google/owlv2-base-patch16-ensemble) is an
// open-vocabulary detector: each text query ("a bird", "a squirrel") is a
// class, and every patch of the 960 x 960 input proposes a box with a score
// per query. The app asks for the animals on its species list; the best box
// frames the subject for the classifier, and no box over the threshold is the
// answer "no animal in this frame" (an empty feeder, a branch, the lawn).
//
//   import { loadAnimalDetector, subjectSquare, cropImage } from "/app/detect.js";
//   const detector = loadAnimalDetector({ weightsDir });        // brovisionml-data/owlv2
//   const hits = detector.detect(decoded);                       // [{ box, score, label }]
//   if (hits.length) {
//       const sq = subjectSquare(hits[0].box, decoded.width, decoded.height);
//       const crop = cropImage(decoded, sq);                       // RGBA { width, height, data }
//   }
//
// Images: any { width, height, data|pixels, channels? } with 8-bit RGB or RGBA
// rows (a bro.image.decodeScaled result, ImageData). OWLv2 sees 960 pixels on
// the long side, so a decode to ~1280 loses nothing.

/** The animals the app's species list holds, as OWLv2 queries. */
export const ANIMAL_QUERIES = [
    'a bird', 'a squirrel', 'a chipmunk', 'a rabbit', 'a deer', 'a raccoon', 'a fox',
    'a woodchuck', 'a skunk', 'a beaver', 'a muskrat', 'an otter', 'a mink',
];

/**
 * Default score threshold. Clear animals score 0.3 and up; between 0.1 and
 * 0.3 sit both real ones (a warbler half hidden in leaves, distant geese) and
 * look-alikes (a rock as "a beaver", a stink bug as "a bird"). 0.15 keeps most
 * of the former; frames with nothing in them score under 0.1.
 */
export const DEFAULT_THRESHOLD = 0.15;

/**
 * Square box around `box` ([x, y, w, h] pixels) grown by `margin` on every
 * side, clamped to the w x h frame (a square larger than the frame's short
 * side becomes that side), or null for an empty box.
 */
export function subjectSquare(box, w, h, opts) {
    const margin = opts && opts.margin != null ? opts.margin : 0.15;
    const [bx, by, bw, bh] = box;
    if (!(bw > 0 && bh > 0)) return null;
    const side = Math.min(Math.max(w, h), Math.round(Math.max(bw, bh) * (1 + 2 * margin)));
    const sw = Math.min(side, w), sh = Math.min(side, h);
    const cx = bx + bw / 2, cy = by + bh / 2;
    const x = Math.round(Math.min(Math.max(cx - sw / 2, 0), w - sw));
    const y = Math.round(Math.min(Math.max(cy - sh / 2, 0), h - sh));
    return { x, y, w: sw, h: sh };
}

/** RGBA crop { width, height, data } of `rect` ({ x, y, w, h }) from an image. */
export function cropImage(img, rect) {
    const ch = img.channels || 4;
    let src = img.data || img.pixels;
    if (ch === 3) {
        const rgba = new Uint8Array(img.width * img.height * 4);
        bro.image.rgbToRgba(rgba, src, img.width * img.height, 255);
        src = rgba;
    }
    const out = new Uint8Array(rect.w * rect.h * 4);
    bro.image.cropU8(out, src, { srcW: img.width, srcH: img.height, channels: 4,
                                 x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    return { width: rect.w, height: rect.h, data: out };
}

/**
 * @param {{weightsDir:string, device?:string, queries?:string[]}} opts
 * @returns {{queries:string[], device:string,
 *            detect(img, opts?): Array<{box:number[], score:number, label:string}>,
 *            dispose()}}
 */
export function loadAnimalDetector(opts) {
    const o = opts || {};
    const owl = bro.vision.loadOwlv2(o.weightsDir, o.device ? { device: o.device } : undefined);
    const defaults = o.queries || ANIMAL_QUERIES;
    return {
        queries: defaults,
        get device() { return owl.device; },
        /**
         * Animals in `img`, best first. `label` is the query that scored
         * ("a bird"). opts: queries (default ANIMAL_QUERIES), threshold
         * (DEFAULT_THRESHOLD), nms (0.3), maxDetections (20).
         */
        detect(img, dopts) {
            const d = dopts || {};
            const queries = d.queries || defaults;
            const hits = owl.detect(img, {
                queries,
                threshold: d.threshold == null ? DEFAULT_THRESHOLD : d.threshold,
                nms: d.nms == null ? 0.3 : d.nms,
                maxDetections: d.maxDetections || 20,
            });
            return hits.map((r) => ({ box: r.box, score: r.score, label: r.query }));
        },
        dispose() { owl.dispose(); },
    };
}
