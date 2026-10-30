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
import { cloudGlsl, faceFrame } from "/app/clouds.js";
import { createSunGrid } from "/app/sun.js";

const N = 512;             // sites along an edge
const B = 8;               // sites along a block's edge
const SNAP = 16;           // sites the eye moves before the field is produced again
const SLICES = 16;         // frames a field takes to produce
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
// shader draws it from them, and the ground (treeShadowGlsl) its shadow.
const treeCrownGlsl = `
    uint pcg(uint v) {
        uint s = v * 747796405u + 2891336453u;
        uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
        return (w >> 22u) ^ w;
    }
    float rnd(inout uint s) { s = pcg(s); return float(s) * (1.0 / 4294967296.0); }
    uint treeSeed(ivec2 world, float face) {
        return pcg(uint(world.x) * 73856093u ^ uint(world.y) * 19349663u ^ uint(face) * 83492791u);
    }
    // Its height, the crown's radius at its foot and the foot's height
    // (below it, the bare trunk), for a site of the given size.
    void treeCrown(inout uint seed, float size, out float H, out float R, out float foot) {
        H = size * mix(11.0, 24.0, rnd(seed));
        R = H * mix(0.17, 0.25, rnd(seed));
        foot = 0.08 * H;
    }`;

// The trees' shadows on the ground, for a node createTrees is given as a
// reader: treeShadow(p, eye, up, toSun) is the sun the crowns leave at p, the
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
export const treeShadowGlsl = `
    buffer float u_treeField[];
    uniform vec3 u_treeOHi;
    uniform vec3 u_treeOLo;
    uniform vec3 u_treeLattice;   // the field's site 0 on the world's lattice, and its face
    uniform vec3 u_treeA;         // the face's plane: axis and its two directions
    uniform vec3 u_treeE;
    uniform vec3 u_treeF;
    uniform vec3 u_treeUV;        // site 0 on the plane, and the plane's units a site; 0: no field
    ${treeCrownGlsl}
    float treeShadow(vec3 p, vec3 eye, vec3 up, vec3 toSun) {
        const int N = ${N};
        float mu = dot(toSun, up);
        if (mu <= 0.05 || u_treeUV.z <= 0.0) return 1.0;
        vec3 lh = toSun - up * mu;
        float lhl = length(lh);
        lh /= lhl;
        float tanE = mu / lhl;
        // p's site coordinates, and the sun's direction across the ground in
        // sites a metre (the gnomonic plane's derivative).
        vec3 P = u_treeOHi + (u_treeOLo + p);
        float r = length(P);
        vec3 q = P / r;
        float z = dot(q, u_treeA);
        vec2 uv = vec2(dot(q, u_treeE), dot(q, u_treeF)) / z;
        vec2 s = (uv - u_treeUV.xy) / u_treeUV.z;
        vec2 ds = (vec2(dot(lh, u_treeE), dot(lh, u_treeF)) - uv * dot(lh, u_treeA)) / (z * r * u_treeUV.z);
        float perMetre = length(ds);
        vec2 dn = ds / perMetre;
        ivec2 across = abs(dn.x) > abs(dn.y) ? ivec2(0, 1) : ivec2(1, 0);
        int steps = min(int(ceil(min(${MAX_TREE_H.toFixed(1)} / tanE, ${SHADOW_REACH.toFixed(1)}) * perMetre / 0.7)) + 2, ${SHADOW_STEPS});
        float vis = 1.0;
        for (int k = -1; k < steps; k++) {
            ivec2 n = ivec2(floor(s + dn * (0.7 * float(k)) + 0.5));
            for (int j = -1; j <= 1; j++) {
                ivec2 site = n + across * j;
                int edge = min(min(site.x, N - 1 - site.x), min(site.y, N - 1 - site.y));
                if (edge < 0) continue;
                int i = (site.y * N + site.x) * 7;
                vec3 c = vec3(u_treeField[i], u_treeField[i + 1], u_treeField[i + 2]);
                // Sized as the tree is drawn: shrinking into the ground over
                // the last sixth of its reach and at the field's edge.
                float size = u_treeField[i + 3] * smoothstep(0.0, 12.0, float(edge))
                           * smoothstep(${FAR.toFixed(1)}, ${(FAR * 5 / 6).toFixed(1)}, length(c - eye));
                if (size <= 0.0) continue;
                uint seed = treeSeed(site + ivec2(u_treeLattice.xy), u_treeLattice.z);
                float H, R, foot;
                treeCrown(seed, size, H, R, foot);
                vec3 w = c - p;
                float hb = dot(w, up);            // the tree's foot over p
                vec3 wh = w - up * hb;
                float a = dot(wh, lh);            // along the sun's path to the axis
                float e = length(wh - lh * a);    // and across it
                float kw = tanE * R / (H - foot);
                float t = kw < 1.0 ? a - e * kw * inversesqrt(1.0 - kw * kw) : -1.0e9;
                float tFoot = (foot + hb) / tanE, tTop = (H + hb) / tanE;
                t = clamp(t, max(tFoot, 0.0), tTop);
                if (tTop <= 0.0) continue;
                float height = t * tanE - hb;
                float rr = R * (H - height) / (H - foot);
                float dist = length(vec2(e, a - t));
                float pen = 0.2 * rr + 0.0093 * t + 0.1;
                vis = min(vis, 1.0 - 0.85 * smoothstep(rr + pen, rr - pen, dist));
            }
        }
        return vis;
    }`;

