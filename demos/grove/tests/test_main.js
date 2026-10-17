// grove: grown trees and shrubs swaying in bro.scene's wind field with no wind
// code in the app. Run: scripts/validate.sh demos/grove
import { check, eq, test, done, frames, clickOn } from "/lib/kit/test.js";
import { grove, scene, PLANTS, WINDS, FOLIAGE, GROUND, PLANT_SCALE, groundHeight, roller, dryness, ground, setShot, PRESET_PLANTS } from "/app/grove.js";

frames(2);

function changed(a, b) {
    let n = 0;
    for (let i = 0; i < a.data.length; i += 4) {
        if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) +
            Math.abs(a.data[i + 2] - b.data[i + 2]) > 6) n++;
    }
    return n;
}

test('the grove grows every plant and draws it on the GPU path', () => {
    eq(grove.world.plantCount, PLANTS.length, 'plants');
    eq(grove.path, 'gpu');
    eq(grove.nodes.length, 2, 'a tube node and a scatter node');
    check(grove.stats.segments > 0 && grove.stats.leaves > 0, 'segments and leaves: ' + JSON.stringify(grove.stats));
});

test('the conifers and shrubs stand where the grove puts them, a node per preset', () => {
    eq(grove.presets.map((p) => p.name).join(), PRESET_PLANTS.map((p) => p.name).join(), 'preset nodes');
    for (const { name, emit, node } of grove.presets) {
        eq(emit.specimenCount, 1, name + ' specimens');
        const s = node.forestStats();
        check(s && s.treeCount === 1, name + ' trees: ' + JSON.stringify(s && s.treeCount));
    }
    const by = (n) => grove.presets.find((p) => p.name === n).emit;
    const fir = by('fir'), cypress = by('cypress'), boxwood = by('boxwood');
    // A conifer stands taller than a shrub, and a shrub's leaves are its own size.
    check(fir.specimens[6] > 2 * boxwood.specimens[6], 'conifer ' + fir.specimens[6].toFixed(2) + ' m vs shrub ' +
          boxwood.specimens[6].toFixed(2) + ' m');
    check(fir.specimenLooks[3] === 1 && cypress.specimenLooks[3] === 2 && boxwood.specimenLooks[3] === 0, 'leaf forms');
});

test('the emitters carry the vegetation records the scene sways', () => {
    const t = grove.world.emitBranchTubes();
    eq(t.vegetation.length, t.segCount * 16, 'tube records');
    const bark = grove.world.emitMesh(5);
    eq(bark.vegetation.length, bark.vertexCount * 16, 'bark records');
});

test('the trees are cantilevers: a slow trunk, quick sprays', () => {
    // The packed words (broflora/sway.h): trunk f in the top 12 bits of
    // word 15, a spray's f in bits 12-17 of word 13, log over 0.05-50 Hz.
    const t = grove.world.emitBranchTubes();
    const v = t.vegetation;
    const hz = (code, bits) => code === 0 ? 0 : 0.05 * Math.exp((code - 1) / ((1 << bits) - 2) * Math.log(1000));
    let trunkMax = 0, sprayMin = Infinity;
    for (let i = 0; i < t.segCount; i++) {
        trunkMax = Math.max(trunkMax, hz(Math.round(v[i * 16 + 15]) >> 12, 12) / PLANT_SCALE);
        const s = hz((Math.round(v[i * 16 + 13]) >> 12) & 63, 6) / PLANT_SCALE;
        if (s > 0) sprayMin = Math.min(sprayMin, s);
    }
    check(trunkMax > 0.2 && trunkMax < 2, 'trunks sway at a tree\'s period, drawn: ' + trunkMax.toFixed(2) + ' Hz at most');
    check(sprayMin > 2 * trunkMax, 'sprays are quicker: ' + sprayMin.toFixed(2) + ' Hz at least');
});

test('leaves hang in crown clumps and the ground rolls', () => {
    const s = grove.world.emitScatterSegments(FOLIAGE);
    check(s.clumps === true && s.segCount > 0, 'scatter clumps by default: ' + s.segCount);
    const t = grove.world.emitBranchTubes();
    eq(t.tangents.length, t.segCount * 6, 'mitred joints');
    const hs = PLANTS.map((p) => groundHeight(p.x, p.z));
    check(Math.max(...hs) - Math.min(...hs) > 0.1, 'the plants stand at different heights: ' + hs.map((h) => h.toFixed(2)));
    check(groundHeight(GROUND * 0.9, 0) > groundHeight(0, 0) + 4, 'the meadow rises to hills');
});

test('grass covers the meadow, lush to sun-dried, and the roller parts it', () => {
    // From the grove shot the near ring is out of view and issues nothing;
    // in the grass, it draws the tufts at the camera's feet.
    const st = grove.grass.grassStats();
    check(st && st.instances.reduce((s, n) => s + n, 0) > 10000, 'the rings draw blades: ' + (st && st.instances.join('/')));
    setShot('ground');
    frames(1);
    const near = grove.grass.grassStats().instances;
    check(near[0] > 1000, 'in the grass, the near ring draws tufts: ' + near.join('/'));
    setShot('grove');
    frames(1);
    eq(st.movers, 1, 'the roller is a mover');
    check(Math.abs(grove.grass.grassHeightAt(3, 4) - groundHeight(3, 4)) < 0.05, 'the grass stands on the ground');
    let lo = 1, hi = 0;
    for (let x = -30; x <= 30; x += 3) for (let z = -30; z <= 30; z += 3) { const d = dryness(x, z); lo = Math.min(lo, d); hi = Math.max(hi, d); }
    check(lo < 0.15 && hi > 0.6, `lush and dry patches: dryness ${lo.toFixed(2)}..${hi.toFixed(2)}`);
    const p0 = roller.node.position;
    frames(10);
    const p1 = roller.node.position;
    check(Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) > 0.05, 'the roller rolls');
});

test('the wind buttons set the field; a calm is still and a breeze moves', () => {
    // The roller stops and lets go of the grass, which has risen again first.
    roller.running = false;
    grove.grass.removeMover(roller.node);
    frames(2);
    advanceTime(25000);
    clickOn('#winds button[data-value="still"]');
    eq(grove.wind, 'still');
    eq(scene.wind().speed, 0, 'still: no steady wind');
    frames(2);
    let a = scene.captureFrame();
    frames(20);
    let b = scene.captureFrame();
    eq(changed(a, b), 0, 'still: nothing moves');

    clickOn('#winds button[data-value="gusty"]');
    eq(scene.wind().speed, WINDS.gusty.wind.speed, 'gusty speed');
    a = scene.captureFrame();
    frames(20);
    b = scene.captureFrame();
    check(changed(a, b) > 200, 'gusty: the plants move (' + changed(a, b) + ' px)');
    clickOn('#winds button[data-value="breeze"]');
    roller.running = true;
    grove.grass.addMover(roller.node, { radius: 0.7, strength: 1.2, trample: 1 });
});

test('the mesh path draws the same plants as swaying meshes', () => {
    clickOn('#paths button[data-value="mesh"]');
    eq(grove.path, 'mesh');
    eq(grove.nodes.length, 2, 'bark and leaf meshes');
    const a = scene.captureFrame();
    frames(20);
    const b = scene.captureFrame();
    check(changed(a, b) > 200, 'meshes sway too (' + changed(a, b) + ' px)');
    clickOn('#paths button[data-value="gpu"]');
    eq(grove.path, 'gpu');
});

done('grove');
