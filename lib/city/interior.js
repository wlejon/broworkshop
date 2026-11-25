// lib/city/interior.js — real interiors for the building the eye comes near:
// floor slabs, the outer walls from inside with the facade's own window and
// door openings (and their reveals), rooms behind the bays the facade shows,
// furniture by use (flats, offices, shops, sheds), ceiling lamps, point
// lights in the rooms the facade shows lit, and an interior volume for the
// light and the exposure inside. building.bk opens that building's windows
// and door (their glass cut) over the floors built, so the facade's painted
// rooms give way to these.
//
// interiorMesh(M, band, skipBelow) -> { mesh, lamps, lights, windows, floors, tris }
//   M: massRecord(); band: [y0, y1] local heights of the floors to build.
// createInteriors(scene, masses, walls, cuts) -> { update(eye, night, dt), finish(), close(), forget(bi), hold(bi), release(bi), addWalls(node), enclose(bi), breach(bi, open), unenclose(bi), stats, enabled }

import { MASS_FLOATS, STYLE } from "./buildings.js";

const T = 0.3;          // outer wall thickness
const SLAB = 0.28;      // floor slab
const PART = 0.12;      // partition wall
const DOOR_W = 0.95, DOOR_H = 2.1;

export function massRecord(data, i) {
    const o = i * MASS_FLOATS, D = data;
    const seed = D[o + 10];
    return {
        i, cx: D[o], y0: D[o + 1], cz: D[o + 2], yaw: D[o + 3], hw: D[o + 4], h: D[o + 5], hd: D[o + 6],
        floorH: D[o + 7], groundH: D[o + 8], plinth: D[o + 9], seed, style: Math.round(D[o + 11]),
        roof: D[o + 12], roofH: D[o + 13], flags: Math.round(D[o + 14]), hue: D[o + 15],
        id: Math.floor(seed * 1048576),
    };
}

// facade.bk's layout_for: bay width, window across the bay and up the floor.
export function layoutFor(style, ground, shop) {
    if (ground && shop) return { bay: 4.2, wx0: 0.06, wx1: 0.94, wy0: 0.05, wy1: 0.72 };
    switch (style) {
        case STYLE.glass: return { bay: 1.55, wx0: 0.03, wx1: 0.97, wy0: 0.22, wy1: 0.98 };
        case STYLE.office: return { bay: 3.0, wx0: 0.14, wx1: 0.86, wy0: 0.30, wy1: 0.86 };
        case STYLE.brick: return { bay: 3.2, wx0: 0.26, wx1: 0.74, wy0: 0.28, wy1: 0.80 };
        case STYLE.stone: return { bay: 3.6, wx0: 0.28, wx1: 0.72, wy0: 0.22, wy1: 0.84 };
        case STYLE.stucco: return { bay: 3.4, wx0: 0.22, wx1: 0.78, wy0: 0.26, wy1: 0.82 };
        case STYLE.rowhouse: return { bay: 2.4, wx0: 0.24, wx1: 0.76, wy0: 0.28, wy1: 0.82 };
        case STYLE.siding: return { bay: 2.9, wx0: 0.28, wx1: 0.72, wy0: 0.30, wy1: 0.78 };
        case STYLE.plaster: return { bay: 3.0, wx0: 0.27, wx1: 0.73, wy0: 0.30, wy1: 0.80 };
        default: return { bay: 6.0, wx0: 0.05, wx1: 0.95, wy0: 0.70, wy1: 0.92 };
    }
}

// facade.bk's hash3 (scene::hash2 over the floats' bits), for which rooms are lit.
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const bits = (x) => { f32[0] = x; return u32[0]; };
function hash2(x, y) {
    let h = (Math.imul(x, 1973) + Math.imul(y, 9277)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    return ((h ^ (h >>> 15)) & 1023) / 1024;
}
export function hash3(a, b, c) {
    const ia = Math.imul(bits(a), 0x9e3779b1) >>> 0;
    return hash2((ia ^ Math.imul(bits(c), 0x85ebca77)) >>> 0, bits(b));
}

/** Whether the facade shows bay `bay` of floor `fl` lit at night (facade.bk's lit). */
export function bayLit(M, bay, fl, ground) {
    const id = M.id;
    const bshare = 0.25 + 1.5 * hash3(id, 7, 1) * hash3(id, 11, 2);
    let p = 0.3 * bshare;
    if (M.style === STYLE.glass || M.style === STYLE.office) p = (hash3(fl, 3, id) < 0.3 ? 0.7 : 0.06) * bshare;
    if (ground && (M.flags & 2)) p = 0.85;
    // (Multiplied in f32, as facade.bk does: the hash takes the bits, and a
    // double's product rounded after differs from f32's in the last bit for
    // some bays, lighting different windows than the facade's.)
    const F32 = Math.fround;
    return hash3(F32(F32(bay) * F32(1.7)), F32(F32(fl) * F32(2.3)), F32(id + 5)) < p;
}

/** The mass's floors: { fl, y0, y1, ground } in local heights, the ground floor first. */
export function floorsOf(M) {
    const out = [{ fl: 0, y0: 0, y1: Math.min(M.groundH, M.h), ground: true }];
    for (let fl = 1, y = M.groundH; y + 2.2 <= M.h + 0.01; fl++, y += M.floorH) {
        out.push({ fl, y0: y, y1: Math.min(M.h, y + M.floorH), ground: false });
    }
    return out;
}

// A face's frame: face 0 front (+z), 1 back (-z), 2 right (+x), 3 left (-x);
// u across it as facade.bk measures it, W its width.
function faceFrame(M, face) {
    const { hw, hd } = M;
    if (face === 0) return { W: 2 * hw, at: (u, d) => [u - hw, hd - d], n: [0, -1] };
    if (face === 1) return { W: 2 * hw, at: (u, d) => [hw - u, -hd + d], n: [0, 1] };
    if (face === 2) return { W: 2 * hd, at: (u, d) => [hw - d, hd - u], n: [-1, 0] };
    return { W: 2 * hd, at: (u, d) => [-hw + d, u - hd], n: [1, 0] };
}

/** Face `face`'s openings on floor F (the facade's windows, and the door): [{ u0, u1, y0, y1, door }]. */
export function openingsOf(M, face, F) {
    const { W } = faceFrame(M, face);
    const shop = (M.flags & 2) !== 0;
    const L = layoutFor(M.style, F.ground, shop);
    const nb = Math.max(1, Math.floor(W / L.bay + 0.501)), bw = W / nb;   // (building.bk's margin)
    const fh = F.ground ? M.groundH : M.floorH;
    const out = [];
    const doorBay = Math.floor(nb * 0.5);
    const hasDoor = face === 0 && F.ground && !shop && (M.flags & 1) !== 0 && M.style !== STYLE.industrial;
    for (let b = 0; b < nb; b++) {
        if (hasDoor && b === doorBay) {
            out.push({ u0: (b + 0.3) * bw, u1: (b + 0.7) * bw, y0: 0, y1: 0.62 * fh, door: true, bay: b });
            continue;
        }
        let u0 = (b + L.wx0) * bw, u1 = (b + L.wx1) * bw;
        if (M.style !== STYLE.glass) { u0 = Math.max(u0, 0.6); u1 = Math.min(u1, W - 0.6); }
        let y0 = F.y0 + L.wy0 * fh, y1 = F.y0 + L.wy1 * fh;
        if (M.style !== STYLE.glass) y1 = Math.min(y1, M.h - 0.9);
        y1 = Math.min(y1, F.y1);   // (a top floor cut short by the roof: glass to the roof's edge)
        if (M.style === STYLE.industrial && F.ground && face === 0 && Math.abs((u0 + u1) / 2 - W / 2) < 2.6 + (u1 - u0) / 2 && y0 < 4.5) continue;
        if (u1 - u0 < 0.25 || y1 - y0 < 0.3) continue;
        out.push({ u0, u1, y0, y1, door: false, bay: b });
    }
    return { list: out, nb, bw };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function builder(M) {
    const P = [], N = [], C = [], I = [];
    const c = Math.cos(M.yaw), s = Math.sin(M.yaw);
    // Local to world (as building.bk's vertex stage).
    const W = (x, y, z) => [M.cx + c * x + s * z, M.y0 + y, M.cz - s * x + c * z];
    const WN = (x, y, z) => [c * x + s * z, y, -s * x + c * z];
    const quad = (a, b, cc, d, n, col) => {
        const base = P.length / 3, wn = WN(n[0], n[1], n[2]);
        for (const v of [a, b, cc, d]) { const w = W(v[0], v[1], v[2]); P.push(w[0], w[1], w[2]); N.push(wn[0], wn[1], wn[2]); C.push(col[0], col[1], col[2], 1); }
        // Wound to face n.
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
        const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0) I.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else I.push(base, base + 2, base + 1, base, base + 3, base + 2);
    };
    // An axis-aligned box in local coordinates (all six faces, or `faces` of them).
    const box = (x0, y0, z0, x1, y1, z1, col, faces = 63) => {
        if (faces & 1) quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], col);
        if (faces & 2) quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], col);
        if (faces & 4) quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], col);
        if (faces & 8) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], col);
        if (faces & 16) quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], col);
        if (faces & 32) quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], col);
    };
    const mesh = () => new bro.mesh.Mesh({
        positions: new Float32Array(P), normals: new Float32Array(N), colors: new Float32Array(C), indices: new Uint32Array(I),
    });
    // Furniture pieces by kind (what a floor holds, for tests).
    const items = {};
    const add = (k) => { items[k] = (items[k] ?? 0) + 1; };
    return { quad, box, mesh, tris: () => I.length / 3, items, add };
}

