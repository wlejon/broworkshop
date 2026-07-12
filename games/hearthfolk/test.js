// test.js — scripted Hearthfolk session for bro-headless.
// Run: HEARTHFOLK_NO_MODEL=1 bro-headless games/hearthfolk test.js
//
// Groups:
//   1. World-gen invariants (river continuity, bridge walkability, zones,
//      reachability from the hearth).
//   2. Tier-0 life through a full day-night: needs decay, every villager
//      eats/sleeps/works with visible world side-effects.
//   3. Smooth movement with per-frame elevation re-anchoring.
//   4. Mind protocol with a deterministic FAKE brain (strict JSON contract,
//      discard-on-failure, heard-line priority, memory cap).
//   5. Chronicle + mind-panel DOM.
//   6. Save -> mutate -> load round-trip (kind ids survive world.load()).
//   7. Speed controls gate sim advancement.

advanceTime(400);

const H = window.HEARTH;
assert(H, 'HEARTH debug surface exposed');
const { game, world } = H;
const T = H.TILE, F = H.FLAG;
const L_OVER = H.L_OVER;
const CROP_IDS = [T.CROP_A, T.CROP_B, T.CROP_C];

function pump(ms) { for (let t = 0; t < ms; t += 100) advanceTime(100); }
function pumpUntil(desc, fn, maxMs) {
    for (let t = 0; t < (maxMs || 30000); t += 100) {
        if (fn()) return;
        advanceTime(100);
    }
    throw new Error('timeout waiting for ' + desc);
}

// --- 1. World-gen invariants -----------------------------------------------------

{
    assert(world.width === 48 && world.height === 36, 'map is 48x36');

    // River: water in every row, one 4-connected component (continuous), below
    // grade, flagged (except bridge decks).
    for (let y = 0; y < 36; y++) {
        let n = 0;
        for (let x = 0; x < 48; x++) if (world.getTile(x, y, 0) === T.WATER) n++;
        assert(n >= 1, 'river crosses row ' + y);
    }
    const waterComps = world.components({ id: T.WATER });
    assert(waterComps.length === 1, 'river is one connected component (' +
        waterComps.length + ')');
    for (const c of game.riverCells)
        assert(world.getElevation(c.x, c.y) === -1, 'river below grade');

    // Bridge: on the river, walkable, its WATER flag cleared; the raw river
    // is not walkable.
    assert(game.bridgeCells.length >= 1, 'bridge exists (' + game.bridgeCells.length + ' cells)');
    for (const b of game.bridgeCells) {
        assert(world.getTile(b.x, b.y, 0) === T.WATER, 'bridge deck sits on water ground');
        assert(world.getTile(b.x, b.y, L_OVER) === T.BRIDGE, 'bridge overlay tile');
        assert(!world.hasFlag(b.x, b.y, F.WATER), 'bridge cell WATER flag cleared');
        assert(world.isWalkable(b.x, b.y, F.WATER), 'bridge cell is walkable');
    }
    const openWater = game.riverCells.find(c =>
        !game.bridgeCells.some(b => b.x === c.x && b.y === c.y));
    assert(openWater && !world.isWalkable(openWater.x, openWater.y, F.WATER),
        'open water is not walkable');

    // Zones present.
    assert(game.crops.length >= 12, 'farmland sown (' + game.crops.length + ' cells)');
    for (const c of game.crops)
        assert(CROP_IDS.includes(world.getTile(c.x, c.y, L_OVER)), 'crop decal at ' + c.x + ',' + c.y);
    assert(game.trees.length >= 15, 'forest planted (' + game.trees.length + ' trees)');
    assert(game.rockCells.length >= 8, 'rocky rise exists');
    assert(world.getTile(game.quarry.x, game.quarry.y, 0) === T.ROCK, 'quarry is on rock');
    assert(world.getElevation(game.quarry.x, game.quarry.y) >= 1, 'quarry is elevated');

    // Reachability: every home and workplace from the hearth, via findPath.
    const hx = game.hearth.x, hy = game.hearth.y;
    for (const v of game.villagers) {
        const pHome = world.findPath(hx, hy, v.home.x, v.home.y, { blockMask: F.WATER });
        assert(pHome.length > 0, v.name + '\'s home reachable from the hearth');
    }
    const spots = [
        ['farm', game.crops[0]], ['forest', { x: game.trees[0].x, y: game.trees[0].y }],
        ['quarry', game.quarry], ['kitchen', game.kitchen], ['bench', game.bench],
    ];
    for (const [name, s] of spots) {
        const p = world.findPath(hx, hy, s.x, s.y, { blockMask: F.WATER });
        assert(p.length > 0, name + ' reachable from the hearth');
        if (name === 'quarry')
            assert(p.some(c => game.bridgeCells.some(b => b.x === c.x && b.y === c.y)),
                'quarry route crosses the bridge');
    }
    // Same, via a hearth-sourced distance field.
    const field = world.distanceField([game.hearth], { blockMask: F.WATER });
    for (const v of game.villagers)
        assert(field[v.home.y * 48 + v.home.x] >= 0, v.name + ' home in hearth distance field');
    assert(field[game.quarry.y * 48 + game.quarry.x] >= 0, 'quarry in hearth distance field');

    // Advance into full morning light for the overview shot.
    H.setSpeed(4);
    pump(2600);
    H.setSpeed(1);
    screenshot('test-1-village.png');
}

