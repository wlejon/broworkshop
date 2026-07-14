// game.js — BlastGrid domain + arcade plugin.
// Domain: Bomberman-style last-man-standing on a square TileWorld (createGame).
// Plugin: scene/camera/render sync/HUD — shell owns menus.
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

// ============================================================================
// Arcade plugin — 3D scene on #view; shell owns title/howto/pause/gameover.
// ============================================================================

/** @type {HTMLCanvasElement|null} */
let viewCanvas = null;
/** @type {object|null} */
let scene = null;
/** @type {object|null} */
let core = null;
/** @type {object|null} */
let flashLight = null;
let flashT = 0;
const FLASH_DUR = 0.28;
let applied = new Map();
let chipEls = [];
let chipsBuilt = false;
let wiredHud = false;
let toastTimer = 0;

const PU_KIND = {};
const K = {};

function el(id) {
    return document.getElementById(id);
}

function ensureScene() {
    if (scene) return;
    viewCanvas = document.getElementById("view") || document.querySelector("canvas");
    if (!viewCanvas) throw new Error("blastgrid: #view canvas missing");
    scene = viewCanvas.getContext("scene");
    if (!scene) throw new Error("blastgrid: scene context unavailable");

    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.floor(window.innerWidth * dpr);
        const h = Math.floor(window.innerHeight * dpr);
        if (viewCanvas.width !== w) viewCanvas.width = w;
        if (viewCanvas.height !== h) viewCanvas.height = h;
        frameCamera();
    }
    window.addEventListener("resize", resizeCanvas);

    scene.setToneMap({ mode: "aces", exposure: 1.0, gamma: 2.2 });
    scene.setAmbient([0.22, 0.23, 0.27]);
    scene.createLight({
        type: "directional",
        direction: [-0.45, -1.0, -0.35],
        color: [1.0, 0.96, 0.88],
        intensity: 2.0,
    });
    flashLight = scene.createLight({
        type: "point", position: [0, 1.4, 0],
        color: [1.0, 0.72, 0.38], intensity: 0, range: 7,
    });
    resizeCanvas();
}

function ensureCore() {
    ensureScene();
    if (core) return core;
    core = createGame(scene);
    registerObjectKinds();
    wireCoreCallbacks();
    buildChips();
    frameCamera();
    return core;
}

function registerObjectKinds() {
    const world = core.world;
    K.bomber = world.addObjectKind(
        Mesh.merge([
            Mesh.sphere(0.26, 14, 10).translate(0, 0.30, 0),
            Mesh.sphere(0.16, 12, 8).translate(0, 0.60, 0),
            Mesh.box(0.05, 0.05, 0.05).translate(0, 0.60, 0.16),
            Mesh.box(0.09, 0.06, 0.13).translate(-0.11, 0.05, 0),
            Mesh.box(0.09, 0.06, 0.13).translate(0.11, 0.05, 0),
        ]),
        { color: [1, 1, 1, 1], roughness: 0.75 });
    K.bomb = world.addObjectKind(
        Mesh.merge([
            Mesh.sphere(0.235, 14, 10).translate(0, 0.24, 0),
            Mesh.cylinder(0.045, 0.10, 6).translate(0, 0.50, 0),
        ]),
        { color: [1, 1, 1, 1], roughness: 0.45, metallic: 0.25 });
    K.fire = world.addObjectKind(
        Mesh.merge([
            Mesh.cone(0.32, 0.62, 8, 1, false).translate(0, 0.02, 0),
            Mesh.sphere(0.20, 10, 7).translate(0, 0.14, 0),
        ]),
        { color: [1.0, 0.52, 0.10, 1], roughness: 0.35, castsShadow: false });
    K.pBombs = world.addObjectKind(
        Mesh.merge([
            Mesh.sphere(0.16, 12, 8).translate(0, 0.16, 0),
            Mesh.cylinder(0.035, 0.08, 6).translate(0, 0.36, 0),
        ]),
        { color: [0.30, 0.55, 1.0, 1], roughness: 0.4, metallic: 0.2 });
    K.pRange = world.addObjectKind(
        Mesh.cone(0.17, 0.36, 8, 1, false).translate(0, 0.04, 0),
        { color: [1.0, 0.45, 0.10, 1], roughness: 0.4 });
    K.pSpeed = world.addObjectKind(
        Mesh.torus(0.15, 0.055, 14, 8).rotate(1, 0, 0, Math.PI / 2).translate(0, 0.20, 0),
        { color: [0.15, 0.95, 0.85, 1], roughness: 0.35, metallic: 0.3 });
    PU_KIND.bombs = K.pBombs;
    PU_KIND.range = K.pRange;
    PU_KIND.speed = K.pSpeed;
    world.rebuildObjects();
}

