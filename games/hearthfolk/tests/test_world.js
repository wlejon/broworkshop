// World generation invariants: river continuity, the bridge, the zones, and
// every home and workplace reachable from the hearth. Then smooth movement:
// the mason's walk up to the quarry re-anchors elevation every frame.
import { check, eq, frames, shot } from "/lib/kit/test.js";

const H = window.HEARTH;
H.noModels();
frames(2);
const game = H.start();
frames(4);
const world = H.world;
const { TILE: T, FLAG: F, L_OVER, HSTEP, MAP_W, MAP_H } = H.defs;
const CROP_IDS = [T.CROP_A, T.CROP_B, T.CROP_C];
const onBridge = (c) => game.bridgeCells.some((b) => b.x === c.x && b.y === c.y);

eq(H.screen, "playing", "Enter Village starts the run");
check(world.width === MAP_W && world.height === MAP_H, "map is 48x36");

// ── River: water in every row, one 4-connected component, below grade ─────
for (let y = 0; y < MAP_H; y++) {
    let n = 0;
    for (let x = 0; x < MAP_W; x++) if (world.getTile(x, y, 0) === T.WATER) n++;
    check(n >= 1, "river crosses row " + y);
}
eq(world.components({ id: T.WATER }).length, 1, "river is one connected component");
check(game.riverCells.every((c) => world.getElevation(c.x, c.y) === -1), "river below grade");

// ── Bridge: on the river, walkable, WATER flag cleared; open water blocks ─
check(game.bridgeCells.length >= 1, "bridge exists (" + game.bridgeCells.length + " cells)");
for (const b of game.bridgeCells) {
    check(world.getTile(b.x, b.y, 0) === T.WATER, "bridge deck sits on water ground");
    check(world.getTile(b.x, b.y, L_OVER) === T.BRIDGE, "bridge overlay tile");
    check(!world.hasFlag(b.x, b.y, F.WATER), "bridge cell WATER flag cleared");
    check(world.isWalkable(b.x, b.y, F.WATER), "bridge cell is walkable");
}
const openWater = game.riverCells.find((c) => !onBridge(c));
check(openWater && !world.isWalkable(openWater.x, openWater.y, F.WATER), "open water is not walkable");

// ── Zones ─────────────────────────────────────────────────────────────────
check(game.crops.length >= 12, "farmland sown (" + game.crops.length + " cells)");
for (const c of game.crops)
    check(CROP_IDS.includes(world.getTile(c.x, c.y, L_OVER)), "crop decal at " + c.x + "," + c.y);
check(game.trees.length >= 15, "forest planted (" + game.trees.length + " trees)");
check(game.rockCells.length >= 8, "rocky rise exists");
eq(world.getTile(game.quarry.x, game.quarry.y, 0), T.ROCK, "quarry is on rock");
check(world.getElevation(game.quarry.x, game.quarry.y) >= 1, "quarry is elevated");

// ── Reachability from the hearth: findPath and a distance field ───────────
{
    const hx = game.hearth.x, hy = game.hearth.y;
    for (const v of game.villagers)
        check(world.findPath(hx, hy, v.home.x, v.home.y, { blockMask: F.WATER }).length > 0,
            v.name + "'s home reachable from the hearth");
    const spots = [
        ["farm", game.crops[0]], ["forest", game.trees[0]],
        ["quarry", game.quarry], ["kitchen", game.kitchen], ["bench", game.bench],
    ];
    for (const [name, s] of spots) {
        const p = world.findPath(hx, hy, s.x, s.y, { blockMask: F.WATER });
        check(p.length > 0, name + " reachable from the hearth");
        if (name === "quarry") check(p.some(onBridge), "quarry route crosses the bridge");
    }
    const field = world.distanceField([game.hearth], { blockMask: F.WATER });
    for (const v of game.villagers)
        check(field[v.home.y * MAP_W + v.home.x] >= 0, v.name + " home in hearth distance field");
    check(field[game.quarry.y * MAP_W + game.quarry.x] >= 0, "quarry in hearth distance field");
}

// Into full morning light for the overview shot.
H.setSpeed(4);
for (let t = 0; t < 2600; t += 100) advanceTime(100);
H.setSpeed(1);
shot("village");

// ── Movement: smooth path following, per-frame elevation re-anchoring ─────
{
    const v = game.villagerByName("Merek");   // the mason
    H.debug.teleport(v, game.hearth.x, game.hearth.y);
    H.debug.forceGoto(v, game.quarry.x, game.quarry.y);
    advanceTime(100);   // decide + path
    check(v.path && v.path.length > 10, "route to the quarry planned (" + (v.path ? v.path.length : 0) + " cells)");

    const remaining = () => v.path ? (v.path.length - 1 - v.seg) - v.segT : 0;
    let prevRem = remaining();
    let prevY = game.renderInfo(v).worldY;
    let minY = prevY, maxY = prevY, maxStep = 0;
    for (let i = 0; i < 600 && v.path; i++) {
        advanceTime(50);
        if (v.path) {
            const rem = remaining();
            check(rem <= prevRem + 1e-6, "path progress is monotonic (frame " + i + ")");
            prevRem = rem;
        }
        const y = game.renderInfo(v).worldY;
        maxStep = Math.max(maxStep, Math.abs(y - prevY));
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        prevY = y;
    }
    const c = game.cellOf(v);
    check(c.x === game.quarry.x && c.y === game.quarry.y, "mason arrived at the quarry");
    check(maxY - minY >= HSTEP * 1.5, "route spans real elevation (" + (maxY - minY).toFixed(2) + " world units)");
    check(maxStep < HSTEP * 0.5, "no Y teleports: max per-frame step " + maxStep.toFixed(3));
    v.override = null;
}

console.log("hearthfolk world ok");
