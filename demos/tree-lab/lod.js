// A forest of the lab's trees drawn as the grown trees themselves at every
// distance, each level of detail the same tree reduced for what a pixel
// holds where the level begins: its leaf cards L times larger and L^2 fewer
// (times the share of the leaf area that covers as the finest level does:
// speciesLevels), its branches thinner than half a pixel
// dropped and the rest fewer sided. Every level carries the tree's vegetation records, so it sways
// in the wind and shades as foliage (bro.scene vegetation).
import { leafCard, scene, ground } from "/app/lab.js";

// Where each level begins (m from the eye to the tree's crown) and what it is.
export const LEVELS = [
    { from: 0, L: 3, sides: 6 },
    { from: 40, L: 6, sides: 5 },
    { from: 90, L: 12, sides: 4 },
    { from: 150, L: 24, sides: 3 },
];
// A pixel's angle at 1080 rows and a 50 degree view.
const PX = 2 * Math.tan(25 * Math.PI / 180) / 1080;
const BARK = { color: [0.2, 0.17, 0.14], metallic: 0, roughness: 0.9, vertexColorTint: false };
const LEAF = { color: [0.07, 0.13, 0.04], metallic: 0, roughness: 0.7, doubleSided: true, subsurface: 0.5, vertexColorTint: false };

// Bark as a mesh from emitBranchTubes' segments (from xyz, r0, to xyz, r1):
// an open tapered tube a segment, `sides` around, each vertex carrying its
// segment's whole-segment wood record (bro.scene vegetation: root, height;
// tip, -(1 + weightTo); base, weightFrom; 0, twig, limb, trunk), so it
// bends along the segment as the tubes do. (GPU-built tubes cost several
// times as much for the same wood.)
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
        const xl = Math.hypot(x[0], x[1], x[2]);
        x = [x[0] / xl, x[1] / xl, x[2] / xl];
        const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
        const rec = [V[r], V[r + 1], V[r + 2], V[r + 3], b[0], b[1], b[2], -(1 + V[r + 9]),
            a[0], a[1], a[2], V[r + 8], 0, V[r + 13], V[r + 14], V[r + 15]];
        for (let i = 0; i < sides; i++) {
            const t = (i / sides) * 2 * Math.PI, c = Math.cos(t), sn = Math.sin(t);
            const w = [x[0] * c + y[0] * sn, x[1] * c + y[1] * sn, x[2] * c + y[2] * sn];
            const va = (s * sides + i) * 2;
            // Each end ring cut on its joint's plane (the tangent there), so
            // a bend has no crack or overlap; the slide is capped at 0.45 of
            // the segment, as the GPU tubes do.
            const slide = (tan, r) => {
                if (!T) return 0;
                const dz = tan[0] * z[0] + tan[1] * z[1] + tan[2] * z[2];
                const dw = tan[0] * w[0] + tan[1] * w[1] + tan[2] * w[2];
                const sl = dz > 0.2 ? -r * dw / dz : 0;
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

// The leaves' coverage, for matching a level's to the finest's: white where
// a leaf is, in a debug view.
const COVER_HOOK = `
module hook;
import mesh;
import scene;
pub fn vertex(v: mesh::Vertex) -> mesh::Vertex { return v; }
pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
    var out = s;
    if (SCENE_DEBUG(lod_cover)) { out.debug = vec4<f32>(1.0, 1.0, 1.0, 1.0); }
    return out;
}`;
const COVER_DIRS = [[0, 10], [2.1, 40], [4.2, 75]];
const LIN = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });

