// demos/foundry/geom.js — the geometry kit the foundry's parts are modelled with.
//
// A Geo collects triangles with, per vertex: position, normal, a linear
// colour, and uv = (material, edge). shaders/part.bk reads the material id
// and the edge weight (1 on a sharp convex edge, 0 inside a face) to wear
// paint off edges and catch highlights; colour alpha carries ambient
// occlusion, baked once per mesh (finish()).
//
// Shapes are built in a local frame whose axis is Z and then placed with a
// frame { at, axis } (axis 'x' | 'y' | 'z' | '-x' ...): lathe() turns a
// profile, ring() extrudes a star-shaped outline (gears, sprockets) with
// chamfers, cbox() is a box with chamfered edges, tube() sweeps a circle
// along a polyline (hoses, cables).

export const M = {
    STEEL: 0,       // machined steel
    PAINT: 1,       // painted casting / plate (vertex colour is the paint)
    CAST: 2,        // dark oxide / cast iron
    BRASS: 3,       // brass, bronze
    COPPER: 4,
    RUBBER: 5,      // black rubber / plastic
    ALU: 6,         // bead-blasted aluminium
    GLOW: 7,        // emissive (vertex colour is the light)
    CHROME: 8,      // hard-chromed rod
};

const TAU = Math.PI * 2;

export function lin(c) { return [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)]; }
export function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

// Local (u, v, w) with w the frame axis -> frame coordinates.
function framer(f) {
    const at = (f && f.at) || [0, 0, 0];
    const ax = (f && f.axis) || 'z';
    const map = {
        z: (u, v, w) => [u, v, w], '-z': (u, v, w) => [-u, v, -w],
        x: (u, v, w) => [w, v, -u], '-x': (u, v, w) => [-w, v, u],
        y: (u, v, w) => [u, w, -v], '-y': (u, v, w) => [u, -w, v],
    }[ax];
    if (!map) throw new Error('geom: axis ' + ax);
    return {
        p: (u, v, w) => { const r = map(u, v, w); return [r[0] + at[0], r[1] + at[1], r[2] + at[2]]; },
        n: (u, v, w) => map(u, v, w),
    };
}

export class Geo {
    constructor() { this.p = []; this.n = []; this.c = []; this.u = []; this.i = []; this.fineTris = []; }

    get count() { return this.p.length / 3; }

    vert(pos, nrm, col, mat, edge = 0) {
        const k = this.count;
        this.p.push(pos[0], pos[1], pos[2]);
        const l = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
        this.n.push(nrm[0] / l, nrm[1] / l, nrm[2] / l);
        this.c.push(col[0], col[1], col[2], 1);
        this.u.push(mat, edge);
        return k;
    }

    tri(a, b, c) { this.i.push(a, b, c); }

    /** Flat quad, counter-clockwise seen from outside. */
    quad(a, b, c, d, col, mat, edge = 0) {
        const n = faceNormal(a, b, c);
        const i0 = this.vert(a, n, col, mat, edge), i1 = this.vert(b, n, col, mat, edge);
        const i2 = this.vert(c, n, col, mat, edge), i3 = this.vert(d, n, col, mat, edge);
        this.i.push(i0, i1, i2, i0, i2, i3);
    }

