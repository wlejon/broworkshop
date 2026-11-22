// js/geometry.js — Procedural mechanical CAD mesh primitives with outward CCW winding.

function cross(ax, ay, az, bx, by, bz) {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

function normalize3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** Build a Mesh computing Float32Array / Uint32Array typed buffers. */
function buildMesh(pos, norm, uv, idx) {
  return new Mesh({
    positions: new Float32Array(pos),
    normals: new Float32Array(norm),
    uvs: new Float32Array(uv),
    indices: new Uint32Array(idx),
  });
}

/** Push a triangle with geometric outward normal computed automatically. */
function pushTri(pos, norm, uv, idx, a, b, c, uva = [0, 0], uvb = [1, 0], uvc = [1, 1]) {
  const base = pos.length / 3;
  const n = normalize3(...cross(b[0] - a[0], b[1] - a[1], b[2] - a[2], c[0] - a[0], c[1] - a[1], c[2] - a[2]));
  pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  norm.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
  uv.push(uva[0], uva[1], uvb[0], uvb[1], uvc[0], uvc[1]);
  idx.push(base, base + 1, base + 2);
}

/** Push an outward CCW quad (a, b, c, d). */
function pushQuad(pos, norm, uv, idx, a, b, c, d, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
  pushTri(pos, norm, uv, idx, a, b, c, [u0, v0], [u1, v0], [u1, v1]);
  pushTri(pos, norm, uv, idx, a, c, d, [u0, v0], [u1, v1], [u0, v1]);
}

/** Right-handed (det = +1) axis remap from +Y lathe space to 'x', 'y', or 'z'. */
function mapAxis(p, axis) {
  if (axis === 'x') return [p[1], p[2], p[0]];
  if (axis === 'z') return [p[0], -p[2], p[1]];
  return p;
}

/**
 * Revolved surface of revolution from profile `[[r, y], ...]` ordered bottom -> top.
 * Uses verified outward winding (`a, c, d, a, d, b`).
 */
export function createLatheMesh(profile, segs = 36, axis = 'y', uScale = 1, vScale = 1) {
  const pos = [], norm = [], uv = [], idx = [];
  const rows = profile.length;
  for (let i = 0; i < rows; ++i) {
    const [r, y] = profile[i];
    const [pr, py] = profile[Math.max(0, i - 1)];
    const [nr, ny] = profile[Math.min(rows - 1, i + 1)];
    const dr = nr - pr, dy = ny - py;
    const nl = Math.hypot(dr, dy) || 1;
    const nrOut = dy / nl, nyOut = -dr / nl;
    const vCoord = (i / Math.max(1, rows - 1)) * vScale;
    for (let j = 0; j <= segs; ++j) {
      const th = (j / segs) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const p = mapAxis([r * c, y, -r * s], axis);
      const n = mapAxis([nrOut * c, nyOut, -nrOut * s], axis);
      pos.push(p[0], p[1], p[2]);
      norm.push(n[0], n[1], n[2]);
      uv.push((j / segs) * uScale, vCoord);
    }
  }
  const stride = segs + 1;
  for (let i = 0; i < rows - 1; ++i) {
    for (let j = 0; j < segs; ++j) {
      const a = i * stride + j;
      const b = a + stride;
      const c = a + 1;
      const d = b + 1;
      idx.push(a, c, d, a, d, b);
    }
  }
  return buildMesh(pos, norm, uv, idx);
}

/** Smooth swept tube along `pts` (`[[x,y,z], ...]`), optionally capped at ends. */
export function createTubeAlongPoints(pts, radiusOrFn, segs = 14, closedCaps = true) {
  const pos = [], norm = [], uv = [], idx = [];
  const rFn = typeof radiusOrFn === 'function' ? radiusOrFn : () => radiusOrFn;
  const nPts = pts.length;
  let prevB = null;
  for (let i = 0; i < nPts; ++i) {
    const p = pts[i];
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(nPts - 1, i + 1)];
    const t = normalize3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    let up = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let n = prevB ? cross(prevB[0], prevB[1], prevB[2], t[0], t[1], t[2]) : cross(up[0], up[1], up[2], t[0], t[1], t[2]);
    n = normalize3(n[0], n[1], n[2]);
    const b = normalize3(...cross(t[0], t[1], t[2], n[0], n[1], n[2]));
    prevB = b;
    const rad = rFn(i / Math.max(1, nPts - 1));
    for (let j = 0; j <= segs; ++j) {
      const a = (j / segs) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = n[0] * ca + b[0] * sa;
      const ny = n[1] * ca + b[1] * sa;
      const nz = n[2] * ca + b[2] * sa;
      pos.push(p[0] + nx * rad, p[1] + ny * rad, p[2] + nz * rad);
      norm.push(nx, ny, nz);
      uv.push(j / segs, (i / Math.max(1, nPts - 1)) * 3);
    }
  }
  const stride = segs + 1;
  for (let i = 0; i < nPts - 1; ++i) {
    for (let j = 0; j < segs; ++j) {
      const a = i * stride + j;
      const b = a + stride;
      const c = a + 1;
      const d = b + 1;
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
      norm.push(nCap[0], nCap[1], nCap[2]);
      uv.push(0.5, 0.5);
      const ringBase = endIdx * stride;
      for (let j = 0; j < segs; ++j) {
        const a = pos.length / 3;
        pos.push(pos[(ringBase + j) * 3], pos[(ringBase + j) * 3 + 1], pos[(ringBase + j) * 3 + 2]);
        norm.push(nCap[0], nCap[1], nCap[2]); uv.push(0, 0);
        const b = pos.length / 3;
        pos.push(pos[(ringBase + j + 1) * 3], pos[(ringBase + j + 1) * 3 + 1], pos[(ringBase + j + 1) * 3 + 2]);
        norm.push(nCap[0], nCap[1], nCap[2]); uv.push(1, 0);
        if (flip) idx.push(cVert, b, a);
        else idx.push(cVert, a, b);
      }
    }
  }
  return buildMesh(pos, norm, uv, idx);
}

