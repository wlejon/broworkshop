// Long thin sheets of terrain fly through the sky when the camera sits ~60 m
// above a 3.7 km massif. Clean again by 2 km up, and identical on a flat world,
// so it is neither the curve nor the coverage bound.
//
// Bisect the displacement terms rather than argue about them. Everything the
// vertex stage adds on top of the height layers can be switched off from JS:
// the exemplar directly, the procedural detail by its octave count. If the
// ribbons survive both, the defect is in the layer sampling or the morph.
import { cam, terrain, ready } from '/app/app.js';

for (let i = 0; i < 900; i++) { wallSleep(100); advanceTime(16); if (ready()) break; }
assert(ready(), 'terrain never became ready');

const X = -84480, Z = 115200;
const GROUND = terrain.elevationAt(X, Z);

function shoot(tag, agl, pitch = -0.02) {
    cam.pos = [X, GROUND + agl, Z];
    cam.vel = [0, 0, 0];
    cam.rot = Camera.quatNorm(Camera.quatMul(
        Camera.quatFromAxis(0, 1, 0, 2.6),
        Camera.quatFromAxis(1, 0, 0, pitch)));
    for (let i = 0; i < 60; i++) { advanceTime(16); wallSleep(5); }
    flush();
    screenshot('/tmp/ribbon-' + tag + '.png');
    console.log('  wrote ribbon-' + tag + '.png  (agl ' + agl + ' m)');
}

// Where does it start? If it is a near-field term the threshold will be sharp.
console.log('=== altitude sweep, everything on ===');
for (const agl of [20, 60, 150, 400, 1000]) shoot('agl' + agl, agl);

// Altitude and view angle are confounded above: climbing also stops the view
// being grazing. A height mismatch between neighbouring rings is invisible from
// overhead and turns into a screen-wide sliver when seen along the surface, so
// if the ribbons track PITCH rather than altitude the defect is a ring-boundary
// mismatch being amplified, not something that only exists near the ground.
console.log('=== same 60 m, steeper pitch ===');
for (const p of [-0.05, -0.15, -0.40]) shoot('pitch' + Math.abs(p * 100), 60, p);

console.log('=== exemplar off ===');
terrain.setDetailExemplar(null);
// GROUND was measured WITH the exemplar, and dropping it moves the surface by
// tens of metres; without the margin the camera ends up underground and the
// shot is all backface.
shoot('no-exemplar', 400);

console.log('RIBBONS OK');
