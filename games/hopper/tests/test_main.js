// Hopper: rules (hops + forward score, cars, logs, water, pads, timer,
// round clear, lives) and the shell flow (play, hop, pause, game over with
// NEW BEST — the old build saved the best mid-run so NEW BEST never showed).
// Run: scripts/validate.sh games/hopper
import { test, done, check, eq, near, frames, simUntil, press, text, shot } from "/lib/kit/test.js";
import { seededRandom } from "/lib/arcade/grid.js";

frames(6);
const G = window.__hopper;
check(G, "__hopper hooks exposed");
const R = G.rules;

const crossing = () => R.createHopper(seededRandom(9));
const types = (g) => R.drainEvents(g).map((e) => e.type);
/** Park every entity in a lane far off-screen. */
const clearLane = (g, row) => { for (const e of g.lanes[row].entities) e.x = -100; };
const freeze = (g) => { for (const lane of g.lanes) if (lane) lane.speed = 0; };

test("rules: a fresh crossing", () => {
    const g = crossing();
    eq([g.frog.col, g.frog.row], [R.START_COL, R.ROW_START], "frog at the start");
    eq(g.pads.length, 5, "five pads");
    check(g.lanes[R.ROW_ROAD_START].type === "car" && g.lanes[R.ROW_RIVER_START].type === "log", "cars and logs");
    eq(g.timeLeft, R.ROUND_TIME_MS, "60 s");
});

test("rules: forward hops score once per new row", () => {
    const g = crossing();
    g.respawnLock = 0;
    check(R.hop(g, 0, -1), "hop up");
    eq(g.score, R.HOP_POINTS, "+10");
    R.hop(g, 0, 1);
    R.hop(g, 0, -1);
    eq(g.score, R.HOP_POINTS, "no points for a row already reached");
    check(!R.hop(g, 0, 10), "cannot leave the board");
    R.hop(g, -1, 0);
    eq(g.frog.col, 5, "sideways hop");
    for (let i = 0; i < 20; i++) R.hop(g, -1, 0);
    eq(g.frog.col, 0, "clamped at the edge");
});

test("rules: a car squishes; an empty road is safe", () => {
    const g = crossing();
    freeze(g);
    g.frog = { col: 6, row: R.ROW_ROAD_START, onLog: null };
    clearLane(g, R.ROW_ROAD_START);
    R.step(g, 16);
    eq(g.deathTimer, 0, "empty lane is safe");
    g.lanes[R.ROW_ROAD_START].entities[0].x = 6;
    R.step(g, 16);
    eq(g.lives, 2, "hit by a car");
    const ev = R.drainEvents(g).find((e) => e.type === "death");
    eq(ev && ev.kind, "squish", "squish");
});

test("rules: logs carry the frog, water drowns it", () => {
    const g = crossing();
    const row = R.ROW_RIVER_START;
    g.frog = { col: 6, row, onLog: null };
    clearLane(g, row);
    g.lanes[row].entities[0].x = 5;          // a width-3 log under the frog
    R.step(g, 16);
    check(g.frog.onLog, "riding");
    const col = g.frog.col;
    R.step(g, 100);
    near(g.frog.col - col, g.lanes[row].dir * g.lanes[row].speed * 0.1, 1e-6, "carried with the log");
    clearLane(g, row);
    R.step(g, 16);
    const ev = R.drainEvents(g).find((e) => e.type === "death");
    eq(ev && ev.kind, "drown", "drowned");
});

test("rules: pads score with a time bonus; five clear the round", () => {
    const g = crossing();
    freeze(g);
    g.timeLeft = 30000;
    g.frog = { col: R.GOAL_COLS[0], row: R.ROW_GOAL, onLog: null };
    R.step(g, 0);
    eq(g.padsFilled, 1, "pad filled");
    eq(g.score, R.PAD_POINTS + 300, "50 + time bonus");
    eq(g.timeLeft, R.ROUND_TIME_MS, "timer reset");
    g.frog = { col: R.GOAL_COLS[0], row: R.ROW_GOAL, onLog: null };
    R.step(g, 0);
    eq(g.lives, 2, "a filled pad kills");
    g.deathTimer = 0;
    for (let i = 1; i < 5; i++) {
        g.frog = { col: R.GOAL_COLS[i], row: R.ROW_GOAL, onLog: null };
        R.step(g, 0);
    }
    check(types(g).includes("roundclear"), "round clear");
    check(g.pendingRound, "next round pending");
    R.step(g, 1600);
    eq([g.level, g.padsFilled], [2, 0], "level 2, pads empty");
});

test("rules: running out of time costs a life; no lives ends it", () => {
    const g = crossing();
    g.timeLeft = 10;
    R.step(g, 16);
    eq(R.drainEvents(g).find((e) => e.type === "death").kind, "timeout", "timeout");
    g.lives = 0;
    R.step(g, R.DEATH_MS);
    check(g.over, "game over");
});

test("shell: play, hop, pause", () => {
    press("Enter");
    frames(20);
    eq(G.screen, "playing", "Enter plays");
    press("ArrowUp");
    frames(2);
    eq(G.run.crossing.frog.row, R.ROW_START - 1, "Up hops");
    eq(text("#hud-score"), "10", "HUD score");
    eq(text("#hud-pads"), "0/5", "HUD pads");
    shot("playing");
    press("Escape");
    frames(1);
    eq(G.screen, "pause", "paused");
    const t = G.run.crossing.timeLeft;
    frames(30);
    eq(G.run.crossing.timeLeft, t, "timer frozen while paused");
    press("Escape");
    frames(1);
});

test("shell: last life -> game over with NEW BEST", () => {
    G.save.set("highScore", 0);
    const g = G.run.crossing;
    g.lives = 1;
    g.timeLeft = 5;
    check(simUntil(() => G.screen === "gameover", 3000, 16), "game over");
    const stats = text("#gameover-stats");
    check(/Score\s+10\s+·\s+NEW BEST/.test(stats), "NEW BEST: " + stats);
    eq(G.save.highScore(), 10, "saved at the end");
});

done("hopper");
