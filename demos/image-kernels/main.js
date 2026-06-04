// Image Kernels — the definitive showcase of bro.image's composable typed-array
// kernels. The whole model: six verbs operate on whole TypedArray buffers from
// C++ (JS never enters the per-pixel loop), op behaviour is a small struct, and
// every buffer is caller-allocated and reused across frames.
//
// This demo runs a configurable PIPELINE over a live scalar field:
//
//   source → [ map | combine | stencil | resample ]* → reduce → lookup/gpu.colormap
//
// where each bro.image verb is a visible, toggleable stage. Every verb + both
// builders + the GPU path is exercised live:
//
//   bro.image.alloc      — every reusable buffer (field, ping/pong, second src)
//   bro.image.reduce     — minmax (auto range) / mean / sum / histogram (chart)
//   bro.image.map        — affine / abs / log / sqrt / exp / pow stage
//   bro.image.combine    — blend the field with a second source (add..wsum)
//   bro.image.stencil    — box / gaussian / sobelX / sobelY / edge-mag / sharpen / emboss
//   bro.image.resample   — downsample→upsample (nearest vs bilinear) recipe
//   bro.image.gradient   — six built-in LUTs incl. stepped/threshold/cyclic
//   bro.image.lookup     — CPU colorize into ImageData.data (+ histogram-eq LUT)
//   bro.image.gpu.colormap / fbm2D — GPU colorize, autoRange, viewRect scroll
//
// The /lib helpers only mount under the workshop project root; this demo stands
// alone, so everything is self-contained vanilla JS.

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const cpuCanvas = document.querySelector('#cpu');
const gpuCanvas = document.querySelector('#gpu');
const histCanvas = document.querySelector('#hist');
const cpuCtx = cpuCanvas.getContext('2d');
const histCtx = histCanvas.getContext('2d');
let gl = null;   // webgl2 context for gpuCanvas, lazily created

const elSource    = document.querySelector('#source');
const elFieldSize = document.querySelector('#fieldSize');
const elGradient  = document.querySelector('#gradientSel');
const elRangeMode = document.querySelector('#rangeMode');
const elLoWrap = document.querySelector('#loWrap');
const elHiWrap = document.querySelector('#hiWrap');
const elLo = document.querySelector('#lo'), elHi = document.querySelector('#hi');
const elLoVal = document.querySelector('#loVal'), elHiVal = document.querySelector('#hiVal');
const elRenderer = document.querySelector('#renderer');
const elAnimate  = document.querySelector('#animate');
const elPipeline = document.querySelector('#pipeline');

const hud = {
  fps:    document.querySelector('#fps'),
  csize:  document.querySelector('#csize'),
  fsize:  document.querySelector('#fsize'),
  rmode:  document.querySelector('#rmode'),
  tcolor: document.querySelector('#tcolor'),
  tpipe:  document.querySelector('#tpipe'),
  tcpu:   document.querySelector('#tcpu'),
  tgpu:   document.querySelector('#tgpu'),
  rmin:   document.querySelector('#rmin'),
  rmax:   document.querySelector('#rmax'),
  rmean:  document.querySelector('#rmean'),
  rsum:   document.querySelector('#rsum'),
};