const BLOCKS = N / B;           // blocks along an edge
// How far a tree of a block can stand from the block's centre on the
// sphere at the eye's ground: half its diagonal (a site is at most 1.41
// SPACING), the tree, and the relief between.
const BLOCK_REACH = 0.7072 * B * 1.4143 * SPACING + 30 + 250;

const vertex = `buffer float u_field[];
    buffer float u_sun[];
    buffer int u_blocks[];
    uniform vec3 u_camHi;
    uniform vec3 u_camLo;
    uniform vec3 u_camFwd;
    uniform vec3 u_oHi;
    uniform vec3 u_oLo;
    uniform vec3 u_lattice;     // the field's site 0 on the world's lattice, and its face
    uniform vec2 u_sunLattice;  // the sun grid's point 0 on it
    uniform float u_time;
    uniform vec3 u_toSun;
    uniform vec2 u_band;        // the distances this node draws over
    uniform vec2 u_shape;       // tiers, rim vertices
    out vec3 v_col;
    out float v_ao;
    out float v_lit;
    out vec3 v_branch;   // a tier: the point about the trunk (tree frame xy) and how far out (z, 0 at the trunk); -1 none
    out float v_seed;
    ${treeCrownGlsl}
    float sunAt(vec2 f) {
        vec2 s = clamp(f / ${SUN_STRIDE}.0, vec2(0.0), vec2(${SUN_P - 1}.0 - 1e-3));
        ivec2 i = ivec2(s);
        vec2 t = s - vec2(i);
        int k = i.y * ${SUN_P} + i.x;
        return mix(mix(u_sun[k], u_sun[k + 1], t.x), mix(u_sun[k + ${SUN_P}], u_sun[k + ${SUN_P + 1}], t.x), t.y);
    }
    void userVertex(inout vec3 pos, inout vec3 normal, inout vec2 uv) {
        int tree = int(pos.x + 0.5);
        int part = int(floor(pos.y + 0.5));
        int corner = int(floor(pos.z + 0.5));
        ivec2 site = (ivec2(u_blocks[2 * gl_InstanceIndex], u_blocks[2 * gl_InstanceIndex + 1]) + ivec2(${N / B / 2})) * ${B}
                   + ivec2(tree % ${B}, tree / ${B});
        int k = (site.y * ${N} + site.x) * 7;
        vec3 base = vec3(u_field[k], u_field[k + 1], u_field[k + 2]);
        float size = u_field[k + 3];
        vec3 vary = vec3(u_field[k + 4], u_field[k + 5], u_field[k + 6]);
        vec3 rel = (u_oHi - u_camHi) + (u_oLo - u_camLo) + base;
        vec3 up = normalize(u_oHi + (u_oLo + base));
        float d = length(rel);

        // This node's band, the field's edge and FAR: the trees beyond
        // shrink into the ground. None behind the eye.
        int edge = min(min(site.x, ${N - 1} - site.x), min(site.y, ${N - 1} - site.y));
        size *= step(u_band.x, d) * step(d, u_band.y) * smoothstep(${FAR.toFixed(1)}, ${(FAR * 5 / 6).toFixed(1)}, d)
              * smoothstep(0.0, 12.0, float(edge)) * step(-40.0, dot(rel, u_camFwd));

        uint seed = treeSeed(site + ivec2(u_lattice.xy), u_lattice.z);
        float H, R, foot;
        treeCrown(seed, size, H, R, foot);
        float phi = 6.2831853 * rnd(seed);
        vec3 tx = normalize(cross(up, abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
        vec3 ty = cross(up, tx);
        // Its needles: dark, a little bluer or yellower tree to tree, as the
        // ground's colour varies.
        vec3 needles = vec3(0.034, 0.062, 0.028) * vary * exp(vec3(0.3, 0.2, 0.35) * (rnd(seed) - 0.5));
        // A breeze leans the crown, more toward its top.
        vec3 w = mod(u_oHi, 256.0) + mod(u_oLo, 256.0) + base;
        float gust = 0.5 + 0.5 * sin(u_time * 0.9 - dot(w, tx) * 0.05 + 0.7 * sin(dot(w, ty) * 0.03 + u_time * 0.3));
        vec3 lean = tx * (0.004 + 0.012 * gust) * H;

        vec3 p;
        vec3 n;
        float ao = 1.0;
        vec3 col = needles;
        vec3 branch = vec3(0.0, 0.0, -1.0);
        if (part >= 0) {
            float tiers = u_shape.x, rim = u_shape.y;
            float kt = float(part);
            float step1 = (H - foot) / tiers;
            float top = foot + (kt + 1.0) * step1;
            // Each tier's rim droops below the next tier's top, so they overlap.
            float low = max(top - 1.6 * step1, foot * 0.5);
            float spin = 6.2831853 * fract(phi + kt * 0.618);
            uint ts = seed ^ uint(part * 7919 + corner * 104729);
            if (corner < 0) {
                p = up * top;
                n = up;
                ao = 0.45;
                branch = vec3(0.0);
            } else {
                // Long and short branches in turn: a ragged skirt.
                float shortOne = float(corner % 2) * step(2.5, rim);
                float a = spin + 6.2831853 * (float(corner) + 0.3 * (rnd(ts) - 0.5)) / rim;
                vec3 radial = tx * cos(a) + ty * sin(a);
                float rimLow = low + shortOne * 0.3 * step1;
                float r = (R * (1.0 - (rimLow - foot) / (H - foot)) * mix(0.8, 1.2, rnd(ts)) + 0.15)
                        * mix(1.0, 0.72, shortOne);
                p = up * rimLow + radial * r;
                n = normalize(radial * 0.8 + up * 0.6);
                col *= 1.15;
                branch = vec3(dot(radial, tx) * r, dot(radial, ty) * r, 1.0);
            }
            // The crown shades its own lower tiers.
            ao *= mix(0.6, 1.0, (kt + 1.0) / tiers);
        } else if (part == -1) {
            float a = phi + 2.0943951 * float(corner);
            vec3 radial = tx * cos(a) + ty * sin(a);
            p = corner < 0 ? up * 0.4 * H : radial * 0.035 * H;
            n = corner < 0 ? up : radial;
            col = vec3(0.10, 0.07, 0.05);
            ao = 0.4;
        } else {
            // The silhouette: a cone's outline facing the eye, lit as the cone.
            vec3 side = normalize(cross(up, rel));
            vec3 toEye = -normalize(rel);
            if (corner == 2) {
                p = up * H;
                n = normalize(up + toEye * 0.4);
            } else {
                float s = corner == 0 ? -1.0 : 1.0;
                p = up * foot + side * s * R * 1.05;
                n = normalize(side * s * 0.7 + toEye * 0.5 + up * 0.5);
                ao = 0.6;
            }
        }
        float hgt = dot(p, up);
        p += lean * (hgt / max(H, 1e-3)) * (hgt / max(H, 1e-3));
        if (size <= 0.0) p = vec3(0.0);
        pos = rel + p;
        normal = n;
        v_col = col;
        v_ao = ao;
        v_lit = sunAt(vec2(site) + vec2(0.5) + (u_lattice.xy - u_sunLattice));
        // The neighbours' crowns between this point and the sun: the gap
        // probability of a canopy of their cover (the share of the 8 sites
        // about it holding a tree, times the share a crown hides from above,
        // app.js TREE_CROWNS) over the depth of canopy above the point, along
        // the sun's slant (Nilson 1971, as the ground's crowns from afar).
        float around = 0.0;
        for (int j = -1; j <= 1; j++)
            for (int i = -1; i <= 1; i++) {
                ivec2 o = clamp(site + ivec2(i, j), ivec2(0), ivec2(${N - 1}));
                around += (i != 0 || j != 0) && u_field[(o.y * ${N} + o.x) * 7 + 3] > 0.0 ? 1.0 : 0.0;
            }
        float canopy = clamp((H - hgt) / max(H - foot, 1e-3), 0.0, 1.0);
        v_lit *= pow(1.0 - 0.55 * around / 8.0, canopy / max(dot(u_toSun, up), 0.05));
        v_branch = branch;
        v_seed = rnd(seed);
    }`;

