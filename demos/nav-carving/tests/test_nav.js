// The surface and the planner: a tiled bake carved by three obstacles, and
// routes that switch between walking, ladder, jump and lift as they toggle.
//
//   scripts/validate.sh demos/nav-carving
import { check, test, done } from "/lib/kit/test.js";
import { TARGETS, LINKS, OBSTACLES, DOOR, BRIDGE, LANDINGS } from "/app/level.js";
import { navState, generation, walkableAt, findRoute } from "/app/nav.js";
import { plan, linksOf, planStats } from "/app/plan.js";
import { doors, setDoor } from "/app/lab.js";

advanceTime(100);
const mesh = () => navState.mesh;
const SOUTH = TARGETS.south;

test('one tiled bake from the physics, booted with the gate and barricade carved', () => {
    check(mesh() && mesh().valid && mesh().supportsObstacles, navState.lastError);
    check(navState.handles.gate > 0 && navState.handles.barricade > 0 && !navState.handles.bridge, JSON.stringify(navState.handles));
    check(mesh().obstacleCount === 2, 'obstacleCount ' + mesh().obstacleCount);
    for (const def of LINKS) {
        check(walkableAt(def.start) && walkableAt(def.end), def.id + ' endpoints are on the surface');
    }
    LANDINGS.forEach((p, i) => check(walkableAt(p), 'lift landing F' + i + ' on the surface'));
    let threw = false;
    try {
        bro.ai.game.bakeNavMesh({ fromPhysics: Physics, dynamicObstacles: true,
            offMeshLinks: [{ start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } }] });
    } catch (e) { threw = /offMeshLinks/.test(e.message); }
    check(threw, 'bakeNavMesh refuses links on a tiled bake (why the links live in plan.js)');
});

test('the closed gate carves the doorway; the vault is unreachable', () => {
    check(!walkableAt({ x: DOOR.x, y: 0, z: DOOR.z }), 'doorway carved');
    check(!findRoute(SOUTH, TARGETS.vault, true), 'no full path');
    const p = plan(SOUTH, TARGETS.vault);
    check(p.partial && p.legs.length === 1, 'partial single walk leg');
    const end = p.legs[0].route.points.at(-1);
    check(end.z > DOOR.z, 'clamped on the south side at z ' + end.z.toFixed(2));
});

test('the barricade makes the mezzanine lift-only; lifting it opens the ramp', () => {
    const viaLift = plan(SOUTH, TARGETS.mezz);
    check(!viaLift.partial && linksOf(viaLift).join() === 'lift', 'links ' + linksOf(viaLift));
    check(viaLift.legs.find((l) => l.kind === 'lift').fromFloor === 0, 'boards at F0');
    const gen = generation();
    setDoor('barricade', false);
    check(generation() > gen && !navState.handles.barricade, 'barricade removed, generation moved');
    const viaRamp = plan(SOUTH, TARGETS.mezz);
    check(linksOf(viaRamp).length === 0 && viaRamp.legs[0].route.rise > 3, 'walks the ramp: rise ' + viaRamp.legs[0].route.rise.toFixed(2));
    check(viaRamp.cost < viaLift.cost, `${viaRamp.cost.toFixed(1)} s < ${viaLift.cost.toFixed(1)} s`);
    setDoor('barricade', true);
    check(linksOf(plan(SOUTH, TARGETS.mezz)).join() === 'lift', 'back to the lift');
});

test('mezzanine to roof takes the ladder', () => {
    const p = plan(TARGETS.mezz, TARGETS.roof);
    check(!p.partial && linksOf(p).join() === 'ladder', 'links ' + linksOf(p));
});

test('the bridge carries the island route; retracted, the planner jumps', () => {
    const walk = plan(TARGETS.roof, TARGETS.island);
    check(!walk.partial && linksOf(walk).length === 0, 'walks the bridge: ' + linksOf(walk));
    const mid = { x: (BRIDGE.x0 + BRIDGE.x1) / 2, y: 7, z: BRIDGE.z };
    check(walkableAt(mid), 'bridge span walkable');
    setDoor('bridge', false);   // retracting blocks at once
    check(navState.handles.bridge > 0 && !walkableAt(mid), 'bridge span carved');
    const jump = plan(TARGETS.roof, TARGETS.island);
    check(!jump.partial && linksOf(jump).join() === 'jump', 'links ' + linksOf(jump));
    check(walkableAt({ x: -1.5, y: 7, z: 2 }) && walkableAt(TARGETS.island), 'roof and island themselves untouched');
    setDoor('bridge', true);
    advanceTime(1500);          // extends, then releases the carve
    check(doors.bridge.p === 1 && !navState.handles.bridge && walkableAt(mid), 'bridge back');
});

test('from the ground to the island: lift, then walk (or jump)', () => {
    const p = plan(SOUTH, TARGETS.island);
    check(!p.partial && linksOf(p).join() === 'lift', 'links ' + linksOf(p));
    check(p.legs.find((l) => l.kind === 'lift').toFloor === 2, 'rides to the roof');
});

test('opening the gate reopens the vault only once it is clear', () => {
    setDoor('gate', true);
    check(navState.handles.gate > 0, 'still carved while the gate slides');
    advanceTime(1500);
    check(doors.gate.p === 1 && !navState.handles.gate, 'released when open');
    check(walkableAt({ x: DOOR.x, y: 0, z: DOOR.z }), 'doorway walkable');
    const p = plan(SOUTH, TARGETS.vault);
    check(!p.partial && linksOf(p).length === 0, 'walks through');
    setDoor('gate', false);
    check(navState.handles.gate > 0 && plan(SOUTH, TARGETS.vault).partial, 'closing blocks at once');
});

test('walk edges between link endpoints are cached per generation', () => {
    const before = planStats.cacheHits;
    plan(SOUTH, TARGETS.roof);
    check(planStats.cacheHits > before, 'cache used');
    check(OBSTACLES.gate && typeof planStats.walkQueries === 'number', 'stats readable');
});

done('nav-carving nav');
