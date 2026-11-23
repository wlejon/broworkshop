// The metropolis acceptance list, rendered: what test_city.js cannot see.
//  - a still view renders the same twice, and a view left and returned to
//    renders the same (no state left behind: shadow pages, LOD, ground);
//  - LODs keep shape and colour: a building zoomed to the same size from
//    4, 8 and 25+ times its size away (2 km at least) draws alike, the
//    farthest allowed the air's haze (a per-channel blend toward its colour),
//    and seen from one eye through a narrow and a wide view (its pixels'
//    footprint 1 to 25 times larger) the wide one is the narrow averaged; a tree across each level boundary
//    changes no more than across the same move within a level; a car's
//    level swap at its switch distance changes it no more than moving 1 %;
//  - dollying out from the street to 3 km over a clear path, no step changes
//    the frame much more than the steps either side (no whole-frame pop:
//    one object's level change is spread over many frames, so this catches
//    only what changes everywhere at once, like ground or lighting);
//  - strafing (8 m, 250 m) and turning, fixed points of the ground keep
//    their brightness, and no less steadily with the sun's shadows than
//    without them (no shadow swim; what moves without shadows is occluders).
// Time is paused (traffic, sky, wind still), interiors off.
//
//   bro-headless --grant files demos/metropolis tests/test_visual.js

import { frames, waitFor } from "/lib/kit/test.js";
import { riverCenterX, terrainHeight } from "/app/world/terrain_field.js";
import { massRecord } from "/lib/city/interior.js";
import { TREE_FLOATS } from "/lib/city/trees.js";
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

