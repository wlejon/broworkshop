// =============================================================================
// SpatialHash3D headless integration test
//
// Verifies bro.math.SpatialHash3D against an independent brute-force reference
// for radiusQuery / queryAABB / nearest (points and spheres), exercises the
// mutators (insert / insertSphere / remove / clear / reset), checks the live
// getters, then drives the demo's own simulation a few frames and screenshots.
//
// Run:
//   bro-headless demos/spatial-hash demos/spatial-hash/test.js
// =============================================================================

var passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log("  ok  " + label); }
  else      { failed++; console.log("FAIL  " + label); }
}
function sortNum(a) { return a.slice().sort(function (x, y) { return x - y; }); }
function eqArr(a, b) {
  a = sortNum(a); b = sortNum(b);
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

console.log("\n=== SpatialHash3D integration tests ===\n");

// -----------------------------------------------------------------------------
// 1. Mutators + getters on a tiny known set
// -----------------------------------------------------------------------------
console.log("[1] Mutators + getters");
{
  var h = new bro.math.SpatialHash3D(2);
  check("global SpatialHash3D === bro.math.SpatialHash3D",
        SpatialHash3D === bro.math.SpatialHash3D);
  check("insert is chainable (returns this)", h.insert(0, 0, 0, 1) === h);
  h.insert(5, 0, 0, 2);
  check(".size counts inserts", h.size === 2);
  check(".cellSize reports cell size", h.cellSize === 2);
  check(".maxRadius is 0 for point-only", h.maxRadius === 0);

  h.insertSphere(20, 0, 0, 8, 3);
  check(".size includes spheres", h.size === 3);
  check(".maxRadius tracks largest sphere", h.maxRadius === 8);

  check("remove returns this", h.remove(2) === h);
  check(".size drops after remove", h.size === 2);
  check("removed id no longer found", eqArr(h.radiusQuery(5, 0, 0, 1), []));

  check("clear returns this", h.clear() === h);
  check(".size is 0 after clear", h.size === 0);
  check("clear keeps cell size", h.cellSize === 2);

  h.insert(1, 1, 1, 9);
  check("reset returns this", h.reset(5) === h);
  check("reset changes cell size", h.cellSize === 5);
  check("reset clears entries", h.size === 0);
}

// -----------------------------------------------------------------------------
// 2. Sphere dilation reach — the documented headline behaviour
// -----------------------------------------------------------------------------
console.log("\n[2] insertSphere dilation reach");
{
  var h = new bro.math.SpatialHash3D(4);
  h.insertSphere(20, 0, 0, 8, 3);    // center far, radius large
  // dist(center)=9 from (11,0,0); reach = r(1) + R(8) = 9 → match at the edge.
  check("sphere matched when surface in reach (dist 9 == 1+8)",
        eqArr(h.radiusQuery(11, 0, 0, 1), [3]));
  // dist(center)=10 from (10,0,0); reach=9 → no match (10 > 9).
  check("sphere NOT matched when surface out of reach (dist 10 > 9)",
        eqArr(h.radiusQuery(10, 0, 0, 1), []));
}

// -----------------------------------------------------------------------------
// 3. radiusQuery / queryAABB / nearest vs independent brute force
//    over a pseudo-random point+sphere cloud.
// -----------------------------------------------------------------------------
console.log("\n[3] Queries vs brute-force reference");
{
  // Deterministic LCG so the test is reproducible.
  var seed = 0x9e3779b1 >>> 0;
  function rnd() { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; }
  function rr(a, b) { return a + rnd() * (b - a); }

  var N = 1200, SPH = 40, RANGE = 400;
  var pts = [];     // {x,y,z}
  var sph = [];     // {x,y,z,r}
  var h = new bro.math.SpatialHash3D(30);

  for (var i = 0; i < N; i++) {
    var p = { x: rr(0, RANGE), y: rr(0, RANGE), z: rr(0, RANGE) };
    pts.push(p); h.insert(p.x, p.y, p.z, i);
  }
  var SBASE = 100000;
  for (var s = 0; s < SPH; s++) {
    var o = { x: rr(0, RANGE), y: rr(0, RANGE), z: rr(0, RANGE), r: rr(10, 50) };
    sph.push(o); h.insertSphere(o.x, o.y, o.z, o.r, SBASE + s);
  }
  check("cloud .size == N + SPH", h.size === N + SPH);

  function bruteRadius(qx, qy, qz, r) {
    var out = [], r2 = r * r;
    for (var i = 0; i < N; i++) {
      var p = pts[i], dx = p.x - qx, dy = p.y - qy, dz = p.z - qz;
      if (dx * dx + dy * dy + dz * dz <= r2) out.push(i);
    }
    for (var s = 0; s < SPH; s++) {
      var o = sph[s], dx2 = o.x - qx, dy2 = o.y - qy, dz2 = o.z - qz;
      var reach = r + o.r;
      if (dx2 * dx2 + dy2 * dy2 + dz2 * dz2 <= reach * reach) out.push(SBASE + s);
    }
    return out;
  }
  function bruteAABB(ax, ay, az, bx, by, bz) {
    var out = [];
    for (var i = 0; i < N; i++) {
      var p = pts[i];
      if (p.x >= ax && p.x <= bx && p.y >= ay && p.y <= by && p.z >= az && p.z <= bz) out.push(i);
    }
    for (var s = 0; s < SPH; s++) {
      var o = sph[s];
      // closest point on box to sphere center, sphere-box intersection.
      var cx = Math.min(Math.max(o.x, ax), bx);
      var cy = Math.min(Math.max(o.y, ay), by);
      var cz = Math.min(Math.max(o.z, az), bz);
      var dx = o.x - cx, dy = o.y - cy, dz = o.z - cz;
      if (dx * dx + dy * dy + dz * dz <= o.r * o.r) out.push(SBASE + s);
    }
    return out;
  }
  function bruteNearest(qx, qy, qz, maxR) {
    var best = -1, bd = maxR * maxR;
    for (var i = 0; i < N; i++) {
      var p = pts[i], dx = p.x - qx, dy = p.y - qy, dz = p.z - qz;
      var d = dx * dx + dy * dy + dz * dz;
      if (d <= bd) { bd = d; best = i; }   // <= so ties favour later, matches scan order loosely
    }
    // spheres: nearest is center-only too (radii ignored for .nearest).
    for (var s = 0; s < SPH; s++) {
      var o = sph[s], dx2 = o.x - qx, dy2 = o.y - qy, dz2 = o.z - qz;
      var d2 = dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
      if (d2 < bd) { bd = d2; best = SBASE + s; }   // strict < to not override a tied point
    }
    return best;
  }

  // Sample many query origins and radii; compare set-equality.
  var radOk = true, aabbOk = true, nearOk = true;
  var trials = 60;
  for (var t = 0; t < trials; t++) {
    var qx = rr(-50, RANGE + 50), qy = rr(-50, RANGE + 50), qz = rr(-50, RANGE + 50);
    var R = rr(15, 90);
    if (!eqArr(h.radiusQuery(qx, qy, qz, R), bruteRadius(qx, qy, qz, R))) radOk = false;

    var ax = rr(0, RANGE), az = rr(0, RANGE), ay = rr(0, RANGE);
    var bx = ax + rr(20, 150), by = ay + rr(20, 150), bz = az + rr(20, 150);
    if (!eqArr(h.queryAABB(ax, ay, az, bx, by, bz), bruteAABB(ax, ay, az, bx, by, bz))) aabbOk = false;

    // nearest: compare the *distance* to the returned id (id ties are fine as
    // long as the distance matches the brute optimum).
    var hid = h.nearest(qx, qy, qz, 1000);
    var bid = bruteNearest(qx, qy, qz, 1000);
    function distOf(id) {
      var ox, oy, oz;
      if (id < 0) return Infinity;
      if (id >= SBASE) { var o = sph[id - SBASE]; ox = o.x; oy = o.y; oz = o.z; }
      else { var p = pts[id]; ox = p.x; oy = p.y; oz = p.z; }
      var dx = ox - qx, dy = oy - qy, dz = oz - qz; return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    if (Math.abs(distOf(hid) - distOf(bid)) > 1e-4) nearOk = false;
  }
  check("radiusQuery matches brute force over " + trials + " trials", radOk);
  check("queryAABB matches brute force over " + trials + " trials", aabbOk);
  check("nearest matches brute-force optimum over " + trials + " trials", nearOk);

  // nearest respects maxRadius: a far query with a tight cap returns -1.
  check("nearest returns -1 when nothing within maxRadius",
        h.nearest(-10000, -10000, -10000, 5) === -1);
}

// -----------------------------------------------------------------------------
// 4. The demo's own pipeline is alive (app.js ran), then screenshot.
// -----------------------------------------------------------------------------
console.log("\n[4] Live demo pipeline + screenshot");
{
  advanceTime(50);   // let init() + a few rAF frames run
  var sh = globalThis.__sh;
  check("__sh test hook exposed by main.js", sh && typeof sh === 'object');
  if (sh) {
    check("flock populated (count > 0)", sh.count > 0);
    check("hash rebuilt to flock size", sh.hash.size >= sh.count);
    check("hash tracks sphere maxRadius (> 0)", sh.hash.maxRadius > 0);

    // Cross-check the running app's hash against its own brute reference at
    // a cursor position, proving the on-screen comparison is honest.
    sh.setMouse(sh.WORLD_W * 0.5, sh.WORLD_D * 0.5);
    sh.rebuildHash();
    var hq = sh.hash.radiusQuery(sh.WORLD_W * 0.5, 0, sh.WORLD_D * 0.5, 55);
    var bq = sh.bruteRadius(sh.WORLD_W * 0.5, 0, sh.WORLD_D * 0.5, 55);
    check("app hash radiusQuery == app brute reference (" + hq.length + " ids)",
          eqArr(hq, bq));
  }

  advanceTime(200);
  flush();
  screenshot('spatial-hash.png');
  console.log("  screenshot: spatial-hash.png");
}

console.log("\n=== " + passed + " passed, " + failed + " failed ===\n");
assert(failed === 0, failed + " SpatialHash3D test(s) failed");
