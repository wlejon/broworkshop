// lib/mech/geom.js — a small mesh builder: flat-shaded quads with a colour per
// face, pushed through a transform. What it returns goes straight into
// scene.createMesh ({ positions, normals, colors, indices }).

import { add, sub, mul, cross, dot, norm, lerp } from "./vec.js";

export class MeshBuilder {
    constructor() {
        this.p = []; this.n = []; this.c = []; this.i = [];
        /** Points pass through this on their way in (hull coordinates to a segment's own space). */
        this.xf = null;
    }

    get empty() { return this.i.length === 0; }

    _v(p, n, c) {
        this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]);
        this.c.push(c[0], c[1], c[2], c.length > 3 ? c[3] : 1);
        return this.p.length / 3 - 1;
    }

    /** A triangle, counter-clockwise from outside. */
    tri(a, b, c, col) {
        if (this.xf) { a = this.xf(a); b = this.xf(b); c = this.xf(c); }
        const n = norm(cross(sub(b, a), sub(c, a)), [0, 1, 0]);
        const i0 = this._v(a, n, col);
        this._v(b, n, col); this._v(c, n, col);
        this.i.push(i0, i0 + 1, i0 + 2);
    }

    /** A quad, counter-clockwise from outside. */
    quad(a, b, c, d, col) {
        if (this.xf) { a = this.xf(a); b = this.xf(b); c = this.xf(c); d = this.xf(d); }
        let n = cross(sub(b, a), sub(d, a));
        if (dot(n, n) < 1e-12) n = cross(sub(c, b), sub(d, b));
        n = norm(n, [0, 1, 0]);
        const i0 = this._v(a, n, col);
        this._v(b, n, col); this._v(c, n, col); this._v(d, n, col);
        this.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    }

    /** A quad given in either winding, turned to face along `out`. */
    quadFacing(a, b, c, d, out, col) {
        const n = cross(sub(b, a), sub(d, a));
        if (dot(n, out) >= 0) this.quad(a, b, c, d, col); else this.quad(d, c, b, a, col);
    }

    /**
     * A six-faced solid from eight corners: a ring of four, then the ring
     * above it, each going round the same way (as skeleton.hullCorners).
     * `skip`: face indices left open (0 +u, 1 -u, 2 top, 3 bottom, 4 +w, 5 -w).
     */
    hexa(c, col, skip) {
        const F = [[1, 5, 6, 2], [0, 3, 7, 4], [4, 7, 6, 5], [0, 1, 2, 3], [3, 2, 6, 7], [0, 4, 5, 1]];
        // Which way round the rings go decides which side is out.
        const flip = dot(cross(sub(c[1], c[0]), sub(c[3], c[0])), sub(c[4], c[0])) < 0;
        F.forEach((f, k) => {
            if (skip && skip.includes(k)) return;
            const col2 = Array.isArray(col[0]) ? col[k] : col;
            if (flip) this.quad(c[f[0]], c[f[1]], c[f[2]], c[f[3]], col2);
            else this.quad(c[f[3]], c[f[2]], c[f[1]], c[f[0]], col2);
        });
    }

    /** An axis-aligned box from min to max. */
    box(min, max, col, skip) {
        this.hexa([
            [min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], min[1], max[2]], [min[0], min[1], max[2]],
            [min[0], max[1], min[2]], [max[0], max[1], min[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]],
        ], col, skip);
    }

    /** A box of half extents h about `center`, its axes x, y, z given. */
    obox(center, x, y, z, h, col, skip) {
        const at = (sx, sy, sz) => add(center, add(mul(x, sx * h[0]), add(mul(y, sy * h[1]), mul(z, sz * h[2]))));
        this.hexa([at(-1, -1, -1), at(1, -1, -1), at(1, -1, 1), at(-1, -1, 1), at(-1, 1, -1), at(1, 1, -1), at(1, 1, 1), at(-1, 1, 1)], col, skip);
    }

    /** A beam of square section `s` from a to b. */
    beam(a, b, s, col) {
        const d = sub(b, a), z = norm(d, [0, 1, 0]);
        const x = norm(Math.abs(z[1]) < 0.9 ? cross([0, 1, 0], z) : cross([1, 0, 0], z));
        const y = cross(z, x);
        this.obox(lerp(a, b, 0.5), x, y, z, [s / 2, s / 2, Math.hypot(d[0], d[1], d[2]) / 2], col);
    }

    /**
     * A frustum from p0 (radius r0) to p1 (radius r1), `sides` round.
     * caps: 0 none, 1 at p0, 2 at p1, 3 both. `colCap` colours them.
     */
    cyl(p0, p1, r0, r1, sides, col, caps, colCap, inside) {
        if (inside) {
            // The same wall seen from within: built from the far end back.
            const z = norm(sub(p1, p0), [0, 1, 0]);
            const x = norm(Math.abs(z[1]) < 0.9 ? cross([0, 1, 0], z) : cross([1, 0, 0], z)), y = cross(z, x);
            const at = (p, r, k) => { const a = (k + 0.5) / sides * Math.PI * 2; return add(p, add(mul(x, Math.cos(a) * r), mul(y, Math.sin(a) * r))); };
            for (let k = 0; k < sides; k++) this.quad(at(p0, r0, k + 1), at(p0, r0, k), at(p1, r1, k), at(p1, r1, k + 1), col);
            return;
        }
        const z = norm(sub(p1, p0), [0, 1, 0]);
        const x = norm(Math.abs(z[1]) < 0.9 ? cross([0, 1, 0], z) : cross([1, 0, 0], z));
        const y = cross(z, x);
        const ring = (p, r) => {
            const out = [];
            for (let k = 0; k < sides; k++) {
                const a = (k + 0.5) / sides * Math.PI * 2;
                out.push(add(p, add(mul(x, Math.cos(a) * r), mul(y, Math.sin(a) * r))));
            }
            return out;
        };
        const a = ring(p0, r0), b = ring(p1, r1);
        for (let k = 0; k < sides; k++) {
            const k2 = (k + 1) % sides;
            this.quad(a[k], a[k2], b[k2], b[k], col);
        }
        const cc = colCap || col;
        if (caps & 1) for (let k = 1; k < sides - 1; k++) this.tri(a[0], a[k + 1], a[k], cc);
        if (caps & 2) for (let k = 1; k < sides - 1; k++) this.tri(b[0], b[k], b[k + 1], cc);
    }

    /** A disc at p facing along n. */
    disc(p, n, r, sides, col) {
        const z = norm(n);
        const x = norm(Math.abs(z[1]) < 0.9 ? cross([0, 1, 0], z) : cross([1, 0, 0], z));
        const y = cross(z, x);
        const pts = [];
        for (let k = 0; k < sides; k++) {
            const a = (k + 0.5) / sides * Math.PI * 2;
            pts.push(add(p, add(mul(x, Math.cos(a) * r), mul(y, Math.sin(a) * r))));
        }
        for (let k = 1; k < sides - 1; k++) this.tri(pts[0], pts[k], pts[k + 1], col);
    }

    /** A tube of radius r through `points`. */
    tube(points, r, sides, col) {
        for (let k = 0; k + 1 < points.length; k++) this.cyl(points[k], points[k + 1], r, r, sides, col, (k === 0 ? 1 : 0) | (k + 2 === points.length ? 2 : 0));
    }

    /** { positions, normals, colors, indices }, or null when nothing was built. `mirror` reflects it across x = 0. */
    data(mirror) {
        if (!this.i.length) return null;
        const positions = new Float32Array(this.p), normals = new Float32Array(this.n);
        const colors = new Float32Array(this.c), indices = new Uint32Array(this.i);
        if (mirror) {
            for (let k = 0; k < positions.length; k += 3) { positions[k] = -positions[k]; normals[k] = -normals[k]; }
            for (let k = 0; k < indices.length; k += 3) { const t = indices[k + 1]; indices[k + 1] = indices[k + 2]; indices[k + 2] = t; }
        }
        return { positions, normals, colors, indices };
    }
}

/** '#rrggbb' to linear-ish [r, g, b] in 0..1. */
export function hexColor(hex) {
    const v = parseInt(String(hex).replace('#', ''), 16) || 0;
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const tint = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A repeatable number in [0, 1) from integers. */
export function hash(a, b, c) {
    let h = (a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 2147483647;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
