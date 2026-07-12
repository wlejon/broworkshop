// game.js — GridKeep core: open-field maze tower defense on a square TileWorld.
//
// There is NO fixed creep path. Creeps flow downhill along a live
// world.distanceField() computed from the base cell; every tower placement /
// sale recomputes the field and the creeps reroute around the growing maze.
// Placement is refused when it would fully wall off the spawns (or strand a
// live creep) — checked with a tentative flag + distanceField reachability.

// --- Tiles / flags -----------------------------------------------------------

export const TILE = { GRASS: 1, DIRT: 2, ROCK: 3, WATER: 4, BASE: 5, SPAWN: 6, EGRASS: 7 };

export const FLAG_BLOCK = 1;   // impassable to creeps (water, rocks, hills, towers)
export const FLAG_NOBUILD = 2; // no towers here (water, rocks, spawn, base)
export const FLAG_TOWER = 4;   // a tower stands here

export const MAP_W = 20, MAP_H = 14;
export const CELL = 1.0;         // cellSize
export const HSTEP = 0.4;        // heightStep

// Hand-authored 20x14 map. w water (animated border), g grass (buildable),
// r rock (blocked), e elevated grass (blocked to creeps, buildable, +1 range),
// s spawn, b base.
const MAP_ROWS = [
    'wwwwwwwwwwwwwwwwwwww',
    'wgggggggggrgggeegggw',
    'wggggrgggggggggeeggw',
    'wggggggggggggggggggw',
    'wgggggggrrgggggggggw',
    'wsgggggggggggggrgggw',
    'wsggggggggggggggggbw',
    'wsggggggggggggggggew',
    'wgggggrrgggggggrgggw',
    'wggggggggggggggggggw',
    'wggggrggggggggggggew',
    'wggeegggggggrgggggew',
    'wggeeggggggggggggggw',
    'wwwwwwwwwwwwwwwwwwww',
];
const CHAR_TILE = {
    w: TILE.WATER, g: TILE.GRASS, r: TILE.ROCK,
    e: TILE.EGRASS, s: TILE.SPAWN, b: TILE.BASE,
};

export const SPAWNS = [{ x: 1, y: 5 }, { x: 1, y: 6 }, { x: 1, y: 7 }];
export const BASE = { x: 18, y: 6 };

// --- Towers ------------------------------------------------------------------

export const TOWER_TYPES = {
    arrow: {
        name: 'Arrow', cost: 20, dmg: 9, cooldown: 0.5, range: 3,
        proj: 'arrow', projSpeed: 11,
        desc: 'Fast single-target bolts.',
    },
    cannon: {
        name: 'Cannon', cost: 50, dmg: 24, cooldown: 1.7, range: 2, splash: 1.3,
        proj: 'cannon', projSpeed: 5.5,
        desc: 'Slow lobbed shells, splash damage.',
    },
    frost: {
        name: 'Frost', cost: 35, dmg: 4, cooldown: 0.9, range: 2,
        slow: 0.5, slowDur: 1.6,
        proj: 'frost', projSpeed: 8,
        desc: 'Chills creeps to half speed.',
    },
};
export const MAX_LEVEL = 3;
export const SELL_RATIO = 0.7;
// Per-level damage multiplier and cooldown factor.
const LVL_DMG = [0, 1, 1.7, 2.9];
const LVL_CD = [0, 1, 0.92, 0.85];

export function upgradeCost(tower) {
    return TOWER_TYPES[tower.type].cost * tower.level;   // L1->2 = cost, L2->3 = 2x cost
}

// --- Creeps ------------------------------------------------------------------

export const CREEP_TYPES = {
    normal: { name: 'Grub', hp: 30, speed: 1.9, bounty: 4, leak: 1, scale: 1.0 },
    fast: { name: 'Skitter', hp: 20, speed: 3.4, bounty: 5, leak: 1, scale: 0.9 },
    tank: { name: 'Bruiser', hp: 130, speed: 1.15, bounty: 14, leak: 2, scale: 1.25 },
    boss: { name: 'WARLORD', hp: 1200, speed: 0.95, bounty: 90, leak: 10, scale: 1.9 },
};