function rng(seed) {
    let a = seed >>> 0 || 1;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WALL_IN = [[0.72, 0.70, 0.66], [0.66, 0.68, 0.70], [0.74, 0.69, 0.60], [0.60, 0.64, 0.58]];
// Packaging: cartons, labels, bottles (linear).
const GOODS = [[0.62, 0.12, 0.08], [0.08, 0.22, 0.55], [0.85, 0.65, 0.12], [0.12, 0.42, 0.18], [0.8, 0.78, 0.72], [0.45, 0.22, 0.42], [0.9, 0.42, 0.08], [0.15, 0.15, 0.16], [0.55, 0.62, 0.7], [0.7, 0.55, 0.4]];
const PALLET_LOAD = [[0.62, 0.48, 0.3], [0.55, 0.42, 0.26], [0.8, 0.8, 0.78], [0.2, 0.35, 0.6], [0.7, 0.62, 0.45]];
const WOOD = [[0.36, 0.24, 0.14], [0.46, 0.33, 0.20], [0.26, 0.18, 0.12]];
const FABRIC = [[0.30, 0.34, 0.42], [0.45, 0.20, 0.16], [0.36, 0.40, 0.30], [0.55, 0.50, 0.42], [0.20, 0.22, 0.24]];
const CEIL = [0.84, 0.83, 0.80];

// What a floor is used for.
function useOf(M, F) {
    if (M.style === STYLE.industrial) return 'shed';
    if (F.ground && (M.flags & 2)) return 'shop';
    if (M.style === STYLE.glass || M.style === STYLE.office) return 'office';
    return 'flat';
}

/**
 * The interior of mass M over the floors whose span meets `band` (local
 * heights): { mesh, lamps (emissive panels), lights (in the rooms the facade
 * shows lit: { x, y, z } world, lit, office }), floors built }.
 */
export function interiorMesh(M, band = [0, Infinity], skipBelow = 0) {
    const g = builder(M), lamps = builder(M), glass = builder(M), lights = [], window_ = [];
    // The lit rooms, (x0, z0, x1, z1) in the mass's frame, for interior_glow.bk.
    const glowRooms = [];
    const ix0 = -M.hw + T, ix1 = M.hw - T, iz0 = -M.hd + T, iz1 = M.hd - T;
    const wallC = WALL_IN[M.id % WALL_IN.length];
    const floors = floorsOf(M).filter((F) => F.y1 > band[0] && F.y0 < band[1] && F.y0 >= skipBelow - 0.01);
    for (const F of floors) {
        const R = rng(M.id * 7919 + F.fl * 31337 + 13);   // each storey its own rooms
        const use = useOf(M, F);
        const fy0 = F.y0 + (F.ground ? 0 : SLAB * 0.5), fy1 = F.y1 - SLAB * 0.5;
        const ch = fy1 - fy0;
        // Floor and ceiling.
        const floorC = use === 'office' ? [0.30, 0.31, 0.33] : use === 'shop' ? [0.62, 0.60, 0.56] : use === 'shed' ? [0.42, 0.42, 0.40] : WOOD[(M.id + F.fl) % WOOD.length];
        g.quad([ix0, fy0, iz0], [ix0, fy0, iz1], [ix1, fy0, iz1], [ix1, fy0, iz0], [0, 1, 0], floorC);
        g.quad([ix0, fy1, iz0], [ix1, fy1, iz0], [ix1, fy1, iz1], [ix0, fy1, iz1], [0, -1, 0], use === 'shed' ? [0.5, 0.5, 0.52] : CEIL);
        // The outer walls from inside, around the facade's openings, with reveals.
        for (let face = 0; face < 4; face++) {
            const fr = faceFrame(M, face);
            const { list } = openingsOf(M, face, F);
            const nn = [fr.n[0], 0, fr.n[1]];
            const P3 = (u, y, d) => { const [x, z] = fr.at(u, d); return [x, y, z]; };
            const wq = (u0, u1, y0, y1) => { if (u1 - u0 > 1e-3 && y1 - y0 > 1e-3) g.quad(P3(u0, y0, T), P3(u1, y0, T), P3(u1, y1, T), P3(u0, y1, T), nn, wallC); };
            let u = T;
            const ops = list.slice().sort((a, b) => a.u0 - b.u0);
            for (const o of ops) {
                const oy0 = Math.max(o.y0, fy0), oy1 = Math.min(o.y1, fy1);
                wq(u, o.u0, fy0, fy1);
                wq(o.u0, o.u1, fy0, oy0);
                wq(o.u0, o.u1, oy1, fy1);
                // Reveals: the opening's sides, sill and head through the wall.
                const rc = o.door ? [0.30, 0.22, 0.15] : [0.80, 0.79, 0.76];
                const along = [fr.at(1, 0)[0] - fr.at(0, 0)[0], 0, fr.at(1, 0)[1] - fr.at(0, 0)[1]];
                g.quad(P3(o.u0, oy0, 0), P3(o.u0, oy0, T), P3(o.u0, oy1, T), P3(o.u0, oy1, 0), along, rc);
                g.quad(P3(o.u1, oy0, 0), P3(o.u1, oy1, 0), P3(o.u1, oy1, T), P3(o.u1, oy0, T), [-along[0], 0, -along[2]], rc);
                if (!o.door) g.quad(P3(o.u0, oy0, 0), P3(o.u1, oy0, 0), P3(o.u1, oy0, T), P3(o.u0, oy0, T), [0, 1, 0], rc);
                g.quad(P3(o.u0, oy1, 0), P3(o.u0, oy1, T), P3(o.u1, oy1, T), P3(o.u1, oy1, 0), [0, -1, 0], rc);
                // Daylight through it: a soft light just inside (placed by day),
                // and its pane, facing out: the facade's glass is cut away while
                // the building is open, and this keeps its reflection. (In the
                // wall's outer quarter, outside the interior volume, which
                // begins mid-wall: inside it the pane would see no sky.)
                if (!o.door) {
                    const d = T * 0.2;
                    glass.quad(P3(o.u0, oy0, d), P3(o.u1, oy0, d), P3(o.u1, oy1, d), P3(o.u0, oy1, d), [-nn[0], 0, -nn[2]], [1, 1, 1]);
                    const [lx, lz] = fr.at((o.u0 + o.u1) / 2, T + 0.9);
                    const c = Math.cos(M.yaw), s = Math.sin(M.yaw);
                    window_.push({ p: [M.cx + c * lx + s * lz, M.y0 + (oy0 + oy1) / 2, M.cz - s * lx + c * lz], window: true, w: (o.u1 - o.u0) * (oy1 - oy0) });
                }
                u = o.u1;
            }
            wq(u, fr.W - T, fy0, fy1);
        }
        furnish(g, lamps, lights, M, F, use, { ix0, ix1, iz0, iz1, fy0, fy1, ch }, R, wallC, glowRooms);
    }
    return { glowRooms, mesh: g.mesh(), lamps: lamps.tris() ? lamps.mesh() : null, glass: glass.tris() ? glass.mesh() : null, lights, windows: window_, floors, tris: g.tris() + lamps.tris(), items: g.items };
}

// Rooms and their contents on one floor.
// A chair at (x, z) local, its sitter facing (fx, fz) (a unit axis): four
// legs, the seat, the back behind the sitter.
function chair(g, x, z, y0, fx, fz, col) {
    const h = 0.22, L = 0.025, legC = [0.18, 0.18, 0.19];
    for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) g.box(x + a * (h - L) - L, y0, z + b * (h - L) - L, x + a * (h - L) + L, y0 + 0.43, z + b * (h - L) + L, legC, 1 | 2 | 16 | 32);
    g.box(x - h, y0 + 0.43, z - h, x + h, y0 + 0.48, z + h, col);
    const bx = x - fx * (h - 0.03), bz = z - fz * (h - 0.03);
    const ax = Math.abs(fz) * h + Math.abs(fx) * 0.03, az = Math.abs(fx) * h + Math.abs(fz) * 0.03;
    g.box(bx - ax, y0 + 0.48, bz - az, bx + ax, y0 + 0.95, bz + az, col);
    g.add('chair');
}

