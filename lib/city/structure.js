// lib/city/structure.js — a building's load-bearing structure, from its
// masses, for lib/destruct to break.
//
// buildingStructure(data, building, groundAt) -> { members, joints }
//
// Each mass becomes members, boxes in the mass's own frame (buildings.js:
// x across, y up from its foot, z out of its street front):
//   foundation  the plinth under the ground floor, on the ground (anchored)
//   wall        a facade panel: one storey of one structural bay of a face,
//               its outer face the facade the building drew there
//   slab        a floor plate: one structural bay of one floor (the roof the
//               top one)
//   column      one storey of a column at an inner grid line (and, behind a
//               curtain wall, the perimeter's)
// Structural bays are whole facade bays (interior.js's layoutFor), so a panel
// breaks between windows, at the piers, as a real facade would.
// Joints say what rests on what (V: `b` stands on `a`) and what is tied to
// what beside it (H, its `span` the lever a load hung from it has).
// A mass standing on another (rooftop plant, a shaft on its podium's roof)
// rests on that mass's roof slabs under it instead of on a foundation.

import { MASS_FLOATS, STYLE } from "./buildings.js";
import { massRecord, layoutFor, floorsOf } from "./interior.js";
import { KIND, MAT, JOINT } from "../destruct/destruct.js";

// Per style: the facade's material and thickness, the structural bay the
// floors span (m), the slab's, and whether columns stand behind the facade too.
function system(style) {
    switch (style) {
        case STYLE.glass: return { mat: MAT.glass, t: 0.18, bay: 7.5, slab: 0.3, slabMat: MAT.concrete, perimeter: true };
        case STYLE.office: return { mat: MAT.concrete, t: 0.3, bay: 6.0, slab: 0.3, slabMat: MAT.concrete, perimeter: false };
        case STYLE.industrial: return { mat: MAT.steel, t: 0.12, bay: 9.0, slab: 0.2, slabMat: MAT.concrete, perimeter: true };
        case STYLE.siding: return { mat: MAT.timber, t: 0.18, bay: 4.0, slab: 0.25, slabMat: MAT.timber, perimeter: false };
        case STYLE.plant: return { mat: MAT.concrete, t: 0.25, bay: 5.0, slab: 0.25, slabMat: MAT.concrete, perimeter: false };
        default: return { mat: MAT.masonry, t: 0.36, bay: 4.8, slab: 0.28, slabMat: MAT.concrete, perimeter: false };
    }
}

// Grid lines along a face of width W (from -W/2): whole facade bays grouped
// into structural bays of about `target` metres.
function gridLines(W, bay, target) {
    const nb = Math.max(1, Math.floor(W / bay + 0.501));
    const bw = W / nb;
    const k = Math.max(1, Math.round(target / bw));
    let n = Math.max(1, Math.round(nb / k));
    const lines = [-W / 2];
    for (let i = 1; i < n; i++) lines.push(-W / 2 + Math.round(nb * i / n) * bw);
    lines.push(W / 2);
    return lines;
}

/**
 * The structure of building `b` (one of buildMasses' buildings) over the mass
 * records `data`. `groundAt(x, z)` is the ground's height there (a mass whose
 * foot is well above it stands on another mass).
 */
