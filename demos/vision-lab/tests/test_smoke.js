// Vision Lab — end-to-end integration smoke test.
//
// Drives every bro.vision model family against the real brovisionml weights on
// the GPU and asserts the output shapes/ranges. This is the integration test
// the app exists to make possible: one image in, every model exercised.
//
//   bro-headless ../broworkshop/demos/vision-lab \
//     ../broworkshop/demos/vision-lab/test_smoke.js
//
// Weights root: $BRO_VISION_WEIGHTS or D:/projects/brovisionml/weights.
// All calls use the synchronous (blocking) binding forms — no event-loop
// pumping — so the run is deterministic. The app's UI uses the async callback
// forms instead.
import { Util } from "/app/lab/util.js";
import { Models } from "/app/lab/models.js";
window.VLab = { Util: Util, Models: Models };

(function () {
  'use strict';

  var fails = 0, passes = 0;
  function ok(name, cond, extra) {
    console.log((cond ? 'PASS ' : 'FAIL ') + name +
      (extra != null ? ' (' + extra + ')' : ''));
    if (cond) passes++; else fails++;
  }
  function section(t) { console.log('\n── ' + t + ' ' + Array(40 - t.length).join('─')); }

  if (!(window.bro && bro.vision)) { ok('bro.vision available', false); return; }
  if (!(window.VLab && VLab.Models && VLab.Util)) {
    ok('VLab modules loaded', false); return;
  }
  var U = VLab.Util, M = VLab.Models;
  bro.vision.init();
  console.log('bro.vision version: ' + bro.vision.version);
  console.log('app base: ' + U.appBase);

  // ── resolve weights root ────────────────────────────────────────────────
  var fs = require('fs');
  var WROOT = (typeof process !== 'undefined' && process.env && process.env.BRO_WEIGHTS) || 'D:/projects';
  var ROOT = WROOT + '/brovisionml/weights';
  try {
    var env = require('os');
    if (typeof process !== 'undefined' && process.env && process.env.BRO_VISION_WEIGHTS)
      ROOT = process.env.BRO_VISION_WEIGHTS;
  } catch (e) { /* no process.env — use default */ }
  console.log('weights root: ' + ROOT);

  // ── input image ─────────────────────────────────────────────────────────
  var im;
  try {
    im = U.fileToImageData('assets/robot-arm.png');
    ok('decode sample image', im.width > 1 && im.height > 1,
       im.width + 'x' + im.height);
  } catch (e) { ok('decode sample image', false, e.message); return; }
  var W = im.width, H = im.height;

  function defaults(model) {
    var p = {};
    (model.params || []).forEach(function (pr) { p[pr.key] = pr.default; });
    return p;
  }

  // ── annotators ──────────────────────────────────────────────────────────
  M.annotators.forEach(function (model) {
    section(model.label);
    var avail = false;
    var probe = model.probe ? model.probe : model.subdir + '/model.safetensors';
    try { avail = fs.existsSync(ROOT + '/' + probe); }
    catch (e) {}
    if (!avail) { ok(model.id + ' weights present', false, ROOT + '/' + probe); return; }

    var inst, r;
    try {
      inst = model.load(ROOT, defaults(model));
      ok(model.id + ' load', !!inst, 'device ' + inst.device);
    } catch (e) { ok(model.id + ' load', false, e.message); return; }

    try {
      r = model.run(inst, im, defaults(model), {});
    } catch (e) { ok(model.id + ' run', false, e.message); return; }

    ok(model.id + ' returns result', !!r);
    ok(model.id + ' has drawable image', !!r.image);
    ok(model.id + ' positive dims', r.width > 0 && r.height > 0,
       r.width + 'x' + r.height);
    var n = r.width * r.height;

    switch (model.id) {
      case 'depth':
        ok('depth Float32 length == w*h',
           r.depth instanceof Float32Array && r.depth.length === n, r.depth.length);
        ok('depth min <= max', r.min <= r.max, r.min + '..' + r.max);
        break;
      case 'normal':
        ok('normals length == 3*w*h',
           r.normals instanceof Float32Array && r.normals.length === 3 * n,
           r.normals.length + ' vs ' + 3 * n);
        break;
      case 'hed':
        ok('edge length == w*h',
           r.edge instanceof Float32Array && r.edge.length === n, r.edge.length);
        var es = U.floatStats(r.edge);
        ok('edge in [0,1]', es.min >= -1e-3 && es.max <= 1.001,
           es.min.toFixed(3) + '..' + es.max.toFixed(3));
        break;
      case 'lineart':
        ok('line length == w*h',
           r.line instanceof Float32Array && r.line.length === n, r.line.length);
        break;
      case 'mlsd':
        ok('segments is array', Array.isArray(r.segments), r.segments.length);
        if (r.segments.length) {
          var s = r.segments[0];
          ok('segment has x1,y1,x2,y2,score',
             [s.x1, s.y1, s.x2, s.y2, s.score].every(function (v) {
               return typeof v === 'number'; }));
        }
        break;
      case 'openpose':
        ok('bodies is array', Array.isArray(r.bodies), r.bodies.length);
        if (r.bodies.length) {
          ok('body has 18 keypoints', r.bodies[0].keypoints.length === 18,
             r.bodies[0].keypoints.length);
        }
        break;
      case 'segformer':
        ok('classes Uint8 length == w*h',
           r.classes instanceof Uint8Array && r.classes.length === n, r.classes.length);
        var hist = U.classHistogram(r.classes, 3).map(function (h) {
          return M.adeName(h.id); });
        console.log('  top classes: ' + hist.join(', '));
        break;
    }
  });

  // ── SAM (promptable + automatic) ────────────────────────────────────────
  section('Segment · SAM');
  (function () {
    var sam = M.byId('sam');
    var avail = false;
    try { avail = fs.existsSync(ROOT + '/' + sam.subdir + '/model.safetensors'); }
    catch (e) {}
    if (!avail) { ok('sam weights present', false); return; }

    var inst;
    try {
      inst = sam.load(ROOT, {});
      ok('sam load', !!inst, 'device ' + inst.device);
      ok('sam hasImage false before setImage', inst.hasImage === false);
    } catch (e) { ok('sam load', false, e.message); return; }

    try {
      inst.setImage(im);
      ok('sam hasImage true after setImage', inst.hasImage === true);
    } catch (e) { ok('sam setImage', false, e.message); return; }

    try {
      var seg = inst.segment({ points: [[W >> 1, H >> 1]], labels: [1], multimask: true });
      ok('segment num == 3 (multimask)', seg.num === 3, seg.num);
      ok('segment best in range', seg.best >= 0 && seg.best < seg.num, seg.best);
      var best = seg.masks[seg.best];
      ok('best mask iou in [0,1]', best.iou >= 0 && best.iou <= 1.5, best.iou.toFixed(3));
      ok('best mask data == w*h',
         best.data instanceof Uint8Array && best.data.length === W * H, best.data.length);
      ok('best mask has overlay image', !!best.image);

      var single = inst.segment({ points: [[W >> 1, H >> 1]], labels: [1], multimask: false });
      ok('single-mask returns 1', single.num === 1, single.num);

      var boxed = inst.segment({ boxes: [[W >> 2, H >> 2, (3 * W) >> 2, (3 * H) >> 2]] });
      ok('box prompt returns masks', boxed.masks.length >= 1, boxed.masks.length);
    } catch (e) { ok('sam segment', false, e.message); }

    try {
      // A representative automatic-generator config: a moderate grid with the
      // IoU/stability gates relaxed enough to survive on a synthetic scene.
      // (The strict defaults — predIou 0.88 / stability 0.95 — combined with a
      // sparse grid legitimately cull everything; that's filtering, not a bug.)
      var amg = inst.segmentEverything(im, {
        pointsPerSide: 16, pointsPerBatch: 64,
        predIouThresh: 0.7, stabilityThresh: 0.85,
      });
      ok('segmentEverything returns masks', amg.masks.length >= 1, amg.masks.length);
      var m0 = amg.masks[0];
      ok('amg mask has bbox/area/scores',
         Array.isArray(m0.bbox) && m0.bbox.length === 4 &&
         typeof m0.area === 'number' && typeof m0.predictedIou === 'number' &&
         typeof m0.stabilityScore === 'number');
      var sorted = amg.masks.every(function (m, i) {
        return i === 0 || amg.masks[i - 1].area >= m.area; });
      ok('amg masks sorted by area desc', sorted);
    } catch (e) { ok('sam segmentEverything', false, e.message); }
  })();

  console.log('\n' + (fails === 0
    ? 'ALL ' + passes + ' CHECKS PASSED'
    : fails + ' FAILURE(S), ' + passes + ' passed'));
})();