/** True 3D helical coil spring along +Y (y = 0..height), scalable dynamically along Y. */
export function createHelicalSpring(coilR = 0.11, wireR = 0.017, turns = 5.5, height = 0.34, segsPerTurn = 24) {
  const total = Math.max(24, Math.round(turns * segsPerTurn));
  const pts = [];
  for (let i = 0; i <= total; ++i) {
    const t = i / total;
    const ang = t * turns * Math.PI * 2;
    pts.push([Math.cos(ang) * coilR, t * height, Math.sin(ang) * coilR]);
  }
  return createTubeAlongPoints(pts, wireR, 10, true);
}

/** Solid chamfered slab centered at origin (or shifted by [cx, cy, cz]). */
export function createChamferedBox(w, h, d, offset = [0, 0, 0]) {
  const hx = w * 0.5, hy = h * 0.5, hz = d * 0.5;
  const [ox, oy, oz] = offset;
  const p = (x, y, z) => [ox + x, oy + y, oz + z];
  const pos = [], norm = [], uv = [], idx = [];
  // 6 outward faces
  pushQuad(pos, norm, uv, idx, p(-hx, -hy, hz), p(hx, -hy, hz), p(hx, hy, hz), p(-hx, hy, hz));
  pushQuad(pos, norm, uv, idx, p(hx, -hy, -hz), p(-hx, -hy, -hz), p(-hx, hy, -hz), p(hx, hy, -hz));
  pushQuad(pos, norm, uv, idx, p(-hx, hy, hz), p(hx, hy, hz), p(hx, hy, -hz), p(-hx, hy, -hz));
  pushQuad(pos, norm, uv, idx, p(-hx, -hy, -hz), p(hx, -hy, -hz), p(hx, -hy, hz), p(-hx, -hy, hz));
  pushQuad(pos, norm, uv, idx, p(hx, -hy, hz), p(hx, -hy, -hz), p(hx, hy, -hz), p(hx, hy, hz));
  pushQuad(pos, norm, uv, idx, p(-hx, -hy, -hz), p(-hx, -hy, hz), p(-hx, hy, hz), p(-hx, hy, -hz));
  return buildMesh(pos, norm, uv, idx);
}