export function buildingStructure(data, b, groundAt) {
    const members = [];
    const joints = [];
    const add = (m) => { members.push(m); return members.length - 1; };
    const join = (a, bb, type, span = 0) => { if (a >= 0 && bb >= 0 && a !== bb) joints.push({ a, b: bb, type, span }); };
    // Each mass's roof slabs, to stand a mass on top of it on them.
    const roofs = [];

    const masses = [];
    for (let i = b.first; i < b.first + b.count; i++) masses.push(massRecord(data, i));
    // Lower feet first, so a mass's host is built before it.
    masses.sort((p, q) => p.y0 - q.y0 || p.i - q.i);

    for (const M of masses) {
        const S = system(M.style);
        const L = layoutFor(M.style, false, false);
        const xs = gridLines(2 * M.hw, L.bay, S.bay);
        const zs = gridLines(2 * M.hd, L.bay, S.bay);
        const nx = xs.length - 1, nz = zs.length - 1;
        const t = Math.min(S.t, M.hw * 0.4, M.hd * 0.4);
        const st = Math.min(S.slab, M.h * 0.1);
        const floors = floorsOf(M);
        const n = floors.length;
        const base = { frame: M.i, style: M.style };
        const ground = groundAt(M.cx, M.cz);
        const onRoof = M.y0 - ground > 1.5 && M.plinth < 0.5;
        const bearing = !S.perimeter;    // the facade carries the floors (else the columns behind it do)

        // What it stands on: its foundation, or the roof slabs under it.
        let found = -1;
        let host = [];
        if (onRoof) {
            for (const r of roofs) {
                for (const k of r.slabs) {
                    const s = members[k];
                    if (Math.abs(r.top - M.y0) < 0.6 && overlapsXZ(data, s, M)) host.push(k);
                }
            }
        }
        if (!host.length) {
            found = add({ ...base, kind: KIND.foundation, mat: MAT.concrete, c: [0, -M.plinth / 2, 0], h: [M.hw, Math.max(M.plinth / 2, 0.05), M.hd], anchor: true });
            host = [found];
        }

        // Per storey: slab cells (the storey's floor; the ground floor's is the
        // foundation), walls by face and bay, columns at the grid's vertices.
        let prevWalls = null, prevCols = null;
        for (let k = 0; k <= n; k++) {
            const top = k === n;
            const yb = top ? M.h : floors[k].y0;
            // Slabs: the floor of storey k (k >= 1), or the roof (k == n).
            let slabs = null;
            if (k >= 1) {
                slabs = new Int32Array(nx * nz).fill(-1);
                for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
                    const x0 = xs[ix] + (ix === 0 ? t : 0), x1 = xs[ix + 1] - (ix === nx - 1 ? t : 0);
                    const z0 = zs[iz] + (iz === 0 ? t : 0), z1 = zs[iz + 1] - (iz === nz - 1 ? t : 0);
                    if (x1 - x0 < 0.2 || z1 - z0 < 0.2) continue;
                    slabs[ix * nz + iz] = add({ ...base, kind: KIND.slab, mat: S.slabMat, storey: k, roof: top,
                        c: [(x0 + x1) / 2, yb - st / 2, (z0 + z1) / 2], h: [(x1 - x0) / 2, st / 2, (z1 - z0) / 2] });
                }
                // Tied to their neighbours across the floor.
                for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
                    const s = slabs[ix * nz + iz];
                    if (ix + 1 < nx) join(s, slabs[(ix + 1) * nz + iz], JOINT.H, (xs[ix + 2] - xs[ix]) / 2);
                    if (iz + 1 < nz) join(s, slabs[ix * nz + iz + 1], JOINT.H, (zs[iz + 2] - zs[iz]) / 2);
                }
            }
            // The slabs rest on the storey below's walls along the faces (where
            // the facade bears: a curtain wall or cladding hangs off the slabs
            // instead) and its columns.
            if (slabs && prevWalls && bearing) {
                for (const w of prevWalls) {
                    for (const [ix, iz] of w.cells) join(w.id, slabs[ix * nz + iz], JOINT.V);
                }
            }
            if (slabs && prevCols) {
                for (const col of prevCols) {
                    for (const [ix, iz] of col.cells) join(col.id, slabs[ix * nz + iz], JOINT.V);
                }
            }
            if (top) {
                roofs.push({ top: M.y0 + M.h, slabs: [...slabs].filter((s) => s >= 0) });
                if (M.roof > 0.5) pitched(M, xs, zs, nx, nz, slabs, base, add, join, members);
                break;
            }

            const yt = k === n - 1 ? M.h : floors[k + 1].y0;
            const w0 = k === 0 ? 0 : yb - st;                   // a wall covers its floor slab's edge
            const w1 = k === n - 1 ? M.h : yt - st;          // the top storey's to the parapet
            const walls = [];
            const wallAt = (x0, x1, z0, z1, cells) => {
                if (x1 - x0 < 0.1 || z1 - z0 < 0.1 || w1 - w0 < 0.3) return -1;
                const id = add({ ...base, kind: KIND.wall, mat: S.mat, storey: k,
                    c: [(x0 + x1) / 2, (w0 + w1) / 2, (z0 + z1) / 2], h: [(x1 - x0) / 2, (w1 - w0) / 2, (z1 - z0) / 2] });
                walls.push({ id, cells });
                return id;
            };
            // Front and back across the whole width; the sides between them.
            const front = [], back = [], right = [], left = [];
            for (let ix = 0; ix < nx; ix++) {
                front.push(wallAt(xs[ix], xs[ix + 1], M.hd - t, M.hd, [[ix, nz - 1]]));
                back.push(wallAt(xs[ix], xs[ix + 1], -M.hd, -M.hd + t, [[ix, 0]]));
            }
            for (let iz = 0; iz < nz; iz++) {
                const z0 = zs[iz] + (iz === 0 ? t : 0), z1 = zs[iz + 1] - (iz === nz - 1 ? t : 0);
                right.push(wallAt(M.hw - t, M.hw, z0, z1, [[nx - 1, iz]]));
                left.push(wallAt(-M.hw, -M.hw + t, z0, z1, [[0, iz]]));
            }
            // Tied along each face, and round the corners.
            for (const row of [front, back, right, left]) {
                for (let i = 0; i + 1 < row.length; i++) join(row[i], row[i + 1], JOINT.H, Math.max(members[row[i]]?.h[0] ?? 0, members[row[i]]?.h[2] ?? 0));
            }
            join(front[0], left[left.length - 1], JOINT.H, 1); join(front[nx - 1], right[right.length - 1], JOINT.H, 1);
            join(back[0], left[0], JOINT.H, 1); join(back[nx - 1], right[0], JOINT.H, 1);
            // A wall stands on the wall below it (or on what the mass stands on),
            // and is tied to the slab at its foot.
            for (let wi = 0; wi < walls.length; wi++) {
                const w = walls[wi];
                if (prevWalls) { if (prevWalls[wi] && bearing) join(prevWalls[wi].id, w.id, JOINT.V); }
                else for (const hh of host) join(hh, w.id, JOINT.V);
                if (slabs) for (const [ix, iz] of w.cells) join(slabs[ix * nz + iz], w.id, JOINT.H, 0.5);
            }

            // Columns: at the grid's inner vertices (and behind a curtain wall
            // along its edges too). Thicker the more storeys stand on them.
            const cols = [];
            const above = n - k;
            const cw = Math.min(0.25 + 0.022 * above * Math.sqrt(S.bay / 6), 1.4);
            for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
                const edge = ix === 0 || iz === 0 || ix === nx || iz === nz;
                if (edge && !S.perimeter) continue;
                const cx = Math.min(Math.max(xs[ix], -M.hw + t + cw / 2), M.hw - t - cw / 2);
                const cz = Math.min(Math.max(zs[iz], -M.hd + t + cw / 2), M.hd - t - cw / 2);
                const c1 = k === n - 1 ? M.h - st : yt - st;
                if (c1 - yb < 0.5) continue;
                const cells = [];
                for (const [dx, dz] of [[-1, -1], [-1, 0], [0, -1], [0, 0]]) {
                    const cx_ = ix + dx, cz_ = iz + dz;
                    if (cx_ >= 0 && cx_ < nx && cz_ >= 0 && cz_ < nz) cells.push([cx_, cz_]);
                }
                const id = add({ ...base, kind: KIND.column, mat: MAT.concrete, storey: k,
                    c: [cx, (yb + c1) / 2, cz], h: [cw / 2, (c1 - yb) / 2, cw / 2] });
                cols.push({ id, cells, key: ix * (nz + 1) + iz });
            }
            // A column stands on the one below it, and on the floor it rises from.
            const prevByKey = new Map((prevCols ?? []).map((c) => [c.key, c.id]));
            for (const col of cols) {
                const below = prevByKey.get(col.key);
                if (below !== undefined) join(below, col.id, JOINT.V);
                else if (k === 0) for (const hh of host) join(hh, col.id, JOINT.V);
                if (slabs) for (const [ix, iz] of col.cells) join(slabs[ix * nz + iz], col.id, JOINT.V);
            }
            prevWalls = walls; prevCols = cols;
        }
    }
    return { members, joints };
}

