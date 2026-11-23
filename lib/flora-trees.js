// Reusable terrain-aware tree pipeline extracted from demos/tree-lab:
// grows bro.flora archetypes, builds shared multi-LOD mesh geometries,
// bakes & disk-caches 8x4 octahedral alphaToCoverage impostors, builds
// static cached shadow-proxy batches, and manages smooth close-to-far
// handoff on undulating terrain.

const PX = 2 * Math.tan(25 * Math.PI / 180) / 1080;

export const MATURE_HEIGHT = {
    oak: 22, beech: 28, elm: 22, birch: 20, willow: 14,
    pine: 28, spruce: 35, fir: 35, cedar: 30, cypress: 22, juniper: 8, redwood: 90,
};

export const LOD_LEVELS = [
    { from: 0, L: 3, sides: 6, area: 1.0 },
    { from: 40, L: 6, sides: 5, area: 0.85 },
    { from: 90, L: 12, sides: 4, area: 0.68 },
];

export const IMPOSTOR_DEFAULTS = {
    res: 128,
    ss: 4,
    nAz: 8,
    nEl: 4,
    elStep: 25,
    bend: 0.6,
    L: 6,
    gain: [1, 1, 0.95],
    front: 0.4,
    cover: 0.8,
    occluder: 0.5,
    contrast: [2.5, 0.35],
    formats: ['float16', 'unorm8'],
};

const BARK_MAT = { color: [0.22, 0.18, 0.14], metallic: 0, roughness: 0.9, vertexColorTint: false };
const LEAF_MAT = { color: [0.08, 0.14, 0.045], metallic: 0, roughness: 0.7, doubleSided: true, subsurface: 0.5, vertexColorTint: false };

const LUT_SRGB_TO_LIN = new Float32Array(256).map((_, i) => {
    const x = i / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
});

const BAKE_HOOK = `
module hook;
import mesh;
import scene;
struct Params { crown: vec4<f32>, bend: vec4<f32> }
@binding(4, 0) var params: uniform<Params>;
pub fn vertex(v: mesh::Vertex) -> mesh::Vertex {
    var o = v;
    o.v0 = vec4<f32>(v.pos, 1.0);
    return o;
}
pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
    var out = s;
    let p = v.v0.xyz;
    let rc = (p - params.crown.xyz) / max(params.crown.w, 0.5);
    let depth = length(rc);
    var tone = mix(vec3<f32>(0.5, 0.62, 0.68), vec3<f32>(1.0), smoothstep(0.25, 1.0, depth));
    tone *= 1.0 + 0.15 * smoothstep(0.85, 1.15, depth);
    let bulk = normalize(rc + vec3<f32>(0.0, 0.25, 0.0));
    var nf = normalize(s.normal);
    if (dot(nf, params.bend.yzw) < 0.0) { nf = -nf; }
    let nb = normalize(nf * (1.0 - params.bend.x) + bulk * params.bend.x);
    let dc = clamp(depth, 0.0, 1.2);
    let ao = clamp(0.25 + 0.85 * dc * dc, 0.25, 1.0) * mix(0.75, 1.0, clamp(rc.y * 0.5 + 0.6, 0.0, 1.0));
    if (SCENE_DEBUG(imp_albedo)) { out.debug = vec4<f32>(s.base_color * tone, 1.0); }
    if (SCENE_DEBUG(imp_normal)) { out.debug = vec4<f32>(nb * 0.5 + 0.5, 1.0); }
    if (SCENE_DEBUG(imp_ao)) { out.debug = vec4<f32>(vec3<f32>(ao), 1.0); }
    if (SCENE_DEBUG(imp_mask)) { out.debug = vec4<f32>(1.0, 1.0, 1.0, 1.0); }
    return out;
}`;