/** Extrude a closed 2D CCW polygon `pts` (`[[x,y], ...]`) along Z (`-halfT .. +halfT`) with end caps. */
function appendExtrudedPoly(pos, norm, uv, idx, pts, z0, z1) {
  const n = pts.length;
  // Side walls
  for (let i = 0; i < n; ++i) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    pushQuad(pos, norm, uv, idx, [x0, y0, z1], [x0, y0, z0], [x1, y1, z0], [x1, y1, z1]);
  }
  // Triangle fan caps (convex or star-shaped around centroid)
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= n; cy /= n;
  const cF = [cx, cy, z1], cB = [cx, cy, z0];
  for (let i = 0; i < n; ++i) {
    const a = pts[i], b = pts[(i + 1) % n];
    pushTri(pos, norm, uv, idx, cF, [a[0], a[1], z1], [b[0], b[1], z1]);
    pushTri(pos, norm, uv, idx, cB, [b[0], b[1], z0], [a[0], a[1], z0]);
  }
}

/** Add hollow extruded ring sector with teeth/spokes around Z axis (relative to `[cx, cy]`). */
function appendExtrudedRingStrip(pos, norm, uv, idx, outerPts, innerR, z0, z1, cx = 0, cy = 0) {
  const n = outerPts.length;
  for (let i = 0; i < n; ++i) {
    const j = (i + 1) % n;
    const oa = outerPts[i], ob = outerPts[j];
    const a0 = Math.atan2(oa[1] - cy, oa[0] - cx), a1 = Math.atan2(ob[1] - cy, ob[0] - cx);
    const ia = [cx + Math.cos(a0) * innerR, cy + Math.sin(a0) * innerR];
    const ib = [cx + Math.cos(a1) * innerR, cy + Math.sin(a1) * innerR];
    // Outer tooth face
    pushQuad(pos, norm, uv, idx, [oa[0], oa[1], z1], [oa[0], oa[1], z0], [ob[0], ob[1], z0], [ob[0], ob[1], z1]);
    // Inner face
    pushQuad(pos, norm, uv, idx, [ib[0], ib[1], z1], [ib[0], ib[1], z0], [ia[0], ia[1], z0], [ia[0], ia[1], z1]);
    // Front (+Z) annulus quad
    pushQuad(pos, norm, uv, idx, [ia[0], ia[1], z1], [oa[0], oa[1], z1], [ob[0], ob[1], z1], [ib[0], ib[1], z1]);
    // Back (-Z) annulus quad
    pushQuad(pos, norm, uv, idx, [ib[0], ib[1], z0], [ob[0], ob[1], z0], [oa[0], oa[1], z0], [ia[0], ia[1], z0]);
  }
}

/**
 * Precision spoked involute-style spur gear centered on Z axis.
 * Adjacent meshing gears at `d = R1 + R2` interleave cleanly.
 */
