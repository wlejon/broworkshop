// canopyNode: the forest past the impostors as one layer: a quad over the
// forest's ground at its crowns' height, textured with what its trees cover
// of each cell seen from above and the colour of what covers it, lit as
// foliage. Past a few kilometres a crown is a few pixels, and a quad an
// instance over tens of thousands of them is spent on sub-pixel triangles
// that cover the pixels' samples less and less; the layer's cost is one
// quad whatever the forest's size.

import { scene } from "./lab.js";

const HOOK = `
module hook;
import mesh;
import scene;
import custom;
struct Params { area: vec4<f32>, band: vec4<f32>, gain: vec4<f32>, light: vec4<f32> }
@binding(4, 0) var params: uniform<Params>;
@binding(4, 1) var cover: texture2d<vec4<f32>>;

pub fn vertex(v: mesh::Vertex) -> mesh::Vertex {
    var o = v;
    o.v0 = vec4<f32>((v.pos.x - params.area.x) / params.area.z, (v.pos.z - params.area.y) / params.area.z, 0.0, 0.0);
    return o;
}

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
    var out = s;
    // The mip whose texel is the pixel's footprint on the layer (band.z: a
    // pixel's angle; area.w: a cell's side), wider as the view grazes it.
    let up = max(abs(normalize(-v.world_pos).y), 0.15);
    let lod = max(0.0, log2(v.cam_dist * params.band.z / (params.area.w * up)));
    let c = cover.sample_lod(custom::linear, vec2<f32>(v.v0.x, v.v0.y), lod);
    out.base_color = c.xyz * params.gain.xyz;
    // Seen at a slant the crowns' sides hide the gaps between them: the
    // light through the layer falls as through one 1 / sin(elevation)
    // times as deep (light.z scales how deep the crowns stand).
    let elev = max(abs(normalize(-v.world_pos).y), 0.05);
    var alpha = 1.0 - pow(max(1.0 - min(c.w * params.gain.w, 1.0), 0.0), 1.0 + params.light.z * (1.0 / elev - 1.0));
    // Nearer than the band the impostors have the pixel (band.x .. band.y).
    let dither = scene::band_dither(v.pixel);
    if (length(v.world_pos) < mix(params.band.x, params.band.y, dither)) { alpha = 0.0; }
    out.alpha = alpha;
    out.normal = vec3<f32>(0.0, 1.0, 0.0);
    out.sky_visibility = params.light.y;
    out.occluder_sun = params.light.x;
    out.roughness = 0.75;
    out.leaf = 1.0;
    out.metallic = 0.0;
    return out;
}`;

// A pixel's angle at 1080 rows and a 50 degree view (as impostor.js).
const PX = 2 * Math.tan(25 * Math.PI / 180) / 1080;

// A species' crown seen from above, from its impostor bake's top row of
// views (averaged over their azimuths): coverage by radius from the crown's
// centre (BINS rings out to the baked sphere's radius), the colour of what
// covers it (alpha weighted), and the ambient light its leaves see.
const BINS = 24;
function topProfile(imp) {
    const { alb, nrm, W, o } = imp;
    const prof = new Float64Array(BINS), cnt = new Float64Array(BINS), col = [0, 0, 0];
    let wsum = 0, sky = 0;
    for (let ai = 0; ai < o.nAz; ai++) {
        const base = ((o.nEl - 1) * o.nAz + ai) * W * W * 4;
        for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
            const t = base + (y * W + x) * 4, a = alb[t + 3];
            const r = Math.hypot((x + 0.5) / W * 2 - 1, (y + 0.5) / W * 2 - 1);
            const b = Math.floor(r * BINS);
            if (b < BINS) { prof[b] += a; cnt[b]++; }
            if (a > 0) { for (let k = 0; k < 3; k++) col[k] += a * alb[t + k]; wsum += a; sky += a * nrm[t + 3]; }
        }
    }
    for (let b = 0; b < BINS; b++) prof[b] = cnt[b] ? prof[b] / cnt[b] : 0;
    return { prof, color: col.map((c) => c / wsum), sky: sky / wsum };
}

/**
 * Hide `nodes` (the impostors) while the eye is farther than `dist` from
 * every point of the box [x0, z0, x1, z1] (0 to `top` m up): every instance
 * past its band, the node would still cull each one every view. Returns
 * update(eye) (vp.onView((v) => update(v.position))).
 */
export function hideBeyond(nodes, [x0, z0, x1, z1], dist, top = 40) {
    let shown = true;
    return ([x, y, z]) => {
        const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1), dy = Math.max(0, y - top);
        const want = dx * dx + dy * dy + dz * dz < dist * dist;
        if (want !== shown) { for (const n of nodes) n.visible = want; shown = want; }
    };
}

