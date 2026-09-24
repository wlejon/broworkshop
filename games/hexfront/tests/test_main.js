// HexFront: the map and engine grid queries, real click picking, movement,
// deterministic combat (counters, high ground, artillery range), an AI
// turn on game-clock timers (frozen while paused), save / load, victory.
// Run: scripts/validate.sh games/hexfront
import { test, done, check, eq, frames, simUntil, press, text, shot } from "/lib/kit/test.js";

frames(6);
const H = window.__hexfront;
check(H, "__hexfront hooks exposed");
const R = H.rules;

press("Enter");
frames(4);
const B = () => H.battle;
const world = () => H.board.world;
const U = (side, type, n = 0) => B().units.filter((u) => u.side === side && u.type === type)[n];
const place = (u, x, y) => { u.x = x; u.y = y; H.board.sync(B()); };
const resetActed = (side) => { for (const u of R.aliveUnits(B(), side)) u.acted = false; };
const clickCell = (x, y) => {
    const p = H.projectCell(x, y);
    click(p.x, p.y);
    frames(2);
};

test("map: tiles, water, elevation and armies", () => {
    eq(H.screen, "playing", "Enter plays");
    const w = world();
    eq([w.width, w.height], [13, 11], "13x11");
    eq(w.getTile(6, 3, 0), R.TILE.WATER, "water at (6,3)");
    check(w.hasFlag(6, 3, R.FLAG_WATER), "water flagged impassable");
    eq([w.getElevation(6, 3), w.getElevation(9, 0), w.getElevation(10, 1)], [-1, 1, 2], "water below, hill, mountain");
    eq([R.aliveUnits(B(), "red").length, R.aliveUnits(B(), "blue").length], [4, 4], "4 a side");
    const k = H.board.kinds;
    eq([w.objectCount(k.infantry), w.objectCount(k.tank), w.objectCount(k.artillery)], [4, 2, 2], "unit instances");
    shot("initial");
});

test("engine grid search: A* around water, distance field, hex ranges", () => {
    const w = world();
    const path = w.findPath(2, 5, 11, 5, { blockMask: R.FLAG_WATER, costs: R.MOVE_COST });
    check(path.length > 0, "cross-map path");
    check(path.every((p) => w.getTile(p.x, p.y, 0) !== R.TILE.WATER), "path avoids water");
    check(path.length - 1 >= w.cellDistance(2, 5, 11, 5), "path >= hex distance");
    const field = w.distanceField(R.aliveUnits(B(), "blue").map((u) => ({ x: u.x, y: u.y })), { blockMask: R.FLAG_WATER });
    eq(field.length, 13 * 11, "field covers the grid");
    eq(field[3 * 13 + 6], -1, "water unreachable");
    check(field[5 * 13 + 2] > 0, "red tank cell has a distance");
    check(w.cellsInRange(6, 5, 2).every((c) => w.cellDistance(6, 5, c.x, c.y) <= 2), "cellsInRange within radius");
});

test("click picking selects, the reach respects terrain and water", () => {
    clickCell(1, 3);
    const sel = H.run.sel;
    check(sel, "click selected a unit");
    eq([sel.unit.side, sel.unit.type, sel.unit.x, sel.unit.y], ["red", "infantry", 1, 3], "the (1,3) infantry");
    check(sel.reach.has("2,3") && sel.reach.has("4,3"), "grass 1 and 3 steps away");
    check(!sel.reach.has("5,3") && !sel.reach.has("6,3"), "water out of reach");
    eq(sel.reach.get("4,3").cost, 3, "three grass steps");
    check(document.getElementById("unit-panel").style.display !== "none", "unit panel shown");
    eq(text("#unit-name"), "Infantry (RED)", "unit panel name");
    shot("moverange");
});

test("a move walks the route on the game clock, then the unit is spent", () => {
    const inf = U("red", "infantry");
    H.actOnCell(4, 3);
    check(H.run.busy, "animating");
    press("Escape");
    frames(1);
    eq(H.screen, "pause", "paused mid-move");
    const x = inf.x;
    frames(40);
    eq(inf.x, x, "the move waits while paused");
    press("Escape");
    check(simUntil(() => !H.run.busy, 2000, 16), "arrived");
    eq([inf.x, inf.y, inf.acted], [4, 3, true], "at (4,3), spent");
    eq(H.run.sel, null, "selection cleared");
});