function furnish(g, lamps, lights, M, F, use, b, R, wallC, glowRooms) {
    const { ix0, ix1, iz0, iz1, fy0, fy1, ch } = b;
    // A lit room's box for its glow: a few cm over its edges (its side of a
    // partition), and out through the outer wall where it meets one (the
    // windows' reveals).
    const glowRoom = (x0, x1, z0, z1) => {
        const E = 0.08, X = (v, lo, hi) => v <= lo + 0.3 ? -1e3 : v >= hi - 0.3 ? 1e3 : v;
        glowRooms.push(Math.max(X(x0, ix0, ix1), -M.hw - 0.1) - E, Math.max(X(z0, iz0, iz1), -M.hd - 0.1) - E,
            Math.min(X(x1, ix0, ix1), M.hw + 0.1) + E, Math.min(X(z1, iz0, iz1), M.hd + 0.1) + E);
    };
    const c = Math.cos(M.yaw), s = Math.sin(M.yaw);
    const world = (x, y, z) => [M.cx + c * x + s * z, M.y0 + y, M.cz - s * x + c * z];
    const panel = (x, z, w, d) => lamps.quad([x - w, fy1 - 0.02, z - d], [x + w, fy1 - 0.02, z - d], [x + w, fy1 - 0.02, z + d], [x - w, fy1 - 0.02, z + d], [0, -1, 0], [1, 1, 1]);
    const front = openingsOf(M, 0, F);
    const bw = front.bw, nb = front.nb;
    // Lit as the facade shows the windows onto it: each face's bays counted
    // along its u as facade.bk counts them, seen from outside (front +z from
    // -x, back -z from +x, right +x from +z, left -x from -z).
    const side = openingsOf(M, 2, F);
    const uOf = [(x, z) => x + M.hw, (x, z) => M.hw - x, (x, z) => M.hd - z, (x, z) => z + M.hd];
    const bayOn = (face, u) => {
        const o = face < 2 ? front : side;
        return bayLit(M, Math.max(0, Math.min(o.nb - 1, Math.floor(u / o.bw))), F.fl, F.ground);
    };
    // A room [x0, x1] x [z0, z1]: lit if a window on any face it reaches is.
    const litRoom = (x0, x1, z0, z1) => {
        const E = 0.3;
        const runs = [];
        if (z1 >= iz1 - E) runs.push([0, x0, x1, z1, z1]);
        if (z0 <= iz0 + E) runs.push([1, x0, x1, z0, z0]);
        if (x1 >= ix1 - E) runs.push([2, x1, x1, z0, z1]);
        if (x0 <= ix0 + E) runs.push([3, x0, x0, z0, z1]);
        for (const [face, ax, bx, az, bz] of runs) {
            const o = face < 2 ? front : side;
            const ua = uOf[face](ax, az), ub = uOf[face](bx, bz);
            for (let b = Math.floor(Math.min(ua, ub) / o.bw + 0.05); b <= Math.floor(Math.max(ua, ub) / o.bw - 0.05); b++) {
                if (bayOn(face, (b + 0.5) * o.bw)) return true;
            }
        }
        return false;
    };
    // A room's glow, window by window as the facade paints it: behind each
    // lit window its bay's width, facade.bk's room depth in, within the room.
    const depth = Math.min(7, Math.min(M.hw, M.hd) * 1.2 + 1);
    const glowWindows = (x0, x1, z0, z1) => {
        const E = 0.3;
        const faces = [[0, z1 >= iz1 - E], [1, z0 <= iz0 + E], [2, x1 >= ix1 - E], [3, x0 <= ix0 + E]];
        for (const [face, touches] of faces) {
            if (!touches) continue;
            const o = face < 2 ? front : side;
            for (let b = 0; b < o.nb; b++) {
                if (!bayLit(M, b, F.fl, F.ground)) continue;
                const u0 = b * o.bw, u1 = (b + 1) * o.bw;
                // The bay's span along the face and the slab in from it, in the frame.
                let bx0, bx1, bz0, bz1;
                if (face === 0) { bx0 = u0 - M.hw; bx1 = u1 - M.hw; bz0 = iz1 - depth; bz1 = iz1; }
                else if (face === 1) { bx0 = M.hw - u1; bx1 = M.hw - u0; bz0 = iz0; bz1 = iz0 + depth; }
                else if (face === 2) { bz0 = M.hd - u1; bz1 = M.hd - u0; bx0 = ix1 - depth; bx1 = ix1; }
                else { bz0 = u0 - M.hd; bz1 = u1 - M.hd; bx0 = ix0; bx1 = ix0 + depth; }
                bx0 = Math.max(bx0, x0); bx1 = Math.min(bx1, x1); bz0 = Math.max(bz0, z0); bz1 = Math.min(bz1, z1);
                if (bx1 - bx0 > 0.2 && bz1 - bz0 > 0.2) glowRoom(bx0, bx1, bz0, bz1);
            }
        }
    };
    // A ceiling panel at (x, z): lit as the window nearest it.
    const litAt = (x, z) => {
        const d = [iz1 - z, z - iz0, ix1 - x, x - ix0];
        let face = 0;
        for (let k = 1; k < 4; k++) if (d[k] < d[face]) face = k;
        return bayOn(face, uOf[face](x, z));
    };
    const A = ix1 - ix0, B = iz1 - iz0;

    if (use === 'office') {
        // Open plan: desk pairs in rows facing the windows, a core in the middle of a big plate.
        const core = A > 16 && B > 16 ? [-A * 0.15, -B * 0.15, A * 0.15, B * 0.15] : null;
        if (core) {
            g.box(core[0], fy0, core[1], core[2], fy1, core[3], [0.55, 0.55, 0.56], 63 - 12);
            g.add('lift core');
            // Lift doors on the core's front.
            for (let k = -1; k <= 1; k += 2) g.box(k * 1.3 - 0.55, fy0, core[3], k * 1.3 + 0.55, fy0 + 2.2, core[3] + 0.03, [0.62, 0.63, 0.66], 16);
        }
        const inCore = (x, z, m) => core && x > core[0] - m && x < core[2] + m && z > core[1] - m && z < core[3] + m;
        // Meeting tables by the end walls of a plate wide and deep enough.
        const meet = A > 14 && B > 6;
        const dx0 = meet ? ix0 + 4.6 : ix0 + 1.6, dx1 = meet ? ix1 - 4.6 : ix1 - 1.6;
        for (let z = iz0 + 2.2; z < iz1 - 2.0; z += 3.6) {
            for (let x = dx0; x < dx1; x += 1.8) {
                if (inCore(x, z, 1.6)) continue;
                const top = fy0 + 0.74;
                g.box(x - 0.78, top - 0.04, z - 0.4, x + 0.78, top, z + 0.4, [0.78, 0.76, 0.72]);
                g.box(x - 0.72, fy0, z - 0.36, x - 0.68, top - 0.04, z + 0.36, [0.2, 0.2, 0.21], 3);
                g.box(x + 0.68, fy0, z - 0.36, x + 0.72, top - 0.04, z + 0.36, [0.2, 0.2, 0.21], 3);
                g.box(x - 0.25, top, z - 0.05, x + 0.25, top + 0.32, z, [0.05, 0.05, 0.06]);       // a screen
                chair(g, x + (R() - 0.5) * 0.3, z + 0.75 + R() * 0.2, fy0, 0, -1, [0.12, 0.12, 0.14]);
                if (R() < 0.6) g.box(x + 0.35, top, z - 0.3, x + 0.6, top + 0.02, z - 0.1, [0.92, 0.92, 0.9], 4);   // papers
                g.add('desk'); g.add('screen');
            }
        }
        // A meeting table by each end wall, and plants along the windows.
        for (const x of meet ? [ix0 + 2.2, ix1 - 2.2] : []) {
            if (inCore(x, (iz0 + iz1) / 2, 2)) continue;
            const zc = (iz0 + iz1) / 2;
            g.box(x - 0.9, fy0 + 0.72, zc - 1.6, x + 0.9, fy0 + 0.76, zc + 1.6, [0.45, 0.33, 0.22]);
            g.box(x - 0.1, fy0, zc - 0.1, x + 0.1, fy0 + 0.72, zc + 0.1, [0.2, 0.2, 0.21]);
            g.add('meeting table');
            for (let k = -1; k <= 1; k++) for (const sx of [-1, 1]) chair(g, x + sx * 1.2, zc + k * 1.0, fy0, -sx, 0, [0.16, 0.2, 0.3]);
        }
        for (let x = ix0 + 1.0; x < ix1 - 0.6; x += 7.2) for (const z of [iz0 + 0.6, iz1 - 0.6]) {
            g.box(x - 0.2, fy0, z - 0.2, x + 0.2, fy0 + 0.4, z + 0.2, [0.32, 0.32, 0.34]);
            g.box(x - 0.32, fy0 + 0.4, z - 0.32, x + 0.32, fy0 + 1.2, z + 0.32, [0.10, 0.22, 0.07]);
            g.add('plant');
        }
        // Ceiling panels by bay (front to back), lit as the facade's bays are.
        for (let bay = 0; bay < nb; bay++) {
            const x = -M.hw + (bay + 0.5) * bw;
            if (x < ix0 + 0.4 || x > ix1 - 0.4) continue;
            for (let z = iz0 + 1.8; z < iz1 - 1.2; z += 3.6) {
                if (inCore(x, z, 0.5)) continue;
                const on = litAt(x, z);
                // (Its bay, and its row's 3.6 m; the first and last rows to the walls.)
                if (on) glowRoom(x - bw / 2, x + bw / 2, z - 1.8 < iz0 + 0.1 ? iz0 : z - 1.8, z + 3.6 >= iz1 - 1.2 ? iz1 : z + 1.8);
                if (on) panel(x, z, 0.3, 0.6);
                if (on) lights.push({ p: world(x, fy1 - 0.3, z), lit: true, office: true });
            }
        }
        return;
    }
    if (use === 'shop' || use === 'shed') {
        // Shelving in rows behind the front, a counter by the door.
        const shed = use === 'shed';
        if (litRoom(ix0, ix1, iz0, iz1)) glowRoom(ix0, ix1, iz0, iz1);
        for (let x = ix0 + 2; x < ix1 - 2; x += shed ? 4.5 : 2.6) {
            for (let z = iz0 + (shed ? 2 : 1.5); z < iz1 - 4.5; z += shed ? 6 : 99) {
                const z1 = Math.min(iz1 - (shed ? 2 : 4.2), z + (shed ? 4.5 : 99));
                const h = shed ? Math.min(ch - 0.6, 4.2) : 1.7;
                const rows = shed ? 3 : 4, frameC = shed ? [0.30, 0.38, 0.55] : [0.82, 0.82, 0.80];
                // Bays of uprights, a shelf at every level, a spine down the middle.
                const bay = shed ? 2.7 : 1.2;
                for (let zz = z; zz <= z1 + 1e-3; zz += bay) g.box(x - 0.45, fy0, Math.min(zz, z1) - 0.03, x + 0.45, fy0 + h, Math.min(zz, z1) + 0.03, shed ? [0.85, 0.45, 0.1] : frameC);
                if (!shed) g.box(x - 0.02, fy0, z, x + 0.02, fy0 + h, z1, frameC, 1 | 2);
                g.box(x - 0.45, fy0, z, x + 0.45, fy0 + 0.12, z1, frameC, 1 | 2 | 4);
                g.add(shed ? 'racking' : 'shelving');
                for (let k = 1; k <= rows; k++) {
                    const y = fy0 + 0.12 + (k - 1) / rows * (h - 0.12);
                    if (k > 1) g.box(x - 0.45, y - 0.03, z, x + 0.45, y, z1, frameC, 1 | 2 | 4 | 8);
                    const top = Math.min(y + (h - 0.12) / rows - 0.06, fy0 + h - 0.02);
                    if (shed) {
                        // Pallets: a load on a pallet, a gap here and there.
                        for (let zz = z + 0.15; zz + 1.1 < z1; zz += 1.3) {
                            if (R() < 0.15) continue;
                            g.box(x - 0.4, y, zz, x + 0.4, y + 0.14, zz + 1.1, [0.55, 0.40, 0.22], 1 | 2 | 4 | 16 | 32);
                            g.box(x - 0.38, y + 0.14, zz + 0.02, x + 0.38, y + 0.14 + (top - y - 0.14) * (0.5 + R() * 0.45), zz + 1.08, PALLET_LOAD[Math.floor(R() * PALLET_LOAD.length)], 1 | 2 | 4 | 16 | 32);
                            g.add('pallet');
                        }
                        continue;
                    }
                    // Goods: products shoulder to shoulder on both faces, each its own height and colour.
                    for (const side of [-1, 1]) {
                        for (let zz = z + 0.05; zz < z1 - 0.1;) {
                            const wz = 0.12 + R() * 0.28, run = Math.min(zz + wz * (1 + Math.floor(R() * 4)), z1 - 0.05);
                            const col = GOODS[Math.floor(R() * GOODS.length)], hh = (top - y) * (0.35 + R() * 0.55);
                            if (R() > 0.08) g.box(side < 0 ? x - 0.43 : x + 0.05, y, zz, side < 0 ? x - 0.05 : x + 0.43, y + hh, run, col, (side < 0 ? 2 : 1) | 4 | 16 | 32);
                            zz = run + 0.02;
                        }
                    }
                    g.add('goods');
                }
            }
        }
        if (!shed) {
            g.box(ix0 + 0.8, fy0, iz1 - 3.2, ix0 + 3.2, fy0 + 1.05, iz1 - 2.5, [0.32, 0.22, 0.14]); g.add('counter');
            g.box(ix0 + 1.4, fy0 + 1.05, iz1 - 3.0, ix0 + 1.8, fy0 + 1.3, iz1 - 2.7, [0.1, 0.1, 0.11]); g.add('till');
            // Display tables behind the window, goods on them.
            for (let x = ix0 + 4.5; x < ix1 - 1.5; x += 3.2) {
                g.box(x - 0.6, fy0, iz1 - 2.0, x + 0.6, fy0 + 0.8, iz1 - 1.2, [0.55, 0.42, 0.3]);
                g.box(x - 0.45, fy0 + 0.8, iz1 - 1.85, x + 0.45, fy0 + 0.95, iz1 - 1.35, FABRIC[(Math.floor(x) % FABRIC.length + FABRIC.length) % FABRIC.length]);
                g.add('display table');
            }
        } else {
            // A forklift's worth of crates on the floor.
            for (let x = ix0 + 3; x < ix1 - 3; x += 7) { g.box(x - 0.6, fy0, iz1 - 1.8, x + 0.6, fy0 + 1.2, iz1 - 0.6, [0.5, 0.36, 0.2]); g.add('crates'); }
        }
        for (let x = ix0 + 1.5; x < ix1 - 1; x += shed ? 6 : 3) {
            for (let z = iz0 + 1.5; z < iz1 - 1; z += shed ? 6 : 3) {
                panel(x, z, shed ? 0.2 : 0.5, shed ? 1.2 : 0.5);
                // Every panel a light (placeLights keeps the ones nearest the eye).
                // (A shed's are high-bay lamps, hung low enough and reaching far enough to light its floor.)
                lights.push(shed ? { p: world(x, Math.min(fy1 - 0.3, fy0 + 5.5), z), lit: true, office: true, range: 13, power: 700 } : { p: world(x, fy1 - 0.3, z), lit: true, office: true });
            }
        }
        return;
    }
    // Flats: rooms along the front and back, a corridor between them when deep enough.
    const corr = B > 9 ? 1.4 : 0;
    const zMid = (iz0 + iz1) / 2;
    const k = Math.max(1, Math.round(4.2 / bw));        // bays a room
    const bands = corr ? [[zMid + corr / 2, iz1, 0], [iz0, zMid - corr / 2, 1]] : [[iz0, iz1, 0]];
    for (const [z0, z1, back] of bands) {
        // Rooms: partitions at every k-th bay boundary.
        const xs = [ix0];
        for (let j = k; j < nb; j += k) { const x = -M.hw + j * bw; if (x > ix0 + 2 && x < ix1 - 2) xs.push(x); }
        xs.push(ix1);
        for (let r = 0; r + 1 < xs.length; r++) {
            const x0 = xs[r] + (r ? PART / 2 : 0), x1 = xs[r + 1] - (r + 2 < xs.length ? PART / 2 : 0);
            if (r + 2 < xs.length) {
                // The partition, a door in it near the corridor (or the back).
                const px = xs[r + 1], dz = back ? z1 - 0.4 - DOOR_W : z0 + 0.4;
                g.box(px - PART / 2, fy0, z0, px + PART / 2, fy1, dz, wallC, 3);
                g.box(px - PART / 2, fy0 + DOOR_H, dz, px + PART / 2, fy1, dz + DOOR_W, wallC, 3 | 8);
                g.box(px - PART / 2, fy0, dz + DOOR_W, px + PART / 2, fy1, z1, wallC, 3);
                g.add('partition');
            }
            // A room on an end wall is divided along it at the side's bay
            // boundaries, as the front's rooms are: the facade paints a room
            // behind each window, and one long room seen through them all
            // would show the light of one window through the next.
            // (Its partitions' doors by the inner wall, one room into the next.)
            const zs = [z0];
            const endX = r === 0 ? x0 : r + 2 === xs.length ? x1 : null;
            if (endX !== null) {
                const ks = Math.max(1, Math.round(4.2 / side.bw));
                for (let j = ks; j < side.nb; j += ks) {
                    // (The side's u runs along -z on the right face, +z on the left.)
                    const z = r === 0 ? j * side.bw - M.hd : M.hd - j * side.bw;
                    if (z > z0 + 3 && z < z1 - 3) zs.push(z);
                }
                zs.sort((a, b) => a - b);
                // (No room under 3 m deep: room()'s furniture is laid out for one.)
                for (let q = zs.length - 1; q > 1; q--) if (zs[q] - zs[q - 1] < 3) zs.splice(q, 1);
            }
            zs.push(z1);
            for (let q = 0; q + 1 < zs.length; q++) {
                const sz0 = zs[q] + (q ? PART / 2 : 0), sz1 = zs[q + 1] - (q + 2 < zs.length ? PART / 2 : 0);
                if (q + 2 < zs.length) {
                    const pz = zs[q + 1], inner = r === 0 ? x1 : x0;
                    const dx0 = r === 0 ? inner - 0.4 - DOOR_W : inner + 0.4;
                    g.box(x0, fy0, pz - PART / 2, dx0, fy1, pz + PART / 2, wallC, 16 | 32);
                    g.box(dx0, fy0 + DOOR_H, pz - PART / 2, dx0 + DOOR_W, fy1, pz + PART / 2, wallC, 16 | 32 | 8);
                    g.box(dx0 + DOOR_W, fy0, pz - PART / 2, x1, fy1, pz + PART / 2, wallC, 16 | 32);
                    g.add('partition');
                }
                const on = litRoom(x0, x1, sz0, sz1);
                glowWindows(x0, x1, sz0, sz1);
                room(g, panel, lights, world, { x0, x1, z0: sz0, z1: sz1, fy0, fy1, back, on }, R);
            }
        }
        // The corridor wall, a door into each room.
        if (corr) {
            const wz = back ? z1 : z0, n = back ? 32 : 16;
            let x = ix0;
            for (let r = 0; r + 1 < xs.length; r++) {
                const dx = (xs[r] + xs[r + 1]) / 2 - DOOR_W / 2;
                g.box(x, fy0, wz - PART / 2, dx, fy1, wz + PART / 2, wallC, n === 16 ? 16 | 32 : 16 | 32);
                g.box(dx, fy0 + DOOR_H, wz - PART / 2, dx + DOOR_W, fy1, wz + PART / 2, wallC, 16 | 32 | 8);
                x = dx + DOOR_W;
            }
            g.box(x, fy0, wz - PART / 2, ix1, fy1, wz + PART / 2, wallC, 16 | 32);
        }
    }
    if (corr) {
        for (let x = ix0 + 2; x < ix1 - 1; x += 5) panel(x, zMid, 0.25, 0.25);
    }
}

