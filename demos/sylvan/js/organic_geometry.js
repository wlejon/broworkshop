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

function rayTri(ro, rd, a, b, c) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const px = rd[1] * acz - rd[2] * acy;
  const py = rd[2] * acx - rd[0] * acz;
  const pz = rd[0] * acy - rd[1] * acx;
  const det = abx * px + aby * py + abz * pz;
  if (Math.abs(det) < 1e-7) return null;
  const inv = 1.0 / det;
  const tx = ro[0] - a[0], ty = ro[1] - a[1], tz = ro[2] - a[2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-4 || u > 1.0001) return null;
  const qx = ty * abz - tz * aby;
  const qy = tz * abx - tx * abz;
  const qz = tx * aby - ty * abx;
  const v = (rd[0] * qx + rd[1] * qy + rd[2] * qz) * inv;
  if (v < -1e-4 || u + v > 1.0002) return null;
  const t = (acx * qx + acy * qy + acz * qz) * inv;
  if (t <= 0.0) return null;
  const n = normalize3(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx);
  return { t, pos: [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t], normal: n };
}

function raycastRocks(targets, origin, dir) {
  let best = null;
  for (const tgt of targets) {
    const pos = tgt.mesh.positions, idx = tgt.mesh.indices;
    if (!pos || !idx) continue;
    const [ox, oy, oz] = tgt.pos;
    for (let k = 0; k + 2 < idx.length; k += 3) {
      const i0 = idx[k] * 3, i1 = idx[k + 1] * 3, i2 = idx[k + 2] * 3;
      const a = [pos[i0] + ox, pos[i0 + 1] + oy, pos[i0 + 2] + oz];
      const b = [pos[i1] + ox, pos[i1 + 1] + oy, pos[i1 + 2] + oz];
      const c = [pos[i2] + ox, pos[i2 + 1] + oy, pos[i2 + 2] + oz];
      const h = rayTri(origin, dir, a, b, c);
      if (h && (!best || h.t < best.t)) best = h;
    }
  }
  return best;
}

/**
 * Water sheet draped directly via raycasts over the actual cascade boulder surfaces down into the pond.
 * Top edge tucks softly into rock (-0.015), middle hugs every boulder curve (+0.014), bottom plunges to y = -0.04.
 */
