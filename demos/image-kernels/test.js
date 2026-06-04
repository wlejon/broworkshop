// =============================================================================
// Image Kernels headless integration test
//
// Verifies bro.image's six composable verbs + two builders + the GPU path
// against hand-computed references on tiny known buffers, then drives the
// demo's own pipeline a few frames and screenshots.
//
// Run:
//   bro-headless demos/image-kernels demos/image-kernels/test.js
// =============================================================================

var passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log("  ok  " + label); }
  else      { failed++; console.log("FAIL  " + label); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-4); }
function arrApprox(a, b, eps) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (!approx(a[i], b[i], eps)) return false;
  return true;
}

console.log("\n=== Image Kernels integration tests ===\n");

// -----------------------------------------------------------------------------
// 1. alloc — dtype + size
// -----------------------------------------------------------------------------
console.log("[1] alloc");
{
  check("float32 default length = w*h*ch", bro.image.alloc(4, 3, 2).length === 24);
  check("float32 is Float32Array", bro.image.alloc(2, 2, 1).constructor.name === 'Float32Array');
  check("uint8c dtype", bro.image.alloc(2, 2, 4, 'uint8c').constructor.name === 'Uint8ClampedArray');
  check("uint16 dtype", bro.image.alloc(2, 2, 1, 'uint16').constructor.name === 'Uint16Array');
  check("int32 dtype", bro.image.alloc(2, 2, 1, 'int32').constructor.name === 'Int32Array');
}

// -----------------------------------------------------------------------------
// 2. reduce — minmax / sum / mean / histogram on a known ramp 0..15
// -----------------------------------------------------------------------------
console.log("\n[2] reduce");
{
  var f = bro.image.alloc(4, 4, 1);
  for (var i = 0; i < 16; i++) f[i] = i;
  var mm = bro.image.reduce(f, 'minmax');
  check("minmax.min", mm.min === 0);
  check("minmax.max", mm.max === 15);
  check("sum = 120", bro.image.reduce(f, 'sum') === 120);
  check("mean = 7.5", bro.image.reduce(f, 'mean') === 7.5);
  var h = bro.image.reduce(f, 'histogram', { bins: 4, lo: 0, hi: 15 });
  check("histogram is Uint32Array", h.constructor.name === 'Uint32Array');
  // 16 values across 4 bins over [0,15] → 4,4,4,3 (15 lands at the top edge).
  check("histogram bins = [4,4,4,3]", h[0] === 4 && h[1] === 4 && h[2] === 4 && h[3] === 3);
  // The interval is half-open: the value landing exactly on `hi` (15) is not
  // counted, so the bins sum to 15, not 16. Documented behaviour worth pinning.
  check("histogram excludes value at hi edge (sum = 15)", h[0] + h[1] + h[2] + h[3] === 15);
  // stride: visit every 2nd element (0,2,4,..14) → sum = 56.
  check("minmax with stride still spans", bro.image.reduce(f, 'minmax', { stride: 2 }).max === 14);
}

// -----------------------------------------------------------------------------
// 3. map — affine / sqrt / abs / pow vs hand-computed
// -----------------------------------------------------------------------------
console.log("\n[3] map");
{
  var src = new Float32Array([0, 1, 4, 9]);
  var dst = bro.image.alloc(4, 1, 1);
  bro.image.map(dst, src, { op: 'affine', a: 2, b: 1 });
  check("affine 2x+1", arrApprox(dst, [1, 3, 9, 19]));
  bro.image.map(dst, src, { op: 'sqrt' });
  check("sqrt", arrApprox(dst, [0, 1, 2, 3]));
  var neg = new Float32Array([-2, -1, 3, -4]);
  bro.image.map(dst, neg, { op: 'abs' });
  check("abs", arrApprox(dst, [2, 1, 3, 4]));
  bro.image.map(dst, new Float32Array([1, 2, 3, 4]), { op: 'pow', exp: 2 });
  check("pow exp=2", arrApprox(dst, [1, 4, 9, 16]));
  // affine with clamp
  bro.image.map(dst, new Float32Array([-1, 0.5, 2, 0.9]), { op: 'affine', a: 1, b: 0, clamp: [0, 1] });
  check("affine clamp [0,1]", arrApprox(dst, [0, 0.5, 1, 0.9]));
}

