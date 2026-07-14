// sim.js — hearthfolk domain (createGame + constants).
// No shell / HUD / scene wiring — that lives in game.js.

export const MAP_W = 48, MAP_H = 36;
export const CELL = 1.0;
export const HSTEP = 0.45;
export const L_GROUND = 0, L_OVER = 1;

// Tile ids are GLOBALLY unique across layers (animations are keyed by id
// across all layers ΓÇö see docs/tile-api.js).
export const TILE = {
    GRASS: 1, WATER: 2, FOREST: 3, ROCK: 4, SOIL: 5, PLAZA: 6,   // ground
    PATH: 7, BRIDGE: 8, CROP_A: 9, CROP_B: 10, CROP_C: 11,       // overlay
};
export const FLAG = { WATER: 1 };
export const CROP_STAGES = [TILE.CROP_A, TILE.CROP_B, TILE.CROP_C];

// --- Sim constants -----------------------------------------------------------

export const DAY_LEN = 120;            // sim seconds per full day
export const WALK_SPEED = 1.8;         // cells / sim second
export const WORK_TICK = 3.0;          // sim seconds per unit of job work
export const TREE_REGROW = 60;         // sim seconds for a stump to regrow
export const MEMORY_CAP = 20;
export const OVERRIDE_DUR = 30;        // sim seconds an accepted think steers
export const THINK_INTERVAL = 6;       // sim seconds between think dispatches
export const SAY_DUR = 4.5;            // sim seconds a said line stays visible
export const HEAR_RANGE = 2;           // cells within which a say is heard

export const START_RES = { food: 4, wood: 6, stone: 0, meals: 2 };

export const VILLAGER_DEFS = [
    { name: 'Rowan', role: 'farmer',   temperament: 'steady',   color: [0.32, 0.46, 0.22, 1], voice: 'am_michael' },
    { name: 'Bryn',  role: 'forester', temperament: 'restless', color: [0.16, 0.38, 0.30, 1], voice: 'am_fenrir' },
    { name: 'Merek', role: 'mason',    temperament: 'gruff',    color: [0.36, 0.38, 0.46, 1], voice: 'am_adam' },
    { name: 'Sella', role: 'cook',     temperament: 'warm',     color: [0.60, 0.28, 0.20, 1], voice: 'af_heart' },
    { name: 'Wynn',  role: 'elder',    temperament: 'wry',      color: [0.40, 0.28, 0.44, 1], voice: 'am_eric' },
];

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
// 16 columns x 4 rows of 16px cells.
//   Row 0 (0..15):  dirt-path edge-autotile variants (E=1,N=2,W=4,S=8).
//   Row 1 (16..31): bridge-plank variants, same mask order.
//   Row 2 (32+):    32 grass, 33 forest floor, 34 rock, 35..37 water frames,
//                   38 cliff, 39 soil, 40 plaza, 41 sprout, 42 young crop,
//                   43..45 ripe crop frames (sway).

const APX = 16, ACOLS = 16, AROWS = 4;
export const ACELL = {
    PATH0: 0, BRIDGE0: 16,
    GRASS: 32, FORESTF: 33, ROCK: 34, WATER0: 35, WATER1: 36, WATER2: 37,
    CLIFF: 38, SOIL: 39, PLAZA: 40, CROPA: 41, CROPB: 42,
    CROPC0: 43, CROPC1: 44, CROPC2: 45,
};
export const TILE_ATLAS = [
    0, ACELL.GRASS, ACELL.WATER0, ACELL.FORESTF, ACELL.ROCK, ACELL.SOIL,
    ACELL.PLAZA, ACELL.PATH0, ACELL.BRIDGE0, ACELL.CROPA, ACELL.CROPB,
    ACELL.CROPC0,
];

function inPathShape(x, y, m) {
    if (x >= 5 && x <= 10 && y >= 5 && y <= 10) return true;
    if ((m & 1) && x > 10 && y >= 5 && y <= 10) return true;
    if ((m & 2) && y < 5 && x >= 5 && x <= 10) return true;
    if ((m & 4) && x < 5 && y >= 5 && y <= 10) return true;
    if ((m & 8) && y > 10 && x >= 5 && x <= 10) return true;
    return false;
}

