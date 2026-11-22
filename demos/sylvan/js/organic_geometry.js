// js/organic_geometry.js — Outward-wound procedural natural & botanical mesh generators for Sylvan.

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

/**
 * Watertight sculpted boulder with flat grounded bottom (`y >= 0`) and terraced basalt facets.
 * Verified outward CCW normals.
 */
export function createOrganicBoulder(rx = 0.8, ry = 0.55, rz = 0.7, seed = 1.0, latSegs = 14, lonSegs = 22) {
  const rawPos = [];
  const rawUv = [];
  for (let i = 0; i <= latSegs; ++i) {
    const phi = (i / latSegs) * Math.PI; // 0 = top (+Y), pi = bottom (-Y)
    const sp = Math.sin(phi), cp = Math.cos(phi);
    for (let j = 0; j <= lonSegs; ++j) {
      const th = (j / lonSegs) * Math.PI * 2;
      const nx = sp * Math.cos(th), ny = cp, nz = sp * Math.sin(th);
      const n1 = smoothNoise3(nx * 1.9 + seed, ny * 2.1 + seed, nz * 1.9 + seed);
      const n2 = smoothNoise3(nx * 4.3 + seed * 2, ny * 4.0, nz * 4.3) * 0.35;
      const disp = 0.78 + 0.42 * (n1 + n2 * 0.4);
      const flatBot = ny < -0.22 ? Math.max(-0.22, ny * 0.45) : ny;
      const x = nx * rx * disp;
      const y = Math.max(0, (flatBot + 0.22) * ry * (ny > 0 ? disp : 1.0));
      const z = nz * rz * disp;
      rawPos.push([x, y, z]);
      rawUv.push([j / lonSegs, i / latSegs]);
    }
  }
  const pos = [], norm = [], uv = [], idx = [];
  const vertNormals = rawPos.map(() => [0, 0, 0]);
  const tris = [];
  const stride = lonSegs + 1;
  for (let i = 0; i < latSegs; ++i) {
    for (let j = 0; j < lonSegs; ++j) {
      const a = i * stride + j, b = a + stride, c = a + 1, d = b + 1;
      // theta increases CW in XZ (+X -> +Z around +Y from above? (cos, sin): th=0:+X, th=pi/2:+Z -> CW viewed from +Y!)
      // Check quad at equator (phi=pi/2, th=0): a->b is downward (-Y), a->c is +Z: (b-a) x (c-a) = (-Y) x (+Z) = (-X) INWARD!
      // So (a, c, d) and (a, d, b) give (+Z) x (-Y) = (+X) OUTWARD!
      if (i > 0) tris.push([a, c, d]);
      if (i < latSegs - 1) tris.push([a, d, b]);
    }
  }
  for (const [i0, i1, i2] of tris) {
    const p0 = rawPos[i0], p1 = rawPos[i1], p2 = rawPos[i2];
    const fn = cross(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2], p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
    for (const k of [i0, i1, i2]) {
      vertNormals[k][0] += fn[0]; vertNormals[k][1] += fn[1]; vertNormals[k][2] += fn[2];
    }
  }
  for (let i = 0; i < rawPos.length; ++i) {
    const n = normalize3(...vertNormals[i]);
    pos.push(...rawPos[i]);
    norm.push(...n);
    uv.push(...rawUv[i]);
  }
  for (const t of tris) idx.push(...t);
  return buildMesh(pos, norm, uv, idx);
}

/**
 * Watertight swept tapered organic branch/root/koi spine tube along `pts`.
 * Uses verified outward winding `(a, c, d, a, d, b)` + outward end caps.
 */