export function createSpurGear(teeth = 24, pitchR = 0.36, thick = 0.08, boreR = 0.08, spokes = 6) {
  const pos = [], norm = [], uv = [], idx = [];
  const mod = (2 * pitchR) / teeth;
  const tipR = pitchR + 0.85 * mod;
  const rootR = Math.max(boreR + 0.03, pitchR - 1.05 * mod);
  const rimInner = Math.max(boreR + 0.025, rootR - Math.max(0.035, mod * 1.3));
  const hubOuter = Math.min(rimInner - 0.01, boreR + Math.max(0.055, pitchR * 0.22));
  const hz = thick * 0.5;

  // Build trapezoidal involute profile points CCW around tooth pitch circle
  const outerPts = [];
  const step = (Math.PI * 2) / teeth;
  for (let t = 0; t < teeth; ++t) {
    const a = t * step;
    const p = [
      [a - step * 0.28, rootR],
      [a - step * 0.16, tipR],
      [a + step * 0.16, tipR],
      [a + step * 0.28, rootR],
    ];
    for (const [ang, r] of p) outerPts.push([Math.cos(ang) * r, Math.sin(ang) * r]);
  }
  appendExtrudedRingStrip(pos, norm, uv, idx, outerPts, rimInner, -hz, hz);

  // Solid center boss around bore
  const hubSegs = 28;
  const hubPts = [];
  for (let i = 0; i < hubSegs; ++i) {
    const a = (i / hubSegs) * Math.PI * 2;
    hubPts.push([Math.cos(a) * hubOuter, Math.sin(a) * hubOuter]);
  }
  appendExtrudedRingStrip(pos, norm, uv, idx, hubPts, boreR, -hz * 1.18, hz * 1.18);

  // Radial spokes spanning hubOuter -> rimInner (or solid web if small)
  if (rimInner > hubOuter + 0.025) {
    const spCount = Math.max(4, spokes);
    const hw = Math.min(0.032, (rimInner - hubOuter) * 0.28 + 0.014);
    const zSp = hz * 0.72;
    for (let s = 0; s < spCount; ++s) {
      const a = (s / spCount) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = -sa, ny = ca;
      const r0 = hubOuter - 0.008, r1 = rimInner + 0.008;
      const poly = [
        [ca * r0 - nx * hw, sa * r0 - ny * hw],
        [ca * r1 - nx * hw * 0.85, sa * r1 - ny * hw * 0.85],
        [ca * r1 + nx * hw * 0.85, sa * r1 + ny * hw * 0.85],
        [ca * r0 + nx * hw, sa * r0 + ny * hw],
      ];
      appendExtrudedPoly(pos, norm, uv, idx, poly, -zSp, zSp);
    }
  }
  return buildMesh(pos, norm, uv, idx);
}

/**
 * Conical mitre/bevel gear centered around +Y (cone apex at +coneH) for 90-degree drives.
 */
export function createBevelGear(teeth = 18, baseR = 0.22, coneH = 0.14, boreR = 0.06) {
  const pos = [], norm = [], uv = [], idx = [];
  const innerTopR = baseR * 0.56;
  const backPts = [];
  const step = (Math.PI * 2) / teeth;
  const addR = (2 * baseR / teeth) * 0.42;
  for (let t = 0; t < teeth; ++t) {
    const a = t * step;
    const profile = [
      [a - step * 0.28, baseR - addR * 0.85, innerTopR * 0.88],
      [a - step * 0.15, baseR + addR * 0.85, innerTopR * 1.12],
      [a + step * 0.15, baseR + addR * 0.85, innerTopR * 1.12],
      [a + step * 0.28, baseR - addR * 0.85, innerTopR * 0.88],
    ];
    for (const [ang, r0, r1] of profile) {
      backPts.push([Math.cos(ang), Math.sin(ang), r0, r1]);
    }
  }
  const n = backPts.length;
  for (let i = 0; i < n; ++i) {
    const j = (i + 1) % n;
    const [cx0, cz0, br0, tr0] = backPts[i];
    const [cx1, cz1, br1, tr1] = backPts[j];
    const pB0 = [cx0 * br0, 0, -cz0 * br0];
    const pB1 = [cx1 * br1, 0, -cz1 * br1];
    const pT0 = [cx0 * tr0, coneH, -cz0 * tr0];
    const pT1 = [cx1 * tr1, coneH, -cz1 * tr1];
    const pI0 = [cx0 * boreR, 0, -cz0 * boreR];
    const pI1 = [cx1 * boreR, 0, -cz1 * boreR];
    const pU0 = [cx0 * boreR, coneH, -cz0 * boreR];
    const pU1 = [cx1 * boreR, coneH, -cz1 * boreR];
    // Slanted bevel teeth face
    pushQuad(pos, norm, uv, idx, pB0, pB1, pT1, pT0);
    // Top rim
    pushQuad(pos, norm, uv, idx, pT0, pT1, pU1, pU0);
    // Bottom face
    pushQuad(pos, norm, uv, idx, pI0, pI1, pB1, pB0);
    // Inner bore
    pushQuad(pos, norm, uv, idx, pU0, pU1, pI1, pI0);
  }
  return buildMesh(pos, norm, uv, idx);
}

