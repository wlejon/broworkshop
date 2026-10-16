// grove: grown trees and shrubs swaying in bro.scene's wind field with no wind
// code in the app. Run: scripts/validate.sh demos/grove
import { check, eq, test, done, frames, clickOn } from "/lib/kit/test.js";
import { grove, scene, PLANTS, WINDS, FOLIAGE, GROUND, groundHeight, roller, dryness, ground } from "/app/grove.js";

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

test('the emitters carry the vegetation records the scene sways', () => {
    const t = grove.world.emitBranchTubes();
    eq(t.vegetation.length, t.segCount * 12, 'tube records');
    const bark = grove.world.emitMesh(5);
    eq(bark.vegetation.length, bark.vertexCount * 16, 'bark records');
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
    const st = grove.grass.grassStats();
    check(st && st.instances[0] > 10000, 'the near ring draws blades: ' + (st && st.instances.join('/')));
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
