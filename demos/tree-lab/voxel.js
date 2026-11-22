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
        // (A ray short of steps ends on coarser cells: the forest's voxel
        // pass at 24 is 3.5 / 4.1 / 5.2 ms at 1.7 / 30 / 150 m, 4.3 / 4.9 /
        // 8.0 at the default 128, the crowns a little smoother from afar.)
        vd.setMaxRaySteps(24);
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
            let t = p.jitter ? 0.8 + 0.4 * ((Math.sin(k * 12.9898) * 43758.5453) % 1 + 1) % 1 : 1;
            // Shaded by the sky it sees (the voxels' ambient has no
            // occlusion of its own).
            if (p.sky) t *= 0.3 + 0.7 * p.sky(u[0], u[1], u[2]);
            col.set([p.rgb[0] * t, p.rgb[1] * t, p.rgb[2] * t, p.alpha ? p.alpha[k] : 1], (v + k) * 4);
        }
        for (let k = 0; k < I.length; k++) idx[i + k] = I[k] + v;
        v += n; i += I.length;
    }
    return { positions: pos, normals: nrm, colors: col, indices: idx };
}

// The sky each part of the crown sees: leaf area binned into a coarse grid
// (`n`^3 cells over the archetype's cube), then the light that comes down
// through the leaves above a cell and in from the four sides, each
// exp(-0.5 A / s^2) of what the cells between it and the edge hold. Returns
// (u, v, w) in [-1, 1]^3 -> the share of sky it sees, 0..1.
function skyVisibility(leaves, scale, toUnit, voxelSize, res, n = 48) {
    const P = leaves.positions, I = leaves.indices;
    const area = new Float32Array(n * n * n);
    const cell = (u) => Math.min(n - 1, Math.max(0, Math.floor((u + 1) / 2 * n)));
    for (let t = 0; t < I.length / 3; t++) {
        const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
        const e1x = (P[b] - P[a]) * scale, e1y = (P[b + 1] - P[a + 1]) * scale, e1z = (P[b + 2] - P[a + 2]) * scale;
        const e2x = (P[c] - P[a]) * scale, e2y = (P[c + 1] - P[a + 1]) * scale, e2z = (P[c + 2] - P[a + 2]) * scale;
        const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
        const u = toUnit((P[a] + P[b] + P[c]) / 3 * scale, (P[a + 1] + P[b + 1] + P[c + 1]) / 3 * scale,
            (P[a + 2] + P[b + 2] + P[c + 2]) / 3 * scale);
        area[(cell(u[0]) * n + cell(u[1])) * n + cell(u[2])] += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    }
    // A cell's optical depth: its leaves over the cell's face (s = the cell's side).
    const side = voxelSize * res / n;
    const k = 0.5 / (side * side);
    const vis = new Float32Array(n * n * n);
    const at = (x, y, z) => (x * n + y) * n + z;
    for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) {
        let up = 0;
        for (let y = n - 1; y >= 0; y--) { vis[at(x, y, z)] += Math.exp(-k * up) * 2; up += area[at(x, y, z)]; }
    }
    const sweep = (outer, inner, idx) => {
        for (let o1 = 0; o1 < n; o1++) for (let o2 = 0; o2 < n; o2++) {
            let f = 0, b = 0;
            for (let i = 0; i < n; i++) { const j = idx(o1, o2, i); vis[j] += Math.exp(-k * f); f += area[j]; }
            for (let i = n - 1; i >= 0; i--) { const j = idx(o1, o2, i); vis[j] += Math.exp(-k * b); b += area[j]; }
        }
    };
    sweep(0, 0, (y, z, x) => at(x, y, z));
    sweep(0, 0, (x, y, z) => at(x, y, z));
    for (let i = 0; i < vis.length; i++) vis[i] /= 6;   // up counts twice: the sky is mostly above
    return (u, v, w) => vis[at(cell(u), cell(v), cell(w))];
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
    const at = ([px, py, pz]) => [x + size * (px * right[0] + pz * fwd[0]), size * py, z + size * (px * right[2] + pz * fwd[2])];
    const v = voxelWorld();
    const p = t.plant;
    const region = v.addRegion({
        center: at([cx, cy, cz]),
        right, up: [0, 1, 0], forward: fwd,
        voxelSize: t.voxelSize * size, maxDepth: t.depth, minDist, maxDist, castShadow, foliage: true,
        plant: { root: at(p.root), height: p.height * size, trunk: p.trunk, scale: p.scale * size },
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
    const sky = skyVisibility(leaves, scale, toUnit, voxelSize, 4 << depth);
    const mesh = merge([{ mesh: bark, rgb: BARK_RGB, sky }, { mesh: leaves, rgb: LEAF_RGB, jitter: true, alpha, sky }],
        scale, toUnit);
    const v = voxelWorld();
    const archetype = v.addArchetypeFromMesh(mesh, depth, { unitBounds: true, roughness: 0.8 });
    // The plant its vegetation records describe (any branch's record holds
    // the plant's root, height and trunk word), so the voxel tree sways as
    // the mesh tree does.
    const rec = world.emitBranchTubes().vegetation;
    const plant = { root: [rec[0] * scale, rec[1] * scale, rec[2] * scale], height: rec[3] * scale, trunk: rec[15], scale };
    return { archetype, centre: c, voxelSize, depth, plant, ms: Date.now() - t0, tris: mesh.indices.length / 3 };
}
