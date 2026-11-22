// A forest of the lab's trees: a mixed stand laid out by crown (each tree
// keeps clear of the others' crowns by a little, so the canopy closes without
// the crowns crossing), every tree a voxel tree in a region of its own (any
// position, turn and size) that sways, the trees nearest the camera full
// meshes as well, handed over to their voxels without a seam.
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
export function growStand(mix = MIX, { seconds = 50, depth = 6 } = {}) {
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
 * Stand the trees, every one a voxel tree, and follow the camera with up to
 * `slots` swaying mesh trees: a tree whose nearest point comes within reach
 * of the band [handoff, 1.35 handoff] takes a mesh, which dithers out over
 * the band as its voxels dither in, pixel for pixel, and casts its shadow
 * while it holds the tree (its voxels do not). A tree gives its mesh back
 * once wholly past the band, so the swap is never seen. Call `update(eye)`
 * as the camera moves (`follow(vp)` does it each frame).
 * Returns { regions, update, follow, stats }.
 */
// (A forest's mesh trees draw a 1 x 2 segment leaf card, five times cheaper
// than the lab's 3 x 5, its leaves and their shadows, and seen as alike.)
export function plant(trees, { handoff = 30, slots = 8, card = [1, 2] } = {}) {
    const v = voxelWorld();
    const regions = trees.map((t) => standVoxelTree(t.sp.arch, { x: t.x, z: t.z, yaw: t.yaw, size: t.size }));
    const free = new Map(), held = new Map();   // species -> idle meshes; tree index -> mesh
    // (Up to `slots` meshes of each species, made as first wanted; at most
    // `slots` of them shown.)
    let made = 0, short = 0;
    const take = (sp) => {
        const idle = free.get(sp);
        if (idle?.length) return idle.pop();
        made++;
        const m = draw(sp.world, { scale: sp.k, leaf: 1.5, card });
        for (const n of [m.bark, m.leaves]) n.fadeOutDist = handoff;
        return m;
    };
    const show = (m, t, on) => {
        for (const n of [m.bark, m.leaves]) {
            n.visible = on;
            if (!on) continue;
            const s = t.sp.k * t.size;
            n.position = [t.x, 0, t.z];
            n.scale = [s, s, s];
            n.rotation = [0, t.yaw, 0];
        }
    };
    const enter = handoff * 1.35 + 5, leave = handoff * 1.35 + 15;
    const update = ([ex, ey, ez]) => {
        const near = [];
        trees.forEach((t, i) => {
            const h = t.sp.k * t.size * t.sp.m.height;
            const dh = Math.max(0, Math.hypot(t.x - ex, t.z - ez) - t.r);
            const dv = Math.max(0, ey - h, -ey);
            const d = Math.hypot(dh, dv);
            if (d < (held.has(i) ? leave : enter)) near.push([d, i]);
        });
        near.sort((a, b) => a[0] - b[0]);
        const want = new Set(near.slice(0, slots).map(([, i]) => i));
        short = Math.max(0, near.length - slots);
        for (const [i, m] of held) {
            if (want.has(i)) continue;
            show(m, trees[i], false);
            if (!free.has(trees[i].sp)) free.set(trees[i].sp, []);
            free.get(trees[i].sp).push(m);
            held.delete(i);
            v.updateRegion(regions[i], { minDist: 0, castShadow: true });
        }
        for (const i of want) {
            if (held.has(i)) continue;
            const m = take(trees[i].sp);
            if (!m) continue;
            show(m, trees[i], true);
            held.set(i, m);
            v.updateRegion(regions[i], { minDist: handoff, castShadow: false });
        }
    };
    return {
        regions, update,
        follow(vp) { vp.onView((view) => update(view.position)); },
        stats: () => ({ held: held.size, made, short, pool: v.stats() }),
    };
}
