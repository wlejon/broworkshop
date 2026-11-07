// Where a body shows hard lines, measured on its skinned mesh: no reference
// needed, so it judges any creature the lab loads.
//
//   crossings  where two separate pieces' surfaces pass through each other
//              (a body's `pieces`; a lab/flesh.js body is one piece, with
//              detail such as hooves attached only where it never crosses):
//              the curve they cross along, its length and the angle between
//              the two surfaces there. Two surfaces meeting at an angle draw
//              a line however they are shaded; a real body's skin is one
//              surface.
//   folds      a piece's surface passing through itself (the same test
//              between its own triangles that share no vertex), labelled by
//              the masses on either side
//   creases    edges whose dihedral angle has sharpened past its rest angle
//              by more than CREASE degrees: the skin kinking at a joint
//   bone pull  each vertex's distance from its main bone against rest: skin
//              pulled away from the bone or squeezed into it
//
// A site's `score` is the line it draws in centimetres weighted by its
// sharpness (length x angle / 90 degrees), the same unit for every kind, so
// sites rank against each other. Sites are keyed by the pieces they are on
// (and for creases and folds the main bone of the skin there), so the same
// site is followed from frame to frame.

import { ROWS } from "./skeleton.js";

export const SEAMS = {
    crease: 25,        // degrees of sharpening past rest before an edge counts
    cell: 0.04,        // m: the broad phase's grid cell
    pull: 0.3,         // bone pull: |ratio - 1| past this counts
};

const DEG = 180 / Math.PI;

// What a body's mesh needs for the measures, built once per creature.
export function seamTopology(creature) {
    if (creature._seams) return creature._seams;
    const body = creature.body, skel = creature.skel;
    const idx = body.indices, nt = idx.length / 3, nv = body.positions.length / 3;
    const pieces = body.pieces;
    const triPiece = new Int32Array(nt);
    pieces.forEach((p, i) => { for (let t = p.start / 3; t < p.end / 3; t++) triPiece[t] = i; });
    // Each vertex's main bone and the label of the skin there.
    const mainBone = new Int32Array(nv);
    for (let v = 0; v < nv; v++) mainBone[v] = body.weights[v][0].index;
    // A body of masses (lab/flesh.js) names the skin by its mass, else by its bone.
    const label = body.vertexMass
        ? (v) => `${body.masses[body.vertexMass[v]].name} over ${skel.bones[mainBone[v]].name}`
        : (v) => `${pieces[body.piece[v]].name} over ${skel.bones[mainBone[v]].name}`;
    // Interior edges: the two triangles each joins.
    const edgeMap = new Map();
    const ea = [], eb = [], et0 = [], et1 = [];
    for (let t = 0; t < nt; t++) {
        for (let e = 0; e < 3; e++) {
            const a = idx[3 * t + e], b = idx[3 * t + (e + 1) % 3];
            const key = a < b ? a * nv + b : b * nv + a;
            const at = edgeMap.get(key);
            if (at === undefined) edgeMap.set(key, ea.length), ea.push(Math.min(a, b)), eb.push(Math.max(a, b)), et0.push(t), et1.push(-1);
            else et1[at] = t;
        }
    }
    const edges = { a: Int32Array.from(ea), b: Int32Array.from(eb), t0: Int32Array.from(et0), t1: Int32Array.from(et1) };
    const restN = faceNormals(body.positions, idx);
    const restDihedral = dihedrals(restN, edges);
    const restPull = bonePull(creature, body.positions, mainBone);
    creature._seams = { nt, nv, triPiece, mainBone, label, edges, restDihedral, restPull, pieces };
    return creature._seams;
}

export function faceNormals(X, idx) {
    const nt = idx.length / 3, N = new Float32Array(nt * 3);
    for (let t = 0; t < nt; t++) {
        const a = 3 * idx[3 * t], b = 3 * idx[3 * t + 1], c = 3 * idx[3 * t + 2];
        const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2];
        const vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        N[3 * t] = nx / l; N[3 * t + 1] = ny / l; N[3 * t + 2] = nz / l;
    }
    return N;
}

// The angle (degrees) between the two faces at each interior edge; -1 on a border.
function dihedrals(N, edges) {
    const n = edges.a.length, out = new Float32Array(n);
    for (let e = 0; e < n; e++) {
        const s = edges.t0[e], t = edges.t1[e];
        if (t < 0) { out[e] = -1; continue; }
        const d = N[3 * s] * N[3 * t] + N[3 * s + 1] * N[3 * t + 1] + N[3 * s + 2] * N[3 * t + 2];
        out[e] = Math.acos(Math.max(-1, Math.min(1, d))) * DEG;
    }
    return out;
}

