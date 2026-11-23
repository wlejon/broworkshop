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
// covers as much of what is behind it as the finest does there (the trees'
// contrast against the empty view, tests/test_visual.js's tree check, within
// some 4 %). Beech's clumps overlap most, so its cards grow most.
const AREA = {"elm": [1, 1.155, 1.467, 2.026, 1.509], "oak": [1, 1.205, 1.376, 1.201, 1.067], "beech": [1, 1.756, 2.941, 3.513, 2.297], "birch": [1, 0.98, 0.971, 0.693, 0.625]};
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
    out.species[name] = { k, height: m.height, crownW: m.crownW, trunkD: m.trunkD, bole: m.bole, tris: levels.map((l) => l.tris), area: levels.map((l) => l.area) };
    console.log(`EXPORT ${name}: k ${k.toFixed(2)}, ${(k * m.height).toFixed(1)} m, tris ${levels.map((l) => l.tris).join('/')}, ${((perf.now() - t0) / 1000).toFixed(1)} s`);
}
require('fs').writeFileSync(`${DIR}/trees.json`, JSON.stringify(out, null, 1));