const DRAW_HOOK = `
module hook;
import mesh;
import scene;
import custom;
import wind;
struct Params { box: vec4<f32>, views: vec4<f32>, band: vec4<f32>, gain: vec4<f32>, light: vec4<f32>, far: vec4<f32> }
@binding(4, 0) var params: uniform<Params>;
@binding(4, 1) var albedo: texture2d_array<vec4<f32>>;
@binding(4, 2) var normals: texture2d_array<vec4<f32>>;
@binding(4, 14) var trees: read_buffer<vec4<f32>>;
@binding(4, 15) var shape: read_buffer<vec4<f32>>;

fn octagon_corner(vi: i32, k: i32) -> vec2<f32> {
    let b = shape[vi * 2];
    let g = shape[vi * 2 + 1];
    if (k == 0) { return vec2<f32>(b.y, max(b.z, b.y - g.w)); }
    if (k == 1) { return vec2<f32>(b.y, min(b.w, g.y - b.y)); }
    if (k == 2) { return vec2<f32>(min(b.y, g.y - b.w), b.w); }
    if (k == 3) { return vec2<f32>(max(b.x, g.z + b.w), b.w); }
    if (k == 4) { return vec2<f32>(b.x, min(b.w, b.x - g.z)); }
    if (k == 5) { return vec2<f32>(b.x, max(b.z, g.x - b.x)); }
    if (k == 6) { return vec2<f32>(max(b.x, g.x - b.z), b.z); }
    return vec2<f32>(min(b.y, g.w + b.z), b.z);
}

fn yaw_to_world(p: vec3<f32>, c: f32, n: f32) -> vec3<f32> {
    return vec3<f32>(c * p.x + n * p.z, p.y, -n * p.x + c * p.z);
}
fn world_to_yaw(p: vec3<f32>, c: f32, n: f32) -> vec3<f32> {
    return vec3<f32>(c * p.x - n * p.z, p.y, n * p.x + c * p.z);
}
fn view_dir(i: i32) -> vec3<f32> {
    let n_az = params.views.x as i32;
    let az = ((i % n_az) as f32) * 6.2831853 / params.views.x;
    let el = ((i / n_az) as f32) * params.views.z;
    return vec3<f32>(sin(az) * cos(el), sin(el), cos(az) * cos(el));
}

pub fn vertex(v: mesh::Vertex) -> mesh::Vertex {
    var o = v;
    let id = floor(v.uv.x * 0.125) as i32;
    let corner = (v.uv.x - 8.0 * (id as f32)) as i32;
    let t0 = trees[id * 2];
    let t1 = trees[id * 2 + 1];
    let root = t0.xyz;
    let s = t0.w;
    let c = t1.x;
    let n = t1.y;
    let centre = yaw_to_world(params.box.xyz, c, n) * s;
    let to_eye = scene::camera.eye_world.xyz - (root + centre);
    let f = normalize(to_eye);
    var r = cross(vec3<f32>(0.0, 1.0, 0.0), f);
    if (length(r) < 1.0e-4) { r = vec3<f32>(1.0, 0.0, 0.0); }
    r = normalize(r);
    let u = cross(f, r);
    let R = params.box.w;
    let d = world_to_yaw(f, c, n);
    var az = atan2(d.x, d.z);
    if (az < 0.0) { az = az + 6.2831853; }
    let el = asin(clamp(d.y, -1.0, 1.0));
    let ai = (floor(az / (6.2831853 / params.views.x) + 0.5) as i32) % (params.views.x as i32);
    let ei = clamp(floor(el / params.views.z + 0.5) as i32, 0, (params.views.y as i32) - 1);
    let vi = ei * (params.views.x as i32) + ai;
    let dv = view_dir(vi);
    let rv = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), dv));
    let uv_ = cross(dv, rv);
    let a = octagon_corner(vi, corner);
    let ry = world_to_yaw(r, c, n);
    let uy = world_to_yaw(u, c, n);
    let m00 = dot(ry, rv);
    let m01 = dot(uy, rv);
    let m10 = dot(ry, uv_);
    let m11 = dot(uy, uv_);
    let det = m00 * m11 - m01 * m10;
    let q = vec2<f32>(m11 * a.x - m01 * a.y, -m10 * a.x + m00 * a.y) / select(abs(det) > 1.0e-3, det, 1.0e-3);
    let dist = length(to_eye);
    let push_d = min(params.gain.w * R * s, 0.5 * dist);
    o.pos = root + centre + f * push_d + (r * q.x + u * q.y) * (R * s * (dist - push_d) / dist);
    if (params.band.x > 0.0 && dist + R * s < params.band.x) { o.pos = root; }
    if (params.far.x > 0.0 && dist - R * s > 1.35 * params.far.x) { o.pos = root; }
    o.normal = f;
    o.v0 = vec4<f32>(0.5 + 0.5 * a.x, 0.5 - 0.5 * a.y, c, n);
    o.v1 = vec4<f32>(R * s, 0.0, 0.0, 0.0);
    o.vi = vec4<i32>(vi, id, 0, 0);
    return o;
}

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
    var out = s;
    let uvw = vec3<f32>(v.v0.x, v.v0.y, v.vi.x as f32);
    let lod = max(0.0, log2(v.cam_dist * params.views.w * params.band.z / (2.0 * v.v1.x)));
    let a = albedo.sample_lod(custom::linear, uvw, lod);
    let nw = normals.sample_lod(custom::linear, uvw, lod);
    let nl = nw.xyz * 2.0 - 1.0;
    let t = trees[v.vi.y * 2];
    let tone = wind::wind_hash(vec2<i32>(floor(vec2<f32>(t.x, t.z) * 8.0)) + vec2<i32>(17, 3));
    let tint = mix(vec3<f32>(0.84, 0.97, 1.08), vec3<f32>(1.12, 1.04, 0.76), tone) * (0.9 + 0.2 * fract(tone * 13.7));
    out.base_color = a.xyz * tint * params.gain.xyz;
    out.sky_visibility = nw.w;
    out.occluder_sun = params.light.x;
    let dither = scene::band_dither(v.pixel);
    let up = normalize(-v.world_pos).y;
    let top = smoothstep(0.34, 0.77, up);
    let k = mix(mix(params.light.z, 1.0, top), 1.0, smoothstep(1.5, 3.0, lod));
    var alpha = clamp((a.w - params.light.w) * k + params.light.w, 0.0, 1.0) * mix(1.0, params.light.y, top);
    if (params.band.w > 0.0) { alpha = select(a.w > params.band.w, 1.0, 0.0); }
    if (params.band.y > 0.0 && length(v.world_pos) < mix(params.band.x, params.band.y, dither)) { alpha = 0.0; }
    if (params.far.x > 0.0 && length(v.world_pos) >= mix(params.far.x, 1.35 * params.far.x, dither)) { alpha = 0.0; }
    out.alpha = alpha;
    out.normal = normalize(yaw_to_world(nl, v.v0.z, v.v0.w));
    out.roughness = 0.75;
    out.leaf = 1.0;
    out.metallic = 0.0;
    return out;
}`;