// --- 2. Tier-0 life through a full day-night -------------------------------------

{
    // Needs decay while nobody is eating yet.
    const h0 = game.villagers.map(v => v.needs.hunger);
    const ate0 = game.villagers.map(v => v.counts.ate);
    pump(3000);   // 3 sim s at 1x
    for (let i = 0; i < 5; i++) {
        const v = game.villagers[i];
        // Hunger rises unless the villager (started) eating in the window.
        if (v.activity !== 'eating' && v.counts.ate === ate0[i])
            assert(v.needs.hunger > h0[i], v.name + ' hunger decays (' +
                h0[i].toFixed(2) + ' -> ' + v.needs.hunger.toFixed(2) + ')');
    }

    // Snapshot crop stages to prove the farmer changes the world.
    const cropSnap = game.crops.map(c => c.stage).join(',');

    // A full day-night at 4x: 120 sim s ≈ 30 s of virtual time (+ margin).
    H.setSpeed(4);
    pumpUntil('day 2 dawn', () => game.day() >= 2 && game.tod() > 0.02, 60000);
    H.setSpeed(1);

    for (const v of game.villagers) {
        assert(v.counts.ate >= 1, v.name + ' ate (' + v.counts.ate + 'x)');
        assert(v.counts.slept >= 1, v.name + ' slept (' + v.counts.slept + 'x)');
        assert(v.counts.worked >= 1, v.name + ' worked (' + v.counts.worked + ' ticks)');
    }
    // World side-effects of the work.
    const s = game.stats;
    assert(s.harvests >= 1, 'crops were harvested (' + s.harvests + ')');
    assert(s.treesChopped >= 1, 'trees were felled (' + s.treesChopped + ')');
    assert(s.stoneMined >= 1, 'stone was cut (' + s.stoneMined + ')');
    assert(s.mealsCooked >= 1, 'meals were cooked (' + s.mealsCooked + ')');
    assert(s.fireTends >= 1, 'the elder tended the hearth (' + s.fireTends + ')');
    assert(game.crops.map(c => c.stage).join(',') !== cropSnap, 'crop stages advanced');
    for (const c of game.crops)
        assert(world.getTile(c.x, c.y, L_OVER) === CROP_IDS[c.stage],
            'crop decal tracks its stage');
    assert(game.chronicle.some(e => e.kind === 'day' && e.text.indexOf('Day 2') >= 0),
        'chronicle recorded the new day');
}

