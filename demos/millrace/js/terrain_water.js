// js/terrain_water.js — Alpine valley terrain, sculpted granite boulders, raycast cliff stream & optical millpond shaders.

function normalize3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
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

export function pushSmoothTris(verts, uvs, tris) {
  const vn = verts.map(() => [0, 0, 0]);
  for (const [i0, i1, i2] of tris) {
    const a = verts[i0], b = verts[i1], c = verts[i2];
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    for (const k of [i0, i1, i2]) { vn[k][0] += nx; vn[k][1] += ny; vn[k][2] += nz; }
  }
  const pos = [], norm = [], uv = [], idx = [];
  for (let i = 0; i < verts.length; ++i) {
    pos.push(...verts[i]);
    norm.push(...normalize3(...vn[i]));
    uv.push(...uvs[i]);
  }
  for (const t of tris) idx.push(...t);
  return new Mesh({
    positions: new Float32Array(pos),
    normals: new Float32Array(norm),
    uvs: new Float32Array(uv),
    indices: new Uint32Array(idx),
  });
}

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Signed water-basin factor < 0 inside pond & wheelpit tailrace channel, > 0 on dry land. */
export function waterMaskAt(x, z) {
  // Broad southern Millpond centered at (-0.85, 2.35)
  const px = (x + 0.85) / 2.85, pz = (z - 2.35) / 2.25;
  const ang = Math.atan2(pz, px);
  const wobble = 1.0 + 0.08 * Math.sin(ang * 3.0 + 0.4) + 0.05 * Math.cos(ang * 5.0 - 0.6);
  const pondDist = Math.hypot(px, pz) / wobble;

  // Tailrace channel running south from wheelpit (-0.45, -1.75) into pond (-0.45, 0.8)
  const dxR = Math.abs(x + 0.45) / 0.62;
  const zClamp = z < -1.85 ? (-1.85 - z) / 0.35 : (z > 0.85 ? (z - 0.85) / 0.35 : 0.0);
  const raceDist = Math.hypot(dxR, zClamp);
  return Math.min(pondDist, raceDist) - 1.0;
}

/** Exact analytical elevation across the 14m x 14m Millrace alpine valley. */
export function valleyHeightAt(x, z) {
  const wm = waterMaskAt(x, z);
  const n1 = smoothNoise3(x * 0.42 + 1.3, 0, z * 0.42 + 2.7) - 0.5;
  const n2 = smoothNoise3(x * 1.15, 0, z * 1.15) - 0.5;

  // Base meadow rolling gently above waterline (0.28..0.52m)
  let h = 0.34 + n1 * 0.22 + n2 * 0.06;

  // Raised NW alpine granite cliff bench (-3.4, -3.4) up to ~2.32m
  const cwX = smoothstep(-0.4, -2.5, x);
  const cwZ = smoothstep(-1.1, -3.0, z);
  h += cwX * cwZ * 2.02;

  // Gentle West shore maple knoll (-4.0, 0.6) ~0.68m
  const dm = ((x + 4.1) * (x + 4.1)) / 2.8 + ((z - 0.5) * (z - 0.5)) / 3.2;
  h += 0.32 * Math.exp(-dm);

  // Leveled stone terrace under the watermill & gear porch (x: 0.72..4.3, z: -3.2..0.9 -> y = 0.42m),
  // leaving a dedicated sunken gear-pit recess under Main Cast-Iron Pit Gear at (0.62, -0.95)
  const mx = smoothstep(0.10, 0.55, x) * (1.0 - smoothstep(4.2, 4.9, x));
  const mz = smoothstep(-3.4, -2.7, z) * (1.0 - smoothstep(0.75, 1.35, z));
  const millFlat = mx * mz;
  h = h * (1.0 - millFlat) + 0.42 * millFlat;

  const pitRecess = (1.0 - smoothstep(0.14, 0.26, Math.abs(x - 0.62))) * (1.0 - smoothstep(0.48, 0.68, Math.abs(z + 0.95)));
  h = h * (1.0 - pitRecess) + 0.16 * pitRecess;

  // Excavate water pond & wheelpit tailrace down to -0.64m
  if (wm < 0.28) {
    const bankT = smoothstep(-0.26, 0.28, wm);
    const pondBed = -0.66 + n2 * 0.05;
    h = pondBed * (1.0 - bankT) + h * bankT;
  }
  return h;
}