const plain = (m) => new Mesh({ positions: m.positions, normals: m.normals, indices: m.indices });

export function leafCard(k = 1, segments = [1, 2]) {
    const m = Mesh.leafCard('oval', {
        width: 0.07 * k, length: 0.12 * k, bend: 0.4, fullUV: true, shapedSilhouette: true, cup: 0.55,
        widthSegments: segments[0], lengthSegments: segments[1],
    });
    m.colors = new Float32Array(0);
    return m;
}

export function barkMesh(tubes, sides) {
    const S = tubes.segments, V = tubes.vegetation, T = tubes.tangents, n = tubes.segCount;
    const nv = n * sides * 2;
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), veg = new Float32Array(nv * 16);
    const idx = new Uint32Array(n * sides * 6);
    for (let s = 0; s < n; s++) {
        const o = s * 8, r = s * 16;
        const a = [S[o], S[o + 1], S[o + 2]], b = [S[o + 4], S[o + 5], S[o + 6]];
        const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const len = Math.hypot(d[0], d[1], d[2]) || 1;
        const z = [d[0] / len, d[1] / len, d[2] / len];
        const h = Math.abs(z[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        let x = [h[1] * z[2] - h[2] * z[1], h[2] * z[0] - h[0] * z[2], h[0] * z[1] - h[1] * z[0]];
        const xl = Math.hypot(x[0], x[1], x[2]) || 1;
        x = [x[0] / xl, x[1] / xl, x[2] / xl];
        const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
        const rec = [V[r], V[r + 1], V[r + 2], V[r + 3], b[0], b[1], b[2], -(1 + V[r + 9]),
            a[0], a[1], a[2], V[r + 8], 0, V[r + 13], V[r + 14], V[r + 15]];
        for (let i = 0; i < sides; i++) {
            const t = (i / sides) * 2 * Math.PI, c = Math.cos(t), sn = Math.sin(t);
            const w = [x[0] * c + y[0] * sn, x[1] * c + y[1] * sn, x[2] * c + y[2] * sn];
            const va = (s * sides + i) * 2;
            const slide = (tan, rad) => {
                if (!T) return 0;
                const dz = tan[0] * z[0] + tan[1] * z[1] + tan[2] * z[2];
                const dw = tan[0] * w[0] + tan[1] * w[1] + tan[2] * w[2];
                const sl = dz > 0.2 ? -rad * dw / dz : 0;
                return Math.max(-0.45 * len, Math.min(0.45 * len, sl));
            };
            const sa = T ? slide([T[s * 6], T[s * 6 + 1], T[s * 6 + 2]], S[o + 3]) : 0;
            const sb = T ? slide([T[s * 6 + 3], T[s * 6 + 4], T[s * 6 + 5]], S[o + 7]) : 0;
            for (let k = 0; k < 3; k++) {
                pos[va * 3 + k] = a[k] + w[k] * S[o + 3] + z[k] * sa;
                pos[va * 3 + 3 + k] = b[k] + w[k] * S[o + 7] + z[k] * sb;
                nrm[va * 3 + k] = nrm[va * 3 + 3 + k] = w[k];
            }
            veg.set(rec, va * 16);
            veg.set(rec, va * 16 + 16);
            const vb = (s * sides + (i + 1) % sides) * 2;
            idx.set([va, va + 1, vb, vb, va + 1, vb + 1], (s * sides + i) * 6);
        }
    }
    const m = new Mesh({ positions: pos, normals: nrm, indices: idx });
    m.vegetation = veg;
    return m;
}

export function growSpecies(name, { seconds = 45, seed = 0xc0f1, cacheDir = bro.app.cacheDir, species, leaf = 1.5 } = {}) {
    const S = 40;
    const world = bro.flora.createWorld({
        rngSeed: seed,
        climate: { annualTempBase: 12, annualPrecip: 1000 },
        shadow: { origin: [-S / 2, -2, -S / 2], cellSize: 1, width: S, height: 60, depth: S, fill: 1 },
    });
    world.plantSpecies(name, Object.assign({ origin: [0, 0, 0] }, species ? { species } : {}));
    world.grow(Math.round(seconds / 0.02), 0.02, cacheDir ? { cache: cacheDir } : undefined);
    const segs = world.emitSegments(), fol = world.emitFoliage();
    let height = 0, baseR = 0, crownMin = Infinity, rx = 0;
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        height = Math.max(height, s.from[1], s.to[1]);
        if (s.parent < 0) baseR = Math.max(baseR, s.radius);
        rx = Math.max(rx, Math.hypot(s.to[0], s.to[2]));
        if (fol[i] && fol[i].mass > 0 && s.radius <= 0.05) crownMin = Math.min(crownMin, s.from[1], s.to[1]);
    }
    const m = { height, trunkD: 2 * baseR, bole: Number.isFinite(crownMin) ? crownMin : 0, crownW: 2 * rx, segments: segs.length };
    const k = MATURE_HEIGHT[name] && m.height > 0 ? MATURE_HEIGHT[name] / m.height : 1;
    return { name, world, m, k, leaf, radius: k * m.crownW * 0.5 };
}

