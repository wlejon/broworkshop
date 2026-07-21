// Flying fast made the window "Not Responding".
//
// The re-cut is not expensive because of the model — world.coarse returns a
// 1212-square window in under a millisecond. It is expensive because
// setHeightLayer then copies six megabytes, uploads them and builds a mip
// pyramid. So the failure mode is not one slow call, it is MANY calls: the
// clipmap's zoom compares the camera's height above TERRAIN against a
// threshold, and terrain height under a camera doing 13 km/s swings hundreds of
// metres per frame. With a narrow hysteresis band that noise walks back and
// forth across a threshold and re-uploads the layer on consecutive frames.
//
// This flies the profile that broke it and counts re-cuts, which is the thing
// that has to stay bounded.
import { cam, terrain, ready } from '/app/app.js';

for (let i = 0; i < 900; i++) { wallSleep(100); advanceTime(16); if (ready()) break; }
assert(ready(), 'terrain never became ready');

let cuts = 0;
const realLog = console.log;
console.log = (m) => { if (String(m).indexOf('re-cut') >= 0) cuts++; else realLog(m); };

// Climb from the deck to the swap ceiling and back at the speed the app actually
// allows, crossing every zoom threshold the clipmap has twice. X moves too, so the
// ground underneath keeps changing — that is the noise source. (The clipmap only
// uses cellScale 1 and 2 now: the higher zoom levels served the fly-to-orbit reach
// the globe replaced, so they are never entered below the ~480 km swap.)
console.log('=== climb and descend across every zoom step ===');
let frames = 0, worstRun = 0, run = 0, prevCuts = 0;
const scales = {};
for (const dir of [1, -1]) {
    for (let k = 0; k < 260; k++) {
        const t = dir > 0 ? k / 260 : 1 - k / 260;
        const alt = 200 + t * t * 300000;
        cam.pos = [-84480 + k * 4000 * dir, alt, 115200 + k * 1500];
        advanceTime(16);
        terrain.update(cam.pos[0], cam.pos[1], cam.pos[2]);
        frames++;
        scales[terrain.cellScale] = (scales[terrain.cellScale] || 0) + 1;
        // Consecutive frames that each re-cut are what locks the window.
        if (cuts > prevCuts) { run++; worstRun = Math.max(worstRun, run); }
        else run = 0;
        prevCuts = cuts;
    }
}
console.log = realLog;

console.log('  frames ' + frames + ', re-cuts ' + cuts +
            ' (one per ' + (frames / Math.max(cuts, 1)).toFixed(0) + ' frames)');
console.log('  longest run of back-to-back re-cut frames: ' + worstRun);
console.log('  cellScale occupancy: ' +
            Object.keys(scales).sort((a, b) => a - b)
                  .map((s) => s + 'x:' + scales[s]).join('  '));

// One re-cut per zoom step per direction, plus drift, is a handful. Dozens
// means the scale is oscillating.
assert(cuts < 30, 'coarse window re-cut ' + cuts + ' times — the scale is thrashing');
assert(worstRun <= 1, 'layer re-uploaded on ' + worstRun + ' consecutive frames');

// And the zoom must actually have exercised its range, or the test proves nothing
// about thresholds it never crossed. Two occupied scales (1 and 2) means the one
// threshold in the clipmap's bounded range was crossed both ways — which is what
// there is to thrash across now.
assert(Object.keys(scales).length >= 2, 'never crossed a zoom step');
console.log('THRASH OK');
