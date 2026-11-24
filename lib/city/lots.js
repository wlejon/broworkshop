// lib/city/lots.js — lots along every block's street frontage.
//
// placeLots(graph, field, opts) -> [{ x, z, yaw, w, d, zone, face, edge, y0, y1 }]
//   x, z: the lot's centre; yaw: its facing (local +z points at the street);
//   w: frontage width, d: depth; y0 / y1: lowest / highest ground at its corners,
//   yf: the ground at the middle of its street front; corner: 1 on a corner lot.
// For each block (a bounded face), each street edge of its boundary is walked
// on the block's side and lots of the zone's width are stood on it, as deep as
// the zone wants or as the block allows (shallower tries before giving up). A
// lot stands clear of every road (its half width and sidewalk), of the other
// lots, of water and of ground too steep for it. In the denser zones a
// block's corners are filled first, each with a lot fronting both streets
// (`corner: 1`, its local +x side to the cross street); elsewhere the
// frontage lots stop at the cross street's clearance, leaving the corners
// open as yards. A road's side that faces the water (in no block) gets lots
// too, backing onto the bank.

import { hash2, rng } from "./field.js";

export const ZONES = {
    //            frontage w [min, max], depth, side gap, setback, max ground drop
    // (corner: the block's corners get a lot fronting both streets.)
    tower:       { w: [28, 46], d: [34, 50], gap: 3, setback: 0.8, drop: 4.5, corner: true },
    urban:       { w: [16, 30], d: [22, 32], gap: 0, setback: 0.4, drop: 3.0, corner: true },
    mixed:       { w: [10, 18], d: [16, 24], gap: 0, setback: 0.3, drop: 2.4, corner: true },
    rowhouse:    { w: [6.5, 9], d: [12, 16], gap: 0, setback: 2.5, drop: 2.0 },
    house:       { w: [17, 24], d: [26, 34], gap: 4, setback: 5.5, drop: 4.0 },
    industrial:  { w: [36, 64], d: [36, 56], gap: 8, setback: 6.0, drop: 3.0 },
};

/** The zone of a block: from density, with a little variety. */
export function zoneFor(density, x, z, industrial) {
    if (industrial) return 'industrial';
    const n = hash2(Math.floor(x / 300), Math.floor(z / 300), 917);
    if (density > 0.72) return 'tower';
    if (density > 0.5) return n < 0.25 ? 'tower' : 'urban';
    if (density > 0.33) return n < 0.5 ? 'urban' : 'mixed';
    if (density > 0.2) return n < 0.45 ? 'mixed' : 'rowhouse';
    return 'house';
}

class Hash {
    constructor(cell) { this.cell = cell; this.m = new Map(); this.stamp = 0; }
    k(i, j) { return i * 73856093 ^ j * 19349663; }
    add(minx, minz, maxx, maxz, item) {
        const c = this.cell;
        for (let j = Math.floor(minz / c); j <= Math.floor(maxz / c); j++)
            for (let i = Math.floor(minx / c); i <= Math.floor(maxx / c); i++) {
                const key = this.k(i, j); let b = this.m.get(key); if (!b) { b = []; this.m.set(key, b); } b.push(item);
            }
    }
    each(minx, minz, maxx, maxz, fn) {
        // (Each item once a query: stamped with the query's number.)
        const c = this.cell, stamp = ++this.stamp;
        for (let j = Math.floor(minz / c); j <= Math.floor(maxz / c); j++)
            for (let i = Math.floor(minx / c); i <= Math.floor(maxx / c); i++) {
                const b = this.m.get(this.k(i, j)); if (!b) continue;
                for (const it of b) { if (it.seen === stamp) continue; it.seen = stamp; if (fn(it) === false) return false; }
            }
        return true;
    }
}

