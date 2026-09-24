// Scripted GridKeep session: real click picking + placement, the
// no-walling-off refusal, live distance-field rerouting, a full wave killed
// by towers, splash locality, frost slow, upgrade/sell through the panel, a
// leaked creep, a final-wave victory and a fresh restart.
// Run: scripts/validate.sh games/gridkeep
import { check, press, text, clickOn, shot } from "/lib/kit/test.js";

advanceTime(400);

// The shell boots on the title; Enter starts a run (Play is selected).
press('Enter');
advanceTime(200);

const G = window.GRIDKEEP;
check(G, 'GRIDKEEP test surface exposed');
check(G.screen === 'playing', 'Enter on Play starts the game');
const { game, world } = G;
const F = (x, y) => game.fieldAt(x, y);

// --- 1. Map + routing sanity -------------------------------------------------

check(world.width === 20 && world.height === 14, 'map is 20x14');
check(world.getTile(0, 0, 0) === G.TILE.WATER, 'water border authored');
check(world.getElevation(0, 0) === -1, 'water sits below grade');
check(world.hasFlag(0, 0, G.FLAG_BLOCK), 'water blocked');
check(world.getTile(10, 1, 0) === G.TILE.ROCK, 'rock obstacle at (10,1)');
check(world.hasFlag(10, 1, G.FLAG_BLOCK) && world.hasFlag(10, 1, G.FLAG_NOBUILD), 'rock blocked + unbuildable');
check(world.getTile(15, 1, 0) === G.TILE.EGRASS && world.getElevation(15, 1) === 1, 'elevated grass at (15,1)');
check(world.getTile(G.BASE.x, G.BASE.y, 0) === G.TILE.BASE, 'base tile authored');
for (const s of G.SPAWNS) check(world.getTile(s.x, s.y, 0) === G.TILE.SPAWN, 'spawn tile at ' + s.x + ',' + s.y);

// distanceField from the base reaches the spawns; blocked cells are -1.
check(game.field.length === 20 * 14, 'distance field covers grid');
const f0 = F(1, 6);
check(f0 === 17, 'open-field spawn distance is Manhattan 17 (got ' + f0 + ')');
check(F(10, 1) === -1, 'rock is -1 in field');
check(F(0, 0) === -1, 'water is -1 in field');
check(F(G.BASE.x, G.BASE.y) === 0, 'base is 0 in field');
{
    const path = world.findPath(1, 6, G.BASE.x, G.BASE.y, { blockMask: G.FLAG_BLOCK });
    check(path.length === f0 + 1, 'A* path length matches field distance');
    for (const p of path) check(!world.hasFlag(p.x, p.y, G.FLAG_BLOCK), 'path avoids blocks at ' + p.x + ',' + p.y);
}
shot('map');

// --- 2. Picking + real-click tower placement ----------------------------------

{
    // The stage's screen ray and the cell projection agree across the map.
    for (const [x, y] of [[5, 6], [1, 1], [18, 12], [10, 7]]) {
        const p = G.projectCell(x, y);
        const c = G.cellAt(p.x, p.y);
        check(c && c.x === x && c.y === y, 'pick round-trips cell ' + x + ',' + y + ' (got ' + JSON.stringify(c) + ')');
    }
    check(game.gold === 90, 'start gold 90');
    G.setPlaceType('arrow');
    check(G.placeType === 'arrow', 'arrow armed');
    const p = G.projectCell(5, 6);
    click(p.x, p.y);
    advanceTime(60);
    check(game.towers.length === 1, 'clicked cell placed a tower');
    const t = game.towers[0];
    check(t.x === 5 && t.y === 6 && t.type === 'arrow', 'tower is the arrow at (5,6)');
    check(game.gold === 70, 'gold 90 -> 70');
    check(world.hasFlag(5, 6, G.FLAG_TOWER) && world.hasFlag(5, 6, G.FLAG_BLOCK), 'tower cell flagged');
    check(F(5, 6) === -1, 'tower cell now unreachable in field');
    check(text('#hud-gold') === '70', 'HUD gold updated');
}

// --- 3. Maze wall + live reroute ------------------------------------------------

{
    G.debug.addGold(500);
    // Wall column x=8 from the top down to y=11 ((8,4) is already rock),
    // leaving (8,12) as the only crossing.
    for (const y of [1, 2, 3, 5, 6, 7, 8, 9, 10, 11])
        check(game.placeTower('arrow', 8, y), 'wall tower at (8,' + y + ') placed');
    const f1 = F(1, 6);
    check(f1 === 29, 'detour through (8,12) is 29 steps (got ' + f1 + ')');
    const path = world.findPath(1, 6, G.BASE.x, G.BASE.y, { blockMask: G.FLAG_BLOCK });
    check(path.length === f1 + 1, 'A* reroutes through the gap');
    check(path.some((p) => p.x === 8 && p.y === 12), 'path uses the (8,12) gap');
}

