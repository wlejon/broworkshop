// Scripted BlastGrid match: real keyboard gameplay with gliding movement and
// buffered corner turns, bomb fuse timing, blasts stopping at pillars,
// soft-block destruction + power-up reveal + walk-over pickup, chain
// reactions, death by blast, AI danger avoidance, round-over, sudden death,
// match-over and a rematch on a fresh arena.
// Run: scripts/validate.sh games/blastgrid
import { check, press, text, shot } from "/lib/kit/test.js";

advanceTime(200);
const G = window.BLAST;
check(G, 'BLAST test surface exposed');
check(G.screen === 'title', 'boots on the title');
const T = G.TILE;

// Enter on Play starts the match.
press('Enter');
advanceTime(100);
check(G.screen === 'playing', 'Enter on Play starts a match');
const game = G.game;
const world = G.world;
const debug = G.debug;
check(game && world && debug, 'match ready');

// SDL keycodes for held keys (kit press() is a tap).
const KEY = {
    RIGHT: 0x40000000 | 79, LEFT: 0x40000000 | 80,
    DOWN: 0x40000000 | 81, UP: 0x40000000 | 82,
    SPACE: 32, W: 119,
};

// Freeze AI before advancing time so contenders stay on spawn cells.
debug.freezeAI(true);
advanceTime(100);

// --- 1. Arena authoring ------------------------------------------------------

{
    check(world.width === 15 && world.height === 13, 'arena is 15x13');
    for (let x = 0; x < 15; x++) {
        check(world.getTile(x, 0, 0) === T.WALL && world.hasFlag(x, 0, G.FLAG_SOLID), 'top border wall at ' + x);
        check(world.getTile(x, 12, 0) === T.WALL, 'bottom border wall at ' + x);
    }
    // Pillar lattice on (even,even) interior cells; never elsewhere.
    let pillars = 0;
    for (let y = 1; y < 12; y++) {
        for (let x = 1; x < 14; x++) {
            if (x % 2 === 0 && y % 2 === 0) {
                check(world.getTile(x, y, 0) === T.PILLAR, 'pillar at ' + x + ',' + y);
                check(world.hasFlag(x, y, G.FLAG_SOLID), 'pillar solid');
                check(world.getElevation(x, y) === 2, 'pillar elevated');
                pillars++;
            } else {
                check(world.getTile(x, y, 0) !== T.PILLAR && world.getTile(x, y, 0) !== T.WALL,
                    'no wall/pillar at ' + x + ',' + y);
            }
        }
    }
    check(pillars === 30, '6x5 pillar lattice (got ' + pillars + ')');
    // Soft blocks: roughly 60% of the eligible floor, none by the spawns.
    let soft = 0, eligible = 0;
    const spawnZone = new Set();
    for (const s of G.SPAWNS) {
        spawnZone.add(s.x + ',' + s.y);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) spawnZone.add((s.x + dx) + ',' + (s.y + dy));
    }
    for (let y = 1; y < 12; y++) {
        for (let x = 1; x < 14; x++) {
            if (x % 2 === 0 && y % 2 === 0) continue;
            if (spawnZone.has(x + ',' + y)) {
                check(!world.hasFlag(x, y, G.FLAG_SOFT), 'spawn zone clear at ' + x + ',' + y);
                continue;
            }
            eligible++;
            if (world.hasFlag(x, y, G.FLAG_SOFT)) {
                check(world.getTile(x, y, 0) === T.SOFT, 'soft tile matches flag');
                check(world.getElevation(x, y) === 1, 'soft block raised');
                soft++;
            }
        }
    }
    const ratio = soft / eligible;
    check(ratio > 0.45 && ratio < 0.78, 'soft density ~60% (got ' + ratio.toFixed(2) + ')');
    for (const e of game.contenders) {
        const s = G.SPAWNS[e.i];
        check(e.alive && e.cx === s.x && e.cy === s.y, e.name + ' at spawn');
    }
    // HUD: four chips, round clock, powers line (no mojibake).
    check(document.querySelectorAll('#hud-chips .chip').length === 4, 'four contender chips');
    check(text('#chip-0 .cname') === 'YOU', 'first chip is the player');
    check(text('#chip-0 .cwins') === '···', 'no wins yet: three open pips');
    check(text('#hud-timer') === '2:00', 'round clock starts at 2:00');
    check(text('#hud-round') === 'ROUND 1 · FIRST TO 3', 'round line');
    check(text('#hud-powers') === 'BOMBS 1 · RANGE 2 · SPEED 1', 'powers line');
    shot('arena');
}

