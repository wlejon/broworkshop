// What does re-cutting the coarse window actually cost? The app timed it with
// performance.now() around the call and got 0 ms at 1206 square, which was
// enqueue time — the model runs on the GPU and the result is not read until the
// upload. Reading the buffer forces the sync and gives the real number.
import { worldgen, ready } from '/app/app.js';
for (let i = 0; i < 900; i++) { wallSleep(100); advanceTime(16); if (ready()) break; }
const world = worldgen();
assert(world, 'no world');
for (const half of [78, 156, 306, 606]) {
    const t0 = performance.now();
    const r = world.coarse(-half, -half, half, half);
    const enq = performance.now() - t0;
    let s = 0;
    for (let i = 0; i < r.data.length; i += 997) s += r.data[i];
    const real = performance.now() - t0;
    console.log(String(r.width) + 'x' + r.height + ': enqueue ' +
                enq.toFixed(1) + ' ms, real ' + real.toFixed(1) + ' ms');
}
