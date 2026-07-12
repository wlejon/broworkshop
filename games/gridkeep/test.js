// test.js — scripted GridKeep session for bro-headless.
// Run: bro-headless games/gridkeep test.js
// Drives real click picking + placement, the no-walling-off refusal, live
// distance-field rerouting, a full wave killed by towers, splash locality,
// frost slow, upgrade/sell, a leaked creep, and a final-wave victory.

advanceTime(400);

const G = window.GRIDKEEP;
assert(G, 'GRIDKEEP debug surface exposed');
const { game, world } = G;
const F = (x, y) => game.fieldAt(x, y);

// --- 1. Map + routing sanity -------------------------------------------------

assert(world.width === 20 && world.height === 14, 'map is 20x14');
assert(world.getTile(0, 0, 0) === G.TILE.WATER, 'water border authored');
assert(world.getElevation(0, 0) === -1, 'water sits below grade');
assert(world.hasFlag(0, 0, G.FLAG_BLOCK), 'water blocked');
assert(world.getTile(10, 1, 0) === G.TILE.ROCK, 'rock obstacle at (10,1)');
assert(world.hasFlag(10, 1, G.FLAG_BLOCK) && world.hasFlag(10, 1, G.FLAG_NOBUILD),
    'rock blocked + unbuildable');
assert(world.getTile(15, 1, 0) === G.TILE.EGRASS && world.getElevation(15, 1) === 1,
    'elevated grass at (15,1)');
assert(world.getTile(G.BASE.x, G.BASE.y, 0) === G.TILE.BASE, 'base tile authored');
for (const s of G.SPAWNS)
    assert(world.getTile(s.x, s.y, 0) === G.TILE.SPAWN, 'spawn tile at ' + s.x + ',' + s.y);

// distanceField from the base reaches the spawns; blocked cells are -1.
assert(game.field.length === 20 * 14, 'distance field covers grid');
const f0 = F(1, 6);
assert(f0 === 17, 'open-field spawn distance is Manhattan 17 (got ' + f0 + ')');
assert(F(10, 1) === -1, 'rock is -1 in field');
assert(F(0, 0) === -1, 'water is -1 in field');
assert(F(G.BASE.x, G.BASE.y) === 0, 'base is 0 in field');

// findPath agrees and avoids blocked cells.
{
    const path = world.findPath(1, 6, G.BASE.x, G.BASE.y, { blockMask: G.FLAG_BLOCK });
    assert(path.length === f0 + 1, 'A* path length matches field distance');
    for (const p of path)
        assert(!world.hasFlag(p.x, p.y, G.FLAG_BLOCK), 'path avoids blocks at ' + p.x + ',' + p.y);
}
screenshot('test-1-map.png');

// --- 2. Real-click tower placement --------------------------------------------

{
    assert(game.gold === 90, 'start gold 90');
    G.setPlaceType('arrow');
    assert(G.placeType === 'arrow', 'arrow armed');
    const p = G.projectCell(5, 6);
    click(p.x, p.y);
    advanceTime(60);
    assert(game.towers.length === 1, 'clicked cell placed a tower');
    const t = game.towers[0];
    assert(t.x === 5 && t.y === 6 && t.type === 'arrow', 'tower is the arrow at (5,6)');
    assert(game.gold === 70, 'gold 90 -> 70');
    assert(world.hasFlag(5, 6, G.FLAG_TOWER) && world.hasFlag(5, 6, G.FLAG_BLOCK),
        'tower cell flagged');
    assert(F(5, 6) === -1, 'tower cell now unreachable in field');
    assert(document.getElementById('hud-gold').textContent === '70', 'HUD gold updated');
}

// --- 3. Maze wall + live reroute ------------------------------------------------

{
    G.debug.addGold(500);
    // Wall column x=8 from the top down to y=11 ((8,4) is already rock),
    // leaving (8,12) as the only crossing.
    for (const y of [1, 2, 3, 5, 6, 7, 8, 9, 10, 11]) {
        const t = game.placeTower('arrow', 8, y);
        assert(t, 'wall tower at (8,' + y + ') placed');
    }
    const f1 = F(1, 6);
    assert(f1 > f0, 'wall lengthened the route: ' + f0 + ' -> ' + f1);
    assert(f1 === 29, 'detour through (8,12) is 29 steps (got ' + f1 + ')');
    const path = world.findPath(1, 6, G.BASE.x, G.BASE.y, { blockMask: G.FLAG_BLOCK });
    assert(path.length === f1 + 1, 'A* reroutes through the gap');
    assert(path.some(p => p.x === 8 && p.y === 12), 'path uses the (8,12) gap');
}

