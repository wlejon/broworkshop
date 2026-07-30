// sweep-runner.js — content-addressed parameter sweeps: render a sequence of
// frames to disk, skip what a previous run already made, and pack the ordered
// result into an animation.
//
// Written for generative-model labs, where a single frame costs seconds and a
// sweep costs minutes. The rule it enforces is that identical settings never
// render twice: every frame's identity is a hash of everything that shaped it,
// so re-running a sweep after adding two steps renders two frames, and
// re-running it unchanged renders none.
//
// Usage:
//   import { createSweepRunner } from '/lib/sweep-runner.js';
//
//   const runner = createSweepRunner({ root: 'D:/out/sweeps' });
//   const result = await runner.runSweep({
//     name:    'composition.proximity',   // folder name (sanitized)
//     baseKey: everythingHeldConstant,    // any JSON value; identifies the folder
//     values:  [-6, -3, 0, 3, 6],         // the one thing that varies
//     render:  async (value) => ({ pixels, width, height }),   // RGBA, 4 bytes/px
//     frameName: (value) => '0600_p0.00',                      // optional, stable
//     animations: [{ msPerFrame: 200, pingPong: true }],
//     signal:  { cancelled: false },      // set .cancelled to stop after the frame
//     onProgress: (p) => {},              // {done,total,value,reused,label}
//   });
//
//   // result: {dir, frames:[{value,file,path,reused}], rendered, reused,
//   //          animations:[{path,reused,frames,fps}], cancelled}
//
// The output layout, for a sweep named N with base-key signature S:
//
//   <root>/<N>/<S>/v_<frameName>.png     one still per value
//   <root>/<N>/<S>/<name>.webm           the animation(s)
//   <root>/<N>/<S>/manifest.json         what was made, and from what
//
// The signature folder is the whole idempotency mechanism: change the prompt,
// the seed, the size — anything in baseKey — and the sweep lands in a NEW
// folder rather than silently overwriting stills that were made from different
// settings. Two sweeps of the same axis under different prompts coexist, which
// is what you want when the sweeps are the deliverable.
//
// Requires: bro.image (encodePngFile / decodeOriented), VideoEncoder and/or
// GifEncoder, and node fs/path. Everything is checked up front so a missing
// build feature is an error at the call, not a half-written folder.

const fs = require('fs');
const path = require('path');

// ── hashing ────────────────────────────────────────────────────────────────
// SHA-256 through WebCrypto (async — the only digest available without a node
// crypto module). Sweeps are seconds-per-frame, so the awaits are free.
export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  const b = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, '0');
  return out;
}

// Stable JSON: object keys sorted at every depth, floats rounded, and typed
// arrays reduced to a digest of their bytes rather than a megabyte of decimals.
// Two structurally equal values must produce one identical string, or the whole
// cache silently misses.
export function canonicalJson(v) {
  const seen = new Set();
  function enc(x) {
    if (x === null || x === undefined) return 'null';
    const t = typeof x;
    if (t === 'number') {
      if (!isFinite(x)) return 'null';
      // Slider values carry fp noise (0.6000000000000001); 6 decimals is far
      // finer than any control here and kills the noise.
      return JSON.stringify(Math.round(x * 1e6) / 1e6);
    }
    if (t === 'boolean' || t === 'string') return JSON.stringify(x);
    if (t === 'function') return 'null';
    if (ArrayBuffer.isView(x) || x instanceof ArrayBuffer) return taDigest(x);
    if (Array.isArray(x)) return '[' + x.map(enc).join(',') + ']';
    if (t === 'object') {
      // A cycle can't be hashed; refusing beats hashing a truncated view of the
      // settings and calling two different sweeps identical.
      if (seen.has(x)) throw new Error('canonicalJson: cyclic value');
      seen.add(x);
      const keys = Object.keys(x).filter((k) => x[k] !== undefined).sort();
      const body = keys.map((k) => JSON.stringify(k) + ':' + enc(x[k])).join(',');
      seen.delete(x);
      return '{' + body + '}';
    }
    return 'null';
  }
  return enc(v);
}

// FNV-1a over the raw bytes of a typed array / buffer. Not a cryptographic
// digest — it stands in for pixel and tensor payloads (masks, reference images)
// that would otherwise dominate the canonical string. Collisions here mean a
// stale frame is reused, so it mixes the length in too.
function taDigest(x) {
  const bytes = x instanceof ArrayBuffer
    ? new Uint8Array(x)
    : new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = (h * 0x01000193) >>> 0;
  }
  const kind = x instanceof ArrayBuffer ? 'ArrayBuffer' : (x.constructor && x.constructor.name) || 'View';
  return JSON.stringify('\u0000ta:' + kind + ':' + bytes.length + ':' + h.toString(16));
}

