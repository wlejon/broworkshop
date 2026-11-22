// js/geometry.js — Precision analytical mesh builders for the Aurelia brass armillary orrery.
// Every mesh outputs explicit positions, normals, uvs, and indices with sharp crease splits
// at angular discontinuities and smooth normals along swept curves.

function buildMeshFromBuffers(pos, nrm, uv, idx) {
  return new Mesh({
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    uvs: new Float32Array(uv),
    indices: new Uint32Array(idx),
  });
}

function pushQuad(pos, nrm, uv, idx, p0, p1, p2, p3, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
  const bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
  let nx = ay * bz - az * by;
  let ny = az * bx - ax * bz;
  let nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  const base = pos.length / 3;
  pos.push(...p0, ...p1, ...p2, ...p3);
  for (let i = 0; i < 4; ++i) nrm.push(nx, ny, nz);
  uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * Closed surface of revolution from a list of `[radius, y]` profile points.
 * Duplicate a `[r, y]` vertex or rely on angle threshold to split sharp lathe edges.
 */
export function createLatheMesh(profile, segments = 64, creaseDeg = 32) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  const cosThresh = Math.cos((creaseDeg * Math.PI) / 180);

  // Split profile into smooth segments wherever corner angle exceeds creaseDeg.
  const runs = [];
  let cur = [profile[0]];
  for (let i = 1; i < profile.length; ++i) {
    cur.push(profile[i]);
    if (i + 1 < profile.length) {
      const a = profile[i - 1], b = profile[i], c = profile[i + 1];
      const dr1 = b[0] - a[0], dy1 = b[1] - a[1];
      const dr2 = c[0] - b[0], dy2 = c[1] - b[1];
      const l1 = Math.hypot(dr1, dy1), l2 = Math.hypot(dr2, dy2);
      const dot = (l1 > 1e-6 && l2 > 1e-6) ? (dr1 * dr2 + dy1 * dy2) / (l1 * l2) : -1;
      if (dot < cosThresh) {
        runs.push(cur);
        cur = [profile[i]];
      }
    }
  }
  if (cur.length >= 2) runs.push(cur);

  for (const run of runs) {
    // Compute 2D outward normal (in r, y plane assuming CCW outer boundary from bottom to top).
    const segNorms = [];
    for (let i = 0; i < run.length - 1; ++i) {
      const dr = run[i + 1][0] - run[i][0];
      const dy = run[i + 1][1] - run[i][1];
      const len = Math.hypot(dr, dy) || 1;
      // Right-hand outward normal for CCW upward profile: (+dy, -dr)
      segNorms.push([dy / len, -dr / len]);
    }
    const baseVertex = pos.length / 3;
    const cols = segments + 1;
    for (let i = 0; i < run.length; ++i) {
      const [r, y] = run[i];
      let nr = 0, ny = 0;
      if (i > 0) { nr += segNorms[i - 1][0]; ny += segNorms[i - 1][1]; }
      if (i < segNorms.length) { nr += segNorms[i][0]; ny += segNorms[i][1]; }
      const nLen = Math.hypot(nr, ny) || 1;
      nr /= nLen; ny /= nLen;
      const vCoord = i / Math.max(1, run.length - 1);
      for (let s = 0; s <= segments; ++s) {
        const theta = (s / segments) * Math.PI * 2;
        const ct = Math.cos(theta), st = Math.sin(theta);
        pos.push(r * ct, y, r * st);
        nrm.push(nr * ct, ny, nr * st);
        uv.push((s / segments) * 4, vCoord);
      }
    }
    for (let i = 0; i < run.length - 1; ++i) {
      for (let s = 0; s < segments; ++s) {
        const a = baseVertex + i * cols + s;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        idx.push(a, c, d, a, d, b);
      }
    }
  }
  return buildMeshFromBuffers(pos, nrm, uv, idx);
}

/**
 * Chamfered rectangular-cross-section ring centered on origin in XZ plane.
 */
