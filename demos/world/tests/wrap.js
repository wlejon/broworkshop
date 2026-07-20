// Does longitude actually wrap, on the surface the GPU draws?
//
// tests/baked.js proves the DATA closes across the meridian. That is necessary
// and not sufficient: the height layer was still sampled GL_CLAMP_TO_EDGE with
// a coverage ramp that faded to nothing at its east and west edges, so a closed
// field was being drawn with a hole at the join and a smeared column past it.
//
// This asks the clipmap itself, through elevationAt — the same sampler the
// vertex stage displaces from, including the procedural detail on top.
import { PLANET, loadChart } from '/app/planet.js';
import { terrain, elevationAt } from '/app/app.js';

const chart = loadChart('D:/projects/broworkshop/demos/world/');
assert(chart, 'no baked chart — run tools/bake-planet.js');

const SPAN = chart.width * chart.cellSize;      // one circumference, in metres
const z    = chart.height * chart.cellSize * 0.5;   // the equator

console.log('=== the world is periodic in longitude ===');
console.log('  circumference ' + (SPAN / 1e6).toFixed(2) + ' Mm');

// CONTINUITY is the property that matters, and it is not the same as
// periodicity. The height LAYER is periodic — x and x + SPAN are the same
// texels. Procedural detail is not: it is a pure function of world position, so
// a full lap returns to the same landforms carrying different sub-cell detail.
//
// That is measured and reported rather than asserted away, because it is a real
// limitation with a known fix: detail has to become a function of DIRECTION on
// the sphere, which is the same change that lets the geometry cross a pole.
// Until then the world is an endless tiling of one globe's landforms rather
// than a closed surface — and, importantly, that is invisible: you cannot see
// two laps at once, and every point is still continuous with its neighbours.
let lap = 0;
for (let k = 0; k < 12; k++) {
    const x = SPAN * (k / 12);
    lap = Math.max(lap, Math.abs(elevationAt(x, z) - elevationAt(x + SPAN, z)));
}
console.log('  worst detail difference after a full lap: ' + lap.toFixed(1) +
            ' m  (the layer repeats exactly; detail does not yet)');
// The LANDFORMS must repeat even though the detail does not — if this grows to
// kilometres the height layer itself has stopped wrapping.
assert(lap < 1500, 'a lap moved the ground by ' + lap.toFixed(0) +
       ' m — that is the layer, not detail');

// --- and the join is not a wall ----------------------------------------------
// Step across the meridian in small increments and compare the biggest step
// against the terrain's own roughness at the same scale. A clamped edge shows up
// here as a single huge jump; a faded coverage ramp shows up as a plunge toward
// sea level on both sides.
console.log('');
console.log('=== crossing the meridian ===');
const STEP = 200;                     // metres
function walk(x0) {
    let prev = elevationAt(x0 - 10 * STEP, z), mx = 0, sum = 0;
    for (let k = -9; k <= 10; k++) {
        const h = elevationAt(x0 + k * STEP, z);
        const d = Math.abs(h - prev);
        mx = Math.max(mx, d); sum += d; prev = h;
    }
    return { max: mx, mean: sum / 20 };
}
// This is the assertion that would have caught the bug this change fixes: with
// GL_CLAMP_TO_EDGE and a coverage ramp that faded at the layer's east and west
// edges, crossing x = 0 dropped toward sea level on both sides and stepped.
const at0  = walk(0);                 // straight over the join
const away = walk(SPAN * 0.37);       // ordinary ground, same latitude
console.log('  over the meridian:  worst step ' + at0.max.toFixed(1) +
            ' m, mean ' + at0.mean.toFixed(1) + ' m');
console.log('  ordinary ground:    worst step ' + away.max.toFixed(1) +
            ' m, mean ' + away.mean.toFixed(1) + ' m');
assert(at0.max < Math.max(away.max * 3, 60),
       'the meridian steps by ' + at0.max.toFixed(1) +
       ' m against ' + away.max.toFixed(1) + ' m on ordinary ground');

// --- the poles still clamp, and that is correct ------------------------------
// Latitude is NOT periodic. Wrapping T would blend the north pole row into the
// south pole row; clamping is right, and it is only correct because the bake
// made each polar row single-valued.
console.log('');
console.log('=== the poles clamp, not wrap ===');
const north = elevationAt(SPAN * 0.25, -50000);          // past the north edge
const south = elevationAt(SPAN * 0.25, chart.height * chart.cellSize + 50000);
const rowN  = chart.data[Math.floor(chart.width * 0.25)];
console.log('  past the north edge ' + north.toFixed(0) + ' m, pole row ' +
            rowN.toFixed(0) + ' m');
assert(Math.abs(north - south) > 0.5 || Math.abs(north - rowN) < 3000,
       'the poles are wrapping into each other');

console.log('WRAP OK');
