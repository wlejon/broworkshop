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
 * A level is { from, L, sides } and optionally `area` and `minRadius` (m,
 * drawn: the thinnest branch kept, else half a pixel where it begins).
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
    let ref = null, box = null;
    return levels.map((lv, i) => {
        let area = lv.area ?? 1;
        let leaves = emit(lv, area);
        if (i === 0) { box = boundsOf(leaves); if (lv.area === undefined && levels.length > 1) ref = leafCover(leaves, box); }
        else if (ref && lv.area === undefined) {
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
 * the normals (3 floats a vertex) and the indices (uint32), in the grown
 * tree's metres.
 */
export function saveLevels(levels, dir, name, lvDefs = LEVELS) {
    const fs = require('fs');
    levels.forEach((lv, i) => {
        for (const part of ['bark', 'leaves']) {
            const m = lv[part], nv = m.positions.length / 3, ni = m.indices.length;
            const buf = new ArrayBuffer(8 + nv * 24 + ni * 4);
            new Uint32Array(buf, 0, 2).set([nv, ni]);
            new Float32Array(buf, 8, nv * 3).set(m.positions);
            new Float32Array(buf, 8 + nv * 12, nv * 3).set(m.normals);
            new Uint32Array(buf, 8 + nv * 24, ni).set(m.indices);
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
