// forest: a few thousand grown trees on hills, each at the detail its size
// on screen asks for. Run: scripts/validate.sh demos/forest
import { check, eq, test, done, frames, clickOn } from "/lib/kit/test.js";
import { forest, scene, NURSERY, GLADE, FOREST, groundHeight, setShot, setWind, flight, flightAt,
         FLIGHT_SECONDS } from "/app/forest.js";

frames(2);

function changed(a, b) {
    let n = 0;
    for (let i = 0; i < a.data.length; i += 4) {
        if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) +
            Math.abs(a.data[i + 2] - b.data[i + 2]) > 6) n++;
    }
    return n;
}

test('the nursery grows every specimen and the forest stands thousands of them', () => {
    eq(forest.world.plantCount, NURSERY.cols * NURSERY.rows, 'specimens grown');
    eq(forest.emit.specimenCount, NURSERY.cols * NURSERY.rows, 'specimens emitted');
    const s = forest.node.forestStats();
    eq(s.specimenCount, NURSERY.cols * NURSERY.rows, 'the node holds them');
    check(s.treeCount > 2000, 'a few thousand trees at least: ' + s.treeCount);
});

test('trees stand on the ground, round a glade, off the trail', () => {
    const t = forest.trees;
    let off = 0, inGlade = 0, inside = true;
    for (let i = 0; i < t.length / 8; i++) {
        const x = t[i * 8], y = t[i * 8 + 1], z = t[i * 8 + 2];
        if (Math.abs(y - (groundHeight(x, z) - 0.12)) > 1e-3) off++;
        if (Math.hypot(x - GLADE.x, z - GLADE.z) < GLADE.r * 0.6) inGlade++;
        if (Math.abs(x) > FOREST || Math.abs(z) > FOREST) inside = false;
    }
    eq(off, 0, 'every root on the ground');
    eq(inGlade, 0, 'the glade is open');
    check(inside, 'inside the planted area');
    // The flight's low end walks between trunks.
    for (let tt = 24; tt <= FLIGHT_SECONDS; tt += 1) {
        const e = flightAt(tt).eye;
        let near = Infinity;
        for (let i = 0; i < t.length / 8; i++) near = Math.min(near, Math.hypot(t[i * 8] - e[0], t[i * 8 + 2] - e[2]));
        check(near > 1.5, `no trunk on the flight at ${tt} s (nearest ${near.toFixed(1)} m)`);
    }
});

test('from above the trees are impostors; among the trunks the near ones are leaves', () => {
    setShot('above');
    frames(2);
    let s = forest.node.forestStats();
    // At this window's 1920 x 1052 the trees right under the eye are a
    // little larger than their baked pictures, so they keep their leaves
    // (at 1280 x 720 none do); everything else is an impostor.
    check(s.trees.leaves < 60, 'from 150 m up only the trees under the eye keep leaves: ' + s.trees.leaves);
    check(s.trees.impostors > 1000, 'every other tree an impostor: ' + s.trees.impostors);
    eq(s.trees.clumps + s.trees.crowns, 0, 'no sprites while impostors are on');
    const g = forest.grass.grassStats().instances;
    check(g[0] === 0 && g[1] === 0, 'from above the near grass rings issue nothing: ' + g.join(' / '));
    setShot('trunks');
    frames(2);
    s = forest.node.forestStats();
    check(s.trees.leaves > 5 && s.leaves > 50000, `the near trees draw their leaves: ${s.trees.leaves} trees, ${s.leaves} leaves`);
    check(s.trees.impostors > 100, 'the far ones are impostors: ' + s.trees.impostors);
    check(s.vertices < 30e6, 'the budget holds the view: ' + (s.vertices / 1e6).toFixed(1) + ' M vertices');
    check(forest.grass.grassStats().instances[0] > 0, 'on the trail, the near grass draws');
});

test('the tier buttons draw every tree at one tier', () => {
    setShot('glade');
    clickOn('#tiers button[data-value="crowns"]');
    frames(1);
    let s = forest.node.forestStats();
    eq(s.trees.leaves + s.trees.clumps + s.trees.impostors, 0, 'crowns only');
    clickOn('#tiers button[data-value="impostors"]');
    frames(1);
    s = forest.node.forestStats();
    check(s.trees.impostors > 0 && s.trees.leaves + s.trees.clumps + s.trees.crowns === 0, 'impostors only');
    clickOn('#tiers button[data-value="leaves"]');
    frames(1);
    s = forest.node.forestStats();
    eq(s.trees.clumps + s.trees.crowns + s.trees.impostors, 0, 'leaves only');
    clickOn('#tiers button[data-value="auto"]');
    frames(1);
    s = forest.node.forestStats();
    check(s.trees.leaves > 0 && s.trees.impostors > 0, 'by size again');
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
