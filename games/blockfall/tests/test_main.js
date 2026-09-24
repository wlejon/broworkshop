// Blockfall: rules (7-bag, movement, kicks, hold, gravity, lock delay,
// line scoring, combos, level-ups, top out) and the shell flow (countdown,
// pause, settings, game over with NEW BEST).
// Run: scripts/validate.sh games/blockfall
import { test, done, check, eq, frames, simUntil, press, text, shot } from "/lib/kit/test.js";
import { seededRandom } from "/lib/arcade/grid.js";

frames(6);
const G = window.__blockfall;
check(G, "__blockfall hooks exposed");
const R = G.rules;

const fresh = (seed = 9, startLevel = 1) => R.createBlockfall({ rng: seededRandom(seed), startLevel });
/** Fill row r except the listed columns. */
function fillRow(s, r, gaps = []) {
    for (let c = 0; c < R.COLS; c++) s.board[r][c] = gaps.includes(c) ? 0 : 8 - 1;
}
/** Make the current piece an I, flat, at column x. */
function giveI(s, x = 3) {
    s.cur = { type: 1, x, y: 0, rot: 0 };
}

test("rules: the bag deals each piece once per seven", () => {
    const s = fresh();
    const seen = [s.cur.type];
    for (let i = 0; i < 6; i++) { R.hardDrop(s); seen.push(s.cur.type); }
    eq(seen.slice().sort(), [1, 2, 3, 4, 5, 6, 7], "one of each");
    eq(s.next.length, 5, "five in the queue");
});

test("rules: walls block moves, rotation kicks off the wall", () => {
    const s = fresh();
    giveI(s, 0);
    check(!R.moveH(s, -1), "left wall");
    s.cur = { type: 3, x: -1, y: 5, rot: 1 };       // T against the left wall
    check(R.rotate(s, 1), "rotated with a kick");
    check(R.canPlace(s, s.cur.type, s.cur.x, s.cur.y, s.cur.rot), "still in bounds");
});

test("rules: hold swaps once per piece", () => {
    const s = fresh();
    const first = s.cur.type, second = s.next[0];
    check(R.hold(s), "held");
    eq([s.holdType, s.cur.type], [first, second], "next piece came in");
    check(!R.hold(s), "only once per piece");
    R.hardDrop(s);
    check(R.hold(s), "free again after a lock");
    eq(s.cur.type, first, "swapped back");
});

test("rules: gravity, then the lock delay", () => {
    const s = fresh();
    const y = s.cur.y;
    R.step(s, R.SPEEDS[0], false);
    eq(s.cur.y, y + 1, "one row per 800 ms on level 1");
    const pieces = s.pieces;
    s.cur.y = R.ghostY(s);
    R.step(s, R.LOCK_DELAY - 1, false);
    eq(s.pieces, pieces, "not locked yet");
    R.step(s, 1, false);
    eq(s.pieces, pieces + 1, "locked after the delay");
});

test("rules: line clears score by lines x level, quads back to back 1.5x", () => {
    const s = fresh(9, 2);
    for (let r = 16; r < 20; r++) fillRow(s, r, [9]);
    s.cur = { type: 1, x: 7, y: 16, rot: 1 };       // vertical I into column 9
    R.hardDrop(s);
    const ev = R.drainEvents(s).find((e) => e.type === "clear");
    eq(ev && ev.n, 4, "quad");
    eq(s.stats.quads, 1, "counted");
    const quad = 800 * 2;
    check(s.score >= quad, "800 x level 2: " + s.score);
    const before = s.score;
    for (let r = 16; r < 20; r++) fillRow(s, r, [9]);
    s.cur = { type: 1, x: 7, y: 16, rot: 1 };
    R.hardDrop(s);
    const gained = s.score - before;
    check(gained >= quad * 1.5 + 50 * 2, "back-to-back quad plus combo: " + gained);
    eq(s.combo, 1, "second clear in a row");
    eq(s.lines, 8, "8 lines");
});

test("rules: ten lines level up", () => {
    const s = fresh();
    s.lines = 9;
    fillRow(s, 19, [0, 1, 2, 3]);
    giveI(s, 0);
    s.cur.y = 17;
    R.hardDrop(s);
    eq(s.level, 2, "level 2");
    check(R.drainEvents(s).some((e) => e.type === "levelup"), "levelup event");
    eq(R.dropInterval(2), 717, "faster gravity");
});

test("rules: a blocked spawn tops out", () => {
    const s = fresh();
    for (let r = 0; r < 20; r++) fillRow(s, r, [r % 10]);
    R.hardDrop(s);
    check(s.over, "topped out");
    check(R.drainEvents(s).some((e) => e.type === "topout"), "topout event");
});

test("shell: settings, countdown, pause", () => {
    check(G.screen === "title", "boots to the title");
    press("ArrowDown");
    press("ArrowDown");
    press("Enter");
    frames(1);
    eq(G.screen, "settings", "Settings screen");
    eq(text("#opt-startLevel"), "1", "start level shown");
    press("Enter");
    frames(1);
    eq(text("#opt-startLevel"), "2", "Enter cycles the start level");
    shot("settings");
    press("Escape");
    frames(1);
    eq(G.screen, "title", "Esc backs out to the title");
    press("Enter");
    frames(2);
    eq(G.screen, "playing", "Play");
    eq(G.run.phase, "countdown", "counts down first");
    eq(G.run.state.level, 2, "starts on the chosen level");
    G.save.set("startLevel", 1);
    const y = G.run.state.cur.y;
    frames(60);
    eq(G.run.state.cur.y, y, "nothing falls during the countdown");
    check(simUntil(() => G.run.phase === "playing", 4000, 16), "GO");
    press("ArrowLeft");
    frames(1);
    press("ArrowUp");
    frames(20);
    shot("playing");
    press("Escape");
    frames(1);
    eq(G.screen, "pause", "Esc pauses");
    const t = G.run.state.time;
    frames(30);
    eq(G.run.state.time, t, "paused clock");
    press("Escape");
    frames(1);
    eq(G.screen, "playing", "Esc resumes");
});

test("shell: a quad shows its callout, topping out ends the run with NEW BEST", () => {
    G.save.set("highScore", 0);
    const s = G.run.state;
    for (let r = 16; r < 20; r++) fillRow(s, r, [9]);
    s.cur = { type: 1, x: 7, y: 16, rot: 1 };
    press("Space");
    frames(1);
    eq(text("#action-text"), "QUAD!", "QUAD! callout");
    eq(text("#hud-lines"), "4", "HUD lines");
    for (let r = 0; r < 20; r++) fillRow(s, r, [r % 10]);
    press("Space");
    check(simUntil(() => G.screen === "gameover", 500, 16), "topped out");
    const stats = text("#gameover-stats");
    check(/Score\s+\d+\s+·\s+NEW BEST/.test(stats), "NEW BEST on the game-over screen: " + stats);
    check(/Triples \/ Quads\s+0 \/ 1/.test(stats), "clear stats");
    shot("gameover");
});

done("blockfall");