export function createBeveledRing(innerR, outerR, thickness, bevel = 0.015, segments = 96) {
  const hy = thickness * 0.5;
  const b = Math.min(bevel, (outerR - innerR) * 0.28, hy * 0.45);
  const profile = [
    [innerR + b, -hy],
    [outerR - b, -hy],
    [outerR, -hy + b],
    [outerR, hy - b],
    [outerR - b, hy],
    [innerR + b, hy],
    [innerR, hy - b],
    [innerR, -hy + b],
    [innerR + b, -hy],
  ];
  return createLatheMesh(profile, segments, 25);
}

/**
 * Precision spoked brass spur gear in the XZ plane, centered at Y = 0.
 */
export function createSpurGear(teeth, pitchR, thickness, holeR = 0.14, spokes = 6) {
  const pos = [], nrm = [], uv = [], idx = [];
  const hy = thickness * 0.5;
  const addendum = (pitchR * 1.15) / teeth;
  const dedendum = addendum * 1.2;
  const outerR = pitchR + addendum;
  const rootR = Math.max(holeR + 0.08, pitchR - dedendum);
  const rimInnerR = rootR - Math.min(0.10, (rootR - holeR) * 0.3);
  const hubOuterR = Math.min(rimInnerR - 0.02, holeR + Math.max(0.06, (rimInnerR - holeR) * 0.28));

  const ringSteps = teeth * 4;
  const toothRadiusAt = (step) => {
    const ph = ((step % 4) + 4) % 4;
    return (ph === 1 || ph === 2) ? outerR : rootR;
  };
  const angleAt = (step) => {
    const toothIdx = Math.floor(step / 4);
    const sub = ((step % 4) + 4) % 4;
    const base = (toothIdx / teeth) * Math.PI * 2;
    const dTooth = (Math.PI * 2) / teeth;
    const offsets = [0.08, 0.24, 0.56, 0.72];
    return base + offsets[sub] * dTooth;
  };

  // Outer toothed rim (between rimInnerR and toothed perimeter).
  for (let i = 0; i < ringSteps; ++i) {
    const a0 = angleAt(i), a1 = angleAt(i + 1);
    const r0 = toothRadiusAt(i), r1 = toothRadiusAt(i + 1);
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    const u0 = i / ringSteps, u1 = (i + 1) / ringSteps;

    // Top face
    pushQuad(pos, nrm, uv, idx,
      [rimInnerR * c0, hy, rimInnerR * s0],
      [rimInnerR * c1, hy, rimInnerR * s1],
      [r1 * c1, hy, r1 * s1],
      [r0 * c0, hy, r0 * s0], u0, 0, u1, 1);
    // Bottom face
    pushQuad(pos, nrm, uv, idx,
      [r0 * c0, -hy, r0 * s0],
      [r1 * c1, -hy, r1 * s1],
      [rimInnerR * c1, -hy, rimInnerR * s1],
      [rimInnerR * c0, -hy, rimInnerR * s0], u0, 0, u1, 1);
    // Outer tooth flank
    pushQuad(pos, nrm, uv, idx,
      [r0 * c0, -hy, r0 * s0],
      [r0 * c0, hy, r0 * s0],
      [r1 * c1, hy, r1 * s1],
      [r1 * c1, -hy, r1 * s1], u0, 0, u1, 1);
    // Inner rim wall
    pushQuad(pos, nrm, uv, idx,
      [rimInnerR * c1, -hy, rimInnerR * s1],
      [rimInnerR * c1, hy, rimInnerR * s1],
      [rimInnerR * c0, hy, rimInnerR * s0],
      [rimInnerR * c0, -hy, rimInnerR * s0], u0, 0, u1, 1);
  }

  // Central hub ring + bore.
  const hubSegs = 32;
  for (let i = 0; i < hubSegs; ++i) {
    const a0 = (i / hubSegs) * Math.PI * 2;
    const a1 = ((i + 1) / hubSegs) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    const hY = hy * 1.35;
    pushQuad(pos, nrm, uv, idx,
      [holeR * c0, hY, holeR * s0], [holeR * c1, hY, holeR * s1],
      [hubOuterR * c1, hY, hubOuterR * s1], [hubOuterR * c0, hY, hubOuterR * s0]);
    pushQuad(pos, nrm, uv, idx,
      [hubOuterR * c0, -hY, hubOuterR * s0], [hubOuterR * c1, -hY, hubOuterR * s1],
      [holeR * c1, -hY, holeR * s1], [holeR * c0, -hY, holeR * s0]);
    pushQuad(pos, nrm, uv, idx,
      [hubOuterR * c0, -hY, hubOuterR * s0], [hubOuterR * c0, hY, hubOuterR * s0],
      [hubOuterR * c1, hY, hubOuterR * s1], [hubOuterR * c1, -hY, hubOuterR * s1]);
    pushQuad(pos, nrm, uv, idx,
      [holeR * c1, -hY, holeR * s1], [holeR * c1, hY, holeR * s1],
      [holeR * c0, hY, holeR * s0], [holeR * c0, -hY, holeR * s0]);
  }

  // Radial spokes.
  const spokeHalfW = Math.max(0.018, pitchR * 0.06);
  const spokeHalfH = hy * 0.72;
  for (let k = 0; k < spokes; ++k) {
    const a = (k / spokes) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    const px = -dz * spokeHalfW, pz = dx * spokeHalfW;
    const rA = Math.max(holeR + 0.01, hubOuterR - 0.01), rB = rimInnerR + 0.015;
    const aL = [dx * rA + px, -spokeHalfH, dz * rA + pz];
    const aR = [dx * rA - px, -spokeHalfH, dz * rA - pz];
    const aLt = [dx * rA + px, spokeHalfH, dz * rA + pz];
    const aRt = [dx * rA - px, spokeHalfH, dz * rA - pz];
    const bL = [dx * rB + px, -spokeHalfH, dz * rB + pz];
    const bR = [dx * rB - px, -spokeHalfH, dz * rB - pz];
    const bLt = [dx * rB + px, spokeHalfH, dz * rB + pz];
    const bRt = [dx * rB - px, spokeHalfH, dz * rB - pz];
    pushQuad(pos, nrm, uv, idx, aLt, bLt, bRt, aRt);
    pushQuad(pos, nrm, uv, idx, aR, bR, bL, aL);
    pushQuad(pos, nrm, uv, idx, aL, bL, bLt, aLt);
    pushQuad(pos, nrm, uv, idx, aRt, bRt, bR, aR);
  }
  return buildMeshFromBuffers(pos, nrm, uv, idx);
}