const fragment = (radius, ragged) => `in vec3 v_col;
    in float v_ao;
    in float v_lit;
    in vec3 v_branch;
    in float v_seed;
    uniform vec3 u_camHi;
    uniform vec3 u_camLo;
    ${cloudGlsl(radius)}
    // userFragment to userLight: 1 on a tier's underside, which the sun reaches
    // only through the needles above it (15%) and the sky through about the
    // gaps below the tier (40%).
    float g_under = 0.0;
    void userFragment(inout vec3 baseColor, inout vec3 normal, inout float metallic,
                      inout float roughness, inout vec3 emissive, inout float alpha) {
        // A tier is branches radiating from the trunk, needled fingers
        // narrowing out to the rim with the dark of the crown between them;
        // where they are finer than a pixel, their average.
        float shade = 1.0;
        if (v_branch.z >= 0.0) {
            float nb = 9.0 + floor(v_seed * 6.0);
            float a = atan(v_branch.y, v_branch.x) * (nb / 6.2831853) + v_seed * 17.0 + 0.8 * v_branch.z;
            float off = abs(fract(a) - 0.5);
            float width = mix(0.46, 0.27, v_branch.z);
            float fw = fwidth(a);
            float inBranch = 1.0 - smoothstep(width - 0.06 - fw, width + fw, off);
            // Out toward the rim the gaps between fingers are open, each
            // finger reaching its own way out and narrowing to its tip, so a
            // tier's edge is ragged rather than a polygon's; where the
            // fingers are finer than a pixel, the edge is their average
            // instead. Only the near trees' fingers are that large, and
            // only their pass gives up the early depth test a discard costs.
            ${ragged ? `float reach = 0.6 + 0.3 * fract(sin(floor(a) * 12.9898 + v_seed * 78.233) * 43758.5453);
            float tip = (width + 0.04) * (1.0 - 0.75 * smoothstep(reach, 1.0, v_branch.z));
            if (fw < 0.25 && v_branch.z > reach && off > tip) discard;` : ''}
            float cover = mix(2.0 * width, inBranch, smoothstep(0.6, 0.25, fw));
            shade = mix(0.3, 1.0, cover);
            // Each finger is needled twigs: across and along it, a grain
            // that averages out where it is finer than a pixel.
            vec2 g = vec2(a * 7.0, v_branch.z * 38.0);
            vec2 gc = floor(g), gf = g - gc;
            gf = gf * gf * (3.0 - 2.0 * gf);
            float s0 = v_seed * 31.0;
            float twig = mix(mix(fract(sin(dot(gc, vec2(12.9898, 78.233)) + s0) * 43758.5453),
                                 fract(sin(dot(gc + vec2(1.0, 0.0), vec2(12.9898, 78.233)) + s0) * 43758.5453), gf.x),
                             mix(fract(sin(dot(gc + vec2(0.0, 1.0), vec2(12.9898, 78.233)) + s0) * 43758.5453),
                                 fract(sin(dot(gc + vec2(1.0, 1.0), vec2(12.9898, 78.233)) + s0) * 43758.5453), gf.x), gf.y);
            float gw = max(fwidth(g.x), fwidth(g.y));
            shade *= mix(1.0, mix(0.72, 1.12, twig), inBranch * smoothstep(0.5, 0.15, gw));
            // The fingers' edges turn from the sun: rounded, not painted.
            float across = (fract(a) - 0.5) / width;
            shade *= mix(1.0, 1.0 - 0.35 * across * across, inBranch * smoothstep(0.6, 0.25, fw));
        }
        baseColor = v_col * shade;
        // Both faces of a drooping tier take its outer side's normal; but
        // the face seen from below it is its underside, inside the crown:
        // where the face itself, turned to the eye, faces down.
        vec3 upv = normalize((u_camHi + u_camLo) + vWorldPos);
        if (dot(normal, upv) < 0.0) normal = -normal;
        vec3 face = cross(dFdx(vWorldPos), dFdy(vWorldPos));
        if (dot(face, vWorldPos) > 0.0) face = -face;
        g_under = v_branch.z >= 0.0 && dot(face, upv) < 0.0 ? 1.0 : 0.0;
        metallic = 0.0;
        roughness = 0.85;
    }
    // The terrain's shadow from the sun grid, the clouds' as the ground's,
    // and the crown's own: inside and below, its branches hide the sun and
    // the sky.
    void userLight(vec3 toSun, inout float sunVisibility, inout float skyVisibility, inout vec3 skyNormal,
                   inout float occluderSun) {
        vec3 g = (u_camHi + u_camLo) + vWorldPos;
        float h = length(g) - CLOUD_R;
        vec3 up = normalize(g);
        float w = max(length(dFdx(vWorldPos)), length(dFdy(vWorldPos)));
        float clouds = cloudShadow(g, h, toSun, w);
        sunVisibility *= v_lit * clouds * mix(0.35, 1.0, v_ao) * mix(1.0, 0.15, g_under);
        skyVisibility *= v_ao * cloudShadow(g, h, up, w) * mix(1.0, 0.4, g_under);
        occluderSun *= clouds * 0.5;
    }`;