function corners(cx, cz, ux, uz, hw, hd) {
    // u: frontage direction; v = (-uz, ux) inward... callers pass the depth axis as v.
    const vx = -uz, vz = ux;
    return [
        cx - ux * hw - vx * hd, cz - uz * hw - vz * hd,
        cx + ux * hw - vx * hd, cz + uz * hw - vz * hd,
        cx + ux * hw + vx * hd, cz + uz * hw + vz * hd,
        cx - ux * hw + vx * hd, cz - uz * hw + vz * hd,
    ];
}

function sat(a, b) {
    // Two convex quads (8 numbers each): separated along an edge normal of either?
    for (const P of [a, b]) for (let i = 0; i < 4; i++) {
        const j = (i + 1) & 3;
        const nx = -(P[2 * j + 1] - P[2 * i + 1]), nz = P[2 * j] - P[2 * i];
        let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
        for (let k = 0; k < 4; k++) {
            const pa = a[2 * k] * nx + a[2 * k + 1] * nz; amin = Math.min(amin, pa); amax = Math.max(amax, pa);
            const pb = b[2 * k] * nx + b[2 * k + 1] * nz; bmin = Math.min(bmin, pb); bmax = Math.max(bmax, pb);
        }
        if (amax <= bmin + 1e-6 || bmax <= amin + 1e-6) return false;
    }
    return true;
}

function segDist2(px, pz, x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / l2));
    const ex = px - x0 - dx * t, ez = pz - z0 - dz * t;
    return ex * ex + ez * ez;
}

function pointInPoly(x, z, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
        const xi = poly[i], zi = poly[i + 1], xj = poly[j], zj = poly[j + 1];
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
}

