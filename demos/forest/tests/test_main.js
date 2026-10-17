// forest: a few thousand grown trees on hills, each at the detail its size
// on screen asks for. Run: scripts/validate.sh demos/forest
import { check, eq, test, done, frames, clickOn } from "/lib/kit/test.js";
import { forest, scene, NURSERY, CONIFERS, SHRUBS, SPECIMENS, GLADE, FOREST, groundHeight, setShot, setWind, flight,
         flightAt, FLIGHT_SECONDS, forestStats } from "/app/forest.js";

frames(2);

function changed(a, b) {
    let n = 0;
    for (let i = 0; i < a.data.length; i += 4) {
        if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) +
            Math.abs(a.data[i + 2] - b.data[i + 2]) > 6) n++;
    }
    return n;
}

const part = (name) => forest.parts.find((p) => p.name === name);

test('the nursery grows every specimen and the forest stands thousands of them', () => {
    eq(forest.world.plantCount, SPECIMENS, 'specimens grown');
    eq(forest.emit.specimenCount, NURSERY.cols * NURSERY.rows, 'broadleaf specimens emitted');
    eq(part('needle').emit.specimenCount, CONIFERS.filter((n) => n !== 'cypress').length, 'needle conifers');
    eq(part('scale').emit.specimenCount, CONIFERS.filter((n) => n === 'cypress').length, 'scale-leaf conifers');
    eq(part('shrub').emit.specimenCount, SHRUBS.length, 'shrubs');
    eq(part('needle').emit.leafForm, 'needle', 'the conifers emitted by form');
    const s = forestStats();
    eq(s.specimenCount, SPECIMENS, 'the nodes hold them');
    check(s.treeCount > 2000, 'a few thousand trees at least: ' + s.treeCount);
    for (const p of forest.parts) check(p.node.forestStats().treeCount > 100, `${p.name}: ${p.node.forestStats().treeCount} planted`);
});

test('a mixed forest: conifers on the high ground, shrubs at the glade\'s edge', () => {
    // Mean ground height under each kind of tree.
    const meanY = (t) => { let y = 0; for (let i = 0; i < t.length / 8; i++) y += t[i * 8 + 1]; return y / (t.length / 8); };
    check(meanY(part('needle').trees) > meanY(part('broadleaf').trees) + 1,
          `conifers stand higher: ${meanY(part('needle').trees).toFixed(1)} vs ${meanY(part('broadleaf').trees).toFixed(1)} m`);
    // Shrubs per hectare round the glade's rim against deep in the forest.
    const sh = part('shrub').trees;
    let rim = 0, deep = 0;
    for (let i = 0; i < sh.length / 8; i++) {
        const d = Math.hypot(sh[i * 8] - GLADE.x, sh[i * 8 + 2] - GLADE.z);
        if (d > GLADE.r * 0.8 && d < GLADE.r * 1.3) rim++;
        else if (d > 150 && d < 250) deep++;
    }
    const ringArea = (a, b) => Math.PI * (b * b - a * a);
    const rimDensity = rim / ringArea(GLADE.r * 0.8, GLADE.r * 1.3), deepDensity = deep / ringArea(150, 250);
    check(rimDensity > 3 * deepDensity, `shrubs crowd the edge: ${(rimDensity * 1e4).toFixed(0)} vs ${(deepDensity * 1e4).toFixed(0)} a hectare`);
});

test('trees stand on the ground, round a glade, off the trail', () => {
    let off = 0, inGlade = 0, inside = true;
    for (const p of forest.parts) {
        if (p.name === 'shrub') continue;
        const t = p.trees;
        for (let i = 0; i < t.length / 8; i++) {
            const x = t[i * 8], y = t[i * 8 + 1], z = t[i * 8 + 2];
            if (Math.abs(y - (groundHeight(x, z) - 0.12)) > 1e-3) off++;
            if (Math.hypot(x - GLADE.x, z - GLADE.z) < GLADE.r * 0.6) inGlade++;
            if (Math.abs(x) > FOREST || Math.abs(z) > FOREST) inside = false;
        }
    }
    eq(off, 0, 'every root on the ground');
    eq(inGlade, 0, 'the glade is open');
    check(inside, 'inside the planted area');
    // The flight's low end walks between trunks and shrubs.
    for (let tt = 24; tt <= FLIGHT_SECONDS; tt += 1) {
        const e = flightAt(tt).eye;
        let near = Infinity;
        for (const p of forest.parts) {
            const t = p.trees;
            for (let i = 0; i < t.length / 8; i++) near = Math.min(near, Math.hypot(t[i * 8] - e[0], t[i * 8 + 2] - e[2]));
        }
        check(near > 1.5, `no trunk or shrub on the flight at ${tt} s (nearest ${near.toFixed(1)} m)`);
    }
});