/** Sculpted watertight 14m x 14m valley floor + chamfered stone cliff diorama plinth. */
export function createSculptedValleyTerrain(segs = 88) {
  const verts = [], uvs = [], tris = [];
  const rads = [
    0.0, 0.4, 0.85, 1.35, 1.9, 2.45, 3.0, 3.6, 4.2, 4.8, 5.4, 6.0, 6.55,
    6.78, 6.84, 6.35,
  ];
  const rings = [];
  verts.push([0, valleyHeightAt(0, 0), 0]);
  uvs.push([0.5, 0.5]);

  for (let ri = 1; ri < rads.length; ++ri) {
    const rBase = rads[ri];
    const start = verts.length;
    for (let j = 0; j < segs; ++j) {
      const a = (j / segs) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const wob = ri >= 11 ? 1.0 + 0.025 * Math.sin(a * 6.0 + 0.5) + 0.015 * Math.cos(a * 9.0) : 1.0;
      const rr = rBase * wob;
      const x = ca * rr, z = -sa * rr;
      let y = valleyHeightAt(x, z);
      if (ri === 13) y = Math.min(y, 0.04);
      else if (ri === 14) y = -0.74;
      else if (ri === 15) y = -0.82;
      verts.push([x, y, z]);
      uvs.push([0.5 + x * 0.075, 0.5 + z * 0.075]);
    }
    rings.push(start);
  }
  const cBot = verts.length;
  verts.push([0, -0.82, 0]);
  uvs.push([0.5, 0.5]);

  for (let j = 0; j < segs; ++j) tris.push([0, rings[0] + j, rings[0] + ((j + 1) % segs)]);
  for (let ri = 0; ri < rings.length - 1; ++ri) {
    const r0 = rings[ri], r1 = rings[ri + 1];
    for (let j = 0; j < segs; ++j) {
      const j1 = (j + 1) % segs;
      tris.push([r0 + j, r1 + j, r1 + j1], [r0 + j, r1 + j1, r0 + j1]);
    }
  }
  const last = rings[rings.length - 1];
  for (let j = 0; j < segs; ++j) tris.push([cBot, last + ((j + 1) % segs), last + j]);
  return pushSmoothTris(verts, uvs, tris);
}

/** Subdivided icosphere alpine granite boulder with stratified ledges and grounded base. */
export function createSculptedGraniteBoulder(rx = 0.8, ry = 0.6, rz = 0.7, seed = 1.0) {
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
  const verts = [], uvs = [];
  for (const [nx, ny, nz] of icoV) {
    const n1 = smoothNoise3(nx * 2.0 + seed, ny * 2.2 + seed, nz * 2.0 + seed);
    const n2 = smoothNoise3(nx * 4.5 + seed * 1.4, ny * 4.5, nz * 4.5) * 0.30;
    const strata = Math.sin(ny * 11.0 + n1 * 3.8) * 0.055;
    const disp = 0.78 + 0.36 * (n1 + n2 * 0.4) + strata;
    const flatY = ny < -0.20 ? -0.20 + (ny + 0.20) * 0.14 : ny;
    verts.push([nx * rx * disp, (flatY + 0.20) * ry * (ny > 0 ? disp : 1.0) - 0.14, nz * rz * disp]);
    uvs.push([0.5 + nx * 0.45, 0.5 - ny * 0.45]);
  }
  return pushSmoothTris(verts, uvs, icoF);
}

