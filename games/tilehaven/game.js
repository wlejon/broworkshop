// game.js — TileHaven core: a mini city-builder / transport game on a square
// TileWorld.
//
// Procedural terrain (grass plain, meandering animated river with bridgeable
// narrows, forest patches, elevated ore hills), edge-autotiled road painting
// on an overlay layer (roads + bridges connect as you paint, family:
// 'nonEmpty' so road and bridge join each other), buildings as instanced
// props, and a logistics economy: producers only function when road-connected
// to the depot (floodFill over the road layer on every edit), carts haul
// goods along findPath routes over road cells, houses grow population when
// fed and market-connected.

// --- Grid constants ----------------------------------------------------------

export const MAP_W = 28, MAP_H = 20;
export const CELL = 1.0;       // cellSize
export const HSTEP = 0.45;     // heightStep

// Layers: 0 ground, 1 roads (edge-autotiled decals), 2 decals (animated crops)
export const L_GROUND = 0, L_ROADS = 1, L_DECALS = 2;

// Tile ids are GLOBALLY unique across layers: tile animations are keyed by id
// only (bro src/scene/tile_world.cpp buildChunk scans every layer for animated
// ids), so reusing an id on two layers would animate both.
export const TILE = { GRASS: 1, WATER: 2, FOREST: 3, ORE: 4, ROAD: 5, BRIDGE: 6, CROP: 7 };

// One flag bit per concern (single-bit hasFlag/blockMask tests only — the
// engine's isWalkable multi-bit mask is ALL-bits, known paper-cut).
// OFFROAD is set on every non-road cell so cart pathfinding
// (findPath blockMask: OFFROAD) is confined to the road network.
export const FLAG = { OFFROAD: 1, ROAD: 2, BLD: 4 };

// --- Economy constants ---------------------------------------------------------

export const COSTS = {
    road:   { coins: 2,  wood: 0 },
    bridge: { coins: 12, wood: 0 },   // road painted over water
    house:  { coins: 30, wood: 6 },
    farm:   { coins: 35, wood: 8 },
    lumber: { coins: 25, wood: 0 },
    mine:   { coins: 60, wood: 12 },
    market: { coins: 80, wood: 20 },
};
export const BUILD_INFO = {
    house:  { name: 'House',       desc: 'Holds 6 people. Needs food + road to a market.' },
    farm:   { name: 'Farm',        desc: 'Grows food on adjacent grass. 2 workers.' },
    lumber: { name: 'Lumber Camp', desc: 'Cuts wood. Must sit beside a forest. 2 workers.' },
    mine:   { name: 'Mine',        desc: 'Digs ore (sold for coins). Build ON an ore hill. 2 workers.' },
    market: { name: 'Market',      desc: 'Extra delivery hub — shortens cart hauls.' },
};
export const HOUSE_CAP = 6;
export const WORKERS_PER_INDUSTRY = 2;
export const CART_LOAD = 4;
export const MAX_CARTS = 12;
export const CART_SPEED = 2.4;         // cells / second
export const ORE_PRICE = 5;            // coins per ore delivered
export const SELL_RATIO = 0.5;         // bulldoze refund on the coin cost
export const GOAL = { pop: 50, coins: 500 };

// production: seconds per batch, stock gained, resource hauled
export const PROD = {
    farm:   { every: 2.5, gain: 2, res: 'food' },
    lumber: { every: 3.0, gain: 1, res: 'wood' },
    mine:   { every: 3.5, gain: 1, res: 'ore' },
};
const STOCK_CAP = CART_LOAD * 2;

const GROWTH_EVERY = 6;    // s — each fed, connected house gains 1 pop
const FOOD_EVERY = 5;      // s — city eats ceil(pop/10) food
const TAX_EVERY = 10;      // s — coins += floor(pop/2)

export const START = { coins: 300, food: 25, wood: 40, ore: 0 };

// --- Seeded RNG ----------------------------------------------------------------

export function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// --- Procedural tileset atlas ------------------------------------------------
// 16x4 grid of 16px cells (256x64 RGBA).
//   Row 0 (cells  0..15): road edge-autotile variants, mask bit0=E bit1=N
//                         bit2=W bit3=S (atlas cell top edge renders on the
//                         grid-north / y-1 side). Transparent off-road.
//   Row 1 (cells 16..31): bridge variants, same mask order (wood planks).
//   Row 2 (cells 32..47): terrain: 32 grass, 33 forest floor, 34 ore rock,
//                         35..37 water frames, 38 cliff, 40..42 crop frames.

const APX = 16, ACOLS = 16, AROWS = 4;
export const ACELL = {
    ROAD0: 0, BRIDGE0: 16,
    GRASS: 32, FOREST: 33, ORE: 34, WATER0: 35, WATER1: 36, WATER2: 37,
    CLIFF: 38, CROP0: 40, CROP1: 41, CROP2: 42,
};
// tile id -> atlas cell (autotile rules override roads/bridges per-neighbour)
export const TILE_ATLAS = [
    0, ACELL.GRASS, ACELL.WATER0, ACELL.FOREST, ACELL.ORE,
    ACELL.ROAD0, ACELL.BRIDGE0, ACELL.CROP0,
];

// Which pixels of a 16px cell belong to the road shape for edge mask m.
function inRoadShape(x, y, m) {
    if (x >= 5 && x <= 10 && y >= 5 && y <= 10) return true;             // core
    if ((m & 1) && x > 10 && y >= 5 && y <= 10) return true;             // E arm
    if ((m & 2) && y < 5 && x >= 5 && x <= 10) return true;              // N arm
    if ((m & 4) && x < 5 && y >= 5 && y <= 10) return true;              // W arm
    if ((m & 8) && y > 10 && x >= 5 && x <= 10) return true;             // S arm
    return false;
}

export function makeAtlas() {
    const w = ACOLS * APX, h = AROWS * APX;
    const buf = new Uint8Array(w * h * 4);
    const rng = mulberry32(0x7A11E);
    const clamp = (v) => Math.max(0, Math.min(255, v | 0));
    function paint(cell, fn) {
        const cx = (cell % ACOLS) * APX, cy = Math.floor(cell / ACOLS) * APX;
        for (let py = 0; py < APX; py++) {
            for (let px = 0; px < APX; px++) {
                const c = fn(px, py);
                const i = ((cy + py) * w + cx + px) * 4;
                buf[i] = clamp(c[0]); buf[i + 1] = clamp(c[1]); buf[i + 2] = clamp(c[2]);
                buf[i + 3] = c.length > 3 ? clamp(c[3]) : 255;
            }
        }
    }
    const noise = (amt) => (rng() - 0.5) * 2 * amt;

    // Road variants 0..15 — grey cobbles, darker rim where the shape ends.
    for (let m = 0; m < 16; m++) {
        paint(m, (x, y) => {
            if (!inRoadShape(x, y, m)) return [0, 0, 0, 0];
            const n = noise(7);
            const cob = ((x % 4 === 3) || (y % 4 === 3)) ? -16 : 0;
            const rim = !inRoadShape(x - 1, y, m) || !inRoadShape(x + 1, y, m) ||
                        !inRoadShape(x, y - 1, m) || !inRoadShape(x, y + 1, m);
            const mul = rim ? 0.62 : 1;
            return [(122 + n + cob) * mul, (117 + n + cob) * mul, (108 + n + cob) * mul, 255];
        });
    }
    // Bridge variants 16..31 — wooden planks with dark rails.
    for (let m = 0; m < 16; m++) {
        paint(16 + m, (x, y) => {
            if (!inRoadShape(x, y, m)) return [0, 0, 0, 0];
            const n = noise(8);
            const horiz = (m & 5) !== 0 && (m & 10) === 0;   // pure E/W run
            const seam = (horiz ? (x % 3 === 2) : (y % 3 === 2)) ? -34 : 0;
            const rim = !inRoadShape(x - 1, y, m) || !inRoadShape(x + 1, y, m) ||
                        !inRoadShape(x, y - 1, m) || !inRoadShape(x, y + 1, m);
            if (rim) return [72 + n, 50 + n, 26 + n, 255];
            return [158 + n + seam, 116 + n + seam, 66 + n + seam, 255];
        });
    }
    // 32 grass
    paint(ACELL.GRASS, () => {
        const n = noise(9), tuft = rng() < 0.06 ? -16 : 0;
        return [92 + n + tuft, 148 + n * 1.3 + tuft, 66 + n + tuft];
    });
    // 33 forest floor — darker, mulchy
    paint(ACELL.FOREST, () => {
        const n = noise(8), leaf = rng() < 0.10 ? 14 : 0;
        return [52 + n, 96 + n + leaf, 46 + n];
    });
    // 34 ore rock — grey with copper flecks
    paint(ACELL.ORE, () => {
        const n = noise(8);
        if (rng() < 0.07) return [196 + n, 138 + n, 58 + n];
        return [112 + n, 110 + n, 112 + n];
    });
    // 35..37 water frames — drifting shimmer band
    for (let f = 0; f < 3; f++) {
        paint(ACELL.WATER0 + f, (x, y) => {
            const wv = Math.sin((x + f * 5) * 0.55 + y * 0.85);
            const n = noise(5);
            if (wv > 1.0 - f * 0.04 && wv > 0.86) return [116 + n, 182 + n, 226 + n];
            return [30 + n + wv * 4, 88 + n + wv * 6, 150 + n + wv * 7];
        });
    }
    // 38 cliff strata
    paint(ACELL.CLIFF, (x, y) => {
        const strata = (y % 5 === 0) ? -24 : 0;
        const n = noise(7);
        return [104 + n + strata, 88 + n + strata, 62 + n + strata];
    });
    // 40..42 crop frames — soil rows, sprout tips shimmer across frames
    for (let f = 0; f < 3; f++) {
        paint(ACELL.CROP0 + f, (x, y) => {
            const n = noise(6);
            if (y % 4 === 1 || y % 4 === 2) {
                const tip = ((x + f) % 4 === 0) ? 34 : 0;
                return [64 + n + tip * 0.4, 138 + n + tip, 50 + n];
            }
            return [92 + n, 70 + n, 44 + n];
        });
    }
    return { pixels: buf, width: w, height: h };
}