// --- 4. Refused placement: may not wall off the spawns ---------------------------

{
    const chk = game.canPlace('arrow', 8, 12);
    check(!chk.ok && chk.reason === 'blocks', 'closing the gap is vetoed (route check)');
    const goldBefore = game.gold, towersBefore = game.towers.length;
    if (G.placeType !== 'arrow') G.setPlaceType('arrow');   // setPlaceType toggles
    const p = G.projectCell(8, 12);
    click(p.x, p.y);
    advanceTime(48);
    check(game.towers.length === towersBefore, 'refused: no tower appeared');
    check(game.gold === goldBefore, 'refused: gold untouched');
    check(game.lastRefusal && game.lastRefusal.reason === 'blocks' &&
        game.lastRefusal.x === 8 && game.lastRefusal.y === 12, 'refusal recorded with reason');
    check(/wall off/.test(text('#toast')) && document.getElementById('toast').style.display !== 'none',
        'refusal toast shown');
    shot('refused');    // red flash on (8,12)
    check(game.canPlace('arrow', 10, 1).reason === 'terrain', 'rock is unbuildable');
    check(game.canPlace('arrow', 0, 3).reason === 'terrain', 'water is unbuildable');
    check(game.canPlace('arrow', 5, 6).reason === 'occupied', 'occupied cell vetoed');
    check(game.canPlace('cannon', 15, 1).ok, 'elevated grass IS buildable');
}

// --- 5. Wave 1: creeps die to towers, none leak -----------------------------------

{
    game.placeTower('arrow', 6, 10);       // covers the southern corridor
    if (G.placeType) G.setPlaceType(G.placeType);   // disarm (toggle off)
    const goldBefore = game.gold;
    press(' ');                             // Space starts the wave
    advanceTime(20);
    check(game.wave === 1 && game.waveActive, 'Space started wave 1');
    check(/WAVE 1/.test(text('#announce')), 'wave announced');

    let sawProjectile = false, sawCreeps = false, shotTaken = false;
    for (let t = 0; t < 60000 && game.waveActive; t += 500) {
        advanceTime(500);
        sawProjectile = sawProjectile || game.projectiles.length > 0;
        sawCreeps = sawCreeps || game.creeps.length > 0;
        if (!shotTaken && game.creeps.length >= 3 && game.projectiles.length > 0) {
            shot('wave');
            shotTaken = true;
        }
    }
    check(sawCreeps, 'creeps spawned');
    check(sawProjectile, 'towers fired projectiles');
    check(!game.waveActive, 'wave 1 cleared');
    check(game.kills === 6, 'all 6 grubs died to towers (kills=' + game.kills + ')');
    check(game.leaks === 0 && game.lives === 20, 'no leaks, lives intact');
    check(game.gold === goldBefore + 6 * 4 + 18, 'bounties (6x4) + clear bonus (18) banked');
}

// --- 6. Cannon splash hits multiple creeps, with locality ---------------------------

{
    G.debug.freeze(true);
    // Field distances to the base: (13,9)=8 < (12,9)=9 < (12,10)=10, so the
    // cannon targets c; a is 1.0 from the impact (inside the 1.3 splash), b
    // is sqrt(2) away (outside).
    const a = G.debug.spawnCreep('tank', 12, 9);
    const b = G.debug.spawnCreep('tank', 12, 10);
    const c = G.debug.spawnCreep('tank', 13, 9);
    const cannon = game.placeTower('cannon', 11, 10);
    check(cannon, 'cannon placed');
    advanceTime(700);                               // fire + lob (2 cells @ 5.5/s)
    check(c.hp < c.maxHp, 'primary target hit (' + c.hp + '/' + c.maxHp + ')');
    check(a.hp < a.maxHp, 'splash caught the adjacent creep');
    check(b.hp === b.maxHp, 'creep outside splash radius untouched');
    check(c.maxHp - c.hp === 24 && a.maxHp - a.hp === 24, 'full splash damage to both');
    game.sellTower(cannon);
    G.debug.killAll();
    G.debug.freeze(false);
    advanceTime(100);
    check(game.creeps.length === 0, 'splash arena cleaned up');
}

// --- 7. Frost slows creeps ------------------------------------------------------------

