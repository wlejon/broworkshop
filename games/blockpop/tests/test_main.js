// Blockpop headless test: the pure rules, the session (pick / place /
// cascade / brake / top-out / modes) and the real UI: menus, keyboard,
// mouse, HUD, settings, game over and per-mode high scores.
// Run: scripts/validate.sh games/blockpop
import { check, eq, press, text, q, frames, shot } from "/lib/kit/test.js";
import { recordScore } from "/lib/arcade/scores.js";

advanceTime(200);
const H = window.__blockpop;
check(H && H.rules && H.Board, '__blockpop exposed');
const R = H.rules;
check(H.screen === 'title', 'boots on the title');

// Start from a clean save: the app's .storage.json survives between runs.
for (const [k, v] of Object.entries({ highScore: 0, riseSpeed: 10, colorBlind: false, sfxVol: 80, hsClassic: [], hsSprint: [], hsPuzzle: [] })) {
    H.save.set(k, v);
}
H.save.save();
H.prefs.riseSpeed = 10;
H.prefs.colorBlind = false;
shot('title');

const mk = (color, special) => ({ color, special: special || 0 });
const fillCol = (col, arr) => { for (const c of arr) col.push(mk(c)); };
const quiet = () => ({ cue() {}, pop() {}, toast() {}, shake() {} });

// ── Rules ──────────────────────────────────────────────────────────────────

{
    const eb = R.makeEmptyBoard();
    eb[0].push(mk(1)); eb[1].push(mk(1)); eb[2].push(mk(1));
    eb[3].push(mk(2));
    const chains = R.findChains(eb);
    check(chains.length >= 1, 'found a chain');
    eq(chains.reduce((n, g) => n + g.cells.length, 0), 3, 'chain covers 3 cells');
    eq(chains[0].color, 1, 'chain colour');
    const res = R.popChains(eb, chains);
    eq(res.removed, 3, 'popChains removed 3');
    check(eb[0].length === 0 && eb[1].length === 0 && eb[2].length === 0, 'columns emptied');
    eq(eb[3].length, 1, 'col 3 untouched');

    const eb2 = R.makeEmptyBoard();
    fillCol(eb2[0], [5, 5, 5]);
    const cc = R.findChains(eb2);
    check(cc.length === 1 && cc[0].cells.length === 3, 'single-column stack of 3 is one chain');

    const eb3 = R.makeEmptyBoard();
    eb3[0].push(mk(1)); eb3[0].push(null); eb3[0].push(mk(2));
    R.settle(eb3);
    check(eb3[0].length === 2 && eb3[0][0].color === 1 && eb3[0][1].color === 2, 'settle compacts, keeps order');

    const eb4 = R.makeEmptyBoard();
    R.spawnRow(eb4, R.makeRng(42));
    for (let c = 0; c < R.COLS; c++) eq(eb4[c].length, 1, 'spawnRow fed col ' + c);

    check(R.findChains(R.seedBoard(5, R.makeRng(7))).length === 0, 'seedBoard starts chain-free');

    // Star sweeps every block of its colour.
    const eb5 = R.makeEmptyBoard();
    eb5[0].push(mk(1, R.SPECIAL_STAR)); eb5[1].push(mk(1)); eb5[2].push(mk(1));
    eb5[4].push(mk(1));
    const ex = R.expandSpecials(eb5, R.findChains(eb5)[0]);
    check(ex.cells.some(([c, r]) => c === 4 && r === 0), 'star sweeps the lone colour-1 at col 4');

    // Bomb pops its 3x3.
    const eb6 = R.makeEmptyBoard();
    for (let c = 0; c < 3; c++) eb6[c].push(mk(2));
    eb6[0].push(mk(3, R.SPECIAL_BOMB)); eb6[1].push(mk(3)); eb6[2].push(mk(3));
    const ex6 = R.expandSpecials(eb6, R.findChains(eb6)[0]);
    check(ex6.cells.some(([c, r]) => c === 1 && r === 0), 'bomb reaches col 1 row 0');

    // Rainbow is a wildcard.
    const eb7 = R.makeEmptyBoard();
    eb7[0].push(mk(1)); eb7[1].push(mk(5, R.SPECIAL_RAINBOW)); eb7[2].push(mk(1));
    const g7 = R.findChains(eb7);
    check(g7.length >= 1 && g7[0].cells.length >= 3, 'rainbow joins a colour-1 chain');

    eq(R.groupScore(3), 150, '3-pop = 150');
    eq(R.groupScore(4), 300, '4-pop = 300');
    eq(R.groupScore(5), 600, '5-pop = 600');
    eq(R.groupScore(7), 1100, '7-pop = 600 + 2 x 250');

    const p0 = R.puzzleBoard(0), p0b = R.puzzleBoard(0);
    eq(JSON.stringify(p0.board), JSON.stringify(p0b.board), 'puzzle layouts are deterministic');
    eq(p0.moves, 8, 'puzzle 0 move budget');
}

