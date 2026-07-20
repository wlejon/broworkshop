// What makes a mountain read as enormous is SLOPE and VERTICAL THROW, not total
// relief spread over a hundred kilometres. This measures both, at two places far
// enough apart that any privileged region would show up as a difference.
//
// The bar is the 30 m decoder field, measured before it was removed:
//   slope at 30 m baseline   median 29.2°   p90 44.6°   p99 55.7°
//   slope at 2 km baseline   median 12.3°   p90 22.8°   p99 31.6°
//   max drop over 1 km       1177 m
// Everything below those numbers is terrain that reads as a scale model.
import { cam, elevationAt, ready } from '/app/app.js';

for (let i = 0; i < 900; i++) {
    wallSleep(100); advanceTime(16);
    if (ready()) break;
}
assert(ready(), 'terrain never became ready');

const SX = -81810, SZ = 114310;   // the ground-level screenshot position
cam.pos = [SX, 5000, SZ];
for (let i = 0; i < 90; i++) advanceTime(16);

// Slope in degrees over a given baseline, sampled on a grid.
function slopes(cx, cz, baseline, span, n) {
    const out = [];
    for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
            const x = cx - span + 2 * span * i / (n - 1);
            const z = cz - span + 2 * span * j / (n - 1);
            const h  = elevationAt(x, z);
            const hx = elevationAt(x + baseline, z);
            const hz = elevationAt(x, z + baseline);
            if (h === null || hx === null || hz === null) continue;
            const g = Math.hypot(hx - h, hz - h) / baseline;
            out.push(Math.atan(g) * 180 / Math.PI);
        }
    out.sort((a, b) => a - b);
    return out;
}
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];

function report(label, cx, cz, span) {
    console.log('--- ' + label + ' ---');
    for (const b of [30, 120, 500, 2000, 8000]) {
        const s = slopes(cx, cz, b, span, 26);
        if (!s.length) continue;
        console.log('  baseline ' + String(b).padStart(5) + ' m:  ' +
                    'median ' + pct(s, 0.50).toFixed(1).padStart(5) + '°  ' +
                    'p90 '    + pct(s, 0.90).toFixed(1).padStart(5) + '°  ' +
                    'p99 '    + pct(s, 0.99).toFixed(1).padStart(5) + '°  ' +
                    'max '    + pct(s, 1.00).toFixed(1).padStart(5) + '°');
    }
}

// Two widely separated places. These must agree — one surface, no sweet spot.
report('surface at the spawn', SX, SZ, 6000);

report('surface 200 km away (must match: no privileged region)', SX + 200000, SZ, 6000);

// How much vertical throw exists in the band that reads as "a mountain" —
// relief within a few km, which is what fills the frame when you stand on one.
console.log('=== VERTICAL THROW within a short horizontal run ===');
function throwOver(cx, cz, run) {
    let best = 0;
    for (let k = 0; k < 400; k++) {
        const a = Math.random() * Math.PI * 2;
        const x = cx + (Math.random() - 0.5) * 20000, z = cz + (Math.random() - 0.5) * 20000;
        const h0 = elevationAt(x, z);
        const h1 = elevationAt(x + Math.cos(a) * run, z + Math.sin(a) * run);
        if (h0 === null || h1 === null) continue;
        best = Math.max(best, Math.abs(h1 - h0));
    }
    return best;
}
for (const run of [500, 1000, 2000, 5000]) {
    console.log('  max drop over ' + String(run).padStart(4) + ' m:  ' +
                'A ' + throwOver(SX, SZ, run).toFixed(0).padStart(5) + ' m   ' +
                'B ' + throwOver(SX + 200000, SZ, run).toFixed(0).padStart(5) + ' m');
}
console.log('PROBE OK');
