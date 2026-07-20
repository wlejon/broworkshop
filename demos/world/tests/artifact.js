// Reproduce the shingled/banded overlay seen on close mountainsides, and
// bisect it: shadows on vs off.
import { cam, terrain, sun, ready } from '/app/app.js';

for (let i = 0; i < 900; i++) { wallSleep(100); advanceTime(16); if (ready()) break; }
assert(ready(), 'terrain never became ready');

// The vantage from the close-up screenshot.
cam.pos = [-75570, 3063, 103510];
cam.vel = [0, 0, 0];
cam.rot = Camera.quatNorm(Camera.quatMul(
    Camera.quatFromAxis(0, 1, 0, 2.6),
    Camera.quatFromAxis(1, 0, 0, -0.30)));

const settle = (n) => { for (let i = 0; i < (n || 90); i++) advanceTime(16); };

settle();
screenshot('artifact-shadows-on.png');
console.log('shadows ON  -> artifact-shadows-on.png');

sun.castsShadow = false;
settle();
screenshot('artifact-shadows-off.png');
console.log('shadows OFF -> artifact-shadows-off.png');

sun.castsShadow = true;
sun.cascadeCount = 1;
settle();
screenshot('artifact-one-cascade.png');
console.log('one cascade -> artifact-one-cascade.png');

console.log('ARTIFACT OK');
