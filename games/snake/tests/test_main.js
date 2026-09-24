// Snake: rules (turning, eating, growth, speed, collisions) and the shell
// flow (title -> play -> pause -> game over with NEW BEST).
// Run: scripts/validate.sh games/snake
import { test, done, check, eq, frames, simUntil, press, text, shot } from "/lib/kit/test.js";
import { seededRandom } from "/lib/arcade/grid.js";

frames(6);
const G = window.__snake;
check(G, "__snake hooks exposed");
const R = G.rules;

/** A board with the snake laid out on `cells` heading `dir`, food parked out of the way. */
function boardWith(cells, dir) {
    const b = R.createSnake(seededRandom(7));
    b.snake = cells.map(([x, y]) => ({ x, y }));
    b.dir = b.nextDir = R.DIRS[dir];
    b.food = { x: 0, y: 0 };
    return b;
}

test("rules: fresh board", () => {
    const b = R.createSnake(seededRandom(1));
    eq(b.snake.length, R.START_LENGTH, "starts 3 long");
    eq(b.snake[0], { x: 14, y: 11 }, "head at the centre");
    check(!R.onSnake(b, b.food.x, b.food.y), "food not on the snake");
    eq(b.interval, R.TICK_MAX, "starts slow");
});

test("rules: turns buffer, reverses are refused", () => {
    const b = boardWith([[5, 5], [4, 5], [3, 5]], "right");
    R.turn(b, R.DIRS.left);
    eq(b.nextDir, R.DIRS.right, "reverse ignored");
    R.turn(b, R.DIRS.up);
    R.step(b);
    eq(b.snake[0], { x: 5, y: 4 }, "turned up on the next step");
    eq(b.snake.length, 3, "no growth without food");
});

test("rules: eating scores, grows by one and speeds up", () => {
    const b = boardWith([[5, 5], [4, 5], [3, 5]], "right");
    b.food = { x: 6, y: 5 };
    R.step(b);
    eq(b.score, R.POINTS, "10 points");
    eq(b.snake.length, 4, "grew");
    check(b.interval < R.TICK_MAX, "faster after eating");
    eq(R.drainEvents(b).map((e) => e.type), ["eat"], "eat event");
    check(!R.onSnake(b, b.food.x, b.food.y), "new food placed off the snake");
    eq(Math.round(R.stepInterval(R.START_LENGTH + R.RAMP_LENGTH)), R.TICK_MIN, "full speed after the ramp");
});

test("rules: walls and the body kill, the vacating tail does not", () => {
    const wall = boardWith([[R.COLS - 1, 3], [R.COLS - 2, 3], [R.COLS - 3, 3]], "right");
    R.step(wall);
    check(!wall.alive, "wall kills");
    eq(R.drainEvents(wall).map((e) => e.type), ["die"], "die event");

    // A 2x2 loop: the head moves into the cell the tail leaves this step.
    const loop = boardWith([[5, 5], [5, 6], [6, 6], [6, 5]], "down");
    loop.dir = loop.nextDir = R.DIRS.right;
    R.step(loop);
    check(loop.alive, "chasing the tail is safe");

    const bite = boardWith([[5, 5], [5, 6], [6, 6], [6, 5], [6, 4]], "left");
    bite.dir = bite.nextDir = R.DIRS.right;
    R.step(bite);
    check(!bite.alive, "running into the body kills");
});

test("rules: advance steps once per interval", () => {
    const b = boardWith([[5, 5], [4, 5], [3, 5]], "right");
    R.advance(b, R.TICK_MAX - 1);
    eq(b.snake[0].x, 5, "not yet");
    R.advance(b, 1);
    eq(b.snake[0].x, 6, "one step");
    R.advance(b, R.TICK_MAX * 3);
    eq(b.snake[0].x, 9, "three more");
});

test("shell: title, play, pause", () => {
    check(G.screen === "title", "boots to the title");
    press("Enter");
    frames(2);
    eq(G.screen, "playing", "Enter plays");
    eq(text("#hud-length"), "3", "HUD length");
    shot("playing");
    press("Escape");
    frames(1);
    eq(G.screen, "pause", "Esc pauses");
    const head = Object.assign({}, G.run.board.snake[0]);
    frames(30);
    eq(G.run.board.snake[0], head, "paused board does not move");
    press("Escape");
    frames(1);
    eq(G.screen, "playing", "Esc resumes");
});

test("shell: eating shows in the HUD, the wall ends the run with NEW BEST", () => {
    G.save.set("highScore", 0);
    const b = G.run.board;
    const head = b.snake[0];
    b.food = { x: head.x + b.dir.x, y: head.y + b.dir.y };
    check(simUntil(() => b.score > 0, 1000, 16), "ate the food");
    frames(1);
    eq(text("#hud-score"), "10", "HUD score");
    eq(text("#hud-length"), "4", "HUD length grew");
    check(simUntil(() => G.screen === "gameover", 8000, 16), "ran into the wall");
    const stats = text("#gameover-stats");
    check(/Score\s+10\s+·\s+NEW BEST/.test(stats), "NEW BEST on the game-over screen: " + stats);
    check(/Length\s+4/.test(stats), "length on the game-over screen");
    eq(G.save.highScore(), 10, "high score saved");
    shot("gameover");
});

done("snake");
