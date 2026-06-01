// Vision Lab — SAM session controller.
//
// Wraps a loaded Sam model and the interactive prompt state (foreground /
// background points + an optional box). The app feeds it image-space clicks
// from the stage; it owns the setImage encode (async) and the per-prompt
// segment() decode (synchronous against the cached embedding), plus the
// automatic "segment everything" generator. Pure logic — no DOM — so the app
// keeps full control of layout and the stage owns all drawing.
(function () {
  'use strict';

  function create() {
    var model = null;        // native Sam handle
    var encoded = false;     // setImage() embedding is cached
    var points = [];         // [[x,y], ...] image-space
    var labels = [];         // [1|0, ...] foreground / background
    var box = null;          // [x1,y1,x2,y2] image-space, or null
    var inflight = null;     // AsyncHandle of an encode in flight

    function reset() { points = []; labels = []; box = null; }

    return {
      setModel: function (m) { model = m; encoded = false; reset(); },
      hasModel: function () { return !!model; },
      isEncoded: function () { return encoded; },
      device: function () { return model ? model.device : '—'; },

      // Encode the image (slow ViT pass) — async via onDone. Cancels any
      // previous encode. cb(err) on completion.
      setImage: function (image, cb) {
        if (!model) { cb && cb(new Error('no SAM model loaded')); return; }
        if (inflight) { try { inflight.cancel(); } catch (e) {} inflight = null; }
        encoded = false; reset();
        inflight = model.setImage(image, {
          onDone: function (_r, info) {
            inflight = null;
            if (info && info.cancelled) { cb && cb(new Error('cancelled')); return; }
            if (info && info.error) { cb && cb(new Error(info.error)); return; }
            encoded = true;
            cb && cb(null);
          },
        });
      },

      cancelEncode: function () {
        if (inflight) { try { inflight.cancel(); } catch (e) {} inflight = null; }
      },

      // ── prompt state ─────────────────────────────────────────────────────
      addPoint: function (x, y, foreground) {
        points.push([Math.round(x), Math.round(y)]);
        labels.push(foreground ? 1 : 0);
      },
      setBox: function (x1, y1, x2, y2) {
        box = [Math.round(Math.min(x1, x2)), Math.round(Math.min(y1, y2)),
               Math.round(Math.max(x1, x2)), Math.round(Math.max(y1, y2))];
      },
      clearPrompts: reset,
      hasPrompts: function () { return points.length > 0 || !!box; },
      prompts: function () { return { points: points, labels: labels, box: box }; },

      // ── decode against the cached embedding (synchronous) ────────────────
      segment: function (multimask) {
        if (!encoded) throw new Error('call setImage first');
        if (!points.length && !box) throw new Error('add a point or box first');
        var opts = { multimask: multimask !== false };
        if (points.length) { opts.points = points; opts.labels = labels; }
        if (box) opts.boxes = [box];
        return model.segment(opts);
      },

      // ── automatic mask generator — async via onDone ──────────────────────
      segmentEverything: function (image, params, cb) {
        if (!model) { cb && cb(new Error('no SAM model loaded')); return null; }
        var opts = {};
        for (var k in params) if (params.hasOwnProperty(k)) opts[k] = params[k];
        opts.onDone = function (r, info) {
          if (info && info.cancelled) { cb && cb(new Error('cancelled')); return; }
          if (info && info.error) { cb && cb(new Error(info.error)); return; }
          cb && cb(null, r);
        };
        return model.segmentEverything(image, opts);
      },
    };
  }

  window.VLab = window.VLab || {};
  window.VLab.Sam = { create: create };
})();
