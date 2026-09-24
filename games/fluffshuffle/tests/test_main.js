// Fluffshuffle: slide/match rules, mouse wrap-drag, keyboard grab/slide,
// locks, cascades, the three modes, high scores and settings.
// Run: scripts/validate.sh games/fluffshuffle
import { test, done, check, eq, frames, simUntil, press, clickOn, q, text, shot } from "/lib/kit/test.js";

frames(6);
const F = window.__fluffshuffle;
check(F, "__fluffshuffle hooks exposed");
const R = F.rules;
const { SPECIAL, makePuff } = R;

/** Grid from rows of color digits; "L" before a digit locks that puff. */
function grid(rows) {
    return rows.map((row) => {
        const out = [];
        for (let i = 0; i < row.length; i++) {
            const locked = row[i] === "L";
            if (locked) i++;
            out.push(makePuff(+row[i], 0, locked));
        }
        return out;
    });
}
const colors = (g) => g.map((row) => row.map((p) => (p ? p.color : 0)).join(""));

// Each row a rotation of 1..6: no line ever holds a color twice, so no slide can match.
const DEAD = ["123456", "234561", "345612", "456123", "561234", "612345"];

// Slide row 2 right by one: its 5 lands between (1,2) and (3,2) -> vertical 5-5-5.
const SLIDE_ME = ["123123", "235131", "456464", "315232", "123123", "231231"];

const settle = () => simUntil(() => !F.board.busy(), 6000, 16);

function startMode(mode) {
    F.shell.switchTo("title");
    frames(1);
    clickOn('#screen-title [data-action="modeselect"]');
    clickOn('[data-action="mode-' + mode + '"]');
    frames(2);
    check(F.screen === "playing" && F.board.mode === mode, mode + " run started");
}

/** Viewport px of a cell centre (the canvas may be scaled to the window). */
function cellPoint(r, c) {
    const L = F.run.layout, view = F.shell.api.view;
    const rect = view.canvas.getBoundingClientRect();
    const sx = rect.width / view.width(), sy = rect.height / view.height();
    return { x: rect.left + (L.ox + (c + 0.5) * L.cell) * sx, y: rect.top + (L.oy + (r + 0.5) * L.cell) * sy, sx, sy };
}

/** Real mouse drag from a cell by (dc, dr) cells. */
function drag(r, c, dr, dc) {
    const p = cellPoint(r, c), cell = F.run.layout.cell;
    mouseDown(p.x, p.y);
    frames(1);
    for (let i = 1; i <= 6; i++) {
        mouseMove(p.x + dc * cell * p.sx * i / 6, p.y + dr * cell * p.sy * i / 6);
        frames(1);
    }
    mouseUp(p.x + dc * cell * p.sx, p.y + dr * cell * p.sy);
    frames(1);
}

test("rules: slides wrap and do not mutate", () => {
    const g = grid(DEAD);
    eq(colors(R.slideRow(g, 2, 1))[2], "234561", "345612 >> 1 = 234561");
    eq(colors(g)[2], "345612", "input untouched");
    eq(colors(R.slideRow(g, 2, -1))[2], "456123", "<< 1 wraps the other way");
    eq(colors(R.slideRow(g, 2, 6))[2], "345612", "a full turn is identity");
    const down = R.slideCol(g, 0, 2);
    eq(colors(down).map((row) => row[0]).join(""), "561234", "column slides down with wrap");
});

