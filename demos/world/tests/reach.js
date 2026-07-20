// The world ended at 524 km. From 280 km up that is not a horizon, it is a
// plate of land hanging in the sky with space beyond it.
//
// The ring stack now zooms with altitude (ClipmapTerrain::update). The claim
// being tested is not "it looks better" but the exact invariant that makes the
// zoom free: cmCellSize returns max(cGeo, cAA), cGeo's floor is c0, and the
// zoom only ever raises c0 to a value cAA already exceeds. So the SURFACE must
// be unchanged while the REACH multiplies.
import { cam, terrain, elevationAt, ready } from '/app/app.js';

for (let i = 0; i < 900; i++) { wallSleep(100); advanceTime(16); if (ready()) break; }
assert(ready(), 'terrain never became ready');

function settle(x, y, z, n = 30) {
    cam.pos = [x, y, z]; cam.vel = [0, 0, 0];
    for (let i = 0; i < n; i++) { advanceTime(16); terrain.update(x, y, z); }
}

// --- Reach grows with altitude, and the data window keeps up -----------------
console.log('=== reach vs altitude ===');
const X = 692300, Z = -1391800;
let groundReach = 0;
for (const alt of [200, 2000, 20000, 80000, 280000]) {
    settle(X, alt, Z);
    const km = terrain.farDistance / 1000;
    if (alt === 200) groundReach = km;
    console.log('  alt ' + String(alt).padStart(7) + ' m:  cellScale ' +
                String(terrain.cellScale).padStart(3) + '  reach ' +
                km.toFixed(0).padStart(6) + ' km  (' +
                (km / (alt / 1000)).toFixed(1) + 'x altitude)');
}
settle(X, 280000, Z);
assert(terrain.cellScale > 1, 'stack never zoomed out');
assert(terrain.farDistance / 1000 > groundReach * 4,
       'reach barely grew: ' + (terrain.farDistance / 1000).toFixed(0) + ' km');

// From 280 km up the rim must sit close enough to the horizon to be lost in
// aerial perspective. The old 524 km reach put it 28 degrees below horizontal.
const rimDeg = Math.atan(280000 / terrain.farDistance) * 180 / Math.PI;
console.log('  rim at 280 km altitude sits ' + rimDeg.toFixed(1) +
            ' deg below horizontal (was 28.1)');
assert(rimDeg < 6, 'terrain rim still well inside the view');

// --- The surface itself must not move ---------------------------------------
// elevationAt is the CPU mirror of the same height function; if the zoom were
// changing what the layers resolve, the ground under a fixed point would shift
// as the camera climbed past a step.
console.log('=== surface invariance across zoom steps ===');
const PTS = [[X, Z], [X + 40000, Z - 15000], [X - 120000, Z + 90000]];
const base = PTS.map(([x, z]) => { settle(X, 200, Z); return elevationAt(x, z); });
let worst = 0;
for (const alt of [20000, 80000, 280000]) {
    settle(X, alt, Z);
    for (let i = 0; i < PTS.length; i++) {
        const h = elevationAt(PTS[i][0], PTS[i][1]);
        worst = Math.max(worst, Math.abs(h - base[i]));
    }
}
console.log('  worst ground drift across all zoom steps: ' + worst.toFixed(3) + ' m');
assert(worst < 1, 'zooming the stack moved the ground: ' + worst.toFixed(2) + ' m');

// --- What it looks like ------------------------------------------------------
const ROT = Camera.quatNorm(Camera.quatMul(
    Camera.quatFromAxis(0, 1, 0, 2.6),
    Camera.quatFromAxis(1, 0, 0, -0.22)));
for (const alt of [280000, 80000, 2000]) {
    cam.rot = ROT;
    settle(X, alt, Z, 60);
    cam.rot = ROT;
    for (let i = 0; i < 8; i++) advanceTime(16);
    screenshot('reach-' + (alt / 1000) + 'km.png');
}

console.log('REACH OK');