// --- Game factory --------------------------------------------------------------

export function createGame(scene, seed) {
    const atlas = makeAtlas();
    const world = scene.createTileWorld({
        width: MAP_W, height: MAP_H,
        layers: ['ground', 'roads', 'decals'],
        cellSize: CELL, heightStep: HSTEP, chunkSize: 10,
        baseLevel: -3, aoStrength: 0.5,
        atlasPixels: atlas.pixels, atlasWidth: atlas.width, atlasHeight: atlas.height,
        atlasColumns: ACOLS, atlasRows: AROWS,
        tileAtlas: TILE_ATLAS,
        cliffCell: ACELL.CLIFF,
        atlasInset: 0.5,
        autotiles: [
            // THE marquee feature: roads/bridges edge-autotile on the overlay
            // layer, family nonEmpty so they join each other across ids.
            { id: TILE.ROAD, layer: L_ROADS, mode: 'edge', family: 'nonEmpty',
              cells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
            { id: TILE.BRIDGE, layer: L_ROADS, mode: 'edge', family: 'nonEmpty',
              cells: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31] },
        ],
        overlays: [
            {},                        // ground — ignored
            { alphaCutoff: 0.5 },      // roads: cut the road shape from alpha
            { alphaCutoff: 0.5 },      // decals (crops)
        ],
        animations: [
            { id: TILE.WATER, fps: 2.5, frames: [ACELL.WATER0, ACELL.WATER1, ACELL.WATER2] },
            { id: TILE.CROP, fps: 2, frames: [ACELL.CROP0, ACELL.CROP1, ACELL.CROP2] },
        ],
    });

    // ---- object kinds -----------------------------------------------------------
    //
    // ENGINE NOTE / workaround: world.load() drops every registered object kind
    // and all placed instances (known TileWorld bug — loadGrid() clears
    // objectKinds_ even though load() docs say rendering config is preserved).
    // registerKinds() is called once here and again after every world.load();
    // scatterDecor() then re-places the static props and the per-frame sync
    // re-places everything dynamic.

    const kinds = {};
    function registerKinds() {
        const M = Mesh;
        kinds.tree = world.addObjectKind(
            M.merge([
                M.cylinder(0.045, 0.16, 6).translate(0, 0.08, 0),
                M.cone(0.20, 0.30, 7, 1, true).translate(0, 0.32, 0),
                M.cone(0.16, 0.26, 7, 1, true).translate(0, 0.50, 0),
                M.cone(0.11, 0.20, 7, 1, true).translate(0, 0.66, 0),
            ]), { color: [0.18, 0.42, 0.20, 1], roughness: 0.95 });
        kinds.rock = world.addObjectKind(
            M.rock(0.20, 9, 2).translate(0, 0.11, 0),
            { color: [0.48, 0.47, 0.50, 1], roughness: 1.0 });
        kinds.oreChunk = world.addObjectKind(
            M.rock(0.10, 7, 1).translate(0, 0.06, 0),
            { color: [0.85, 0.58, 0.25, 1], roughness: 0.5, metallic: 0.5 });

        kinds.depot = world.addObjectKind(
            M.merge([
                M.box(0.42, 0.05, 0.42).translate(0, 0.05, 0),               // pad
                M.box(0.28, 0.18, 0.21).translate(0, 0.28, 0),               // hall
                M.cone(0.40, 0.26, 4, 1, true).rotate(0, 1, 0, Math.PI / 4)
                    .translate(0, 0.45, 0),                                   // roof
                M.cylinder(0.015, 0.24, 5).translate(0.33, 0.34, 0.33),       // flag pole
                M.box(0.08, 0.045, 0.005).translate(0.42, 0.52, 0.33),        // flag
            ]), { color: [0.92, 0.76, 0.38, 1], roughness: 0.6 });
        kinds.house = world.addObjectKind(
            M.box(0.16, 0.13, 0.14).translate(0, 0.13, 0),
            { color: [0.85, 0.72, 0.55, 1], roughness: 0.8 });
        kinds.houseRoof = world.addObjectKind(
            M.cone(0.25, 0.20, 4, 1, true).rotate(0, 1, 0, Math.PI / 4)
                .translate(0, 0.255, 0),
            { color: [0.72, 0.30, 0.24, 1], roughness: 0.85 });
        kinds.farm = world.addObjectKind(
            M.merge([
                M.box(0.15, 0.12, 0.12).translate(0, 0.12, 0),               // barn
                M.cone(0.22, 0.16, 4, 1, true).rotate(0, 1, 0, Math.PI / 4)
                    .translate(0, 0.235, 0),
                M.cylinder(0.05, 0.15, 8).translate(0.16, 0.15, 0.07),       // silo
                M.cone(0.062, 0.08, 8, 1, true).translate(0.16, 0.30, 0.07), // silo cap
            ]), { color: [0.78, 0.34, 0.26, 1], roughness: 0.85 });
        kinds.lumber = world.addObjectKind(
            M.merge([
                M.box(0.16, 0.11, 0.13).translate(0, 0.11, 0),               // cabin
                M.cone(0.22, 0.14, 4, 1, true).rotate(0, 1, 0, Math.PI / 4)
                    .translate(0, 0.215, 0),
                M.cylinder(0.035, 0.14, 6).rotate(0, 0, 1, Math.PI / 2)
                    .translate(0.02, 0.035, 0.24),                            // logs
                M.cylinder(0.035, 0.12, 6).rotate(0, 0, 1, Math.PI / 2)
                    .translate(-0.02, 0.10, 0.24),
            ]), { color: [0.55, 0.40, 0.24, 1], roughness: 0.9 });
        kinds.mine = world.addObjectKind(
            M.merge([
                M.box(0.16, 0.05, 0.16).translate(0, 0.05, 0),               // base
                M.box(0.025, 0.20, 0.025).translate(-0.10, 0.20, -0.10),     // headframe legs
                M.box(0.025, 0.20, 0.025).translate(0.10, 0.20, -0.10),
                M.box(0.025, 0.20, 0.025).translate(-0.10, 0.20, 0.10),
                M.box(0.025, 0.20, 0.025).translate(0.10, 0.20, 0.10),
                M.box(0.13, 0.025, 0.13).translate(0, 0.42, 0),              // top deck
                M.torus(0.07, 0.02, 10, 6).rotate(0, 0, 1, Math.PI / 2)
                    .translate(0, 0.52, 0),                                   // winding wheel
            ]), { color: [0.45, 0.42, 0.40, 1], roughness: 0.7, metallic: 0.2 });
        kinds.market = world.addObjectKind(
            M.merge([
                M.box(0.20, 0.03, 0.16).translate(0, 0.03, 0),               // counter
                M.cylinder(0.02, 0.16, 5).translate(-0.16, 0.16, -0.12),     // poles
                M.cylinder(0.02, 0.16, 5).translate(0.16, 0.16, -0.12),
                M.cylinder(0.02, 0.16, 5).translate(-0.16, 0.16, 0.12),
                M.cylinder(0.02, 0.16, 5).translate(0.16, 0.16, 0.12),
                M.cone(0.30, 0.15, 4, 1, true).rotate(0, 1, 0, Math.PI / 4)
                    .translate(0, 0.315, 0),                                  // awning
                M.box(0.05, 0.05, 0.05).translate(0.06, 0.11, 0.02),         // crates
                M.box(0.04, 0.04, 0.04).translate(-0.07, 0.10, -0.02),
            ]), { color: [0.30, 0.55, 0.80, 1], roughness: 0.7 });

        kinds.cart = world.addObjectKind(
            M.merge([
                M.box(0.11, 0.045, 0.15).translate(0, 0.115, 0),             // bed
                M.cylinder(0.045, 0.03, 8).rotate(0, 0, 1, Math.PI / 2)
                    .translate(-0.115, 0.055, 0.09),                          // wheels
                M.cylinder(0.045, 0.03, 8).rotate(0, 0, 1, Math.PI / 2)
                    .translate(0.115, 0.055, 0.09),
                M.cylinder(0.045, 0.03, 8).rotate(0, 0, 1, Math.PI / 2)
                    .translate(-0.115, 0.055, -0.09),
                M.cylinder(0.045, 0.03, 8).rotate(0, 0, 1, Math.PI / 2)
                    .translate(0.115, 0.055, -0.09),
                M.sphere(0.05, 8, 6).translate(0, 0.10, 0.20),               // pony
                M.box(0.035, 0.055, 0.055).translate(0, 0.055, 0.20),
            ]), { color: [0.52, 0.36, 0.20, 1], roughness: 0.9 });
        kinds.cargo = world.addObjectKind(
            M.box(0.075, 0.075, 0.075),
            { color: [1, 1, 1, 1], roughness: 0.7 });
        kinds.warn = world.addObjectKind(
            M.merge([
                M.box(0.030, 0.10, 0.030).translate(0, 0.10, 0),
                M.box(0.038, 0.038, 0.038).translate(0, -0.06, 0),
            ]), { color: [1.0, 0.22, 0.16, 1], roughness: 0.4 });
    }
    registerKinds();

    // ---- state ---------------------------------------------------------------

    const game = {
        world, kinds,
        seed: (seed >>> 0) || 20260712,
        time: 0,
        coins: START.coins, food: START.food, wood: START.wood, ore: START.ore,
        pop: 0,
        buildings: [],       // { id, type, x, y, yaw, stock, cartOut, prodT, connected, staffed, pop, cropCells }
        carts: [],           // { id, fromId, targetId, path, seg, t, phase, goods:{res,n}, repath }
        depot: null,
        riverCells: [], narrows: [], forestCells: [], oreCells: [],
        connectedRoads: new Set(),   // "x,y" of road cells reachable from the depot
        netCount: 0,                 // road networks on the map (components stress)
        victory: false, sandbox: false,
        lastRefusal: null,           // { x, y, tool, reason }
        totalHauls: 0, totalOreSold: 0,
        stats: { recomputes: 0, cartsDispatched: 0, cartsRerouted: 0, cartsStranded: 0 },
        // callbacks the shell wires up
        onRefused: null, onVictory: null, onToast: null, onRoadsChanged: null,
    };

    let nextId = 1;
    let growthT = 0, foodT = 0, taxT = 0;

    const inB = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
    const key = (x, y) => x + ',' + y;
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    game.roadAt = (x, y) => inB(x, y) && world.getTile(x, y, L_ROADS) !== 0;
    game.buildingAt = (x, y) => game.buildings.find(b => b.x === x && b.y === y) || null;

    // Edge-autotile mask a road cell should render with (E=1,N=2,W=4,S=8) —
    // mirrors the engine's edgeMask for tests/inspection.
    game.edgeMaskAt = (x, y) =>
        (game.roadAt(x + 1, y) ? 1 : 0) | (game.roadAt(x, y - 1) ? 2 : 0) |
        (game.roadAt(x - 1, y) ? 4 : 0) | (game.roadAt(x, y + 1) ? 8 : 0);

    // ---- terrain generation ---------------------------------------------------

    function genTerrain() {
        const rng = mulberry32(game.seed);
        for (let y = 0; y < MAP_H; y++) {
            for (let x = 0; x < MAP_W; x++) {
                world.setTile(x, y, TILE.GRASS, L_GROUND);
                world.setTile(x, y, 0, L_ROADS);
                world.setTile(x, y, 0, L_DECALS);
                world.setElevation(x, y, 0);
                world.setFlag(x, y, 0xFF, false);
                world.setFlag(x, y, FLAG.OFFROAD, true);
            }
        }

        // River: north->south meander around x=16, width 1..3. Two guaranteed
        // one-cell narrows — the cheap places to bridge.
        const phase = rng() * Math.PI * 2;
        const narrowRows = [3 + (rng() * 4 | 0), 12 + (rng() * 5 | 0)];
        game.riverCells = []; game.narrows = [];
        for (let y = 0; y < MAP_H; y++) {
            const cx = Math.max(8, Math.min(MAP_W - 6,
                Math.round(16 + 3.4 * Math.sin(y * 0.34 + phase) + (rng() - 0.5) * 1.4)));
            let w = 2;
            if (narrowRows.includes(y)) w = 1;
            else if (rng() < 0.30) w = 3;
            const x0 = cx - ((w - 1) >> 1);
            for (let i = 0; i < w; i++) {
                const x = x0 + i;
                world.setTile(x, y, TILE.WATER, L_GROUND);
                world.setElevation(x, y, -1);
                game.riverCells.push({ x, y });
            }
            if (w === 1) game.narrows.push({ x: x0, y });
        }

        // Forest patches: elliptical blobs clear of the river.
        const nearWater = (x, y, r) => {
            for (let dy = -r; dy <= r; dy++)
                for (let dx = -r; dx <= r; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (inB(nx, ny) && world.getTile(nx, ny, L_GROUND) === TILE.WATER) return true;
                }
            return false;
        };
        game.forestCells = [];
        let patches = 0;
        for (let i = 0; i < 200 && patches < 4; i++) {
            const cx = 2 + (rng() * (MAP_W - 4) | 0), cy = 2 + (rng() * (MAP_H - 4) | 0);
            const rx = 1.6 + rng() * 1.6, ry = 1.3 + rng() * 1.3;
            if (nearWater(cx, cy, Math.ceil(Math.max(rx, ry)) + 1)) continue;
            let placed = 0;
            for (let y = Math.max(0, cy - 4); y <= Math.min(MAP_H - 1, cy + 4); y++)
                for (let x = Math.max(0, cx - 4); x <= Math.min(MAP_W - 1, cx + 4); x++) {
                    if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) continue;
                    if (world.getTile(x, y, L_GROUND) !== TILE.GRASS) continue;
                    world.setTile(x, y, TILE.FOREST, L_GROUND);
                    game.forestCells.push({ x, y });
                    placed++;
                }
            if (placed >= 3) patches++;
        }

        // Ore hills: raised rocky blobs (elevation +1, mines go on top).
        game.oreCells = [];
        let hills = 0;
        for (let i = 0; i < 300 && hills < 2; i++) {
            const cx = 2 + (rng() * (MAP_W - 4) | 0), cy = 2 + (rng() * (MAP_H - 4) | 0);
            const r = 1.5 + rng() * 0.9;
            if (nearWater(cx, cy, Math.ceil(r) + 1)) continue;
            const cells = [];
            for (let y = Math.max(0, cy - 3); y <= Math.min(MAP_H - 1, cy + 3); y++)
                for (let x = Math.max(0, cx - 3); x <= Math.min(MAP_W - 1, cx + 3); x++) {
                    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
                    if (world.getTile(x, y, L_GROUND) !== TILE.GRASS) continue;
                    cells.push({ x, y });
                }
            if (cells.length < 4) continue;
            for (const c of cells) {
                world.setTile(c.x, c.y, TILE.ORE, L_GROUND);
                world.setElevation(c.x, c.y, 1);
                game.oreCells.push(c);
            }
            hills++;
        }

        // Depot: a clear grass cell on the west plain, its own cell carries a
        // road tile (the network seed the flood fill grows from).
        let depotCell = null;
        outer:
        for (let ring = 0; ring < 12 && !depotCell; ring++) {
            for (const c of ring === 0 ? [{ x: 7, y: MAP_H >> 1 }]
                : world.cellRing(7, MAP_H >> 1, ring)) {
                if (!inB(c.x, c.y) || c.x > 12) continue;
                let ok = world.getTile(c.x, c.y, L_GROUND) === TILE.GRASS;
                for (const [dx, dy] of DIRS)
                    ok = ok && inB(c.x + dx, c.y + dy) &&
                        world.getTile(c.x + dx, c.y + dy, L_GROUND) === TILE.GRASS;
                if (ok) { depotCell = c; break outer; }
            }
        }
        game.depot = {
            id: nextId++, type: 'depot', x: depotCell.x, y: depotCell.y, yaw: Math.PI / 2,
            stock: 0, cartOut: false, prodT: 0, connected: true, staffed: true,
            pop: 0, cropCells: [],
        };
        game.buildings.push(game.depot);
        world.setTile(depotCell.x, depotCell.y, TILE.ROAD, L_ROADS);
        world.setFlag(depotCell.x, depotCell.y, FLAG.ROAD, true);
        world.setFlag(depotCell.x, depotCell.y, FLAG.OFFROAD, false);
        world.setFlag(depotCell.x, depotCell.y, FLAG.BLD, true);
    }

    // Static props: trees on forest, rocks + ore chunks on hills. Deterministic,
    // so it can be re-run after world.load() (which wipes all instances).
    function scatterDecor() {
        world.clearObjects(kinds.tree);
        world.clearObjects(kinds.rock);
        world.clearObjects(kinds.oreChunk);
        const rng = mulberry32(game.seed ^ 0xDEC0);
        for (let y = 0; y < MAP_H; y++) {
            for (let x = 0; x < MAP_W; x++) {
                const t = world.getTile(x, y, L_GROUND);
                if (t === TILE.FOREST) {
                    const n = 1 + (rng() * 2 | 0);
                    for (let i = 0; i < n; i++)
                        world.addObject(kinds.tree, x, y, {
                            yaw: rng() * 6.28, scale: 0.8 + rng() * 0.55,
                            offsetX: (rng() - 0.5) * 0.6, offsetZ: (rng() - 0.5) * 0.6,
                        });
                } else if (t === TILE.ORE) {
                    world.addObject(kinds.rock, x, y, {
                        yaw: rng() * 6.28, scale: 0.7 + rng() * 0.6,
                        offsetX: (rng() - 0.5) * 0.5, offsetZ: (rng() - 0.5) * 0.5,
                    });
                    if (rng() < 0.6)
                        world.addObject(kinds.oreChunk, x, y, {
                            yaw: rng() * 6.28,
                            offsetX: (rng() - 0.5) * 0.6, offsetZ: (rng() - 0.5) * 0.6,
                        });
                }
            }
        }
    }
    game.registerKinds = registerKinds;
    game.scatterDecor = scatterDecor;

    // ---- road network / connectivity -------------------------------------------
    // Recomputed on EVERY road edit: components() over the road flag gives the
    // network count, floodFill from the depot gives the connected set.

    game.recomputeRoads = function () {
        game.stats.recomputes++;
        game.netCount = world.components({ flag: FLAG.ROAD }).length;
        const fill = world.floodFill(game.depot.x, game.depot.y, { flag: FLAG.ROAD });
        game.connectedRoads = new Set(fill.map(c => key(c.x, c.y)));
        for (const b of game.buildings) {
            if (b.type === 'depot') { b.connected = true; continue; }
            if (b.type === 'market') {
                b.connected = game.connectedRoads.has(key(b.x, b.y));
                continue;
            }
            b.connected = DIRS.some(([dx, dy]) =>
                game.connectedRoads.has(key(b.x + dx, b.y + dy)));
        }
        for (const c of game.carts) c.repath = true;
        if (game.onRoadsChanged) game.onRoadsChanged();
    };

    // First road cell adjacent to a building that is depot-connected.
    game.anchorRoad = function (b) {
        if (b.type === 'depot' || b.type === 'market') return { x: b.x, y: b.y };
        for (const [dx, dy] of DIRS) {
            const x = b.x + dx, y = b.y + dy;
            if (game.connectedRoads.has(key(x, y))) return { x, y };
        }
        return null;
    };

    // ---- roads: paint / cost / bulldoze -----------------------------------------

    game.roadCostAt = function (x, y) {
        return world.getTile(x, y, L_GROUND) === TILE.WATER ? COSTS.bridge : COSTS.road;
    };

    game.canPaintRoad = function (x, y) {
        if (!inB(x, y)) return { ok: false, reason: 'bounds' };
        if (world.getTile(x, y, L_ROADS) !== 0) return { ok: false, reason: 'occupied' };
        if (world.hasFlag(x, y, FLAG.BLD)) return { ok: false, reason: 'building' };
        const g = world.getTile(x, y, L_GROUND);
        if (g === TILE.FOREST || g === TILE.ORE) return { ok: false, reason: 'terrain' };
        const cost = game.roadCostAt(x, y);
        if (game.coins < cost.coins) return { ok: false, reason: 'coins' };
        return { ok: true, bridge: g === TILE.WATER, cost };
    };

    game.paintRoad = function (x, y) {
        const chk = game.canPaintRoad(x, y);
        if (!chk.ok) {
            game.lastRefusal = { x, y, tool: 'road', reason: chk.reason };
            if (game.onRefused) game.onRefused(game.lastRefusal);
            return false;
        }
        game.coins -= chk.cost.coins;
        world.setTile(x, y, chk.bridge ? TILE.BRIDGE : TILE.ROAD, L_ROADS);
        world.setFlag(x, y, FLAG.ROAD, true);
        world.setFlag(x, y, FLAG.OFFROAD, false);
        // Paving over a crop strip retires it from its farm.
        if (world.getTile(x, y, L_DECALS) === TILE.CROP) {
            world.setTile(x, y, 0, L_DECALS);
            for (const b of game.buildings)
                b.cropCells = b.cropCells.filter(c => c.x !== x || c.y !== y);
        }
        game.recomputeRoads();
        return true;
    };

    // ---- buildings ---------------------------------------------------------------

    const nearForest = (x, y) =>
        world.cellsInRange(x, y, 1, 'vertex')
            .some(c => world.getTile(c.x, c.y, L_GROUND) === TILE.FOREST);

    game.canPlace = function (type, x, y) {
        if (!inB(x, y)) return { ok: false, reason: 'bounds' };
        if (world.hasFlag(x, y, FLAG.BLD)) return { ok: false, reason: 'occupied' };
        if (world.getTile(x, y, L_ROADS) !== 0) return { ok: false, reason: 'road' };
        const g = world.getTile(x, y, L_GROUND);
        if (type === 'mine') {
            if (g !== TILE.ORE) return { ok: false, reason: 'ore' };     // mines go ON ore hills
        } else {
            if (g !== TILE.GRASS) return { ok: false, reason: 'terrain' };
            if (type === 'lumber' && !nearForest(x, y)) return { ok: false, reason: 'forest' };
        }
        const cost = COSTS[type];
        if (game.coins < cost.coins) return { ok: false, reason: 'coins' };
        if (game.wood < cost.wood) return { ok: false, reason: 'wood' };
        return { ok: true };
    };

    game.placeBuilding = function (type, x, y) {
        const chk = game.canPlace(type, x, y);
        if (!chk.ok) {
            game.lastRefusal = { x, y, tool: type, reason: chk.reason };
            if (game.onRefused) game.onRefused(game.lastRefusal);
            return null;
        }
        const cost = COSTS[type];
        game.coins -= cost.coins;
        game.wood -= cost.wood;
        const rng = mulberry32((game.seed ^ (x * 73856093) ^ (y * 19349663)) >>> 0);
        const b = {
            id: nextId++, type, x, y,
            yaw: [0, Math.PI / 2, Math.PI, -Math.PI / 2][(rng() * 4) | 0],
            stock: 0, cartOut: false, prodT: -rng() * 1.5,   // stagger production
            connected: false, staffed: false, pop: 0, cropCells: [],
        };
        world.setFlag(x, y, FLAG.BLD, true);
        // Building over a crop strip retires it from its farm.
        if (world.getTile(x, y, L_DECALS) === TILE.CROP) {
            world.setTile(x, y, 0, L_DECALS);
            for (const other of game.buildings)
                other.cropCells = other.cropCells.filter(c => c.x !== x || c.y !== y);
        }
        if (type === 'market') {
            // Markets are hubs: their cell carries road so carts can dock.
            world.setTile(x, y, TILE.ROAD, L_ROADS);
            world.setFlag(x, y, FLAG.ROAD, true);
            world.setFlag(x, y, FLAG.OFFROAD, false);
        }
        if (type === 'farm') {
            for (const [dx, dy] of DIRS) {
                const nx = x + dx, ny = y + dy;
                if (!inB(nx, ny)) continue;
                if (world.getTile(nx, ny, L_GROUND) !== TILE.GRASS) continue;
                if (world.getTile(nx, ny, L_ROADS) !== 0) continue;
                if (world.hasFlag(nx, ny, FLAG.BLD)) continue;
                world.setTile(nx, ny, TILE.CROP, L_DECALS);      // animated field strip
                b.cropCells.push({ x: nx, y: ny });
            }
        }
        game.buildings.push(b);
        game.recomputeRoads();
        return b;
    };

    game.bulldoze = function (x, y) {
        if (!inB(x, y)) return { ok: false, reason: 'bounds' };
        const b = game.buildingAt(x, y);
        if (b) {
            if (b.type === 'depot') return { ok: false, reason: 'depot' };
            const refund = Math.floor(COSTS[b.type].coins * SELL_RATIO);
            game.coins += refund;
            if (b.type === 'house') game.pop = Math.max(0, game.pop - b.pop);
            for (const c of b.cropCells) world.setTile(c.x, c.y, 0, L_DECALS);
            world.setFlag(x, y, FLAG.BLD, false);
            if (b.type === 'market') {
                world.setTile(x, y, 0, L_ROADS);
                world.setFlag(x, y, FLAG.ROAD, false);
                world.setFlag(x, y, FLAG.OFFROAD, true);
            }
            // Carts bound for / from this building despawn (goods lost with it).
            game.carts = game.carts.filter(c => c.fromId !== b.id && c.targetId !== b.id);
            game.buildings.splice(game.buildings.indexOf(b), 1);
            game.recomputeRoads();
            return { ok: true, what: 'building', type: b.type, refund };
        }
        if (world.getTile(x, y, L_ROADS) !== 0) {
            world.setTile(x, y, 0, L_ROADS);
            world.setFlag(x, y, FLAG.ROAD, false);
            world.setFlag(x, y, FLAG.OFFROAD, true);
            game.recomputeRoads();
            return { ok: true, what: 'road', refund: 0 };
        }
        return { ok: false, reason: 'nothing' };
    };

    // ---- carts ---------------------------------------------------------------------

    // Route over ROAD CELLS ONLY: every non-road cell carries FLAG.OFFROAD, so
    // blockMask OFFROAD confines A* to the painted network.
    const roadPath = (x0, y0, x1, y1) =>
        world.findPath(x0, y0, x1, y1, { blockMask: FLAG.OFFROAD });

    // Nearest delivery hub (depot or a connected market) by actual road distance.
    function bestTarget(anchor) {
        let best = null;
        for (const hub of game.buildings) {
            if (hub.type !== 'depot' && hub.type !== 'market') continue;
            if (!hub.connected) continue;
            const p = roadPath(anchor.x, anchor.y, hub.x, hub.y);
            if (!p.length) continue;
            if (!best || p.length < best.path.length) best = { hub, path: p };
        }
        return best;
    }

    function dispatchCart(b) {
        const anchor = game.anchorRoad(b);
        if (!anchor) return;
        const t = bestTarget(anchor);
        if (!t) return;
        const res = PROD[b.type].res;
        game.carts.push({
            id: nextId++, fromId: b.id, targetId: t.hub.id,
            path: [{ x: b.x, y: b.y }, ...t.path],     // roll out of the building
            seg: 0, t: 0, phase: 'out',
            goods: { res, n: CART_LOAD }, repath: false,
        });
        b.stock -= CART_LOAD;
        b.cartOut = true;
        game.stats.cartsDispatched++;
    }

    function deliver(cart) {
        const g = cart.goods;
        if (g.res === 'ore') {
            game.ore += g.n;
            game.coins += g.n * ORE_PRICE;
            game.totalOreSold += g.n;
        } else {
            game[g.res] += g.n;
        }
        game.totalHauls++;
        cart.goods = null;
    }

    function endCart(cart) {
        const home = game.buildings.find(b => b.id === cart.fromId);
        if (home) home.cartOut = false;
        // A stranded outbound cart hands its goods back to the producer.
        if (cart.goods && home) home.stock = Math.min(STOCK_CAP, home.stock + cart.goods.n);
        game.carts.splice(game.carts.indexOf(cart), 1);
    }

    game.cartPos = function (c) {
        const a = c.path[c.seg], b = c.path[Math.min(c.seg + 1, c.path.length - 1)];
        return { x: a.x + (b.x - a.x) * c.t, y: a.y + (b.y - a.y) * c.t };
    };

    function repathCart(c) {
        c.repath = false;
        const pos = game.cartPos(c);
        const cx = Math.round(pos.x), cy = Math.round(pos.y);
        const home = game.buildings.find(b => b.id === c.fromId);
        // The cell under the cart lost its road (and isn't the home building
        // cell) -> stranded.
        const onRoad = game.roadAt(cx, cy) || (home && home.x === cx && home.y === cy);
        let goal = null;
        if (c.phase === 'out') {
            const hub = game.buildings.find(b => b.id === c.targetId);
            if (hub && hub.connected) goal = { x: hub.x, y: hub.y };
            // Hub gone or cut off? try any other hub.
            if (!goal) {
                const t = onRoad ? bestTarget({ x: cx, y: cy }) : null;
                if (t) { c.targetId = t.hub.id; goal = { x: t.hub.x, y: t.hub.y }; }
            }
        } else {
            if (home) {
                const anchor = game.anchorRoad(home);
                if (anchor) goal = anchor;
            }
        }
        const p = (onRoad && goal) ? roadPath(cx, cy, goal.x, goal.y) : [];
        if (!p.length) { game.stats.cartsStranded++; endCart(c); return; }
        c.path = p; c.seg = 0; c.t = 0;
        game.stats.cartsRerouted++;
    }

    function updateCarts(dt) {
        for (const c of [...game.carts]) {
            if (c.repath) { repathCart(c); if (!game.carts.includes(c)) continue; }
            let remaining = CART_SPEED * dt;
            while (remaining > 0) {
                if (c.seg >= c.path.length - 1) {
                    if (c.phase === 'out') {
                        deliver(c);
                        // Head home: retrace to the producer's road anchor.
                        const home = game.buildings.find(b => b.id === c.fromId);
                        if (!home) { endCart(c); break; }
                        const end = c.path[c.path.length - 1];
                        const anchor = game.anchorRoad(home);
                        const p = anchor ? roadPath(end.x, end.y, anchor.x, anchor.y) : [];
                        if (!p.length) { endCart(c); break; }
                        c.phase = 'back';
                        c.path = [...p, { x: home.x, y: home.y }];
                        c.seg = 0; c.t = 0;
                        continue;
                    }
                    endCart(c);
                    break;
                }
                const step = Math.min(remaining, 1 - c.t);
                c.t += step;
                remaining -= step;
                if (c.t >= 1 - 1e-9) { c.seg++; c.t = 0; }
            }
        }
    }

    // ---- economy tick ------------------------------------------------------------

    const INDUSTRY = new Set(['farm', 'lumber', 'mine']);

    function updateStaffing() {
        let workers = game.pop;
        for (const b of game.buildings) {
            if (!INDUSTRY.has(b.type)) continue;
            b.staffed = workers >= WORKERS_PER_INDUSTRY;
            if (b.staffed) workers -= WORKERS_PER_INDUSTRY;
        }
    }

    game.jobs = () => game.buildings.filter(b => INDUSTRY.has(b.type)).length * WORKERS_PER_INDUSTRY;
    game.houseCount = () => game.buildings.filter(b => b.type === 'house').length;

    game.update = function (dt) {
        game.time += dt;
        updateStaffing();

        // Production + cart dispatch
        for (const b of game.buildings) {
            if (!INDUSTRY.has(b.type)) continue;
            const def = PROD[b.type];
            if (b.connected && b.staffed && b.stock < STOCK_CAP) {
                b.prodT += dt;
                while (b.prodT >= def.every && b.stock < STOCK_CAP) {
                    b.prodT -= def.every;
                    b.stock = Math.min(STOCK_CAP, b.stock + def.gain);
                }
            } else {
                b.prodT = Math.min(b.prodT, 0);
            }
            if (b.stock >= CART_LOAD && !b.cartOut && b.connected &&
                game.carts.length < MAX_CARTS)
                dispatchCart(b);
        }

        updateCarts(dt);

        // Population growth: fed + road-connected houses grow.
        growthT += dt;
        while (growthT >= GROWTH_EVERY) {
            growthT -= GROWTH_EVERY;
            for (const b of game.buildings) {
                if (b.type !== 'house' || !b.connected) continue;
                if (b.pop >= HOUSE_CAP || game.food < 1) continue;
                b.pop++;
                game.food--;
                game.pop++;
            }
        }
        // Food upkeep; famine shrinks the city.
        foodT += dt;
        while (foodT >= FOOD_EVERY) {
            foodT -= FOOD_EVERY;
            const eat = Math.ceil(game.pop / 10);
            if (game.food >= eat) game.food -= eat;
            else {
                game.food = 0;
                const h = game.buildings.find(b => b.type === 'house' && b.pop > 0);
                if (h) { h.pop--; game.pop--; }
            }
        }
        // Taxes
        taxT += dt;
        while (taxT >= TAX_EVERY) {
            taxT -= TAX_EVERY;
            game.coins += Math.floor(game.pop / 2);
        }

        if (!game.victory && game.pop >= GOAL.pop && game.coins >= GOAL.coins) {
            game.victory = true;
            if (game.onVictory) game.onVictory();
        }
    };

    // Route a selected building's goods would take (for the tint preview).
    game.routeFor = function (b) {
        if (!b || !b.connected || b.type === 'depot') return [];
        const anchor = game.anchorRoad(b);
        if (!anchor) return [];
        const t = bestTarget(anchor);
        return t ? t.path : [];
    };

    // ---- save / load ----------------------------------------------------------------

    const SAVE_KEY = 'tilehaven-save';
    const bytesToB64 = (bytes) => {
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    };
    const b64ToBytes = (b64) => {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    };

    game.saveCity = function () {
        const data = {
            version: 1,
            seed: game.seed, time: game.time,
            coins: game.coins, food: game.food, wood: game.wood, ore: game.ore,
            pop: game.pop,
            victory: game.victory, sandbox: game.sandbox,
            totalHauls: game.totalHauls, totalOreSold: game.totalOreSold,
            nextId,
            buildings: game.buildings.map(b => ({
                id: b.id, type: b.type, x: b.x, y: b.y, yaw: b.yaw,
                stock: b.stock, cartOut: b.cartOut, pop: b.pop,
                cropCells: b.cropCells.map(c => ({ ...c })),
            })),
            carts: game.carts.map(c => {
                const pos = game.cartPos(c);
                return {
                    id: c.id, fromId: c.fromId, targetId: c.targetId,
                    phase: c.phase, goods: c.goods ? { ...c.goods } : null,
                    px: pos.x, py: pos.y,
                };
            }),
            river: game.riverCells, narrows: game.narrows,
            forest: game.forestCells, oreHills: game.oreCells,
            grid: bytesToB64(world.save()),
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
        return true;
    };

    game.loadCity = function () {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return false;
        let data;
        try { data = JSON.parse(raw); } catch { return false; }
        if (!data || data.version !== 1) return false;
        if (!world.load(b64ToBytes(data.grid))) return false;
        // world.load() destroyed all object kinds + instances (ENGINE NOTE
        // above) — re-register kinds, re-scatter static decor; the per-frame
        // sync re-places buildings/carts.
        registerKinds();
        game.seed = data.seed; game.time = data.time;
        game.coins = data.coins; game.food = data.food;
        game.wood = data.wood; game.ore = data.ore;
        game.pop = data.pop;
        game.victory = data.victory; game.sandbox = data.sandbox;
        game.totalHauls = data.totalHauls; game.totalOreSold = data.totalOreSold;
        nextId = data.nextId;
        game.buildings = data.buildings.map(b => ({
            ...b, prodT: 0, connected: false, staffed: false,
            cropCells: b.cropCells.map(c => ({ ...c })),
        }));
        game.depot = game.buildings.find(b => b.type === 'depot');
        game.riverCells = data.river; game.narrows = data.narrows;
        game.forestCells = data.forest; game.oreCells = data.oreHills;
        scatterDecor();
        game.recomputeRoads();
        // Carts resume from their saved cell; repath rebuilds their routes.
        game.carts = data.carts.map(c => ({
            id: c.id, fromId: c.fromId, targetId: c.targetId,
            phase: c.phase, goods: c.goods ? { ...c.goods } : null,
            path: [{ x: Math.round(c.px), y: Math.round(c.py) },
                   { x: Math.round(c.px), y: Math.round(c.py) }],
            seg: 0, t: 0, repath: true,
        }));
        growthT = foodT = taxT = 0;
        world.rebuildObjects();
        return true;
    };

    game.hasSave = () => localStorage.getItem(SAVE_KEY) !== null;

    // ---- boot ----------------------------------------------------------------------

    genTerrain();
    scatterDecor();
    game.recomputeRoads();
    world.rebuildAll();
    world.rebuildObjects();

    return game;
}

