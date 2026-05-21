// Viewport — draws the decoded image and an optional attention heatmap.
//
// The <canvas> fills its container via CSS (htmlayout lays a canvas out from
// CSS width/height, not from its drawing-buffer attributes). The drawing
// buffer is sized to the displayed pixels; the image is contain-fitted
// inside it, and the heatmap composites over the same rect.
(function () {
  'use strict';

  // turbo-lite ramp: low magnitude → cool/dark, high → hot.
  var STOPS = [
    [0.00, 30, 40, 90],
    [0.35, 40, 150, 200],
    [0.65, 240, 200, 60],
    [1.00, 240, 60, 50],
  ];
  function ramp(t) {
    if (t <= 0) return STOPS[0];
    for (var i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0]) {
        var a = STOPS[i - 1], b = STOPS[i];
        var f = (t - a[0]) / (b[0] - a[0]);
        return [a[1] + (b[1] - a[1]) * f,
                a[2] + (b[2] - a[2]) * f,
                a[3] + (b[3] - a[3]) * f];
      }
    }
    return STOPS[STOPS.length - 1];
  }

  function create(canvasEl) {
    var ctx = canvasEl.getContext('2d');
    var base = document.createElement('canvas');   // native-res image cache
    var heat = document.createElement('canvas');   // heatmap grid cache
    var hasImage = false;
    var overlay = null;       // { grid:{w,h,values}, opacity }
    var imgW = 0, imgH = 0;   // native image dimensions

    // Match the drawing buffer to the canvas's displayed CSS size.
    function syncSize() {
      var w = canvasEl.clientWidth || canvasEl.parentElement &&
              canvasEl.parentElement.clientWidth || 512;
      var h = canvasEl.clientHeight || canvasEl.parentElement &&
              canvasEl.parentElement.clientHeight || 512;
      if (canvasEl.width !== w) canvasEl.width = w;
      if (canvasEl.height !== h) canvasEl.height = h;
    }

    // Contain-fit rect for the native image inside the drawing buffer.
    function fitRect() {
      var cw = canvasEl.width, ch = canvasEl.height;
      var scale = Math.min(cw / imgW, ch / imgH);
      var dw = imgW * scale, dh = imgH * scale;
      return { x: (cw - dw) / 2, y: (ch - dh) / 2, w: dw, h: dh };
    }

    function redraw() {
      syncSize();
      ctx.fillStyle = '#0a0b0f';
      ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
      if (!hasImage) return;

      // 5-arg drawImage (whole source, scaled into the dst rect) — the
      // 9-arg source-rect form mis-scales in this engine.
      var r = fitRect();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(base, r.x, r.y, r.w, r.h);

      if (overlay && overlay.grid) {
        ctx.save();
        ctx.globalAlpha = overlay.opacity;
        ctx.drawImage(heat, r.x, r.y, r.w, r.h);
        ctx.restore();
      }
    }

    // img — { width, height, data:Uint8ClampedArray (RGBA) }
    function setImage(img) {
      if (base.width !== img.width || base.height !== img.height) {
        base.width = img.width;
        base.height = img.height;
      }
      var bctx = base.getContext('2d');
      var id = bctx.createImageData(img.width, img.height);
      id.data.set(img.data);
      bctx.putImageData(id, 0, 0);

      imgW = img.width;
      imgH = img.height;
      hasImage = true;
      redraw();
    }

    // grid — { w, h, values:Float32Array (0..1, row-major) } or null
    function setOverlay(grid, opacity) {
      if (!grid) { overlay = null; redraw(); return; }
      heat.width = grid.w;
      heat.height = grid.h;
      var hctx = heat.getContext('2d');
      var id = hctx.createImageData(grid.w, grid.h);
      for (var i = 0; i < grid.values.length; i++) {
        var t = grid.values[i];
        if (t < 0) t = 0; else if (t > 1) t = 1;
        var c = ramp(t);
        var o = i * 4;
        id.data[o] = c[0]; id.data[o + 1] = c[1]; id.data[o + 2] = c[2];
        // alpha tracks magnitude so weak attention stays see-through while
        // hot regions read clearly.
        id.data[o + 3] = Math.round((0.15 + 0.85 * t) * t * 255);
      }
      hctx.putImageData(id, 0, 0);
      overlay = { grid: grid, opacity: opacity == null ? 0.7 : opacity };
      redraw();
    }

    function setOpacity(opacity) {
      if (overlay) { overlay.opacity = opacity; redraw(); }
    }

    function clear() {
      hasImage = false;
      overlay = null;
      redraw();
    }

    return {
      setImage: setImage,
      setOverlay: setOverlay,
      setOpacity: setOpacity,
      clear: clear,
      resize: function () { redraw(); },
      hasImage: function () { return hasImage; },
    };
  }

  window.DLab = window.DLab || {};
  window.DLab.Viewport = { create: create };
})();
