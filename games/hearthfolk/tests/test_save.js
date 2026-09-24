// Save -> vandalize -> load through the status-bar buttons restores the
// village exactly (object kinds survive world.load() without re-registering),
// then the speed buttons gate sim time and thinks.
import { check, eq, frames, clickOn } from "/lib/kit/test.js";

const H = window.HEARTH;
H.noModels();
frames(2);
const game = H.start();
frames(4);
const world = H.world;
const { TILE: T, FLAG: F, L_OVER } = H.defs;
const pump = (ms) => { for (let t = 0; t < ms; t += 100) advanceTime(100); };

// Let the village live a little first, so there is state worth saving.
H.setSpeed(4);
pump(6000);

// ── Save -> mutate -> load ──────────────────────────────────────────────
{
    H.setSpeed(0);   // freeze so the snapshot is exact across the clicks
    frames(1);
    const rowan = game.villagerByName("Rowan");
    rowan.memories.push("the well is deep", "Bryn snores");
    rowan.goal = "a saved goal";
    const snap = {
        time: game.time,
        res: { ...game.res },
        fire: game.fire,
        memories: [...rowan.memories],
        goal: rowan.goal,
        needs: { ...rowan.needs },
        chronLen: Math.min(game.chronicle.length, 120),
        cropStages: game.crops.map((c) => c.stage).join(","),
        aliveTrees: game.trees.filter((t) => t.alive).length,
        accepted: game.mind.accepted, discarded: game.mind.discarded,
        pathTile: world.getTile(23, 20, L_OVER),
        bridge: game.bridgeCells[0],
        villagerKind: game.kinds.villagers[0],
    };
    eq(game.stats.kindRegistrations, 1, "kinds registered exactly once before save");

    clickOn("#btn-save");
    frames(2);
    check(game.hasSave(), "save written");
    eq(document.getElementById("toast").textContent, "Village saved", "save toast");

    // Vandalize the live state.
    H.debug.setRes({ food: 99, wood: 0, stone: 77, meals: 0 });
    rowan.memories.length = 0;
    rowan.goal = "VANDALIZED";
    game.fire = 0;
    for (const t of game.trees) t.alive = false;
    game.crops[0].stage = 2;
    world.setTile(game.crops[0].x, game.crops[0].y, T.CROP_C, L_OVER);
    world.setTile(23, 20, 0, L_OVER);
    world.rebuild();
    advanceTime(100);

    clickOn("#btn-load");
    frames(2);
    eq(document.getElementById("toast").textContent, "Village loaded", "load toast");

    eq(game.time, snap.time, "sim time restored exactly");
    for (const k of ["food", "wood", "stone", "meals"]) eq(game.res[k], snap.res[k], k + " restored");
    check(Math.abs(game.fire - snap.fire) < 0.05, "fire level restored");
    eq(rowan.goal, snap.goal, "goal restored");
    eq(rowan.memories, snap.memories, "memories restored");
    check(Math.abs(rowan.needs.hunger - snap.needs.hunger) < 0.05, "needs restored");
    eq(game.chronicle.length, snap.chronLen, "chronicle restored");
    eq(document.querySelectorAll("#chronicle-list .chron-entry").length, Math.min(snap.chronLen, 120),
        "chronicle panel rebuilt from the save");
    check(game.mind.accepted === snap.accepted && game.mind.discarded === snap.discarded, "think counters restored");
    eq(game.crops.map((c) => c.stage).join(","), snap.cropStages, "crop stages restored");
    eq(game.trees.filter((t) => t.alive).length, snap.aliveTrees, "trees restored");
    eq(world.getTile(23, 20, L_OVER), snap.pathTile, "path overlay round-tripped");
    eq(world.getTile(snap.bridge.x, snap.bridge.y, L_OVER), T.BRIDGE, "bridge overlay round-tripped");
    check(!world.hasFlag(snap.bridge.x, snap.bridge.y, F.WATER), "bridge flag round-tripped");
    check(world.isWalkable(snap.bridge.x, snap.bridge.y, F.WATER), "bridge still walkable after load");

    // world.load() preserved the registered kinds: no re-registration, the
    // old kind ids still address live kinds, and instances were re-placed.
    eq(game.stats.kindRegistrations, 1, "kinds NOT re-registered after load");
    eq(game.kinds.villagers[0], snap.villagerKind, "kind id unchanged");
    advanceTime(200);   // a few frames of render sync
    for (let i = 0; i < 5; i++)
        eq(world.objectCount(game.kinds.villagers[i]), 1, "villager " + i + " instance re-placed after load");
    eq(world.objectCount(game.kinds.tree), game.trees.filter((t) => t.alive).length, "tree instances re-placed");
    eq(world.objectCount(game.kinds.hut), 5, "hut instances re-placed after load");
    const probe = world.addObject(game.kinds.tree, 1, 1, {});
    check(probe >= 0, "saved kind id still places instances (" + probe + ")");
    world.clearObjects(game.kinds.tree);
    game.dirty.trees = true;   // frame sync restores the real placements
    advanceTime(100);
}

// ── Speed controls gate sim advancement ───────────────────────────────
{
    const btn = (sel) => { clickOn(sel); advanceTime(40); };

    btn("#btn-pause");
    eq(game.speed, 0, "pause engaged");
    check(document.getElementById("btn-pause").classList.contains("selected"), "pause button lit");
    const t0 = game.time;
    pump(2000);
    eq(game.time, t0, "paused sim does not advance");
    const n0 = game.mind.accepted + game.mind.discarded;
    globalThis.__hearthmindGenerate = async () => "{}";
    pump(2000);
    eq(game.mind.accepted + game.mind.discarded, n0, "paused sim dispatches no thinks");
    delete globalThis.__hearthmindGenerate;

    btn("#btn-1x");
    eq(game.speed, 1, "1x engaged");
    const t1 = game.time;
    pump(2000);
    const d1 = game.time - t1;
    check(d1 > 1.4 && d1 < 2.6, "1x advances about 2 sim s (" + d1.toFixed(2) + ")");

    btn("#btn-4x");
    eq(game.speed, 4, "4x engaged");
    const t4 = game.time;
    pump(2000);
    const d4 = game.time - t4;
    check(d4 > 6.0 && d4 < 10.0, "4x advances about 8 sim s (" + d4.toFixed(2) + ")");
    check(d4 > d1 * 2.5, "4x is decisively faster than 1x (" + d4.toFixed(2) + " vs " + d1.toFixed(2) + ")");

    btn("#btn-1x");
}

// Esc opens the pause menu and the village holds still under it.
{
    const t0 = game.time;
    H.shell.switchTo("pause");
    pump(1000);
    eq(H.screen, "pause", "pause menu up");
    eq(game.time, t0, "the sim holds under the pause menu");
}

console.log("hearthfolk save ok");
