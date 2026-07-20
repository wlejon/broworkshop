// Does distant terrain carry detail at altitude, or is it flat paint?
// Reproduces the vantage from the 37 km screenshot: most of the frame is ground
// beyond the fine layer's footprint, where the only data is the 7.68 km field.
import { cam, elevationAt } from '/app/app.js';

for (let i = 0; i < 600; i++) {
    wallSleep(100);
    advanceTime(16);
    if (elevationAt(0, 0) !== null) break;
}
assert(elevationAt(0, 0) !== null, 'no tile ever arrived');

cam.pos = [-70140, 37544, 104800];
cam.vel = [0, 0, 0];
for (let i = 0; i < 90; i++) advanceTime(16);
screenshot('alt-37km.png');

// The measurable version of "flat paint": sample a transect far outside the
// fine footprint and ask how much relief exists at the scales a pixel can see
// from here. Layer 0 spans 30.7 km, so 200 km out is pure coarse field.
function relief(x0, z0, step, n) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) {
        const h = elevationAt(x0 + i * step, z0 + i * step * 0.37);
        if (h === null) continue;
        if (h < mn) mn = h;
        if (h > mx) mx = h;
    }
    return mx - mn;
}
// Successive detail bands, all far outside layer 0.
const fine = relief(-270000, 300000, 25, 8);
const mid  = relief(-270000, 300000, 250, 8);
const data = relief(-270000, 300000, 2500, 8);
console.log('relief over 200 m  (fine band): ' + fine.toFixed(1) + ' m');
console.log('relief over 2 km   (mid band):  ' + mid.toFixed(1) + ' m');
console.log('relief over 20 km  (data band): ' + data.toFixed(1) + ' m');

// The regression this guards: with the detail band pinned to a constant start
// wavelength, everything between the coarse cell and that constant was missing,
// and ground this far out was a bilinear ramp between 7.68 km samples — 2.6 m of
// relief over 200 m, which is why it rendered as flat paint. The band now
// reaches up to whatever the data floor is here, so the decades in between
// exist. Coarser bands must still dominate: detail supplements the model's
// terrain, it does not replace it.
assert(fine > 8, 'sub-cell detail missing outside the fine layer: ' + fine.toFixed(1) + ' m');
assert(mid > fine, 'relief must grow with scale, not shrink');
assert(data > mid, 'procedural detail is drowning the model terrain');
console.log('ALT OK');