// One room of a flat: a bedroom, a living room or a kitchen, by its hash.
function room(g, panel, lights, world, r, R) {
    const { x0, x1, z0, z1, fy0, fy1, back, on } = r;
    const w = x1 - x0, d = z1 - z0;
    if (w < 1.8 || d < 1.8) return;
    // The window wall is at z1 for the front band, z0 for the back.
    const winZ = back ? z0 : z1, inZ = back ? z1 : z0, sg = back ? -1 : 1;
    const kind = R();
    const wood = WOOD[Math.floor(R() * WOOD.length)], fab = FABRIC[Math.floor(R() * FABRIC.length)];
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const zIn = (t) => inZ + sg * t;   // t metres from the inner wall toward the window
    const bx = (a0, a1, y0, y1, t0, t1, col, faces) => {
        const za = zIn(t0), zb = zIn(t1);
        g.box(a0, fy0 + y0, Math.min(za, zb), a1, fy0 + y1, Math.max(za, zb), col, faces);
    };
    // A rug.
    bx(cx - w * 0.3, cx + w * 0.3, 0.005, 0.015, d * 0.3, d * 0.75, mix3(fab, [0.8, 0.78, 0.72], 0.4), 4);
    g.add('rug');
    if (kind < 0.4 && w > 2.6 && d > 3.2) {
        // Bedroom: the bed's head on the inner wall, nightstands, a wardrobe.
        bx(cx - 0.8, cx + 0.8, 0, 0.45, 0.05, 2.1, wood);
        bx(cx - 0.78, cx + 0.78, 0.45, 0.62, 0.1, 2.05, [0.86, 0.85, 0.82]);
        bx(cx - 0.78, cx + 0.78, 0.62, 0.7, 0.15, 0.6, [0.9, 0.9, 0.88]);
        bx(cx - 0.78, cx + 0.78, 0.62, 0.66, 0.7, 2.05, fab);
        bx(cx - 0.8, cx + 0.8, 0, 1.05, 0.0, 0.08, wood);
        bx(cx - 1.35, cx - 0.9, 0, 0.55, 0.05, 0.5, wood);
        bx(cx + 0.9, cx + 1.35, 0, 0.55, 0.05, 0.5, wood);
        g.add('bed'); g.add('nightstand'); g.add('nightstand');
        if (w > 3.4) { bx(x0 + 0.05, x0 + 0.65, 0, 2.0, d * 0.55, Math.min(d - 0.4, d * 0.55 + 1.6), wood); g.add('wardrobe'); }
    } else if (kind < 0.75) {
        // Living room: a sofa on a side wall, a low table, a shelf, a television.
        bx(x0 + 0.05, x0 + 0.95, 0, 0.42, d * 0.25, d * 0.25 + 2.1, fab);
        bx(x0 + 0.05, x0 + 0.3, 0.42, 0.85, d * 0.25, d * 0.25 + 2.1, fab);
        bx(x0 + 1.4, x0 + 2.0, 0, 0.4, d * 0.3, d * 0.3 + 1.0, wood);
        bx(x1 - 0.4, x1 - 0.05, 0, 0.5, d * 0.25, d * 0.25 + 1.6, wood);
        bx(x1 - 0.12, x1 - 0.08, 0.8, 1.5, d * 0.3, d * 0.3 + 1.2, [0.03, 0.03, 0.035]);
        bx(cx - 0.6, cx + 0.6, 0, 1.9, 0.02, 0.38, wood);
        for (let k = 0; k < 4; k++) bx(cx - 0.55, cx + 0.55, 0.4 + k * 0.42, 0.42 + k * 0.42, 0.04, 0.36, mix3(wood, [0.9, 0.85, 0.7], 0.3));
        g.add('sofa'); g.add('coffee table'); g.add('sideboard'); g.add('television'); g.add('bookcase');
    } else {
        // Kitchen: units and a counter along the inner wall, a table and chairs.
        bx(x0 + 0.1, x1 - 0.1, 0, 0.9, 0.02, 0.62, [0.85, 0.84, 0.80]);
        bx(x0 + 0.1, x1 - 0.1, 0.9, 0.94, 0.0, 0.64, [0.25, 0.25, 0.27]);
        bx(x0 + 0.1, x1 - 0.1, 1.5, 2.2, 0.02, 0.36, [0.85, 0.84, 0.80]);
        g.add('kitchen units'); g.add('wall cupboards'); g.add('table');
        const tz = d * 0.6;
        bx(cx - 0.6, cx + 0.6, 0.72, 0.76, tz - 0.4, tz + 0.4, wood);
        bx(cx - 0.05, cx + 0.05, 0, 0.72, tz - 0.05, tz + 0.05, wood);
        for (const [ox, oz] of [[-0.85, 0], [0.85, 0], [0, -0.65], [0, 0.65]]) {
            if (tz + oz + 0.25 > d - 0.1) continue;
            const fz = -Math.sign(oz) * sg;
            chair(g, cx + ox, zIn(tz + oz), fy0, -Math.sign(ox), oz ? fz : 0, wood);
        }
    }
    // A plant by the window, sometimes.
    if (R() < 0.5) {
        const px = R() < 0.5 ? x0 + 0.35 : x1 - 0.35, pt = d - 0.45;
        bx(px - 0.16, px + 0.16, 0, 0.35, pt - 0.16, pt + 0.16, [0.45, 0.28, 0.18]);
        bx(px - 0.28, px + 0.28, 0.35, 0.95, pt - 0.28, pt + 0.28, [0.10, 0.22, 0.07]);
        g.add('plant');
    }
    // The ceiling lamp; a light when the facade shows the room lit.
    const lz = (z0 + z1) / 2;
    panel(cx, lz, 0.22, 0.22);
    lights.push({ p: world(cx, fy1 - 0.35, lz), lit: on, office: false });
    void winZ;
}

