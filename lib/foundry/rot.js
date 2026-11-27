// lib/foundry/rot.js — the 24 axis-aligned orientations a placed child can
// take, and the vector math the compiler and the view share.
//
// Every child sits in its assembly turned by one of the 24 rotations that map
// axes onto axes, so a child's box stays a box in its parent's frame and a
// port's axis stays an axis. A rotation is an index into ROTS; ROTS[i] is a
// row-major 3x3 integer matrix.

export const ROTS = [];
(function build() {
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const p of perms) {
        for (let s = 0; s < 8; s++) {
            const m = new Array(9).fill(0);
            for (let r = 0; r < 3; r++) m[r * 3 + p[r]] = (s >> r) & 1 ? -1 : 1;
            if (det(m) === 1) ROTS.push(m);
        }
    }
    // Identity first, so rotation 0 means "as built".
    const id = ROTS.findIndex((m) => m[0] === 1 && m[4] === 1 && m[8] === 1);
    const tmp = ROTS[0]; ROTS[0] = ROTS[id]; ROTS[id] = tmp;
})();

function det(m) {
    return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

export function rotApply(i, v) {
    const m = ROTS[i];
    return [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
        m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
        m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ];
}

function matMul(a, b) {
    const o = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
    return o;
}

function indexOf(m) {
    for (let i = 0; i < ROTS.length; i++) {
        const r = ROTS[i];
        let same = true;
        for (let k = 0; k < 9 && same; k++) same = r[k] === m[k];
        if (same) return i;
    }
    throw new Error('foundry rot: not an axis rotation');
}

/** Rotation a then b applied after it (b ∘ a). */
export function rotCompose(a, b) { return indexOf(matMul(ROTS[b], ROTS[a])); }

export function rotInverse(i) {
    const m = ROTS[i];
    return indexOf([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}

/** Unit quaternion [x, y, z, w] of rotation i, for scene nodes. */
export function rotQuat(i) {
    const m = ROTS[i];
    const tr = m[0] + m[4] + m[8];
    let x, y, z, w;
    if (tr > 0) {
        const s = Math.sqrt(tr + 1) * 2;
        w = 0.25 * s; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s;
    } else if (m[0] > m[4] && m[0] > m[8]) {
        const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
        w = (m[7] - m[5]) / s; x = 0.25 * s; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s;
    } else if (m[4] > m[8]) {
        const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
        w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = 0.25 * s; z = (m[5] + m[7]) / s;
    } else {
        const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
        w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = 0.25 * s;
    }
    return [x, y, z, w];
}

const DIR_ORDER = [[0, 1, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0], [-1, 0, 0], [0, 0, -1]];

function sameDir(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }
function rank(d) { return DIR_ORDER.findIndex((o) => sameDir(o, d)); }

/** Snap a unit-ish vector to the nearest signed axis. */
export function snapAxis(v) {
    const ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
    if (ax >= ay && ax >= az) return [Math.sign(v[0]) || 1, 0, 0];
    if (ay >= az) return [0, Math.sign(v[1]) || 1, 0];
    return [0, 0, Math.sign(v[2]) || 1];
}

/**
 * The rotation that turns local axis `from` onto world axis `to`, with
 * `spin` quarter turns about `to` (0..3). Spin 0 keeps the child's local up
 * (or +X when `from` is vertical) as close to the top of DIR_ORDER as it can,
 * so the same mate always lands the same way.
 */
export function rotMapping(from, to, spin = 0) {
    from = snapAxis(from); to = snapAxis(to);
    const cands = [];
    for (let i = 0; i < ROTS.length; i++) if (sameDir(rotApply(i, from), to)) cands.push(i);
    const ref = Math.abs(from[1]) === 1 ? [1, 0, 0] : [0, 1, 0];
    cands.sort((a, b) => rank(rotApply(a, ref)) - rank(rotApply(b, ref)));
    const base = cands[0];
    // Quarter turn about `to`: the rotation fixing `to` that takes p to to × p.
    const p = Math.abs(to[1]) === 1 ? [1, 0, 0] : [0, 1, 0];
    const q = cross(to, p);
    let quarter = 0;
    for (let i = 0; i < ROTS.length; i++) {
        if (sameDir(rotApply(i, to), to) && sameDir(rotApply(i, p), q)) { quarter = i; break; }
    }
    let r = base;
    for (let s = 0; s < (((spin % 4) + 4) % 4); s++) r = rotCompose(r, quarter);
    return r;
}

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const neg = (a) => [-a[0], -a[1], -a[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Axis-aligned box {min, max} turned by rotation i and moved by pos. */
export function boxPlace(box, rot, pos) {
    const a = rotApply(rot, box.min), b = rotApply(rot, box.max);
    return {
        min: [Math.min(a[0], b[0]) + pos[0], Math.min(a[1], b[1]) + pos[1], Math.min(a[2], b[2]) + pos[2]],
        max: [Math.max(a[0], b[0]) + pos[0], Math.max(a[1], b[1]) + pos[1], Math.max(a[2], b[2]) + pos[2]],
    };
}
