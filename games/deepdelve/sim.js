// sim.js — DeepDelve domain: map gen, combat, FOV, save/load (createGame).
// No shell / HUD / scene wiring — that lives in game.js.

export const MAP_W = 40, MAP_H = 30, FLOORS = 3;
export const CELL = 1.0;      // cellSize
export const HSTEP = 0.35;    // heightStep
export const FOV_R = 8;       // sight radius

export const TILE = {
    WALL: 1, FLOOR: 2, MOSS: 3, CRACK: 4, WATER: 5,
    DOOR: 6, DOOR_OPEN: 7, STAIRS_DOWN: 8, STAIRS_UP: 9, TRAPR: 10,
};

// One flag bit per concern. ENGINE NOTE: isWalkable(x,y,mask) treats a
// multi-bit mask as ALL-bits (engine bug, fix scheduled), so movement checks
// below test one bit at a time; findPath/distanceField blockMask is ANY-bit
// as documented and safe with a combined mask.
export const FLAG = { WALL: 1, DOOR: 2, WATER: 4, TRAP: 8, OPEN: 16 };
export const BLOCK_MOVE = FLAG.WALL | FLAG.DOOR | FLAG.WATER; // pathfind blockers

// --- Monsters / items --------------------------------------------------------

export const MONSTERS = {
    rat:    { name: 'giant rat',       hp: 5,  atk: 2, def: 0, ai: 'chaser' },
    wolf:   { name: 'dire wolf',       hp: 7,  atk: 3, def: 0, ai: 'pack' },
    archer: { name: 'skeleton archer', hp: 6,  atk: 3, def: 0, ai: 'ranged', range: 6, minRange: 3 },
    ogre:   { name: 'ogre',            hp: 18, atk: 6, def: 1, ai: 'chaser', slow: true },
    boss:   { name: 'OGRE KING',       hp: 42, atk: 8, def: 2, ai: 'chaser', boss: true },
};

const FLOOR_MONSTERS = {
    1: [['rat', 4], ['wolf', 3], ['archer', 1]],
    2: [['rat', 3], ['wolf', 3], ['archer', 2], ['ogre', 1]],
    3: [['rat', 2], ['wolf', 3], ['archer', 3], ['ogre', 2], ['boss', 1]],
};

const FLOOR_GEAR = {
    1: { kind: 'weapon', name: 'Iron Sword',      bonus: 2 },
    2: { kind: 'armor',  name: 'Chain Mail',      bonus: 2 },
    3: { kind: 'weapon', name: 'Dwarven War Axe', bonus: 4 },
};

export const PLAYER_BASE = { hp: 26, atk: 3, def: 0 };
export const POTION_HEAL = 10;
export const TRAP_DMG = 4;

// --- Seeded RNG ----------------------------------------------------------------

export function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// --- blob47 variant table --------------------------------------------------------
// Mirrors bro/src/tile/autotile.cpp: 8-neighbour mask bits E=1,NE=2,N=4,NW=8,
// W=16,SW=32,S=64,SE=128; a corner bit only counts when both adjacent edge
// bits are set; variant index = rank of the normalized mask in increasing
// order. blobVariantMasks()[i] is the canonical neighbour mask of variant i,
// which is exactly what the atlas painter needs to draw each variant's art.

const B = { E: 1, NE: 2, N: 4, NW: 8, W: 16, SW: 32, S: 64, SE: 128 };

function normBlob(m) {
    let out = m & 0x55;
    if ((m & B.NE) && (m & B.E) && (m & B.N)) out |= B.NE;
    if ((m & B.NW) && (m & B.N) && (m & B.W)) out |= B.NW;
    if ((m & B.SW) && (m & B.W) && (m & B.S)) out |= B.SW;
    if ((m & B.SE) && (m & B.S) && (m & B.E)) out |= B.SE;
    return out;
}

export function blobVariantMasks() {
    const out = [];
    for (let m = 0; m < 256; m++) if (normBlob(m) === m) out.push(m);
    return out;   // length 47
}

// --- Procedural tileset atlas ------------------------------------------------------
// 16x4 grid of 16px cells (256x64 RGBA). Cells 1..47 are the blob47 wall-top
// variants (mortar seams trace the wall silhouette); the rest are floors,
// animated water, doors, stairs, the revealed trap and the cliff face.
// Atlas orientation: cell-pixel top edge renders on the grid-north (y-1) side.

const APX = 16, ACOLS = 16, AROWS = 4;
export const ACELL = {
    FLOOR: 48, MOSS: 49, CRACK: 50, WATER0: 51, WATER1: 52, WATER2: 53,
    DOOR: 54, DOOR_OPEN: 55, STAIRS_DOWN: 56, STAIRS_UP: 57, TRAPR: 58, CLIFF: 59,
};
export const TILE_ATLAS = [
    0, 1,                                   // 0 empty, 1 wall (autotile overrides)
    ACELL.FLOOR, ACELL.MOSS, ACELL.CRACK, ACELL.WATER0,
    ACELL.DOOR, ACELL.DOOR_OPEN, ACELL.STAIRS_DOWN, ACELL.STAIRS_UP, ACELL.TRAPR,
];