// The trees in `scene`, their field produced by `module` (trees.bk
// k_tree_field) and their sun grid by `sunModule` (sun.bk) at `octaves` of
// the ground's. Their nodes read the clouds' field (createClouds' readers);
// `readers` are nodes whose chunks include treeShadowGlsl, bound to theirs.
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
        const node = scene.createInstancedMesh({ mesh: treeBlock(tiers, rim, trunk), color: [1, 1, 1],
                                                 castsShadow: false, receivesShadow: false, doubleSided: true });
        node.setShader({ vertex, fragment: fragment(radius, ragged) });
        node.cullMargin = 4 * radius;   // the shader places the trees
        node.drawOrder = 4;             // before the grass and the ground they hide
        node.setShaderBuffer('u_field', fields[0]);
        node.setShaderBuffer('u_sun', sunGrid.buffer);
        lists[i].buffer = bro.kernel.createBuffer(lists[i].blocks.byteLength);
        node.setShaderBuffer('u_blocks', lists[i].buffer);
        node.setShaderUniform('u_band', band);
        node.setShaderUniform('u_shape', [tiers, rim]);
        node.setInstanceCount(0);
        return node;
    });
    // The front field's block centres: unit directions, three a block.
    const centres = new Float64Array(3 * BLOCKS * BLOCKS);

    // The field shown (front) and the one being produced; the jobs left of
    // a production, one run a frame.
    let front = 0, shown = false, ready = false;
    let face = -1, delta = 0, ui = NaN, vi = NaN;
    let jobs = [];
    const sun = [0, 0, 0];

    function faceOf(eye) {
        const m = eye.map(Math.abs);
        const best = m[0] >= m[1] && m[0] >= m[2] ? 0 : (m[1] >= m[2] ? 1 : 2);
        if (face >= 0 && m[face % 3] * 1.05 >= m[best] && Math.sign(eye[face % 3]) === (face < 3 ? 1 : -1)) return face;
        return best + (eye[best] < 0 ? 3 : 0);
    }

    function sunJobs(plane, u0, v0, dl, toSun, lattice) {
        sun.splice(0, 3, ...toSun);
        const out = sunGrid.jobs(plane, u0, v0, dl * SUN_STRIDE, toSun, radius, octaves, seed);
        const last = out.pop();
        out.push(() => {
            last();
            for (const n of nodes) n.setShaderUniform('u_sunLattice', lattice);
        });
        return out;
    }

    let current = null;   // the production in hand: its plane, origin, lattice
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
        if (jumped || nu !== ui || nv !== vi) {
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
            jobs = [];
            for (let s = 0; s < SLICES; s++) {
                const y0 = s * N / SLICES;
                jobs.push(() => fieldKernel.dispatch([N, N / SLICES], out, ...plane, u0, v0, dl, ...origin,
                                                     radius, octaves, seed, li, lj, fc, y0, net));
            }
            jobs.push(() => {
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
                    n.setShaderBuffer('u_field', fields[front]);
                    n.setShaderUniform('u_oHi', hi);
                    n.setShaderUniform('u_oLo', lo);
                    n.setShaderUniform('u_lattice', [li, lj, fc]);
                }
                for (const n of readers) {
                    n.setShaderBuffer('u_treeField', fields[front]);
                    n.setShaderUniform('u_treeOHi', hi);
                    n.setShaderUniform('u_treeOLo', lo);
                    n.setShaderUniform('u_treeLattice', [li, lj, fc]);
                    n.setShaderUniform('u_treeA', frame.a);
                    n.setShaderUniform('u_treeE', frame.e);
                    n.setShaderUniform('u_treeF', frame.f);
                    n.setShaderUniform('u_treeUV', [u0, v0, dl]);
                }
                ready = true;
            });
            jobs.push(...sunJobs(plane, u0, v0, dl, toSun, [li, lj]));
            current = { plane, u0, v0, dl, li, lj };
            // A field from another face or spacing means nothing here: all
            // of the new one at once.
            if (jumped || !ready) while (jobs.length) jobs.shift()();
            return;
        }
        const turned = sun[0] * toSun[0] + sun[1] * toSun[1] + sun[2] * toSun[2] < 0.999999;
        if (turned && jobs.length === 0 && current)
            jobs = sunJobs(current.plane, current.u0, current.v0, current.dl, toSun, [current.li, current.lj]);
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
            const show = altitude < SHOWN_BELOW;
            if (show !== shown) {
                shown = show;
                if (!show) for (const n of nodes) n.setInstanceCount(0);
            }
            if (!show) return;
            plan(eye, toSun);
            if (jobs.length) jobs.shift()();
            listBlocks(eye, altitude, forward, cone);
            for (const n of nodes) {
                n.setShaderUniform('u_camHi', camHi);
                n.setShaderUniform('u_camLo', camLo);
                n.setShaderUniform('u_camFwd', forward);
                n.setShaderUniform('u_time', time);
                n.setShaderUniform('u_toSun', toSun);
            }
        },
    };
}
