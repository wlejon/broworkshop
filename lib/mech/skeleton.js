// lib/mech/skeleton.js — the geometry a design implies: which segments exist on
// which side, where their joints are, the hull each one is, the bay of cells
// inside it, and what a ray hits.
//
// A segment is defined once, for the mech's right side (+x). Every segment's
// own axes are the mech's at rest (x right, y up, -z forward), so `attach` is
// a plain offset from the parent's joint. Its hull is a tapered box laid along
// `bone`, measured in hull coordinates [a, b, c] along the hull's axes U
// (across), V (the bone) and W (U x V): it runs from b = -back to b = len, its
// section centred on `off` with half extents hu, hw that go from their first
// value at the root to their second at the tip.

import { add, sub, mul, dot, cross, norm, qrot, qmul, qaxis, mirrorV, QI } from "./vec.js";
import { CELL, WALL } from "./catalog.js";

export const FACES = ['+u', '-u', '+v', '-v', '+w', '-w'];
const FACE_AXIS = { '+u': 0, '-u': 0, '+v': 1, '-v': 1, '+w': 2, '-w': 2 };
export const faceAxis = (f) => FACE_AXIS[f];
export const faceSign = (f) => (f[0] === '+' ? 1 : -1);

/** The segments by id. */
export function segMap(design) {
    const m = {};
    for (const s of design.segments) m[s.id] = s;
    return m;
}

/**
 * Every segment as it exists on the machine, parents first. A segment marked
 * `mirror`, and everything hanging from it, exists twice: `id.R` and `id.L`.
 * @returns {{id: string, seg: Object, side: number, parent: ?string, depth: number}[]}
 *   side: 1 right, -1 left (the mirrored one), 0 on the centre line
 */
export function instances(design) {
    const out = [], kids = {};
    for (const s of design.segments) (kids[s.parent || ''] ||= []).push(s);
    const walk = (seg, side, parentInst, depth) => {
        const id = side === 0 ? seg.id : seg.id + (side > 0 ? '.R' : '.L');
        out.push({ id, seg, side, parent: parentInst, depth });
        for (const k of kids[seg.id] || []) {
            if (side !== 0) walk(k, side, id, depth + 1);
            else if (k.mirror) { walk(k, 1, id, depth + 1); walk(k, -1, id, depth + 1); }
            else walk(k, 0, id, depth + 1);
        }
    };
    for (const root of kids[''] || []) walk(root, 0, null, 0);
    return out;
}

/** The hull's axes in the segment's own space: { U, V, W }. */
export function hullBasis(seg) {
    const V = norm(seg.bone, [0, 1, 0]);
    let U = sub([1, 0, 0], mul(V, V[0]));
    if (dot(U, U) < 1e-4) U = sub([0, 0, 1], mul(V, V[2]));
    U = norm(U);
    let W = cross(U, V);
    if (seg.roll) {
        const q = qaxis(V, seg.roll * Math.PI / 180);
        U = qrot(q, U); W = qrot(q, W);
    }
    return { U, V, W };
}

/** Half extents of the section at b: [hu, hw]. */
export function sectionAt(seg, b) {
    const k = (b + seg.back) / Math.max(1e-6, seg.len + seg.back);
    return [seg.hu[0] + (seg.hu[1] - seg.hu[0]) * k, seg.hw[0] + (seg.hw[1] - seg.hw[0]) * k];
}

/** Hull coordinates to the segment's own space (right side). */
export function hullToLocal(basis, p) {
    return [
        basis.U[0] * p[0] + basis.V[0] * p[1] + basis.W[0] * p[2],
        basis.U[1] * p[0] + basis.V[1] * p[1] + basis.W[1] * p[2],
        basis.U[2] * p[0] + basis.V[2] * p[1] + basis.W[2] * p[2],
    ];
}
export const localToHull = (basis, p) => [dot(basis.U, p), dot(basis.V, p), dot(basis.W, p)];

