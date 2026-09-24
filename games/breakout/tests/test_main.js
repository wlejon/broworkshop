// Breakout: court rules (serve, paddle angle, bricks, lives, clear) and the
// shell flow (mouse paddle, launch, level clear -> next level, game over).
// Run: scripts/validate.sh games/breakout
import { test, done, check, eq, near, frames, simUntil, press, clickOn, text, shot } from "/lib/kit/test.js";
import { seededRandom } from "/lib/arcade/grid.js";

frames(6);
const G = window.__breakout;
check(G, "__breakout hooks exposed");
const R = G.rules;

const court = () => R.createBreakout(800, 700, seededRandom(3));

test("rules: a fresh court", () => {
    const c = court();
    eq(c.bricks.length, R.BRICK_ROWS * R.BRICK_COLS, "full wall");
    eq(c.bricksAlive, c.bricks.length, "all alive");
    check(c.ball.stuck, "ball waits on the paddle");
    near(c.ball.x, c.paddle.x + c.paddle.w / 2, 1e-9, "ball centred on the paddle");
    eq([c.lives, c.level, c.score], [3, 1, 0], "lives, level, score");
});

test("rules: launch goes up at level speed; the paddle clamps", () => {
    const c = court();
    check(R.launch(c), "launched");
    check(!R.launch(c), "only once");
    check(c.ball.vy < 0, "upward");
    near(Math.hypot(c.ball.vx, c.ball.vy), R.ballSpeed(1), 1e-6, "level-1 speed");
    R.aimPaddle(c, -500);
    eq(c.paddle.x, 0, "left clamp");
    R.nudgePaddle(c, 1, 10000);
    eq(c.paddle.x, 800 - c.paddle.w, "right clamp");
});

test("rules: the paddle edge bends the bounce", () => {
    const c = court();
    R.launch(c);
    const p = c.paddle;
    Object.assign(c.ball, { x: p.x + p.w, y: p.y - 2, vx: 0, vy: 200 });
    R.step(c, 1);
    check(c.ball.vy < 0 && c.ball.vx > 0, "right edge sends it up and right");
    Object.assign(c.ball, { x: p.x + p.w / 2, y: p.y - 2, vx: 0, vy: 200 });
    R.step(c, 1);
    near(c.ball.vx, 0, 1e-6, "centre sends it straight up");
    check(R.drainEvents(c).some((e) => e.type === "paddle"), "paddle event");
});

test("rules: bricks score by row and the last one clears the level", () => {
    const c = court();
    R.launch(c);
    const top = c.bricks[0];
    Object.assign(c.ball, { x: top.x + top.w / 2, y: top.y + top.h + 6, vx: 0, vy: -300 });
    R.step(c, 16);
    check(!top.alive, "top-row brick broke");
    eq(c.score, R.BRICK_POINTS[0], "row 0 is worth 50");
    check(c.ball.vy > 0, "reflected down");
    const ev = R.drainEvents(c).find((e) => e.type === "brick");
    eq(ev && ev.row, 0, "brick event carries the row");

    for (const b of c.bricks) if (b !== c.bricks[1]) b.alive = false;
    c.bricksAlive = 1;
    const last = c.bricks[1];
    Object.assign(c.ball, { x: last.x + last.w / 2, y: last.y + last.h + 6, vx: 0, vy: -300 });
    R.step(c, 16);
    check(R.drainEvents(c).some((e) => e.type === "levelclear"), "levelclear event");
    R.startLevel(c, 2);
    eq([c.level, c.bricksAlive], [2, 66], "level 2 wall");
    check(c.ball.stuck, "ball back on the paddle");
    near(R.ballSpeed(2), R.BASE_BALL_SPEED + R.LEVEL_SPEEDUP, 1e-9, "faster ball");
});

test("rules: dropping the ball costs a life, the third ends the game", () => {
    const c = court();
    for (let i = 0; i < 3; i++) {
        R.launch(c);
        Object.assign(c.ball, { x: 400, y: c.H + 20, vx: 0, vy: 300 });
        R.step(c, 16);
    }
    const types = R.drainEvents(c).map((e) => e.type);
    eq(types.filter((t) => t === "life").length, 3, "three lives lost");
    eq(types[types.length - 1], "gameover", "then game over");
    eq(c.lives, 0, "no lives left");
});

test("shell: play, mouse paddle, launch, pause", () => {
    press("Enter");
    frames(2);
    eq(G.screen, "playing", "Enter plays");
    eq([text("#hud-level"), text("#hud-lives")], ["1", "3"], "HUD level + lives");
    const rect = G.api.view.canvas.getBoundingClientRect();
    mouseMove(rect.left + rect.width * 0.25, rect.top + rect.height / 2);
    frames(2);
    const c = G.run.court;
    near(c.paddle.x + c.paddle.w / 2, G.api.view.width() * 0.25, 2, "mouse centres the paddle");
    press(" ");
    frames(2);
    check(!c.ball.stuck, "Space launches");
    shot("playing");
    press("Escape");
    frames(1);
    eq(G.screen, "pause", "Esc pauses");
    const y = c.ball.y;
    frames(20);
    eq(c.ball.y, y, "ball frozen while paused");
    press("Escape");
    frames(1);
});

test("shell: last brick -> Level Clear -> Next Level", () => {
    const c = G.run.court;
    for (const b of c.bricks) b.alive = false;
    c.bricksAlive = 1;
    c.bricks[0].alive = true;
    const b0 = c.bricks[0];
    Object.assign(c.ball, { stuck: false, x: b0.x + b0.w / 2, y: b0.y + b0.h + 6, vx: 0, vy: -300 });
    check(simUntil(() => G.screen === "levelclear", 1000, 16), "level clear screen");
    check(/Level\s+1 complete/.test(text("#levelclear-stats")), "clear stats");
    shot("levelclear");
    clickOn('#screen-levelclear [data-action="nextlevel"]');
    frames(2);
    eq(G.screen, "playing", "next level plays");
    eq(text("#hud-level"), "2", "HUD level 2");
});

test("shell: losing every ball ends with NEW BEST", () => {
    G.save.set("highScore", 0);
    const c = G.run.court;
    c.score = 120;
    c.lives = 1;
    Object.assign(c.ball, { stuck: false, x: 400, y: c.H + 20, vx: 0, vy: 300 });
    check(simUntil(() => G.screen === "gameover", 1000, 16), "game over");
    const stats = text("#gameover-stats");
    check(/Score\s+120\s+·\s+NEW BEST/.test(stats), "NEW BEST: " + stats);
    eq(G.save.highScore(), 120, "high score saved");
});

done("breakout");
