// Eyeball the curve. Numbers said the horizon is at 5 km; these say whether
// the vertex stage agrees, and whether anything downstream (materials, the
// atmosphere, the normal rotation) broke when the chart stopped being flat.
import { cam, terrain, ready } from '/app/app.js';

for (let i = 0; i < 900; i++) { wallSleep(100); advanceTime(16); if (ready()) break; }
assert(ready(), 'terrain never became ready');

// Altitudes are ABOVE GROUND, not above sea level. The spawn sits on a 3.7 km
// massif, so absolute heights put the camera inside the mountain and every shot
// came back black — which looked exactly like a broken shader.
const X = -84480, Z = 115200;
const GROUND = terrain.elevationAt(X, Z);
console.log('ground at the spawn: ' + GROUND.toFixed(0) + ' m');

const SHOTS = [
    ['deck',    60,      -0.02],
    ['low',     2000,    -0.12],
    ['mid',     40000,   -0.35],
    ['high',    300000,  -0.7],
    ['space',   1200000, -1.2],
];

for (const [name, agl, pitch] of SHOTS) {
    const pos = [X, GROUND + agl, Z];
    cam.pos = pos.slice();
    cam.vel = [0, 0, 0];
    cam.rot = Camera.quatNorm(Camera.quatMul(
        Camera.quatFromAxis(0, 1, 0, 2.6),
        Camera.quatFromAxis(1, 0, 0, pitch)));
    // Let the coarse window catch up with the altitude before shooting.
    for (let i = 0; i < 90; i++) { advanceTime(16); wallSleep(10); }
    flush();
    screenshot('/tmp/world-' + name + '.png');
    console.log('  ' + name.padEnd(6) + ' agl ' +
                (agl / 1000).toFixed(1).padStart(7) + ' km   horizon ' +
                (terrain.horizonDistance(agl) / 1000).toFixed(0).padStart(5) +
                ' km   cover ' +
                (terrain.coverageDistance(agl) / 1000).toFixed(0).padStart(5) +
                ' km   scale ' + terrain.cellScale + 'x');
}
console.log('SHOTS OK');