// (helpers below need the masses)
const allM = []; for (let i = 0; i < nM; i++) allM.push(massRecord(MD, i));
function blocked(a, b, skip = null) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  for (const M of allM) {
    if (M === skip) continue;
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

// Levels of detail keep shape and colour.
const canvas = document.querySelector('canvas');
const cssW = canvas.getBoundingClientRect().width;
function crop(img, r) { const w = r[2] - r[0], h = r[3] - r[1], out = new ImageData(w, h); for (let y = 0; y < h; y++) out.data.set(img.data.subarray(((r[1] + y) * img.width + r[0]) * 4, ((r[1] + y) * img.width + r[2]) * 4), y * w * 4); return out; }
const meanC = (im) => { let a = [0, 0, 0]; for (let k = 0; k < im.data.length; k += 4) { a[0] += im.data[k]; a[1] += im.data[k + 1]; a[2] += im.data[k + 2]; } const n = im.data.length / 4; return a.map((v) => v / n); };
const dC = (a, b) => { const p = meanC(a), q = meanC(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
// rect (device px) of world points under the current camera, grown by `pad` px
function rectOf(pts, W, H, pad = 0) {
  const sc = W / cssW; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of pts) { const q = m.scene.projectLocal(p); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
  return [Math.max(0, Math.round(x0 * sc) - pad), Math.max(0, Math.round(y0 * sc) - pad), Math.min(W, Math.round(x1 * sc) + pad), Math.min(H, Math.round(y1 * sc) + pad)];
}
const treeN = m.trees.nodes, carN = m.cars.nodes;
treeN.forEach((n) => n.visible = false); carN.forEach((n) => n.visible = false);
{
  // Per style a mass and a side from which 150 m, 500 m and 2 km all see
  // its centre and its top corners (no other building in between).
  const clearSide = (M) => {
    const fx = Math.sin(M.yaw), fz = Math.cos(M.yaw);
    for (const [a, el] of [[0.34, 0.2], [-0.34, 0.2], [0.34, 0.4], [-0.34, 0.4], [0.8, 0.3], [-0.8, 0.3]]) {
      const h = Math.cos(el), dir = [(fx * Math.cos(a) + fz * Math.sin(a)) * h, Math.sin(el), (fz * Math.cos(a) - fx * Math.sin(a)) * h];
      const tops = [0.2, 0.5, 1].map((t) => [M.cx, M.y0 + M.h * t, M.cz]);
      if ([100, 300, 2000, 6000].every((d) => tops.every((t) => { const e = [t[0] + dir[0] * d, t[1] + dir[1] * d, t[2] + dir[2] * d]; return !blocked(e, t, M); }))) return dir;
    }
    return null;
  };
  const pick = (f) => { for (const M of allM) { if (!f(M)) continue; const dir = clearSide(M); if (dir) return { M, dir }; } return null; };
  const cases = { tower: pick((M) => M.h > 80 && M.style === 0), office: pick((M) => M.style === 1 && M.h > 30), brick: pick((M) => M.style === 2 && M.h > 12), rowhouse: pick((M) => M.style === 5 && M.hw > 4), house: pick((M) => M.style === 6) };
  for (const tm of ['day', 'night']) {
    m.setTimeMode(tm);
    for (const [name, { M, dir }] of Object.entries(cases)) {
      const mid = [M.cx, M.y0 + M.h * 0.5, M.cz];
      const view = Math.max(M.h, 2 * M.hw, 2 * M.hd) * 1.3;
      const c = Math.cos(M.yaw), sn = Math.sin(M.yaw), corners = [];
      for (const lx of [-M.hw, M.hw]) for (const lz of [-M.hd, M.hd]) for (const ly of [0, M.h]) corners.push([M.cx + c * lx + sn * lz, M.y0 + ly, M.cz - sn * lx + c * lz]);
      const cs = []; let r = null;
      const dMid = Math.max(300, view * 8), dists = [dMid, Math.max(100, view * 4), Math.max(2000, dMid * 3)];
      for (const d of dists) {
        const eye = [mid[0] + dir[0] * d, mid[1] + dir[1] * d, mid[2] + dir[2] * d];
        m.cam.setFov(2 * Math.atan(view / 2 / d) * 180 / Math.PI);
        for (let i = 0; i < 20; i++) { m.lookAt(eye, mid); frames(1); }
        const im = shot();
        if (!r) { r = rectOf(corners, im.width, im.height); const w = r[2] - r[0], h = r[3] - r[1]; r = [r[0] + Math.round(w * 0.1), r[1] + Math.round(h * 0.1), r[2] - Math.round(w * 0.1), r[3] - Math.round(h * 0.1)]; }
        cs.push(crop(im, r));
      }
      m.cam.setFov(58);
      // Compared at 12x12 (box-averaged: windows and brick average out, a
      // change of form stays), each channel fitted as a.x + b to the
      // reference: the air's haze (and the view's own) is such a blend toward
      // its colour, so what must be small is the fit's residual (the near
      // one also carries the perspective's shift), and the mean colour may
      // move only as far as the air between explains.
      const small = (im) => { const N = 12, out = []; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const xa = Math.floor(x * im.width / N), xb = Math.max(xa + 1, Math.floor((x + 1) * im.width / N)), ya = Math.floor(y * im.height / N), yb = Math.max(ya + 1, Math.floor((y + 1) * im.height / N)); const acc = [0, 0, 0]; let n = 0; for (let v = ya; v < yb; v++) for (let u = xa; u < xb; u++) { const k = (v * im.width + u) * 4; acc[0] += im.data[k]; acc[1] += im.data[k + 1]; acc[2] += im.data[k + 2]; n++; } out.push(acc.map((c) => c / n)); } return out; };
      const fit = (ref, x) => {
        let worst = 0;
        for (let c = 0; c < 3; c++) {
          const X = ref.map((p) => p[c]), Y = x.map((p) => p[c]), n = X.length;
          const mx = X.reduce((s, v) => s + v, 0) / n, my = Y.reduce((s, v) => s + v, 0) / n;
          let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (X[i] - mx) * (Y[i] - my); sxx += (X[i] - mx) ** 2; }
          const ka = sxx > 1 ? sxy / sxx : 1, kb = my - ka * mx;
          let r = 0; for (let i = 0; i < n; i++) r += (Y[i] - ka * X[i] - kb) ** 2;
          worst = Math.max(worst, Math.sqrt(r / n));
        }
        return { resid: worst };
      };
      const sm = cs.map(small), fn = fit(sm[0], sm[1]), ff = fit(sm[0], sm[2]);
      const shiftN = dC(cs[0], cs[1]), shiftF = dC(cs[0], cs[2]);
      check(fn.resid < 12 && ff.resid < 10 && shiftN < 15 && shiftF < 35,
        `${tm} ${name}: the same at ${dists.map((d) => `${d.toFixed(0)} m`).join(', ')} (against the first, at 12x12 after each channel's blend: residual ${fn.resid.toFixed(1)} near, ${ff.resid.toFixed(1)} far /255; mean colour shift ${shiftN.toFixed(1)} near, ${shiftF.toFixed(1)} far, the air's haze)`);
    }
  }
}
treeN.forEach((n) => n.visible = true);
m.setTimeMode('day');
{
  // Every species across every level boundary, twelve full-width trees each: each level
  // alone just past the boundary (fades off) must cover as much of what is
  // behind (pixels differing from the settled empty view) within 12 %
  // (tree-lab's scattered levels lost 7-22 % a step) in the same leaf colour
  // (the covered pixels' mean within 5/255), and in the band's middle, with
  // the city's fades, the two must cover their mean within 10 % (a gap
  // between them: 0.5-0.86); the steps' product, the farthest level against
  // the finest, within 12 % too (scattered: elm 0.91, oak 0.65).
  const SP = ['elm', 'oak', 'beech', 'birch'];
  const TR = m.treeRecs, NT = TR.length / TREE_FLOATS;
  const dv = [0.7, 0.35, 0.6], dn = Math.hypot(...dv);
  const measure = (E, A, r) => {
    let n = 0, tot = 0; const col = [0, 0, 0];
    for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) {
      const k = (y * E.width + x) * 4; tot++;
      if (Math.abs(A.data[k] - E.data[k]) + Math.abs(A.data[k + 1] - E.data[k + 1]) + Math.abs(A.data[k + 2] - E.data[k + 2]) > 18) { n++; col[0] += A.data[k]; col[1] += A.data[k + 1]; col[2] += A.data[k + 2]; }
    }
    return { n, tot, col };
  };
  for (let si = 0; si < 4; si++) {
    const trees = [];
    for (let i = 0; i < NT && trees.length < 12; i += 53) {
      if (TR[i * TREE_FLOATS + 5] !== si || TR[i * TREE_FLOATS + 6] < 0.99) continue;
      const t = [TR[i * TREE_FLOATS], TR[i * TREE_FLOATS + 1], TR[i * TREE_FLOATS + 2]], up = [t[0], t[1] + 8, t[2]];
      if (![30, 700].some((d) => blocked([t[0] + 0.7 * d, t[1] + 0.35 * d, t[2] + 0.6 * d], up))) trees.push(t);
    }
    const lv = {};
    for (const n of treeN) { const mm = n.name.match(new RegExp(`city_trees_${SP[si]}_L(\\d+)_(bark|leaves)$`)); if (mm && !n.shadowOnly) (lv[+mm[1]] ??= []).push(n); }
    const Ls = Object.keys(lv).map(Number).sort((x, y) => x - y);
    let cum = 1;
    for (let li = 0; li + 1 < Ls.length; li++) {
      const near = lv[Ls[li]], far = lv[Ls[li + 1]], b = far[0].fadeInDist;
      const keep = [...near, ...far].map((n) => [n, n.fadeInDist, n.fadeOutDist]);
      const acc = { A: { n: 0, tot: 0, col: [0, 0, 0] }, B: { n: 0, tot: 0, col: [0, 0, 0] }, Mn: { n: 0, tot: 0, col: [0, 0, 0] }, Mid: { n: 0, tot: 0, col: [0, 0, 0] }, Mf: { n: 0, tot: 0, col: [0, 0, 0] } };
      const add = (k, r) => { acc[k].n += r.n; acc[k].tot += r.tot; for (let c = 0; c < 3; c++) acc[k].col[c] += r.col[c]; };
      for (const tree of trees) {
        const aim = [tree[0], tree[1] + 6, tree[2]];
        const eyeAt = (d) => [aim[0] + dv[0] / dn * d, aim[1] + dv[1] / dn * d, aim[2] + dv[2] / dn * d];
        const show = (nodes) => { treeN.forEach((n) => { n.visible = false; }); nodes.forEach((n) => { n.visible = true; }); };
        const at = (d, settle) => { for (let i = 0; i < settle; i++) { look(eyeAt(d), aim); frames(1); } return shot(); };
        // Levels alone, just past the boundary (fades off).
        for (const n of [...near, ...far]) { n.fadeInDist = 0; n.fadeOutDist = 0; }
        const d0 = b * 1.02;
        show([]); const E = at(d0, 30);
        show(near); const A = at(d0, 4);
        show(far); const B = at(d0, 4);
        look(eyeAt(d0), aim);
        const r = rectOf([[tree[0] - 6, tree[1], tree[2] - 6], [tree[0] + 6, tree[1] + 15, tree[2] + 6], [tree[0] - 6, tree[1] + 15, tree[2] + 6], [tree[0] + 6, tree[1], tree[2] - 6]], A.width, A.height, 2);
        add('A', measure(E, A, r)); add('B', measure(E, B, r));
        // The band's middle, fades as the city sets them (GAP: farther's fade-in moved to the band's end).
        for (const [n, fi, fo] of keep) { n.fadeInDist = fi; n.fadeOutDist = fo; }
        const dm = b * 1.175;
        show([]); const Em = at(dm, 30);
        for (const n of [...near, ...far]) { n.fadeInDist = 0; n.fadeOutDist = 0; }
        show(near); const An = at(dm, 4);
        show(far); const Bf = at(dm, 4);
        for (const [n, fi, fo] of keep) { n.fadeInDist = fi; n.fadeOutDist = fo; }
        show([...near, ...far]); const Mi = at(dm, 4);
        look(eyeAt(dm), aim);
        const rm = rectOf([[tree[0] - 6, tree[1], tree[2] - 6], [tree[0] + 6, tree[1] + 15, tree[2] + 6], [tree[0] - 6, tree[1] + 15, tree[2] + 6], [tree[0] + 6, tree[1], tree[2] - 6]], A.width, A.height, 2);
        add('Mn', measure(Em, An, rm)); add('Mf', measure(Em, Bf, rm)); add('Mid', measure(Em, Mi, rm));
      }
      for (const [n, fi, fo] of keep) { n.fadeInDist = fi; n.fadeOutDist = fo; }
      const cov = (k) => acc[k].n / acc[k].tot, colr = (k) => acc[k].col.map((c) => c / Math.max(1, acc[k].n));
      const cA = colr('A'), cB = colr('B');
      const dcol = Math.hypot(cA[0] - cB[0], cA[1] - cB[1], cA[2] - cB[2]);
      const midRatio = cov('Mid') / ((cov('Mn') + cov('Mf')) / 2);
      const cr = cov('B') / cov('A');
      cum *= cr;
      check(trees.length === 12 && cr > 0.88 && cr < 1.12 && dcol < 5 && midRatio > 0.9 && midRatio < 1.12,
        `${SP[si]} across the ${b} m level boundary (L${Ls[li]} -> L${Ls[li + 1]}): cover ${(cov('A') * 100).toFixed(1)} -> ${(cov('B') * 100).toFixed(1)} % (x${cr.toFixed(2)}), leaf colour shift ${dcol.toFixed(1)}/255, the band's middle x${midRatio.toFixed(2)} of the levels' mean cover (${trees.length} trees)`);
    }
    check(cum > 0.88 && cum < 1.12, `${SP[si]}: the farthest level covers as the finest does, step by step (x${cum.toFixed(2)})`);
  }
  treeN.forEach((n) => { n.visible = true; });
}
{
  const byType = {};
  for (const n of carN) { const mm = n.name.match(/city_cars_(.+)_lod(\d)/); if (mm) (byType[mm[1]] ??= [])[+mm[2]] = n; }
  treeN.forEach((n) => n.visible = false);
  const [px, pz] = along(best * 0.5), [qx, qz] = along(best * 0.5 + 1), py = g(px, pz);
  const yawC = Math.atan2(qx - px, qz - pz), cy = Math.cos(yawC), sy = Math.sin(yawC);
  const row = new Float32Array([cy, 0, -sy, px, 0, 1, 0, py, sy, 0, cy, pz, 0.55, 0.08, 0.06, 1]);
  const box = [[px - 3, py, pz - 3], [px + 3, py + 2, pz + 3], [px - 3, py + 2, pz + 3], [px + 3, py, pz - 3]];
  // A side from which both switch distances see the car (not across a tower).
  let side = null;
  for (let az = 0; az < 360 && !side; az += 5) {
    const a = az * Math.PI / 180, dd = [Math.cos(a) * 0.99, 0.12, Math.sin(a) * 0.99];
    if ([120, 300].every((d) => { const e = [px + dd[0] * d, py + dd[1] * d, pz + dd[2] * d]; return e[1] > g(e[0], e[2]) + 2 && !blocked(e, [px, py + 0.7, pz]); })) side = dd;
  }
  for (const tm of ['day', 'night']) {
    m.setTimeMode(tm);
    for (const [name, lv] of Object.entries(byType)) {
      const res = []; let ok = true;
      for (const [k, dist] of [[0, 120], [1, 300]]) {
        const e = [px + side[0] * dist, py + side[1] * dist, pz + side[2] * dist];
        lv.forEach((n) => n.visible = false);
        for (let i = 0; i < 30; i++) { look(e, [px, py + 0.7, pz]); frames(1); }   // settled at this view
        const empty = shot();
        const imgs = [];
        for (const j of [k, k + 1]) {
          lv.forEach((n) => n.visible = false);
          lv[j].visible = true; lv[j].setInstances(row);
          for (let i = 0; i < 4; i++) { look(e, [px, py + 0.7, pz]); frames(1); }
          imgs.push(shot());
        }
        // The control: the same level, the eye 1 % farther (what moving does).
        const e2 = [px + side[0] * dist * 1.01, py + side[1] * dist * 1.01, pz + side[2] * dist * 1.01];
        for (let i = 0; i < 4; i++) { look(e2, [px, py + 0.7, pz]); frames(1); }
        const moved = shot();
        look(e, [px, py + 0.7, pz]);
        const r = rectOf(box, imgs[0].width, imgs[0].height, 3);
        // The share of the car's own contrast (against the empty road) that
        // the swap changes: SSIM over-weighs single pixels on a 15 px car.
        const mad = (a, b) => { let t = 0; for (let q = 0; q < a.data.length; q += 4) t += Math.abs(a.data[q] - b.data[q]) + Math.abs(a.data[q + 1] - b.data[q + 1]) + Math.abs(a.data[q + 2] - b.data[q + 2]); return t; };
        const A = crop(imgs[0], r), Bc = crop(imgs[1], r), E = crop(empty, r);
        const contrast = mad(E, A), change = contrast > 0 ? mad(A, Bc) / contrast : 1, drawn = 1 - ssim(E, A);
        const control = contrast > 0 ? mad(crop(imgs[1], r), crop(moved, r)) / contrast : 1;
        ok = ok && change < Math.max(0.15, control + 0.1) && drawn > 0.2;
        res.push(`lod${k}->${k + 1} at ${dist} m changes ${(change * 100).toFixed(0)} % of the car's contrast, moving 1 % ${(control * 100).toFixed(0)} %`);
      }
      lv.forEach((n) => { n.setInstances(new Float32Array(0)); n.visible = true; });
      check(ok, `${tm} ${name}: a car's level swap changes it no more than moving 1 % does (${res.join(', ')})`);
    }
  }
  treeN.forEach((n) => n.visible = true);
}

