// ═══ small helpers — dom, fs/os bridges, image draw, W+ math ═══════════════════
import { setBadge } from "/app/lib/engine.js";

const _fs = require('fs');
export const _os = require('os');

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function pExists(p) { try { return _fs.existsSync(p); } catch (e) { return false; } }
export function pParent(p) { return p.replace(/[\\\/]+$/, '').replace(/[\\\/][^\\\/]*$/, ''); }
export function pName(p)   { return p.replace(/[\\\/]+$/, '').replace(/^.*[\\\/]/, ''); }

// localStorage, defensively (absent in some headless builds).
export function remember(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
export function recall(key)        { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }

// Native folder dialog, gated (absent in headless / GPU-less builds).
export function browseFolder(start) {
  if (typeof showOpenFolderDialog !== 'function') { setBadge('folder dialog unavailable', true); return null; }
  const r = showOpenFolderDialog(start || null);
  return r && r.length ? r[0] : null;
}

// A 32-bit seed in StyleGAN's usual range.
export function randSeed() { return Math.floor(Math.random() * 0xffffffff) >>> 0; }

// Draw an ImageBitmap into a canvas at native size (CSS scales the display).
// Only touch width/height when they change — each assignment reallocates the
// backing surface.
export function drawBitmap(canvas, bmp) {
  if (!canvas || !bmp) return;
  if (canvas.width !== bmp.width) canvas.width = bmp.width;
  if (canvas.height !== bmp.height) canvas.height = bmp.height;
  canvas.getContext('2d').drawImage(bmp, 0, 0);
}

// ── W+ math ──────────────────────────────────────────────────────────────────
// A w+ is a flat Float32Array of length numWs*wDim (row-major, one wDim row per
// synthesis layer).

export function wKey(seed, psi, cutoff) { return seed + '|' + psi + '|' + cutoff; }

// Elementwise interpolation a→b at t — the canonical W+ morph.
export function lerpW(a, b, t) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * (1 - t) + b[i] * t;
  return out;
}

// Style mixing: coarse rows [0,k) from a, fine rows [k,numWs) from b.
export function mixW(a, b, k, numWs, wDim) {
  const out = Float32Array.from(a);
  for (let row = k; row < numWs; row++) {
    out.set(b.subarray(row * wDim, (row + 1) * wDim), row * wDim);
  }
  return out;
}