/** Raycast mountain stream sheet draping cleanly down granite ledges & terrain into millpond. */
function rayTri(ro, rd, a, b, c) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const px = rd[1] * acz - rd[2] * acy, py = rd[2] * acx - rd[0] * acz, pz = rd[0] * acy - rd[1] * acx;
  const det = abx * px + aby * py + abz * pz;
  if (Math.abs(det) < 1e-7) return null;
  const inv = 1.0 / det;
  const tx = ro[0] - a[0], ty = ro[1] - a[1], tz = ro[2] - a[2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-4 || u > 1.0001) return null;
  const qx = ty * abz - tz * aby, qy = tz * abx - tx * abz, qz = tx * aby - ty * abx;
  const v = (rd[0] * qx + rd[1] * qy + rd[2] * qz) * inv;
  if (v < -1e-4 || u + v > 1.0002) return null;
  const t = (acx * qx + acy * qy + acz * qz) * inv;
  if (t <= 0.0) return null;
  const n = normalize3(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx);
  return { t, pos: [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t], normal: n };
}

export function createRockHuggingCascade(rockTargets, xStart, zStart, xEnd, zEnd, wTop = 0.08, wBot = 0.22, segsV = 24, segsW = 8) {
  const verts = [], uvs = [], tris = [];
  const stride = segsW + 1;
  const rayDir = normalize3(0.0, -1.0, 0.0);
  const grid = Array.from({ length: segsV + 1 }, () => new Array(stride));

  for (let i = 0; i <= segsV; ++i) {
    const v = i / segsV;
    const cx = xStart + (xEnd - xStart) * v + Math.sin(v * Math.PI) * 0.14;
    const cz = zStart + (zEnd - zStart) * v;
    const hw = wTop + (wBot - wTop) * Math.pow(v, 0.85);
    const [tx, tz] = normalize3(-(zEnd - zStart), 0, xEnd - xStart);
    const lateral = normalize3(tx, 0, tz);
    for (let j = 0; j <= segsW; ++j) {
      const u = j / segsW;
      const s = u * 2.0 - 1.0;
      const px = cx + lateral[0] * s * hw;
      const pz = cz + lateral[2] * s * hw;
      let surfY = valleyHeightAt(px, pz);
      const eps = 0.04;
      let surfN = normalize3(
        valleyHeightAt(px - eps, pz) - valleyHeightAt(px + eps, pz),
        2.0 * eps,
        valleyHeightAt(px, pz - eps) - valleyHeightAt(px, pz + eps),
      );
      for (const tgt of rockTargets) {
        const pos = tgt.mesh.positions, idx = tgt.mesh.indices;
        if (!pos || !idx) continue;
        const [ox, oy, oz] = tgt.pos;
        const hit = (() => {
          let best = null;
          for (let k = 0; k + 2 < idx.length; k += 3) {
            const i0 = idx[k] * 3, i1 = idx[k + 1] * 3, i2 = idx[k + 2] * 3;
            const h = rayTri([px, 5.0, pz], rayDir,
              [pos[i0] + ox, pos[i0 + 1] + oy, pos[i0 + 2] + oz],
              [pos[i1] + ox, pos[i1 + 1] + oy, pos[i1 + 2] + oz],
              [pos[i2] + ox, pos[i2 + 1] + oy, pos[i2 + 2] + oz]);
            if (h && (!best || h.t < best.t)) best = h;
          }
          return best;
        })();
        if (hit && hit.pos[1] > surfY) {
          surfY = hit.pos[1];
          surfN = hit.normal[1] < 0 ? [-hit.normal[0], -hit.normal[1], -hit.normal[2]] : hit.normal;
        }
      }
      const edgeTaper = 1.0 - s * s;
      const push = 0.008 + edgeTaper * 0.014;
      const ny = Math.max(-0.04, surfY + surfN[1] * push);
      grid[i][j] = [px + surfN[0] * push, ny, pz + surfN[2] * push];
    }
  }
  const rawY = grid.map((row) => row.map((p) => p[1]));
  for (let pass = 0; pass < 1; ++pass) {
    for (let j = 0; j <= segsW; ++j) {
      for (let i = 1; i < segsV; ++i) {
        const sm = grid[i][j][1] * 0.6 + (grid[i - 1][j][1] + grid[i + 1][j][1]) * 0.2;
        grid[i][j][1] = Math.min(rawY[i][j] + 0.018, Math.max(rawY[i][j] - 0.006, sm));
      }
    }
  }
  for (let i = 0; i <= segsV; ++i) {
    for (let j = 0; j <= segsW; ++j) {
      verts.push(grid[i][j]);
      uvs.push([j / segsW, i / segsV]);
    }
  }
  for (let i = 0; i < segsV; ++i) {
    for (let j = 0; j < segsW; ++j) {
      const a = i * stride + j, b = a + stride, c = a + 1, d = b + 1;
      tris.push([a, b, d], [a, d, c]);
    }
  }
  return { mesh: pushSmoothTris(verts, uvs, tris), entry: [xEnd, zEnd] };
}