// ---------------------------------------------------------------------------
// The near building's interior, kept as the eye moves
// ---------------------------------------------------------------------------

const OPEN_DIST = 40;      // the eye this near a building's walls opens it
const CLOSE_DIST = 60;     // and this far closes it
const BAND = 26;           // floors this far above and below the eye are built
const MAX_LIGHTS = 160;  // (the engine culls lights per screen tile)
const MAX_SPEED = 14;     // m/s: faster than a slow drive, no building opens
const BUDGET_MS = 2;     // building floors a frame
const MAX_OPEN = 6;       // buildings open at once, the nearest
const MAX_VOLUMES = 48;   // their interior volumes (the engine loops over them a pixel)
const FADE_S = 0.4;      // the crossfade from the facade's painted rooms to the built ones
// The light inside as luminance per unit albedo (cd/m^2): daylight through
// the windows, some 150 lux, by day; by night the lamps' light off the
// ceiling and walls, some 25 lux (the facade's lit rooms show about this),
// the lamps themselves pooling more under them.
// (At night the volume's is only the city's glow through the glass: a room
// no lamp lights reads near black from the street, darker than the lamp-lit
// wall around it. A lit room's lamplight is interior_glow.bk's.)
const ambientFor = (night) => 45 * (1 - night) + 0.2 * night;
// A lit room's glow at night: facade.bk's night_glow (albedo x lamp share
// 0.8 x warm x room_night 5 x night), warm as its rooms' (offices cooler).
const ROOM_NIGHT = 5, ROOM_LAMP = 0.8;
const glowFor = (M, night) => {
    const k = M.style === STYLE.glass || M.style === STYLE.office ? 0.6 : 0.15;
    const w = [1 + (0.86 - 1) * k, 0.78 + (0.92 - 0.78) * k, 0.52 + (1 - 0.52) * k];
    return w.map((v) => v * ROOM_LAMP * ROOM_NIGHT * night);
};
let glowSource = null;
// By day most of it comes through the windows, falling off over a few metres
// in from them (a deep floor is dim in its middle); the lamps light it evenly.
const windowShareFor = (night) => 0.6 * (1 - night);
const WINDOW_DEPTH = 4;
// An open building's panes: facade.bk's glass tint (glass scatters almost
// nothing: what it shows is its reflection and the room through it), drawn
// blended (alpha < 1) so the room shows through and the sky's reflection
// lies over it whole.
const GLASS = [0.035, 0.04, 0.045, 0.35];