    /**
     * Surface of revolution. profile: [[r, w], ...] walked from one end to the
     * other; r = 0 closes an end. Each profile segment is its own band, so the
     * turned shoulders and chamfers stay crisp; a band shorter than the segment
     * before gets the edge weight that wears and catches light.
     */
    lathe(profile, opts) {
        const o = opts || {};
        const segs = o.segs || 32;
        const F = framer(o);
        const col = o.color, mat = o.mat ?? M.STEEL;
        const a0 = o.phase || 0;
        // A solid's profile runs counter-clockwise in (r, w): out along its
        // low end, up its outside, in across its high end. One traced the
        // other way (toward -w) is the mirror image: turn it outside-out by
        // its signed area, closing it along the axis.
        let area = 0;
        for (let s = 0; s < profile.length; s++) {
            const [r0, w0] = profile[s], [r1, w1] = profile[(s + 1) % profile.length];
            area += r0 * w1 - r1 * w0;
        }
        const flip = !!o.inside !== (area < 0);
        // Long segments are cut into near-square quads, so the baked
        // occlusion is sampled across a face and not smeared along slivers.
        // A quad's width is the circumference where it sits over `segs`, so
        // rings close in toward the axis: a disc's centre (often buried under
        // a shaft, and dark) reaches no further than its first small ring.
        const rMax = Math.max(...profile.map((q) => q[0]), 1e-6);
        const pts = [profile[0]];
        for (let s = 0; s + 1 < profile.length; s++) {
            const [r0, w0] = profile[s], [r1, w1] = profile[s + 1];
            const len = Math.hypot(r1 - r0, w1 - w0);
            // Breakpoints from the end nearer the axis outward, as fractions of the segment.
            const a = Math.min(r0, r1), b = Math.max(r0, r1);
            const radial = b - a > Math.abs(w1 - w0);
            const minStep = radial ? len / 48 : len / 12;
            const cap = radial ? 47 : 11;
            const ts = [];
            for (let u = 0; ;) {
                const r = a + (b - a) * (len > 0 ? u / len : 0);
                u += Math.max(minStep, (1.5 * TAU * Math.max(r, rMax * 0.02)) / segs);
                if (u >= len * 0.999 || ts.length >= cap) break;
                ts.push(u / len);
            }
            ts.push(1);
            const fromInner = r0 <= r1;
            const ks = fromInner ? ts : ts.slice(0, -1).map((t) => 1 - t).reverse().concat(1);
            for (const t of ks) pts.push([r0 + (r1 - r0) * t, w0 + (w1 - w0) * t, len]);
        }
        for (let s = 0; s + 1 < pts.length; s++) {
            const [r0, w0] = pts[s], [r1, w1, segLen] = pts[s + 1];
            if (r0 === r1 && w0 === w1) continue;
            const dr = r1 - r0, dw = w1 - w0;
            // Outward 2D normal of the segment in (r, w).
            let nr = dw, nw = -dr;
            const nl = Math.hypot(nr, nw) || 1; nr /= nl; nw /= nl;
            if (flip) { nr = -nr; nw = -nw; }
            const edge = o.edges === false ? 0 : (segLen < (o.chamfer || 0.0025) * 1.6 ? 0.85 : 0);
            const ring = [];
            for (let k = 0; k <= segs; k++) {
                const a = a0 + (k / segs) * TAU, ca = Math.cos(a), sa = Math.sin(a);
                const n = F.n(ca * nr, sa * nr, nw);
                ring.push([
                    this.vert(F.p(ca * r0, sa * r0, w0), n, col, mat, edge),
                    this.vert(F.p(ca * r1, sa * r1, w1), n, col, mat, edge),
                ]);
            }
            for (let k = 0; k < segs; k++) {
                const [a, b] = ring[k], [c, d] = ring[k + 1];
                if (flip) this.i.push(a, b, d, a, d, c);
                else this.i.push(a, c, d, a, d, b);
            }
        }
        return this;
    }

    /** A plain cylinder along the frame axis from w0 to w1, chamfered ends. */
    cyl(r, w0, w1, opts) {
        const ch = Math.min((opts && opts.chamfer) ?? r * 0.08, Math.abs(w1 - w0) * 0.25);
        return this.lathe([[0, w0], [r - ch, w0], [r, w0 + ch], [r, w1 - ch], [r - ch, w1], [0, w1]], { ...opts, chamfer: ch });
    }

