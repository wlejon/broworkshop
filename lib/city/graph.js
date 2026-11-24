// lib/city/graph.js — traced street lines -> a planar road graph and its blocks.
//
// buildGraph(lines, field, opts) -> {
//   nodes: [{ x, z, y, edges: [edgeIndex...] }],
//   edges: [{ a, b, pts: [x, z, ...], ys: [y...], level, kind, halfW, walkW, len }],
//   faces: [{ halfEdges: [[edge, dir]...], poly: [x, z, ...], area }],   // bounded blocks, CCW (none with a bridge on its boundary)
//   open: [[edge, dir]...],   // half-edges of no block: roads' outward sides (the block on a half-edge's left)
// }
// Steps: simplify each line; extend a dangling end straight ahead to the road
// it is about to meet; split every line where it crosses another (junctions);
// merge near junctions; drop short stubs, and roads that end at the water
// without a bridge; grade heights along each edge; walk the half-edges into
// faces.

const ROAD = {
    arterial: { halfW: 8.5, walkW: 3.6 },
    bridge: { halfW: 8.5, walkW: 2.4 },
    street: { halfW: 5.0, walkW: 2.8 },
};

function rdp(pts, tol) {
    const n = pts.length / 2;
    if (n <= 2) return pts.slice();
    const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        const ax = pts[2 * a], az = pts[2 * a + 1], bx = pts[2 * b], bz = pts[2 * b + 1];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
        let best = -1, bd = tol * tol;
        for (let i = a + 1; i < b; i++) {
            const px = pts[2 * i] - ax, pz = pts[2 * i + 1] - az;
            const t = Math.max(0, Math.min(1, (px * dx + pz * dz) / l2));
            const ex = px - dx * t, ez = pz - dz * t, d = ex * ex + ez * ez;
            if (d > bd) { bd = d; best = i; }
        }
        if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
    return out;
}

/** Segment hash: segments of all lines, by cell, for intersection and nearest queries. */
class SegHash {
    constructor(cell) { this.cell = cell; this.m = new Map(); }
    key(i, j) { return i * 73856093 ^ j * 19349663; }
    add(x0, z0, x1, z1, item) {
        const c = this.cell;
        const i0 = Math.floor(Math.min(x0, x1) / c), i1 = Math.floor(Math.max(x0, x1) / c);
        const j0 = Math.floor(Math.min(z0, z1) / c), j1 = Math.floor(Math.max(z0, z1) / c);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const k = this.key(i, j);
            let b = this.m.get(k); if (!b) { b = []; this.m.set(k, b); }
            b.push(item);
        }
    }
    query(x0, z0, x1, z1, fn) {
        const c = this.cell;
        const i0 = Math.floor(Math.min(x0, x1) / c), i1 = Math.floor(Math.max(x0, x1) / c);
        const j0 = Math.floor(Math.min(z0, z1) / c), j1 = Math.floor(Math.max(z0, z1) / c);
        const seen = new Set();
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const b = this.m.get(this.key(i, j)); if (!b) continue;
            for (const it of b) { if (seen.has(it)) continue; seen.add(it); fn(it); }
        }
    }
}

function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
    const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
    const den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-9) return null;
    const qx = cx - ax, qz = cz - az;
    const t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return [t, u];
}

