// The generated city against the metropolis acceptance list: no road runs
// into the river except over a bridge, every bridge lands on both banks,
// none leads to the water and stops or runs along the bank, the town backs
// onto the river,
// no building stands in the water or on a carriageway, and the city keeps
// its scale. Generation only (no rendering).
//
//   bro-headless demos/metropolis tests/test_city.js

import { generateCity } from "/lib/city/generate.js";
import { SEG_FLOATS } from "/lib/city/ground.js";
import { MASS_FLOATS } from "/lib/city/buildings.js";
import { SITE } from "/app/world/site.js";
import { createTraffic, edgeDensity } from "/lib/city/traffic.js";
import { massRecord, interiorMesh, openingsOf, floorsOf } from "/lib/city/interior.js";
import { carMesh, CAR_TYPES } from "/lib/city/car_mesh.js";
import { STYLE } from "/lib/city/buildings.js";

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

// The river's edge: no road leads to it and stops (only over a bridge), none
// runs along the bank (save where it comes to a bridge), and the town backs
// onto it: lots on the water side of the roads nearest it.
{
    const deg = new Int32Array(graph.nodes.length);
    for (const e of graph.edges) { deg[e.a]++; deg[e.b]++; }
    const ends = graph.nodes.filter((nd, i) => deg[i] === 1 && water(nd.x, nd.z) < 140).length;
    check(ends === 0, `no road ends at the water without crossing it (${ends} dead ends within 140 m of it)`);
    const bridgeEnds = [];
    for (const e of bridges) { const p = e.pts; bridgeEnds.push([p[0], p[1]], [p[p.length - 2], p[p.length - 1]]); }
    let along = 0;
    for (const e of graph.edges) {
        if (e.kind === 'bridge') continue;
        const p = e.pts;
        for (let k = 2; k < p.length; k += 2) {
            const x = (p[k] + p[k - 2]) / 2, z = (p[k + 1] + p[k - 1]) / 2;
            if (water(x, z) < 60 && !bridgeEnds.some(([bx, bz]) => Math.hypot(bx - x, bz - z) < 150)) along += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
        }
    }
    check(along < 500, `no road along the bank (${along.toFixed(0)} m of road within 60 m of the water, away from the bridges)`);
    const backing = lots.filter((l) => l.face === -1).length;
    check(backing > 200, `the town backs onto the river (${backing} lots on the water side of the roads nearest it)`);
}

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