test("rules: matches, specials, legal shifts, dead boards", () => {
    const dead = grid(DEAD);
    eq(R.findMatches(dead).length, 0, "no standing match");
    check(!R.hasAnyMatchingShift(dead), "rotation board is dead");

    const g = grid(DEAD);
    g[0][0].color = g[0][1].color = g[0][2].color = 6;
    let m = R.findMatches(g).filter((x) => x.color === 6);
    eq([m.length, m[0].special], [1, SPECIAL.NONE], "3-line plain");
    g[0][3].color = 6;
    eq(R.findMatches(g).find((x) => x.color === 6).special, SPECIAL.JUMBO, "4 = jumbo");
    g[0][4].color = 6;
    const five = R.findMatches(g).find((x) => x.color === 6);
    eq([five.special, five.arrowDir], [SPECIAL.ARROW, "h"], "5 = horizontal arrow");

    const l = grid(DEAD);
    l[0][0].color = l[0][1].color = l[0][2].color = 5;
    l[1][0].color = l[2][0].color = 5;
    const lm = R.findMatches(l).filter((x) => x.color === 5);
    eq([lm.length, lm[0].special], [1, SPECIAL.PRISM], "L = prism");

    const s = grid(SLIDE_ME);
    eq(R.findMatches(s).length, 0, "slide board is quiet");
    check(R.findMatches(R.slideRow(s, 2, 1)).some((x) => x.color === 5 && x.hasV), "slide makes a vertical 5-line");
    check(R.legalShifts(s).some((x) => x.axis === "h" && x.index === 2), "legalShifts lists row 2");
    s[2][0].locked = true;
    check(!R.legalShifts(s).some((x) => x.axis === "h" && x.index === 2), "a locked row cannot shift");

    eq(R.scoreChain(3, 0), 150, "3 puffs = 150");
    eq(R.scoreChain(3, 1), 300, "doubled on the second step");
    eq(R.scoreChain(4, 2), 600, "tripled on the third");
});

test("rules: specials chain their blasts", () => {
    const g = grid(DEAD);
    g[1][0].special = SPECIAL.ARROW; g[1][0].arrowDir = "h";   // row 1
    g[1][4].special = SPECIAL.JUMBO;                            // caught -> 3x3 around (1,4)
    const cells = R.expandClears(g, [[1, 0]], []);
    const has = (r, c) => cells.some(([y, x]) => y === r && x === c);
    check(has(1, 5) && has(0, 3) && has(2, 5), "arrow row then jumbo burst");
    check(!R.expandClears(g, [[1, 0]], [[1, 0]]).some(([y, x]) => y === 1 && x === 0), "keep cell survives");
});

test("menus: title, mode select, how to play", () => {
    eq(F.screen, "title", "boots to title");
    shot("title");
    clickOn('#screen-title [data-action="howto"]');
    eq(F.screen, "howto", "how to play");
    clickOn('#screen-howto [data-action="back"]');
    eq(F.screen, "title", "back");
});

test("classic: mouse wrap-drag pops a line and scores", () => {
    startMode("classic");
    eq(text("#hud-extra-label"), "Popped", "classic shows popped");
    F.board.setGrid(grid(SLIDE_ME));
    frames(2);
    drag(2, 3, 0, 1);
    check(settle(), "cascade settles");
    eq(F.board.moves, 1, "one move");
    check(F.board.score >= 150, "scored: " + F.board.score);
    check(F.board.popped >= 3, "popped: " + F.board.popped);
    eq(text("#hud-score"), String(F.board.score), "HUD score");
    shot("classic");
});

test("classic: dragging a locked row thuds; keyboard grab-slide-release moves", () => {
    const g = grid(SLIDE_ME);
    g[2][5].locked = true;
    F.board.setGrid(g);
    const moves = F.board.moves;
    drag(2, 3, 0, 1);
    frames(10);
    eq(F.board.moves, moves, "locked row did not move");
    eq(colors(F.board.grid)[2], "456464", "row unchanged");

    F.board.setGrid(grid(SLIDE_ME));
    F.board.cursor = { r: 2, c: 1, active: true };
    press(" ");
    frames(1);
    check(F.board.drag, "Space grabs");
    press("ArrowRight");
    frames(1);
    eq(F.board.drag.axis, "h", "first arrow picks the row");
    press(" ");
    frames(1);
    check(F.board.snap, "Space releases into a snap");
    check(settle(), "released line settles");
    eq(F.board.moves, moves + 1, "keyboard slide counted");
    check(F.board.score > 0, "and scored");
});