// The dolly.
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
// only, cars hidden) followed while the eye moves; each path with the sun's
// shadows and without them. Without shadows what changes is occluders
// (posts, rails), so shadows must add nothing: their p95 no worse than
// without plus 3/255, and their jumps (over 20/255) no more.
for (const n of carN) n.visible = false;
for (const n of treeN) if (!n.shadowOnly) n.visible = false;
m.setTimeMode('day');
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
// The largest change of each ground point over `poses` (re-sampled every
// `every` poses, as the view moves on).
function track(poses, every) {
  const all = [];
  for (let s0 = 0; s0 < poses.length - 1; s0 += every) {
    look(...poses[s0]); frames(10);
    const img0 = shot(), sc = img0.width / cssW, pts = [];
    for (let j = 0; j < 28; j++) for (let i = 0; i < 48; i++) {
      const r = m.scene.unprojectLocal((i + 0.5) / 48 * cssW, (j + 0.5) / 28 * (img0.height / sc));
      const p = r && groundHit(r.origin, r.dir);
      if (p) pts.push(p);
    }
    const L0 = [], dev = new Float64Array(pts.length), valid = new Uint8Array(pts.length).fill(1);
    for (let k = s0; k <= Math.min(poses.length - 1, s0 + every); k++) {
      const [e, t] = poses[k]; look(e, t); frames(2);
      const img = frameImage();
      pts.forEach((p, i) => {
        if (!valid[i]) return;
        const q = m.scene.projectLocal(p);
        if (!q || q.behind || q.x < 2 || q.y < 2 || q.x * sc > img.width - 3 || q.y * sc > img.height - 3 || blocked(e, p)) { valid[i] = 0; return; }
        const L = lum(img, q.x * sc, q.y * sc);
        if (k === s0) L0[i] = L; else dev[i] = Math.max(dev[i], Math.abs(L - L0[i]));
      });
    }
    dev.forEach((d, i) => { if (valid[i]) all.push(d); });
  }
  all.sort((a, b) => a - b);
  return { n: all.length, p95: all[Math.floor(all.length * 0.95)] ?? 0, jumps: all.filter((d) => d > 20).length };
}
{
  const [ax, az] = along(best * 0.5 + 1);
  const fx = ax - cx, fz = az - cz, ux = -fz, uz = fx, gy = g(cx, cz);
  const strafe = (h, back, side, len, n) => {
    const eye0 = [cx - fx * back + ux * 6, gy + h, cz - fz * back + uz * 6], tg0 = [cx + fx * 60, gy, cz + fz * 60];
    return Array.from({ length: n + 1 }, (_, k) => { const t = k / n * len, [sx, sz] = side ? [ux * t, uz * t] : [fx * t, fz * t]; return [[eye0[0] + sx, eye0[1], eye0[2] + sz], [tg0[0] + sx, tg0[1], tg0[2] + sz]]; });
  };
  const e2 = [cx - fx * 25 + ux * 6, gy + 35, cz - fz * 25 + uz * 6];
  const paths = {
    'street, 8 m along': [strafe(1.8, 0, false, 8, 100), 100],
    'canyon 35 m up, 8 m sideways': [strafe(35, 25, true, 8, 100), 100],
    'block 120 m up, 8 m sideways': [strafe(120, 90, true, 8, 100), 100],
    'block 120 m up, 250 m sideways': [strafe(120, 90, true, 250, 250), 25],
    'canyon 35 m up, turning 40 degrees': [Array.from({ length: 101 }, (_, k) => { const a = (k / 100 - 0.5) * 0.7, ca = Math.cos(a), sa = Math.sin(a); return [e2, [e2[0] + (fx * ca - fz * sa) * 85, gy, e2[2] + (fx * sa + fz * ca) * 85]]; }), 100],
  };
  for (const [tag, [poses, every]] of Object.entries(paths)) {
    m.sky.sun.castsShadow = true; const on = track(poses, every);
    m.sky.sun.castsShadow = false; const off = track(poses, every);
    m.sky.sun.castsShadow = true;
    check(on.n > 50 && on.p95 < off.p95 + 3 && on.jumps <= off.jumps, `${tag}: the ground's shadows stay put (${on.n} points: p95 change ${on.p95.toFixed(1)}/255 and ${on.jumps} over 20 with shadows, ${off.p95.toFixed(1)} and ${off.jumps} without)`);
  }
}
for (const n of carN) n.visible = true;
for (const n of treeN) n.visible = true;
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
