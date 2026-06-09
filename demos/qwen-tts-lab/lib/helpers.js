// ═══ small helpers ═══════════════════════════════════════════════════════════
const _fs = require('fs');
const _os = require('os');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// A canvas wrapped in a titled card body. Returns the canvas.
function mkCanvas(body, w, h) {
  const wrap = el('div', 'canvas-wrap');
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  wrap.appendChild(cv);
  body.appendChild(wrap);
  return cv;
}

function pExists(p) { try { return _fs.existsSync(p); } catch (e) { return false; } }
function pParent(p) { return p.replace(/[\\\/]+$/, '').replace(/[\\\/][^\\\/]*$/, ''); }
function pName(p)   { return p.replace(/[\\\/]+$/, '').replace(/^.*[\\\/]/, ''); }

// Find a steering-basis json near a checkpoint. The emotion / masc-fem bases are
// written beside the Base checkpoint (and the shared qwen-tts data dir), so a
// CustomVoice dir resolves them via its sibling 0.6B-Base or the parent qwen-tts
// dir. Returns the parsed object, or null if none of the candidates parse.
function readBasisJson(modelDir, name) {
  const parent = pParent(modelDir);
  for (const d of [modelDir, parent + '/0.6B-Base', parent]) {
    try {
      const b = JSON.parse(_fs.readFileSync(d + '/' + name, 'utf-8'));
      if (b) return b;
    } catch (e) {}
  }
  return null;
}

// Downmix interleaved PCM to mono (embedSpeaker treats its input as mono).
function toMono(samples, channels) {
  if (!channels || channels === 1) return samples;
  const n = Math.floor(samples.length / channels), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0; for (let c = 0; c < channels; c++) s += samples[i * channels + c];
    out[i] = s / channels;
  }
  return out;
}

// localStorage, defensively (absent in some headless builds).
function remember(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
function recall(key)        { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }

// Native dialogs, gated (absent in headless / GPU-less builds).
function browseFolder(start) {
  if (typeof showOpenFolderDialog !== 'function') { setBadge('folder dialog unavailable', true); return null; }
  const r = showOpenFolderDialog(start || null);
  return r && r.length ? r[0] : null;
}
function browseFile(filter) {
  if (typeof showOpenFileDialog !== 'function') { setBadge('file dialog unavailable', true); return null; }
  const r = showOpenFileDialog(filter || '');
  return r && r.length ? r[0] : null;
}