/** The hull's eight corners in hull coordinates: root ring then tip ring, each (-u-w, +u-w, +u+w, -u+w). */
export function hullCorners(seg) {
    const [ou, ow] = seg.off || [0, 0];
    const ring = (b, hu, hw) => [[ou - hu, b, ow - hw], [ou + hu, b, ow - hw], [ou + hu, b, ow + hw], [ou - hu, b, ow + hw]];
    return ring(-seg.back, seg.hu[0], seg.hw[0]).concat(ring(seg.len, seg.hu[1], seg.hw[1]));
}

// Corner indices of each face, wound counter-clockwise seen from outside.
const FACE_QUADS = {
    '+u': [1, 5, 6, 2], '-u': [0, 3, 7, 4], '+v': [4, 7, 6, 5], '-v': [0, 1, 2, 3], '+w': [3, 2, 6, 7], '-w': [0, 4, 5, 1],
};

/** A face's four corners (hull coordinates), counter-clockwise from outside. */
export function faceQuad(seg, face) {
    const c = hullCorners(seg);
    return FACE_QUADS[face].map((i) => c[i]);
}

export function quadArea(q) {
    const a = cross(sub(q[1], q[0]), sub(q[2], q[0])), b = cross(sub(q[2], q[0]), sub(q[3], q[0]));
    return 0.5 * (Math.hypot(a[0], a[1], a[2]) + Math.hypot(b[0], b[1], b[2]));
}

export function faceNormal(seg, face) {
    const q = faceQuad(seg, face);
    return norm(cross(sub(q[1], q[0]), sub(q[3], q[0])));
}

/** What a face is called from where it looks on the standing machine. */
export function faceName(seg, face, side) {
    let n = hullToLocal(hullBasis(seg), faceNormal(seg, face));
    if (side < 0) n = mirrorV(n);
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    if (ay >= ax && ay >= az) return n[1] > 0 ? 'top' : 'bottom';
    if (az >= ax) return n[2] < 0 ? 'front' : 'back';
    return n[0] > 0 ? 'right' : 'left';
}

export function hullVolume(seg) {
    const L = seg.len + seg.back, a0 = 4 * seg.hu[0] * seg.hw[0], a1 = 4 * seg.hu[1] * seg.hw[1];
    const am = (seg.hu[0] + seg.hu[1]) * (seg.hw[0] + seg.hw[1]);
    return L * (a0 + a1 + 4 * am) / 6;
}

export function hullArea(seg) {
    let a = 0;
    for (const f of FACES) a += quadArea(faceQuad(seg, f));
    return a;
}

/** The middle of the hull, hull coordinates. */
export function hullCenter(seg) {
    const [ou, ow] = seg.off || [0, 0];
    return [ou, (seg.len - seg.back) / 2, ow];
}

/**
 * The bay: whole cells of CELL inside the hull's walls.
 * @returns {{n: number[], o: number[], valid: (i: number, j: number, k: number) => boolean}}
 *   n: cells along a, b, c; o: hull coordinates of the corner of cell 0, 0, 0
 */
export function bay(seg) {
    const [ou, ow] = seg.off || [0, 0];
    const HU = Math.max(seg.hu[0], seg.hu[1]) - WALL, HW = Math.max(seg.hw[0], seg.hw[1]) - WALL;
    const L = seg.len + seg.back - 2 * WALL;
    const n = [Math.max(0, Math.floor(2 * HU / CELL + 1e-6)), Math.max(0, Math.floor(L / CELL + 1e-6)), Math.max(0, Math.floor(2 * HW / CELL + 1e-6))];
    const o = [ou - n[0] * CELL / 2, -seg.back + (seg.len + seg.back - n[1] * CELL) / 2, ow - n[2] * CELL / 2];
    const valid = (i, j, k) => {
        if (i < 0 || j < 0 || k < 0 || i >= n[0] || j >= n[1] || k >= n[2]) return false;
        const b0 = o[1] + j * CELL, b1 = b0 + CELL;
        const s0 = sectionAt(seg, b0), s1 = sectionAt(seg, b1);
        const hu = Math.min(s0[0], s1[0]) - WALL + 1e-6, hw = Math.min(s0[1], s1[1]) - WALL + 1e-6;
        const a0 = o[0] + i * CELL - ou, c0 = o[2] + k * CELL - ow;
        return a0 >= -hu && a0 + CELL <= hu && c0 >= -hw && c0 + CELL <= hw;
    };
    return { n, o, valid };
}