export function buildSpeciesLevels(scene, sp, { levels = LOD_LEVELS } = {}) {
    return levels.map((lv) => {
        const area = lv.area ?? 1;
        const kk = (sp.leaf ?? 1.5) * lv.L / sp.k;
        const leaves = sp.world.emitFoliageMesh(leafCard(kk, [1, 2]), { seed: 0x1eaf, perArea: area * 90 / (kk * kk) });
        const bark = barkMesh(sp.world.emitBranchTubes({ minRadius: (lv.minRadius ?? 0.25 * lv.from * PX) / sp.k }), lv.sides);
        return {
            from: lv.from,
            L: lv.L,
            tris: (bark.indices.length + leaves.indices.length) / 3,
            barkGeometry: scene.createGeometry(bark),
            leavesGeometry: scene.createGeometry(leaves),
        };
    });
}

function impostorCacheKey(sp, o) {
    return `impostor_v2_${sp.name}_L${o.L}_W${o.res}_V${o.nAz}x${o.nEl}`;
}

export function bakeSpeciesImpostor(scene, sp, { opts = IMPOSTOR_DEFAULTS, hideNodes = [], cacheDir = bro.app.cacheDir } = {}) {
    const o = Object.assign({}, IMPOSTOR_DEFAULTS, opts);
    const fs = require('fs');
    const key = impostorCacheKey(sp, o);
    const jsonPath = cacheDir ? `${cacheDir}/${key}.json` : null;
    const binPath = cacheDir ? `${cacheDir}/${key}.bin` : null;
    if (jsonPath && binPath && fs.existsSync(jsonPath) && fs.existsSync(binPath)) {
        try {
            const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
            const raw = fs.readFileSync(binPath);
            const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
            const pixLen = meta.V * meta.W * meta.W * 4;
            const shapeLen = meta.V * 8;
            if (buf.byteLength === (pixLen * 2 + shapeLen) * 4) {
                const alb = new Float32Array(buf, 0, pixLen);
                const nrm = new Float32Array(buf, pixLen * 4, pixLen);
                const shape = new Float32Array(buf, pixLen * 8, shapeLen);
                return { alb, nrm, box: meta.box, W: meta.W, V: meta.V, o, shape, fromCache: true };
            }
        } catch {}
    }

    const kk = (sp.leaf ?? 1.5) * o.L / sp.k;
    const foliage = sp.world.emitFoliageMesh(leafCard(kk, [1, 2]), { seed: 0x1eaf, perArea: 90 / (kk * kk) });
    const leaves = plain(foliage);
    const bark = plain(sp.world.emitMesh(5));
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const llo = [Infinity, Infinity, Infinity], lhi = [-Infinity, -Infinity, -Infinity];
    for (const [m, isLeaf] of [[leaves, true], [bark, false]]) {
        const P = m.positions;
        for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) {
            lo[a] = Math.min(lo[a], P[i + a]); hi[a] = Math.max(hi[a], P[i + a]);
            if (isLeaf) { llo[a] = Math.min(llo[a], P[i + a]); lhi[a] = Math.max(lhi[a], P[i + a]); }
        }
    }
    const c = [0, 1, 2].map((a) => (lo[a] + hi[a]) * 0.5);
    let R = 0;
    for (const m of [leaves, bark]) {
        const P = m.positions;
        for (let i = 0; i < P.length; i += 3) R = Math.max(R, Math.hypot(P[i] - c[0], P[i + 1] - c[1], P[i + 2] - c[2]));
    }
    let crownC = [0, 1, 2].map((a) => (llo[a] + lhi[a]) * 0.5);
    let crownR = Math.max(...[0, 1, 2].map((a) => (lhi[a] - llo[a]) * 0.5));
    const VR = foliage.vegetation;
    if (VR && VR.length >= 16) {
        const sum = [0, 0, 0, 0];
        let n = 0;
        for (let r = 0; r < VR.length; r += 16) {
            if (!(VR[r + 7] > 0)) continue;
            for (let k = 0; k < 4; k++) sum[k] += VR[r + 4 + k];
            n++;
        }
        if (n) { crownC = sum.slice(0, 3).map((v) => v / n); crownR = sum[3] / n; }
    }

    const prevVis = hideNodes.map((n) => n.visible);
    for (const n of hideNodes) n.visible = false;
    const tempNodes = [[bark, BARK_MAT], [leaves, LEAF_MAT]].map(([m, mat]) => {
        const n = scene.createMesh(Object.assign({ data: m, castsShadow: false }, mat));
        n.setShader({ module: BAKE_HOOK, file: 'flora_impostor_bake.bk', uniforms: { crown: [...crownC, crownR], bend: [o.bend, 0, 0, 0] } });
        return n;
    });

    const W = o.res, V = o.nAz * o.nEl, SS = o.ss, B = W * SS;
    const alb = new Float32Array(V * W * W * 4), nrm = new Float32Array(V * W * W * 4);
    const el0 = o.elStep * Math.PI / 180;
    for (let vi = 0; vi < V; vi++) {
        const az = (vi % o.nAz) * 2 * Math.PI / o.nAz, el = Math.floor(vi / o.nAz) * el0;
        const d = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
        const D = 4 * R;
        scene.setCamera({
            mode: 'orthographic', size: 2 * R, aspect: 1, near: 0.1, far: 8 * R,
            eye: [c[0] + d[0] * D, c[1] + d[1] * D, c[2] + d[2] * D], target: c, up: [0, 1, 0],
        });
        for (const n of tempNodes) n.setShaderUniform('bend', [o.bend, ...d]);
        const shots = {};
        for (const view of ['imp_albedo', 'imp_normal', 'imp_ao', 'imp_mask']) {
            scene.setDebugView(view);
            shots[view] = scene.captureFrame(B, B).data;
        }
        const A = shots.imp_albedo, N = shots.imp_normal, O = shots.imp_ao, M = shots.imp_mask, base = vi * W * W * 4;
        const meanA = [0, 0, 0], meanN = [0, 0, 0];
        let meanCount = 0, meanO = 0;
        for (let ty = 0; ty < W; ty++) for (let tx = 0; tx < W; tx++) {
            const a = [0, 0, 0], nn = [0, 0, 0];
            let cov = 0, ao = 0;
            for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
                const p = ((ty * SS + sy) * B + tx * SS + sx) * 4;
                const m = LUT_SRGB_TO_LIN[Math.min(M[p], M[p + 1], M[p + 2])];
                if (m < 0.02) continue;
                cov += m;
                ao += LUT_SRGB_TO_LIN[O[p]];
                for (let k = 0; k < 3; k++) { a[k] += LUT_SRGB_TO_LIN[A[p + k]]; nn[k] += LUT_SRGB_TO_LIN[N[p + k]] * 2 - m; }
            }
            const t = base + (ty * W + tx) * 4;
            alb[t + 3] = cov / (SS * SS);
            if (!cov) continue;
            const nl = Math.hypot(...nn) || 1;
            for (let k = 0; k < 3; k++) {
                alb[t + k] = a[k] / cov;
                nrm[t + k] = (nn[k] / nl) * 0.5 + 0.5;
                meanA[k] += a[k]; meanN[k] += nn[k];
            }
            nrm[t + 3] = ao / cov;
            meanO += ao;
            meanCount += cov;
        }
        const mnl = Math.hypot(...meanN) || 1;
        for (let i = 0; i < W * W; i++) {
            const t = base + i * 4;
            if (alb[t + 3] > 0) continue;
            for (let k = 0; k < 3; k++) {
                alb[t + k] = meanCount ? meanA[k] / meanCount : 0;
                nrm[t + k] = (meanN[k] / mnl) * 0.5 + 0.5;
            }
            nrm[t + 3] = meanCount ? meanO / meanCount : 1;
        }
    }
    scene.setDebugView(null);
    for (const n of tempNodes) n.destroy();
    hideNodes.forEach((n, i) => { n.visible = prevVis[i]; });

    const shape = new Float32Array(V * 8), MARGIN = 0.04;
    for (let vi = 0; vi < V; vi++) {
        const loK = [Infinity, Infinity, Infinity, Infinity], hiK = [-Infinity, -Infinity, -Infinity, -Infinity];
        for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
            if (alb[(vi * W * W + y * W + x) * 4 + 3] <= 0.01) continue;
            const X = (x + 0.5) * 2 / W - 1, Y = 1 - (y + 0.5) * 2 / W;
            const k = [X, Y, X + Y, X - Y];
            for (let j = 0; j < 4; j++) { loK[j] = Math.min(loK[j], k[j]); hiK[j] = Math.max(hiK[j], k[j]); }
        }
        if (loK[0] === Infinity) continue;
        const pad = (j) => (j < 2 ? 1 : 2) * (1 / W + MARGIN);
        const lim = (j) => (j < 2 ? 1 : 2);
        for (let j = 0; j < 4; j++) {
            shape[vi * 8 + 2 * j] = Math.max(-lim(j), loK[j] - pad(j));
            shape[vi * 8 + 2 * j + 1] = Math.min(lim(j), hiK[j] + pad(j));
        }
    }

    const box = [...c, R];
    if (jsonPath && binPath) {
        try {
            fs.mkdirSync(cacheDir, { recursive: true });
            const outBuf = new Float32Array(alb.length + nrm.length + shape.length);
            outBuf.set(alb, 0);
            outBuf.set(nrm, alb.length);
            outBuf.set(shape, alb.length + nrm.length);
            fs.writeFileSync(binPath, new Uint8Array(outBuf.buffer));
            fs.writeFileSync(jsonPath, JSON.stringify({ box, W, V }));
        } catch {}
    }
    return { alb, nrm, box, W, V, o, shape, fromCache: false };
}

