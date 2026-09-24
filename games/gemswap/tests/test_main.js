// Gemswap: rules, menus, mouse + keyboard swaps, specials, cascades, the
// three modes, high scores and settings. Run: scripts/validate.sh games/gemswap
import { test, done, check, eq, frames, simUntil, press, clickOn, q, text, shot } from "/lib/kit/test.js";
import { collapse, makeGrid } from "/lib/arcade/grid.js";

frames(6);
const G = window.__gemswap;
check(G, "__gemswap hooks exposed");
const R = G.rules;
const { SPECIAL, makeGem } = R;

/** Grid from strings of color digits; "F" before a digit freezes it, "." = empty. */
function grid(rows) {
    return rows.map((row) => {
        const out = [];
        for (let i = 0; i < row.length; i++) {
            if (row[i] === ".") { out.push(null); continue; }
            const frozen = row[i] === "F";
            if (frozen) i++;
            out.push(makeGem(+row[i], 0, frozen));
        }
        return out;
    });
}

// A match-free board: every row is a rotation of 1..7 shifted by 3.
function quietRows() {
    const rows = [];
    for (let r = 0; r < 8; r++) {
        let s = "";
        for (let c = 0; c < 8; c++) s += 1 + ((r * 3 + c) % 7);
        rows.push(s);
    }
    return rows;
}

function startMode(mode) {
    G.shell.switchTo("title");
    frames(1);
    clickOn('#screen-title [data-action="modeselect"]');
    clickOn('[data-action="mode-' + mode + '"]');
    frames(2);
    check(G.screen === "playing" && G.board.mode === mode, mode + " run started");
}

function clickCell(r, c) {
    const L = G.run.layout;
    const rect = G.shell.api.view.canvas.getBoundingClientRect();
    const sx = rect.width / G.shell.api.view.width(), sy = rect.height / G.shell.api.view.height();
    click(rect.left + (L.ox + (c + 0.5) * L.cell) * sx, rect.top + (L.oy + (r + 0.5) * L.cell) * sy);
    flush();
}

const settle = () => simUntil(() => !G.board.busy(), 6000, 16);

test("rules: line matches classify into specials", () => {
    const g = grid(quietRows());
    eq(R.findMatches(g).length, 0, "quiet board");
    g[0][0].color = g[0][1].color = g[0][2].color = 1;
    let m = R.findMatches(g).filter((x) => x.color === 1);
    eq(m.length, 1, "one group of 1s");
    eq([m[0].size, m[0].special], [3, SPECIAL.NONE], "3-line plain");
    g[0][3].color = 1;
    eq(R.findMatches(g).find((x) => x.color === 1).special, SPECIAL.FLAME, "4-line = flame");
    g[0][4].color = 1;
    eq(R.findMatches(g).find((x) => x.color === 1).special, SPECIAL.HYPER, "5-line = hyper");

    const l = grid(quietRows());
    l[0][0].color = l[0][1].color = l[0][2].color = 4;
    l[1][0].color = l[2][0].color = 4;
    l[0][3].color = 7;                        // keep the arm at 3
    const lm = R.findMatches(l).filter((x) => x.color === 4);
    eq(lm.length, 1, "L fuses to one group");
    eq([lm[0].size, lm[0].special], [5, SPECIAL.STAR], "L = star");
});

test("rules: swaps, frozen gems, dead boards, seeding", () => {
    const g = grid(quietRows());
    g[0][0].color = g[0][1].color = g[0][3].color = 5;
    g[0][2].color = 3; g[1][2].color = 5;
    check(R.swapMakesMatch(g, 0, 2, 1, 2), "vertical swap completes the row");
    eq(g[0][2].color, 3, "swapMakesMatch leaves the grid alone");
    g[1][2].frozen = true;
    check(!R.swapMakesMatch(g, 0, 2, 1, 2), "frozen gems do not swap");

    const seeded = R.seedGrid(Math.random);
    eq(R.findMatches(seeded).length, 0, "seeded board has no standing match");
    check(R.findAnyMove(seeded), "seeded board has a move");

    eq(R.scoreChain([3], 0), 50, "3 = 50");
    eq(R.scoreChain([3], 1), 100, "second cascade step doubles");
    eq(R.scoreChain([4], 0), 100, "4 = 100");
    eq(R.scoreChain([5], 0), 150, "5 = 150");
    eq(R.scoreChain([3, 3], 2), 300, "two groups on the third step");
});