/** Tessellated pond & tailrace water sheet spanning `[-3.9..2.2] x [-2.1..5.1]` at `y = 0`. */
export function createMillpondWaterMesh(nx = 72, nz = 84) {
  const verts = [], uvs = [], tris = [];
  const xMin = -3.9, xMax = 2.2, zMin = -2.1, zMax = 5.1;
  for (let j = 0; j <= nz; ++j) {
    const v = j / nz;
    const z = zMin + (zMax - zMin) * v;
    for (let i = 0; i <= nx; ++i) {
      const u = i / nx;
      const x = xMin + (xMax - xMin) * u;
      verts.push([x, 0.0, z]);
      uvs.push([u, v]);
    }
  }
  const stride = nx + 1;
  for (let j = 0; j < nz; ++j) {
    for (let i = 0; i < nx; ++i) {
      const a = j * stride + i, b = a + stride, c = a + 1, d = b + 1;
      // Only emit quads within 0.35 margin of basin so shoreline feather works without stretching
      const cx = (verts[a][0] + verts[d][0]) * 0.5, cz = (verts[a][2] + verts[d][2]) * 0.5;
      if (waterMaskAt(cx, cz) < 0.35) tris.push([a, b, d], [a, d, c]);
    }
  }
  return pushSmoothTris(verts, uvs, tris);
}

export const VALLEY_TERRAIN_BK = `
module hook;
import mesh;
import scene;

struct Params {
  time: f32,
  sunBoost: f32,
  meadowMask: f32,
  pad: f32,
}
@binding(4, 0) var params: uniform<Params>;

fn h2(p: vec2<f32>) -> vec2<f32> {
  let q = vec2<f32>(dot(p, vec2<f32>(127.1, 311.7)), dot(p, vec2<f32>(269.5, 183.3)));
  return fract(sin(q) * 43758.5453);
}

fn voronoi_ridge(p: vec2<f32>, t: f32) -> f32 {
  let n = floor(p);
  let f = fract(p);
  var d1: f32 = 8.0;
  var d2: f32 = 8.0;
  for (var dy: i32 = -1; dy <= 1; dy += 1) {
    for (var dx: i32 = -1; dx <= 1; dx += 1) {
      let g = vec2<f32>(dx as f32, dy as f32);
      let o = 0.5 + 0.40 * sin(t * 1.15 + h2(n + g) * 6.2831);
      let r = g + o - f;
      let d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return pow(1.0 - smoothstep(0.0, 0.24, sqrt(d2) - sqrt(d1)), 3.0);
}

fn caustic(p_in: vec2<f32>, t: f32) -> f32 {
  let warp = vec2<f32>(sin(p_in.y * 2.3 + t * 1.3), cos(p_in.x * 2.1 - t * 1.1)) * 0.22;
  let p = p_in + warp;
  let rp = vec2<f32>(p.x * 0.78 - p.y * 0.62, p.x * 0.62 + p.y * 0.78);
  return clamp(voronoi_ridge(p * 1.55, t) * 0.55 + voronoi_ridge(rp * 2.35, -t * 0.8) * 0.45, 0.0, 1.0);
}

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
  var out = s;
  let wp = v.world_pos + scene::camera.eye_world.xyz;
  let dry = smoothstep(0.05, 0.22, wp.y);
  let flat_slope = smoothstep(0.56, 0.86, s.normal.y);
  let n = sin(wp.x * 3.1 + cos(wp.z * 2.7)) * 0.5 + 0.5;

  // Lush alpine meadow & mossy boulders on flat upper slopes, granite cliffs on steep faces
  let grass_col = mix(vec3<f32>(0.09, 0.16, 0.05), vec3<f32>(0.16, 0.25, 0.07), n);
  let meadow = dry * flat_slope * mix(0.65, 1.0, params.meadowMask);
  var col = mix(s.base_color * 0.58, grass_col, meadow);
  var rough = mix(s.roughness, 0.90, meadow);

  // Dark glistening tide / splash zone near water & wheelpit
  let wet = (1.0 - smoothstep(-0.04, 0.14, wp.y)) * smoothstep(-0.75, -0.08, wp.y);
  col = mix(col, col * vec3<f32>(0.50, 0.54, 0.56), wet * 0.72);
  rough = mix(rough, 0.36, wet);

  if (wp.y < 0.008) {
    let sub = clamp(-wp.y / 0.62, 0.0, 1.0);
    col *= mix(vec3<f32>(1.0), vec3<f32>(0.42, 0.72, 0.66), sub * 0.85);
    let c = caustic(wp.xz, params.time) * params.sunBoost * smoothstep(-0.025, -0.14, wp.y) * smoothstep(-0.1, 0.9, s.normal.y);
    col += vec3<f32>(0.10, 0.18, 0.17) * c;
    out.emissive += vec3<f32>(0.010, 0.024, 0.024) * c;
  }
  out.base_color = col;
  out.roughness = rough;
  return out;
}
`;

