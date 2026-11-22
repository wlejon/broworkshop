// js/organic_geometry.js — Continuous watertight natural meshes & icosphere rock geometry for Sylvan.

function cross(ax, ay, az, bx, by, bz) {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

function normalize3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function buildMesh(pos, norm, uv, idx) {
  return new Mesh({
    positions: new Float32Array(pos),
    normals: new Float32Array(norm),
    uvs: new Float32Array(uv),
    indices: new Uint32Array(idx),
  });
}

function hash3(x, y, z) {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothNoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c00 = lerp(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), u);
  const c10 = lerp(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), u);
  const c01 = lerp(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), u);
  const c11 = lerp(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), u);
  return lerp(lerp(c00, c10, v), lerp(c01, c11, v), w);
}

function pushSmoothTris(verts, uvs, tris) {
  const vertNrm = verts.map(() => [0, 0, 0]);
  for (const [i0, i1, i2] of tris) {
    const p0 = verts[i0], p1 = verts[i1], p2 = verts[i2];
    const fn = cross(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2], p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
    for (const k of [i0, i1, i2]) {
      vertNrm[k][0] += fn[0]; vertNrm[k][1] += fn[1]; vertNrm[k][2] += fn[2];
    }
  }
  const pos = [], norm = [], uv = [], idx = [];
  for (let i = 0; i < verts.length; ++i) {
    pos.push(...verts[i]);
    norm.push(...normalize3(...vertNrm[i]));
    uv.push(...uvs[i]);
  }
  for (const t of tris) idx.push(...t);
  return buildMesh(pos, norm, uv, idx);
}

/** Exact analytical elevation of Sylvan's island terrain & sunken pebble pond bed. */
export function islandHeightAt(x, z) {
  const r = Math.hypot(x, z);
  const ang = Math.atan2(z, x);
  const shoreR = 1.92 + 0.10 * Math.sin(ang * 3.0 + 0.4) + 0.06 * Math.cos(ang * 5.0);
  if (r < shoreR) {
    const t = r / shoreR;
    const ripple = (smoothNoise3(x * 1.4, 0, z * 1.4) - 0.5) * 0.04;
    return -0.34 + 0.34 * Math.pow(t, 1.85) + ripple * (1.0 - t * t);
  }
  const outer = Math.min(1.0, (r - shoreR) / 1.95);
  let h = 0.16 * Math.sin(outer * Math.PI * 0.85);
  h += (smoothNoise3(x * 0.85 + 2.1, 0, z * 0.85 + 1.3) - 0.5) * 0.09 * Math.min(1, (r - shoreR) * 1.2);
  // Natural knoll under Maple corner (-1.75, -1.15) & gentle terrace under Cascade cove (+0.85, -1.38)
  const dm = (x + 1.75) * (x + 1.75) + (z + 1.15) * (z + 1.15);
  h += 0.24 * Math.exp(-dm / 1.15);
  const dc = (x - 0.85) * (x - 0.85) + (z + 1.48) * (z + 1.48);
  h += 0.16 * Math.exp(-dc / 1.10);
  return h;
}

/** Watertight sculpted botanical diorama island with sunken pond bowl & chamfered basalt skirt. */
export function createSculptedIslandTerrain(segs = 72) {
  const rings = [];
  const rads = [
    0.0, 0.28, 0.56, 0.85, 1.14, 1.42, 1.68, 1.92,
    2.18, 2.50, 2.86, 3.24, 3.60, 3.92, 4.10, 4.18, 3.85,
  ];
  const verts = [], uvs = [], tris = [];
  const cTop = 0;
  verts.push([0, islandHeightAt(0, 0), 0]);
  uvs.push([0.5, 0.5]);

  for (let ri = 1; ri < rads.length; ++ri) {
    const rBase = rads[ri];
    const startIdx = verts.length;
    for (let j = 0; j < segs; ++j) {
      const a = (j / segs) * Math.PI * 2;
      // CCW viewed from +Y: (cos a, 0, -sin a)
      const ca = Math.cos(a), sa = Math.sin(a);
      const wobble = ri >= 12 ? 1.0 + 0.03 * Math.sin(a * 5.0 + 0.7) + 0.02 * Math.cos(a * 8.0) : 1.0;
      const rr = rBase * wobble;
      const x = ca * rr, z = -sa * rr;
      let y = islandHeightAt(x, z);
      if (ri === 14) y = -0.02;
      else if (ri === 15) y = -0.22;
      else if (ri === 16) y = -0.26;
      verts.push([x, y, z]);
      uvs.push([0.5 + x * 0.11, 0.5 + z * 0.11]);
    }
    rings.push(startIdx);
  }
  const cBot = verts.length;
  verts.push([0, -0.26, 0]);
  uvs.push([0.5, 0.5]);

  // First fan: outward +Y
  for (let j = 0; j < segs; ++j) {
    const j1 = (j + 1) % segs;
    tris.push([cTop, rings[0] + j, rings[0] + j1]);
  }
  // Ring strips down to outer bottom rim
  for (let ri = 0; ri < rings.length - 1; ++ri) {
    const r0 = rings[ri], r1 = rings[ri + 1];
    for (let j = 0; j < segs; ++j) {
      const j1 = (j + 1) % segs;
      const a = r0 + j, b = r0 + j1, c = r1 + j, d = r1 + j1;
      tris.push([a, c, d], [a, d, b]);
    }
  }
  // Bottom cap fan: outward -Y
  const lastRing = rings[rings.length - 1];
  for (let j = 0; j < segs; ++j) {
    const j1 = (j + 1) % segs;
    tris.push([cBot, lastRing + j1, lastRing + j]);
  }
  return pushSmoothTris(verts, uvs, tris);
}