test("melee: 6 damage, 3 back from a wounded infantry", () => {
    const tank = U("red", "tank");
    const bInf = U("blue", "infantry");
    place(bInf, 3, 5);
    H.actOnCell(2, 5);
    check(H.run.sel && H.run.sel.targets.includes(bInf), "adjacent enemy attackable");
    H.actOnCell(3, 5);
    frames(2);
    eq([bInf.hp, tank.hp, tank.acted], [4, 11, true], "6 dealt, 3 countered");
});

test("high ground hits 25% harder, the hill softens the counter", () => {
    const rInf = U("red", "infantry", 1), bInf2 = U("blue", "infantry", 1);
    place(rInf, 10, 0);
    place(bInf2, 11, 0);
    resetActed("red");
    H.actOnCell(10, 0);
    H.actOnCell(11, 0);
    frames(2);
    eq([bInf2.hp, rInf.hp], [5, 8], "5 downhill, 2 uphill");
});

test("artillery: range 2-3, nothing inside, no counter", () => {
    const rArty = U("red", "artillery"), bTank = U("blue", "tank"), bArty = U("blue", "artillery");
    place(rArty, 4, 9);
    place(bTank, 6, 9);
    place(bArty, 5, 9);
    resetActed("red");
    H.actOnCell(4, 9);
    const sel = H.run.sel;
    check(sel.targets.includes(bTank) && !sel.targets.includes(bArty), "range 2 yes, range 1 no");
    shot("artillery");
    H.actOnCell(6, 9);
    frames(2);
    eq([bTank.hp, rArty.hp], [8, 8], "6 dealt, no counter");
});

test("end turn: blue acts a unit at a time, then it is red's turn 2", () => {
    const hp = () => R.aliveUnits(B(), "red").reduce((s, u) => s + u.hp, 0);
    const before = hp();
    press("e");
    frames(1);
    check(H.run.aiRunning, "blue is moving");
    eq(text("#hud-side"), "BLUE MOVES", "HUD side");
    check(simUntil(() => !H.run.aiRunning, 5000, 16), "AI finished");
    eq([B().turn.side, B().turn.number], ["red", 2], "red, turn 2");
    check(hp() < before, "AI landed an attack");
    eq(text("#hud-turn"), "TURN 2", "HUD turn");
    shot("after-ai");
});

test("save and load restore units and the turn", () => {
    const tank = U("red", "tank");
    const saved = [tank.x, tank.y, tank.hp, B().turn.number];
    press("s");
    frames(1);
    eq(text("#toast"), "Game saved", "save toast");
    place(tank, 0, 0);
    tank.hp = 1;
    press("l");
    frames(1);
    const t2 = U("red", "tank");
    eq([t2.x, t2.y, t2.hp, B().turn.number], saved, "restored");
    eq(text("#toast"), "Game loaded", "load toast");
    check(world().objectCount(H.board.kinds.infantry) > 0, "unit instances back");
});

test("wiping out blue wins, with a score and NEW BEST", () => {
    H.save.set("highScore", 0);
    const tank = U("red", "tank");
    for (const b of R.aliveUnits(B(), "blue")) {
        b.hp = 1;
        place(b, 3, 1);
        place(tank, 2, 1);
        R.attack(B(), tank, b);
        check(!b.alive, b.type + " destroyed");
    }
    check(simUntil(() => H.screen === "gameover", 500, 16), "game over");
    eq(B().turn.winner, "red", "red wins");
    eq(text("#gameover-title"), "VICTORY", "VICTORY title");
    check(/Score\s+980\s+·\s+NEW BEST/.test(text("#gameover-stats")), "score: " + text("#gameover-stats"));
    eq(world().objectCount(H.board.kinds.tank), 1, "only the red tank remains");
    shot("victory");
});

test("play again builds a fresh battle", () => {
    press("Enter");
    frames(4);
    eq(H.screen, "playing", "playing again");
    eq([R.aliveUnits(B(), "red").length, R.aliveUnits(B(), "blue").length, B().turn.number], [4, 4, 1], "fresh armies");
    eq(world().objectCount(H.board.kinds.tank), 2, "fresh world");
});

done("hexfront");