// ── Session (no DOM) ───────────────────────────────────────────────────────

{
    // Pick exposes a chain; placing elsewhere resolves it.
    const b = new H.Board({ mode: 'classic', fx: quiet(), rand: R.makeRng(3) });
    const craft = R.makeEmptyBoard();
    fillCol(craft[0], [5, 6, 7, 4]);
    fillCol(craft[1], [5, 6, 7, 3]);
    fillCol(craft[2], [5, 6, 3, 7]);
    fillCol(craft[3], [5, 6, 7, 3]);
    fillCol(craft[4], [5, 6, 7, 4]);
    fillCol(craft[5], [5, 6, 7, 2]);
    fillCol(craft[6], [5, 6, 7, 4]);
    fillCol(craft[7], [5, 6, 7, 2]);
    eq(R.findChains(craft).length, 0, 'crafted board starts chain-free');
    b.setBoard(craft);
    b.moveTo(2);
    check(b.pick(), 'pick the top of col 2');
    check(R.findChains(b.board).length >= 1, 'picking lines up the colour-3 tops');
    eq(b.score, 0, 'nothing pops until a drop');
    b.moveTo(4);
    check(b.place(), 'place on col 4');
    check(b.score > 0, 'drop resolved the chain (score ' + b.score + ')');
    check(b.board[1].length === 3 && b.board[3].length === 3, 'cols 1 and 3 lost their tops');

    // Held stack: up to 3, shuffle reverses.
    const s = new H.Board({ fx: quiet(), rand: R.makeRng(9) });
    const tall = R.makeEmptyBoard();
    fillCol(tall[0], [1, 2, 3, 4, 5]);
    s.setBoard(tall);
    s.moveTo(0);
    check(s.pick() && s.pick() && s.pick(), 'three picks');
    check(!s.pick(), 'a fourth pick is refused (HOLD_MAX 3)');
    eq(s.carrier.held.map((x) => x.color).join(''), '543', 'held front-last');
    s.shuffleHeld();
    eq(s.carrier.held.map((x) => x.color).join(''), '345', 'shuffle reverses the held stack');

    // Cascade: popping the tops reveals another chain, scored x2.
    const cz = new H.Board({ fx: quiet() });
    const casc = R.makeEmptyBoard();
    for (let c = 0; c < 3; c++) fillCol(casc[c], [4, 1]);
    for (let c = 3; c < 8; c++) fillCol(casc[c], [6, 7]);
    cz.setBoard(casc);
    cz.resolveChains();
    check(cz.bestChain >= 2, 'cascade depth 2 (got ' + cz.bestChain + ')');
    check(cz.score >= 450, 'cascade score 150 + 150x2 (got ' + cz.score + ')');

    // Rise: a row per 1/RISE_RATE seconds; the brake slows it to 20%.
    const rz = new H.Board({ fx: quiet(), rand: R.makeRng(11) });
    const h0 = rz.board[0].length;
    for (let t = 0; t < 5000; t += 50) rz.tick(50);
    eq(rz.board[0].length, h0, 'no row before ~5.25 s');
    for (let t = 0; t < 400; t += 50) rz.tick(50);
    check(rz.rise < 0.1 && rz.board[0].length !== h0, 'a row rose by 5.4 s (rise ' + rz.rise.toFixed(3) + ')');
    const before = rz.rise;
    check(rz.emergencyBrake(), 'brake engages');
    check(!rz.emergencyBrake(), 'brake is on cooldown');
    rz.tick(1000);
    check(Math.abs((rz.rise - before) - 0.2 * 1 * (8 / 42)) < 1e-6, 'brake slows the rise to 20%');

    // Top-out.
    const tz = new H.Board({ fx: quiet() });
    const full = R.makeEmptyBoard();
    for (let c = 0; c < R.COLS; c++) for (let r = 0; r < R.ROWS; r++) full[c].push(mk(1 + ((c + r) % R.NUM_COLORS)));
    tz.setBoard(full);
    tz.tick(16);
    check(tz.over && tz.ended(), 'top-out ends the game');

    // Puzzle: moves count down; running out ends it.
    const pz = new H.Board({ mode: 'puzzle', fx: quiet() });
    eq(pz.extraHud(), '8', 'puzzle HUD shows moves');
    pz.movesLeft = 1;
    pz.moveTo(0); pz.pick();
    pz.moveTo(7); pz.place();
    check(pz.ended(), 'puzzle out of moves ends the run');

    // Sprint: 100 pops finishes.
    const sp = new H.Board({ mode: 'sprint', fx: quiet() });
    eq(sp.extraHud(), '100', 'sprint HUD shows blocks left');
    sp.blocksPopped = 99;
    const three = R.makeEmptyBoard();
    for (let c = 0; c < 3; c++) three[c].push(mk(2));
    sp.setBoard(three);
    sp.resolveChains();
    check(sp.finished, 'sprint finishes at 100 pops');
}