// Each vertex's distance from its main bone's segment, in pose X (the bones
// placed by pose P at offset o, or at rest when P is null).
function bonePull(creature, X, mainBone, P = null, o = 0) {
    const bones = creature.skel.bones, nv = X.length / 3;
    const seg = bones.map((b) => {
        if (!P) return [b.head, b.tail];
        const k = o + b.index * ROWS;
        const h = [P[k + 3], P[k + 7], P[k + 11]];
        const d = [b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]];
        return [h, [h[0] + P[k] * d[0] + P[k + 1] * d[1] + P[k + 2] * d[2], h[1] + P[k + 4] * d[0] + P[k + 5] * d[1] + P[k + 6] * d[2],
                     h[2] + P[k + 8] * d[0] + P[k + 9] * d[1] + P[k + 10] * d[2]]];
    });
    const out = new Float32Array(nv);
    for (let v = 0; v < nv; v++) {
        const [a, b] = seg[mainBone[v]];
        const ab0 = b[0] - a[0], ab1 = b[1] - a[1], ab2 = b[2] - a[2];
        const p0 = X[3 * v] - a[0], p1 = X[3 * v + 1] - a[1], p2 = X[3 * v + 2] - a[2];
        const t = Math.max(0, Math.min(1, (p0 * ab0 + p1 * ab1 + p2 * ab2) / (ab0 * ab0 + ab1 * ab1 + ab2 * ab2 || 1e-9)));
        out[v] = Math.hypot(p0 - ab0 * t, p1 - ab1 * t, p2 - ab2 * t);
    }
    return out;
}

// The segment where triangles (a0 a1 a2) and (b0 b1 b2) cross, or null.
// Each is given by vertex offsets into X.
function triTri(X, A, B, nA, nB) {
    const dA = planeDists(X, A, nB, B[0]);
    if (!dA) return null;
    const dB = planeDists(X, B, nA, A[0]);
    if (!dB) return null;
    const pa = crossPoints(X, A, dA), pb = crossPoints(X, B, dB);
    if (!pa || !pb) return null;
    const D = [nA[1] * nB[2] - nA[2] * nB[1], nA[2] * nB[0] - nA[0] * nB[2], nA[0] * nB[1] - nA[1] * nB[0]];
    if (D[0] * D[0] + D[1] * D[1] + D[2] * D[2] < 1e-12) return null;   // parallel planes
    const t = (p) => p[0] * D[0] + p[1] * D[1] + p[2] * D[2];
    const sa = t(pa[0]) <= t(pa[1]) ? pa : [pa[1], pa[0]];
    const sb = t(pb[0]) <= t(pb[1]) ? pb : [pb[1], pb[0]];
    const lo = t(sa[0]) >= t(sb[0]) ? sa[0] : sb[0];
    const hi = t(sa[1]) <= t(sb[1]) ? sa[1] : sb[1];
    if (t(hi) <= t(lo)) return null;
    return [lo, hi];
}

function planeDists(X, T, n, p0) {
    const o = n[0] * X[3 * p0] + n[1] * X[3 * p0 + 1] + n[2] * X[3 * p0 + 2];
    const d = [0, 0, 0];
    let pos = 0, neg = 0;
    for (let i = 0; i < 3; i++) {
        let v = n[0] * X[3 * T[i]] + n[1] * X[3 * T[i] + 1] + n[2] * X[3 * T[i] + 2] - o;
        if (Math.abs(v) < 1e-9) v = 1e-9;
        d[i] = v;
        if (v > 0) pos++; else neg++;
    }
    return pos && neg ? d : null;
}

function crossPoints(X, T, d) {
    const out = [];
    for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        if ((d[i] > 0) === (d[j] > 0)) continue;
        const s = d[i] / (d[i] - d[j]), a = 3 * T[i], b = 3 * T[j];
        out.push([X[a] + (X[b] - X[a]) * s, X[a + 1] + (X[b + 1] - X[a + 1]) * s, X[a + 2] + (X[b + 2] - X[a + 2]) * s]);
    }
    return out.length === 2 ? out : null;
}

