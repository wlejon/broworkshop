// The lab's building stands with no bodies, is holed by what is thrown at it,
// and comes down when its ground storey is taken out.
//
//   scripts/validate.sh demos/wrecking-lab
import { check, test, done, frames, shot } from "/lib/kit/test.js";
import { lab, rebuild, launch } from "/app/lab.js";

advanceTime(100);
const counts = () => lab.structure.counts;

test('the tower stands, and costs the world nothing', () => {
    frames(30);
    const c = counts();
    check(c.cells > 2000, c.cells + ' cells');
    check(c.standing === c.cells, 'all standing: ' + c.standing + ' of ' + c.cells);
    check(lab.world.counts.bodies === 1, 'only the ground is a body: ' + lab.world.counts.bodies);
});
shot('standing');

test('a wrecking ball at 30 m/s holes the facade', () => {
    const before = counts().standing;
    const ball = launch('wrecker', [3, 24, 40], [0, 0, -30]);
    frames(50);
    shot('holed-early');
    frames(70);
    const c = counts();
    check(c.standing < before, 'cells came loose: ' + (before - c.standing));
    check(c.standing > before * 0.8, 'the tower still stands: ' + c.standing + ' of ' + before);
    check(lab.world.pose(ball)[2] < 30, 'the ball went in: z ' + lab.world.pose(ball)[2].toFixed(1));
});
shot('holed');

test('a 60 t slab through the ground storey brings it down', () => {
    rebuild('tower');
    frames(5);
    const all = counts().cells;
    launch('truck', [-22, 2.4, 0], [40, 0, 0]);
    frames(60);
    shot('falling-1');
    frames(60);
    shot('falling-2');
    frames(120);
    shot('falling-3');
    frames(240);
    const c = counts();
    check(c.standing < all * 0.5, 'most of it fell: ' + c.standing + ' of ' + all + ' standing');
});
shot('down');

done('wrecking-lab');
