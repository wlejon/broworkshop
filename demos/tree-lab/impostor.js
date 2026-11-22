// Far trees as impostors: each species baked once from N_AZ x N_EL view
// directions by an orthographic camera (albedo with coverage, and a normal
// leaning toward the crown's outward direction as vegetation shading's
// does), each tree then one quad facing the eye that samples the view
// nearest its direction in the tree's own frame, lit by the engine through
// the baked normal and cut by its coverage against a per-pixel dither.
import { leafCard, scene, ground } from "/app/lab.js";
import { barkMesh } from "/app/lod.js";

// `L` is the leaf level baked (lod.js's cards L times a leaf): the level the
// mesh trees show where the impostors take over, so the two cover alike.
// `front`: how far toward the eye (a share of the crown's radius) the quad
// is drawn and shaded, out of the shadow its own proxy casts at the centre.
// `gain` scales the baked albedo: what was left between the canopy's mean
// colour as impostors and as meshes, the same trees, at noon, golden hour
// and dawn from 150 m and 600 m up (blue 0.82-0.91, the rest within 0.87-1.19).
export const IMPOSTOR = { res: 128, ss: 4, nAz: 8, nEl: 4, elStep: 25, bend: 0.6, L: 24, gain: [1, 1, 0.87], front: 0.4 };

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
    // The leaf terms bro.scene's vegetation shading derives from the crown
    // (vegetation.bk tint and crown_shade): albedo darkened toward the
    // crown's centre with a lit rim, the normal leaning to the crown's bulk,
    // and an occlusion of its ambient light (baked to the normal atlas's w).
    // (Model space, which is the world here: the bake's nodes sit at the origin.)
    let p = v.v0.xyz;
    let rc = (p - params.crown.xyz) / max(params.crown.w, 0.5);
    let depth = length(rc);
    var tone = mix(vec3<f32>(0.5, 0.62, 0.68), vec3<f32>(1.0), smoothstep(0.25, 1.0, depth));
    tone *= 1.0 + 0.15 * smoothstep(0.85, 1.15, depth);
    let bulk = normalize(rc + vec3<f32>(0.0, 0.25, 0.0));
    // A leaf's normal faces the eye, as the vegetation shading turns it (by
    // the side it is seen from, not by its triangle's winding).
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
struct Params { box: vec4<f32>, views: vec4<f32>, band: vec4<f32>, gain: vec4<f32> }
@binding(4, 0) var params: uniform<Params>;
@binding(4, 1) var albedo: texture2d_array<vec4<f32>>;
@binding(4, 2) var normals: texture2d_array<vec4<f32>>;
@binding(4, 14) var trees: read_buffer<vec4<f32>>;

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
    let t = trees[v.instance_index];
    let c = cos(t.z);
    let n = sin(t.z);
    let s = t.w;
    let centre = yaw_to_world(params.box.xyz, c, n) * s;
    let to_eye = scene::camera.eye_world.xyz - (vec3<f32>(t.x, 0.0, t.y) + centre);
    let f = normalize(to_eye);
    var r = cross(vec3<f32>(0.0, 1.0, 0.0), f);
    if (length(r) < 1.0e-4) { r = vec3<f32>(1.0, 0.0, 0.0); }
    r = normalize(r);
    let u = cross(f, r);
    let q = vec2<f32>(v.uv.x * 2.0 - 1.0, v.uv.y * 2.0 - 1.0);
    let R = params.box.w;
    // Moved toward the eye by gain.w (front) of the radius, to the crown's near
    // surface where the leaves seen are (its shadow and depth are theirs),
    // and shrunk to cover what it covered at the centre.
    let dist = length(to_eye);
    let push_d = min(params.gain.w * R * s, 0.5 * dist);
    o.pos = centre + f * push_d + (r * q.x + u * q.y) * (R * s * (dist - push_d) / dist);
    // Wholly nearer than the band: no impostor (a collapsed quad, no pixels).
    if (params.band.x > 0.0 && length(to_eye) + R * s < params.band.x) { o.pos = vec3<f32>(0.0); }
    o.normal = f;
    let d = world_to_yaw(f, c, n);
    var az = atan2(d.x, d.z);
    if (az < 0.0) { az = az + 6.2831853; }
    let el = asin(clamp(d.y, -1.0, 1.0));
    let ai = (floor(az / (6.2831853 / params.views.x) + 0.5) as i32) % (params.views.x as i32);
    let ei = clamp(floor(el / params.views.z + 0.5) as i32, 0, (params.views.y as i32) - 1);
    let vi = ei * (params.views.x as i32) + ai;
    let pl = world_to_yaw(r * q.x + u * q.y, c, n) * R;
    let dv = view_dir(vi);
    let rv = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), dv));
    let uv_ = cross(dv, rv);
    o.v0 = vec4<f32>(0.5 + 0.5 * dot(pl, rv) / R, 0.5 - 0.5 * dot(pl, uv_) / R, c, n);
    o.v1 = vec4<f32>(R * s, 0.0, 0.0, 0.0);
    o.vi = vec4<i32>(vi, 0, 0, 0);
    return o;
}

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
    var out = s;
    let uvw = vec3<f32>(v.v0.x, v.v0.y, v.vi.x as f32);
    // The mip whose texel is the pixel's footprint (views.w: a pixel's
    // angle; the atlas spans 2 R s over res texels).
    let lod = max(0.0, log2(v.cam_dist * params.views.w * params.band.z / (2.0 * v.v1.x)));
    let a = albedo.sample_lod(custom::linear, uvw, lod);
    let nw = normals.sample_lod(custom::linear, uvw, lod);
    let nl = nw.xyz * 2.0 - 1.0;
    // The tree's own leaf tone, as vegetation.bk gives the mesh tree's
    // (hashed from its root's 1/8 m cell), and the baked crown occlusion
    // on its ambient light, as the mesh tree's leaves have.
    let t = trees[v.instance_index];
    let tone = wind::wind_hash(vec2<i32>(floor(vec2<f32>(t.x, t.y) * 8.0)) + vec2<i32>(17, 3));
    let tint = mix(vec3<f32>(0.84, 0.97, 1.08), vec3<f32>(1.12, 1.04, 0.76), tone) * (0.9 + 0.2 * fract(tone * 13.7));
    out.base_color = a.xyz * tint * params.gain.xyz;
    out.sky_visibility = nw.w;
    out.occluder_sun = 0.0;
    // Coverage against a per-pixel dither; nearer than the band's start the
    // impostor gives way to the mesh tree pixel for pixel (band.x .. band.y).
    let dither = scene::band_dither(v.pixel);
    var keep = a.w > select(params.band.w > 0.0, params.band.w, dither);
    if (params.band.y > 0.0 && length(v.world_pos) < mix(params.band.x, params.band.y, dither)) { keep = false; }
    out.alpha = select(keep, 1.0, 0.0);
    out.normal = normalize(yaw_to_world(nl, v.v0.z, v.v0.w));
    out.roughness = 0.75;
    out.leaf = 1.0;
    out.metallic = 0.0;
    return out;
}`;

// A pixel's angle at 1080 rows and a 50 degree view (as lod.js).
const PX = 2 * Math.tan(25 * Math.PI / 180) / 1080;
const srgb = (b) => { const x = b / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
const LUT = new Float32Array(256).map((_, i) => srgb(i));
const BARK = { color: [0.2, 0.17, 0.14], metallic: 0, roughness: 0.9, vertexColorTint: false };
const LEAF = { color: [0.07, 0.13, 0.04], metallic: 0, roughness: 0.7, doubleSided: true, vertexColorTint: false };
const plain = (m) => new Mesh({ positions: m.positions, normals: m.normals, indices: m.indices });

/** Bake species `sp` ({ world, k }): { alb, nrm, box: [cx, cy, cz, R], W, V }. Hides the ground while it runs. */
export function bakeImpostor(sp, o = IMPOSTOR) {
    const kk = 1.5 * o.L / sp.k;
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
    const c = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2);
    let R = 0;
    for (const m of [leaves, bark]) {
        const P = m.positions;
        for (let i = 0; i < P.length; i += 3) R = Math.max(R, Math.hypot(P[i] - c[0], P[i + 1] - c[1], P[i + 2] - c[2]));
    }
    // The crown the vegetation shading uses (each leaf's record: v1 = its
    // crown's centre and radius), else the leaves' box.
    let crownC = [0, 1, 2].map((a) => (llo[a] + lhi[a]) / 2);
    let crownR = Math.max(...[0, 1, 2].map((a) => (lhi[a] - llo[a]) / 2));
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
    const groundWas = ground.visible;
    ground.visible = false;
    const nodes = [[bark, BARK], [leaves, LEAF]].map(([m, mat]) => {
        const n = scene.createMesh(Object.assign({ data: m }, mat));
        n.setShader({ module: BAKE_HOOK, file: 'impostor_bake.bk', uniforms: { crown: [...crownC, crownR], bend: [o.bend, 0, 0, 0] } });
        return n;
    });
    const W = o.res, V = o.nAz * o.nEl, SS = o.ss, B = W * SS;
    const alb = new Float32Array(V * W * W * 4), nrm = new Float32Array(V * W * W * 4);
    const el0 = o.elStep * Math.PI / 180;
    for (let vi = 0; vi < V; vi++) {
        const az = (vi % o.nAz) * 2 * Math.PI / o.nAz, el = Math.floor(vi / o.nAz) * el0;
        const d = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
        const D = 4 * R;
        scene.setCamera({ mode: 'orthographic', size: 2 * R, aspect: 1, near: 0.1, far: 8 * R,
            eye: [c[0] + d[0] * D, c[1] + d[1] * D, c[2] + d[2] * D], target: c, up: [0, 1, 0] });
        for (const n of nodes) n.setShaderUniform('bend', [o.bend, ...d]);
        // Captured SS x finer and box-filtered: a texel's alpha is the share
        // of it the tree covers, its albedo and normal the covered samples'
        // mean; empty texels take the view's mean so filtering does not fringe.
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
                if (M[p] < 250 || M[p + 1] < 250 || M[p + 2] < 250) continue;
                cov++;
                ao += LUT[O[p]];
                for (let k = 0; k < 3; k++) { a[k] += LUT[A[p + k]]; nn[k] += LUT[N[p + k]] * 2 - 1; }
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
    for (const n of nodes) n.destroy();
    ground.visible = groundWas;
    return { alb, nrm, box: [...c, R], W, V, o };
}

// Each card (6 vertices) moved toward the crown's centre so its outer edge
// sits where its centre was: a big card does not grow the crown.
function pullCards(m, half, per = 6) {
    const P = m.positions;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], P[i + a]); hi[a] = Math.max(hi[a], P[i + a]); }
    const c = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2);
    const out = new Float32Array(P);
    for (let v = 0; v < P.length / 3; v += per) {
        const q = [0, 0, 0];
        for (let j = 0; j < per; j++) for (let a = 0; a < 3; a++) q[a] += P[(v + j) * 3 + a] / per;
        const d = [q[0] - c[0], q[1] - c[1], q[2] - c[2]], dl = Math.hypot(...d);
        const move = dl > 1e-6 ? Math.min(half, dl) / dl : 0;
        for (let j = 0; j < per; j++) for (let a = 0; a < 3; a++) out[(v + j) * 3 + a] -= d[a] * move;
    }
    return new Mesh({ positions: out, normals: m.normals, indices: m.indices });
}

/**
 * The trees' shadow, for impostors (whose cut the shadow pass does not run):
 * species `sp`'s crown as L-times leaf cards (`cover` of the crown's leaf
 * area, each pulled `pull` of its size toward the crown's centre) and its
 * limbs (branches past `minRadius` m) in one mesh, instanced over `trees`,
 * shadowOnly, casting `range` of the sun's shadow (shadowRange), each page
 * view drawing only the trees whose sphere reaches it
 * (setInstanceCullSpheres). The defaults match the mesh trees' own shadow
 * on the ground within 0.97-1.06 from eye height, 30 m and 150 m in wind,
 * soft-edged as theirs (half the cards: a swaying crown's flutter lets more
 * light through than a still card does). Returns the node.
 */
export function shadowProxyNode(sp, trees, { L = 12, minRadius = 0.15, range = 'all', pull = 0, cover = 0.5 } = {}) {
    const kk = 1.5 * L / sp.k;
    const leaves = pullCards(sp.world.emitFoliageMesh(leafCard(kk, [1, 2]), { seed: 0x1eaf, perArea: cover * 90 / (kk * kk) }), pull * kk);
    const bark = barkMesh(sp.world.emitBranchTubes({ minRadius: minRadius / sp.k }), 3);
    const inst = new Float32Array(trees.length * 16);
    trees.forEach((t, i) => {
        const s = sp.k * t.size, c = Math.cos(t.yaw) * s, n = Math.sin(t.yaw) * s;
        inst.set([c, 0, n, t.x, 0, s, 0, 0, -n, 0, c, t.z, 1, 1, 1, 1], i * 16);
    });
    return scene.createInstancedMesh({ mesh: mergeMeshes(leaves, bark), instances: inst, color: [0.1, 0.1, 0.1],
        doubleSided: true, castsShadow: true, shadowOnly: true, shadowRange: range, receivesShadow: false, vertexColorTint: false })
        .setInstanceCullSpheres(cullSpheres(sp, trees));
}

// Two meshes' positions, normals and triangles as one.
function mergeMeshes(a, b) {
    const na = a.positions.length / 3;
    const pos = new Float32Array(a.positions.length + b.positions.length);
    pos.set(a.positions);
    pos.set(b.positions, a.positions.length);
    const nrm = new Float32Array(pos.length);
    nrm.set(a.normals);
    nrm.set(b.normals, a.normals.length);
    const idx = new Uint32Array(a.indices.length + b.indices.length);
    idx.set(a.indices);
    for (let i = 0; i < b.indices.length; i++) idx[a.indices.length + i] = b.indices[i] + na;
    return new Mesh({ positions: pos, normals: nrm, indices: idx });
}

const QUAD = () => new Mesh({
    positions: new Float32Array([-30, 0, -30, 30, 0, 30, 30, 60, -30, -30, 60, 30]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
});

/**
 * One instanced impostor node for `trees` (all of species `sp`, baked as
 * `sp.imp`): { x, z, yaw, size }. `band` [from, to] (m from the eye) dithers
 * the impostors in over it, for a handoff from mesh trees fading out over the
 * same band. Returns the node (destroy() to drop it).
 */
// Each tree's bounding sphere (its baked box's centre and radius, a little
// over for the quad drawn toward the eye), for setInstanceCullSpheres: the
// camera and every shadow page view draw only the trees that reach them.
function cullSpheres(sp, trees) {
    const [bx, by, bz, R] = sp.imp.box;
    const out = new Float32Array(trees.length * 4);
    trees.forEach((t, i) => {
        const s = sp.k * t.size, c = Math.cos(t.yaw), n = Math.sin(t.yaw);
        out.set([t.x + (c * bx + n * bz) * s, by * s, t.z + (-n * bx + c * bz) * s, 1.1 * R * s], i * 4);
    });
    return bro.kernel.createBuffer(out);
}

export function impostorNode(sp, trees, { band = [0, 0], castsShadow = false, gain = IMPOSTOR.gain, front = IMPOSTOR.front } = {}) {
    const inst = new Float32Array(trees.length * 16), data = new Float32Array(trees.length * 4);
    trees.forEach((t, i) => {
        inst.set([1, 0, 0, t.x, 0, 1, 0, 0, 0, 0, 1, t.z, 1, 1, 1, 1], i * 16);
        data.set([t.x, t.z, t.yaw, sp.k * t.size], i * 4);
    });
    const n = scene.createInstancedMesh({ mesh: QUAD(), instances: inst, color: [1, 1, 1], metallic: 0, roughness: 0.75,
        alphaCutoff: 0.5, doubleSided: true, castsShadow, receivesShadow: true, vertexColorTint: false });
    const { alb, nrm, box, W, V, o } = sp.imp;
    n.setShader({ module: DRAW_HOOK, file: 'impostor.bk',
        uniforms: { box, views: [o.nAz, o.nEl, o.elStep * Math.PI / 180, PX], band: [band[0], band[1], W, 0], gain: [...gain, front] } });
    n.setShaderTexture('albedo', { data: alb, width: W, height: W, layers: V, channels: 4, mipmap: true });
    n.setShaderTexture('normals', { data: nrm, width: W, height: W, layers: V, channels: 4, mipmap: true });
    n.setShaderBuffer('trees', bro.kernel.createBuffer(data));
    n.setInstanceCullSpheres(cullSpheres(sp, trees));
    return n;
}
