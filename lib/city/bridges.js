// lib/city/bridges.js — the road graph's bridge edges as one mesh: a deck
// swept along each edge's graded line (asphalt between raised sidewalks,
// parapets, fascia, soffit) on piers standing in the water.
//
// bridgeMesh(graph, { waterBed }) -> bro.mesh.Mesh (positions, normals, uvs,
// colors, indices) or null. uv = (offset across the deck from its centre
// line, arc length along it), in metres.

const DECK = 1.5;        // deck thickness below the road surface
const CURB = 0.2;        // sidewalk above the road
const PARAPET = 1.1;     // parapet top above the road
const PARAPET_W = 0.35;
const PIER_EVERY = 46;   // pier spacing along a span
const ABUT = 12;         // the deck starts this far from each end (the ground carries the road before it)

const C_ROAD = [0.055, 0.056, 0.058, 1];
const C_WALK = [0.30, 0.29, 0.27, 1];
const C_CONC = [0.46, 0.45, 0.42, 1];
const C_SOFFIT = [0.30, 0.30, 0.29, 1];

export function bridgeMesh(graph, opts = {}) {
    const waterBed = opts.waterBed ?? -7;
    const P = [], N = [], UV = [], C = [], I = [];
    const quad = (a, b, c, d, n, col, uvs) => {
        const base = P.length / 3;
        for (const [k, v] of [a, b, c, d].entries()) {
            P.push(v[0], v[1], v[2]); N.push(n[0], n[1], n[2]); C.push(...col);
            UV.push(uvs ? uvs[k][0] : 0, uvs ? uvs[k][1] : 0);
        }
        I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const box = (cx, cy, cz, ux, uz, hw, hh, hd, col) => {
        // An oriented box: u = (ux, uz) across, v = (-uz, ux) along.
        const vx = -uz, vz = ux;
        const corner = (sx, sy, sz) => [cx + ux * hw * sx + vx * hd * sz, cy + hh * sy, cz + uz * hw * sx + vz * hd * sz];
        const faces = [
            [[1, 0, 0], [[1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1]]],
            [[-1, 0, 0], [[-1, -1, 1], [-1, -1, -1], [-1, 1, -1], [-1, 1, 1]]],
            [[0, 0, 1], [[1, -1, 1], [-1, -1, 1], [-1, 1, 1], [1, 1, 1]]],
            [[0, 0, -1], [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]]],
        ];
        for (const [[nx, , nz], cs] of faces) {
            const n = [ux * nx + vx * nz, 0, uz * nx + vz * nz];
            const v = cs.map(([a, b, c]) => corner(a, b, c));
            quad(v[0], v[1], v[2], v[3], n, col, null);
        }
    };

    let any = false;
    for (const e of graph.edges) {
        if (e.kind !== 'bridge') continue;
        any = true;
        const p = e.pts, ys = e.ys, m = p.length / 2;
        const hw = e.halfW, W = e.halfW + e.walkW + PARAPET_W;
        // The cross-section, (u across, y up from the road), walked around the
        // deck; each segment a strip with its own normal and colour.
        const prof = [
            [[-W, -DECK], [W, -DECK], [0, -1], C_SOFFIT],
            [[W, -DECK], [W, PARAPET], [1, 0], C_CONC],
            [[W, PARAPET], [W - PARAPET_W, PARAPET], [0, 1], C_CONC],
            [[W - PARAPET_W, PARAPET], [W - PARAPET_W, CURB], [-1, 0], C_CONC],
            [[W - PARAPET_W, CURB], [hw, CURB], [0, 1], C_WALK],
            [[hw, CURB], [hw, 0], [-1, 0], C_CONC],
            [[hw, 0], [-hw, 0], [0, 1], C_ROAD],
            [[-hw, 0], [-hw, CURB], [1, 0], C_CONC],
            [[-hw, CURB], [-(W - PARAPET_W), CURB], [0, 1], C_WALK],
            [[-(W - PARAPET_W), CURB], [-(W - PARAPET_W), PARAPET], [1, 0], C_CONC],
            [[-(W - PARAPET_W), PARAPET], [-W, PARAPET], [0, 1], C_CONC],
            [[-W, PARAPET], [-W, -DECK], [-1, 0], C_CONC],
        ];
        // Frames along the line: position, across direction, arc length.
        const F = [];
        let s = 0;
        for (let k = 0; k < m; k++) {
            const k0 = Math.max(0, k - 1), k1 = Math.min(m - 1, k + 1);
            let tx = p[2 * k1] - p[2 * k0], tz = p[2 * k1 + 1] - p[2 * k0 + 1];
            const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
            if (k) s += Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]);
            // Across: to the right of travel.
            F.push({ x: p[2 * k], y: ys[k], z: p[2 * k + 1], ux: -tz, uz: tx, s });
        }
        // The deck between its abutments: frames clipped to [ABUT, total - ABUT].
        {
            const tot = F[m - 1].s;
            const lerpF = (sv) => {
                let k = 1; while (k < m - 1 && F[k].s < sv) k++;
                const a = F[k - 1], b = F[k], t = (sv - a.s) / Math.max(1e-6, b.s - a.s);
                return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, ux: a.ux, uz: a.uz, s: sv };
            };
            if (tot > 2 * ABUT + 4) {
                const clipped = [lerpF(ABUT), ...F.filter((f) => f.s > ABUT && f.s < tot - ABUT), lerpF(tot - ABUT)];
                F.length = 0;
                F.push(...clipped);
            }
        }
        const fm = F.length;
        const at = (f, u, y) => [f.x + f.ux * u, f.y + y, f.z + f.uz * u];
        for (let k = 0; k + 1 < fm; k++) {
            const f0 = F[k], f1 = F[k + 1];
            for (const [[u0, y0], [u1, y1], [nu, ny], col] of prof) {
                const n = [f0.ux * nu, ny, f0.uz * nu];
                quad(at(f0, u0, y0), at(f1, u0, y0), at(f1, u1, y1), at(f0, u1, y1), n, col,
                    [[u0, f0.s], [u0, f1.s], [u1, f1.s], [u1, f0.s]]);
            }
        }
        // End caps against the abutments.
        for (const [f, sg] of [[F[0], -1], [F[fm - 1], 1]]) {
            const tx = f.uz, tz = -f.ux;   // along travel
            const n = [tx * sg, 0, tz * sg];
            const a = at(f, -W, -DECK), b = at(f, W, -DECK), c = at(f, W, CURB), d = at(f, -W, CURB);
            if (sg > 0) quad(a, b, c, d, n, C_CONC, null); else quad(b, a, d, c, n, C_CONC, null);
        }
        // Piers where the deck is over water, every PIER_EVERY metres.
        const s0 = F[0].s, total = F[fm - 1].s - s0;
        const spans = Math.max(1, Math.round(total / PIER_EVERY));
        for (let j = 1; j < spans; j++) {
            const sj = s0 + (j / spans) * total;
            let k = 1; while (k < fm - 1 && F[k].s < sj) k++;
            const fa = F[k - 1], fb = F[k], t = (sj - fa.s) / Math.max(1e-6, fb.s - fa.s);
            const x = fa.x + (fb.x - fa.x) * t, z = fa.z + (fb.z - fa.z) * t, y = fa.y + (fb.y - fa.y) * t;
            const top = y - DECK, bot = waterBed;
            if (top - bot < 2) continue;
            box(x, (top + bot) * 0.5, z, fa.ux, fa.uz, hw * 0.8, (top - bot) * 0.5, 1.1, C_CONC);
        }
    }
    if (!any) return null;
    const { Mesh } = bro.mesh;
    return new Mesh({
        positions: new Float32Array(P), normals: new Float32Array(N), uvs: new Float32Array(UV),
        colors: new Float32Array(C), indices: new Uint32Array(I),
    });
}
