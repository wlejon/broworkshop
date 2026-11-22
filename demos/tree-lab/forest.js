// A forest of the lab's trees: a mixed stand laid out by crown (each tree
// keeps clear of the others' crowns by a little, so the canopy closes without
// the crowns crossing), the trees nearest a point drawn as full meshes that
// sway, the rest as voxel trees, each in a region of its own (any position,
// turn and size).
import { growSpecies, measureTree, matureScale, draw } from "/app/lab.js";
import { voxelArchetype, standVoxelTree, voxelWorld } from "/app/voxel.js";

// What the stand is made of, and how much of it.
export const MIX = [
    { name: 'oak', share: 0.35 },
    { name: 'beech', share: 0.3 },
    { name: 'elm', share: 0.15 },
    { name: 'birch', share: 0.2 },
];

function mulberry32(a) {
    return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The species grown once: { name, world, m, k (draw scale), arch (voxels) }. */
export function growStand(mix = MIX, { seconds = 50, depth = 5 } = {}) {
    return mix.map((s) => {
        const { world } = growSpecies(s.name, { seconds });
        const m = measureTree(world);
        const k = matureScale(s.name, m);
        const arch = voxelArchetype(world, { scale: k, leaf: 1.5, depth });
        return Object.assign({}, s, { world, m, k, arch, radius: k * m.crownW / 2 });
    });
}

/**
 * Lay out trees over a `half`-metre square by dart throwing: a candidate's
 * species by share, its size 0.8-1.15, kept where no tree stands nearer than
 * `crowding` x their two crown radii.
 */
export function layout(species, { half = 300, seed = 7, crowding = 0.42, tries = 30000 } = {}) {
    const rng = mulberry32(seed);
    const cell = 12, grid = new Map(), trees = [];
    const key = (i, j) => i * 100003 + j;
    const total = species.reduce((a, s) => a + s.share, 0);
    for (let t = 0; t < tries; t++) {
        let u = rng() * total, sp = species[0];
        for (const s of species) { if ((u -= s.share) <= 0) { sp = s; break; } }
        const size = 0.8 + 0.35 * rng();
        const r = sp.radius * size;
        const x = (rng() * 2 - 1) * half, z = (rng() * 2 - 1) * half;
        const gi = Math.floor(x / cell), gj = Math.floor(z / cell), reach = Math.ceil((r + 40) / cell);
        let ok = true;
        for (let i = gi - reach; ok && i <= gi + reach; i++) {
            for (let j = gj - reach; ok && j <= gj + reach; j++) {
                for (const o of grid.get(key(i, j)) ?? []) {
                    if (Math.hypot(o.x - x, o.z - z) < crowding * (o.r + r)) { ok = false; break; }
                }
            }
        }
        if (!ok) continue;
        const tree = { sp, x, z, r, size, yaw: rng() * 2 * Math.PI };
        trees.push(tree);
        const k = key(gi, gj);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(tree);
    }
    return trees;
}

/**
 * Stand the trees: the `near` nearest (x0, z0) as swaying meshes, the rest as
 * voxel trees. Returns { meshes, regions }.
 */
export function plant(trees, { x0 = 0, z0 = 0, near = 6 } = {}) {
    const byDist = trees.slice().sort((a, b) => Math.hypot(a.x - x0, a.z - z0) - Math.hypot(b.x - x0, b.z - z0));
    const meshes = [], regions = [];
    byDist.forEach((t, i) => {
        if (i < near) {
            // (A mesh tree is not turned: draw places it as grown.)
            meshes.push(draw(t.sp.world, { x: t.x, z: t.z, scale: t.sp.k * t.size, leaf: 1.5 }));
        } else {
            regions.push(standVoxelTree(t.sp.arch, { x: t.x, z: t.z, yaw: t.yaw, size: t.size }));
        }
    });
    return { meshes, regions, pool: voxelWorld().stats() };
}