// The share of the square around the crown its leaves cover, seen from each
// of COVER_DIRS by an orthographic camera (the ground hidden): each pixel's
// mask counts the share of it covered. `box` is [cx, cy, cz, R].
function leafCover(leaves, box, res = 768) {
    const groundWas = ground.visible;
    ground.visible = false;
    const n = scene.createMesh({ data: new Mesh({ positions: leaves.positions, normals: leaves.normals, indices: leaves.indices }),
        color: [1, 1, 1], doubleSided: true, vertexColorTint: false });
    n.setShader({ module: COVER_HOOK, file: 'lod_cover.bk' });
    scene.setDebugView('lod_cover');
    const [cx, cy, cz, R] = box;
    const out = COVER_DIRS.map(([az, elDeg]) => {
        const el = elDeg * Math.PI / 180, d = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
        scene.setCamera({ mode: 'orthographic', size: 2 * R, aspect: 1, near: 0.1, far: 8 * R,
            eye: [cx + 4 * R * d[0], cy + 4 * R * d[1], cz + 4 * R * d[2]], target: [cx, cy, cz], up: [0, 1, 0] });
        const px = scene.captureFrame(res, res).data;
        let s = 0;
        for (let i = 0; i < px.length; i += 4) s += LIN[Math.min(px[i], px[i + 1], px[i + 2])];
        return s / (px.length / 4);
    });
    scene.setDebugView(null);
    n.destroy();
    ground.visible = groundWas;
    return out;
}

// A coarse level from the finest one's cards (each `per` vertices, its
// indices consecutive): the cards grouped by a grid of cells sized to make
// `target` groups, each group drawn as one of its own cards (the one nearest
// its centre, so its orientation is one the crown has) scaled about its own
// centre to the group's area times `area` and moved to the group's centre.
// The crown keeps the finest level's clumps and gaps where they are, which
// cards scattered afresh do not.
function clusterLeaves(fine, per, target, area) {
    const P = fine.positions, N = fine.normals, U = fine.uvs, n = P.length / 3 / per;
    const cen = new Float64Array(n * 3), ar = new Float64Array(n);
    for (let c = 0; c < n; c++) {
        for (let v = 0; v < per; v++) for (let a = 0; a < 3; a++) cen[c * 3 + a] += P[(c * per + v) * 3 + a] / per;
        // The card's area: its triangles'.
        for (let t = 0; t < per - 2; t++) {
            const i0 = fine.indices[(c * (per - 2) + t) * 3] * 3, i1 = fine.indices[(c * (per - 2) + t) * 3 + 1] * 3, i2 = fine.indices[(c * (per - 2) + t) * 3 + 2] * 3;
            const e1 = [P[i1] - P[i0], P[i1 + 1] - P[i0 + 1], P[i1 + 2] - P[i0 + 2]], e2 = [P[i2] - P[i0], P[i2 + 1] - P[i0 + 1], P[i2 + 2] - P[i0 + 2]];
            ar[c] += 0.5 * Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
        }
    }
    const group = (size) => {
        const m = new Map();
        for (let c = 0; c < n; c++) {
            const k = `${Math.floor(cen[c * 3] / size)},${Math.floor(cen[c * 3 + 1] / size)},${Math.floor(cen[c * 3 + 2] / size)}`;
            let g = m.get(k); if (!g) m.set(k, g = []); g.push(c);
        }
        return m;
    };
    // The cell size giving about `target` groups (bisected in log space).
    let lo = 1e-3, hi = 100, groups = null;
    for (let it = 0; it < 30; it++) {
        const mid = Math.sqrt(lo * hi);
        groups = group(mid);
        if (groups.size > target) lo = mid; else hi = mid;
    }
    const out = { positions: [], normals: [], uvs: [], indices: [] };
    for (const g of groups.values()) {
        let A = 0; const gc = [0, 0, 0];
        for (const c of g) { A += ar[c]; for (let a = 0; a < 3; a++) gc[a] += cen[c * 3 + a] * ar[c]; }
        for (let a = 0; a < 3; a++) gc[a] /= A;
        let rep = g[0], best = Infinity;
        for (const c of g) { const d = (cen[c * 3] - gc[0]) ** 2 + (cen[c * 3 + 1] - gc[1]) ** 2 + (cen[c * 3 + 2] - gc[2]) ** 2; if (d < best) { best = d; rep = c; } }
        const sc = Math.sqrt(A * area / ar[rep]), base = out.positions.length / 3;
        for (let v = 0; v < per; v++) {
            const i = (rep * per + v) * 3;
            for (let a = 0; a < 3; a++) { out.positions.push(gc[a] + (P[i + a] - cen[rep * 3 + a]) * sc); out.normals.push(N[i + a]); }
            out.uvs.push(U[(rep * per + v) * 2], U[(rep * per + v) * 2 + 1]);
        }
        const i0 = rep * (per - 2) * 3;
        for (let t = 0; t < (per - 2) * 3; t++) out.indices.push(fine.indices[i0 + t] - rep * per + base);
    }
    return new Mesh({ positions: new Float32Array(out.positions), normals: new Float32Array(out.normals), uvs: new Float32Array(out.uvs), indices: new Uint32Array(out.indices) });
}