/**
 * Smooth tubular curve swept through a 3D spline with variable radius `rFn(t)`.
 */
export function createTubeAlongPoints(pts, radiusOrFn = 0.022, radialSegs = 12, closedCaps = true) {
  const pos = [], nrm = [], uv = [], idx = [];
  const n = pts.length;
  const cols = radialSegs + 1;
  const frames = [];

  for (let i = 0; i < n; ++i) {
    const pPrev = pts[Math.max(0, i - 1)];
    const pNext = pts[Math.min(n - 1, i + 1)];
    let tx = pNext[0] - pPrev[0], ty = pNext[1] - pPrev[1], tz = pNext[2] - pPrev[2];
    const tLen = Math.hypot(tx, ty, tz) || 1;
    tx /= tLen; ty /= tLen; tz /= tLen;

    const up = Math.abs(ty) < 0.92 ? [0, 1, 0] : [0, 0, 1];
    let bx = ty * up[2] - tz * up[1];
    let by = tz * up[0] - tx * up[2];
    let bz = tx * up[1] - ty * up[0];
    const bLen = Math.hypot(bx, by, bz) || 1;
    bx /= bLen; by /= bLen; bz /= bLen;
    const nx = by * tz - bz * ty;
    const ny = bz * tx - bx * tz;
    const nz = bx * ty - by * tx;
    frames.push({ p: pts[i], n: [nx, ny, nz], b: [bx, by, bz], t: [tx, ty, tz] });
  }

  for (let i = 0; i < n; ++i) {
    const uFrac = i / Math.max(1, n - 1);
    const rad = typeof radiusOrFn === 'function' ? radiusOrFn(uFrac) : radiusOrFn;
    const f = frames[i];
    for (let s = 0; s <= radialSegs; ++s) {
      const a = (s / radialSegs) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const vx = f.n[0] * ca + f.b[0] * sa;
      const vy = f.n[1] * ca + f.b[1] * sa;
      const vz = f.n[2] * ca + f.b[2] * sa;
      pos.push(f.p[0] + rad * vx, f.p[1] + rad * vy, f.p[2] + rad * vz);
      nrm.push(vx, vy, vz);
      uv.push(uFrac * 4, s / radialSegs);
    }
  }
  for (let i = 0; i < n - 1; ++i) {
    for (let s = 0; s < radialSegs; ++s) {
      const a = i * cols + s, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }

  if (closedCaps) {
    for (const endIdx of [0, n - 1]) {
      const f = frames[endIdx];
      const rad = typeof radiusOrFn === 'function' ? radiusOrFn(endIdx === 0 ? 0 : 1) : radiusOrFn;
      const dir = endIdx === 0 ? -1 : 1;
      const cIdx = pos.length / 3;
      pos.push(...f.p);
      nrm.push(f.t[0] * dir, f.t[1] * dir, f.t[2] * dir);
      uv.push(0.5, 0.5);
      for (let s = 0; s <= radialSegs; ++s) {
        const a = (s / radialSegs) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const vx = f.n[0] * ca + f.b[0] * sa;
        const vy = f.n[1] * ca + f.b[1] * sa;
        const vz = f.n[2] * ca + f.b[2] * sa;
        pos.push(f.p[0] + rad * vx, f.p[1] + rad * vy, f.p[2] + rad * vz);
        nrm.push(f.t[0] * dir, f.t[1] * dir, f.t[2] * dir);
        uv.push(0.5 + 0.5 * ca, 0.5 + 0.5 * sa);
      }
      for (let s = 0; s < radialSegs; ++s) {
        if (endIdx === 0) idx.push(cIdx, cIdx + 2 + s, cIdx + 1 + s);
        else idx.push(cIdx, cIdx + 1 + s, cIdx + 2 + s);
      }
    }
  }
  return buildMeshFromBuffers(pos, nrm, uv, idx);
}

/** Smooth S-curve swan-neck cantilever arm from collar (r0, y0) to orbital stylus (r1, y1). */
export function createCantileverArm(r0, y0, r1, y1, tubeR = 0.024, steps = 28) {
  const pts = [];
  for (let i = 0; i <= steps; ++i) {
    const t = i / steps;
    const x = r0 + (r1 - r0) * t;
    // Cubic Hermite S-curve rising gracefully to planet seat height y1.
    const s = t * t * (3 - 2 * t);
    const bow = Math.sin(t * Math.PI) * ((y1 - y0) * 0.14);
    const y = y0 + (y1 - y0) * s - bow;
    pts.push([x, y, 0]);
  }
  // Vertical brass seat stylus below the planet
  pts.push([r1, y1 + 0.04, 0]);
  return createTubeAlongPoints(pts, (t) => tubeR * (1.28 - 0.36 * t), 12, true);
}

/** Flat radial-UV planetary ring annulus (rendered with twoSided: true). */
export function createRingDisk(innerR, outerR, segments = 96) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let s = 0; s <= segments; ++s) {
    const a = (s / segments) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    pos.push(innerR * ca, 0, innerR * sa);
    nrm.push(0, 1, 0);
    uv.push(0, s / segments);
    pos.push(outerR * ca, 0, outerR * sa);
    nrm.push(0, 1, 0);
    uv.push(1, s / segments);
  }
  for (let s = 0; s < segments; ++s) {
    const i = s * 2;
    idx.push(i, i + 1, i + 3, i, i + 3, i + 2);
  }
  return buildMeshFromBuffers(pos, nrm, uv, idx);
}

