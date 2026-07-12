// test.js — scripted DeepDelve session for bro-headless.
// Run: bro-headless games/deepdelve test.js
// Covers: procedural generation + connectivity (components()==1), blob47
// autotile config, multi-elevation ramps, fog-of-war transitions with real
// LOS blocking, exact bump combat, all four monster archetypes, traps
// (hidden + searched), doors (passability + LOS + autotile restyle), items /
// inventory, stairs descent across all floors, save->load round trip (with
// the load() kind re-registration workaround), death and victory.

advanceTime(400);
const G = window.DELVE;
assert(G, 'DELVE debug surface exposed');
const { game, world } = G;
const dbg = G.debug;
const T = G.TILE, F = G.FLAG;
const W = G.MAP_W, H = G.MAP_H;
const idx = (x, y) => y * W + x;

// SDL keycodes for the headless keyDown/keyUp helpers.
const KEY = {
    RIGHT: 0x40000000 | 79, LEFT: 0x40000000 | 80,
    DOWN: 0x40000000 | 81, UP: 0x40000000 | 82,
    SPACE: 32, ENTER: 13, Q: 113, E: 101,
};
function tap(k) { keyDown(k); keyUp(k); advanceTime(40); }

dbg.newRun(12345);
advanceTime(200);

// --- 1. Generation: rooms, connectivity, elevation, autotile ------------------

{
    assert(world.width === W && world.height === H, 'grid is 40x30');
    assert(G.blobVariants.length === 47, 'blob47 variant table has exactly 47 entries');
    assert(game.rooms.length >= 8, 'enough rooms (' + game.rooms.length + ')');
    assert(game.walkableComponents() === 1, 'floor 1 is one connected walkable region');
    assert(game.doors.length >= 3, 'doors generated (' + game.doors.length + ')');
    assert(game.monsters.length >= 6, 'monsters generated (' + game.monsters.length + ')');
    assert(game.items.length >= 6, 'items generated (' + game.items.length + ')');

    // Player starts on the up-stairs of the spawn room.
    assert(game.player.x === game.spawn.x && game.player.y === game.spawn.y, 'player at spawn');
    assert(world.getTile(game.spawn.x, game.spawn.y, 0) === T.STAIRS_UP, 'spawn is the up-stairs');
    assert(game.stairsDown && world.getTile(game.stairsDown.x, game.stairsDown.y, 0) === T.STAIRS_DOWN,
        'down-stairs exist on floor 1');

    // Multi-elevation: some open cells sit above 0, and every open<->open
    // 4-adjacency differs by at most one level (the ramp guarantee).
    let maxElev = 0, badSteps = 0;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (!world.hasFlag(x, y, F.OPEN)) continue;
            const e = world.getElevation(x, y);
            maxElev = Math.max(maxElev, e);
            for (const [dx, dy] of [[1, 0], [0, 1]]) {
                const nx = x + dx, ny = y + dy;
                if (nx >= W || ny >= H || !world.hasFlag(nx, ny, F.OPEN)) continue;
                if (Math.abs(e - world.getElevation(nx, ny)) > 1) badSteps++;
            }
        }
    }
    assert(maxElev >= 1, 'multi-elevation rooms present (max ' + maxElev + ')');
    assert(badSteps === 0, 'no walkable step exceeds one level (' + badSteps + ' bad)');

    // Wall cells tower above their local floor.
    const d0 = game.doors[0];
    let wallSeen = false;
    for (let y = 0; y < H && !wallSeen; y++)
        for (let x = 0; x < W && !wallSeen; x++)
            if (world.hasFlag(x, y, F.WALL) && world.getElevation(x, y) >= 4) wallSeen = true;
    assert(wallSeen, 'walls are elevated');
    assert(d0 && world.hasFlag(d0.x, d0.y, F.DOOR), 'door flag set on generated door');
    screenshot('test-1-spawn.png');
}

// --- 2. Fog of war: unseen -> visible -> remembered, LOS blocked by walls -----

