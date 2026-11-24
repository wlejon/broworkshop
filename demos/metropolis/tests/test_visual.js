// The metropolis acceptance list, rendered: what test_city.js cannot see.
//  - a still view renders the same twice, and a view left and returned to
//    renders the same (no state left behind: shadow pages, LOD, ground);
//  - LODs keep shape and colour: a building zoomed to the same size from
//    4, 8 and 25+ times its size away (2 km at least) draws alike, the
//    farthest allowed the air's haze (a per-channel blend toward its colour);
//    a car's level swap at its switch distance changes it no more than
//    moving 1 %; a facade of every style, seen through a narrow and the
//    normal view from one eye, has the same mean in linear light (its far
//    shading is its near shading averaged);
//  - dollying out from the street to 3 km over a clear path, no step changes
//    the frame's brightness much more than the steps either side (no
//    whole-frame pop: lighting, exposure, the ground's shade at once);
//  - strafing (8 m, 250 m) and turning, fixed points of the ground keep
//    their brightness, and no less steadily with the sun's shadows than
//    without them (no shadow swim; what moves without shadows is occluders).
// Time is paused (traffic, sky, wind still), interiors off.
//
//   bro-headless --grant files demos/metropolis tests/test_visual.js

import { frames, waitFor } from "/lib/kit/test.js";
import { riverCenterX, terrainHeight } from "/app/world/terrain_field.js";
import { massRecord, floorsOf } from "/lib/city/interior.js";
import { STYLE } from "/lib/city/buildings.js";
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
const carN = m.cars.nodes;
carN.forEach((n) => n.visible = false);
const FOV = 60;   // the fly camera's own
{
  // A facade's far shading is its near shading averaged. From one eye, a
  // 12 m patch of a front through a narrow view (~1.5 cm pixels, every
  // facade term resolved: bricks, mortar, ribs, the rooms behind the glass)
  // and the normal one (~0.2 m pixels, every term at its far mean), in
  // linear light: a linear tone curve at a fixed EV that puts the patch
  // mid-range (averaging after ACES reads its toe's convexity as darkening,
  // and an 8-bit mean near black is rounding). The tall styles also from
  // below, as a street sees them: the rooms' far mean follows the angle.
  // Old far means failed this: brick and rowhouse terms (x0.81-0.86), a
  // fixed room average (night glass x0.84-0.89, office from below x0.93),
  // four room samples (night office x1.08); the spread now is 0.96-1.06
  // (noise floor ~1 %). Old industrial ribs fail only by night (x0.934; by
  // day x0.940 passes): the bound is 6 % for night offices' x1.05.
  const lin = (q) => { q /= 255; return q <= 0.04045 ? q / 12.92 : ((q + 0.055) / 1.055) ** 2.4; };
  const meanLin = (im) => { const a = [0, 0, 0]; let clip = 0; for (let k = 0; k < im.data.length; k += 4) { for (let ch = 0; ch < 3; ch++) a[ch] += lin(im.data[k + ch]); if (im.data[k] > 252 || im.data[k + 1] > 252 || im.data[k + 2] > 252) clip++; } const n = im.data.length / 4; return { c: a.map((v) => v / n), clip: clip / n }; };
  const NAMES = Object.keys(STYLE).sort((a, b) => STYLE[a] - STYLE[b]);
  const D = 200;
  const pick = (st, els) => {
    for (const M of allM) {
      if (M.style !== st || M.h < 4.5 || M.hw < 4) continue;
      const c = Math.cos(M.yaw), sn = Math.sin(M.yaw);
      const W = (lx, ly, lz) => [M.cx + c * lx + sn * lz, M.y0 + ly, M.cz - sn * lx + c * lz];
      const pw = Math.min(M.hw - 1, 6), y0 = M.h < 12 ? 0.6 : Math.max(4.6, M.h * 0.5 - 6), y1 = Math.min(M.h - 1.2, y0 + 12);
      if (y1 - y0 < 2.5) continue;
      const mid = W(0, (y0 + y1) / 2, M.hd + 0.05), corners = [W(-pw, y0, M.hd), W(pw, y0, M.hd), W(-pw, y1, M.hd), W(pw, y1, M.hd)];
      for (const el of els) for (const a of [0.25, -0.25, 0.5, -0.5]) {
        const fx = sn, fz = c, h = Math.cos(el);
        const dir = [(fx * Math.cos(a) + fz * Math.sin(a)) * h, Math.sin(el), (fz * Math.cos(a) - fx * Math.sin(a)) * h];
        const eye = [mid[0] + dir[0] * D, mid[1] + dir[1] * D, mid[2] + dir[2] * D];
        if (eye[1] < terrainHeight(eye[0], eye[2]) + 3) continue;
        if (corners.every((t) => !blocked(eye, t, M)) && !blocked(eye, mid, M)) return { eye, mid, corners, span: Math.max(2 * pw, y1 - y0) };
      }
    }
    return null;
  };
  const views = [];
  for (let st = 0; st < NAMES.length; st++) {
    views.push({ name: NAMES[st], P: pick(st, [0.12, 0.2]) });
    if (st === STYLE.glass || st === STYLE.office || st === STYLE.stone) views.push({ name: `${NAMES[st]} from below`, P: pick(st, [-0.1, -0.06]) });
  }
  for (const tm of ['day', 'night']) {
    for (const { name, P } of views) {
      m.setTimeMode(tm);
      if (!P) { check(false, `${tm} ${name}: a facade seen clear from ${D} m`); continue; }
      const narrow = 2 * Math.atan(P.span * 0.75 / D) * 180 / Math.PI;
      const take = (fov) => {
        m.cam.setFov(fov);
        for (let i = 0; i < 12; i++) { m.lookAt(P.eye, P.mid); frames(1); }
        const im = shot();
        let r = rectOf(P.corners, im.width, im.height); const w = r[2] - r[0], h = r[3] - r[1];
        r = [r[0] + Math.round(w * 0.12), r[1] + Math.round(h * 0.12), r[2] - Math.round(w * 0.12), r[3] - Math.round(h * 0.12)];
        return { ...meanLin(crop(im, r)), px: r[2] - r[0] };
      };
      // The EV that brings the narrow view's mean to about 0.12 of white.
      let ev = tm === 'day' ? 14 : 2;
      m.scene.setToneMap({ mode: 'linear' });
      for (let it = 0; it < 2; it++) {
        m.scene.setExposure({ mode: 'fixed', ev });
        const n = take(narrow);
        ev += Math.log2(Math.max(1e-4, (n.c[0] + n.c[1] + n.c[2]) / 3) / 0.12);
      }
      m.scene.setExposure({ mode: 'fixed', ev });
      const a = take(narrow), b = take(FOV);
      const ratio = (b.c[0] + b.c[1] + b.c[2]) / (a.c[0] + a.c[1] + a.c[2]);
      check(Math.abs(ratio - 1) < 0.06 && a.clip < 0.02, `${tm} ${name}: its far shading is its near shading averaged (wide view ${b.px} px across, mean x${ratio.toFixed(3)} of the narrow's, ${(a.clip * 100).toFixed(1)} % clipped)`);
    }
  }
  m.cam.setFov(FOV);
  m.setTimeMode('day');
}
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
      m.cam.setFov(FOV);
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
m.setTimeMode('day');
{
  const byType = {};
  for (const n of carN) { const mm = n.name.match(/city_cars_(.+)_lod(\d)/); if (mm) (byType[mm[1]] ??= [])[+mm[2]] = n; }
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
        // (drawn: the level draws at all, against the empty road, where a
        // missing one reads ~0. The dark red hatch at 300 m is some 12x4 px on
        // a road in shade (under 30/255): SSIM there swings 0.18-0.34 with the
        // car's sub-pixel placement, which differs by what ran before (its
        // projected crop 30 px wide fresh, 29 after the facade check; exposure
        // the same within 0.01 EV), so the floor is 0.1.)
        ok = ok && change < Math.max(0.15, control + 0.1) && drawn > 0.1;
        res.push(`lod${k}->${k + 1} at ${dist} m changes ${(change * 100).toFixed(0)} % of the car's contrast, moving 1 % ${(control * 100).toFixed(0)} %, drawn ${drawn.toFixed(2)}`);
      }
      lv.forEach((n) => { n.setInstances(new Float32Array(0)); n.visible = true; });
      check(ok, `${tm} ${name}: a car's level swap changes it no more than moving 1 % does (${res.join(', ')})`);
    }
  }
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
  // A whole-frame pop (lighting, exposure, the ground's or sky's shade all at
  // once): each step's change of the frame's mean brightness against the
  // steps either side (their median, but never under 1 %: moving past
  // downtown's towers alone changes it up to 9 % a step, as roofs come into
  // view). Measured: the worst step x3.9 its neighbours; a 20 % sun drop at
  // 500 m x11.8. (Structure is not measured here: a step's own motion moves
  // SSIM by 0.5 at full scale and 0.1-0.7 at 1/8, burying even the ground
  // moved 3 m; the return-to-pose check above is the ground's: 0.3 m fails.)
  const lum = (im) => { let t = 0; for (let k = 0; k < im.data.length; k += 4) t += im.data[k] * 0.2126 + im.data[k + 1] * 0.7152 + im.data[k + 2] * 0.0722; return t / (im.data.length / 4); };
  let prevL = -1; const out = [];
  for (let d = 25; d < 3000; d *= 1.012) {
    look([tgt[0] + dir[0] * d, tgt[1] + dir[1] * d, tgt[2] + dir[2] * d], tgt);
    const L = lum(shot());
    if (prevL >= 0) out.push([d, Math.abs(L - prevL) / Math.max(1, prevL)]);
    prevL = L;
  }
  let worst = 0, at = 0;
  for (let i = 1; i < out.length; i++) {
    const w = out.slice(Math.max(1, i - 6), i + 7).map((x) => x[1]).sort((p, q) => p - q);
    const r = out[i][1] / Math.max(w[w.length >> 1], 0.01);
    if (r > worst) { worst = r; at = out[i][0]; }
  }
  check(worst < 6, `dollying out 25 m to 3 km, no step's brightness change stands out from its neighbours' (largest x${worst.toFixed(1)} their median, at ${at.toFixed(0)} m)`);
}
{
  // The ground's tiles swap level by the eye's distance: at each step out
  // the same pose drawn with its own tiles and with the next step's (the
  // tiles chosen from an eye 5 % farther, terrain.update's eye wrapped), the
  // ground alone (buildings and cars hidden). What differs is what a
  // swap at that step shows, without the step's own motion. Measured at 1/8
  // scale in luminance: the mean change and the largest 8x8-block change.
  // Measured: worst block 15.1/255 at 467 m (a corner's narrow ridge in the
  // height field, sampled a little differently a level coarser), mean 0.02;
  // the same tiles drawn twice differ by up to 6. Controls: a parent drawn on
  // a merge from its own parent's shape (bro's tile cache before 767ce53b)
  // jumps the river's bank at 1.3 km, block 21.8; tiles chosen from 4x as
  // far, block 49.5, mean 0.41.
  const TILE_MEAN = 0.1, TILE_BLOCK = 16;
  const hide = [...m.buildings.nodes, ...carN];
  hide.forEach((n) => { n.visible = false; });
  // Exposed as the eye meters the scene: auto exposure adapts on the paused
  // clock, so it would hold whatever EV a section before left it at (the
  // facade check's fixed EV, 0.8 brighter, scales every change here by 1.5).
  for (let i = 0; i < 4; i++) frames(1);
  m.scene.setExposure({ mode: 'fixed', ev: m.scene.cullStats().meteredEv });
  const upd = m.terrain.update;
  let selScale = 1;
  m.terrain.update = (pos, ...rest) => upd(selScale === 1 ? pos : [tgt[0] + (pos[0] - tgt[0]) * selScale, tgt[1] + (pos[1] - tgt[1]) * selScale, tgt[2] + (pos[2] - tgt[2]) * selScale], ...rest);
  const L8 = (im) => { const w = im.width >> 3, h = im.height >> 3, o = new Float32Array(w * h); for (let y = 0; y < h * 8; y++) for (let x = 0; x < w * 8; x++) { const k = (y * im.width + x) * 4; o[(y >> 3) * w + (x >> 3)] += (0.2126 * im.data[k] + 0.7152 * im.data[k + 1] + 0.0722 * im.data[k + 2]) / 64; } return o; };
  // Settled: the tiles in and the shadow pages caught up (a tile change
  // redraws the pages over it, a ration a frame).
  const settled = (e) => { for (let i = 0; i < 240; i++) { look(e, tgt); frames(1); const cs = m.scene.cullStats(); if (i > 6 && m.terrain.stats().pending === 0 && !cs.shadowPagesWanted && !cs.shadowPagesDrawn && !cs.shadowPagesBuilding) break; } return L8(frameImage()); };
  const diff = (a, b) => { let sum = 0, mx = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); sum += d; if (d > mx) mx = d; } return [sum / a.length, mx]; };
  let worstMean = 0, worstBlock = 0, atM = 0, atB = 0;
  const SWAP = 1.05;
  for (let d = 25; d < 3000; d *= 1.05) {
    const e = [tgt[0] + dir[0] * d, tgt[1] + dir[1] * d, tgt[2] + dir[2] * d];
    selScale = 1; const A = settled(e);
    selScale = SWAP; const B = settled(e);
    const [mean, block] = diff(A, B);
    if (mean > worstMean) { worstMean = mean; atM = d; }
    if (block > worstBlock) { worstBlock = block; atB = d; }
  }
  m.terrain.update = upd; selScale = 1;
  m.setTimeMode('day');
  hide.forEach((n) => { n.visible = true; });
  check(worstMean < TILE_MEAN && worstBlock < TILE_BLOCK, `the ground's tiles swap level unseen: the same view with the next step's tiles (mean change ${worstMean.toFixed(2)}/255 at ${atM.toFixed(0)} m, largest 8x8 block ${worstBlock.toFixed(1)}/255 at ${atB.toFixed(0)} m)`);
}