/** Raised brass degree tick marks around a horizontal circle of radius R. */
export function createDegreeTicks(R, y, lenMinor = 0.075, lenMajor = 0.145, count = 72, majorEvery = 6) {
  const pos = [], nrm = [], uv = [], idx = [];
  const hy = 0.012;
  for (let i = 0; i < count; ++i) {
    const major = (i % majorEvery) === 0;
    const hw = major ? 0.015 : 0.008;
    const l = major ? lenMajor : lenMinor;
    const r0 = R - l * 0.5, r1 = R + l * 0.5;
    const a = (i / count) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    const px = -dz * hw, pz = dx * hw;
    const b0L = [r0 * dx + px, y, r0 * dz + pz];
    const b0R = [r0 * dx - px, y, r0 * dz - pz];
    const b1L = [r1 * dx + px, y, r1 * dz + pz];
    const b1R = [r1 * dx - px, y, r1 * dz - pz];
    const t0L = [r0 * dx + px, y + hy * 2, r0 * dz + pz];
    const t0R = [r0 * dx - px, y + hy * 2, r0 * dz - pz];
    const t1L = [r1 * dx + px, y + hy * 2, r1 * dz + pz];
    const t1R = [r1 * dx - px, y + hy * 2, r1 * dz - pz];
    pushQuad(pos, nrm, uv, idx, t0L, t1L, t1R, t0R);
    pushQuad(pos, nrm, uv, idx, b0L, b1L, t1L, t0L);
    pushQuad(pos, nrm, uv, idx, b1R, b0R, t0R, t1R);
    pushQuad(pos, nrm, uv, idx, b0R, b0L, t0L, t0R);
    pushQuad(pos, nrm, uv, idx, b1L, b1R, t1R, t1L);
  }
  return buildMeshFromBuffers(pos, nrm, uv, idx);
}