function mergeMeshes(a, b) {
    const na = a.positions.length / 3;
    const pos = new Float32Array(a.positions.length + b.positions.length);
    pos.set(a.positions); pos.set(b.positions, a.positions.length);
    const nrm = new Float32Array(pos.length);
    nrm.set(a.normals); nrm.set(b.normals, a.normals.length);
    const idx = new Uint32Array(a.indices.length + b.indices.length);
    idx.set(a.indices);
    for (let i = 0; i < b.indices.length; i++) idx[a.indices.length + i] = b.indices[i] + na;
    return new Mesh({ positions: pos, normals: nrm, indices: idx });
}

function cullSpheres(sp, trees) {
    const [bx, by, bz, R] = sp.imp.box;
    const out = new Float32Array(trees.length * 4);
    trees.forEach((t, i) => {
        const s = sp.k * t.size, c = Math.cos(t.yaw), n = Math.sin(t.yaw), ty = t.y ?? 0;
        out.set([t.x + (c * bx + n * bz) * s, ty + by * s, t.z + (-n * bx + c * bz) * s, 1.1 * R * s], i * 4);
    });
    return bro.kernel.createBuffer(out);
}

export function createShadowProxyLayer(scene, sp, trees, { L = 12, minRadius = 0.15, range = 'all', cover = 0.4, thin = [700, 1600, 0.08] } = {}) {
    if (!trees.length) return { nodes: [], destroy() {} };
    const kk = (sp.leaf ?? 1.5) * L / sp.k;
    const cards = (c, seed) => sp.world.emitFoliageMesh(leafCard(kk, [1, 2]), { seed, perArea: c * 90 / (kk * kk) });
    const bark = barkMesh(sp.world.emitBranchTubes({ minRadius: minRadius / sp.k }), 3);
    const inst = new Float32Array(trees.length * 16);
    trees.forEach((t, i) => {
        const s = sp.k * t.size, c = Math.cos(t.yaw) * s, n = Math.sin(t.yaw) * s, ty = t.y ?? 0;
        inst.set([c, 0, n, t.x, 0, s, 0, ty, -n, 0, c, t.z, 1, 1, 1, 1], i * 16);
    });
    const spheres = cullSpheres(sp, trees);
    const make = (mesh) => scene.createInstancedMesh({
        mesh, instances: inst, color: [0.1, 0.1, 0.1],
        doubleSided: true, castsShadow: true, shadowOnly: true, shadowRange: range,
        receivesShadow: false, vertexColorTint: false,
    });
    const far = thin ? Math.min(thin[2], cover) : cover;
    const nodes = [make(mergeMeshes(cards(far, 0x1eaf), bark)).setInstanceCullSpheres(spheres)];
    if (cover > far) {
        nodes.push(make(cards(cover - far, 0x2eaf)).setInstanceCullSpheres(spheres, {
            maxDistance: thin[1], fade: 1 - thin[0] / thin[1],
        }));
    }
    return { nodes, destroy() { for (const n of nodes) n.destroy(); } };
}