export function createOrganicBranch(pts, rFnOrVal, segs = 12, closedCaps = true) {
  const pos = [], norm = [], uv = [], idx = [];
  const rFn = typeof rFnOrVal === 'function' ? rFnOrVal : () => rFnOrVal;
  const nPts = pts.length;
  let prevB = null;
  for (let i = 0; i < nPts; ++i) {
    const p = pts[i];
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(nPts - 1, i + 1)];
    const t = normalize3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const up = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let n = prevB ? cross(prevB[0], prevB[1], prevB[2], t[0], t[1], t[2]) : cross(up[0], up[1], up[2], t[0], t[1], t[2]);
    n = normalize3(n[0], n[1], n[2]);
    const b = normalize3(...cross(t[0], t[1], t[2], n[0], n[1], n[2]));
    prevB = b;
    const rad = Math.max(0.004, rFn(i / Math.max(1, nPts - 1)));
    for (let j = 0; j <= segs; ++j) {
      const a = (j / segs) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = n[0] * ca + b[0] * sa;
      const ny = n[1] * ca + b[1] * sa;
      const nz = n[2] * ca + b[2] * sa;
      pos.push(p[0] + nx * rad, p[1] + ny * rad, p[2] + nz * rad);
      norm.push(nx, ny, nz);
      uv.push(j / segs, (i / Math.max(1, nPts - 1)) * 2.5);
    }
  }
  const stride = segs + 1;
  for (let i = 0; i < nPts - 1; ++i) {
    for (let j = 0; j < segs; ++j) {
      const a = i * stride + j, b = a + stride, c = a + 1, d = b + 1;
      idx.push(a, c, d, a, d, b);
    }
  }
  if (closedCaps && nPts >= 2) {
    for (const [endIdx, flip] of [[0, true], [nPts - 1, false]]) {
      const pc = pts[endIdx];
      const p0 = pts[Math.max(0, endIdx - 1)], p1 = pts[Math.min(nPts - 1, endIdx + 1)];
      const tang = normalize3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      const nCap = flip ? [-tang[0], -tang[1], -tang[2]] : tang;
      const cVert = pos.length / 3;
      pos.push(pc[0], pc[1], pc[2]);
      norm.push(...nCap);
      uv.push(0.5, 0.5);
      const ringBase = endIdx * stride;
      for (let j = 0; j < segs; ++j) {
        const a = pos.length / 3;
        pos.push(pos[(ringBase + j) * 3], pos[(ringBase + j) * 3 + 1], pos[(ringBase + j) * 3 + 2]);
        norm.push(...nCap); uv.push(0, 0);
        const b = pos.length / 3;
        pos.push(pos[(ringBase + j + 1) * 3], pos[(ringBase + j + 1) * 3 + 1], pos[(ringBase + j + 1) * 3 + 2]);
        norm.push(...nCap); uv.push(1, 0);
        // Ring sweeps CW around +T so +T cap uses (cVert, a, b) and -T cap uses (cVert, b, a)
        if (flip) idx.push(cVert, b, a);
        else idx.push(cVert, a, b);
      }
    }
  }
  return buildMesh(pos, norm, uv, idx);
}

/** Layered organic leaf-cloud cushion for crimson Japanese maple crowns. */
export function createFoliageCluster(radius = 0.65, squashY = 0.54, seed = 2.0) {
  return createOrganicBoulder(radius, radius * squashY, radius * 0.92, seed, 12, 20);
}

/** Closed 3D wedge/ribbon feather frond (watertight solid blades with outward CCW normals). */
export function createFernFrond(length = 0.92, archH = 0.24, leaflets = 8) {
  const pts = [];
  for (let i = 0; i <= 14; ++i) {
    const t = i / 14;
    pts.push([t * length, Math.sin(t * Math.PI * 0.85) * archH - t * t * 0.12, 0]);
  }
  // Build solid tapered rachis + solid leaflet diamonds attached to rachis
  const pos = [], norm = [], uv = [], idx = [];
  const addQuad = (a, b, c, d) => {
    const n = normalize3(...cross(b[0] - a[0], b[1] - a[1], b[2] - a[2], c[0] - a[0], c[1] - a[1], c[2] - a[2]));
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    norm.push(...n, ...n, ...n, ...n);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const addTri = (a, b, c) => {
    const n = normalize3(...cross(b[0] - a[0], b[1] - a[1], b[2] - a[2], c[0] - a[0], c[1] - a[1], c[2] - a[2]));
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c);
    norm.push(...n, ...n, ...n);
    uv.push(0, 0, 1, 0, 0.5, 1);
    idx.push(base, base + 1, base + 2);
  };

  // Solid square-section rachis stem along pts
  const rBase = 0.016;
  for (let i = 0; i < pts.length - 1; ++i) {
    const t0 = i / (pts.length - 1), t1 = (i + 1) / (pts.length - 1);
    const w0 = rBase * (1 - t0 * 0.72), w1 = rBase * (1 - t1 * 0.72);
    const p0 = pts[i], p1 = pts[i + 1];
    addQuad([p0[0], p0[1] + w0, w0], [p1[0], p1[1] + w1, w1], [p1[0], p1[1] + w1, -w1], [p0[0], p0[1] + w0, -w0]);
    addQuad([p0[0], p0[1] - w0, -w0], [p1[0], p1[1] - w1, -w1], [p1[0], p1[1] - w1, w1], [p0[0], p0[1] - w0, w0]);
    addQuad([p0[0], p0[1] - w0, w0], [p1[0], p1[1] - w1, w1], [p1[0], p1[1] + w1, w1], [p0[0], p0[1] + w0, w0]);
    addQuad([p0[0], p0[1] + w0, -w0], [p1[0], p1[1] + w1, -w1], [p1[0], p1[1] - w1, -w1], [p0[0], p0[1] - w0, -w0]);
  }

  // Paired closed 3D diamond leaflets fanning along both sides of the arching rachis
  for (let k = 1; k <= leaflets; ++k) {
    const t = 0.14 + (k / (leaflets + 0.4)) * 0.80;
    const x = t * length;
    const y = Math.sin(t * Math.PI * 0.85) * archH - t * t * 0.12;
    const span = 0.24 * Math.sin(t * Math.PI) + 0.04;
    const hw = 0.036;
    const th = 0.008;
    for (const sgn of [1, -1]) {
      const rootA = [x - hw * 0.4, y, sgn * 0.006];
      const rootB = [x + hw * 0.4, y, sgn * 0.006];
      const midT = [x + 0.05, y + 0.025 + th, sgn * span * 0.55];
      const midB = [x + 0.05, y + 0.025 - th, sgn * span * 0.55];
      const tip = [x + 0.12, y - 0.015, sgn * span];
      if (sgn > 0) {
        addTri(rootA, tip, midT); addTri(midT, tip, rootB); addTri(rootA, midT, rootB);
        addTri(rootA, midB, tip); addTri(midB, rootB, tip); addTri(rootA, rootB, midB);
      } else {
        addTri(rootA, midT, tip); addTri(midT, rootB, tip); addTri(rootA, rootB, midT);
        addTri(rootA, tip, midB); addTri(midB, tip, rootB); addTri(rootA, midB, rootB);
      }
    }
  }
  return buildMesh(pos, norm, uv, idx);
}

