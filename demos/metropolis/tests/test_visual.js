// The metropolis acceptance list, rendered: what test_city.js cannot see.
//  - a still view renders the same twice, and a view left and returned to
//    renders the same (no state left behind: shadow pages, LOD, ground);
//  - dollying out from the street to 3 km over a clear path, no step changes
//    the frame much more than the steps either side (no LOD pops: shape or
//    colour changing at a distance);
//  - strafing, fixed points of the ground keep their brightness (no shadow
//    swim: the shadows stay put in the world as the eye moves).
// Time is paused (traffic, sky, wind still), interiors off.
//
//   bro-headless --grant files demos/metropolis tests/test_visual.js

import { frames, waitFor } from "/lib/kit/test.js";
import { riverCenterX, terrainHeight } from "/app/world/terrain_field.js";
import { massRecord } from "/lib/city/interior.js";
waitFor(() => Boolean(globalThis.__metropolis), "mounted", 60000);
const m = globalThis.__metropolis;
let ready = false; m.whenReady().then(() => { ready = true; });
waitFor(() => ready, "ready", 240000);
document.getElementById('hud').hidden = true;
function look(eye, target) {
  const dx = target[0]-eye[0], dy = target[1]-eye[1], dz = target[2]-eye[2];
  m.setPose(eye, Math.atan2(-dx,-dz), Math.atan2(dy, Math.hypot(dx,dz)));
}
const rx = riverCenterX(0), g = (x,z)=>terrainHeight(x,z);
// A downtown road from the graph (not a point inside a block): the longest
// street edge whose middle is within 600 m of the centre left of the river.
const G = m.city.graph;
// The canyon: the edge over 150 m with the most towers (h > 40 m) within 40 m of its middle.
const MD = m.city.masses.data, nM = MD.length / 16, towers = [];
for (let i = 0; i < nM; i++) { const M = massRecord(MD, i); if (M.h > 40) towers.push(M); }
let road = null, best = 0, bestScore = -1;
for (const e of G.edges) {
  if (e.kind === 'bridge') continue;
  const p = e.pts, n = p.length / 2, mx = p[(n >> 1) * 2], mz = p[(n >> 1) * 2 + 1];
  let len = 0; for (let i = 1; i < n; i++) len += Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
  if (len < 150) continue;
  let score = 0; for (const M of towers) if (Math.abs(M.cx - mx) < 60 && Math.abs(M.cz - mz) < 60 && Math.hypot(M.cx - mx, M.cz - mz) < 40 + Math.max(M.hw, M.hd)) score++;
  if (score > bestScore) { bestScore = score; best = len; road = e; }
}
// A point s metres along the road and the point 60 m on, at height h.
const along = (s0) => {
  const p = road.pts, n = p.length / 2;
  let acc = 0;
  for (let i = 1; i < n; i++) {
    const l = Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
    if (acc + l >= s0 || i === n - 1) { const t = Math.min(1, (s0 - acc) / l); return [p[2 * i - 2] + (p[2 * i] - p[2 * i - 2]) * t, p[2 * i - 1] + (p[2 * i + 1] - p[2 * i - 1]) * t]; }
    acc += l;
  }
};
const roadView = (s0, h) => { const [x, z] = along(s0), [tx, tz] = along(s0 + 60); return [[x, g(x, z) + h, z], [tx, g(tx, tz) + h + 1, tz]]; };

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
m.interiors.enabled = false;
bro.time.paused = true;
const shot = () => { frames(2); return frameImage(); };
const ssim = (a, b) => bro.eye.compare(a, b).ssim;
const views = {
  street: roadView(best * 0.3, 1.7),
  flyover: [[rx + 300, 420, 900], [rx - 400, 0, 0]],
  high: [[0, 1800, 3500], [0, 0, 0]],
};

// Still and returned-to views.
look(...views.street); frames(10);
check(ssim(shot(), shot()) > 0.999, 'a still view renders the same twice');
for (const tm of ['day', 'night']) {
  m.setTimeMode(tm);
  for (const [name, v] of Object.entries(views)) {
    look(...v); frames(20); const A = shot();
    for (let i = 0; i < 30; i++) { look([v[0][0] + 1500 + i * 40, 300, v[0][2] - 800], [0, 0, 0]); frames(1); }
    look(...v); frames(20);
    const s = ssim(A, shot());
    check(s > 0.99, `${tm} ${name} the same after flying away and back (ssim ${s.toFixed(4)})`);
  }
}