export function buildGraph(lines, field, opts = {}) {
    // 1. Simplify.
    const L = lines.map((ln) => ({ ...ln, pts: rdp(ln.pts, opts.simplify ?? 0.6), cuts: [] }));

    // 2. Hash every segment.
    const H = new SegHash(48);
    const segs = [];
    for (let li = 0; li < L.length; li++) {
        const p = L[li].pts;
        for (let i = 0; i + 3 < p.length; i += 2) {
            const s = { li, i: i / 2, x0: p[i], z0: p[i + 1], x1: p[i + 2], z1: p[i + 3] };
            segs.push(s);
            H.add(s.x0, s.z0, s.x1, s.z1, s);
        }
    }

    // 3. Extend dangling ends straight ahead to the road they were about to meet.
    for (const ln of L) {
        const p = ln.pts;
        if (p.length < 4) continue;
        const reach = ln.level === 0 ? 240 : 70;
        for (const end of [0, 1]) {
            const i = end ? p.length - 2 : 0, j = end ? p.length - 4 : 2;
            const ex = p[i], ez = p[i + 1];
            let dx = ex - p[j], dz = ez - p[j + 1];
            const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
            const fx = ex + dx * reach, fz = ez + dz * reach;
            let best = null, bt = Infinity;
            H.query(ex, ez, fx, fz, (s) => {
                if (s.li === L.indexOf(ln)) return;
                const r = segIntersect(ex, ez, fx, fz, s.x0, s.z0, s.x1, s.z1);
                if (r && r[0] < bt && r[0] > 1e-4) { bt = r[0]; best = r; }
            });
            if (!best) continue;
            const hx = ex + (fx - ex) * bt, hz = ez + (fz - ez) * bt;
            let wet = false;
            for (let k = 1; k <= 8 && !wet; k++) wet = field.water(ex + (hx - ex) * k / 8, ez + (hz - ez) * k / 8) < 18;
            if (wet) continue;
            if (end) p.push(hx + dx * 0.5, hz + dz * 0.5);
            else p.unshift(hx + dx * 0.5, hz + dz * 0.5);
        }
    }

    // Rebuild the segment hash with the extensions.
    const H2 = new SegHash(48);
    const segs2 = [];
    for (let li = 0; li < L.length; li++) {
        const p = L[li].pts;
        for (let i = 0; i + 3 < p.length; i += 2) {
            const s = { li, i: i / 2, x0: p[i], z0: p[i + 1], x1: p[i + 2], z1: p[i + 3] };
            segs2.push(s);
            H2.add(s.x0, s.z0, s.x1, s.z1, s);
        }
    }

    // 4. Crossings: a cut on both lines at the same point.
    for (const s of segs2) {
        H2.query(s.x0, s.z0, s.x1, s.z1, (o) => {
            if (o === s) return;
            if (o.li < s.li || (o.li === s.li && o.i <= s.i + 1)) return;
            const r = segIntersect(s.x0, s.z0, s.x1, s.z1, o.x0, o.z0, o.x1, o.z1);
            if (!r) return;
            const x = s.x0 + (s.x1 - s.x0) * r[0], z = s.z0 + (s.z1 - s.z0) * r[0];
            L[s.li].cuts.push([s.i + r[0], x, z]);
            L[o.li].cuts.push([o.i + r[1], x, z]);
        });
    }

    // 5. Nodes: cut points and line ends, merged within a few metres.
    const nodes = [];
    const nodeHash = new Map();
    const MERGE = opts.merge ?? 6;
    const nodeAt = (x, z) => {
        const ci = Math.floor(x / MERGE), cj = Math.floor(z / MERGE);
        for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
            const b = nodeHash.get(i * 73856093 ^ j * 19349663); if (!b) continue;
            for (const ni of b) { const nd = nodes[ni]; if (Math.hypot(nd.x - x, nd.z - z) < MERGE) return ni; }
        }
        const ni = nodes.length;
        nodes.push({ x, z, y: 0, edges: [] });
        const k = ci * 73856093 ^ cj * 19349663;
        let b = nodeHash.get(k); if (!b) { b = []; nodeHash.set(k, b); }
        b.push(ni);
        return ni;
    };

    // 6. Edges: each line cut at its junctions.
    let edges = [];
    for (const ln of L) {
        const p = ln.pts, nseg = p.length / 2 - 1;
        if (nseg < 1) continue;
        const cuts = ln.cuts.slice().sort((a, b) => a[0] - b[0]);
        cuts.unshift([0, p[0], p[1]]);
        cuts.push([nseg, p[p.length - 2], p[p.length - 1]]);
        let prev = cuts[0], prevNode = nodeAt(prev[1], prev[2]);
        for (let c = 1; c < cuts.length; c++) {
            const cur = cuts[c];
            if (cur[0] - prev[0] < 1e-6) continue;
            const n2 = nodeAt(cur[1], cur[2]);
            if (n2 === prevNode) { prev = cur; continue; }
            const pts = [nodes[prevNode].x, nodes[prevNode].z];
            for (let k = Math.floor(prev[0]) + 1; k <= Math.ceil(cur[0]) - 1; k++) {
                if (k > prev[0] && k < cur[0]) pts.push(p[2 * k], p[2 * k + 1]);
            }
            pts.push(nodes[n2].x, nodes[n2].z);
            const kind = ln.kind === 'bridge' ? 'bridge' : (ln.kind ?? (ln.level === 0 ? 'arterial' : 'street'));
            edges.push({ a: prevNode, b: n2, pts, level: ln.level, kind });
            prev = cur; prevNode = n2;
        }
    }

    // Duplicates (two lines along the same street) and length.
    const seen = new Set();
    edges = edges.filter((e) => {
        let len = 0;
        for (let i = 2; i < e.pts.length; i += 2) len += Math.hypot(e.pts[i] - e.pts[i - 2], e.pts[i + 1] - e.pts[i - 1]);
        e.len = len;
        const k = e.a < e.b ? `${e.a},${e.b}` : `${e.b},${e.a}`;
        if (len < 0.5 || seen.has(k)) return false;
        seen.add(k);
        return true;
    });

    // 7. Prune short dangling stubs, repeatedly.
    const degree = () => {
        const d = new Int32Array(nodes.length);
        for (const e of edges) { d[e.a]++; d[e.b]++; }
        return d;
    };
    for (let pass = 0; pass < 4; pass++) {
        const d = degree();
        const before = edges.length;
        edges = edges.filter((e) => !((d[e.a] === 1 || d[e.b] === 1) && e.len < (e.level === 0 ? 60 : 32) && e.kind !== 'bridge'));
        if (edges.length === before) break;
    }
    // A road that ends at the water without a bridge leads nowhere: back to
    // its last junction, and again while what is left ends there too.
    const nearWater = opts.waterStub ?? 140;
    for (;;) {
        const d = degree();
        const before = edges.length;
        edges = edges.filter((e) => e.kind === 'bridge'
            || !((d[e.a] === 1 && field.water(nodes[e.a].x, nodes[e.a].z) < nearWater)
              || (d[e.b] === 1 && field.water(nodes[e.b].x, nodes[e.b].z) < nearWater)));
        if (edges.length === before) break;
    }

    // Compact nodes.
    const remap = new Int32Array(nodes.length).fill(-1);
    const nn = [];
    for (const e of edges) for (const k of ['a', 'b']) {
        if (remap[e[k]] < 0) { remap[e[k]] = nn.length; nn.push({ ...nodes[e[k]], edges: [] }); }
        e[k] = remap[e[k]];
    }
    edges.forEach((e, i) => { nn[e.a].edges.push(i); nn[e.b].edges.push(i); });

    // Junction merging moves an edge's ends; points just inside them would leave a short
    // skewed first segment that lots would align to. Drop them.
    for (const e of edges) {
        const p = e.pts, n = p.length / 2;
        if (n <= 2) continue;
        const keep = [p[0], p[1]];
        for (let k = 1; k < n - 1; k++) {
            const x = p[2 * k], z = p[2 * k + 1];
            if (Math.hypot(x - p[0], z - p[1]) < 10 || Math.hypot(x - p[2 * n - 2], z - p[2 * n - 1]) < 10) continue;
            keep.push(x, z);
        }
        keep.push(p[2 * n - 2], p[2 * n - 1]);
        e.pts = keep;
    }

    // 8. Widths and heights. A node's road class is its widest edge's.
    for (const e of edges) {
        const r = ROAD[e.kind] ?? ROAD.street;
        e.halfW = r.halfW; e.walkW = r.walkW;
    }
    for (const nd of nn) nd.y = field.site.height(nd.x, nd.z);
    for (const e of edges) gradeEdge(e, nn, field, opts);

    // A face with a bridge on its boundary holds water (the river between two
    // crossings), not a block.
    const faces = traceFaces(nn, edges).filter((f) => !f.halfEdges.some(([ei]) => edges[ei].kind === 'bridge'));
    // The half-edges of no block: a road's side facing out of the town (to
    // the water, to the country).
    const inFace = new Uint8Array(edges.length * 2);
    for (const f of faces) for (const [ei, dir] of f.halfEdges) inFace[ei * 2 + dir] = 1;
    const open = [];
    for (let k = 0; k < inFace.length; k++) if (!inFace[k]) open.push([k >> 1, k & 1]);
    return { nodes: nn, edges, faces, open };
}

