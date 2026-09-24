// Invaders: rules (firing, kills + march speed-up, shields, UFO, death and
// lives, waves) and the shell flow (play, move, fire, pause, game over).
// Run: scripts/validate.sh games/invaders
import { test, done, check, eq, frames, simUntil, press, text, shot } from "/lib/kit/test.js";
import { seededRandom } from "/lib/arcade/random.js";

frames(6);
const G = window.__invaders;
check(G, "__invaders hooks exposed");
const R = G.rules;

const NONE = { left: false, right: false, fire: false };
const FIRE = { left: false, right: false, fire: true };
const field = () => R.createInvaders(800, 800, seededRandom(11));
const types = (f) => R.drainEvents(f).map((e) => e.type);

test("rules: a fresh field", () => {
    const f = field();
    eq(f.enemies.length, R.ROWS * R.COLS, "55 invaders");
    eq(f.enemies.filter((e) => e.type === 0).length, R.COLS, "one back row");
    eq(f.shields.length, R.SHIELD_COUNT, "four shields");
    eq([f.lives, f.wave, f.score], [3, 1, 0], "lives, wave, score");
});

test("rules: one shot at a time; a kill scores and speeds the march", () => {
    const f = field();
    check(R.fire(f), "fired");
    check(!R.fire(f), "second shot refused while the first flies");
    const target = f.enemies[f.enemies.length - 1];     // front row, bottom right
    f.bullet = { x: target.x + 4, y: target.y + 4, vy: -560 };
    const before = f.stepInterval;
    R.step(f, 1, NONE);
    check(!target.alive, "invader killed");
    eq(f.score, R.POINTS[2], "front row is worth 10");
    check(f.stepInterval < before, "march speeds up");
    check(types(f).includes("kill"), "kill event");
});

test("rules: shields crater under fire", () => {
    const f = field();
    const s = f.shields[0];
    const x = s.x + R.SHIELD_W / 2, y = s.y + R.SHIELD_H / 2;
    check(R.shieldHit(f, x, y), "solid hit");
    const c = Math.floor(R.SHIELD_COLS / 2), r = Math.floor(R.SHIELD_ROWS / 2);
    check(!s.grid[r][c], "cell carved");
    check(!R.shieldHit(f, x, y), "the crater lets the next shot through");
});

test("rules: the UFO pays out", () => {
    const f = field();
    f.ufo = { x: 300, y: 70, vx: 140, points: 150 };
    f.bullet = { x: 310, y: 80, vy: -560 };
    R.step(f, 1, NONE);
    eq(f.score, 150, "UFO points");
    check(!f.ufo, "UFO gone");
});

test("rules: an enemy bullet costs a life after the death timer", () => {
    const f = field();
    const p = f.player;
    f.enemyBullets.push({ x: p.x + 10, y: p.y + 5, vy: 0 });
    R.step(f, 16, NONE);
    eq(f.phase, "dying", "dying");
    check(types(f).includes("die"), "die event");
    R.step(f, R.DIE_MS, NONE);
    eq([f.phase, f.lives], ["playing", 2], "respawned with 2 lives");
    f.lives = 1;
    f.enemyBullets.push({ x: p.x + 10, y: p.y + 5, vy: 0 });
    R.step(f, 16, NONE);
    R.step(f, R.DIE_MS, NONE);
    eq(f.phase, "over", "last life ends it");
    check(types(f).includes("gameover"), "gameover event");
});

test("rules: invaders reaching the line end the game at once", () => {
    const f = field();
    for (const e of f.enemies) e.y = f.player.y - R.ENEMY_H;
    f.stepTimer = f.stepInterval;
    R.step(f, 1, NONE);
    eq([f.phase, f.lives], ["dying", 0], "no lives left");
});

test("rules: clearing the formation starts the next wave", () => {
    const f = field();
    for (const e of f.enemies) e.alive = false;
    R.step(f, 1, NONE);
    eq(f.wave, 2, "wave 2");
    eq(R.aliveCount(f), R.ROWS * R.COLS, "fresh formation");
    check(f.enemies[0].y > 100, "starts lower");
});

test("shell: play, move, fire, pause", () => {
    press("Enter");
    frames(2);
    eq(G.screen, "playing", "Enter plays");
    const f = G.run.field;
    const x0 = f.player.x;
    keyDown(0x4000004f);      // ArrowRight held
    frames(10);
    keyUp(0x4000004f);
    frames(1);
    check(f.player.x > x0, "right arrow moves the cannon");
    press(" ");
    frames(1);
    check(f.bullet || f.score > 0, "Space fires");
    shot("playing");
    press("Escape");
    frames(1);
    eq(G.screen, "pause", "Esc pauses");
    const march = f.enemies[0].x;
    frames(60);
    eq(f.enemies[0].x, march, "formation frozen while paused");
    press("Escape");
    frames(1);
    eq(G.screen, "playing", "resumed");
});

test("shell: last life -> game over with NEW BEST", () => {
    G.save.set("highScore", 0);
    const f = G.run.field;
    f.score = 90;
    f.lives = 1;
    f.enemyBullets.push({ x: f.player.x + 10, y: f.player.y + 5, vy: 0 });
    check(simUntil(() => G.screen === "gameover", 3000, 16), "game over");
    const stats = text("#gameover-stats");
    check(/Score\s+9\d\s+·\s+NEW BEST/.test(stats), "NEW BEST: " + stats);
    check(/Wave\s+1/.test(stats), "wave shown");
});

done("invaders");