// --- 2. Keyboard movement: glide + buffered corner turn -----------------------

{
    const h = game.human;
    debug.clearArea(1, 1, 5, 3);            // open corridor right + a side street
    check(h.cx === 1 && h.cy === 1, 'human at (1,1)');

    keyDown(KEY.RIGHT);
    advanceTime(300);                        // ~0.9 cells at speed 3.0
    check(h.px > 1.5, 'moving right under held key (px=' + h.px.toFixed(2) + ')');

    // Still holding RIGHT, press DOWN before (2,1). (2,2) is a pillar, so
    // the turn waits and fires at (3,1) where the side corridor opens.
    keyDown(KEY.DOWN);
    let turned = false, maxCx = 0;
    for (let i = 0; i < 40 && !turned; i++) {
        advanceTime(50);
        maxCx = Math.max(maxCx, h.cx);
        if (h.cy >= 2) turned = true;
    }
    check(turned, 'buffered turn fired');
    check(h.cx === 3, 'turned down exactly at the (3,1) opening (cx=' + h.cx + ')');
    check(maxCx === 3, 'never overshot the corner (maxCx=' + maxCx + ')');
    advanceTime(400);
    check(h.cy >= 3, 'glided down the side corridor (cy=' + h.cy + ')');
    keyUp(KEY.DOWN);
    keyUp(KEY.RIGHT);
    advanceTime(400);                        // finish the in-flight step
    check(!h.moving && h.px === h.cx && h.py === h.cy, 'settled on a cell center');

    // WASD works too (from a cell with a guaranteed open north corridor).
    debug.teleport(0, 3, 3);
    const cy0 = h.cy;
    keyDown(KEY.W);
    advanceTime(700);
    keyUp(KEY.W);
    advanceTime(400);
    check(h.cy < cy0, 'W moved up (' + cy0 + ' -> ' + h.cy + ')');
    debug.teleport(0, 1, 1);
}

// --- 3. Bomb: space to drop, 2s fuse, blast stops at pillars ------------------

{
    const h = game.human;
    check(game.bombs.length === 0, 'no bombs yet');
    keyDown(KEY.SPACE); keyUp(KEY.SPACE);
    advanceTime(50);
    check(game.bombs.length === 1, 'space dropped a bomb');
    const b = game.bombs[0];
    check(b.x === 1 && b.y === 1, 'bomb at the player cell');
    check(world.hasFlag(1, 1, G.FLAG_BOMB), 'bomb cell flagged');
    check(game.dangerAt(1, 1) && game.dangerAt(3, 1) && game.dangerAt(1, 3), 'danger set covers the pending cross');
    check(!game.dangerAt(2, 2), 'diagonal not in danger');
    keyDown(KEY.SPACE); keyUp(KEY.SPACE);
    advanceTime(20);
    check(game.bombs.length === 1, 'bomb cap 1: a second press drops nothing');

    // Walk off the bomb (and out of its range-2 cross) while the fuse burns.
    keyDown(KEY.RIGHT);
    advanceTime(1100);                      // ~3.3 cells -> (4,1)
    keyUp(KEY.RIGHT);
    check(h.cx === 4 && h.cy === 1, 'walked off the bomb to (4,1)');
    check(!game.canEnter(1, 1), 'cannot walk back onto a bomb cell');

    advanceTime(580);                       // t ~= 1.75s: fuse still burning
    check(game.bombs.length === 1, 'fuse not done at ~1.75s');
    advanceTime(400);                       // past 2.0s
    check(game.bombs.length === 0, 'bomb exploded after ~2s fuse');
    check(!world.hasFlag(1, 1, G.FLAG_BOMB), 'bomb flag cleared');
    check(game.fireAt(1, 1) && game.fireAt(2, 1) && game.fireAt(3, 1), 'fire east arm');
    check(game.fireAt(1, 2) && game.fireAt(1, 3), 'fire south arm');
    check(!game.fireAt(4, 1), 'range-2 blast did not reach (4,1)');
    check(h.alive, 'player escaped own blast');
    shot('blast');

    advanceTime(600);                       // linger ~0.45s
    check(!game.fireAt(1, 1), 'fire burned out');
    check(!game.dangerAt(1, 1), 'danger cleared');

    // Pillar containment: a bomb on an (even,odd) cell is boxed by pillars
    // above and below, so the blast only travels the open row.
    debug.clearArea(1, 3, 4, 3);
    debug.spawnBomb(2, 3, 2, { fuse: 0.1 });
    advanceTime(250);
    check(game.fireAt(2, 3) && game.fireAt(1, 3) && game.fireAt(3, 3) && game.fireAt(4, 3), 'blast ran the open row');
    check(!game.fireAt(2, 2) && !game.fireAt(2, 4), 'blast stopped at the pillars');
    check(!game.fireAt(0, 3), 'blast stopped at the border wall');
    check(!game.fireAt(5, 3), 'range respected');
    advanceTime(700);
}

