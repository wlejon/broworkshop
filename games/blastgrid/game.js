// game.js — BlastGrid core: Bomberman-style last-man-standing arena on a
// square TileWorld.
//
// The arena is the classic 15x13 lattice: a solid border wall, indestructible
// pillars on every (even,even) cell, and destructible soft blocks scattered
// over ~60% of the remaining floor (spawn corners kept clear). Soft blocks and
// walls are ordinary tiles (elevated so the arena reads in 3D); destroying a
// soft block is setTile + rebuild — chunk remesh is cheap.
//
// Passability and AI threat-awareness both ride on tile flags so the engine's
// grid search does the heavy lifting: findPath/distanceField with
// blockMask=MOVE_MASK is "physically passable", blockMask=SAFE_MASK
// additionally treats every cell in a pending blast (FLAG_DANGER) as a wall.

export const TILE = { FLOOR: 1, FLOOR2: 2, WALL: 3, PILLAR: 4, SOFT: 5, SDWALL: 6 };

export const FLAG_SOLID = 1;    // border walls, pillars, sudden-death walls
export const FLAG_SOFT = 2;     // destructible soft block
export const FLAG_BOMB = 4;     // a live bomb occupies this cell
export const FLAG_DANGER = 8;   // in some bomb's pending blast (or live fire)

export const MOVE_MASK = FLAG_SOLID | FLAG_SOFT | FLAG_BOMB;
export const SAFE_MASK = MOVE_MASK | FLAG_DANGER;

export const MAP_W = 15, MAP_H = 13;
export const CELL = 1.0;         // cellSize
export const HSTEP = 0.5;        // heightStep: walls/pillars elev 2 = 1.0 world

export const FUSE = 2.0;         // seconds from placement to blast
export const FIRE_LINGER = 0.45; // seconds the fire cross stays lethal
export const SOFT_PROB = 0.62;   // soft-block density over eligible floor
export const DROP_PROB = 0.35;   // chance a destroyed soft block hides a power-up

export const ROUND_TIME = 120;   // seconds until sudden death
export const SD_INTERVAL = 1.0;  // seconds between closing-wall drops
export const WINS_TARGET = 3;    // first to N round wins takes the match

export const BASE_RANGE = 2, MAX_RANGE = 8;
export const BASE_BOMBS = 1, MAX_BOMBS = 6;
export const BASE_SPEED = 3.0, SPEED_STEP = 0.45, MAX_SPEED = 4.8;

export const SPAWNS = [
    { x: 1, y: 1 }, { x: 13, y: 1 }, { x: 1, y: 11 }, { x: 13, y: 11 },
];

export const ROSTER = [
    { name: 'YOU', color: [0.35, 0.65, 1.0, 1], isAI: false },
    { name: 'RUBY', color: [1.0, 0.30, 0.32, 1], isAI: true },
    { name: 'IRIS', color: [0.75, 0.40, 1.0, 1], isAI: true },
    { name: 'AMBER', color: [1.0, 0.68, 0.16, 1], isAI: true },
];

export const POWER_TYPES = ['bombs', 'range', 'speed'];

const DIRVEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const AI_REACT = 0.24;           // seconds before an AI responds to new danger

