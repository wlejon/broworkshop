// lib/city/trees.js — the city's trees: street trees along the sidewalks of
// every block but the industrial ones, and groves in the parks, drawn as
// tree-lab's grown species (demos/metropolis/assets/trees, exported by
// tools/export_trees.js) at levels of detail that hand over pixel for pixel
// (fadeOutDist / fadeInDist), so a tree never pops from one to the next.
//
// placeTrees(city, { seed }) -> Float32Array, TREE_FLOATS a tree:
//   x, y (ground), z, yaw, size (times the species' mature height), species index
// createTrees(scene, trees, dir) -> { nodes, count }

import { SEG_FLOATS } from "./ground.js";

export const TREE_FLOATS = 6;
export const SPECIES = ['elm', 'oak', 'beech', 'birch'];
// Street trees (by zone): the species' shares and the spacing along the kerb.
const STREET = { elm: 0.45, beech: 0.2, oak: 0.15, birch: 0.2 };
const PARK = { oak: 0.35, beech: 0.25, elm: 0.15, birch: 0.25 };
const SPACING = { urban: 11, mixed: 11, tower: 12, rowhouse: 12, house: 14, park: 10 };

function mulberry32(a) {
    return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function placeTrees(city, opts = {}) {
    const { graph, graded, field } = city;
    const rand = mulberry32(opts.seed ?? 0x7ee5);
    const pick = (shares) => {
        let r = rand();
        for (const [name, w] of Object.entries(shares)) { r -= w; if (r <= 0) return SPECIES.indexOf(name); }
        return 0;
    };
    const out = [];
    const wet = (x, z) => field.water && field.water(x, z) < 6;
    // Within `margin` of any carriageway (another road at a corner, a close
    // parallel street): by the ground's road cells.
    const G = city.ground, S = G.segs, { half, cell, cells } = G.info;
    const onRoad = (x, z, margin) => {
        const ci = Math.floor((x + half) / cell), cj = Math.floor((z + half) / cell);
        if (ci < 0 || cj < 0 || ci >= cells || cj >= cells) return false;
        const c = cj * cells + ci;
        for (let k = G.cellStart[c]; k < G.cellStart[c + 1]; k++) {
            const o = G.cellSegs[k] * SEG_FLOATS;
            const ax = S[o], az = S[o + 1], dx = S[o + 2] - ax, dz = S[o + 3] - az;
            const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9)));
            if (Math.hypot(x - ax - dx * t, z - az - dz * t) < S[o + 6] + margin) return true;
        }
        return false;
    };
    // Street trees: along each block's kerbs, on its side of the road.
    for (const f of graph.faces) {
        const zone = f.park ? 'park' : f.zone;
        const step = SPACING[zone];
        if (!step) continue;
        for (const [ei, dir] of f.halfEdges) {
            const e = graph.edges[ei];
            if (e.kind === 'bridge' || e.walkW < 2.4) continue;
            const p = e.pts, m = p.length / 2;
            // Arc lengths along the edge, travelled the half-edge's way.
            const pts = [];
            for (let k = 0; k < m; k++) { const j = dir ? m - 1 - k : k; pts.push(p[2 * j], p[2 * j + 1]); }
            let total = 0;
            const cum = [0];
            for (let k = 1; k < m; k++) { total += Math.hypot(pts[2 * k] - pts[2 * k - 2], pts[2 * k + 1] - pts[2 * k - 1]); cum.push(total); }
            const clear = 14;
            if (total < 2 * clear + 4) continue;
            const off = e.halfW + Math.min(1.3, e.walkW * 0.4);
            const n = Math.floor((total - 2 * clear) / step);
            const s0 = clear + (total - 2 * clear - n * step) / 2;
            let k = 1;
            for (let i = 0; i <= n; i++) {
                const s = s0 + i * step;
                if (rand() < 0.12) continue;   // a gap: a driveway, a lamp, a missing tree
                while (k < m - 1 && cum[k] < s) k++;
                const t = (s - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
                const ax = pts[2 * k - 2], az = pts[2 * k - 1], bx = pts[2 * k], bz = pts[2 * k + 1];
                let tx = bx - ax, tz = bz - az;
                const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
                // The face is on the left of travel (CCW faces): left is (-tz, tx).
                const x = ax + (bx - ax) * t - tz * off, z = az + (bz - az) * t + tx * off;
                if (wet(x, z) || onRoad(x, z, 1.0)) continue;
                out.push(x, graded(x, z) + 0.15, z, rand() * Math.PI * 2, 0.48 + rand() * 0.16, pick(STREET));
            }
        }
    }
    // Park groves: darts in each park block, clear of its kerbs, thinned in
    // broad patches so lawns open between the groves.
    for (const f of graph.faces) {
        if (!f.park) continue;
        const P = f.poly, n = P.length / 2;
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let k = 0; k < n; k++) { x0 = Math.min(x0, P[2 * k]); x1 = Math.max(x1, P[2 * k]); z0 = Math.min(z0, P[2 * k + 1]); z1 = Math.max(z1, P[2 * k + 1]); }
        const inside = (x, z) => {
            let c = false;
            for (let k = 0, l = n - 1; k < n; l = k++) {
                const za = P[2 * l + 1], zb = P[2 * k + 1];
                if ((za > z) !== (zb > z) && x < P[2 * l] + (z - za) / (zb - za) * (P[2 * k] - P[2 * l])) c = !c;
            }
            return c;
        };
        const edgeDist = (x, z) => {
            let d = Infinity;
            for (let k = 0, l = n - 1; k < n; l = k++) {
                const ax = P[2 * l], az = P[2 * l + 1], dx = P[2 * k] - ax, dz = P[2 * k + 1] - az;
                const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
                d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t));
            }
            return d;
        };
        const placed = [];
        const tries = Math.min(20000, Math.round(f.area / 25));
        const gx = rand() * 1000, gz = rand() * 1000;
        for (let i = 0; i < tries; i++) {
            const x = x0 + rand() * (x1 - x0), z = z0 + rand() * (z1 - z0);
            if (!inside(x, z) || edgeDist(x, z) < 22) continue;
            // Groves and lawns: a smooth patch pattern (two crossed waves).
            const g = Math.sin((x + gx) / 37) * Math.sin((z + gz) / 43) + 0.5 * Math.sin((x - z + gx) / 23);
            if (g < 0.45) continue;
            const size = 0.62 + rand() * 0.38;
            const r = 5.5 * size;
            if (placed.some(([px, pz, pr]) => Math.hypot(px - x, pz - z) < 0.95 * (r + pr))) continue;
            if (wet(x, z) || onRoad(x, z, 3)) continue;
            placed.push([x, z, r]);
            out.push(x, graded(x, z), z, rand() * Math.PI * 2, size, pick(PARK));
        }
    }
    return new Float32Array(out);
}

