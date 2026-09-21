// Small shared helpers, the joint-sequence geometry constants, and the two
// image measures the lab reads a render with.

export function $(id) { return document.getElementById(id); }

// Joint-sequence geometry (docs/diffusion-control-api.js section 7, note (c),
// and qwen-image-research/lib/masks.js). One gate-mask row covers a 16x16 pixel
// square: the VAE is 16x and the DiT consumes the latent unpatched, so the
// token grid is width/16 by height/16 and the joint order is
//
//     [text rows ; image tokens row-major],  idx = textRows + y * wp + x
//
// A mask whose length is not textRows + imgLen throws on the next forward.
export const PATCH_PX = 16;
// Sides land on a multiple of 32: the vision tower emits one token per 32 px
// and the two doors of the edit path have to line up (hLat * wLat === 4 * slots).
export const SIZE_MULT = 32;
export const NUM_BLOCKS = 32;

export function gridFor(width, height) {
  return { wp: Math.floor(width / PATCH_PX), hp: Math.floor(height / PATCH_PX) };
}

// ── image measures ────────────────────────────────────────────────────────
// Mean squared error per channel between two same-sized RGBA buffers. The
// lab's "did this control do anything" number; the seed-to-seed floor at a
// fixed seed is 0, so anything above a few units is a real change.
export function pixelMse(a, b) {
  const n = Math.min(a.data.length, b.data.length);
  let acc = 0, count = 0;
  for (let i = 0; i < n; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = a.data[i + c] - b.data[i + c];
      acc += d * d;
    }
    count += 3;
  }
  return count ? acc / count : 0;
}

// A structural-similarity proxy over 8x8 luma blocks — the CLIP-free stand-in
// for round 3's subject-retention bar (which asked whether the render is still
// the same picture, and answered with CLIP image similarity at a 0.71 cut).
// Means, variances and covariance per block, the standard SSIM constants, and
// the mean over blocks. 1.0 is the identical image.
export function retention(a, b) {
  const W = Math.min(a.width, b.width), H = Math.min(a.height, b.height);
  if (!W || !H) return 0;
  const C1 = 6.5025, C2 = 58.5225;   // (0.01*255)^2, (0.03*255)^2
  const B = 8;
  let acc = 0, blocks = 0;
  const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  for (let by = 0; by + B <= H; by += B) {
    for (let bx = 0; bx + B <= W; bx += B) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let y = 0; y < B; y++) {
        for (let x = 0; x < B; x++) {
          const ia = 4 * ((by + y) * a.width + bx + x);
          const ib = 4 * ((by + y) * b.width + bx + x);
          const va = lum(a.data, ia), vb = lum(b.data, ib);
          sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
        }
      }
      const n = B * B;
      const ma = sa / n, mb = sb / n;
      const va = saa / n - ma * ma, vb = sbb / n - mb * mb, cab = sab / n - ma * mb;
      acc += ((2 * ma * mb + C1) * (2 * cab + C2)) /
             ((ma * ma + mb * mb + C1) * (va + vb + C2));
      blocks++;
    }
  }
  return blocks ? acc / blocks : 0;
}

// Mean per-channel absolute difference inside a pixel rectangle — the
// localisation readout the gate-mask tests compare inside against outside.
export function regionDiff(a, b, x0, y0, x1, y1) {
  let sum = 0, n = 0;
  const W = a.width;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = 4 * (y * W + x);
      sum += Math.abs(a.data[i] - b.data[i]) +
             Math.abs(a.data[i + 1] - b.data[i + 1]) +
             Math.abs(a.data[i + 2] - b.data[i + 2]);
      n++;
    }
  }
  return n ? sum / n / 3 : 0;
}

// HWC RGBA -> planar CHW FP32 in [0,1] — the `pixels` shape a condition image
// entry takes (GenerateOptions.conditionImages).
export function toChwFp32(imageData) {
  const W = imageData.width, H = imageData.height, d = imageData.data;
  const out = new Float32Array(3 * H * W);
  const plane = H * W;
  for (let i = 0; i < plane; i++) {
    out[0 * plane + i] = d[i * 4 + 0] / 255;
    out[1 * plane + i] = d[i * 4 + 1] / 255;
    out[2 * plane + i] = d[i * 4 + 2] / 255;
  }
  return { pixels: out, width: W, height: H, channels: 3 };
}

// Decode an image file synchronously (bro's Image decodes on assignment) and
// return its ImageData.
const APP_BASE = (function () {
  try { return require('fs').realpathSync('.'); } catch (e) { return ''; }
})();
function isAbsolutePath(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.charAt(0) === '/' || p.charAt(0) === '\\';
}
export function appPath(p) {
  if (!p || isAbsolutePath(p) || !APP_BASE) return p;
  return APP_BASE + '/' + p;
}
export function fileToImageData(path) {
  const img = new Image();
  img.src = appPath(path);
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) throw new Error('could not decode image: ' + path);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0);
  return c.getContext('2d').getImageData(0, 0, w, h);
}

// Paint any image source into a preview box, letterboxed into a small backing
// store (a CSS background-image from a file: URL does not render in bro).
export function paintThumbInto(thumb, src, sw, sh) {
  let cv = thumb.querySelector('canvas');
  if (!cv) { cv = document.createElement('canvas'); thumb.appendChild(cv); }
  const BOX = 120;
  const scale = Math.min(BOX / sw, BOX / sh, 1);
  cv.width = Math.max(1, Math.round(sw * scale));
  cv.height = Math.max(1, Math.round(sh * scale));
  const cx = cv.getContext('2d');
  cx.clearRect(0, 0, cv.width, cv.height);
  if (src instanceof ImageData) {
    const tmp = document.createElement('canvas');
    tmp.width = sw; tmp.height = sh;
    tmp.getContext('2d').putImageData(src, 0, 0);
    cx.drawImage(tmp, 0, 0, cv.width, cv.height);
  } else {
    cx.drawImage(src, 0, 0, cv.width, cv.height);
  }
  thumb.classList.add('filled');
}