// --- 3. Movement: smooth path following, per-frame elevation re-anchoring ---------

{
    const v = game.villagers[2];   // Merek the mason
    H.debug.teleport(v, game.hearth.x, game.hearth.y);
    H.debug.forceGoto(v, game.quarry.x, game.quarry.y);
    advanceTime(100);   // decide + path
    assert(v.path && v.path.length > 10, 'route to the quarry planned (' +
        (v.path ? v.path.length : 0) + ' cells)');

    const remaining = () => {
        if (!v.path) return 0;
        return (v.path.length - 1 - v.seg) - v.segT;
    };
    let prevRem = remaining();
    let prevY = game.renderInfo(v).worldY;
    let minY = prevY, maxY = prevY, maxStep = 0, frames = 0;
    for (let i = 0; i < 600 && v.path; i++) {
        advanceTime(50);
        frames++;
        const rem = remaining();
        if (v.path) {
            assert(rem <= prevRem + 1e-6, 'path progress is monotonic (frame ' + i + ')');
            prevRem = rem;
        }
        const y = game.renderInfo(v).worldY;
        maxStep = Math.max(maxStep, Math.abs(y - prevY));
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        prevY = y;
    }
    const c = game.cellOf(v);
    assert(c.x === game.quarry.x && c.y === game.quarry.y, 'mason arrived at the quarry');
    assert(maxY - minY >= H.HSTEP * 1.5,
        'route spans real elevation (' + (maxY - minY).toFixed(2) + ' world units)');
    assert(maxStep < H.HSTEP * 0.5,
        'no Y teleports: max per-frame step ' + maxStep.toFixed(3) + ' < ' +
        (H.HSTEP * 0.5).toFixed(3));
    v.override = null;   // release
}

// --- 4. Mind protocol with a deterministic fake brain ------------------------------

