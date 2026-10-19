// wilds: a world kilometres across, planted with the nursery, flown on
// fixed routes. Run: scripts/validate.sh demos/wilds (km=1 keeps it quick:
// WILDS_KM=1).
import { check, eq, test, done, frames } from "/lib/kit/test.js";
import { world, HALF, ROUTES, routeAt, groundHeight, forestStats, fly, flight } from "/app/world.js";

frames(2);

test('the world is planted: every part, grass and the ground tiles', () => {
    eq(world.parts.length, 4, 'broadleaf, needle, scale, shrub nodes');
    for (const p of world.parts) check(p.trees.length / 8 > 50, `${p.name}: ${p.trees.length / 8} planted`);
    check(world.grass, 'the grass node');
    eq(world.tiles.length, (2 * HALF / 250) ** 2, 'a tile every 250 m');
    const s = forestStats();
    check(s.treeCount === world.stats.trees, 'the nodes hold every tree: ' + s.treeCount);
});

test('every route keeps the eye over the ground, inside the world', () => {
    for (const key of Object.keys(ROUTES)) for (const t of [0, 7, 31]) {
        const { eye, look } = routeAt(key, t);
        check(eye.every(Number.isFinite) && look.every(Number.isFinite), `${key} at ${t} s is finite`);
        check(eye[1] >= groundHeight(eye[0], eye[2]) + 1.5, `${key} at ${t} s above the ground`);
        check(Math.abs(eye[0]) <= HALF && Math.abs(eye[2]) <= HALF, `${key} at ${t} s inside the world`);
    }
});

test('flying a route draws trees', () => {
    fly('cruise', 0);
    flight.speed = 1;
    frames(10);
    check(forestStats().vertices > 0, 'vertices drawn');
});

done();