test("pause: Enter on Resume does not grab a puff", () => {
    press("Escape");
    eq(F.screen, "pause", "paused");
    press("Enter");
    frames(2);
    eq(F.screen, "playing", "resumed");
    eq(F.board.drag, null, "the Enter that resumed did not grab");
});

test("classic: a dead board ends the run", () => {
    F.board.setGrid(grid(DEAD));
    F.board.resolving = true;         // as if a slide just settled here
    simUntil(() => F.screen === "gameover", 2000, 16);
    eq(F.screen, "gameover", "game over");
    eq(text("#gameover-title"), "Game Over", "title");
    check(/Unlocks/.test(text("#gameover-stats")), "stats block");
});

test("timed: clock counts down and pops add time", () => {
    startMode("timed");
    eq(text("#hud-extra-label"), "Time", "timed shows time");
    const t0 = F.board.timeLeft;
    frames(30);
    check(F.board.timeLeft < t0, "clock runs");
    F.board.timeLeft = 10000;
    const start = F.board.time;
    F.board.setGrid(grid(SLIDE_ME));
    drag(2, 3, 0, 1);
    check(settle(), "settles");
    const noBonus = 10000 - (F.board.time - start);
    check(F.board.timeLeft >= noBonus + 3 * 150, "pops added time: " + F.board.timeLeft + " vs " + noBonus);
    F.board.timeLeft = 30;
    simUntil(() => F.screen === "gameover", 2000, 16);
    eq(text("#gameover-title"), "Timed Complete!", "time up completes the mode");
});

test("puzzle: goal, move budget, next board", () => {
    startMode("puzzle");
    eq(text("#hud-extra-label"), "Moves", "puzzle shows moves left");
    check(q("#hud-goal-stat").style.display !== "none", "goal visible");
    eq(text("#hud-goal"), "0 / " + F.board.puzzleTarget, "goal text");
    check(F.board.grid.some((row) => row.some((p) => p.locked)), "puzzle has locks");
    const left = F.board.puzzleMovesLeft;
    F.board.setGrid(grid(SLIDE_ME));
    drag(2, 3, 0, 1);
    check(settle(), "settles");
    eq(F.board.puzzleMovesLeft, left - 1, "a move spent");
    F.board.popped = F.board.puzzleTarget;
    F.board.resolving = true;
    check(settle(), "settles");
    eq(F.board.puzzleIndex, 1, "goal met -> puzzle 2");
    eq(text("#hud-level"), "2", "HUD shows puzzle 2");
    shot("puzzle");
});

test("high scores record per mode", () => {
    press("Escape");
    clickOn('#screen-pause [data-action="title"]');
    clickOn('#screen-title [data-action="highscores"]');
    check(q("#hs-tab-puzzle").className.indexOf("active") >= 0, "opens on the last mode's tab");
    clickOn('[data-action="hs-next"]');
    check(q("#hs-tab-classic").className.indexOf("active") >= 0, "cycles to classic");
    check(/\d/.test(text("#hs-list")), "classic run listed: " + text("#hs-list"));
    clickOn('#screen-highscores [data-action="back"]');
});

test("settings: toggles reach the board", () => {
    clickOn('#screen-title [data-action="settings"]');
    eq(text("#opt-eyeTrack"), "ON", "eyes on by default");
    clickOn('[data-action="toggle-eyes"]');
    eq(text("#opt-eyeTrack"), "OFF", "eyes off");
    const b = F.startRun("classic");
    eq(b.settings.eyeTrack, false, "board sees it");
    F.shell.switchTo("settings");
    clickOn('[data-action="toggle-eyes"]');
    eq(text("#opt-eyeTrack"), "ON", "eyes back on");
    const dead = +text("#opt-dragDead");
    clickOn('[data-action="cycle-drag"]');
    const next = dead >= 20 ? 2 : dead + 1;
    eq(text("#opt-dragDead"), String(next), "drag threshold cycles");
    eq(F.board.settings.dragDead, next, "live setting");
});

done("fluffshuffle");
