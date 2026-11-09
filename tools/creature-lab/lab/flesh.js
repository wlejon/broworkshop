// A creature's body as one surface: named masses on the skeleton's bones,
// blended into one field and meshed once in the rest pose, so no two parts
// of the body can pass through each other.
//
//   const B = new Flesh(skel, { color });
//   B.blob('ribs', 'thorax', [0, 0.78, 0.15], [0.12, 0.19, 0.30], { blend: 0.05 });
//   B.limb('neck', ['neck1', 'neck2'], [{ c, r }, ...], { blend: 0.04 });
//   B.section('girth', { at, normal, bone, radius });
//   return B.build();
//
// A mass is an ellipsoid (`blob`) or a limb: a tube through key points,
// each with a radius or [side, up] radii (an elliptical section, its `up`
// leaning to the limb's `up` hint), splined between them, its spans joined
// with a rounding of `joint` (1 cm). Each has a `blend` (m): the distance
// over which it melts into the masses about it. A mass given `carve: true`
// takes the body away inside it instead (an ear's hollow, a nostril), cut
// with a rounding of about its blend; it has no weights or colour.
//
// The field (lab/flesh.bk, on the GPU). A mass at distance d (negative
// inside) contributes exp(-d / blend); the body is where the contributions
// sum to 1. A mass alone has exactly its own surface; two meeting fill the
// angle between them over about their blends, so a neck runs on into the
// chest instead of standing out of it. The field is sampled on a grid of
// `cell` (5 mm), meshed by surface nets, decimated to the body's triangle
// budget and every vertex put back on the surface along the field's
// gradient, its normal the gradient. A mass marked `keep` (true, or the
// margin in m about its box) keeps the grid's detail through decimation:
// its vertices are locked and the budget is spent on the rest, so an eye
// or a nose 3 cm across stays a shape rather than a couple of triangles.
//
// Skin weights come from the same field: a vertex goes to the bones of the
// masses about it, each mass by exp(-d / (blend * soft)) (`soft`, 1.6 by
// default, widens the hand-over beyond the shape's own blend), and within a
// mass to the bones its key points name, interpolated along it; then the
// weights are smoothed over the mesh's edges (`smoothWeights` passes). Where
// two masses blend, so do their bones. A blob's bone may be a name or
// [[name, weight], ...]; a limb's key point may carry its own `bone`, else
// the limb's `bones` give it (the nearest of them by distance).
//
// Colour: `color(p, n, share)` with share(name) the mass's part of the
// field at the vertex (0..1), so a hoof's colour ends where its mass does.
//
// Sections (`section`) are planes carried by a bone that lab/form.js cuts
// the skinned mesh with: girths, widths and areas at rest and in motion.
//
// build() returns what the lab draws and measures: mesh, skin (two vec4 a
// vertex for lab/skin.bk), positions, normals, indices, weights, the masses
// (name, bone, rest centre) and each vertex's main mass, the sections, and
// the one piece the finder sees.

import { readApp } from "./creature.js";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// The two sides of a bilateral creature: [sign of x, bone suffix].
export const SIDES = [[1, 'L'], [-1, 'R']];

// Contributions fade out between these multiples of a mass's blend (as flesh.bk).
const FADE1 = 4.6;
// A limb's joint rounds in full where its spans turn by BEND_FULL (rad),
// and by BEND_FLOOR of it where they run on straight.
const BEND_FULL = 25 * Math.PI / 180;
const BEND_FLOOR = 0.05;

let kernels = null;
function fleshKernels() {
    if (!kernels) {
        const m = bro.kernel.compile(readApp('lab/flesh.bk'), { file: 'lab/flesh.bk' });
        kernels = { field: m.kernel('k_field'), project: m.kernel('k_project'), masses: m.kernel('k_masses') };
    }
    return kernels;
}

// An orthonormal frame about `dir` with its up leaning to `hint`.
function frame(dir, hint) {
    const t = norm(dir);
    let side = cross(hint, t);
    if (Math.hypot(...side) < 1e-6) side = cross([1, 0, 0], t);
    side = norm(side);
    return { t, side, up: cross(t, side) };
}