export const MILLPOND_WATER_BK = `
module hook;
import mesh;
import scene;

struct Params {
  time: f32,
  flow: f32,
  breeze: f32,
  pad: f32,
}
@binding(4, 0) var params: uniform<Params>;

fn hash21(p: vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn snoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2<f32>(1.0, 0.0)), u.x),
             mix(hash21(i + vec2<f32>(0.0, 1.0)), hash21(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}

fn wave_h(p: vec2<f32>, t: f32, fl: f32, br: f32) -> f32 {
  let dw = length(p - vec2<f32>(-0.45, -0.95));
  let dc = length(p - vec2<f32>(-1.75, -0.35));
  let wheel_w = sin(dw * 14.0 - t * 6.4) * exp(-dw * 0.95) * 0.008 * (0.3 + 0.7 * fl);
  let casc_w = sin(dc * 18.0 - t * 6.0) * exp(-dc * 1.45) * 0.004;
  let amp = 0.0018 * (0.35 + 0.65 * br);
  let w1 = sin(dot(p, vec2<f32>(4.2, 2.5)) + t * 1.9) * amp;
  let w2 = sin(dot(p, vec2<f32>(-3.1, 5.1)) - t * 2.3) * amp * 0.8;
  let w3 = sin(dot(p, vec2<f32>(6.4, -3.7)) + t * 2.7) * amp * 0.55;
  return wheel_w + casc_w + w1 + w2 + w3;
}

pub fn vertex(v: mesh::Vertex) -> mesh::Vertex {
  var out = v;
  let h = wave_h(v.pos.xz, params.time, params.flow, params.breeze);
  let eps = 0.04;
  let hx = wave_h(v.pos.xz + vec2<f32>(eps, 0.0), params.time, params.flow, params.breeze);
  let hz = wave_h(v.pos.xz + vec2<f32>(0.0, eps), params.time, params.flow, params.breeze);
  out.pos.y += h;
  out.normal = normalize(vec3<f32>((h - hx) / eps, 1.0, (h - hz) / eps));
  out.v0 = vec4<f32>(v.pos.x, h, v.pos.z, 1.0);
  return out;
}

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
  var out = s;
  let p = v.v0.xz;
  let t = params.time;
  let p1 = vec2<f32>(p.x * 0.86 - p.y * 0.51, p.x * 0.51 + p.y * 0.86);
  let p2 = vec2<f32>(p.x * -0.42 - p.y * 0.91, p.x * 0.91 - p.y * 0.42);
  let e = 0.05;
  let n1 = snoise(p1 * 4.5 + vec2<f32>(t * 0.4, -t * 0.3));
  let nx1 = snoise((p1 + vec2<f32>(e, 0.0)) * 4.5 + vec2<f32>(t * 0.4, -t * 0.3));
  let nz1 = snoise((p1 + vec2<f32>(0.0, e)) * 4.5 + vec2<f32>(t * 0.4, -t * 0.3));
  let n2 = snoise(p2 * 9.5 + vec2<f32>(-t * 0.6, t * 0.45));
  let nx2 = snoise((p2 + vec2<f32>(e, 0.0)) * 9.5 + vec2<f32>(-t * 0.6, t * 0.45));
  let nz2 = snoise((p2 + vec2<f32>(0.0, e)) * 9.5 + vec2<f32>(-t * 0.6, t * 0.45));
  let gs = 0.7 + 0.6 * params.breeze;
  out.normal = normalize(s.normal + vec3<f32>(((n1 - nx1) * 0.08 + (n2 - nx2) * 0.05) * gs, 0.0, ((n1 - nz1) * 0.08 + (n2 - nz2) * 0.05) * gs));

  let uv = scene::screen_uv(v.pixel);
  let surf_d = max(0.05, -scene::view_pos(v.world_pos).z);
  let bg_d = scene::linear_depth(scene::sample_scene_depth(uv));
  let water_depth = max(0.0, bg_d - surf_d);
  let refr_uv = clamp(uv + out.normal.xz * 0.025 * clamp(water_depth * 2.5, 0.0, 1.0), vec2<f32>(0.002), vec2<f32>(0.998));
  let test_d = scene::linear_depth(scene::sample_scene_depth(refr_uv));
  let safe_uv = select(test_d > surf_d, refr_uv, uv);
  let thick = max(0.0, select(test_d > surf_d, test_d, bg_d) - surf_d);
  let refr = scene::sample_scene_color(safe_uv) * exp(-thick * vec3<f32>(2.4, 0.95, 0.72));

  let fn1 = snoise(p * 12.0 + vec2<f32>(0.0, -t * 1.8));
  let wake = exp(-pow((p.x + 0.45) / 0.42, 2.0)) * smoothstep(-1.55, -0.85, p.y) * smoothstep(1.35, -0.2, p.y) * (0.4 + 0.6 * fn1) * (0.25 + 0.75 * params.flow) * 0.52;
  let casc_foam = exp(-dot(p - vec2<f32>(-1.75, -0.35), p - vec2<f32>(-1.75, -0.35)) * 14.0) * (0.4 + 0.6 * fn1) * 0.48;
  let shore_foam = (1.0 - smoothstep(0.0, 0.05, water_depth)) * smoothstep(0.004, 0.02, water_depth) * (0.1 + 0.2 * fn1);
  let foam = clamp(wake + casc_foam + shore_foam, 0.0, 0.75);

  let ndotv = clamp(dot(out.normal, normalize(-v.world_pos)), 0.0, 1.0);
  let fresnel = 0.024 + 0.976 * pow(1.0 - ndotv, 4.6);

  out.base_color = mix(vec3<f32>(0.012, 0.036, 0.044), vec3<f32>(0.34, 0.39, 0.43), foam);
  out.roughness = mix(0.28, 0.72, foam);
  out.metallic = 0.0;
  let sky_tint = vec3<f32>(0.16, 0.25, 0.32) * fresnel * 0.45;
  out.emissive = refr * (1.0 - fresnel * 0.72) * (1.0 - foam) * 0.72 + sky_tint * (1.0 - foam);
  out.alpha = smoothstep(0.0, 0.032, water_depth) * 0.985;
  return out;
}
`;