{
    const p = game.player;
    assert(game.fog[idx(p.x, p.y)] === 2, 'player cell visible');

    let visCount = 0, unseenInRange = 0, unseenTotal = 0;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const f = game.fog[idx(x, y)];
            if (f === 2) visCount++;
            if (f === 0) unseenTotal++;
            const dx = x - p.x, dy = y - p.y;
            const inRange = Math.abs(dx) <= G.FOV_R && Math.abs(dy) <= G.FOV_R &&
                dx * dx + dy * dy <= G.FOV_R * G.FOV_R + 4;
            if (!inRange) {
                assert(f !== 2, 'nothing visible beyond FOV range at ' + x + ',' + y);
                continue;
            }
            if (f === 0) {
                unseenInRange++;
                // Unseen despite being in range => its own sight line must hit
                // a blocker strictly before arriving.
                const line = world.cellLine(p.x, p.y, x, y);
                let blocked = false;
                for (let i = 1; i < line.length - 1; i++)
                    if (game.blocksLOS(line[i].x, line[i].y)) { blocked = true; break; }
                assert(blocked, 'unseen in-range cell ' + x + ',' + y + ' has a blocked sight line');
            }
        }
    }
    assert(visCount > 15, 'a useful area is visible (' + visCount + ')');
    assert(unseenInRange > 0, 'walls actually hide in-range cells (' + unseenInRange + ')');
    assert(unseenTotal > 800, 'most of the dungeon starts unseen');

    // Tint compositor mirrors fog: visible cell white, unseen near-black.
    const tv = G.appliedTints.get(idx(p.x, p.y));
    assert(tv && tv[0] === 1 && tv[1] === 1, 'visible cell tinted white');
    let unseenCell = null;
    for (let i = 0; i < game.fog.length && !unseenCell; i++)
        if (game.fog[i] === 0) unseenCell = i;
    const tu = G.appliedTints.get(unseenCell);
    assert(tu && tu[0] < 0.1, 'unseen cell tinted near-black');

    // Move: cells left behind flip visible -> remembered (never back to unseen).
    const before = new Set();
    for (let i = 0; i < game.fog.length; i++) if (game.fog[i] === 2) before.add(i);
    // Step somewhere legal.
    let dir = null;
    for (const [k, d] of [['RIGHT', [1, 0]], ['LEFT', [-1, 0]], ['DOWN', [0, 1]], ['UP', [0, -1]]])
        if (game.canEnter(p.x + d[1 - 1], p.y + d[1]) && !game.monsterAt(p.x + d[0], p.y + d[1])) { dir = k; break; }
    assert(dir, 'a legal first step exists');
    tap(KEY[dir]);
    let demoted = 0;
    for (const i of before) {
        assert(game.fog[i] !== 0, 'seen cell never returns to unseen');
        if (game.fog[i] === 1) demoted++;
    }
    assert(game.turn === 1, 'move consumed a turn');
    screenshot('test-2-fog.png');
}

// --- 3. Multi-elevation beauty shot -------------------------------------------

{
    let best = game.rooms[0];
    for (const r of game.rooms) if (r.elev > best.elev) best = r;
    dbg.teleport(best.cx, best.cy);
    advanceTime(600);          // camera glide + torch settle
    screenshot('test-3-elevation.png');
}

// --- 4. Combat: exact bump damage both ways ------------------------------------

{
    dbg.clearMonsters();
    dbg.carve(2, 2, 15, 13);   // open test arena
    game.items.splice(0, game.items.length,
        ...game.items.filter(it => it.x > 15 || it.y > 13 || it.x < 2 || it.y < 2));
    dbg.teleport(8, 8);
    advanceTime(40);

    const rat = dbg.spawnMonster('rat', 9, 8, { awake: true });
    const hp0 = game.player.hp;
    tap(KEY.RIGHT);            // bump-attack
    assert(rat.hp === 5 - 3, 'player bump deals atk-def=3 (rat at ' + rat.hp + ')');
    assert(game.player.hp === hp0 - 2, 'adjacent rat counter-hits for 2');
    assert(game.player.x === 8 && game.player.y === 8, 'bump-attack does not move the player');
    const kills0 = game.kills;
    tap(KEY.RIGHT);            // kill
    assert(game.monsters.length === 0, 'rat slain');
    assert(game.kills === kills0 + 1, 'kill counted');
    assert(game.player.hp === hp0 - 2, 'dead rat gets no counter-swing');
    assert(game.msgs.some(m => m.text.includes('You hit the giant rat for 3')), 'combat log line');

    // Bumping a wall consumes no turn.
    dbg.setWall(1, 8);         // guarantee a wall (the cell may have been a room)
    dbg.teleport(2, 8);
    const t0 = game.turn;
    tap(KEY.LEFT);
    assert(game.turn === t0 && game.player.x === 2, 'wall bump: no move, no turn');
}