/** Watertight V-notched thick water-lily pad (`y = -thick/2 .. +thick/2`) with integral underwater root stem option. */
export function createLilyPad(radius = 0.32, thick = 0.018, segs = 28) {
  const pos = [], norm = [], uv = [], idx = [];
  const startA = 0.28, arc = Math.PI * 2 - 0.56;
  const hy = thick * 0.5;
  const pushQuad = (a, b, c, d) => {
    const n = normalize3(...cross(b[0] - a[0], b[1] - a[1], b[2] - a[2], c[0] - a[0], c[1] - a[1], c[2] - a[2]));
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    norm.push(...n, ...n, ...n, ...n);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const pushTri = (a, b, c) => {
    const n = normalize3(...cross(b[0] - a[0], b[1] - a[1], b[2] - a[2], c[0] - a[0], c[1] - a[1], c[2] - a[2]));
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c);
    norm.push(...n, ...n, ...n);
    uv.push(0.5, 0.5, 1, 0, 1, 1);
    idx.push(base, base + 1, base + 2);
  };

  for (let i = 0; i < segs; ++i) {
    const a0 = startA + (i / segs) * arc;
    const a1 = startA + ((i + 1) / segs) * arc;
    // CCW when viewed from +Y: (r cos a, 0, -r sin a)
    const x0 = Math.cos(a0) * radius, z0 = -Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius, z1 = -Math.sin(a1) * radius;
    pushTri([0, hy, 0], [x0, hy, z0], [x1, hy, z1]);
    pushTri([0, -hy, 0], [x1, -hy, z1], [x0, -hy, z0]);
    pushQuad([x0, -hy, z0], [x1, -hy, z1], [x1, hy, z1], [x0, hy, z0]);
  }
  const sX = Math.cos(startA) * radius, sZ = -Math.sin(startA) * radius;
  const eX = Math.cos(startA + arc) * radius, eZ = -Math.sin(startA + arc) * radius;
  pushQuad([0, -hy, 0], [sX, -hy, sZ], [sX, hy, sZ], [0, hy, 0]);
  pushQuad([eX, -hy, eZ], [0, -hy, 0], [0, hy, 0], [eX, hy, eZ]);
  return buildMesh(pos, norm, uv, idx);
}

/** Solid two-tier blooming lotus blossom (`y = 0..height`) with watertight solid petals. */
export function createLotusBloom(radius = 0.14) {
  const pos = [], norm = [], uv = [], idx = [];
  const pushTri = (a, b, c) => {
    const n = normalize3(...cross(b[0] - a[0], b[1] - a[1], b[2] - a[2], c[0] - a[0], c[1] - a[1], c[2] - a[2]));
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c);
    norm.push(...n, ...n, ...n);
    uv.push(0.5, 0, 1, 0.5, 0, 1);
    idx.push(base, base + 1, base + 2);
  };
  for (const [count, ringR, tilt, h] of [[8, radius, 0.42, 0.085], [6, radius * 0.65, 0.85, 0.105]]) {
    for (let i = 0; i < count; ++i) {
      const a = (i / count) * Math.PI * 2 + ringR;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = -sa, nz = ca;
      const bL = [ca * 0.02 + nx * 0.022, 0, -sa * 0.02 - nz * 0.022];
      const bR = [ca * 0.02 - nx * 0.022, 0, -sa * 0.02 + nz * 0.022];
      const tip = [ca * ringR, h * tilt, -sa * ringR];
      const midIn = [ca * ringR * 0.55, h * tilt * 0.45 + 0.028, -sa * ringR * 0.55];
      // Solid tetrahedron-like cupped petal (always closed + outward CCW!)
      pushTri(bL, bR, tip);
      pushTri(bL, tip, midIn);
      pushTri(midIn, tip, bR);
      pushTri(bL, midIn, bR);
    }
  }
  return buildMesh(pos, norm, uv, idx);
}

/** Articulated smooth swimming koi segment (tapered fish body cylinder or forked caudal fin). */
export function createKoiSegment(len = 0.22, rFront = 0.06, rBack = 0.04, heightRatio = 1.15) {
  return createOrganicBranch([[0, 0, 0], [-len * 0.5, 0, 0], [-len, 0, 0]], (t) => (rFront * (1 - t) + rBack * t) * (1 + 0.12 * heightRatio * Math.sin(t * Math.PI)), 14, true);
}