// The dolly.
const allM = []; for (let i = 0; i < nM; i++) allM.push(massRecord(MD, i));
function blocked(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  for (const M of allM) {
    if (Math.hypot(M.cx - a[0], M.cz - a[2]) > Math.hypot(dx, dz) + 300 && Math.hypot(M.cx - b[0], M.cz - b[2]) > 300) continue;
    const c = Math.cos(M.yaw), s = Math.sin(M.yaw);
    const ox = a[0] - M.cx, oz = a[2] - M.cz;
    const lx = c * ox - s * oz, lz = s * ox + c * oz, ldx = c * dx - s * dz, ldz = s * dx + c * dz;
    let t0 = 0, t1 = 1;
    const slab = (o, d, lo, hi) => { if (Math.abs(d) < 1e-9) return o >= lo && o <= hi; let p = (lo - o) / d, q = (hi - o) / d; if (p > q) [p, q] = [q, p]; t0 = Math.max(t0, p); t1 = Math.min(t1, q); return t0 <= t1; };
    if (slab(lx, ldx, -M.hw - 2, M.hw + 2) && slab(lz, ldz, -M.hd - 2, M.hd + 2) && slab(a[1], dy, M.y0 - 1, M.y0 + M.h + (M.roofH || 0) + 2)) return true;
  }
  return false;
}
const [cx, cz] = along(best * 0.5);
const tgt = [cx, g(cx, cz) + 3, cz];
let dir = null;
for (const el of [0.3, 0.45, 0.6]) for (let az = 0; az < 360 && !dir; az += 7.5) {
  const a = az * Math.PI / 180, dd = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
  let ok = true;
  for (let d = 25; d < 3000 && ok; d *= 1.05) { const e = [tgt[0] + dd[0] * d, tgt[1] + dd[1] * d, tgt[2] + dd[2] * d]; if (e[1] < g(e[0], e[2]) + 2 || blocked(e, tgt)) ok = false; }
  if (ok) dir = dd;
}
m.setTimeMode('day'); frames(5);
{
  let prev = null; const out = [];
  for (let d = 25; d < 3000; d *= 1.012) {
    look([tgt[0] + dir[0] * d, tgt[1] + dir[1] * d, tgt[2] + dir[2] * d], tgt);
    const f = shot();
    if (prev) out.push([d, ssim(prev, f)]);
    prev = f;
  }
  // A pop is one step well below the steps either side (moving alone
  // changes every step about alike).
  let worst = 0, at = 0;
  for (let i = 1; i < out.length; i++) {
    const w = out.slice(Math.max(1, i - 6), i + 7).map((x) => x[1]).sort((p, q) => p - q);
    const drop = w[w.length >> 1] - out[i][1];
    if (drop > worst) { worst = drop; at = out[i][0]; }
  }
  check(worst < 0.1, `dollying out 25 m to 3 km, no step stands out from its neighbours (largest dip ${worst.toFixed(3)} at ${at.toFixed(0)} m)`);
}

// Shadow swim: ground points (not behind a building, trees drawn as shadows
// only, cars hidden) followed while the eye moves 8 m.
for (const n of m.cars.nodes) n.visible = false;
for (const n of m.trees.nodes) if (!n.shadowOnly) n.visible = false;
const canvas = document.querySelector('canvas');
const cssW = canvas.getBoundingClientRect().width;
function groundHit(o, d) {
  let t = 0;
  for (let k = 0; k < 4000; k++) { t += 0.25; const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t; if (y <= g(x, z)) return [x, g(x, z), z]; if (t > 400) return null; }
  return null;
}
function lum(img, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, W = img.width;
  const L = (i, j) => { const k = (j * W + i) * 4; return 0.2126 * img.data[k] + 0.7152 * img.data[k + 1] + 0.0722 * img.data[k + 2]; };
  return (L(x0, y0) * (1 - fx) + L(x0 + 1, y0) * fx) * (1 - fy) + (L(x0, y0 + 1) * (1 - fx) + L(x0 + 1, y0 + 1) * fx) * fy;
}
{
  const [ax, az] = along(best * 0.5 + 1);
  const fx = ax - cx, fz = az - cz, ux = -fz, uz = fx;
  for (const [tag, h, back, side] of [['street', 1.8, 0, false], ['canyon 35 m up', 35, 25, true], ['block 120 m up', 120, 90, true]]) {
    const eye0 = [cx - fx * back + ux * 6, g(cx, cz) + h, cz - fz * back + uz * 6];
    const tg0 = [cx + fx * 60, g(cx, cz), cz + fz * 60];
    const pose = (k) => { const [sx, sz] = side ? [ux * k, uz * k] : [fx * k, fz * k]; return [[eye0[0] + sx, eye0[1], eye0[2] + sz], [tg0[0] + sx, tg0[1], tg0[2] + sz]]; };
    look(...pose(0)); frames(30);
    const img0 = shot(), sc = img0.width / cssW;
    const Ms = allM.filter((M) => Math.hypot(M.cx - eye0[0], M.cz - eye0[2]) < 500);
    const pts = [];
    for (let j = 0; j < 28; j++) for (let i = 0; i < 48; i++) {
      const r = m.scene.unprojectLocal((i + 0.5) / 48 * cssW, (j + 0.5) / 28 * (img0.height / sc));
      const p = r && groundHit(r.origin, r.dir);
      if (p) pts.push(p);
    }
    const L0 = [], dev = new Float64Array(pts.length), valid = new Uint8Array(pts.length).fill(1);
    for (let k = 0; k <= 100; k++) {
      const [e, t] = pose(k * 0.08); look(e, t); frames(2);
      const img = frameImage();
      pts.forEach((p, i) => {
        if (!valid[i]) return;
        const q = m.scene.projectLocal(p);
        if (!q || q.behind || q.x < 2 || q.y < 2 || q.x * sc > img.width - 3 || q.y * sc > img.height - 3 || blocked(e, p)) { valid[i] = 0; return; }
        const L = lum(img, q.x * sc, q.y * sc);
        if (k === 0) L0[i] = L; else dev[i] = Math.max(dev[i], Math.abs(L - L0[i]));
      });
    }
    const ds = [...dev].filter((_, i) => valid[i]).sort((a, b) => a - b);
    const p95 = ds[Math.floor(ds.length * 0.95)], jumps = ds.filter((d) => d > 20).length;
    check(ds.length > 50 && p95 < 12 && jumps < ds.length * 0.05, `${tag}: the ground's shading stays put as the eye moves 8 m (${ds.length} points, p95 change ${p95.toFixed(1)}/255, ${jumps} over 20)`);
  }
}
for (const n of m.cars.nodes) n.visible = true;
for (const n of m.trees.nodes) n.visible = true;
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