// --- 5. Monster archetypes -------------------------------------------------------

{
    // Chaser closes distance via findPath, one step per turn.
    dbg.clearMonsters();
    dbg.teleport(8, 8);
    const rat = dbg.spawnMonster('rat', 14, 8, { awake: true });
    for (let i = 0; i < 3; i++) tap(KEY.SPACE);
    assert(world.cellDistance(rat.x, rat.y, 8, 8) === 3,
        'chaser closed from 6 to 3 in 3 turns (at ' + rat.x + ',' + rat.y + ')');

    // Pack converges via the shared distanceField, without stacking.
    dbg.clearMonsters();
    const wolves = [
        dbg.spawnMonster('wolf', 4, 4, { awake: true }),
        dbg.spawnMonster('wolf', 12, 4, { awake: true }),
        dbg.spawnMonster('wolf', 4, 12, { awake: true }),
    ];
    const d0 = wolves.map(w => world.cellDistance(w.x, w.y, 8, 8));
    for (let i = 0; i < 6; i++) tap(KEY.SPACE);
    const d1 = wolves.map(w => world.cellDistance(w.x, w.y, 8, 8));
    for (let i = 0; i < 3; i++)
        assert(d1[i] <= 2 && d1[i] < d0[i], 'wolf ' + i + ' converged (' + d0[i] + ' -> ' + d1[i] + ')');
    const cells = new Set(wolves.map(w => w.x + ',' + w.y));
    assert(cells.size === 3, 'pack members never stack');

    // Ranged: shoots at range with clear LOS, holds position.
    dbg.clearMonsters();
    dbg.teleport(8, 8);
    const arch = dbg.spawnMonster('archer', 13, 8, { awake: true });
    let hp = game.player.hp;
    tap(KEY.SPACE);
    assert(game.player.hp === hp - 3, 'arrow hits for 3 at range 5');
    assert(arch.x === 13 && arch.y === 8, 'archer holds position while shooting');
    assert(game.lastShot && game.lastShot.from.x === 13, 'shot recorded');

    // Too close -> retreats instead of shooting.
    dbg.teleport(11, 8);
    hp = game.player.hp;
    tap(KEY.SPACE);
    assert(world.cellDistance(arch.x, arch.y, 11, 8) === 3, 'archer retreated to min range');
    assert(game.player.hp === hp, 'no shot on the retreat turn');

    // At held range it fires again.
    hp = game.player.hp;
    const ax = arch.x, ay = arch.y;
    tap(KEY.SPACE);
    assert(game.player.hp === hp - 3, 'archer fires from held range');
    assert(arch.x === ax && arch.y === ay, 'and does not move');

    // LOS blocked by a wall -> no shot; it repositions instead.
    dbg.setWall(12, 8);
    hp = game.player.hp;
    const bx = arch.x, by = arch.y;
    tap(KEY.SPACE);
    assert(game.player.hp === hp, 'no arrow through the wall');
    assert(arch.x !== bx || arch.y !== by, 'archer repositions when LOS is blocked');
    dbg.setWall(12, 8, false);

    // Brute: acts every other turn.
    dbg.clearMonsters();
    dbg.teleport(8, 8);
    const ogre = dbg.spawnMonster('ogre', 12, 8, { awake: true });
    tap(KEY.SPACE); tap(KEY.SPACE);
    assert(world.cellDistance(ogre.x, ogre.y, 8, 8) === 3,
        'slow brute moved exactly once in two turns (at ' + ogre.x + ',' + ogre.y + ')');
    dbg.clearMonsters();
}

// --- 6. Traps: adjacent search reveals; stepping triggers ------------------------

