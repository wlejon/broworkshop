// World generation: river + bridge, forest, rocky rise with the quarry,
// farmland, the plaza with hearth / bench / kitchen, five huts and the paths
// between them. Fills the tile world and the game's zone lists.

import { MAP_W, MAP_H, L_GROUND, L_OVER, TILE, FLAG, CROP_STAGES } from "/app/defs.js";
import { seededRandom } from "/lib/arcade/random.js";

const inB = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

export function genTerrain(game) {
    const world = game.world;
    const rng = seededRandom(game.seed);
    for (let y = 0; y < MAP_H; y++)
        for (let x = 0; x < MAP_W; x++) {
            world.setTile(x, y, TILE.GRASS, L_GROUND);
            world.setTile(x, y, 0, L_OVER);
            world.setElevation(x, y, 0);
            world.setFlag(x, y, 0xFF, false);
        }

    // River: north->south meander around x=33, width 1..2. It crosses every
    // row, so the east bank is reachable ONLY over a bridge. Row-to-row
    // shifts are constrained so consecutive spans always share a column
    // (the river is 4-connected end to end).
    const phase = rng() * Math.PI * 2;
    game.riverCells = [];
    let prevCx = 33, prevW = 2;
    for (let y = 0; y < MAP_H; y++) {
        const w = (y === 18 || rng() < 0.35) ? 1 : 2;
        let cx;
        if (y === 0) {
            cx = Math.round(33 + 2.6 * Math.sin(phase));
        } else {
            const want = Math.round(33 + 2.6 * Math.sin(y * 0.26 + phase) + (rng() - 0.5));
            let shift = Math.max(-1, Math.min(1, want - prevCx));
            if (shift === 1 && prevW === 1) shift = 0;   // keep spans overlapping
            if (shift === -1 && w === 1) shift = 0;
            cx = prevCx + shift;
        }
        cx = Math.max(29, Math.min(36, cx));
        for (let i = 0; i < w; i++) {
            const x = cx + i;
            world.setTile(x, y, TILE.WATER, L_GROUND);
            world.setElevation(x, y, -1);
            world.setFlag(x, y, FLAG.WATER, true);
            game.riverCells.push({ x, y });
        }
        prevCx = cx; prevW = w;
    }

    // Forest: an elliptical blob in the west, trees on ~70% of its cells.
    game.forestCells = [];
    for (let y = 5; y <= 17; y++)
        for (let x = 4; x <= 17; x++) {
            if (((x - 10) / 6.2) ** 2 + ((y - 11) / 5.4) ** 2 > 1) continue;
            if (world.getTile(x, y, L_GROUND) !== TILE.GRASS) continue;
            world.setTile(x, y, TILE.FOREST, L_GROUND);
            game.forestCells.push({ x, y });
        }
    game.trees = [];
    for (const c of game.forestCells) {
        if (rng() > 0.7) continue;
        game.trees.push({
            x: c.x, y: c.y, alive: true, regrowT: 0,
            scale: 0.8 + rng() * 0.5, yaw: rng() * 6.28,
            ox: (rng() - 0.5) * 0.4, oz: (rng() - 0.5) * 0.4,
        });
    }

    // Rocky rise: an elevated stone knoll east of the river.
    game.rockCells = [];
    for (let y = 5; y <= 14; y++)
        for (let x = 39; x <= 46; x++) {
            const d2 = ((x - 42.5) / 3.6) ** 2 + ((y - 9.5) / 3.4) ** 2;
            if (d2 > 1) continue;
            if (world.getTile(x, y, L_GROUND) !== TILE.GRASS) continue;
            world.setTile(x, y, TILE.ROCK, L_GROUND);
            world.setElevation(x, y, d2 < 0.35 ? 2 : 1);
            game.rockCells.push({ x, y });
        }
    // Quarry: the rock cell nearest the village plaza.
    game.quarry = game.rockCells.reduce((a, b) =>
        (Math.abs(b.x - 24) + Math.abs(b.y - 18) < Math.abs(a.x - 24) + Math.abs(a.y - 18)) ? b : a);

    // Farmland: tilled soil south-west of the plaza, all cells sown.
    game.crops = [];
    for (let y = 24; y <= 27; y++)
        for (let x = 16; x <= 21; x++) {
            if (world.getTile(x, y, L_GROUND) !== TILE.GRASS) continue;
            world.setTile(x, y, TILE.SOIL, L_GROUND);
            const stage = (rng() * 2) | 0;
            world.setTile(x, y, CROP_STAGES[stage], L_OVER);
            game.crops.push({ x, y, stage });
        }

    // Village plaza + hearth fire + bench + kitchen.
    for (let y = 16; y <= 18; y++)
        for (let x = 22; x <= 24; x++)
            world.setTile(x, y, TILE.PLAZA, L_GROUND);
    game.hearth = { x: 23, y: 17 };
    game.bench = { x: 22, y: 18 };
    game.kitchen = { x: 24, y: 18 };

    // Homes: five huts ringing the plaza.
    game.homes = [
        { x: 20, y: 14 }, { x: 26, y: 14 }, { x: 19, y: 20 },
        { x: 27, y: 20 }, { x: 23, y: 22 },
    ];

    // Paths: plaza to each hut, to the farm, into the forest, and east over
    // the river (the bridge) toward the quarry.
    game.bridgeCells = [];
    const path = (x0, y0, x1, y1) => drawPathL(game, x0, y0, x1, y1);
    for (const h of game.homes) path(23, 18, h.x, h.y);
    path(22, 18, 18, 25);                          // farm
    path(22, 17, 14, 12);                          // forest
    path(24, 18, 38, 18);                          // east: crosses the river
    path(38, 18, game.quarry.x, game.quarry.y);    // up to the quarry skirt
    // The plaza keeps its flagstones (no path decals on plaza).
    for (let y = 16; y <= 18; y++)
        for (let x = 22; x <= 24; x++)
            world.setTile(x, y, 0, L_OVER);
}

// L-shaped path: horizontal first, then vertical. Water cells become bridge
// planks and drop their WATER flag (walkable crossings); paths stop at the
// rock rise (masons climb the bare stone).
function drawPathL(game, x0, y0, x1, y1) {
    const world = game.world;
    const put = (x, y) => {
        if (!inB(x, y)) return;
        const g = world.getTile(x, y, L_GROUND);
        if (g === TILE.WATER) {
            world.setTile(x, y, TILE.BRIDGE, L_OVER);
            world.setFlag(x, y, FLAG.WATER, false);
            if (!game.bridgeCells.some((c) => c.x === x && c.y === y))
                game.bridgeCells.push({ x, y });
        } else if (g !== TILE.ROCK && world.getTile(x, y, L_OVER) === 0) {
            world.setTile(x, y, TILE.PATH, L_OVER);
        }
    };
    const sx = x0 <= x1 ? 1 : -1, sy = y0 <= y1 ? 1 : -1;
    for (let x = x0; x !== x1 + sx; x += sx) put(x, y0);
    for (let y = y0; y !== y1 + sy; y += sy) put(x1, y);
}