// Scripted waves: sequential groups, per-wave HP multiplier.
export const WAVES = [
    { groups: [{ t: 'normal', n: 6, gap: 0.9 }], mul: 1.0 },
    { groups: [{ t: 'normal', n: 10, gap: 0.7 }], mul: 1.2 },
    { groups: [{ t: 'normal', n: 8, gap: 0.7 }, { t: 'fast', n: 6, gap: 0.45 }], mul: 1.3 },
    { groups: [{ t: 'fast', n: 14, gap: 0.4 }], mul: 1.45 },
    { groups: [{ t: 'tank', n: 5, gap: 1.8 }], mul: 1.25 },
    { groups: [{ t: 'normal', n: 12, gap: 0.6 }, { t: 'fast', n: 8, gap: 0.4 }], mul: 2.1 },
    { groups: [{ t: 'fast', n: 18, gap: 0.30 }], mul: 2.5 },
    { groups: [{ t: 'tank', n: 8, gap: 1.2 }], mul: 2.4 },
    { groups: [{ t: 'normal', n: 16, gap: 0.42 }, { t: 'fast', n: 12, gap: 0.30 }], mul: 3.2 },
    { groups: [{ t: 'tank', n: 8, gap: 1.0 }, { t: 'fast', n: 10, gap: 0.30 }, { t: 'boss', n: 1, gap: 1 }], mul: 3.4 },
];

export const START_GOLD = 90;
export const START_LIVES = 20;

// --- Procedural tileset atlas --------------------------------------------------
// Animated tiles require an atlas, so the "palette" is baked into a tiny
// procedural RGBA atlas: 12 cells of 16x16 flat-noise colour, 4 of them the
// water animation frames. atlasInset fights bilinear bleeding between cells.

const APX = 16, ACOLS = 8, AROWS = 2;

function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makeAtlas() {
    const w = ACOLS * APX, h = AROWS * APX;
    const buf = new Uint8Array(w * h * 4);
    const rng = mulberry32(0x9E3779B9);
    function paint(cell, fn) {
        const cx = (cell % ACOLS) * APX, cy = Math.floor(cell / ACOLS) * APX;
        for (let py = 0; py < APX; py++) {
            for (let px = 0; px < APX; px++) {
                const [r, g, b] = fn(px, py, rng);
                const i = ((cy + py) * w + cx + px) * 4;
                buf[i] = Math.max(0, Math.min(255, r | 0));
                buf[i + 1] = Math.max(0, Math.min(255, g | 0));
                buf[i + 2] = Math.max(0, Math.min(255, b | 0));
                buf[i + 3] = 255;
            }
        }
    }
    const noise = (base, amt, rng) => base + (rng() - 0.5) * 2 * amt;
    // 1 grass
    paint(1, (px, py, rng) => {
        const n = noise(0, 10, rng), tuft = rng() < 0.06 ? -18 : 0;
        return [88 + n + tuft, 150 + n * 1.3 + tuft, 62 + n + tuft];
    });
    // 2 dirt
    paint(2, (px, py, rng) => {
        const n = noise(0, 9, rng);
        return [124 + n, 98 + n, 60 + n * 0.7];
    });
    // 3 rock ground
    paint(3, (px, py, rng) => {
        const n = noise(0, 8, rng), crack = rng() < 0.05 ? -25 : 0;
        return [108 + n + crack, 110 + n + crack, 116 + n + crack];
    });
    // 4..7 water animation frames — a shimmer band that drifts per frame
    for (let f = 0; f < 4; f++) {
        paint(4 + f, (px, py, rng) => {
            const wave = Math.sin((px + f * 4) * 0.5 + py * 0.9);
            const lit = wave > 0.82 ? 1 : 0;
            const n = noise(0, 6, rng);
            return lit
                ? [110 + n, 178 + n, 224 + n]
                : [36 + n + wave * 5, 92 + n + wave * 7, 152 + n + wave * 8];
        });
    }
    // 8 base pad (gold)
    paint(8, (px, py, rng) => {
        const edge = (px < 2 || py < 2 || px >= APX - 2 || py >= APX - 2) ? -55 : 0;
        const n = noise(0, 8, rng);
        return [198 + n + edge, 158 + n + edge, 62 + n * 0.6 + edge];
    });
    // 9 spawn pad (violet)
    paint(9, (px, py, rng) => {
        const edge = (px < 2 || py < 2 || px >= APX - 2 || py >= APX - 2) ? -40 : 0;
        const n = noise(0, 8, rng);
        return [128 + n + edge, 66 + n + edge, 152 + n + edge];
    });
    // 10 cliff (strata)
    paint(10, (px, py, rng) => {
        const strata = (py % 5 === 0) ? -22 : 0;
        const n = noise(0, 7, rng);
        return [96 + n + strata, 78 + n + strata, 54 + n * 0.8 + strata];
    });
    // 11 elevated grass (brighter, drier)
    paint(11, (px, py, rng) => {
        const n = noise(0, 9, rng);
        return [110 + n, 164 + n, 84 + n];
    });
    return { pixels: buf, width: w, height: h };
}