export function makeAtlas() {
    const w = ACOLS * APX, h = AROWS * APX;
    const buf = new Uint8Array(w * h * 4);
    const rng = mulberry32(0xD0E5A11);
    const clamp = (v) => Math.max(0, Math.min(255, v | 0));
    function paint(cell, fn) {
        const cx = (cell % ACOLS) * APX, cy = Math.floor(cell / ACOLS) * APX;
        for (let py = 0; py < APX; py++) {
            for (let px = 0; px < APX; px++) {
                const [r, g, b] = fn(px, py);
                const i = ((cy + py) * w + cx + px) * 4;
                buf[i] = clamp(r); buf[i + 1] = clamp(g); buf[i + 2] = clamp(b);
                buf[i + 3] = 255;
            }
        }
    }
    const noise = (amt) => (rng() - 0.5) * 2 * amt;

    // Wall-top blob variants at cells 1..47.
    blobVariantMasks().forEach((m, i) => {
        paint(1 + i, (x, y) => {
            const n = noise(8);
            const blk = (((x >> 2) * 7 + (y >> 2) * 13) % 5) * 3 - 6;
            let r = 86 + n + blk, g = 88 + n + blk, b = 103 + n + blk;
            const oE = !(m & B.E), oN = !(m & B.N), oW = !(m & B.W), oS = !(m & B.S);
            let mul = 1;
            if ((oE && x >= 14) || (oW && x <= 1) || (oN && y <= 1) || (oS && y >= 14)) mul = 0.40;
            else if ((oE && x === 13) || (oW && x === 2) || (oN && y === 2)) mul = 1.24;
            else if (oS && y === 13) mul = 0.78;
            // inner-corner pips: both edges joined but the diagonal is not
            if (!oE && !oN && !(m & B.NE) && x >= 13 && y <= 2) mul = 0.40;
            if (!oN && !oW && !(m & B.NW) && x <= 2 && y <= 2) mul = 0.40;
            if (!oW && !oS && !(m & B.SW) && x <= 2 && y >= 13) mul = 0.40;
            if (!oS && !oE && !(m & B.SE) && x >= 13 && y >= 13) mul = 0.40;
            return [r * mul, g * mul, b * mul];
        });
    });

    // Floor flagstones (48), mossy (49), cracked (50).
    const flag = (x, y, r0, g0, b0) => {
        const n = noise(6);
        const seam = (x % 8 === 7 || y % 8 === 7) ? 0.72 : 1;
        const spark = rng() < 0.02 ? 18 : 0;
        return [(r0 + n + spark) * seam, (g0 + n + spark) * seam, (b0 + n + spark) * seam];
    };
    paint(ACELL.FLOOR, (x, y) => flag(x, y, 60, 58, 68));
    paint(ACELL.MOSS, (x, y) => {
        const c = flag(x, y, 56, 60, 62);
        const blob = Math.hypot(x - 5, y - 9) < 4 || Math.hypot(x - 12, y - 4) < 3;
        return blob ? [c[0] * 0.7, c[1] * 1.35, c[2] * 0.7] : c;
    });
    paint(ACELL.CRACK, (x, y) => {
        const c = flag(x, y, 60, 58, 68);
        const on = Math.abs((y - 2) - (x * 0.8)) < 0.9 || (x > 9 && Math.abs(y - x + 4) < 0.9);
        return on ? [c[0] * 0.45, c[1] * 0.45, c[2] * 0.45] : c;
    });

    // Water, 3 animated frames (51..53).
    for (let f = 0; f < 3; f++) {
        paint(ACELL.WATER0 + f, (x, y) => {
            const wv = Math.sin((x + f * 5) * 0.55 + y * 0.8) + Math.sin(y * 0.5 - f * 1.9);
            const n = noise(4);
            if (wv > 1.3) return [64 + n, 116 + n, 148 + n];
            return [16 + n + wv * 3, 40 + n + wv * 4, 58 + n + wv * 5];
        });
    }

    // Door, closed (54): wood planks + frame + iron bands.
    paint(ACELL.DOOR, (x, y) => {
        if (x === 0 || y === 0 || x === 15 || y === 15) return [34, 26, 20];
        const n = noise(7);
        if (y === 5 || y === 10) return [72 + n, 72 + n, 80 + n];       // iron bands
        const plank = (x % 4 === 3) ? 0.6 : 1;
        return [(104 + n) * plank, (70 + n) * plank, (38 + n) * plank];
    });
    // Door, open (55): floor with wooden jambs.
    paint(ACELL.DOOR_OPEN, (x, y) => {
        if (x <= 1 || x >= 14) return [88 + noise(6), 60 + noise(5), 34];
        return flag(x, y, 52, 50, 60);
    });

    // Stairs down (56): bands darkening; stairs up (57): bands lightening.
    paint(ACELL.STAIRS_DOWN, (x, y) => {
        const band = y >> 2;
        const m = 1 - band * 0.21;
        const seam = (y % 4 === 0) ? 0.6 : 1;
        const n = noise(5);
        return [(78 + n) * m * seam, (76 + n) * m * seam, (88 + n) * m * seam];
    });
    paint(ACELL.STAIRS_UP, (x, y) => {
        const band = y >> 2;
        const m = 0.55 + band * 0.17;
        const seam = (y % 4 === 0) ? 0.6 : 1;
        const n = noise(5);
        return [(92 + n) * m * seam, (88 + n) * m * seam, (86 + n) * m * seam];
    });

    // Revealed trap (58): floor + crimson rune diamond.
    paint(ACELL.TRAPR, (x, y) => {
        const c = flag(x, y, 56, 52, 60);
        const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
        if (d > 4.4 && d < 6.4) return [168 + noise(10), 34, 44];
        if (d <= 1.6) return [150, 40, 48];
        return c;
    });

    // Cliff strata (59) ΓÇö stretched vertically on tall drops, reads as rock beds.
    paint(ACELL.CLIFF, (x, y) => {
        const n = noise(6);
        const strata = (y % 5 === 0) ? 0.68 : 1;
        const depth = 1 - y * 0.016;
        return [(74 + n) * strata * depth, (70 + n) * strata * depth, (82 + n) * strata * depth];
    });

    return { pixels: buf, width: w, height: h };
}

// --- Game factory ------------------------------------------------------------------