export function makeAtlas() {
    const w = ACOLS * APX, h = AROWS * APX;
    const buf = new Uint8Array(w * h * 4);
    const rng = mulberry32(0x4EA47);
    const clamp = (v) => Math.max(0, Math.min(255, v | 0));
    function paint(cell, fn) {
        const cx = (cell % ACOLS) * APX, cy = Math.floor(cell / ACOLS) * APX;
        for (let py = 0; py < APX; py++)
            for (let px = 0; px < APX; px++) {
                const c = fn(px, py);
                const i = ((cy + py) * w + cx + px) * 4;
                buf[i] = clamp(c[0]); buf[i + 1] = clamp(c[1]); buf[i + 2] = clamp(c[2]);
                buf[i + 3] = c.length > 3 ? clamp(c[3]) : 255;
            }
    }
    const noise = (amt) => (rng() - 0.5) * 2 * amt;

    // Path variants 0..15 ΓÇö packed dirt, darker rim.
    for (let m = 0; m < 16; m++) {
        paint(m, (x, y) => {
            if (!inPathShape(x, y, m)) return [0, 0, 0, 0];
            const n = noise(8);
            const pebble = rng() < 0.05 ? -20 : 0;
            const rim = !inPathShape(x - 1, y, m) || !inPathShape(x + 1, y, m) ||
                        !inPathShape(x, y - 1, m) || !inPathShape(x, y + 1, m);
            const mul = rim ? 0.66 : 1;
            return [(128 + n + pebble) * mul, (104 + n + pebble) * mul, (74 + n + pebble) * mul, 255];
        });
    }
    // Bridge variants 16..31 ΓÇö planks with dark rails.
    for (let m = 0; m < 16; m++) {
        paint(16 + m, (x, y) => {
            if (!inPathShape(x, y, m)) return [0, 0, 0, 0];
            const n = noise(8);
            const horiz = (m & 5) !== 0 && (m & 10) === 0;
            const seam = (horiz ? (x % 3 === 2) : (y % 3 === 2)) ? -32 : 0;
            const rim = !inPathShape(x - 1, y, m) || !inPathShape(x + 1, y, m) ||
                        !inPathShape(x, y - 1, m) || !inPathShape(x, y + 1, m);
            if (rim) return [70 + n, 48 + n, 26 + n, 255];
            return [152 + n + seam, 112 + n + seam, 62 + n + seam, 255];
        });
    }
    // 32 grass
    paint(ACELL.GRASS, () => {
        const n = noise(9), tuft = rng() < 0.06 ? -14 : 0;
        return [88 + n + tuft, 140 + n * 1.3 + tuft, 62 + n + tuft];
    });
    // 33 forest floor
    paint(ACELL.FORESTF, () => {
        const n = noise(8), leaf = rng() < 0.10 ? 14 : 0;
        return [50 + n, 92 + n + leaf, 44 + n];
    });
    // 34 rock
    paint(ACELL.ROCK, () => {
        const n = noise(9);
        if (rng() < 0.05) return [148 + n, 148 + n, 152 + n];
        return [106 + n, 104 + n, 108 + n];
    });
    // 35..37 water frames
    for (let f = 0; f < 3; f++) {
        paint(ACELL.WATER0 + f, (x, y) => {
            const wv = Math.sin((x + f * 5) * 0.55 + y * 0.85);
            const n = noise(5);
            if (wv > 0.86) return [112 + n, 176 + n, 220 + n];
            return [28 + n + wv * 4, 84 + n + wv * 6, 146 + n + wv * 7];
        });
    }
    // 38 cliff strata
    paint(ACELL.CLIFF, (x, y) => {
        const strata = (y % 5 === 0) ? -22 : 0;
        const n = noise(7);
        return [100 + n + strata, 86 + n + strata, 62 + n + strata];
    });
    // 39 tilled soil rows
    paint(ACELL.SOIL, (x, y) => {
        const n = noise(6);
        const row = (y % 4 < 2) ? -18 : 0;
        return [96 + n + row, 70 + n + row, 46 + n + row];
    });
    // 40 plaza flagstones
    paint(ACELL.PLAZA, (x, y) => {
        const n = noise(6);
        const seam = ((x % 5 === 4) || (y % 5 === 4)) ? -24 : 0;
        return [118 + n + seam, 112 + n + seam, 102 + n + seam];
    });
    // 41 sprout ΓÇö soil with tiny green tips
    paint(ACELL.CROPA, (x, y) => {
        const n = noise(6);
        if ((x % 4 === 1) && (y % 4 === 1)) return [70 + n, 130 + n, 52 + n];
        const row = (y % 4 < 2) ? -16 : 0;
        return [94 + n + row, 68 + n + row, 44 + n + row, 255];
    });
    // 42 young crop ΓÇö green rows
    paint(ACELL.CROPB, (x, y) => {
        const n = noise(7);
        if (y % 4 === 1 || y % 4 === 2) return [64 + n, 128 + n, 48 + n];
        return [90 + n, 66 + n, 42 + n];
    });
    // 43..45 ripe crop frames ΓÇö golden heads swaying
    for (let f = 0; f < 3; f++) {
        paint(ACELL.CROPC0 + f, (x, y) => {
            const n = noise(7);
            if (y % 4 === 1 || y % 4 === 2) {
                const tip = ((x + f) % 3 === 0) ? 30 : 0;
                return [150 + n + tip, 124 + n + tip, 46 + n];
            }
            return [88 + n, 64 + n, 42 + n];
        });
    }
    return { pixels: buf, width: w, height: h };
}

// --- Game factory --------------------------------------------------------------

