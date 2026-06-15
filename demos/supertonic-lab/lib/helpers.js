// ═══ small helpers ═══════════════════════════════════════════════════════════
import { setBadge } from "/app/lib/model.js";

export const _fs = require('fs');
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

// Native dialogs, gated (absent in headless / GPU-less builds).
export function browseFolder(start) {
  if (typeof showOpenFolderDialog !== 'function') { setBadge('folder dialog unavailable', true); return null; }
  const r = showOpenFolderDialog(start || null);
  return r && r.length ? r[0] : null;
}

// ═══ WAV export ════════════════════════════════════════════════════════════
// Encode mono FP32 PCM to a mono 16-bit PCM WAV (Supertonic's native 44.1 kHz).
export function encodeWavPCM16(samples, rate) {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  let p = 0;
  const w32 = (v) => { dv.setUint32(p, v, true); p += 4; };
  const w16 = (v) => { dv.setUint16(p, v, true); p += 2; };
  const ws = (s) => { for (let i = 0; i < s.length; i++) dv.setUint8(p++, s.charCodeAt(i)); };
  ws('RIFF'); w32(36 + n * 2); ws('WAVE');
  ws('fmt '); w32(16); w16(1); w16(1); w32(rate); w32(rate * 2); w16(2); w16(16);
  ws('data'); w32(n * 2);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true); p += 2;
  }
  return new Uint8Array(buf);
}
