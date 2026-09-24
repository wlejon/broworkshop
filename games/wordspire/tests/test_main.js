// Wordspire: dictionary, scoring and path rules, mouse + keyboard chains,
// burning tiles, the three modes, high scores and settings.
// Run: scripts/validate.sh games/wordspire
import { test, done, check, eq, frames, simUntil, press, clickOn, q, text, shot } from "/lib/kit/test.js";

frames(4);
const W = window.__wordspire;
check(W, "__wordspire hooks exposed");
const L = W.letters, S = W.scoring, D = W.dictionary;
check(simUntil(() => D.loaded() && W.screen === "title", 8000, 50), "dictionary loads, then the title");

// CAT across the top row, the rest filler that spells nothing useful.
const CAT = ["catxqzj", "xqzjvxq", "zjvxqzj", "vxqzjvx", "qzjvxqz", "jvxqzjv", "xqzjvxq", "zjvxqzj"];

function startMode(mode) {
    W.shell.switchTo("title");
    frames(1);
    clickOn('#screen-title [data-action="modeselect"]');
    clickOn('[data-action="mode-' + mode + '"]');
    frames(2);
    check(W.screen === "playing" && W.board.mode === mode, mode + " run started");
}

/** Viewport px of a canvas point (the canvas may be scaled to the window). */
function toViewport(x, y) {
    const view = W.shell.api.view;
    const rect = view.canvas.getBoundingClientRect();
    return { x: rect.left + x * rect.width / view.width(), y: rect.top + y * rect.height / view.height() };
}
function cellPoint(r, c) {
    const lay = W.run.layout;
    return toViewport(lay.ox + (c + 0.5) * lay.cell, lay.oy + (r + 0.5) * lay.cell);
}
function clickCell(r, c) {
    const p = cellPoint(r, c);
    click(p.x, p.y);
    frames(1);
}
function clickSubmit() {
    const lay = W.run.layout;
    const p = toViewport(lay.ox + lay.boardW + 80, lay.oy + 22);
    click(p.x, p.y);
    frames(1);
}
function setRows(rows) {
    W.board.setGrid(L.gridFromRows(rows, Math.random));
    frames(1);
}

test("dictionary, scoring, paths", () => {
    check(D.count() > 5000, "thousands of words: " + D.count());
    for (const w of ["hello", "world", "game", "board", "tower", "stone"]) check(D.isWord(w), "has " + w);
    check(D.isPrefix("sto") && !D.isWord("zxq"), "prefixes; junk rejected");

    eq([S.letterValue("a"), S.letterValue("q"), S.letterValue("z")], [1, 10, 10], "letter values");
    eq([S.lengthBonus(3), S.lengthBonus(5), S.lengthBonus(7)], [10, 40, 160], "length bonus");
    eq(S.computeWordScore("cat"), 15, "CAT = 5 + 10");
    eq(S.computeWordScore("stone"), 45, "STONE = 5 + 40");
    eq(S.computeWordScore("cat", [{ mult: 1 }, { mult: 3 }, { mult: 1 }]), 37, "x3 tile: 7 + 10x3");
    eq([S.comboMultiplier(1), S.comboMultiplier(3), S.comboMultiplier(20)], [1, 2, 5], "combo multiplier");

    const g = L.fillGrid(L.emptyGrid(), Math.random);
    check(L.isValidPath([[0, 0], [1, 1], [2, 2]], g), "diagonal path");
    check(!L.isValidPath([[0, 0], [2, 0]], g), "gap rejected");
    check(!L.isValidPath([[0, 0], [1, 0], [0, 0]], g), "revisit rejected");

    const cat = L.gridFromRows(CAT, Math.random);
    const found = L.findWords(cat, D, 50).map((f) => f.word);
    check(found.includes("cat"), "findWords sees CAT");
    eq(L.rewardFor(4), 0, "4 letters: no reward");
    eq([L.rewardFor(5), L.rewardFor(7), L.rewardFor(9)], [2, 4, 5], "reward tiers");
});

