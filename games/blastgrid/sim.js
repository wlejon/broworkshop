// sim.js — BlastGrid match: the arena TileWorld, bombs and blasts, movement,
// power-ups, rounds and sudden death. Tuning in rules.js, rival bombers in
// ai.js. No DOM and no rendering: the plugin reads state and on* callbacks.

import { seededRandom } from "/lib/arcade/grid.js";
import {
    TILE, FLAG_SOLID, FLAG_SOFT, FLAG_BOMB, FLAG_DANGER, MOVE_MASK,
    MAP_W, MAP_H, CELL, HSTEP, FUSE, FIRE_LINGER, SOFT_PROB, DROP_PROB,
    ROUND_TIME, SD_INTERVAL, WINS_TARGET,
    BASE_RANGE, MAX_RANGE, BASE_BOMBS, MAX_BOMBS, BASE_SPEED, SPEED_STEP, MAX_SPEED,
    SPAWNS, ROSTER,
} from "/app/rules.js";
import { createAI } from "/app/ai.js";

export * from "/app/rules.js";

const DIRVEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const PALETTE = new Float32Array([
    0, 0, 0, 1,                 // 0 empty
    0.34, 0.58, 0.29, 1,        // FLOOR
    0.30, 0.52, 0.26, 1,        // FLOOR2 (checker)
    0.34, 0.355, 0.44, 1,       // WALL
    0.55, 0.575, 0.66, 1,       // PILLAR
    0.80, 0.55, 0.30, 1,        // SOFT (crate)
    0.62, 0.32, 0.35, 1,        // SDWALL (sudden death)
]);