test('from above the trees are clumps and crowns; among the trunks the near ones are leaves', () => {
    setShot('above');
    frames(2);
    let s = forestStats();
    check(s.trees.leaves < 60, 'from 150 m up only the trees under the eye keep leaves: ' + s.trees.leaves);
    check(s.trees.clumps + s.trees.crowns > 1000, 'every other tree clumps or a crown: ' + s.trees.clumps + ' / ' +
          s.trees.crowns);
    const g = forest.grass.grassStats().instances;
    check(g[0] === 0 && g[1] === 0, 'from above the near grass rings issue nothing: ' + g.join(' / '));
    setShot('trunks');
    frames(2);
    s = forestStats();
    check(s.trees.leaves > 5 && s.leaves > 50000, `the near trees draw their leaves: ${s.trees.leaves} trees, ${s.leaves} leaves`);
    check(s.trees.clumps + s.trees.crowns > 100, 'the far ones are clumps and crowns: ' + s.trees.clumps + ' / ' +
          s.trees.crowns);
    check(s.vertices < 30e6, 'the budget holds the view: ' + (s.vertices / 1e6).toFixed(1) + ' M vertices');
    check(forest.grass.grassStats().instances[0] > 0, 'on the trail, the near grass draws');
});

test('the tier buttons draw every tree at one tier', () => {
    setShot('glade');
    clickOn('#tiers button[data-value="crowns"]');
    frames(1);
    let s = forestStats();
    check(s.trees.crowns > 0 && s.trees.leaves + s.trees.clumps === 0, 'crowns only: ' + JSON.stringify(s.trees) + ' ' +
          JSON.stringify(forest.parts.map((p) => p.node.forestStats().trees)));
    clickOn('#tiers button[data-value="clumps"]');
    frames(1);
    s = forestStats();
    check(s.trees.clumps > 0 && s.trees.leaves + s.trees.crowns === 0, 'clumps only');
    clickOn('#tiers button[data-value="leaves"]');
    frames(1);
    s = forestStats();
    eq(s.trees.clumps + s.trees.crowns, 0, 'leaves only');
    clickOn('#tiers button[data-value="auto"]');
    frames(1);
    s = forestStats();
    check(s.trees.leaves > 0 && s.trees.clumps + s.trees.crowns > 0, 'by size again');
});

test('a calm is still at every distance and a breeze moves the forest', () => {
    setShot('canopy');
    setWind('still');
    frames(2);
    let a = scene.captureFrame();
    frames(10);
    let b = scene.captureFrame();
    eq(changed(a, b), 0, 'still: nothing moves');
    setWind('gusty');
    a = scene.captureFrame();
    frames(10);
    b = scene.captureFrame();
    check(changed(a, b) > 2000, 'gusty: the canopy moves (' + changed(a, b) + ' px)');
    setWind('breeze');
});

test('the flight runs from above the canopy to the trunks', () => {
    clickOn('#fly');
    check(flight.on && flight.t === 0, 'flying from the start');
    const y0 = flightAt(0).eye[1] - groundHeight(flightAt(0).eye[0], flightAt(0).eye[2]);
    const end = flightAt(FLIGHT_SECONDS).eye;
    check(y0 > 100 && end[1] - groundHeight(end[0], end[2]) < 2, 'high to standing');
    frames(30);
    check(flight.t > 0.3, 'the flight advances: ' + flight.t.toFixed(2));
    setShot('above');
});

done('forest');