// --- 4. Soft block destruction, power-up reveal, walk-over pickup -------------

{
    const h = game.human;
    debug.teleport(0, 11, 3);               // out of the demolition zone
    debug.clearArea(1, 1, 9, 1);
    debug.setSoft(6, 1);
    debug.setSoft(7, 1);
    debug.setNextDrop('range');             // force a deterministic reveal

    debug.spawnBomb(4, 1, 3, { fuse: 0.1 });
    check(game.dangerAt(6, 1) && !game.dangerAt(7, 1), 'pending blast stops AT the first soft block');
    advanceTime(250);
    check(world.getTile(6, 1, 0) !== T.SOFT && !world.hasFlag(6, 1, G.FLAG_SOFT), 'first soft block destroyed');
    check(world.getElevation(6, 1) === 0, 'destroyed block flattened');
    check(world.getTile(7, 1, 0) === T.SOFT, 'blast stopped: second soft block survives');
    check(game.powerups.length === 1, 'power-up revealed');
    const p = game.powerups[0];
    check(p.x === 6 && p.y === 1 && p.type === 'range', 'forced range power-up at (6,1)');

    advanceTime(700);                       // let the fire die
    shot('powerup');
    debug.teleport(0, 4, 1);
    const r0 = h.range;
    keyDown(KEY.RIGHT);
    advanceTime(900);
    keyUp(KEY.RIGHT);
    check(h.cx >= 6, 'walked onto the power-up cell');
    check(h.range === r0 + 1, 'range grew on pickup (' + r0 + ' -> ' + h.range + ')');
    check(game.powerups.length === 0, 'power-up consumed');
    advanceTime(50);
    check(text('#toast') === '+1 RANGE', 'pickup toast');
    check(text('#hud-powers') === 'BOMBS 1 · RANGE 3 · SPEED 1', 'HUD shows the new range');
    debug.clearArea(7, 1, 7, 1);            // tidy the leftover crate
    debug.teleport(0, 11, 3);
}

// --- 5. Chain reaction --------------------------------------------------------

{
    debug.clearArea(4, 1, 9, 1);
    const a = debug.spawnBomb(5, 1, 2, { fuse: 0.2 });
    const b = debug.spawnBomb(7, 1, 2, { fuse: 60 });
    check(game.bombs.length === 2, 'two bombs staged');
    advanceTime(400);                       // only A's fuse elapses
    check(a.exploded && b.exploded, 'blast touched bomb B: instant sympathetic detonation');
    check(game.bombs.length === 0, 'both bombs gone despite B\'s 60s fuse');
    check(game.fireAt(8, 1) && game.fireAt(9, 1), 'B\'s own blast arms burned (chain, not just removal)');
    advanceTime(700);
    check(!game.fireAt(7, 1), 'fire cleaned up');
}

// --- 6. AI avoids lethal cells --------------------------------------------------

{
    debug.freezeAI(false);
    for (const i of [1, 2, 3]) game.contenders[i].ai.bombCd = 999;   // no reason to bomb
    const iris = game.contenders[2];
    debug.clearArea(5, 5, 9, 7);
    debug.teleport(2, 7, 5);
    advanceTime(100);

    debug.spawnBomb(7, 5, 3, { fuse: 2.0 });   // right under IRIS
    check(game.dangerAt(7, 5), 'bomb cross is danger');
    let vacated = -1;
    for (let t = 0; t < 1900; t += 100) {
        advanceTime(100);
        if (vacated < 0 && !game.dangerAt(Math.round(iris.px), Math.round(iris.py))) vacated = t + 100;
    }
    check(vacated >= 0, 'AI vacated the blast cross before detonation (by ' + vacated + 'ms)');
    advanceTime(800);                       // through the blast + linger
    check(iris.alive, 'AI survived the bomb');
    debug.freezeAI(true);
    advanceTime(100);
}

