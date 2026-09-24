// Clipmap Terrain: the rings follow the fly camera, the camera keeps its
// ground clearance, and the panel drives views, surface and sun.
// Run: scripts/validate.sh demos/clipmap-terrain
import { check, eq, near, test, done, frames, q, text, clickOn, setValue, press, shot } from "/lib/kit/test.js";
import { clipmap, fly, sun, surface, LAYER, VIEWS } from "/app/lab.js";

frames(20);

test('the clipmap is built and populated', () => {
    eq(clipmap.levels, 6);
    eq(clipmap.resolution, 128);
    eq(clipmap.cellSize, 2);
    check(clipmap.layerCount >= 1, 'height layer set');
    check(clipmap.triangleCount > 0 && clipmap.vertexCount > 0, 'ring geometry');
    check(clipmap.farDistance > 0, 'far distance ' + clipmap.farDistance);
    // detailRelief is a slope fraction (engine default 0.35); metre-sized values spike the surface km high.
    check(surface.detailRelief > 0 && surface.detailRelief <= 1.5, 'detail relief is a slope: ' + surface.detailRelief);
    check(/tris\s*[\d.]+k/.test(text('#stats')), 'HUD: ' + text('#stats'));
    check(/128 × 128/.test(text('#info')), 'info: ' + text('#info'));
});

test('the height layer is centred on the origin', () => {
    // Texel 0 sits at originX; a layer centred on 0 samples mountains on both
    // sides, and the elevation there is what the generator produced.
    const e0 = clipmap.elevationAt(0, 0);
    const e1 = clipmap.elevationAt(-3000, -3000), e2 = clipmap.elevationAt(3000, 3000);
    check([e0, e1, e2].every(Number.isFinite), 'finite elevations');
    check(e1 !== e2, 'the field varies across the layer');
    eq(LAYER.originX, -LAYER.width * LAYER.metresPerCell / 2);
});

test('views jump the camera, and it keeps 15 m above the ground', () => {
    clickOn('#views button[data-value="orbit"]');
    near(fly.cam.pos[1], VIEWS.orbit.pos[1], 1);
    check(q('#views button[data-value="orbit"]').classList.contains('active'), 'orbit active');
    clickOn('#views button[data-value="valley"]');
    frames(8);
    const ground = clipmap.elevationAt(fly.cam.pos[0], fly.cam.pos[2]);
    check(fly.cam.pos[1] >= ground + 15 - 0.01, 'clearance: y ' + fly.cam.pos[1].toFixed(1) + ' ground ' + ground.toFixed(1));
    check(/altitude\s*-?\d+ m AGL/.test(text('#stats')), 'altitude shown: ' + text('#stats'));
});

test('W flies forward at the flight speed', () => {
    clickOn('#views button[data-value="home"]');
    setValue('#flight input', 500);
    eq(fly.opts.speed, 500);
    const p0 = fly.cam.pos.slice();
    keyDown(119);
    frames(30);
    keyUp(119);
    const f = fly.forward();
    const moved = (fly.cam.pos[0] - p0[0]) * f[0] + (fly.cam.pos[1] - p0[1]) * f[1] + (fly.cam.pos[2] - p0[2]) * f[2];
    check(moved > 20, 'moved ' + moved.toFixed(1) + ' m forward');
    clickOn('#views button[data-value="home"]');
    eq(fly.cam.pos, VIEWS.home.pos, 'back home');
});

test('surface sliders drive the clipmap', () => {
    const row = (re) => [...document.querySelectorAll('#surface .k-field')].find((r) => re.test(r.textContent));
    setValue(row(/snow line/).querySelector('input'), 2000);
    eq(surface.snowLine, 2000);
    setValue(row(/detail relief/).querySelector('input'), 0.8);
    near(surface.detailRelief, 0.8, 1e-6);
    setValue(row(/forest/).querySelector('input'), 0.2);
    near(surface.forestStrength, 0.2, 1e-6);
    check(/2000 m/.test(text('#surface')), 'readout follows');
    frames(5);
});

test('sun sliders aim the light', () => {
    const el = [...document.querySelectorAll('#sun .k-field')].find((r) => /elevation/.test(r.textContent));
    setValue(el.querySelector('input'), 60);
    near(sun.direction[1], -Math.sin(60 * Math.PI / 180), 1e-3);
});

test('the Controls button and Tab hide and show the panel', () => {
    clickOn('#togglePanel');
    check(q('#panel').hidden, 'hidden by button');
    press('Tab');
    check(!q('#panel').hidden, 'shown by Tab');
    check(!q('#tip').hidden, 'tip shows while the mouse is free');
});

clickOn('#views button[data-value="home"]');
frames(20);
shot('main');
clickOn('#views button[data-value="peak"]');
frames(20);
shot('peak');
done('clipmap-terrain');