// ---------------------------------------------------------------------------
// Gradients (bro.image.gradient builders). The LUT *shape* alone does the
// posterize/threshold work — lookup() is the same call every time.
// ---------------------------------------------------------------------------
function buildGradient(name, n = 256) {
  switch (name) {
    case 'gray':
      return bro.image.gradient([[0, 0, 0, 0], [1, 255, 255, 255]], n);
    case 'viridis':
      return bro.image.gradient([
        [0.00,  68,   1,  84],
        [0.25,  59,  82, 139],
        [0.50,  33, 145, 140],
        [0.75,  94, 201,  98],
        [1.00, 253, 231,  37],
      ], n);
    case 'magma':
      return bro.image.gradient([
        [0.00,   0,   0,   4],
        [0.25,  80,  18, 123],
        [0.50, 182,  54, 121],
        [0.75, 251, 136,  97],
        [1.00, 252, 253, 191],
      ], n);
    case 'posterize': {
      // 8 hard steps — a stepped LUT posterizes via lookup() alone.
      const stops = [];
      const STEPS = 8;
      for (let i = 0; i < STEPS; i++) {
        const t0 = i / STEPS, t1 = (i + 1) / STEPS;
        const v = Math.round((i / (STEPS - 1)) * 255);
        // duplicate t at each band edge → a flat plateau (no interpolation).
        stops.push([t0, v, v, v]);
        stops.push([t1 - 1e-4, v, v, v]);
      }
      return bro.image.gradient(stops, n);
    }
    case 'threshold':
      // Doc recipe: a step at 0.5 black→white. Pure binarize via LUT shape.
      return bro.image.gradient([
        [0.0,   8,  12,  24], [0.5,   8,  12,  24],
        [0.5, 120, 230, 170], [1.0, 235, 255, 245],
      ], n);
    case 'cyclic':
      // First == last colour so 'wrap' edge mode tiles seamlessly.
      return bro.image.gradient([
        [0.00,  30,  30,  60],
        [0.25, 220,  90,  90],
        [0.50, 240, 230, 120],
        [0.75,  90, 200, 140],
        [1.00,  30,  30,  60],
      ], n);
  }
  return bro.image.gradient([[0, 0, 0, 0], [1, 255, 255, 255]], n);
}

// ---------------------------------------------------------------------------
// Stencil kernels (bro.image.stencil presets). divisor/bias chosen so each
// kernel produces a sensible field to colorize.
// ---------------------------------------------------------------------------
const STENCILS = {
  box:     { data: new Float32Array(9).fill(1), w: 3, h: 3, divisor: 9, bias: 0, label: 'box blur' },
  gaussian:{ data: new Float32Array([1,2,1, 2,4,2, 1,2,1]), w: 3, h: 3, divisor: 16, bias: 0, label: 'gaussian 3×3' },
  sobelX:  { data: new Float32Array([-1,0,1, -2,0,2, -1,0,1]), w: 3, h: 3, divisor: 1, bias: 0, label: 'sobel X' },
  sobelY:  { data: new Float32Array([-1,-2,-1, 0,0,0, 1,2,1]), w: 3, h: 3, divisor: 1, bias: 0, label: 'sobel Y' },
  sharpen: { data: new Float32Array([0,-1,0, -1,5,-1, 0,-1,0]), w: 3, h: 3, divisor: 1, bias: 0, label: 'sharpen' },
  emboss:  { data: new Float32Array([-2,-1,0, -1,1,1, 0,1,2]), w: 3, h: 3, divisor: 1, bias: 0, label: 'emboss' },
  // 'edgemag' is special-cased (sqrt(sx²+sy²)); handled in runStencil.
};
function kernelMatrixText(k) {
  if (!k) return '';
  let s = '';
  for (let y = 0; y < k.h; y++) {
    const row = [];
    for (let x = 0; x < k.w; x++) row.push(String(k.data[y * k.w + x]).padStart(3));
    s += row.join(' ');
    if (y < k.h - 1) s += '\n';
  }
  s += `\n÷${k.divisor}`;
  return s;
}

// ---------------------------------------------------------------------------
// Pipeline model. Each stage carries an enabled flag + its config; main.js
// renders a card per stage and applies them in order to a ping-pong buffer.
// ---------------------------------------------------------------------------
const pipeline = [
  { id: 'map',      verb: 'bro.image.map',      name: 'map',      on: false,
    cfg: { op: 'affine', a: 1, b: 0, exp: 2.2 }, ms: 0 },
  { id: 'combine',  verb: 'bro.image.combine',  name: 'combine',  on: false,
    cfg: { op: 'lerp', src2: 'radial', t: 0.5, wa: 1, wb: 1 }, ms: 0 },
  { id: 'stencil',  verb: 'bro.image.stencil',  name: 'stencil',  on: false,
    cfg: { kernel: 'gaussian', edge: 'clamp' }, ms: 0 },
  { id: 'resample', verb: 'bro.image.resample', name: 'resample', on: false,
    cfg: { factor: 4, filter: 'nearest' }, ms: 0 },
  { id: 'histeq',   verb: 'bro.image.reduce → lookup', name: 'histogram-eq', on: false,
    cfg: {}, ms: 0 },
];