export function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function createGame(scene, opts = {}) {
    const palette = new Float32Array([
        0, 0, 0, 1,                 // 0 empty
        0.34, 0.58, 0.29, 1,        // FLOOR
        0.30, 0.52, 0.26, 1,        // FLOOR2 (checker)
        0.34, 0.355, 0.44, 1,       // WALL
        0.55, 0.575, 0.66, 1,       // PILLAR
        0.80, 0.55, 0.30, 1,        // SOFT (crate)
        0.62, 0.32, 0.35, 1,        // SDWALL (sudden death)
    ]);

    const world = scene.createTileWorld({
        width: MAP_W, height: MAP_H,
        cellSize: CELL, heightStep: HSTEP, chunkSize: 8,
        baseLevel: -1, aoStrength: 0.55,
        palette,
    });

    const idx = (x, y) => y * MAP_W + x;
    const inBounds = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

    const game = {
        world,
        state: 'playing',        // 'playing' | 'roundover' | 'matchover'
        round: 1,
        time: 0,                 // game clock, seconds (runs across rounds)
        timeLeft: ROUND_TIME,
        seed: opts.seed !== undefined ? opts.seed : 0xB1A57,
        contenders: [],          // persistent entities; wins survive rounds
        bombs: [],               // { id, x, y, owner, range, fuse, exploded }
        powerups: [],            // { x, y, type }
        fire: new Map(),         // cellIdx -> lethal-until game.time
        dangerSet: new Set(),    // cellIdx in any pending blast or live fire
        dangerVersion: 0,
        sd: { active: false, timer: 0, queue: [] },   // sudden death
        winner: null,            // last round's winner entity (null = draw)
        aiFrozen: false,         // debug/test: halt AI thinking
        lastBlast: null,         // { centers, cells } — for shell FX
        // shell callbacks
        onBlast: null, onDeath: null, onPickup: null, onRoundOver: null,
        onSuddenDeath: null, onArenaReset: null, onReveal: null,
    };

    let nextId = 1;
    let nextDrops = [];          // forced power-up reveals (tests)
    let pendingOver = -1;        // game.time at which the round resolves
    let rng = mulberry32(game.seed);

    game.idx = idx;
    game.fireAt = (x, y) => game.fire.has(idx(x, y));
    game.dangerAt = (x, y) => game.dangerSet.has(idx(x, y));

    // ---- contenders -----------------------------------------------------------

    for (let i = 0; i < ROSTER.length; i++) {
        const def = ROSTER[i];
        game.contenders.push({
            i, name: def.name, color: def.color, isAI: def.isAI,
            wins: 0,
            alive: true, px: 0, py: 0, cx: 0, cy: 0, tx: 0, ty: 0,
            moving: false, facing: Math.PI, held: [],
            range: BASE_RANGE, bombCap: BASE_BOMBS, speed: BASE_SPEED,
            activeBombs: 0,
            ai: null,
        });
    }
    game.human = game.contenders[0];

    function resetEntity(e) {
        const s = SPAWNS[e.i];
        e.alive = true;
        e.px = s.x; e.py = s.y; e.cx = s.x; e.cy = s.y; e.tx = s.x; e.ty = s.y;
        e.moving = false; e.held = []; e.facing = e.i < 2 ? Math.PI : 0;
        e.range = BASE_RANGE; e.bombCap = BASE_BOMBS; e.speed = BASE_SPEED;
        e.activeBombs = 0;
        e.ai = e.isAI ? {
            path: [], fleeing: false, replanNow: false, replanTimer: 0,
            bombCd: 1.2 + rng() * 1.2, react: 0, dangerVer: -1,
        } : null;
    }

    // ---- arena ------------------------------------------------------------------

    function spawnClearSet() {
        const clear = new Set();
        for (const s of SPAWNS) {
            clear.add(idx(s.x, s.y));
            for (const [dx, dy] of DIRS) {
                const nx = s.x + dx, ny = s.y + dy;
                if (inBounds(nx, ny)) clear.add(idx(nx, ny));
            }
        }
        return clear;
    }

    function spiralOrder() {
        // Interior cells, outer ring first, clockwise from (1,1).
        const cells = [];
        let l = 1, t = 1, r = MAP_W - 2, b = MAP_H - 2;
        while (l <= r && t <= b) {
            for (let x = l; x <= r; x++) cells.push({ x, y: t });
            for (let y = t + 1; y <= b; y++) cells.push({ x: r, y });
            if (t < b) for (let x = r - 1; x >= l; x--) cells.push({ x, y: b });
            if (l < r) for (let y = b - 1; y > t; y--) cells.push({ x: l, y });
            l++; t++; r--; b--;
        }
        return cells;
    }

    function buildArena() {
        rng = mulberry32((game.seed ^ Math.imul(game.round, 0x9E3779B9)) >>> 0);
        for (let y = 0; y < MAP_H; y++) {
            for (let x = 0; x < MAP_W; x++) {
                world.setFlag(x, y, FLAG_SOLID | FLAG_SOFT | FLAG_BOMB | FLAG_DANGER, false);
                world.setTint(x, y, 1, 1, 1, 1);
                const border = x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1;
                if (border) {
                    world.setTile(x, y, TILE.WALL, 0);
                    world.setElevation(x, y, 2);
                    world.setFlag(x, y, FLAG_SOLID, true);
                } else if (x % 2 === 0 && y % 2 === 0) {
                    world.setTile(x, y, TILE.PILLAR, 0);
                    world.setElevation(x, y, 2);
                    world.setFlag(x, y, FLAG_SOLID, true);
                } else {
                    world.setTile(x, y, (x + y) % 2 ? TILE.FLOOR : TILE.FLOOR2, 0);
                    world.setElevation(x, y, 0);
                }
            }
        }
        const clear = spawnClearSet();
        for (let y = 1; y < MAP_H - 1; y++) {
            for (let x = 1; x < MAP_W - 1; x++) {
                if (x % 2 === 0 && y % 2 === 0) continue;
                if (clear.has(idx(x, y))) continue;
                if (rng() < SOFT_PROB) {
                    world.setTile(x, y, TILE.SOFT, 0);
                    world.setElevation(x, y, 1);
                    world.setFlag(x, y, FLAG_SOFT, true);
                }
            }
        }
        world.rebuild();

        game.bombs = [];
        game.powerups = [];
        game.fire.clear();
        game.dangerSet = new Set();
        game.dangerVersion++;
        game.sd = { active: false, timer: 0, queue: spiralOrder() };
        game.timeLeft = ROUND_TIME;
        pendingOver = -1;
        game.lastBlast = null;
        for (const e of game.contenders) resetEntity(e);
        if (game.onArenaReset) game.onArenaReset();
    }

    function floorId(x, y) { return (x + y) % 2 ? TILE.FLOOR : TILE.FLOOR2; }

    function destroySoft(x, y) {
        world.setTile(x, y, floorId(x, y), 0);
        world.setElevation(x, y, 0);
        world.setFlag(x, y, FLAG_SOFT, false);
    }

    // ---- danger tracking ----------------------------------------------------------

    // Predicted blast of a bomb at (x,y) with `range`, given current obstructions.
    // Fire passes over floors, stops AT the first soft block (destroying it),
    // stops at solids without entering, and stops at (but detonates) bombs.
    game.blastCells = function (x, y, range) {
        const cells = [{ x, y }], soft = [], hitBombs = [];
        for (const [dx, dy] of DIRS) {
            for (let i = 1; i <= range; i++) {
                const cx = x + dx * i, cy = y + dy * i;
                if (!inBounds(cx, cy) || world.hasFlag(cx, cy, FLAG_SOLID)) break;
                cells.push({ x: cx, y: cy });
                if (world.hasFlag(cx, cy, FLAG_SOFT)) { soft.push({ x: cx, y: cy }); break; }
                if (world.hasFlag(cx, cy, FLAG_BOMB)) { hitBombs.push({ x: cx, y: cy }); break; }
            }
        }
        return { cells, soft, hitBombs };
    };

    function recomputeDanger() {
        const next = new Set();
        for (const b of game.bombs)
            for (const c of game.blastCells(b.x, b.y, b.range).cells)
                next.add(idx(c.x, c.y));
        for (const k of game.fire.keys()) next.add(k);
        for (const k of game.dangerSet)
            if (!next.has(k)) world.setFlag(k % MAP_W, (k / MAP_W) | 0, FLAG_DANGER, false);
        for (const k of next)
            if (!game.dangerSet.has(k)) world.setFlag(k % MAP_W, (k / MAP_W) | 0, FLAG_DANGER, true);
        game.dangerSet = next;
        game.dangerVersion++;
    }

    // ---- bombs ------------------------------------------------------------------------

    game.bombAt = (x, y) => game.bombs.find(b => b.x === x && b.y === y) || null;

    game.placeBomb = function (e) {
        if (game.state !== 'playing' || !e.alive) return null;
        const x = Math.round(e.px), y = Math.round(e.py);
        if (e.activeBombs >= e.bombCap) return null;
        if (world.hasFlag(x, y, FLAG_BOMB) || game.fire.has(idx(x, y))) return null;
        const b = { id: nextId++, x, y, owner: e, range: e.range, fuse: FUSE, exploded: false };
        game.bombs.push(b);
        e.activeBombs++;
        world.setFlag(x, y, FLAG_BOMB, true);
        recomputeDanger();
        return b;
    };

    game.dropBomb = () => game.placeBomb(game.human);

    function explodeRec(b, chain) {
        if (b.exploded) return;
        b.exploded = true;
        const bi = game.bombs.indexOf(b);
        if (bi >= 0) game.bombs.splice(bi, 1);
        world.setFlag(b.x, b.y, FLAG_BOMB, false);
        b.owner.activeBombs = Math.max(0, b.owner.activeBombs - 1);
        const r = game.blastCells(b.x, b.y, b.range);
        chain.centers.push({ x: b.x, y: b.y });
        for (const c of r.cells) chain.cells.add(idx(c.x, c.y));
        for (const s of r.soft) { destroySoft(s.x, s.y); chain.soft.push(s); }
        for (const hc of r.hitBombs) {
            const ob = game.bombAt(hc.x, hc.y);
            if (ob) explodeRec(ob, chain);       // chain reaction: immediate
        }
    }

    function detonate(b) {
        const chain = { cells: new Set(), soft: [], centers: [] };
        explodeRec(b, chain);
        // Loose power-ups caught in the fire burn up (before new reveals appear).
        game.powerups = game.powerups.filter(p => !chain.cells.has(idx(p.x, p.y)));
        // Reveals under destroyed soft blocks.
        for (const s of chain.soft) {
            let type = null;
            if (nextDrops.length) type = nextDrops.shift();
            else if (rng() < DROP_PROB) {
                const r = rng();
                type = r < 0.4 ? 'bombs' : r < 0.8 ? 'range' : 'speed';
            }
            if (type) {
                game.powerups.push({ x: s.x, y: s.y, type });
                if (game.onReveal) game.onReveal(s.x, s.y, type);
            }
        }
        for (const k of chain.cells) game.fire.set(k, game.time + FIRE_LINGER);
        world.rebuild();
        recomputeDanger();
        game.lastBlast = {
            centers: chain.centers,
            cells: [...chain.cells].map(k => ({ x: k % MAP_W, y: (k / MAP_W) | 0 })),
        };
        if (game.onBlast) game.onBlast(game.lastBlast);
        killCheck();
    }

    // ---- movement -----------------------------------------------------------------------

    // ENGINE BUG WORKAROUND: TileWorld.isWalkable(x, y, blockMask) tests the
    // mask with hasFlag() ALL-bits semantics (src/scene/tile_world.cpp:484),
    // so a multi-bit mask only blocks cells carrying EVERY bit — while
    // findPath/distanceField use the documented ANY-bit test
    // (src/tile/pathfind.cpp:113). Until that's fixed, test one bit at a time.
    game.canEnter = (x, y) => inBounds(x, y)
        && !world.hasFlag(x, y, FLAG_SOLID)
        && !world.hasFlag(x, y, FLAG_SOFT)
        && !world.hasFlag(x, y, FLAG_BOMB);

    game.pressDir = function (name) {
        const e = game.human;
        e.held = e.held.filter(d => d !== name);
        e.held.push(name);
    };
    game.releaseDir = function (name) {
        const e = game.human;
        e.held = e.held.filter(d => d !== name);
    };

    function pickDir(e) {
        if (!e.isAI) {
            // Latest-pressed passable direction wins: hold a direction and you
            // glide around corners the moment the side corridor opens.
            for (let i = e.held.length - 1; i >= 0; i--) {
                const d = DIRVEC[e.held[i]];
                if (game.canEnter(e.cx + d[0], e.cy + d[1])) return d;
            }
            return null;
        }
        const p = e.ai.path;
        while (p.length && p[0].x === e.cx && p[0].y === e.cy) p.shift();
        if (!p.length) return null;
        const n = p[0];
        if (Math.abs(n.x - e.cx) + Math.abs(n.y - e.cy) !== 1 || !game.canEnter(n.x, n.y)) {
            p.length = 0; e.ai.replanNow = true; return null;
        }
        // Never walk INTO danger unless already in it (fleeing crosses danger).
        if (!e.ai.fleeing && game.dangerSet.has(idx(n.x, n.y))
            && !game.dangerSet.has(idx(e.cx, e.cy))) {
            p.length = 0; e.ai.replanNow = true; return null;
        }
        return [n.x - e.cx, n.y - e.cy];
    }

    function onCellEnter(e) {
        for (let i = 0; i < game.powerups.length; i++) {
            const p = game.powerups[i];
            if (p.x !== e.cx || p.y !== e.cy) continue;
            game.powerups.splice(i, 1);
            if (p.type === 'bombs') e.bombCap = Math.min(MAX_BOMBS, e.bombCap + 1);
            else if (p.type === 'range') e.range = Math.min(MAX_RANGE, e.range + 1);
            else if (p.type === 'speed') e.speed = Math.min(MAX_SPEED, e.speed + SPEED_STEP);
            if (game.onPickup) game.onPickup(e, p.type);
            break;
        }
    }

    function updateMover(e, dt) {
        let rem = e.speed * dt;
        let guard = 8;
        while (rem > 1e-6 && guard-- > 0) {
            if (!e.moving) {
                const d = pickDir(e);
                if (!d) { e.px = e.cx; e.py = e.cy; break; }
                e.tx = e.cx + d[0]; e.ty = e.cy + d[1];
                e.moving = true;
                e.facing = Math.atan2(d[0], d[1]);
            }
            const dx = e.tx - e.px, dy = e.ty - e.py;
            const dist = Math.hypot(dx, dy);
            if (dist <= rem) {
                e.px = e.tx; e.py = e.ty; e.cx = e.tx; e.cy = e.ty;
                e.moving = false;
                rem -= dist;
                onCellEnter(e);
                if (e.isAI && e.ai.path.length && e.ai.path[0].x === e.cx && e.ai.path[0].y === e.cy)
                    e.ai.path.shift();
            } else {
                e.px += dx / dist * rem;
                e.py += dy / dist * rem;
                rem = 0;
            }
        }
    }

    // ---- AI --------------------------------------------------------------------------------

    function adjacentSoftCount(x, y) {
        let n = 0;
        for (const [dx, dy] of DIRS)
            if (inBounds(x + dx, y + dy) && world.hasFlag(x + dx, y + dy, FLAG_SOFT)) n++;
        return n;
    }

    // distanceField with the entity's own cell temporarily un-bombed, so an AI
    // standing on its own fresh bomb can still see escape routes (the source
    // cell would otherwise be impassable and the whole field unreachable).
    function fieldFrom(e, mask) {
        const onBomb = world.hasFlag(e.cx, e.cy, FLAG_BOMB);
        if (onBomb) world.setFlag(e.cx, e.cy, FLAG_BOMB, false);
        const f = world.distanceField([{ x: e.cx, y: e.cy }], { blockMask: mask });
        if (onBomb) world.setFlag(e.cx, e.cy, FLAG_BOMB, true);
        return f;
    }

    function pathTo(e, x, y, mask) {
        const onBomb = world.hasFlag(e.cx, e.cy, FLAG_BOMB);
        if (onBomb) world.setFlag(e.cx, e.cy, FLAG_BOMB, false);
        const p = world.findPath(e.cx, e.cy, x, y, { blockMask: mask });
        if (onBomb) world.setFlag(e.cx, e.cy, FLAG_BOMB, true);
        if (p.length && p[0].x === e.cx && p[0].y === e.cy) p.shift();
        return p;
    }

    function flee(e) {
        const field = fieldFrom(e, MOVE_MASK);
        let best = -1, bx = -1, by = -1;
        for (let k = 0; k < field.length; k++) {
            const d = field[k];
            if (d < 0 || d > 14 || game.dangerSet.has(k)) continue;
            const score = d + rng() * 0.25;
            if (best < 0 || score < best) { best = score; bx = k % MAP_W; by = (k / MAP_W) | 0; }
        }
        if (bx < 0) { e.ai.path = []; return; }             // boxed in — doomed
        // Prefer a route that stays out of OTHER danger; fall back to raw.
        let p = pathTo(e, bx, by, SAFE_MASK);
        if (!p.length) p = pathTo(e, bx, by, MOVE_MASK);
        e.ai.path = p;
        e.ai.fleeing = true;
    }

    function canEscapeAfterBomb(e) {
        const sim = new Set(game.blastCells(e.cx, e.cy, e.range).cells.map(c => idx(c.x, c.y)));
        const field = fieldFrom(e, MOVE_MASK);
        const maxSteps = Math.max(3, Math.floor(e.speed * FUSE) - 1);
        for (let k = 0; k < field.length; k++) {
            const d = field[k];
            if (d >= 0 && d <= maxSteps && !sim.has(k) && !game.dangerSet.has(k)) return true;
        }
        return false;
    }

    function shouldBomb(e) {
        if (adjacentSoftCount(e.cx, e.cy) > 0) return true;
        for (const o of game.contenders) {
            if (o === e || !o.alive) continue;
            if (Math.abs(o.cx - e.cx) + Math.abs(o.cy - e.cy) <= 2) return true;
            // Enemy on the same open row/column within blast reach.
            if (o.cx === e.cx || o.cy === e.cy) {
                const hit = game.blastCells(e.cx, e.cy, e.range).cells
                    .some(c => c.x === o.cx && c.y === o.cy);
                if (hit) return true;
            }
        }
        return false;
    }

    function softRemaining() {
        let n = 0;
        for (let y = 1; y < MAP_H - 1; y++)
            for (let x = 1; x < MAP_W - 1; x++)
                if (world.hasFlag(x, y, FLAG_SOFT)) n++;
        return n;
    }

    function goal(e) {
        const field = fieldFrom(e, SAFE_MASK);
        // 1. nearest reachable power-up
        let pu = null, puD = 1e9;
        for (const p of game.powerups) {
            const d = field[idx(p.x, p.y)];
            if (d >= 0 && d < puD) { puD = d; pu = p; }
        }
        if (pu && puD <= 12) { e.ai.path = pathTo(e, pu.x, pu.y, SAFE_MASK); return; }
        // 2. approach: a cell adjacent to a soft block, or (sometimes) a cell
        //    adjacent to a living opponent — that's where bombs get dropped.
        //    The fewer crates remain, the more the AI hunts.
        const hunt = rng() < 0.25 + 0.55 * (1 - Math.min(1, softRemaining() / 50));
        let bx = -1, by = -1, best = 1e9;
        for (let k = 0; k < field.length; k++) {
            const d = field[k];
            if (d <= 0 || d > 18) continue;
            const x = k % MAP_W, y = (k / MAP_W) | 0;
            let want = adjacentSoftCount(x, y) > 0;
            if (!want && hunt) {
                for (const o of game.contenders) {
                    if (o === e || !o.alive) continue;
                    if (Math.abs(o.cx - x) + Math.abs(o.cy - y) === 1) { want = true; break; }
                }
            }
            if (!want) continue;
            const score = d + rng() * 2.5;
            if (score < best) { best = score; bx = x; by = y; }
        }
        if (bx >= 0) { e.ai.path = pathTo(e, bx, by, SAFE_MASK); return; }
        // 3. wander anywhere safe nearby
        let wx = -1, wy = -1, wBest = 1e9;
        for (let k = 0; k < field.length; k++) {
            const d = field[k];
            if (d <= 0 || d > 6) continue;
            const score = rng() * 10 - d;
            if (score < wBest) { wBest = score; wx = k % MAP_W; wy = (k / MAP_W) | 0; }
        }
        e.ai.path = wx >= 0 ? pathTo(e, wx, wy, SAFE_MASK) : [];
    }

    function plan(e) {
        const ai = e.ai;
        ai.replanNow = false;
        ai.fleeing = false;
        ai.replanTimer = 0.5 + rng() * 0.4;
        if (game.dangerSet.has(idx(e.cx, e.cy))) { flee(e); return; }
        if (ai.bombCd <= 0 && shouldBomb(e) && canEscapeAfterBomb(e)) {
            if (game.placeBomb(e)) {
                ai.bombCd = 1.5 + rng() * 1.3;
                flee(e);                          // danger now includes own bomb
                return;
            }
        }
        goal(e);
    }

    function aiThink(e, dt) {
        const ai = e.ai;
        ai.bombCd = Math.max(0, ai.bombCd - dt);
        ai.replanTimer -= dt;
        if (ai.dangerVer !== game.dangerVersion) {
            ai.dangerVer = game.dangerVersion;
            ai.replanNow = true;
            // Human-ish hesitation before reacting to danger that isn't ours.
            if (game.dangerSet.has(idx(e.cx, e.cy)) && !ai.fleeing) ai.react = AI_REACT;
        }
        if (ai.react > 0) { ai.react -= dt; if (ai.react > 0) return; }
        if (!e.moving && (ai.replanNow || !ai.path.length || ai.replanTimer <= 0)) plan(e);
    }

    // ---- death / rounds ---------------------------------------------------------------------

    function kill(e) {
        if (!e.alive) return;
        e.alive = false;
        e.held = [];
        if (e.ai) e.ai.path = [];
        if (game.onDeath) game.onDeath(e);
    }
    game.kill = kill;

    function killCheck() {
        for (const e of game.contenders) {
            if (!e.alive) continue;
            if (game.fire.has(idx(Math.round(e.px), Math.round(e.py)))) kill(e);
        }
    }

    function sdStep() {
        const q = game.sd.queue;
        while (q.length) {
            const c = q.shift();
            if (world.hasFlag(c.x, c.y, FLAG_SOLID)) continue;   // pillar already there
            for (const e of game.contenders)
                if (e.alive && Math.round(e.px) === c.x && Math.round(e.py) === c.y) kill(e);
            const b = game.bombAt(c.x, c.y);
            if (b) {
                game.bombs.splice(game.bombs.indexOf(b), 1);
                b.owner.activeBombs = Math.max(0, b.owner.activeBombs - 1);
            }
            game.powerups = game.powerups.filter(p => p.x !== c.x || p.y !== c.y);
            game.fire.delete(idx(c.x, c.y));
            world.setTile(c.x, c.y, TILE.SDWALL, 0);
            world.setElevation(c.x, c.y, 2);
            world.setFlag(c.x, c.y, FLAG_SOFT | FLAG_BOMB, false);
            world.setFlag(c.x, c.y, FLAG_SOLID, true);
            world.rebuild();
            recomputeDanger();
            return;
        }
    }

    game.nextSdCell = function () {
        for (const c of game.sd.queue)
            if (!world.hasFlag(c.x, c.y, FLAG_SOLID)) return c;
        return null;
    };

    // ---- main update -----------------------------------------------------------------------

    game.update = function (dt) {
        if (game.state !== 'playing') return;
        game.time += dt;

        // round clock -> sudden death
        if (!game.sd.active) {
            game.timeLeft = Math.max(0, game.timeLeft - dt);
            if (game.timeLeft <= 0) {
                game.sd.active = true;
                game.sd.timer = 0.5;
                if (game.onSuddenDeath) game.onSuddenDeath();
            }
        } else {
            game.sd.timer -= dt;
            while (game.sd.timer <= 0 && game.sd.queue.length) {
                sdStep();
                game.sd.timer += SD_INTERVAL;
            }
        }

        // bomb fuses (detonate mutates game.bombs — snapshot first)
        for (const b of [...game.bombs]) {
            b.fuse -= dt;
            if (b.fuse <= 0 && !b.exploded) detonate(b);
        }

        // fire burn-out
        let expired = false;
        for (const [k, until] of game.fire)
            if (game.time >= until) { game.fire.delete(k); expired = true; }
        if (expired) recomputeDanger();

        // entities
        for (const e of game.contenders) {
            if (!e.alive) continue;
            if (e.isAI && !game.aiFrozen) aiThink(e, dt);
            updateMover(e, dt);
        }
        killCheck();

        // round resolution (small delay so the killing fire reads on screen)
        const alive = game.contenders.filter(e => e.alive);
        if (alive.length <= 1 && pendingOver < 0) pendingOver = game.time + 0.9;
        if (pendingOver >= 0 && game.time >= pendingOver) {
            game.winner = alive[0] || null;
            if (game.winner) game.winner.wins++;
            game.state = (game.winner && game.winner.wins >= WINS_TARGET)
                ? 'matchover' : 'roundover';
            if (game.onRoundOver) game.onRoundOver(game.winner, game.state === 'matchover');
        }
    };

    // Advance past a round-over / match-over screen.
    game.proceed = function () {
        if (game.state === 'roundover') {
            game.round++;
            buildArena();
            game.state = 'playing';
            return true;
        }
        if (game.state === 'matchover') {
            for (const e of game.contenders) e.wins = 0;
            game.round = 1;
            buildArena();
            game.state = 'playing';
            return true;
        }
        return false;
    };

    // ---- debug / test surface -----------------------------------------------------------------

    game.debug = {
        freezeAI(on) {
            game.aiFrozen = !!on;
            if (game.aiFrozen)
                for (const e of game.contenders)
                    if (e.ai) e.ai.path = [];
        },
        setNextDrop(type) { nextDrops.push(type); },
        setTimeLeft(s) { game.timeLeft = s; },
        kill(i) { kill(game.contenders[i]); },
        teleport(i, x, y) {
            const e = game.contenders[i];
            e.px = x; e.py = y; e.cx = x; e.cy = y; e.tx = x; e.ty = y;
            e.moving = false; e.held = [];
            if (e.ai) { e.ai.path = []; e.ai.replanNow = true; }
        },
        clearArea(x0, y0, x1, y1) {           // strip soft blocks from a rect
            for (let y = y0; y <= y1; y++)
                for (let x = x0; x <= x1; x++)
                    if (inBounds(x, y) && world.hasFlag(x, y, FLAG_SOFT)) destroySoft(x, y);
            world.rebuild();
            recomputeDanger();
        },
        setSoft(x, y) {
            world.setTile(x, y, TILE.SOFT, 0);
            world.setElevation(x, y, 1);
            world.setFlag(x, y, FLAG_SOFT, true);
            world.rebuild();
            recomputeDanger();
        },
        spawnBomb(x, y, range, opts = {}) {
            const owner = game.contenders[opts.owner !== undefined ? opts.owner : 3];
            const b = {
                id: nextId++, x, y, owner,
                range, fuse: opts.fuse !== undefined ? opts.fuse : FUSE, exploded: false,
            };
            game.bombs.push(b);
            owner.activeBombs++;
            world.setFlag(x, y, FLAG_BOMB, true);
            recomputeDanger();
            return b;
        },
        setWins(i, n) { game.contenders[i].wins = n; },
    };

    buildArena();
    return game;
}
