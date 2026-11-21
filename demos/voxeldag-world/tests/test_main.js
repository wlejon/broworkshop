// Voxel World (SVDAG): validates pointer-instanced compression, O(1) GPU animation,
// heightfield carve cutouts, 6 tour presets, live sculpting, and UI toggles.
// Run: scripts/validate.sh demos/voxeldag-world
import { check, eq, near, test, done, frames, q, text, clickOn, press, shot, skip } from "/lib/kit/test.js";
import {
    available, vd, fly, PRESETS, settings, sculpt,
    sculptAtCenter, getTelemetry, selectPreset,
} from "/app/lab.js";

if (!available) skip('no GPU / bro.voxeldag runtime');

frames(14);

const tele0 = getTelemetry();
console.log('SVDAG telemetry:', JSON.stringify(tele0));

test('world builds compact deduplicated SVDAG across 4 regions', () => {
    check(tele0 && tele0.instances >= 6000, 'instances: ' + (tele0 && tele0.instances));
    check(tele0.virtualVoxels >= 100000000, 'virtual voxels >= 100M: ' + tele0.virtualVoxels);
    check(tele0.nodes > 0 && tele0.nodes < 20000, 'compact DAG nodes: ' + tele0.nodes);
    check(tele0.bricks > 0 && tele0.bricks < 20000, 'compact 4^3 bricks: ' + tele0.bricks);
    check(tele0.compression >= 50, 'compression ratio: ' + tele0.compression + ':1');
    check(/ready/.test(text('#status')), 'status ready: ' + text('#status'));
});

test('GPU cyclic clips advance animTick with zero DAG rebuild', () => {
    const gen0 = vd.stats().generation;
    const tick0 = vd.stats().animTick;
    frames(24); // 384 ms @ 8 FPS -> ~3 ticks
    const s1 = vd.stats();
    check(s1.animTick > tick0, 'animTick advanced: ' + tick0 + ' -> ' + s1.animTick);
    eq(s1.generation, gen0, 'DAG generation unchanged during animation');
});

for (const key of Object.keys(PRESETS)) {
    test('camera preset ' + key + ' frames cleanly', () => {
        clickOn('#presets button[data-value="' + key + '"]');
        frames(8);
        const want = PRESETS[key].pose.pos;
        near(fly.cam.pos[0], want[0], 0.5, key + ' x');
        near(fly.cam.pos[1], want[1], 0.5, key + ' y');
        near(fly.cam.pos[2], want[2], 0.5, key + ' z');
        shot(key);
    });
}

test('carve cutout toggle and dusk emissives inside cliff cavern', () => {
    clickOn('#presets button[data-value="cavern"]');
    frames(6);
    clickOn('#btn-carve');
    eq(settings.carveCutouts, false, 'carveCutouts off');
    frames(6);
    shot('cavern-uncarved');

    clickOn('#btn-carve');
    eq(settings.carveCutouts, true, 'carveCutouts restored');
    frames(4);

    // Unfold Atmosphere & Camera panel, switch to dusk so cavern crystals pop
    clickOn(q('#tod').parentNode.querySelector('h2'));
    clickOn('#tod button[data-value="dusk"]');
    frames(6);
    shot('cavern-dusk');
    clickOn('#tod button[data-value="afternoon"]');
    frames(4);
});

test('interactive sculpting carves / stamps into live terrain and resets', () => {
    selectPreset('overview');
    frames(4);
    clickOn('#sculptTool button[data-value="carve"]');
    const hit = sculptAtCenter('carve');
    check(hit !== null, 'overview center ray hits terrain');
    check(sculpt.edits >= 1, 'sculptAtCenter recorded edit');

    clickOn('#stage');
    check(sculpt.edits >= 2, 'stage left-click recorded edit (' + sculpt.edits + ')');
    frames(6);

    clickOn('#resetSculpt');
    eq(sculpt.edits, 0, 'resetSculpt cleared user edits');
    frames(4);
});

test('layer toggles, fly W movement, and Tab panel toggle work', () => {
    clickOn('#btn-svdag');
    eq(settings.showVoxelDag, false);
    frames(3);
    clickOn('#btn-svdag');
    eq(settings.showVoxelDag, true);

    clickOn('#btn-terrain');
    eq(settings.showTerrain, false);
    frames(3);
    clickOn('#btn-terrain');
    eq(settings.showTerrain, true);

    const p0 = fly.cam.pos.slice();
    keyDown(119);
    frames(18);
    keyUp(119);
    const f = fly.forward();
    const moved = (fly.cam.pos[0] - p0[0]) * f[0] + (fly.cam.pos[1] - p0[1]) * f[1] + (fly.cam.pos[2] - p0[2]) * f[2];
    check(moved > 1.5, 'W moved ' + moved.toFixed(2) + ' m forward');

    press('Tab');
    check(q('#panel').hidden, 'Tab hid side panel');
    press('Tab');
    check(!q('#panel').hidden, 'Tab restored side panel');
});

selectPreset('overview');
frames(8);
done('voxeldag-world');