test("rules: detonations chain; ice holds the column", () => {
    const g = grid(quietRows());
    g[3][0].special = SPECIAL.STAR;          // clearing (3,0) fires row 3 + column 0
    g[3][5].special = SPECIAL.FLAME;         // ...which catches a flame at (3,5)
    const cells = R.expandClears(g, [[3, 0]], null);
    const has = (r, c) => cells.some(([y, x]) => y === r && x === c);
    check(has(3, 7) && has(7, 0), "star clears its row and column");
    check(has(2, 6) && has(4, 4), "caught flame bursts 3x3");
    check(!R.expandClears(g, [[3, 0]], [3, 0]).some(([y, x]) => y === 3 && x === 0), "kept cell survives");

    // A hole under a frozen gem refills from the ice instead of staying empty.
    const col = makeGrid(4, 1, (r) => makeGem(r + 1, 0, r === 1));
    col[3][0] = null;
    const moves = collapse(col, { isFixed: (gem) => gem.frozen, spawn: () => makeGem(6) });
    check(col.every((row) => row[0]), "no holes after collapse");
    check(col[1][0].frozen, "ice stays put");
    check(moves.length > 0, "fall moves for the animation");
});

test("menus: title, mode select, how to play", () => {
    eq(G.screen, "title", "boots to title");
    shot("title");
    clickOn('#screen-title [data-action="howto"]');
    eq(G.screen, "howto", "how to play");
    clickOn('#screen-howto [data-action="back"]');
    clickOn('#screen-title [data-action="modeselect"]');
    eq(G.screen, "modeselect", "mode select");
    press("Escape");
    eq(G.screen, "title", "Esc backs out");
});

test("classic: mouse swap scores, 4-line spawns a flame gem", () => {
    startMode("classic");
    check(!q("#hud").hidden, "HUD visible");
    eq(text("#hud-extra-label"), "Moves", "classic shows moves");
    const rows = quietRows();
    const g = grid(rows);
    // Row 4: _ 1 1 X 1 with a 1 below X at (5,3): swapping (4,3)<->(5,3) makes 1 1 1 1.
    g[4][1].color = g[4][2].color = g[4][4].color = 1;
    g[4][3].color = 2; g[5][3].color = 1;
    g[3][1].color = 3; g[3][2].color = 4; g[5][2].color = 6; g[5][4].color = 6; g[4][0].color = 7; g[4][5].color = 5;
    eq(R.findMatches(g).length, 0, "crafted board is quiet");
    G.board.setGrid(g);
    frames(2);
    clickCell(4, 3);
    check(G.board.sel && G.board.sel.r === 4 && G.board.sel.c === 3, "first click selects");
    clickCell(5, 3);
    check(settle(), "cascade settles");
    check(G.board.score >= 100, "4-line scored: " + G.board.score);
    eq(G.board.moves, 1, "one move");
    check(G.board.stats.flameMade >= 1, "flame gem made");
    let flames = 0;
    for (const row of G.board.grid) for (const gem of row) if (gem && gem.special === SPECIAL.FLAME) flames++;
    check(flames >= 1, "flame gem on the board");
    eq(text("#hud-score"), String(G.board.score), "HUD score");
    shot("classic");
});

test("classic: bad swap bounces back; keyboard swap works", () => {
    const g = grid(quietRows());
    G.board.setGrid(g);
    const before = G.board.grid[0][0];
    const moves = G.board.moves;
    G.board.pick(0, 0);
    G.board.pick(0, 1);
    check(G.board.swap && G.board.swap.kind === "back", "swap plays out and back");
    check(settle(), "bounce finishes");
    check(G.board.grid[0][0] === before, "gems back in place");
    eq(G.board.moves, moves, "a bounce is not a move");

    const k = grid(quietRows());
    k[2][0].color = k[2][1].color = 6; k[2][2].color = 1; k[3][2].color = 6;
    k[1][2].color = 2; k[3][1].color = 3; k[3][3].color = 4; k[2][3].color = 5;
    eq(R.findMatches(k).length, 0, "keyboard board quiet");
    G.board.setGrid(k);
    G.board.cursor = { r: 3, c: 2, active: true };
    press(" ");
    frames(1);
    check(G.board.sel && G.board.sel.r === 3, "Space picks under the cursor");
    press("ArrowUp");
    frames(1);
    check(G.board.swap, "arrow swaps the picked gem");
    check(settle(), "keyboard swap settles");
    eq(G.board.moves, moves + 1, "keyboard swap counted");
});

