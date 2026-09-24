// Chomper: rules (movement, turns, pellets, power pellets, ghost chains,
// deaths, level clear) and the shell flow (play, pause, level clear screen,
// game over with NEW BEST).
// Run: scripts/validate.sh games/chomper
import { test, done, check, eq, near, frames, simUntil, press, text, shot } from "/lib/kit/test.js";
import { seededRandom } from "/lib/arcade/grid.js";

frames(6);
const G = window.__chomper;
check(G, "__chomper hooks exposed");
const R = G.rules, M = G.maze;

/** A game with the ghosts parked in the house for good. */
function calm() {
    const g = R.createChomper(seededRandom(2));
    for (const gh of g.ghosts) gh.houseTimer = 1e9;
    return g;
}
function run(g, ms, turn = -1) {
    for (let t = 0; t < ms; t += 16) R.step(g, 16, t === 0 ? turn : -1);
}

test("rules: fresh level", () => {
    const g = R.createChomper(seededRandom(1));
    eq([g.lives, g.level, g.score], [3, 1, 0], "3 lives, level 1");
    eq(g.maze.pellets, g.maze.total, "every pellet in place");
    check(g.maze.total > 200, "a full maze");
    eq(g.ghosts.map((x) => x.mode), ["house", "house", "house", "house"], "ghosts home");
});

test("rules: moving eats pellets, walls stop him", () => {
    const g = calm();
    run(g, 500);
    check(g.pac.c < M.PAC_SPAWN.c - 2, "heads left from the spawn");
    check(g.score >= 2 * R.PELLET_POINTS, "ate pellets on the way: " + g.score);
    run(g, 4000);
    const at = g.pac.c;
    run(g, 300);
    eq(g.pac.c, at, "stopped against the wall");
    eq(Math.round(g.pac.r), 23, "same row");
});

test("rules: turns wait for an opening", () => {
    const g = calm();
    run(g, 16, 2);                                 // up is walled at the spawn
    eq(g.pac.dir, 1, "still heading left");
    eq(g.pac.nextDir, 2, "turn buffered");
    for (let t = 0; t < 3000 && g.pac.dir !== 2; t += 16) R.step(g, 16);
    eq(g.pac.dir, 2, "turned up at the first opening");
    near(g.pac.c, Math.round(g.pac.c), 1e-9, "turned on a tile centre");
});

test("rules: a power pellet frightens, ghosts chain 200 400 800 1600", () => {
    const g = calm();
    for (const gh of g.ghosts) { gh.mode = "chase"; gh.c = 20; gh.r = 5; }
    g.maze.grid[23][12] = "o";
    run(g, 300);
    check(g.ghosts.every((x) => x.mode === "frightened"), "all frightened");
    const before = g.score;
    for (const gh of g.ghosts) { gh.c = g.pac.c; gh.r = g.pac.r; }
    R.step(g, 1);
    eq(g.score - before, 200 + 400 + 800 + 1600, "chain bonus");
    eq(R.drainEvents(g).filter((e) => e.type === "eatghost").map((e) => e.points), [200, 400, 800, 1600], "events");
    check(g.ghosts.every((x) => x.mode === "eaten"), "eyes head home");
    eq(R.frightMs(1), 8000, "8 s at level 1");
    eq(R.frightMs(20), 3000, "3 s floor");
});

test("rules: a ghost costs a life, the last life ends it", () => {
    const g = calm();
    g.lives = 1;
    const gh = g.ghosts[0];
    gh.mode = "chase";
    gh.c = g.pac.c; gh.r = g.pac.r;
    R.step(g, 1);
    eq([g.phase, g.lives], ["dying", 0], "caught");
    run(g, R.DIE_MS + 100);
    eq(g.phase, "over", "game over");
    check(R.drainEvents(g).some((e) => e.type === "gameover"), "gameover event");
});

test("rules: the last pellet clears the level", () => {
    const g = calm();
    for (const row of g.maze.grid) for (let c = 0; c < row.length; c++) if (row[c] === "." || row[c] === "o") row[c] = " ";
    g.maze.pellets = 1;
    g.maze.grid[23][12] = ".";
    run(g, 300);
    eq(g.phase, "cleared", "cleared");
    R.nextLevel(g);
    eq([g.level, g.phase, g.maze.pellets], [2, "playing", g.maze.total], "level 2, fresh maze");
});

test("shell: title, play, pause", () => {
    check(G.screen === "title", "boots to the title");
    shot("title");
    press("Enter");
    frames(2);
    eq(G.screen, "playing", "Enter plays");
    eq(text("#hud-lives"), "3", "HUD lives");
    frames(60);
    check(G.run.score > 0, "chomping");
    shot("playing");
    press("Escape");
    frames(1);
    eq(G.screen, "pause", "Esc pauses");
    const c = G.run.game.pac.c;
    frames(30);
    eq(G.run.game.pac.c, c, "paused");
    press("Escape");
    frames(1);
    eq(G.screen, "playing", "Esc resumes");
});

test("shell: level clear screen, then game over with NEW BEST", () => {
    G.save.set("highScore", 0);
    const g = G.run.game;
    for (const row of g.maze.grid) for (let c = 0; c < row.length; c++) if (row[c] === ".") row[c] = " ";
    g.maze.pellets = 0;
    check(simUntil(() => G.screen === "levelclear", 500, 16), "level clear");
    check(/Level\s+1 clear!/.test(text("#levelclear-stats")), "stats: " + text("#levelclear-stats"));
    press("Enter");
    frames(2);
    eq(text("#hud-level"), "2", "level 2");
    g.lives = 1;
    const gh = g.ghosts[0];
    gh.mode = "chase";
    gh.c = g.pac.c; gh.r = g.pac.r;
    check(simUntil(() => G.screen === "gameover", 3000, 16), "caught on the last life");
    const stats = text("#gameover-stats");
    check(/Score\s+\d+\s+·\s+NEW BEST/.test(stats), "NEW BEST on the game-over screen: " + stats);
    check(/Level\s+2/.test(stats), "level on the game-over screen");
    shot("gameover");
});

done("chomper");