export function createGame(scene, opts = {}) {
    const world = scene.createTileWorld({
        width: MAP_W, height: MAP_H,
        cellSize: CELL, heightStep: HSTEP, chunkSize: 8,
        baseLevel: -1, aoStrength: 0.55,
        palette: PALETTE,
    });

    const idx = (x, y) => y * MAP_W + x;
    const inBounds = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

    const game = {
        world,
        state: "playing",        // "playing" | "roundover" | "matchover"
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
        lastBlast: null,         // { centers, cells }: for the plugin's FX
        // plugin callbacks
        onBlast: null, onDeath: null, onPickup: null, onRoundOver: null,
        onSuddenDeath: null, onArenaReset: null, onReveal: null,
    };

    let nextId = 1;
    const nextDrops = [];        // forced power-up reveals (tests)
    let pendingOver = -1;        // game.time at which the round resolves
    let rng = seededRandom(game.seed);
    const ai = createAI(game, () => rng());

    game.idx = idx;
    game.fireAt = (x, y) => game.fire.has(idx(x, y));
    game.dangerAt = (x, y) => game.dangerSet.has(idx(x, y));

    // ── Contenders ───────────────────────────────────────────────────────

    game.contenders = ROSTER.map((def, i) => ({
        i, name: def.name, color: def.color, isAI: def.isAI,
        wins: 0,
        alive: true, px: 0, py: 0, cx: 0, cy: 0, tx: 0, ty: 0,
        moving: false, facing: Math.PI, held: [],
        range: BASE_RANGE, bombCap: BASE_BOMBS, speed: BASE_SPEED,
        activeBombs: 0,
        ai: null,
    }));
    game.human = game.contenders[0];

    function resetEntity(e) {
        const s = SPAWNS[e.i];
        e.alive = true;
        e.px = s.x; e.py = s.y; e.cx = s.x; e.cy = s.y; e.tx = s.x; e.ty = s.y;
        e.moving = false; e.held = []; e.facing = e.i < 2 ? Math.PI : 0;
        e.range = BASE_RANGE; e.bombCap = BASE_BOMBS; e.speed = BASE_SPEED;
        e.activeBombs = 0;
        e.ai = e.isAI ? ai.fresh() : null;
    }

    // ── Arena ────────────────────────────────────────────────────────────

    function spawnClearSet() {
        const clear = new Set();
        for (const s of SPAWNS) {
            clear.add(idx(s.x, s.y));
            for (const [dx, dy] of DIRS)
                if (inBounds(s.x + dx, s.y + dy)) clear.add(idx(s.x + dx, s.y + dy));
        }
        return clear;
    }

    // Interior cells, outer ring first, clockwise from (1,1): the order the
    // sudden-death walls close in.
    function spiralOrder() {
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

    const floorId = (x, y) => ((x + y) % 2 ? TILE.FLOOR : TILE.FLOOR2);

    function setWall(x, y, tile) {
        world.setTile(x, y, tile, 0);
        world.setElevation(x, y, 2);
        world.setFlag(x, y, FLAG_SOLID, true);
    }

    function setSoft(x, y) {
        world.setTile(x, y, TILE.SOFT, 0);
        world.setElevation(x, y, 1);
        world.setFlag(x, y, FLAG_SOFT, true);
    }

    function destroySoft(x, y) {
        world.setTile(x, y, floorId(x, y), 0);
        world.setElevation(x, y, 0);
        world.setFlag(x, y, FLAG_SOFT, false);
    }

    function buildArena() {
        rng = seededRandom((game.seed ^ Math.imul(game.round, 0x9E3779B9)) >>> 0);
        for (let y = 0; y < MAP_H; y++) {
            for (let x = 0; x < MAP_W; x++) {
                world.setFlag(x, y, FLAG_SOLID | FLAG_SOFT | FLAG_BOMB | FLAG_DANGER, false);
                world.setTint(x, y, 1, 1, 1, 1);
                const border = x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1;
                if (border) setWall(x, y, TILE.WALL);
                else if (x % 2 === 0 && y % 2 === 0) setWall(x, y, TILE.PILLAR);
                else {
                    world.setTile(x, y, floorId(x, y), 0);
                    world.setElevation(x, y, 0);
                }
            }
        }
        const clear = spawnClearSet();
        for (let y = 1; y < MAP_H - 1; y++) {
            for (let x = 1; x < MAP_W - 1; x++) {
                if ((x % 2 === 0 && y % 2 === 0) || clear.has(idx(x, y))) continue;
                if (rng() < SOFT_PROB) setSoft(x, y);
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

    // ── Danger ───────────────────────────────────────────────────────────

    // Predicted blast of a bomb at (x,y) with `range`, given current
    // obstructions. Fire passes over floors, stops AT the first soft block
    // (destroying it), stops at solids without entering, and stops at (but
    // detonates) bombs.
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
            for (const c of game.blastCells(b.x, b.y, b.range).cells) next.add(idx(c.x, c.y));
        for (const k of game.fire.keys()) next.add(k);
        for (const k of game.dangerSet)
            if (!next.has(k)) world.setFlag(k % MAP_W, (k / MAP_W) | 0, FLAG_DANGER, false);
        for (const k of next)
            if (!game.dangerSet.has(k)) world.setFlag(k % MAP_W, (k / MAP_W) | 0, FLAG_DANGER, true);
        game.dangerSet = next;
        game.dangerVersion++;
    }

    // ── Bombs ────────────────────────────────────────────────────────────

    game.bombAt = (x, y) => game.bombs.find((b) => b.x === x && b.y === y) || null;

    function armBomb(owner, x, y, range, fuse) {
        const b = { id: nextId++, x, y, owner, range, fuse, exploded: false };
        game.bombs.push(b);
        owner.activeBombs++;
        world.setFlag(x, y, FLAG_BOMB, true);
        recomputeDanger();
        return b;
    }

    game.placeBomb = function (e) {
        if (game.state !== "playing" || !e.alive) return null;
        const x = Math.round(e.px), y = Math.round(e.py);
        if (e.activeBombs >= e.bombCap) return null;
        if (world.hasFlag(x, y, FLAG_BOMB) || game.fire.has(idx(x, y))) return null;
        return armBomb(e, x, y, e.range, FUSE);
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
        game.powerups = game.powerups.filter((p) => !chain.cells.has(idx(p.x, p.y)));
        // Reveals under destroyed soft blocks.
        for (const s of chain.soft) {
            let type = null;
            if (nextDrops.length) type = nextDrops.shift();
            else if (rng() < DROP_PROB) {
                const r = rng();
                type = r < 0.4 ? "bombs" : r < 0.8 ? "range" : "speed";
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
            cells: [...chain.cells].map((k) => ({ x: k % MAP_W, y: (k / MAP_W) | 0 })),
        };
        if (game.onBlast) game.onBlast(game.lastBlast);
        killCheck();
    }

    // ── Movement ─────────────────────────────────────────────────────────

    game.canEnter = (x, y) => world.isWalkable(x, y, MOVE_MASK);

    game.pressDir = function (name) {
        const e = game.human;
        e.held = e.held.filter((d) => d !== name);
        e.held.push(name);
    };
    game.releaseDir = function (name) {
        const e = game.human;
        e.held = e.held.filter((d) => d !== name);
    };

    // Human: the latest-pressed passable direction wins, so holding a
    // direction glides round corners the moment the side corridor opens.
    function pickDir(e) {
        if (e.isAI) return ai.nextStep(e);
        for (let i = e.held.length - 1; i >= 0; i--) {
            const d = DIRVEC[e.held[i]];
            if (game.canEnter(e.cx + d[0], e.cy + d[1])) return d;
        }
        return null;
    }

    function onCellEnter(e) {
        const i = game.powerups.findIndex((p) => p.x === e.cx && p.y === e.cy);
        if (i < 0) return;
        const p = game.powerups.splice(i, 1)[0];
        if (p.type === "bombs") e.bombCap = Math.min(MAX_BOMBS, e.bombCap + 1);
        else if (p.type === "range") e.range = Math.min(MAX_RANGE, e.range + 1);
        else if (p.type === "speed") e.speed = Math.min(MAX_SPEED, e.speed + SPEED_STEP);
        if (game.onPickup) game.onPickup(e, p.type);
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
            } else {
                e.px += dx / dist * rem;
                e.py += dy / dist * rem;
                rem = 0;
            }
        }
    }

    // ── Death / rounds ───────────────────────────────────────────────────

    function kill(e) {
        if (!e.alive) return;
        e.alive = false;
        e.held = [];
        if (e.ai) e.ai.path = [];
        if (game.onDeath) game.onDeath(e);
    }

    function killCheck() {
        for (const e of game.contenders)
            if (e.alive && game.fire.has(idx(Math.round(e.px), Math.round(e.py)))) kill(e);
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
            game.powerups = game.powerups.filter((p) => p.x !== c.x || p.y !== c.y);
            game.fire.delete(idx(c.x, c.y));
            world.setFlag(c.x, c.y, FLAG_SOFT | FLAG_BOMB, false);
            setWall(c.x, c.y, TILE.SDWALL);
            world.rebuild();
            recomputeDanger();
            return;
        }
    }

    /** The next cell the closing walls will take (flashed as a warning). */
    game.nextSdCell = function () {
        for (const c of game.sd.queue) if (!world.hasFlag(c.x, c.y, FLAG_SOLID)) return c;
        return null;
    };

    // ── Frame ────────────────────────────────────────────────────────────

    game.update = function (dt) {
        if (game.state !== "playing") return;
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

        // bomb fuses (detonate mutates game.bombs: snapshot first)
        for (const b of [...game.bombs]) {
            b.fuse -= dt;
            if (b.fuse <= 0 && !b.exploded) detonate(b);
        }

        // fire burn-out
        let expired = false;
        for (const [k, until] of game.fire)
            if (game.time >= until) { game.fire.delete(k); expired = true; }
        if (expired) recomputeDanger();

        for (const e of game.contenders) {
            if (!e.alive) continue;
            if (e.isAI && !game.aiFrozen) ai.think(e, dt);
            updateMover(e, dt);
        }
        killCheck();

        // round resolution (small delay so the killing fire reads on screen)
        const alive = game.contenders.filter((e) => e.alive);
        if (alive.length <= 1 && pendingOver < 0) pendingOver = game.time + 0.9;
        if (pendingOver >= 0 && game.time >= pendingOver) {
            game.winner = alive[0] || null;
            if (game.winner) game.winner.wins++;
            game.state = game.winner && game.winner.wins >= WINS_TARGET ? "matchover" : "roundover";
            if (game.onRoundOver) game.onRoundOver(game.winner, game.state === "matchover");
        }
    };

    /** Advance past a round-over screen into the next round. */
    game.proceed = function () {
        if (game.state !== "roundover") return false;
        game.round++;
        buildArena();
        game.state = "playing";
        return true;
    };

    // ── Debug / test surface ─────────────────────────────────────────────

    game.debug = {
        freezeAI(on) {
            game.aiFrozen = !!on;
            if (game.aiFrozen) for (const e of game.contenders) if (e.ai) e.ai.path = [];
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
            setSoft(x, y);
            world.rebuild();
            recomputeDanger();
        },
        spawnBomb(x, y, range, o = {}) {
            const owner = game.contenders[o.owner !== undefined ? o.owner : 3];
            return armBomb(owner, x, y, range, o.fuse !== undefined ? o.fuse : FUSE);
        },
        setWins(i, n) { game.contenders[i].wins = n; },
    };

    buildArena();
    return game;
}
