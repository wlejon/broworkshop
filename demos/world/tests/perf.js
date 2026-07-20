// Where does the frame actually go?  Date.now, NOT performance.now: advanceTime
// drives a virtual clock and performance.now follows it, so it reports the step
// size however long the work took. That mistake made world.coarse look free.
//
// Rotating the camera locks the app, and rotating touches NONE of the coarse
// window machinery — no re-cut, no upload. So the cost has to be in the frame
// itself, and the two candidates are the fragment shader (rotating to the
// horizon fills the screen with terrain) and setHeightLayer (which the flying
// case does hit). Both are measured here against wall-clock with the GPU
// forced to finish, because everything in this pipeline is async by default and
// an unsynced timer measures enqueue, not work.
import { cam, terrain, coarseField, ready } from '/app/app.js';

for (let i = 0; i < 900; i++) { wallSleep(100); advanceTime(16); if (ready()) break; }
assert(ready(), 'terrain never became ready');

const POS = [-84480, 4000, 115200];

function frameMs(pitch, n) {
    cam.pos = POS.slice(); cam.vel = [0, 0, 0];
    cam.rot = Camera.quatNorm(Camera.quatMul(
        Camera.quatFromAxis(0, 1, 0, 2.6),
        Camera.quatFromAxis(1, 0, 0, pitch)));
    for (let i = 0; i < 20; i++) advanceTime(16);   // settle
    flush();
    const t0 = Date.now();
    for (let i = 0; i < n; i++) { advanceTime(16); }
    flush();
    return (Date.now() - t0) / n;
}

console.log('=== frame cost vs how much terrain is on screen ===');
for (const [name, pitch] of [['straight down', -1.45], ['45 deg', -0.78],
                             ['shallow', -0.30], ['at the horizon', -0.06]]) {
    console.log('  ' + name.padEnd(16) + frameMs(pitch, 40).toFixed(1) + ' ms/frame');
}

// setHeightLayer on its own: no model call, just the copy + upload + mipmap
// + the CPU scan of the whole layer that recomputeHeightRange does.
console.log('=== setHeightLayer, by field size ===');
const cf = coarseField();
const src = cf.data;
for (const n of [156, 312, 612, 1212]) {
    const buf = new Float32Array(n * n);
    for (let i = 0; i < buf.length; i++) buf[i] = src.data[i % src.data.length];
    flush();
    const t0 = Date.now();
    terrain.setHeightLayer(0, { data: buf, width: n, height: n, originX: 0,
                                originZ: 0, metresPerCell: 7680 });
    const staged = Date.now() - t0;
    advanceTime(16); flush();
    const total = Date.now() - t0;
    console.log('  ' + (n + 'x' + n).padEnd(11) + ' stage ' +
                staged.toFixed(1).padStart(7) + ' ms   through upload ' +
                total.toFixed(1).padStart(7) + ' ms');
}

// Put the real field back so nothing downstream sees the synthetic one.
terrain.setHeightLayer(0, { data: src.data, width: src.width, height: src.height,
                            originX: cf.originX, originZ: cf.originZ,
                            metresPerCell: src.cellSize });
console.log('PERF OK');
