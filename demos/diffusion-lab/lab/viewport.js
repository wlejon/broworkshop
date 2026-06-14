// Viewport — draws the current frame and an optional attention heatmap.
//
// Both the frame and the heatmap are ImageBitmaps drawn straight onto the
// in-DOM <canvas>. There are no offscreen canvases: frames arrive as
// ImageBitmaps (built in the worker, transferred zero-copy) and drawImage
// scales them on the GPU; the heatmap is colour-mapped into an ImageBitmap
// once per change. An immutable ImageBitmap uploads to a GPU texture exactly
// once, so scrubbing back and forth re-draws with no re-upload.
  // turbo-lite ramp for the attention heatmap LUT: low → cool, high → hot.
  var HEAT_STOPS = [
    [0.00, 30, 40, 90],
    [0.35, 40, 150, 200],
    [0.65, 240, 200, 60],
    [1.00, 240, 60, 50],
  ];

  function create(canvasEl) {
    // The <canvas> is in the DOM, so getContext caches — fetch it once.
    var ctx = canvasEl.getContext('2d');
    var heatLut = (window.bro && bro.image)
      ? bro.image.gradient(HEAT_STOPS) : null;

    var frame = null;          // current frame ImageBitmap (owned by app frames[])
    var overlay = null;        // current heatmap ImageBitmap (owned here)
    var overlayOpacity = 0.7;
    var overlayToken = 0;      // guards against out-of-order async overlay builds

    // Match the drawing buffer to the canvas's displayed CSS size.
    function syncSize() {
      var w = canvasEl.clientWidth || (canvasEl.parentElement &&
              canvasEl.parentElement.clientWidth) || 512;
      var h = canvasEl.clientHeight || (canvasEl.parentElement &&
              canvasEl.parentElement.clientHeight) || 512;
      if (canvasEl.width !== w) canvasEl.width = w;
      if (canvasEl.height !== h) canvasEl.height = h;
    }

    // Contain-fit rect for the frame inside the drawing buffer.
    function fitRect() {
      var cw = canvasEl.width, ch = canvasEl.height;
      var scale = Math.min(cw / frame.width, ch / frame.height);
      var dw = frame.width * scale, dh = frame.height * scale;
      return { x: (cw - dw) / 2, y: (ch - dh) / 2, w: dw, h: dh };
    }

    function redraw() {
      syncSize();
      ctx.fillStyle = '#0a0b0f';
      ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
      if (!frame) return;

      var r = fitRect();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(frame, r.x, r.y, r.w, r.h);

      if (overlay) {
        ctx.save();
        ctx.globalAlpha = overlayOpacity;
        ctx.drawImage(overlay, r.x, r.y, r.w, r.h);
        ctx.restore();
      }
    }

    // bmp — an ImageBitmap. The viewport only *borrows* it; the frame store
    // in app.js owns it and is responsible for close().
    function setImage(bmp) {
      frame = bmp;
      redraw();
    }

    // grid — { w, h, values:Float32Array (0..1, row-major) } or null.
    function setOverlay(grid, opacity) {
      if (opacity != null) overlayOpacity = opacity;
      var token = ++overlayToken;
      if (overlay) { overlay.close(); overlay = null; }
      if (!grid) { redraw(); return; }

      var n = grid.w * grid.h;
      var rgba = new Uint8ClampedArray(n * 4);
      if (heatLut) {
        bro.image.lookup(rgba, grid.values, heatLut, { lo: 0, hi: 1 });
      }
      // Alpha tracks magnitude so weak attention stays see-through while hot
      // regions read clearly.
      for (var i = 0; i < n; i++) {
        var t = grid.values[i];
        if (t < 0) t = 0; else if (t > 1) t = 1;
        rgba[i * 4 + 3] = Math.round((0.15 + 0.85 * t) * t * 255);
      }
      createImageBitmap({ width: grid.w, height: grid.h, data: rgba })
        .then(function (bmp) {
          if (token !== overlayToken) { bmp.close(); return; }  // superseded
          overlay = bmp;
          redraw();
        });
    }

    function setOpacity(opacity) {
      overlayOpacity = opacity;
      redraw();
    }

    function clear() {
      frame = null;   // app frames[] owns frame bitmaps — don't close here
      if (overlay) { overlay.close(); overlay = null; }
      redraw();
    }

    return {
      setImage: setImage,
      setOverlay: setOverlay,
      setOpacity: setOpacity,
      clear: clear,
      resize: function () { redraw(); },
      hasImage: function () { return !!frame; },
    };
  }

  export const Viewport = { create: create };
