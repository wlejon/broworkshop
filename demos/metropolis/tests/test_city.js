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
import { placeTrees, TREE_FLOATS } from "/lib/city/trees.js";
import { createTraffic, edgeDensity } from "/lib/city/traffic.js";

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
// Whether (x, z) is on a carriageway (within its half width plus `margin`).
function onCarriageway(x, z, margin = 0) {
    const ci = Math.floor((x + half) / cell), cj = Math.floor((z + half) / cell);
    if (ci < 0 || cj < 0 || ci >= cells || cj >= cells) return false;
    const c = cj * cells + ci;
    for (let k = ground.cellStart[c]; k < ground.cellStart[c + 1]; k++) {
        const so = ground.cellSegs[k] * SEG_FLOATS;
        const ax = S[so], az = S[so + 1], dx = S[so + 2] - ax, dz = S[so + 3] - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9)));
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) < S[so + 6] + margin) return true;
    }
    return false;
}
for (let i = 0; i < masses.count; i++) {
    const o = i * MASS_FLOATS, x = D[o], z = D[o + 2];
    if (water(x, z) < 0) inWater++;
    if (onCarriageway(x, z)) onRoad++;
}
check(inWater === 0, `no building in the water (${inWater})`);
check(onRoad === 0, `no building on a carriageway (${onRoad})`);

// Scale.
let km = 0; for (const e of graph.edges) km += e.len / 1000;
check(masses.buildings.length > 50000, `a city's worth of buildings (${masses.buildings.length})`);
check(km > 1000, `road network (${km.toFixed(0)} km)`);
const zones = new Set(lots.map((l) => l.zone));
check(zones.size >= 6, `every zone present (${[...zones].join(', ')})`);

// Traffic: three minutes of it. Cars keep moving (no gridlock) and stay on
// land or a bridge's deck.
check(city.transit.length === 4, `tram lines planned (${city.transit.map((l) => `${l.name}: ${(l.length / 1000).toFixed(1)} km, ${l.stops.length} stops`).join('; ')})`);
const crossesRiver = city.transit.filter((l) => l.steps.some((st) => graph.edges[st.edge].kind === 'bridge')).length;
check(crossesRiver >= 2, `tram lines crossing the river (${crossesRiver})`);
const traffic = createTraffic(graph, { count: 12000, edgeDensity: edgeDensity(graph, city.field.density), lines: city.transit });
const pose = [0, 0, 0, 0, 0];
let wetCars = 0, movingMin = 1;
for (let t = 0; t < 180; t += 0.1) {
    traffic.step(0.1);
    if (Math.round(t * 10) % 300 === 299) {
        let moving = 0;
        for (const c of traffic.cars) {
            if (c.v > 0.5) moving++;
            if (graph.edges[c.lane.edge].kind !== 'bridge' && !c.turn) {
                traffic.pose(c, pose);
                if (water(pose[0], pose[2]) < -2) wetCars++;
            }
        }
        const f = moving / traffic.cars.length;
        movingMin = Math.min(movingMin, f);
        console.log(`  traffic t=${t.toFixed(0)} s: ${(f * 100).toFixed(0)} % moving`);
    }
}
// Trees: street trees and park groves, none in the water or on a carriageway.
const treeRecs = placeTrees(city);   // (the graded height, field and graph only)
const nTrees = treeRecs.length / TREE_FLOATS;
let wetTrees = 0, roadTrees = 0;
for (let i = 0; i < treeRecs.length; i += TREE_FLOATS) {
    const x = treeRecs[i], z = treeRecs[i + 2];
    if (water(x, z) < 2) wetTrees++;
    if (onCarriageway(x, z, 0.3)) roadTrees++;
}
check(nTrees > 50000, `a city's worth of trees (${nTrees})`);
check(wetTrees === 0, `no tree in the water (${wetTrees})`);
check(roadTrees === 0, `no tree on a carriageway (${roadTrees})`);
const trams = traffic.cars.filter((c) => c.route);
const served = trams.filter((c) => c.served >= 0 || c.dwell > 0).length;
check(trams.length > 10 && served >= trams.length * 0.8, `trams run and stop (${trams.length} trams, ${served} have served a stop)`);
check(wetCars === 0, `no car off a bridge in the water (${wetCars})`);
check(movingMin > 0.35, `traffic flows: at least 35 % of cars moving throughout (lowest ${(movingMin * 100).toFixed(0)} %)`);

console.log(failed ? `FAILED ${failed}` : 'ALL PASS');
if (failed) throw new Error(`${failed} city checks failed`);
