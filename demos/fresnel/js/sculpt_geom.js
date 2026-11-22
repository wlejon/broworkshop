// js/sculpt_geom.js — Revolved masonry/optical profiles, UV primitives & helical staircase geometry.

export function vNorm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** Build indexed smooth-normal Mesh from `[x,y,z]` vertices, `[u,v]` coords, and `[i0,i1,i2]` tris. */
export function makeIndexedMesh(verts, uvs, tris) {
  const vn = Array.from({ length: verts.length }, () => [0, 0, 0]);
  for (const [i0, i1, i2] of tris) {
    const a = verts[i0], b = verts[i1], c = verts[i2];
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const k of [i0, i1, i2]) {
      vn[k][0] += nx;
      vn[k][1] += ny;
      vn[k][2] += nz;
    }
  }
  const pos = new Float32Array(verts.length * 3);
  const norm = new Float32Array(verts.length * 3);
  const uv = new Float32Array(verts.length * 2);
  for (let i = 0; i < verts.length; ++i) {
    pos[i * 3] = verts[i][0]; pos[i * 3 + 1] = verts[i][1]; pos[i * 3 + 2] = verts[i][2];
    const n = vNorm3(vn[i][0], vn[i][1], vn[i][2]);
    norm[i * 3] = n[0]; norm[i * 3 + 1] = n[1]; norm[i * 3 + 2] = n[2];
    uv[i * 2] = uvs[i][0]; uv[i * 2 + 1] = uvs[i][1];
  }
  const idx = new Uint32Array(tris.length * 3);
  for (let i = 0; i < tris.length; ++i) {
    idx[i * 3] = tris[i][0]; idx[i * 3 + 1] = tris[i][1]; idx[i * 3 + 2] = tris[i][2];
  }
  return new Mesh({ positions: pos, normals: norm, uvs: uv, indices: idx });
}

/** Full-extent box with world-scaled planar face UVs (wrapping bromesh's half-extent constructor). */
export function boxFull(w, h, d, uvScale = 0.8) {
  const m = Mesh.box(w * 0.5, h * 0.5, d * 0.5);
  const pos = m.positions, nrm = m.normals;
  const uvs = new Float32Array(m.vertexCount * 2);
  for (let i = 0; i < m.vertexCount; ++i) {
    const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
    const ax = Math.abs(nrm[i * 3]), ay = Math.abs(nrm[i * 3 + 1]), az = Math.abs(nrm[i * 3 + 2]);
    if (ax >= ay && ax >= az) {
      uvs[i * 2] = (pz + d * 0.5) * uvScale;
      uvs[i * 2 + 1] = (py + h * 0.5) * uvScale;
    } else if (ay >= ax && ay >= az) {
      uvs[i * 2] = (px + w * 0.5) * uvScale;
      uvs[i * 2 + 1] = (pz + d * 0.5) * uvScale;
    } else {
      uvs[i * 2] = (px + w * 0.5) * uvScale;
      uvs[i * 2 + 1] = (py + h * 0.5) * uvScale;
    }
  }
  m.uvs = uvs;
  return m;
}

/** Full-height cylinder along +Y with planar circular cap UVs (no radial seam pinching). */
export function cylFull(radius, height, segs = 20, uvScale = 0.8) {
  const m = Mesh.cylinder(radius, height * 0.5, segs);
  const pos = m.positions, nrm = m.normals;
  const uvs = new Float32Array(m.vertexCount * 2);
  const d = Math.max(0.02, radius * 2.0);
  for (let i = 0; i < m.vertexCount; ++i) {
    const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
    if (Math.abs(nrm[i * 3 + 1]) > 0.6) {
      uvs[i * 2] = (0.5 + px / d) * Math.max(1.0, uvScale * radius);
      uvs[i * 2 + 1] = (0.5 + pz / d) * Math.max(1.0, uvScale * radius);
    } else {
      uvs[i * 2] = (Math.atan2(pz, px) / (Math.PI * 2) + 0.5) * Math.max(1.0, radius * 2.5 * uvScale);
      uvs[i * 2 + 1] = (py + height * 0.5) * uvScale;
    }
  }
  m.uvs = uvs;
  return m;
}

