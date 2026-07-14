// test.js — scripted BlastGrid session for bro-headless.
// Run: bro-headless games/blastgrid test.js
// Drives real keyboard gameplay: gliding movement with buffered corner turns,
// bomb fuse timing, blast propagation stopping at pillars, soft-block
// destruction + power-up reveal + walk-over pickup, chain reactions, death by
// blast, AI danger avoidance, round-over / rematch, and sudden death.

advanceTime(200);
const G = window.BLAST;
assert(G, 'BLAST debug surface exposed');
const { game, world, debug } = G;
const T = G.TILE;

// Arcade shell starts on title; enter a run so keyboard hits update().
if (G.shell && !G.shell.getRun()) G.shell.startRun();
advanceTime(200);

// SDL keycodes for the headless keyDown/keyUp helpers.
// Arrows are 0x40000000 | scancode; printable keys are their ASCII code.
const KEY = {
    RIGHT: 0x40000000 | 79, LEFT: 0x40000000 | 80,
    DOWN: 0x40000000 | 81, UP: 0x40000000 | 82,
    SPACE: 32, ENTER: 13, W: 119, A: 97, S: 115, D: 100,
};

debug.freezeAI(true);        // mechanics first; the AI gets its own group
advanceTime(400);

// --- 1. Arena authoring ------------------------------------------------------

{
    assert(world.width === 15 && world.height === 13, 'arena is 15x13');
    // Border ring is solid wall.
    for (let x = 0; x < 15; x++) {
        assert(world.getTile(x, 0, 0) === T.WALL && world.hasFlag(x, 0, G.FLAG_SOLID),
            'top border wall at ' + x);
        assert(world.getTile(x, 12, 0) === T.WALL, 'bottom border wall at ' + x);
    }
    // Pillar lattice on (even,even) interior cells; never elsewhere.
    let pillars = 0;
    for (let y = 1; y < 12; y++) {
        for (let x = 1; x < 14; x++) {
            if (x % 2 === 0 && y % 2 === 0) {
                assert(world.getTile(x, y, 0) === T.PILLAR, 'pillar at ' + x + ',' + y);
                assert(world.hasFlag(x, y, G.FLAG_SOLID), 'pillar solid');
                assert(world.getElevation(x, y) === 2, 'pillar elevated');
                pillars++;
            } else {
                assert(world.getTile(x, y, 0) !== T.PILLAR && world.getTile(x, y, 0) !== T.WALL,
                    'no wall/pillar at ' + x + ',' + y);
            }
        }
    }
    assert(pillars === 30, '6x5 pillar lattice (got ' + pillars + ')');
    // Soft blocks: roughly 60% of the eligible floor.
    let soft = 0, eligible = 0;
    const spawnZone = new Set();
    for (const s of G.SPAWNS) {
        spawnZone.add(s.x + ',' + s.y);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
            spawnZone.add((s.x + dx) + ',' + (s.y + dy));
    }
    for (let y = 1; y < 12; y++) {
        for (let x = 1; x < 14; x++) {
            if (x % 2 === 0 && y % 2 === 0) continue;
            if (spawnZone.has(x + ',' + y)) {
                assert(!world.hasFlag(x, y, G.FLAG_SOFT), 'spawn zone clear at ' + x + ',' + y);
                continue;
            }
            eligible++;
            if (world.hasFlag(x, y, G.FLAG_SOFT)) {
                assert(world.getTile(x, y, 0) === T.SOFT, 'soft tile matches flag');
                assert(world.getElevation(x, y) === 1, 'soft block raised');
                soft++;
            }
        }
    }
    const ratio = soft / eligible;
    assert(ratio > 0.45 && ratio < 0.78, 'soft density ~60% (got ' + ratio.toFixed(2) + ')');
    // All four contenders standing at their corners, alive.
    for (const e of game.contenders) {
        const s = G.SPAWNS[e.i];
        assert(e.alive && e.cx === s.x && e.cy === s.y, e.name + ' at spawn');
    }
    screenshot('test-1-arena.png');
}

