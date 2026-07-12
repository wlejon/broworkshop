// game.js — HexFront core: hex TileWorld map, units, combat rules, and AI.
//
// A turn-based hex tactics wargame built on scene.createTileWorld
// (topology 'hex'). Terrain ids double as palette indices; water is marked
// impassable with a flag bit and every grid query (findPath, distanceField,
// reachability) respects it via blockMask. Elevation gives hills/mountains
// real cliffs and a +25% damage bonus for attacking from high ground.

export const TILE = { GRASS: 1, FOREST: 2, HILL: 3, MOUNTAIN: 4, WATER: 5 };
export const FLAG_WATER = 1;   // impassable terrain
export const FLAG_UNIT = 2;    // transient: cell occupied (set only around findPath calls)

export const MAP_W = 13, MAP_H = 11;

// Per-tile-id data, indexed by TILE id (0 = empty, unused).
export const MOVE_COST = [1, 1, 2, 2, 3, 1];       // step cost entering the cell
export const DEF_BONUS = [0, 0, 1, 1, 2, 0];       // flat damage reduction on defender
const TILE_ELEV = [0, 0, 0, 1, 2, -1];             // authored elevation per terrain
const TILE_NAME = ['?', 'Grass', 'Forest', 'Hill', 'Mountain', 'Water'];

export const UNIT_TYPES = {
    infantry:  { name: 'Infantry',  hp: 10, atk: 4, move: 3, rangeMin: 1, rangeMax: 1, canCounter: true },
    tank:      { name: 'Tank',      hp: 14, atk: 6, move: 4, rangeMin: 1, rangeMax: 1, canCounter: true },
    artillery: { name: 'Artillery', hp: 8,  atk: 6, move: 2, rangeMin: 2, rangeMax: 3, canCounter: false },
};

// Hand-authored 13x11 map. g grass, f forest, h hill, m mountain, w water.
// A river snakes down the middle with open crossings north and south plus a
// narrow eastern inlet — two chokepoints worth fighting over.
const MAP_ROWS = [
    'gggffgggghhgg',
    'gfffggggggmhg',
    'ggfgggwwgghhg',
    'gggggwwwggggg',
    'hggggwwggffgg',
    'ghggggwgggfgg',
    'ghggfgwwggggg',
    'ggggfggwwgggh',
    'gmhggggwwgghh',
    'ghhggggggggfg',
    'ggggffggggffg',
];
const CHAR_TILE = { g: TILE.GRASS, f: TILE.FOREST, h: TILE.HILL, m: TILE.MOUNTAIN, w: TILE.WATER };

const START_UNITS = [
    { side: 'red',  type: 'infantry',  x: 1,  y: 3 },
    { side: 'red',  type: 'infantry',  x: 1,  y: 7 },
    { side: 'red',  type: 'tank',      x: 2,  y: 5 },
    { side: 'red',  type: 'artillery', x: 0,  y: 5 },
    { side: 'blue', type: 'infantry',  x: 11, y: 3 },
    { side: 'blue', type: 'infantry',  x: 11, y: 7 },
    { side: 'blue', type: 'tank',      x: 10, y: 5 },
    { side: 'blue', type: 'artillery', x: 12, y: 5 },
];

const SIDE_COLOR = {
    red:  [0.88, 0.26, 0.20, 1],
    blue: [0.28, 0.50, 0.95, 1],
};

// Deterministic PRNG for decorative scatter (tree offsets) so headless
// screenshots and tests are reproducible.
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Odd-r offset hex neighbours (pointy-top, matches TileWorld's hex layout).
const HEX_EVEN = [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]];
const HEX_ODD  = [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]];
export function hexNeighbors(x, y) {
    const dirs = (y & 1) ? HEX_ODD : HEX_EVEN;
    return dirs.map(([dx, dy]) => [x + dx, y + dy]);
}

