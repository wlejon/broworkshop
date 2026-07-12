// test.js — scripted HexFront battle for bro-headless.
// Run: bro-headless games/hexfront test.js
// Drives real click picking, movement, combat (incl. counterattack, high
// ground, artillery), an AI turn, save/load, and a full victory, with
// deterministic damage assertions.

advanceTime(400);

const H = window.HEXFRONT;
assert(H, 'HEXFRONT debug surface exposed');
const { game, world } = H;
const U = (side, type) => game.units.find(u => u.side === side && u.type === type);

// --- 1. Map + grid-search sanity --------------------------------------------

assert(world.width === 13 && world.height === 11, 'map is 13x11');
assert(world.getTile(6, 3, 0) === 5, 'water tile authored at (6,3)');
assert(world.hasFlag(6, 3, H.FLAG_WATER), 'water flagged impassable');
assert(world.getElevation(6, 3) === -1, 'water sits below grade');
assert(world.getElevation(9, 0) === 1, 'hill elevated at (9,0)');
assert(world.getElevation(10, 1) === 2, 'mountain elevated at (10,1)');

assert(game.aliveUnits('red').length === 4, '4 red units');
assert(game.aliveUnits('blue').length === 4, '4 blue units');
assert(world.objectCount(game.unitKinds.infantry) === 4, 'infantry instances placed (2 per side)');
assert(world.objectCount(game.unitKinds.tank) === 2, 'tank instances placed');
assert(world.objectCount(game.unitKinds.artillery) === 2, 'artillery instances placed');

// Engine A* avoids water and beats straight-line distance.
{
    const path = world.findPath(2, 5, 11, 5, { blockMask: H.FLAG_WATER, costs: [1, 1, 2, 2, 3, 1] });
    assert(path.length > 0, 'cross-map path exists');
    for (const p of path)
        assert(world.getTile(p.x, p.y, 0) !== 5, 'path avoids water at ' + p.x + ',' + p.y);
    assert(path.length - 1 >= world.cellDistance(2, 5, 11, 5), 'path >= hex distance');
}
// distanceField marks water unreachable.
{
    const field = world.distanceField(
        game.aliveUnits('blue').map(u => ({ x: u.x, y: u.y })), { blockMask: H.FLAG_WATER });
    assert(field.length === 13 * 11, 'distance field covers grid');
    assert(field[3 * 13 + 6] === -1, 'water cell is -1 in distance field');
    assert(field[5 * 13 + 2] > 0, 'red tank cell has finite distance to blue');
}
// cellsInRange / cellLine behave hex-style.
{
    const disk = world.cellsInRange(6, 5, 2);
    assert(disk.length > 0, 'cellsInRange non-empty');
    for (const c of disk)
        assert(world.cellDistance(6, 5, c.x, c.y) <= 2, 'cellsInRange within radius');
    const line = world.cellLine(0, 0, 5, 3);
    assert(line.length >= 6, 'cellLine spans endpoints');
}

screenshot('test-1-initial.png');

// --- 2. Real mouse picking: click the red infantry at (1,3) -----------------

{
    const p = H.projectCell(1, 3);
    click(p.x, p.y);
    advanceTime(60);
    assert(H.selection, 'click selected a unit');
    assert(H.selection.unit.type === 'infantry' && H.selection.unit.side === 'red',
        'clicked unit is the red infantry');
    assert(H.selection.unit.x === 1 && H.selection.unit.y === 3, 'selected the (1,3) unit');

    // Movement range: terrain-cost Dijkstra, water excluded.
    const reach = H.selection.reach;
    assert(reach.has('2,3'), 'adjacent grass reachable');
    assert(reach.has('4,3'), 'grass 3 steps away reachable (move 3)');
    assert(!reach.has('5,3'), 'water not reachable');
    assert(!reach.has('6,3'), 'far water not reachable');
    assert(reach.get('4,3').cost === 3, 'terrain cost bookkeeping (3 grass steps)');
    screenshot('test-2-moverange.png');
}

// --- 3. Move along the A* route ----------------------------------------------

{
    const inf = U('red', 'infantry');
    H.actOnCell(4, 3);
    advanceTime(1200);   // move animation
    assert(inf.x === 4 && inf.y === 3, 'infantry moved to (4,3)');
    assert(inf.acted, 'unit spent after moving with no targets');
    assert(!H.selection, 'selection cleared after acting');
}

// --- 4. Melee combat + counterattack (deterministic numbers) ----------------

{
    const tank = U('red', 'tank');                       // (2,5), hp 14, atk 6
    const bInf = game.units.find(u => u.side === 'blue' && u.type === 'infantry');
    H.debug.place(bInf, 3, 5);                           // grass, adjacent to tank
    H.actOnCell(2, 5);
    assert(H.selection && H.selection.unit === tank, 'tank selected');
    assert(H.selection.targets.includes(bInf), 'adjacent enemy is attackable pre-move');
    H.actOnCell(3, 5);                                   // attack in place
    advanceTime(400);
    // dmg = round(6 * (0.5 + 0.5*14/14)) - 0 grass = 6; counter from 4/10 inf = round(4*0.7) = 3
    assert(bInf.hp === 4, 'tank dealt 6 (got ' + bInf.hp + ' hp left)');
    assert(tank.hp === 11, 'infantry countered for 3 (tank at ' + tank.hp + ')');
    assert(tank.acted, 'tank spent after attacking');
}

