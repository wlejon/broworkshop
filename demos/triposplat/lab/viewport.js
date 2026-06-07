// TripoSplat Lab — the 3D viewport.
//
// Owns the scene's GaussianSplatNode and an orbit camera. The scene FBO clears
// transparent, so the canvas's CSS background shows through (the light/dark bg
// toggle is pure CSS, handled in app.js). Auto-rotate runs off rAF; the scene
// re-renders every frame in windowed mode, so moving the camera is enough.
(function () {
  'use strict';

  function create(canvas) {
    var scene = canvas.getContext('scene');
    var node = null;

    // orbit state
    var az = 0.6, el = 0.25, radius = 2.2;
    var target = [0, 0, 0];
    var autoRotate = true;
    var scale = 1.0;

    // model-space bounds of the current cloud (pre-scale), for re-framing
    var bb = null;   // { cx, cy, cz, ext }

    function applyCamera() {
      var cx = target[0] + radius * Math.cos(el) * Math.sin(az);
      var cy = target[1] + radius * Math.sin(el);
      var cz = target[2] + radius * Math.cos(el) * Math.cos(az);
      scene.setCamera({ position: [cx, cy, cz], target: target, fov: 45 });
    }

    // Frame the camera so the whole cloud fits, keeping the current azimuth.
    function reframe() {
      if (!bb) { target = [0, 0, 0]; radius = 2.2; applyCamera(); return; }
      target = [bb.cx * scale, bb.cy * scale, bb.cz * scale];
      radius = Math.max(0.4, bb.ext * scale * 1.7);
      applyCamera();
    }

    // ── auto-rotate ───────────────────────────────────────────────────────
    var last = 0;
    function tick(t) {
      if (autoRotate && node) {
        var dt = last ? (t - last) / 1000 : 0;
        az -= dt * 0.45;          // rad/s
        applyCamera();
      }
      last = t;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    // ── orbit / zoom input ────────────────────────────────────────────────
    var dragging = false, lx = 0, ly = 0;
    canvas.addEventListener('mousedown', function (e) {
      dragging = true; lx = e.clientX; ly = e.clientY;
    });
    window.addEventListener('mouseup', function () { dragging = false; });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      az -= (e.clientX - lx) * 0.01;
      el = Math.max(-1.4, Math.min(1.4, el + (e.clientY - ly) * 0.01));
      lx = e.clientX; ly = e.clientY;
      applyCamera();
    });
    canvas.addEventListener('wheel', function (e) {
      radius = Math.max(0.3, Math.min(10, radius * (1 + Math.sign(e.deltaY) * 0.08)));
      applyCamera();
      e.preventDefault();
    });

    applyCamera();

    // ── public API ────────────────────────────────────────────────────────
    function computeBounds(cloud) {
      var p = cloud && cloud.positions;
      if (!p || !p.length) return null;
      var n = (p.length / 3) | 0;
      var minx = 1e9, miny = 1e9, minz = 1e9, maxx = -1e9, maxy = -1e9, maxz = -1e9;
      for (var i = 0; i < n; i++) {
        var x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
        if (x < minx) minx = x; if (y < miny) miny = y; if (z < minz) minz = z;
        if (x > maxx) maxx = x; if (y > maxy) maxy = y; if (z > maxz) maxz = z;
      }
      var ext = Math.max(maxx - minx, maxy - miny, maxz - minz) || 1;
      return { cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, cz: (minz + maxz) / 2, ext: ext };
    }

    return {
      // Replace the rendered cloud and frame it. `cloud` is the SoA object
      // bro.triposplat.generate returns.
      setCloud: function (cloud) {
        if (node) { node.destroy(); node = null; }
        bb = computeBounds(cloud);
        node = scene.createGaussianSplat({ name: 'splat', cloud: cloud, scale: scale });
        reframe();
      },

      hasCloud: function () { return !!node; },

      splatCount: function () { return node ? node.splatCount : 0; },

      // Write the live cloud to a .ply (throws on failure, like the binding).
      savePly: function (path) {
        if (!node) throw new Error('nothing to save');
        return node.savePly(path);
      },

      setAutoRotate: function (on) { autoRotate = !!on; },

      // Uniform scale applied to the splat node; re-frames so it stays centered.
      setScale: function (s) {
        scale = (isFinite(s) && s > 0) ? s : 1;
        if (node) { node.scaleX = scale; node.scaleY = scale; node.scaleZ = scale; }
        reframe();
      },

      // Reset orbit to the default three-quarter view and re-frame.
      reset: function () { az = 0.6; el = 0.25; reframe(); },
    };
  }

  window.TSLab = window.TSLab || {};
  window.TSLab.Viewport = { create: create };
})();
