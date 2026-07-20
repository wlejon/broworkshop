// Long thin sheets of terrain fly through the sky when the camera sits ~60 m
// above a 3.7 km massif, and the near field is stretched into slivers. Clean by
// 400 m up, and identical on a flat world and against the pre-curvature
// shaders, so it is neither the curve nor the coverage bound.
//
// Bisect the displacement terms AT THE FAILING ALTITUDE. Everything the vertex
// stage adds on top of the height layers can be switched off from JS: the
// exemplar directly, the procedural detail by its octave count. If the ribbons
// survive both, the defect is in the layer sampling or the morph.
//
// Re-measure the ground after every change. Each term moves the surface by tens
// of metres, so a camera placed from a stale reading ends up inside the
// mountain, and a backface shot looks exactly like a broken shader.
import { cam, terrain, ready } from '/app/app.js';

for (let i = 0; i < 900; i++) { wallSleep(100); advanceTime(16); if (ready()) break; }
assert(ready(), 'terrain never became ready');

const X = -84480, Z = 115200;

function shoot(tag, agl, pitch = -0.02) {
    const ground = terrain.elevationAt(X, Z);
    cam.pos = [X, ground + agl, Z];
    cam.vel = [0, 0, 0];
    cam.rot = Camera.quatNorm(Camera.quatMul(
        Camera.quatFromAxis(0, 1, 0, 2.6),
        Camera.quatFromAxis(1, 0, 0, pitch)));
    for (let i = 0; i < 60; i++) { advanceTime(16); wallSleep(5); }
    flush();
    screenshot('/tmp/ribbon-' + tag + '.png');
    console.log('  ribbon-' + tag + '.png  agl ' + agl + ' m, ground ' +
                ground.toFixed(0) + ' m');
}

// Where does it start? If it is a near-field term the threshold will be sharp.
console.log('=== altitude sweep, everything on ===');
for (const agl of [20, 60, 150, 400]) shoot('agl' + agl, agl);

// Now bisect at 60 m, where it is worst.
console.log('=== 60 m, exemplar off ===');
terrain.setDetailExemplar(null);
shoot('no-exemplar', 60);

console.log('=== 60 m, exemplar off AND detail off ===');
terrain.detailOctaves = 0;
shoot('no-exemplar-no-detail', 60);

console.log('=== 60 m, detail off, exemplar back on ===');
console.log('  (exemplar cannot be restored in-process; see world.js)');

console.log('RIBBONS OK');