{
    dbg.teleport(8, 8);
    dbg.placeTrap(9, 8);
    assert(world.getTile(9, 8, 0) !== T.TRAPR, 'trap starts hidden');
    tap(KEY.E);                 // search
    assert(world.getTile(9, 8, 0) === T.TRAPR, 'search revealed the adjacent trap');
    assert(world.hasFlag(9, 8, F.TRAP), 'revealed trap is still armed');
    let hp = game.player.hp;
    tap(KEY.RIGHT);             // step on it anyway
    assert(game.player.hp === hp - 4, 'revealed trap still triggers for 4');
    assert(!world.hasFlag(9, 8, F.TRAP), 'trap sprung after triggering');

    // Hidden trap triggers on step, revealing itself the hard way.
    dbg.placeTrap(10, 8);
    hp = game.player.hp;
    tap(KEY.RIGHT);
    assert(game.player.hp === hp - 4, 'hidden trap triggers on step');
    assert(world.getTile(10, 8, 0) === T.TRAPR && !world.hasFlag(10, 8, F.TRAP),
        'hidden trap revealed + sprung');
}

// --- 7. Doors: passability, LOS, bump to open -------------------------------------

{
    dbg.teleport(8, 8);
    for (let y = 5; y <= 11; y++) if (y !== 8) dbg.setWall(11, y);
    dbg.placeDoor(11, 8);
    advanceTime(40);
    assert(!game.canEnter(11, 8), 'closed door is impassable');
    assert(game.fog[idx(12, 8)] !== 2, 'closed door blocks LOS to the cell behind');

    dbg.teleport(10, 8);
    const t0 = game.turn;
    tap(KEY.RIGHT);             // bump opens
    assert(game.turn === t0 + 1, 'opening a door consumes the turn');
    assert(world.getTile(11, 8, 0) === T.DOOR_OPEN, 'door tile now open');
    assert(!world.hasFlag(11, 8, F.DOOR), 'door flag cleared');
    assert(game.canEnter(11, 8), 'open door is passable');
    assert(game.player.x === 10, 'opening did not move the player');
    assert(game.fog[idx(12, 8)] === 2, 'opening the door extended LOS through it');
    tap(KEY.RIGHT);
    assert(game.player.x === 11, 'walked through the open door');
    assert(game.msgs.some(m => m.text === 'You open the door.'), 'door log line');
    for (let y = 5; y <= 11; y++) if (y !== 8) dbg.setWall(11, y, false);
}

// --- 8. Items, inventory, potion -----------------------------------------------

{
    dbg.teleport(4, 12);
    const p = game.player;
    dbg.placeItem('gold', 5, 12, { amount: 15 });
    dbg.placeItem('potion', 6, 12);
    dbg.placeItem('weapon', 7, 12, { name: 'Iron Sword', bonus: 2 });
    dbg.placeItem('armor', 8, 12, { name: 'Chain Mail', bonus: 2 });
    const gold0 = p.gold, pots0 = p.potions;
    tap(KEY.RIGHT);
    assert(p.gold === gold0 + 15, 'gold picked up on walk-over');
    tap(KEY.RIGHT);
    assert(p.potions === pots0 + 1, 'potion added to inventory');
    tap(KEY.RIGHT);
    assert(p.atk === 5 && p.weapon === 'Iron Sword', 'weapon equipped (+2 ATK)');
    tap(KEY.RIGHT);
    assert(p.def === 2 && p.armor === 'Chain Mail', 'armor equipped (+2 DEF)');
    assert(!game.items.some(it => it.y === 12 && it.x >= 5 && it.x <= 8), 'floor items consumed');

    dbg.setHP(p.maxHp - 12);
    const pots1 = p.potions;
    tap(KEY.Q);
    assert(p.hp === p.maxHp - 2, 'potion healed exactly 10');
    assert(p.potions === pots1 - 1, 'potion consumed');
}

// --- 9. Stairs: descend regenerates the floor ------------------------------------

