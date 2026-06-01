// Vision Lab — small shared helpers (no bro.vision in here).
//
// Image I/O: the engine's `Image` element decodes a file synchronously via
// broimage on `.src =`, so a file path round-trips to drawable+feedable pixels
// without a network or event-loop hop. bro.vision's image argument accepts
// either an ImageBitmap or an `{ data, width, height }` ImageData shape; we keep
// the canonical input as an ImageBitmap (drawable on the stage AND a valid
// vision input AND a WebGL texture source).
(function () {
  'use strict';

  // The app's absolute directory. The engine resolves `fs` relative paths
  // against the app dir, but `new Image().src` resolves against a process-global
  // base that other contexts (system panels) can clobber — so a bare
  // 'assets/x.png' is unreliable for image decode. Anchoring relative paths to
  // the real app dir (via fs.realpathSync('.')) makes decode deterministic in
  // both windowed and headless runs.
  var APP_BASE = '';
  try { APP_BASE = require('fs').realpathSync('.'); } catch (e) { APP_BASE = ''; }

  function isAbsolute(p) {
    return /^[a-zA-Z]:[\\/]/.test(p) || p.charAt(0) === '/' || p.charAt(0) === '\\';
  }

  // Resolve an app-relative path to an absolute one (idempotent on absolutes).
  function appPath(p) {
    if (!p || isAbsolute(p) || !APP_BASE) return p;
    return APP_BASE + '/' + p;
  }

  // Decode an image file to an ImageData { data, width, height }. Synchronous —
  // Image.src decodes inline and the canvas readback is immediate.
  function fileToImageData(path) {
    var img = new Image();
    img.src = appPath(path);                         // sync decode + onload
    var w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error('could not decode image: ' + path);
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    return cx.getImageData(0, 0, w, h);              // { data, width, height }
  }

  // Decode a file straight to a drawable ImageBitmap (async, web-standard).
  function fileToBitmap(path) {
    return createImageBitmap(fileToImageData(path));
  }

  // min / max / mean over a numeric typed array (skips NaN/Inf).
  function floatStats(arr) {
    var lo = Infinity, hi = -Infinity, sum = 0, n = 0;
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (v !== v || v === Infinity || v === -Infinity) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      sum += v; n++;
    }
    if (!n) return { min: 0, max: 0, mean: 0, n: 0 };
    return { min: lo, max: hi, mean: sum / n, n: n };
  }

  // Count occurrences of each Uint8 class id → [{ id, count }] sorted desc.
  function classHistogram(classes, topK) {
    var counts = {};
    for (var i = 0; i < classes.length; i++) {
      var c = classes[i];
      counts[c] = (counts[c] || 0) + 1;
    }
    var out = [];
    for (var k in counts) {
      if (counts.hasOwnProperty(k)) out.push({ id: +k, count: counts[k] });
    }
    out.sort(function (a, b) { return b.count - a.count; });
    return topK ? out.slice(0, topK) : out;
  }

  // Human-readable byte / count formatting for metadata panels.
  function fmtInt(n) { return n.toLocaleString ? n.toLocaleString() : '' + n; }

  window.VLab = window.VLab || {};
  window.VLab.Util = {
    appBase: APP_BASE,
    appPath: appPath,
    isAbsolute: isAbsolute,
    fileToImageData: fileToImageData,
    fileToBitmap: fileToBitmap,
    floatStats: floatStats,
    classHistogram: classHistogram,
    fmtInt: fmtInt,
  };
})();
