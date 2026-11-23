// lib/city/ground.js — what the ground needs to know about the city, packed
// for the GPU: the roads as segments in a cell index (the terrain kernel
// grades the ground to them, the ground shader paints them), and the blocks'
// surfaces on a grid (paved, yard, park, industrial yard).
//
// packGround(graph, opts) -> {
//   segs: Float32Array, SEG_FLOATS a segment:
//     0: x0, z0, x1, z1
//     1: y0, y1, halfW (carriageway), walkW (sidewalk)
//     2: s0 (arc length of the edge at the segment's start), edge length,
//        level (0 major, 1 street), flags (1: start is a junction, 2: end is)
//   cellStart: Int32Array (cells^2 + 1), cellSegs: Int32Array: the segments
//     within reach of each CELL-metre cell (CSR), row-major from (-half, -half);
//   surf: Uint32Array, four 8-bit codes a word, SURF-metre cells:
//     0 open land, 1 paved (urban / tower blocks), 2 yards (houses, rowhouses),
//     3 park, 4 industrial yard;
//   info: { half, cell, cells, surfCell, surfCells, segCount, reach } }
// Bridges are left out: their decks are meshes over the water, not ground.

export const SEG_FLOATS = 12;
export const CELL = 32;
export const SURF = 8;
/** How far past its sidewalk a road still pulls the ground to its grade. */
export const REACH = 14;

export const SURFACE = { open: 0, paved: 1, yard: 2, park: 3, industrial: 4 };
const ZONE_SURFACE = { tower: 1, urban: 1, mixed: 1, rowhouse: 2, house: 2, industrial: 4 };

