// Run against tree-lab (it draws the trees):
//   bro-headless --grant files demos/tree-lab demos/metropolis/tools/export_trees.js
// Grows the city's species once and writes their levels of detail
// (tree-lab saveLevels) to
// demos/metropolis/assets/trees/, with trees.json: per species its draw
// scale k (the grown tree to its mature height), height, crown width and
// each level's triangles.
import { growSpecies, measureTree, matureScale, clear } from "/app/lab.js";
import { speciesLevels, saveLevels } from "/app/lod.js";

const DIR = bro.resolvePath('/app/../metropolis/assets/trees');
const NAMES = ['oak', 'elm', 'birch', 'beech'];
// The city's levels: from where each begins (m from the eye), the leaf
// card's size (L times the lab's leaf) and the tube sides; the far ones keep
// only the limbs at least minRadius thick (drawn metres).
// A branch is kept where it is over about a pixel wide (1080 rows, 50
// degrees) where its level begins, for a tree at about half its mature
// height (minRadius is in the mature tree's metres): the leaves hide the
// twigs beyond that.
const LEVELS = [
    { from: 0, L: 6, sides: 5, minRadius: 0.03 },
    { from: 40, L: 12, sides: 4, minRadius: 0.06, cluster: true },
    { from: 100, L: 24, sides: 3, minRadius: 0.1, cluster: true },
    { from: 220, L: 48, sides: 3, minRadius: 0.2, cluster: true },
    { from: 600, L: 96, sides: 3, minRadius: 0.35, cluster: true },
];
// Each level's leaf area (against the grown tree's) by species, calibrated
// in the city: a coarse level's cards are the finest level's grouped where
// they stand (cluster), and each grows by this factor until the level
// covers as much of what is behind it as the finest does there (the share of
// pixels the trees change against the empty view, tests/test_visual.js's
// tree check, over 48 trees of the city's other than the test's 24, within
// some 7 % a boundary). Beech's clumps overlap most, so its cards grow most;
// elm's coarse clusters cannot fill the finest's gaps, so past ~1.3 more area
// gains it little cover.
const AREA = {"elm": [1, 1.666, 2.675, 3.757, 2.694], "oak": [1, 1.158, 1.283, 1.186, 1.097], "beech": [1, 2.652, 4.715, 5.234, 3.418], "birch": [1, 0.876, 0.808, 0.613, 0.585]};
const out = { levels: LEVELS, species: {} };
clear();
for (const name of NAMES) {
    const t0 = perf.now();
    const { world } = growSpecies(name);
    const m = measureTree(world);
    const k = matureScale(name, m);
    const sp = { name, world, m, k };
    const levels = speciesLevels(sp, AREA[name] ? LEVELS.map((lv, i) => Object.assign({}, lv, { area: AREA[name][i] })) : LEVELS);
    saveLevels(levels, DIR, name, LEVELS);
    // The leaves' reach from the trunk over the levels drawn within 600 m (the
    // grown tree's metres; the farthest level's few big cards of birch and
    // beech reach further, by a few pixels at that distance).
    let leafR = 0;
    for (const l of levels.slice(0, -1)) { const P = l.leaves.positions; for (let i = 0; i < P.length; i += 3) leafR = Math.max(leafR, Math.hypot(P[i], P[i + 2])); }
    out.species[name] = { k, height: m.height, crownW: m.crownW, leafR, trunkD: m.trunkD, bole: m.bole, tris: levels.map((l) => l.tris), area: levels.map((l) => l.area) };
    console.log(`EXPORT ${name}: k ${k.toFixed(2)}, ${(k * m.height).toFixed(1)} m, tris ${levels.map((l) => l.tris).join('/')}, ${((perf.now() - t0) / 1000).toFixed(1)} s`);
}
require('fs').writeFileSync(`${DIR}/trees.json`, JSON.stringify(out, null, 1));