test("burning tiles sink and collapse", () => {
    const g = L.gridFromRows(CAT, Math.random);
    g[5][2].burning = true;
    const sink = L.descendBurning(g);
    check(!sink.collapsed && g[6][2].burning && !g[5][2].burning, "sinks one row");
    check(L.burningDanger(g), "row 6 is danger");
    L.descendBurning(g);
    check(L.descendBurning(g).collapsed, "bottom row collapses");
});

test("menus: title, how to play, mode select", () => {
    eq(W.screen, "title", "title");
    shot("title");
    clickOn('#screen-title [data-action="howto"]');
    eq(W.screen, "howto", "how to play");
    clickOn('#screen-howto [data-action="back"]');
    clickOn('#screen-title [data-action="modeselect"]');
    eq(W.screen, "modeselect", "mode select");
    press("Escape");
    frames(1);
    eq(W.screen, "title", "Esc backs out");
});

test("classic: mouse chain + Submit scores and pops", () => {
    startMode("classic");
    check(!q("#hud").hidden, "HUD visible");
    eq(text("#hud-extra-label"), "Words", "classic counts words");
    setRows(CAT);
    W.save.set("topWords", []);     // storage persists between runs
    clickCell(0, 0); clickCell(0, 1); clickCell(0, 2);
    eq(W.board.chain.length, 3, "three tiles chained");
    eq(W.board.preview().word, "cat", "preview spells CAT");
    shot("chain");
    clickSubmit();
    eq(W.board.words, 1, "one word");
    check(W.board.score >= 15, "CAT scored: " + W.board.score);
    eq(W.board.chain.length, 0, "chain cleared");
    check(W.board.grid.every((row) => row.every((t) => t)), "board refilled");
    eq(text("#hud-score"), String(W.board.score), "HUD score");
    eq(text("#hud-longest"), "CAT", "HUD longest");
    check(q("#action-text").style.display !== "none" && /CAT/.test(text("#action-text")), "toast shows the word");
    const top = W.save.get("topWords");
    eq([top.length, top[0].word, top[0].mode], [1, "cat", "classic"], "top words recorded");
});

test("classic: tapping back and non-words", () => {
    setRows(CAT);
    clickCell(0, 0); clickCell(0, 1);
    clickCell(0, 0);
    eq(W.board.chain.length, 1, "tapping the previous tile backs up");
    clickCell(2, 2);
    eq(W.board.chain.length, 1, "non-adjacent tile ignored");
    W.board.clearChain();

    const score = W.board.score;
    clickCell(1, 0); clickCell(1, 1); clickCell(1, 2);
    check(!W.board.submit(), "XQZ is not a word");
    eq(W.board.score, score, "no points");
    eq(W.board.streak, 0, "streak broken");
    eq(text("#action-text"), "NOT A WORD", "told why");
});

test("classic: double-click the last tile submits", () => {
    setRows(CAT);
    const words = W.board.words;
    clickCell(0, 0); clickCell(0, 1);
    const p = cellPoint(0, 2);
    click(p.x, p.y);
    click(p.x, p.y);
    frames(2);
    eq(W.board.words, words + 1, "CAT submitted by double-click");
    eq(W.board.chain.length, 0, "chain cleared");
    // Not asserted: String(getSelection()) should be "" here, but the engine
    // selects the toast's text (ENGINE-ISSUES.md, "Double-clicking a canvas").
    window.getSelection().removeAllRanges();
});

test("classic: keyboard cursor, Space, Backspace, Enter", () => {
    setRows(CAT);
    W.board.cursor = { r: 1, c: 0 };
    press("ArrowUp"); frames(1);
    eq([W.board.cursor.r, W.board.cursor.c], [0, 0], "cursor up");
    press(" "); frames(1);
    press("ArrowRight"); frames(1);
    press(" "); frames(1);
    press("ArrowRight"); frames(1);
    press(" "); frames(1);
    eq(W.board.preview().word, "cat", "chained by keyboard");
    press("Backspace"); frames(1);
    eq(W.board.chain.length, 2, "Backspace drops the last tile");
    press(" "); frames(1);
    const words = W.board.words;
    press("Enter"); frames(1);
    eq(W.board.words, words + 1, "Enter submits");
    check(W.board.streak >= 2, "valid words build a streak");
    check(q("#hud-combo-stat").style.display !== "none", "combo shows");
});

