// Drawing many copies of a creature in one frame, each in its own cell of
// a sheet: an orthographic camera over the whole page, every copy an
// instance of the creature's batch mesh placed at its cell (instance rows)
// with its own pose slot. The same mesh, hook and pose layout as the live
// view and the planet; only the instance transforms differ.

import { drawBatch } from "./batch.js";
import { ROWS } from "./skeleton.js";
import { groundHeights } from "./run.js";
import { relativePose, rootOf, toRelative } from "./cycle.js";

const DEG = Math.PI / 180;

// The camera: looking along +X, `elev` degrees down, k px a metre.
export function cellCamera(scene, W, H, k, elev = 6) {
    const e = elev * DEG;
    const f = [Math.cos(e), -Math.sin(e), 0];
    const r = [0, 0, 1];
    const u = [Math.sin(e), Math.cos(e), 0];
    const target = [0, 0, 0];
    if (scene) {
        scene.setCamera({
            mode: 'orthographic', size: H / k, aspect: W / H, near: 0.1, far: 200,
            eye: [-50 * f[0], -50 * f[1], 0], target, up: [0, 1, 0],
        });
    }
    const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return {
        k, W, H, elev: e,
        project: (p) => [W / 2 + dot3(p, r) * k, H / 2 - dot3(p, u) * k],
        unproject: (sx, sy) => {
            const a = (sx - W / 2) / k, b = (H / 2 - sy) / k;
            return [r[0] * a + u[0] * b, r[1] * a + u[1] * b, r[2] * a + u[2] * b];
        },
        // Vertical metres to screen pixels.
        vk: k * Math.cos(e),
    };
}

// A cell's placement: the creature's frame (root ground point at the
// origin, facing +Z) turned by `yaw` and put with its `pivot` at world A.
export function placement(A, yaw, pivot = [0, 0, 0]) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const rot = (p) => [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
    const rp = rot(pivot);
    const t = [A[0] - rp[0], A[1] - rp[1], A[2] - rp[2]];
    return {
        row: [c, 0, s, t[0], 0, 1, 0, t[1], -s, 0, c, t[2], 1, 1, 1, 1],
        apply: (p) => { const q = rot(p); return [q[0] + t[0], q[1] + t[1], q[2] + t[2]]; },
    };
}

// The same with any rotation M (row-major 3x3) in place of the turn.
export function placementM(A, M, pivot = [0, 0, 0]) {
    const rot = (p) => [0, 1, 2].map((r) => M[3 * r] * p[0] + M[3 * r + 1] * p[1] + M[3 * r + 2] * p[2]);
    const rp = rot(pivot);
    const t = [A[0] - rp[0], A[1] - rp[1], A[2] - rp[2]];
    return {
        row: [M[0], M[1], M[2], t[0], M[3], M[4], M[5], t[1], M[6], M[7], M[8], t[2], 1, 1, 1, 1],
        apply: (p) => { const q = rot(p); return [q[0] + t[0], q[1] + t[1], q[2] + t[2]]; },
    };
}

// The copies: cells [{ rec, step, place, tint? }] drawn from one pose buffer
// (or cells [{ pose, place }] with a pose of their own).
export function drawCells(scene, creature, cells) {
    const nb = creature.skel.count;
    const poses = new Float32Array(cells.length * nb * ROWS);
    const rows = new Float32Array(cells.length * 16);
    cells.forEach((c, i) => {
        if (c.pose) poses.set(c.pose, i * nb * ROWS);
        else relativePose(c.rec, c.step, c.ground, poses, i * nb * ROWS);
        rows.set(c.place.row, i * 16);
        if (c.tint) rows.set(c.tint, i * 16 + 12);
    });
    const buf = bro.kernel.createBuffer(poses);
    const node = drawBatch(scene, creature, buf, cells.length, { rows, shadows: false });
    return { node, buf, poses };
}

// The ground under each cell's creature, as one mesh: a patch `len` x
// `wide` m about the root in the creature's frame, checkered every 0.25 m
// so a sliding hoof reads against it.
export function groundCells(cells, { len = 2.4, wide = 1.0, z0 = 0.1, step = 0.1 } = {}) {
    const nx = Math.round(wide / step), nz = Math.round(len / step);
    const pts = [];
    for (const c of cells) {
        const r = rootOf(c.rec, c.step);
        const cy = Math.cos(r.yaw), sy = Math.sin(r.yaw);
        for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
            const lx = -wide / 2 + i * step, lz = z0 - len / 2 + j * step;
            pts.push(r.x + cy * lx + sy * lz, r.z - sy * lx + cy * lz);
        }
    }
    const h = groundHeights(cells[0].rec.env, new Float32Array(pts));
    const pos = [], nrm = [], col = [], idx = [];
    let at = 0;
    cells.forEach((c) => {
        const g = c.ground;
        const P = (i, j) => {
            const lx = -wide / 2 + i * step, lz = z0 - len / 2 + j * step;
            return c.place.apply([lx, h[at + j * (nx + 1) + i] - g, lz]);
        };
        for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
            const q = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
            const ax = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]];
            const az = [q[3][0] - q[0][0], q[3][1] - q[0][1], q[3][2] - q[0][2]];
            let n = [az[1] * ax[2] - az[2] * ax[1], az[2] * ax[0] - az[0] * ax[2], az[0] * ax[1] - az[1] * ax[0]];
            const l = Math.hypot(...n) || 1;
            n = n.map((v) => v / l);
            if (n[1] < 0) n = n.map((v) => -v);
            const lz = z0 - len / 2 + (j + 0.5) * step, lx = -wide / 2 + (i + 0.5) * step;
            const checker = (Math.floor(lz / 0.25 + 100) + Math.floor(lx / 0.25 + 100)) % 2;
            const v = checker ? 0.34 : 0.24;
            const b = pos.length / 3;
            for (const p of q) { pos.push(...p); nrm.push(...n); col.push(v, v, v * 0.97, 1); }
            idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
        }
        at += (nx + 1) * (nz + 1);
    });
    return new Mesh({ positions: new Float32Array(pos), normals: new Float32Array(nrm), colors: new Float32Array(col), indices: new Uint32Array(idx) });
}

// The ground height under a step's root.
export function groundUnder(rec, k) {
    const r = rootOf(rec, k);
    return groundHeights(rec.env, new Float32Array([r.x, r.z]))[0];
}

export { toRelative };
