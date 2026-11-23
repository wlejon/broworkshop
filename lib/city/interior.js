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
// createInteriors(scene, masses, walls) -> { update(eye, night, dt), finish(), close(), stats, enabled }

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

// building.bk's layout_for: bay width, window across the bay and up the floor.
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

// building.bk's hash3 (scene::hash2 over the floats' bits), for which rooms are lit.
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

/** Whether the facade shows bay `bay` of floor `fl` lit at night (building.bk's lit). */
export function bayLit(M, bay, fl, ground) {
    const id = M.id;
    const bshare = 0.25 + 1.5 * hash3(id, 7, 1) * hash3(id, 11, 2);
    let p = 0.3 * bshare;
    if (M.style === STYLE.glass || M.style === STYLE.office) p = (hash3(fl, 3, id) < 0.3 ? 0.7 : 0.06) * bshare;
    if (ground && (M.flags & 2)) p = 0.85;
    return hash3(bay * 1.7, fl * 2.3, id + 5) < p;
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
// u across it as building.bk measures it, W its width.
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
    const nb = Math.max(1, Math.floor(W / L.bay + 0.5)), bw = W / nb;
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
    return { quad, box, mesh, tris: () => I.length / 3 };
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
    const g = builder(M), lamps = builder(M), lights = [], window_ = [];
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
                // Daylight through it: a soft light just inside (placed by day).
                if (!o.door) {
                    const [lx, lz] = fr.at((o.u0 + o.u1) / 2, T + 0.9);
                    const c = Math.cos(M.yaw), s = Math.sin(M.yaw);
                    window_.push({ p: [M.cx + c * lx + s * lz, M.y0 + (oy0 + oy1) / 2, M.cz - s * lx + c * lz], window: true, w: (o.u1 - o.u0) * (oy1 - oy0) });
                }
                u = o.u1;
            }
            wq(u, fr.W - T, fy0, fy1);
        }
        furnish(g, lamps, lights, M, F, use, { ix0, ix1, iz0, iz1, fy0, fy1, ch }, R, wallC);
    }
    return { mesh: g.mesh(), lamps: lamps.tris() ? lamps.mesh() : null, lights, windows: window_, floors, tris: g.tris() + lamps.tris() };
}

