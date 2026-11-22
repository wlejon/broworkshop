// A grown tree as voxels: its bark and leaf cards (at the size `draw` gives
// them) voxelized into one bro.voxeldag archetype, and a region that stands
// it where the mesh tree stands, for the far rings of a forest.
import { scene, leafCard } from "/app/lab.js";

const BARK_RGB = [0.2, 0.17, 0.14], LEAF_RGB = [0.07, 0.13, 0.04];

// Each leaf vertex's opacity: that of the voxel its triangle is in, the share
// of rays the voxel's leaves stop. Leaves of area A (all sides turned every
// way) in a voxel of side s let exp(-0.5 A / s^2) of the light through it.
function leafOpacity(leaves, scale, toUnit, res, voxelSize) {
    const P = leaves.positions, I = leaves.indices;
    const cell = (u) => Math.min(res - 1, Math.max(0, Math.floor((u + 1) / 2 * res)));
    const area = new Map(), triCell = new Int32Array(I.length / 3);
    for (let t = 0; t < I.length / 3; t++) {
        const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
        const e1 = [0, 1, 2].map((i) => (P[b + i] - P[a + i]) * scale);
        const e2 = [0, 1, 2].map((i) => (P[c + i] - P[a + i]) * scale);
        const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
        const u = toUnit(...[0, 1, 2].map((i) => (P[a + i] + P[b + i] + P[c + i]) / 3 * scale));
        const key = (cell(u[0]) * res + cell(u[1])) * res + cell(u[2]);
        triCell[t] = key;
        area.set(key, (area.get(key) ?? 0) + 0.5 * Math.hypot(cx, cy, cz));
    }
    const alpha = new Float32Array(P.length / 3).fill(1);
    for (let t = 0; t < I.length / 3; t++) {
        const op = 1 - Math.exp(-0.5 * area.get(triCell[t]) / (voxelSize * voxelSize));
        for (let j = 0; j < 3; j++) alpha[I[t * 3 + j]] = Math.max(op, 1 / 255);
    }
    return alpha;
}

let vd = null;
export function voxelWorld() {
    if (!vd) {
        vd = bro.voxeldag.createWorld(scene);
        vd.setLodScale(1.0);
    }
    return vd;
}

// Positions, normals and indices of `parts` ({ mesh, rgb }) in one mesh with
// per-vertex colours, scaled by `scale` and mapped by `toUnit` (a metre point
// to the archetype's [-1, 1]^3).
function merge(parts, scale, toUnit) {
    let nv = 0, ni = 0;
    for (const p of parts) { nv += p.mesh.positions.length / 3; ni += p.mesh.indices.length; }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 4), idx = new Uint32Array(ni);
    let v = 0, i = 0;
    for (const p of parts) {
        const P = p.mesh.positions, N = p.mesh.normals, I = p.mesh.indices, n = P.length / 3;
        for (let k = 0; k < n; k++) {
            const u = toUnit(P[k * 3] * scale, P[k * 3 + 1] * scale, P[k * 3 + 2] * scale);
            pos.set(u, (v + k) * 3);
            if (N) nrm.set([N[k * 3], N[k * 3 + 1], N[k * 3 + 2]], (v + k) * 3);
            // A leaf's own shade, as the scatter tints them.
            const t = p.jitter ? 0.8 + 0.4 * ((Math.sin(k * 12.9898) * 43758.5453) % 1 + 1) % 1 : 1;
            col.set([p.rgb[0] * t, p.rgb[1] * t, p.rgb[2] * t, p.alpha ? p.alpha[k] : 1], (v + k) * 4);
        }
        for (let k = 0; k < I.length; k++) idx[i + k] = I[k] + v;
        v += n; i += I.length;
    }
    return { positions: pos, normals: nrm, colors: col, indices: idx };
}

/**
 * Voxelize a grown world's tree drawn at `scale` (leaves `leaf` x their grown
 * size) at `depth` ((4 << depth)^3 voxels over its bounding cube) and stand
 * it at (x, z). Returns { region, archetype, voxelSize, ms }.
 */
export function voxelTree(world, opts = {}) {
    const t = voxelArchetype(world, opts);
    const region = standVoxelTree(t, opts);
    return { region, archetype: t.archetype, voxelSize: t.voxelSize, ms: t.ms, tris: t.tris };
}

/**
 * Stand an archetype from voxelArchetype at (x, z), turned `yaw` radians
 * about its trunk and `size` times as big: a region of its own, so it stands
 * anywhere, not on a lattice of cells.
 */
export function standVoxelTree(t, { x = 0, z = 0, yaw = 0, size = 1, minDist = 0, maxDist = 0, castShadow = true } = {}) {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const right = [cs, 0, -sn], fwd = [sn, 0, cs];
    const [cx, cy, cz] = t.centre;
    const v = voxelWorld();
    const region = v.addRegion({
        center: [x + size * (cx * right[0] + cz * fwd[0]), size * cy, z + size * (cx * right[2] + cz * fwd[2])],
        right, up: [0, 1, 0], forward: fwd,
        voxelSize: t.voxelSize * size, maxDepth: t.depth, minDist, maxDist, castShadow, foliage: true,
    });
    v.place(region, 0, 0, 0, t.archetype, 0);
    return region;
}

/** The tree as an archetype: { archetype, centre (its cube's, from the root, m), voxelSize, depth, ms, tris }. */
export function voxelArchetype(world, { scale = 1, leaf = 1, depth = 5 } = {}) {
    const t0 = Date.now();
    const k = leaf / scale;
    const bark = world.emitMesh(6);
    const leaves = world.emitFoliageMesh(leafCard(k), { seed: 0x1eaf, perArea: 90 / (k * k) });
    // The tree's bounding cube, in metres.
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const m of [bark, leaves]) {
        const P = m.positions;
        for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) {
            lo[a] = Math.min(lo[a], P[i + a] * scale); hi[a] = Math.max(hi[a], P[i + a] * scale);
        }
    }
    const half = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 * 1.02;
    const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const toUnit = (px, py, pz) => [(px - c[0]) / half, (py - c[1]) / half, (pz - c[2]) / half];
    const voxelSize = (2 * half) / (4 << depth);
    const alpha = leafOpacity(leaves, scale, toUnit, 4 << depth, voxelSize);
    const mesh = merge([{ mesh: bark, rgb: BARK_RGB }, { mesh: leaves, rgb: LEAF_RGB, jitter: true, alpha }], scale, toUnit);
    const v = voxelWorld();
    const archetype = v.addArchetypeFromMesh(mesh, depth, { unitBounds: true, roughness: 0.8 });
    return { archetype, centre: c, voxelSize, depth, ms: Date.now() - t0, tris: mesh.indices.length / 3 };
}