{
    const c = G.debug.spawnCreep('normal', 12, 3);
    const frost = game.placeTower('frost', 13, 3);
    check(frost, 'frost tower placed');
    advanceTime(400);                               // first shard lands
    check(game.isSlowed(c), 'creep is chilled');
    check(Math.abs(game.creepSpeed(c) - c.def.speed * 0.5) < 1e-9, 'speed halved');
    const x0 = c.px, y0 = c.py;
    advanceTime(500);
    const moved = Math.hypot(c.px - x0, c.py - y0);
    check(moved > 0.30 && moved < 0.55, 'slowed creep covered ~0.42 cells in 0.5s (got ' + moved.toFixed(3) + ')');
    game.sellTower(frost);
    advanceTime(2200);                              // slow expires (1.6s)
    if (game.creeps.includes(c)) {
        check(!game.isSlowed(c), 'slow expired');
        check(game.creepSpeed(c) === c.def.speed, 'full speed restored');
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
    check(G.selectedTower === t, 'clicking a tower selects it');
    check(!document.getElementById('tower-panel').hidden, 'tower panel shown');
    check(/Arrow Tower/.test(text('#tp-name')), 'panel names the tower');

    const dmg1 = game.towerDamage(t), goldBefore = game.gold;
    clickOn('#btn-upgrade');
    advanceTime(48);
    check(t.level === 2, 'tower upgraded to L2');
    check(game.gold === goldBefore - 20, 'upgrade cost 20g (L1->L2)');
    check(game.towerDamage(t) > dmg1, 'damage rose: ' + dmg1 + ' -> ' + game.towerDamage(t));
    check(t.invested === 40, 'invested tracked');

    // Sell through the panel: the maze opens up and the field shortens live.
    const wallT = game.towerAt(8, 1);
    click(G.projectCell(8, 1).x, G.projectCell(8, 1).y);
    advanceTime(48);
    check(G.selectedTower === wallT, 'wall tower selected');
    const fBefore = F(1, 6);
    const goldBefore2 = game.gold;
    clickOn('#btn-sell');
    advanceTime(48);
    check(!game.towers.includes(wallT), 'sell removed the tower');
    check(G.selectedTower === null && document.getElementById('tower-panel').hidden, 'selection cleared');
    check(game.gold === goldBefore2 + 14, 'refund is 70% of 20g = 14g');
    check(!world.hasFlag(8, 1, G.FLAG_TOWER) && !world.hasFlag(8, 1, G.FLAG_BLOCK), 'sold cell unflagged');
    check(F(8, 1) >= 0, 'sold cell walkable again');
    check(F(1, 6) < fBefore, 'route shortened after sell: ' + fBefore + ' -> ' + F(1, 6));
}

// --- 9. A leaked creep costs lives -------------------------------------------------------

{
    check(game.lives === 20, 'still 20 lives');
    const tank = G.debug.spawnCreep('tank', 16, 6);   // 2 cells from the keep, no towers near
    advanceTime(4000);
    check(!game.creeps.includes(tank), 'tank reached the keep');
    check(game.leaks === 1, 'leak counted');
    check(game.lives === 18, 'tank leak costs 2 lives (20 -> 18)');
    check(text('#hud-lives') === '18', 'HUD lives updated');
}

// --- 10. Final wave -> victory screen ------------------------------------------------------

{
    G.debug.setWave(9);                               // next wave is the 10th = final
    check(game.startNextWave(), 'final wave starts');
    check(game.wave === 10 && game.waveActive, 'wave 10 running');
    for (let t = 0; t < 40000 && game.waveActive; t += 1000) {
        advanceTime(1000);
        G.debug.killAll();                            // the towers get help
    }
    check(!game.waveActive, 'final wave cleared');
    check(game.over && game.won, 'game won');
    check(!game.startNextWave(), 'no waves after victory');
    advanceTime(200);
    check(G.screen === 'gameover', 'victory ends the run');
    check(text('#gameover-title') === 'VICTORY', 'VICTORY title');
    check(document.getElementById('gameover-title').className.includes('victory'), 'victory styling');
    check(/All 10 waves repelled/.test(text('#gameover-stats')), 'victory stats');
    shot('victory');
}

// --- 11. Play Again: a fresh world replaces the old one ------------------------------------

{
    const oldWorld = world;
    press('Enter');                                   // "Play Again" is selected
    advanceTime(200);
    check(G.screen === 'playing', 'restart is playing');
    check(G.world !== oldWorld, 'new TileWorld for the new run');
    check(G.game.gold === 90 && G.game.towers.length === 0 && G.game.wave === 0, 'fresh run state');
    check(G.game.fieldAt(1, 6) === 17, 'fresh map routes open-field again');
    const p = G.projectCell(4, 4);
    const c = G.cellAt(p.x, p.y);
    check(c && c.x === 4 && c.y === 4, 'picking works on the new world');
}

console.log('GRIDKEEP: all checks passed');