// --- 2. Keyboard movement: glide + buffered corner turn -----------------------

{
    const h = game.human;
    debug.clearArea(1, 1, 5, 3);            // open corridor right + a side street
    assert(h.cx === 1 && h.cy === 1, 'human at (1,1)');

    // Hold RIGHT: glide cell to cell.
    keyDown(KEY.RIGHT);
    advanceTime(300);                        // ~0.9 cells at speed 3.0
    assert(h.px > 1.5, 'moving right under held key (px=' + h.px.toFixed(2) + ')');

    // While still holding RIGHT (and before reaching (2,1)), press DOWN.
    // (2,2) is a pillar so at (2,1) the turn is impossible and the glide
    // continues; at (3,1) the side corridor opens and the buffered turn
    // fires — classic corner glide.
    keyDown(KEY.DOWN);
    let turned = false, maxCx = 0;
    for (let i = 0; i < 40 && !turned; i++) {
        advanceTime(50);
        maxCx = Math.max(maxCx, h.cx);
        if (h.cy >= 2) turned = true;
    }
    assert(turned, 'buffered turn fired');
    assert(h.cx === 3, 'turned down exactly at the (3,1) opening (cx=' + h.cx + ')');
    assert(maxCx === 3, 'never overshot the corner (maxCx=' + maxCx + ')');
    advanceTime(400);
    assert(h.cy >= 3, 'glided down the side corridor (cy=' + h.cy + ')');
    keyUp(KEY.DOWN);
    keyUp(KEY.RIGHT);
    advanceTime(400);                        // finish the in-flight step
    assert(!h.moving && h.px === h.cx && h.py === h.cy, 'settled on a cell center');

    // WASD works too (from a cell with a guaranteed open north corridor).
    debug.teleport(0, 3, 3);
    const cy0 = h.cy;
    keyDown(KEY.W);
    advanceTime(700);
    keyUp(KEY.W);
    advanceTime(400);
    assert(h.cy < cy0, 'W moved up (' + cy0 + ' -> ' + h.cy + ')');
    debug.teleport(0, 1, 1);
}

// --- 3. Bomb: space to drop, 2s fuse, blast stops at pillars ------------------