/**
 * Keep the interiors of the buildings near the eye (the MAX_OPEN nearest
 * within OPEN_DIST of their walls) built, each over the floors within BAND
 * metres of the eye's height, rebuilt as the eye climbs; `walls` is the
 * buildings' walls node, whose building.bk reads `open_state` (per mass: the
 * cut's fade and the band it cuts the windows over); `cuts` other nodes given
 * `open_list` (the open buildings' masses) and an alpha cutoff while any is
 * open, to cut themselves out of their footprints (the ground, which a
 * building cut into a rise has above its floor).
 */
export function createInteriors(scene, masses, walls, cuts = []) {
    const { data, buildings } = masses;
    // Buildings by 64 m cells of their centres.
    const CELL = 64, grid = new Map();
    const key = (i, j) => i * 100003 + j;
    buildings.forEach((b, bi) => {
        const k = key(Math.floor(b.x / CELL), Math.floor(b.z / CELL));
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(bi);
    });
    // Distance from (x, z) to a mass's walls (0 inside), and whether inside.
    const massDist = (M, x, z) => {
        const c = Math.cos(M.yaw), s = Math.sin(M.yaw), dx = x - M.cx, dz = z - M.cz;
        const lx = c * dx - s * dz, lz = s * dx + c * dz;
        const ex = Math.max(0, Math.abs(lx) - M.hw), ez = Math.max(0, Math.abs(lz) - M.hd);
        return Math.hypot(ex, ez);
    };
    // Warm the builder up at load (its first floor otherwise compiles in
    // the frame that opens the first building): a floor of each use.
    for (const style of [STYLE.brick, STYLE.office, STYLE.industrial]) {
        interiorMesh({ i: 0, cx: 0, y0: 0, cz: 0, yaw: 0, hw: 10, h: 12, hd: 9, floorH: 3.2, groundH: 4.2, plinth: 0, seed: 0.37, style, roof: 0, roofH: 0, flags: 3, hue: 0, id: 4242 }, [0, 12]);
    }

    // The open buildings, bi -> { bi, masses (each with the height it is
    // built above), band, volumes, floors (Map key -> { nodes, recs, y0, y1 }),
    // jobs, fade, closing, cut ([lo, hi] once its glass is cut), d (from the
    // eye) }.
    const open = new Map();
    let lights = [];   // every open building's, each with its building (B) and base intensity
    // (lights: placed; lamps: lit rooms' lamps wanting one, by day the offices' and shops')
    const stats = { buildings: 0, tris: 0, ms: 0, builds: 0, pending: 0, lights: 0, lamps: 0, roomLamps: 0 };
    let night = 0;

    // Per mass the cut building.bk reads; the open masses the cuts read.
    const stateBuf = bro.kernel.createBuffer(Math.max(16, masses.count * 16));
    stateBuf.write(new Float32Array(masses.count * 4));
    // The nodes drawing the buildings' walls (building.bk's, and destruction's
    // for a building taken down but standing): each reads the cut.
    const wallNodes = [walls];
    walls.setShaderBuffer('open_state', stateBuf);
    // Buildings taken down but standing whole, kept open as they were.
    const held = new Set();
    const MAX_LIST = 64;
    const listBuf = bro.kernel.createBuffer((MAX_LIST + 1) * 4);
    listBuf.write(new Int32Array(MAX_LIST + 1));
    for (const n of cuts) n.setShaderBuffer('open_list', listBuf);
    const rec4 = new Float32Array(4);
    function writeState(B) {
        const b = buildings[B.bi];
        rec4[0] = B.cut ? B.fade : 0; rec4[1] = B.cut ? B.cut[0] : 0; rec4[2] = B.cut ? B.cut[1] : 0; rec4[3] = 0;
        for (let k = 0; k < b.count; k++) stateBuf.write(rec4, (b.first + k) * 16);
    }
    // The ground's cut: every building whose glass is cut (and the cutoff on
    // while there is one).
    function writeList() {
        const list = [];
        for (const B of open.values()) {
            if (!B.cut) continue;
            const b = buildings[B.bi];
            for (let k = 0; k < b.count && list.length < MAX_LIST; k++) list.push(b.first + k);
        }
        const a = new Int32Array(MAX_LIST + 1); a[0] = list.length; a.set(list, 1);
        listBuf.write(a);
        const cutoff = list.length ? 0.5 : 0;
        for (const n of wallNodes) n.alphaCutoff = cutoff;
        for (const n of cuts) n.alphaCutoff = cutoff;
    }

    // Fade B's cut back out, then destroy it (close(B) at once).
    function release(B) {
        if (B.fade > 0) B.closing = true;
        else close(B);
    }
    function setFade(B, f) {
        B.fade = f;
        writeState(B);
        for (const l of lights) if (l.B === B) l.intensity = l.base * f;
    }
    function dropFloor(fr) { for (const n of fr.nodes) n.destroy(); }
    function close(B) {
        for (const fr of B.floors.values()) dropFloor(fr);
        for (const v of B.volumes) v.destroy();
        lights = lights.filter((l) => { if (l.B !== B) return true; l.destroy(); return false; });
        open.delete(B.bi);
        B.cut = null; B.fade = 0;
        writeState(B);
        writeList();
        stats.buildings = open.size;
    }
    function closeAll() { for (const B of [...open.values()]) close(B); }

    // B's glass cut over the floors built (they run on from the eye's floor,
    // so the span holds no gap once they are in).
    function setCut(B) {
        let lo = Infinity, hi = -Infinity;
        for (const fr of B.floors.values()) { lo = Math.min(lo, fr.y0); hi = Math.max(hi, fr.y1); }
        if (!Number.isFinite(lo)) return false;
        const had = !!B.cut;
        B.cut = [lo, hi];
        writeState(B);
        if (!had) writeList();
        return true;
    }

    // Mass M's interior volume. The light inside: little sky (more tinted
    // the ceilings with the ground's green and the floors with the sky's
    // blue), no sun, a warm fill; the exposure follows it.
    // (Its edge fade within a few cm of the walls: a wider one lit the
    // floor, shelves and walls by the windows with the outdoors', sun and
    // all, white under the room's exposure. It reaches a metre below the
    // ground floor and half one over the top ceiling: on its edge those were
    // lit as outdoors.) Its top is 2 cm over the roof: a surface is in the
    // enclosure it faces into, so the roof facing up is outdoors, the top
    // ceiling under it, facing down, is in; one half a metre over had the
    // roof in, near black.
    function enclosure(M) {
        const v = scene.createInteriorVolume({
            position: [M.cx, M.y0 + (M.h - 0.98) / 2, M.cz], size: [2 * M.hw - T, M.h + 1.02, 2 * M.hd - T],
            skyVisibility: SHELL_SKY, sunVisibility: 0, ambientColor: [1.0, 0.92, 0.82], ambientIntensity: ambientFor(night), blendDistance: 0.05,
            windowDepth: WINDOW_DEPTH, windowShare: windowShareFor(night),
        });
        v.rotation = [0, M.yaw, 0];
        return v;
    }
    // Buildings taken down but standing, bi -> their volumes (no rooms: their
    // pieces are their floors and walls; lib/city/destruction.js).
    const shells = new Map();
    const MAX_SHELL_VOLUMES = 16;
    const SHELL_SKY = 0.004;   // a whole shell's sky: indoors
    let shellVolumes = 0;

    // Open building bi: its volumes, and its floors about eyeY as jobs.
    function build(bi, eyeY, d) {
        const b = buildings[bi];
        const Ms = [];
        // (Plant, stacks and silos have no rooms.)
        for (let k = 0; k < b.count; k++) { const M = massRecord(data, b.first + k); if (M.style !== STYLE.plant) Ms.push(M); }
        const volumes = [];
        const masses = Ms.map((M) => {
            // A mass standing inside a larger one is built only above it.
            let skip = 0;
            for (const O of Ms) {
                if (O === M || O.hw * O.hd <= M.hw * M.hd) continue;
                if (massDist(O, M.cx, M.cz) === 0) skip = Math.max(skip, O.h + O.y0 - M.y0);
            }
            volumes.push(enclosure(M));
            return { M, skip, floors: floorsOf(M) };
        });
        const B = { bi, masses, band: null, volumes, floors: new Map(), jobs: [], fade: 0, closing: false, cut: null, d };
        open.set(bi, B);
        stats.buildings = open.size; stats.builds++;
        setBand(B, eyeY);
    }

    // Keep B's floors within BAND of eyeY: drop the rest, queue the missing
    // ones (the eye's nearest first). The fade is left as it is.
    function setBand(B, eyeY) {
        B.band = [eyeY - BAND, eyeY + BAND];
        const want = new Map();
        for (const { M, skip, floors } of B.masses) {
            for (const F of floors) {
                if (F.y0 < skip - 0.01) continue;
                if (!(M.y0 + F.y1 > B.band[0] && M.y0 + F.y0 < B.band[1])) continue;
                want.set(`${M.i}:${F.fl}`, { M, F, d: Math.abs(M.y0 + (F.y0 + F.y1) / 2 - eyeY) });
            }
        }
        let dropped = false;
        for (const [k, fr] of B.floors) if (!want.has(k)) { dropFloor(fr); B.floors.delete(k); dropped = true; }
        B.jobs = [...want].filter(([k]) => !B.floors.has(k)).map(([k, j]) => ({ key: k, ...j })).sort((a, b) => b.d - a.d);
        if (dropped) {
            // The cut follows the floors left; none left (the eye gone far
            // above or below), no cut: windows open on no rooms show through.
            if (B.floors.size) setCut(B);
            else if (B.cut) { B.cut = null; writeState(B); writeList(); }
            placeLights(lastEye);
        }
    }

    // Build queued floors for up to `budget` ms, the nearest building's first.
    function pump(budget) {
        const t0 = perf.now();
        let lit = false;
        for (const B of [...open.values()].filter((B) => !B.closing).sort((a, b) => a.d - b.d)) {
            let added = false;
            while (B.jobs.length && perf.now() - t0 < budget) {
                const { key, M, F } = B.jobs.pop();
                const r = interiorMesh(M, [F.y0 + 0.01, F.y1 - 0.01]);
                const fr = { nodes: [], recs: [...r.lights, ...r.windows], y0: M.y0 + F.y0, y1: M.y0 + F.y1 };
                stats.tris += r.tris;
                const room = scene.createMesh({ name: 'interior', mesh: r.mesh, roughness: 0.8, metallic: 0, vertexColorTint: true, color: [1, 1, 1], castsShadow: false, receivesShadow: true });
                fr.nodes.push(room);
                if (r.glowRooms.length) {
                    glowSource ??= require('fs').readFileSync(bro.resolvePath('/lib/city/interior_glow.bk'), 'utf8');
                    const n = Math.min(r.glowRooms.length / 4, 64);
                    const g = glowFor(M, night);
                    room.setShader({ module: glowSource, file: 'lib/city/interior_glow.bk',
                        uniforms: { frame: [M.cx, M.cz, Math.cos(M.yaw), Math.sin(M.yaw)], glow: [g[0], g[1], g[2], n] } });
                    room.setShaderBuffer('rooms', bro.kernel.createBuffer(new Float32Array(r.glowRooms.slice(0, n * 4))));
                    fr.glow = { node: room, M, n };
                }
                if (r.lamps) fr.nodes.push(scene.createMesh({ name: 'interior_lamps', mesh: r.lamps, color: [1, 1, 1], emissiveColor: [1, 0.95, 0.85], emissive: 400, castsShadow: false, receivesShadow: false }));
                if (r.glass) fr.nodes.push(scene.createMesh({ name: 'interior_glass', mesh: r.glass, color: GLASS, roughness: 0.04, metallic: 0, vertexColorTint: false, castsShadow: false, receivesShadow: false }));
                B.floors.set(key, fr);
                added = true;
            }
            // An opening building's glass is cut once all its floors are in
            // (the fade then dissolves it); an open one's as each floor is added.
            if (added && (B.fade > 0 || !B.jobs.length) && setCut(B)) lit = true;
            if (perf.now() - t0 >= budget) break;
        }
        stats.ms += perf.now() - t0;
        stats.pending = 0; for (const B of open.values()) stats.pending += B.jobs.length;
        if (lit) placeLights(lastEye);
    }

    // Point lights in the lit rooms nearest the eye, over every open building
    // whose glass is cut (the rest are lamps alone).
    let lastEye = [0, 0, 0];
    function placeLights(eye = lastEye) {
        for (const l of lights) l.destroy();
        lights = [];
        // By day the windows light the rooms (and the offices' and shops' lamps
        // stay on); by night the rooms the facade shows lit.
        const day = night < 0.5;
        const all = [];
        for (const B of open.values()) {
            if (!B.cut) continue;
            for (const fr of B.floors.values()) for (const l of fr.recs) {
                if (l.window ? day : l.lit && (l.office || !day)) all.push([l, B, (l.p[0] - eye[0]) ** 2 + (l.p[1] - eye[1]) ** 2 * 4 + (l.p[2] - eye[2]) ** 2]);
            }
        }
        all.sort((a, b) => a[2] - b[2]);
        // The lights shared out over the space before the density: each 5 m
        // cell of a floor its nearest first, a second only once every cell
        // has one (a shop's rows of lamps do not take every light while the
        // lit rooms above go dark).
        const rankIn = new Map();
        for (const e of all) {
            const p = e[0].p, k = `${Math.floor(p[0] / 5)},${Math.round(p[1])},${Math.floor(p[2] / 5)}`;
            const r = rankIn.get(k) ?? 0;
            rankIn.set(k, r + 1);
            e.push(r);
        }
        all.sort((a, b) => a[3] - b[3] || a[2] - b[2]);
        stats.lamps = all.length;
        stats.roomLamps = all.filter(([l]) => !l.window && !l.office).length;
        stats.lights = Math.min(all.length, MAX_LIGHTS);
        stats.roomLights = all.slice(0, MAX_LIGHTS).filter(([l]) => !l.window && !l.office).length;
        for (const [l, B] of all.slice(0, MAX_LIGHTS)) {
            const base = l.power ?? (l.window ? 90 * Math.min(4, l.w) : l.office ? 260 : 160);
            // A window's daylight spreads every way; a ceiling lamp shines
            // down and out (a wide spot), not up into the ceiling it hangs from.
            const light = scene.createLight({
                // (A lamp's range ends above the floor below's desks: lights
                // cast no shadows, so a longer one lit that floor through the slab.)
                type: l.window ? 'point' : 'spot', position: l.p, range: l.range ?? (l.window ? 8 : 5), intensity: base * B.fade,
                ...(l.window ? {} : { direction: [0, -1, 0], innerAngle: 0.6, outerAngle: 1.4 }),
                color: l.window ? [0.85, 0.92, 1.0] : l.office ? [0.95, 0.97, 1.0] : [1.0, 0.85, 0.65],
            });
            light.base = base;
            light.B = B;
            lights.push(light);
        }
    }

    let enabled = true;
    let prev = null, speed = 0;

    // The buildings within OPEN_DIST of (x, y, z) (0 inside one), not ones
    // the eye is far above, nearest first: [{ bi, d }].
    function near(x, y, z) {
        const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
        const out = [];
        for (let i = ci - 2; i <= ci + 2; i++) for (let j = cj - 2; j <= cj + 2; j++) {
            for (const bi of grid.get(key(i, j)) ?? []) {
                const b = buildings[bi];
                let bd = Infinity;
                for (let k = 0; k < b.count; k++) {
                    const M = massRecord(data, b.first + k);
                    // (A mass taken down, flag 4, is its pieces now (no rooms,
                    // unless held: still standing whole), and one hidden from
                    // view, 8, shows nothing.)
                    if (M.style === STYLE.plant || (M.flags & 8) || ((M.flags & 4) && !held.has(bi)) || y > M.y0 + M.h + 20) continue;
                    bd = Math.min(bd, massDist(M, x, z));
                }
                if (bd < OPEN_DIST) out.push({ bi, d: bd });
            }
        }
        return out.sort((a, b) => a.d - b.d);
    }
    const distTo = (bi, x, z) => {
        const b = buildings[bi];
        let d = Infinity;
        for (let k = 0; k < b.count; k++) d = Math.min(d, massDist(massRecord(data, b.first + k), x, z));
        return d;
    };

    /**
     * A frame: `eye` the camera, `nightLevel` 0..1, `dt` seconds. While the
     * eye goes at a walk or a slow drive (under MAX_SPEED) the MAX_OPEN
     * buildings nearest it within OPEN_DIST open (their volumes at most
     * MAX_VOLUMES); one gives way (fading out) past CLOSE_DIST, or when a
     * nearer one wants its place; their floors follow the eye's height,
     * BUDGET_MS a frame over them all, the nearest building's first.
     */
    function update(eye, nightLevel = night, dt = 1 / 60) {
        if (!enabled) { if (open.size) closeAll(); return; }
        const [x, y, z] = eye;
        const step = prev ? Math.hypot(x - prev[0], y - prev[1], z - prev[2]) : 0;
        // A jump (setPose) is not motion: the speed is unknown until a few
        // frames have measured it, so nothing opens on the frame it lands.
        if (step > 50) speed = 2 * MAX_SPEED;
        else if (dt > 0) speed += (step / dt - speed) * Math.min(1, dt * 4);
        prev = [x, y, z];
        const changed = nightLevel !== night;
        night = nightLevel;
        if (changed && open.size) {
            for (const B of open.values()) for (const v of B.volumes) { v.ambientIntensity = ambientFor(night); v.windowShare = windowShareFor(night); }
            for (const B of open.values()) for (const fr of B.floors.values()) {
                if (!fr.glow) continue;
                const g = glowFor(fr.glow.M, night);
                fr.glow.node.setShaderUniform('glow', [g[0], g[1], g[2], fr.glow.n]);
            }
            placeLights(lastEye);
        }
        if (changed) for (const vs of shells.values()) for (const v of vs) { v.ambientIntensity = ambientFor(night); v.windowShare = windowShareFor(night); }
        // Each one's fade: in once its floors are in, out while closing.
        for (const B of [...open.values()]) {
            // (Closing with no floors or no cut: nothing to fade; gone now,
            // or its volumes would light the box as indoors for good.)
            if (B.closing && (!B.floors.size || !B.cut)) { close(B); continue; }
            if (!B.floors.size || !(B.closing || !B.jobs.length || B.fade > 0)) continue;
            const f = Math.max(0, Math.min(1, B.fade + (B.closing ? -1 : 1) * dt / FADE_S));
            if (f !== B.fade) setFade(B, f);
            if (B.closing && f === 0) close(B);
        }
        for (const B of open.values()) B.d = distTo(B.bi, x, z);
        const slow = speed <= MAX_SPEED;
        const want = slow ? near(x, y, z).slice(0, MAX_OPEN) : [];
        const wanted = new Set(want.map((w) => w.bi));
        // Give way: too far, or not wanted while a wanted one waits for room.
        const waiting = want.some((w) => !open.has(w.bi));
        let live = 0;
        for (const B of open.values()) if (!B.closing) live++;
        for (const B of [...open.values()]) {
            if (B.closing) continue;
            // (No floors in its band and none coming: the eye has gone far
            // above it, where near() no longer finds it; it has no rooms to
            // show, only its volumes darkening it.)
            const empty = !B.floors.size && !B.jobs.length;
            if (empty || B.d > CLOSE_DIST || (waiting && live >= MAX_OPEN && !wanted.has(B.bi))) { release(B); live--; }
        }
        // Open the wanted ones there is room for (in buildings and volumes).
        let vols = 0;
        for (const B of open.values()) vols += B.volumes.length;
        for (const w of want) {
            if (open.has(w.bi) || live >= MAX_OPEN) continue;
            const n = buildings[w.bi].count;
            if (vols + n > MAX_VOLUMES) continue;
            if (!open.size) lastEye = [x, y, z];
            build(w.bi, y, w.d);
            live++; vols += n;
        }
        // The floors follow the eye's height; the lights its place.
        let moved = false;
        for (const B of open.values()) {
            if (B.closing) continue;
            if (Math.abs(y - (B.band[0] + B.band[1]) / 2) > BAND * 0.5) { lastEye = [x, y, z]; setBand(B, y); }
        }
        if (stats.pending === 0 && Math.hypot(x - lastEye[0], y - lastEye[1], z - lastEye[2]) > 6) { lastEye = [x, y, z]; moved = true; }
        if (moved) placeLights(lastEye);
        pump(BUDGET_MS);
    }

    return {
        update, stats, get speed() { return speed; },
        /** The open buildings: [{ bi, fade, closing, floors }]. */
        get opened() { return [...open.values()].map((B) => ({ bi: B.bi, fade: B.fade, closing: B.closing, floors: B.floors.size })); },
        close: closeAll,
        /** Building bi is taken down (its masses flagged 4): close it now if it is open. */
        forget(bi) { held.delete(bi); const B = open.get(bi); if (B) close(B); },
        /**
         * Building bi is taken down but stands whole (its pieces in place):
         * if it is open, it stays open (rooms, glass) until `release`, so
         * nothing about it changes until it breaks.
         */
        hold(bi) { if (open.has(bi)) held.add(bi); },
        /** Building bi, held, broke: its rooms fade out as any closing building's. */
        release(bi) { if (!held.delete(bi)) return; const B = open.get(bi); if (B) release(B); },
        /** Another node drawing buildings' walls (reads `open_state`; cuts its glass with the walls). */
        addWalls(node) { wallNodes.push(node); node.setShaderBuffer('open_state', stateBuf); node.alphaCutoff = walls.alphaCutoff; },
        /**
         * Building bi, taken down, still stands as its pieces: its rooms are
         * dark as indoors (its volumes, no rooms built) until `unenclose`.
         * False when the shells' volume budget is spent.
         */
        enclose(bi) {
            if (shells.has(bi)) return true;
            const b = buildings[bi];
            const Ms = [];
            for (let k = 0; k < b.count; k++) { const M = massRecord(data, b.first + k); if (M.style !== STYLE.plant) Ms.push(M); }
            if (shellVolumes + Ms.length > MAX_SHELL_VOLUMES) return false;
            shells.set(bi, Ms.map(enclosure));
            shellVolumes += Ms.length;
            return true;
        },
        /**
         * Building bi, enclosed, broken open by `open` (0..1: 0 whole, 1 as
         * good as down): daylight in through the breaches. The sun at once (the
         * pieces' shadows keep it to what the holes let in), the sky by how
         * open it is (the sky's light has no shadows to hold it back).
         */
        breach(bi, open) {
            const vs = shells.get(bi);
            if (!vs) return;
            const o = Math.max(0, Math.min(1, open));
            for (const v of vs) {
                v.sunVisibility = o > 0 ? 1 : 0;
                v.skyVisibility = SHELL_SKY + (0.35 - SHELL_SKY) * Math.sqrt(o);
            }
        },
        /** Building bi no longer stands: its volumes go. */
        unenclose(bi) {
            const vs = shells.get(bi);
            if (!vs) return;
            for (const v of vs) v.destroy();
            shellVolumes -= vs.length;
            shells.delete(bi);
        },
        /** Build the open buildings' remaining floors now and finish their fades (tests, stills). */
        finish() { pump(Infinity); for (const B of open.values()) if (!B.closing && B.floors.size) setFade(B, 1); },
        get enabled() { return enabled; }, set enabled(v) { enabled = !!v; },
    };
}