// ---------------------------------------------------------------------------
// Buffers — all bro.image.alloc, reused across frames. Sized to fieldW*fieldH.
// ---------------------------------------------------------------------------
let fieldW = 0, fieldH = 0;
let bufA = null, bufB = null;     // ping-pong for the pipeline
let field = null;                  // the source field (== bufA after fill)
let src2 = null;                   // second source for combine
let loBuf = null, hiBuf = null;    // resample scratch (low-res, full-res)
let edgeBuf = null;                // edge-magnitude scratch (2nd sobel pass)
let resampLoW = 0, resampLoH = 0;
let imgData = null;                // CPU lookup target
let eqLut = null;                  // histogram-eq LUT (built each frame when active)

function allocBuffers(w, h) {
  fieldW = w; fieldH = h;
  bufA = bro.image.alloc(w, h, 1);
  bufB = bro.image.alloc(w, h, 1);
  src2 = bro.image.alloc(w, h, 1);
  hiBuf = bro.image.alloc(w, h, 1);
  edgeBuf = null;   // re-alloc on first edgemag use at this size
  loBuf = null; resampLoW = 0; resampLoH = 0;
  eqLut = new Uint8Array(256 * 4);
  imgData = null;   // rebuilt on first CPU draw at the right canvas size
}

// ---------------------------------------------------------------------------
// Source fields. Procedural so the demo stays self-contained (no new assets).
// ---------------------------------------------------------------------------
let simplexNode = FastNoise.create('Simplex');
let fbmNode = FastNoise.create('FractalFBm');
fbmNode.set('Source', FastNoise.create('Simplex'));
fbmNode.set('Octaves', 6);
fbmNode.set('Gain', 0.5);
fbmNode.set('Lacunarity', 2.0);

let animTime = 0;

function fillSource(dst, kind, w, h, t) {
  if (kind === 'fbm') {
    fbmNode.genUniformGrid2DInto(dst, t * 12, 0, w, h, 0.012, 1337);
  } else if (kind === 'simplex') {
    simplexNode.genUniformGrid2DInto(dst, t * 12, 0, w, h, 0.02, 7);
  } else if (kind === 'radial') {
    const cx = w / 2, cy = h / 2, maxR = Math.hypot(cx, cy);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy) / maxR;
      dst[y * w + x] = 0.5 + 0.5 * Math.sin(d * 22 - t * 4);
    }
  } else if (kind === 'gradient') {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      dst[y * w + x] = (x / (w - 1)) * 0.5 + (y / (h - 1)) * 0.5;
  } else if (kind === 'checker') {
    const cell = Math.max(4, (w / 16) | 0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = ((x / cell | 0) + (y / cell | 0)) & 1;
      dst[y * w + x] = c ? (x / (w - 1)) : (1 - x / (w - 1));
    }
  }
}

// ---------------------------------------------------------------------------
// Pipeline application. Walks enabled stages, ping-ponging bufA↔bufB; returns
// the buffer holding the final field. Each stage times itself.
// ---------------------------------------------------------------------------
let curRange = { min: 0, max: 1 };   // exposed for the GPU colorize + HUD

function runMap(stage, src, dst) {
  const c = stage.cfg;
  let spec;
  if (c.op === 'affine') spec = { op: 'affine', a: c.a, b: c.b };
  else if (c.op === 'pow') spec = { op: 'pow', exp: c.exp };
  else spec = { op: c.op };
  bro.image.map(dst, src, spec);
  return dst;
}

function runCombine(stage, src, dst) {
  const c = stage.cfg;
  // (Re)fill the second source each frame so it can animate too.
  fillSource(src2, c.src2, fieldW, fieldH, animTime * 0.5 + 3.0);
  let spec;
  if (c.op === 'lerp') spec = { op: 'lerp', t: c.t };
  else if (c.op === 'wsum') spec = { op: 'wsum', wa: c.wa, wb: c.wb };
  else spec = { op: c.op };
  bro.image.combine(dst, src, src2, spec);
  return dst;
}

