// Flying past the coarse field's edge. The layer is ONE fixed request centred
// on the origin; the clipmap's rings follow the camera forever. Beyond the
// layer's footprint every sample is whatever GL_CLAMP_TO_EDGE returns, so the
// edge row smears outward as infinite parallel bands.
import { cam, elevationAt, coarseField, ready } from '/app/app.js';

for (let i = 0; i < 900; i++) { wallSleep(100); advanceTime(16); if (ready()) break; }
assert(ready(), 'terrain never became ready');

function window_() {
    const c = coarseField();
    const span = c.data.width * c.data.cellSize;
    return { x0: c.originX, z0: c.originZ, span, c };
}
let w = window_();
console.log('coarse window: ' + (w.span / 1000).toFixed(0) + ' km across, x ' +
            (w.x0 / 1000).toFixed(0) + '..' + ((w.x0 + w.span) / 1000).toFixed(0) + ' km');

// Fly out along +X, letting the window re-cut, and sample under the camera.
// The regression this guards is clamp-to-edge: with a fixed window, height past
// its rim stops depending on X and two distant points read the same.
console.log('=== flying out along +X, sampling under the camera ===');
const seen = [];
for (const km of [0, 300, 600, 1235, 2000, 4000]) {
    cam.pos = [km * 1000, 20000, 127530];
    for (let i = 0; i < 12; i++) advanceTime(16);
    w = window_();
    const h = elevationAt(km * 1000, 127530);
    seen.push(h);
    console.log('  x = ' + String(km).padStart(5) + ' km:  ground ' +
                h.toFixed(1).padStart(9) + ' m   window x ' +
                (w.x0 / 1000).toFixed(0).padStart(6) + '..' +
                ((w.x0 + w.span) / 1000).toFixed(0).padStart(6) + ' km');
    assert(km * 1000 >= w.x0 && km * 1000 <= w.x0 + w.span,
           'camera outside its own coarse window at ' + km + ' km');
}

// Real terrain keeps changing however far you go. Identical or near-identical
// heights across thousands of km is the clamp-to-edge signature.
let flat = 0;
for (let i = 1; i < seen.length; i++) if (Math.abs(seen[i] - seen[i - 1]) < 5) flat++;
console.log('near-identical consecutive samples: ' + flat + ' of ' + (seen.length - 1));
assert(flat <= 1, 'terrain stopped varying with distance — clamped edge is back');

// Re-centring must not MOVE terrain: the window is cut in cell indices, so a
// fixed point reads the same whichever window covers it.
const PX = 600000, PZ = 127530;
cam.pos = [PX, 20000, PZ];
for (let i = 0; i < 12; i++) advanceTime(16);
const near = elevationAt(PX, PZ);
cam.pos = [PX + 300000, 20000, PZ];
for (let i = 0; i < 12; i++) advanceTime(16);
const far = elevationAt(PX, PZ);
console.log('fixed point, two different windows: ' + near.toFixed(1) + ' vs ' +
            far.toFixed(1) + ' m  (delta ' + Math.abs(near - far).toFixed(2) + ')');
assert(Math.abs(near - far) < 60,
       'terrain moved when the window re-cut: ' + Math.abs(near - far).toFixed(1) + ' m');
console.log('EDGE OK');