{
    const M = game.mind;
    const prompts = [];
    let reply = '{}';
    globalThis.__hearthmindGenerate = async (prompt) => { prompts.push(prompt); return reply; };
    // Park the background scheduler while the deterministic sub-tests drive
    // requestThink() directly (it shares the same serial one-in-flight queue).
    M.thinkT = -1e9;

    const rowan = game.villagerByName('Rowan');
    const bryn = game.villagerByName('Bryn');

    // Park both by the hearth, adjacent to each other.
    H.debug.teleport(rowan, game.hearth.x - 1, game.hearth.y);
    H.debug.teleport(bryn, game.hearth.x, game.hearth.y);
    rowan.override = { until: game.time + 300, action: 'idle', target: { x: game.hearth.x - 1, y: game.hearth.y } };
    bryn.override = { until: game.time + 300, action: 'idle', target: { x: game.hearth.x, y: game.hearth.y } };

    // (a) A fully-formed think is applied exactly.
    const acc0 = M.accepted, dis0 = M.discarded;
    const gotoX = 20, gotoY = 24;
    assert(world.isWalkable(gotoX, gotoY, F.WATER), 'test goto cell is walkable');
    reply = JSON.stringify({
        say: 'The grain is nearly ripe, Bryn.',
        goto: { x: gotoX, y: gotoY },
        action: 'work',
        goal: 'bring in the harvest before the rain',
        remember: 'Bryn was at the hearth this morning',
    });
    game.requestThink(rowan);
    advanceTime(50);
    assert(M.accepted === acc0 + 1, 'valid think accepted');
    assert(rowan.goal === 'bring in the harvest before the rain', 'goal applied');
    assert(rowan.memories[rowan.memories.length - 1] === 'Bryn was at the hearth this morning',
        'memory appended');
    assert(rowan.override && rowan.override.target.x === gotoX &&
        rowan.override.target.y === gotoY, 'goto override applied');
    assert(rowan.override.action === 'work', 'action applied');
    assert(rowan.say && rowan.say.text.indexOf('nearly ripe') >= 0, 'say line active');
    assert(game.chronicle.some(e => e.kind === 'say' && e.text.indexOf('nearly ripe') >= 0),
        'say entered the chronicle');
    assert(rowan.lastThink && !rowan.lastThink.discarded, 'lastThink recorded');

    // The say was heard by adjacent Bryn, who is now the priority thinker.
    assert(bryn.heard && bryn.heard.from === 'Rowan' &&
        bryn.heard.text.indexOf('nearly ripe') >= 0, 'adjacent villager heard the line');
    assert(game.pickNextThinker() === bryn, 'hearer takes think priority');

    // Speech bubble + feed visible — the conversation money shot.
    advanceTime(100);
    assert(document.querySelectorAll('#bubbles .bubble').length >= 1, 'speech bubble shown');
    assert(document.querySelectorAll('#feed .feed-line').length >= 1, 'conversation feed line');
    screenshot('test-2-conversation.png');

    // (b) The hearer's prompt carries the heard line -> emergent back-and-forth.
    reply = JSON.stringify({ say: 'Then I will save my axe arm for the sheaves.' });
    game.requestThink(bryn);
    advanceTime(50);
    const brynPrompt = prompts[prompts.length - 1];
    assert(brynPrompt.indexOf('Rowan just said to you') >= 0 &&
        brynPrompt.indexOf('nearly ripe') >= 0, 'heard line included in the prompt');
    assert(bryn.heard === null, 'heard line consumed by the think');
    assert(rowan.heard && rowan.heard.from === 'Bryn', 'reply heard back by Rowan');

    // The accepted think is really EXECUTED: Rowan walks to the goto cell and,
    // since it is a crop cell, works it.
    pumpUntil('rowan reaches his goto cell', () => {
        const c = game.cellOf(rowan);
        return c.x === gotoX && c.y === gotoY;
    }, 20000);
    pumpUntil('rowan works the crop cell he walked to', () => rowan.activity === 'working', 10000);

    // (c) Malformed output is DISCARDED — tier 0 carries on untouched.
    const disB = M.discarded, accB = M.accepted;
    const goalB = rowan.goal, memB = rowan.memories.length;
    for (const bad of [
        'I think I shall go to the fields now.',                  // no JSON at all
        '{"say": "unterminated',                                   // broken JSON
        '{"say": 123}',                                            // wrong type
        '{"action": "fly"}',                                       // unknown action
        '{"goto": {"x": 9999, "y": 2}}',                           // out of bounds
        '{"goto": {"x": ' + game.riverCells[0].x + ', "y": ' + game.riverCells[0].y + '}}', // water
        '{"goto": {"x": 1.5, "y": 2}}',                            // non-integer
    ]) {
        reply = bad;
        game.requestThink(rowan);
        advanceTime(50);
    }
    assert(M.discarded === disB + 7, 'all malformed thinks discarded (' +
        (M.discarded - disB) + '/7)');
    assert(M.accepted === accB, 'no malformed think accepted');
    assert(rowan.goal === goalB && rowan.memories.length === memB,
        'discards left the villager untouched');
    const t0 = game.time;
    advanceTime(300);
    assert(game.time > t0, 'tier 0 keeps running after discards');

    // (d) Memory cap: oldest out at ' + MEMORY_CAP.
    reply = '{}';
    rowan.memories.length = 0;
    for (let i = 1; i <= 25; i++) {
        reply = JSON.stringify({ remember: 'm' + i });
        game.requestThink(rowan);
        advanceTime(30);
    }
    assert(rowan.memories.length === 20, 'memory capped at 20 (' + rowan.memories.length + ')');
    assert(rowan.memories[0] === 'm6' && rowan.memories[19] === 'm25',
        'oldest memories evicted first');

    // (e) The scheduler drives thinks through the same serial queue.
    const accS = M.accepted + M.discarded;
    reply = '{"goal":"scheduled thought"}';
    M.thinkT = 0;   // re-arm the scheduler
    pump(8000);     // > THINK_INTERVAL sim s at 1x
    assert(M.accepted + M.discarded > accS, 'scheduler dispatched a think');

    delete globalThis.__hearthmindGenerate;
    rowan.override = null; bryn.override = null;
}