/** Finely tessellated circular pond water surface (`y = 0`) for smooth vertex waves. */
export function createPondWaterDisk(radius = 2.08, ringCount = 26, segs = 64) {
  const verts = [[0, 0, 0]];
  const uvs = [[0.5, 0.5]];
  const tris = [];
  for (let r = 1; r <= ringCount; ++r) {
    const rr = (r / ringCount) * radius;
    const base = verts.length;
    for (let j = 0; j < segs; ++j) {
      const a = (j / segs) * Math.PI * 2;
      const x = Math.cos(a) * rr, z = -Math.sin(a) * rr;
      verts.push([x, 0, z]);
      uvs.push([0.5 + (x / (radius * 2)), 0.5 + (z / (radius * 2))]);
    }
    if (r === 1) {
      for (let j = 0; j < segs; ++j) tris.push([0, base + j, base + ((j + 1) % segs)]);
    } else {
      const prev = base - segs;
      for (let j = 0; j < segs; ++j) {
        const j1 = (j + 1) % segs;
        tris.push([prev + j, base + j, base + j1], [prev + j, base + j1, prev + j1]);
      }
    }
  }
  return pushSmoothTris(verts, uvs, tris);
}

/** Subdivided icosphere basalt boulder — zero UV/normal pinch cross artifacts, grounded flat base. */
export function createSculptedBoulder(rx = 0.6, ry = 0.4, rz = 0.5, seed = 1.0) {
  const t = (1 + Math.sqrt(5)) / 2;
  let icoV = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((p) => normalize3(...p));
  let icoF = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let sub = 0; sub < 2; ++sub) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (cache.has(key)) return cache.get(key);
      const va = icoV[a], vb = icoV[b];
      const idx = icoV.length;
      icoV.push(normalize3(va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]));
      cache.set(key, idx);
      return idx;
    };
    const nextF = [];
    for (const [a, b, c] of icoF) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      nextF.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    icoF = nextF;
  }

  const verts = [];
  const uvs = [];
  for (const [nx, ny, nz] of icoV) {
    const n1 = smoothNoise3(nx * 2.1 + seed, ny * 2.3 + seed, nz * 2.1 + seed);
    const n2 = smoothNoise3(nx * 4.8 + seed * 1.7, ny * 4.5, nz * 4.8) * 0.32;
    const strata = Math.sin(ny * 13.0 + n1 * 4.2) * 0.055;
    const ridge = 1.0 - Math.abs(n2 * 2.0 - 0.32) * 0.35;
    const disp = (0.78 + 0.38 * (n1 + n2 * 0.45) + strata) * ridge;
    const flatY = ny < -0.18 ? -0.18 + (ny + 0.18) * 0.16 : ny;
    verts.push([nx * rx * disp, (flatY + 0.18) * ry * (ny > 0 ? disp : 1.0) - 0.12, nz * rz * disp]);
    uvs.push([0.5 + nx * 0.45, 0.5 - ny * 0.45]);
  }
  return pushSmoothTris(verts, uvs, icoF);
}