// ── filesystem helpers ─────────────────────────────────────────────────────
// Anything that becomes a path component. Windows rejects <>:"/\|?* and trailing
// dots; axis names carry dots mid-string (composition.proximity), which is fine,
// so only the genuinely illegal characters are replaced.
export function sanitizeName(s) {
  let out = String(s == null ? '' : s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  out = out.replace(/[. ]+$/, '');           // no trailing dot/space on Windows
  if (!out) out = 'unnamed';
  return out.slice(0, 80);
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return fallback; }
}

function writeJson(p, v) {
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

// ── frame rate from a per-frame duration ───────────────────────────────────
// VideoEncoder takes a rational fps (fps/fpsDen), so "200 ms per frame" is an
// exact 5/1 rather than an approximation. Reduce so the timebase stays small.
export function fpsForMs(msPerFrame) {
  const ms = Math.max(1, Math.round(msPerFrame));
  const g = (function gcd(a, b) { while (b) { const t = a % b; a = b; b = t; } return a; })(1000, ms);
  return { fps: 1000 / g, fpsDen: ms / g };
}

// ── the runner ─────────────────────────────────────────────────────────────
export function createSweepRunner(cfg) {
  const root = cfg && cfg.root;
  if (!root) throw new Error('createSweepRunner: root directory required');

  // Fail before making any directories, so an unsupported build can't leave a
  // folder of stills with no animation and no explanation.
  function requireEncoder(format) {
    if (format === 'gif') {
      if (typeof GifEncoder !== 'function') throw new Error('GifEncoder unavailable in this build');
      return;
    }
    if (typeof VideoEncoder !== 'function') throw new Error('VideoEncoder unavailable in this build (BRO_WITH_VIDEO off)');
  }
  if (!bro.image || typeof bro.image.encodePngFile !== 'function')
    throw new Error('bro.image.encodePngFile unavailable in this build');
  if (typeof bro.image.decodeOriented !== 'function')
    throw new Error('bro.image.decodeOriented unavailable in this build');

  async function runSweep(spec) {
    const name = spec.name;
    const values = spec.values || [];
    const render = spec.render;
    const signal = spec.signal || {};
    const onProgress = spec.onProgress || function () {};
    const animations = spec.animations || [];
    const frameName = spec.frameName || ((v) => sanitizeName(String(v)));
    if (!name) throw new Error('runSweep: name required');
    if (typeof render !== 'function') throw new Error('runSweep: render(value) required');
    animations.forEach((a) => requireEncoder(a.format || 'webm'));

    // Identity of this folder: the constants plus the sweep's own name. The
    // VALUES are deliberately not in it — adding steps to a sweep must reuse
    // the stills the earlier, coarser run already made.
    const sigFull = await sha256Hex(canonicalJson(spec.baseKey === undefined ? null : spec.baseKey) +
                                    '\n' + name);
    const sig = sigFull.slice(0, 12);
    const dir = path.join(root, sanitizeName(name), sig);
    fs.mkdirSync(dir, { recursive: true });

    const manPath = path.join(dir, 'manifest.json');
    const man = readJson(manPath, null) || {};
    if (!man.frames || typeof man.frames !== 'object') man.frames = {};
    if (!man.animations || typeof man.animations !== 'object') man.animations = {};
    man.version = 1;
    man.name = name;
    man.sig = sig;
    // Kept for the human reading the folder six months later, not for matching.
    man.baseKeyPreview = previewOf(spec.baseKey);

    const frames = [];
    let rendered = 0, reused = 0, cancelled = false;

    for (let i = 0; i < values.length; i++) {
      if (signal.cancelled) { cancelled = true; break; }
      const value = values[i];
      const file = 'v_' + sanitizeName(frameName(value)) + '.png';
      const fpath = path.join(dir, file);
      // Frame identity: the folder's signature already pins every constant, so
      // the value is all that is left to vary.
      const hash = await sha256Hex(sig + '|' + canonicalJson(value));
      const rec = man.frames[file];
      const have = rec && rec.hash === hash && fs.existsSync(fpath);

      if (have) {
        reused++;
        frames.push({ value: value, file: file, path: fpath, reused: true });
        onProgress({ done: i + 1, total: values.length, value: value, reused: true,
                     label: file + ' (already rendered)' });
        continue;
      }

      onProgress({ done: i, total: values.length, value: value, reused: false,
                   label: 'rendering ' + file });
      const out = await render(value);
      if (!out || !out.pixels || !out.width || !out.height)
        throw new Error('render(' + value + ') returned no pixels');
      bro.image.encodePngFile(fpath, out.pixels, out.width, out.height, 4);
      man.frames[file] = { value: value, hash: hash, width: out.width, height: out.height };
      // Written per frame, not at the end: a sweep killed mid-run (or cancelled)
      // must leave every finished frame reusable by the next run. A manifest
      // flushed only on completion would throw away an hour of renders.
      writeJson(manPath, man);
      rendered++;
      frames.push({ value: value, file: file, path: fpath, reused: false });
      onProgress({ done: i + 1, total: values.length, value: value, reused: false,
                   label: file });
    }

    // Animations only over the frames that exist. A cancelled sweep still packs
    // what it got — a partial walk is a useful thing to look at.
    const anims = [];
    for (let a = 0; a < animations.length; a++) {
      if (signal.cancelled) { cancelled = true; break; }
      const spec2 = animations[a];
      const packed = await packAnimation(dir, man, frames, spec2, name);
      if (packed) anims.push(packed);
      writeJson(manPath, man);
    }

    writeJson(manPath, man);
    return { dir: dir, sig: sig, frames: frames, rendered: rendered, reused: reused,
             animations: anims, cancelled: cancelled || !!signal.cancelled };
  }

  // One animation over an ordered frame list. Re-encodes only when the output is
  // missing, its recipe changed, or a frame in it was re-rendered this run.
  async function packAnimation(dir, man, frames, spec, sweepName) {
    if (frames.length === 0) return null;
    const format = spec.format || 'webm';
    const ms = Math.max(1, Math.round(spec.msPerFrame || 200));
    const pingPong = !!spec.pingPong;

    // Out and back, without repeating the endpoints, so a looping player runs
    // the walk forward then backward with no stutter at the turns.
    let order = frames.slice();
    if (pingPong && frames.length > 2) {
      order = order.concat(frames.slice(1, -1).reverse());
    }

    const base = spec.name || ('walk_' + frames.length + 'f_' + ms + 'ms' + (pingPong ? '_pp' : ''));
    const file = sanitizeName(base) + (format === 'gif' ? '.gif' : '.webm');
    const fpath = path.join(dir, file);
    const recipe = await sha256Hex(canonicalJson({
      format: format, ms: ms, pingPong: pingPong,
      frames: order.map((f) => f.file),
      quality: spec.quality || 'best',
    }));
    const prev = man.animations[file];
    const touched = order.some((f) => !f.reused);
    if (prev && prev.recipe === recipe && !touched && fs.existsSync(fpath)) {
      return { path: fpath, file: file, reused: true, frames: order.length,
               ms: ms, format: format };
    }

    // Decode every still back to RGBA. The stills are the source of truth: a
    // reused frame has no pixels in memory, and re-rendering one to encode a
    // video would defeat the entire point of the cache.
    const first = decodeFrame(order[0].path);
    const w = first.width, h = first.height;
    if (format !== 'gif' && (w % 2 || h % 2))
      throw new Error('VP9 needs even dimensions; got ' + w + 'x' + h);

    const rate = fpsForMs(ms);
    let enc;
    if (format === 'gif') {
      enc = new GifEncoder({ path: fpath, width: w, height: h,
                             delayCs: Math.max(1, Math.round(ms / 10)),
                             paletteBits: 8, loopCount: 0 });
    } else {
      // VP9 at 'best' with a generous bitrate: the deliverable is a showcase of
      // subtle per-frame differences, which is exactly what a thrifty encode
      // smears. Still an order of magnitude smaller than the equivalent GIF,
      // and true colour rather than a 256-entry palette.
      enc = new VideoEncoder({
        path: fpath, width: w, height: h,
        fps: rate.fps, fpsDen: rate.fpsDen,
        quality: spec.quality || 'best',
        keyframeIntervalSec: 1,
        bitrateKbps: spec.bitrateKbps || Math.max(2000, Math.round(w * h * 0.004)),
        threads: 4,
      });
    }
    try {
      for (let i = 0; i < order.length; i++) {
        const px = i === 0 ? first : decodeFrame(order[i].path);
        if (px.width !== w || px.height !== h)
          throw new Error('frame ' + order[i].file + ' is ' + px.width + 'x' + px.height +
                          ', expected ' + w + 'x' + h + ' — delete the folder to re-sweep at one size');
        enc.addFrameRGBA(px.pixels);
      }
    } finally {
      enc.finish();
    }
    man.animations[file] = { recipe: recipe, frames: order.length, ms: ms,
                             format: format, width: w, height: h };
    return { path: fpath, file: file, reused: false, frames: order.length,
             ms: ms, format: format };
  }

  function decodeFrame(p) {
    const img = bro.image.decodeOriented(new Uint8Array(fs.readFileSync(p)));
    if (!img || !img.pixels) throw new Error('could not decode ' + p);
    return img;
  }

  // A short, readable echo of the constants — enough to tell two sibling
  // signature folders apart by eye without re-deriving the hash.
  function previewOf(v) {
    try {
      const s = canonicalJson(v);
      return s.length > 2000 ? s.slice(0, 2000) + '…' : s;
    } catch (e) { return String(e.message || e); }
  }

  return { runSweep: runSweep, root: root };
}