export function packGround(graph, opts = {}) {
    const half = opts.half;
    const cells = Math.ceil((2 * half) / CELL);
    const segs = [];
    const degree = graph.nodes.map((n) => n.edges.length);
    for (const e of graph.edges) {
        if (e.kind === 'bridge') continue;
        const p = e.pts, ys = e.ys, m = p.length / 2;
        let s = 0;
        const fa = degree[e.a] > 2 ? 1 : 0, fb = degree[e.b] > 2 ? 2 : 0;
        for (let k = 0; k + 1 < m; k++) {
            const x0 = p[2 * k], z0 = p[2 * k + 1], x1 = p[2 * k + 2], z1 = p[2 * k + 3];
            segs.push(x0, z0, x1, z1, ys[k], ys[k + 1], e.halfW, e.walkW, s, e.len, e.level, fa | fb);
            s += Math.hypot(x1 - x0, z1 - z0);
        }
    }
    const segCount = segs.length / SEG_FLOATS;
    const segF = new Float32Array(segs);

    // Cell lists: a segment goes in every cell its padded box touches.
    const counts = new Int32Array(cells * cells + 1);
    const each = (fn) => {
        for (let i = 0; i < segCount; i++) {
            const o = i * SEG_FLOATS;
            const pad = segF[o + 6] + segF[o + 7] + REACH;
            const i0 = Math.max(0, Math.floor((Math.min(segF[o], segF[o + 2]) - pad + half) / CELL));
            const i1 = Math.min(cells - 1, Math.floor((Math.max(segF[o], segF[o + 2]) + pad + half) / CELL));
            const j0 = Math.max(0, Math.floor((Math.min(segF[o + 1], segF[o + 3]) - pad + half) / CELL));
            const j1 = Math.min(cells - 1, Math.floor((Math.max(segF[o + 1], segF[o + 3]) + pad + half) / CELL));
            // Only cells the padded segment really reaches (a long diagonal's box is mostly empty).
            const ax = segF[o], az = segF[o + 1], bx = segF[o + 2], bz = segF[o + 3];
            const r = pad + CELL * 0.7072;
            for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
                const cx = -half + (ii + 0.5) * CELL, cz = -half + (j + 0.5) * CELL;
                const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
                const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / l2));
                const ex = cx - ax - dx * t, ez = cz - az - dz * t;
                if (ex * ex + ez * ez <= r * r) fn(j * cells + ii, i);
            }
        }
    };
    each((c) => { counts[c + 1]++; });
    for (let c = 0; c < cells * cells; c++) counts[c + 1] += counts[c];
    const cellSegs = new Int32Array(counts[cells * cells]);
    const fill = counts.slice(0, cells * cells);
    each((c, i) => { cellSegs[fill[c]++] = i; });

    // Block surfaces: each face's polygon scan-filled at SURF metres.
    const surfCells = Math.ceil((2 * half) / SURF);
    const words = Math.ceil((surfCells * surfCells) / 4);
    const surf = new Uint32Array(words);
    const setSurf = (ci, code) => { surf[ci >> 2] = (surf[ci >> 2] & ~(0xff << ((ci & 3) * 8))) | (code << ((ci & 3) * 8)); };
    for (const f of graph.faces) {
        const code = f.park ? SURFACE.park : (ZONE_SURFACE[f.zone] ?? 0);
        if (!code) continue;
        const P = f.poly, n = P.length / 2;
        let zmin = Infinity, zmax = -Infinity;
        for (let k = 0; k < n; k++) { zmin = Math.min(zmin, P[2 * k + 1]); zmax = Math.max(zmax, P[2 * k + 1]); }
        const j0 = Math.max(0, Math.floor((zmin + half) / SURF)), j1 = Math.min(surfCells - 1, Math.floor((zmax + half) / SURF));
        const xs = [];
        for (let j = j0; j <= j1; j++) {
            const z = -half + (j + 0.5) * SURF;
            xs.length = 0;
            for (let k = 0, l = n - 1; k < n; l = k++) {
                const za = P[2 * l + 1], zb = P[2 * k + 1];
                if ((za > z) !== (zb > z)) xs.push(P[2 * l] + (z - za) / (zb - za) * (P[2 * k] - P[2 * l]));
            }
            xs.sort((a, b) => a - b);
            for (let q = 0; q + 1 < xs.length; q += 2) {
                const i0 = Math.max(0, Math.ceil((xs[q] + half) / SURF - 0.5));
                const i1 = Math.min(surfCells - 1, Math.floor((xs[q + 1] + half) / SURF - 0.5));
                for (let i = i0; i <= i1; i++) setSurf(j * surfCells + i, code);
            }
        }
    }

    return {
        segs: segF, cellStart: counts, cellSegs, surf,
        info: { half, cell: CELL, cells, surfCell: SURF, surfCells, segCount, reach: REACH },
    };
}

/** The ground's height at (x, z) with the roads' grading: the JS twin of city_ground.bk's road_grade. */
export function gradedHeight(ground, natural, x, z) {
    const { half, cell, cells, reach } = ground.info;
    const h = natural(x, z);
    const ci = Math.floor((x + half) / cell), cj = Math.floor((z + half) / cell);
    if (ci < 0 || cj < 0 || ci >= cells || cj >= cells) return h;
    const c = cj * cells + ci;
    const S = ground.segs;
    let best = Infinity, by = h;
    for (let k = ground.cellStart[c]; k < ground.cellStart[c + 1]; k++) {
        const o = ground.cellSegs[k] * SEG_FLOATS;
        const ax = S[o], az = S[o + 1], dx = S[o + 2] - ax, dz = S[o + 3] - az;
        const l2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        const ex = x - ax - dx * t, ez = z - az - dz * t;
        const d = Math.sqrt(ex * ex + ez * ez) - (S[o + 6] + S[o + 7]);
        if (d < best) { best = d; by = S[o + 4] + (S[o + 5] - S[o + 4]) * t; }
    }
    if (best >= reach) return h;
    const w = best <= 0 ? 1 : 1 - smooth(best / reach);
    return h + (by - h) * w;
}

function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