// ── UI: title -> mode select -> classic ────────────────────────────────────

press('Enter');
frames(2);
eq(H.screen, 'modeselect', 'PLAY opens mode select');
shot('modeselect');
press('Enter');
frames(3);
eq(H.screen, 'playing', 'CLASSIC starts a run');
const run = H.run;
eq(run.board.mode, 'classic', 'classic session');
eq(text('#hud-extra-label'), 'NEXT RISE', 'classic HUD label');
check(/^\d+\.\ds$/.test(text('#hud-extra')), 'next-rise readout (' + text('#hud-extra') + ')');

// Keyboard: move, pick, drop.
{
    const b = run.board;
    const col0 = b.carrier.col;
    press('ArrowRight');
    frames(1);
    eq(b.carrier.col, col0 + 1, 'Right moves the carrier');
    press('a');
    frames(1);
    eq(b.carrier.col, col0, 'A moves it back');
    const h = b.board[col0].length;
    press('ArrowDown');
    frames(1);
    check(b.carrier.held.length === 1 && b.board[col0].length === h - 1, 'Down picks the top block');
    press('ArrowRight');
    press('s');
    frames(1);
    eq(b.carrier.held.length, 0, 'S drops it');
    press(' ');
    frames(1);
    check(b.brake > 0, 'Space brakes');
    frames(2);
    eq(text('#action-text'), 'BRAKE', 'brake toast');
    check(q('#action-text').style.display === 'block', 'toast visible');
    frames(70);
    check(q('#action-text').style.display === 'none', 'toast hides after 900 ms');
}

// Mouse: click a column to move there and pick; wheel shuffles.
{
    const b = run.board;
    const L = run.layout;
    const view = H.shell.api.view;
    const cr = view.canvas.getBoundingClientRect();
    const sx = cr.width / view.width(), sy = cr.height / view.height();
    const colX = (c) => cr.left + (L.ox + c * L.cell + L.cell / 2) * sx;
    const y = cr.top + (L.oy + L.h / 2) * sy;
    const tall = R.makeEmptyBoard();
    for (let c = 0; c < R.COLS; c++) fillCol(tall[c], c % 2 ? [1, 2, 3, 4] : [5, 6, 7, 1]);
    b.setBoard(tall);
    b.carrier.held.length = 0;
    click(colX(6), y);
    frames(1);
    check(b.carrier.col === 6 && b.carrier.held.length === 1, 'click moved to col 6 and picked');
    click(colX(6), y);
    frames(1);
    check(b.carrier.col === 6 && b.carrier.held.length === 0, 'second click dropped');
    b.pick(); b.pick();
    const order = b.carrier.held.map((x) => x.color).join('');
    wheel(colX(6), y, 1);
    frames(1);
    eq(b.carrier.held.map((x) => x.color).join(''), order.split('').reverse().join(''), 'wheel shuffles the held stack');
    b.carrier.held.length = 0;
}

// Cascade on the live run: CHAIN toast + combo HUD.
{
    const b = run.board;
    const casc = R.makeEmptyBoard();
    for (let c = 0; c < 3; c++) fillCol(casc[c], [4, 1]);
    for (let c = 3; c < 8; c++) fillCol(casc[c], [6, 7]);
    b.setBoard(casc);
    b.resolveChains();
    frames(2);
    eq(text('#cascade-text'), 'x2 CHAIN', 'cascade toast');
    eq(text('#hud-combo'), 'x2', 'combo HUD shows the chain');
    check(q('#hud-combo').style.display === 'block', 'combo HUD visible');
    check(run.flashes.length > 0, 'pop flashes queued');
    shot('play');
}

// Top-out -> game over with stats, NEW BEST and a classic leaderboard entry.
{
    const b = run.board;
    const full = R.makeEmptyBoard();
    for (let c = 0; c < R.COLS; c++) for (let r = 0; r < R.ROWS; r++) full[c].push(mk(1 + ((c + r) % R.NUM_COLORS)));
    b.setBoard(full);
    frames(3);
    eq(H.screen, 'gameover', 'top-out shows game over');
    eq(text('#screen-gameover .overlay-title'), 'GAME OVER', 'game over title');
    const stats = text('#gameover-stats');
    check(/Mode\s+CLASSIC/.test(stats) && /Score\s+\d+/.test(stats), 'stats block');
    check(/NEW BEST/.test(stats), 'first score is a new best');
    const hs = H.save.get('hsClassic');
    check(hs.length >= 1 && hs[0].score === b.score, 'classic leaderboard recorded');
    shot('gameover');
}