// -----------------------------------------------------------------------------
// 4. combine — add / sub / mul / lerp / wsum vs hand-computed
// -----------------------------------------------------------------------------
console.log("\n[4] combine");
{
  var a = new Float32Array([0, 1, 2, 3]);
  var b = new Float32Array([10, 10, 10, 10]);
  var d = bro.image.alloc(4, 1, 1);
  bro.image.combine(d, a, b, { op: 'add' });  check("add", arrApprox(d, [10, 11, 12, 13]));
  bro.image.combine(d, a, b, { op: 'sub' });  check("sub", arrApprox(d, [-10, -9, -8, -7]));
  bro.image.combine(d, a, b, { op: 'mul' });  check("mul", arrApprox(d, [0, 10, 20, 30]));
  bro.image.combine(d, a, b, { op: 'min' });  check("min", arrApprox(d, [0, 1, 2, 3]));
  bro.image.combine(d, a, b, { op: 'max' });  check("max", arrApprox(d, [10, 10, 10, 10]));
  bro.image.combine(d, a, b, { op: 'lerp', t: 0.5 }); check("lerp t=0.5", arrApprox(d, [5, 5.5, 6, 6.5]));
  bro.image.combine(d, a, b, { op: 'wsum', wa: 2, wb: 1 }); check("wsum 2a+b", arrApprox(d, [10, 12, 14, 16]));
}

// -----------------------------------------------------------------------------
// 5. stencil — box blur + sobel on a tiny known field, interior pixels by hand
// -----------------------------------------------------------------------------
console.log("\n[5] stencil");
{
  // 5x5 field, single spike of 9 at the centre (idx 12). Box blur /9 spreads
  // it over the 3x3 around the centre: each of the 9 cells touching it becomes
  // 9/9 = 1; the centre itself = 1 too.
  var W = 5, H = 5;
  var sf = bro.image.alloc(W, H, 1); sf[12] = 9;
  var out = bro.image.alloc(W, H, 1);
  var box = { data: new Float32Array(9).fill(1), w: 3, h: 3 };
  bro.image.stencil(out, sf, box, { srcW: W, srcH: H, edge: 'clamp', divisor: 9 });
  check("box blur centre = 1", approx(out[12], 1));
  check("box blur 4-neighbour = 1", approx(out[11], 1) && approx(out[13], 1) && approx(out[7], 1) && approx(out[17], 1));
  check("box blur far cell = 0", approx(out[0], 0));

  // Sobel X on a horizontal ramp: f(x,y) = x (0..4 per row). A clean X gradient
  // → interior sobelX response is constant. For src[x]=x with edge replicate,
  // an interior column (x=2): sum = (-1*1 + 1*3)*1 + (-2*1 + 2*3) + (-1*1 + 1*3)
  //   = 2 + 4 + 2 = 8.
  var ramp = bro.image.alloc(W, H, 1);
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) ramp[y * W + x] = x;
  var sx = { data: new Float32Array([-1, 0, 1, -2, 0, 2, -1, 0, 1]), w: 3, h: 3 };
  var edges = bro.image.alloc(W, H, 1);
  bro.image.stencil(edges, ramp, sx, { srcW: W, srcH: H, edge: 'clamp' });
  check("sobelX interior (x=2,y=2) = 8", approx(edges[2 * W + 2], 8));
  check("sobelX interior (x=2,y=1) = 8", approx(edges[1 * W + 2], 8));
  // A flat field → zero everywhere (sobel kernel sums to 0).
  var flat = bro.image.alloc(W, H, 1); for (var k = 0; k < 25; k++) flat[k] = 3;
  bro.image.stencil(edges, flat, sx, { srcW: W, srcH: H, edge: 'clamp' });
  check("sobelX on flat field = 0", approx(edges[12], 0));

  // bias: box blur of zeros + bias 5 = 5.
  var zero = bro.image.alloc(W, H, 1);
  bro.image.stencil(out, zero, box, { srcW: W, srcH: H, edge: 'zero', divisor: 9, bias: 5 });
  check("stencil bias applied", approx(out[12], 5));
}