{
    const sd = game.stairsDown;
    assert(sd, 'floor 1 still has its down-stairs');
    // Find an enterable neighbour of the stairs and step in from it.
    let from = null, dirKey = null;
    for (const [k, d] of [['LEFT', [1, 0]], ['RIGHT', [-1, 0]], ['UP', [0, 1]], ['DOWN', [0, -1]]])
        if (game.canEnter(sd.x + d[0], sd.y + d[1])) { from = { x: sd.x + d[0], y: sd.y + d[1] }; dirKey = k; break; }
    assert(from, 'down-stairs reachable from a neighbour');
    dbg.clearMonsters();       // nobody camping the stairwell
    dbg.teleport(from.x, from.y);
    tap(KEY[dirKey]);
    assert(game.floor === 2, 'descended to floor 2');
    assert(game.player.x === game.spawn.x && game.player.y === game.spawn.y,
        'arrived on floor 2 spawn');
    assert(world.getTile(game.spawn.x, game.spawn.y, 0) === T.STAIRS_UP, 'floor 2 up-stairs under the player');
    assert(game.walkableComponents() === 1, 'floor 2 is one connected walkable region');
    assert(game.monsters.length >= 6, 'floor 2 repopulated with monsters');
    let unseen = 0;
    for (let i = 0; i < game.fog.length; i++) if (game.fog[i] === 0) unseen++;
    assert(unseen > 900, 'fog reset on the new floor (' + unseen + ' unseen)');
    advanceTime(600);
    screenshot('test-4-floor2.png');
}

// --- 10. Save -> load round trip ---------------------------------------------------

{
    // Distinctive grid mutation to prove world.save() round-trips: carve one
    // wall cell open next to the spawn.
    const p = game.player;
    let wallCell = null;
    for (const c of world.cellRing(p.x, p.y, 2, 'vertex'))
        if (world.hasFlag(c.x, c.y, F.WALL)) { wallCell = c; break; }
    assert(wallCell, 'found a wall near spawn to mutate');
    dbg.setWall(wallCell.x, wallCell.y, false);

    // Take a couple of turns and some damage for a distinctive state.
    tap(KEY.SPACE); tap(KEY.SPACE);
    dbg.setHP(17);
    game.player.gold += 7;
    advanceTime(60);

    const snap = {
        x: p.x, y: p.y, hp: p.hp, gold: p.gold, potions: p.potions,
        atk: p.atk, def: p.def, weapon: p.weapon,
        floor: game.floor, turn: game.turn, kills: game.kills,
        monsters: game.monsters.map(m => m.type + '@' + m.x + ',' + m.y + ':' + m.hp).sort().join('|'),
        items: game.items.map(it => it.kind + '@' + it.x + ',' + it.y).sort().join('|'),
        fog: Array.from(game.fog),
        mutTile: world.getTile(wallCell.x, wallCell.y, 0),
    };
    assert(game.saveRun(), 'saveRun succeeded');

    // Trash the live state.
    dbg.setHP(3);
    game.player.gold = 0;
    if (game.monsters.length) dbg.killMonster(game.monsters[0]);
    tap(KEY.SPACE); tap(KEY.SPACE); tap(KEY.SPACE);
    dbg.setWall(wallCell.x, wallCell.y, true);

    assert(game.loadRun(), 'loadRun succeeded');
    advanceTime(100);          // a frame: kinds re-registered, objects re-placed

    assert(game.player.x === snap.x && game.player.y === snap.y, 'player position restored');
    assert(game.player.hp === snap.hp, 'hp restored');
    assert(game.player.gold === snap.gold, 'gold restored');
    assert(game.player.potions === snap.potions, 'potions restored');
    assert(game.player.atk === snap.atk && game.player.def === snap.def &&
        game.player.weapon === snap.weapon, 'equipment restored');
    assert(game.floor === snap.floor && game.turn === snap.turn && game.kills === snap.kills,
        'run counters restored');
    assert(game.monsters.map(m => m.type + '@' + m.x + ',' + m.y + ':' + m.hp).sort().join('|') === snap.monsters,
        'monsters restored exactly');
    assert(game.items.map(it => it.kind + '@' + it.x + ',' + it.y).sort().join('|') === snap.items,
        'items restored exactly');
    let fogMatch = true;
    for (let i = 0; i < game.fog.length; i++)
        if (game.fog[i] !== snap.fog[i]) { fogMatch = false; break; }
    assert(fogMatch, 'fog map restored exactly');
    assert(world.getTile(wallCell.x, wallCell.y, 0) === snap.mutTile &&
        !world.hasFlag(wallCell.x, wallCell.y, F.WALL),
        'grid mutation round-tripped through world.save()/load()');
    // The load() kind-destruction workaround: objects render again post-load.
    assert(world.objectCount(game.kinds.player) === 1, 'player instance re-placed after load()');
    screenshot('test-5-loaded.png');
}

