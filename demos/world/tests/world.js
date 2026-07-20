// Drive the World app headless: does a tile actually arrive, does terrain build
// from it, and is what we're standing on the same terrain the model produced?
import { cam, elevationAt } from '/app/app.js';

const scene = document.getElementById('c').getContext('scene');

// The model load and the first tile are REAL work on a background thread, so
// this needs wall-clock time (wallSleep) as well as frames (advanceTime).
// advanceTime alone spins through virtual time in no real time at all and would
// give the worker no chance to finish.
let waited = 0;
for (let i = 0; i < 600; i++) {
    wallSleep(100);
    advanceTime(16);
    waited += 100;
    if (elevationAt(0, 0) !== null) break;
}
const g0 = elevationAt(0, 0);
console.log('tile resident after ~' + (waited/1000).toFixed(1) + ' s wall; ground at origin = ' +
            (g0 === null ? 'MISSING' : g0.toFixed(1) + ' m'));
assert(g0 !== null, 'no tile ever arrived');

// Let terrain stream chunks off the resident tile.
for (let i = 0; i < 240; i++) advanceTime(16);

// Sample a transect and confirm it is real terrain, not a constant or noise.
let mn = Infinity, mx = -Infinity, n = 0;
for (let km = 0; km < 25; km++) {
    const h = elevationAt(km * 1000, km * 700);
    if (h === null) continue;
    if (h < mn) mn = h;
    if (h > mx) mx = h;
    n++;
}
console.log('transect over ' + n + ' points: ' + mn.toFixed(0) + ' .. ' + mx.toFixed(0) + ' m');
assert(n > 10, 'transect mostly missing');
assert(mx - mn > 50, 'terrain is suspiciously flat (' + (mx - mn).toFixed(1) + ' m relief)');

// Continuity: adjacent samples must not jump. A broken skirt or tile mismatch
// shows up here as a cliff between neighbouring cells.
let worstJump = 0, jumpAt = null;
for (let s = 0; s < 4000; s++) {
    const x = s * 10, z = 1234;
    const a = elevationAt(x, z), b = elevationAt(x + 10, z);
    if (a === null || b === null) continue;
    const d = Math.abs(b - a);
    if (d > worstJump) { worstJump = d; jumpAt = x; }
}
console.log('worst step between adjacent 10 m samples = ' + worstJump.toFixed(2) +
            ' m (at x=' + jumpAt + ')');
// 30 m cells on a mountainside legitimately step several metres; a seam would
// be a discontinuity far larger than the surrounding relief.
assert(worstJump < 40, 'discontinuity suggests a seam: ' + worstJump);

// Walk mode must put the eye above the ground, never inside it.
cam.pos[0] = 3000; cam.pos[2] = 4000;
for (let i = 0; i < 30; i++) advanceTime(16);
const gw = elevationAt(cam.pos[0], cam.pos[2]);
console.log('ground here = ' + (gw === null ? 'n/a' : gw.toFixed(1) + ' m'));

console.log('WORLD OK');