/**
 * Revolve a closed or open `[r, y]` cross-section around +Y from `a0` to `a1`.
 * When `pts` is a closed CCW loop (outer bottom->top, top->inner, inner top->bottom, bottom->outer),
 * both full-circle rings and capped cutaway sectors emit strictly outward-facing normals.
 */
export function revolveProfile(pts, segs = 36, a0 = 0, a1 = Math.PI * 2, capEnds = true, uvScale = 0.75) {
  const closedLoop = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-4;
  const prof = closedLoop ? pts.slice() : [...pts, pts[0]];
  const np = prof.length;

  // Duplicate sharp-corner vertices so side, top, and cutaway faces stay crisply lit
  const verts = [], uvs = [], tris = [];
  const cumLen = [0];
  for (let j = 1; j < np; ++j) {
    cumLen.push(cumLen[j - 1] + Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]));
  }

  for (let j = 0; j < np - 1; ++j) {
    const [r0, y0] = prof[j], [r1, y1] = prof[j + 1];
    const base = verts.length;
    const meanR = Math.max(0.25, (r0 + r1) * 0.5);
    const arcLen = Math.abs(a1 - a0) * meanR * uvScale;
    const v0 = cumLen[j] * uvScale, v1 = cumLen[j + 1] * uvScale;
    for (let i = 0; i <= segs; ++i) {
      const t = i / segs;
      const th = a0 + (a1 - a0) * t;
      const sn = Math.sin(th), cs = Math.cos(th);
      verts.push([r0 * sn, y0, r0 * cs], [r1 * sn, y1, r1 * cs]);
      uvs.push([t * arcLen, v0], [t * arcLen, v1]);
    }
    for (let i = 0; i < segs; ++i) {
      const k = base + i * 2;
      tris.push([k, k + 2, k + 3], [k, k + 3, k + 1]);
    }
  }

  // Watertight end caps for non-360° cutaway arcs using exact outward normal alignment
  const span = Math.abs(a1 - a0);
  if (capEnds && span < Math.PI * 2 - 1e-3 && np >= 4) {
    const loop2D = prof.slice(0, np - 1);
    const m = loop2D.length;
    let cy = 0, cr = 0;
    for (const [r, y] of loop2D) { cr += r; cy += y; }
    cr /= m; cy /= m;

    const addCap = (angle, flipSign) => {
      const sn = Math.sin(angle), cs = Math.cos(angle);
      const outN = [-flipSign * cs, 0, flipSign * sn];
      const base = verts.length;
      verts.push([cr * sn, cy, cr * cs]);
      uvs.push([cr * uvScale, cy * uvScale]);
      for (const [r, y] of loop2D) {
        verts.push([r * sn, y, r * cs]);
        uvs.push([r * uvScale, y * uvScale]);
      }
      for (let j = 0; j < m; ++j) {
        const j1 = (j + 1) % m;
        const p0 = verts[base], p1 = verts[base + 1 + j], p2 = verts[base + 1 + j1];
        const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
        const dot = (e1[1] * e2[2] - e1[2] * e2[1]) * outN[0] +
                    (e1[2] * e2[0] - e1[0] * e2[2]) * outN[1] +
                    (e1[0] * e2[1] - e1[1] * e2[0]) * outN[2];
        if (dot >= 0) tris.push([base, base + 1 + j, base + 1 + j1]);
        else tris.push([base, base + 1 + j1, base + 1 + j]);
      }
    };
    addCap(a0, 1);
    addCap(a1, -1);
  }
  return makeIndexedMesh(verts, uvs, tris);
}

