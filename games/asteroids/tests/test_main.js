// Asteroids: rules (wrap, firing limits, splitting, extra life, death and
// respawn, waves) and the shell flow (title backdrop, play, thrust, fire,
// mouse steering, pause, game over).
// Run: scripts/validate.sh games/asteroids
import { test, done, check, eq, near, frames, simUntil, press, text, shot } from "/lib/kit/test.js";
import { seededRandom } from "/lib/arcade/random.js";

frames(6);
const G = window.__asteroids;
check(G, "__asteroids hooks exposed");
const R = G.rules;

const IDLE = { left: false, right: false, thrust: false, fire: false, aim: null };
const field = () => R.createAsteroids(900, 800, seededRandom(5));
const types = (f) => R.drainEvents(f).map((e) => e.type);

test("rules: wave 1 keeps rocks clear of the ship", () => {
    const f = field();
    eq(f.wave, 1, "wave 1");
    eq(f.rocks.length, 4, "3 + wave rocks");
    for (const a of f.rocks) check(R.wrapDistSq(a.x, a.y, f.ship.x, f.ship.y, f.W, f.H) >= 180 * 180, "safe spawn");
    eq(R.wrap(-5, 100), 95, "wrap below");
    eq(R.wrap(105, 100), 5, "wrap above");
    eq(R.wrapDistSq(1, 0, 99, 0, 100, 100), 4, "distance across the seam");
});

test("rules: firing is capped by cooldown and bullets in flight", () => {
    const f = field();
    check(R.fire(f), "first shot");
    check(!R.fire(f), "cooldown");
    for (let i = 0; i < 10; i++) { f.cooldown = 0; R.fire(f); }
    eq(f.bullets.length, R.MAX_BULLETS, "max 5 in flight");
    R.step(f, R.BULLET_LIFE + 1, IDLE);
    eq(f.bullets.length, 0, "bullets expire");
});

test("rules: rocks split large -> medium -> small -> dust", () => {
    const f = field();
    f.rocks = [R.makeRock(f, 100, 100, "large")];
    R.breakRock(f, f.rocks.pop(), 0, 0);
    eq(f.rocks.map((a) => a.size), ["medium", "medium"], "two mediums");
    R.breakRock(f, f.rocks.pop(), 0, 0);
    eq(f.rocks.filter((a) => a.size === "small").length, 2, "two smalls");
    const before = f.rocks.length;
    R.breakRock(f, f.rocks.pop(), 0, 0);
    eq(f.rocks.length, before - 1, "small is dust");
    eq(f.score, 20 + 50 + 100, "size scores");
});

test("rules: every 10,000 points is a life", () => {
    const f = field();
    f.score = R.EXTRA_LIFE_AT - 20;
    R.breakRock(f, R.makeRock(f, 0, 0, "large"), 0, 0);
    eq(f.lives, 4, "extra life");
    eq(f.nextExtraLife, R.EXTRA_LIFE_AT * 2, "next threshold");
    check(types(f).includes("extralife"), "event");
});

test("rules: thrust accelerates up to the cap; the nose steers", () => {
    const f = field();
    f.rocks = [];
    f.rocks.push(R.makeRock(f, 10, 10, "small"));    // keep the wave from advancing
    const s = f.ship;
    R.step(f, 5000, Object.assign({}, IDLE, { thrust: true }));
    check(Math.hypot(s.vx, s.vy) <= R.SHIP_MAX_SPEED + 1e-9, "speed capped");
    check(s.vy < 0, "thrusting along the nose (up)");
    const a0 = s.angle;
    R.step(f, 100, Object.assign({}, IDLE, { right: true }));
    near(s.angle - a0, R.SHIP_ROT_SPEED * 100, 1e-9, "rotates right");
});

test("rules: a collision costs a life, then a safe respawn with shields", () => {
    const f = field();
    f.invuln = 0;
    f.rocks = [R.makeRock(f, f.ship.x, f.ship.y, "small")];
    f.rocks.push(R.makeRock(f, 5, 5, "small"));
    R.step(f, 16, IDLE);
    check(!f.ship.alive, "ship destroyed");
    eq(f.lives, 2, "life lost");
    check(types(f).includes("shipexplode"), "explode event");
    f.rocks = [R.makeRock(f, 5, 5, "small")];
    R.step(f, R.RESPAWN_DELAY + 16, IDLE);
    check(f.ship.alive, "respawned");
    check(f.invuln > 0, "spawn shield");
});

test("rules: clearing the field starts the next wave; the last life ends it", () => {
    const f = field();
    f.rocks = [];
    R.step(f, 16, IDLE);
    eq([f.wave, f.rocks.length], [2, 5], "wave 2 with 5 rocks");
    f.lives = 1;
    f.invuln = 0;
    f.rocks.push(R.makeRock(f, f.ship.x, f.ship.y, "large"));
    R.step(f, 16, IDLE);
    check(f.over, "game over");
});

test("shell: title backdrop, play, thrust, fire, pause", () => {
    frames(5);
    shot("title");
    press("Enter");
    frames(2);
    eq(G.screen, "playing", "Enter plays");
    const s = G.run.field.ship;
    keyDown(0x40000052);          // ArrowUp held
    frames(20);
    keyUp(0x40000052);
    check(s.vy < 0, "Up thrusts");
    press(" ");
    frames(1);
    check(G.run.field.bullets.length > 0 || G.run.score > 0, "Space fires");
    shot("playing");
    press("Escape");
    frames(1);
    eq(G.screen, "pause", "paused");
    press("Escape");
    frames(1);
});

test("shell: last life -> game over with NEW BEST", () => {
    G.save.set("highScore", 0);
    const f = G.run.field;
    f.score = 70;
    f.lives = 1;
    f.invuln = 0;
    f.rocks.push(R.makeRock(f, f.ship.x, f.ship.y, "large"));
    check(simUntil(() => G.screen === "gameover", 1000, 16), "game over");
    check(/Score\s+\d+\s+·\s+NEW BEST/.test(text("#gameover-stats")), "NEW BEST: " + text("#gameover-stats"));
});

done("asteroids");