/** Heights along an edge: the ground, smoothed, ends pinned to its junctions; a bridge arches over the water. */
function gradeEdge(e, nodes, field, opts) {
    if (e.kind === 'bridge') {
        e.pts = resample(e.pts, 8);   // points enough for the deck's arch
        // A bridge line split by a road on its bank leaves a dry piece: that is road.
        let wet = false;
        for (let i = 0; i < e.pts.length; i += 2) if (field.water(e.pts[i], e.pts[i + 1]) < 0) { wet = true; break; }
        if (!wet) e.kind = 'arterial';
    }
    const p = e.pts, n = p.length / 2;
    const ya = nodes[e.a].y, yb = nodes[e.b].y;
    const ys = new Float32Array(n);
    const s = new Float32Array(n);
    for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
    const total = s[n - 1] || 1;
    if (e.kind === 'bridge') {
        // One gentle crest from bank to bank (at most ~6 % for a 170 m span, level at both ends),
        // high enough to clear the water by 7 m at mid-span.
        const crest = Math.max(2.5, (opts.waterY ?? 0) + 7 - Math.max(ya, yb));
        for (let i = 0; i < n; i++) {
            const t = s[i] / total;
            const k = Math.sin(Math.PI * t);
            ys[i] = ya + (yb - ya) * t + crest * k * k;   // level at the banks: no kink at the junction
        }
    } else {
        for (let i = 0; i < n; i++) ys[i] = field.site.height(p[2 * i], p[2 * i + 1]);
        // Smooth in place over ~40 m, then pin the ends.
        for (let it = 0; it < 6; it++) {
            for (let i = 1; i < n - 1; i++) ys[i] = (ys[i - 1] + 2 * ys[i] + ys[i + 1]) * 0.25;
        }
        for (let i = 0; i < n; i++) {
            const wa = Math.max(0, 1 - s[i] / 30), wb = Math.max(0, 1 - (total - s[i]) / 30);
            const w = Math.max(wa, wb);
            ys[i] = ys[i] * (1 - w) + (wa > wb ? ya : yb) * w;
        }
        ys[0] = ya; ys[n - 1] = yb;
    }
    e.ys = Array.from(ys);
}

