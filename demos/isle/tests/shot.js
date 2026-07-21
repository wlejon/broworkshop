// Headless smoke for M1: boot the app, wait for the bake, screenshot the island.
//   ../bro/build/Release/bro-headless.exe demos/isle demos/isle/tests/shot.js
import { ready, stats } from "/app/app.js";

// pump until the model loads + island bakes
let ok = false;
for (let i = 0; i < 1500; i++) {
    if (typeof wallSleep === 'function') wallSleep(60);
    advanceTime(16);
    if (typeof flush === 'function') flush();
    if (ready()) { ok = true; break; }
}
if (!ok) { console.log('ISLAND NOT READY (load/bake timed out)'); throw new Error('not ready'); }

const s = stats();
console.log('READY  loadMs=' + s.loadMs.toFixed(0) + '  bakeMs=' + s.bakeMs.toFixed(0) +
            '  atlas=' + s.atlas.w + 'x' + s.atlas.h + '  elev ' + s.atlas.min.toFixed(0) + '..' + s.atlas.max.toFixed(0) + 'm');

// let the clipmap stream / lighting settle, then capture
for (let i = 0; i < 40; i++) { if (typeof wallSleep === 'function') wallSleep(30); advanceTime(16); }
if (typeof flush === 'function') flush();
screenshot('m1_aerial.png');
console.log('SHOT m1_aerial.png');