function frameCamera() {
    if (!core || !scene || !viewCanvas) return;
    const world = core.world;
    const b = world.worldBounds();
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const rect = viewCanvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    const fovDeg = 42, fov = fovDeg * Math.PI / 180;
    const spanX = b.maxX - b.minX, spanZ = b.maxZ - b.minZ;
    const distV = (spanZ * 0.60 + 1.8) / Math.tan(fov / 2);
    const distH = (spanX * 0.54 + 1.2) / (Math.tan(fov / 2) * aspect);
    const dist = Math.max(distV, distH);
    const pitch = 58 * Math.PI / 180;
    scene.setCamera({
        fov: fovDeg, aspect, near: 0.1, far: 200,
        position: [cx, Math.sin(pitch) * dist, cz + Math.cos(pitch) * dist],
        target: [cx, 0, cz - 0.4],
    });
}

function desiredTints() {
    const want = new Map();
    const put = (x, y, rgb) => {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
        want.set(x + "," + y, rgb);
    };
    for (const k of core.dangerSet)
        put(k % MAP_W, (k / MAP_W) | 0, [1.18, 0.94, 0.88]);
    for (const [k, until] of core.fire) {
        const t = Math.round(Math.max(0, Math.min(1, (until - core.time) / FIRE_LINGER)) * 5) / 5;
        put(k % MAP_W, (k / MAP_W) | 0, [1 + 1.25 * t, 1 + 0.32 * t, 1 - 0.55 * t]);
    }
    if (core.sd.active) {
        const n = core.nextSdCell();
        if (n && Math.floor(core.time * 4) % 2 === 0) put(n.x, n.y, [1.9, 0.5, 0.5]);
    }
    return want;
}

function applyTints() {
    const world = core.world;
    const want = desiredTints();
    let dirty = false;
    for (const key of applied.keys()) {
        if (!want.has(key)) {
            const [x, y] = key.split(",").map(Number);
            world.setTint(x, y, 1, 1, 1, 1);
            applied.delete(key);
            dirty = true;
        }
    }
    for (const [key, rgb] of want) {
        const cur = applied.get(key);
        if (cur && cur[0] === rgb[0] && cur[1] === rgb[1] && cur[2] === rgb[2]) continue;
        const [x, y] = key.split(",").map(Number);
        world.setTint(x, y, rgb[0], rgb[1], rgb[2], 1);
        applied.set(key, rgb);
        dirty = true;
    }
    if (dirty) world.rebuild();
}

function syncRender() {
    const world = core.world;
    world.clearObjects(K.bomber);
    for (const e of core.contenders) {
        if (!e.alive) continue;
        const cx = Math.round(e.px), cy = Math.round(e.py);
        const bob = e.moving ? Math.abs(Math.sin(core.time * 11 + e.i)) * 0.05 : 0;
        world.addObject(K.bomber, cx, cy, {
            yaw: e.facing,
            offsetX: e.px - cx, offsetZ: e.py - cy,
            yOffset: bob,
            color: e.color,
        });
    }

    world.clearObjects(K.bomb);
    for (const b of core.bombs) {
        const t = 1 - Math.max(0, b.fuse) / FUSE;
        const pulse = 1 + 0.08 * Math.sin(core.time * (6 + t * 14));
        const red = Math.max(0, (t - 0.55) / 0.45);
        world.addObject(K.bomb, b.x, b.y, {
            scale: pulse,
            color: [0.14 + 0.9 * red, 0.14, 0.17, 1],
        });
    }

    world.clearObjects(K.fire);
    for (const [k, until] of core.fire) {
        const x = k % MAP_W, y = (k / MAP_W) | 0;
        const t = Math.max(0, Math.min(1, (until - core.time) / FIRE_LINGER));
        const jig = 1 + 0.10 * Math.sin(core.time * 40 + x * 3.1 + y * 7.3);
        world.addObject(K.fire, x, y, {
            scale: (0.35 + 0.95 * t) * jig,
            yaw: (x * 5 + y * 11) % 6.28,
            color: [1, 0.65 + 0.35 * t, 0.35 * t, 1],
        });
    }

    for (const kn of POWER_TYPES) world.clearObjects(PU_KIND[kn]);
    for (const p of core.powerups) {
        world.addObject(PU_KIND[p.type], p.x, p.y, {
            yaw: core.time * 2.6,
            scale: 1.35,
            yOffset: 0.10 + Math.sin(core.time * 3.0 + p.x + p.y) * 0.05,
        });
    }

    world.rebuildObjects();

    if (flashT > 0) {
        flashLight.intensity = 30 * (flashT / FLASH_DUR);
    } else if (flashLight.intensity !== 0) {
        flashLight.intensity = 0;
    }
}