function runStencil(stage, src, dst) {
  const c = stage.cfg;
  if (c.kernel === 'edgemag') {
    // sqrt(sobelX² + sobelY²): two stencils + combine + map(sqrt). Needs a
    // dedicated scratch (edgeBuf) so neither sobel pass clobbers `src` while
    // the other still needs it.
    if (!edgeBuf || edgeBuf.length !== src.length) edgeBuf = bro.image.alloc(fieldW, fieldH, 1);
    const sx = STENCILS.sobelX, sy = STENCILS.sobelY;
    bro.image.stencil(edgeBuf, src, { data: sx.data, w: 3, h: 3 },
      { srcW: fieldW, srcH: fieldH, edge: c.edge, divisor: sx.divisor });   // gx
    bro.image.stencil(dst, src, { data: sy.data, w: 3, h: 3 },
      { srcW: fieldW, srcH: fieldH, edge: c.edge, divisor: sy.divisor });   // gy
    bro.image.combine(edgeBuf, edgeBuf, edgeBuf, { op: 'mul' });   // gx²
    bro.image.combine(dst, dst, dst, { op: 'mul' });               // gy²
    bro.image.combine(dst, dst, edgeBuf, { op: 'add' });           // gx²+gy²
    bro.image.map(dst, dst, { op: 'sqrt' });                       // magnitude
    return dst;
  }
  const k = STENCILS[c.kernel];
  bro.image.stencil(dst, src, { data: k.data, w: k.w, h: k.h },
    { srcW: fieldW, srcH: fieldH, edge: c.edge, divisor: k.divisor, bias: k.bias });
  return dst;
}

function runResample(stage, src, dst) {
  // Downsample to 1/factor then bilinear/nearest back up — the doc recipe that
  // makes nearest-vs-bilinear visible (blocky vs smooth low-res look).
  const c = stage.cfg;
  const loW = Math.max(2, Math.round(fieldW / c.factor));
  const loH = Math.max(2, Math.round(fieldH / c.factor));
  if (!loBuf || loW !== resampLoW || loH !== resampLoH) {
    loBuf = bro.image.alloc(loW, loH, 1);
    resampLoW = loW; resampLoH = loH;
  }
  bro.image.resample(loBuf, src, { srcW: fieldW, srcH: fieldH, dstW: loW, dstH: loH, channels: 1, filter: 'bilinear' });
  bro.image.resample(dst, loBuf, { srcW: loW, srcH: loH, dstW: fieldW, dstH: fieldH, channels: 1, filter: c.filter });
  return dst;
}

// Build a histogram-equalization LUT (RGBA8) from the field's histogram. The
// classic recipe: CDF of the histogram, normalized, drives a grayscale LUT.
function buildEqLut(src, lo, hi) {
  const BINS = 256;
  const hist = bro.image.reduce(src, 'histogram', { bins: BINS, lo, hi });
  let total = 0;
  for (let i = 0; i < BINS; i++) total += hist[i];
  if (total === 0) total = 1;
  // CDF.
  let cum = 0;
  // find first nonzero cdf for normalization (avoid wasting dynamic range).
  let cdfMin = 0;
  for (let i = 0; i < BINS; i++) { if (hist[i] > 0) { cdfMin = hist[i]; break; } }
  const denom = Math.max(1, total - cdfMin);
  for (let i = 0; i < BINS; i++) {
    cum += hist[i];
    const v = Math.round(((cum - cdfMin) / denom) * 255);
    const cv = v < 0 ? 0 : (v > 255 ? 255 : v);
    eqLut[i * 4] = cv; eqLut[i * 4 + 1] = cv; eqLut[i * 4 + 2] = cv; eqLut[i * 4 + 3] = 255;
  }
  return eqLut;
}

// applyPipeline → returns { buf, eqActive }. eqActive routes colorize through
// the eq LUT instead of the selected gradient.
function applyPipeline() {
  // Source fills bufA.
  let t0 = performance.now();
  fillSource(bufA, elSource.value, fieldW, fieldH, animTime);
  const tSource = performance.now() - t0;

  let src = bufA, dst = bufB;
  let eqActive = false;

  for (const stage of pipeline) {
    if (!stage.on) { stage.ms = 0; continue; }
    const s0 = performance.now();
    if (stage.id === 'map')      src = runMap(stage, src, dst);
    else if (stage.id === 'combine')  src = runCombine(stage, src, dst);
    else if (stage.id === 'stencil')  src = runStencil(stage, src, dst);
    else if (stage.id === 'resample') src = runResample(stage, src, dst);
    else if (stage.id === 'histeq') { eqActive = true; stage.ms = 0; /* applied at colorize */ }
    stage.ms = performance.now() - s0;
    if (stage.id !== 'histeq') dst = (src === bufA) ? bufB : bufA;   // swap
  }

  return { buf: src, eqActive, tSource };
}