// Rooms and their contents on one floor.
function furnish(g, lamps, lights, M, F, use, b, R, wallC) {
    const { ix0, ix1, iz0, iz1, fy0, fy1, ch } = b;
    const c = Math.cos(M.yaw), s = Math.sin(M.yaw);
    const world = (x, y, z) => [M.cx + c * x + s * z, M.y0 + y, M.cz - s * x + c * z];
    const panel = (x, z, w, d) => lamps.quad([x - w, fy1 - 0.02, z - d], [x + w, fy1 - 0.02, z - d], [x + w, fy1 - 0.02, z + d], [x - w, fy1 - 0.02, z + d], [0, -1, 0], [1, 1, 1]);
    const front = openingsOf(M, 0, F);
    const bw = front.bw, nb = front.nb;
    const litBay = (bay) => bayLit(M, bay, F.fl, F.ground);
    const bayAtX = (x) => Math.max(0, Math.min(nb - 1, Math.floor((x + M.hw) / bw)));
    const A = ix1 - ix0, B = iz1 - iz0;

    if (use === 'office') {
        // Open plan: desk pairs in rows facing the windows, a core in the middle of a big plate.
        const core = A > 16 && B > 16 ? [-A * 0.15, -B * 0.15, A * 0.15, B * 0.15] : null;
        if (core) {
            g.box(core[0], fy0, core[1], core[2], fy1, core[3], [0.55, 0.55, 0.56], 63 - 12);
            // Lift doors on the core's front.
            for (let k = -1; k <= 1; k += 2) g.box(k * 1.3 - 0.55, fy0, core[3], k * 1.3 + 0.55, fy0 + 2.2, core[3] + 0.03, [0.62, 0.63, 0.66], 16);
        }
        const inCore = (x, z, m) => core && x > core[0] - m && x < core[2] + m && z > core[1] - m && z < core[3] + m;
        for (let z = iz0 + 2.2; z < iz1 - 2.0; z += 3.6) {
            for (let x = ix0 + 1.6; x < ix1 - 1.6; x += 1.8) {
                if (inCore(x, z, 1.6)) continue;
                const top = fy0 + 0.74;
                g.box(x - 0.78, top - 0.04, z - 0.4, x + 0.78, top, z + 0.4, [0.78, 0.76, 0.72]);
                g.box(x - 0.72, fy0, z - 0.36, x - 0.68, top - 0.04, z + 0.36, [0.2, 0.2, 0.21], 3);
                g.box(x + 0.68, fy0, z - 0.36, x + 0.72, top - 0.04, z + 0.36, [0.2, 0.2, 0.21], 3);
                g.box(x - 0.25, top, z - 0.05, x + 0.25, top + 0.32, z, [0.05, 0.05, 0.06]);       // a screen
                g.box(x - 0.25, fy0 + 0.42, z + 0.55, x + 0.25, fy0 + 0.48, z + 1.0, [0.12, 0.12, 0.14]);   // a chair
                g.box(x - 0.25, fy0 + 0.48, z + 0.95, x + 0.25, fy0 + 1.05, z + 1.0, [0.12, 0.12, 0.14]);
            }
        }
        // Ceiling panels by bay (front to back), lit as the facade's bays are.
        for (let bay = 0; bay < nb; bay++) {
            const x = -M.hw + (bay + 0.5) * bw;
            if (x < ix0 + 0.4 || x > ix1 - 0.4) continue;
            const on = litBay(bay);
            for (let z = iz0 + 1.8; z < iz1 - 1.2; z += 3.6) {
                if (inCore(x, z, 0.5)) continue;
                if (on) panel(x, z, 0.3, 0.6);
                if (on && Math.abs(z - (iz0 + iz1) / 2) < 3.7) lights.push({ p: world(x, fy1 - 0.3, z), lit: true, office: true });
            }
        }
        return;
    }
    if (use === 'shop' || use === 'shed') {
        // Shelving in rows behind the front, a counter by the door.
        const shed = use === 'shed';
        for (let x = ix0 + 2; x < ix1 - 2; x += shed ? 4.5 : 2.6) {
            for (let z = iz0 + (shed ? 2 : 1.5); z < iz1 - 4.5; z += shed ? 6 : 99) {
                const z1 = Math.min(iz1 - (shed ? 2 : 4.2), z + (shed ? 4.5 : 99));
                const h = shed ? Math.min(ch - 0.6, 4.2) : 1.7;
                g.box(x - 0.45, fy0, z, x + 0.45, fy0 + h, z1, shed ? [0.30, 0.38, 0.55] : [0.82, 0.82, 0.80]);
                const rows = shed ? 3 : 4;
                for (let k = 1; k <= rows; k++) {
                    const y = fy0 + (k / (rows + 1)) * h;
                    const goods = FABRIC[(((k + Math.floor(x)) % FABRIC.length) + FABRIC.length) % FABRIC.length];
                    g.box(x - 0.5, y, z + 0.1, x + 0.5, y + (shed ? 0.6 : 0.24), z1 - 0.1, shed ? [0.55, 0.40, 0.22] : goods, 1 | 2 | 4);
                }
            }
        }
        if (!shed) g.box(ix0 + 0.8, fy0, iz1 - 3.2, ix0 + 3.2, fy0 + 1.05, iz1 - 2.5, [0.32, 0.22, 0.14]);
        for (let x = ix0 + 1.5; x < ix1 - 1; x += shed ? 6 : 3) {
            for (let z = iz0 + 1.5; z < iz1 - 1; z += shed ? 6 : 3) {
                panel(x, z, shed ? 0.2 : 0.5, shed ? 1.2 : 0.5);
                if (Math.abs(x) < (shed ? 7 : 4) && Math.abs(z) < (shed ? 7 : 4)) lights.push({ p: world(x, fy1 - 0.3, z), lit: true, office: true });
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
            }
            const firstBay = bayAtX(x0 + 0.5), lastBay = bayAtX(x1 - 0.5);
            let on = false;
            for (let bay = firstBay; bay <= lastBay; bay++) on = on || litBay(bay);
            room(g, panel, lights, world, { x0, x1, z0, z1, fy0, fy1, back, on }, R);
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
    if (kind < 0.4 && w > 2.6 && d > 3.2) {
        // Bedroom: the bed's head on the inner wall, nightstands, a wardrobe.
        bx(cx - 0.8, cx + 0.8, 0, 0.45, 0.05, 2.1, wood);
        bx(cx - 0.78, cx + 0.78, 0.45, 0.62, 0.1, 2.05, [0.86, 0.85, 0.82]);
        bx(cx - 0.78, cx + 0.78, 0.62, 0.7, 0.15, 0.6, [0.9, 0.9, 0.88]);
        bx(cx - 0.78, cx + 0.78, 0.62, 0.66, 0.7, 2.05, fab);
        bx(cx - 0.8, cx + 0.8, 0, 1.05, 0.0, 0.08, wood);
        bx(cx - 1.35, cx - 0.9, 0, 0.55, 0.05, 0.5, wood);
        bx(cx + 0.9, cx + 1.35, 0, 0.55, 0.05, 0.5, wood);
        if (w > 3.4) bx(x0 + 0.05, x0 + 0.65, 0, 2.0, d * 0.55, Math.min(d - 0.4, d * 0.55 + 1.6), wood);
    } else if (kind < 0.75) {
        // Living room: a sofa on a side wall, a low table, a shelf, a television.
        bx(x0 + 0.05, x0 + 0.95, 0, 0.42, d * 0.25, d * 0.25 + 2.1, fab);
        bx(x0 + 0.05, x0 + 0.3, 0.42, 0.85, d * 0.25, d * 0.25 + 2.1, fab);
        bx(x0 + 1.4, x0 + 2.0, 0, 0.4, d * 0.3, d * 0.3 + 1.0, wood);
        bx(x1 - 0.4, x1 - 0.05, 0, 0.5, d * 0.25, d * 0.25 + 1.6, wood);
        bx(x1 - 0.12, x1 - 0.08, 0.8, 1.5, d * 0.3, d * 0.3 + 1.2, [0.03, 0.03, 0.035]);
        bx(cx - 0.6, cx + 0.6, 0, 1.9, 0.02, 0.38, wood);
        for (let k = 0; k < 4; k++) bx(cx - 0.55, cx + 0.55, 0.4 + k * 0.42, 0.42 + k * 0.42, 0.04, 0.36, mix3(wood, [0.9, 0.85, 0.7], 0.3));
    } else {
        // Kitchen: units and a counter along the inner wall, a table and chairs.
        bx(x0 + 0.1, x1 - 0.1, 0, 0.9, 0.02, 0.62, [0.85, 0.84, 0.80]);
        bx(x0 + 0.1, x1 - 0.1, 0.9, 0.94, 0.0, 0.64, [0.25, 0.25, 0.27]);
        bx(x0 + 0.1, x1 - 0.1, 1.5, 2.2, 0.02, 0.36, [0.85, 0.84, 0.80]);
        const tz = d * 0.6;
        bx(cx - 0.6, cx + 0.6, 0.72, 0.76, tz - 0.4, tz + 0.4, wood);
        bx(cx - 0.05, cx + 0.05, 0, 0.72, tz - 0.05, tz + 0.05, wood);
        for (const [ox, oz] of [[-0.85, 0], [0.85, 0], [0, -0.65], [0, 0.65]]) {
            if (tz + oz + 0.25 > d - 0.1) continue;
            bx(cx + ox - 0.2, cx + ox + 0.2, 0.44, 0.48, tz + oz - 0.2, tz + oz + 0.2, wood);
        }
    }
    // A plant by the window, sometimes.
    if (R() < 0.5) {
        const px = R() < 0.5 ? x0 + 0.35 : x1 - 0.35, pt = d - 0.45;
        bx(px - 0.16, px + 0.16, 0, 0.35, pt - 0.16, pt + 0.16, [0.45, 0.28, 0.18]);
        bx(px - 0.28, px + 0.28, 0.35, 0.95, pt - 0.28, pt + 0.28, [0.10, 0.22, 0.07]);
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
const MAX_LIGHTS = 24;
const MAX_SPEED = 14;     // m/s: faster than a slow drive, no building opens
const BUDGET_MS = 2;     // building floors a frame
const SWITCH_MARGIN = 10; // m: another building this much nearer takes over
const FADE_S = 0.4;      // the crossfade from the facade's painted rooms to the built ones
// The light inside as luminance per unit albedo (cd/m^2): daylight through
// the windows, some 150 lux, by day; by night the city's glow alone (the
// rooms the facade shows lit have their lamps).
const ambientFor = (night) => 45 * (1 - night) + 0.4 * night;

/**
 * Keep the interior of the building nearest the eye (within OPEN_DIST of its
 * walls) built, over the floors within BAND metres of the eye's height,
 * rebuilt as the eye climbs; `walls` is the buildings' walls node, whose
 * building.bk `open` uniform cuts that building's windows over the band.
 */
export function createInteriors(scene, masses, walls) {
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

    // cur: the open building: { bi, Ms (its masses and the height each is
    // built above), band, volumes, floors (Map key -> { nodes, recs, y0, y1 }),
    // jobs, lights, fade, closing }.
    let cur = null;
    const stats = { building: -1, tris: 0, ms: 0, builds: 0, pending: 0 };
    let night = 0;

    // Fade the cut back out, then destroy (close() at once).
    function release() {
        if (!cur) return;
        if (cur.fade > 0) cur.closing = true;
        else close();
    }
    function setFade(f) {
        cur.fade = f;
        walls.setShaderUniform('open_fade', f);
        for (const l of cur.lights) l.intensity = l.base * f;
    }
    function dropFloor(fr) { for (const n of fr.nodes) n.destroy(); }
    function close() {
        if (!cur) return;
        for (const fr of cur.floors.values()) dropFloor(fr);
        for (const l of cur.lights) l.destroy();
        for (const v of cur.volumes) v.destroy();
        cur = null;
        walls.setShaderUniform('open', [-1, -1, 0, 0]);
        walls.setShaderUniform('open_fade', 0);
        walls.alphaCutoff = 0;
        stats.building = -1;
        stats.pending = 0;
    }
    const lightRecs = () => { const out = []; for (const fr of cur.floors.values()) for (const r of fr.recs) out.push(r); return out; };

    // The facade's glass cut over the floors built (they run on from the
    // eye's floor, so the span holds no gap once they are in).
    function setCut() {
        let lo = Infinity, hi = -Infinity;
        for (const fr of cur.floors.values()) { lo = Math.min(lo, fr.y0); hi = Math.max(hi, fr.y1); }
        const b = buildings[cur.bi];
        if (Number.isFinite(lo)) {
            walls.setShaderUniform('open', [b.first, b.first + b.count, lo, hi]);
            walls.alphaCutoff = 0.5;
        }
        return Number.isFinite(lo);
    }

    // Open building bi: its volumes, and its floors about eyeY as jobs.
    function build(bi, eyeY) {
        const b = buildings[bi];
        const Ms = [];
        for (let k = 0; k < b.count; k++) Ms.push(massRecord(data, b.first + k));
        const volumes = [];
        const masses = Ms.map((M) => {
            // A mass standing inside a larger one is built only above it.
            let skip = 0;
            for (const O of Ms) {
                if (O === M || O.hw * O.hd <= M.hw * M.hd) continue;
                if (massDist(O, M.cx, M.cz) === 0) skip = Math.max(skip, O.h + O.y0 - M.y0);
            }
            // The light inside: little sky, no sun, a warm fill; the exposure follows it.
            const v = scene.createInteriorVolume({
                position: [M.cx, M.y0 + M.h / 2, M.cz], size: [2 * M.hw - T, M.h, 2 * M.hd - T],
                skyVisibility: 0.015, sunVisibility: 0, ambientColor: [1.0, 0.92, 0.82], ambientIntensity: ambientFor(night), blendDistance: 0.4,
            });
            v.rotation = [0, M.yaw, 0];
            volumes.push(v);
            return { M, skip, floors: floorsOf(M) };
        });
        cur = { bi, masses, band: null, volumes, floors: new Map(), jobs: [], lights: [], fade: 0, closing: false };
        stats.building = bi; stats.tris = 0; stats.ms = 0; stats.builds++;
        setBand(eyeY);
    }

    // Keep the floors within BAND of eyeY: drop the rest, queue the missing
    // ones (the eye's nearest first). The fade is left as it is.
    function setBand(eyeY) {
        cur.band = [eyeY - BAND, eyeY + BAND];
        const want = new Map();
        for (const { M, skip, floors } of cur.masses) {
            for (const F of floors) {
                if (F.y0 < skip - 0.01) continue;
                if (!(M.y0 + F.y1 > cur.band[0] && M.y0 + F.y0 < cur.band[1])) continue;
                want.set(`${M.i}:${F.fl}`, { M, F, d: Math.abs(M.y0 + (F.y0 + F.y1) / 2 - eyeY) });
            }
        }
        let dropped = false;
        for (const [k, fr] of cur.floors) if (!want.has(k)) { dropFloor(fr); cur.floors.delete(k); dropped = true; }
        cur.jobs = [...want].filter(([k]) => !cur.floors.has(k)).map(([k, j]) => ({ key: k, ...j })).sort((a, b) => b.d - a.d);
        stats.pending = cur.jobs.length;
        if (dropped && cur.floors.size) { setCut(); placeLights(lastEye[1], lastEye); }
    }

    // Build queued floors for up to `budget` ms.
    function pump(budget) {
        if (!cur || !cur.jobs.length) return;
        const t0 = perf.now();
        let added = false;
        while (cur.jobs.length && perf.now() - t0 < budget) {
            const { key, M, F } = cur.jobs.pop();
            const r = interiorMesh(M, [F.y0 + 0.01, F.y1 - 0.01]);
            const fr = { nodes: [], recs: [...r.lights, ...r.windows], y0: M.y0 + F.y0, y1: M.y0 + F.y1 };
            stats.tris += r.tris;
            fr.nodes.push(scene.createMesh({ name: 'interior', mesh: r.mesh, roughness: 0.8, metallic: 0, vertexColorTint: true, color: [1, 1, 1], castsShadow: false, receivesShadow: true }));
            if (r.lamps) fr.nodes.push(scene.createMesh({ name: 'interior_lamps', mesh: r.lamps, color: [1, 1, 1], emissiveColor: [1, 0.95, 0.85], emissive: 400, castsShadow: false, receivesShadow: false }));
            cur.floors.set(key, fr);
            added = true;
        }
        stats.ms += perf.now() - t0;
        stats.pending = cur.jobs.length;
        // An opening building's glass is cut once all its floors are in (the
        // fade then dissolves it); an open one's as each floor is added.
        if (added && (cur.fade > 0 || !cur.jobs.length) && setCut()) placeLights(lastEye[1], lastEye);
    }

    // Point lights in the lit rooms nearest the eye (the rest are lamps alone).
    let lastEye = [0, 0, 0];
    function placeLights(eyeY, eye = lastEye) {
        if (!cur) return;
        for (const l of cur.lights) l.destroy();
        cur.lights = [];
        // By day the windows light the rooms (and the offices' and shops' lamps
        // stay on); by night the rooms the facade shows lit.
        const day = night < 0.5;
        const recs = lightRecs().filter((l) => (l.window ? day : l.lit && (l.office || !day)))
            .map((l) => [l, (l.p[0] - eye[0]) ** 2 + (l.p[1] - eyeY) ** 2 * 4 + (l.p[2] - eye[2]) ** 2])
            .sort((a, b) => a[1] - b[1]).slice(0, MAX_LIGHTS);
        for (const [l] of recs) {
            const base = l.window ? 90 * Math.min(4, l.w) : l.office ? 260 : 160;
            const light = scene.createLight({
                type: 'point', position: l.p, range: l.window ? 8 : 9, intensity: base * cur.fade,
                color: l.window ? [0.85, 0.92, 1.0] : l.office ? [0.95, 0.97, 1.0] : [1.0, 0.85, 0.65],
            });
            light.base = base;
            cur.lights.push(light);
        }
    }

    let enabled = true;
    let prev = null, speed = 0;

    // The building nearest (x, y, z) within OPEN_DIST of its walls (0 inside
    // one), not one the eye is far above: { bi, d } or null.
    function nearest(x, y, z) {
        const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
        let best = -1, bd = OPEN_DIST;
        for (let i = ci - 2; i <= ci + 2; i++) for (let j = cj - 2; j <= cj + 2; j++) {
            for (const bi of grid.get(key(i, j)) ?? []) {
                const b = buildings[bi];
                for (let k = 0; k < b.count; k++) {
                    const M = massRecord(data, b.first + k);
                    if (y > M.y0 + M.h + 20) continue;
                    const d = massDist(M, x, z);
                    if (d < bd) { bd = d; best = bi; }
                }
            }
        }
        return best >= 0 ? { bi: best, d: bd } : null;
    }
    const distTo = (bi, x, z) => {
        const b = buildings[bi];
        let d = Infinity;
        for (let k = 0; k < b.count; k++) d = Math.min(d, massDist(massRecord(data, b.first + k), x, z));
        return d;
    };

    /**
     * A frame: `eye` the camera, `nightLevel` 0..1, `dt` seconds. The
     * building nearest the eye opens while the eye goes at a walk or a slow
     * drive (under MAX_SPEED); the open one gives way (fading out) when the
     * eye is inside another or another is SWITCH_MARGIN nearer, or at
     * CLOSE_DIST; its floors follow the eye's height, BUDGET_MS a frame.
     */
    function update(eye, nightLevel = night, dt = 1 / 60) {
        if (!enabled) { if (cur) close(); return; }
        const [x, y, z] = eye;
        const step = prev ? Math.hypot(x - prev[0], y - prev[1], z - prev[2]) : 0;
        if (step > 50) speed = 0;   // a jump (setPose), not motion
        else if (dt > 0) speed += (step / dt - speed) * Math.min(1, dt * 4);
        prev = [x, y, z];
        const changed = nightLevel !== night;
        night = nightLevel;
        if (changed && cur) { for (const v of cur.volumes) v.ambientIntensity = ambientFor(night); placeLights(lastEye[1], lastEye); }
        // The fade: in once the floors are in, out while closing.
        if (cur && cur.floors.size && (cur.closing || !cur.jobs.length || cur.fade > 0)) {
            const f = Math.max(0, Math.min(1, cur.fade + (cur.closing ? -1 : 1) * dt / FADE_S));
            if (f !== cur.fade) setFade(f);
            if (cur.closing && f === 0) close();
        }
        if (cur && cur.closing) return;
        const slow = speed <= MAX_SPEED;
        if (cur) {
            const d = distTo(cur.bi, x, z);
            const other = slow ? nearest(x, y, z) : null;
            if (d > CLOSE_DIST || (other && other.bi !== cur.bi && ((other.d === 0 && d > 0) || other.d < d - SWITCH_MARGIN))) {
                release();
                return;
            }
            if (Math.abs(y - (cur.band[0] + cur.band[1]) / 2) > BAND * 0.5) { lastEye = [x, y, z]; setBand(y); }
            else if (!cur.jobs.length && Math.hypot(x - lastEye[0], y - lastEye[1], z - lastEye[2]) > 6) { lastEye = [x, y, z]; placeLights(y, eye); }
            pump(BUDGET_MS);
            return;
        }
        if (!slow) return;
        const n = nearest(x, y, z);
        if (n) { lastEye = [x, y, z]; build(n.bi, y); pump(BUDGET_MS); }
    }

    return {
        update, close, stats, get current() { return cur; }, get speed() { return speed; },
        /** Build the open building's remaining floors now and finish its fade (tests, stills). */
        finish() { pump(Infinity); if (cur && !cur.closing && cur.floors.size) setFade(1); },
        get enabled() { return enabled; }, set enabled(v) { enabled = !!v; },
    };
}