/** Smooth curved open waterfall sheet hugging cliff contour down into the pond. */
export function createCurvedWaterfall(pts, wTop = 0.18, wBot = 0.34, segsW = 10) {
  const verts = [], uvs = [], tris = [];
  const stride = segsW + 1;
  for (let i = 0; i < pts.length; ++i) {
    const v = i / (pts.length - 1);
    const [cx, cy, cz] = pts[i];
    const hw = wTop + (wBot - wTop) * v;
    for (let j = 0; j <= segsW; ++j) {
      const u = j / segsW;
      const s = u * 2.0 - 1.0;
      // Gently convex parabolic bow along front stream
      const bowZ = (1.0 - s * s) * 0.035;
      verts.push([cx + s * hw, cy, cz + bowZ]);
      uvs.push([u, v]);
    }
  }
  for (let i = 0; i < pts.length - 1; ++i) {
    for (let j = 0; j < segsW; ++j) {
      const a = i * stride + j, b = a + stride, c = a + 1, d = b + 1;
      // Top->bottom (y drops as i increases), left->right (+X as j increases): (d-a)x(c-a) -> +Z front outward
      tris.push([a, b, d], [a, d, c]);
    }
  }
  return pushSmoothTris(verts, uvs, tris);
}

/**
 * Single watertight sculpted Nishikigoi mesh (`x = 0` rounded nose -> `x = -0.40` forked caudal tail)
 * with dorsal ridge, integrated dorsal fin, swept pectoral fins, pelvic fins, and deeply forked tail fin.
 */
