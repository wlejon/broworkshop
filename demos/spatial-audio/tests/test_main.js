// Spatial Audio headless test: the zone crossfade drives the three bus gains
// from the listener's x, occlusion counts the distinct walls between the
// listener and each source (and scales that voice), footsteps fire only while
// moving, the zone mixer mutes a bus, and H hides the head-model panel.
// Run: scripts/validate.sh demos/spatial-audio
import { check, eq, near, frames, clickOn, press, text, test, done, shot } from "/lib/kit/test.js";
import { lab, zoneAt, zoneWeights, occludersBetween } from "/app/lab.js";

frames(5);
const { ctx, snd, fly, state, occlusion } = lab;
state.autoTick = false;   // step the world by hand from here on

/** Stand at `pos` looking along yaw, then run n frames. */
function standAt(pos, n, yaw) {
    fly.pose({ pos, yaw: yaw || 0, pitch: 0 });
    step(n || 6);
}
function step(n) {
    for (let i = 0; i < n; i++) { advanceTime(16); lab.tick(1 / 60); }
    flush();
}
const gains = () => ['cave', 'forest', 'metal'].map((k) => ctx.getBusGain(snd.buses[k]));

test('zone weights: 1 inside a room, linear across a bridge', () => {
    eq(zoneWeights(-21), { cave: 1, forest: 0, metal: 0 });
    eq(zoneWeights(0), { cave: 0, forest: 1, metal: 0 });
    eq(zoneWeights(21), { cave: 0, forest: 0, metal: 1 });
    const b = zoneWeights(-10);
    near(b.cave, 0.5, 1e-9); near(b.forest, 0.5, 1e-9);
    near(zoneWeights(9).metal, 0.25, 1e-9);
    eq(zoneAt(-10), 'bridge_cave_forest');
    eq(zoneAt(10), 'bridge_forest_metal');
});

test('bus gains follow the listener between rooms', () => {
    standAt([-21, 1.6, 0]);
    eq(state.zone, 'cave');
    const g = gains();
    near(g[0], 1, 1e-3, 'cave bus'); near(g[1], 0, 1e-3); near(g[2], 0, 1e-3);
    eq(text('#zoneLabel'), 'Stone Cave');

    standAt([-10, 1.6, 0]);
    const m = gains();
    near(m[0], 0.5, 1e-3, 'cave half'); near(m[1], 0.5, 1e-3, 'forest half');
    eq(text('#zoneLabel'), 'Bridge: cave / forest');

    standAt([21, 1.6, 0]);
    near(gains()[2], 1, 1e-3, 'metal bus');
    eq(text('#zoneLabel'), 'Metal Hall');
    check(/^21\.0, 1\.6, 0\.0$/.test(text('#posLabel')), 'position readout ' + text('#posLabel'));
});

test('occlusion counts each wall once and scales the voice', () => {
    // From the forest: the cave drone sits behind the cave's east wall, the
    // crystal above the sky platform, the forest drone in plain view.
    standAt([0, 1.6, 8]);
    eq(occludersBetween([0, 1.6, 8], [-21, 2, 0]), 1, 'cave east wall');
    eq(occludersBetween([0, 1.6, 8], [0, 9, 0]), 1, 'sky platform');
    eq(occludersBetween([0, 1.6, 8], [0, 3, 0]), 0, 'forest drone in view');
    eq(occlusion.caveDrone.hits, 1);
    near(occlusion.caveDrone.factor, 0.4, 1e-6, 'one wall -> 1 - 0.6');
    eq(occlusion.forest1.factor, 1);
    // From inside the cave the crystal is behind the wall AND the platform.
    standAt([-21, 1.6, 0]);
    eq(occlusion.crystal.hits, 2, 'two occluders to the crystal');
    near(occlusion.crystal.factor, 0.05, 1e-6, 'floored at 0.05');
    check(document.querySelector('#occList > div.hit'), 'occluded rows are marked');
});

test('footsteps fire only while moving, rate-limited', () => {
    standAt([0, 1.6, 4], 30);
    const before = lab.shots.counts.footsteps;
    check(!state.moving, 'standing still');
    step(30);
    eq(lab.shots.counts.footsteps, before, 'no steps while still');
    fly.keys.w = true;
    step(60);
    fly.keys.w = false;
    check(state.moving || lab.shots.counts.footsteps > before, 'walked');
    check(lab.shots.counts.footsteps > before, 'a footstep fired');
    check(fly.cam.pos[2] < 4, 'W walks north (-Z): z ' + fly.cam.pos[2].toFixed(2));
    check(lab.shots.counts.drips > 0 && lab.shots.counts.bubbles > 0, 'drips and bubbles tick');
});

test('movement is clamped to the world', () => {
    standAt([28.5, 1.6, 0], 2, -Math.PI / 2);   // yaw -90deg looks +X
    fly.keys.w = true; step(90); fly.keys.w = false;
    check(fly.cam.pos[0] <= 29, 'x clamp ' + fly.cam.pos[0]);
});

test('zone mixer mutes and solos buses', () => {
    standAt([0, 1.6, 8]);
    clickOn('#busStrips [data-bus=forest] button[title=mute]');
    step(2);
    near(gains()[1], 0, 1e-6, 'muted forest');
    clickOn('#busStrips [data-bus=forest] button[title=mute]');
    clickOn('#busStrips [data-bus=cave] button[title=solo]');
    step(2);
    near(gains()[1], 0, 1e-6, 'forest silenced by cave solo');
    clickOn('#busStrips [data-bus=cave] button[title=solo]');
    step(5);
    near(gains()[1], 1, 1e-6, 'forest back');
    eq(text('#busStrips .k-kv b'), '0.00 / 1.00 / 0.00', 'gain readout');
});

test('head model panel: ten controls, H hides it', () => {
    eq(document.querySelectorAll('#headParams .k-field').length, 10);
    lab.headPanel.set('ild', 0.5);
    eq(lab.head.ild, 0.5);
    check(lab.panelVisible, 'visible at start');
    shot('forest');
    press('h');
    check(!lab.panelVisible, 'H hides');
    clickOn('#panelToggle');
    check(lab.panelVisible, 'the toggle button shows it again');
});

// A wide view over the whole map for the screenshot.
standAt([-2, 10, 9], 4, 0.35);
fly.pose({ pos: [-2, 10, 9], yaw: 0.35, pitch: -0.55 });
step(4);
shot('overview');

done('spatial-audio');
