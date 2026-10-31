// Planet trees: conifers about the eye wherever the ground is forest, each
// standing at its own site of a lattice fixed to the world (trees.bk
// k_tree_field), so a tree is the same tree from 2 m and from 2 km.
//
// The field is N x N sites on the gnomonic plane of the eye's cube face (as
// the grass's, grass.js), about SPACING metres apart (a power of two of the
// plane's units), each the ground's true surface at the site's hashed spot,
// whether a tree stands there and how large, and the colour variation there.
// It is produced again when the eye has moved SNAP sites, into a second
// buffer a slice a frame, and swapped in when it is whole, so no frame pays
// for all of it; the terrain's shadow on it (sun.js) follows the same way.
//
// The trees are drawn in blocks of B x B sites, one instance per block, the
// GPU building every tree from its site and a hash of it (as the grass's
// blades). A conifer is a cone of whorls: tiers of drooping branches, each a
// fan from the trunk out to a ragged rim, lit as the soft cone the crown is
// and darker inside and below, where the crown shades itself (Ghost of
// Tsushima's trees and the tiered silhouettes of spruce and fir are the
// models). Near, seven tiers of seven; out to MID, three of five; beyond, the
// cone's silhouette facing the eye; past FAR they shrink into the ground,
// whose forest colour is what they average to (ground.bk tree_cover).
import { faceFrame } from "/app/clouds.js";
import { createSunGrid } from "/app/sun.js";
import { stepped } from "/app/stepped.js";

const N = 512;             // sites along an edge
const B = 8;               // sites along a block's edge
const SNAP = 16;           // sites the eye moves before the field is produced again
const SLICES = 16;         // frames a field's production takes, a slice of rows each
const SPACING = 8.0;       // metres between sites, about (a power of two of the plane's units)
const NEAR = 220;          // metres: the full trees inside
const MID = 800;           // the three-tier ones out to it
const FAR = 1900;          // the silhouettes out to it, shrinking over its last sixth
const SUN_STRIDE = 4;      // sites between the sun grid's points
const SUN_P = N / SUN_STRIDE + 1;
const SHOWN_BELOW = 2500;  // metres of altitude above which no tree is drawn
const MAX_TREE_H = 24;     // metres: the tallest tree (treeCrown at size 1)
const SHADOW_REACH = 64;   // metres: the farthest a crown's shadow is followed toward the sun
const SHADOW_STEPS = 14;   // and the most steps along it