function wireCoreCallbacks() {
    core.onBlast = (blast) => {
        const c = blast.centers[0];
        const w = core.world.cellCenterWorldXZ(c.x, c.y);
        flashLight.position = [w.x, 1.4, w.z];
        flashT = FLASH_DUR;
    };
    core.onArenaReset = () => {
        applied = new Map();
    };
    core.onSuddenDeath = () => announce("SUDDEN DEATH — THE WALLS CLOSE IN");
    core.onPickup = (e, type) => {
        if (e !== core.human) return;
        const label = { bombs: "+1 BOMB", range: "+1 RANGE", speed: "+SPEED" }[type];
        const t = el("toast");
        if (!t) return;
        t.textContent = label;
        t.style.display = "";
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.style.display = "none"; }, 1200);
    };
}

function announce(msg) {
    const a = el("announce");
    if (!a) return;
    a.textContent = msg;
    a.style.display = "";
    a.classList.remove("pop");
    void a.offsetWidth;
    a.classList.add("pop");
    setTimeout(() => { a.style.display = "none"; }, 2400);
}

function fmtTime(s) {
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ":" + (r < 10 ? "0" : "") + r;
}

function buildChips() {
    if (chipsBuilt || !core) return;
    const bar = el("hud-chips") || el("chips");
    if (!bar) return;
    chipsBuilt = true;
    chipEls = [];
    bar.innerHTML = "";
    for (const e of core.contenders) {
        const chip = document.createElement("div");
        chip.className = "chip";
        chip.id = "chip-" + e.i;
        const [r, g, b] = e.color;
        chip.innerHTML =
            '<span class="dot" style="background: rgb(' +
            Math.round(r * 255) + "," + Math.round(g * 255) + "," + Math.round(b * 255) +
            ')"></span><span class="cname">' + e.name +
            '</span><span class="cwins" id="chip-wins-' + e.i + '"></span>';
        bar.appendChild(chip);
        chipEls.push(chip);
    }
}

function refreshChipWins() {
    if (!core) return;
    for (const e of core.contenders) {
        const chip = chipEls[e.i];
        if (!chip) continue;
        chip.classList.toggle("dead", !e.alive);
        const w = chip.querySelector(".cwins");
        if (w) {
            w.textContent =
                "★".repeat(e.wins) + "·".repeat(Math.max(0, WINS_TARGET - e.wins));
        }
    }
}

function resetMatch() {
    ensureCore();
    for (const e of core.contenders) e.wins = 0;
    core.round = 1;
    core.state = "matchover";
    core.proceed();
    applied = new Map();
    flashT = 0;
    frameCamera();
}

function fillRoundScreen() {
    if (!core) return;
    const w = core.winner;
    const title = el("round-title");
    const sub = el("round-sub");
    if (title) {
        title.textContent = w ? w.name + " WINS THE ROUND" : "DRAW";
        if (w) {
            const [r, g, b] = w.color;
            title.style.color = "rgb(" + Math.round(r * 255) + "," +
                Math.round(g * 255) + "," + Math.round(b * 255) + ")";
        } else {
            title.style.color = "";
        }
    }
    if (sub) {
        sub.textContent = "First to " + WINS_TARGET + "  ·  Round " + core.round;
    }
}