// A site's running sums.
function siteAdd(sites, key, kind, f) {
    let s = sites.get(key);
    if (!s) {
        s = { key, kind, a: f.a, b: f.b, where: f.where, length: 0, score: 0, angleMax: 0, sum: [0, 0, 0], nsum: [0, 0, 0], w: 0, worstAt: null, worstAngle: -1 };
        sites.set(key, s);
    }
    s.length += f.len;
    s.score += f.len * 100 * (f.angle / 90);
    s.angleMax = Math.max(s.angleMax, f.angle);
    for (let k = 0; k < 3; k++) { s.sum[k] += f.mid[k] * f.len; s.nsum[k] += f.n[k] * f.len; }
    s.w += f.len;
    if (f.angle > s.worstAngle) { s.worstAngle = f.angle; s.worstAt = f.mid; s.where = f.where; }
}

const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r1 = (x) => Math.round(x * 10) / 10;

// The measures of one posed mesh X (skinned positions; P/o the pose, for
// bone pull). Returns { sites: [...], pull: {...}, volume: {...} }: each
// site with its kind, pieces, where (the skin's label at its sharpest
// point), length (m), score, its sharpest angle, its centre and the mean
// outward normal there (to look at it from).
export function measureMesh(creature, X, P = null, o = 0) {
    const topo = seamTopology(creature);
    const body = creature.body, idx = body.indices, nt = topo.nt;
    const N = faceNormals(X, idx);
    const sites = new Map();
    // Broad phase: triangles binned into a grid by their bounds.
    const cs = SEAMS.cell, box = new Float32Array(nt * 6);
    const grid = new Map();
    for (let t = 0; t < nt; t++) {
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
        for (let e = 0; e < 3; e++) {
            const v = 3 * idx[3 * t + e];
            x0 = Math.min(x0, X[v]); x1 = Math.max(x1, X[v]); y0 = Math.min(y0, X[v + 1]); y1 = Math.max(y1, X[v + 1]); z0 = Math.min(z0, X[v + 2]); z1 = Math.max(z1, X[v + 2]);
        }
        box.set([x0, y0, z0, x1, y1, z1], 6 * t);
        for (let i = Math.floor(x0 / cs); i <= Math.floor(x1 / cs); i++)
            for (let j = Math.floor(y0 / cs); j <= Math.floor(y1 / cs); j++)
                for (let k = Math.floor(z0 / cs); k <= Math.floor(z1 / cs); k++) {
                    const key = (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);
                    let c = grid.get(key);
                    if (!c) grid.set(key, c = []);
                    c.push(t);
                }
    }
    const seen = new Int32Array(nt).fill(-1);
    const A = [0, 0, 0], B = [0, 0, 0];
    for (let t = 0; t < nt; t++) {
        const bx = 6 * t;
        for (let i = Math.floor(box[bx] / cs); i <= Math.floor(box[bx + 3] / cs); i++)
            for (let j = Math.floor(box[bx + 1] / cs); j <= Math.floor(box[bx + 4] / cs); j++)
                for (let k = Math.floor(box[bx + 2] / cs); k <= Math.floor(box[bx + 5] / cs); k++) {
                    const c = grid.get((i + 512) * 1048576 + (j + 512) * 1024 + (k + 512));
                    for (const u of c) {
                        if (u <= t || seen[u] === t) continue;
                        seen[u] = t;
                        const ux = 6 * u;
                        if (box[ux] > box[bx + 3] || box[ux + 3] < box[bx] || box[ux + 1] > box[bx + 4] || box[ux + 4] < box[bx + 1]
                            || box[ux + 2] > box[bx + 5] || box[ux + 5] < box[bx + 2]) continue;
                        const same = topo.triPiece[t] === topo.triPiece[u];
                        for (let e = 0; e < 3; e++) { A[e] = idx[3 * t + e]; B[e] = idx[3 * u + e]; }
                        if (same && (A[0] === B[0] || A[0] === B[1] || A[0] === B[2] || A[1] === B[0] || A[1] === B[1] || A[1] === B[2]
                            || A[2] === B[0] || A[2] === B[1] || A[2] === B[2])) continue;
                        const nA = [N[3 * t], N[3 * t + 1], N[3 * t + 2]], nB = [N[3 * u], N[3 * u + 1], N[3 * u + 2]];
                        const seg = triTri(X, A, B, nA, nB);
                        if (!seg) continue;
                        const len = Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1], seg[1][2] - seg[0][2]);
                        if (len < 1e-5) continue;
                        const cosv = nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2];
                        const angle = Math.acos(Math.max(-1, Math.min(1, cosv))) * DEG;
                        const mid = [(seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2, (seg[0][2] + seg[1][2]) / 2];
                        const n = [nA[0] + nB[0], nA[1] + nB[1], nA[2] + nB[2]];
                        let pa = topo.pieces[topo.triPiece[t]].name, pb = topo.pieces[topo.triPiece[u]].name;
                        if (pa > pb) [pa, pb] = [pb, pa];
                        if (same) {
                            // The skin on both sides of the fold, when they differ.
                            let where = topo.label(A[0]);
                            const other = topo.label(B[0]);
                            if (other !== where) where = where < other ? `${where} x ${other}` : `${other} x ${where}`;
                            siteAdd(sites, `fold ${where}`, 'fold', { a: pa, b: pa, where, len, angle, mid, n });
                        } else {
                            // The crossing's label is the skin of the larger piece, where the other comes through.
                            const big = (body.pieces[topo.triPiece[t]].count >= body.pieces[topo.triPiece[u]].count) ? A[0] : B[0];
                            siteAdd(sites, `cross ${pa} x ${pb}`, 'cross', { a: pa, b: pb, where: topo.label(big), len, angle, mid, n });
                        }
                    }
                }
    }
    // Creases: edges sharper than at rest.
    const E = topo.edges, nE = E.a.length;
    for (let e = 0; e < nE; e++) {
        const s = E.t0[e], t = E.t1[e];
        if (t < 0) continue;
        const d = N[3 * s] * N[3 * t] + N[3 * s + 1] * N[3 * t + 1] + N[3 * s + 2] * N[3 * t + 2];
        const ang = Math.acos(Math.max(-1, Math.min(1, d))) * DEG;
        const ex = ang - topo.restDihedral[e];
        if (ex < SEAMS.crease) continue;
        const a = 3 * E.a[e], b = 3 * E.b[e];
        const len = Math.hypot(X[b] - X[a], X[b + 1] - X[a + 1], X[b + 2] - X[a + 2]);
        const where = topo.label(E.a[e]);
        const piece = topo.pieces[topo.triPiece[s]].name;
        siteAdd(sites, `crease ${where}`, 'crease', {
            a: piece, b: piece, where, len, angle: ex,
            mid: [(X[a] + X[b]) / 2, (X[a + 1] + X[b + 1]) / 2, (X[a + 2] + X[b + 2]) / 2],
            n: [N[3 * s] + N[3 * t], N[3 * s + 1] + N[3 * t + 1], N[3 * s + 2] + N[3 * t + 2]],
        });
    }
    const out = [];
    for (const s of sites.values()) {
        const c = s.sum.map((v) => v / s.w), nl = Math.hypot(...s.nsum) || 1;
        out.push({
            key: s.key, kind: s.kind, a: s.a, b: s.b, where: s.where, length: r4(s.length), score: r1(s.score),
            angleMax: r1(s.angleMax), meanAngle: r1(s.score / (s.length * 100) * 90),
            centre: c.map(r4), normal: s.nsum.map((v) => r4(v / nl)), worstAt: s.worstAt.map(r4),
        });
    }
    out.sort((x, y) => y.score - x.score);
    return { sites: out, pull: P ? pullBy(creature, X, P, o) : null };
}