/** Smooth UV sphere with clean equirectangular coordinates (no pole UV pinching). */
export function createSphereUV(radius = 1, segments = 48, rings = 32) {
  const pos = [], nrm = [], uv = [], idx = [];
  const cols = segments + 1;
  for (let y = 0; y <= rings; ++y) {
    const v = y / rings;
    const phi = v * Math.PI;
    const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
    for (let x = 0; x <= segments; ++x) {
      const u = x / segments;
      const theta = u * Math.PI * 2;
      const nx = Math.cos(theta) * sinPhi;
      const ny = cosPhi;
      const nz = Math.sin(theta) * sinPhi;
      pos.push(radius * nx, radius * ny, radius * nz);
      nrm.push(nx, ny, nz);
      uv.push(u, v);
    }
  }
  for (let y = 0; y < rings; ++y) {
    for (let x = 0; x < segments; ++x) {
      const a = y * cols + x, b = a + 1, c = a + cols, d = c + 1;
      if (y !== 0) idx.push(a, b, d);
      if (y !== rings - 1) idx.push(a, d, c);
    }
  }
  return buildMeshFromBuffers(pos, nrm, uv, idx);
}

/** Flat circular disc facing +Y with planar UVs mapped onto [0..1]^2. */
export function createFlatDisc(radius, segments = 64) {
  const pos = [0, 0, 0];
  const nrm = [0, 1, 0];
  const uv = [0.5, 0.5];
  const idx = [];
  for (let s = 0; s <= segments; ++s) {
    const a = (s / segments) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    pos.push(radius * ca, 0, radius * sa);
    nrm.push(0, 1, 0);
    uv.push(0.5 + 0.5 * ca, 0.5 + 0.5 * sa);
  }
  for (let s = 0; s < segments; ++s) {
    idx.push(0, 1 + s + 1, 1 + s);
  }
  return buildMeshFromBuffers(pos, nrm, uv, idx);
}