// --- 5. Chronicle + mind panel DOM -------------------------------------------------

{
    assert(document.querySelectorAll('#chronicle-list .chron-entry').length >= 5,
        'chronicle panel has entries');

    // Click Rowan through the real input pipeline.
    const rowan = game.villagerByName('Rowan');
    pumpUntil('rowan not walking', () => !rowan.path, 15000);
    const p = H.projectVillager(rowan);
    click(p.x, p.y + 6);
    advanceTime(80);
    assert(H.selected === rowan, 'villager selected by click');
    const panel = document.getElementById('mind-panel');
    assert(panel.style.display !== 'none', 'mind panel opened');
    assert(document.getElementById('mp-name').textContent === 'Rowan', 'panel names the villager');
    assert(document.getElementById('mp-sub').textContent.indexOf('farmer') >= 0,
        'panel shows the role');
    const w = document.getElementById('bar-hunger').style.width;
    assert(/%$/.test(w), 'needs bar rendered (' + w + ')');
    assert(document.getElementById('mp-goal').textContent.length > 0, 'goal shown');
    assert(document.querySelectorAll('#mp-memories li').length >= 1, 'memories listed');
    assert(document.getElementById('mp-think').textContent.length > 0, 'last think shown');
    screenshot('test-3-mind.png');
}

// --- 6. Save -> mutate -> load round-trip ------------------------------------------

{
    // Freeze the sim so the snapshot is exact across the save/load clicks.
    H.setSpeed(0);
    const rowan = game.villagerByName('Rowan');
    const snap = {
        time: game.time,
        res: { ...game.res },
        fire: game.fire,
        memories: [...rowan.memories],
        goal: rowan.goal,
        needs: { ...rowan.needs },
        chronLen: Math.min(game.chronicle.length, 120),
        cropStages: game.crops.map(c => c.stage).join(','),
        aliveTrees: game.trees.filter(t => t.alive).length,
        accepted: game.mind.accepted, discarded: game.mind.discarded,
        pathTile: world.getTile(23, 20, L_OVER),
        bridge: game.bridgeCells[0],
        kindRegs: game.stats.kindRegistrations,
        villagerKind: game.kinds.villagers[0],
    };
    assert(snap.kindRegs === 1, 'kinds registered exactly once before save');

    // Save through the real UI button.
    const rs = document.getElementById('btn-save').getBoundingClientRect();
    click(rs.x + rs.width / 2, rs.y + rs.height / 2);
    advanceTime(60);
    assert(game.hasSave(), 'save written');

    // Vandalize the live state.
    H.debug.setRes({ food: 99, wood: 0, stone: 77, meals: 0 });
    rowan.memories.length = 0;
    rowan.goal = 'VANDALIZED';
    game.fire = 0;
    for (const t of game.trees) t.alive = false;
    game.crops[0].stage = 2;
    world.setTile(game.crops[0].x, game.crops[0].y, T.CROP_C, L_OVER);
    world.setTile(23, 20, 0, L_OVER);
    world.rebuild();
    advanceTime(100);

    // Load through the real UI button.
    const rl = document.getElementById('btn-load').getBoundingClientRect();
    click(rl.x + rl.width / 2, rl.y + rl.height / 2);
    advanceTime(150);

    assert(game.time === snap.time, 'sim time restored exactly');
    for (const k of ['food', 'wood', 'stone', 'meals'])
        assert(game.res[k] === snap.res[k], k + ' restored (' + game.res[k] + ')');
    assert(Math.abs(game.fire - snap.fire) < 0.05, 'fire level restored');
    assert(rowan.goal === snap.goal, 'goal restored');
    assert(rowan.memories.join('|') === snap.memories.join('|'), 'memories restored');
    assert(Math.abs(rowan.needs.hunger - snap.needs.hunger) < 0.05, 'needs restored');
    assert(game.chronicle.length === snap.chronLen, 'chronicle restored (' +
        game.chronicle.length + ')');
    assert(game.mind.accepted === snap.accepted && game.mind.discarded === snap.discarded,
        'think counters restored');
    assert(game.crops.map(c => c.stage).join(',') === snap.cropStages, 'crop stages restored');
    assert(game.trees.filter(t => t.alive).length === snap.aliveTrees, 'trees restored');
    assert(world.getTile(23, 20, L_OVER) === snap.pathTile, 'path overlay round-tripped');
    assert(world.getTile(snap.bridge.x, snap.bridge.y, L_OVER) === T.BRIDGE,
        'bridge overlay round-tripped');
    assert(!world.hasFlag(snap.bridge.x, snap.bridge.y, F.WATER),
        'bridge flag round-tripped');
    assert(world.isWalkable(snap.bridge.x, snap.bridge.y, F.WATER),
        'bridge still walkable after load');

    // world.load() preserved the registered kinds: no re-registration, the old
    // kind ids still address live kinds, and instances were re-placed.
    assert(game.stats.kindRegistrations === 1, 'kinds NOT re-registered after load');
    assert(game.kinds.villagers[0] === snap.villagerKind, 'kind id unchanged');
    advanceTime(200);   // a few frames of render sync
    for (let i = 0; i < 5; i++)
        assert(world.objectCount(game.kinds.villagers[i]) === 1,
            'villager ' + i + ' instance re-placed after load');
    assert(world.objectCount(game.kinds.tree) === game.trees.filter(t => t.alive).length,
        'tree instances re-placed after load');
    assert(world.objectCount(game.kinds.hut) === 5, 'hut instances re-placed after load');
    const probe = world.addObject(game.kinds.tree, 1, 1, {});
    assert(probe >= 0, 'saved kind id still places instances (' + probe + ')');
    world.clearObjects(game.kinds.tree);
    game.dirty.trees = true;   // frame sync restores the real placements
    advanceTime(100);
}