export const WATER_STREAM_BK = `
module hook;
import mesh;
import scene;

struct Params {
  time: f32,
  flow: f32,
  softTop: f32,
  pad: f32,
}
@binding(4, 0) var params: uniform<Params>;

pub fn vertex(v: mesh::Vertex) -> mesh::Vertex {
  var out = v;
  let env = smoothstep(0.0, 0.14, v.uv.y);
  let r = sin(v.uv.y * 20.0 - params.time * 9.0 + v.uv.x * 10.0) * 0.005 * env;
  out.pos += v.normal * r;
  return out;
}

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
  var out = s;
  let t = params.time * (1.8 + 0.8 * params.flow);
  let u = v.uv.x;
  let y = v.uv.y;
  let s1 = sin(u * 20.0 + sin(y * 11.0 - t * 2.2) * 1.4) * 0.5 + 0.5;
  let s2 = sin((y * 18.0 - t * 4.5) + sin(u * 26.0)) * 0.5 + 0.5;
  let foam = clamp(pow(s1 * 0.5 + s2 * 0.5, 1.8) * 0.62 + smoothstep(0.75, 1.0, y) * 0.45, 0.0, 0.88);

  let uv = scene::screen_uv(v.pixel);
  let bg = scene::sample_scene_color(clamp(uv + vec2<f32>((s1 - 0.5) * 0.015, (s2 - 0.5) * 0.015), vec2<f32>(0.002), vec2<f32>(0.998)));
  let top_f = mix(1.0, smoothstep(0.0, 0.14, y), params.softTop);
  let edge_f = smoothstep(0.0, 0.22, u) * smoothstep(1.0, 0.78, u);
  out.base_color = mix(vec3<f32>(0.03, 0.10, 0.14), vec3<f32>(0.40, 0.46, 0.50), foam * 0.68);
  out.roughness = mix(0.26, 0.62, foam);
  out.emissive = bg * (1.0 - foam * 0.68) * 0.68 + vec3<f32>(0.15, 0.19, 0.22) * foam * 0.30;
  out.alpha = clamp(edge_f * top_f * (0.45 + 0.45 * foam) * (0.15 + 0.85 * params.flow), 0.0, 0.92);
  return out;
}
`;