// The meshes: per tree in a block (x its index), its parts by (y, z):
// y >= 0 tier y, z its rim vertex (-1 the tier's top, at the trunk);
// y = -1 the trunk (z 0..2 its foot, -1 its top); y = -2 the silhouette's
// corners (z 0..2).
function treeBlock(tiers, rim, trunk) {
    const pos = [], idx = [];
    for (let t = 0; t < B * B; t++) {
        if (tiers > 0) {
            for (let k = 0; k < tiers; k++) {
                const top = pos.length / 3;
                pos.push(t, k, -1);
                for (let i = 0; i < rim; i++) pos.push(t, k, i);
                for (let i = 0; i < rim; i++) idx.push(top, top + 1 + i, top + 1 + (i + 1) % rim);
            }
            if (trunk) {
                const foot = pos.length / 3;
                pos.push(t, -1, 0, t, -1, 1, t, -1, 2, t, -1, -1);
                for (let i = 0; i < 3; i++) idx.push(foot + 3, foot + i, foot + (i + 1) % 3);
            }
        } else {
            const c = pos.length / 3;
            pos.push(t, -2, 0, t, -2, 1, t, -2, 2);
            idx.push(c, c + 1, c + 2);
        }
    }
    const normals = new Float32Array(pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    return new Mesh({ positions: new Float32Array(pos), normals, indices: new Uint32Array(idx) });
}

// A tree's hash and crown, from its site on the world's lattice: the tree
// shader draws it from them, and the ground (treeShadowBk) its shadow.
const treeCrownBk = `
    fn pcg(v: u32) -> u32 {
        let s = v * 747796405u + 2891336453u;
        let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
        return (w >> 22u) ^ w;
    }
    fn rnd_val(s: u32) -> f32 {
        return (s as f32) * (1.0 / 4294967296.0);
    }
    fn tree_seed(world: vec2<i32>, face: f32) -> u32 {
        return pcg((world.x as u32) * 73856093u ^ (world.y as u32) * 19349663u ^ (face as u32) * 83492791u);
    }
    struct Crown {
        h: f32,
        r: f32,
        foot: f32,
        seed: u32,
    }
    // Its height, the crown's radius at its foot and the foot's height
    // (below it, the bare trunk), for a site of the given size.
    fn tree_crown(seed_in: u32, size: f32) -> Crown {
        let s1 = pcg(seed_in);
        let h = size * mix(11.0, 24.0, rnd_val(s1));
        let s2 = pcg(s1);
        let r = h * mix(0.17, 0.25, rnd_val(s2));
        return Crown { h: h, r: r, foot: 0.08 * h, seed: s2 };
    }`;

// The trees' shadows on the ground, for a node createTrees is given as a
// reader: tree_shadow(p, eye, up, to_sun) is the sun the crowns leave at p, the
// ground point about the field's origin (eye the camera's), each crown the
// cone the tree draws it as, from R at its foot to nothing at its top. The
// trees whose crowns the sun's ray from p can cross stand within a crown's
// reach of its path across the ground, up to the tallest tree's height over
// the sun's slope: the sites about that path (three across it, a step of 0.7
// sites along it) are tested. For each, the ray's horizontal distance to the
// axis and the crown's radius at the ray's height are both linear in the
// distance along the ray (with the square root), so the nearest the ray comes
// inside the crown is where their difference is least: at the point of
// closest approach, moved down the ray by e k / sqrt(1 - k^2) (k the rate the
// crown widens as the ray descends), within the crown's heights. A crown
// passes 15% of the sun through its gaps, its edge a penumbra growing with
// the distance (the sun's disc) and its ragged rim.
export const treeShadowBk = `
    ${treeCrownBk}
    fn tree_shadow(p: vec3<f32>, eye: vec3<f32>, up: vec3<f32>, to_sun: vec3<f32>) -> f32 {
        let mu = dot(to_sun, up);
        if (mu <= 0.05 || params.tree_uv.z <= 0.0) { return 1.0; }
        var lh = to_sun - up * mu;
        let lhl = length(lh);
        lh = lh / lhl;
        let tan_e = mu / lhl;
        // p's site coordinates, and the sun's direction across the ground in
        // sites a metre (the gnomonic plane's derivative).
        let big_p = params.tree_o_hi + (params.tree_o_lo + p);
        let r = length(big_p);
        let q = big_p / r;
        let z = dot(q, params.tree_a);
        let uv = vec2<f32>(dot(q, params.tree_e), dot(q, params.tree_f)) / z;
        let s = (uv - params.tree_uv.xy) / params.tree_uv.z;
        let ds = (vec2<f32>(dot(lh, params.tree_e), dot(lh, params.tree_f)) - uv * dot(lh, params.tree_a)) / (z * r * params.tree_uv.z);
        let per_metre = length(ds);
        let dn = ds / per_metre;
        let across = abs(dn.x) > abs(dn.y) ? vec2<i32>(0, 1) : vec2<i32>(1, 0);
        let steps = min((ceil(min(${MAX_TREE_H.toFixed(1)} / tan_e, ${SHADOW_REACH.toFixed(1)}) * per_metre / 0.7) as i32) + 2, ${SHADOW_STEPS});
        var vis: f32 = 1.0;
        let lat_xy = vec2<i32>(params.tree_lattice.x as i32, params.tree_lattice.y as i32);
        for (var k: i32 = -1; k < steps; k += 1) {
            let nf = floor(s + dn * (0.7 * (k as f32)) + vec2<f32>(0.5));
            let n = vec2<i32>(nf.x as i32, nf.y as i32);
            for (var j: i32 = -1; j <= 1; j += 1) {
                let site = n + across * j;
                let edge = min(min(site.x, ${N - 1} - site.x), min(site.y, ${N - 1} - site.y));
                if (edge >= 0) {
                    let idx = (site.y * ${N} + site.x) * 7;
                    let c = vec3<f32>(tree_field[idx], tree_field[idx + 1], tree_field[idx + 2]);
                    // Sized as the tree is drawn: shrinking into the ground over
                    // the last sixth of its reach and at the field's edge.
                    let size = tree_field[idx + 3] * smoothstep(0.0, 12.0, edge as f32)
                             * smoothstep(${FAR.toFixed(1)}, ${(FAR * 5 / 6).toFixed(1)}, length(c - eye));
                    if (size > 0.0) {
                        let seed = tree_seed(site + lat_xy, params.tree_lattice.z);
                        let cr = tree_crown(seed, size);
                        let w = c - p;
                        let hb = dot(w, up);            // the tree's foot over p
                        let wh = w - up * hb;
                        let a = dot(wh, lh);            // along the sun's path to the axis
                        let e = length(wh - lh * a);    // and across it
                        let kw = tan_e * cr.r / (cr.h - cr.foot);
                        var t = kw < 1.0 ? a - e * kw * inversesqrt(1.0 - kw * kw) : -1.0e9;
                        let t_foot = (cr.foot + hb) / tan_e;
                        let t_top = (cr.h + hb) / tan_e;
                        t = clamp(t, max(t_foot, 0.0), t_top);
                        if (t_top > 0.0) {
                            let height = t * tan_e - hb;
                            let rr = cr.r * (cr.h - height) / (cr.h - cr.foot);
                            let dist = length(vec2<f32>(e, a - t));
                            let pen = 0.2 * rr + 0.0093 * t + 0.1;
                            vis = min(vis, 1.0 - 0.85 * smoothstep(rr + pen, rr - pen, dist));
                        }
                    }
                }
            }
        }
        return vis;
    }`;

const BLOCKS = N / B;           // blocks along an edge
// How far a tree of a block can stand from the block's centre on the
// sphere at the eye's ground: half its diagonal (a site is at most 1.41
// SPACING), the tree, and the relief between.
const BLOCK_REACH = 0.7072 * B * 1.4143 * SPACING + 30 + 250;

const treeHookBk = (ragged) => `module hook;
import mesh;

struct Params {
    cam_hi: vec3<f32>,
    cam_lo: vec3<f32>,
    cam_fwd: vec3<f32>,
    o_hi: vec3<f32>,
    o_lo: vec3<f32>,
    lattice: vec3<f32>,
    sun_lattice: vec2<f32>,
    time: f32,
    to_sun: vec3<f32>,
    band: vec2<f32>,
    shape: vec2<f32>,
}
@binding(4, 0) var params: uniform<Params>;
@binding(4, 14) var field: read_buffer<f32>;
@binding(4, 15) var sun: read_buffer<u32>;
@binding(4, 16) var blocks: read_buffer<i32>;

${treeCrownBk}

// The sun grid between its points, at field point f (sun.js: the
// terrain's sun, then the clouds' direct, scattered and sky).
fn sun_at(f: vec2<f32>) -> vec4<f32> {
    let s = clamp(f / ${SUN_STRIDE}.0, vec2<f32>(0.0), vec2<f32>(${SUN_P - 1}.0 - 1e-3));
    let i = vec2<i32>(s.x as i32, s.y as i32);
    let t = s - vec2<f32>(i.x as f32, i.y as f32);
    let k = i.y * ${SUN_P} + i.x;
    return mix(mix(unpack_unorm4x8(sun[k]), unpack_unorm4x8(sun[k + 1]), t.x),
               mix(unpack_unorm4x8(sun[k + ${SUN_P}]), unpack_unorm4x8(sun[k + ${SUN_P + 1}]), t.x), t.y);
}

pub fn vertex(v_in: mesh::Vertex) -> mesh::Vertex {
    var v = v_in;
    let tree = (v.pos.x + 0.5) as i32;
    let part = floor(v.pos.y + 0.5) as i32;
    let corner = floor(v.pos.z + 0.5) as i32;
    let inst = v.instance_index;
    let site = (vec2<i32>(blocks[2 * inst], blocks[2 * inst + 1]) + vec2<i32>(${N / B / 2})) * ${B}
             + vec2<i32>(tree % ${B}, tree / ${B});
    let k = (site.y * ${N} + site.x) * 7;
    let base = vec3<f32>(field[k], field[k + 1], field[k + 2]);
    var size = field[k + 3];
    let vary = vec3<f32>(field[k + 4], field[k + 5], field[k + 6]);
    let rel = (params.o_hi - params.cam_hi) + (params.o_lo - params.cam_lo) + base;
    let up = normalize(params.o_hi + (params.o_lo + base));
    let d = length(rel);

    // This node's band, the field's edge and FAR: the trees beyond
    // shrink into the ground. None behind the eye.
    let edge = min(min(site.x, ${N - 1} - site.x), min(site.y, ${N - 1} - site.y));
    size *= step(params.band.x, d) * step(d, params.band.y) * smoothstep(${FAR.toFixed(1)}, ${(FAR * 5 / 6).toFixed(1)}, d)
          * smoothstep(0.0, 12.0, edge as f32) * step(-40.0, dot(rel, params.cam_fwd));

    let lat_xy = vec2<i32>(params.lattice.x as i32, params.lattice.y as i32);
    var seed = tree_seed(site + lat_xy, params.lattice.z);
    let cr = tree_crown(seed, size);
    seed = cr.seed;
    let big_h = cr.h;
    let big_r = cr.r;
    let foot = cr.foot;
    seed = pcg(seed);
    let phi = 6.2831853 * rnd_val(seed);
    let tx = normalize(cross(up, abs(up.y) < 0.9 ? vec3<f32>(0.0, 1.0, 0.0) : vec3<f32>(1.0, 0.0, 0.0)));
    let ty = cross(up, tx);
    // Its needles: dark, a little bluer or yellower tree to tree, as the
    // ground's colour varies.
    seed = pcg(seed);
    let needles = vec3<f32>(0.034, 0.062, 0.028) * vary * exp(vec3<f32>(0.3, 0.2, 0.35) * (rnd_val(seed) - 0.5));
    // A breeze leans the crown, more toward its top.
    let w = mod(params.o_hi, 256.0) + mod(params.o_lo, 256.0) + base;
    let gust = 0.5 + 0.5 * sin(params.time * 0.9 - dot(w, tx) * 0.05 + 0.7 * sin(dot(w, ty) * 0.03 + params.time * 0.3));
    let lean = tx * (0.004 + 0.012 * gust) * big_h;

    var p = vec3<f32>(0.0);
    var n = up;
    var ao: f32 = 1.0;
    var col = needles;
    var branch = vec3<f32>(0.0, 0.0, -1.0);
    if (part >= 0) {
        let tiers = params.shape.x;
        let rim = params.shape.y;
        let kt = part as f32;
        let step1 = (big_h - foot) / tiers;
        let top = foot + (kt + 1.0) * step1;
        // Each tier's rim droops below the next tier's top, so they overlap.
        let low = max(top - 1.6 * step1, foot * 0.5);
        let spin = 6.2831853 * fract(phi + kt * 0.618);
        var ts = seed ^ ((part * 7919 + corner * 104729) as u32);
        if (corner < 0) {
            p = up * top;
            n = up;
            ao = 0.45;
            branch = vec3<f32>(0.0);
        } else {
            // Long and short branches in turn: a ragged skirt.
            let short_one = ((corner % 2) as f32) * step(2.5, rim);
            ts = pcg(ts);
            let a = spin + 6.2831853 * ((corner as f32) + 0.3 * (rnd_val(ts) - 0.5)) / rim;
            let radial = tx * cos(a) + ty * sin(a);
            let rim_low = low + short_one * 0.3 * step1;
            ts = pcg(ts);
            let r = (big_r * (1.0 - (rim_low - foot) / (big_h - foot)) * mix(0.8, 1.2, rnd_val(ts)) + 0.15)
                  * mix(1.0, 0.72, short_one);
            p = up * rim_low + radial * r;
            n = normalize(radial * 0.8 + up * 0.6);
            col *= 1.15;
            branch = vec3<f32>(dot(radial, tx) * r, dot(radial, ty) * r, 1.0);
        }
        // The crown shades its own lower tiers.
        ao *= mix(0.6, 1.0, (kt + 1.0) / tiers);
    } else if (part == -1) {
        let a = phi + 2.0943951 * (corner as f32);
        let radial = tx * cos(a) + ty * sin(a);
        p = corner < 0 ? up * 0.4 * big_h : radial * 0.035 * big_h;
        n = corner < 0 ? up : radial;
        col = vec3<f32>(0.10, 0.07, 0.05);
        ao = 0.4;
    } else {
        // The silhouette: a cone's outline facing the eye, lit as the cone.
        let side = normalize(cross(up, rel));
        let to_eye = -normalize(rel);
        if (corner == 2) {
            p = up * big_h;
            n = normalize(up + to_eye * 0.4);
        } else {
            let s = corner == 0 ? -1.0 : 1.0;
            p = up * foot + side * s * big_r * 1.05;
            n = normalize(side * s * 0.7 + to_eye * 0.5 + up * 0.5);
            ao = 0.6;
        }
    }
    let hgt = dot(p, up);
    p += lean * (hgt / max(big_h, 1e-3)) * (hgt / max(big_h, 1e-3));
    if (size <= 0.0) { p = vec3<f32>(0.0); }
    v.pos = rel + p;
    v.normal = n;
    var v_light = sun_at(vec2<f32>(site.x as f32, site.y as f32) + vec2<f32>(0.5) + (params.lattice.xy - params.sun_lattice));
    // The neighbours' crowns between this point and the sun: the gap
    // probability of a canopy of their cover (the share of the 8 sites
    // about it holding a tree, times the share a crown hides from above,
    // app.js TREE_CROWNS) over the depth of canopy above the point, along
    // the sun's slant (Nilson 1971, as the ground's crowns from afar).
    var around: f32 = 0.0;
    for (var j: i32 = -1; j <= 1; j += 1) {
        for (var i: i32 = -1; i <= 1; i += 1) {
            let o = clamp(site + vec2<i32>(i, j), vec2<i32>(0), vec2<i32>(${N - 1}));
            if ((i != 0 || j != 0) && field[(o.y * ${N} + o.x) * 7 + 3] > 0.0) {
                around += 1.0;
            }
        }
    }
    let canopy = clamp((big_h - hgt) / max(big_h - foot, 1e-3), 0.0, 1.0);
    let sun_vis = v_light.x * pow(1.0 - 0.55 * around / 8.0, canopy / max(dot(params.to_sun, up), 0.05));
    seed = pcg(seed);
    let v_seed = rnd_val(seed);
    v.v0 = vec4<f32>(col, ao);
    v.v1 = vec4<f32>(sun_vis, v_light.y, v_light.z, v_light.w);
    v.v2 = vec4<f32>(branch, v_seed);
    return v;
}

pub fn fragment(v: mesh::Vertex, s_in: mesh::Surface) -> mesh::Surface {
    var s = s_in;
    let v_col = v.v0.xyz;
    let v_ao = v.v0.w;
    let v_light = v.v1;
    let v_branch = v.v2.xyz;
    let v_seed = v.v2.w;
    // A tier is branches radiating from the trunk, needled fingers
    // narrowing out to the rim with the dark of the crown between them;
    // where they are finer than a pixel, their average.
    var shade: f32 = 1.0;
    if (v_branch.z >= 0.0) {
        let nb = 9.0 + floor(v_seed * 6.0);
        let a = atan2(v_branch.y, v_branch.x) * (nb / 6.2831853) + v_seed * 17.0 + 0.8 * v_branch.z;
        let off = abs(fract(a) - 0.5);
        let width = mix(0.46, 0.27, v_branch.z);
        let fw = fwidth(a);
        let in_branch = 1.0 - smoothstep(width - 0.06 - fw, width + fw, off);
        // Out toward the rim the gaps between fingers are open, each
        // finger reaching its own way out and narrowing to its tip, so a
        // tier's edge is ragged rather than a polygon's; where the
        // fingers are finer than a pixel, the edge is their average
        // instead. Only the near trees' fingers are that large, and
        // only their pass gives up the early depth test a discard costs.
        ${ragged ? `let reach = 0.6 + 0.3 * fract(sin(floor(a) * 12.9898 + v_seed * 78.233) * 43758.5453);
        let tip = (width + 0.04) * (1.0 - 0.75 * smoothstep(reach, 1.0, v_branch.z));
        if (fw < 0.25 && v_branch.z > reach && off > tip) { discard_fragment(); }` : ''}
        let cover = mix(2.0 * width, in_branch, smoothstep(0.6, 0.25, fw));
        shade = mix(0.3, 1.0, cover);
        // Each finger is needled twigs: across and along it, a grain
        // that averages out where it is finer than a pixel.
        let g = vec2<f32>(a * 7.0, v_branch.z * 38.0);
        let gc = floor(g);
        var gf = g - gc;
        gf = gf * gf * (3.0 - 2.0 * gf);
        let s0 = v_seed * 31.0;
        let twig = mix(mix(fract(sin(dot(gc, vec2<f32>(12.9898, 78.233)) + s0) * 43758.5453),
                           fract(sin(dot(gc + vec2<f32>(1.0, 0.0), vec2<f32>(12.9898, 78.233)) + s0) * 43758.5453), gf.x),
                       mix(fract(sin(dot(gc + vec2<f32>(0.0, 1.0), vec2<f32>(12.9898, 78.233)) + s0) * 43758.5453),
                           fract(sin(dot(gc + vec2<f32>(1.0, 1.0), vec2<f32>(12.9898, 78.233)) + s0) * 43758.5453), gf.x), gf.y);
        let gw = max(fwidth(g.x), fwidth(g.y));
        shade *= mix(1.0, mix(0.72, 1.12, twig), in_branch * smoothstep(0.5, 0.15, gw));
        // The fingers' edges turn from the sun: rounded, not painted.
        let across = (fract(a) - 0.5) / width;
        shade *= mix(1.0, 1.0 - 0.35 * across * across, in_branch * smoothstep(0.6, 0.25, fw));
    }
    s.base_color = v_col * shade;
    // Both faces of a drooping tier take its outer side's normal; but
    // the face seen from below it is its underside, inside the crown:
    // where the face itself, turned to the eye, faces down.
    let upv = normalize((params.cam_hi + params.cam_lo) + v.world_pos);
    if (dot(s.normal, upv) < 0.0) { s.normal = -s.normal; }
    var face = cross(dpdx(v.world_pos), dpdy(v.world_pos));
    if (dot(face, v.world_pos) > 0.0) { face = -face; }
    // 1 on a tier's underside, which the sun reaches only through the
    // needles above it (15%) and the sky through about the gaps below
    // the tier (40%).
    let g_under = v_branch.z >= 0.0 && dot(face, upv) < 0.0 ? 1.0 : 0.0;
    s.metallic = 0.0;
    s.roughness = 0.85;
    // The terrain's shadow and the clouds' light from the sun grid, which
    // takes the clouds as the ground's light does (sun.bk), and the crown's
    // own: inside and below, its branches hide the sun and the sky.
    s.sun_visibility *= v_light.x * v_light.y * mix(0.35, 1.0, v_ao) * mix(1.0, 0.15, g_under);
    s.sun_diffuse = v_light.z;
    s.sky_visibility *= v_ao * v_light.w * mix(1.0, 0.4, g_under);
    s.occluder_sun *= v_light.y * 0.5;
    return s;
}`;

// The trees in `scene`, their field produced by `module` (trees.bk
// k_tree_field) and their sun grid, the terrain's shadow and the clouds'
// light, by `sunModule` (sun.bk) at `octaves` of the ground's; `readers`
// are nodes whose modules include treeShadowBk, bound to theirs.
// update() each frame with the eye about the planet's centre (f64), its
// altitude, the unit direction to the sun and the view's forward.
export function createTrees(scene, radius, module, sunModule, octaves, seed, net, readers = []) {
    const fieldKernel = module.kernel('k_tree_field');
    const fields = [bro.kernel.createBuffer(N * N * 7 * 4), bro.kernel.createBuffer(N * N * 7 * 4)];
    const sunGrid = createSunGrid(sunModule, SUN_P, net, 14);
    const bands = [
        { tiers: 7, rim: 7, trunk: true, band: [0, NEAR], ragged: true },
        { tiers: 3, rim: 5, trunk: false, band: [NEAR, MID], ragged: false },
        { tiers: 0, rim: 0, trunk: false, band: [MID, FAR], ragged: false },
    ];
    // Each band draws the blocks the CPU finds in its distances and in view,
    // listed afresh each frame (a few thousand blocks, against drawing all of
    // them in every band, most out of it or behind the eye).
    const lists = bands.map(() => ({ blocks: new Int32Array(2 * BLOCKS * BLOCKS), buffer: null, count: 0,
                                    found: new Int32Array(BLOCKS * BLOCKS), dist: new Float64Array(BLOCKS * BLOCKS) }));
    const nodes = bands.map(({ tiers, rim, trunk, band, ragged }, i) => {
        const node = scene.createInstancedMesh({
            mesh: treeBlock(tiers, rim, trunk), color: [1, 1, 1],
            castsShadow: false, receivesShadow: false, doubleSided: true,
            module: treeHookBk(ragged), file: 'trees_mesh.bk',
        });
        node.cullMargin = 4 * radius;   // the shader places the trees
        node.drawOrder = 4;             // before the grass and the ground they hide
        node.setShaderBuffer('field', fields[0]);
        node.setShaderBuffer('sun', sunGrid.buffer);
        lists[i].buffer = bro.kernel.createBuffer(lists[i].blocks.byteLength);
        node.setShaderBuffer('blocks', lists[i].buffer);
        node.setShaderUniform('band', band);
        node.setShaderUniform('shape', [tiers, rim]);
        node.setInstanceCount(0);
        return node;
    });
    // The front field's block centres: unit directions, three a block.
    const centres = new Float64Array(3 * BLOCKS * BLOCKS);

    // The field shown (front); the production in flight, a step a frame
    // beside the frames (stepped.js: a whole field and its sun grid in one
    // frame lengthened it by 6 ms), shown once done.
    let front = 0, shown = false, ready = false;
    let face = -1, delta = 0, ui = NaN, vi = NaN;
    let production = null;
    const sun = [0, 0, 0];

    function faceOf(eye) {
        const m = eye.map(Math.abs);
        const best = m[0] >= m[1] && m[0] >= m[2] ? 0 : (m[1] >= m[2] ? 1 : 2);
        if (face >= 0 && m[face % 3] * 1.05 >= m[best] && Math.sign(eye[face % 3]) === (face < 3 ? 1 : -1)) return face;
        return best + (eye[best] < 0 ? 3 : 0);
    }

    // The sun grid's steps, and showing it.
    function sunSteps(plane, u0, v0, dl, toSun) {
        sun.splice(0, 3, ...toSun);
        return sunGrid.steps(plane, u0, v0, dl * SUN_STRIDE, toSun, radius, octaves, seed);
    }
    function showSun(lattice) {
        const buffer = sunGrid.swap();
        for (const n of nodes) {
            n.setShaderBuffer('sun', buffer);
            n.setShaderUniform('sun_lattice', lattice);
        }
    }

    let current = null;   // the field shown or in flight: its plane, origin, lattice
    function plan(eye, toSun) {
        const fc = faceOf(eye), frame = faceFrame(fc);
        const z = eye[0] * frame.a[0] + eye[1] * frame.a[1] + eye[2] * frame.a[2];
        const u = (eye[0] * frame.e[0] + eye[1] * frame.e[1] + eye[2] * frame.e[2]) / z;
        const v = (eye[0] * frame.f[0] + eye[1] * frame.f[1] + eye[2] * frame.f[2]) / z;
        const stretch = Math.sqrt(1 + Math.max(u * u, v * v)) / (1 + u * u + v * v);
        const dl = 2 ** Math.round(Math.log2(SPACING / (radius * stretch)));
        const nu = Math.round(u / (SNAP * dl)) * SNAP, nv = Math.round(v / (SNAP * dl)) * SNAP;
        const plane = [...frame.a, ...frame.e, ...frame.f];
        const jumped = fc !== face || dl !== delta;
        // A production begun is shown before the next begins, unless the eye
        // left its face or spacing: then the new one replaces it (background
        // jobs run in order, so the back field ends as the new one's).
        if ((jumped || nu !== ui || nv !== vi) && (jumped || !production)) {
            face = fc;
            delta = dl;
            ui = nu;
            vi = nv;
            const c = [0, 0, 0];
            for (let k = 0; k < 3; k++) c[k] = frame.a[k] + frame.e[k] * ui * dl + frame.f[k] * vi * dl;
            const len = Math.hypot(c[0], c[1], c[2]);
            const origin = c.map((x) => x / len * radius);
            const li = ui - N / 2, lj = vi - N / 2, u0 = li * dl, v0 = lj * dl;
            const back = 1 - front, out = fields[back];
            const hi = origin.map(Math.fround), lo = origin.map((x, k) => x - hi[k]);
            const steps = [];
            for (let s = 0; s < SLICES; s++) {
                const y0 = s * N / SLICES;
                steps.push(() => fieldKernel.dispatch([N, N / SLICES], out, ...plane, u0, v0, dl, ...origin,
                                                      radius, octaves, seed, li, lj, fc, y0, net));
            }
            steps.push(...sunSteps(plane, u0, v0, dl, toSun));
            production = stepped(steps, () => {
                front = back;
                for (let by = 0; by < BLOCKS; by++)
                    for (let bx = 0; bx < BLOCKS; bx++) {
                        const su = u0 + (bx + 0.5) * B * dl, sv = v0 + (by + 0.5) * B * dl, j = 3 * (by * BLOCKS + bx);
                        const x = frame.a[0] + frame.e[0] * su + frame.f[0] * sv;
                        const y = frame.a[1] + frame.e[1] * su + frame.f[1] * sv;
                        const z = frame.a[2] + frame.e[2] * su + frame.f[2] * sv;
                        const l = Math.hypot(x, y, z);
                        centres[j] = x / l;
                        centres[j + 1] = y / l;
                        centres[j + 2] = z / l;
                    }
                for (const n of nodes) {
                    n.setShaderBuffer('field', fields[front]);
                    n.setShaderUniform('o_hi', hi);
                    n.setShaderUniform('o_lo', lo);
                    n.setShaderUniform('lattice', [li, lj, fc]);
                }
                for (const n of readers) {
                    n.setShaderBuffer('tree_field', fields[front]);
                    n.setShaderUniform('tree_o_hi', hi);
                    n.setShaderUniform('tree_o_lo', lo);
                    n.setShaderUniform('tree_lattice', [li, lj, fc]);
                    n.setShaderUniform('tree_a', frame.a);
                    n.setShaderUniform('tree_e', frame.e);
                    n.setShaderUniform('tree_f', frame.f);
                    n.setShaderUniform('tree_uv', [u0, v0, dl]);
                }
                showSun([li, lj]);
                ready = true;
            });
            current = { plane, u0, v0, dl, li, lj };
            return;
        }
        const turned = sun[0] * toSun[0] + sun[1] * toSun[1] + sun[2] * toSun[2] < 0.999999;
        if (turned && !production && current) {
            const { plane: p, u0, v0, dl: d, li, lj } = current;
            production = stepped(sunSteps(p, u0, v0, d, toSun), () => showSun([li, lj]));
        }
    }

    // The blocks each band draws: a block's trees stand within BLOCK_REACH
    // of its centre on the sphere at the eye's ground, which is in the band's
    // distances and inside the cone `cone` (radians) about `forward`.
    // Blocks are tested a superblock (SUPER x SUPER blocks) at a time first,
    // and listed again only once the eye has moved LIST_MOVE metres or turned
    // LIST_TURN, the cone widened by LIST_SLACK so what comes into view
    // meanwhile is already listed.
    const SUPER = 8, SUPERS = BLOCKS / SUPER;
    const SUPER_REACH = 0.7072 * SUPER * B * 1.4143 * SPACING + 30 + 250;
    const LIST_MOVE = 8, LIST_TURN = 2 * Math.PI / 180, LIST_SLACK = 3 * Math.PI / 180;
    const last = { eye: [NaN, 0, 0], forward: [0, 0, 0], field: -1 };
    const counts = [0, 0, 0];
    const r0 = bands.map((b) => b.band[0]), r1 = bands.map((b) => b.band[1]);
    function listBlocks(eye, altitude, forward, cone) {
        const ex = eye[0], ey = eye[1], ez = eye[2];
        const fx = forward[0], fy = forward[1], fz = forward[2];
        const mx = ex - last.eye[0], my = ey - last.eye[1], mz = ez - last.eye[2];
        const turn = fx * last.forward[0] + fy * last.forward[1] + fz * last.forward[2];
        if (last.field === front && mx * mx + my * my + mz * mz < LIST_MOVE * LIST_MOVE && turn > Math.cos(LIST_TURN)) return;
        last.eye = [ex, ey, ez];
        last.forward = [fx, fy, fz];
        last.field = front;
        const ground = Math.sqrt(ex * ex + ey * ey + ez * ez) - altitude;
        const wide = cone + LIST_SLACK;
        const cosCone = Math.cos(wide), sinCone = Math.sin(wide);
        // Whether a ball `reach` about a point r (d away) is in the distances
        // and the cone: the angle off forward under cone + asin(reach / d),
        // that is cos(off) above that sum's cosine, or always once it passes pi.
        const seen = (rx, ry, rz, d, reach) => {
            if (d - reach > FAR) return false;
            if (d <= reach) return true;
            const s = reach / d, c = Math.sqrt(1 - s * s);
            const cosSum = cosCone * c - sinCone * s;
            if (sinCone * c + cosCone * s < 0 && cosSum < 0) return true;
            return rx * fx + ry * fy + rz * fz >= cosSum * d;
        };
        counts[0] = counts[1] = counts[2] = 0;
        for (let sb = 0; sb < SUPERS * SUPERS; sb++) {
            const sx = sb % SUPERS, sy = (sb - sx) / SUPERS;
            const cb = ((sy * SUPER + SUPER / 2) * BLOCKS + sx * SUPER + SUPER / 2) * 3;
            const qx = centres[cb] * ground - ex, qy = centres[cb + 1] * ground - ey, qz = centres[cb + 2] * ground - ez;
            if (!seen(qx, qy, qz, Math.sqrt(qx * qx + qy * qy + qz * qz), SUPER_REACH)) continue;
            for (let j = 0; j < SUPER * SUPER; j++) {
                const bxi = sx * SUPER + j % SUPER, byi = sy * SUPER + (j - j % SUPER) / SUPER;
                const b = 3 * (byi * BLOCKS + bxi);
                const rx = centres[b] * ground - ex, ry = centres[b + 1] * ground - ey, rz = centres[b + 2] * ground - ez;
                const d = Math.sqrt(rx * rx + ry * ry + rz * rz);
                if (!seen(rx, ry, rz, d, BLOCK_REACH)) continue;
                for (let i = 0; i < 3; i++) {
                    if (d + BLOCK_REACH < r0[i] || d - BLOCK_REACH > r1[i]) continue;
                    const n = counts[i];
                    lists[i].found[n] = byi * BLOCKS + bxi;
                    lists[i].dist[n] = d;
                    counts[i] = n + 1;
                }
            }
        }
        // Nearest first, so the depth test turns away what they hide.
        for (let i = 0; i < lists.length; i++) {
            const l = lists[i], n = counts[i];
            const order = Array.from({ length: n }, (_, k) => k).sort((p, q) => l.dist[p] - l.dist[q]);
            for (let k = 0; k < n; k++) {
                const b = l.found[order[k]];
                l.blocks[2 * k] = b % BLOCKS - BLOCKS / 2;
                l.blocks[2 * k + 1] = (b - b % BLOCKS) / BLOCKS - BLOCKS / 2;
            }
            l.count = n;
            if (n) l.buffer.write(l.blocks.subarray(0, 2 * n));
            nodes[i].setInstanceCount(n);
        }
    }

    return {
        nodes,
        // How far off the trees are drawn (0: not at all), the last sixth of
        // it shrinking: beyond, the ground draws the forest's average.
        get far() { return shown ? FAR : 0; },
        // cone: the half-angle of the view's diagonal, radians.
        update(eye, altitude, toSun, camHi, camLo, forward, cone, time) {
            const visible = altitude < SHOWN_BELOW;
            if (visible !== shown) {
                shown = visible;
                if (!visible) for (const n of nodes) n.setInstanceCount(0);
            }
            if (!visible) return;
            if (production && production.advance()) production = null;
            plan(eye, toSun);
            // (None drawn until the first field is there.)
            if (!ready) return;
            listBlocks(eye, altitude, forward, cone);
            for (const n of nodes) {
                n.setShaderUniform('cam_hi', camHi);
                n.setShaderUniform('cam_lo', camLo);
                n.setShaderUniform('cam_fwd', forward);
                n.setShaderUniform('time', time);
                n.setShaderUniform('to_sun', toSun);
            }
        },
    };
}