// --- 4. Refused placement: may not wall off the spawns ---------------------------

{
    const chk = game.canPlace('arrow', 8, 12);
    assert(!chk.ok && chk.reason === 'blocks', 'closing the gap is vetoed (route check)');
    const goldBefore = game.gold, towersBefore = game.towers.length;
    if (G.placeType !== 'arrow') G.setPlaceType('arrow');   // (setPlaceType toggles)
    const p = G.projectCell(8, 12);
    click(p.x, p.y);
    advanceTime(48);
    assert(game.towers.length === towersBefore, 'refused: no tower appeared');
    assert(game.gold === goldBefore, 'refused: gold untouched');
    assert(game.lastRefusal && game.lastRefusal.reason === 'blocks'
        && game.lastRefusal.x === 8 && game.lastRefusal.y === 12,
        'refusal recorded with reason');
    screenshot('test-2-refused.png');    // red flash on (8,12)
    // Terrain + gold vetoes too
    assert(game.canPlace('arrow', 10, 1).reason === 'terrain', 'rock is unbuildable');
    assert(game.canPlace('arrow', 0, 3).reason === 'terrain', 'water is unbuildable');
    assert(game.canPlace('arrow', 5, 6).reason === 'occupied', 'occupied cell vetoed');
    assert(game.canPlace('cannon', 15, 1).ok, 'elevated grass IS buildable');
}

// --- 5. Wave 1: creeps die to towers, none leak -----------------------------------

{
    game.placeTower('arrow', 6, 10);       // covers the southern corridor
    if (G.placeType) G.setPlaceType(G.placeType);   // disarm placement mode (toggle off)
    const goldBefore = game.gold;
    const started = game.startNextWave();
    assert(started && game.wave === 1 && game.waveActive, 'wave 1 started');

    let sawProjectile = false, sawCreeps = false, shot = false;
    for (let t = 0; t < 60000 && game.waveActive; t += 500) {
        advanceTime(500);
        sawProjectile = sawProjectile || game.projectiles.length > 0;
        sawCreeps = sawCreeps || game.creeps.length > 0;
        if (!shot && game.creeps.length >= 3 && game.projectiles.length > 0) {
            screenshot('test-3-wave.png');
            shot = true;
        }
    }
    assert(sawCreeps, 'creeps spawned');
    assert(sawProjectile, 'towers fired projectiles');
    assert(!game.waveActive, 'wave 1 cleared');
    assert(game.kills === 6, 'all 6 grubs died to towers (kills=' + game.kills + ')');
    assert(game.leaks === 0, 'no leaks');
    assert(game.lives === 20, 'lives intact');
    assert(game.gold === goldBefore + 6 * 4 + 18, 'bounties (6x4) + clear bonus (18) banked');
}

// --- 6. Cannon splash hits multiple creeps, with locality ---------------------------

{
    G.debug.freeze(true);
    // Field distances to the base: (13,9)=8 < (12,9)=9 < (12,10)=10, so the
    // cannon unambiguously targets c; a is 1.0 from the impact (inside the
    // 1.3 splash), b is sqrt(2) away (outside).
    const a = G.debug.spawnCreep('tank', 12, 9);
    const b = G.debug.spawnCreep('tank', 12, 10);
    const c = G.debug.spawnCreep('tank', 13, 9);
    const cannon = game.placeTower('cannon', 11, 10);
    assert(cannon, 'cannon placed');
    advanceTime(700);                               // fire + lob (2 cells @ 5.5/s)
    assert(c.hp < c.maxHp, 'primary target hit (' + c.hp + '/' + c.maxHp + ')');
    assert(a.hp < a.maxHp, 'splash caught the adjacent creep');
    assert(b.hp === b.maxHp, 'creep outside splash radius untouched');
    assert(c.maxHp - c.hp === 24 && a.maxHp - a.hp === 24, 'full splash damage to both');
    game.sellTower(cannon);
    G.debug.killAll();
    G.debug.freeze(false);
    advanceTime(100);
    assert(game.creeps.length === 0, 'splash arena cleaned up');
}

