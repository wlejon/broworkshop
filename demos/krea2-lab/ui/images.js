// Image file/canvas -> pixel-tensor helpers (synchronous decode, matches
// vision-lab/triposplat), plus the Image Axis pair-slot thumbnail painter.

import { $ } from '/app/ui/util.js';

const APP_BASE = (function () {
  try { return require('fs').realpathSync('.'); } catch (e) { return ''; }
})();
function isAbsolutePath(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.charAt(0) === '/' || p.charAt(0) === '\\';
}
function appPath(p) {
  if (!p || isAbsolutePath(p) || !APP_BASE) return p;
  return APP_BASE + '/' + p;
}
export function fileToImageData(path) {
  const img = new Image();
  img.src = appPath(path);                          // sync decode + onload
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) throw new Error('could not decode image: ' + path);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  return cx.getImageData(0, 0, w, h);
}
// Cap the long side at maxSide (Krea 2's vision tower resizes internally —
// this just keeps the upload/JS-side conversion small).
export function capLongSide(imageData, maxSide) {
  const w = imageData.width, h = imageData.height;
  const long = Math.max(w, h);
  if (long <= maxSide) return imageData;
  const scale = maxSide / long;
  const nw = Math.max(1, Math.round(w * scale)), nh = Math.max(1, Math.round(h * scale));
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  src.getContext('2d').putImageData(imageData, 0, 0);
  const dst = document.createElement('canvas');
  dst.width = nw; dst.height = nh;
  dst.getContext('2d').drawImage(src, 0, 0, nw, nh);
  return dst.getContext('2d').getImageData(0, 0, nw, nh);
}
// HWC RGBA Uint8ClampedArray -> CHW FP32 [0,1] (krea2EncodeImagePrompt's shape).
export function toChwFp32(imageData) {
  const W = imageData.width, H = imageData.height, data = imageData.data;
  const out = new Float32Array(3 * H * W);
  const plane = H * W;
  for (let i = 0; i < plane; i++) {
    out[0 * plane + i] = data[i * 4 + 0] / 255;
    out[1 * plane + i] = data[i * 4 + 1] / 255;
    out[2 * plane + i] = data[i * 4 + 2] / 255;
  }
  return { pixels: out, H: H, W: W };
}
// Same tensor a file would produce, but sourced from an already-rendered canvas
// (the history thumbnails hold full-resolution pixels).
export function tensorFromCanvas(cnv) {
  const id = cnv.getContext('2d').getImageData(0, 0, cnv.width, cnv.height);
  return toChwFp32(capLongSide(id, 1024));
}
// Paint a picked image source into a preview box. Draws into a real
// <canvas> child (faithful in bro) rather than a CSS background-image from a
// data:/file: URL, which didn't render — the box stayed black. `src` is a
// canvas or ImageData; it's letterboxed into a small backing store keyed to the
// box (`.imgpick-thumb` is square via aspect-ratio; object-fit:contain fits it).
export function paintThumbInto(thumb, src, sw, sh) {
  let cv = thumb.querySelector('canvas');
  if (!cv) { cv = document.createElement('canvas'); thumb.appendChild(cv); }
  const BOX = 160;
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
// The Image Axis pair slots address their boxes by slot letter.
export function paintMintThumb(which, src, sw, sh) {
  paintThumbInto($('mint-' + which + '-thumb'), src, sw, sh);
}
