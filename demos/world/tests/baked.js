// Does the BAKED field actually close, on real terrain?
//
// tests/chart.js proves the closing rules on a synthetic ramp. That is the right
// test for the rules and the wrong one for the deliverable: real generated
// terrain has coastlines, trenches and mountain fronts, and a fold that looks
// fine on a monotone ramp can still leave a visible scar where a continent meets
// open ocean across the meridian.
//
// So this reads the artifact itself. It is also the guard against shipping a
// field baked for a different planet than the one being drawn.
import { PLANET, chartSize } from '/app/planet.js';

const fs = require('fs');
const DIR = 'D:/projects/broworkshop/demos/world/';

const meta = JSON.parse(fs.readFileSync(DIR + 'planet-coarse.json', 'utf8'));
const buf  = fs.readFileSync(DIR + 'planet-coarse.bin');
const f    = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

const W = meta.width, H = meta.height;
console.log('=== the artifact ===');
console.log('  planet "' + meta.name + '"  seed ' + meta.seed + '  radius ' +
            (meta.radius / 1000).toFixed(0) + ' km');
console.log('  ' + W + ' x ' + H + ' at ' + (meta.cellSize / 1000).toFixed(2) +
            ' km  (' + (buf.byteLength / 1048576).toFixed(1) + ' MB)');

// The sidecar must describe THIS planet. A field baked for another radius is not
// wrong in any way the renderer can detect — the terrain simply stops agreeing
// with the horizon, silently.
assert(meta.seed === PLANET.seed, 'baked seed ' + meta.seed + ' is not the app seed');
assert(meta.radius === PLANET.radius, 'baked radius is not the app radius');
const want = chartSize(PLANET.radius, meta.cellSize);
assert(want.width === W && want.height === H,
       'baked chart is ' + W + 'x' + H + ', the app expects ' +
       want.width + 'x' + want.height);
assert(f.length === W * H, 'the binary holds ' + f.length + ' cells, not ' + W * H);

// --- the field is real terrain, not zeros or NaN -----------------------------
let lo = Infinity, hi = -Infinity, bad = 0, land = 0;
for (let k = 0; k < f.length; k++) {
    const v = f[k];
    if (!Number.isFinite(v)) { bad++; continue; }
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    if (v > PLANET.seaLevel) land++;
}
console.log('  elevation ' + lo.toFixed(0) + ' .. ' + hi.toFixed(0) + ' m,  ' +
            (100 * land / f.length).toFixed(1) + '% above sea level');
assert(bad === 0, bad + ' cells are NaN or infinite');
assert(hi - lo > 1000, 'the field is flat: range is only ' + (hi - lo).toFixed(0) + ' m');
// A planet that is all land or all ocean means the generator or the chart
// mapping is wrong, not that the seed is unusual.
assert(land > f.length * 0.05 && land < f.length * 0.8,
       'land fraction ' + (100 * land / f.length).toFixed(1) + '% is not a world');

// --- the meridian, on real ground --------------------------------------------
// Compare the step ACROSS the seam against the field's own typical east-west
// step at the same latitude. The claim is not "the step is small in metres" —
// mountains are steep — it is "the seam is not distinguishable from ordinary
// terrain".
console.log('');
console.log('=== the meridian, on real terrain ===');
let seam = 0, seamSum = 0, interior = 0;
for (let r = 0; r < H; r++) {
    const d = Math.abs(f[r * W] - f[r * W + W - 1]);
    seamSum += d;
    if (d > seam) seam = d;
    for (let c = 1; c < W - 1; c += 7) {
        interior += Math.abs(f[r * W + c + 1] - f[r * W + c]);
    }
}
const seamMean = seamSum / H;
const interiorMean = interior / (H * Math.floor((W - 2) / 7));
console.log('  mean step across the seam   ' + seamMean.toFixed(2) + ' m');
console.log('  mean step elsewhere         ' + interiorMean.toFixed(2) + ' m');
console.log('  worst single row at the seam ' + seam.toFixed(1) + ' m');
assert(seamMean < interiorMean * 2,
       'the meridian averages ' + seamMean.toFixed(1) +
       ' m against ' + interiorMean.toFixed(1) + ' m elsewhere — that is a scar');

// --- the poles ---------------------------------------------------------------
console.log('');
console.log('=== the poles ===');
for (const [label, row] of [['north', 0], ['south', H - 1]]) {
    let mn = Infinity, mx = -Infinity;
    for (let c = 0; c < W; c++) {
        const v = f[row * W + c];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
    }
    console.log('  ' + label + ' pole spread ' + (mx - mn).toFixed(3) + ' m');
    assert(mx - mn < 0.01, label + ' pole is not single-valued');
}

console.log('BAKED OK');