// --- 7. Frost slows creeps ------------------------------------------------------------

{
    const c = G.debug.spawnCreep('normal', 12, 3);
    const frost = game.placeTower('frost', 13, 3);
    assert(frost, 'frost tower placed');
    advanceTime(400);                               // first shard lands
    assert(game.isSlowed(c), 'creep is chilled');
    assert(Math.abs(game.creepSpeed(c) - c.def.speed * 0.5) < 1e-9, 'speed halved');
    const x0 = c.px, y0 = c.py;
    advanceTime(500);
    const moved = Math.hypot(c.px - x0, c.py - y0);
    assert(moved > 0.30 && moved < 0.55,
        'slowed creep covered ~0.42 cells in 0.5s (got ' + moved.toFixed(3) + ')');
    game.sellTower(frost);
    advanceTime(2200);                              // slow expires (1.6s)
    if (game.creeps.includes(c)) {
        assert(!game.isSlowed(c), 'slow expired');
        assert(game.creepSpeed(c) === c.def.speed, 'full speed restored');
    }
    G.debug.killAll();
    advanceTime(100);
}

// --- 8. Upgrade + sell via the real UI -------------------------------------------------

{
    const t = game.towerAt(5, 6);
    const p = G.projectCell(5, 6);
    click(p.x, p.y);                                // select the tower
    advanceTime(48);
    assert(G.selectedTower === t, 'clicking a tower selects it');
    const panel = document.getElementById('tower-panel');
    assert(panel.style.display !== 'none', 'tower panel shown');

    const dmg1 = game.towerDamage(t), goldBefore = game.gold;
    const r = document.getElementById('btn-upgrade').getBoundingClientRect();
    click(r.x + r.width / 2, r.y + r.height / 2);
    advanceTime(48);
    assert(t.level === 2, 'tower upgraded to L2');
    assert(game.gold === goldBefore - 20, 'upgrade cost 20g (L1->L2)');
    assert(game.towerDamage(t) > dmg1, 'damage rose: ' + dmg1 + ' -> ' + game.towerDamage(t));
    assert(t.invested === 40, 'invested tracked');

    // Sell a wall tower — the maze opens up and the field shortens live.
    const wallT = game.towerAt(8, 1);
    const fBefore = F(1, 6);
    const goldBefore2 = game.gold;
    assert(game.sellTower(wallT), 'sell succeeds');
    assert(game.gold === goldBefore2 + 14, 'refund is 70% of 20g = 14g');
    assert(!world.hasFlag(8, 1, G.FLAG_TOWER) && !world.hasFlag(8, 1, G.FLAG_BLOCK),
        'sold cell unflagged');
    assert(F(8, 1) >= 0, 'sold cell walkable again');
    assert(F(1, 6) < fBefore, 'route shortened after sell: ' + fBefore + ' -> ' + F(1, 6));
}

// --- 9. A leaked creep costs lives -------------------------------------------------------

{
    assert(game.lives === 20, 'still 20 lives');
    const tank = G.debug.spawnCreep('tank', 16, 6);   // 2 cells from the keep, no towers near
    advanceTime(4000);
    assert(!game.creeps.includes(tank), 'tank reached the keep');
    assert(game.leaks === 1, 'leak counted');
    assert(game.lives === 18, 'tank leak costs 2 lives (20 -> 18)');
    assert(document.getElementById('hud-lives').textContent === '18', 'HUD lives updated');
}

// --- 10. Final wave -> victory banner ------------------------------------------------------

{
    G.debug.setWave(9);                               // next wave is the 10th = final
    assert(game.startNextWave(), 'final wave starts');
    assert(game.wave === 10 && game.waveActive, 'wave 10 running');
    for (let t = 0; t < 40000 && game.waveActive; t += 1000) {
        advanceTime(1000);
        G.debug.killAll();                            // the towers get help
    }
    assert(!game.waveActive, 'final wave cleared');
    assert(game.over && game.won, 'game won');
    assert(!game.startNextWave(), 'no waves after victory');
    advanceTime(200);
    const banner = document.getElementById('banner');
    assert(banner.style.display !== 'none', 'banner shown');
    assert(banner.className === 'victory', 'victory styling');
    assert(document.getElementById('banner-text').textContent === 'VICTORY', 'VICTORY text');
    screenshot('test-4-victory.png');
}

console.log('GRIDKEEP: all assertions passed');
