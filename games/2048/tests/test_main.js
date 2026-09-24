// 2048: rules (packing, single merges, spawn, undo, win, stuck) and the
// shell flow (slide, undo, restart board, win screen, keep playing, game
// over with NEW BEST).
// Run: scripts/validate.sh games/2048
import { test, done, check, eq, frames, simUntil, press, text, shot } from "/lib/kit/test.js";
import { seededRandom } from "/lib/arcade/grid.js";

frames(6);
const G = window.__2048;
check(G, "__2048 hooks exposed");
const R = G.rules;

/** A board holding `rows` (0 = empty); ids fresh. */
function boardOf(rows, seed = 5) {
    const b = R.createBoard(seededRandom(seed));
    b.grid = rows.map((row) => row.map((v) => (v ? { value: v, id: b.nextId++ } : null)));
    return b;
}
const values = (b) => b.grid.map((row) => row.map((t) => (t ? t.value : 0)));

test("rules: fresh board", () => {
    const b = R.createBoard(seededRandom(1));
    eq(R.tilesOf(b.grid).length, 2, "two tiles");
    check(R.tilesOf(b.grid).every((t) => t.value === 2 || t.value === 4), "2s and 4s");
});

test("rules: slide packs and merges each tile once", () => {
    const b = boardOf([[2, 2, 2, 2], [4, 0, 4, 8], [0, 0, 0, 0], [0, 0, 0, 0]]);
    const res = R.slide(b, "left");
    check(res, "moved");
    const v = values(b);
    eq(v[0].slice(0, 2), [4, 4], "2 2 2 2 -> 4 4");
    eq(v[1].slice(0, 2), [8, 8], "4 _ 4 8 -> 8 8");
    eq(b.score, 16, "merge values scored");
    eq(R.tilesOf(b.grid).length, 5, "one tile spawned");
    eq(R.drainEvents(b).map((e) => e.type), ["merge"], "merge event");
    check(res.moved.some((m) => m.kind === "merge"), "animation sees the merge");
});

test("rules: a move that changes nothing is refused", () => {
    const b = boardOf([[2, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    eq(R.slide(b, "left"), null, "already packed left");
    eq(b.prev, null, "no undo snapshot");
    check(R.slide(b, "down"), "down moves");
});

test("rules: undo restores one step", () => {
    const b = boardOf([[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    R.slide(b, "right");
    eq(b.score, 4, "scored");
    check(R.undo(b), "undone");
    eq(values(b)[0], [2, 2, 0, 0], "row restored");
    eq(b.score, 0, "score restored");
    check(!R.undo(b), "only one step");
});

test("rules: reaching 2048 wins once, a full stuck board loses", () => {
    const b = boardOf([[1024, 1024, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    R.slide(b, "left");
    check(b.won, "won");
    eq(R.drainEvents(b).map((e) => e.type), ["merge", "win"], "win event");
    R.keepPlaying(b);

    const stuck = boardOf([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [8, 4, 2, 0]]);
    stuck.rng = () => 0;                               // the spawn is a 4 in the gap
    R.slide(stuck, "right");
    check(stuck.over, "no moves left");
    check(R.drainEvents(stuck).some((e) => e.type === "lose"), "lose event");
});

test("shell: slide, undo, restart board", () => {
    check(G.screen === "title", "boots to the title");
    press("Enter");
    frames(20);
    eq(G.screen, "playing", "Enter plays");
    const run = G.run;
    run.board.grid = boardOf([[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]).grid;
    press("ArrowLeft");
    frames(1);
    eq(run.board.grid[0][0].value, 4, "arrow slid and merged");
    frames(20);
    eq(text("#hud-score"), "4", "HUD score");
    shot("playing");
    press("u");
    frames(2);
    eq(run.board.grid[0][1].value, 2, "U undoes");
    eq(run.score, 0, "score undone");
    press("r");
    frames(20);
    eq(R.tilesOf(run.board.grid).length, 2, "R deals a fresh board");
});

test("shell: win screen, keep playing, game over with NEW BEST", () => {
    G.save.set("highScore", 0);
    const run = G.run;
    run.board.grid = boardOf([[1024, 1024, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]).grid;
    press("ArrowLeft");
    check(simUntil(() => G.screen === "win", 1000, 16), "win screen");
    check(/Score\s+2048/.test(text("#win-stats")), "win stats: " + text("#win-stats"));
    shot("win");
    press("Enter");
    frames(2);
    eq(G.screen, "playing", "Keep Playing");
    check(run.board.keepPlaying, "keeps playing");

    run.board.grid = boardOf([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [8, 4, 2, 0]]).grid;
    run.board.rng = () => 0;
    press("ArrowRight");
    check(simUntil(() => G.screen === "gameover", 1000, 16), "stuck board ends the run");
    const stats = text("#gameover-stats");
    check(/Score\s+2048\s+·\s+NEW BEST/.test(stats), "NEW BEST on the game-over screen: " + stats);
    eq(G.save.highScore(), 2048, "high score saved");
    shot("gameover");
});

done("2048");