function buildOctagons(sp, trees) {
    const N = trees.length, R = sp.imp.box[3];
    const pos = new Float32Array(N * 24), nrm = new Float32Array(N * 24);
    const uv = new Float32Array(N * 16), idx = new Uint32Array(N * 18);
    trees.forEach((t, i) => {
        const r = 2 * R * sp.k * t.size, ty = t.y ?? 0;
        for (let c = 0; c < 8; c++) {
            const a = c * Math.PI / 4;
            pos.set([t.x + Math.cos(a) * r, ty + (c & 1) * r, t.z + Math.sin(a) * r], (i * 8 + c) * 3);
            nrm[(i * 8 + c) * 3 + 2] = 1;
            uv.set([c + 8 * i, 0], (i * 8 + c) * 2);
        }
        for (let k = 1; k < 7; k++) idx.set([i * 8, i * 8 + k, i * 8 + k + 1], i * 18 + (k - 1) * 3);
    });
    return new Mesh({ positions: pos, normals: nrm, uvs: uv, indices: idx });
}

export function createImpostorLayer(scene, sp, trees, opts = {}) {
    if (!trees.length) return null;
    const { band = [0, 0], castsShadow = false, until = 0 } = opts;
    const g = Object.assign({}, IMPOSTOR_DEFAULTS, opts);
    const data = new Float32Array(trees.length * 8);
    trees.forEach((t, i) => {
        data.set([t.x, t.y ?? 0, t.z, sp.k * t.size, Math.cos(t.yaw), Math.sin(t.yaw), t.yaw, 0], i * 8);
    });
    const n = scene.createMesh({
        data: buildOctagons(sp, trees), color: [1, 1, 1], metallic: 0, roughness: 0.75,
        alphaCutoff: 0.5, alphaToCoverage: true, doubleSided: true, castsShadow,
        receivesShadow: true, vertexColorTint: false,
    });
    const { alb, nrm, box, W, V, o, shape } = sp.imp;
    n.setShader({
        module: DRAW_HOOK, file: 'flora_impostor_draw.bk',
        uniforms: {
            box, views: [o.nAz, o.nEl, o.elStep * Math.PI / 180, PX],
            band: [band[0], band[1], W, 0], gain: [...g.gain, g.front],
            light: [g.occluder, g.cover, g.contrast[0], g.contrast[1]], far: [until, 0, 0, 0],
        },
    });
    n.setShaderBuffer('shape', bro.kernel.createBuffer(shape));
    n.setShaderTexture('albedo', { data: alb, width: W, height: W, layers: V, channels: 4, mipmap: true, format: o.formats[0] });
    n.setShaderTexture('normals', { data: nrm, width: W, height: W, layers: V, channels: 4, mipmap: true, format: o.formats[1] });
    n.setShaderBuffer('trees', bro.kernel.createBuffer(data));
    return n;
}