// -----------------------------------------------------------------------------
// 6. resample — nearest exactness + bilinear midpoint
// -----------------------------------------------------------------------------
console.log("\n[6] resample");
{
  // 2x2 → 4x4 nearest: each source cell duplicated into a 2x2 block.
  var src = new Float32Array([1, 2, 3, 4]);   // [[1,2],[3,4]]
  var dst = bro.image.alloc(4, 4, 1);
  bro.image.resample(dst, src, { srcW: 2, srcH: 2, dstW: 4, dstH: 4, channels: 1, filter: 'nearest' });
  check("nearest row0 = [1,1,2,2]", arrApprox(dst.subarray(0, 4), [1, 1, 2, 2]));
  check("nearest row3 = [3,3,4,4]", arrApprox(dst.subarray(12, 16), [3, 3, 4, 4]));

  // identity resize (same dims) is exact for both filters.
  var same = bro.image.alloc(2, 2, 1);
  bro.image.resample(same, src, { srcW: 2, srcH: 2, dstW: 2, dstH: 2, channels: 1, filter: 'bilinear' });
  check("resample identity exact", arrApprox(same, [1, 2, 3, 4]));

  // multi-channel interleaved: 2x1 RG, nearest to 4x1 → channels stay paired.
  var rg = new Float32Array([1, 100, 2, 200]);   // (1,100) (2,200)
  var rgOut = bro.image.alloc(4, 1, 2);
  bro.image.resample(rgOut, rg, { srcW: 2, srcH: 1, dstW: 4, dstH: 1, channels: 2, filter: 'nearest' });
  check("multi-channel nearest keeps pairs", rgOut[0] === 1 && rgOut[1] === 100 && rgOut[6] === 2 && rgOut[7] === 200);
}

// -----------------------------------------------------------------------------
// 7. gradient — endpoints + a stepped (posterize) LUT
// -----------------------------------------------------------------------------
console.log("\n[7] gradient");
{
  var lut = bro.image.gradient([[0, 0, 0, 0], [1, 255, 255, 255]], 256);
  check("gradient LUT 4*n bytes", lut.length === 256 * 4);
  check("gradient first entry black", lut[0] === 0 && lut[1] === 0 && lut[2] === 0);
  check("gradient last entry white", lut[1020] === 255 && lut[1021] === 255 && lut[1022] === 255);
  // midpoint of black→white ≈ 127/128.
  var mid = lut[128 * 4];
  check("gradient midpoint ~127", mid >= 126 && mid <= 129);
  // alpha defaults to 255 when stops are [t,r,g,b].
  check("gradient default alpha 255", lut[3] === 255);

  // stepped LUT (two identical t plateaus) → hard step, no interpolation.
  var step = bro.image.gradient([
    [0.0, 0, 0, 0], [0.5, 0, 0, 0],
    [0.5, 255, 255, 255], [1.0, 255, 255, 255],
  ], 256);
  check("stepped LUT low half black", step[64 * 4] === 0);
  check("stepped LUT high half white", step[200 * 4] === 255);
}