// --- 7. Death by blast, round over, next round ----------------------------------

{
    const h = game.human;
    debug.clearArea(9, 5, 9, 5);
    debug.teleport(0, 9, 5);
    debug.spawnBomb(9, 5, 1, { fuse: 0.1 });
    advanceTime(300);
    check(!h.alive, 'player killed by the blast');
    advanceTime(100);
    check(document.getElementById('chip-0').classList.contains('dead'), 'HUD chip shows the death');

    check(game.state === 'playing', 'round continues with 3 AIs alive');
    debug.kill(2);
    debug.kill(3);
    advanceTime(1300);                      // resolution delay
    check(game.state === 'roundover', 'last man standing ends the round');
    check(game.winner === game.contenders[1], 'RUBY won the round');
    check(game.contenders[1].wins === 1, 'win recorded');
    check(G.screen === 'roundover', 'round-over screen up');
    check(text('#round-title') === 'RUBY WINS THE ROUND', 'round-over screen names the winner');
    check(text('#round-sub') === 'First to 3  ·  Round 1', 'round-over subtitle');
    check(text('#chip-1 .cwins') === '★··', 'RUBY chip shows one star');
    shot('roundover');

    press('Enter');                          // Next Round
    advanceTime(200);
    check(G.screen === 'playing', 'Enter resumed play');
    check(game.state === 'playing' && game.round === 2, 'Enter started round 2');
    check(h.alive && h.cx === 1 && h.cy === 1, 'player respawned at the corner');
    check(game.bombs.length === 0 && game.powerups.length === 0, 'board state reset');
    check(h.range === G.BASE_RANGE, 'powers reset for the new round');
    let soft = 0;
    for (let y = 1; y < 12; y++)
        for (let x = 1; x < 14; x++)
            if (world.hasFlag(x, y, G.FLAG_SOFT)) soft++;
    check(soft > 30, 'fresh soft blocks rolled (' + soft + ')');
    check(game.contenders[1].wins === 1, 'wins persist across rounds');
    debug.freezeAI(true);
    advanceTime(100);
}

// --- 8. Sudden death: the walls close in ------------------------------------------

{
    debug.teleport(0, 7, 7);
    debug.setTimeLeft(0.2);
    advanceTime(400);
    check(game.sd.active, 'sudden death armed at 0:00');
    check(text('#hud-timer') === 'SUDDEN DEATH', 'HUD flips to sudden death');
    check(text('#announce') === 'SUDDEN DEATH — THE WALLS CLOSE IN', 'sudden-death banner');
    advanceTime(2600);                      // first drop at +0.5s, then every 1s
    check(world.getTile(1, 1, 0) === T.SDWALL && world.hasFlag(1, 1, G.FLAG_SOLID), 'outer ring converting to solid wall');
    check(world.getTile(3, 1, 0) === T.SDWALL, 'spiral marches on (3rd cell down)');
    check(!game.canEnter(1, 1), 'converted cell impassable');
    shot('sudden');
}

// --- 9. Match over + rematch --------------------------------------------------------

{
    debug.setWins(1, 2);                    // RUBY on match point
    debug.kill(0);
    debug.kill(2);
    debug.kill(3);
    advanceTime(1300);
    check(game.state === 'matchover', 'third win ends the match');
    check(game.contenders[1].wins === 3, 'RUBY at 3 wins');
    advanceTime(100);
    check(G.screen === 'gameover', 'match over screen');
    const stats = text('#gameover-stats');
    check(/^RUBY WINS THE MATCH/.test(stats), 'match winner named');
    check(/RUBY: 3 wins/.test(stats) && /YOU: 0 wins/.test(stats), 'per-contender wins listed');
    shot('matchover');

    const oldWorld = world;
    press('Enter');                          // Rematch
    advanceTime(200);
    const fresh = G.game;
    check(G.screen === 'playing', 'rematch is playing');
    check(fresh !== game && G.world !== oldWorld, 'rematch builds a fresh arena');
    check(fresh.state === 'playing' && fresh.round === 1, 'fresh match at round 1');
    for (const e of fresh.contenders) check(e.wins === 0 && e.alive, e.name + ' reset');
    check(document.querySelectorAll('#hud-chips .chip').length === 4, 'chips rebuilt, not duplicated');
}

console.log('BLASTGRID: all checks passed');