    /**
     * Extrude a star-shaped closed outline (points [x, y] around the origin)
     * along the frame axis from w0 to w1, with chamfered faces and an optional
     * bore of radius `bore`. Gear teeth, sprockets, plates.
     */
    ring(outline, w0, w1, opts) {
        const o = opts || {};
        const F = framer(o);
        const col = o.color, mat = o.mat ?? M.STEEL;
        const ch = Math.min(o.chamfer ?? 0, Math.abs(w1 - w0) * 0.3);
        const n = outline.length;
        const shrink = (pt, d) => {
            const r = Math.hypot(pt[0], pt[1]) || 1;
            const s = Math.max(0, r - d) / r;
            return [pt[0] * s, pt[1] * s];
        };
        const inner = ch > 0 ? outline.map((pt) => shrink(pt, ch)) : outline;
        // Side walls: hard per edge.
        for (let k = 0; k < n; k++) {
            const a = outline[k], b = outline[(k + 1) % n];
            this.quad(F.p(a[0], a[1], w0 + ch), F.p(b[0], b[1], w0 + ch), F.p(b[0], b[1], w1 - ch), F.p(a[0], a[1], w1 - ch), col, mat, 0);
        }
        // Chamfer bands, then caps (to the bore or to the centre).
        for (const [w, wIn, dir] of [[w1 - ch, w1, 1], [w0 + ch, w0, -1]]) {
            for (let k = 0; k < n; k++) {
                const a = outline[k], b = outline[(k + 1) % n], ai = inner[k], bi = inner[(k + 1) % n];
                if (ch > 0) {
                    const q = [F.p(a[0], a[1], w), F.p(b[0], b[1], w), F.p(bi[0], bi[1], wIn), F.p(ai[0], ai[1], wIn)];
                    if (dir > 0) this.quad(q[0], q[1], q[2], q[3], col, mat, 0.9);
                    else this.quad(q[1], q[0], q[3], q[2], col, mat, 0.9);
                }
                const nrm = F.n(0, 0, dir);
                if (o.bore) {
                    const aa = Math.atan2(ai[1], ai[0]), ab = Math.atan2(bi[1], bi[0]);
                    const ia = [Math.cos(aa) * o.bore, Math.sin(aa) * o.bore], ib = [Math.cos(ab) * o.bore, Math.sin(ab) * o.bore];
                    const v = [
                        this.vert(F.p(ai[0], ai[1], wIn), nrm, col, mat), this.vert(F.p(bi[0], bi[1], wIn), nrm, col, mat),
                        this.vert(F.p(ib[0], ib[1], wIn), nrm, col, mat), this.vert(F.p(ia[0], ia[1], wIn), nrm, col, mat),
                    ];
                    if (dir > 0) this.i.push(v[0], v[1], v[2], v[0], v[2], v[3]);
                    else this.i.push(v[1], v[0], v[3], v[1], v[3], v[2]);
                } else {
                    const c = this.vert(F.p(0, 0, wIn), nrm, col, mat);
                    const va = this.vert(F.p(ai[0], ai[1], wIn), nrm, col, mat), vb = this.vert(F.p(bi[0], bi[1], wIn), nrm, col, mat);
                    if (dir > 0) this.i.push(c, va, vb); else this.i.push(c, vb, va);
                }
            }
        }
        if (o.bore) this.lathe([[o.bore, w1], [o.bore, w0]], { ...o, segs: Math.max(12, Math.min(48, n)), edges: false, inside: false, color: o.boreColor || col });
        return this;
    }