function boundsOf(m) {
    const P = m.positions, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], P[i + a]); hi[a] = Math.max(hi[a], P[i + a]); }
    const c = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2);
    return [...c, Math.max(...[0, 1, 2].map((a) => (hi[a] - lo[a]) / 2)) * Math.SQRT2];
}

/**
 * A species' meshes at each level: [{ bark, leaves, tris, area, barkGeometry,
 * leavesGeometry }], the geometries shared by every tree drawn at that level
 * (scene.createGeometry: made and uploaded once). `sp` is { world, k (draw scale) }.
 * A level is { from, L, sides } and optionally `area`, `minRadius` (m,
 * drawn: the thinnest branch kept, else half a pixel where it begins) and
 * `cluster`: its cards made from the finest level's, grouped (L0/L)^2 to a
 * card where they stand (clusterLeaves), rather than scattered afresh, so
 * its clumps and gaps are the finest level's; its `area` (default 1) then
 * scales each card, and is not measured.
 *
 * A level's cards hold the crown's leaf area times `area`. Left unset, it is
 * measured: L^2 fewer cards L times larger cover more of the crown than the
 * small leaves they stand for (a crown's leaves overlap less as cards than
 * as leaves, and fill the gaps between its clumps), so a coarse level would
 * hide more of what is behind the tree, and darken a forest seen from
 * afar. Each level's coverage is matched to the finest level's from three
 * directions, stepping the area by the overlap of independent cards
 * (cover = 1 - (1 - c1)^area, c1 its cover at full area) from each
 * measured cover, up to three times (some 0.8 s a species). How much a
 * level gives up differs by species: birch keeps 0.80, 0.58 and 0.43 of
 * its area at L6, L12 and L24, oak 0.97, 0.81 and 0.72. With the same
 * coverage the coarse levels still darken the picture 0-23% more than the
 * grown tree does (one tree at 170 m and 400 m, noon; the shadow off
 * changes none of it), so each covered pixel is darker.
 */
export function speciesLevels(sp, levels = LEVELS) {
    const emit = (lv, area) => {
        const kk = 1.5 * lv.L / sp.k;
        return sp.world.emitFoliageMesh(leafCard(kk, [1, 2]), { seed: 0x1eaf, perArea: area * 90 / (kk * kk) });
    };
    let ref = null, box = null, fine = null;
    return levels.map((lv, i) => {
        let area = lv.area ?? 1;
        // A clustered level: the finest level's cards grouped L^2/L0^2 to a
        // card (as many cards as scattering would make).
        let leaves = lv.cluster && fine ? clusterLeaves(fine, 6, Math.max(1, Math.round(fine.indices.length / 12 * (levels[0].L / lv.L) ** 2)), area) : emit(lv, area);
        if (i === 0) fine = leaves;
        if (i === 0) { box = boundsOf(leaves); if (lv.area === undefined && levels.length > 1) ref = leafCover(leaves, box); }
        else if (ref && lv.area === undefined && !lv.cluster) {
            // Fewer cards cover less than in proportion (they thin within
            // clumps that still overlap), so the overlap model's step is
            // taken from each measured cover in turn.
            for (let it = 0; it < 3; it++) {
                const c = leafCover(leaves, box);
                const per = ref.map((c0, d) => Math.log(1 - Math.min(c0, 0.98)) / Math.log(1 - Math.min(c[d], 0.98)));
                const next = Math.min(1, Math.max(0.1, area * per.reduce((a, b) => a + b, 0) / per.length));
                if (Math.abs(next - area) < 0.02) break;
                area = next;
                leaves = emit(lv, area);
            }
        }
        // The branches at least half a pixel wide where the level begins
        // (or `minRadius` m in radius, drawn, when the level sets one).
        const bark = barkMesh(sp.world.emitBranchTubes({ minRadius: (lv.minRadius ?? 0.25 * lv.from * PX) / sp.k }), lv.sides);
        return { bark, leaves, area, tris: (bark.indices.length + leaves.indices.length) / 3,
            barkGeometry: scene.createGeometry(bark), leavesGeometry: scene.createGeometry(leaves) };
    });
}