// A pitched roof (gable or hip, its ridge along x; building.bk's prism, 0.45 m
// eaves): its two slopes split at the ridge and at the structural bays, each
// a box from the eaves to the ridge whose top destruction.bk lays on the
// slope. They rest on the roof slab cells under them, tied along the ridge
// and to their neighbours.
const EAVES = 0.45;
function pitched(M, xs, zs, nx, nz, slabs, base, add, join, members) {
    const rw = M.hw + EAVES, rd = M.hd + EAVES;
    const y0 = M.h - 0.12, y1 = M.h + M.roofH;
    const halves = [[-rd, 0], [0, rd]];
    const ids = [];
    for (let ix = 0; ix < nx; ix++) {
        const x0 = ix === 0 ? -rw : xs[ix], x1 = ix === nx - 1 ? rw : xs[ix + 1];
        const pair = halves.map(([z0, z1]) => add({ ...base, kind: KIND.roof, mat: MAT.timber,
            c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], h: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2] }));
        ids.push(pair);
        join(pair[0], pair[1], JOINT.H, rd);
        if (ix > 0) { join(ids[ix - 1][0], pair[0], JOINT.H, (x1 - x0) / 2); join(ids[ix - 1][1], pair[1], JOINT.H, (x1 - x0) / 2); }
        // On the roof slab cells of its bay and half.
        for (let iz = 0; iz < nz; iz++) {
            const s = slabs[ix * nz + iz];
            if (s < 0) continue;
            const zc = members[s].c[2];
            join(s, pair[zc < 0 ? 0 : 1], JOINT.V);
        }
    }
}

// Whether slab member `s` (in its own mass's frame) lies under mass M's footprint.
function overlapsXZ(data, s, M) {
    const o = s.frame * MASS_FLOATS;
    const yaw = data[o + 3], c = Math.cos(yaw), sn = Math.sin(yaw);
    const wx = data[o] + c * s.c[0] + sn * s.c[2], wz = data[o + 2] - sn * s.c[0] + c * s.c[2];
    const mc = Math.cos(M.yaw), ms = Math.sin(M.yaw);
    const dx = wx - M.cx, dz = wz - M.cz;
    const lx = mc * dx - ms * dz, lz = ms * dx + mc * dz;
    const r = Math.max(s.h[0], s.h[2]);
    return Math.abs(lx) < M.hw + r && Math.abs(lz) < M.hd + r;
}
