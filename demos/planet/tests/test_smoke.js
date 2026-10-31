// Planet — boots, fills its tile cache, and refines as the camera descends.
//   Run: scripts/validate.sh demos/planet
import { check, frames, test, done } from "/lib/kit/test.js";

// Production spends the gap 360 fps frames leave (about a millisecond), so
// a jump from orbit to 3 km takes a few hundred frames to refine. A level's
// children are wanted only once it is ready, so nothing may be pending for a
// frame between levels: settled is eight frames running with none.
const settle = () => {
    for (let i = 0, quiet = 0; i < 800 && quiet < 8; i++) {
        frames(1);
        quiet = i >= 4 && planet.cache.pending === 0 ? quiet + 1 : 0;
    }
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