export function createAnatomicalKoi() {
  const len = 0.40;
  const xSegs = 44;
  const rSegs = 20;
  const verts = [], uvs = [], tris = [];

  const profile = (t) => {
    let w = 0, hTop = 0, hBot = 0;
    if (t < 0.74) {
      const u = t / 0.74;
      const body = Math.sin(Math.pow(u, 0.56) * Math.PI * 0.91);
      // Graceful narrow caudal peduncle before tail flare
      const pinch = t > 0.64 ? 1.0 - 0.35 * Math.sin(((t - 0.64) / 0.10) * Math.PI * 0.5) : 1.0;
      w = (0.044 * body + 0.007 * (1 - u)) * pinch;
      hTop = (0.048 * Math.pow(body, 0.85) + 0.007 * (1 - u)) * (0.85 + 0.15 * pinch);
      hBot = (0.032 * body + 0.005 * (1 - u)) * (0.85 + 0.15 * pinch);
      if (t < 0.05) {
        const s = Math.sin((t / 0.05) * Math.PI * 0.5);
        w *= s; hTop *= s; hBot *= s;
      }
    } else {
      // Veil caudal tail fan with soft trailing lobe taper
      const u = (t - 0.74) / 0.26;
      const arch = Math.sin(Math.min(1.0, u * 0.82) * Math.PI * 0.78);
      w = 0.006 * (1.0 - 0.75 * u) + 0.0018;
      hTop = 0.010 + 0.046 * arch * (1.0 - 0.25 * Math.pow(u, 3.0));
      hBot = 0.008 + 0.040 * arch * (1.0 - 0.25 * Math.pow(u, 3.0));
    }
    return { w, hTop, hBot };
  };

  // Nose pole
  verts.push([0.004, 0.0, 0.0]);
  uvs.push([0.0, 0.5]);

  for (let i = 1; i < xSegs; ++i) {
    const t = i / xSegs;
    const xBase = -t * len;
    const { w, hTop, hBot } = profile(t);
    for (let j = 0; j <= rSegs; ++j) {
      const a = (j / rSegs) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a); // sa=+1 top (+Y), sa=-1 bot (-Y), ca=+1 (+Z)
      const h = sa >= 0 ? hTop : hBot;
      // Smooth central caudal V-fork notch at trailing edge
      const forkPull = (t > 0.85 && Math.abs(sa) < 0.75) ? (1.0 - Math.abs(sa) / 0.75) * 0.055 * ((t - 0.85) / 0.15) : 0.0;
      const eyeBump = (t > 0.07 && t < 0.14 && sa > 0.15 && Math.abs(ca) > 0.75) ? 0.004 : 0.0;
      verts.push([xBase + forkPull, sa * h, ca * (w + eyeBump)]);
      uvs.push([t, 0.5 - sa * 0.45]);
    }
  }
  const tailPoleIdx = verts.length;
  verts.push([-len + 0.042, 0.0, 0.0]);
  uvs.push([1.0, 0.5]);

  const stride = rSegs + 1;
  // Nose fan: outward +X
  for (let j = 0; j < rSegs; ++j) {
    tris.push([0, 1 + j + 1, 1 + j]);
  }
  // Body & tail rings
  for (let i = 0; i < xSegs - 2; ++i) {
    const r0 = 1 + i * stride, r1 = r0 + stride;
    for (let j = 0; j < rSegs; ++j) {
      const a = r0 + j, b = a + 1, c = r1 + j, d = c + 1;
      tris.push([a, b, d], [a, d, c]);
    }
  }
  // Tail pole fan: outward -X
  const lastBodyRing = 1 + (xSegs - 2) * stride;
  for (let j = 0; j < rSegs; ++j) {
    tris.push([tailPoleIdx, lastBodyRing + j, lastBodyRing + j + 1]);
  }

  // Seamlessly attached curved fan fins fused INTO the body hull (n-gon convex outline, zero sharp boxes)
  const addCurvedFin = (pts, thick = 0.003) => {
    const n = pts.length;
    const f0 = verts.length;
    for (const p of pts) {
      verts.push([p[0], p[1] + thick, p[2]]); uvs.push([Math.max(0.05, Math.min(0.95, -p[0] / len)), 0.88]);
    }
    const b0 = verts.length;
    for (const p of pts) {
      verts.push([p[0], p[1] - thick, p[2]]); uvs.push([Math.max(0.05, Math.min(0.95, -p[0] / len)), 0.88]);
    }
    for (let k = 1; k < n - 1; ++k) {
      tris.push([f0, f0 + k, f0 + k + 1]);
      tris.push([b0, b0 + k + 1, b0 + k]);
    }
    for (let k = 0; k < n; ++k) {
      const k1 = (k + 1) % n;
      tris.push([f0 + k, b0 + k, b0 + k1], [f0 + k, b0 + k1, f0 + k1]);
    }
  };
  // Left (+Z) & Right (-Z) rounded swept pectoral fans rooted inside hull
  addCurvedFin([
    [-0.085, -0.012, 0.020], [-0.105, -0.016, 0.068], [-0.128, -0.018, 0.086],
    [-0.156, -0.017, 0.080], [-0.165, -0.014, 0.052], [-0.135, -0.010, 0.020],
  ], 0.0022);
  addCurvedFin([
    [-0.135, -0.010, -0.020], [-0.165, -0.014, -0.052], [-0.156, -0.017, -0.080],
    [-0.128, -0.018, -0.086], [-0.105, -0.016, -0.068], [-0.085, -0.012, -0.020],
  ], 0.0022);
  // Swept pelvic fins
  addCurvedFin([
    [-0.175, -0.018, 0.014], [-0.192, -0.022, 0.042], [-0.215, -0.023, 0.048],
    [-0.228, -0.020, 0.034], [-0.210, -0.016, 0.014],
  ], 0.0018);
  addCurvedFin([
    [-0.210, -0.016, -0.014], [-0.228, -0.020, -0.034], [-0.215, -0.023, -0.048],
    [-0.192, -0.022, -0.042], [-0.175, -0.018, -0.014],
  ], 0.0018);
  // Flowing curved dorsal crest along back spine
  const addVerticalFin = (pts, halfZ = 0.0022) => {
    const n = pts.length;
    const l0 = verts.length;
    for (const p of pts) { verts.push([p[0], p[1], p[2] + halfZ]); uvs.push([-p[0] / len, 0.45]); }
    const r0 = verts.length;
    for (const p of pts) { verts.push([p[0], p[1], p[2] - halfZ]); uvs.push([-p[0] / len, 0.55]); }
    for (let k = 1; k < n - 1; ++k) {
      tris.push([l0, l0 + k, l0 + k + 1]);
      tris.push([r0, r0 + k + 1, r0 + k]);
    }
    for (let k = 0; k < n; ++k) {
      const k1 = (k + 1) % n;
      tris.push([l0 + k, r0 + k, r0 + k1], [l0 + k, r0 + k1, l0 + k1]);
    }
  };
  addVerticalFin([
    [-0.125, 0.032, 0], [-0.148, 0.072, 0], [-0.182, 0.082, 0],
    [-0.224, 0.074, 0], [-0.252, 0.056, 0], [-0.225, 0.020, 0],
  ], 0.0020);

  return pushSmoothTris(verts, uvs, tris);
}