/** Carved granite gallery corbel bracket jutting from wall `rWall` out to `rOut`, `y0..y1`. */
export function buildCorbelBracket(rWall = 2.48, rOut = 2.98, y0 = 1.96, y1 = 2.50, width = 0.22) {
  const hw = width * 0.5;
  const dy = y1 - y0, dr = rOut - rWall;
  const prof = [
    [rWall - 0.04, y0],
    [rWall + dr * 0.26, y0 + dy * 0.22],
    [rWall + dr * 0.62, y0 + dy * 0.56],
    [rOut, y0 + dy * 0.84],
    [rOut, y1],
    [rWall - 0.04, y1],
  ];
  const n = prof.length;
  const verts = [], uvs = [], tris = [];
  // Side faces (+/- X in local bracket aligned along +Z)
  for (const s of [-1, 1]) {
    const base = verts.length;
    verts.push([s * hw, (y0 + y1) * 0.5, (rWall + rOut) * 0.5]);
    uvs.push([0.5, 0.5]);
    for (const [r, y] of prof) {
      verts.push([s * hw, y, r]);
      uvs.push([r * 1.2, y * 1.2]);
    }
    for (let j = 0; j < n; ++j) {
      const j1 = (j + 1) % n;
      if (s > 0) tris.push([base, base + 1 + j, base + 1 + j1]);
      else tris.push([base, base + 1 + j1, base + 1 + j]);
    }
  }
  // Perimeter quads
  const pBase = verts.length;
  for (let j = 0; j < n; ++j) {
    const j1 = (j + 1) % n;
    const [rA, yA] = prof[j], [rB, yB] = prof[j1];
    const b = verts.length;
    verts.push([-hw, yA, rA], [hw, yA, rA], [hw, yB, rB], [-hw, yB, rB]);
    uvs.push([0, 0], [width * 2, 0], [width * 2, 0.4], [0, 0.4]);
    tris.push([b, b + 1, b + 2], [b, b + 2, b + 3]);
  }
  void pBase;
  return makeIndexedMesh(verts, uvs, tris);
}

/** Helical cast-iron watchroom staircase climbing from floor `y=0` to iron service deck `y=2.56`. */
export function buildSpiralStaircase(steps = 16, rIn = 1.46, rOut = 2.08, aStart = 0.48 * Math.PI, aEnd = 1.18 * Math.PI) {
  const treadMeshes = [], railMeshes = [];
  const yTop = 2.56;
  const railPts = [];

  for (let i = 0; i < steps; ++i) {
    const frac = (i + 0.5) / steps;
    const y = (i + 1) * (yTop / steps) - 0.04;
    const th = aStart + (aEnd - aStart) * frac;
    const midR = (rIn + rOut) * 0.5;
    const tread = boxFull(0.29, 0.042, rOut - rIn, 1.4)
      .rotate(0, 1, 0, th)
      .translate(midR * Math.sin(th), y, midR * Math.cos(th));
    treadMeshes.push(tread);

    // Inner & outer wrought-iron risers/balusters anchored on tread up to helical handrail
    const bx = rIn * Math.sin(th), bz = rIn * Math.cos(th);
    const ox = (rOut - 0.04) * Math.sin(th), oz = (rOut - 0.04) * Math.cos(th);
    if (i > 0) {
      treadMeshes.push(cylFull(0.020, (yTop / steps) + 0.02, 8).translate(bx, y - (yTop / steps) * 0.5, bz));
      treadMeshes.push(cylFull(0.020, (yTop / steps) + 0.02, 8).translate(ox, y - (yTop / steps) * 0.5, oz));
    } else {
      treadMeshes.push(cylFull(0.024, y, 8).translate(bx, y * 0.5, bz));
      treadMeshes.push(cylFull(0.024, y, 8).translate(ox, y * 0.5, oz));
    }

    const railH = y + 0.84;
    railMeshes.push(cylFull(0.014, 0.84, 8).translate(bx, y + 0.42, bz));
    railPts.push([bx, railH, bz]);
  }
  const handrail = Mesh.tube(railPts, 0.024, 10, { capStart: true, capEnd: true });
  railMeshes.push(handrail);

  return {
    treadMesh: Mesh.merge(treadMeshes),
    handrailMesh: Mesh.merge(railMeshes),
  };
}