// --- 7. Speed controls gate sim advancement -----------------------------------------

{
    const btn = (id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        click(r.x + r.width / 2, r.y + r.height / 2);
        advanceTime(40);
    };

    btn('btn-pause');
    assert(game.speed === 0, 'pause engaged');
    const t0 = game.time;
    pump(2000);
    assert(game.time === t0, 'paused sim does not advance');
    const acc0 = game.mind.accepted + game.mind.discarded;
    globalThis.__hearthmindGenerate = async () => '{}';
    pump(2000);
    assert(game.mind.accepted + game.mind.discarded === acc0,
        'paused sim dispatches no thinks');
    delete globalThis.__hearthmindGenerate;

    btn('btn-1x');
    assert(game.speed === 1, '1x engaged');
    const t1 = game.time;
    pump(2000);
    const d1 = game.time - t1;
    assert(d1 > 1.4 && d1 < 2.6, '1x advances ~2 sim s (' + d1.toFixed(2) + ')');

    btn('btn-4x');
    assert(game.speed === 4, '4x engaged');
    const t4 = game.time;
    pump(2000);
    const d4 = game.time - t4;
    assert(d4 > 6.0 && d4 < 10.0, '4x advances ~8 sim s (' + d4.toFixed(2) + ')');
    assert(d4 > d1 * 2.5, '4x is decisively faster than 1x');

    btn('btn-1x');
}

console.log('HEARTHFOLK: all assertions passed  (thinks ✓' + game.mind.accepted +
    ' ✕' + game.mind.discarded + ', harvests ' + game.stats.harvests +
    ', trees ' + game.stats.treesChopped + ', stone ' + game.stats.stoneMined +
    ', meals ' + game.stats.mealsCooked + ')');