// ═══════════════════════════════════════════════════════════════════════════
// Arcade shell plugin — scene on #view, chrome via /lib/arcade/shell.js
// ═══════════════════════════════════════════════════════════════════════════

let canvas = null;
let scene = null;
let wired = false;
/** @type {object|null} */
let G = null;

const REFUSE_TEXT = {
    coins: "Not enough coins",
    wood: "Not enough wood",
    terrain: "Cannot build on that terrain",
    occupied: "That spot is taken",
    building: "A building is in the way",
    road: "Cannot build on a road",
    forest: "Lumber camps must sit beside a forest",
    ore: "Mines must be built on an ore hill",
    depot: "The depot cannot be demolished",
    bounds: "Out of bounds",
};

const CARGO_COLOR = {
    food: [0.55, 0.95, 0.35, 1],
    wood: [0.62, 0.42, 0.20, 1],
    ore: [1.0, 0.72, 0.25, 1],
};
const HOUSE_TINTS = [
    [0.95, 0.82, 0.62, 1], [0.85, 0.70, 0.72, 1], [0.72, 0.80, 0.88, 1],
];
const SQ = Math.SQRT1_2;

export const game = {
    id: "tilehaven",
    clearColor: "#0a0d12",

    actions: [
        { name: "primary", label: "Confirm", defaults: ["Enter"] },
        { name: "tool_road", label: "Road", defaults: ["r"] },
        { name: "tool_house", label: "House", defaults: ["h"] },
        { name: "tool_farm", label: "Farm", defaults: ["f"] },
        { name: "tool_lumber", label: "Lumber", defaults: ["l"] },
        { name: "tool_mine", label: "Mine", defaults: ["m"] },
        { name: "tool_market", label: "Market", defaults: ["k"] },
        { name: "tool_dozer", label: "Bulldoze", defaults: ["b"] },
        { name: "save", label: "Save", defaults: ["F5"] },
        { name: "load", label: "Load", defaults: ["F9"] },
    ],

    create(ctx) {
        ensureScene();
        ensureWiring();

        const sim = createGame(scene);
        const run = {
            score: 0,
            play: ctx.play,
            highScore: ctx.highScore,
            sim,
            tool: null,
            selected: null,
            hoverCell: null,
            painting: false,
            applied: new Map(),
            camera: { panX: 0, panZ: 0, zoom: 1 },
            baseCX: 0, baseCZ: 0, baseSize: 12,
            panKeys: { right: false, left: false, up: false, down: false },
            lastWarnSig: "",
            toastTimer: null,
            victoryShown: false,
        };
        G = run;
        frameCamera(run);
        fillPaletteCosts();

        sim.onToast = (msg) => toast(run, msg);
        sim.onRefused = (r) => {
            toast(run, REFUSE_TEXT[r.reason] || "Cannot do that");
            ctx.play("refuse");
        };
        sim.onVictory = () => {
            run.score = sim.pop * 10 + sim.coins;
            run.victoryShown = true;
            ctx.play("win");
        };

        exposeDebug(run);
        return run;
    },

    update(run, dt, input) {
        G = run;
        if (!run || !run.sim) return;

        if (run.victoryShown && run.sim.victory && !run.sim.sandbox) {
            run.victoryShown = false;
            fillVictory(run);
            return { status: "screen", name: "victory" };
        }

        const dtSec = Math.min(0.05, Math.max(0, dt / 1000));
        run.sim.update(dtSec);
        run.sim.world.advance(dt);
        updatePan(run, dtSec);

        if (input.pressed("tool_road")) setTool(run, "road");
        if (input.pressed("tool_house")) setTool(run, "house");
        if (input.pressed("tool_farm")) setTool(run, "farm");
        if (input.pressed("tool_lumber")) setTool(run, "lumber");
        if (input.pressed("tool_mine")) setTool(run, "mine");
        if (input.pressed("tool_market")) setTool(run, "market");
        if (input.pressed("tool_dozer")) setTool(run, "dozer");
        if (input.pressed("save") && run.sim.saveCity()) toast(run, "City saved");
        if (input.pressed("load")) doLoad(run);

        // Hold pan via standard directions
        run.panKeys.right = input.down("right");
        run.panKeys.left = input.down("left");
        run.panKeys.up = input.down("up");
        run.panKeys.down = input.down("down");

        const blink = (run.sim.time % 1.2) < 0.7;
        const warnSig = run.sim.buildings.filter(b => !b.connected).map(b => b.id).join(",") +
            "|" + blink + "|" + (run.selected ? run.selected.id : "") + "|" +
            (run.hoverCell ? run.hoverCell.x + "," + run.hoverCell.y + "," + run.tool : "");
        if (warnSig !== run.lastWarnSig) {
            run.lastWarnSig = warnSig;
            applyTints(run);
        }

        syncRender(run);
    },

    draw() {},

    hud(run) {
        if (!run || !run.sim) {
            return { coins: "0", pop: "0", food: "0", wood: "0", ore: "0", carts: "0", goal: "GOAL" };
        }
        const sim = run.sim;
        for (const t of ["road", "house", "farm", "lumber", "mine", "market", "dozer"]) {
            const btn = document.getElementById("btn-" + t);
            if (!btn) continue;
            btn.classList.toggle("selected", run.tool === t);
            if (COSTS[t]) {
                btn.classList.toggle("poor",
                    sim.coins < COSTS[t].coins || sim.wood < COSTS[t].wood);
            }
        }
        refreshInfoPanel(run);
        return {
            coins: String(sim.coins),
            pop: String(sim.pop),
            food: String(sim.food),
            wood: String(sim.wood),
            ore: String(sim.ore),
            carts: String(sim.carts.length),
            goal: sim.victory
                ? "GOAL REACHED"
                : "GOAL  " + sim.pop + "/" + GOAL.pop + " pop · " +
                  Math.min(sim.coins, GOAL.coins) + "/" + GOAL.coins + " coins",
        };
    },

    gameOverText(run) {
        const sim = run && run.sim;
        if (!sim) return "";
        return "Population " + sim.pop + " · " + sim.coins + " coins\n" +
            sim.totalHauls + " cart hauls · " + sim.totalOreSold + " ore sold";
    },

    onMenuAction(action, run) {
        if (action === "continue" && run) {
            run.sim.sandbox = true;
            return "playing";
        }
        return null;
    },

    onEnterScreen(name, run) {
        if (name === "victory" && run) fillVictory(run);
    },

    cue(name, audio) {
        if (name === "refuse") audio.tone(200, 0.06, "square", 0.35);
        else if (name === "win") {
            audio.sequence([
                [523, 0.1, "square", 0.5],
                [659, 0.1, "square", 0.55],
                [784, 0.18, "square", 0.6],
            ]);
        }
    },
};

