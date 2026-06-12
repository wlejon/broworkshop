// TripoSplat Lab — the 3D viewport.
//
// Owns the scene's GaussianSplatNode and a quaternion orbit camera (the shared
// /lib/camera.js 6DOF rig, so dragging never gimbal-locks or pins the rotation
// axis). The scene FBO clears transparent, so the canvas's CSS background shows
// through (the light/dark bg toggle is pure CSS, handled in app.js). Auto-rotate
// runs off rAF; the scene re-renders every frame in windowed mode, so moving the
// camera is enough.
(function () {
  'use strict';

  var DEFAULT_DIST = 2.2;

  function create(canvas) {
    var scene = canvas.getContext('scene');
    var node = null;

    // Quaternion orbit camera (gimbal-lock-free). The default pose is a slight
    // three-quarter swing with a small downward tilt — an upright, front-facing
    // view of the y-up reconstructed cloud. Stored so "reset view" restores it.
    var cam = Camera.createOrbit({ target: [0, 0, 0], dist: DEFAULT_DIST, fov: 45 });
    var DEFAULT_ROT = Camera.quatNorm(Camera.quatMul(
      Camera.quatFromAxis(0, 1, 0, 0.5),     // yaw: off straight-on, 3/4 view
      Camera.quatFromAxis(1, 0, 0, -0.22)));  // pitch: look slightly down

    var autoRotate = true;
    var scale = 1.0;

    // model-space bounds of the current cloud (pre-scale), for re-framing
    var bb = null;   // { cx, cy, cz, ext }

    function applyCamera() {
      scene.setCamera(Camera.orbitViewOpts(cam, canvas));
    }

    // Frame the camera so the whole cloud fits, keeping the current orientation.
    function reframe() {
      var pivot = bb ? [bb.cx * scale, bb.cy * scale, bb.cz * scale] : [0, 0, 0];
      var dist  = bb ? Math.max(0.4, bb.ext * scale * 1.7) : DEFAULT_DIST;
      Camera.orbitReframe(cam, pivot, dist);
      applyCamera();
    }

    // ── auto-rotate ───────────────────────────────────────────────────────
    var last = 0;
    function tick(t) {
      if (autoRotate && node && !dragging) {
        var dt = last ? (t - last) / 1000 : 0;
        // ~0.45 rad/s yaw around world +Y. orbitLook yaw = -dx * yawSpeed.
        Camera.orbitLook(cam, -(0.45 * dt) / cam.yawSpeed, 0);
        applyCamera();
      }
      last = t;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    // ── orbit / zoom input ────────────────────────────────────────────────
    var dragging = false;
    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      dragging = true;
      e.preventDefault();   // suppress text selection / focus while dragging
    });
    window.addEventListener('mouseup', function () { dragging = false; });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      // Direct-manipulation feel: drag the model, not the camera — so the
      // surface follows the cursor (drag right → the model turns right). That's
      // the opposite horizontal sense from orbitLook's orbit-the-camera dx.
      Camera.orbitLook(cam, -e.movementX, e.movementY);
      applyCamera();
    });
    canvas.addEventListener('wheel', function (e) {
      cam.dist = Math.max(0.3, Math.min(10, cam.dist * Math.exp(e.deltaY * 0.001)));
      applyCamera();
      e.preventDefault();
    });

    setPose(DEFAULT_ROT);

    function setPose(rot) {
      cam.rot = rot.slice();
      reframe();
    }

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

      // Reset orbit to the default front three-quarter view and re-frame.
      reset: function () { setPose(DEFAULT_ROT); },
    };
  }

  window.TSLab = window.TSLab || {};
  window.TSLab.Viewport = { create: create };
})();