/** Heavy cast-iron spoked flywheel centered on Z axis. */
export function createSpokedFlywheel(outerR = 1.36, rimRadial = 0.19, depthZ = 0.22, hubR = 0.24, spokes = 8) {
  const pos = [], norm = [], uv = [], idx = [];
  const innerRimR = outerR - rimRadial;
  const hz = depthZ * 0.5;
  const segs = 64;
  const rimPts = [];
  for (let i = 0; i < segs; ++i) {
    const a = (i / segs) * Math.PI * 2;
    rimPts.push([Math.cos(a) * outerR, Math.sin(a) * outerR]);
  }
  appendExtrudedRingStrip(pos, norm, uv, idx, rimPts, innerRimR, -hz, hz);

  // Stepped center hub
  const hubPts = [];
  for (let i = 0; i < 32; ++i) {
    const a = (i / 32) * Math.PI * 2;
    hubPts.push([Math.cos(a) * hubR, Math.sin(a) * hubR]);
  }
  appendExtrudedRingStrip(pos, norm, uv, idx, hubPts, 0.098, -hz * 1.15, hz * 1.15);

  // Tapered spokes connecting hub to inner rim
  for (let s = 0; s < spokes; ++s) {
    const a = (s / spokes) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const nx = -sa, ny = ca;
    const r0 = hubR - 0.02, r1 = innerRimR + 0.02;
    const w0 = 0.056, w1 = 0.042;
    const zSp = hz * 0.42;
    appendExtrudedPoly(pos, norm, uv, idx, [
      [ca * r0 - nx * w0, sa * r0 - ny * w0],
      [ca * r1 - nx * w1, sa * r1 - ny * w1],
      [ca * r1 + nx * w1, sa * r1 + ny * w1],
      [ca * r0 + nx * w0, sa * r0 + ny * w0],
    ], -zSp, zSp);
  }
  return buildMesh(pos, norm, uv, idx);
}

/**
 * Thick-walled cutaway steam cylinder jacket centered along X (`x = -length/2 .. +length/2`).
 * Arc spans `cutEndRad .. cutStartRad + 2*pi` leaving a generous upper-front inspection window.
 */
export function createCutawayCylinder(innerR = 0.25, outerR = 0.34, length = 1.12, cutStart = 0.05, cutEnd = 1.65) {
  const pos = [], norm = [], uv = [], idx = [];
  const hx = length * 0.5;
  const arc = Math.PI * 2 - (cutEnd - cutStart);
  const segs = 36;
  const ring = (x, rad) => {
    const out = [];
    for (let i = 0; i <= segs; ++i) {
      const a = cutEnd + (i / segs) * arc;
      out.push([x, Math.sin(a) * rad, Math.cos(a) * rad]);
    }
    return out;
  };
  const oL = ring(-hx, outerR), oR = ring(hx, outerR);
  const iL = ring(-hx, innerR), iR = ring(hx, innerR);

  for (let i = 0; i < segs; ++i) {
    pushQuad(pos, norm, uv, idx, oL[i], oR[i], oR[i + 1], oL[i + 1]); // Outer barrel
    pushQuad(pos, norm, uv, idx, iL[i + 1], iR[i + 1], iR[i], iL[i]); // Inner bore
    pushQuad(pos, norm, uv, idx, iL[i], oL[i], oL[i + 1], iL[i + 1]); // Left end wall
    pushQuad(pos, norm, uv, idx, oR[i], iR[i], iR[i + 1], oR[i + 1]); // Right end wall
  }
  // Longitudinal cutaway walls exposing cylinder wall thickness
  pushQuad(pos, norm, uv, idx, oL[0], iL[0], iR[0], oR[0]);
  pushQuad(pos, norm, uv, idx, iL[segs], oL[segs], oR[segs], iR[segs]);
  return buildMesh(pos, norm, uv, idx);
}