export function createGame(scene, seed) {
    const atlas = makeAtlas();
    const world = scene.createTileWorld({
        width: MAP_W, height: MAP_H,
        layers: ['ground', 'over'],
        cellSize: CELL, heightStep: HSTEP, chunkSize: 12,
        baseLevel: -3, aoStrength: 0.5,
        atlasPixels: atlas.pixels, atlasWidth: atlas.width, atlasHeight: atlas.height,
        atlasColumns: ACOLS, atlasRows: AROWS,
        tileAtlas: TILE_ATLAS,
        cliffCell: ACELL.CLIFF,
        atlasInset: 0.5,
        autotiles: [
            { id: TILE.PATH, layer: L_OVER, mode: 'edge', family: 'nonEmpty',
              cells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
            { id: TILE.BRIDGE, layer: L_OVER, mode: 'edge', family: 'nonEmpty',
              cells: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31] },
        ],
        overlays: [
            {},
            { alphaCutoff: 0.5 },
        ],
        animations: [
            { id: TILE.WATER, fps: 2.5, frames: [ACELL.WATER0, ACELL.WATER1, ACELL.WATER2] },
            { id: TILE.CROP_C, fps: 2, frames: [ACELL.CROPC0, ACELL.CROPC1, ACELL.CROPC2] },
        ],
    });

    // ---- object kinds -----------------------------------------------------------
    // Registered exactly ONCE. world.load() preserves registered kinds (kind ids
    // stay valid; only instance placements are cleared), so load re-places
    // instances without re-registering ΓÇö game.stats.kindRegistrations proves it.

    const kinds = {};
    const stats = {
        kindRegistrations: 0,
        harvests: 0, treesChopped: 0, stoneMined: 0, mealsCooked: 0,
        fireTends: 0, meals: 0,
    };

    function registerKinds() {
        stats.kindRegistrations++;
        const M = Mesh;
        kinds.tree = world.addObjectKind(
            M.merge([
                M.cylinder(0.05, 0.18, 6).translate(0, 0.09, 0),
                M.cone(0.22, 0.34, 7, 1, true).translate(0, 0.36, 0),
                M.cone(0.17, 0.28, 7, 1, true).translate(0, 0.56, 0),
                M.cone(0.11, 0.22, 7, 1, true).translate(0, 0.74, 0),
            ]), { color: [0.16, 0.36, 0.18, 1], roughness: 0.95 });
        kinds.stump = world.addObjectKind(
            M.cylinder(0.07, 0.08, 7).translate(0, 0.04, 0),
            { color: [0.42, 0.30, 0.18, 1], roughness: 1.0 });
        kinds.hut = world.addObjectKind(
            M.merge([
                M.box(0.20, 0.16, 0.17).translate(0, 0.16, 0),
                M.cone(0.30, 0.22, 4, 1, true).rotate(0, 1, 0, Math.PI / 4)
                    .translate(0, 0.42, 0),
                M.box(0.05, 0.09, 0.02).translate(0, 0.09, 0.175),        // door
            ]), { color: [0.62, 0.50, 0.36, 1], roughness: 0.85 });
        kinds.hutRoof = world.addObjectKind(
            M.cone(0.32, 0.10, 4, 1, true).rotate(0, 1, 0, Math.PI / 4)
                .translate(0, 0.55, 0),
            { color: [0.55, 0.33, 0.20, 1], roughness: 0.9 });
        kinds.hearth = world.addObjectKind(
            M.merge([
                M.torus(0.20, 0.05, 10, 6).translate(0, 0.05, 0),         // stone ring
                M.cylinder(0.04, 0.16, 5).rotate(0, 0, 1, 0.5).translate(0.05, 0.09, 0),
                M.cylinder(0.04, 0.16, 5).rotate(0, 0, 1, -0.5).translate(-0.05, 0.09, 0),
            ]), { color: [0.40, 0.38, 0.38, 1], roughness: 1.0 });
        kinds.flame = world.addObjectKind(
            M.merge([
                M.cone(0.10, 0.26, 6, 1, true).translate(0, 0.20, 0),
                M.cone(0.05, 0.16, 6, 1, true).translate(0.05, 0.16, 0.03),
            ]), { color: [1.0, 0.55, 0.12, 1], roughness: 0.3 });
        kinds.bench = world.addObjectKind(
            M.merge([
                M.box(0.16, 0.02, 0.06).translate(0, 0.10, 0),
                M.box(0.02, 0.05, 0.05).translate(-0.12, 0.05, 0),
                M.box(0.02, 0.05, 0.05).translate(0.12, 0.05, 0),
            ]), { color: [0.50, 0.38, 0.24, 1], roughness: 0.9 });
        kinds.kitchen = world.addObjectKind(
            M.merge([
                M.box(0.16, 0.10, 0.10).translate(0, 0.10, 0),            // table
                M.cylinder(0.06, 0.05, 8).translate(0.04, 0.225, 0),      // pot
            ]), { color: [0.46, 0.34, 0.24, 1], roughness: 0.8 });
        kinds.meal = world.addObjectKind(
            M.merge([
                M.cylinder(0.045, 0.015, 8).translate(0, 0.008, 0),
                M.sphere(0.028, 8, 6).translate(0, 0.035, 0),
            ]), { color: [0.75, 0.58, 0.28, 1], roughness: 0.6 });
        kinds.stone = world.addObjectKind(
            M.rock(0.09, 8, 2).translate(0, 0.05, 0),
            { color: [0.52, 0.52, 0.56, 1], roughness: 1.0 });
        kinds.boulder = world.addObjectKind(
            M.rock(0.22, 9, 3).translate(0, 0.12, 0),
            { color: [0.44, 0.43, 0.46, 1], roughness: 1.0 });
        kinds.logPile = world.addObjectKind(
            M.merge([
                M.cylinder(0.035, 0.16, 6).rotate(0, 0, 1, Math.PI / 2).translate(0, 0.035, 0.03),
                M.cylinder(0.035, 0.16, 6).rotate(0, 0, 1, Math.PI / 2).translate(0, 0.035, -0.04),
                M.cylinder(0.035, 0.14, 6).rotate(0, 0, 1, Math.PI / 2).translate(0, 0.10, -0.005),
            ]), { color: [0.48, 0.35, 0.20, 1], roughness: 0.95 });

        // One kind per villager ΓÇö distinct silhouettes + colours per role.
        kinds.villagers = [];
        for (const def of VILLAGER_DEFS) {
            const parts = [
                M.cylinder(0.075, 0.20, 8).translate(0, 0.13, 0),           // body
                M.sphere(0.062, 10, 8).translate(0, 0.30, 0),               // head
            ];
            switch (def.role) {
                case 'farmer':
                    parts.push(M.cone(0.11, 0.045, 9, 1, true).translate(0, 0.345, 0)); // straw hat
                    break;
                case 'forester':
                    parts.push(M.cone(0.07, 0.11, 7, 1, true).translate(0, 0.36, 0));   // pointed hood
                    break;
                case 'mason':
                    parts.push(M.box(0.10, 0.03, 0.10).translate(0, 0.355, 0));         // flat cap
                    break;
                case 'cook':
                    parts.push(M.cylinder(0.055, 0.06, 8).translate(0, 0.37, 0));       // toque
                    break;
                case 'elder':
                    parts.push(M.cylinder(0.012, 0.34, 5).translate(0.10, 0.17, 0));    // staff
                    break;
            }
            kinds.villagers.push(world.addObjectKind(M.merge(parts),
                { color: def.color, roughness: 0.8 }));
        }
    }
    registerKinds();

    // ---- state ---------------------------------------------------------------

    const game = {
        world, kinds, stats,
        seed: (seed >>> 0) || 20260712,
        time: 0,                     // sim seconds
        speed: 1,                    // 0 pause, 1, 4
        res: { ...START_RES },
        fire: 1.0,                   // hearth fire level 0..1
        villagers: [],
        trees: [],                   // { x, y, alive, regrowT, scale, yaw, ox, oz }
        crops: [],                   // { x, y, stage 0..2 }
        chronicle: [],               // { t, day, text, kind }
        hearth: null, bench: null, kitchen: null, quarry: null,
        homes: [], bridgeCells: [],
        dirty: { trees: true, static: true, piles: true },
        mind: {
            status: 'off',           // 'off' | 'loading' | 'ready' | 'test'
            statusText: 'minds: off',
            accepted: 0, discarded: 0,
            inFlight: false,
            thinkT: 0,
            generate: null,          // app-installed: (promptText, parts) => Promise<string>
            lastPrompt: null,        // last prompt text dispatched (tests inspect)
        },
        onSay: null,                 // app hook: (villager, text) => void
        onChronicle: null,           // app hook: (entry) => void
    };

    const inB = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

    game.day = () => Math.floor(game.time / DAY_LEN) + 1;
    game.tod = () => (game.time % DAY_LEN) / DAY_LEN;
    game.isNight = () => game.tod() >= 0.70;
    game.phaseName = () => {
        const t = game.tod();
        if (t < 0.08) return 'dawn';
        if (t < 0.45) return 'morning';
        if (t < 0.55) return 'midday';
        if (t < 0.70) return 'evening';
        return 'night';
    };

    function addEvent(text, kind) {
        const e = { t: game.time, day: game.day(), phase: game.phaseName(), text, kind: kind || 'event' };
        game.chronicle.push(e);
        if (game.chronicle.length > 250) game.chronicle.shift();
        if (game.onChronicle) game.onChronicle(e);
        return e;
    }
    game.addEvent = addEvent;

    // ---- terrain generation ---------------------------------------------------

    function drawPathL(x0, y0, x1, y1) {
        // L-shaped path: horizontal first, then vertical. Water cells become
        // bridge planks and drop their WATER flag (walkable crossings).
        const put = (x, y) => {
            if (!inB(x, y)) return;
            const g = world.getTile(x, y, L_GROUND);
            if (g === TILE.WATER) {
                world.setTile(x, y, TILE.BRIDGE, L_OVER);
                world.setFlag(x, y, FLAG.WATER, false);
                if (!game.bridgeCells.some(c => c.x === x && c.y === y))
                    game.bridgeCells.push({ x, y });
            } else if (g === TILE.ROCK) {
                // paths stop at the rock rise ΓÇö masons climb the bare stone
            } else if (world.getTile(x, y, L_OVER) === 0) {
                world.setTile(x, y, TILE.PATH, L_OVER);
            }
        };
        const sx = x0 <= x1 ? 1 : -1, sy = y0 <= y1 ? 1 : -1;
        for (let x = x0; x !== x1 + sx; x += sx) put(x, y0);
        for (let y = y0; y !== y1 + sy; y += sy) put(x1, y);
    }

    function genTerrain() {
        const rng = mulberry32(game.seed);
        for (let y = 0; y < MAP_H; y++)
            for (let x = 0; x < MAP_W; x++) {
                world.setTile(x, y, TILE.GRASS, L_GROUND);
                world.setTile(x, y, 0, L_OVER);
                world.setElevation(x, y, 0);
                world.setFlag(x, y, 0xFF, false);
            }

        // River: north->south meander around x=33, width 1..2 ΓÇö crosses every
        // row so the east bank is reachable ONLY over a bridge. Row-to-row
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

        // Forest: an elliptical blob in the west.
        game.forestCells = [];
        for (let y = 5; y <= 17; y++)
            for (let x = 4; x <= 17; x++) {
                if (((x - 10) / 6.2) ** 2 + ((y - 11) / 5.4) ** 2 > 1) continue;
                if (world.getTile(x, y, L_GROUND) !== TILE.GRASS) continue;
                world.setTile(x, y, TILE.FOREST, L_GROUND);
                game.forestCells.push({ x, y });
            }
        // Trees on ~70% of forest cells.
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
        // Quarry: the rock cell nearest the village (min x+y toward plaza).
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

        // Paths: plaza to each hut, to the farm, into the forest, and east
        // over the river (the bridge) toward the quarry.
        game.bridgeCells = [];
        for (const h of game.homes) drawPathL(23, 18, h.x, h.y);
        drawPathL(22, 18, 18, 25);                      // farm
        drawPathL(22, 17, 14, 12);                      // forest
        drawPathL(24, 18, 38, 18);                      // east: crosses the river
        drawPathL(38, 18, game.quarry.x, game.quarry.y); // up to the quarry skirt
        // The plaza keeps its flagstones (no path decals on plaza).
        for (let y = 16; y <= 18; y++)
            for (let x = 22; x <= 24; x++)
                world.setTile(x, y, 0, L_OVER);
    }

    // ---- villagers ---------------------------------------------------------------

    function makeVillagers() {
        game.villagers = VILLAGER_DEFS.map((def, i) => ({
            id: i, ...def,
            home: { ...game.homes[i] },
            pos: { x: game.homes[i].x, y: game.homes[i].y },
            path: null, seg: 0, segT: 0, target: null,
            activity: 'idle',
            goal: 'starting the day',
            needs: { hunger: 0.25 + i * 0.04, energy: 0.15 + i * 0.03, social: 0.2 + i * 0.05, warmth: 0.1 },
            workT: 0, actT: 0, commit: null,
            memories: [],
            counts: { ate: 0, slept: 0, worked: 0, socialized: 0 },
            override: null,          // { until, action, target }
            heard: null,             // { from, text, t }
            say: null,               // { text, until }
            lastThink: null,         // { raw, parsed, t, discarded }
            lastThinkT: -1,
        }));
    }

    game.villagerByName = (n) => game.villagers.find(v => v.name === n) || null;

    const cellOf = (v) => ({ x: Math.round(v.pos.x), y: Math.round(v.pos.y) });
    game.cellOf = cellOf;

    function workSpot(v) {
        switch (v.role) {
            case 'farmer': {
                // Ripe crops first (harvest), else the least-grown one.
                const c = cellOf(v);
                let best = null, bestScore = Infinity;
                for (const cr of game.crops) {
                    const d = world.cellDistance(c.x, c.y, cr.x, cr.y);
                    const score = (cr.stage === 2 ? 0 : 100) + d;
                    if (score < bestScore) { bestScore = score; best = cr; }
                }
                return best ? { x: best.x, y: best.y } : { ...game.hearth };
            }
            case 'forester': {
                // Nearest standing tree via a weighted distance field (rock
                // slows, water blocks) ΓÇö the Dijkstra variant of distanceField.
                const c = cellOf(v);
                const field = world.distanceField([c], {
                    blockMask: FLAG.WATER,
                    costs: [0, 1, 1, 1.5, 4, 1, 1],
                });
                let best = null, bestD = Infinity;
                for (const t of game.trees) {
                    if (!t.alive) continue;
                    const d = field[t.y * MAP_W + t.x];
                    if (d >= 0 && d < bestD) { bestD = d; best = t; }
                }
                return best ? { x: best.x, y: best.y } : { ...game.hearth };
            }
            case 'mason': return { ...game.quarry };
            case 'cook': return { ...game.kitchen };
            case 'elder': return { ...game.bench };
        }
    }

    function spotFor(v, action) {
        switch (action) {
            case 'work': return workSpot(v);
            case 'eat': return { ...game.hearth };
            case 'rest': return { ...v.home };
            case 'socialize': {
                let best = null, bestD = Infinity;
                const c = cellOf(v);
                for (const o of game.villagers) {
                    if (o === v) continue;
                    const oc = cellOf(o);
                    const d = world.cellDistance(c.x, c.y, oc.x, oc.y);
                    if (d < bestD) { bestD = d; best = oc; }
                }
                return best || { ...game.hearth };
            }
            default: return cellOf(v);
        }
    }

    // ---- tier 0: utility AI ---------------------------------------------------

    function decide(v) {
        if (v.override && game.time < v.override.until) {
            v.commit = null;
            return { action: v.override.action || 'idle', target: v.override.target };
        }
        if (v.override) v.override = null;

        const night = game.isNight();
        const canEat = game.res.meals > 0 || game.res.food > 0;

        // Trip commitment: a chosen destination holds until arrival ΓÇö no
        // mid-route flip-flopping ΓÇö unless a need turns genuinely critical
        // (or night falls on a work commute).
        if (v.commit) {
            const c = cellOf(v);
            const done = c.x === v.commit.target.x && c.y === v.commit.target.y;
            const crisis = (canEat && v.needs.hunger > 0.85) || v.needs.energy > 0.92 ||
                (night && v.commit.action === 'work');
            if (!done && !crisis) return v.commit;
            v.commit = null;
        }

        // Hysteresis: stick with a need-driven activity until it completes.
        if (v.activity === 'eating' && v.actT > 0) return { action: 'eat', target: { ...game.hearth } };
        if (v.activity === 'sleeping' && (night || v.needs.energy > 0.08))
            return { action: 'rest', target: { ...v.home } };
        if (v.activity === 'socializing' && v.needs.social > 0.15)
            return { action: 'socialize', target: spotFor(v, 'socialize') };
        if (v.activity === 'warming' && v.needs.warmth > 0.10)
            return { action: 'warm', target: { ...game.hearth } };

        const opts = [
            ['eat', v.needs.hunger * (canEat ? 1.0 : 0.35)],
            // At night the village default is bed ΓÇö the floor sends everyone
            // home even when not exhausted. Daytime naps only when spent.
            ['rest', night ? Math.max(v.needs.energy * 1.7, 0.56) : v.needs.energy * 0.6],
            ['socialize', v.needs.social * 1.0],
            ['warm', v.needs.warmth * (night ? 1.3 : 0.5)],
            ['work', night ? 0.10 : 0.52],
        ];
        let best = 'work', bestU = -1;
        for (const [a, u] of opts) if (u > bestU) { bestU = u; best = a; }
        // Need-driven actions only trigger past a threshold; otherwise work.
        if (best !== 'work' && bestU < 0.52) best = 'work';
        const plan = { action: best, target: best === 'warm' ? { ...game.hearth } : spotFor(v, best) };
        const c = cellOf(v);
        if (plan.target.x !== c.x || plan.target.y !== c.y) v.commit = plan;
        return plan;
    }

    const ACT_NAME = {
        work: 'working', eat: 'eating', rest: 'sleeping',
        socialize: 'socializing', warm: 'warming', idle: 'idle',
    };

    function ensurePath(v, target) {
        // An in-progress walk toward this same target continues ΓÇö arrival is
        // when walk() exhausts the path (pos lands exactly on the target
        // centre), NOT when the rounded cell first matches; snapping early
        // would pop the elevation-lerped Y half a cell out.
        const cur = v.target;
        if (v.path && cur && cur.x === target.x && cur.y === target.y) return false;
        const c = cellOf(v);
        if (!v.path && c.x === target.x && c.y === target.y) return true;
        const p = world.findPath(c.x, c.y, target.x, target.y, { blockMask: FLAG.WATER });
        if (!p.length) { v.path = null; v.target = null; return false; }
        v.path = p; v.seg = 0; v.segT = 0; v.target = { ...target };
        return false;
    }

    function walk(v, dt) {
        if (!v.path) return;
        let remaining = WALK_SPEED * dt;
        while (remaining > 0 && v.path) {
            if (v.seg >= v.path.length - 1) {
                const end = v.path[v.path.length - 1];
                v.pos = { x: end.x, y: end.y };
                v.path = null;
                break;
            }
            const step = Math.min(remaining, 1 - v.segT);
            v.segT += step;
            remaining -= step;
            const a = v.path[v.seg], b = v.path[v.seg + 1];
            v.pos = { x: a.x + (b.x - a.x) * v.segT, y: a.y + (b.y - a.y) * v.segT };
            if (v.segT >= 1 - 1e-9) { v.seg++; v.segT = 0; }
        }
    }

    // The Y a villager renders at: elevation-lerped between the current path
    // segment's cells (movers re-anchor per frame ΓÇö see docs/tile-api.js).
    game.renderInfo = function (v) {
        const c = cellOf(v);
        let y;
        if (v.path && v.seg < v.path.length - 1) {
            const a = v.path[v.seg], b = v.path[v.seg + 1];
            y = (world.getElevation(a.x, a.y) +
                (world.getElevation(b.x, b.y) - world.getElevation(a.x, a.y)) * v.segT) * HSTEP;
        } else {
            y = world.getElevation(c.x, c.y) * HSTEP;
        }
        return {
            anchor: c,
            offsetX: v.pos.x - c.x, offsetZ: v.pos.y - c.y,
            worldY: y,
            yOffset: y - world.getElevation(c.x, c.y) * HSTEP,
        };
    };

    function doWork(v) {
        switch (v.role) {
            case 'farmer': {
                const c = cellOf(v);
                const cr = game.crops.find(k => k.x === c.x && k.y === c.y);
                if (!cr) return false;
                if (cr.stage < 2) {
                    cr.stage++;
                    world.setTile(cr.x, cr.y, CROP_STAGES[cr.stage], L_OVER);
                } else {
                    cr.stage = 0;
                    world.setTile(cr.x, cr.y, CROP_STAGES[0], L_OVER);
                    game.res.food++;
                    stats.harvests++;
                    addEvent(v.name + ' harvests grain (food ' + game.res.food + ')', 'work');
                }
                world.rebuild();
                return true;
            }
            case 'forester': {
                const c = cellOf(v);
                const t = game.trees.find(t => t.alive &&
                    world.cellDistance(t.x, t.y, c.x, c.y) <= 1);
                if (!t) return false;
                t.alive = false;
                t.regrowT = TREE_REGROW;
                game.res.wood++;
                stats.treesChopped++;
                game.dirty.trees = true;
                addEvent(v.name + ' fells a tree (wood ' + game.res.wood + ')', 'work');
                return true;
            }
            case 'mason': {
                const c = cellOf(v);
                if (world.cellDistance(c.x, c.y, game.quarry.x, game.quarry.y) > 1) return false;
                game.res.stone++;
                stats.stoneMined++;
                game.dirty.piles = true;
                addEvent(v.name + ' cuts stone (stone ' + game.res.stone + ')', 'work');
                return true;
            }
            case 'cook': {
                const c = cellOf(v);
                if (world.cellDistance(c.x, c.y, game.kitchen.x, game.kitchen.y) > 1) return false;
                if (game.res.food <= 0) return false;
                game.res.food--;
                game.res.meals++;
                stats.mealsCooked++;
                game.dirty.piles = true;
                addEvent(v.name + ' cooks a meal (meals ' + game.res.meals + ')', 'work');
                return true;
            }
            case 'elder': {
                const c = cellOf(v);
                if (world.cellDistance(c.x, c.y, game.bench.x, game.bench.y) > 1) return false;
                if (game.fire < 0.55 && game.res.wood > 0) {
                    game.res.wood--;
                    game.fire = Math.min(1, game.fire + 0.5);
                    stats.fireTends++;
                    game.dirty.piles = true;
                    addEvent(v.name + ' feeds the hearth fire (wood ' + game.res.wood + ')', 'work');
                } else {
                    stats.fireTends++;   // keeping watch counts as the elder's work
                }
                return true;
            }
        }
        return false;
    }

    function nearFire(v) {
        const c = cellOf(v);
        return world.cellDistance(c.x, c.y, game.hearth.x, game.hearth.y) <= 2 && game.fire > 0.1;
    }

    function updateVillager(v, dt) {
        const night = game.isNight();
        const sleeping = v.activity === 'sleeping';

        // Needs decay.
        v.needs.hunger = Math.min(1, v.needs.hunger + dt / 75);
        v.needs.energy = sleeping
            ? Math.max(0, v.needs.energy - dt / 10)
            : Math.min(1, v.needs.energy + dt / 110);
        v.needs.social = v.activity === 'socializing'
            ? Math.max(0, v.needs.social - dt / 5)
            : Math.min(1, v.needs.social + dt / 90);
        const atHomeOrFire = sleeping || nearFire(v) || !night;
        v.needs.warmth = atHomeOrFire
            ? Math.max(0, v.needs.warmth - dt / 8)
            : Math.min(1, v.needs.warmth + dt / 55);

        // Decide + move.
        const plan = decide(v);
        const name = ACT_NAME[plan.action] || 'idle';
        const arrived = ensurePath(v, plan.target);
        if (!arrived && v.path) {
            if (v.activity !== 'walking' || v.plannedAct !== name) {
                v.activity = 'walking';
                v.plannedAct = name;
            }
            walk(v, dt);
            return;
        }

        // At the target: perform.
        if (v.activity !== name) {
            v.activity = name;
            v.actT = 0;
            v.workT = 0;
            if (name === 'sleeping') { v.counts.slept++; addEvent(v.name + ' turns in for the night', 'life'); }
            if (name === 'socializing') v.counts.socialized++;
            if (name === 'eating') v.actT = 2.5;   // meal takes 2.5 sim s
        }

        switch (name) {
            case 'eating':
                v.actT -= dt;
                if (v.actT <= 0) {
                    if (game.res.meals > 0) {
                        game.res.meals--;
                        v.needs.hunger = 0.04;
                        game.dirty.piles = true;
                        addEvent(v.name + ' eats a warm meal at the hearth', 'life');
                    } else if (game.res.food > 0) {
                        game.res.food--;
                        v.needs.hunger = 0.25;
                        addEvent(v.name + ' snacks on raw grain', 'life');
                    } else {
                        v.needs.hunger = Math.max(0.5, v.needs.hunger - 0.2);
                    }
                    v.counts.ate++;
                    v.activity = 'idle';
                }
                break;
            case 'working':
                v.workT += dt;
                while (v.workT >= WORK_TICK) {
                    v.workT -= WORK_TICK;
                    if (doWork(v)) v.counts.worked++;
                    // Re-target after every tick: farmers rotate crop cells,
                    // foresters pick the next tree; fixed posts re-resolve to
                    // the same spot.
                    v.plannedAct = null; v.target = null;
                    if (v.override) break;   // override targets stay put
                }
                break;
            case 'sleeping':
                // handled by the needs block; waking happens via decide().
                break;
            case 'socializing': {
                // Drift toward the partner if they moved away.
                const c = cellOf(v);
                const near = game.villagers.some(o => o !== v &&
                    world.cellDistance(c.x, c.y, cellOf(o).x, cellOf(o).y) <= 2);
                if (!near) { v.target = null; v.plannedAct = null; }
                break;
            }
            case 'warming':
            case 'idle':
                break;
        }
    }

    // ---- speech / hearing --------------------------------------------------------

    game.speak = function (v, text) {
        v.say = { text, until: game.time + SAY_DUR };
        addEvent(v.name + ': ΓÇ£' + text + 'ΓÇ¥', 'say');
        const c = cellOf(v);
        for (const o of game.villagers) {
            if (o === v) continue;
            const oc = cellOf(o);
            if (world.cellDistance(c.x, c.y, oc.x, oc.y) <= HEAR_RANGE)
                o.heard = { from: v.name, text, t: game.time };
        }
        if (game.onSay) game.onSay(v, text);
    };

    // ---- tier 1: the mind ----------------------------------------------------------

    game.buildThink = function (v) {
        const c = cellOf(v);
        const needsPct = (n) => Math.round(n * 100);
        const nearby = game.villagers
            .filter(o => o !== v && world.cellDistance(c.x, c.y, cellOf(o).x, cellOf(o).y) <= 6)
            .map(o => o.name + ' the ' + o.role + ' (' + o.activity + ', ' +
                cellOf(o).x + ',' + cellOf(o).y + ')');
        const recent = game.chronicle.slice(-5).map(e => e.text);
        const mems = v.memories.slice(-8);
        const system =
            'You are the mind of ' + v.name + ', a ' + v.temperament + ' ' + v.role +
            ' in the tiny village of Hearthfolk. You decide what ' + v.name +
            ' does next. Respond with EXACTLY one JSON object on a single line and nothing else. Fields (all optional): ' +
            '"say" (a short spoken line, under 90 chars), ' +
            '"goto" ({"x":int,"y":int} a map cell to walk to; the map is ' + MAP_W + 'x' + MAP_H +
            ', the hearth is at ' + game.hearth.x + ',' + game.hearth.y + '), ' +
            '"action" (one of "work","eat","rest","socialize","idle"), ' +
            '"goal" (a short private intention), ' +
            '"remember" (a short note to keep). No prose, no markdown, JSON only.';
        const lines = [
            'Day ' + game.day() + ', ' + game.phaseName() + '.',
            'You are at ' + c.x + ',' + c.y + ', currently ' + v.activity + '. Goal: ' + v.goal + '.',
            'Needs (0 fine, 100 desperate): hunger ' + needsPct(v.needs.hunger) +
                ', tiredness ' + needsPct(v.needs.energy) + ', loneliness ' + needsPct(v.needs.social) +
                ', cold ' + needsPct(v.needs.warmth) + '.',
            'Village stores: food ' + game.res.food + ', wood ' + game.res.wood +
                ', stone ' + game.res.stone + ', meals ' + game.res.meals + '. Hearth fire ' +
                Math.round(game.fire * 100) + '%.',
            'Your home is at ' + v.home.x + ',' + v.home.y + '. Your work: ' + roleWorkText(v) + '.',
            nearby.length ? 'Nearby: ' + nearby.join('; ') + '.' : 'Nobody is nearby.',
            recent.length ? 'Recent village events: ' + recent.join(' | ') : '',
            mems.length ? 'Your memories: ' + mems.join(' | ') : '',
        ];
        if (v.heard)
            lines.push(v.heard.from + ' just said to you: ΓÇ£' + v.heard.text + 'ΓÇ¥');
        lines.push('What do you do? One JSON object only. /no_think');
        const user = lines.filter(Boolean).join('\n');
        return { system, user, text: system + '\n\n' + user };
    };

    function roleWorkText(v) {
        switch (v.role) {
            case 'farmer': return 'tending and harvesting the grain field around 18,25';
            case 'forester': return 'felling trees in the western forest around 10,11';
            case 'mason': return 'cutting stone at the quarry at ' + game.quarry.x + ',' + game.quarry.y;
            case 'cook': return 'cooking meals at the hearth kitchen at ' + game.kitchen.x + ',' + game.kitchen.y;
            case 'elder': return 'keeping the hearth fire alive from the bench at ' + game.bench.x + ',' + game.bench.y;
        }
    }

    // Extract the single JSON object from raw model output: drop any
    // <think>...</think> block, then take first '{' .. last '}'. JSON.parse
    // runs on that slice only ΓÇö anything else is a discard, never repaired.
    function extractJson(raw) {
        if (typeof raw !== 'string') return null;
        const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
        const a = cleaned.indexOf('{');
        const b = cleaned.lastIndexOf('}');
        if (a < 0 || b <= a) return null;
        return cleaned.slice(a, b + 1);
    }

    const ACTIONS = ['work', 'eat', 'rest', 'socialize', 'idle'];

    function validateThink(o) {
        if (o === null || typeof o !== 'object' || Array.isArray(o)) return false;
        if ('say' in o && o.say !== undefined &&
            (typeof o.say !== 'string' || !o.say.trim() || o.say.length > 200)) return false;
        if ('goto' in o && o.goto !== undefined) {
            const g = o.goto;
            if (g === null || typeof g !== 'object' || Array.isArray(g)) return false;
            if (!Number.isInteger(g.x) || !Number.isInteger(g.y)) return false;
            if (!inB(g.x, g.y)) return false;
            if (!world.isWalkable(g.x, g.y, FLAG.WATER)) return false;
        }
        if ('action' in o && o.action !== undefined &&
            (typeof o.action !== 'string' || !ACTIONS.includes(o.action))) return false;
        if ('goal' in o && o.goal !== undefined &&
            (typeof o.goal !== 'string' || o.goal.length > 200)) return false;
        if ('remember' in o && o.remember !== undefined &&
            (typeof o.remember !== 'string' || o.remember.length > 200)) return false;
        return true;
    }

    game.applyThink = function (v, raw) {
        const slice = extractJson(raw);
        let parsed = null;
        if (slice !== null) {
            try { parsed = JSON.parse(slice); } catch (e) { parsed = null; }
        }
        if (parsed === null || !validateThink(parsed)) {
            game.mind.discarded++;
            v.lastThink = { raw, parsed: null, discarded: true, t: game.time };
            v.lastThinkT = game.time;   // rotate the queue even on a discard
            v.heard = null;
            return false;
        }
        game.mind.accepted++;
        v.lastThink = { raw, parsed, discarded: false, t: game.time };
        v.lastThinkT = game.time;
        v.heard = null;

        if (typeof parsed.goal === 'string' && parsed.goal.trim())
            v.goal = parsed.goal.trim();
        if (typeof parsed.remember === 'string' && parsed.remember.trim()) {
            v.memories.push(parsed.remember.trim());
            while (v.memories.length > MEMORY_CAP) v.memories.shift();
        }
        if (typeof parsed.say === 'string' && parsed.say.trim())
            game.speak(v, parsed.say.trim());

        const action = parsed.action || (parsed.goto ? 'idle' : null);
        if (action || parsed.goto) {
            const target = parsed.goto
                ? { x: parsed.goto.x, y: parsed.goto.y }
                : spotFor(v, action);
            v.override = { until: game.time + OVERRIDE_DUR, action: action || 'idle', target };
            v.target = null;         // force re-path toward the new target
            v.plannedAct = null;
            addEvent(v.name + ' resolves: ' + (v.goal || action || 'a new intention'), 'think');
        } else {
            addEvent(v.name + ' reflects quietly', 'think');
        }
        return true;
    };

    // Who thinks next: villagers who just heard a line take priority (real
    // back-and-forth conversation), else the one who has waited longest.
    game.pickNextThinker = function () {
        let best = null, bestKey = Infinity;
        for (const v of game.villagers) {
            const heardBoost = (v.heard && v.heard.t >= v.lastThinkT) ? -1e6 : 0;
            const key = heardBoost + v.lastThinkT;
            if (key < bestKey) { bestKey = key; best = v; }
        }
        return best;
    };

    // The generator in force: a test-injected fake takes precedence over the
    // app-installed model-backed one.
    game.activeGenerate = function () {
        if (typeof globalThis.__hearthmindGenerate === 'function')
            return globalThis.__hearthmindGenerate;
        return game.mind.generate;
    };

    // One think, serially: build the digest, run the generator, apply. Only
    // ever ONE generate in flight.
    game.requestThink = function (v) {
        const gen = game.activeGenerate();
        if (!gen || game.mind.inFlight) return Promise.resolve(false);
        game.mind.inFlight = true;
        const parts = game.buildThink(v);
        game.mind.lastPrompt = parts.text;
        let p;
        try {
            p = Promise.resolve(gen(parts.text, parts));
        } catch (e) {
            game.mind.inFlight = false;
            game.mind.discarded++;
            return Promise.resolve(false);
        }
        return p.then(
            (raw) => { game.mind.inFlight = false; return game.applyThink(v, raw); },
            (err) => {
                game.mind.inFlight = false;
                game.mind.discarded++;
                v.lastThink = { raw: String(err), parsed: null, discarded: true, t: game.time };
                return false;
            });
    };

    function stepMind(dt) {
        if (!game.activeGenerate() || game.mind.inFlight) return;
        game.mind.thinkT += dt;
        if (game.mind.thinkT < THINK_INTERVAL) return;
        game.mind.thinkT = 0;
        const v = game.pickNextThinker();
        if (v) game.requestThink(v);
    }

    // ---- main update ----------------------------------------------------------------

    let lastDay = 1;

    game.update = function (rdt) {
        const dt = rdt * game.speed;
        if (dt <= 0) return;
        game.time += dt;

        if (game.day() !== lastDay) {
            lastDay = game.day();
            addEvent('Day ' + lastDay + ' dawns over Hearthfolk', 'day');
        }

        // Fire burns down slowly.
        game.fire = Math.max(0, game.fire - dt / 300);

        // Trees regrow.
        for (const t of game.trees) {
            if (t.alive) continue;
            t.regrowT -= dt;
            if (t.regrowT <= 0) { t.alive = true; game.dirty.trees = true; }
        }

        for (const v of game.villagers) {
            updateVillager(v, dt);
            if (v.say && game.time >= v.say.until) v.say = null;
            if (v.heard && game.time - v.heard.t > 60) v.heard = null;
        }

        stepMind(dt);
    };

    // ---- save / load ----------------------------------------------------------------

    const SAVE_KEY = 'hearthfolk-save';
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

    game.saveVillage = function () {
        const data = {
            version: 1,
            seed: game.seed, time: game.time, speed: game.speed,
            res: { ...game.res }, fire: game.fire,
            stats: { ...stats },
            mind: { accepted: game.mind.accepted, discarded: game.mind.discarded },
            villagers: game.villagers.map(v => ({
                name: v.name, pos: { ...v.pos }, needs: { ...v.needs },
                goal: v.goal, memories: [...v.memories], counts: { ...v.counts },
                activity: v.activity,
            })),
            trees: game.trees.map(t => ({ ...t })),
            crops: game.crops.map(c => ({ ...c })),
            chronicle: game.chronicle.slice(-120),
            grid: bytesToB64(world.save()),
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
        return true;
    };

    game.loadVillage = function () {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return false;
        let data;
        try { data = JSON.parse(raw); } catch (e) { return false; }
        if (!data || data.version !== 1) return false;
        if (!world.load(b64ToBytes(data.grid))) return false;
        // world.load() preserved every registered kind (ids stay valid); only
        // the instance placements were cleared ΓÇö the per-frame sync and the
        // dirty flags below re-place everything. NO re-registration happens.
        game.seed = data.seed; game.time = data.time; game.speed = data.speed;
        game.res = { ...data.res }; game.fire = data.fire;
        Object.assign(stats, data.stats);
        game.mind.accepted = data.mind.accepted;
        game.mind.discarded = data.mind.discarded;
        for (const sv of data.villagers) {
            const v = game.villagerByName(sv.name);
            if (!v) continue;
            v.pos = { ...sv.pos };
            v.needs = { ...sv.needs };
            v.goal = sv.goal;
            v.memories = [...sv.memories];
            v.counts = { ...sv.counts };
            v.activity = 'idle';
            v.path = null; v.target = null; v.plannedAct = null;
            v.commit = null; v.override = null; v.say = null; v.heard = null;
        }
        game.trees = data.trees.map(t => ({ ...t }));
        game.crops = data.crops.map(c => ({ ...c }));
        game.chronicle = data.chronicle.map(e => ({ ...e }));
        lastDay = game.day();
        game.dirty.trees = true;
        game.dirty.static = true;
        game.dirty.piles = true;
        return true;
    };

    game.hasSave = () => localStorage.getItem(SAVE_KEY) !== null;

    // ---- boot ----------------------------------------------------------------------

    genTerrain();
    makeVillagers();
    world.rebuildAll();
    addEvent('Day 1 dawns over Hearthfolk', 'day');

    return game;
}