// Buildings are composed of parts (buildings.js), and no two parts of one
// draw a face in one plane, facing one way, over an area (they would flicker):
// walls (foundations included) and flat tops, by building.
{
    let composed = 0, clash = 0, worst = null;
    const faces = (i) => {
        const o = i * MASS_FLOATS, cx = D[o], y0 = D[o + 1], cz = D[o + 2], yaw = D[o + 3];
        const hw = D[o + 4], h = D[o + 5], hd = D[o + 6], plinth = D[o + 9];
        const c = Math.cos(yaw), s = Math.sin(yaw);
        // Local axes in world: x (c, -s), z (s, c).
        const out = [];
        for (const [nx, nz, half, tx, tz, along] of [[s, c, hd, c, -s, hw], [-s, -c, hd, c, -s, hw], [c, -s, hw, s, c, hd], [-c, s, hw, s, c, hd]]) {
            const off = nx * cx + nz * cz + half, t = tx * cx + tz * cz;
            out.push({ kind: 'wall', a: Math.atan2(nz, nx), off, t0: t - along, t1: t + along, y0: y0 - plinth, y1: y0 + h });
        }
        out.push({ kind: 'top', y: y0 + h, cx, cz, yaw, hw, hd, flat: D[o + 12] < 0.5 });
        return out;
    };
    const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
    for (const b of masses.buildings) {
        if (b.count > 1) composed++;
        const F = [];
        for (let k = 0; k < b.count; k++) F.push(faces(b.first + k));
        for (let i = 0; i < b.count; i++) for (let j = i + 1; j < b.count; j++) {
            for (const p of F[i]) for (const q of F[j]) {
                if (p.kind !== q.kind) continue;
                let bad = false;
                if (p.kind === 'wall') {
                    let da = Math.abs(p.a - q.a); da = Math.min(da, 2 * Math.PI - da);
                    bad = da < 1e-3 && Math.abs(p.off - q.off) < 0.01 && overlap(p.t0, p.t1, q.t0, q.t1) > 0.05 && overlap(p.y0, p.y1, q.y0, q.y1) > 0.05;
                } else if (p.flat && q.flat && Math.abs(p.y - q.y) < 0.01) {
                    // Flat tops at one height: overlapping footprints (as circles within them, conservatively).
                    bad = Math.hypot(p.cx - q.cx, p.cz - q.cz) < Math.min(p.hw, p.hd) + Math.min(q.hw, q.hd) - 0.05;
                }
                if (bad) { clash++; worst ??= `${b.zone} at ${b.x.toFixed(0)}, ${b.z.toFixed(0)}: parts ${i} and ${j} of ${b.count}, ${p.kind} ${JSON.stringify(p, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v)} / ${JSON.stringify(q, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v)}`; }
            }
        }
    }
    check(composed > masses.buildings.length * 0.35, `buildings composed of parts (${composed} of ${masses.buildings.length})`);
    check(clash === 0, `no two parts of a building draw one face in one plane (${clash}${worst ? `, first: ${worst}` : ''})`);
}
// A skyline, not a plateau: each district core's tallest tower stands well
// above the towers around it, and tower heights spread.
{
    const tops = new Map();   // building -> its top
    for (const b of masses.buildings) {
        if (b.zone !== 'tower') continue;
        let top = 0;
        for (let k = 0; k < b.count; k++) { const o = (b.first + k) * MASS_FLOATS; top = Math.max(top, D[o + 1] + D[o + 5] + (D[o + 12] > 0.5 ? D[o + 13] : 0) - b.y0); }
        tops.set(b, top);
    }
    const hs = [...tops.values()].sort((a, b) => a - b);
    const q = (f) => hs[Math.floor(f * (hs.length - 1))];
    let peaks = 0, cores = 0;
    for (const c of SITE.centers) {
        const near = [...tops].filter(([b]) => Math.hypot(b.x - c.x, b.z - c.z) < c.r * 0.6).map(([, t]) => t).sort((a, b) => b - a);
        if (near.length < 10) continue;
        cores++;
        if (near[0] > 1.6 * near[Math.floor(near.length / 2)]) peaks++;
    }
    // (One tower per lot, every tower the same form, measured 1.85.)
    check(q(0.9) > 2.0 * q(0.5) && q(0.99) > 250, `tower heights spread (median ${q(0.5).toFixed(0)} m, 90th ${q(0.9).toFixed(0)} m, 99th ${q(0.99).toFixed(0)} m, tallest ${hs[hs.length - 1].toFixed(0)} m)`);
    check(cores > 0 && peaks === cores, `each district core peaks (${peaks} of ${cores} cores' tallest over 1.6x their median)`);
}

// Scale.
let km = 0; for (const e of graph.edges) km += e.len / 1000;
check(masses.buildings.length > 50000, `a city's worth of buildings (${masses.buildings.length})`);
check(km > 1000, `road network (${km.toFixed(0)} km)`);
const zones = new Set(lots.map((l) => l.zone));
check(zones.size >= 6, `every zone present (${[...zones].join(', ')})`);