/**
 * Forged connecting rod anchored at big-end center `[0,0,0]` extending to `-length` along X
 * (so rotationZ = gamma aligns cleanly from crankpin toward crosshead wrist pin).
 */
export function createConnectingRod(length = 1.78, bigR = 0.115, smallR = 0.072, thick = 0.068) {
  const pos = [], norm = [], uv = [], idx = [];
  const hz = thick * 0.5;
  // Big-end bearing ring (centered at [0, 0])
  const bigPts = [];
  for (let i = 0; i < 24; ++i) {
    const a = (i / 24) * Math.PI * 2;
    bigPts.push([Math.cos(a) * bigR, Math.sin(a) * bigR]);
  }
  appendExtrudedRingStrip(pos, norm, uv, idx, bigPts, bigR * 0.44, -hz * 1.15, hz * 1.15);

  // Small-end eye (centered at [-length, 0])
  const smPts = [];
  for (let i = 0; i < 20; ++i) {
    const a = (i / 20) * Math.PI * 2;
    smPts.push([-length + Math.cos(a) * smallR, Math.sin(a) * smallR]);
  }
  appendExtrudedRingStrip(pos, norm, uv, idx, smPts, smallR * 0.44, -hz * 1.05, hz * 1.05, -length, 0);

  // Tapered connecting beam (stops strictly outside eye bores!)
  const xStart = -bigR * 0.94, xEnd = -length + smallR * 0.94;
  const h0 = bigR * 0.58, h1 = smallR * 0.54;
  appendExtrudedPoly(pos, norm, uv, idx, [
    [xEnd, -h1], [xStart, -h0], [xStart, h0], [xEnd, h1],
  ], -hz * 0.62, hz * 0.62);
  return buildMesh(pos, norm, uv, idx);
}

/** Counterweighted teardrop crank web (`[0,0]` main shaft -> `[throwR, 0]` crankpin). */
export function createCrankWeb(throwR = 0.36, pinR = 0.085, mainR = 0.14, thick = 0.08) {
  const pos = [], norm = [], uv = [], idx = [];
  const pts = [];
  for (let i = 0; i < 12; ++i) {
    const a = Math.PI * 0.5 + (i / 11) * Math.PI;
    pts.push([-throwR * 0.55 + Math.cos(a) * (mainR * 1.45), Math.sin(a) * (mainR * 1.45)]);
  }
  for (let i = 0; i < 12; ++i) {
    const a = -Math.PI * 0.5 + (i / 11) * Math.PI;
    pts.push([throwR + Math.cos(a) * (pinR * 1.25), Math.sin(a) * (pinR * 1.25)]);
  }
  appendExtrudedPoly(pos, norm, uv, idx, pts, -thick * 0.5, thick * 0.5);
  return buildMesh(pos, norm, uv, idx);
}