/**
 * Write `levels` (speciesLevels') for another app to draw:
 * `<dir>/<name>_L<L>_<bark|leaves>.bin` each, a mesh as little-endian words:
 * the vertex count, the index count, then the positions (3 floats a vertex),
 * the normals (3 floats a vertex), the indices (uint32), then, for a mesh
 * with them (the leaves: each card's own 0-1 square), the uvs (2 floats a
 * vertex), in the grown tree's metres.
 */
export function saveLevels(levels, dir, name, lvDefs = LEVELS) {
    const fs = require('fs');
    levels.forEach((lv, i) => {
        for (const part of ['bark', 'leaves']) {
            const m = lv[part], nv = m.positions.length / 3, ni = m.indices.length;
            const uvs = m.uvs?.length === nv * 2 ? m.uvs : null;
            const buf = new ArrayBuffer(8 + nv * 24 + ni * 4 + (uvs ? nv * 8 : 0));
            new Uint32Array(buf, 0, 2).set([nv, ni]);
            new Float32Array(buf, 8, nv * 3).set(m.positions);
            new Float32Array(buf, 8 + nv * 12, nv * 3).set(m.normals);
            new Uint32Array(buf, 8 + nv * 24, ni).set(m.indices);
            if (uvs) new Float32Array(buf, 8 + nv * 24 + ni * 4, nv * 2).set(uvs);
            fs.writeFileSync(`${dir}/${name}_L${lvDefs[i].L}_${part}.bin`, new Uint8Array(buf));
        }
    });
}

/**
 * Stand `trees` ({ sp (with .levels from speciesLevels), x, z, yaw, size, r })
 * as grown trees with distance LOD. Call `update(eye)` as the camera moves
 * (`follow(vp)` does it each frame). `until` (m, 0: none) ends the meshes:
 * each dithers out over [until, 1.35 until] from the eye (fadeOutDist), for
 * what draws the trees beyond to dither in over the same band. The levels
 * from `castFrom` up to (not including) `castUntil` cast shadows, the part
 * `castRange` names (bro.scene shadowRange: 'near' with a stand-in casting
 * 'far', so a level's swap redraws no cached shadow page).
 * Returns { update, follow, clear, stats } (stats: the triangles drawn, the
 * trees at each level, and the level swaps made so far).
 */