// ---------------------------------------------------------------------------
// Colorize — CPU (lookup + putImageData) or GPU (gpu.colormap). Both timed.
// ---------------------------------------------------------------------------
let useGPU = true;
let curLut = buildGradient('viridis');
let gpuTime = 0, cpuTime = 0;
let scrollX = 0;   // GPU viewRect scroll demo

function ensureGL() {
  if (gl) return gl;
  gl = gpuCanvas.getContext('webgl2');
  return gl;
}

function colorizeCPU(buf, eqActive) {
  const cw = cpuCanvas.width, ch = cpuCanvas.height;
  if (!imgData || imgData.width !== cw || imgData.height !== ch)
    imgData = cpuCtx.createImageData(cw, ch);

  // The field is fieldW×fieldH; the canvas is cw×ch. Resample the field to the
  // canvas size (into hiBuf reinterpreted) only if sizes differ — but to keep
  // the hot path a single lookup, we resample the field up to canvas dims.
  let srcBuf = buf, sw = fieldW, sh = fieldH;
  if (cw !== fieldW || ch !== fieldH) {
    if (!colorizeCPU._rs || colorizeCPU._rs.length !== cw * ch)
      colorizeCPU._rs = bro.image.alloc(cw, ch, 1);
    bro.image.resample(colorizeCPU._rs, buf, { srcW: fieldW, srcH: fieldH, dstW: cw, dstH: ch, channels: 1, filter: 'bilinear' });
    srcBuf = colorizeCPU._rs; sw = cw; sh = ch;
  }

  const t0 = performance.now();
  let lut = curLut, edge = (elGradient.value === 'cyclic') ? 'wrap' : 'clamp';
  if (eqActive) { lut = buildEqLut(srcBuf, curRange.min, curRange.max); edge = 'clamp'; }
  bro.image.lookup(imgData.data, srcBuf, lut, { lo: curRange.min, hi: curRange.max, edge });
  cpuCtx.putImageData(imgData, 0, 0);
  cpuTime = performance.now() - t0;
  void sw; void sh;
}

function colorizeGPU(buf, eqActive) {
  ensureGL();
  let lut = curLut;
  if (eqActive) lut = buildEqLut(buf, curRange.min, curRange.max);
  const t0 = performance.now();
  const params = { srcW: fieldW, srcH: fieldH };
  if (elRangeMode.value === 'auto') { params.autoRange = true; params.ema = 0.15; }
  else { params.lo = curRange.min; params.hi = curRange.max; }
  // viewRect scroll: slide a window across the field horizontally so the GPU
  // viewRect path is exercised (wraps when it runs off the right edge).
  const winW = Math.max(8, fieldW - 48);
  const sx = Math.floor((Math.sin(scrollX) * 0.5 + 0.5) * (fieldW - winW));
  params.viewRect = { x: sx, y: 0, w: winW, h: fieldH };
  bro.image.gpu.colormap(gpuCanvas, buf, lut, params);
  // gl.finish() so the timer reflects the actual GPU work, not just submission.
  if (gl) gl.finish();
  gpuTime = performance.now() - t0;
}

// ---------------------------------------------------------------------------
// Histogram chart (reduce('histogram')).
// ---------------------------------------------------------------------------
function drawHistogram(buf) {
  const w = histCanvas.width, h = histCanvas.height;
  histCtx.fillStyle = '#0b0e14';
  histCtx.fillRect(0, 0, w, h);
  const BINS = 96;
  const hist = bro.image.reduce(buf, 'histogram', { bins: BINS, lo: curRange.min, hi: curRange.max });
  let peak = 1;
  for (let i = 0; i < BINS; i++) if (hist[i] > peak) peak = hist[i];
  const bw = w / BINS;
  for (let i = 0; i < BINS; i++) {
    const t = i / (BINS - 1);
    // colour each bar by the active LUT so the histogram reads as "tone map".
    const li = Math.min(255, Math.floor(t * 255)) * 4;
    const r = curLut[li], g = curLut[li + 1], b = curLut[li + 2];
    const barH = Math.pow(hist[i] / peak, 0.6) * (h - 10);
    histCtx.fillStyle = `rgb(${r},${g},${b})`;
    histCtx.fillRect(i * bw, h - barH, Math.max(1, bw - 0.5), barH);
  }
}