/** The polyline with points at most `step` metres apart (its own points kept). */
function resample(p, step) {
    const out = [p[0], p[1]];
    for (let k = 2; k < p.length; k += 2) {
        const x0 = p[k - 2], z0 = p[k - 1], x1 = p[k], z1 = p[k + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
        for (let i = 1; i <= n; i++) out.push(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n);
    }
    return out;
}

/** Bounded faces of the planar graph (CCW, area > 0), as half-edge cycles and polygons. */
function traceFaces(nodes, edges) {
    // Outgoing half-edges at each node sorted by angle; a half-edge is [edge, dir] (dir 0: a->b).
    const out = nodes.map(() => []);
    edges.forEach((e, ei) => {
        const p = e.pts;
        const a0 = Math.atan2(p[3] - p[1], p[2] - p[0]);
        const m = p.length;
        const b0 = Math.atan2(p[m - 3] - p[m - 1], p[m - 4] - p[m - 2]);
        out[e.a].push([ei, 0, a0]);
        out[e.b].push([ei, 1, b0]);
    });
    for (const o of out) o.sort((u, v) => u[2] - v[2]);
    const used = new Uint8Array(edges.length * 2);
    const faces = [];
    for (let ei = 0; ei < edges.length; ei++) for (let dir = 0; dir < 2; dir++) {
        if (used[ei * 2 + dir]) continue;
        const cyc = [];
        let ce = ei, cd = dir, guard = 0;
        let ok = true;
        while (guard++ < 4000) {
            if (used[ce * 2 + cd]) { ok = ce === ei && cd === dir; break; }
            used[ce * 2 + cd] = 1;
            cyc.push([ce, cd]);
            const e = edges[ce];
            const head = cd === 0 ? e.b : e.a;
            // At the head, the twin arrives; turn to the next half-edge clockwise from it
            // so the face lies on the left (CCW faces).
            const lst = out[head];
            let k = lst.findIndex((h) => h[0] === ce && h[1] === (1 - cd));
            if (k < 0) { ok = false; break; }
            const nxt = lst[(k - 1 + lst.length) % lst.length];
            ce = nxt[0]; cd = nxt[1];
        }
        if (!ok || cyc.length < 2) continue;
        const poly = [];
        for (const [ce2, cd2] of cyc) {
            const p = edges[ce2].pts;
            const m = p.length / 2;
            for (let k = 0; k < m - 1; k++) {
                const idx = cd2 === 0 ? k : m - 1 - k;
                poly.push(p[2 * idx], p[2 * idx + 1]);
            }
        }
        let area = 0;
        for (let i = 0; i < poly.length; i += 2) {
            const j = (i + 2) % poly.length;
            area += poly[i] * poly[j + 1] - poly[j] * poly[i + 1];
        }
        area *= 0.5;
        if (area > 0) faces.push({ halfEdges: cyc, poly, area });
    }
    return faces;
}