{
    const h = game.human;
    assert(game.bombs.length === 0, 'no bombs yet');
    keyDown(KEY.SPACE); keyUp(KEY.SPACE);
    advanceTime(50);
    assert(game.bombs.length === 1, 'space dropped a bomb');
    const b = game.bombs[0];
    assert(b.x === 1 && b.y === 1, 'bomb at the player cell');
    assert(world.hasFlag(1, 1, G.FLAG_BOMB), 'bomb cell flagged');
    assert(game.dangerAt(1, 1) && game.dangerAt(3, 1) && game.dangerAt(1, 3),
        'danger set covers the pending cross');
    assert(!game.dangerAt(2, 2), 'diagonal not in danger');

    // Walk off the bomb (and out of its range-2 cross) while the fuse burns.
    keyDown(KEY.RIGHT);
    advanceTime(1100);                      // ~3.3 cells -> (4,1)
    keyUp(KEY.RIGHT);
    assert(h.cx === 4 && h.cy === 1, 'walked off the bomb to (4,1)');
    assert(!game.canEnter(1, 1), 'cannot walk back onto a bomb cell');

    advanceTime(600);                       // t ~= 1.75s: fuse still burning
    assert(game.bombs.length === 1, 'fuse not done at ~1.75s');
    advanceTime(400);                       // past 2.0s
    assert(game.bombs.length === 0, 'bomb exploded after ~2s fuse');
    assert(!world.hasFlag(1, 1, G.FLAG_BOMB), 'bomb flag cleared');
    assert(game.fireAt(1, 1) && game.fireAt(2, 1) && game.fireAt(3, 1), 'fire east arm');
    assert(game.fireAt(1, 2) && game.fireAt(1, 3), 'fire south arm');
    assert(!game.fireAt(4, 1), 'range-2 blast did not reach (4,1)');
    assert(h.alive, 'player escaped own blast');
    screenshot('test-2-blast.png');

    advanceTime(600);                       // linger ~0.45s
    assert(!game.fireAt(1, 1), 'fire burned out');
    assert(!game.dangerAt(1, 1), 'danger cleared');

    // Pillar containment: a bomb on an (even,odd) cell is boxed by pillars
    // above and below — the blast only travels the open row.
    debug.clearArea(1, 3, 4, 3);
    debug.spawnBomb(2, 3, 2, { fuse: 0.1 });
    advanceTime(250);
    assert(game.fireAt(2, 3) && game.fireAt(1, 3) && game.fireAt(3, 3) && game.fireAt(4, 3),
        'blast ran the open row');
    assert(!game.fireAt(2, 2) && !game.fireAt(2, 4), 'blast stopped at the pillars');
    assert(!game.fireAt(0, 3), 'blast stopped at the border wall');
    assert(!game.fireAt(5, 3), 'range respected');
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
    assert(game.dangerAt(6, 1) && !game.dangerAt(7, 1),
        'pending blast stops AT the first soft block');
    advanceTime(250);
    assert(world.getTile(6, 1, 0) !== T.SOFT && !world.hasFlag(6, 1, G.FLAG_SOFT),
        'first soft block destroyed');
    assert(world.getElevation(6, 1) === 0, 'destroyed block flattened');
    assert(world.getTile(7, 1, 0) === T.SOFT, 'blast stopped: second soft block survives');
    assert(game.powerups.length === 1, 'power-up revealed');
    const p = game.powerups[0];
    assert(p.x === 6 && p.y === 1 && p.type === 'range', 'forced range power-up at (6,1)');

    advanceTime(700);                       // let the fire die
    screenshot('test-3-powerup.png');
    debug.teleport(0, 4, 1);
    const r0 = h.range;
    keyDown(KEY.RIGHT);
    advanceTime(900);
    keyUp(KEY.RIGHT);
    assert(h.cx >= 6, 'walked onto the power-up cell');
    assert(h.range === r0 + 1, 'range grew on pickup (' + r0 + ' -> ' + h.range + ')');
    assert(game.powerups.length === 0, 'power-up consumed');
    debug.clearArea(7, 1, 7, 1);            // tidy the leftover crate
    debug.teleport(0, 11, 3);
}

// --- 5. Chain reaction --------------------------------------------------------

{
    debug.clearArea(4, 1, 9, 1);
    const a = debug.spawnBomb(5, 1, 2, { fuse: 0.2 });
    const b = debug.spawnBomb(7, 1, 2, { fuse: 60 });
    assert(game.bombs.length === 2, 'two bombs staged');
    advanceTime(400);                       // only A's fuse elapses
    assert(a.exploded && b.exploded, 'blast touched bomb B: instant sympathetic detonation');
    assert(game.bombs.length === 0, 'both bombs gone despite B\'s 60s fuse');
    assert(game.fireAt(8, 1) && game.fireAt(9, 1),
        'B\'s own blast arms burned (chain, not just removal)');
    advanceTime(700);
    assert(!game.fireAt(7, 1), 'fire cleaned up');
}

// --- 6. AI avoids lethal cells --------------------------------------------------

{
    debug.freezeAI(false);
    // Park the others; give them no reason to bomb.
    for (const i of [1, 3]) game.contenders[i].ai.bombCd = 999;
    game.contenders[2].ai.bombCd = 999;
    const iris = game.contenders[2];
    debug.clearArea(5, 5, 9, 7);
    debug.teleport(2, 7, 5);
    advanceTime(100);

    debug.spawnBomb(7, 5, 3, { fuse: 2.0 });   // right under IRIS
    assert(game.dangerAt(7, 5), 'bomb cross is danger');
    let vacated = -1;
    for (let t = 0; t < 1900; t += 100) {
        advanceTime(100);
        if (vacated < 0 && !game.dangerAt(Math.round(iris.px), Math.round(iris.py)))
            vacated = t + 100;
    }
    assert(vacated >= 0, 'AI vacated the blast cross before detonation (by ' + vacated + 'ms)');
    advanceTime(800);                       // through the blast + linger
    assert(iris.alive, 'AI survived the bomb');
    debug.freezeAI(true);
    advanceTime(100);
}