// ---------------------------------------------------------------------------
// Pipeline card UI. Built once; values bind back into the model.
// ---------------------------------------------------------------------------
const MAP_OPS = ['affine', 'abs', 'log', 'sqrt', 'exp', 'pow'];
const COMBINE_OPS = ['add', 'sub', 'mul', 'min', 'max', 'lerp', 'wsum'];
const COMBINE_SRC = ['radial', 'gradient', 'simplex', 'checker'];
const STENCIL_KERNELS = ['box', 'gaussian', 'sobelX', 'sobelY', 'edgemag', 'sharpen', 'emboss'];

function opt(v, label, sel) { return `<option value="${v}"${v === sel ? ' selected' : ''}>${label || v}</option>`; }

function buildCards() {
  // clear (keep the h2)
  elPipeline.querySelectorAll('.stage').forEach(n => n.remove());

  for (const stage of pipeline) {
    const card = document.createElement('div');
    card.className = 'stage' + (stage.on ? '' : ' off');
    card.dataset.id = stage.id;

    let body = '';
    if (stage.id === 'map') {
      body = `<label>op <select data-k="op">${MAP_OPS.map(o => opt(o, o, stage.cfg.op)).join('')}</select></label>
        <label class="p-affine">a <input type="range" data-k="a" min="-4" max="4" step="0.1" value="${stage.cfg.a}"> <span data-v="a">${stage.cfg.a}</span></label>
        <label class="p-affine">b <input type="range" data-k="b" min="-1" max="1" step="0.05" value="${stage.cfg.b}"> <span data-v="b">${stage.cfg.b}</span></label>
        <label class="p-pow">exp <input type="range" data-k="exp" min="0.2" max="4" step="0.1" value="${stage.cfg.exp}"> <span data-v="exp">${stage.cfg.exp}</span></label>`;
    } else if (stage.id === 'combine') {
      body = `<label>op <select data-k="op">${COMBINE_OPS.map(o => opt(o, o, stage.cfg.op)).join('')}</select></label>
        <label>2nd src <select data-k="src2">${COMBINE_SRC.map(o => opt(o, o, stage.cfg.src2)).join('')}</select></label>
        <label class="p-lerp">t <input type="range" data-k="t" min="0" max="1" step="0.02" value="${stage.cfg.t}"> <span data-v="t">${stage.cfg.t}</span></label>
        <label class="p-wsum">wa <input type="range" data-k="wa" min="0" max="2" step="0.05" value="${stage.cfg.wa}"> <span data-v="wa">${stage.cfg.wa}</span></label>
        <label class="p-wsum">wb <input type="range" data-k="wb" min="0" max="2" step="0.05" value="${stage.cfg.wb}"> <span data-v="wb">${stage.cfg.wb}</span></label>`;
    } else if (stage.id === 'stencil') {
      body = `<label>kernel <select data-k="kernel">${STENCIL_KERNELS.map(o => opt(o, STENCILS[o] ? STENCILS[o].label : 'edge magnitude', stage.cfg.kernel)).join('')}</select></label>
        <label>edge <select data-k="edge">${['clamp', 'wrap', 'zero'].map(o => opt(o, o, stage.cfg.edge)).join('')}</select></label>
        <div class="kmat" data-kmat></div>`;
    } else if (stage.id === 'resample') {
      body = `<label>factor <select data-k="factor">${[2, 4, 8, 16].map(o => opt(String(o), '1/' + o, String(stage.cfg.factor))).join('')}</select></label>
        <label>filter <select data-k="filter">${['nearest', 'bilinear'].map(o => opt(o, o, stage.cfg.filter)).join('')}</select></label>`;
    } else if (stage.id === 'histeq') {
      body = `<div class="kmat">build eq LUT from reduce('histogram') CDF, then lookup() through it</div>`;
    }

    card.innerHTML = `
      <div class="row head">
        <div><span class="name">${stage.name}</span> <span class="verb">${stage.verb}</span></div>
        <button class="toggle ${stage.on ? 'active' : ''}" data-toggle>${stage.on ? 'on' : 'off'}</button>
      </div>
      <div class="body">${body}</div>
      <div class="row"><span class="verb" data-ms>0.00 ms</span></div>`;

    elPipeline.appendChild(card);
    wireCard(card, stage);
    refreshCardVisibility(card, stage);
  }
}