    /** Box from `min` to `max` with chamfered edges of size `bevel`. */
    cbox(min, max, opts) {
        const o = opts || {};
        const col = o.color, mat = o.mat ?? M.PAINT;
        const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
        const b = Math.min(o.bevel ?? Math.min(...ext) * 0.08, Math.min(...ext) * 0.45);
        const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
        const h = ext.map((e) => e / 2);
        // The 24 points: each face's inset corners.
        const P = (sx, sy, sz, ax) => {
            const p = [c[0] + sx * h[0], c[1] + sy * h[1], c[2] + sz * h[2]];
            const s = [sx, sy, sz];
            for (let a = 0; a < 3; a++) if (a !== ax) p[a] -= s[a] * b;
            return p;
        };
        const faces = [
            [0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1],
        ];
        for (const [ax, s] of faces) {
            const u = (ax + 1) % 3, v = (ax + 2) % 3;
            const corner = (su, sv) => { const sg = [0, 0, 0]; sg[ax] = s; sg[u] = su; sg[v] = sv; return P(sg[0], sg[1], sg[2], ax); };
            const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
            if (s > 0) this.quad(q[0], q[1], q[2], q[3], col, mat, 0); else this.quad(q[0], q[3], q[2], q[1], col, mat, 0);
        }
        if (b <= 0) return this;
        // Edge chamfers: for each pair of axes, 4 edges.
        for (let a1 = 0; a1 < 3; a1++) for (let a2 = a1 + 1; a2 < 3; a2++) {
            const along = 3 - a1 - a2;
            for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
                const pt = (sa, onFace) => {
                    const sg = [0, 0, 0]; sg[a1] = s1; sg[a2] = s2; sg[along] = sa;
                    return P(sg[0], sg[1], sg[2], onFace);
                };
                const q = [pt(-1, a1), pt(1, a1), pt(1, a2), pt(-1, a2)];
                const n = faceNormal(q[0], q[1], q[2]);
                const out = [0, 0, 0]; out[a1] = s1; out[a2] = s2;
                if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] > 0) this.quad(q[0], q[1], q[2], q[3], col, mat, 1);
                else this.quad(q[0], q[3], q[2], q[1], col, mat, 1);
            }
        }
        // Corner triangles.
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
            const t = [P(sx, sy, sz, 0), P(sx, sy, sz, 1), P(sx, sy, sz, 2)];
            let n = faceNormal(t[0], t[1], t[2]);
            const outward = n[0] * sx + n[1] * sy + n[2] * sz > 0;
            if (!outward) n = [-n[0], -n[1], -n[2]];
            const k = [this.vert(t[0], n, col, mat, 1), this.vert(t[1], n, col, mat, 1), this.vert(t[2], n, col, mat, 1)];
            if (outward) this.i.push(k[0], k[1], k[2]); else this.i.push(k[0], k[2], k[1]);
        }
        return this;
    }

    /** Hex bolt head (and washer) seated on a face at `at`, facing `axis`. */
    bolt(at, axis, size, opts) {
        const o = opts || {};
        const s = size;
        return this.fine(() => this.lathe([[0, 0], [s * 1.25, 0], [s * 1.25, s * 0.12], [s * 0.95, s * 0.12], [s * 0.95, s * 0.62], [s * 0.8, s * 0.72], [0, s * 0.72]],
            { at, axis, segs: 6, phase: Math.PI / 6, color: o.color || lin([0.55, 0.57, 0.6]), mat: o.mat ?? M.CAST, chamfer: s * 0.2 }));
    }

    /**
     * Draw `fn`'s geometry as fine detail: it is baked like the rest but
     * casts no occlusion. A bolt is smaller than a cell of the face it sits
     * on, and per-vertex occlusion from it would smear into streaks.
     */
    fine(fn) {
        const i0 = this.i.length;
        fn();
        this.fineTris.push([i0, this.i.length]);
        return this;
    }

    /** Bolts on a circle of radius R about the frame axis at depth w. */
    boltCircle(R, n, w, size, frame, opts) {
        const F = framer(frame);
        const axis = frame && frame.axis || 'z';
        for (let k = 0; k < n; k++) {
            const a = (k / n) * TAU + ((opts && opts.phase) || (frame && frame.phase) || 0);
            this.bolt(F.p(Math.cos(a) * R, Math.sin(a) * R, w), axis, size, opts);
        }
        return this;
    }

    /** Sweep a circle of radius r along points (a polyline); smooth. */
    tube(points, r, opts) {
        const o = opts || {};
        const segs = o.segs || 12;
        const col = o.color, mat = o.mat ?? M.RUBBER;
        let prevN = null;
        const rings = [];
        for (let k = 0; k < points.length; k++) {
            const a = points[Math.max(0, k - 1)], b = points[Math.min(points.length - 1, k + 1)];
            let t = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
            let nrm = prevN ? norm(sub(prevN, scale(t, dot(prevN, t)))) : perp(t);
            if (!isFinite(nrm[0])) nrm = perp(t);
            const bin = cross(t, nrm);
            prevN = nrm;
            const ring = [];
            for (let s = 0; s <= segs; s++) {
                const ang = (s / segs) * TAU, ca = Math.cos(ang), sa = Math.sin(ang);
                const d = [nrm[0] * ca + bin[0] * sa, nrm[1] * ca + bin[1] * sa, nrm[2] * ca + bin[2] * sa];
                const p = points[k];
                ring.push(this.vert([p[0] + d[0] * r, p[1] + d[1] * r, p[2] + d[2] * r], d, col, mat));
            }
            rings.push(ring);
        }
        for (let k = 0; k + 1 < rings.length; k++) {
            for (let s = 0; s < segs; s++) {
                const a = rings[k][s], b = rings[k][s + 1], c = rings[k + 1][s], d = rings[k + 1][s + 1];
                this.i.push(a, b, c, b, d, c);
            }
        }
        return this;
    }

    /** Add another Geo's triangles. */
    append(g) {
        const base = this.count, i0 = this.i.length;
        this.p.push(...g.p); this.n.push(...g.n); this.c.push(...g.c); this.u.push(...g.u);
        for (const k of g.i) this.i.push(k + base);
        for (const [a, b] of g.fineTris || []) this.fineTris.push([a + i0, b + i0]);
        return this;
    }

    /**
     * The bro.mesh Mesh, with ambient occlusion baked into colour alpha
     * (ao: rays per vertex, 0 skips; aoDist: how far it looks).
     */
    finish(opts) {
        const o = opts || {};
        const mesh = new bro.mesh.Mesh({
            positions: new Float32Array(this.p),
            normals: new Float32Array(this.n),
            uvs: new Float32Array(this.u),
            colors: new Float32Array(this.c),
            indices: new Uint32Array(this.i),
        });
        if (o.ao && this.count > 0) {
            // The occluders: everything but fine detail (same vertices, so the
            // baked values line up with the mesh's).
            let probe = mesh.clone();
            if (this.fineTris.length) {
                const keep = [];
                let at = 0;
                for (const [a, b] of this.fineTris) { for (let k = at; k < a; k++) keep.push(this.i[k]); at = b; }
                for (let k = at; k < this.i.length; k++) keep.push(this.i[k]);
                probe = new bro.mesh.Mesh({ positions: mesh.positions, normals: mesh.normals, colors: mesh.colors, indices: new Uint32Array(keep) });
            }
            // Fewer rays on a dense mesh: its vertices sit close, so their noise averages out on the
            // surface, and the bake stays bounded (a 600-tooth ring would otherwise take a second).
            const rays = Math.max(8, Math.min(o.ao, Math.round((o.ao * 24000) / this.count)));
            probe.bakeAmbientOcclusion(rays, o.aoDist || 0);
            const ao = probe.colors;
            const cols = mesh.colors;
            for (let k = 0; k < this.count; k++) cols[k * 4 + 3] = Math.min(1, ao[k * 4] * 1.08);
            mesh.colors = cols;
        }
        return mesh;
    }
}

