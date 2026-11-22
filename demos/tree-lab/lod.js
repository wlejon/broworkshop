// A forest of the lab's trees drawn as the grown trees themselves at every
// distance, each level of detail the same tree reduced for what a pixel
// holds where the level begins: its leaf cards L times larger and L^2 fewer
// (the crown's leaf area kept), its branches thinner than half a pixel
// dropped and the rest fewer sided. Every level carries the tree's vegetation records, so it sways
// in the wind and shades as foliage (bro.scene vegetation).
import { leafCard, scene } from "/app/lab.js";

// Where each level begins (m from the eye to the tree's crown) and what it is.
export const LEVELS = [
    { from: 0, L: 3, sides: 6 },
    { from: 40, L: 6, sides: 5 },
    { from: 100, L: 12, sides: 4 },
    { from: 250, L: 24, sides: 3 },
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

/**
 * A species' meshes at each level: [{ bark, leaves, tris, barkGeometry,
 * leavesGeometry }], the geometries shared by every tree drawn at that level
 * (scene.createGeometry: made and uploaded once). `sp` is { world, k (draw scale) }.
 */
export function speciesLevels(sp, levels = LEVELS) {
    return levels.map((lv) => {
        const kk = 1.5 * lv.L / sp.k;
        const leaves = sp.world.emitFoliageMesh(leafCard(kk, [1, 2]), { seed: 0x1eaf, perArea: 90 / (kk * kk) });
        // The branches at least half a pixel wide where the level begins.
        const bark = barkMesh(sp.world.emitBranchTubes({ minRadius: 0.25 * lv.from * PX / sp.k }), lv.sides);
        return { bark, leaves, tris: (bark.indices.length + leaves.indices.length) / 3,
            barkGeometry: scene.createGeometry(bark), leavesGeometry: scene.createGeometry(leaves) };
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
    const update = ([ex, ey, ez]) => {
        tris = 0;
        counts.fill(0);
        const dy2 = (ey - 10) * (ey - 10);
        for (let i = 0; i < trees.length; i++) {
            const t = trees[i], e = i * (nl + 1);
            const d2 = (t.x - ex) * (t.x - ex) + (t.z - ez) * (t.z - ez) + dy2;
            if (d2 >= edges[e + nl]) {
                // Past the band: no mesh (what draws it beyond takes over).
                if (nodes[i]) for (const n of nodes[i]) n.destroy();
                nodes[i] = null;
                shown[i] = -2;
                continue;
            }
            let li = 0;
            while (li + 1 < nl && d2 >= edges[e + li + 1]) li++;
            counts[li]++;
            tris += t.sp.levels[li].tris;
            if (shown[i] === li) continue;
            if (nodes[i]) for (const n of nodes[i]) n.destroy();
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
    return {
        update,
        follow(vp) { vp.onView((view) => { if (!cleared) update(view.position); }); },
        clear() {
            cleared = true;
            nodes.forEach((ns, i) => { for (const n of ns ?? []) n.destroy(); nodes[i] = null; shown[i] = -1; });
        },
        stats: () => ({ tris, counts: counts.slice(), swaps }),
    };
}