// --- 11. All three floors connect; the last holds boss + amulet --------------------

{
    dbg.newRun(555);
    advanceTime(100);
    assert(game.floor === 1 && game.walkableComponents() === 1, 'run 555 floor 1 connected');
    let water = 0, chasm = 0;
    const countHazards = () => {
        for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) {
                if (world.hasFlag(x, y, F.WATER)) water++;
                if (world.getTile(x, y, 0) === 0) chasm++;
            }
    };
    countHazards();
    dbg.descend();
    assert(game.floor === 2 && game.walkableComponents() === 1, 'floor 2 connected');
    countHazards();
    dbg.descend();
    assert(game.floor === 3 && game.walkableComponents() === 1, 'floor 3 connected');
    countHazards();
    assert(game.stairsDown === null, 'no deeper stairs on the last floor');
    assert(game.monsters.some(m => m.type === 'boss'), 'boss lurks on floor 3');
    assert(game.items.some(it => it.kind === 'amulet'), 'amulet waits on floor 3');
    assert(water > 0, 'water pools generated somewhere in the run (' + water + ' cells)');
    assert(chasm > 0, 'a chasm opened somewhere in the run (' + chasm + ' cells)');
}

// --- 12. Boss drop + victory --------------------------------------------------------

{
    dbg.clearMonsters();
    const p = game.player;
    let nb = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        if (game.canEnter(p.x + dx, p.y + dy)) { nb = { x: p.x + dx, y: p.y + dy, dx, dy }; break; }
    assert(nb, 'open neighbour for the boss');
    // Strip pre-placed amulet so the drop is unambiguous.
    game.items.splice(0, game.items.length, ...game.items.filter(it => it.kind !== 'amulet'));
    const boss = dbg.spawnMonster('boss', nb.x, nb.y, { awake: true });
    boss.hp = 1;
    const dirKey = nb.dx === 1 ? 'RIGHT' : nb.dx === -1 ? 'LEFT' : nb.dy === 1 ? 'DOWN' : 'UP';
    tap(KEY[dirKey]);
    assert(game.monsters.length === 0, 'boss slain');
    assert(game.items.some(it => it.kind === 'amulet' && it.x === nb.x && it.y === nb.y),
        'boss dropped the amulet');
    tap(KEY[dirKey]);          // step onto the drop
    assert(game.won === true && game.over === true, 'amulet pickup wins the run');
    advanceTime(100);
    const banner = document.getElementById('banner');
    assert(banner.style.display !== 'none', 'victory banner shown');
    assert(document.getElementById('banner-text').textContent.includes('AMULET'), 'banner names the amulet');
    screenshot('test-6-victory.png');
}

// --- 13. Death: permadeath run-over + restart ---------------------------------------

{
    tap(KEY.ENTER);            // victory banner -> fresh run
    advanceTime(100);
    assert(!game.over && game.floor === 1, 'Enter started a fresh run');
    assert(game.player.hp === G.PLAYER_BASE.hp, 'fresh run at full HP');

    dbg.clearMonsters();
    const p = game.player;
    let nb = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        if (game.canEnter(p.x + dx, p.y + dy)) { nb = { x: p.x + dx, y: p.y + dy }; break; }
    dbg.spawnMonster('rat', nb.x, nb.y, { awake: true });
    dbg.setHP(1);
    tap(KEY.SPACE);            // rat swings: 2 damage into 1 hp
    assert(game.over === true && game.won === false, 'player died — run over');
    assert(game.player.hp === 0, 'hp floored at 0');
    advanceTime(100);
    const banner = document.getElementById('banner');
    assert(banner.style.display !== 'none' &&
        document.getElementById('banner-text').textContent.includes('DIED'), 'death banner shown');
    assert(document.getElementById('banner-sub').textContent.includes('turns'), 'death stats shown');
    screenshot('test-7-death.png');

    // No zombie turns.
    const t0 = game.turn;
    tap(KEY.SPACE);
    assert(game.turn === t0, 'no actions after death');
    tap(KEY.ENTER);
    advanceTime(100);
    assert(!game.over && game.player.hp === G.PLAYER_BASE.hp && game.floor === 1,
        'restart after death works');
}

console.log('DEEPDELVE: all assertions passed');