function ensureScene() {
    if (scene) return;
    canvas = document.getElementById("view");
    if (!canvas) throw new Error("tilehaven: #view canvas missing");
    scene = canvas.getContext("scene");
    if (!scene) throw new Error("tilehaven: scene context unavailable");
    scene.setToneMap({ mode: "aces", exposure: 0.98, gamma: 2.2 });
    scene.setAmbient([0.21, 0.22, 0.26]);
    scene.createLight({
        type: "directional",
        direction: [-0.55, -1.0, -0.30],
        color: [1.0, 0.96, 0.87],
        intensity: 2.0,
    });
    window.addEventListener("resize", () => { if (G) frameCamera(G); });
}

function frameCamera(run) {
    if (!scene || !canvas || !run.sim) return;
    const b = run.sim.world.worldBounds();
    run.baseCX = (b.minX + b.maxX) / 2;
    run.baseCZ = (b.minZ + b.maxZ) / 2;
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    const spanZ = b.maxZ - b.minZ;
    const diag = Math.hypot(b.maxX - b.minX, spanZ);
    run.baseSize = Math.max(spanZ * 0.72 + 2.0, (diag * 0.72 + 1.5) / aspect);
    applyCamera(run, aspect);
}

function applyCamera(run, aspect) {
    if (aspect === undefined) {
        const rect = canvas.getBoundingClientRect();
        aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    }
    const cx = run.baseCX + run.camera.panX, cz = run.baseCZ + run.camera.panZ;
    scene.setCamera({
        mode: "orthographic",
        size: run.baseSize * run.camera.zoom, aspect, near: 0.1, far: 200,
        position: [cx + 14, 16, cz + 14],
        target: [cx, 0, cz],
    });
}