/** Organic V-notched water-lily pad with subtle upturned botanical rim (flush at water surface y = 0). */
export function createCurledLilyPad(radius = 0.25, segs = 28) {
  const verts = [[0, 0.004, 0], [0, 0.000, 0]];
  const uvs = [[0.5, 0.5], [0.5, 0.5]];
  const tris = [];
  const startA = 0.24, arc = Math.PI * 2 - 0.48;
  const topRing = [], botRing = [];
  for (let i = 0; i <= segs; ++i) {
    const t = i / segs;
    const a = startA + t * arc;
    const ca = Math.cos(a), sa = Math.sin(a);
    const wave = 0.006 + 0.004 * Math.sin(a * 5.0);
    const x = ca * radius, z = -sa * radius;
    topRing.push(verts.length);
    verts.push([x, 0.006 + wave, z]); uvs.push([0.5 + ca * 0.48, 0.5 - sa * 0.48]);
    botRing.push(verts.length);
    verts.push([x, 0.000, z]); uvs.push([0.5 + ca * 0.48, 0.5 - sa * 0.48]);
  }
  for (let i = 0; i < segs; ++i) {
    tris.push([0, topRing[i], topRing[i + 1]]);
    tris.push([1, botRing[i + 1], botRing[i]]);
    tris.push([botRing[i], botRing[i + 1], topRing[i + 1]], [botRing[i], topRing[i + 1], topRing[i]]);
  }
  tris.push([1, botRing[0], topRing[0]], [1, topRing[0], 0]);
  tris.push([0, topRing[segs], botRing[segs]], [0, botRing[segs], 1]);
  const mesh = pushSmoothTris(verts, uvs, tris);
  const cols = new Float32Array(verts.length * 4);
  for (let i = 0; i < verts.length; ++i) {
    const rNorm = Math.min(1.0, Math.hypot(verts[i][0], verts[i][2]) / Math.max(1e-4, radius));
    const a = Math.atan2(verts[i][2], verts[i][0]);
    const vein = Math.pow(0.5 + 0.5 * Math.cos(a * 11.0), 3.0) * 0.06;
    const cen = 1.0 - rNorm * 0.42;
    cols[i * 4 + 0] = 0.14 + 0.16 * rNorm + vein * 0.5;
    cols[i * 4 + 1] = 0.34 + 0.24 * rNorm + 0.06 * (1 - cen) + vein;
    cols[i * 4 + 2] = 0.12 + 0.12 * rNorm;
    cols[i * 4 + 3] = 1.0;
  }
  mesh.colors = cols;
  return mesh;
}

/** Smooth continuous vertical/arched cattail & underwater stem tube using Mesh.tube. */
export function createSmoothTube(pts, rVals, sides = 10) {
  return Mesh.tube(pts, rVals, sides, { capStart: true, capEnd: true, miterJoints: true });
}

/** Graceful arching tufted bank clump of cattail stalks + sedge grass blades rooted together at y = -0.04. */
export function createSedgeClumpGeo(bladeCount = 14, seed = 1.0) {
  const meshes = [];
  for (let i = 0; i < bladeCount; ++i) {
    const a = (i / bladeCount) * Math.PI * 2 + seed * 0.7;
    const ox = Math.cos(a) * (0.02 + (i % 3) * 0.025);
    const oz = Math.sin(a) * (0.02 + (i % 3) * 0.025);
    const len = 0.46 + (i % 4) * 0.12;
    const path = Mesh.bladePath({
      base: [ox, -0.03, oz],
      tipDir: [Math.cos(a) * 0.48, 0.88, Math.sin(a) * 0.48],
      length: len,
      bend: 0.14 + (i % 3) * 0.06,
      lift: 0.12,
      segments: 7,
    });
    meshes.push(Mesh.bladeStrip(path, {
      width: 0.018,
      thickness: 0.002,
      profileScale: [1.0, 0.95, 0.88, 0.75, 0.56, 0.34, 0.14, 0.02],
      capStart: true,
      capEnd: true,
    }));
  }
  return Mesh.merge(meshes);
}