// tile id -> atlas cell (water id points at frame 0; the animation cycles it)
const TILE_ATLAS = [0, 1, 2, 3, 4, 8, 9, 11];

// --- Game factory ----------------------------------------------------------------

export function createGame(scene) {
    const atlas = makeAtlas();
    const world = scene.createTileWorld({
        width: MAP_W, height: MAP_H,
        cellSize: CELL, heightStep: HSTEP, chunkSize: 10,
        baseLevel: -2, aoStrength: 0.5,
        atlasPixels: atlas.pixels, atlasWidth: atlas.width, atlasHeight: atlas.height,
        atlasColumns: ACOLS, atlasRows: AROWS,
        tileAtlas: TILE_ATLAS,
        cliffCell: 10,
        atlasInset: 0.5,
        animations: [{ id: TILE.WATER, fps: 3, frames: [4, 5, 6, 7] }],
    });

    // ---- author the map -------------------------------------------------------

    const dirtRng = mulberry32(0x5EED);
    for (let y = 0; y < MAP_H; y++) {
        const row = MAP_ROWS[y];
        if (row.length !== MAP_W) throw new Error('MAP_ROWS[' + y + '] length ' + row.length);
        for (let x = 0; x < MAP_W; x++) {
            let id = CHAR_TILE[row[x]];
            // Sprinkle worn dirt patches through the grass (visual variety only;
            // dirt is walkable and buildable like grass).
            if (id === TILE.GRASS && dirtRng() < 0.10) id = TILE.DIRT;
            world.setTile(x, y, id, 0);
            let elev = 0;
            if (id === TILE.WATER) elev = -1;
            if (id === TILE.EGRASS) elev = 1;
            world.setElevation(x, y, elev);
            const block = id === TILE.WATER || id === TILE.ROCK || id === TILE.EGRASS;
            const nobuild = id === TILE.WATER || id === TILE.ROCK ||
                id === TILE.SPAWN || id === TILE.BASE;
            if (block) world.setFlag(x, y, FLAG_BLOCK, true);
            if (nobuild) world.setFlag(x, y, FLAG_NOBUILD, true);
        }
    }

    // ---- object kinds -----------------------------------------------------------

    const kinds = {};
    {
        // Static decorations
        kinds.rock = world.addObjectKind(
            Mesh.rock(0.30, 11, 2).translate(0, 0.16, 0),
            { color: [0.52, 0.53, 0.58, 1], roughness: 1.0 });
        kinds.keep = world.addObjectKind(
            Mesh.merge([
                Mesh.box(0.30, 0.06, 0.30).translate(0, 0.06, 0),          // plinth
                Mesh.box(0.22, 0.24, 0.22).translate(0, 0.34, 0),          // keep
                Mesh.cone(0.30, 0.34, 4, 1, true).rotate(0, 1, 0, Math.PI / 4)
                    .translate(0, 0.58, 0),                                 // roof
                Mesh.cylinder(0.015, 0.14, 5).translate(0, 1.02, 0),        // flag pole
                Mesh.box(0.075, 0.045, 0.004).translate(0.09, 1.10, 0),     // flag
            ]),
            { color: [0.92, 0.78, 0.42, 1], roughness: 0.6 });
        kinds.portal = world.addObjectKind(
            Mesh.merge([
                Mesh.torus(0.30, 0.055, 20, 10).rotate(0, 0, 1, Math.PI / 2)
                    .translate(0, 0.36, 0),                                 // upright ring
                Mesh.box(0.06, 0.05, 0.34).translate(0, 0.05, 0),           // sill
            ]),
            { color: [0.70, 0.36, 0.85, 1], roughness: 0.5, metallic: 0.2 });

        // Towers (white-ish base; per-instance colour carries type + level)
        kinds.arrow = world.addObjectKind(
            Mesh.merge([
                Mesh.cylinder(0.24, 0.09, 10).translate(0, 0.09, 0),
                Mesh.cylinder(0.15, 0.24, 8).translate(0, 0.42, 0),
                Mesh.cone(0.21, 0.30, 8, 1, true).translate(0, 0.66, 0),
            ]),
            { color: [1, 1, 1, 1], roughness: 0.8 });
        kinds.cannon = world.addObjectKind(
            Mesh.merge([
                Mesh.cylinder(0.26, 0.10, 10).translate(0, 0.10, 0),
                Mesh.sphere(0.18, 12, 8).translate(0, 0.32, 0),
                Mesh.cylinder(0.065, 0.17, 8).rotate(1, 0, 0, Math.PI / 2)
                    .translate(0, 0.36, 0.22),                              // barrel +Z
            ]),
            { color: [1, 1, 1, 1], roughness: 0.5, metallic: 0.4 });
        kinds.frost = world.addObjectKind(
            Mesh.merge([
                Mesh.cylinder(0.22, 0.08, 8).translate(0, 0.08, 0),
                Mesh.cone(0.15, 0.36, 6, 1, false).translate(0, 0.28, 0),   // crystal up
                Mesh.cone(0.15, 0.16, 6, 1, false).rotate(1, 0, 0, Math.PI)
                    .translate(0, 0.28, 0),                                 // crystal down
            ]),
            { color: [1, 1, 1, 1], roughness: 0.3, metallic: 0.1 });

        // Creeps (authored facing +Z; yaw = travel direction)
        kinds.normal = world.addObjectKind(
            Mesh.merge([
                Mesh.capsule(0.14, 0.08, 10, 6).rotate(1, 0, 0, Math.PI / 2)
                    .translate(0, 0.16, 0),                                 // slug body
                Mesh.sphere(0.10, 8, 6).translate(0, 0.24, 0.14),           // head
            ]),
            { color: [1, 1, 1, 1], roughness: 0.85 });
        kinds.fast = world.addObjectKind(
            Mesh.merge([
                Mesh.cone(0.11, 0.34, 8, 1, true).rotate(1, 0, 0, Math.PI / 2)
                    .translate(0, 0.14, 0.03),                              // dart, nose +Z
                Mesh.sphere(0.07, 8, 6).translate(0, 0.16, -0.10),
            ]),
            { color: [1, 1, 1, 1], roughness: 0.7 });
        kinds.tank = world.addObjectKind(
            Mesh.merge([
                Mesh.box(0.17, 0.11, 0.20).translate(0, 0.13, 0),
                Mesh.sphere(0.13, 10, 8).translate(0, 0.27, 0),
            ]),
            { color: [1, 1, 1, 1], roughness: 0.9 });
        kinds.boss = kinds.tank;   // boss reuses the tank silhouette, scaled up

        // Projectiles
        kinds.projArrow = world.addObjectKind(
            Mesh.merge([
                Mesh.cylinder(0.028, 0.10, 6).rotate(1, 0, 0, Math.PI / 2),
                Mesh.cone(0.05, 0.09, 6, 1, true).rotate(1, 0, 0, Math.PI / 2)
                    .translate(0, 0, 0.10),
            ]),
            { color: [1, 0.9, 0.55, 1], roughness: 0.4 });
        kinds.projCannon = world.addObjectKind(
            Mesh.sphere(0.09, 8, 6),
            { color: [0.22, 0.22, 0.24, 1], roughness: 0.6, metallic: 0.3 });
        kinds.projFrost = world.addObjectKind(
            Mesh.cone(0.05, 0.18, 5, 1, true).rotate(1, 0, 0, Math.PI / 2),
            { color: [0.65, 0.88, 1, 1], roughness: 0.2 });

        // Scatter decorative rocks on rock cells
        const rng = mulberry32(0xBADC0DE);
        for (let y = 0; y < MAP_H; y++) {
            for (let x = 0; x < MAP_W; x++) {
                if (world.getTile(x, y, 0) !== TILE.ROCK) continue;
                const n = 1 + Math.floor(rng() * 2);
                for (let i = 0; i < n; i++) {
                    world.addObject(kinds.rock, x, y, {
                        yaw: rng() * 6.28, scale: 0.75 + rng() * 0.5,
                        offsetX: (rng() - 0.5) * 0.4, offsetZ: (rng() - 0.5) * 0.4,
                    });
                }
            }
        }
        world.addObject(kinds.keep, BASE.x, BASE.y, { yaw: -Math.PI / 2, scale: 1.35 });
        for (const s of SPAWNS)
            world.addObject(kinds.portal, s.x, s.y, { yaw: 0, scale: 1.2 });
    }

    world.rebuild();
    world.rebuildObjects();

    // ---- state ---------------------------------------------------------------

    const game = {
        world, kinds,
        gold: START_GOLD,
        lives: START_LIVES,
        wave: 0,                 // last wave started (1-based); 0 = pre-game
        waveActive: false,
        over: false, won: false,
        kills: 0, leaks: 0,
        towers: [],              // { id, type, x, y, level, invested, cooldown, yaw, target }
        creeps: [],              // { id, type, def, hp, maxHp, px, py, tx, ty, ... }
        projectiles: [],         // { kind, x, y (cell floats), ... }
        field: null,             // Int32Array distance-to-base, -1 unreachable
        time: 0,                 // game clock, seconds
        lastRefusal: null,       // { x, y, reason } — for UI flash + tests
        frozen: false,           // debug: halt creep movement
        // callbacks the shell wires up
        onWaveStart: null, onWaveCleared: null, onGameOver: null,
        onLeak: null, onGoldChange: null, onTowersChanged: null,
        onCreepDied: null, onRefused: null, onSplash: null,
    };

    let nextId = 1;
    let spawnQueue = [];         // [{ type, at }] absolute game.time seconds
    let spawnCursor = 0;         // round-robin over SPAWNS

    // ---- routing ----------------------------------------------------------------

    game.recomputeField = function () {
        game.field = world.distanceField([BASE], { blockMask: FLAG_BLOCK });
        for (const c of game.creeps) c.repath = true;
    };
    game.recomputeField();

    game.fieldAt = (x, y) =>
        (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) ? game.field[y * MAP_W + x] : -1;

    // ---- placement -----------------------------------------------------------------

    game.towerAt = (x, y) => game.towers.find(t => t.x === x && t.y === y) || null;

    game.creepOn = (x, y) =>
        game.creeps.find(c => Math.round(c.px) === x && Math.round(c.py) === y) || null;

    // Placement legality WITHOUT the route check (cheap; used for hover preview
    // too). Returns null when fine, else a reason string.
    function placeVeto(type, x, y) {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return 'bounds';
        if (world.hasFlag(x, y, FLAG_TOWER)) return 'occupied';
        if (world.hasFlag(x, y, FLAG_NOBUILD)) return 'terrain';
        const id = world.getTile(x, y, 0);
        if (id !== TILE.GRASS && id !== TILE.DIRT && id !== TILE.EGRASS) return 'terrain';
        if (game.creepOn(x, y)) return 'creep';
        if (game.gold < TOWER_TYPES[type].cost) return 'gold';
        return null;
    }

    // Full check including the "may not wall off the map" rule: tentatively
    // block the cell, recompute the distance field, and demand every spawn AND
    // every live creep can still reach the base.
    game.canPlace = function (type, x, y) {
        const veto = placeVeto(type, x, y);
        if (veto) return { ok: false, reason: veto };
        if (world.getTile(x, y, 0) === TILE.EGRASS)   // already blocked; can't affect routes
            return { ok: true, reason: null };
        world.setFlag(x, y, FLAG_BLOCK, true);
        try {
            const f = world.distanceField([BASE], { blockMask: FLAG_BLOCK });
            for (const s of SPAWNS)
                if (f[s.y * MAP_W + s.x] < 0) return { ok: false, reason: 'blocks' };
            for (const c of game.creeps) {
                const cx = Math.round(c.px), cy = Math.round(c.py);
                if (f[cy * MAP_W + cx] < 0) return { ok: false, reason: 'blocks' };
            }
            return { ok: true, reason: null };
        } finally {
            world.setFlag(x, y, FLAG_BLOCK, false);
        }
    };

    game.placeTower = function (type, x, y) {
        const chk = game.canPlace(type, x, y);
        if (!chk.ok) {
            game.lastRefusal = { x, y, reason: chk.reason, time: game.time };
            if (game.onRefused) game.onRefused(game.lastRefusal);
            return null;
        }
        const def = TOWER_TYPES[type];
        const tower = {
            id: nextId++, type, x, y, level: 1, invested: def.cost,
            cooldown: 0, yaw: Math.PI / 2, target: null,
            elevated: world.getTile(x, y, 0) === TILE.EGRASS,
        };
        game.towers.push(tower);
        game.gold -= def.cost;
        world.setFlag(x, y, FLAG_BLOCK, true);
        world.setFlag(x, y, FLAG_TOWER, true);
        game.recomputeField();
        game.lastRefusal = null;
        if (game.onGoldChange) game.onGoldChange();
        if (game.onTowersChanged) game.onTowersChanged();
        return tower;
    };

    game.towerRange = function (t) {
        return TOWER_TYPES[t.type].range + (t.elevated ? 1 : 0) + (t.level >= 3 ? 1 : 0);
    };
    game.towerDamage = (t) => Math.round(TOWER_TYPES[t.type].dmg * LVL_DMG[t.level]);
    game.towerCooldown = (t) => TOWER_TYPES[t.type].cooldown * LVL_CD[t.level];

    game.upgradeTower = function (t) {
        if (t.level >= MAX_LEVEL) return false;
        const cost = upgradeCost(t);
        if (game.gold < cost) return false;
        game.gold -= cost;
        t.invested += cost;
        t.level++;
        if (game.onGoldChange) game.onGoldChange();
        if (game.onTowersChanged) game.onTowersChanged();
        return true;
    };

    game.sellRefund = (t) => Math.floor(t.invested * SELL_RATIO);

    game.sellTower = function (t) {
        const i = game.towers.indexOf(t);
        if (i < 0) return false;
        game.towers.splice(i, 1);
        game.gold += game.sellRefund(t);
        world.setFlag(t.x, t.y, FLAG_BLOCK,
            world.getTile(t.x, t.y, 0) === TILE.EGRASS);   // hills stay blocked
        world.setFlag(t.x, t.y, FLAG_TOWER, false);
        game.recomputeField();
        if (game.onGoldChange) game.onGoldChange();
        if (game.onTowersChanged) game.onTowersChanged();
        return true;
    };

    // ---- creeps -----------------------------------------------------------------

    game.spawnCreep = function (type, x, y, opts = {}) {
        const def = CREEP_TYPES[type];
        const hp = Math.round(def.hp * (opts.hpMul || 1));
        const c = {
            id: nextId++, type, def,
            hp, maxHp: hp,
            px: x, py: y, tx: x, ty: y,     // continuous cell coords + next cell
            yaw: Math.PI / 2,
            slowUntil: 0, hitFlash: 0, repath: true,
        };
        game.creeps.push(c);
        return c;
    };

    // Next step: the 4-neighbour with the smallest field value below ours.
    // Straight-ahead wins ties so lanes read cleanly.
    const DIRS = [[1, 0], [0, -1], [-1, 0], [0, 1]];
    function pickNext(c) {
        const cx = Math.round(c.px), cy = Math.round(c.py);
        const here = game.fieldAt(cx, cy);
        if (here === 0) return 'base';
        const pdx = Math.sign(c.tx - c.px), pdy = Math.sign(c.ty - c.py);
        let best = null, bestF = Infinity, bestStraight = -1;
        for (const [dx, dy] of DIRS) {
            const f = game.fieldAt(cx + dx, cy + dy);
            if (f < 0) continue;
            const straight = (dx === pdx && dy === pdy) ? 1 : 0;
            if (f < bestF || (f === bestF && straight > bestStraight)) {
                best = [cx + dx, cy + dy]; bestF = f; bestStraight = straight;
            }
        }
        if (!best) return null;         // stranded (shouldn't happen; placement forbids it)
        c.tx = best[0]; c.ty = best[1];
        c.repath = false;
        return 'go';
    }

    function leak(c) {
        game.lives -= c.def.leak;
        game.leaks++;
        removeCreep(c);
        if (game.onLeak) game.onLeak(c);
        if (game.lives <= 0 && !game.over) {
            game.lives = 0;
            game.over = true; game.won = false;
            if (game.onGameOver) game.onGameOver(false);
        }
    }

    function removeCreep(c) {
        const i = game.creeps.indexOf(c);
        if (i >= 0) game.creeps.splice(i, 1);
    }

    game.damageCreep = function (c, dmg) {
        if (c.hp <= 0) return;
        c.hp -= dmg;
        c.hitFlash = 0.12;
        if (c.hp <= 0) {
            c.hp = 0;
            game.gold += c.def.bounty;
            game.kills++;
            removeCreep(c);
            if (game.onCreepDied) game.onCreepDied(c);
            if (game.onGoldChange) game.onGoldChange();
        }
    };

    game.creepSpeed = (c) =>
        c.def.speed * (game.time < c.slowUntil ? TOWER_TYPES.frost.slow : 1);

    game.isSlowed = (c) => game.time < c.slowUntil;

    function updateCreeps(dt) {
        if (game.frozen) return;
        for (const c of [...game.creeps]) {
            c.hitFlash = Math.max(0, c.hitFlash - dt);
            // If rerouted or the current target got blocked, re-pick from here.
            if (c.repath || game.fieldAt(c.tx, c.ty) < 0) {
                const r = pickNext(c);
                if (r === 'base') { leak(c); continue; }
                if (r === null) continue;
            }
            let remaining = game.creepSpeed(c) * dt;
            while (remaining > 0) {
                const dx = c.tx - c.px, dy = c.ty - c.py;
                const dist = Math.hypot(dx, dy);
                if (dist < 1e-6) {
                    const r = pickNext(c);
                    if (r === 'base') { leak(c); break; }
                    if (r !== 'go') break;
                    continue;
                }
                c.yaw = Math.atan2(dx, dy);
                const step = Math.min(remaining, dist);
                c.px += dx / dist * step;
                c.py += dy / dist * step;
                remaining -= step;
                if (step >= dist - 1e-9) { c.px = c.tx; c.py = c.ty; }
            }
        }
    }

    // ---- waves ------------------------------------------------------------------

    game.finalWave = WAVES.length;

    game.startNextWave = function () {
        if (game.over || game.waveActive || game.wave >= WAVES.length) return false;
        game.wave++;
        game.waveActive = true;
        const def = WAVES[game.wave - 1];
        spawnQueue = [];
        let at = game.time + 0.5;
        for (const grp of def.groups) {
            for (let i = 0; i < grp.n; i++) {
                spawnQueue.push({ type: grp.t, at, hpMul: def.mul });
                at += grp.gap;
            }
            at += 1.2;
        }
        if (game.onWaveStart) game.onWaveStart(game.wave, def);
        return true;
    };

    function updateWave() {
        while (spawnQueue.length && spawnQueue[0].at <= game.time) {
            const s = spawnQueue.shift();
            const cell = SPAWNS[spawnCursor++ % SPAWNS.length];
            game.spawnCreep(s.type, cell.x, cell.y, { hpMul: s.hpMul });
        }
        if (game.waveActive && spawnQueue.length === 0 && game.creeps.length === 0 && !game.over) {
            game.waveActive = false;
            const bonus = 15 + game.wave * 3;
            game.gold += bonus;
            if (game.onGoldChange) game.onGoldChange();
            if (game.onWaveCleared) game.onWaveCleared(game.wave, bonus);
            if (game.wave >= WAVES.length) {
                game.over = true; game.won = true;
                if (game.onGameOver) game.onGameOver(true);
            }
        }
    }

    // ---- towers firing --------------------------------------------------------------

    // Chebyshev range (square "box" ring, matches cellsInRange 'vertex' display).
    function inRange(t, c) {
        const r = game.towerRange(t);
        return Math.max(Math.abs(Math.round(c.px) - t.x), Math.abs(Math.round(c.py) - t.y)) <= r;
    }

    // Target the in-range creep closest to the base (lowest field value).
    function acquire(t) {
        let best = null, bestF = Infinity;
        for (const c of game.creeps) {
            if (!inRange(t, c)) continue;
            const f = game.fieldAt(Math.round(c.px), Math.round(c.py));
            const score = f < 0 ? 9999 : f;
            if (score < bestF || (score === bestF && best && c.id < best.id)) {
                best = c; bestF = score;
            }
        }
        return best;
    }

    function fire(t, target) {
        const def = TOWER_TYPES[t.type];
        const p = {
            kind: def.proj,
            x: t.x, y: t.y,               // continuous cell coords
            h: 0.72 + (t.elevated ? HSTEP : 0),   // flight height above grade
            startH: 0.72 + (t.elevated ? HSTEP : 0),
            speed: def.projSpeed,
            dmg: game.towerDamage(t),
            splash: def.splash || 0,
            slow: def.slow ? { dur: def.slowDur } : null,
            target, lastX: target.px, lastY: target.py,
            traveled: 0,
            total: Math.max(0.35, Math.hypot(target.px - t.x, target.py - t.y)),
            yaw: 0,
        };
        game.projectiles.push(p);
        t.cooldown = game.towerCooldown(t);
        t.yaw = Math.atan2(target.px - t.x, target.py - t.y);
    }

    function updateTowers(dt) {
        for (const t of game.towers) {
            t.cooldown = Math.max(0, t.cooldown - dt);
            const target = acquire(t);
            t.target = target;
            if (target) t.yaw = Math.atan2(target.px - t.x, target.py - t.y);
            if (target && t.cooldown <= 0) fire(t, target);
        }
    }

    function impact(p) {
        const alive = p.target && p.target.hp > 0;
        if (p.splash > 0) {
            const ix = alive ? p.target.px : p.lastX;
            const iy = alive ? p.target.py : p.lastY;
            for (const c of [...game.creeps])
                if (Math.hypot(c.px - ix, c.py - iy) <= p.splash)
                    game.damageCreep(c, p.dmg);
            if (game.onSplash) game.onSplash(Math.round(ix), Math.round(iy));
        } else if (alive) {
            if (p.slow) p.target.slowUntil = game.time + p.slow.dur;
            game.damageCreep(p.target, p.dmg);
        }
    }

    function updateProjectiles(dt) {
        for (const p of [...game.projectiles]) {
            const alive = p.target && p.target.hp > 0 && game.creeps.includes(p.target);
            const gx = alive ? p.target.px : p.lastX;
            const gy = alive ? p.target.py : p.lastY;
            if (alive) { p.lastX = p.target.px; p.lastY = p.target.py; }
            const dx = gx - p.x, dy = gy - p.y;
            const dist = Math.hypot(dx, dy);
            const step = p.speed * dt;
            p.yaw = Math.atan2(dx, dy);
            if (step >= dist - 0.02) {
                impact(p);
                game.projectiles.splice(game.projectiles.indexOf(p), 1);
                continue;
            }
            p.x += dx / dist * step;
            p.y += dy / dist * step;
            p.traveled += step;
            const t01 = Math.min(1, p.traveled / p.total);
            if (p.kind === 'cannon') {
                p.h = p.startH + 4 * 0.85 * t01 * (1 - t01);   // lobbed arc
            } else {
                p.h = p.startH + (0.32 - p.startH) * t01;      // dive to torso height
            }
        }
    }

    // ---- main update ------------------------------------------------------------------

    game.update = function (dt) {
        if (game.over) return;
        game.time += dt;
        updateWave();
        updateCreeps(dt);
        updateTowers(dt);
        updateProjectiles(dt);
    };

    return game;
}