export function placeLots(graph, field, opts = {}) {
    const site = field.site;
    const height = opts.height ?? site.height;
    const roads = new Hash(48);
    graph.edges.forEach((e, ei) => {
        const p = e.pts;
        for (let i = 0; i + 3 < p.length; i += 2) {
            const pad = e.halfW + e.walkW;
            roads.add(Math.min(p[i], p[i + 2]) - pad, Math.min(p[i + 1], p[i + 3]) - pad,
                Math.max(p[i], p[i + 2]) + pad, Math.max(p[i + 1], p[i + 3]) + pad,
                { x0: p[i], z0: p[i + 1], x1: p[i + 2], z1: p[i + 3], clear: e.halfW + e.walkW, ei, seen: 0,
                  bx0: Math.min(p[i], p[i + 2]) - pad, bz0: Math.min(p[i + 1], p[i + 3]) - pad,
                  bx1: Math.max(p[i], p[i + 2]) + pad, bz1: Math.max(p[i + 1], p[i + 3]) + pad });
        }
    });
    const lotHash = new Hash(32);
    const lots = [];

    // Clearance of a quad from every road: its corners, edge midpoints and centre.
    const clearOfRoads = (q, cx, cz) => {
        const xs = [q[0], q[2], q[4], q[6]], zs = [q[1], q[3], q[5], q[7]];
        const minx = Math.min(...xs) - 12, maxx = Math.max(...xs) + 12;
        const minz = Math.min(...zs) - 12, maxz = Math.max(...zs) + 12;
        const probes = [cx, cz];
        for (let i = 0; i < 4; i++) {
            const j = (i + 1) & 3;
            probes.push(q[2 * i], q[2 * i + 1], (q[2 * i] + q[2 * j]) * 0.5, (q[2 * i + 1] + q[2 * j + 1]) * 0.5);
        }
        // (The quad's own bounds, for a segment whose padded bounds miss them:
        // no probe or edge of the quad can come within its clearance.)
        const qx0 = minx + 12, qx1 = maxx - 12, qz0 = minz + 12, qz1 = maxz - 12;
        return roads.each(minx, minz, maxx, maxz, (r) => {
            if (r.bx1 < qx0 || r.bx0 > qx1 || r.bz1 < qz0 || r.bz0 > qz1) return true;
            const c2 = (r.clear - 0.05) ** 2;
            for (let k = 0; k < probes.length; k += 2) if (segDist2(probes[k], probes[k + 1], r.x0, r.z0, r.x1, r.z1) < c2) return false;
            // An edge of the lot crossing the road line.
            for (let i = 0; i < 4; i++) {
                const j = (i + 1) & 3;
                const ax = q[2 * i], az = q[2 * i + 1], bx = q[2 * j], bz = q[2 * j + 1];
                const d1 = (r.x1 - r.x0) * (az - r.z0) - (r.z1 - r.z0) * (ax - r.x0);
                const d2 = (r.x1 - r.x0) * (bz - r.z0) - (r.z1 - r.z0) * (bx - r.x0);
                const d3 = (bx - ax) * (r.z0 - az) - (bz - az) * (r.x0 - ax);
                const d4 = (bx - ax) * (r.z1 - az) - (bz - az) * (r.x1 - ax);
                if (d1 * d2 < 0 && d3 * d4 < 0) return false;
            }
            return true;
        });
    };
    const clearOfLots = (q) => {
        const xs = [q[0], q[2], q[4], q[6]], zs = [q[1], q[3], q[5], q[7]];
        return lotHash.each(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), (o) => !sat(q, o.q));
    };

    graph.faces.forEach((face, fi) => {
        if (face.area > (opts.maxBlockArea ?? 260000) || face.area < 600) return;
        // Centroid for the zone.
        let sx = 0, sz = 0;
        const P = face.poly, np = P.length / 2;
        for (let i = 0; i < P.length; i += 2) { sx += P[i]; sz += P[i + 1]; }
        const fx = sx / np, fz = sz / np;
        const dens = field.density(fx, fz);
        if (dens < 0.04) return;
        const isPark = opts.isPark ? opts.isPark(fx, fz, face, dens) : false;
        if (isPark) { face.park = true; return; }
        const industrial = opts.isIndustrial ? opts.isIndustrial(fx, fz, dens) : false;
        const zone = zoneFor(dens, fx, fz, industrial);
        face.zone = zone;
        fill(face, fi, zone, dens, (x, z) => pointInPoly(x, z, P));
    });

    // A road's side facing the water (a half-edge of no block, the water
    // near on its left): lots there too, backing onto the bank, of the zone
    // inland of the road. The water's own clearance keeps them off the bank.
    for (const [ei, dir] of graph.open ?? []) {
        const e = graph.edges[ei];
        if (e.kind === 'bridge' || e.len < 30) continue;
        const p = e.pts, m = p.length >> 1, k = m >> 1;
        const i0 = Math.max(0, k - 1), i1 = Math.min(m - 1, k + 1);
        let ux = p[2 * i1] - p[2 * i0], uz = p[2 * i1 + 1] - p[2 * i0 + 1];
        const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
        if (dir === 1) { ux = -ux; uz = -uz; }
        const mx = p[2 * k], mz = p[2 * k + 1], nx = -uz, nz = ux;   // n: the half-edge's left
        let wet = false;
        for (let s = 30; s <= 170 && !wet; s += 20) wet = site.water(mx + nx * s, mz + nz * s) < 0;
        if (!wet) continue;
        const ix = mx - nx * 50, iz = mz - nz * 50;
        const dens = field.density(ix, iz);
        if (dens < 0.04) continue;
        const industrial = opts.isIndustrial ? opts.isIndustrial(ix, iz, dens) : false;
        // (Its side: left of the road, within the lot's depth of it.)
        const side = (x, z) => {
            let best = Infinity, sgn = 0;
            for (let q = 0; q + 3 < p.length; q += 2) {
                const d2 = segDist2(x, z, p[q], p[q + 1], p[q + 2], p[q + 3]);
                if (d2 < best) { best = d2; sgn = (p[q + 2] - p[q]) * (z - p[q + 1]) - (p[q + 3] - p[q + 1]) * (x - p[q]); }
            }
            return (dir === 0 ? sgn > 0 : sgn < 0) && best < 70 * 70;
        };
        fill({ halfEdges: [[ei, dir]] }, -1, zoneFor(dens, ix, iz, industrial), dens, side, true);
    }
    return lots;

    function fill(face, fi, zone, dens, inside, open = false) {
        const Z = ZONES[zone];
        const R = rng(((fi < 0 ? 0x9e3779b9 + face.halfEdges[0][0] * 2 + face.halfEdges[0][1] : fi) * 2654435761) >>> 0);

        // A lot of half width hw and depth d whose street front's middle is
        // (fx, fz) on a street running u (interior to its left), set `off`
        // back from it; placed if it stands clear of roads, lots, water and
        // steep ground. Returns whether it was.
        const tryLot = (fx, fz, ux, uz, off, hw, d, ei, extra) => {
            const nx = -uz, nz = ux;
            const cx = fx + nx * (off + d * 0.5), cz = fz + nz * (off + d * 0.5);
            const hd = d * 0.5;
            const q = corners(cx, cz, ux, uz, hw, hd);
            if (!inside(cx, cz)) return false;
            // (Every corner on the dry ground above the bank's slope.)
            for (let k = 0; k < 4; k++) if (site.water(q[2 * k], q[2 * k + 1]) < (opts.bankClear ?? 40)) return false;
            if (!clearOfRoads(q, cx, cz) || !clearOfLots(q)) return false;
            let y0 = Infinity, y1 = -Infinity;
            for (let k = 0; k < 4; k++) { const h = height(q[2 * k], q[2 * k + 1]); y0 = Math.min(y0, h); y1 = Math.max(y1, h); }
            if (y1 - y0 > Z.drop) return false;
            // Local +z faces the street: the lot's -n side.
            const yaw = Math.atan2(-nx, -nz);
            const yf = height((q[0] + q[2]) * 0.5, (q[1] + q[3]) * 0.5);   // the street front's ground
            const lot = { x: cx, z: cz, yaw, w: hw * 2, d, zone, face: fi, edge: ei, y0, y1, yf, q, dens, ...extra };
            lots.push(lot);
            lotHash.add(Math.min(q[0], q[2], q[4], q[6]), Math.min(q[1], q[3], q[5], q[7]),
                Math.max(q[0], q[2], q[4], q[6]), Math.max(q[1], q[3], q[5], q[7]), lot);
            return true;
        };

        // Corners first, while they are free: where two streets meet at a
        // block's corner (a turn of 60-120 degrees), a lot fronting both,
        // its front on the second street, its side along the first at the
        // first's setback (`corner: 1`: its local +x side faces that street).
        if (Z.corner && !open) {
            const he = face.halfEdges, n = he.length;
            for (let k = 0; k < n; k++) {
                const [e1i, d1] = he[k], [e2i, d2] = he[(k + 1) % n];
                const e1 = graph.edges[e1i], e2 = graph.edges[e2i];
                if (e1.kind === 'bridge' || e2.kind === 'bridge' || e1i === e2i) continue;
                const p1 = e1.pts, p2 = e2.pts, m1 = p1.length / 2, m2 = p2.length / 2;
                // The first edge's last segment into the corner, the second's first out of it.
                const a1 = d1 === 0 ? m1 - 2 : 1, b1 = d1 === 0 ? m1 - 1 : 0;
                const s0 = d2 === 0 ? 0 : m2 - 1, s1 = d2 === 0 ? 1 : m2 - 2;
                const vx = p1[2 * b1], vz = p1[2 * b1 + 1];
                let u1x = vx - p1[2 * a1], u1z = vz - p1[2 * a1 + 1];
                let u2x = p2[2 * s1] - p2[2 * s0], u2z = p2[2 * s1 + 1] - p2[2 * s0 + 1];
                const l1 = Math.hypot(u1x, u1z), l2 = Math.hypot(u2x, u2z);
                if (l1 < 1e-6 || l2 < 1e-6) continue;
                u1x /= l1; u1z /= l1; u2x /= l2; u2z /= l2;
                // A left turn (the block's convex corner) of 60-120 degrees.
                if (Math.abs(u1x * u2x + u1z * u2z) > 0.5 || u1x * u2z - u1z * u2x <= 0) continue;
                const n1x = -u1z, n1z = u1x, n2x = -u2z, n2z = u2x;
                const o1 = e1.halfW + e1.walkW + Z.setback, o2 = e2.halfW + e2.walkW + Z.setback;
                // The corner of the two setback lines: V + n1 o1 + t u1 on the second's.
                const u1n2 = u1x * n2x + u1z * n2z;
                const t = (o2 - o1 * (n1x * n2x + n1z * n2z)) / u1n2;
                const cx0 = vx + n1x * o1 + u1x * t, cz0 = vz + n1z * o1 + u1z * t;
                // Back along the second street's setback line to its street front.
                const fx0 = cx0 - n2x * o2, fz0 = cz0 - n2z * o2;
                for (const f of [1, 0.84, 0.7, 0.58, 0.48]) {
                    const w = Math.max(Z.w[0], Z.w[1] * 0.85) * f, d = Z.d[1] * f;
                    if (w < 6 || d < 7) break;
                    // (A hair inside both setback lines, off the cross street's clearance.)
                    const ins = 0.3;
                    if (tryLot(fx0 + u2x * (w * 0.5 + ins), fz0 + u2z * (w * 0.5 + ins), u2x, u2z, o2 + ins, w * 0.5, d, e2i, { corner: 1 })) break;
                }
            }
        }

        for (const [ei, dir] of face.halfEdges) {
            const e = graph.edges[ei];
            if (e.kind === 'bridge') continue;
            // The edge in the face's direction, as a polyline with arc length.
            const src = e.pts, m = src.length / 2;
            const pts = new Float64Array(src.length);
            for (let k = 0; k < m; k++) {
                const idx = dir === 0 ? k : m - 1 - k;
                pts[2 * k] = src[2 * idx]; pts[2 * k + 1] = src[2 * idx + 1];
            }
            const s = new Float64Array(m);
            for (let k = 1; k < m; k++) s[k] = s[k - 1] + Math.hypot(pts[2 * k] - pts[2 * k - 2], pts[2 * k + 1] - pts[2 * k - 1]);
            const total = s[m - 1];
            const at = (t) => {
                let k = 1; while (k < m - 1 && s[k] < t) k++;
                const f = (t - s[k - 1]) / Math.max(1e-6, s[k] - s[k - 1]);
                return [pts[2 * k - 2] + (pts[2 * k] - pts[2 * k - 2]) * f, pts[2 * k - 1] + (pts[2 * k + 1] - pts[2 * k - 1]) * f];
            };
            const off = e.halfW + e.walkW + Z.setback;
            let t = 4 + R() * 3;
            while (t < total - 4) {
                const w = Z.w[0] + R() * (Z.w[1] - Z.w[0]);
                if (t + w > total - 2) break;
                const a = at(t), b = at(t + w);
                let ux = b[0] - a[0], uz = b[1] - a[1];
                const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
                const fxm = (a[0] + b[0]) * 0.5, fzm = (a[1] + b[1]) * 0.5;
                let placed = false;
                const hw = (ul - Z.gap) * 0.5;
                for (const shrink of [1, 0.78, 0.6]) {
                    const d = (Z.d[0] + R() * (Z.d[1] - Z.d[0])) * shrink;
                    if (d < 7 || hw < 2.5) break;
                    if (tryLot(fxm, fzm, ux, uz, off, hw, d, ei)) { placed = true; break; }
                }
                t += placed ? w : Math.max(3, w * 0.5);
            }
        }
    }
}
