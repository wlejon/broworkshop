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
    // Level 4's cells are about 20 km: under 2 px on a 1080p screen.
    check(planet.stats.visible > 0 && planet.stats.visible < 600 && deepest() <= 5,
          `drawn ${planet.stats.visible}, deepest level ${deepest()}`);
});

test('descending refines what is seen, within the cache', () => {
    planet.cam.alt = 3000;
    planet.cam.pitch = -12;
    settle();
    check(deepest() >= 14, `deepest level near the ground: ${deepest()}`);
    check(planet.cache.pending === 0 && planet.cache.resident <= planet.cache.capacity,
          `what is seen settles within the cache (${planet.cache.resident} resident, ${planet.cache.pending} pending)`);
});

done('planet smoke');