// --- small vector helpers ---------------------------------------------------
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function perp(t) { return norm(Math.abs(t[1]) < 0.9 ? cross(t, [0, 1, 0]) : cross(t, [1, 0, 0])); }
function faceNormal(a, b, c) { return norm(cross(sub(b, a), sub(c, a))); }

/** Involute-ish gear outline: z teeth of module m, as points [x, y]. */
export function gearOutline(z, m, opts) {
    const o = opts || {};
    const rp = 0.5 * m * z, ra = rp + m * (o.addendum ?? 1), rf = rp - m * 1.25;
    const pts = [];
    const step = TAU / z;
    for (let t = 0; t < z; t++) {
        const b = t * step + (o.phase || 0);
        const prof = [[0.00, rf], [0.10, rf], [0.18, rp - 0.3 * m], [0.25, rp + 0.35 * m], [0.31, ra], [0.44, ra], [0.50, rp + 0.35 * m], [0.57, rp - 0.3 * m], [0.65, rf], [0.75, rf]];
        for (const [f, r] of prof) pts.push([Math.cos(b + f * step) * r, Math.sin(b + f * step) * r]);
    }
    return pts;
}

/** Sprocket outline: z teeth for chain pitch p. */
export function sprocketOutline(z, pc) {
    const R = pc / (2 * Math.sin(Math.PI / z));
    const pts = [];
    for (let t = 0; t < z; t++) {
        const b = (t / z) * TAU, s = TAU / z;
        for (const [f, r] of [[0, R - pc * 0.3], [0.2, R - pc * 0.28], [0.36, R + pc * 0.18], [0.5, R + pc * 0.26], [0.64, R + pc * 0.18], [0.8, R - pc * 0.28]]) {
            pts.push([Math.cos(b + f * s) * r, Math.sin(b + f * s) * r]);
        }
    }
    return pts;
}

/** Rounded-rectangle / stadium outline centred at (cx, cy). */
export function roundRect(cx, cy, hw, hh, r, segs = 6) {
    r = Math.min(r, hw, hh);
    const pts = [];
    const corners = [[hw - r, hh - r, 0], [-hw + r, hh - r, 0.25], [-hw + r, -hh + r, 0.5], [hw - r, -hh + r, 0.75]];
    for (const [x, y, q] of corners) {
        for (let k = 0; k <= segs; k++) {
            const a = (q + (k / segs) * 0.25) * TAU;
            pts.push([cx + x + Math.cos(a) * r, cy + y + Math.sin(a) * r]);
        }
    }
    return pts;
}

/** Extrude any closed polygon (convex or star-shaped about `centre`) between w0 and w1. */
export function slab(g, outline, w0, w1, opts) {
    const o = opts || {};
    const c = o.centre || [0, 0];
    const rel = outline.map((p) => [p[0] - c[0], p[1] - c[1]]);
    const F = framer({ at: [0, 0, 0], axis: o.axis || 'z' });
    const at = o.at || [0, 0, 0];
    const sub = new Geo();
    sub.ring(rel, w0, w1, { ...o, at: undefined, axis: 'z' });
    // Move by centre in the frame's (u, v) and place.
    for (let k = 0; k < sub.count; k++) {
        const u = sub.p[k * 3] + c[0], v = sub.p[k * 3 + 1] + c[1], w = sub.p[k * 3 + 2];
        const q = F.p(u, v, w);
        sub.p[k * 3] = q[0] + at[0]; sub.p[k * 3 + 1] = q[1] + at[1]; sub.p[k * 3 + 2] = q[2] + at[2];
        const nn = F.n(sub.n[k * 3], sub.n[k * 3 + 1], sub.n[k * 3 + 2]);
        sub.n[k * 3] = nn[0]; sub.n[k * 3 + 1] = nn[1]; sub.n[k * 3 + 2] = nn[2];
    }
    g.append(sub);
    return g;
}