export function plantLod(trees, { levels = LEVELS, castFrom = 0, castUntil = Infinity, castRange = 'all', until = 0 } = {}) {
    const shown = new Array(trees.length).fill(-1), nodes = new Array(trees.length).fill(null);
    let tris = 0, cleared = false, swaps = 0;
    const counts = levels.map(() => 0);
    // Per tree, the squared distances from the eye (to its crown's centre
    // line, 10 m up) at which each level begins and the meshes end: a level
    // begins `from` m from the crown's edge.
    const nl = levels.length;
    const edges = new Float64Array(trees.length * (nl + 1));
    trees.forEach((t, i) => {
        for (let l = 1; l < nl; l++) edges[i * (nl + 1) + l] = (levels[l].from + t.r) ** 2;
        edges[i * (nl + 1) + nl] = until > 0 ? (1.35 * until + t.r) ** 2 : Infinity;
    });
    // With an end, the trees in grid cells (CELL m) so a pass looks only at
    // those within reach of it (its cost follows the trees near the eye,
    // not the forest's), and at those it left a mesh on.
    const CELL = 64;
    let rMax = 0;
    for (const t of trees) rMax = Math.max(rMax, t.r);
    const reach = until > 0 ? 1.35 * until + rMax : Infinity;
    const cells = new Map();
    const key = (cx, cz) => cx * 65536 + cz;
    trees.forEach((t, i) => {
        const k = key(Math.floor(t.x / CELL), Math.floor(t.z / CELL));
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(i);
    });
    const meshed = new Set();
    const seen = new Uint32Array(trees.length);
    let pass = 0;
    const visit = (i, ex, ez, dy2) => {
        seen[i] = pass;
        const t = trees[i], e = i * (nl + 1);
        const d2 = (t.x - ex) * (t.x - ex) + (t.z - ez) * (t.z - ez) + dy2;
        if (d2 >= edges[e + nl]) {
            // Past the band: no mesh (what draws it beyond takes over).
            if (nodes[i]) for (const n of nodes[i]) n.destroy();
            nodes[i] = null;
            meshed.delete(i);
            shown[i] = -2;
            return;
        }
        {
            let li = 0;
            while (li + 1 < nl && d2 >= edges[e + li + 1]) li++;
            counts[li]++;
            tris += t.sp.levels[li].tris;
            if (shown[i] === li) return;
            if (nodes[i]) for (const n of nodes[i]) n.destroy();
            meshed.add(i);
            swaps++;
            const lv = t.sp.levels[li], s = t.sp.k * t.size;
            const cast = li >= castFrom && li < castUntil;
            nodes[i] = [
                scene.createMesh(Object.assign({ geometry: lv.barkGeometry, castsShadow: cast, shadowRange: castRange, receivesShadow: true }, BARK)),
                scene.createMesh(Object.assign({ geometry: lv.leavesGeometry, castsShadow: cast, shadowRange: castRange, receivesShadow: true }, LEAF)),
            ].map((n) => {
                n.position = [t.x, 0, t.z];
                n.scale = [s, s, s];
                n.rotation = [0, t.yaw, 0];
                if (until > 0) n.fadeOutDist = until;
                return n;
            });
            shown[i] = li;
        }
    };
    const update = ([ex, ey, ez]) => {
        tris = 0;
        counts.fill(0);
        pass = (pass + 1) >>> 0 || 1;
        const dy2 = (ey - 10) * (ey - 10);
        if (!Number.isFinite(reach)) {
            for (let i = 0; i < trees.length; i++) visit(i, ex, ez, dy2);
        } else if (dy2 < reach * reach) {
            const span = Math.sqrt(reach * reach - dy2);
            const x0 = Math.floor((ex - span) / CELL), x1 = Math.floor((ex + span) / CELL);
            const z0 = Math.floor((ez - span) / CELL), z1 = Math.floor((ez + span) / CELL);
            for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
                const list = cells.get(key(cx, cz));
                if (list) for (const i of list) visit(i, ex, ez, dy2);
            }
        }
        // Those left with a mesh but out of reach now.
        for (const i of meshed) if (seen[i] !== pass) visit(i, ex, ez, dy2);
    };
    return {
        update,
        follow(vp) { vp.onView((view) => { if (!cleared) update(view.position); }); },
        clear() {
            cleared = true;
            nodes.forEach((ns, i) => { for (const n of ns ?? []) n.destroy(); nodes[i] = null; shown[i] = -1; });
            meshed.clear();
        },
        stats: () => ({ tris, counts: counts.slice(), swaps }),
    };
}