// --- 7. Death by blast, round over, rematch -------------------------------------

{
    const h = game.human;
    debug.clearArea(9, 5, 9, 5);
    debug.teleport(0, 9, 5);
    debug.spawnBomb(9, 5, 1, { fuse: 0.1 });
    advanceTime(300);
    assert(!h.alive, 'player killed by the blast');
    advanceTime(100);
    assert(document.getElementById('chip-0').classList.contains('dead'),
        'HUD chip shows the death');

    assert(game.state === 'playing', 'round continues with 3 AIs alive');
    debug.kill(2);
    debug.kill(3);
    advanceTime(1300);                      // resolution delay
    assert(game.state === 'roundover', 'last man standing ends the round');
    assert(game.winner === game.contenders[1], 'RUBY won the round');
    assert(game.contenders[1].wins === 1, 'win recorded');
    advanceTime(100);
    const roundTitle = document.getElementById('round-title');
    assert(roundTitle && roundTitle.textContent.includes('RUBY'),
        'round-over screen names the winner');
    screenshot('test-4-roundover.png');

    keyDown(KEY.ENTER); keyUp(KEY.ENTER);
    advanceTime(200);
    assert(game.state === 'playing' && game.round === 2, 'Enter started round 2');
    assert(game.human.alive && game.human.cx === 1 && game.human.cy === 1,
        'player respawned at the corner');
    assert(game.bombs.length === 0 && game.powerups.length === 0, 'board state reset');
    assert(game.human.range === G.BASE_RANGE, 'powers reset for the new round');
    let soft = 0;
    for (let y = 1; y < 12; y++)
        for (let x = 1; x < 14; x++)
            if (world.hasFlag(x, y, G.FLAG_SOFT)) soft++;
    assert(soft > 30, 'fresh soft blocks rolled (' + soft + ')');
    assert(game.contenders[1].wins === 1, 'wins persist across rounds');
    debug.freezeAI(true);
    advanceTime(100);
}

// --- 8. Sudden death: the walls close in ------------------------------------------

{
    debug.teleport(0, 7, 7);
    debug.setTimeLeft(0.2);
    advanceTime(400);
    assert(game.sd.active, 'sudden death armed at 0:00');
    assert(document.getElementById('hud-timer').textContent === 'SUDDEN DEATH',
        'HUD flips to sudden death');
    advanceTime(2600);                      // first drop at +0.5s, then every 1s
    assert(world.getTile(1, 1, 0) === T.SDWALL && world.hasFlag(1, 1, G.FLAG_SOLID),
        'outer ring converting to solid wall');
    assert(world.getTile(3, 1, 0) === T.SDWALL, 'spiral marches on (3rd cell down)');
    assert(!game.canEnter(1, 1), 'converted cell impassable');
    screenshot('test-5-sudden.png');
}

// --- 9. Match over + full reset ------------------------------------------------------

{
    debug.setWins(1, 2);                    // RUBY on match point
    debug.kill(0);
    debug.kill(2);
    debug.kill(3);
    advanceTime(1300);
    assert(game.state === 'matchover', 'third win ends the match');
    assert(game.contenders[1].wins === 3, 'RUBY at 3 wins');
    advanceTime(100);
    const stats = document.getElementById('gameover-stats');
    assert(stats && stats.textContent.includes('MATCH'), 'match gameover text shown');
    screenshot('test-6-matchover.png');

    keyDown(KEY.ENTER); keyUp(KEY.ENTER);
    advanceTime(200);
    assert(game.state === 'playing' && game.round === 1, 'fresh match started');
    for (const e of game.contenders)
        assert(e.wins === 0 && e.alive, e.name + ' reset');
}

console.log('BLASTGRID: all assertions passed');
