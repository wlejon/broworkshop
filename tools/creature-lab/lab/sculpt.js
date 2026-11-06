// Sculpting a soft-skinned body in code, in the rest pose, with its skin
// weights. A body is lofts (tubes through rings, each an ellipse with an
// optional cross-section shape) and blobs (ellipsoids), every vertex
// coloured by a function of where it is, and weighted to up to four bones.
//
//   const S = new Sculpt(skel);
//   S.loft(rings, { bones: ['radiusL', 'mcL'], segs: 16, hint: [0, 0, 1], color });
//   const { mesh, skin } = S.build();
//
// Weights come from distances to the bones' rest segments, among the bones
// a part names (so a leg never pulls the other leg):
//   weights: 'ring'    every vertex of a ring takes the ring centre's
//                      weights: the tube bends as a whole (limbs, neck)
//   weights: 'vertex'  each vertex its own (a trunk, where the skin over a
//                      shoulder follows the scapula and the belly the spine)
//   weights: fn(p, c)  each vertex the weights fn gives for its rest point
//                      and its ring's centre, [[bone, weight], ...] (a field
//                      drawn by hand: which skin a shoulder blade or a thigh
//                      carries; a leg's top taking the trunk's weights)
// A bone named as [name, influence] counts its distance divided by that.
// A loft given a `name` is measured by lab/form.js, as are its key rings
// that carry a `name`.
// `skin` is two vec4 a vertex (weights, then bone indices) for lab/skin.bk.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function segDist(p, a, b) {
    const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1e-9)));
    return Math.hypot(...sub(p, add(a, mul(ab, t))));
}