test("pause: Enter on Resume does not pick a gem", () => {
    press("Escape");
    eq(G.screen, "pause", "paused");
    press("Enter");
    frames(2);
    eq(G.screen, "playing", "resumed");
    eq(G.board.sel, null, "the Enter that resumed did not select");
});

test("classic: dead board shuffles", () => {
    // In the quiet board no color repeats within 2 cells along a line, so no swap can match.
    const g = grid(quietRows());
    eq(R.findAnyMove(g), null, "quiet board is dead");
    G.board.setGrid(g);
    G.board.resolving = true;     // as if a cascade just ended here
    check(settle(), "settles");
    check(R.findAnyMove(G.board.grid), "shuffled into a live board");
    check(!G.board.over, "run continues");
});

test("timed: clock in HUD, time-up ends the run with a high score", () => {
    startMode("timed");
    eq(text("#hud-extra-label"), "Time", "timed shows time");
    check(/^\d:\d\d$/.test(text("#hud-extra")), "clock format: " + text("#hud-extra"));
    G.board.score = 1234;
    G.board.timeLeft = 50;
    simUntil(() => G.screen === "gameover", 2000, 16);
    eq(G.screen, "gameover", "time up -> game over");
    eq(text("#gameover-title"), "Timed Complete!", "complete title");
    check(/1234/.test(text("#gameover-stats")), "stats show the score");
    clickOn('#screen-gameover [data-action="highscores"]');
    eq(G.screen, "highscores", "high scores");
    check(q("#hs-tab-timed").className.indexOf("active") >= 0, "opens on the timed tab");
    check(/1234/.test(text("#hs-list")), "timed list has the run");
    clickOn('[data-action="hs-next"]');
    check(q("#hs-tab-puzzle").className.indexOf("active") >= 0, "next tab");
    shot("highscores");
});

test("puzzle: frozen gems crack and count down", () => {
    startMode("puzzle");
    eq(text("#hud-extra-label"), "Frozen", "puzzle shows frozen");
    check(G.board.frozenLeft > 0, "puzzle 1 has ice");
    const g = grid(quietRows());
    g[6][0].color = g[6][1].color = g[6][2].color = 2;
    g[5][0].color = 5; g[5][1].color = 6; g[5][2].color = 7; g[7][0].color = 4; g[7][1].color = 5; g[7][2].color = 6; g[6][3].color = 3;
    g[6][1].frozen = true;
    g[0][7].frozen = true;
    eq(R.findMatches(g).length, 1, "one standing match through the ice");
    G.board.setGrid(g);
    eq(G.board.frozenLeft, 2, "two frozen");
    G.board.resolving = true;
    check(settle(), "settles");
    check(G.board.frozenLeft <= 1, "ice cracked: " + G.board.frozenLeft);
    eq(text("#hud-extra"), String(G.board.frozenLeft), "HUD counts it");
    shot("puzzle");
});

test("settings: cycle hint delay and volume", () => {
    press("Escape");
    clickOn('#screen-pause [data-action="title"]');
    clickOn('#screen-title [data-action="settings"]');
    const before = text("#opt-hintDelay");
    clickOn('[data-action="cycle-hint"]');
    check(text("#opt-hintDelay") !== before, "hint delay cycles");
    const vol = text("#opt-sfxVol");
    clickOn('[data-action="cycle-sfx"]');
    check(text("#opt-sfxVol") !== vol, "volume cycles");
    eq(G.save.get("sfxVol") + "", text("#opt-sfxVol"), "saved");
});

done("gemswap");