/** Egg-shaped harmonic dwell-rise-fall cam lobe centered around Z axis. */
export function createCamLobe(baseR = 0.11, lift = 0.095, thick = 0.075) {
  const pos = [], norm = [], uv = [], idx = [];
  const segs = 36;
  const pts = [];
  for (let i = 0; i < segs; ++i) {
    const a = (i / segs) * Math.PI * 2;
    const lobe = Math.max(0, Math.cos(a));
    const r = baseR + lift * Math.pow(lobe, 2.2);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  appendExtrudedPoly(pos, norm, uv, idx, pts, -thick * 0.5, thick * 0.5);
  return buildMesh(pos, norm, uv, idx);
}

/** Open curved journal bearing saddle hugging bottom semicircle `boreR` around `centerY`. */
export function createBearingSaddle(w = 0.42, baseY = 0.34, centerY = 1.48, depthZ = 0.22, boreR = 0.094) {
  const pos = [], norm = [], uv = [], idx = [];
  const hw = w * 0.5, hz = depthZ * 0.5;
  const yLug = centerY - boreR - 0.03;
  appendExtrudedPoly(pos, norm, uv, idx, [[-hw, baseY], [hw, baseY], [hw, yLug], [-hw, yLug]], -hz, hz);
  const segs = 16;
  for (let i = 0; i < segs; ++i) {
    const a0 = Math.PI + (i / segs) * Math.PI;
    const a1 = Math.PI + ((i + 1) / segs) * Math.PI;
    const ix0 = Math.cos(a0) * boreR, iy0 = centerY + Math.sin(a0) * boreR;
    const ix1 = Math.cos(a1) * boreR, iy1 = centerY + Math.sin(a1) * boreR;
    const o0 = [Math.abs(Math.cos(a0)) > 0.7 ? Math.sign(Math.cos(a0)) * hw : Math.cos(a0) * hw * 0.85,
                Math.sin(a0) < -0.55 ? yLug : Math.max(yLug, centerY + Math.sin(a0) * boreR * 1.45)];
    const o1 = [Math.abs(Math.cos(a1)) > 0.7 ? Math.sign(Math.cos(a1)) * hw : Math.cos(a1) * hw * 0.85,
                Math.sin(a1) < -0.55 ? yLug : Math.max(yLug, centerY + Math.sin(a1) * boreR * 1.45)];
    appendExtrudedPoly(pos, norm, uv, idx, [[ix0, iy0], [ix1, iy1], [o1[0], o1[1]], [o0[0], o0[1]]], -hz, hz);
  }
  return buildMesh(pos, norm, uv, idx);
}

/** Curved upper brass bearing cap hugging top semicircle `boreR` around `centerY`. */
export function createBearingCap(w = 0.38, centerY = 1.48, topY = 1.66, depthZ = 0.22, boreR = 0.094) {
  const pos = [], norm = [], uv = [], idx = [];
  const hw = w * 0.5, hz = depthZ * 0.5;
  const segs = 16;
  const capOutR = Math.max(boreR + 0.055, topY - centerY);
  for (let i = 0; i < segs; ++i) {
    const a0 = (i / segs) * Math.PI;
    const a1 = ((i + 1) / segs) * Math.PI;
    const ix0 = Math.cos(a0) * boreR, iy0 = centerY + Math.sin(a0) * boreR;
    const ix1 = Math.cos(a1) * boreR, iy1 = centerY + Math.sin(a1) * boreR;
    const ox0 = Math.max(-hw, Math.min(hw, Math.cos(a0) * hw * 1.05));
    const ox1 = Math.max(-hw, Math.min(hw, Math.cos(a1) * hw * 1.05));
    const oy0 = Math.min(topY, centerY + Math.sin(a0) * capOutR + 0.015);
    const oy1 = Math.min(topY, centerY + Math.sin(a1) * capOutR + 0.015);
    appendExtrudedPoly(pos, norm, uv, idx, [[ix0, iy0], [ix1, iy1], [ox1, oy1], [ox0, oy0]], -hz, hz);
  }
  return buildMesh(pos, norm, uv, idx);
}
