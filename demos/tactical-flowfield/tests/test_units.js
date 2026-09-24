// The swarm: seeded deploys, arrival in formation, walls, mud, formations.
//
//   scripts/validate.sh demos/tactical-flowfield
import { check, test, done, frames } from "/lib/kit/test.js";
import { COLS, ROWS, TERRAIN, field, paint } from "/app/field.js";
import { swarm, FORMATIONS, deploy, setCount, setFormation, formationOffsets, tickUnits, slotError, unitsInWalls, unitsNear, centroid } from "/app/units.js";
import { loadScenario, placeGoal, refresh } from "/app/lab.js";

frames(10);

/** Step the swarm by hand (the live loop steps it too; this is just faster). */
function run(seconds) { for (let i = 0; i < Math.round(seconds * 60); i++) tickUnits(1 / 60); }

test('deploy is seeded: the same scenario starts the same way', () => {
    loadScenario('choke');
    const a = Array.from(swarm.x.subarray(0, 50));
    loadScenario('choke');
    const b = Array.from(swarm.x.subarray(0, 50));
    check(a.every((v, i) => v === b[i]), 'identical scatter');
    deploy(30, 30, 99);
    check(swarm.x[0] !== a[0], 'another seed scatters differently');
    loadScenario('choke');
    check(unitsInWalls() === 0, 'nobody starts in a wall');
    check(swarm.x.subarray(0, swarm.n).every((v) => v > 1 && v < COLS / 2), 'all start west of the wall');
});

test('formation offsets: right counts, centred box, forward wedge tip', () => {
    for (const f of FORMATIONS) {
        const off = formationOffsets(f, 300, 0, 1.2);
        check(off.length === 300, f + ' count');
        const far = Math.max(...off.map((o) => Math.hypot(o.x, o.y)));
        check(far < 40, `${f} fits (reach ${far.toFixed(1)})`);
    }
    const box = formationOffsets('Box', 400, 0, 1.2);
    const mx = box.reduce((s, o) => s + o.x, 0) / box.length, my = box.reduce((s, o) => s + o.y, 0) / box.length;
    check(Math.abs(mx) < 1 && Math.abs(my) < 1, 'box centred on the goal');
    const wedge = formationOffsets('Wedge', 100, 0, 1.2);
    check(wedge[0].x === 0 && wedge.every((o) => o.x <= 1e-9), 'wedge tip leads, rows trail');
    const turned = formationOffsets('Wedge', 100, Math.PI / 2, 1.2);
    check(turned.every((o) => o.y <= 1e-9), 'facing rotates the formation');
});

test('the swarm crosses the choke and settles into its slots', () => {
    loadScenario('choke');
    const e0 = slotError();
    run(6);
    check(slotError() < e0, `slot error falls ${e0.toFixed(1)} -> ${slotError().toFixed(1)}`);
    run(10);
    check(slotError() < 4, 'settled, slot error ' + slotError().toFixed(2));
    check(centroid().x > COLS / 2 + 10, 'the swarm is past the wall');
    check(unitsInWalls() === 0, 'nobody in a wall');
    check(unitsNear(field.goal.x, field.goal.y, 6) > 20, 'units at the goal');
});

test('every formation settles', () => {
    setCount(300);          // a smaller swarm keeps this test quick
    for (const f of FORMATIONS) {
        loadScenario('clear');
        setFormation(f);
        run(8);
        check(slotError() < 4.5, `${f} slot error ${slotError().toFixed(2)}`);
        check(unitsInWalls() === 0, f + ' walls');
    }
    setFormation('Box');
    setCount(1000);
});

test('unit count: slots follow, and a big swarm stays out of walls', () => {
    loadScenario('choke');
    setCount(3000);
    check(swarm.n === 3000, 'n ' + swarm.n);
    run(4);
    check(unitsInWalls() === 0, 'no wall crossings at 3000');
    setCount(1e9);
    check(swarm.n === 5000, 'clamped high');
    setCount(1);
    check(swarm.n === 10, 'clamped low');
    setCount(1000);
    loadScenario('choke');
});

test('units under a freshly painted wall walk out of it', () => {
    loadScenario('choke');
    const c = centroid();
    paint(c.x, c.y, 4, TERRAIN.WALL);
    refresh();
    check(unitsInWalls() > 5, 'trapped ' + unitsInWalls());
    run(2);
    check(unitsInWalls() === 0, 'still trapped ' + unitsInWalls());
    loadScenario('choke');
});

test('mud slows the swarm', () => {
    const progress = (mud) => {
        loadScenario('clear');
        placeGoal(COLS - 10, ROWS / 2);
        if (mud) { for (let y = 4; y < ROWS - 4; y += 2) paint(40, y, 3.5, TERRAIN.ROUGH); refresh(); }
        const x0 = centroid().x;
        run(4);
        return centroid().x - x0;
    };
    const dry = progress(false), wet = progress(true);
    check(wet < dry * 0.9, `mud: ${dry.toFixed(1)} vs ${wet.toFixed(1)} cells in 4 s`);
    loadScenario('choke');
});

done('tactical-flowfield units');