/** A module's box in hull coordinates: { min, max, center, size }. */
export function moduleBox(grid, m) {
    const min = [grid.o[0] + m.cell[0] * CELL, grid.o[1] + m.cell[1] * CELL, grid.o[2] + m.cell[2] * CELL];
    const size = [m.size[0] * CELL, m.size[1] * CELL, m.size[2] * CELL];
    const max = add(min, size);
    return { min, max, size, center: mul(add(min, max), 0.5) };
}

/** The area of the face a module shows through `face`, and how deep it runs behind it. */
export function moduleFace(m, face) {
    const ax = FACE_AXIS[face || '+v'];
    const d = [m.size[0] * CELL, m.size[1] * CELL, m.size[2] * CELL];
    return { A: d[(ax + 1) % 3] * d[(ax + 2) % 3], L: d[ax] };
}

/**
 * Why a module cannot be where it is, or null: outside the bay, through
 * another module (`taken`: a set of "i,j,k" of the cells others hold), or a
 * part that must show through the hull with something between it and the skin.
 */
export function placementFault(grid, m, taken, needsFace) {
    for (let i = 0; i < m.size[0]; i++) for (let j = 0; j < m.size[1]; j++) for (let k = 0; k < m.size[2]; k++) {
        const c = [m.cell[0] + i, m.cell[1] + j, m.cell[2] + k];
        if (!grid.valid(c[0], c[1], c[2])) return 'outside the bay';
        if (taken && taken.has(c[0] + ',' + c[1] + ',' + c[2])) return 'overlaps another module';
    }
    if (needsFace) {
        if (!m.face) return 'needs a face to show through';
        const ax = FACE_AXIS[m.face], sg = faceSign(m.face);
        const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3;
        for (let p = 0; p < m.size[a1]; p++) for (let q = 0; q < m.size[a2]; q++) {
            const c = [0, 0, 0];
            c[a1] = m.cell[a1] + p; c[a2] = m.cell[a2] + q;
            for (let at = sg > 0 ? m.cell[ax] + m.size[ax] : m.cell[ax] - 1; at >= 0 && at < grid.n[ax]; at += sg) {
                c[ax] = at;
                if (taken && taken.has(c[0] + ',' + c[1] + ',' + c[2])) return 'another module is between it and the skin';
            }
        }
    }
    return null;
}

/** Where the line out of a point through `face` meets the hull's skin, hull coordinates. */
export function skinPoint(seg, p, face) {
    const [ou, ow] = seg.off || [0, 0];
    const ax = FACE_AXIS[face], sg = faceSign(face), out = p.slice();
    if (ax === 1) out[1] = sg > 0 ? seg.len : -seg.back;
    else {
        const s = sectionAt(seg, p[1]);
        if (ax === 0) out[0] = ou + sg * s[0]; else out[2] = ow + sg * s[1];
    }
    return out;
}

/**
 * Where everything stands at rest: the joint of each instance in the world,
 * feet on y = 0.
 * @returns {{pos: Object<string, number[]>, rootY: number}}
 */
export function restPose(design, insts) {
    insts = insts || instances(design);
    const pos = {};
    let low = Infinity;
    for (const it of insts) {
        const at = it.side < 0 ? mirrorV(it.seg.attach) : it.seg.attach;
        pos[it.id] = it.parent ? add(pos[it.parent], at) : [0, 0, 0];
        const B = hullBasis(it.seg);
        for (const c of hullCorners(it.seg)) low = Math.min(low, pos[it.id][1] + hullToLocal(B, c)[1]);
    }
    if (!isFinite(low)) low = 0;
    for (const id in pos) pos[id] = [pos[id][0], pos[id][1] - low, pos[id][2]];
    return { pos, rootY: -low };
}