// Catmull-Rom through key values, `steps` samples a span.
function spline(keys, steps, get) {
    const out = [];
    const n = keys.length;
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

export class Sculpt {
    constructor(skel) {
        this.skel = skel;
        this.pos = []; this.nrm = []; this.col = []; this.idx = []; this.wts = [];
        this.parts = [];
        this.rings = [];
    }

    candidates(bones) {
        return bones.map((b) => {
            const [name, inf] = Array.isArray(b) ? b : [b, 1];
            const bone = this.skel.bones[this.skel.index(name)];
            return { index: bone.index, a: bone.head, b: bone.tail, inf };
        });
    }

    // Up to four (bone, weight) pairs at point p.
    weigh(p, cands, sharp = 4) {
        const ws = cands.map((c) => {
            const d = segDist(p, c.a, c.b) / c.inf;
            return { index: c.index, w: 1 / Math.pow(d + 0.012, sharp) };
        }).sort((x, y) => y.w - x.w).slice(0, 4);
        const sum = ws.reduce((s, x) => s + x.w, 0);
        const out = ws.map((x) => ({ index: x.index, w: x.w / sum })).filter((x) => x.w > 0.004);
        const s2 = out.reduce((s, x) => s + x.w, 0);
        return out.map((x) => ({ index: x.index, w: x.w / s2 }));
    }

    // The distance weights of point p among `bones` (names or [name,
    // influence]), as [[bone, weight], ...]: for a weight field to build on.
    distanceWeights(p, bones, sharp) {
        return this.weigh(p, this.candidates(bones), sharp).map(({ index, w }) => [this.skel.bones[index].name, w]);
    }

    // Weights given by name ([[bone, weight], ...]): the four largest, normalised.
    explicit(list) {
        const ws = list.filter(([, w]) => w > 0).map(([name, w]) => ({ index: this.skel.index(name), w }))
            .sort((x, y) => y.w - x.w).slice(0, 4);
        const sum = ws.reduce((s, x) => s + x.w, 0);
        const out = ws.map((x) => ({ index: x.index, w: x.w / sum })).filter((x) => x.w > 0.004);
        const s2 = out.reduce((s, x) => s + x.w, 0);
        return out.map((x) => ({ index: x.index, w: x.w / s2 }));
    }

    // A tube through `rings` ({ c: centre, r: radius or [side, up] }), the
    // rings splined `steps` to a span. opts: bones, segs, hint (the up
    // direction the ellipse's second axis leans to), shape(theta, t) -> a
    // radius factor, color(p, n, t) -> [r, g, b], caps [start, end],
    // weights 'ring' | 'vertex' | fn(p) -> [[bone, weight], ...], sharp.
    // A ring may carry `s`, an array of numbers splined like the radii and
    // handed to shape as its third argument (a cross-section that changes
    // along the tube), and `name` (see `name` below).
    loft(rings, opts = {}) {
        const segs = opts.segs || 16, steps = opts.steps || 4;
        const fn = typeof opts.weights === 'function' ? opts.weights : null;
        const cands = fn ? null : this.candidates(opts.bones);
        const centres = spline(rings, steps, (r) => r.c);
        const radii = spline(rings, steps, (r) => (Array.isArray(r.r) ? r.r : [r.r, r.r]));
        const shp = rings[0].s ? spline(rings, steps, (r) => r.s) : null;
        const weigh = (p, c) => (fn ? this.explicit(fn(p, c)) : this.weigh(p, cands, opts.sharp));
        const n = centres.length;
        const hint = opts.hint || [0, 1, 0];
        const base = this.pos.length / 3;
        const start = this.idx.length;
        for (let i = 0; i < n; i++) {
            const t = norm(sub(centres[Math.min(n - 1, i + 1)], centres[Math.max(0, i - 1)]));
            const side = norm(cross(hint, t));
            const up = cross(t, side);
            const u = i / (n - 1);
            const ringW = opts.weights === 'vertex' || fn ? null : weigh(centres[i]);
            for (let j = 0; j < segs; j++) {
                const th = (j / segs) * Math.PI * 2;
                const f = opts.shape ? opts.shape(th, u, shp ? shp[i] : null) : 1;
                const fs = Array.isArray(f) ? f : [f, f];
                const p = add(centres[i], add(mul(side, Math.cos(th) * radii[i][0] * fs[0]), mul(up, Math.sin(th) * radii[i][1] * fs[1])));
                this.vertex(p, ringW || weigh(p, centres[i]));
            }
        }
        for (let i = 0; i < n - 1; i++) {
            for (let j = 0; j < segs; j++) {
                const a = base + i * segs + j, b = base + i * segs + (j + 1) % segs;
                const c2 = a + segs, d = b + segs;
                this.idx.push(a, b, c2, b, d, c2);
            }
        }
        const caps = opts.caps || [true, true];
        for (const [end, on] of [[0, caps[0]], [n - 1, caps[1]]]) {
            if (!on) continue;
            const ring = base + end * segs;
            const ci = this.vertex(centres[end], weigh(centres[end], centres[end]));
            for (let j = 0; j < segs; j++) {
                const a = ring + j, b = ring + (j + 1) % segs;
                if (end === 0) this.idx.push(ci, b, a); else this.idx.push(ci, a, b);
            }
        }
        this.part(base, start, opts.color, (vi) => {
            const k = vi - base;
            return k < n * segs ? Math.floor(k / segs) / (n - 1) : (k === n * segs ? 0 : 1);
        });
        // A named part, and its named rings (a key ring's `name`), for the
        // lab's measures of the body in motion (lab/form.js).
        if (opts.name) {
            this.parts.push({ name: opts.name, base, count: this.pos.length / 3 - base, start, end: this.idx.length,
                              closed: caps[0] && caps[1], rings: n, segs });
            rings.forEach((r, i) => {
                if (r.name) this.rings.push({ name: r.name, part: opts.name, first: base + i * steps * segs, segs });
            });
        }
    }

    // An ellipsoid at c with radii r, on the given bones.
    blob(c, r, opts = {}) {
        const segs = opts.segs || 12, rows = opts.rows || 8;
        const cands = this.candidates(opts.bones);
        const base = this.pos.length / 3, start = this.idx.length;
        for (let i = 0; i <= rows; i++) {
            const ph = (i / rows) * Math.PI - Math.PI / 2;
            for (let j = 0; j < segs; j++) {
                const th = (j / segs) * Math.PI * 2;
                const p = [c[0] + r[0] * Math.cos(ph) * Math.cos(th), c[1] + r[1] * Math.sin(ph), c[2] + r[2] * Math.cos(ph) * Math.sin(th)];
                this.vertex(p, this.weigh(opts.weights === 'vertex' ? p : c, cands, opts.sharp));
            }
        }
        for (let i = 0; i < rows; i++) for (let j = 0; j < segs; j++) {
            const a = base + i * segs + j, b = base + i * segs + (j + 1) % segs;
            this.idx.push(a, a + segs, b, b, a + segs, b + segs);
        }
        this.part(base, start, opts.color, () => 0);
    }

    vertex(p, w) {
        this.pos.push(p[0], p[1], p[2]);
        this.nrm.push(0, 0, 0);
        this.col.push(1, 1, 1, 1);
        this.wts.push(w);
        return this.pos.length / 3 - 1;
    }

    // Smooth normals and colours for the part just added.
    part(base, start, color, tOf) {
        const end = this.pos.length / 3;
        const P = this.pos, N = this.nrm;
        for (let i = start; i < this.idx.length; i += 3) {
            const a = this.idx[i], b = this.idx[i + 1], c = this.idx[i + 2];
            const pa = [P[3 * a], P[3 * a + 1], P[3 * a + 2]];
            const fn = cross(sub([P[3 * b], P[3 * b + 1], P[3 * b + 2]], pa), sub([P[3 * c], P[3 * c + 1], P[3 * c + 2]], pa));
            for (const v of [a, b, c]) for (let k = 0; k < 3; k++) N[3 * v + k] += fn[k];
        }
        for (let v = base; v < end; v++) {
            const nn = norm([N[3 * v], N[3 * v + 1], N[3 * v + 2]]);
            N[3 * v] = nn[0]; N[3 * v + 1] = nn[1]; N[3 * v + 2] = nn[2];
            if (color) {
                const p = [P[3 * v], P[3 * v + 1], P[3 * v + 2]];
                const c = typeof color === 'function' ? color(p, nn, tOf(v)) : color;
                // Colours are given as display (sRGB) values; the mesh takes linear.
                for (let k = 0; k < 3; k++) this.col[4 * v + k] = Math.pow(Math.max(0, c[k]), 2.2);
            }
        }
    }

    build() {
        const nv = this.pos.length / 3;
        const skin = new Float32Array(nv * 8);
        for (let v = 0; v < nv; v++) {
            const w = this.wts[v];
            for (let j = 0; j < w.length; j++) {
                skin[8 * v + j] = w[j].w;
                skin[8 * v + 4 + j] = w[j].index;
            }
        }
        const mesh = new Mesh({
            positions: new Float32Array(this.pos), normals: new Float32Array(this.nrm),
            colors: new Float32Array(this.col), indices: new Uint32Array(this.idx),
        });
        return {
            mesh, skin, vertices: nv, triangles: this.idx.length / 3,
            positions: new Float32Array(this.pos), indices: new Uint32Array(this.idx), weights: this.wts,
            parts: this.parts, rings: this.rings,
        };
    }
}