function wireCard(card, stage) {
  card.querySelector('[data-toggle]').addEventListener('click', () => {
    stage.on = !stage.on;
    card.classList.toggle('off', !stage.on);
    const btn = card.querySelector('[data-toggle]');
    btn.textContent = stage.on ? 'on' : 'off';
    btn.classList.toggle('active', stage.on);
  });
  card.querySelectorAll('[data-k]').forEach(input => {
    const k = input.dataset.k;
    const handler = () => {
      let v = input.value;
      if (input.type === 'range') v = +v;
      else if (k === 'factor') v = +v;
      stage.cfg[k] = v;
      const span = card.querySelector(`[data-v="${k}"]`);
      if (span) span.textContent = (typeof v === 'number') ? v.toFixed(2) : v;
      refreshCardVisibility(card, stage);
    };
    input.addEventListener('input', handler);
    input.addEventListener('change', handler);
  });
}

// Show only the param rows relevant to the chosen op; refresh kernel matrix.
function refreshCardVisibility(card, stage) {
  if (stage.id === 'map') {
    const isAffine = stage.cfg.op === 'affine', isPow = stage.cfg.op === 'pow';
    card.querySelectorAll('.p-affine').forEach(n => n.style.display = isAffine ? '' : 'none');
    card.querySelectorAll('.p-pow').forEach(n => n.style.display = isPow ? '' : 'none');
  } else if (stage.id === 'combine') {
    card.querySelectorAll('.p-lerp').forEach(n => n.style.display = stage.cfg.op === 'lerp' ? '' : 'none');
    card.querySelectorAll('.p-wsum').forEach(n => n.style.display = stage.cfg.op === 'wsum' ? '' : 'none');
  } else if (stage.id === 'stencil') {
    const m = card.querySelector('[data-kmat]');
    if (m) m.textContent = stage.cfg.kernel === 'edgemag'
      ? 'sqrt(sobelX² + sobelY²)\n(2 stencil + map/combine)'
      : kernelMatrixText(STENCILS[stage.cfg.kernel]);
  }
}

// ---------------------------------------------------------------------------
// Controls wiring
// ---------------------------------------------------------------------------
elGradient.addEventListener('change', () => { curLut = buildGradient(elGradient.value); });
elSource.addEventListener('change', () => {});
elFieldSize.addEventListener('change', () => { allocBuffers(+elFieldSize.value, +elFieldSize.value); });
elRangeMode.addEventListener('change', () => {
  const manual = elRangeMode.value === 'manual';
  elLoWrap.style.display = manual ? '' : 'none';
  elHiWrap.style.display = manual ? '' : 'none';
});
elLo.addEventListener('input', () => { elLoVal.textContent = (+elLo.value).toFixed(2); });
elHi.addEventListener('input', () => { elHiVal.textContent = (+elHi.value).toFixed(2); });

let animate = true;
elAnimate.addEventListener('click', () => {
  animate = !animate;
  elAnimate.classList.toggle('active', animate);
});

elRenderer.addEventListener('click', () => {
  useGPU = !useGPU;
  elRenderer.textContent = 'renderer: ' + (useGPU ? 'GPU' : 'CPU');
  cpuCanvas.classList.toggle('hidden', useGPU);
  gpuCanvas.classList.toggle('hidden', !useGPU);
  hud.rmode.textContent = useGPU ? 'GPU' : 'CPU';
});

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------
let lastFps = 0, fpsAccum = 0, fpsCount = 0, fpsT = 0;
let pipeMs = 0, colorMs = 0;
let prev = performance.now();