function updatePan(run, dt) {
    const s = 9 * dt * run.camera.zoom;
    let dx = 0, dz = 0;
    if (run.panKeys.right) { dx += SQ * s; dz -= SQ * s; }
    if (run.panKeys.left) { dx -= SQ * s; dz += SQ * s; }
    if (run.panKeys.up) { dx += SQ * s; dz += SQ * s; }
    if (run.panKeys.down) { dx -= SQ * s; dz -= SQ * s; }
    if (dx || dz) {
        run.camera.panX = Math.max(-14, Math.min(14, run.camera.panX + dx));
        run.camera.panZ = Math.max(-10, Math.min(10, run.camera.panZ + dz));
        applyCamera(run);
    }
}

function desiredTints(run) {
    const want = new Map();
    const put = (x, y, rgb) => {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
        want.set(x + "," + y, rgb);
    };
    const sim = run.sim, world = sim.world;
    const blinkOn = (sim.time % 1.2) < 0.7;
    for (const b of sim.buildings) {
        if (b.connected) continue;
        put(b.x, b.y, blinkOn ? [1.9, 0.42, 0.38] : [1.45, 0.6, 0.55]);
    }
    if (run.selected) {
        for (const c of sim.routeFor(run.selected)) put(c.x, c.y, [1.45, 1.3, 0.55]);
        put(run.selected.x, run.selected.y, [1.55, 1.35, 0.6]);
    }
    if (run.tool && run.hoverCell) {
        const { x, y } = run.hoverCell;
        if (run.tool === "road") {
            const chk = sim.canPaintRoad(x, y);
            put(x, y, chk.ok ? (chk.bridge ? [0.65, 1.1, 1.55] : [0.6, 1.5, 0.65])
                : [1.8, 0.45, 0.45]);
        } else if (run.tool === "dozer") {
            const has = sim.buildingAt(x, y) || world.getTile(x, y, L_ROADS) !== 0;
            put(x, y, has ? [1.7, 0.9, 0.4] : [1.2, 1.2, 1.2]);
        } else {
            put(x, y, sim.canPlace(run.tool, x, y).ok ? [0.6, 1.5, 0.65] : [1.8, 0.45, 0.45]);
            if (run.tool === "lumber")
                for (const c of world.cellsInRange(x, y, 1, "vertex"))
                    if (world.getTile(c.x, c.y, L_GROUND) === TILE.FOREST)
                        put(c.x, c.y, [1.2, 1.45, 0.8]);
        }
    }
    return want;
}

