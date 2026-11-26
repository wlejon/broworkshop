// lib/mech/vec.js — the vector and quaternion math the mech model is written in.
// Vectors are [x, y, z], rotations [x, y, z, w], as scene nodes and
// bro.dynamics take them. No DOM, no engine: runs in a page, a Worker and
// bro-server alike.

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mix = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const RAD = Math.PI / 180;

export function norm(a, fallback) {
    const l = len(a);
    return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : (fallback ? fallback.slice() : [0, 1, 0]);
}

/** a + b * s */
export const addScaled = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

export const QI = [0, 0, 0, 1];

export function qmul(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
}
export const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];

export function qrot(q, v) {
    const tx = 2 * (q[1] * v[2] - q[2] * v[1]);
    const ty = 2 * (q[2] * v[0] - q[0] * v[2]);
    const tz = 2 * (q[0] * v[1] - q[1] * v[0]);
    return [
        v[0] + q[3] * tx + (q[1] * tz - q[2] * ty),
        v[1] + q[3] * ty + (q[2] * tx - q[0] * tz),
        v[2] + q[3] * tz + (q[0] * ty - q[1] * tx),
    ];
}

/** Rotation of `angle` radians about `axis` (need not be unit). */
export function qaxis(axis, angle) {
    const l = len(axis);
    if (!(l > 1e-9)) return [0, 0, 0, 1];
    const s = Math.sin(angle / 2) / l;
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/** The shortest rotation taking unit `a` onto unit `b`. */
export function qfromTo(a, b) {
    const d = dot(a, b);
    if (d > 0.999999) return [0, 0, 0, 1];
    if (d < -0.999999) {
        const ax = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
        return qaxis(ax, Math.PI);
    }
    const c = cross(a, b);
    const q = [c[0], c[1], c[2], 1 + d];
    const l = Math.hypot(q[0], q[1], q[2], q[3]);
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export function qslerp(a, b, t) {
    let c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let s = 1;
    if (c < 0) { c = -c; s = -1; }
    let ka = 1 - t, kb = t;
    if (c < 0.9995) {
        const th = Math.acos(c), sn = Math.sin(th);
        ka = Math.sin((1 - t) * th) / sn;
        kb = Math.sin(t * th) / sn;
    }
    const q = [a[0] * ka + b[0] * kb * s, a[1] * ka + b[1] * kb * s, a[2] * ka + b[2] * kb * s, a[3] * ka + b[3] * kb * s];
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** A point or direction mirrored across the mech's centre plane (x = 0). */
export const mirrorV = (v) => [-v[0], v[1], v[2]];
/** A rotation mirrored across x = 0. */
export const mirrorQ = (q) => [q[0], -q[1], -q[2], q[3]];

/** The convex hull of 2D points [[x, z], ...], counter-clockwise. */
export function hull2(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const q of p) {
        while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
        lo.push(q);
    }
    for (let i = p.length - 1; i >= 0; i--) {
        const q = p[i];
        while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop();
        hi.push(q);
    }
    lo.pop(); hi.pop();
    return lo.concat(hi);
}
