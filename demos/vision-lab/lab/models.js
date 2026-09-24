// Vision Lab — the model registry.
//
// One descriptor per bro.vision model family: its weights location under the
// brovisionml weights root, its loader params (baked in at load; `runtime`
// ones are read per run instead), how to run it, and how to summarise a result
// for the metadata panel. The app shell and the test both drive everything off
// this table; adding a model is one entry.
//
// Loaders are synchronous: bro.vision's loaders take no onReady/onError, so
// load(root, params) returns the model or throws. Inference ops (estimate /
// detect / removeBackground, SAM setImage / segmentEverything) are async via
// opts.onDone(result, info).
//
// The seven dense-map annotators plus BiRefNet share `group: 'annotator'`:
// run(model, image, params, onDone) -> result with `.image` (an ImageBitmap).
// SAM is `group: 'sam'`; its prompt flow lives in lab/sam.js.

const V = () => bro.vision;

/** min / max / mean over a numeric array, skipping NaN / Inf. */
export function floatStats(arr) {
    let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
    for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        sum += v; n++;
    }
    return n ? { min: lo, max: hi, mean: sum / n, n } : { min: 0, max: 0, mean: 0, n: 0 };
}

/** Uint8 class ids -> [{ id, count }] by count, desc (topK optional). */
export function classHistogram(classes, topK) {
    const counts = new Map();
    for (let i = 0; i < classes.length; i++) counts.set(classes[i], (counts.get(classes[i]) || 0) + 1);
    const out = [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
    return topK ? out.slice(0, topK) : out;
}

export const fmtInt = (n) => (n.toLocaleString ? n.toLocaleString() : String(n));

// ADE20K's 150 class names (SegFormer output ids index into this).
const ADE20K = ('wall,building,sky,floor,tree,ceiling,road,bed,windowpane,grass,cabinet,sidewalk,person,earth,' +
    'door,table,mountain,plant,curtain,chair,car,water,painting,sofa,shelf,house,sea,mirror,rug,field,armchair,' +
    'seat,fence,desk,rock,wardrobe,lamp,bathtub,railing,cushion,base,box,column,signboard,chest of drawers,' +
    'counter,sand,sink,skyscraper,fireplace,refrigerator,grandstand,path,stairs,runway,case,pool table,pillow,' +
    'screen door,stairway,river,bridge,bookcase,blind,coffee table,toilet,flower,book,hill,bench,countertop,' +
    'stove,palm,kitchen island,computer,swivel chair,boat,bar,arcade machine,hovel,bus,towel,light,truck,tower,' +
    'chandelier,awning,streetlight,booth,television,airplane,dirt track,apparel,pole,land,bannister,escalator,' +
    'ottoman,bottle,buffet,poster,stage,van,ship,fountain,conveyer belt,canopy,washer,plaything,swimming pool,' +
    'stool,barrel,basket,waterfall,tent,bag,minibike,cradle,oven,ball,food,step,tank,trade name,microwave,pot,' +
    'animal,bicycle,lake,dishwasher,screen,blanket,sculpture,hood,sconce,vase,traffic light,tray,ashcan,fan,' +
    'pier,crt screen,plate,monitor,bulletin board,shower,radiator,glass,clock,flag').split(',');
export const adeName = (id) => ADE20K[id] || 'class ' + id;

// Tiling params shared by HED and Lineart: tile large images and feather-blend
// the per-tile maps (both are local FCNs, so the blend is seamless). Auto-skips
// for images that fit one tile.
const TILING = {
    tile: { label: 'tile (0 = off)', type: 'number', min: 0, max: 2048, step: 64, default: 768, hint: 'tile size; auto for large images' },
    overlap: { label: 'tile overlap', type: 'number', min: 0, max: 512, step: 16, default: 96 },
};
const RESOLUTION = { label: 'detect res', type: 'number', min: 0, max: 2048, step: 64, default: 0,
                     hint: 'detect resolution (0 = native; ignored when tiling)' };

const annotator = (d) => Object.assign({ group: 'annotator', params: {}, probe: d.subdir + '/model.safetensors' }, d);

export const MODELS = [
    {
        id: 'sam', label: 'Segment · SAM', group: 'sam', subdir: 'sam-vit-base', probe: 'sam-vit-base/model.safetensors',
        tagline: 'promptable segmentation (ViT-B)', params: {},
        load: (root, p) => V().loadSam(root + '/sam-vit-base', { variant: 'vit_b', device: p.device }),
    },
    annotator({
        id: 'depth', label: 'Depth · Depth-Anything-V2', subdir: 'Depth-Anything-V2-Small', tagline: 'monocular relative depth',
        params: { invert: { label: 'invert (far = bright)', type: 'bool', default: false, runtime: true } },
        load: (root, p) => V().loadDepth(root + '/Depth-Anything-V2-Small', { variant: 'small', device: p.device }),
        run: (m, img, p, onDone) => m.estimate(img, { invert: !!p.invert, onDone }),
        metadata: (r) => [['depth range', r.min.toFixed(3) + ' … ' + r.max.toFixed(3)], ['depth samples', fmtInt(r.depth.length)]],
    }),
    annotator({
        id: 'normal', label: 'Normals · DSINE', subdir: 'dsine', tagline: 'per-pixel surface normals (camera space)',
        params: {
            fov: { label: 'field of view', type: 'number', min: 20, max: 120, step: 1, default: 60 },
            // DSINE has no internal cap: downscale above this (0 = native) as the OOM guard.
            maxResolution: { label: 'max res (0 = native)', type: 'number', min: 0, max: 4096, step: 128, default: 1536 },
        },
        load: (root, p) => V().loadNormal(root + '/dsine', { fov: p.fov || 60, maxResolution: p.maxResolution || 0, device: p.device }),
        run: (m, img, p, onDone) => m.estimate(img, { onDone }),
        metadata: (r) => {
            const s = floatStats(r.normals);
            return [['normals', fmtInt(r.normals.length) + ' (3·h·w planar)'], ['component range', s.min.toFixed(2) + ' … ' + s.max.toFixed(2)]];
        },
    }),
    annotator({
        id: 'hed', label: 'Soft edges · HED', subdir: 'hed', tagline: 'holistically-nested edge detection',
        params: { resolution: RESOLUTION, ...TILING },
        load: (root, p) => V().loadHed(root + '/hed', { resolution: p.resolution || 0, tile: p.tile || 0, overlap: p.overlap || 0, device: p.device }),
        run: (m, img, p, onDone) => m.detect(img, { onDone }),
        metadata: (r) => [['edge strength (mean)', floatStats(r.edge).mean.toFixed(3)], ['edge map', fmtInt(r.edge.length) + ' px']],
    }),
    annotator({
        id: 'lineart', label: 'Lineart', subdir: 'lineart', tagline: 'clean line drawing (ControlNet convention)',
        params: { invert: { label: 'invert (bright lines)', type: 'bool', default: true }, resolution: RESOLUTION, ...TILING },
        load: (root, p) => V().loadLineart(root + '/lineart', { invert: p.invert !== false, resolution: p.resolution || 0,
                                                                tile: p.tile || 0, overlap: p.overlap || 0, device: p.device }),
        run: (m, img, p, onDone) => m.detect(img, { onDone }),
        metadata: (r) => [['line intensity (mean)', floatStats(r.line).mean.toFixed(3)], ['line map', fmtInt(r.line.length) + ' px']],
    }),
    annotator({
        id: 'mlsd', label: 'Straight lines · MLSD', subdir: 'mlsd', tagline: 'mobile line-segment detection', vectors: 'mlsd',
        params: {
            scoreThr: { label: 'score thr', min: 0, max: 1, step: 0.01, default: 0.1 },
            distThr: { label: 'distance thr', min: 0, max: 1, step: 0.01, default: 0.1 },
        },
        load: (root, p) => V().loadMlsd(root + '/mlsd', { scoreThr: p.scoreThr, distThr: p.distThr, device: p.device }),
        run: (m, img, p, onDone) => m.detect(img, { onDone }),
        metadata: (r) => [['line segments', fmtInt(r.segments.length)]],
    }),
    annotator({
        id: 'openpose', label: 'Body pose · OpenPose', subdir: 'openpose', tagline: 'COCO-18 body keypoints', vectors: 'pose',
        params: { resolution: { label: 'detect res', type: 'number', min: 128, max: 1024, step: 64, default: 512 } },
        load: (root, p) => V().loadOpenpose(root + '/openpose', { resolution: p.resolution || 512, device: p.device }),
        run: (m, img, p, onDone) => m.detect(img, { onDone }),
        metadata: (r) => {
            let present = 0;
            for (const b of r.bodies) for (const k of b.keypoints) if (k.present) present++;
            return [['bodies', fmtInt(r.bodies.length)], ['keypoints present', fmtInt(present)]];
        },
    }),
    annotator({
        id: 'segformer', label: 'Semantic seg · SegFormer', subdir: 'segformer-b0-ade', tagline: 'ADE20K 150-class segmentation',
        load: (root, p) => V().loadSegformer(root + '/segformer-b0-ade', { device: p.device }),
        run: (m, img, p, onDone) => m.detect(img, { onDone }),
        metadata: (r) => {
            const total = r.classes.length;
            return [['classes present', fmtInt(classHistogram(r.classes).length)],
                    ...classHistogram(r.classes, 4).map((c) => [adeName(c.id), (100 * c.count / total).toFixed(1) + '%'])];
        },
    }),
    annotator({
        // A safetensors FILE, the same checkpoint triposplat uses as its matting front end.
        id: 'rembg', label: 'Background removal · BiRefNet', subdir: 'triposplat/background_removal',
        probe: 'triposplat/background_removal/birefnet.safetensors', tagline: 'Swin-L matte → transparent cutout',
        params: { modelSize: { label: 'model size', type: 'number', min: 256, max: 1024, step: 64, default: 1024 } },
        load: (root, p) => V().loadBirefnet(root + '/triposplat/background_removal/birefnet.safetensors',
                                            { modelSize: p.modelSize || 1024, device: p.device }),
        run: (m, img, p, onDone) => m.removeBackground(img, { onDone }),
        metadata: (r) => {
            let fg = 0;
            for (let i = 0; i < r.alpha.length; i++) if (r.alpha[i] > 0.5) fg++;
            return [['foreground', (100 * fg / r.alpha.length).toFixed(1) + '%'], ['matte', r.width + '×' + r.height]];
        },
    }),
];

export const byId = (id) => MODELS.find((m) => m.id === id);
export const ANNOTATORS = MODELS.filter((m) => m.group === 'annotator');

/** Default param values of a model: { key: default }. */
export function defaults(m) {
    const p = {};
    for (const k in m.params) p[k] = m.params[k].default;
    return p;
}

/** Weights candidates for kit/weights.js (the root holds every model). */
export const VISION_ROOT = ['brovisionml/weights'];