export function createTreeStand(scene, speciesList, trees, { handoff = 65, shadowProxy = true, closeLod = true, maxClose = 24 } = {}) {
    const bySpecies = new Map();
    for (const sp of speciesList) bySpecies.set(sp, []);
    for (const t of trees) {
        if (!bySpecies.has(t.sp)) bySpecies.set(t.sp, []);
        bySpecies.get(t.sp).push(t);
    }

    const staticNodes = [];
    for (const [sp, list] of bySpecies) {
        if (!list.length) continue;
        const band = closeLod ? [handoff, 1.35 * handoff] : [0, 0];
        const imp = createImpostorLayer(scene, sp, list, { band, until: 0 });
        if (imp) staticNodes.push(imp);
        if (shadowProxy) staticNodes.push(createShadowProxyLayer(scene, sp, list));
    }

    const CELL = 64, enter = 1.35 * handoff + 6;
    const cells = new Map();
    const key = (cx, cz) => cx * 65536 + cz;
    trees.forEach((t, i) => {
        const k = key(Math.floor(t.x / CELL), Math.floor(t.z / CELL));
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(i);
    });
    const shown = new Map(); // tree index -> { li, nodes }

    const update = ([ex, ey, ez]) => {
        if (!closeLod) return;
        const cands = [];
        const x0 = Math.floor((ex - enter) / CELL), x1 = Math.floor((ex + enter) / CELL);
        const z0 = Math.floor((ez - enter) / CELL), z1 = Math.floor((ez + enter) / CELL);
        for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
            const bucket = cells.get(key(cx, cz));
            if (!bucket) continue;
            for (const i of bucket) {
                const t = trees[i];
                const d2 = (t.x - ex) * (t.x - ex) + ((t.y ?? 0) + 10 - ey) ** 2 + (t.z - ez) * (t.z - ez);
                if (d2 <= enter * enter) cands.push([d2, i]);
            }
        }
        cands.sort((a, b) => a[0] - b[0]);
        if (cands.length > maxClose) cands.length = maxClose;
        const want = new Set(cands.map((c) => c[1]));
        for (const [i, rec] of shown) {
            if (want.has(i)) continue;
            for (const n of rec.nodes) n.destroy();
            shown.delete(i);
        }
        for (const [d2, i] of cands) {
            const t = trees[i];
            if (!t.sp.levels?.length) continue;
            const d = Math.sqrt(d2);
            let li = 0;
            while (li + 1 < t.sp.levels.length && d >= t.sp.levels[li + 1].from + t.r) li++;
            const prev = shown.get(i);
            if (prev && prev.li === li) continue;
            if (prev) for (const n of prev.nodes) n.destroy();
            const lv = t.sp.levels[li], s = t.sp.k * t.size, ty = t.y ?? 0;
            const nodes = [
                scene.createMesh(Object.assign({ geometry: lv.barkGeometry, castsShadow: false, receivesShadow: true }, BARK_MAT)),
                scene.createMesh(Object.assign({ geometry: lv.leavesGeometry, castsShadow: false, receivesShadow: true }, LEAF_MAT)),
            ].map((n) => {
                n.position = [t.x, ty, t.z];
                n.scale = [s, s, s];
                n.rotation = [0, t.yaw, 0];
                n.fadeOutDist = handoff;
                return n;
            });
            shown.set(i, { li, nodes });
        }
    };

    return {
        update,
        stats: () => ({ staticLayers: staticNodes.length, closeMeshes: shown.size, totalTrees: trees.length }),
        destroy() {
            for (const item of staticNodes) item.destroy();
            staticNodes.length = 0;
            for (const rec of shown.values()) for (const n of rec.nodes) n.destroy();
            shown.clear();
        },
    };
}
