// Is the ribbon artifact a PRECISION failure in the exemplar tap?
//
// cmExBicubic takes u = world / lambda and immediately forms u * n, where n is
// the texel count at the sampled mip. The B-spline is evaluated by the
// Sigg & Hadwiger trick, which folds each weight pair into one bilinear fetch at
// a carefully placed SUB-TEXEL offset. That offset is the whole mechanism, and
// it is computed as (i + 0.5 + w/s) / n with i of order u * n.
//
// The CPU mirror (ClipmapTerrain::exemplarAt) wraps first — ux - floor(ux) —
// so it never sees a large coordinate, which is why elevationAt scans came back
// perfectly smooth while the GPU shredded the near field.
//
// So the prediction is sharp and falsifiable: the artifact must scale with
// DISTANCE FROM THE WORLD ORIGIN, be absent at 0,0, and be worse at 500 km.
// Nothing about a morph or ring-boundary bug would behave that way.
import { cam, terrain, ready } from '/app/app.js';

for (let i = 0; i < 900; i++) { wallSleep(100); advanceTime(16); if (ready()) break; }
assert(ready(), 'terrain never became ready');

function shoot(tag, x, z) {
    const ground = terrain.elevationAt(x, z);
    cam.pos = [x, ground + 60, z];
    cam.vel = [0, 0, 0];
    cam.rot = Camera.quatNorm(Camera.quatMul(
        Camera.quatFromAxis(0, 1, 0, 2.6),
        Camera.quatFromAxis(1, 0, 0, -0.02)));
    for (let i = 0; i < 90; i++) { advanceTime(16); wallSleep(5); }
    flush();
    screenshot('/tmp/exspike-' + tag + '.png');
    console.log('  exspike-' + tag + '.png  at ' + (x / 1000).toFixed(0) + ',' +
                (z / 1000).toFixed(0) + ' km, ground ' + ground.toFixed(0) + ' m');
}

console.log('=== 60 m AGL at increasing distance from the origin ===');
shoot('origin',  0,       0);
shoot('spawn',  -84480,   115200);
shoot('far',     500000,  500000);

console.log('EXSPIKE OK');