// Not a grid: street bearings (mod 90 degrees, by length) spread over many
// 5-degree bins rather than one.
const bins = new Float64Array(18);
let streetLen = 0;
for (const e of graph.edges) {
    const p = e.pts;
    for (let k = 2; k < p.length; k += 2) {
        const dx = p[k] - p[k - 2], dz = p[k + 1] - p[k - 1], l = Math.hypot(dx, dz);
        const a = ((Math.atan2(dz, dx) * 180 / Math.PI) % 90 + 90) % 90;
        bins[Math.min(17, Math.floor(a / 5))] += l; streetLen += l;
    }
}
const topBin = Math.max(...bins) / streetLen;
check(topBin < 0.25, `not a grid: no street bearing holds more than a quarter of the road (largest 5-degree bin ${(topBin * 100).toFixed(1)} %)`);
// Built round the river: the towers stand near the water.
const allM = []; for (let i = 0; i < masses.data.length / 16; i++) allM.push(massRecord(masses.data, i));
const tall = allM.filter((M) => M.h > 40);
const nearRiver = tall.filter((M) => water(M.cx, M.cz) < 1500).length;
check(tall.length > 100 && nearRiver > tall.length * 0.7, `the towers stand by the river (${nearRiver}/${tall.length} within 1.5 km of the water)`);
// Not one material: every facade style in use, and no style in one tint
// band (brick, render, siding... each tinted by hue) above a tenth of them.
const styleN = new Map(), combo = new Map();
for (const M of allM) {
    styleN.set(M.style, (styleN.get(M.style) ?? 0) + 1);
    const k = M.style * 10 + Math.floor(M.hue * 10);
    combo.set(k, (combo.get(k) ?? 0) + 1);
}
const comboMax = Math.max(...combo.values()) / allM.length;
check(styleN.size === Object.keys(STYLE).length && combo.size >= 60 && comboMax < 0.1, `facade materials vary (${styleN.size} styles in ${combo.size} tints, the commonest ${(comboMax * 100).toFixed(1)} % of buildings)`);
// Cars are modelled, not boxes: lofted bodies with glass, lamps and round wheels.
const carTris = Object.keys(CAR_TYPES).map((n) => {
    const mm = carMesh(n, 0), col = mm.colors, parts = new Set();
    for (let k = 0; k < col.length; k += 4) parts.add(col[k]);
    return { n, tris: mm.indices.length / 3, parts: parts.size };
});
check(carTris.every((c) => c.tris > 800 && c.parts >= 6), `cars are modelled, not boxes (${carTris.map((c) => `${c.n} ${c.tris} tris/${c.parts} parts`).join(', ')})`);

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
const trams = traffic.cars.filter((c) => c.route);
const served = trams.filter((c) => c.served >= 0 || c.dwell > 0).length;
check(trams.length > 10 && served >= trams.length * 0.8, `trams run and stop (${trams.length} trams, ${served} have served a stop)`);
check(wetCars === 0, `no car off a bridge in the water (${wetCars})`);
check(movingMin > 0.35, `traffic flows: at least 35 % of cars moving throughout (lowest ${(movingMin * 100).toFixed(0)} %)`);