// -----------------------------------------------------------------------------
// 8. lookup — scalar field → RGBA8 through a LUT
// -----------------------------------------------------------------------------
console.log("\n[8] lookup");
{
  var lut = bro.image.gradient([[0, 0, 0, 0], [1, 255, 255, 255]], 256);
  var f = bro.image.alloc(4, 4, 1);
  for (var i = 0; i < 16; i++) f[i] = i;
  var rgba = new Uint8ClampedArray(16 * 4);
  bro.image.lookup(rgba, f, lut, { lo: 0, hi: 15 });
  // value 0 → LUT index 0 → black; value 15 → LUT index 255 → white.
  check("lookup min → black", rgba[0] === 0 && rgba[1] === 0 && rgba[2] === 0);
  check("lookup max → white", rgba[60] === 255 && rgba[61] === 255 && rgba[62] === 255);
  // A 4-component stop [t,r,g,b] defaults alpha to 255 (not 0), so both pixels
  // are fully opaque. (5-component [t,r,g,b,a] is needed for a custom alpha.)
  check("lookup writes opaque alpha (default 255)", rgba[3] === 255 && rgba[63] === 255);

  // wrap edge: value above hi wraps around (cyclic LUT use case). With a black→
  // white LUT and lo=0/hi=1, a src of exactly 1.0 maps to top; 2.0 with wrap
  // re-enters from the bottom. We just assert wrap differs from clamp here.
  var w2 = bro.image.alloc(2, 1, 1); w2[0] = 0.0; w2[1] = 1.9;
  var rc = new Uint8ClampedArray(8), rw = new Uint8ClampedArray(8);
  bro.image.lookup(rc, w2, lut, { lo: 0, hi: 1, edge: 'clamp' });
  bro.image.lookup(rw, w2, lut, { lo: 0, hi: 1, edge: 'wrap' });
  check("lookup wrap differs from clamp out-of-range", rc[4] !== rw[4]);
}

// -----------------------------------------------------------------------------
// 9. GPU path — gpu.colormap + gpu.fbm2D do not throw and produce pixels
// -----------------------------------------------------------------------------
console.log("\n[9] gpu.colormap / gpu.fbm2D");
{
  var cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  var glx = cv.getContext('webgl2');
  check("webgl2 context available", !!glx);
  var lut = bro.image.gradient([[0, 0, 0, 0], [1, 255, 255, 255]], 256);
  var fld = bro.image.alloc(64, 64, 1);
  for (var i = 0; i < 64 * 64; i++) fld[i] = (i % 64) / 63;
  var ok = true;
  try { bro.image.gpu.colormap(cv, fld, lut, { lo: 0, hi: 1, srcW: 64, srcH: 64 }); } catch (e) { ok = false; console.log("    colormap threw: " + e.message); }
  check("gpu.colormap explicit range", ok);
  ok = true;
  try { bro.image.gpu.colormap(cv, fld, lut, { autoRange: true, ema: 0.5, srcW: 64, srcH: 64 }); } catch (e) { ok = false; console.log("    autoRange threw: " + e.message); }
  check("gpu.colormap autoRange", ok);
  ok = true;
  try { bro.image.gpu.colormap(cv, fld, lut, { autoRange: true, srcW: 64, srcH: 64, viewRect: { x: 4, y: 0, w: 56, h: 64 } }); } catch (e) { ok = false; console.log("    viewRect threw: " + e.message); }
  check("gpu.colormap viewRect", ok);
  ok = true;
  try { bro.image.gpu.fbm2D(cv, lut, { frequency: 0.05, octaves: 4, gain: 0.5, lacunarity: 2, seed: 1337, autoRange: true }); } catch (e) { ok = false; console.log("    fbm2D threw: " + e.message); }
  check("gpu.fbm2D Simplex autoRange", ok);
  ok = true;
  try { bro.image.gpu.fbm2D(cv, lut, { regenerate: false, autoRange: true, viewRect: { x: 2, y: 0, w: 60, h: 64 } }); } catch (e) { ok = false; console.log("    fbm2D regen=false threw: " + e.message); }
  check("gpu.fbm2D regenerate:false + viewRect", ok);

  // readback: the colormap actually wrote non-empty pixels.
  bro.image.gpu.colormap(cv, fld, lut, { lo: 0, hi: 1, srcW: 64, srcH: 64 });
  var px = new Uint8Array(64 * 64 * 4);
  glx.readPixels(0, 0, 64, 64, glx.RGBA, glx.UNSIGNED_BYTE, px);
  var anyNonZero = false;
  for (var p = 0; p < px.length; p += 4) { if (px[p] !== 0 || px[p + 1] !== 0 || px[p + 2] !== 0) { anyNonZero = true; break; } }
  check("gpu.colormap produced non-empty pixels", anyNonZero);
}

