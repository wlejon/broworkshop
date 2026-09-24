// Terrain: chunks stream in around the fly camera, sculpting edits the
// surface, and the panel reconfigures the generator.
// Run: scripts/validate.sh demos/terrain
import { check, eq, near, test, done, frames, simUntil, q, text, clickOn, setValue, press, shot } from "/lib/kit/test.js";
import { terrain, fly, config, sculpt, sculptAtCenter, regen, HOME } from "/app/lab.js";

frames(10);
simUntil(() => terrain.chunkCount >= 9 && terrain.triangleCount > 0, 5000);
frames(10);

test('chunks stream in around the camera', () => {
    check(terrain.chunkCount >= 4, 'chunks: ' + terrain.chunkCount);
    check(terrain.triangleCount > 0, 'triangles');
    check(/chunks\s*\d+/.test(text('#stats')), 'HUD: ' + text('#stats'));
});

test('a downward ray lands on the surface', () => {
    const hit = terrain.raycast([fly.cam.pos[0], 300, fly.cam.pos[2]], [0, -1, 0], 600);
    check(hit && hit.position[1] > 0 && hit.position[1] < 60, 'surface hit: ' + (hit && hit.position));
});

test('sculpting lowers and raises the column under the crosshair', () => {
    const hit = terrain.raycast(fly.cam.pos, fly.forward(), 200);
    check(hit, 'the view centre is on terrain');
    // setVoxel moves the height-grid node at floor(x), floor(z); sample there
    // (the hit point itself can sit in a neighbouring triangle).
    const x = Math.floor(hit.position[0]) + 0.02, z = Math.floor(hit.position[2]) + 0.02;
    const h0 = terrain.heightAt(x, z);
    for (let i = 0; i < 3; i++) sculptAtCenter('lower');
    const h1 = terrain.heightAt(x, z);
    check(h1 < h0, 'lowered: ' + h0 + ' -> ' + h1);
    for (let i = 0; i < 3; i++) sculptAtCenter('raise');
    check(terrain.heightAt(x, z) > h1, 'raised again');
    check(terrain.triangleCount > 0, 'still meshed');
});

test('left click sculpts in the chosen mode; [ flips it', () => {
    clickOn('#sculpt button[data-value="lower"]');
    eq(sculpt.mode, 'lower');
    press('[');
    eq(sculpt.mode, 'raise');
    check(q('#sculpt button[data-value="raise"]').classList.contains('active'), 'mode button follows');
    const n = sculpt.edits;
    clickOn('#stage');
    eq(sculpt.edits, n + 1, 'click edited');
});

test('W flies forward', () => {
    const p0 = fly.cam.pos.slice();
    keyDown(119);
    frames(30);
    keyUp(119);
    const f = fly.forward();
    const moved = (fly.cam.pos[0] - p0[0]) * f[0] + (fly.cam.pos[1] - p0[1]) * f[1] + (fly.cam.pos[2] - p0[2]) * f[2];
    check(moved > 1, 'moved ' + moved.toFixed(2) + ' m forward');
    clickOn('#resetPos');
    eq(fly.cam.pos, HOME.pos, 'reset position');
});

test('a preset reconfigures once, after the debounce', () => {
    const n = regen.count;
    clickOn('#presets button[data-value="terraced"]');
    eq(config.meshMode, 2, 'terraced mesh mode');
    eq(q('#mesh select').value, '2', 'panel follows');
    check(regen.pending && regen.count === n, 'debounced');
    frames(20);
    eq(regen.count, n + 1, 'configured once');
    simUntil(() => terrain.chunkCount >= 4, 5000);
    check(terrain.triangleCount > 0, 'regenerated');
});

test('seed slider and colours feed the config', () => {
    const seed = [...document.querySelectorAll('#noise .k-field')].find((r) => /seed/.test(r.textContent));
    setValue(seed.querySelector('input'), 4242);
    eq(config.seed, 4242);
    clickOn(q('#palette').parentNode.querySelector('h2'));   // unfold Materials
    setValue('#palette input[type=color]', '#ff0000');
    eq(config.grass, '#ff0000');
    clickOn('#resetColors');
    eq(config.grass, '#6bb345');
    frames(20);
});

test('Tab hides and shows the panel', () => {
    press('Tab');
    check(q('#panel').hidden, 'hidden');
    press('Tab');
    check(!q('#panel').hidden, 'shown');
});

near(fly.cam.pos[1], HOME.pos[1], 5);
frames(10);
shot('main');
done('terrain');