// Bone pull by the skin's label: the worst ratio either way per label.
function pullBy(creature, X, P, o) {
    const topo = seamTopology(creature);
    const d = bonePull(creature, X, topo.mainBone, P, o);
    const by = new Map();
    for (let v = 0; v < topo.nv; v++) {
        const r0 = topo.restPull[v];
        if (r0 < 0.01) continue;
        const r = d[v] / r0;
        const l = topo.label(v);
        let s = by.get(l);
        if (!s) by.set(l, s = { min: Infinity, max: -Infinity });
        s.min = Math.min(s.min, r); s.max = Math.max(s.max, r);
    }
    return Object.fromEntries([...by].map(([k, s]) => [k, { min: r4(s.min), max: r4(s.max) }]));
}

// A closed piece's enclosed volume (divergence theorem); null for an open one.
export function pieceVolume(X, idx, piece) {
    let v = 0;
    for (let i = piece.start; i < piece.end; i += 3) {
        const a = 3 * idx[i], b = 3 * idx[i + 1], c = 3 * idx[i + 2];
        v += (X[a] * (X[b + 1] * X[c + 2] - X[b + 2] * X[c + 1]) + X[a + 1] * (X[b + 2] * X[c] - X[b] * X[c + 2])
            + X[a + 2] * (X[b] * X[c + 1] - X[b + 1] * X[c])) / 6;
    }
    return Math.abs(v);
}

// Whether a piece is closed: every edge of its triangles is shared by two.
export function pieceClosed(creature, i) {
    const topo = seamTopology(creature), E = topo.edges;
    for (let e = 0; e < E.a.length; e++) if (topo.triPiece[E.t0[e]] === i && E.t1[e] < 0) return false;
    return true;
}
