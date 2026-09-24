// HexFront rules — the map, units, movement, combat, turns and the blue AI.
// No scene nodes, DOM or audio: the grid queries (tiles, elevation, flags,
// findPath, distanceField, cellDistance) go to the TileWorld passed in,
// which board.js builds and draws.
//
// createBattle(world) places both armies on an authored map (authorMap).
// Events on battle.events: combat {attacker, defender, damage,
// counterDamage, killed, counterKilled} · gameover {winner}.

export const TILE = { GRASS: 1, FOREST: 2, HILL: 3, MOUNTAIN: 4, WATER: 5 };
export const FLAG_WATER = 1;   // impassable terrain
export const FLAG_UNIT = 2;    // transient: cell occupied (set only around findPath calls)

export const MAP_W = 13, MAP_H = 11;

// Per-tile-id data, indexed by TILE id (0 = empty, unused).
export const MOVE_COST = [1, 1, 2, 2, 3, 1];       // step cost entering the cell
export const DEF_BONUS = [0, 0, 1, 1, 2, 0];       // flat damage reduction on defender
export const TILE_ELEV = [0, 0, 0, 1, 2, -1];      // authored elevation per terrain
const TILE_NAME = ["?", "Grass", "Forest", "Hill", "Mountain", "Water"];

export const UNIT_TYPES = {
    infantry:  { name: "Infantry",  hp: 10, atk: 4, move: 3, rangeMin: 1, rangeMax: 1, canCounter: true },
    tank:      { name: "Tank",      hp: 14, atk: 6, move: 4, rangeMin: 1, rangeMax: 1, canCounter: true },
    artillery: { name: "Artillery", hp: 8,  atk: 6, move: 2, rangeMin: 2, rangeMax: 3, canCounter: false },
};

// Hand-authored 13x11 map. g grass, f forest, h hill, m mountain, w water.
// A river snakes down the middle with open crossings north and south plus a
// narrow eastern inlet — two chokepoints worth fighting over.
export const MAP_ROWS = [
    "gggffgggghhgg",
    "gfffggggggmhg",
    "ggfgggwwgghhg",
    "gggggwwwggggg",
    "hggggwwggffgg",
    "ghggggwgggfgg",
    "ghggfgwwggggg",
    "ggggfggwwgggh",
    "gmhggggwwgghh",
    "ghhggggggggfg",
    "ggggffggggffg",
];
const CHAR_TILE = { g: TILE.GRASS, f: TILE.FOREST, h: TILE.HILL, m: TILE.MOUNTAIN, w: TILE.WATER };

const START_UNITS = [
    { side: "red",  type: "infantry",  x: 1,  y: 3 },
    { side: "red",  type: "infantry",  x: 1,  y: 7 },
    { side: "red",  type: "tank",      x: 2,  y: 5 },
    { side: "red",  type: "artillery", x: 0,  y: 5 },
    { side: "blue", type: "infantry",  x: 11, y: 3 },
    { side: "blue", type: "infantry",  x: 11, y: 7 },
    { side: "blue", type: "tank",      x: 10, y: 5 },
    { side: "blue", type: "artillery", x: 12, y: 5 },
];

// Odd-r offset hex neighbours (pointy-top, matches TileWorld's hex layout).
const HEX_EVEN = [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]];
const HEX_ODD  = [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]];
export function hexNeighbors(x, y) {
    return ((y & 1) ? HEX_ODD : HEX_EVEN).map(([dx, dy]) => [x + dx, y + dy]);
}

/** Write the map's tiles, elevations and water flags into the grid. */
export function authorMap(world) {
    for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
            const id = CHAR_TILE[MAP_ROWS[y][x]];
            world.setTile(x, y, id, 0);
            world.setElevation(x, y, TILE_ELEV[id]);
            world.setFlag(x, y, FLAG_WATER, id === TILE.WATER);
        }
    }
}