/** Traditional hexagonal Japanese carved stone Tōrō lantern meshes ({ stone, ember }). */
export function createCarvedLanternMeshes() {
  const hexSlab = (rBot, rTop, yBot, yTop) => {
    const segs = 6;
    const verts = [[0, yTop, 0], [0, yBot, 0]];
    const uvs = [[0.5, 0.5], [0.5, 0.5]];
    const tris = [], tr = [], br = [];
    for (let i = 0; i < segs; ++i) {
      const a = (i / segs) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      tr.push(verts.length); verts.push([ca * rTop, yTop, -sa * rTop]); uvs.push([0.5 + ca * 0.4, 0.5 - sa * 0.4]);
      br.push(verts.length); verts.push([ca * rBot, yBot, -sa * rBot]); uvs.push([0.5 + ca * 0.4, 0.5 - sa * 0.4]);
    }
    for (let i = 0; i < segs; ++i) {
      const j = (i + 1) % segs;
      tris.push([0, tr[i], tr[j]], [1, br[j], br[i]], [br[i], br[j], tr[j]], [br[i], tr[j], tr[i]]);
    }
    return pushSmoothTris(verts, uvs, tris);
  };

  const parts = [
    hexSlab(0.28, 0.24, -0.14, 0.10),
    Mesh.tube([[0, 0.06, 0], [0, 0.28, 0], [0, 0.44, 0], [0, 0.52, 0]], [0.11, 0.085, 0.095, 0.16], 10),
    hexSlab(0.18, 0.18, 0.51, 0.55),
    hexSlab(0.26, 0.12, 0.72, 0.82),
    hexSlab(0.26, 0.26, 0.70, 0.72),
    Mesh.sphere(0.065, 10, 8).scale(0.85, 1.35, 0.85).translate(0, 0.87, 0),
  ];
  for (let i = 0; i < 4; ++i) {
    const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
    const px = Math.cos(a) * 0.11, pz = Math.sin(a) * 0.11;
    parts.push(Mesh.tube([[px, 0.54, pz], [px, 0.71, pz]], 0.018, 6));
  }
  return {
    stone: Mesh.merge(parts),
    ember: Mesh.sphere(0.060, 12, 10).translate(0, 0.60, 0),
  };
}

/**
 * Watertight slender dragonfly anatomy pointing along -X nose-to-tail (Wait: head = +X = nose toward velocity!)
 * Actually Koi/Dragonfly both travel along +X (`atan2(-vz, vx)` aligns local +X to forward velocity (vx, vz)).
 * Mesh.leafCard extends along +Z, which is ALREADY perpendicular to local X!
 */
export function createDragonflyMeshes() {
  const head = Mesh.sphere(0.011, 10, 8).scale(1.05, 0.9, 1.15).translate(0.012, 0.004, 0);
  const eyeL = Mesh.sphere(0.0055, 8, 6).translate(0.016, 0.006, 0.007);
  const eyeR = Mesh.sphere(0.0055, 8, 6).translate(0.016, 0.006, -0.007);
  const bodyTube = Mesh.tube([
    [0.004, 0.003, 0],
    [-0.018, 0.009, 0],
    [-0.040, 0.004, 0],
    [-0.085, 0.001, 0],
    [-0.135, -0.001, 0],
  ], [0.0085, 0.011, 0.0055, 0.0042, 0.0028], 8, { capStart: true, capEnd: true });
  const body = Mesh.merge([head, eyeL, eyeR, bodyTube]);

  const paintWhite = (m) => {
    const c = new Float32Array(m.vertexCount * 4);
    for (let i = 0; i < m.vertexCount; ++i) { c[i * 4] = 1; c[i * 4 + 1] = 1; c[i * 4 + 2] = 1; c[i * 4 + 3] = 1; }
    m.colors = c;
    return m;
  };
  // Forewing + hindwing pair: leafCard already extends along +Z (lateral left), rotate PI around Y for right (-Z)
  const foreL = paintWhite(Mesh.leafCard('oval', { width: 0.016, length: 0.115, bend: 0.04, cup: 0.04, shapedSilhouette: true })
    .rotate(0, 1, 0, -0.18));
  const hindL = paintWhite(Mesh.leafCard('oval', { width: 0.019, length: 0.105, bend: 0.03, cup: 0.04, shapedSilhouette: true })
    .rotate(0, 1, 0, -0.42).translate(-0.018, -0.002, 0));
  const wingL = Mesh.merge([foreL, hindL]);

  const foreR = paintWhite(Mesh.leafCard('oval', { width: 0.016, length: 0.115, bend: 0.04, cup: 0.04, shapedSilhouette: true })
    .rotate(0, 1, 0, Math.PI + 0.18));
  const hindR = paintWhite(Mesh.leafCard('oval', { width: 0.019, length: 0.105, bend: 0.03, cup: 0.04, shapedSilhouette: true })
    .rotate(0, 1, 0, Math.PI + 0.42).translate(-0.018, -0.002, 0));
  const wingR = Mesh.merge([foreR, hindR]);

  return { body, wingL, wingR };
}