export function createGame(scene) {
    const palette = new Float32Array([
        0, 0, 0, 1,                // 0 empty
        0.42, 0.66, 0.29, 1,       // grass
        0.20, 0.44, 0.19, 1,       // forest floor
        0.63, 0.55, 0.33, 1,       // hill
        0.56, 0.56, 0.60, 1,       // mountain
        0.19, 0.40, 0.66, 1,       // water
    ]);

    const world = scene.createTileWorld({
        width: MAP_W, height: MAP_H, topology: 'hex',
        cellSize: 1.0, heightStep: 0.45, chunkSize: 16,
        baseLevel: -2, aoStrength: 0.4,
        palette,
    });

    // ---- author the map -----------------------------------------------------

    for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
            const id = CHAR_TILE[MAP_ROWS[y][x]];
            world.setTile(x, y, id, 0);
            world.setElevation(x, y, TILE_ELEV[id]);
            world.setFlag(x, y, FLAG_WATER, id === TILE.WATER);
        }
    }

    // ---- object kinds + decorations ------------------------------------------
    //
    // ENGINE NOTE / workaround: world.load() drops every registered object
    // kind and all placed instances — TileWorld::loadGrid() calls clear(),
    // which destroys objectKinds_ (bro src/scene/tile_world.cpp:296 + 332),
    // even though the load() docs say rendering config is preserved. After a
    // stale-kind addObject the call just returns -1 silently. So kinds are
    // (re-)registered and decorations re-scattered via this function, called
    // once at startup and again after every world.load().

    const unitKinds = {};   // stable object identity; indices refreshed below

    function registerKindsAndDecorations() {
        const rng = mulberry32(0xC0FFEE);
        const treeKind = world.addObjectKind(
            Mesh.merge([
                Mesh.cylinder(0.05, 0.10, 6).translate(0, 0.10, 0),
                Mesh.cone(0.20, 0.52, 7, 1, true).translate(0, 0.16, 0),
            ]),
            { color: [0.16, 0.38, 0.16, 1], roughness: 0.95 });
        const rockKind = world.addObjectKind(
            Mesh.rock(0.22, 7, 2).translate(0, 0.14, 0),
            { color: [0.48, 0.48, 0.52, 1], roughness: 1.0 });
        for (let y = 0; y < MAP_H; y++) {
            for (let x = 0; x < MAP_W; x++) {
                const id = world.getTile(x, y, 0);
                if (id === TILE.FOREST) {
                    const n = 2 + Math.floor(rng() * 2);
                    for (let i = 0; i < n; i++) {
                        world.addObject(treeKind, x, y, {
                            yaw: rng() * Math.PI * 2,
                            scale: 0.8 + rng() * 0.45,
                            offsetX: (rng() - 0.5) * 0.55,
                            offsetZ: (rng() - 0.5) * 0.55,
                        });
                    }
                } else if (id === TILE.MOUNTAIN) {
                    world.addObject(rockKind, x, y, { yaw: rng() * 6.28, scale: 1.1 });
                }
            }
        }

        // Unit kinds: bro.mesh primitive assemblies, white base so the
        // per-instance color carries the side (red/blue).
        unitKinds.infantry = world.addObjectKind(
            Mesh.merge([
                Mesh.cylinder(0.26, 0.035, 12).translate(0, 0.035, 0),      // base puck
                Mesh.capsule(0.13, 0.13, 10, 6).translate(0, 0.40, 0),      // body
                Mesh.sphere(0.10, 10, 8).translate(0, 0.68, 0),             // head
            ]),
            { color: [1, 1, 1, 1], roughness: 0.75 });
        unitKinds.tank = world.addObjectKind(
            Mesh.merge([
                Mesh.box(0.32, 0.10, 0.24).translate(0, 0.14, 0),           // hull
                Mesh.cylinder(0.15, 0.07, 12).translate(0, 0.31, 0),        // turret
                Mesh.cylinder(0.035, 0.20, 8).rotate(1, 0, 0, Math.PI / 2)
                    .translate(0, 0.31, 0.30),                              // barrel
            ]),
            { color: [1, 1, 1, 1], roughness: 0.6, metallic: 0.35 });
        unitKinds.artillery = world.addObjectKind(
            Mesh.merge([
                Mesh.box(0.26, 0.07, 0.20).translate(0, 0.11, 0),           // carriage
                Mesh.cylinder(0.09, 0.05, 10).translate(0, 0.21, 0),        // mount
                Mesh.cylinder(0.05, 0.30, 8).rotate(1, 0, 0, Math.PI / 3)
                    .translate(0, 0.34, 0.18),                              // tilted barrel
            ]),
            { color: [1, 1, 1, 1], roughness: 0.6, metallic: 0.3 });
    }

    registerKindsAndDecorations();
    world.rebuild();
    world.rebuildObjects();

    // ---- state ---------------------------------------------------------------

    let nextId = 1;
    const units = START_UNITS.map(s => ({
        id: nextId++,
        side: s.side, type: s.type, x: s.x, y: s.y,
        hp: UNIT_TYPES[s.type].hp,
        acted: false, alive: true,
    }));

    const game = {
        world, units, unitKinds,
        turn: { number: 1, side: 'red', over: false, winner: null },
        onCombat: null,      // ({attacker, defender, damage, counterDamage, killed, counterKilled})
        onGameOver: null,    // (winner)
    };

    game.aliveUnits = (side) =>
        units.filter(u => u.alive && (!side || u.side === side));

    game.unitAt = (x, y) =>
        units.find(u => u.alive && u.x === x && u.y === y) || null;

    game.tileName = (x, y) => TILE_NAME[world.getTile(x, y, 0)] || '?';

    game.isPassable = (x, y) =>
        x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && !world.hasFlag(x, y, FLAG_WATER);

    // ---- movement -------------------------------------------------------------

    // Dijkstra over hex neighbours with terrain costs. Occupied cells (any
    // unit but the mover) block both pass-through and stopping. Returns
    // Map "x,y" -> { x, y, cost } including the start at cost 0.
    game.reachable = function (unit) {
        const budget = UNIT_TYPES[unit.type].move;
        const dist = new Map();
        const startKey = unit.x + ',' + unit.y;
        dist.set(startKey, { x: unit.x, y: unit.y, cost: 0 });
        const frontier = [[0, unit.x, unit.y]];
        while (frontier.length) {
            let bi = 0;
            for (let i = 1; i < frontier.length; i++) if (frontier[i][0] < frontier[bi][0]) bi = i;
            const [c, x, y] = frontier.splice(bi, 1)[0];
            const cur = dist.get(x + ',' + y);
            if (cur && cur.cost < c) continue;
            for (const [nx, ny] of hexNeighbors(x, y)) {
                if (!game.isPassable(nx, ny)) continue;
                const occ = game.unitAt(nx, ny);
                if (occ && occ !== unit) continue;
                const nc = c + MOVE_COST[world.getTile(nx, ny, 0)];
                if (nc > budget) continue;
                const key = nx + ',' + ny;
                const prev = dist.get(key);
                if (!prev || nc < prev.cost) {
                    dist.set(key, { x: nx, y: ny, cost: nc });
                    frontier.push([nc, nx, ny]);
                }
            }
        }
        return dist;
    };

    // Run fn with FLAG_UNIT stamped on every occupied cell except `exclude`,
    // so world.findPath treats other units as obstacles.
    function withUnitFlags(exclude, fn) {
        const stamped = [];
        for (const u of units) {
            if (!u.alive || u === exclude) continue;
            world.setFlag(u.x, u.y, FLAG_UNIT, true);
            stamped.push(u);
        }
        try { return fn(); }
        finally { for (const u of stamped) world.setFlag(u.x, u.y, FLAG_UNIT, false); }
    }

    // Engine A* route with terrain costs, avoiding water and other units.
    game.routeTo = function (unit, tx, ty) {
        return withUnitFlags(unit, () =>
            world.findPath(unit.x, unit.y, tx, ty, {
                blockMask: FLAG_WATER | FLAG_UNIT,
                costs: MOVE_COST,
            }));
    };

    // Animated move: steps the unit down `path` on a timer (advanceTime-
    // friendly in headless), then onDone. Instant when path <= 1 cell.
    game.moveUnitAlong = function (unit, path, stepMs, onDone) {
        if (!path || path.length === 0) { if (onDone) onDone(); return; }
        let i = 0;
        const step = () => {
            unit.x = path[i].x; unit.y = path[i].y;
            game.sync();
            i++;
            if (i < path.length) setTimeout(step, stepMs);
            else if (onDone) onDone();
        };
        step();
    };

    // ---- combat ---------------------------------------------------------------

    // Wounded units hit softer; terrain shields the defender; attacking from
    // higher elevation lands 25% harder. Deterministic (no dice) so headless
    // battles are exactly reproducible.
    game.computeDamage = function (att, def) {
        const t = UNIT_TYPES[att.type];
        let dmg = t.atk * (0.5 + 0.5 * att.hp / t.hp);
        dmg -= DEF_BONUS[world.getTile(def.x, def.y, 0)];
        if (world.getElevation(att.x, att.y) > world.getElevation(def.x, def.y)) dmg *= 1.25;
        return Math.max(1, Math.round(dmg));
    };

    game.inAttackRange = function (unit, fromX, fromY, target) {
        const t = UNIT_TYPES[unit.type];
        const d = world.cellDistance(fromX, fromY, target.x, target.y);
        return d >= t.rangeMin && d <= t.rangeMax;
    };

    game.attackTargets = function (unit, fromX = unit.x, fromY = unit.y) {
        const foe = unit.side === 'red' ? 'blue' : 'red';
        return game.aliveUnits(foe).filter(e => game.inAttackRange(unit, fromX, fromY, e));
    };

    game.attack = function (att, def) {
        const damage = game.computeDamage(att, def);
        def.hp -= damage;
        let counterDamage = 0;
        let killed = false, counterKilled = false;
        if (def.hp <= 0) { def.hp = 0; def.alive = false; killed = true; }
        else if (UNIT_TYPES[def.type].canCounter && game.inAttackRange(def, def.x, def.y, att)) {
            counterDamage = game.computeDamage(def, att);
            att.hp -= counterDamage;
            if (att.hp <= 0) { att.hp = 0; att.alive = false; counterKilled = true; }
        }
        game.sync();
        const info = { attacker: att, defender: def, damage, counterDamage, killed, counterKilled };
        if (game.onCombat) game.onCombat(info);
        game.checkVictory();
        return info;
    };

    game.checkVictory = function () {
        if (game.turn.over) return;
        const red = game.aliveUnits('red').length;
        const blue = game.aliveUnits('blue').length;
        if (red === 0 || blue === 0) {
            game.turn.over = true;
            game.turn.winner = red === 0 ? 'blue' : 'red';
            if (game.onGameOver) game.onGameOver(game.turn.winner);
        }
    };

    // ---- turns ----------------------------------------------------------------

    game.beginBlueTurn = function () {
        game.turn.side = 'blue';
        for (const u of game.aliveUnits('blue')) u.acted = false;
    };
    game.beginRedTurn = function () {
        game.turn.side = 'red';
        game.turn.number++;
        for (const u of game.aliveUnits('red')) u.acted = false;
        game.sync();
    };

    // ---- AI (one blue unit's whole action, applied synchronously) -------------
    //
    // Guidance uses the engine distanceField from all red positions (uniform
    // steps, water-blocked); the unit picks its reachable cell that best
    // closes distance — or, for artillery, one that puts a red in its 2-3
    // ring — then attacks the weakest target in range.
    game.aiAct = function (unit) {
        const enemies = game.aliveUnits('red');
        if (!enemies.length || !unit.alive) { unit.acted = true; return null; }
        const t = UNIT_TYPES[unit.type];
        let action = { unit, moved: false, combat: null };

        let targets = game.attackTargets(unit);
        if (!targets.length) {
            const field = world.distanceField(
                enemies.map(e => ({ x: e.x, y: e.y })), { blockMask: FLAG_WATER });
            const reach = game.reachable(unit);
            let best = null, bestScore = Infinity;
            for (const cell of reach.values()) {
                if (game.unitAt(cell.x, cell.y) && !(cell.x === unit.x && cell.y === unit.y)) continue;
                const canShoot = enemies.some(e => game.inAttackRange(unit, cell.x, cell.y, e));
                const f = field[cell.y * MAP_W + cell.x];
                const dist = f >= 0 ? f : 999;
                // A firing position beats any amount of approach; otherwise
                // walk downhill on the distance field, cheapest path first.
                const score = (canShoot ? -1000 : dist * 10) + cell.cost * 0.1;
                if (score < bestScore) { bestScore = score; best = cell; }
            }
            if (best && (best.x !== unit.x || best.y !== unit.y)) {
                const path = game.routeTo(unit, best.x, best.y);
                if (path.length) {
                    unit.x = best.x; unit.y = best.y;
                    action.moved = true;
                    action.path = path;
                }
            }
            targets = game.attackTargets(unit);
        }
        if (targets.length) {
            let target = targets[0];
            for (const e of targets) if (e.hp < target.hp) target = e;
            action.combat = game.attack(unit, target);
        }
        unit.acted = true;
        game.sync();
        return action;
    };

    // ---- highlights (per-cell tint) --------------------------------------------

    game.clearHighlights = function () {
        world.fillTint(0, 0, MAP_W - 1, MAP_H - 1, 1, 1, 1, 1);
        world.rebuild();
    };

    // cells: iterable of {x,y}; [r,g,b] multiplies the terrain colour.
    game.highlight = function (cells, r, g, b) {
        for (const c of cells) world.setTint(c.x, c.y, r, g, b, 1);
        world.rebuild();
    };

    // ---- render sync: unit instances + HP bar billboards -----------------------

    const hpBars = new Map();   // unit.id -> ShapeNode

    game.sync = function () {
        for (const kindName of Object.keys(unitKinds)) {
            world.clearObjects(unitKinds[kindName]);
        }
        for (const u of units) {
            if (!u.alive) continue;
            const c = SIDE_COLOR[u.side];
            const dim = (u.acted && !game.turn.over) ? 0.55 : 1.0;
            world.addObject(unitKinds[u.type], u.x, u.y, {
                yaw: u.side === 'red' ? Math.PI / 2 : -Math.PI / 2,
                scale: 1.25,
                color: [c[0] * dim, c[1] * dim, c[2] * dim, 1],
            });
        }
        world.rebuildObjects();

        for (const u of units) {
            let bar = hpBars.get(u.id);
            if (!u.alive) {
                if (bar) { bar.destroy(); hpBars.delete(u.id); }
                continue;
            }
            const p = world.cellCenterWorldXZ(u.x, u.y);
            let topY = world.sampleHeight(p.x, p.z);
            if (topY === null) topY = 0;
            const frac = u.hp / UNIT_TYPES[u.type].hp;
            const fill = frac > 0.6 ? '#46d24a' : frac > 0.3 ? '#e6c33c' : '#e04430';
            if (!bar) {
                bar = scene.createShape({
                    shape: 'rect', width: 0.8, height: 0.09,
                    fill, worldAnchor: [p.x, topY + 1.18, p.z], billboard: 'full',
                });
                hpBars.set(u.id, bar);
            }
            bar.worldAnchor = [p.x, topY + 1.18, p.z];
            bar.width = Math.max(0.06, 0.8 * frac);
            bar.fillColor = fill;
        }
    };

    // ---- save / load ------------------------------------------------------------

    function bytesToB64(bytes) {
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    }
    function b64ToBytes(b64) {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    game.save = function () {
        const data = {
            version: 1,
            turn: { ...game.turn },
            units: units.map(u => ({ ...u })),
            grid: bytesToB64(world.save()),
        };
        localStorage.setItem('hexfront-save', JSON.stringify(data));
        return true;
    };

    game.load = function () {
        const raw = localStorage.getItem('hexfront-save');
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (!data || data.version !== 1) return false;
        if (!world.load(b64ToBytes(data.grid))) return false;
        // world.load() cleared all object kinds (see ENGINE NOTE above) —
        // re-register kinds and re-scatter decorations before syncing units.
        registerKindsAndDecorations();
        Object.assign(game.turn, data.turn);
        units.length = 0;
        for (const u of data.units) units.push({ ...u });
        game.clearHighlights();
        game.sync();
        return true;
    };

    game.sync();
    return game;
}