// High scores screen from game over: classic tab first, then sprint.
{
    press('ArrowDown');
    press('Enter');
    frames(2);
    eq(H.screen, 'highscores', 'high scores from game over');
    check(q('#hs-tab-classic').className === 'hs-tab active', 'classic tab active');
    check(/^1\. \d+  Lv\d+  x\d+/.test(text('#hs-list')), 'classic row format (' + text('#hs-list').split('\n')[0] + ')');
    press('Enter');   // NEXT MODE
    frames(1);
    check(q('#hs-tab-sprint').className === 'hs-tab active', 'sprint tab next');
    eq(text('#hs-list'), 'No scores yet', 'no sprint times yet');
    press('ArrowDown');
    press('Enter');   // BACK
    frames(2);
    eq(H.screen, 'title', 'back to title');
}

// Settings: rise speed cycles 1.0 -> 1.1, colour-blind toggles, live prefs.
{
    press('ArrowDown'); press('ArrowDown'); press('ArrowDown');
    press('Enter');
    frames(2);
    eq(H.screen, 'settings', 'settings screen');
    eq(text('#opt-riseSpeed'), '1.0', 'rise speed 1.0x');
    eq(text('#opt-colorBlind'), 'OFF', 'colour-blind off');
    press('Enter');
    frames(1);
    eq(text('#opt-riseSpeed'), '1.1', 'rise speed cycles');
    eq(H.prefs.riseSpeed, 11, 'rise pref applied');
    press('ArrowDown');
    press('Enter');
    frames(1);
    eq(text('#opt-colorBlind'), 'ON', 'colour-blind toggles');
    check(H.prefs.colorBlind === true, 'colour-blind pref applied');
    shot('settings');
    press('Enter');   // back OFF
    press('ArrowUp');
    for (let i = 0; i < 15; i++) press('Enter');   // 1.1 -> ... -> 1.0
    eq(text('#opt-riseSpeed'), '1.0', 'rise speed wraps 2.0 -> 0.5 -> 1.0');
    press('Escape');
    frames(2);
}

// Sprint: finishing records a time, ranked fastest first.
{
    H.shell.switchTo('modeselect');
    frames(1);
    press('ArrowDown');
    press('Enter');
    frames(3);
    eq(H.screen, 'playing', 'sprint started');
    const b = H.board;
    eq(b.mode, 'sprint', 'sprint session');
    eq(text('#hud-extra-label'), 'LEFT', 'sprint HUD label');
    b.blocksPopped = 99;
    const three = R.makeEmptyBoard();
    for (let c = 0; c < 3; c++) three[c].push(mk(2));
    b.setBoard(three);
    b.resolveChains();
    frames(3);
    eq(H.screen, 'gameover', 'sprint complete ends the run');
    eq(text('#screen-gameover .overlay-title'), 'SPRINT COMPLETE!', 'sprint complete title');
    const hs = H.save.get('hsSprint');
    check(hs.length === 1 && hs[0].time === Math.floor(b.time), 'sprint time recorded');
    H.save.set('hsSprint', [{ time: 999999, level: 1, score: 0 }].concat(hs));
    recordScore(H.save, 'hsSprint', { time: 5, level: 1, score: 0 }, 10, (a, b2) => a.time - b2.time);
    eq(H.save.get('hsSprint')[0].time, 5, 'sprint board ranks fastest first');
    eq(H.save.get('hsSprint')[2].time, 999999, 'slowest last');
}

// Puzzle via mode select, then Play Again restarts the same mode.
{
    H.shell.switchTo('modeselect');
    frames(1);
    press('ArrowDown'); press('ArrowDown');
    press('Enter');
    frames(3);
    eq(H.board.mode, 'puzzle', 'puzzle session');
    eq(text('#hud-extra-label'), 'MOVES', 'puzzle HUD label');
    eq(text('#hud-extra'), '8', 'puzzle moves');
    const first = H.board;
    press('Escape');
    frames(1);
    eq(H.screen, 'pause', 'Esc pauses');
    press('ArrowDown');
    press('Enter');   // RESTART
    frames(2);
    check(H.board !== first && H.board.mode === 'puzzle', 'restart keeps the mode with a fresh session');
}

console.log('blockpop tests passed.');
