// Karst World: validates compact 3-region SVDAG storage, smooth GPU -> Surface Nets
// extraction, instanced flora, 6 cave/arch/overhang camera presets, storage inspection,
// cave layer toggle, and live incremental 3D sculpting.
// Run: scripts/validate.sh demos/karst-world
import { check, eq, near, test, done, frames, q, text, clickOn, press, shot, skip } from "/lib/kit/test.js";
import {
    available, vd, fly, PRESETS, settings, sculpt,
    sculptAtCenter, getTelemetry, selectPreset,
} from "/app/lab.js";

if (!available) skip('no GPU / bro.voxeldag / Mesh.surfaceNets runtime');

frames(14);

const tele0 = getTelemetry();
console.log('Karst telemetry:', JSON.stringify(tele0));

test('compact SVDAG storage extracts smooth multi-chunk terrain and flora', () => {
    check(tele0 && tele0.nodes > 0 && tele0.bricks > 0, 'SVDAG populated: ' + (tele0 && tele0.nodes) + ' nodes');
    check(tele0.poolBytes < 4 * 1024 * 1024, 'compact storage < 4 MB: ' + tele0.poolBytes);
    check(tele0.compression >= 20, 'volume ratio >= 20:1: ' + tele0.compression + ':1');
    check(tele0.chunks === 16, '16 seamless chunks extracted: ' + tele0.chunks);
    check(tele0.triangles >= 30000, 'dense non-voxel surface tris: ' + tele0.triangles);
    check(tele0.floraTotal >= 150, 'sunlit instanced flora placed: ' + tele0.floraTotal);
    check(/ready/.test(text('#status')), 'status ready: ' + text('#status'));
    eq(vd.node.visible, false, 'SVDAG node hidden in default smooth world mode');
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

test('view mode toggles Inspect SVDAG storage visualization and restores smooth world', () => {
    clickOn('#presets button[data-value="overview"]');
    frames(4);
    clickOn('#viewMode button[data-value="storage"]');
    eq(settings.viewMode, 'storage');
    eq(vd.node.visible, true, 'SVDAG node shown in inspect storage mode');
    frames(6);
    shot('storage');

    clickOn('#viewMode button[data-value="smooth"]');
    eq(settings.viewMode, 'smooth');
    eq(vd.node.visible, false, 'SVDAG node hidden again');
    frames(4);
});

test('caves layer toggle disables Region 1 carvings and restores smoothly', () => {
    selectPreset('skylight');
    frames(4);
    clickOn('#btn-caves');
    eq(settings.cavesEnabled, false, 'caves disabled');
    frames(4);
    clickOn('#btn-caves');
    eq(settings.cavesEnabled, true, 'caves restored');
    frames(4);
});

test('live non-voxel 3D sculpting carves and resets incrementally', () => {
    selectPreset('bridge');
    frames(4);
    const gen0 = vd.stats().generation;
    clickOn('#sculptTool button[data-value="carveTunnel"]');
    const hit = sculptAtCenter('carveTunnel');
    check(hit !== null, 'bridge center ray hits smooth stone bridge/cliff');
    check(sculpt.edits >= 1, 'sculptAtCenter recorded edit');

    clickOn('#stage');
    check(sculpt.edits >= 2, 'stage click recorded edit');
    check(vd.stats().generation > gen0, 'DAG generation updated on live edit');
    frames(4);

    clickOn('#resetSculpt');
    eq(sculpt.edits, 0, 'resetEdits cleared sculpts');
    frames(4);
});

test('fly W movement and Tab panel toggle work', () => {
    selectPreset('overview');
    frames(4);
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
frames(6);
done('karst-world');