const hash = (x, z) => {
    let h = Math.imul(Math.floor(x * 8) | 0, 0x27d4eb2d) ^ Math.imul(Math.floor(z * 8) | 0, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

/**
 * The layer for `bySp[i]` (the trees of `species[i]`, each with its bake
 * `imp`) over the square [-half, half]: `cell` m texels (each 2 x 2 samples
 * of the trees' top-view coverage, a cell's coverage what its trees leave
 * uncovered taken away, 1 - prod(1 - a)), at the crowns' mean height.
 * `band` [from, to] (m from the eye) dithers it in, for the impostors
 * dithering out over the same band (`impostorNode`'s `until`). `cover`
 * scales its coverage (as the impostors' from above), `gain` its colour.
 * Returns { node, ms } (ms: the texture's build).
 */
export function canopyNode(species, bySp, { half, cell = 4, band = [3000, 4050], cover = 1.2, gain = [1.06, 0.96, 0.95], occluder = 0.5, slant = 2 } = {}) {
    const t0 = perf.now();
    const N = Math.ceil(2 * half / cell);
    const T = new Float32Array(N * N).fill(1);   // what the trees leave uncovered
    const C = new Float32Array(N * N * 3);       // covering colour, coverage weighted
    const S = new Float32Array(N * N);
    let hSum = 0, hN = 0, skySum = 0;
    const sub = [0.25, 0.75];
    species.forEach((sp, si) => {
        const { prof, color, sky } = topProfile(sp.imp);
        const [bx, by, bz, R] = sp.imp.box;
        for (const t of bySp[si]) {
            const s = sp.k * t.size, rr = R * s;
            const c = Math.cos(t.yaw), n = Math.sin(t.yaw);
            const cx = t.x + (c * bx + n * bz) * s, cz = t.z + (-n * bx + c * bz) * s;
            hSum += by * s; hN++;
            const tone = hash(t.x, t.z);
            const tint = [0, 1, 2].map((k) => ([0.84, 0.97, 1.08][k] * (1 - tone) + [1.12, 1.04, 0.76][k] * tone) * (0.9 + 0.2 * ((tone * 13.7) % 1)));
            const i0 = Math.max(0, Math.floor((cx - rr + half) / cell)), i1 = Math.min(N - 1, Math.floor((cx + rr + half) / cell));
            const j0 = Math.max(0, Math.floor((cz - rr + half) / cell)), j1 = Math.min(N - 1, Math.floor((cz + rr + half) / cell));
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                let a = 0;
                for (const u of sub) for (const w of sub) {
                    const r = Math.hypot((i + u) * cell - half - cx, (j + w) * cell - half - cz) / rr;
                    const b = Math.floor(r * BINS);
                    if (b < BINS) a += prof[b];
                }
                a = Math.min(1, cover * a / 4);
                if (a <= 0) continue;
                const k = j * N + i;
                T[k] *= 1 - a;
                for (let q = 0; q < 3; q++) C[k * 3 + q] += a * color[q] * tint[q];
                S[k] += a;
            }
            skySum += sky;
        }
    });
    const data = new Float32Array(N * N * 4);
    for (let k = 0; k < N * N; k++) {
        const w = S[k];
        for (let q = 0; q < 3; q++) data[k * 4 + q] = w > 0 ? C[k * 3 + q] / w : 0;
        data[k * 4 + 3] = 1 - T[k];
    }
    // Uncovered cells take their neighbourhood's colour, so a mip averaging
    // them with covered ones does not darken toward black.
    let mean = [0, 0, 0], mw = 0;
    for (let k = 0; k < N * N; k++) if (S[k] > 0) { for (let q = 0; q < 3; q++) mean[q] += data[k * 4 + q] * S[k]; mw += S[k]; }
    mean = mean.map((m) => m / mw);
    for (let k = 0; k < N * N; k++) if (!(S[k] > 0)) for (let q = 0; q < 3; q++) data[k * 4 + q] = mean[q];
    const h = hSum / hN, e = N * cell / 2;
    const mesh = new Mesh({
        positions: new Float32Array([-e, h, -e, e, h, -e, e, h, e, -e, h, e]),
        normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
    });
    const node = scene.createMesh({ data: mesh, color: [1, 1, 1], metallic: 0, roughness: 0.75, alphaCutoff: 0.5,
        alphaToCoverage: true, doubleSided: true, castsShadow: false, receivesShadow: false, vertexColorTint: false });
    node.setShader({ module: HOOK, file: 'canopy.bk',
        uniforms: { area: [-e, -e, 2 * e, cell], band: [band[0], band[1], PX, 0], gain: [gain[0], gain[1], gain[2], 1], light: [occluder, skySum / hN, slant, 0] } });
    node.setShaderTexture('cover', { data, width: N, height: N, channels: 4, mipmap: true });
    return { node, ms: perf.now() - t0, height: h };
}