function applyTints(run) {
    const world = run.sim.world;
    const want = desiredTints(run);
    let dirty = false;
    for (const k of run.applied.keys()) {
        if (!want.has(k)) {
            const [x, y] = k.split(",").map(Number);
            world.setTint(x, y, 1, 1, 1, 1);
            run.applied.delete(k);
            dirty = true;
        }
    }
    for (const [k, rgb] of want) {
        const cur = run.applied.get(k);
        if (cur && cur[0] === rgb[0] && cur[1] === rgb[1] && cur[2] === rgb[2]) continue;
        const [x, y] = k.split(",").map(Number);
        world.setTint(x, y, rgb[0], rgb[1], rgb[2], 1);
        run.applied.set(k, rgb);
        dirty = true;
    }
    if (dirty) world.rebuild();
}

function syncRender(run) {
    const sim = run.sim, world = sim.world, K = sim.kinds;
    const km = {
        depot: K.depot, house: K.house, farm: K.farm,
        lumber: K.lumber, mine: K.mine, market: K.market,
    };
    for (const t of Object.keys(km)) world.clearObjects(km[t]);
    world.clearObjects(K.houseRoof);
    world.clearObjects(K.cart);
    world.clearObjects(K.cargo);
    world.clearObjects(K.warn);

    for (const b of sim.buildings) {
        const opts = { yaw: b.yaw, scale: b.type === "depot" ? 1.5 : 1.15 };
        if (b.type === "house") {
            opts.color = HOUSE_TINTS[b.id % HOUSE_TINTS.length];
            opts.scale = 1.0 + 0.05 * Math.min(b.pop, HOUSE_CAP);
        }
        world.addObject(km[b.type], b.x, b.y, opts);
        if (b.type === "house")
            world.addObject(K.houseRoof, b.x, b.y, { yaw: opts.yaw, scale: opts.scale });
        if (!b.connected)
            world.addObject(K.warn, b.x, b.y, {
                yOffset: 0.95 + 0.08 * Math.sin(sim.time * 5 + b.id),
            });
    }

    for (const c of sim.carts) {
        const pos = sim.cartPos(c);
        const cx = Math.round(pos.x), cy = Math.round(pos.y);
        const a = c.path[c.seg], b2 = c.path[Math.min(c.seg + 1, c.path.length - 1)];
        const ea = world.getElevation(a.x, a.y) * HSTEP;
        const eb = world.getElevation(b2.x, b2.y) * HSTEP;
        const desiredY = ea + (eb - ea) * c.t + 0.02;
        const cellTop = world.getElevation(cx, cy) * HSTEP;
        const yaw = Math.atan2(b2.x - a.x, b2.y - a.y);
        world.addObject(K.cart, cx, cy, {
            yaw, offsetX: pos.x - cx, offsetZ: pos.y - cy,
            yOffset: desiredY - cellTop,
        });
        if (c.goods)
            world.addObject(K.cargo, cx, cy, {
                yaw, offsetX: pos.x - cx, offsetZ: pos.y - cy,
                yOffset: desiredY - cellTop + 0.19,
                color: CARGO_COLOR[c.goods.res],
            });
    }
    world.rebuildObjects();
}

