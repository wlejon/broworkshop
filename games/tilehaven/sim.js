// sim.js — TileHaven domain: terrain, roads, buildings, carts, economy,
// save/load (createGame + constants). No shell / HUD / camera wiring; that
// lives in game.js. The TileWorld is the map: its tiles, flags, components,
// floodFill and findPath are the rules' data structures.

import { seededRandom } from "/lib/arcade/grid.js";
import { bytesToBase64, base64ToBytes } from "/lib/arcade/save.js";
import { makeAtlas, ACELL, ACOLS, AROWS, TILE_ATLAS } from "/app/atlas.js";
import { registerKinds } from "/app/kinds.js";

export const MAP_W = 28, MAP_H = 20;
export const CELL = 1.0;       // cellSize
export const HSTEP = 0.45;     // heightStep

// Layers: 0 ground, 1 roads (edge-autotiled decals), 2 decals (animated crops)
export const L_GROUND = 0, L_ROADS = 1, L_DECALS = 2;

// Tile ids are GLOBALLY unique across layers: tile animations are keyed by id
// only (bro src/scene/tile_world.cpp buildChunk scans every layer for animated
// ids), so reusing an id on two layers would animate both.
export const TILE = { GRASS: 1, WATER: 2, FOREST: 3, ORE: 4, ROAD: 5, BRIDGE: 6, CROP: 7 };

// One flag bit per concern (single-bit hasFlag/blockMask tests only; the
// engine's isWalkable multi-bit mask is ALL-bits, a known paper-cut).
// OFFROAD is set on every non-road cell so cart pathfinding
// (findPath blockMask: OFFROAD) is confined to the road network.
export const FLAG = { OFFROAD: 1, ROAD: 2, BLD: 4 };

// ── Economy constants ────────────────────────────────────────────────────

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
    depot:  { name: 'Depot',       desc: 'The heart of your city.' },
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
const INDUSTRY = new Set(['farm', 'lumber', 'mine']);

const GROWTH_EVERY = 6;    // s: each fed, connected house gains 1 pop
const FOOD_EVERY = 5;      // s: the city eats ceil(pop/10) food
const TAX_EVERY = 10;      // s: coins += floor(pop/2)

export const START = { coins: 300, food: 25, wood: 40, ore: 0 };

const SAVE_KEY = 'tilehaven-save';
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const inB = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
const key = (x, y) => x + ',' + y;

