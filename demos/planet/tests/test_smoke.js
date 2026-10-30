// Planet — boots, fills its tile cache, and refines as the camera descends.
//   Run: scripts/validate.sh demos/planet
import { check, frames, test, done } from "/lib/kit/test.js";

const settle = () => {
    for (let i = 0; i < 200 && (i < 4 || planet.cache.pending > 0); i++) frames(1);
};
const deepest = () => Math.max(...planet.cache.drawn.map((t) => t.level));

test('from orbit the planet is a handful of coarse tiles', () => {
    settle();
    check(planet.cache.pending === 0, `the cache settles (${planet.cache.pending} pending)`);
    check(planet.stats.visible > 0 && deepest() <= 2, `drawn ${planet.stats.visible}, deepest level ${deepest()}`);
});

test('descending refines what is seen, within the cache', () => {
    planet.cam.alt = 3000;
    planet.cam.pitch = -12;
    settle();
    check(deepest() >= 14, `deepest level near the ground: ${deepest()}`);
    check(planet.cache.resident < planet.cache.capacity, `the frustum keeps it under capacity (${planet.cache.resident})`);
});

done('planet smoke');