function toast(run, msg) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.style.display = "";
    if (run.toastTimer) clearTimeout(run.toastTimer);
    run.toastTimer = setTimeout(() => { t.style.display = "none"; }, 1900);
}

function fillPaletteCosts() {
    for (const t of ["road", "house", "farm", "lumber", "mine", "market", "dozer"]) {
        const btn = document.getElementById("btn-" + t);
        if (!btn) continue;
        const costEl = btn.querySelector(".tb-cost");
        if (costEl && COSTS[t]) {
            costEl.textContent = COSTS[t].coins + "c" +
                (COSTS[t].wood ? " + " + COSTS[t].wood + "w" : "");
        }
    }
}

function refreshInfoPanel(run) {
    const panel = document.getElementById("info-panel");
    if (!panel) return;
    if (!run.selected) { panel.style.display = "none"; return; }
    const b = run.selected, sim = run.sim;
    const info = BUILD_INFO[b.type] || { name: "Depot", desc: "The heart of your city." };
    const name = document.getElementById("ip-name");
    const status = document.getElementById("ip-status");
    if (name) name.textContent = info.name;
    let text;
    if (b.type === "depot") text = "Hub · " + sim.totalHauls + " hauls received";
    else if (!b.connected) text = "NOT ROAD-CONNECTED — build a road to the depot!";
    else if (b.type === "house") text = b.pop + "/" + HOUSE_CAP + " residents" +
        (sim.food < 1 ? " · needs food" : "");
    else if (b.type === "market") text = "Trading hub — carts deliver here";
    else if (!b.staffed) text = "NO WORKERS — build houses (" + sim.pop + "/" + sim.jobs() + " jobs filled)";
    else text = "Producing " + PROD[b.type].res + " · stock " + b.stock + "/" + CART_LOAD +
        (b.cartOut ? " · cart en route" : "");
    if (status) {
        status.textContent = text;
        status.classList.toggle("warn-text", !b.connected || (PROD[b.type] && !b.staffed));
    }
    panel.style.display = "";
}