// ── Game factory ─────────────────────────────────────────────────────────

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
            // The marquee feature: roads/bridges edge-autotile on the overlay
            // layer, family nonEmpty so they join each other across ids.
            { id: TILE.ROAD, layer: L_ROADS, mode: 'edge', family: 'nonEmpty',
              cells: Array.from({ length: 16 }, (_, i) => ACELL.ROAD0 + i) },
            { id: TILE.BRIDGE, layer: L_ROADS, mode: 'edge', family: 'nonEmpty',
              cells: Array.from({ length: 16 }, (_, i) => ACELL.BRIDGE0 + i) },
        ],
        overlays: [
            {},                        // ground: ignored
            { alphaCutoff: 0.5 },      // roads: cut the road shape from alpha
            { alphaCutoff: 0.5 },      // decals (crops)
        ],
        animations: [
            { id: TILE.WATER, fps: 2.5, frames: [ACELL.WATER0, ACELL.WATER1, ACELL.WATER2] },
            { id: TILE.CROP, fps: 2, frames: [ACELL.CROP0, ACELL.CROP1, ACELL.CROP2] },
        ],
    });
    const kinds = registerKinds(world);

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
        // callbacks game.js wires up
        onRefused: null, onVictory: null,
    };

    let nextId = 1;
    let growthT = 0, foodT = 0, taxT = 0;

    game.roadAt = (x, y) => inB(x, y) && world.getTile(x, y, L_ROADS) !== 0;
    game.buildingAt = (x, y) => game.buildings.find(b => b.x === x && b.y === y) || null;

    // Edge-autotile mask a road cell should render with (E=1,N=2,W=4,S=8);
    // mirrors the engine's edgeMask for tests/inspection.
    game.edgeMaskAt = (x, y) =>
        (game.roadAt(x + 1, y) ? 1 : 0) | (game.roadAt(x, y - 1) ? 2 : 0) |
        (game.roadAt(x - 1, y) ? 4 : 0) | (game.roadAt(x, y + 1) ? 8 : 0);

    function refuse(x, y, tool, reason) {
        game.lastRefusal = { x, y, tool, reason };
        if (game.onRefused) game.onRefused(game.lastRefusal);
    }

    // Road cells carry FLAG.ROAD; everything else FLAG.OFFROAD.
    function setRoadFlags(x, y, on) {
        world.setFlag(x, y, FLAG.ROAD, on);
        world.setFlag(x, y, FLAG.OFFROAD, !on);
    }

    // Paving or building over a crop strip retires it from its farm.
    function retireCrop(x, y) {
        if (world.getTile(x, y, L_DECALS) !== TILE.CROP) return;
        world.setTile(x, y, 0, L_DECALS);
        for (const b of game.buildings)
            b.cropCells = b.cropCells.filter(c => c.x !== x || c.y !== y);
    }

    // ── Terrain generation ───────────────────────────────────────────────

    function genTerrain() {
        const rng = seededRandom(game.seed);
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
        // one-cell narrows are the cheap places to bridge.
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

        // Depot: a clear grass cell on the west plain; its own cell carries a
        // road tile (the network seed the flood fill grows from).
        let depotCell = null;
        for (let ring = 0; ring < 12 && !depotCell; ring++) {
            const ringCells = ring === 0 ? [{ x: 7, y: MAP_H >> 1 }] : world.cellRing(7, MAP_H >> 1, ring);
            depotCell = ringCells.find((c) => inB(c.x, c.y) && c.x <= 12 &&
                world.getTile(c.x, c.y, L_GROUND) === TILE.GRASS &&
                DIRS.every(([dx, dy]) => inB(c.x + dx, c.y + dy) &&
                    world.getTile(c.x + dx, c.y + dy, L_GROUND) === TILE.GRASS)) || null;
        }
        game.depot = {
            id: nextId++, type: 'depot', x: depotCell.x, y: depotCell.y, yaw: Math.PI / 2,
            stock: 0, cartOut: false, prodT: 0, connected: true, staffed: true,
            pop: 0, cropCells: [],
        };
        game.buildings.push(game.depot);
        world.setTile(depotCell.x, depotCell.y, TILE.ROAD, L_ROADS);
        setRoadFlags(depotCell.x, depotCell.y, true);
        world.setFlag(depotCell.x, depotCell.y, FLAG.BLD, true);
    }

    // Static props: trees on forest, rocks + ore chunks on hills. Deterministic,
    // so it can be re-run after world.load() (which wipes all instances).
    function scatterDecor() {
        world.clearObjects(kinds.tree);
        world.clearObjects(kinds.rock);
        world.clearObjects(kinds.oreChunk);
        const rng = seededRandom(game.seed ^ 0xDEC0);
        const jitter = (amt) => (rng() - 0.5) * amt;
        for (let y = 0; y < MAP_H; y++) {
            for (let x = 0; x < MAP_W; x++) {
                const t = world.getTile(x, y, L_GROUND);
                if (t === TILE.FOREST) {
                    const n = 1 + (rng() * 2 | 0);
                    for (let i = 0; i < n; i++)
                        world.addObject(kinds.tree, x, y, {
                            yaw: rng() * 6.28, scale: 0.8 + rng() * 0.55,
                            offsetX: jitter(0.6), offsetZ: jitter(0.6),
                        });
                } else if (t === TILE.ORE) {
                    world.addObject(kinds.rock, x, y, {
                        yaw: rng() * 6.28, scale: 0.7 + rng() * 0.6,
                        offsetX: jitter(0.5), offsetZ: jitter(0.5),
                    });
                    if (rng() < 0.6)
                        world.addObject(kinds.oreChunk, x, y, {
                            yaw: rng() * 6.28, offsetX: jitter(0.6), offsetZ: jitter(0.6),
                        });
                }
            }
        }
    }
    game.scatterDecor = scatterDecor;

    // ── Road network / connectivity ──────────────────────────────────────
    // Recomputed on EVERY road edit: components() over the road flag gives the
    // network count, floodFill from the depot gives the connected set.

    game.recomputeRoads = function () {
        game.stats.recomputes++;
        game.netCount = world.components({ flag: FLAG.ROAD }).length;
        const fill = world.floodFill(game.depot.x, game.depot.y, { flag: FLAG.ROAD });
        game.connectedRoads = new Set(fill.map(c => key(c.x, c.y)));
        for (const b of game.buildings) {
            if (b.type === 'depot') b.connected = true;
            else if (b.type === 'market') b.connected = game.connectedRoads.has(key(b.x, b.y));
            else b.connected = DIRS.some(([dx, dy]) => game.connectedRoads.has(key(b.x + dx, b.y + dy)));
        }
        for (const c of game.carts) c.repath = true;
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

    // ── Roads: paint / cost ──────────────────────────────────────────────

    game.roadCostAt = (x, y) =>
        world.getTile(x, y, L_GROUND) === TILE.WATER ? COSTS.bridge : COSTS.road;

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
        if (!chk.ok) { refuse(x, y, 'road', chk.reason); return false; }
        game.coins -= chk.cost.coins;
        world.setTile(x, y, chk.bridge ? TILE.BRIDGE : TILE.ROAD, L_ROADS);
        setRoadFlags(x, y, true);
        retireCrop(x, y);
        game.recomputeRoads();
        return true;
    };

    // ── Buildings ────────────────────────────────────────────────────────

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
        if (!chk.ok) { refuse(x, y, type, chk.reason); return null; }
        const cost = COSTS[type];
        game.coins -= cost.coins;
        game.wood -= cost.wood;
        const rng = seededRandom((game.seed ^ (x * 73856093) ^ (y * 19349663)) >>> 0);
        const b = {
            id: nextId++, type, x, y,
            yaw: [0, Math.PI / 2, Math.PI, -Math.PI / 2][(rng() * 4) | 0],
            stock: 0, cartOut: false, prodT: -rng() * 1.5,   // stagger production
            connected: false, staffed: false, pop: 0, cropCells: [],
        };
        world.setFlag(x, y, FLAG.BLD, true);
        retireCrop(x, y);
        if (type === 'market') {
            // Markets are hubs: their cell carries road so carts can dock.
            world.setTile(x, y, TILE.ROAD, L_ROADS);
            setRoadFlags(x, y, true);
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

    // Remove the building or road at (x, y): { ok, what, refund } or { ok: false, reason }.
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
                setRoadFlags(x, y, false);
            }
            // Carts bound for / from this building despawn (goods lost with it).
            game.carts = game.carts.filter(c => c.fromId !== b.id && c.targetId !== b.id);
            game.buildings.splice(game.buildings.indexOf(b), 1);
            game.recomputeRoads();
            return { ok: true, what: 'building', type: b.type, refund };
        }
        if (world.getTile(x, y, L_ROADS) !== 0) {
            world.setTile(x, y, 0, L_ROADS);
            setRoadFlags(x, y, false);
            game.recomputeRoads();
            return { ok: true, what: 'road', refund: 0 };
        }
        return { ok: false, reason: 'nothing' };
    };

    // ── Carts ────────────────────────────────────────────────────────────

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
        game.carts.push({
            id: nextId++, fromId: b.id, targetId: t.hub.id,
            path: [{ x: b.x, y: b.y }, ...t.path],     // roll out of the building
            seg: 0, t: 0, phase: 'out',
            goods: { res: PROD[b.type].res, n: CART_LOAD }, repath: false,
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

    const homeOf = (cart) => game.buildings.find(b => b.id === cart.fromId);

    function endCart(cart) {
        const home = homeOf(cart);
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
        const home = homeOf(c);
        // The cell under the cart lost its road (and isn't the home building
        // cell) -> stranded.
        const onRoad = game.roadAt(cx, cy) || (home && home.x === cx && home.y === cy);
        let goal = null;
        if (c.phase === 'out') {
            const hub = game.buildings.find(b => b.id === c.targetId);
            if (hub && hub.connected) goal = { x: hub.x, y: hub.y };
            // Hub gone or cut off? Try any other hub.
            if (!goal) {
                const t = onRoad ? bestTarget({ x: cx, y: cy }) : null;
                if (t) { c.targetId = t.hub.id; goal = { x: t.hub.x, y: t.hub.y }; }
            }
        } else if (home) {
            goal = game.anchorRoad(home);
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
                    if (c.phase !== 'out') { endCart(c); break; }
                    deliver(c);
                    // Head home: retrace to the producer's road anchor.
                    const home = homeOf(c);
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
                const step = Math.min(remaining, 1 - c.t);
                c.t += step;
                remaining -= step;
                if (c.t >= 1 - 1e-9) { c.seg++; c.t = 0; }
            }
        }
    }

    // ── Economy tick ─────────────────────────────────────────────────────

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
            if (b.stock >= CART_LOAD && !b.cartOut && b.connected && game.carts.length < MAX_CARTS)
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

    // ── Save / load ──────────────────────────────────────────────────────

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
            grid: bytesToBase64(world.save()),
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
        if (!world.load(base64ToBytes(data.grid))) return false;
        // world.load() keeps the object kinds; game.js re-places buildings
        // and carts every frame, decor is re-scattered here.
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
        game.carts = data.carts.map(c => {
            const at = { x: Math.round(c.px), y: Math.round(c.py) };
            return {
                id: c.id, fromId: c.fromId, targetId: c.targetId,
                phase: c.phase, goods: c.goods ? { ...c.goods } : null,
                path: [at, { ...at }], seg: 0, t: 0, repath: true,
            };
        });
        growthT = foodT = taxT = 0;
        world.rebuildObjects();
        return true;
    };

    game.hasSave = () => localStorage.getItem(SAVE_KEY) !== null;

    // ── Boot ─────────────────────────────────────────────────────────────

    genTerrain();
    scatterDecor();
    game.recomputeRoads();
    world.rebuildAll();
    world.rebuildObjects();
    return game;
}