// --- 5. High-ground bonus (+25%) ---------------------------------------------

{
    const rInf = game.units.filter(u => u.side === 'red' && u.type === 'infantry')[1];
    const bInf2 = game.units.filter(u => u.side === 'blue' && u.type === 'infantry')[1];
    H.debug.place(rInf, 10, 0);                          // hill, elev 1
    H.debug.place(bInf2, 11, 0);                         // grass, elev 0, adjacent
    H.debug.resetActed('red');
    H.actOnCell(10, 0);
    H.actOnCell(11, 0);
    advanceTime(400);
    // dmg = round(4 * 1.0 * 1.25) = 5 downhill; counter = round(4*0.75) - 1 hill = 2 uphill
    assert(bInf2.hp === 5, 'high ground dealt 5 (+25%), got hp ' + bInf2.hp);
    assert(rInf.hp === 8, 'uphill counter dealt 2 (hill defense), got hp ' + rInf.hp);
}

// --- 6. Artillery: range 2-3, min range, no counter ---------------------------

{
    const rArty = U('red', 'artillery');
    const bTank = U('blue', 'tank');
    const bArty = U('blue', 'artillery');
    H.debug.place(rArty, 4, 9);
    H.debug.place(bTank, 6, 9);                          // distance 2
    H.debug.place(bArty, 5, 9);                          // distance 1 — inside min range
    H.debug.resetActed('red');
    H.actOnCell(4, 9);
    assert(H.selection && H.selection.unit === rArty, 'artillery selected');
    assert(H.selection.targets.includes(bTank), 'range-2 enemy targetable');
    assert(!H.selection.targets.includes(bArty), 'adjacent enemy inside min range NOT targetable');
    screenshot('test-3-artillery.png');
    H.actOnCell(6, 9);
    advanceTime(400);
    assert(bTank.hp === 8, 'artillery dealt 6 at range 2, tank hp ' + bTank.hp);
    assert(rArty.hp === 8, 'no counterattack against ranged attacker');
}

// --- 7. AI turn ----------------------------------------------------------------

{
    const redHpBefore = game.aliveUnits('red').reduce((s, u) => s + u.hp, 0);
    const bluePosBefore = game.aliveUnits('blue').map(u => u.x + ',' + u.y).join('|');
    H.endTurn();
    assert(H.aiRunning || game.turn.side === 'blue', 'blue turn started');
    advanceTime(5000);
    assert(!H.aiRunning, 'AI finished');
    assert(game.turn.side === 'red', 'back to red after AI');
    assert(game.turn.number === 2, 'turn counter advanced');
    const redHpAfter = game.aliveUnits('red').reduce((s, u) => s + u.hp, 0);
    const bluePosAfter = game.aliveUnits('blue').map(u => u.x + ',' + u.y).join('|');
    assert(bluePosAfter !== bluePosBefore || redHpAfter < redHpBefore,
        'AI moved and/or attacked');
    assert(redHpAfter < redHpBefore, 'AI landed at least one attack');
    screenshot('test-4-after-ai.png');
}

// --- 8. Save / load --------------------------------------------------------------

{
    const tank = U('red', 'tank');
    game.save();
    const savedX = tank.x, savedY = tank.y, savedHp = tank.hp, savedTurn = game.turn.number;
    H.debug.place(tank, 0, 0);
    H.debug.setHp(tank, 1);
    assert(game.load(), 'load succeeds');
    const tank2 = game.units.find(u => u.side === 'red' && u.type === 'tank');
    assert(tank2.x === savedX && tank2.y === savedY, 'tank position restored');
    assert(tank2.hp === savedHp, 'tank hp restored');
    assert(game.turn.number === savedTurn, 'turn restored');
    assert(world.getTile(6, 3, 0) === 5, 'terrain grid round-tripped through world.save/load');
    // world.load() drops object kinds (engine paper-cut, see game.js); the
    // game re-registers them — instances must be back.
    assert(world.objectCount(game.unitKinds.infantry) > 0, 'unit instances restored after load');
}

// --- 9. Fight to victory ----------------------------------------------------------

{
    const tank = game.units.find(u => u.side === 'red' && u.type === 'tank');
    for (const b of game.aliveUnits('blue')) {
        H.debug.setHp(b, 1);
        H.debug.place(b, 3, 1);          // free grass cell
        H.debug.place(tank, 2, 1);       // adjacent
        game.attack(tank, b);
        assert(!b.alive, 'weakened ' + b.type + ' destroyed');
    }
    assert(game.aliveUnits('blue').length === 0, 'blue army eliminated');
    assert(game.turn.over && game.turn.winner === 'red', 'red wins');
    assert(world.objectCount(game.unitKinds.tank) === 1, 'only the red tank instance remains');
    advanceTime(200);
    const banner = document.getElementById('banner');
    assert(banner.style.display !== 'none', 'end banner shown');
    assert(document.getElementById('banner-text').textContent === 'VICTORY', 'VICTORY banner');
    screenshot('test-5-victory.png');
}

console.log('HEXFRONT: all assertions passed');