/**
 * Forward kinematics. `joints` gives an instance's joint rotation (world
 * handed, as it is on that side); a missing one is at rest.
 * @returns {Object<string, {pos: number[], rot: number[]}>}
 */
export function poseWorld(design, insts, rootPos, rootRot, joints) {
    const out = {};
    for (const it of insts) {
        const local = (joints && joints[it.id]) || QI;
        if (!it.parent) { out[it.id] = { pos: rootPos.slice(), rot: qmul(rootRot, local) }; continue; }
        const p = out[it.parent];
        const at = it.side < 0 ? mirrorV(it.seg.attach) : it.seg.attach;
        out[it.id] = { pos: add(p.pos, qrot(p.rot, at)), rot: qmul(p.rot, local) };
    }
    return out;
}

/**
 * A ray against a segment's hull. `o`, `d` are in the segment's own space,
 * right side (mirror them first for a left instance).
 * @returns {?{t: number, face: string, point: number[]}} point in hull coordinates
 */
export function rayHull(seg, basis, o, d) {
    const ho = localToHull(basis, o), hd = localToHull(basis, d);
    const [ou, ow] = seg.off || [0, 0];
    const L = Math.max(1e-6, seg.len + seg.back);
    const su = (seg.hu[1] - seg.hu[0]) / L, sw = (seg.hw[1] - seg.hw[0]) / L;
    const planes = [
        ['+u', [1, -su, 0], ou + seg.hu[0] + su * seg.back], ['-u', [-1, -su, 0], -ou + seg.hu[0] + su * seg.back],
        ['+v', [0, 1, 0], seg.len], ['-v', [0, -1, 0], seg.back],
        ['+w', [0, -sw, 1], ow + seg.hw[0] + sw * seg.back], ['-w', [0, -sw, -1], -ow + seg.hw[0] + sw * seg.back],
    ];
    let t0 = 0, t1 = Infinity, face = null;
    for (const [f, n, h] of planes) {
        const dn = dot(n, hd), dist = h - dot(n, ho);
        if (Math.abs(dn) < 1e-9) { if (dist < 0) return null; continue; }
        const t = dist / dn;
        if (dn < 0) { if (t > t0) { t0 = t; face = f; } }
        else if (t < t1) t1 = t;
        if (t0 > t1) return null;
    }
    if (!face) return null;
    return { t: t0, t1, face, point: add(ho, mul(hd, t0)), dir: hd, origin: ho };
}

/** A ray (hull coordinates) against a box: entry distance and the face entered, or null. */
export function rayBox(o, d, min, max) {
    let t0 = 0, t1 = Infinity, face = null;
    for (let ax = 0; ax < 3; ax++) {
        if (Math.abs(d[ax]) < 1e-9) { if (o[ax] < min[ax] || o[ax] > max[ax]) return null; continue; }
        let a = (min[ax] - o[ax]) / d[ax], b = (max[ax] - o[ax]) / d[ax], f = '-' + 'uvw'[ax];
        if (a > b) { const s = a; a = b; b = s; f = '+' + 'uvw'[ax]; }
        if (a > t0) { t0 = a; face = f; }
        if (b < t1) t1 = b;
        if (t0 > t1) return null;
    }
    return face ? { t: t0, face } : null;
}

/** The first empty cell of the bay along a ray that has entered the hull, or null. */
export function firstFreeCell(grid, taken, o, d, tFrom, tTo) {
    const step = CELL / 4;
    for (let t = tFrom + 1e-3; t < tTo; t += step) {
        const c = [0, 1, 2].map((ax) => Math.floor((o[ax] + d[ax] * t - grid.o[ax]) / CELL));
        if (grid.valid(c[0], c[1], c[2]) && !taken.has(c[0] + ',' + c[1] + ',' + c[2])) return c;
    }
    return null;
}