// -----------------------------------------------------------------------------
// 10. Histogram-equalization LUT recipe (CDF) is monotonic & spans 0..255
// -----------------------------------------------------------------------------
console.log("\n[10] histogram-equalization LUT recipe");
{
  // A field bunched into the low end → eq should stretch it. Build the eq LUT
  // exactly as the demo does (CDF of the histogram → grayscale LUT).
  var N = 256, f = bro.image.alloc(16, 16, 1);
  for (var i = 0; i < N; i++) f[i] = (i / N) * 0.3;   // all values in [0,0.3)
  var hist = bro.image.reduce(f, 'histogram', { bins: 256, lo: 0, hi: 1 });
  var total = 0; for (var b = 0; b < 256; b++) total += hist[b];
  var lut = new Uint8Array(256 * 4);
  var cum = 0, cdfMin = 0;
  for (var b2 = 0; b2 < 256; b2++) { if (hist[b2] > 0) { cdfMin = hist[b2]; break; } }
  var denom = Math.max(1, total - cdfMin);
  var monotonic = true, prevV = -1;
  for (var b3 = 0; b3 < 256; b3++) {
    cum += hist[b3];
    var v = Math.round(((cum - cdfMin) / denom) * 255);
    v = v < 0 ? 0 : (v > 255 ? 255 : v);
    lut[b3 * 4] = v; lut[b3 * 4 + 1] = v; lut[b3 * 4 + 2] = v; lut[b3 * 4 + 3] = 255;
    if (v < prevV) monotonic = false;
    prevV = v;
  }
  check("eq LUT histogram sums to pixel count", total === 256);
  check("eq LUT is monotonic non-decreasing", monotonic);
  check("eq LUT reaches 255 at the top", lut[255 * 4] === 255);
}

// -----------------------------------------------------------------------------
// 11. Live demo pipeline (main.js ran) + screenshot
// -----------------------------------------------------------------------------
console.log("\n[11] Live demo pipeline + screenshot");
{
  advanceTime(50);
  var ik = globalThis.__ik;
  check("__ik test hook exposed by main.js", ik && typeof ik === 'object');
  if (ik) {
    check("field allocated (> 0)", ik.fieldW > 0 && ik.fieldH > 0);

    // Drive a representative chain through the demo's own applyPipeline.
    ik.pipeline.find(function (s) { return s.id === 'map'; }).on = true;
    var mp = ik.pipeline.find(function (s) { return s.id === 'map'; }); mp.cfg.op = 'abs';
    var st = ik.pipeline.find(function (s) { return s.id === 'stencil'; }); st.on = true; st.cfg.kernel = 'edgemag';
    var r = ik.applyPipeline();
    var mm = bro.image.reduce(r.buf, 'minmax');
    check("pipeline produces a finite field (max not NaN/Inf)", mm.max != null && isFinite(mm.max));
    check("pipeline field has dynamic range", mm.max > mm.min);

    // histeq stage flips eqActive.
    ik.pipeline.find(function (s) { return s.id === 'histeq'; }).on = true;
    check("histeq stage routes eqActive", ik.applyPipeline().eqActive === true);
  }

  advanceTime(300);
  flush();
  screenshot('image-kernels.png');
  console.log("  screenshot: image-kernels.png");
}

console.log("\n=== " + passed + " passed, " + failed + " failed ===\n");
assert(failed === 0, failed + " Image Kernels test(s) failed");