export function createBattle(world) {
    let id = 1;
    return {
        world,
        units: START_UNITS.map((s) => ({ id: id++, side: s.side, type: s.type, x: s.x, y: s.y, hp: UNIT_TYPES[s.type].hp, acted: false, alive: true })),
        turn: { number: 1, side: "red", over: false, winner: null },
        events: [],
    };
}

// ── Queries ──────────────────────────────────────────────────────────────

export const aliveUnits = (b, side) => b.units.filter((u) => u.alive && (!side || u.side === side));
export const unitAt = (b, x, y) => b.units.find((u) => u.alive && u.x === x && u.y === y) || null;
export const tileName = (b, x, y) => TILE_NAME[b.world.getTile(x, y, 0)] || "?";
export const isPassable = (b, x, y) =>
    x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && !b.world.hasFlag(x, y, FLAG_WATER);

/**
 * Cells a unit can reach this turn: Dijkstra over hex neighbours with
 * terrain costs; other units block passing and stopping. Map "x,y" ->
 * { x, y, cost }, the start included at cost 0.
 */
export function reachable(b, unit) {
    const budget = UNIT_TYPES[unit.type].move;
    const dist = new Map([[unit.x + "," + unit.y, { x: unit.x, y: unit.y, cost: 0 }]]);
    const frontier = [[0, unit.x, unit.y]];
    while (frontier.length) {
        let bi = 0;
        for (let i = 1; i < frontier.length; i++) if (frontier[i][0] < frontier[bi][0]) bi = i;
        const [c, x, y] = frontier.splice(bi, 1)[0];
        const cur = dist.get(x + "," + y);
        if (cur && cur.cost < c) continue;
        for (const [nx, ny] of hexNeighbors(x, y)) {
            if (!isPassable(b, nx, ny)) continue;
            const occ = unitAt(b, nx, ny);
            if (occ && occ !== unit) continue;
            const nc = c + MOVE_COST[b.world.getTile(nx, ny, 0)];
            if (nc > budget) continue;
            const key = nx + "," + ny;
            const prev = dist.get(key);
            if (!prev || nc < prev.cost) {
                dist.set(key, { x: nx, y: ny, cost: nc });
                frontier.push([nc, nx, ny]);
            }
        }
    }
    return dist;
}

/** The engine's A* route (terrain costs, around water and other units): [{x, y}, ...]. */
export function routeTo(b, unit, tx, ty) {
    const w = b.world;
    const others = aliveUnits(b).filter((u) => u !== unit);
    for (const u of others) w.setFlag(u.x, u.y, FLAG_UNIT, true);
    try {
        return w.findPath(unit.x, unit.y, tx, ty, { blockMask: FLAG_WATER | FLAG_UNIT, costs: MOVE_COST });
    } finally {
        for (const u of others) w.setFlag(u.x, u.y, FLAG_UNIT, false);
    }
}

// ── Combat ───────────────────────────────────────────────────────────────

/**
 * Wounded units hit softer; terrain shields the defender; attacking from
 * higher ground lands 25% harder. No dice, so battles replay exactly.
 */
export function computeDamage(b, att, def) {
    const t = UNIT_TYPES[att.type];
    let dmg = t.atk * (0.5 + 0.5 * att.hp / t.hp);
    dmg -= DEF_BONUS[b.world.getTile(def.x, def.y, 0)];
    if (b.world.getElevation(att.x, att.y) > b.world.getElevation(def.x, def.y)) dmg *= 1.25;
    return Math.max(1, Math.round(dmg));
}

export function inAttackRange(b, unit, fromX, fromY, target) {
    const t = UNIT_TYPES[unit.type];
    const d = b.world.cellDistance(fromX, fromY, target.x, target.y);
    return d >= t.rangeMin && d <= t.rangeMax;
}

export function attackTargets(b, unit, fromX = unit.x, fromY = unit.y) {
    return aliveUnits(b, unit.side === "red" ? "blue" : "red").filter((e) => inAttackRange(b, unit, fromX, fromY, e));
}