function frame() {
  const now = performance.now();
  let dt = (now - prev) / 1000; prev = now;
  if (dt > 0.1) dt = 0.1;
  if (animate) { animTime += dt; scrollX += dt * 0.6; }

  // Run the pipeline.
  let p0 = performance.now();
  const { buf, eqActive } = applyPipeline();
  pipeMs = performance.now() - p0;

  // Range: auto (reduce minmax) or manual sliders. The GPU autoRange path
  // computes its own range on-device; we still reduce on CPU for the HUD +
  // histogram + CPU colorize.
  const mm = bro.image.reduce(buf, 'minmax');
  if (elRangeMode.value === 'auto') { curRange.min = mm.min; curRange.max = mm.max; }
  else { curRange.min = +elLo.value; curRange.max = +elHi.value; }
  if (curRange.max - curRange.min < 1e-6) curRange.max = curRange.min + 1e-6;

  const mean = bro.image.reduce(buf, 'mean');
  const sum = bro.image.reduce(buf, 'sum');

  // Colorize.
  let c0 = performance.now();
  if (useGPU) colorizeGPU(buf, eqActive);
  else        colorizeCPU(buf, eqActive);
  colorMs = performance.now() - c0;

  drawHistogram(buf);

  // Stage ms labels.
  const cards = elPipeline.querySelectorAll('.stage');
  cards.forEach(card => {
    const id = card.dataset.id;
    const stage = pipeline.find(s => s.id === id);
    const el = card.querySelector('[data-ms]');
    if (el) el.textContent = (stage.on ? stage.ms.toFixed(2) : '—') + ' ms';
  });

  // HUD.
  fpsAccum += dt; fpsCount++; fpsT += dt;
  if (fpsT >= 0.5) { lastFps = fpsCount / fpsAccum; fpsAccum = 0; fpsCount = 0; fpsT = 0; }
  hud.fps.textContent = lastFps.toFixed(0);
  hud.csize.textContent = `${cpuCanvas.width}×${cpuCanvas.height}`;
  hud.fsize.textContent = `${fieldW}×${fieldH}`;
  hud.tcolor.textContent = colorMs.toFixed(2);
  hud.tpipe.textContent = pipeMs.toFixed(2);
  hud.tcpu.textContent = (cpuTime > 0 ? cpuTime.toFixed(2) + ' ms' : '—');
  hud.tgpu.textContent = (gpuTime > 0 ? gpuTime.toFixed(2) + ' ms' : '—');
  hud.rmin.textContent = curRange.min.toFixed(3);
  hud.rmax.textContent = curRange.max.toFixed(3);
  hud.rmean.textContent = mean.toFixed(3);
  hud.rsum.textContent = sum.toExponential(2);

  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Resize + init (mic-chunks readyState guard: clientWidth is the 300×150
// replaced-element default before the first layout pass).
// ---------------------------------------------------------------------------
function resize() {
  const parent = cpuCanvas.parentElement;
  const w = parent.clientWidth, h = parent.clientHeight;
  cpuCanvas.width = w; cpuCanvas.height = h;
  gpuCanvas.width = w; gpuCanvas.height = h;
  histCanvas.width = histCanvas.clientWidth;
  histCanvas.height = histCanvas.clientHeight;
  imgData = null;   // force ImageData rebuild at the new size
}
window.addEventListener('resize', resize);

function init() {
  resize();
  allocBuffers(+elFieldSize.value, +elFieldSize.value);
  curLut = buildGradient(elGradient.value);
  cpuCanvas.classList.toggle('hidden', useGPU);
  gpuCanvas.classList.toggle('hidden', !useGPU);
  hud.rmode.textContent = useGPU ? 'GPU' : 'CPU';
  buildCards();
  requestAnimationFrame(frame);
}
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init();
} else {
  window.addEventListener('load', init);
}

// Expose internals for headless test.js (drive the same code paths).
globalThis.__ik = {
  get fieldW() { return fieldW; }, get fieldH() { return fieldH; },
  get field() { return bufA; },
  applyPipeline, buildGradient, buildEqLut,
  fillSource, allocBuffers, STENCILS,
  pipeline,
  get range() { return curRange; },
};