test("classic: burning tile on the bottom ends the game", () => {
    setRows(CAT);
    W.board.grid[6][4].burning = true;
    frames(1);
    check(q("#burning-warn").style.display === "block", "danger warning up");
    shot("burning");
    W.board.grid[7][4].burning = true;
    clickCell(0, 0); clickCell(0, 1); clickCell(0, 2);
    clickSubmit();
    check(simUntil(() => W.screen === "gameover", 500, 16), "spire collapsed");
    eq(text("#gameover-title"), "Game Over", "collapse title");
    check(/Doused/.test(text("#gameover-stats")) && /CAT/.test(text("#gameover-stats")), "stats");
    check(q("#burning-warn").style.display === "none", "warning hidden off the board");
    check(W.save.get("hsClassic").some((e) => e.score === W.board.score), "classic score recorded");
    shot("gameover");
});

test("timed: clock runs out", () => {
    startMode("timed");
    eq(text("#hud-extra-label"), "Time", "timed shows the clock");
    eq(text("#hud-extra"), "3:00", "three minutes");
    W.board.timeLeft = 200;
    check(simUntil(() => W.screen === "gameover", 1000, 16), "time up");
    eq(text("#gameover-title"), "Timed Complete!", "timed finish");
});

test("puzzle: target shown, solving it loads the next board", () => {
    startMode("puzzle");
    eq(text("#hud-extra"), "1/20", "puzzle 1 of 20");
    const b = W.board;
    check(b.target.length >= 3, "has a target: " + b.target);
    const hit = L.findWords(b.grid, D, 400, 12).find((f) => f.word === b.target);
    check(hit, "target is on the board");
    shot("puzzle");
    for (const [r, c] of hit.path) clickCell(r, c);
    clickSubmit();
    eq(b.puzzleSolved, 1, "solved one");
    eq(b.puzzleIndex, 1, "next board");
    eq(text("#hud-extra"), "2/20", "HUD advances");
});

test("pause keeps the chain; menu Enter does not leak", () => {
    const b = W.board;
    b.clearChain();
    press("Escape"); frames(1);
    eq(W.screen, "pause", "paused");
    press("Enter"); frames(2);
    eq(W.screen, "playing", "resumed");
    eq(b.chain.length, 0, "resume Enter did not add or submit");
    eq(b.words, 1, "no word played by the menu key");
});

test("high scores: tabs incl. top words", () => {
    W.shell.switchTo("highscores");
    frames(1);
    clickOn('#screen-highscores [data-action="hs-next"]');
    const seen = [];
    for (let i = 0; i < 4; i++) {
        seen.push(q(".hs-tab.active").id);
        if (q(".hs-tab.active").id === "hs-tab-words") check(/CAT/.test(text("#hs-list")), "top words lists CAT");
        clickOn('#screen-highscores [data-action="hs-next"]');
    }
    eq(new Set(seen).size, 4, "four tabs cycle");
    shot("highscores");
});

test("settings: difficulty and volume cycle and persist", () => {
    W.shell.switchTo("settings");
    frames(1);
    const d = W.save.get("difficulty");
    clickOn('[data-action="cycle-difficulty"]');
    check(W.save.get("difficulty") !== d, "difficulty changed");
    eq(text("#opt-difficulty"), ["Easy", "Normal", "Hard"][W.save.get("difficulty")], "label follows");
    const v = W.save.get("sfxVol");
    clickOn('[data-action="cycle-sfx"]');
    check(W.save.get("sfxVol") !== v, "volume changed");
    eq(text("#opt-sfxVol"), String(W.save.get("sfxVol")), "volume label");
    // Leave Normal difficulty for the next run.
    while (W.save.get("difficulty") !== 1) clickOn('[data-action="cycle-difficulty"]');
});

done("wordspire");