/** Strike, and a survivor in range that can counter hits back. */
export function attack(b, att, def) {
    const damage = computeDamage(b, att, def);
    def.hp -= damage;
    let counterDamage = 0, killed = false, counterKilled = false;
    if (def.hp <= 0) {
        def.hp = 0; def.alive = false; killed = true;
    } else if (UNIT_TYPES[def.type].canCounter && inAttackRange(b, def, def.x, def.y, att)) {
        counterDamage = computeDamage(b, def, att);
        att.hp -= counterDamage;
        if (att.hp <= 0) { att.hp = 0; att.alive = false; counterKilled = true; }
    }
    const info = { type: "combat", attacker: att, defender: def, damage, counterDamage, killed, counterKilled };
    b.events.push(info);
    checkVictory(b);
    return info;
}

function checkVictory(b) {
    if (b.turn.over) return;
    const red = aliveUnits(b, "red").length, blue = aliveUnits(b, "blue").length;
    if (red && blue) return;
    b.turn.over = true;
    b.turn.winner = red ? "red" : "blue";
    b.events.push({ type: "gameover", winner: b.turn.winner });
}

// ── Turns ────────────────────────────────────────────────────────────────

export function beginBlueTurn(b) {
    b.turn.side = "blue";
    for (const u of aliveUnits(b, "blue")) u.acted = false;
}

export function beginRedTurn(b) {
    b.turn.side = "red";
    b.turn.number++;
    for (const u of aliveUnits(b, "red")) u.acted = false;
}

/** Score for a red win: 1000, 10 less per turn taken. */
export const victoryScore = (b) => Math.max(1, 1000 - b.turn.number * 10);

// ── AI: one blue unit's whole action, applied at once ────────────────────
//
// Guidance is the engine distanceField from every red unit (water-blocked);
// the unit takes the reachable cell that best closes in — any cell it can
// fire from wins outright — then attacks the weakest target in range.
export function aiAct(b, unit) {
    const enemies = aliveUnits(b, "red");
    const action = { unit, moved: false, combat: null };
    if (!enemies.length || !unit.alive) { unit.acted = true; return action; }

    let targets = attackTargets(b, unit);
    if (!targets.length) {
        const field = b.world.distanceField(enemies.map((e) => ({ x: e.x, y: e.y })), { blockMask: FLAG_WATER });
        let best = null, bestScore = Infinity;
        for (const cell of reachable(b, unit).values()) {
            if (unitAt(b, cell.x, cell.y) && !(cell.x === unit.x && cell.y === unit.y)) continue;
            const canShoot = enemies.some((e) => inAttackRange(b, unit, cell.x, cell.y, e));
            const f = field[cell.y * MAP_W + cell.x];
            const score = (canShoot ? -1000 : (f >= 0 ? f : 999) * 10) + cell.cost * 0.1;
            if (score < bestScore) { bestScore = score; best = cell; }
        }
        if (best && (best.x !== unit.x || best.y !== unit.y) && routeTo(b, unit, best.x, best.y).length) {
            unit.x = best.x;
            unit.y = best.y;
            action.moved = true;
        }
        targets = attackTargets(b, unit);
    }
    if (targets.length) {
        const target = targets.reduce((a, e) => (e.hp < a.hp ? e : a));
        action.combat = attack(b, unit, target);
    }
    unit.acted = true;
    return action;
}

// ── Save / load (the map is fixed, so units and the turn are the game) ────

export function snapshot(b) {
    return { version: 2, turn: Object.assign({}, b.turn), units: b.units.map((u) => Object.assign({}, u)) };
}

export function restore(b, data) {
    if (!data || data.version !== 2) return false;
    Object.assign(b.turn, data.turn);
    b.units = data.units.map((u) => Object.assign({}, u));
    return true;
}

export function drainEvents(b) {
    const out = b.events;
    b.events = [];
    return out;
}
