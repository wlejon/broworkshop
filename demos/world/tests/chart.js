// Does the global data chart actually close?
//
// The whole cube-sphere blending plan rests on one claim: a single equirect
// field has no interior seams, and its two exterior edges (the meridian and the
// poles) are closed at continental scale. If that is false the faces inherit a
// hard edge and no amount of face-level blending repairs it.
//
// This runs on a synthetic field, not the generator, so it tests the closing
// rules rather than the terrain — and runs in milliseconds instead of minutes.
import { CHART, chartSize, foldLongitude, closePoles } from '/app/planet.js';

// --- sizing ------------------------------------------------------------------
console.log('=== chart sizing ===');
for (const [r, cell] of [[6371000, 7680], [600000, 7680], [6371000, 30]]) {
    const { width, height } = chartSize(r, cell);
    const span = width * cell / 1000;
    console.log('  R ' + (r / 1000).toFixed(0).padStart(5) + ' km  cell ' +
                String(cell).padStart(5) + ' m  ->  ' + width + ' x ' + height +
                '  (' + span.toFixed(0) + ' km around, ' +
                (width * height * 4 / 1048576).toFixed(1) + ' MB)');
    // Width must span one circumference and height exactly half, or a cell is
    // not square at the equator and the whole chart is anisotropic.
    assert(Math.abs(width * cell - 2 * Math.PI * r) / (2 * Math.PI * r) < 0.01,
           'width does not span a circumference');
    assert(Math.abs(height * 2 - width) <= 1, 'height is not half the width');
}

// A field with a deliberate discontinuity at the meridian: a ramp that runs
// 0 -> 1000 m west to east, so column 0 and column W-1 differ by the full range.
// That is the worst case the closing has to absorb.
function ramp(W, H) {
    const f = new Float32Array(W * H);
    for (let r = 0; r < H; r++)
        for (let c = 0; c < W; c++)
            f[r * W + c] = 1000 * (c / (W - 1)) + 40 * Math.sin(r * 0.3);
    return f;
}

const W = 800, H = 400;
const B = CHART.wrapBand;

// --- the meridian ------------------------------------------------------------
// The generator is asked for B extra columns past the meridian; foldLongitude
// folds them back. The synthetic field mimics that: a ramp over W + B columns,
// so column W continues column W-1 exactly as real generated data would.
console.log('');
console.log('=== longitude wrap ===');
const src = ramp(W + B, H);
const naive = Math.abs(src[0] - src[W - 1]);
const out = foldLongitude(src, W + B, H, B);
const jump = Math.abs(out[0] - out[W - 1]);
console.log('  step across the meridian: ' + naive.toFixed(1) + ' m  ->  ' +
            jump.toFixed(1) + ' m');
assert(jump < naive * 0.05,
       'the meridian still steps by ' + jump.toFixed(1) + ' m');

// Continuity is not enough on its own — a fold that is C0 but kinks reads as a
// ridge. Compare the worst neighbour step inside the band against the field's
// own typical step, which is what "no visible seam" actually means.
let worst = 0, typical = 0;
for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
        const d = Math.abs(out[r * W + ((c + 1) % W)] - out[r * W + c]);
        typical += d;
        if (c < B + 2 || c > W - 3) worst = Math.max(worst, d);
    }
}
typical /= W * H;
console.log('  worst step in the band ' + worst.toFixed(2) +
            ' m vs typical ' + typical.toFixed(2) + ' m');
assert(worst < typical * 4,
       'the band kinks: ' + worst.toFixed(2) + ' m against a typical ' +
       typical.toFixed(2) + ' m');

// --- the poles ---------------------------------------------------------------
// Every cell in row 0 is the same point on the sphere, so the row has to be
// constant. Anything else is not a surface, and an equirect chart cannot express
// the difference — it just tears.
console.log('');
console.log('=== poles ===');
const p = ramp(W, H), base = ramp(W, H);
const spreadBefore = Math.max(...p.slice(0, W)) - Math.min(...p.slice(0, W));
closePoles(p, W, H);
for (const [label, row] of [['north', 0], ['south', H - 1]]) {
    const r = p.slice(row * W, row * W + W);
    const spread = Math.max(...r) - Math.min(...r);
    console.log('  ' + label + ' pole row spread: ' + spreadBefore.toFixed(1) +
                ' m  ->  ' + spread.toFixed(3) + ' m');
    assert(spread < 0.01, label + ' pole is not single-valued: ' + spread + ' m');
}

// And the convergence must be gradual: the band's inner edge should still be
// essentially untouched, or the poles flatten into visible caps.
const inner = CHART.poleBand;
let moved = 0;
for (let c = 0; c < W; c++) {
    moved = Math.max(moved, Math.abs(p[inner * W + c] - base[inner * W + c]));
}
console.log('  displacement at the band edge (row ' + inner + '): ' +
            moved.toFixed(3) + ' m');
assert(moved < 1, 'the pole band bleeds past its edge by ' + moved.toFixed(1) + ' m');

console.log('CHART OK');