// Interiors: every vertex and light inside its mass, every opening within its
// wall, a door where the facade draws one, rooms lit by lamps.
{
    let bad = 0, outside = 0, badOpen = 0, doors = 0, doorMasses = 0, lit = 0, rooms = 0, tris = 0;
    const nM = masses.data.length / MASS_FLOATS;
    // (Plant, stacks and silos have no rooms: interiors skip them.)
    const roomy = [];
    for (let i = 0; i < masses.data.length / MASS_FLOATS; i++) if (Math.round(masses.data[i * MASS_FLOATS + 11]) !== STYLE.plant) roomy.push(i);
    for (let k = 0; k < 400; k++) {
        const M = massRecord(masses.data, roomy[Math.floor((k + 0.5) * roomy.length / 400)]);
        const r = interiorMesh(M, [0, 30]);
        tris += r.tris;
        const c = Math.cos(M.yaw), s = Math.sin(M.yaw);
        const local = (x, y, z) => [c * (x - M.cx) - s * (z - M.cz), y - M.y0, s * (x - M.cx) + c * (z - M.cz)];
        const inMass = (p) => Math.abs(p[0]) <= M.hw + 0.01 && Math.abs(p[2]) <= M.hd + 0.01 && p[1] >= -0.01 && p[1] <= M.h + 0.01;
        const P = r.mesh.positions ?? r.mesh.getPositions?.();
        if (P) for (let i = 0; i < P.length; i += 3) {
            if (!Number.isFinite(P[i] + P[i + 1] + P[i + 2])) bad++;
            else if (!inMass(local(P[i], P[i + 1], P[i + 2]))) outside++;
        }
        for (const l of [...r.lights, ...r.windows]) { if (!inMass(local(...l.p))) outside++; }
        rooms += r.lights.length; lit += r.lights.filter((l) => l.lit).length;
        for (const F of floorsOf(M).filter((F) => F.y0 < 30)) for (let face = 0; face < 4; face++) {
            const W = face < 2 ? 2 * M.hw : 2 * M.hd;
            for (const o of openingsOf(M, face, F).list) {
                if (o.u0 < 0 || o.u1 > W || o.u0 >= o.u1 || o.y0 < F.y0 - 0.01 || o.y1 > F.y1 + 0.01) badOpen++;
                if (o.door) doors++;
            }
        }
        if (M.flags & 1 && !(M.flags & 2) && M.style !== 8) doorMasses++;
    }
    check(bad === 0 && outside === 0, `interiors inside their buildings (${bad} non-finite, ${outside} outside; ${(tris / 400).toFixed(0)} tris a mass)`);
    check(badOpen === 0, `interior openings within their walls and floors (${badOpen} bad)`);
    check(doors === doorMasses, `a street door into every building whose facade draws one (${doors}/${doorMasses})`);
    check(rooms > 1000 && lit > rooms * 0.1 && lit < rooms * 0.9, `rooms with lamps, some lit at night (${lit}/${rooms})`);
    // Storeys differ: the furniture of floors 1 and 2 of flats, in plan.
    let same = 0, pairs = 0;
    for (let i = 0; i < nM && pairs < 100; i += 37) {
        const M = massRecord(masses.data, i);
        const fl = floorsOf(M);
        if (fl.length < 3 || M.style === STYLE.glass || M.style === STYLE.office || M.style === STYLE.industrial || M.style === STYLE.plant) continue;
        const plan = (F) => { const P = interiorMesh(M, [F.y0 + 0.01, F.y1 - 0.01]).mesh.positions; let h = 0; for (let k = 0; k < P.length; k += 3) h += P[k] * 0.37 + P[k + 2] * 0.61; return `${P.length}:${h.toFixed(1)}`; };
        pairs++;
        if (plan(fl[1]) === plan(fl[2])) same++;
    }
    check(pairs > 20 && same < pairs * 0.2, `storeys furnished differently (${pairs - same}/${pairs} pairs differ)`);
    // Furnished, not empty boxes: what a floor holds, by use (offices,
    // shops, sheds, flats), averaged over sampled floors.
    const byUse = {};
    for (let k = 0; k < roomy.length; k += 53) {
        const M = massRecord(masses.data, roomy[k]);
        for (const F of floorsOf(M).slice(0, 3)) {
            const it = interiorMesh(M, [F.y0 + 0.01, F.y1 - 0.01]).items;
            const use = it.desk ? 'office' : it.shelving ? 'shop' : it.racking ? 'shed' : it.rug ? 'flat' : 'empty';
            const u = (byUse[use] ??= { floors: 0, kinds: 0, pieces: 0 });
            u.floors++; u.kinds += Object.keys(it).length; u.pieces += Object.values(it).reduce((a, b) => a + b, 0);
        }
    }
    const useLine = Object.entries(byUse).map(([k, u]) => `${k} ${u.floors} floors: ${(u.kinds / u.floors).toFixed(1)} kinds, ${(u.pieces / u.floors).toFixed(0)} pieces`).join('; ');
    const furnished = ['office', 'shop', 'flat'].every((k) => byUse[k] && byUse[k].kinds / byUse[k].floors >= 4) && byUse.shed && byUse.shed.kinds / byUse.shed.floors >= 2 && !(byUse.empty?.floors > 0.05 * Object.values(byUse).reduce((a, u) => a + u.floors, 0));
    check(furnished, `floors furnished by use (${useLine})`);
}

console.log(failed ? `FAILED ${failed}` : 'ALL PASS');
if (failed) throw new Error(`${failed} city checks failed`);
