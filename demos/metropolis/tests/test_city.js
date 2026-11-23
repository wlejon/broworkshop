// The generated city against the metropolis acceptance list: no road runs
// into the river except over a bridge, every bridge lands on both banks,
// no building stands in the water or on a carriageway, and the city keeps
// its scale. Generation only (no rendering).
//
//   bro-headless demos/metropolis tests/test_city.js

import { generateCity } from "/lib/city/generate.js";
import { SEG_FLOATS } from "/lib/city/ground.js";
import { MASS_FLOATS } from "/lib/city/buildings.js";
import { SITE } from "/app/world/site.js";

const city = generateCity(SITE);
const { graph, lots, masses, ground } = city;
const water = (x, z) => SITE.water(x, z);   // distance to the water, < 0 in it
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };

// Roads: every point of every non-bridge edge (and its segments' midpoints) on land.
let wet = 0, worst = null;
for (const e of graph.edges) {
    if (e.kind === 'bridge') continue;
    const p = e.pts;
    for (let k = 0; k < p.length; k += 2) {
        const pts = [[p[k], p[k + 1]]];
        if (k + 2 < p.length) pts.push([(p[k] + p[k + 2]) / 2, (p[k + 1] + p[k + 3]) / 2]);
        for (const [x, z] of pts) {
            const w = water(x, z);
            if (w < 0) { wet++; if (!worst || w < worst.w) worst = { x, z, w }; }
        }
    }
}
check(wet === 0, `no road point in the water (${wet}${worst ? `, worst ${worst.w.toFixed(1)} m at ${worst.x.toFixed(0)},${worst.z.toFixed(0)}` : ''})`);

// Bridges: some, each landing on land at both ends and crossing water.
const bridges = graph.edges.filter((e) => e.kind === 'bridge');
const landed = bridges.filter((e) => {
    const p = e.pts, n = p.length;
    let crosses = false;
    for (let k = 0; k < n; k += 2) if (water(p[k], p[k + 1]) < 0) crosses = true;
    return water(p[0], p[1]) > 0 && water(p[n - 2], p[n - 1]) > 0 && crosses;
});
for (const e of bridges) if (!landed.includes(e)) {
    const p = e.pts, n = p.length;
    let minW = Infinity; for (let k = 0; k < n; k += 2) minW = Math.min(minW, water(p[k], p[k + 1]));
    console.log(`  bridge ${p[0].toFixed(0)},${p[1].toFixed(0)} -> ${p[n - 2].toFixed(0)},${p[n - 1].toFixed(0)}: ends ${water(p[0], p[1]).toFixed(1)} / ${water(p[n - 2], p[n - 1]).toFixed(1)} m from water, deepest ${minW.toFixed(1)}, ${e.len.toFixed(0)} m`);
}
check(bridges.length >= 4, `bridges over the river (${bridges.length})`);
check(landed.length === bridges.length, `every bridge lands on both banks and crosses water (${landed.length}/${bridges.length})`);

// Buildings: no mass centre in the water, none on a carriageway.
const D = masses.data;
let inWater = 0, onRoad = 0;
const { half, cell, cells } = ground.info, S = ground.segs;
for (let i = 0; i < masses.count; i++) {
    const o = i * MASS_FLOATS, x = D[o], z = D[o + 2];
    if (water(x, z) < 0) inWater++;
    const ci = Math.floor((x + half) / cell), cj = Math.floor((z + half) / cell);
    if (ci < 0 || cj < 0 || ci >= cells || cj >= cells) continue;
    const c = cj * cells + ci;
    for (let k = ground.cellStart[c]; k < ground.cellStart[c + 1]; k++) {
        const so = ground.cellSegs[k] * SEG_FLOATS;
        const ax = S[so], az = S[so + 1], dx = S[so + 2] - ax, dz = S[so + 3] - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9)));
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) < S[so + 6]) { onRoad++; break; }
    }
}
check(inWater === 0, `no building in the water (${inWater})`);
check(onRoad === 0, `no building on a carriageway (${onRoad})`);

// Scale.
let km = 0; for (const e of graph.edges) km += e.len / 1000;
check(masses.buildings.length > 50000, `a city's worth of buildings (${masses.buildings.length})`);
check(km > 1000, `road network (${km.toFixed(0)} km)`);
const zones = new Set(lots.map((l) => l.zone));
check(zones.size >= 6, `every zone present (${[...zones].join(', ')})`);

console.log(failed ? `FAILED ${failed}` : 'ALL PASS');
if (failed) throw new Error(`${failed} city checks failed`);