function fillVictory(run) {
    const sim = run.sim;
    const sub = document.getElementById("victory-stats");
    if (sub) {
        sub.textContent =
            "Population " + sim.pop + " · " + sim.coins + " coins · " +
            sim.totalHauls + " cart hauls · " + sim.totalOreSold + " ore sold";
    }
}

function setTool(run, t) {
    run.tool = (run.tool === t) ? null : t;
    run.selected = null;
    applyTints(run);
}

function pickCell(e) {
    if (!G || !scene) return null;
    const rect = canvas.getBoundingClientRect();
    const ray = scene.unprojectLocal(e.clientX - rect.left, e.clientY - rect.top);
    if (!ray) return null;
    const hit = G.sim.world.raycastCell(ray.origin, ray.dir, 500);
    return hit ? { x: hit.x, y: hit.y } : null;
}

function actOnCell(run, x, y) {
    if (run.tool === "road") {
        if (run.sim.paintRoad(x, y)) run.sim.world.rebuild();
        return;
    }
    if (run.tool === "dozer") {
        const r = run.sim.bulldoze(x, y);
        if (r.ok) {
            run.sim.world.rebuild();
            if (r.what === "building") toast(run, "Demolished (+" + r.refund + " coins)");
        } else if (r.reason === "depot") {
            run.sim.onRefused({ reason: "depot" });
        }
        return;
    }
    if (run.tool) {
        const b = run.sim.placeBuilding(run.tool, x, y);
        if (b) run.sim.world.rebuild();
        return;
    }
    const b = run.sim.buildingAt(x, y);
    run.selected = (b && b !== run.selected) ? b : null;
    applyTints(run);
}

function doLoad(run) {
    if (!run.sim.hasSave()) { toast(run, "No saved city"); return; }
    if (run.sim.loadCity()) {
        run.selected = null; run.tool = null;
        run.applied.clear();
        applyTints(run);
        run.sim.world.rebuild();
        toast(run, "City loaded");
    } else toast(run, "Save file is corrupt");
}

function ensureWiring() {
    if (wired) return;
    wired = true;
    ensureScene();

    canvas.addEventListener("mousedown", (e) => {
        if (!G) return;
        if (e.button === 2) { setTool(G, null); return; }
        if (e.button !== 0) return;
        const c = pickCell(e);
        if (!c) return;
        actOnCell(G, c.x, c.y);
        if (G.tool === "road" || G.tool === "dozer") G.painting = true;
    });
    canvas.addEventListener("mouseup", () => { if (G) G.painting = false; });
    canvas.addEventListener("mousemove", (e) => {
        if (!G) return;
        const c = pickCell(e);
        if (!c) {
            if (G.hoverCell) { G.hoverCell = null; applyTints(G); }
            return;
        }
        const changed = !G.hoverCell || G.hoverCell.x !== c.x || G.hoverCell.y !== c.y;
        G.hoverCell = c;
        if (G.painting && changed && (G.tool === "road" || G.tool === "dozer")) {
            actOnCell(G, c.x, c.y);
        }
        if (changed) applyTints(G);
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("wheel", (e) => {
        if (!G) return;
        G.camera.zoom = Math.max(0.45, Math.min(1.6, G.camera.zoom * (1 + e.deltaY * 0.06)));
        applyCamera(G);
    });

    for (const t of ["road", "house", "farm", "lumber", "mine", "market", "dozer"]) {
        const btn = document.getElementById("btn-" + t);
        if (btn) btn.addEventListener("click", () => { if (G) setTool(G, t); });
    }
    const saveBtn = document.getElementById("btn-save");
    if (saveBtn) saveBtn.addEventListener("click", () => {
        if (G && G.sim.saveCity()) toast(G, "City saved");
    });
    const loadBtn = document.getElementById("btn-load");
    if (loadBtn) loadBtn.addEventListener("click", () => { if (G) doLoad(G); });
}

function projectCell(x, y) {
    if (!G || !scene) return { x: 0, y: 0 };
    const world = G.sim.world;
    const c = world.cellCenterWorldXZ(x, y);
    let topY = world.sampleHeight(c.x, c.z);
    if (topY === null) topY = 0;
    const V = scene.viewMatrix, P = scene.projectionMatrix;
    const mul = (m, v) => [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
        m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
    ];
    const clip = mul(P, mul(V, [c.x, topY, c.z, 1]));
    const rect = canvas.getBoundingClientRect();
    return {
        x: rect.left + (clip[0] / clip[3] * 0.5 + 0.5) * rect.width,
        y: rect.top + (1 - (clip[1] / clip[3] * 0.5 + 0.5)) * rect.height,
    };
}

function exposeDebug(run) {
    window.HAVEN = {
        game: run.sim,
        world: run.sim.world,
        scene,
        projectCell,
        actOnCell: (x, y) => actOnCell(run, x, y),
        setTool: (t) => setTool(run, t),
        get tool() { return run.tool; },
        get selected() { return run.selected; },
        TILE, FLAG, COSTS, GOAL, MAP_W, MAP_H,
        debug: {
            addCoins(n) { run.sim.coins += n; },
            addRes(res, n) { run.sim[res] += n; },
            setHousePop(b, n) {
                if (b.type !== "house") return;
                run.sim.pop += n - b.pop;
                b.pop = n;
            },
            fillStock(b) { b.stock = CART_LOAD; },
            select(b) { run.selected = b; applyTints(run); },
        },
    };
}