// Shadow swim: ground points (not behind a building, cars hidden) followed while the eye moves; each path with the sun's
// shadows and without them. Without shadows what changes is occluders
// (posts, rails), so shadows must add nothing: their p95 no worse than
// without plus 3/255, and their jumps (over 20/255) no more.
for (const n of carN) n.visible = false;
m.setTimeMode('day');
function groundHit(o, d) {
  let t = 0;
  for (let k = 0; k < 20000; k++) { t += 0.25 + t * 0.002; const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t; if (y <= g(x, z)) return [x, g(x, z), z]; if (t > 1500) return null; }
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
  // (Control: the sun's shadow bias changed every other pose, which redraws
  // its pages and shows them mid-rebuild, fails street and canyon at p95
  // 117-135/255. A sun turned +-0.5 degrees a pose shows nothing: a turn's
  // clipmap is drawn behind the shown one and swapped in whole, so this
  // checks instability in the shown shadows, not a sub-texel swim.)
  const e2 = [cx - fx * 25 + ux * 6, gy + 35, cz - fz * 25 + uz * 6];
  const paths = {
    'street, 8 m along': [strafe(1.8, 0, false, 8, 100), 100],
    'canyon 35 m up, 8 m sideways': [strafe(35, 25, true, 8, 100), 100],
    'block 120 m up, 8 m sideways': [strafe(120, 90, true, 8, 100), 100],
    'block 120 m up, 250 m sideways': [strafe(120, 90, true, 250, 250), 25],
    'flyover 400 m up, 600 m along': [strafe(400, 300, false, 600, 120), 30],
    'rising from 35 m to 300 m': [Array.from({ length: 121 }, (_, k) => { const h = 35 + 265 * k / 120; return [[e2[0], gy + h, e2[2]], [cx + fx * 60, gy, cz + fz * 60]]; }), 30],
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
{
  // Inside by day the outdoors' light stops at the walls: from a corner of a
  // shop's and an office's floor, the lower half of the frame (floor, shelves,
  // desks) is not burnt white. (The interior volume's edge fade at 0.4 m lit
  // a band inside the walls with the sun under the room's exposure: shop
  // 2.2 %, office 10.5 % near-white; 1.5 % and 0.4 % at 5 cm. Only the
  // office tells them apart: the shop is lit bright by day either way.)
  m.setTimeMode('day');
  m.interiors.enabled = true;
  bro.time.paused = false;   // (the eye adapts to the room)
  const B = m.city.masses.buildings, D = m.city.masses.data, found = {};
  const want = {
    shop: (M) => (M.flags & 2) && M.hw > 6 && M.hd > 6,
    office: (M) => (M.style === STYLE.office || M.style === STYLE.glass) && M.hw > 10 && M.hd > 8,
  };
  for (let bi = 600; bi < B.length && Object.keys(found).length < 2; bi++) {
    const M = massRecord(D, B[bi].first);
    for (const [u, f] of Object.entries(want)) if (!found[u] && f(M)) found[u] = M;
  }
  for (const [u, M] of Object.entries(found)) {
    const F = floorsOf(M)[u === 'office' ? Math.min(2, floorsOf(M).length - 1) : 0];
    const c = Math.cos(M.yaw), sn = Math.sin(M.yaw);
    const W = (lx, ly, lz) => [M.cx + c * lx + sn * lz, M.y0 + ly, M.cz - sn * lx + c * lz];
    const e = W(-M.hw + 1.0, F.y0 + 1.65, -M.hd + 1.0), t = W(M.hw * 0.4, F.y0 + 0.9, M.hd * 0.4);
    for (let i = 0; i < 150; i++) { m.lookAt(e, t); frames(1); }
    m.interiors.finish(); for (let i = 0; i < 8; i++) { m.lookAt(e, t); frames(1); }
    const im = shot();
    let n = 0, white = 0;
    for (let y = im.height >> 1; y < im.height - 60; y += 2) for (let x = 0; x < im.width; x += 2) {
      const k = (y * im.width + x) * 4; n++;
      if (im.data[k] > 245 && im.data[k + 1] > 245 && im.data[k + 2] > 245) white++;
    }
    globalThis.WHITE = (globalThis.WHITE ?? '') + ` ${u} ${(white / n * 100).toFixed(1)}`;
    check(white / n < 0.04, `inside a ${u} by day the floor by the windows is not burnt white (${(white / n * 100).toFixed(1)} % of the lower half near-white)`);
  }
  m.interiors.enabled = false;
  bro.time.paused = true;
}
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
