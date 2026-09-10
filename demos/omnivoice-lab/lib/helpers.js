// ═══ small helpers ═══════════════════════════════════════════════════════════
import { $ } from "/app/lib/state.js";

export const _fs = require('fs');
export const _os = require('os');

export function setBadge(text, err) {
  const b = $('#backend');
  b.textContent = text;
  b.classList.toggle('err', !!err);
}

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function pExists(p) { try { return !!p && _fs.existsSync(p); } catch (e) { return false; } }
export function pParent(p) { return p.replace(/[\\\/]+$/, '').replace(/[\\\/][^\\\/]*$/, ''); }
export function pName(p)   { return p.replace(/[\\\/]+$/, '').replace(/^.*[\\\/]/, ''); }
export function envVar(k)  { try { return (process.env && process.env[k]) || ''; } catch (e) { return ''; } }

// Downmix interleaved PCM to mono.
export function toMono(samples, channels) {
  if (!channels || channels === 1) return samples;
  const n = Math.floor(samples.length / channels), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0; for (let c = 0; c < channels; c++) s += samples[i * channels + c];
    out[i] = s / channels;
  }
  return out;
}

// Linear resample (plenty for a transcript check or a clip publish).
export function resampleTo(samples, inRate, outRate) {
  if (Math.abs(outRate - inRate) < 1) return samples;
  const ratio = outRate / inRate, n = Math.floor(samples.length * ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / ratio, j = t | 0, f = t - j;
    const a = samples[j], b = samples[j + 1] !== undefined ? samples[j + 1] : a;
    out[i] = a * (1 - f) + b * f;
  }
  return out;
}

export function concatF32(parts) {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Float32Array(n);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// localStorage, defensively (absent in some headless builds).
export function remember(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
export function recall(key)        { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }

// Native dialogs, gated (absent in headless / GPU-less builds). Only ever
// reached from a user click — never from a test.
export function browseFolder(start) {
  if (typeof showOpenFolderDialog !== 'function') { setBadge('folder dialog unavailable', true); return null; }
  const r = showOpenFolderDialog(start || null);
  return r && r.length ? r[0] : null;
}
export function browseFile(filter) {
  if (typeof showOpenFileDialog !== 'function') { setBadge('file dialog unavailable', true); return null; }
  const r = showOpenFileDialog(filter || '');
  return r && r.length ? r[0] : null;
}
export function saveFile(filter, name) {
  if (typeof showSaveFileDialog !== 'function') { setBadge('save dialog unavailable in this build', true); return null; }
  return showSaveFileDialog(filter, name) || null;
}

export function fmtSecs(n, sr) { return (n / (sr || 24000)).toFixed(2) + 's'; }
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function slug(s, n) {
  return (s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n || 32);
}

// Golden-angle hue for a code id: neighbouring ids get distinct colours, so a
// re-rolled cell visibly changes even when the id moved by one.
export function codeColor(code) {
  const h = (code * 137.508) % 360, s = 55 + (code % 7) * 5, l = 38 + ((code >> 3) % 5) * 6;
  return hsl2rgb(h, s / 100, l / 100);
}
export function hsl2rgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return [((r + m) * 255) | 0, ((g + m) * 255) | 0, ((b + m) * 255) | 0];
}
// Sequential colormap for a step index (early = deep blue, late = warm white).
export function stepColor(t) {
  t = clamp(t, 0, 1);
  const stops = [[20, 40, 110], [40, 120, 200], [60, 190, 160], [230, 180, 60], [255, 245, 220]];
  const x = t * (stops.length - 1), i = Math.min(stops.length - 2, x | 0), f = x - i;
  const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
// Confidence colour: red (unsure) -> amber -> green (sure).
export function confColor(t) {
  t = clamp(t, 0, 1);
  const r = t < 0.5 ? 230 : 230 - (t - 0.5) * 2 * 150;
  const g = t < 0.5 ? 90 + t * 2 * 130 : 220;
  return [r | 0, g | 0, 90];
}