export const game = {
    id: "blastgrid",
    clearColor: "#0a0d12",

    actions: [
        { name: "primary", label: "Drop Bomb", defaults: [" "] },
    ],

    defaults: {
        highScore: 0,
    },

    create(ctx) {
        ensureCore();
        buildChips();
        resetMatch();

        const run = {
            score: 0,
            play: ctx.play,
            save: ctx.save,
            highScore: ctx.highScore,
            held: { up: false, down: false, left: false, right: false },
            roundPending: false,
            ended: false,
        };
        run.score = core.human.wins;
        return run;
    },

    update(run, dt, input) {
        if (!core) return;
        const dtSec = dt / 1000;

        if (run.ended) {
            return { status: "gameover" };
        }

        // Sync held directions into domain
        for (const d of ["up", "down", "left", "right"]) {
            const now = input.down(d);
            if (now && !run.held[d]) core.pressDir(d);
            if (!now && run.held[d]) core.releaseDir(d);
            run.held[d] = now;
        }
        if (input.pressed("primary")) {
            core.dropBomb();
            run.play("bomb");
        }

        if (core.state === "playing") {
            core.update(dtSec);
            flashT = Math.max(0, flashT - dtSec);
            applyTints();
            syncRender();
            run.score = core.human.wins;

            if (core.state === "roundover") {
                run.roundPending = true;
                run.play("round");
                fillRoundScreen();
                return { status: "screen", name: "roundover" };
            }
            if (core.state === "matchover") {
                run.ended = true;
                run.score = core.human.wins;
                run.save.maybeHighScore(run.score);
                run.save.save();
                run.play(core.winner === core.human ? "win" : "lose");
                return { status: "gameover" };
            }
        }
    },

    draw() {
        if (!core || !scene) return;
        frameCamera();
    },

    hud(run) {
        if (!core) {
            return { timer: "—", round: "—", powers: "—" };
        }
        refreshChipWins();
        const h = core.human;
        let timer;
        const timerEl = el("hud-timer");
        if (core.sd.active) {
            timer = "SUDDEN DEATH";
            if (timerEl) timerEl.className = "sudden";
        } else {
            timer = fmtTime(core.timeLeft);
            if (timerEl) timerEl.className = core.timeLeft <= 30 ? "low" : "";
        }
        return {
            timer,
            round: "ROUND " + core.round + " · FIRST TO " + WINS_TARGET,
            powers:
                "BOMBS " + h.bombCap + " · RANGE " + h.range +
                " · SPEED " + (1 + Math.round((h.speed - BASE_SPEED) / SPEED_STEP)),
        };
    },

    gameOverText(run) {
        if (!core) return "";
        const w = core.winner;
        const tag = run && run._newBest ? "  (NEW BEST!)" : "";
        const lines = [];
        if (w) lines.push(w.name + " WINS THE MATCH");
        else lines.push("MATCH OVER");
        lines.push("");
        for (const e of core.contenders) {
            lines.push(e.name + ": " + e.wins + " win" + (e.wins === 1 ? "" : "s"));
        }
        lines.push("");
        lines.push("Your wins: " + core.human.wins + tag);
        return lines.join("\n");
    },

    onEnterScreen(name) {
        if (name === "roundover") fillRoundScreen();
    },

    onMenuAction(action, run, api) {
        if (action === "continue" && core) {
            // Advance past round-over into the next round without a full rematch.
            for (const d of ["up", "down", "left", "right"]) {
                if (run && run.held[d]) {
                    core.releaseDir(d);
                    run.held[d] = false;
                }
            }
            core.proceed();
            applied = new Map();
            frameCamera();
            if (run) run.roundPending = false;
            return "playing";
        }
        return null;
    },

    cue(name, audio) {
        if (name === "menu") audio.tone(440, 0.03, "sine", 0.3);
        else if (name === "select") audio.tone(620, 0.06, "square", 0.35);
        else if (name === "bomb") audio.tone(180, 0.05, "square", 0.35);
        else if (name === "round") {
            audio.sequence([
                [523, 0.08, "square", 0.45],
                [659, 0.12, "square", 0.5],
            ]);
        } else if (name === "win") {
            audio.sequence([
                [523, 0.09, "square", 0.55],
                [659, 0.09, "square", 0.6],
                [784, 0.1, "square", 0.65],
                [1047, 0.22, "square", 0.7],
            ]);
        } else if (name === "lose") {
            audio.sequence([
                [220, 0.12, "sawtooth", 0.45],
                [160, 0.2, "sawtooth", 0.5],
            ]);
        }
    },
};

export function installTestHooks(shell) {
    // Lazy: scene/core are built on first run (or BLAST.ensure()), so
    // headless --no-gpu can still open the title screen.
    window.BLAST = {
        shell,
        ensure() {
            ensureCore();
            buildChips();
            this.game = core;
            this.world = core.world;
            this.scene = scene;
            this.debug = core.debug;
            return this;
        },
        get game() { return core; },
        get world() { return core && core.world; },
        get scene() { return scene; },
        get debug() { return core && core.debug; },
        TILE, SPAWNS, ROSTER,
        FLAG_SOLID, FLAG_SOFT, FLAG_BOMB, FLAG_DANGER,
        MAP_W, MAP_H, FUSE, FIRE_LINGER,
        BASE_RANGE, BASE_BOMBS, BASE_SPEED,
    };
}
