// Is the whole planet resident, and is it the SAME surface it used to be?
//
// The bake replaces a computation with a read, so the thing worth testing is
// not that a texture uploaded — it is that swapping the source did not move the
// terrain. The chart is a contiguous region of the same generator, so a point
// inside the old camera window must come back at the same elevation whether it
// was generated live or read from disk.
//
// It also guards the property that motivated the bake: no synchronous re-cut.
import { PLANET, loadChart, chartSize } from '/app/planet.js';
import { terrain, cam, elevationAt } from '/app/app.js';

const DIR = 'D:/projects/broworkshop/demos/world/';

const chart = loadChart(DIR);
assert(chart, 'no baked chart for this planet — run tools/bake-planet.js');

console.log('=== resident ===');
console.log('  ' + chart.width + ' x ' + chart.height + ' at ' +
            (chart.cellSize / 1000).toFixed(2) + ' km, ' +
            (chart.width * chart.height * 4 / 1048576).toFixed(1) + ' MB');
const span = chart.width * chart.cellSize;
console.log('  world spans ' + (span / 1e6).toFixed(2) + ' Mm east-west, ' +
            (chart.height * chart.cellSize / 1e6).toFixed(2) + ' Mm north-south');
assert(Math.abs(span - 2 * Math.PI * PLANET.radius) / span < 0.01,
       'the chart does not span a circumference');

// --- the layer is actually installed, and reads back as the chart ------------
// elevationAt is the clipmap's own sampler, so this goes through the layer the
// GPU displaces from rather than the array we just read off disk. It carries
// procedural detail on top, so it will not match a cell exactly — but at 7.68 km
// per cell it must stay within detail's amplitude of it, not kilometres away.
console.log('');
console.log('=== the layer answers, away from the origin ===');
let checked = 0, worst = 0;
for (const [i, j] of [[1303, 2606], [400, 900], [2100, 4400], [700, 5100]]) {
    const wx = j * chart.cellSize, wz = i * chart.cellSize;
    const want = chart.data[i * chart.width + j];
    const got  = elevationAt(wx, wz);
    assert(got !== null, 'elevationAt returned null at ' + wx + ', ' + wz);
    const d = Math.abs(got - want);
    worst = Math.max(worst, d);
    checked++;
    console.log('  cell ' + i + ',' + j + '  (' + (wx / 1e6).toFixed(2) + ', ' +
                (wz / 1e6).toFixed(2) + ' Mm)   chart ' + want.toFixed(0) +
                ' m   surface ' + got.toFixed(0) + ' m   d ' + d.toFixed(0) + ' m');
}
assert(checked === 4, 'not every probe ran');
// Detail relief is a slope over a 48 m wavelength plus the exemplar's own
// amplitude; a few hundred metres is structure, a few thousand is the wrong
// cell. This is deliberately loose — it is a "did we address the chart right"
// test, not a detail-amplitude test.
assert(worst < 2000, 'the surface is ' + worst.toFixed(0) +
       ' m from the chart — the layer is not addressed the way the bake is laid out');

// --- the far side of the planet is present ----------------------------------
// The point of the bake: no window, so somewhere 15 Mm from the spawn is just
// there. Under the old path this was clamped edge texel, identical for every x.
console.log('');
console.log('=== no window edge ===');
const far = chart.height * chart.cellSize * 0.5;
const a = elevationAt(2.0e6, far), b = elevationAt(14.0e6, far);
console.log('  x=2 Mm ' + a.toFixed(0) + ' m,  x=14 Mm ' + b.toFixed(0) + ' m');
assert(Math.abs(a - b) > 1,
       'two points 12 Mm apart returned the same height — the layer is clamping');

// --- and no re-cut while flying ----------------------------------------------
// The failure this replaced was a synchronous generate mid-flight. Fly a long
// way and assert no frame took anything like a generation.
console.log('');
console.log('=== flight, no synchronous re-cut ===');
cam.pos = [chart.width * chart.cellSize * 0.5, 120000, far];
let slowest = 0;
for (let k = 0; k < 240; k++) {
    cam.pos[0] += 20000;                       // 4.8 Mm over the run
    const t0 = performance.now();
    terrain.update(cam.pos[0], cam.pos[1], cam.pos[2]);
    advanceTime(16);
    slowest = Math.max(slowest, performance.now() - t0);
}
console.log('  slowest terrain.update over 4.8 Mm: ' + slowest.toFixed(1) + ' ms');
assert(slowest < 250, 'a frame took ' + slowest.toFixed(0) +
       ' ms — something is still generating on the fly');

console.log('RESIDENT OK');
