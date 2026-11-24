// lib/city/ground.js — what the ground needs to know about the city, packed
// for the GPU: the roads as segments in a cell index (the terrain kernel
// grades the ground to them, the ground shader paints them), and the blocks'
// surfaces on a grid (paved, yard, park, industrial yard).
//
// packRoads(graph, { half }) -> ground {  (packSurfaces(ground, graph) adds `surf` once lots have zoned the blocks)
//   segs: Float32Array, SEG_FLOATS a segment:
//     0: x0, z0, x1, z1
//     1: y0, y1, halfW (carriageway), walkW (sidewalk)
//     2: s0 (arc length of the edge at the segment's start), edge length,
//        level (0 major, 1 street), flags (1: start is a junction, 2: end is,
//        4: tram rails in its inner lanes)
//   cellStart: Int32Array (cells^2 + 1), cellSegs: Int32Array: the segments
//     within reach of each CELL-metre cell (CSR), row-major from (-half, -half):
//     the terrain kernel grades by them;
//   paintStart / paintSegs: the same for PAINT_CELL-metre cells, only the
//     segments whose sidewalk reaches the cell: the ground shader paints by them;
//   surf: Uint32Array, four 8-bit codes a word, SURF-metre cells:
//     0 open land, 1 paved (urban / tower blocks), 2 yards (houses, rowhouses),
//     3 park, 4 industrial yard;
//   info: { half, cell, cells, paintCell, paintCells, surfCell, surfCells, segCount, reach } }
// Bridges are ground only for BRIDGE_LAND metres at each end; their decks are meshes over the water.

export const SEG_FLOATS = 12;
export const CELL = 32;
export const SURF = 8;
/** The ground shader's road-search cells. */
export const PAINT_CELL = 16;
/** How far past its sidewalk a road still pulls the ground to its grade. */
export const REACH = 14;
/** How far a bridge's ends are ground (graded, painted) before its deck takes over (bridges.js starts it 2 m sooner). */
export const BRIDGE_LAND = 14;

export const SURFACE = { open: 0, paved: 1, yard: 2, park: 3, industrial: 4 };
const ZONE_SURFACE = { tower: 1, urban: 1, mixed: 1, rowhouse: 2, house: 2, industrial: 4 };

export function packRoads(graph, opts = {}) {
    const half = opts.half;
    const segs = [];
    const degree = graph.nodes.map((n) => n.edges.length);
    for (let ei = 0; ei < graph.edges.length; ei++) {
        const e = graph.edges[ei];
        const p = e.pts, ys = e.ys, m = p.length / 2;
        const bridge = e.kind === 'bridge';
        let s = 0;
        const fa = degree[e.a] > 2 ? 1 : 0, fb = degree[e.b] > 2 ? 2 : 0;
        const tram = opts.tramEdges?.has(ei) ? 4 : 0;
        for (let k = 0; k + 1 < m; k++) {
            const x0 = p[2 * k], z0 = p[2 * k + 1], x1 = p[2 * k + 2], z1 = p[2 * k + 3];
            const l = Math.hypot(x1 - x0, z1 - z0);
            // A bridge is ground only at its ends, under the deck's abutments.
            if (!bridge || s < BRIDGE_LAND || s + l > e.len - BRIDGE_LAND) {
                segs.push(x0, z0, x1, z1, ys[k], ys[k + 1], e.halfW, e.walkW, s, e.len, e.level, fa | fb | tram);
            }
            s += l;
        }
    }
    const segCount = segs.length / SEG_FLOATS;
    const segF = new Float32Array(segs);

    // Grading lists: every segment within REACH past its sidewalk of a CELL cell.
    const grade = cellLists(segF, segCount, half, CELL, REACH);
    // Paint lists, for the ground shader's per-pixel search: only the segments
    // whose carriageway or sidewalk reach a PAINT_CELL cell.
    const paint = cellLists(segF, segCount, half, PAINT_CELL, 0.5);

    const surfCells = Math.ceil((2 * half) / SURF);
    return {
        segs: segF, cellStart: grade.start, cellSegs: grade.list, paintStart: paint.start, paintSegs: paint.list, surf: null,
        info: { half, cell: CELL, cells: grade.cells, paintCell: PAINT_CELL, paintCells: paint.cells, surfCell: SURF, surfCells, segCount, reach: REACH },
    };
}