// A level's mesh as tree-lab's saveLevels wrote it.
function loadMesh(path) {
    const b = require('fs').readFileSync(path);
    const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    const [nv, ni] = new Uint32Array(buf, 0, 2);
    const positions = new Float32Array(buf, 8, nv * 3);
    const normals = new Float32Array(buf, 8 + nv * 12, nv * 3);
    const indices = new Uint32Array(buf, 8 + nv * 24, ni);
    const rest = 8 + nv * 24 + ni * 4;
    const uvs = buf.byteLength >= rest + nv * 8 ? new Float32Array(buf, rest, nv * 2) : undefined;
    return new bro.mesh.Mesh(Object.assign({ positions, normals, indices }, uvs ? { uvs } : {}));
}

const BARK = { color: [0.2, 0.17, 0.14], metallic: 0, roughness: 0.9, vertexColorTint: false };
const LEAF = { color: [0.13, 0.22, 0.07], metallic: 0, roughness: 0.7, doubleSided: true, subsurface: 0.5, vertexColorTint: false };

/**
 * Draw `trees` (placeTrees') from the levels in `dir`: per species and
 * level an instanced bark and leaves node holding every tree of the species,
 * the level drawn from where it begins (fadeInDist) to where the next does
 * (fadeOutDist, the two dithered over the same band), its instances culled
 * past that (setInstanceCullSpheres). One coarse level per species casts
 * every tree's shadow (shadowOnly), so a level's handover never moves a
 * shadow and the still trees' shadow pages stay cached.
 */
export function createTrees(scene, trees, dir) {
    const meta = JSON.parse(require('fs').readFileSync(`${dir}/trees.json`, 'utf8'));
    const levels = meta.levels;
    const nodes = [];
    const count = trees.length / TREE_FLOATS;
    SPECIES.forEach((name, si) => {
        const sp = meta.species[name];
        if (!sp) return;
        const rows = [], spheres = [];
        for (let i = 0; i < count; i++) {
            const o = i * TREE_FLOATS;
            if (trees[o + 5] !== si) continue;
            const x = trees[o], y = trees[o + 1], z = trees[o + 2], yaw = trees[o + 3];
            const s = sp.k * trees[o + 4];
            const c = Math.cos(yaw) * s, sn = Math.sin(yaw) * s;
            // A tone a tree: leaves a little lighter or darker, yellower or bluer.
            const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453, u = h - Math.floor(h);
            const tone = 0.82 + 0.36 * u;
            rows.push(c, 0, sn, x, 0, s, 0, y, -sn, 0, c, z, tone * (1.04 - 0.08 * u), tone, tone * (0.92 + 0.12 * u), 1);
            const H = sp.height * s;
            spheres.push(x, y + H * 0.55, z, Math.max(H * 0.6, sp.crownW * s * 0.5));
        }
        if (!rows.length) return;
        const inst = new Float32Array(rows);
        const sph = bro.kernel.createBuffer(new Float32Array(spheres));
        const n = inst.length / 16;
        const make = (lv, part, extra) => {
            const node = scene.createInstancedMesh(Object.assign({
                name: `city_trees_${name}_L${lv.L}_${part}`,
                mesh: loadMesh(`${dir}/${name}_L${lv.L}_${part}.bin`),
                capacity: n, instances: inst, receivesShadow: true, castsShadow: false,
            }, part === 'bark' ? BARK : LEAF, extra));
            node.setCullBounds([-20000, -1000, -20000], [20000, 2000, 20000]);
            nodes.push(node);
            return node;
        };
        levels.forEach((lv, li) => {
            const next = levels[li + 1];
            for (const part of ['bark', 'leaves']) {
                const node = make(lv, part, {});
                if (li > 0) node.fadeInDist = lv.from;
                if (next) node.fadeOutDist = next.from;
                // Instances wholly past the level's fade band are culled; the
                // last level thins out over the far distance.
                // Instances wholly nearer than the level's fade-in are culled too.
                const minDistance = li > 0 ? lv.from : 0;
                node.setInstanceCullSpheres(sph, next ? { maxDistance: next.from * 1.35 + 20, minDistance } : { maxDistance: 2200, fade: 0.5, minDistance });
            }
        });
        // The shadow: the L24 level, every tree within 900 m of the eye.
        const sh = levels.find((l) => l.L === 24) ?? levels[levels.length - 1];
        for (const part of ['bark', 'leaves']) {
            const node = make(sh, part, { castsShadow: true, shadowOnly: true });
            node.setInstanceCullSpheres(sph, { maxDistance: 900, fade: 0.3 });
        }
    });
    return { nodes, count };
}