export function createGame(scene, seed) {
    const atlas = makeAtlas();
    const world = scene.createTileWorld({
        width: MAP_W, height: MAP_H,
        cellSize: CELL, heightStep: HSTEP, chunkSize: 10,
        baseLevel: -6, aoStrength: 0.55,
        atlasPixels: atlas.pixels, atlasWidth: atlas.width, atlasHeight: atlas.height,
        atlasColumns: ACOLS, atlasRows: AROWS,
        tileAtlas: TILE_ATLAS,
        cliffCell: ACELL.CLIFF,
        atlasInset: 0.5,
        autotiles: [{
            id: TILE.WALL, mode: 'blob47', family: 'id',
            cells: blobVariantMasks().map((_, i) => 1 + i),
        }],
        animations: [{ id: TILE.WATER, fps: 2, frames: [ACELL.WATER0, ACELL.WATER1, ACELL.WATER2] }],
    });

    // ---- object kinds ---------------------------------------------------------
    //
    // ENGINE NOTE / workaround: world.load() drops every registered object kind
    // and all placed instances (TileWorld::loadGrid() clears objectKinds_), even
    // though load() docs say rendering config is preserved. registerKinds() is
    // called once here and again after every world.load(); the per-frame render
    // sync then re-places all instances.

    const kinds = {};
    function registerKinds() {
        const M = Mesh;
        kinds.player = world.addObjectKind(
            M.merge([
                M.cylinder(0.15, 0.04, 10).translate(0, 0.04, 0),
                M.capsule(0.115, 0.13, 10, 6).translate(0, 0.30, 0),
                M.sphere(0.085, 10, 8).translate(0, 0.52, 0),
                M.box(0.03, 0.30, 0.03).rotate(0, 0, 1, 0.5).translate(0.17, 0.36, 0.03),
            ]), { color: [1, 1, 1, 1], roughness: 0.7 });
        kinds.rat = world.addObjectKind(
            M.merge([
                M.capsule(0.085, 0.09, 8, 6).rotate(1, 0, 0, Math.PI / 2).translate(0, 0.09, 0),
                M.sphere(0.06, 8, 6).translate(0, 0.12, 0.11),
                M.cone(0.02, 0.14, 5, 1, true).rotate(1, 0, 0, -Math.PI / 2).translate(0, 0.08, -0.16),
            ]), { color: [1, 1, 1, 1], roughness: 0.9 });
        kinds.wolf = world.addObjectKind(
            M.merge([
                M.box(0.14, 0.12, 0.34).translate(0, 0.16, 0),
                M.sphere(0.075, 8, 6).translate(0, 0.24, 0.20),
                M.cone(0.035, 0.05, 4, 1, true).translate(-0.04, 0.31, 0.22),
                M.cone(0.035, 0.05, 4, 1, true).translate(0.04, 0.31, 0.22),
            ]), { color: [1, 1, 1, 1], roughness: 0.9 });
        kinds.archer = world.addObjectKind(
            M.merge([
                M.capsule(0.09, 0.15, 8, 6).translate(0, 0.28, 0),
                M.sphere(0.075, 8, 6).translate(0, 0.50, 0),
                M.torus(0.11, 0.014, 10, 6).rotate(0, 1, 0, Math.PI / 2).translate(0.14, 0.32, 0),
            ]), { color: [1, 1, 1, 1], roughness: 0.85 });
        kinds.ogre = world.addObjectKind(
            M.merge([
                M.box(0.26, 0.26, 0.20).translate(0, 0.26, 0),
                M.sphere(0.11, 10, 8).translate(0, 0.48, 0.02),
                M.box(0.08, 0.24, 0.08).translate(-0.20, 0.22, 0),
                M.box(0.08, 0.24, 0.08).translate(0.20, 0.22, 0),
            ]), { color: [1, 1, 1, 1], roughness: 0.95 });
        kinds.potion = world.addObjectKind(
            M.merge([
                M.sphere(0.075, 8, 6).translate(0, 0.08, 0),
                M.cylinder(0.03, 0.07, 6).translate(0, 0.16, 0),
            ]), { color: [0.85, 0.16, 0.26, 1], roughness: 0.3 });
        kinds.gold = world.addObjectKind(
            M.merge([
                M.sphere(0.07, 8, 6).translate(0, 0.05, 0),
                M.sphere(0.055, 8, 6).translate(0.09, 0.045, 0.05),
                M.sphere(0.05, 8, 6).translate(-0.06, 0.04, 0.08),
            ]), { color: [1.0, 0.82, 0.28, 1], roughness: 0.35, metallic: 0.7 });
        kinds.weapon = world.addObjectKind(
            M.merge([
                M.box(0.035, 0.36, 0.035).translate(0, 0.24, 0),
                M.box(0.15, 0.03, 0.05).translate(0, 0.12, 0),
                M.sphere(0.03, 6, 5).translate(0, 0.045, 0),
            ]).rotate(0, 0, 1, 0.35), { color: [0.80, 0.85, 0.95, 1], roughness: 0.25, metallic: 0.8 });
        kinds.armor = world.addObjectKind(
            M.merge([
                M.box(0.20, 0.20, 0.13).translate(0, 0.14, 0),
                M.sphere(0.055, 8, 6).translate(-0.12, 0.24, 0),
                M.sphere(0.055, 8, 6).translate(0.12, 0.24, 0),
            ]), { color: [0.55, 0.62, 0.75, 1], roughness: 0.35, metallic: 0.75 });
        kinds.amulet = world.addObjectKind(
            M.merge([
                M.cylinder(0.10, 0.06, 8).translate(0, 0.06, 0),
                M.cylinder(0.045, 0.42, 8).translate(0, 0.28, 0),
                M.cylinder(0.09, 0.03, 8).translate(0, 0.50, 0),
                M.torus(0.09, 0.028, 14, 8).translate(0, 0.66, 0),
            ]), { color: [1.0, 0.80, 0.25, 1], roughness: 0.25, metallic: 0.8 });
        kinds.door = world.addObjectKind(
            M.box(0.46, 0.40, 0.05).translate(0, 0.40, 0),   // box() takes half-extents
            { color: [0.42, 0.28, 0.15, 1], roughness: 0.9 });
        kinds.spikes = world.addObjectKind(
            M.merge([
                M.cone(0.035, 0.16, 5, 1, true).translate(-0.10, 0.08, -0.08),
                M.cone(0.035, 0.18, 5, 1, true).translate(0.08, 0.09, 0.06),
                M.cone(0.035, 0.14, 5, 1, true).translate(-0.02, 0.07, 0.12),
                M.cone(0.035, 0.15, 5, 1, true).translate(0.10, 0.075, -0.10),
            ]), { color: [0.72, 0.72, 0.78, 1], roughness: 0.3, metallic: 0.6 });
        kinds.rubble = world.addObjectKind(
            M.rock(0.13, 8, 2).translate(0, 0.07, 0),
            { color: [0.45, 0.45, 0.52, 1], roughness: 1.0 });
        kinds.bone = world.addObjectKind(
            M.merge([
                M.cylinder(0.02, 0.22, 5).rotate(0, 0, 1, Math.PI / 2).translate(0, 0.03, 0),
                M.sphere(0.03, 6, 5).translate(-0.11, 0.03, 0),
                M.sphere(0.03, 6, 5).translate(0.11, 0.03, 0),
            ]), { color: [0.85, 0.83, 0.74, 1], roughness: 0.85 });
        kinds.mushroom = world.addObjectKind(
            M.merge([
                M.cylinder(0.022, 0.09, 6).translate(0, 0.045, 0),
                M.sphere(0.055, 8, 6).translate(0, 0.11, 0),
            ]), { color: [0.35, 0.95, 0.88, 1], roughness: 0.4 });
    }
    registerKinds();

    // ---- state ---------------------------------------------------------------

    const game = {
        world, kinds,
        seed: (seed >>> 0) || 1,
        floor: 1,
        turn: 0,
        over: false, won: false,
        kills: 0, goldTotal: 0, doorsOpened: 0,
        player: null,          // { x, y, hp, maxHp, atk, def, weapon, armor, potions, gold }
        monsters: [],          // { id, type, x, y, hp, awake }
        items: [],             // { kind, x, y, amount?, name?, bonus? }
        doors: [],             // { x, y, open, orient }  orient 0 = slab spans X
        decor: [],             // { kind, x, y, yaw, scale }
        rooms: [],
        spawn: null, stairsDown: null,
        fog: new Uint8Array(MAP_W * MAP_H),   // 0 unseen, 1 remembered, 2 visible
        visible: new Set(),
        fogDirty: true,
        msgs: [],
        lastShot: null,        // { from, to, turn } ΓÇö ranged attack, for tests + fx
        rng: mulberry32(1),
        // callbacks the shell wires up
        onLog: null, onShot: null, onHurt: null, onGameOver: null,
        onDescend: null, onFullRedraw: null,
    };

    let nextId = 1;

    const inB = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
    const idx = (x, y) => y * MAP_W + x;

    game.log = function (text, cls) {
        game.msgs.push({ text, cls: cls || '', turn: game.turn });
        if (game.msgs.length > 80) game.msgs.splice(0, game.msgs.length - 80);
        if (game.onLog) game.onLog(text, cls);
    };

    // ---- cell predicates -------------------------------------------------------
    // Single-bit hasFlag tests only (see ENGINE NOTE at FLAG).

    game.blocksLOS = (x, y) =>
        !inB(x, y) || world.hasFlag(x, y, FLAG.WALL) || world.hasFlag(x, y, FLAG.DOOR);

    game.canEnter = function (x, y) {
        if (!inB(x, y)) return false;
        if (world.getTile(x, y, 0) === 0) return false;             // chasm
        if (world.hasFlag(x, y, FLAG.WALL)) return false;
        if (world.hasFlag(x, y, FLAG.DOOR)) return false;           // closed door: bump opens
        if (world.hasFlag(x, y, FLAG.WATER)) return false;
        return true;
    };

    game.monsterAt = (x, y) => game.monsters.find(m => m.hp > 0 && m.x === x && m.y === y) || null;

    const freeForMonster = (x, y) =>
        game.canEnter(x, y) && !game.monsterAt(x, y) &&
        !(game.player.x === x && game.player.y === y);

    game.losClear = function (x0, y0, x1, y1) {
        const line = world.cellLine(x0, y0, x1, y1);
        for (let i = 1; i < line.length - 1; i++)
            if (game.blocksLOS(line[i].x, line[i].y)) return false;
        return true;
    };

    game.walkableComponents = () => world.components({ flag: FLAG.OPEN }).length;

    // ---- fog of war -------------------------------------------------------------

    game.computeFOV = function () {
        const p = game.player;
        const newVis = new Set();
        newVis.add(idx(p.x, p.y));
        for (const c of world.cellsInRange(p.x, p.y, FOV_R, 'vertex')) {
            const dx = c.x - p.x, dy = c.y - p.y;
            if (dx * dx + dy * dy > FOV_R * FOV_R + 4) continue;    // round the box off
            const line = world.cellLine(p.x, p.y, c.x, c.y);
            for (let i = 1; i < line.length; i++) {
                const L = line[i];
                newVis.add(idx(L.x, L.y));
                if (game.blocksLOS(L.x, L.y)) break;                // blocker itself is lit
            }
        }
        for (const k of game.visible) if (!newVis.has(k)) game.fog[k] = 1;
        for (const k of newVis) game.fog[k] = 2;
        game.visible = newVis;
        game.fogDirty = true;
    };

    // ---- floor generation ---------------------------------------------------------

    function clearCellFlags(x, y) { world.setFlag(x, y, 0xFF, false); }

    function genFloor(floorNum) {
        const rng = mulberry32((game.seed ^ Math.imul(floorNum, 0x9E3779B9)) >>> 0);
        game.rng = rng;

        for (let y = 0; y < MAP_H; y++) {
            for (let x = 0; x < MAP_W; x++) {
                world.setTile(x, y, TILE.WALL, 0);
                world.setElevation(x, y, 0);
                clearCellFlags(x, y);
                world.setFlag(x, y, FLAG.WALL, true);
            }
        }

        // Rooms by rejection sampling (1-cell gaps between rooms).
        const rooms = [];
        for (let i = 0; i < 300 && rooms.length < 13; i++) {
            const w = 4 + (rng() * 6 | 0), h = 3 + (rng() * 5 | 0);
            const x = 1 + (rng() * (MAP_W - w - 2) | 0);
            const y = 1 + (rng() * (MAP_H - h - 2) | 0);
            let ok = true;
            for (const r of rooms)
                if (x < r.x + r.w + 1 && r.x < x + w + 1 && y < r.y + r.h + 1 && r.y < y + h + 1) { ok = false; break; }
            if (ok) rooms.push({
                x, y, w, h,
                elev: [0, 0, 0, 1, 1, 2][(rng() * 6) | 0],
                cx: x + (w >> 1), cy: y + (h >> 1),
            });
        }
        game.rooms = rooms;

        const carveOpen = (x, y, id, elev) => {
            world.setTile(x, y, id, 0);
            world.setElevation(x, y, elev);
            world.setFlag(x, y, FLAG.WALL, false);
            world.setFlag(x, y, FLAG.OPEN, true);
        };

        for (const r of rooms) {
            for (let y = r.y; y < r.y + r.h; y++) {
                for (let x = r.x; x < r.x + r.w; x++) {
                    const roll = rng();
                    const id = roll < 0.09 ? TILE.MOSS : roll < 0.15 ? TILE.CRACK : TILE.FLOOR;
                    carveOpen(x, y, id, r.elev);
                }
            }
        }

        // Corridors: connect each unconnected room to the nearest connected one
        // (L-shaped, 1 wide) with elevation lerped end to end ΓÇö natural ramps.
        function carveCorridor(A, Bm) {
            const cells = [];
            let x = A.cx, y = A.cy;
            const horizFirst = rng() < 0.5;
            const goH = () => { while (x !== Bm.cx) { x += Math.sign(Bm.cx - x); cells.push({ x, y }); } };
            const goV = () => { while (y !== Bm.cy) { y += Math.sign(Bm.cy - y); cells.push({ x, y }); } };
            if (horizFirst) { goH(); goV(); } else { goV(); goH(); }
            const n = cells.length;
            cells.forEach((c, i) => {
                if (!world.hasFlag(c.x, c.y, FLAG.WALL)) return;      // already open: keep
                const t = n <= 1 ? 1 : i / (n - 1);
                carveOpen(c.x, c.y, TILE.FLOOR, Math.round(A.elev + (Bm.elev - A.elev) * t));
            });
        }
        const connected = new Set([0]);
        while (connected.size < rooms.length) {
            let best = null;
            for (const i of connected) {
                for (let j = 0; j < rooms.length; j++) {
                    if (connected.has(j)) continue;
                    const d = Math.abs(rooms[i].cx - rooms[j].cx) + Math.abs(rooms[i].cy - rooms[j].cy);
                    if (!best || d < best.d) best = { i, j, d };
                }
            }
            carveCorridor(rooms[best.i], rooms[best.j]);
            connected.add(best.j);
        }
        for (let k = 0; k < 2; k++) {          // a couple of loops for tactics
            const a = rng() * rooms.length | 0, b2 = rng() * rooms.length | 0;
            if (a !== b2) carveCorridor(rooms[a], rooms[b2]);
        }

        // Elevation relaxation: lower any open cell more than 1 above an open
        // neighbour until stable, so every walkable step is at most one level ΓÇö
        // rooms keep their height, fringes turn into ramps.
        let changed = true;
        while (changed) {
            changed = false;
            for (let y = 0; y < MAP_H; y++) {
                for (let x = 0; x < MAP_W; x++) {
                    if (world.hasFlag(x, y, FLAG.WALL)) continue;
                    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const nx = x + dx, ny = y + dy;
                        if (!inB(nx, ny) || world.hasFlag(nx, ny, FLAG.WALL)) continue;
                        const e = world.getElevation(x, y), ne = world.getElevation(nx, ny);
                        if (e > ne + 1) { world.setElevation(x, y, ne + 1); changed = true; }
                    }
                }
            }
        }

        // Hazards: water pools and (deeper floors) chasms, each applied
        // tentatively and reverted if it splits the walkable region ΓÇö
        // components() guarantees one connected dungeon.
        function tryHazard(cells, apply) {
            const prev = cells.map(c => ({
                x: c.x, y: c.y,
                tile: world.getTile(c.x, c.y, 0),
                elev: world.getElevation(c.x, c.y),
            }));
            apply();
            if (game.walkableComponents() === 1) return true;
            for (const p of prev) {
                world.setTile(p.x, p.y, p.tile, 0);
                world.setElevation(p.x, p.y, p.elev);
                world.setFlag(p.x, p.y, FLAG.WATER, false);
                world.setFlag(p.x, p.y, FLAG.OPEN, true);
                world.setFlag(p.x, p.y, FLAG.WALL, false);
            }
            return false;
        }
        function blobCells(r, rx, ry) {
            const cx = r.x + 1 + rx + (rng() * Math.max(1, r.w - 2 - 2 * rx) | 0);
            const cy = r.y + 1 + ry + (rng() * Math.max(1, r.h - 2 - 2 * ry) | 0);
            const out = [];
            for (let y = r.y + 1; y < r.y + r.h - 1; y++)
                for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
                    const t = world.getTile(x, y, 0);
                    if (((x - cx) / (rx + 0.6)) ** 2 + ((y - cy) / (ry + 0.6)) ** 2 <= 1 &&
                        (t === TILE.FLOOR || t === TILE.MOSS || t === TILE.CRACK))
                        out.push({ x, y });
                }
            return out;
        }
        const bigRooms = rooms.filter(r => r.w >= 5 && r.h >= 4);
        const shuffled = [...bigRooms].sort(() => rng() - 0.5);
        let pools = 0;
        for (const r of shuffled) {
            if (pools >= 2 + (floorNum > 1 ? 1 : 0)) break;
            const cells = blobCells(r, 1 + (rng() * 1.5 | 0), 1);
            if (!cells.length) continue;
            if (tryHazard(cells, () => {
                for (const c of cells) {
                    world.setTile(c.x, c.y, TILE.WATER, 0);
                    world.setElevation(c.x, c.y, world.getElevation(c.x, c.y) - 1);
                    world.setFlag(c.x, c.y, FLAG.WATER, true);
                    world.setFlag(c.x, c.y, FLAG.OPEN, false);
                }
            })) pools++;
        }
        if (floorNum >= 2) {
            for (const r of shuffled.filter(r => r.w >= 6 && r.h >= 5).slice(0, 2)) {
                const cells = blobCells(r, 1, 1);
                if (!cells.length) continue;
                if (tryHazard(cells, () => {
                    for (const c of cells) {
                        world.setTile(c.x, c.y, 0, 0);              // open pit to baseLevel
                        clearCellFlags(c.x, c.y);
                    }
                })) break;                                          // one chasm per floor
            }
        }

        // Doors: corridor cells at room mouths (walls on both perpendicular
        // sides, an open room cell adjacent).
        const roomCell = new Set();
        for (const r of rooms)
            for (let y = r.y; y < r.y + r.h; y++)
                for (let x = r.x; x < r.x + r.w; x++) roomCell.add(idx(x, y));
        game.doors = [];
        for (let y = 1; y < MAP_H - 1; y++) {
            for (let x = 1; x < MAP_W - 1; x++) {
                if (world.getTile(x, y, 0) !== TILE.FLOOR || roomCell.has(idx(x, y))) continue;
                const wall = (X, Y) => world.hasFlag(X, Y, FLAG.WALL);
                const openC = (X, Y) => !wall(X, Y) && world.getTile(X, Y, 0) !== 0;
                let orient = -1;
                if (wall(x - 1, y) && wall(x + 1, y) && openC(x, y - 1) && openC(x, y + 1)) orient = 0;
                if (wall(x, y - 1) && wall(x, y + 1) && openC(x - 1, y) && openC(x + 1, y)) orient = 1;
                if (orient < 0) continue;
                const nearRoom = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
                    roomCell.has(idx(x + dx, y + dy)) && !wall(x + dx, y + dy));
                if (!nearRoom || rng() > 0.65) continue;
                world.setTile(x, y, TILE.DOOR, 0);
                world.setFlag(x, y, FLAG.DOOR, true);
                game.doors.push({ x, y, open: false, orient });
            }
        }

        // Stairs: spawn in a random room, way down in the farthest room.
        const spawnRoom = rooms[rng() * rooms.length | 0];
        const freeCells = (r) => {
            const out = [];
            for (let y = r.y; y < r.y + r.h; y++)
                for (let x = r.x; x < r.x + r.w; x++) {
                    const t = world.getTile(x, y, 0);
                    if ((t === TILE.FLOOR || t === TILE.MOSS || t === TILE.CRACK) &&
                        !world.hasFlag(x, y, FLAG.TRAP)) out.push({ x, y });
                }
            return out;
        };
        const centerFree = (r) => {
            const cells = freeCells(r);
            cells.sort((a, b) =>
                (Math.abs(a.x - r.cx) + Math.abs(a.y - r.cy)) - (Math.abs(b.x - r.cx) + Math.abs(b.y - r.cy)));
            return cells[0] || null;
        };
        const spawn = centerFree(spawnRoom);
        world.setTile(spawn.x, spawn.y, TILE.STAIRS_UP, 0);
        game.spawn = spawn;

        const field = world.distanceField([spawn], { blockMask: FLAG.WALL | FLAG.WATER });
        let farRoom = null, farD = -1;
        for (const r of rooms) {
            if (r === spawnRoom) continue;
            const c = centerFree(r);
            if (!c) continue;
            const d = field[idx(c.x, c.y)];
            if (d > farD) { farD = d; farRoom = r; }
        }
        game.stairsDown = null;
        let amuletCell = null;
        if (floorNum < FLOORS) {
            const c = centerFree(farRoom);
            world.setTile(c.x, c.y, TILE.STAIRS_DOWN, 0);
            game.stairsDown = c;
        } else {
            amuletCell = centerFree(farRoom);
        }

        // Traps (hidden: flag set, tile unchanged).
        const trapTarget = 3 + floorNum * 2;
        let traps = 0;
        for (let i = 0; i < 400 && traps < trapTarget; i++) {
            const r = rooms[rng() * rooms.length | 0];
            if (r === spawnRoom) continue;
            const cs = freeCells(r);
            if (!cs.length) continue;
            const c = cs[rng() * cs.length | 0];
            if (world.hasFlag(c.x, c.y, FLAG.TRAP)) continue;
            let nearFeature = false;
            for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const t = world.getTile(c.x + dx, c.y + dy, 0);
                if (t === TILE.DOOR || t === TILE.STAIRS_DOWN || t === TILE.STAIRS_UP) nearFeature = true;
            }
            if (nearFeature) continue;
            world.setFlag(c.x, c.y, FLAG.TRAP, true);
            traps++;
        }

        // Items.
        game.items = [];
        const itemFree = (c) => c && !game.items.some(it => it.x === c.x && it.y === c.y) &&
            !world.hasFlag(c.x, c.y, FLAG.TRAP);
        const randFree = (avoidSpawn) => {
            for (let i = 0; i < 200; i++) {
                const r = rooms[rng() * rooms.length | 0];
                if (avoidSpawn && r === spawnRoom) continue;
                const cs = freeCells(r);
                if (!cs.length) continue;
                const c = cs[rng() * cs.length | 0];
                if (itemFree(c)) return c;
            }
            return null;
        };
        for (let i = 0; i < 3; i++) {
            const c = randFree(false);
            if (c) game.items.push({ kind: 'potion', x: c.x, y: c.y });
        }
        for (let i = 0; i < 3 + floorNum; i++) {
            const c = randFree(false);
            if (c) game.items.push({ kind: 'gold', x: c.x, y: c.y, amount: 8 + (rng() * 18 | 0) });
        }
        {
            const gear = FLOOR_GEAR[floorNum];
            const c = randFree(true);
            if (gear && c) game.items.push({ kind: gear.kind, x: c.x, y: c.y, name: gear.name, bonus: gear.bonus });
        }
        if (amuletCell) game.items.push({ kind: 'amulet', x: amuletCell.x, y: amuletCell.y });

        // Monsters.
        game.monsters = [];
        const spawnMonster = (type, x, y) => {
            const m = { id: nextId++, type, x, y, hp: MONSTERS[type].hp, awake: false };
            game.monsters.push(m);
            return m;
        };
        game.spawnMonster = spawnMonster;
        const monsterSpot = (minDist, nearCell) => {
            for (let i = 0; i < 300; i++) {
                const r = rooms[rng() * rooms.length | 0];
                if (r === spawnRoom) continue;
                const cs = freeCells(r);
                if (!cs.length) continue;
                const c = nearCell
                    ? cs.sort((a, b) => world.cellDistance(a.x, a.y, nearCell.x, nearCell.y) -
                        world.cellDistance(b.x, b.y, nearCell.x, nearCell.y))[0]
                    : cs[rng() * cs.length | 0];
                if (game.monsterAt(c.x, c.y)) continue;
                if (world.cellDistance(c.x, c.y, spawn.x, spawn.y) < minDist) continue;
                if (game.items.some(it => it.kind === 'amulet' && it.x === c.x && it.y === c.y)) continue;
                return c;
            }
            return null;
        };
        for (const [type, count] of FLOOR_MONSTERS[floorNum]) {
            if (type === 'wolf') {
                // one pack: same room, clustered
                const c0 = monsterSpot(8, null);
                if (!c0) continue;
                spawnMonster('wolf', c0.x, c0.y);
                let placed = 1;
                for (const cc of world.cellsInRange(c0.x, c0.y, 2, 'vertex')) {
                    if (placed >= count) break;
                    if (freeForMonsterGen(cc.x, cc.y)) { spawnMonster('wolf', cc.x, cc.y); placed++; }
                }
            } else if (type === 'boss') {
                const near = amuletCell || game.stairsDown;
                const c = monsterSpot(8, near);
                if (c) spawnMonster('boss', c.x, c.y);
            } else {
                for (let i = 0; i < count; i++) {
                    const c = monsterSpot(6, null);
                    if (c) spawnMonster(type, c.x, c.y);
                }
            }
        }
        function freeForMonsterGen(x, y) {
            if (!inB(x, y)) return false;
            const t = world.getTile(x, y, 0);
            if (t !== TILE.FLOOR && t !== TILE.MOSS && t !== TILE.CRACK) return false;
            if (world.hasFlag(x, y, FLAG.WATER) || world.hasFlag(x, y, FLAG.WALL)) return false;
            if (game.monsterAt(x, y)) return false;
            return true;
        }

        // Decor: rubble, bones, glowing mushrooms.
        game.decor = [];
        for (let i = 0; i < 26; i++) {
            const r = rooms[rng() * rooms.length | 0];
            const cs = freeCells(r);
            if (!cs.length) continue;
            const c = cs[rng() * cs.length | 0];
            if (c.x === spawn.x && c.y === spawn.y) continue;
            const roll = rng();
            game.decor.push({
                kind: roll < 0.45 ? 'rubble' : roll < 0.72 ? 'bone' : 'mushroom',
                x: c.x, y: c.y, yaw: rng() * 6.28, scale: 0.7 + rng() * 0.6,
                ox: (rng() - 0.5) * 0.55, oz: (rng() - 0.5) * 0.55,
            });
        }

        // Wall tops: local floor + 4 levels, so wall height tracks the terrain.
        for (let y = 0; y < MAP_H; y++) {
            for (let x = 0; x < MAP_W; x++) {
                if (!world.hasFlag(x, y, FLAG.WALL)) continue;
                let maxOpen = 0;
                for (let dy = -1; dy <= 1; dy++)
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx, ny = y + dy;
                        if (!inB(nx, ny) || world.hasFlag(nx, ny, FLAG.WALL)) continue;
                        if (world.getTile(nx, ny, 0) === 0) continue;
                        maxOpen = Math.max(maxOpen, world.getElevation(nx, ny));
                    }
                world.setElevation(x, y, maxOpen + 4);
            }
        }

        // Fresh fog.
        game.fog = new Uint8Array(MAP_W * MAP_H);
        game.visible = new Set();
        game.fogDirty = true;

        world.rebuildAll();
    }

    // ---- combat -------------------------------------------------------------------

    function damagePlayer(dmg, source) {
        const p = game.player;
        p.hp -= dmg;
        if (game.onHurt) game.onHurt(dmg);
        if (p.hp <= 0) {
            p.hp = 0;
            game.over = true; game.won = false;
            game.log('You are slain by ' + source + '...', 'bad');
            if (game.onGameOver) game.onGameOver(false);
        }
    }

    function attackPlayer(m, atk) {
        const def = MONSTERS[m.type];
        const dmg = Math.max(1, atk - game.player.def);
        game.log('The ' + def.name + ' hits you for ' + dmg + '.', 'bad');
        damagePlayer(dmg, 'the ' + def.name);
    }

    function playerAttack(m) {
        const def = MONSTERS[m.type];
        const dmg = Math.max(1, game.player.atk - def.def);
        m.hp -= dmg;
        m.awake = true;
        if (m.hp <= 0) {
            game.log('You slay the ' + def.name + '!', 'good');
            game.kills++;
            if (def.boss) {
                game.items.push({ kind: 'amulet', x: m.x, y: m.y });
                game.log('The Ogre King drops the AMULET OF DELVING!', 'gold');
            }
            game.monsters.splice(game.monsters.indexOf(m), 1);
        } else {
            game.log('You hit the ' + def.name + ' for ' + dmg + '.');
        }
    }

    // ---- monster turn ----------------------------------------------------------------

    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    function monstersAct() {
        const p = game.player;
        const field = world.distanceField([{ x: p.x, y: p.y }], { blockMask: BLOCK_MOVE });
        const fAt = (x, y) => inB(x, y) ? field[idx(x, y)] : -1;

        const downhillStep = (m) => {
            const here = fAt(m.x, m.y);
            if (here < 0) return false;
            let best = null, bestF = here;
            for (const [dx, dy] of DIRS) {
                const nx = m.x + dx, ny = m.y + dy;
                const f = fAt(nx, ny);
                if (f < 0 || f >= bestF) continue;
                if (!freeForMonster(nx, ny)) continue;
                best = { x: nx, y: ny }; bestF = f;
            }
            if (best) { m.x = best.x; m.y = best.y; return true; }
            return false;
        };
        const chaseStep = (m) => {
            const path = world.findPath(m.x, m.y, p.x, p.y, { blockMask: BLOCK_MOVE });
            if (path.length > 1 && freeForMonster(path[1].x, path[1].y)) {
                m.x = path[1].x; m.y = path[1].y;
                return true;
            }
            return downhillStep(m);
        };
        const retreatStep = (m) => {
            const here = fAt(m.x, m.y);
            let best = null, bestF = here;
            for (const [dx, dy] of DIRS) {
                const nx = m.x + dx, ny = m.y + dy;
                const f = fAt(nx, ny);
                if (f <= bestF) continue;
                if (!freeForMonster(nx, ny)) continue;
                best = { x: nx, y: ny }; bestF = f;
            }
            if (best) { m.x = best.x; m.y = best.y; return true; }
            return false;
        };
        const shoot = (m, def) => {
            const dmg = Math.max(1, def.atk - p.def);
            game.lastShot = { from: { x: m.x, y: m.y }, to: { x: p.x, y: p.y }, turn: game.turn };
            game.log("The skeleton archer's arrow hits you for " + dmg + '.', 'bad');
            if (game.onShot) game.onShot(world.cellLine(m.x, m.y, p.x, p.y));
            damagePlayer(dmg, 'an arrow');
        };

        for (const m of [...game.monsters]) {
            if (m.hp <= 0 || game.over) continue;
            const def = MONSTERS[m.type];
            if (def.slow && (game.turn & 1)) continue;              // brutes act every other turn
            const dist = world.cellDistance(m.x, m.y, p.x, p.y);
            if (!m.awake) {
                const seen = game.fog[idx(m.x, m.y)] === 2;
                if ((seen && dist <= 10) || dist <= 4) {
                    m.awake = true;
                    if (seen) game.log('The ' + def.name + ' notices you!', 'warn');
                } else continue;
            }
            if (def.ai === 'ranged') {
                if (dist === 1) { attackPlayer(m, Math.max(1, def.atk - 1)); continue; }
                const los = game.losClear(m.x, m.y, p.x, p.y);
                if (los && dist <= def.range) {
                    if (dist < def.minRange && retreatStep(m)) continue;
                    shoot(m, def);
                    continue;
                }
                chaseStep(m);
                continue;
            }
            if (dist === 1) { attackPlayer(m, def.atk); continue; }
            if (def.ai === 'pack') { downhillStep(m); continue; }
            chaseStep(m);
        }
    }

    // ---- doors / traps / items ------------------------------------------------------

    function openDoor(x, y) {
        world.setTile(x, y, TILE.DOOR_OPEN, 0);
        world.setFlag(x, y, FLAG.DOOR, false);
        const d = game.doors.find(d => d.x === x && d.y === y);
        if (d) d.open = true;
        game.doorsOpened++;
        game.log('You open the door.');
    }

    function triggerTrap(x, y) {
        world.setTile(x, y, TILE.TRAPR, 0);
        world.setFlag(x, y, FLAG.TRAP, false);      // sprung
        game.log('Spikes shoot from the floor! You take ' + TRAP_DMG + ' damage.', 'bad');
        damagePlayer(TRAP_DMG, 'a spike trap');
    }

    function pickupAt(x, y) {
        for (const it of [...game.items]) {
            if (it.x !== x || it.y !== y) continue;
            const p = game.player;
            if (it.kind === 'potion') {
                p.potions++;
                game.log('You pick up a healing potion.', 'good');
            } else if (it.kind === 'gold') {
                p.gold += it.amount; game.goldTotal += it.amount;
                game.log('You scoop up ' + it.amount + ' gold.', 'gold');
            } else if (it.kind === 'weapon') {
                if (it.bonus > p.atk - PLAYER_BASE.atk) {
                    p.atk = PLAYER_BASE.atk + it.bonus; p.weapon = it.name;
                    game.log('You wield the ' + it.name + ' (+' + it.bonus + ' ATK).', 'good');
                } else {
                    game.log('You leave the inferior ' + it.name + ' behind.');
                }
            } else if (it.kind === 'armor') {
                if (it.bonus > p.def - PLAYER_BASE.def) {
                    p.def = PLAYER_BASE.def + it.bonus; p.armor = it.name;
                    game.log('You don the ' + it.name + ' (+' + it.bonus + ' DEF).', 'good');
                } else {
                    game.log('You leave the inferior ' + it.name + ' behind.');
                }
            } else if (it.kind === 'amulet') {
                game.over = true; game.won = true;
                game.log('You clutch the AMULET OF DELVING ΓÇö the dungeon is conquered!', 'gold');
                if (game.onGameOver) game.onGameOver(true);
            }
            game.items.splice(game.items.indexOf(it), 1);
        }
    }

    // ---- player actions -----------------------------------------------------------

    game.descend = function () {
        game.floor++;
        genFloor(game.floor);
        game.player.x = game.spawn.x;
        game.player.y = game.spawn.y;
        game.computeFOV();
        game.log('You descend to floor ' + game.floor + '.', 'warn');
        if (game.onFullRedraw) game.onFullRedraw();
        if (game.onDescend) game.onDescend(game.floor);
    };

    // act: {type:'move',dx,dy} | {type:'wait'} | {type:'potion'} | {type:'search'}
    // Returns true when the action consumed a turn (monsters acted).
    game.playerAct = function (act) {
        if (game.over) return false;
        const p = game.player;
        let consumed = false;
        if (act.type === 'move') {
            const nx = p.x + act.dx, ny = p.y + act.dy;
            const m = game.monsterAt(nx, ny);
            if (m) {
                playerAttack(m);
                consumed = true;
            } else if (inB(nx, ny) && world.hasFlag(nx, ny, FLAG.DOOR)) {
                openDoor(nx, ny);
                consumed = true;
            } else if (!game.canEnter(nx, ny)) {
                return false;                                     // bump a wall: no turn
            } else {
                p.x = nx; p.y = ny;
                consumed = true;
                pickupAt(nx, ny);
                if (!game.over && world.hasFlag(nx, ny, FLAG.TRAP)) triggerTrap(nx, ny);
                if (!game.over && world.getTile(nx, ny, 0) === TILE.STAIRS_DOWN) {
                    game.turn++;
                    game.descend();                               // monsters don't get a swing
                    return true;
                }
            }
        } else if (act.type === 'wait') {
            consumed = true;
        } else if (act.type === 'potion') {
            if (p.potions <= 0) { game.log('You have no potions.'); return false; }
            if (p.hp >= p.maxHp) { game.log('You are already at full health.'); return false; }
            p.potions--;
            p.hp = Math.min(p.maxHp, p.hp + POTION_HEAL);
            game.log('You quaff a potion and feel restored (+' + POTION_HEAL + ' HP).', 'good');
            consumed = true;
        } else if (act.type === 'search') {
            let found = 0;
            for (const c of world.cellsInRange(p.x, p.y, 1, 'vertex')) {
                if (world.hasFlag(c.x, c.y, FLAG.TRAP) && world.getTile(c.x, c.y, 0) !== TILE.TRAPR) {
                    world.setTile(c.x, c.y, TILE.TRAPR, 0);       // revealed, still armed
                    found++;
                }
            }
            game.log(found ? 'You spot ' + (found > 1 ? found + ' spike traps!' : 'a spike trap!')
                : 'You search the ground but find nothing.', found ? 'warn' : '');
            consumed = true;
        }
        if (!consumed) return false;
        if (!game.over) monstersAct();
        game.turn++;
        game.computeFOV();
        return true;
    };

    // ---- save / load ---------------------------------------------------------------

    const SAVE_KEY = 'deepdelve-save';
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

    game.saveRun = function () {
        if (game.over) { game.log('The run is over ΓÇö nothing to save.'); return false; }
        const data = {
            version: 1,
            seed: game.seed, floor: game.floor, turn: game.turn,
            kills: game.kills, goldTotal: game.goldTotal, doorsOpened: game.doorsOpened,
            player: { ...game.player },
            monsters: game.monsters.map(m => ({ ...m })),
            items: game.items.map(it => ({ ...it })),
            doors: game.doors.map(d => ({ ...d })),
            decor: game.decor.map(d => ({ ...d })),
            spawn: { ...game.spawn },
            stairsDown: game.stairsDown ? { ...game.stairsDown } : null,
            fog: bytesToB64(game.fog),
            grid: bytesToB64(world.save()),
            msgs: game.msgs.slice(-12),
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
        game.log('Game saved.', 'good');
        return true;
    };

    game.loadRun = function () {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) { game.log('No saved game found.'); return false; }
        let data;
        try { data = JSON.parse(raw); } catch { return false; }
        if (!data || data.version !== 1) return false;
        if (!world.load(b64ToBytes(data.grid))) return false;
        // world.load() destroyed all object kinds (ENGINE NOTE above) ΓÇö
        // re-register them; the per-frame sync re-places every instance.
        registerKinds();
        game.seed = data.seed; game.floor = data.floor; game.turn = data.turn;
        game.kills = data.kills; game.goldTotal = data.goldTotal;
        game.doorsOpened = data.doorsOpened;
        game.player = { ...data.player };
        game.monsters = data.monsters.map(m => ({ ...m }));
        game.items = data.items.map(it => ({ ...it }));
        game.doors = data.doors.map(d => ({ ...d }));
        game.decor = data.decor.map(d => ({ ...d }));
        game.spawn = { ...data.spawn };
        game.stairsDown = data.stairsDown ? { ...data.stairsDown } : null;
        game.msgs = data.msgs.map(m => ({ ...m }));
        game.over = false; game.won = false;
        game.fog = new Uint8Array(b64ToBytes(data.fog));
        // Demote everything lit to remembered, then re-light from the player.
        for (let i = 0; i < game.fog.length; i++) if (game.fog[i] === 2) game.fog[i] = 1;
        game.visible = new Set();
        game.computeFOV();
        if (game.onFullRedraw) game.onFullRedraw();
        game.log('Game loaded.', 'good');
        return true;
    };

    // ---- run lifecycle --------------------------------------------------------------

    game.newRun = function (seed) {
        game.seed = (seed >>> 0) || 1;
        game.floor = 1;
        game.turn = 0;
        game.over = false; game.won = false;
        game.kills = 0; game.goldTotal = 0; game.doorsOpened = 0;
        game.msgs = [];
        game.player = {
            x: 0, y: 0,
            hp: PLAYER_BASE.hp, maxHp: PLAYER_BASE.hp,
            atk: PLAYER_BASE.atk, def: PLAYER_BASE.def,
            weapon: 'Rusty Dagger', armor: 'Cloth Rags',
            potions: 1, gold: 0,
        };
        genFloor(1);
        game.player.x = game.spawn.x;
        game.player.y = game.spawn.y;
        game.computeFOV();
        game.log('You descend into the Deep Delve. Retrieve the Amulet from floor ' + FLOORS + '!', 'warn');
        if (game.onFullRedraw) game.onFullRedraw();
    };

    game.newRun(seed);
    return game;
}
