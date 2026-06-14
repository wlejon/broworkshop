// Vision Lab — the model registry.
//
// One descriptor per bro.vision model family. Each knows its weights subdir,
// how to load (sync or async via opts.onReady/onError), its tunable params, how
// to run inference (sync or async via opts.onDone), and how to summarise a
// result for the metadata panel. Adding a model is one new entry here — the app
// shell and the smoke test both drive everything off this table.
//
// The seven dense-map annotators (depth, normals, hed, lineart, mlsd, openpose,
// segformer) share the `group: 'annotator'` shape: run(model, image, params,
// opts) -> { image: ImageBitmap, ...raw }. SAM is `group: 'sam'` — its two-phase
// setImage/segment/segmentEverything flow lives in lab/sam.js — so it has a
// loader and availability entry here but no generic run().
import { Util } from "/app/lab/util.js";

  var V = function () { return window.bro && bro.vision; };
  var U = function () { return Util; };

  function path(root, subdir) { return root + '/' + subdir; }

  // Split the async callbacks out of an opts object so a descriptor can forward
  // them to the binding (onReady/onError for loaders, onDone for inference).
  function loaderOpts(base, opts) {
    var o = {};
    for (var k in base) if (base.hasOwnProperty(k)) o[k] = base[k];
    if (opts && opts.onReady) o.onReady = opts.onReady;
    if (opts && opts.onError) o.onError = opts.onError;
    return o;
  }
  function runOpts(base, opts) {
    var o = {};
    for (var k in base) if (base.hasOwnProperty(k)) o[k] = base[k];
    if (opts && opts.onDone) o.onDone = opts.onDone;
    return o;
  }

  // ── ADE20K 150 class names (SegFormer output ids index into this) ──────────
  var ADE20K = [
    'wall','building','sky','floor','tree','ceiling','road','bed','windowpane',
    'grass','cabinet','sidewalk','person','earth','door','table','mountain',
    'plant','curtain','chair','car','water','painting','sofa','shelf','house',
    'sea','mirror','rug','field','armchair','seat','fence','desk','rock',
    'wardrobe','lamp','bathtub','railing','cushion','base','box','column',
    'signboard','chest of drawers','counter','sand','sink','skyscraper',
    'fireplace','refrigerator','grandstand','path','stairs','runway','case',
    'pool table','pillow','screen door','stairway','river','bridge','bookcase',
    'blind','coffee table','toilet','flower','book','hill','bench','countertop',
    'stove','palm','kitchen island','computer','swivel chair','boat','bar',
    'arcade machine','hovel','bus','towel','light','truck','tower','chandelier',
    'awning','streetlight','booth','television','airplane','dirt track',
    'apparel','pole','land','bannister','escalator','ottoman','bottle','buffet',
    'poster','stage','van','ship','fountain','conveyer belt','canopy','washer',
    'plaything','swimming pool','stool','barrel','basket','waterfall','tent',
    'bag','minibike','cradle','oven','ball','food','step','tank','trade name',
    'microwave','pot','animal','bicycle','lake','dishwasher','screen','blanket',
    'sculpture','hood','sconce','vase','traffic light','tray','ashcan','fan',
    'pier','crt screen','plate','monitor','bulletin board','shower','radiator',
    'glass','clock','flag',
  ];
  function adeName(id) { return ADE20K[id] || ('class ' + id); }

  // ── Depth-Anything-V2 ──────────────────────────────────────────────────────
  var depth = {
    id: 'depth', label: 'Depth · Depth-Anything-V2', group: 'annotator',
    subdir: 'Depth-Anything-V2-Small', tagline: 'monocular relative depth',
    params: [
      // `runtime` — read at estimate() time, so toggling it re-runs without a
      // reload (every other annotator param is baked into the loader).
      { key: 'invert', label: 'Invert (far = bright)', type: 'check',
        default: false, runtime: true },
    ],
    load: function (root, p, opts) {
      return V().loadDepth(path(root, this.subdir),
        loaderOpts({ variant: 'small', device: p.device }, opts));
    },
    run: function (m, image, p, opts) {
      return m.estimate(image, runOpts({ invert: !!p.invert }, opts));
    },
    metadata: function (r) {
      return [['depth range', r.min.toFixed(3) + ' … ' + r.max.toFixed(3)],
              ['depth samples', U().fmtInt(r.depth.length)]];
    },
  };

  // ── DSINE surface normals ──────────────────────────────────────────────────
  var normal = {
    id: 'normal', label: 'Normals · DSINE', group: 'annotator',
    subdir: 'dsine', tagline: 'per-pixel surface normals (camera space)',
    params: [
      { key: 'fov', label: 'Field of view (deg)', type: 'number',
        min: 20, max: 120, step: 1, default: 60 },
      // DSINE runs at native resolution with no internal cap — the OOM guard for
      // large images. Conditioned on global intrinsics, so it caps (downscales)
      // rather than tiles; only bites when the longer side exceeds the cap.
      { key: 'maxResolution', label: 'Max resolution (0 = native)', type: 'number',
        min: 0, max: 4096, step: 128, default: 1536 },
    ],
    load: function (root, p, opts) {
      return V().loadNormal(path(root, this.subdir),
        loaderOpts({ fov: p.fov || 60,
                     maxResolution: p.maxResolution || 0,
                     device: p.device }, opts));
    },
    run: function (m, image, p, opts) {
      // fov was baked at load; estimate accepts explicit intrinsics — left to
      // the synthesized pinhole here.
      return m.estimate(image, runOpts({}, opts));
    },
    metadata: function (r) {
      var s = U().floatStats(r.normals);
      return [['normals', U().fmtInt(r.normals.length) + ' (3·h·w planar)'],
              ['component range', s.min.toFixed(2) + ' … ' + s.max.toFixed(2)]];
    },
  };

  // ── HED soft edges ──────────────────────────────────────────────────────────
  var hed = {
    id: 'hed', label: 'Soft edges · HED', group: 'annotator',
    subdir: 'hed', tagline: 'holistically-nested edge detection',
    params: [
      { key: 'resolution', label: 'Detect resolution (0 = native; ignored when tiling)',
        type: 'number', min: 0, max: 2048, step: 64, default: 0 },
      // Tile large images and feather-blend the per-tile edge maps (HED is a
      // local FCN, so the blend is seamless). Auto-skips for images that fit one
      // tile, so small inputs run whole-image exactly as before.
      { key: 'tile', label: 'Tile size (0 = off; auto for large)', type: 'number',
        min: 0, max: 2048, step: 64, default: 768 },
      { key: 'overlap', label: 'Tile overlap (px)', type: 'number',
        min: 0, max: 512, step: 16, default: 96 },
    ],
    load: function (root, p, opts) {
      return V().loadHed(path(root, this.subdir),
        loaderOpts({ resolution: p.resolution || 0,
                     tile: p.tile || 0, overlap: p.overlap || 0,
                     device: p.device }, opts));
    },
    run: function (m, image, p, opts) { return m.detect(image, runOpts({}, opts)); },
    metadata: function (r) {
      var s = U().floatStats(r.edge);
      return [['edge strength (mean)', s.mean.toFixed(3)],
              ['edge map', U().fmtInt(r.edge.length) + ' px']];
    },
  };

  // ── Lineart ─────────────────────────────────────────────────────────────────
  var lineart = {
    id: 'lineart', label: 'Lineart', group: 'annotator',
    subdir: 'lineart', tagline: 'clean line drawing (ControlNet convention)',
    params: [
      { key: 'invert', label: 'Invert (bright lines on dark)', type: 'check', default: true },
      { key: 'resolution', label: 'Detect resolution (0 = native; ignored when tiling)',
        type: 'number', min: 0, max: 2048, step: 64, default: 0 },
      // Tile large images and feather-blend the per-tile line maps (the generator
      // is a local FCN; invert commutes with the blend). Auto-skips for small inputs.
      { key: 'tile', label: 'Tile size (0 = off; auto for large)', type: 'number',
        min: 0, max: 2048, step: 64, default: 768 },
      { key: 'overlap', label: 'Tile overlap (px)', type: 'number',
        min: 0, max: 512, step: 16, default: 96 },
    ],
    load: function (root, p, opts) {
      return V().loadLineart(path(root, this.subdir),
        loaderOpts({ invert: p.invert !== false, resolution: p.resolution || 0,
                     tile: p.tile || 0, overlap: p.overlap || 0,
                     device: p.device }, opts));
    },
    run: function (m, image, p, opts) { return m.detect(image, runOpts({}, opts)); },
    metadata: function (r) {
      var s = U().floatStats(r.line);
      return [['line intensity (mean)', s.mean.toFixed(3)],
              ['line map', U().fmtInt(r.line.length) + ' px']];
    },
  };

  // ── MLSD straight lines ─────────────────────────────────────────────────────
  var mlsd = {
    id: 'mlsd', label: 'Straight lines · MLSD', group: 'annotator',
    subdir: 'mlsd', tagline: 'mobile line-segment detection', hasVectors: true,
    params: [
      { key: 'scoreThr', label: 'Score threshold', type: 'range',
        min: 0, max: 1, step: 0.01, default: 0.1 },
      { key: 'distThr', label: 'Distance threshold', type: 'range',
        min: 0, max: 1, step: 0.01, default: 0.1 },
    ],
    load: function (root, p, opts) {
      return V().loadMlsd(path(root, this.subdir),
        loaderOpts({ scoreThr: p.scoreThr != null ? p.scoreThr : 0.1,
                     distThr: p.distThr != null ? p.distThr : 0.1,
                     device: p.device }, opts));
    },
    run: function (m, image, p, opts) { return m.detect(image, runOpts({}, opts)); },
    metadata: function (r) {
      return [['line segments', U().fmtInt(r.segments.length)]];
    },
  };

  // ── OpenPose body pose ──────────────────────────────────────────────────────
  var openpose = {
    id: 'openpose', label: 'Body pose · OpenPose', group: 'annotator',
    subdir: 'openpose', tagline: 'COCO-18 body keypoints', hasVectors: true,
    params: [
      { key: 'resolution', label: 'Detect resolution', type: 'number',
        min: 128, max: 1024, step: 64, default: 512 },
    ],
    load: function (root, p, opts) {
      return V().loadOpenpose(path(root, this.subdir),
        loaderOpts({ resolution: p.resolution || 512, device: p.device }, opts));
    },
    run: function (m, image, p, opts) { return m.detect(image, runOpts({}, opts)); },
    metadata: function (r) {
      var present = 0;
      for (var i = 0; i < r.bodies.length; i++) {
        var kp = r.bodies[i].keypoints;
        for (var j = 0; j < kp.length; j++) if (kp[j].present) present++;
      }
      return [['bodies', U().fmtInt(r.bodies.length)],
              ['keypoints present', U().fmtInt(present)]];
    },
  };

  // ── SegFormer semantic segmentation ─────────────────────────────────────────
  var segformer = {
    id: 'segformer', label: 'Semantic seg · SegFormer', group: 'annotator',
    subdir: 'segformer-b0-ade', tagline: 'ADE20K 150-class segmentation',
    params: [],
    load: function (root, p, opts) {
      return V().loadSegformer(path(root, this.subdir),
        loaderOpts({ device: p.device }, opts));
    },
    run: function (m, image, p, opts) { return m.detect(image, runOpts({}, opts)); },
    metadata: function (r) {
      var hist = U().classHistogram(r.classes, 4);
      var rows = [['classes present', U().fmtInt(
        U().classHistogram(r.classes).length)]];
      var total = r.classes.length;
      for (var i = 0; i < hist.length; i++) {
        var pct = (100 * hist[i].count / total).toFixed(1);
        rows.push([adeName(hist[i].id), pct + '%']);
      }
      return rows;
    },
  };

  // ── BiRefNet background removal ─────────────────────────────────────────────
  var rembg = {
    id: 'rembg', label: 'Background removal · BiRefNet', group: 'annotator',
    // A safetensors FILE, not a weights dir — the same checkpoint the
    // triposplat demo consumes as its matting front-end.
    subdir: 'triposplat/background_removal/birefnet.safetensors',
    probe: 'triposplat/background_removal/birefnet.safetensors',
    tagline: 'Swin-L matte → transparent cutout',
    params: [
      { key: 'modelSize', label: 'Model size', type: 'number',
        min: 256, max: 1024, step: 64, default: 1024 },
    ],
    load: function (root, p, opts) {
      return V().loadBirefnet(path(root, this.subdir),
        loaderOpts({ modelSize: p.modelSize || 1024, device: p.device }, opts));
    },
    run: function (m, image, p, opts) {
      return m.removeBackground(image, runOpts({}, opts));
    },
    metadata: function (r) {
      var fg = 0;
      for (var i = 0; i < r.alpha.length; i++) if (r.alpha[i] > 0.5) fg++;
      return [['foreground', (100 * fg / r.alpha.length).toFixed(1) + '%'],
              ['matte', r.width + '×' + r.height]];
    },
  };

  // ── SAM (loader + availability only; flow lives in lab/sam.js) ───────────────
  var sam = {
    id: 'sam', label: 'Segment · SAM', group: 'sam',
    subdir: 'sam-vit-base', tagline: 'promptable segmentation', variant: 'vit_b',
    params: [],
    load: function (root, p, opts) {
      return V().loadSam(path(root, this.subdir),
        loaderOpts({ variant: this.variant, device: p.device }, opts));
    },
  };

  var ALL = [sam, depth, normal, hed, lineart, mlsd, openpose, segformer, rembg];
  var BY_ID = {};
  ALL.forEach(function (m) { BY_ID[m.id] = m; });
  // Annotators in contact-sheet / "run all" order.
  var ANNOTATORS = ALL.filter(function (m) { return m.group === 'annotator'; });

  export const Models = {
    all: ALL,
    annotators: ANNOTATORS,
    byId: function (id) { return BY_ID[id]; },
    adeName: adeName,
  };