/** CSR lists of the segments within `pad` past their sidewalk of each `cell`-metre cell. */
function cellLists(segF, segCount, half, cell, pad0) {
    const cells = Math.ceil((2 * half) / cell);
    const counts = new Int32Array(cells * cells + 1);
    const each = (fn) => {
        for (let i = 0; i < segCount; i++) {
            const o = i * SEG_FLOATS;
            const pad = segF[o + 6] + segF[o + 7] + pad0;
            const i0 = Math.max(0, Math.floor((Math.min(segF[o], segF[o + 2]) - pad + half) / cell));
            const i1 = Math.min(cells - 1, Math.floor((Math.max(segF[o], segF[o + 2]) + pad + half) / cell));
            const j0 = Math.max(0, Math.floor((Math.min(segF[o + 1], segF[o + 3]) - pad + half) / cell));
            const j1 = Math.min(cells - 1, Math.floor((Math.max(segF[o + 1], segF[o + 3]) + pad + half) / cell));
            // Only cells the padded segment really reaches (a long diagonal's box is mostly empty).
            const ax = segF[o], az = segF[o + 1], dx = segF[o + 2] - ax, dz = segF[o + 3] - az, l2 = dx * dx + dz * dz || 1e-9;
            const r = pad + cell * 0.7072;
            for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
                const cx = -half + (ii + 0.5) * cell, cz = -half + (j + 0.5) * cell;
                const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / l2));
                const ex = cx - ax - dx * t, ez = cz - az - dz * t;
                if (ex * ex + ez * ez <= r * r) fn(j * cells + ii, i);
            }
        }
    };
    each((c) => { counts[c + 1]++; });
    for (let c = 0; c < cells * cells; c++) counts[c + 1] += counts[c];
    const list = new Int32Array(counts[cells * cells]);
    const fill = counts.slice(0, cells * cells);
    each((c, i) => { list[fill[c]++] = i; });
    return { start: counts, list, cells };
}

/** The blocks' surfaces (each face scan-filled at SURF metres by its zone or park) into ground.surf. */
export function packSurfaces(ground, graph) {
    const { half, surfCells } = ground.info;
    // Block surfaces: each face's polygon scan-filled at SURF metres.
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

    ground.surf = surf;
    return ground;
}

/** The ground's height at (x, z) with the roads' grading: the JS twin of city_ground.bk's road_grade. */
export function gradedHeight(ground, natural, x, z) {
    const { half, cell, cells, reach } = ground.info;
    const h = natural(x, z);
    const ci = Math.floor((x + half) / cell), cj = Math.floor((z + half) / cell);
    if (ci < 0 || cj < 0 || ci >= cells || cj >= cells) return h;
    const c = cj * cells + ci;
    const S = ground.segs;
    // The roads' heights blended by how much farther each is than the
    // nearest: two alike on the line halfway between, so the grade has no
    // step there (the nearest road's height alone jumped on that line, a
    // crease the low sun drew dark across junctions and fields).
    const n = ground.cellStart[c + 1] - ground.cellStart[c];
    if (n === 0) return h;
    const ds = new Float64Array(n), ys = new Float64Array(n);
    let best = Infinity;
    for (let k = 0; k < n; k++) {
        const o = ground.cellSegs[ground.cellStart[c] + k] * SEG_FLOATS;
        const ax = S[o], az = S[o + 1], dx = S[o + 2] - ax, dz = S[o + 3] - az;
        const l2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        const ex = x - ax - dx * t, ez = z - az - dz * t;
        ds[k] = Math.sqrt(ex * ex + ez * ez) - (S[o + 6] + S[o + 7]);
        ys[k] = S[o + 4] + (S[o + 5] - S[o + 4]) * t;
        if (ds[k] < best) best = ds[k];
    }
    if (best >= reach) return h;
    // A road GRADE_SPAN metres farther than the nearest no longer counts
    // (terrain_produce.bk's twin uses the same span).
    let sw = 0, sy = 0;
    for (let k = 0; k < n; k++) {
        const wk = 1 - smooth((ds[k] - best) / GRADE_SPAN);
        sw += wk; sy += wk * ys[k];
    }
    const by = sy / sw;
    const w = best <= 0 ? 1 : 1 - smooth(best / reach);
    return h + (by - h) * w;
}

const GRADE_SPAN = 4;

function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