export function createRockHuggingStream(rockTargets, xCenter, yStart, zMinHit, widthTop = 0.045, widthBot = 0.088, segsV = 22, segsW = 8) {
  const verts = [], uvs = [], tris = [];
  const stride = segsW + 1;
  const dir = normalize3(0.0, -0.22, -0.975);
  const grid = Array.from({ length: segsV + 1 }, () => new Array(stride));
  let lastValidZ = zMinHit;

  for (let i = 0; i <= segsV; ++i) {
    const v = i / segsV;
    const hw = widthTop + (widthBot - widthTop) * Math.pow(v, 0.82);
    const rowY = yStart * (1.0 - v) - 0.045 * v;
    for (let j = 0; j <= segsW; ++j) {
      const u = j / segsW;
      const s = u * 2.0 - 1.0;
      const x = xCenter + s * hw;
      const origin = [x, rowY + 0.14 * (1.0 - v), -0.45];
      const hit = raycastRocks(rockTargets, origin, dir);
      const crown = (1.0 - s * s) * 0.010;
      if (hit && hit.pos[1] > -0.04) {
        const pushOut = v < 0.08 ? (-0.012 + (v / 0.08) * 0.026) : 0.014;
        const nz = Math.max(0.25, hit.normal[2]);
        const ny = Math.max(0.0, hit.normal[1]);
        const nrm = normalize3(hit.normal[0] * 0.5, ny, nz);
        grid[i][j] = [
          hit.pos[0] + nrm[0] * (pushOut + crown * 0.2),
          Math.max(-0.045, hit.pos[1] + nrm[1] * (pushOut + crown * 0.3)),
          hit.pos[2] + nrm[2] * (pushOut + crown),
        ];
        lastValidZ = Math.max(lastValidZ, grid[i][j][2]);
      } else {
        grid[i][j] = [x, Math.max(-0.045, rowY), lastValidZ + v * 0.04 + crown];
      }
    }
  }
  // Light Laplacian smoothing along flow axis v to eliminate triangle-edge kinks while preserving boulder contour
  for (let pass = 0; pass < 2; ++pass) {
    for (let j = 0; j <= segsW; ++j) {
      for (let i = 1; i < segsV; ++i) {
        grid[i][j][1] = grid[i][j][1] * 0.5 + (grid[i - 1][j][1] + grid[i + 1][j][1]) * 0.25;
        grid[i][j][2] = grid[i][j][2] * 0.5 + (grid[i - 1][j][2] + grid[i + 1][j][2]) * 0.25;
      }
    }
  }
  for (let i = 0; i <= segsV; ++i) {
    const v = i / segsV;
    for (let j = 0; j <= segsW; ++j) {
      const u = j / segsW;
      verts.push(grid[i][j]);
      uvs.push([u, v]);
    }
  }
  for (let i = 0; i < segsV; ++i) {
    for (let j = 0; j < segsW; ++j) {
      const a = i * stride + j, b = a + stride, c = a + 1, d = b + 1;
      tris.push([a, b, d], [a, d, c]);
    }
  }
  const midBot = grid[segsV][Math.floor(segsW / 2)];
  return {
    mesh: pushSmoothTris(verts, uvs, tris),
    entry: [xCenter, midBot[2]],
  };
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

/** Organic V-notched water-lily pad with saucer mid-ring and upturned rim for polar-UV PBR vein mapping. */
export function createCurledLilyPad(radius = 0.25, segs = 36) {
  const verts = [[0, 0.002, 0], [0, -0.001, 0]];
  const uvs = [[0.5, 0.5], [0.5, 0.5]];
  const tris = [];
  const startA = 0.22, arc = Math.PI * 2 - 0.44;
  const midRing = [], topRing = [], botRing = [];
  for (let i = 0; i <= segs; ++i) {
    const t = i / segs;
    const a = startA + t * arc;
    const ca = Math.cos(a), sa = Math.sin(a);
    const rimWave = 1.0 + 0.028 * Math.sin(a * 7.0) + 0.015 * Math.cos(a * 13.0);
    const rm = radius * 0.56;
    const ro = radius * rimWave;
    const edgeLift = 0.009 + 0.005 * Math.sin(a * 5.0);

    midRing.push(verts.length);
    verts.push([ca * rm, 0.003, -sa * rm]); uvs.push([0.5 + ca * 0.27, 0.5 - sa * 0.27]);

    topRing.push(verts.length);
    verts.push([ca * ro, 0.005 + edgeLift, -sa * ro]); uvs.push([0.5 + ca * 0.48, 0.5 - sa * 0.48]);

    botRing.push(verts.length);
    verts.push([ca * ro, 0.000, -sa * ro]); uvs.push([0.5 + ca * 0.48, 0.5 - sa * 0.48]);
  }
  for (let i = 0; i < segs; ++i) {
    tris.push([0, midRing[i], midRing[i + 1]]);
    tris.push([midRing[i], topRing[i], topRing[i + 1]], [midRing[i], topRing[i + 1], midRing[i + 1]]);
    tris.push([1, botRing[i + 1], botRing[i]]);
    tris.push([botRing[i], botRing[i + 1], topRing[i + 1]], [botRing[i], topRing[i + 1], topRing[i]]);
  }
  tris.push([1, botRing[0], topRing[0]], [1, topRing[0], midRing[0]], [1, midRing[0], 0]);
  tris.push([0, midRing[segs], topRing[segs]], [0, topRing[segs], botRing[segs]], [0, botRing[segs], 1]);
  return pushSmoothTris(verts, uvs, tris);
}

/** Three-tier rounded cupped sacred lotus petals + separate textured seedpod receptacle & stamen ring. */
export function createSculptedLotusMeshes() {
  const petalCard = Mesh.leafCard('oval', {
    width: 0.068, length: 0.118, bend: 0.28, cup: 0.34,
    fullUV: true, shapedSilhouette: false, widthSegments: 5, lengthSegments: 7,
  });
  const vc = petalCard.vertexCount;
  const white = new Float32Array(vc * 4);
  for (let i = 0; i < vc * 4; ++i) white[i] = 1.0;
  petalCard.colors = white;

  // Negative rotateX tilts +Z leafCard UPWARD (+Y) & OUTWARD (+Z): outer open -> mid cupped -> inner erect
  const tiers = [
    { count: 8, elev: 0.28, radius: 0.028, y: 0.005, scale: 1.00, twist: 0.0 },
    { count: 8, elev: 0.62, radius: 0.022, y: 0.009, scale: 0.88, twist: Math.PI / 8 },
    { count: 6, elev: 0.98, radius: 0.015, y: 0.014, scale: 0.72, twist: Math.PI / 12 },
  ];
  const petalParts = [];
  for (const tier of tiers) {
    for (let i = 0; i < tier.count; ++i) {
      const a = (i / tier.count) * Math.PI * 2 + tier.twist;
      const p = petalCard.clone()
        .scale(tier.scale, tier.scale, tier.scale)
        .rotate(1, 0, 0, -tier.elev)
        .translate(0, tier.y, tier.radius)
        .rotate(0, 1, 0, a);
      petalParts.push(p);
    }
  }

  // Receptacle seedpod cone + 18 curved golden stamen filaments with anther tips
  const receptacle = Mesh.tube([[0, 0.0, 0], [0, 0.022, 0]], [0.026, 0.014], 12, { capStart: true, capEnd: true });
  const stamenParts = [receptacle];
  for (let i = 0; i < 18; ++i) {
    const a = (i / 18) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const r0 = 0.022, r1 = 0.030;
    stamenParts.push(Mesh.tube([
      [ca * r0, 0.015, sa * r0],
      [ca * (r0 + 0.006), 0.028, sa * (r0 + 0.006)],
      [ca * r1, 0.038, sa * r1],
    ], [0.0020, 0.0016, 0.0026], 5, { capStart: false, capEnd: true }));
  }
  return {
    petals: Mesh.merge(petalParts),
    stamens: Mesh.merge(stamenParts),
  };
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
  // Enforce continuous axial chitin UVs along +X -> -X so segmented body markings align cleanly
  const bPos = body.positions;
  const bUvs = new Float32Array(body.vertexCount * 2);
  for (let i = 0; i < body.vertexCount; ++i) {
    const px = bPos[i * 3 + 0], pz = bPos[i * 3 + 2];
    bUvs[i * 2 + 0] = Math.max(0, Math.min(1, (0.022 - px) / 0.165));
    bUvs[i * 2 + 1] = Math.max(0, Math.min(1, 0.5 + pz / 0.028));
  }
  body.uvs = bUvs;

  // Forewing + hindwing pair with fullUV & white vertex colors (leafCard packs windBend into r otherwise!)
  const paintWhite = (m) => {
    const c = new Float32Array(m.vertexCount * 4);
    for (let i = 0; i < c.length; ++i) c[i] = 1.0;
    m.colors = c;
    return m;
  };
  const foreL = paintWhite(Mesh.leafCard('oval', { width: 0.022, length: 0.120, bend: 0.04, cup: 0.03, fullUV: true, shapedSilhouette: false })
    .rotate(0, 1, 0, -0.18));
  const hindL = paintWhite(Mesh.leafCard('oval', { width: 0.025, length: 0.108, bend: 0.03, cup: 0.03, fullUV: true, shapedSilhouette: false })
    .rotate(0, 1, 0, -0.42).translate(-0.018, -0.002, 0));
  const wingL = Mesh.merge([foreL, hindL]);

  const foreR = paintWhite(Mesh.leafCard('oval', { width: 0.022, length: 0.120, bend: 0.04, cup: 0.03, fullUV: true, shapedSilhouette: false })
    .rotate(0, 1, 0, Math.PI + 0.18));
  const hindR = paintWhite(Mesh.leafCard('oval', { width: 0.025, length: 0.108, bend: 0.03, cup: 0.03, fullUV: true, shapedSilhouette: false })
    .rotate(0, 1, 0, Math.PI + 0.42).translate(-0.018, -0.002, 0));
  const wingR = Mesh.merge([foreR, hindR]);

  return { body, wingL, wingR };
}