export const TROUT_SWAY_BK = `
module hook;
import mesh;

struct Params {
  time: f32,
  swimPhase: f32,
  bendAmp: f32,
  turnCurve: f32,
}
@binding(4, 0) var params: uniform<Params>;

fn lat(s: f32) -> f32 {
  return sin(params.swimPhase - s * 5.2) * (0.004 + params.bendAmp * s * s) + params.turnCurve * s * s;
}

pub fn vertex(v: mesh::Vertex) -> mesh::Vertex {
  var out = v;
  let s = clamp(-v.pos.x / 0.40, 0.0, 1.0);
  let dz = lat(s);
  let slope = (lat(min(1.0, s + 0.025)) - lat(max(0.0, s - 0.025))) / 0.02;
  out.pos.z += dz;
  let c = 1.0 / sqrt(1.0 + slope * slope);
  let sn = -slope * c;
  out.normal = normalize(vec3<f32>(v.normal.x * c - v.normal.z * sn, v.normal.y, v.normal.x * sn + v.normal.z * c));
  return out;
}
`;

export const WIND_SWAY_BK = `
module hook;
import mesh;
import scene;

struct Params {
  time: f32,
  breeze: f32,
  rootPos: vec3<f32>,
  flutterAmp: f32,
}
@binding(4, 0) var params: uniform<Params>;

pub fn vertex(v: mesh::Vertex) -> mesh::Vertex {
  var out = v;
  let wp = v.world_pos + scene::camera.eye_world.xyz;
  let h = max(0.0, wp.y - params.rootPos.y);
  let cant = pow(clamp(h / 2.8, 0.0, 1.2), 1.65);
  let amp = (0.012 + 0.055 * params.breeze) * cant;
  let gx = sin(params.time * 1.15 + wp.z * 0.6) + 0.35 * cos(params.time * 2.0 + wp.x * 0.8);
  let gz = cos(params.time * 0.92 + wp.x * 0.5) * 0.6;
  let fl = sin(params.time * 5.4 + wp.x * 10.0 + wp.z * 8.0) * params.flutterAmp * (0.3 + 0.7 * params.breeze) * v.uv.y;
  out.pos.x += gx * amp + fl;
  out.pos.z += gz * amp + fl * 0.6;
  return out;
}
`;