// Catmull-Rom through key values, `steps` samples a span.
function spline(keys, steps, get) {
    const out = [], n = keys.length;
    for (let i = 0; i < n - 1; i++) {
        const p0 = get(keys[Math.max(0, i - 1)]), p1 = get(keys[i]), p2 = get(keys[i + 1]), p3 = get(keys[Math.min(n - 1, i + 2)]);
        for (let s = 0; s < steps; s++) {
            const t = s / steps, t2 = t * t, t3 = t2 * t;
            out.push(p1.map((_, k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
                + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
        }
    }
    out.push(get(keys[n - 1]).slice());
    return out;
}

// Bone weights [{ index, w }] mixed: a by 1 - s, b by s.
function mixWeights(a, b, s) {
    const m = new Map();
    for (const x of a) m.set(x.index, (m.get(x.index) || 0) + x.w * (1 - s));
    for (const x of b) m.set(x.index, (m.get(x.index) || 0) + x.w * s);
    return [...m].map(([index, w]) => ({ index, w }));
}

export class Flesh {
    // opts: cell (m, the meshing grid, 0.005), triangles (the budget,
    // 14000), simplifyError (how far decimating to the budget may move the
    // surface, a share of the body's size, 1e-3: a coarser level of detail
    // allows more), soft (the weights' blend over the shape's, 1.6),
    // smoothWeights (passes, 2), keep (whether the masses marked `keep`
    // keep their detail, true: a coarse level of detail spends nothing on
    // them), color.
    constructor(skel, opts = {}) {
        this.skel = skel;
        this.opts = { cell: 0.005, triangles: 14000, simplifyError: 1e-3, soft: 1.6, smoothWeights: 2, keep: true, ...opts };
        this.masses = [];
        this.sections = [];
    }

    // Bone weights by name or [[name, weight], ...], as [{ index, w }].
    boneWeights(spec) {
        const list = typeof spec === 'string' ? [[spec, 1]] : spec;
        const sum = list.reduce((s, [, w]) => s + w, 0);
        return list.map(([n, w]) => ({ index: this.skel.index(n), w: w / sum }));
    }

    // A point's weights among `bones` by its distance to each bone's rest
    // segment, the nearest dominating.
    nearestWeights(p, bones) {
        const ws = bones.map((n) => {
            const b = this.skel.bones[this.skel.index(n)];
            const ab = sub(b.tail, b.head), t = Math.max(0, Math.min(1, dot(sub(p, b.head), ab) / (dot(ab, ab) || 1e-9)));
            const d = Math.hypot(...sub(p, add(b.head, mul(ab, t))));
            return { index: b.index, w: 1 / Math.pow(d + 0.012, 4) };
        });
        const sum = ws.reduce((s, x) => s + x.w, 0);
        return ws.map((x) => ({ index: x.index, w: x.w / sum })).filter((x) => x.w > 0.01);
    }

    // An ellipsoid mass at c with radii r: [side, up, along] of its frame,
    // the world's x, y and z, or `dir` (along) with `up` leaning to opts.up.
    blob(name, bone, c, r, opts = {}) {
        const f = opts.dir ? frame(opts.dir, opts.up || [0, 1, 0]) : { t: [0, 0, 1], side: [1, 0, 0], up: [0, 1, 0] };
        const ext = [0, 1, 2].map((k) => Math.abs(f.side[k]) * r[0] + Math.abs(f.up[k]) * r[1] + Math.abs(f.t[k]) * r[2]);
        const w = this.boneWeights(bone);
        this.add(name, [{ kind: 0, a: c, ...f, L: 0, r: [r[0], r[1], r[2], 0], lo: sub(c, ext), hi: add(c, ext), w0: w, w1: w }], opts);
    }

    // A limb through key points { c, r: radius | [side, up], bone? },
    // splined `steps` (3) spans between keys, its sections' up leaning to
    // opts.up ([0, 1, 0]); `bones` weight the points that name no bone.
    limb(name, bones, points, opts = {}) {
        const steps = opts.steps || 3, hint = opts.up || [0, 1, 0];
        const ws = points.map((pt) => (pt.bone ? this.boneWeights(pt.bone) : this.nearestWeights(pt.c, bones)));
        const keys = points.map((pt) => ({ c: pt.c, r: Array.isArray(pt.r) ? pt.r : [pt.r, pt.r] }));
        const C = spline(keys, steps, (k) => k.c), R = spline(keys, steps, (k) => k.r);
        // The bones at sample j: the key points about it, mixed.
        const at = (j) => { const u = j / steps, k = Math.min(points.length - 2, Math.floor(u)); return mixWeights(ws[k], ws[k + 1], u - k); };
        const prims = [];
        let prevT = null;
        for (let i = 0; i + 1 < C.length; i++) {
            const d = sub(C[i + 1], C[i]), L = Math.hypot(...d);
            if (L < 1e-6) continue;
            const f = frame(d, hint);
            // The joint's rounding at this span's start, by how far the limb
            // bends there (full at BEND_FULL): a smooth minimum fills the
            // crease inside a bend, but between spans running on nearly
            // straight it would add its bulge all along them.
            const bend = prevT ? Math.min(1, Math.max(BEND_FLOOR, (1 - dot(prevT, f.t)) / (1 - Math.cos(BEND_FULL)))) : 1;
            prevT = f.t;
            const r0 = R[i].map((x) => Math.max(x, 1e-4)), r1 = R[i + 1].map((x) => Math.max(x, 1e-4));
            const m0 = Math.max(...r0), m1 = Math.max(...r1);
            prims.push({
                kind: 1, a: C[i], ...f, L, bend, r: [r0[0], r0[1], r1[0], r1[1]],
                lo: [0, 1, 2].map((k) => Math.min(C[i][k] - m0, C[i + 1][k] - m1)),
                hi: [0, 1, 2].map((k) => Math.max(C[i][k] + m0, C[i + 1][k] + m1)),
                w0: at(i), w1: at(i + 1),
            });
        }
        this.add(name, prims, { joint: 0.01, ...opts });
    }

    add(name, prims, opts) {
        if (this.masses.some((m) => m.name === name)) throw new Error(`flesh: two masses named ${name}`);
        const lo = [0, 1, 2].map((k) => Math.min(...prims.map((p) => p.lo[k])));
        const hi = [0, 1, 2].map((k) => Math.max(...prims.map((p) => p.hi[k])));
        const bones = new Map();
        for (const p of prims) for (const x of [...p.w0, ...p.w1]) bones.set(x.index, (bones.get(x.index) || 0) + x.w);
        this.masses.push({
            name, prims, blend: opts.blend ?? 0.03, soft: opts.soft ?? this.opts.soft, joint: opts.joint ?? 0, lo, hi,
            keep: opts.keep ?? false,
            carve: opts.carve ?? false,
            // The rest centre, the middle of its extent: lab/form.js measures
            // its volume from there.
            centre: lo.map((v, k) => (v + hi[k]) / 2),
            bone: [...bones].sort((a, b) => b[1] - a[1])[0][0],
        });
    }

    // A plane form.js cuts the mesh with: through `at`, square to `normal`,
    // riding `bone`, or halfway between two bones ([a, b]: a joint's
    // bisector); the cut is the loop about `at` within `radius`.
    section(name, { at, normal, bone, radius = 0.4 }) {
        const bones = (Array.isArray(bone) ? bone : [bone]).map((b) => this.skel.index(b));
        this.sections.push({ name, at, normal: norm(normal), bones, radius });
    }

    // The masses and their primitives as flesh.bk reads them.
    pack() {
        const prims = this.masses.flatMap((m) => m.prims);
        const P = new Float32Array(prims.length * 32);
        prims.forEach((q, i) => {
            P.set([q.kind, q.L, q.bend ?? 1, 0, ...q.a, 0, ...q.t, 0, ...q.side, 0, ...q.up, 0, ...q.r, ...q.lo, 0, ...q.hi, 0], 32 * i);
        });
        const M = new Float32Array(this.masses.length * 12);
        let first = 0;
        this.masses.forEach((m, i) => {
            M.set([first, m.prims.length, m.blend, m.joint, ...m.lo, m.soft, ...m.hi, m.carve ? 1 : 0], 12 * i);
            first += m.prims.length;
        });
        return { prims, P, M };
    }

    build() {
        const t0 = Date.now();
        const K = fleshKernels();
        const { prims, P, M } = this.pack();
        const nm = this.masses.length;
        const primBuf = bro.kernel.createBuffer(P), massBuf = bro.kernel.createBuffer(M);
        const cell = this.opts.cell;
        const pad = Math.max(...this.masses.map((m) => m.blend)) + 3 * cell;
        const lo = [0, 1, 2].map((k) => Math.min(...this.masses.map((m) => m.lo[k])) - pad);
        const hi = [0, 1, 2].map((k) => Math.max(...this.masses.map((m) => m.hi[k])) + pad);
        const dim = [0, 1, 2].map((k) => Math.ceil((hi[k] - lo[k]) / cell) + 1);
        const fieldBuf = K.field.dispatch(dim, primBuf, massBuf, nm, lo, cell);
        const S = fieldBuf.read(new Float32Array(dim[0] * dim[1] * dim[2]));
        fieldBuf.destroy();
        const t1 = Date.now();
        const raw = Mesh.surfaceNets(S, dim[0], dim[1], dim[2], 0);
        const rawTris = raw.indices.length / 3;
        // The kept masses' vertices stay as meshed: decimation spends the
        // budget on the rest.
        const kept = this.opts.keep ? this.masses.filter((m) => m.keep) : [];
        let lock = null, locked = 0;
        if (kept.length && rawTris > this.opts.triangles) {
            const G = raw.positions, nv0 = G.length / 3;
            lock = new Uint8Array(nv0);
            const boxes = kept.map((m) => {
                const g = m.keep === true ? 2 * m.blend + 2 * cell : m.keep;
                return { lo: m.lo.map((x) => x - g), hi: m.hi.map((x) => x + g) };
            });
            for (let v = 0; v < nv0; v++) {
                const p = [0, 1, 2].map((k) => lo[k] + G[3 * v + k] * cell);
                if (boxes.some((b) => p.every((x, k) => x >= b.lo[k] && x <= b.hi[k]))) { lock[v] = 1; locked++; }
            }
        }
        if (rawTris > this.opts.triangles) raw.simplifyToTriangleCount(this.opts.triangles, this.opts.simplifyError, lock);
        // Triangles in vertex-cache order and vertices in first-use order:
        // the skin hook blends four bones a vertex, so each one shaded again
        // costs (twice the herd's shadow pass in the order decimation leaves).
        raw.optimize();
        const t2 = Date.now();
        // Back into the body's space, then onto the surface.
        const G = raw.positions, idx = raw.indices, nv = G.length / 3;
        const start = new Float32Array(nv * 3);
        for (let v = 0; v < 3 * nv; v++) start[v] = lo[v % 3] + G[v] * cell;
        const startBuf = bro.kernel.createBuffer(start), projBuf = bro.kernel.createBuffer(nv * 32);
        K.project.dispatch(nv, primBuf, massBuf, nm, startBuf, cell, projBuf);
        const PN = projBuf.read(new Float32Array(nv * 8));
        const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
        let offSurface = 0;
        for (let v = 0; v < nv; v++) {
            for (let k = 0; k < 3; k++) { pos[3 * v + k] = PN[8 * v + k]; nrm[3 * v + k] = PN[8 * v + 4 + k]; }
            offSurface = Math.max(offSurface, Math.abs(PN[8 * v + 3]));
        }
        const massOut = bro.kernel.createBuffer(nv * nm * 16);
        K.masses.dispatch([nv, nm], primBuf, massBuf, projBuf, massOut);
        const MD = massOut.read(new Float32Array(nv * nm * 4));
        for (const b of [primBuf, massBuf, startBuf, projBuf, massOut]) b.destroy();
        const t3 = Date.now();
        const { weights, vertexMass, shares } = this.weigh(MD, prims, nv, idx);
        const swell = this.swell(MD, nv, vertexMass, shares);
        const col = new Float32Array(nv * 4);
        const color = this.opts.color;
        for (let v = 0; v < nv; v++) {
            const p = [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]], n = [nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]];
            const sh = shares[v];
            const c = color ? color(p, n, (name) => sh.get(name) || 0) : [0.6, 0.6, 0.6];
            // Colours are given as display (sRGB) values; the mesh takes linear.
            for (let k = 0; k < 3; k++) col[4 * v + k] = Math.pow(Math.max(0, c[k]), 2.2);
            col[4 * v + 3] = 1;
        }
        const skin = new Float32Array(nv * 8);
        for (let v = 0; v < nv; v++) weights[v].forEach((x, j) => { skin[8 * v + j] = x.w; skin[8 * v + 4 + j] = x.index; });
        const indices = new Uint32Array(idx);
        const mesh = new Mesh({ positions: pos, normals: nrm, colors: col, indices });
        return {
            mesh, skin, vertices: nv, triangles: indices.length / 3, positions: pos, normals: nrm, indices, weights,
            pieces: [{ name: 'body', kind: 'flesh', base: 0, count: nv, start: 0, end: indices.length }], piece: new Float32Array(nv),
            masses: this.masses.map((m) => ({ name: m.name, bone: m.bone, centre: m.centre })), vertexMass,
            sections: this.sections, swell,
            build: { grid: dim, cell, rawTriangles: rawTris, locked, offSurface, ms: { field: t1 - t0, mesh: t2 - t1, place: t3 - t2, total: Date.now() - t0 } },
        };
    }

    // How far each mass's skin stands off the shape it declares: over the
    // vertices that are its alone (its share of the field 0.95 or more, so
    // not the fillets where it blends), the distance from its nearest
    // primitive, positive outside. A mass's own skin is on its shape but for
    // the rounding of its span joints, so this is what the rounding adds
    // (m: the median and the 90th percentile).
    swell(MD, nv, vertexMass, shares) {
        const out = [];
        this.masses.forEach((m, mi) => {
            if (m.carve) return;
            const ds = [];
            for (let v = 0; v < nv; v++) {
                if (vertexMass[v] !== mi || (shares[v].get(m.name) || 0) < 0.95) continue;
                ds.push(MD[4 * (mi * nv + v) + 3]);
            }
            if (ds.length < 8) return;
            ds.sort((a, b) => a - b);
            out.push({ name: m.name, vertices: ds.length, median: ds[ds.length >> 1], p90: ds[Math.floor(0.9 * (ds.length - 1))] });
        });
        return out;
    }

    // Each vertex's bone weights (the four largest), its main mass and every
    // mass's share of the field there, from flesh.bk's distances (MD: per
    // mass, per vertex, (d, primitive, along, 0)).
    weigh(MD, prims, nv, idx) {
        const nb = this.skel.count, nm = this.masses.length;
        const W = new Float32Array(nv * nb);
        const vertexMass = new Int32Array(nv);
        const shares = new Array(nv);
        for (let v = 0; v < nv; v++) {
            let total = 0, best = 0, bestC = -1;
            const sh = new Map();
            for (let mi = 0; mi < nm; mi++) {
                const o = 4 * (mi * nv + v), pi = MD[o + 1];
                if (pi < 0) continue;
                const m = this.masses[mi], d = MD[o], q = prims[pi];
                const c = Math.exp(-Math.max(d, -m.blend) / m.blend);
                if (d < FADE1 * m.blend) { sh.set(m.name, c); total += c; }
                if (c > bestC) { bestC = c; best = mi; }
                const cw = Math.exp(-Math.max(d, -m.blend) / (m.blend * m.soft));
                for (const x of mixWeights(q.w0, q.w1, MD[o + 2])) W[v * nb + x.index] += cw * x.w;
            }
            for (const [k, c] of sh) sh.set(k, c / (total || 1));
            shares[v] = sh;
            vertexMass[v] = best;
        }
        for (let v = 0; v < nv; v++) {
            let s = 0;
            for (let b = 0; b < nb; b++) s += W[v * nb + b];
            for (let b = 0; b < nb; b++) W[v * nb + b] /= s || 1;
        }
        // Smoothing over the mesh: each vertex halfway to its neighbours' mean.
        const nbr = Array.from({ length: nv }, () => new Set());
        for (let i = 0; i < idx.length; i += 3) for (let e = 0; e < 3; e++) {
            const a = idx[i + e], b = idx[i + (e + 1) % 3];
            nbr[a].add(b); nbr[b].add(a);
        }
        for (let it = 0; it < this.opts.smoothWeights; it++) {
            const N = new Float32Array(W.length);
            for (let v = 0; v < nv; v++) {
                const ns = nbr[v], k = 0.5 / (ns.size || 1);
                for (let b = 0; b < nb; b++) N[v * nb + b] = 0.5 * W[v * nb + b];
                for (const u of ns) for (let b = 0; b < nb; b++) N[v * nb + b] += k * W[u * nb + b];
            }
            W.set(N);
        }
        const weights = new Array(nv);
        for (let v = 0; v < nv; v++) {
            const ws = [];
            for (let b = 0; b < nb; b++) if (W[v * nb + b] > 0.01) ws.push({ index: b, w: W[v * nb + b] });
            ws.sort((a, b) => b.w - a.w);
            const top = ws.slice(0, 4), s = top.reduce((a, x) => a + x.w, 0);
            weights[v] = top.map((x) => ({ index: x.index, w: x.w / s }));
        }
        return { weights, vertexMass, shares };
    }
}
