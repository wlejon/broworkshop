// sim.js — GridKeep rules: open-field maze tower defense on a square TileWorld.
//
// There is NO fixed creep path. Creeps flow downhill along a live
// world.distanceField() computed from the base cell; every tower placement /
// sale recomputes the field and the creeps reroute around the growing maze.
// Placement is refused when it would fully wall off the spawns (or strand a
// live creep), checked with a tentative flag + distanceField reachability.
//
// No DOM here: the plugin (game.js) wires the on* callbacks to HUD and sound.
// The map, atlas and meshes live in map.js.

import {
    buildWorld, TILE, FLAG_BLOCK, FLAG_NOBUILD, FLAG_TOWER,
    MAP_W, MAP_H, HSTEP, SPAWNS, BASE,
} from "/app/map.js";

export { TILE, FLAG_BLOCK, FLAG_NOBUILD, FLAG_TOWER, MAP_W, MAP_H, HSTEP, SPAWNS, BASE };

// ── Towers ───────────────────────────────────────────────────────────────

export const TOWER_TYPES = {
    arrow: {
        name: "Arrow", cost: 20, dmg: 9, cooldown: 0.5, range: 3,
        proj: "arrow", projSpeed: 11,
        desc: "Fast single-target bolts.",
    },
    cannon: {
        name: "Cannon", cost: 50, dmg: 24, cooldown: 1.7, range: 2, splash: 1.3,
        proj: "cannon", projSpeed: 5.5,
        desc: "Slow lobbed shells, splash damage.",
    },
    frost: {
        name: "Frost", cost: 35, dmg: 4, cooldown: 0.9, range: 2,
        slow: 0.5, slowDur: 1.6,
        proj: "frost", projSpeed: 8,
        desc: "Chills creeps to half speed.",
    },
};
export const MAX_LEVEL = 3;
export const SELL_RATIO = 0.7;
// Per-level damage multiplier and cooldown factor.
const LVL_DMG = [0, 1, 1.7, 2.9];
const LVL_CD = [0, 1, 0.92, 0.85];

/** L1->2 costs the tower's price, L2->3 twice that. */
export function upgradeCost(tower) {
    return TOWER_TYPES[tower.type].cost * tower.level;
}

// ── Creeps + waves ───────────────────────────────────────────────────────

export const CREEP_TYPES = {
    normal: { name: "Grub", hp: 30, speed: 1.9, bounty: 4, leak: 1, scale: 1.0 },
    fast: { name: "Skitter", hp: 20, speed: 3.4, bounty: 5, leak: 1, scale: 0.9 },
    tank: { name: "Bruiser", hp: 130, speed: 1.15, bounty: 14, leak: 2, scale: 1.25 },
    boss: { name: "WARLORD", hp: 1200, speed: 0.95, bounty: 90, leak: 10, scale: 1.9 },
};

// Scripted waves: sequential groups, per-wave HP multiplier.
export const WAVES = [
    { groups: [{ t: "normal", n: 6, gap: 0.9 }], mul: 1.0 },
    { groups: [{ t: "normal", n: 10, gap: 0.7 }], mul: 1.2 },
    { groups: [{ t: "normal", n: 8, gap: 0.7 }, { t: "fast", n: 6, gap: 0.45 }], mul: 1.3 },
    { groups: [{ t: "fast", n: 14, gap: 0.4 }], mul: 1.45 },
    { groups: [{ t: "tank", n: 5, gap: 1.8 }], mul: 1.25 },
    { groups: [{ t: "normal", n: 12, gap: 0.6 }, { t: "fast", n: 8, gap: 0.4 }], mul: 2.1 },
    { groups: [{ t: "fast", n: 18, gap: 0.30 }], mul: 2.5 },
    { groups: [{ t: "tank", n: 8, gap: 1.2 }], mul: 2.4 },
    { groups: [{ t: "normal", n: 16, gap: 0.42 }, { t: "fast", n: 12, gap: 0.30 }], mul: 3.2 },
    { groups: [{ t: "tank", n: 8, gap: 1.0 }, { t: "fast", n: 10, gap: 0.30 }, { t: "boss", n: 1, gap: 1 }], mul: 3.4 },
];

export const START_GOLD = 90;
export const START_LIVES = 20;

// ── Game factory ─────────────────────────────────────────────────────────

export function createGame(scene) {
    const { world, kinds } = buildWorld(scene);

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
        lastRefusal: null,       // { x, y, reason }: for the UI flash + tests
        frozen: false,           // debug: halt creep movement
        finalWave: WAVES.length,
        // callbacks the plugin wires up
        onWaveStart: null, onWaveCleared: null, onGameOver: null,
        onLeak: null, onRefused: null, onSplash: null,
    };

    let nextId = 1;
    let spawnQueue = [];         // [{ type, at, hpMul }] absolute game.time seconds
    let spawnCursor = 0;         // round-robin over SPAWNS

    const inMap = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

    // ── Routing ──────────────────────────────────────────────────────────

    game.recomputeField = function () {
        game.field = world.distanceField([BASE], { blockMask: FLAG_BLOCK });
        for (const c of game.creeps) c.repath = true;
    };
    game.recomputeField();

    game.fieldAt = (x, y) => (inMap(x, y) ? game.field[y * MAP_W + x] : -1);

    // ── Placement ────────────────────────────────────────────────────────

    game.towerAt = (x, y) => game.towers.find((t) => t.x === x && t.y === y) || null;

    game.creepOn = (x, y) =>
        game.creeps.find((c) => Math.round(c.px) === x && Math.round(c.py) === y) || null;

    // Placement legality WITHOUT the route check (cheap). null when fine,
    // else a reason string.
    function placeVeto(type, x, y) {
        if (!inMap(x, y)) return "bounds";
        if (world.hasFlag(x, y, FLAG_TOWER)) return "occupied";
        if (world.hasFlag(x, y, FLAG_NOBUILD)) return "terrain";
        const id = world.getTile(x, y, 0);
        if (id !== TILE.GRASS && id !== TILE.DIRT && id !== TILE.EGRASS) return "terrain";
        if (game.creepOn(x, y)) return "creep";
        if (game.gold < TOWER_TYPES[type].cost) return "gold";
        return null;
    }

    // Full check including "may not wall off the map": tentatively block the
    // cell, recompute the distance field, and demand every spawn AND every
    // live creep can still reach the base.
    game.canPlace = function (type, x, y) {
        const veto = placeVeto(type, x, y);
        if (veto) return { ok: false, reason: veto };
        if (world.getTile(x, y, 0) === TILE.EGRASS)   // already blocked; routes unaffected
            return { ok: true, reason: null };
        world.setFlag(x, y, FLAG_BLOCK, true);
        try {
            const f = world.distanceField([BASE], { blockMask: FLAG_BLOCK });
            for (const s of SPAWNS)
                if (f[s.y * MAP_W + s.x] < 0) return { ok: false, reason: "blocks" };
            for (const c of game.creeps) {
                if (f[Math.round(c.py) * MAP_W + Math.round(c.px)] < 0) return { ok: false, reason: "blocks" };
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
        return tower;
    };

    game.towerRange = (t) =>
        TOWER_TYPES[t.type].range + (t.elevated ? 1 : 0) + (t.level >= 3 ? 1 : 0);
    game.towerDamage = (t) => Math.round(TOWER_TYPES[t.type].dmg * LVL_DMG[t.level]);
    game.towerCooldown = (t) => TOWER_TYPES[t.type].cooldown * LVL_CD[t.level];

    game.upgradeTower = function (t) {
        if (t.level >= MAX_LEVEL) return false;
        const cost = upgradeCost(t);
        if (game.gold < cost) return false;
        game.gold -= cost;
        t.invested += cost;
        t.level++;
        return true;
    };

    game.sellRefund = (t) => Math.floor(t.invested * SELL_RATIO);

    game.sellTower = function (t) {
        const i = game.towers.indexOf(t);
        if (i < 0) return false;
        game.towers.splice(i, 1);
        game.gold += game.sellRefund(t);
        // Hills stay blocked to creeps once the tower is gone.
        world.setFlag(t.x, t.y, FLAG_BLOCK, world.getTile(t.x, t.y, 0) === TILE.EGRASS);
        world.setFlag(t.x, t.y, FLAG_TOWER, false);
        game.recomputeField();
        return true;
    };

    // ── Creeps ───────────────────────────────────────────────────────────

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
        if (game.fieldAt(cx, cy) === 0) return "base";
        const pdx = Math.sign(c.tx - c.px), pdy = Math.sign(c.ty - c.py);
        let best = null, bestF = Infinity, bestStraight = -1;
        for (const [dx, dy] of DIRS) {
            const f = game.fieldAt(cx + dx, cy + dy);
            if (f < 0) continue;
            const straight = dx === pdx && dy === pdy ? 1 : 0;
            if (f < bestF || (f === bestF && straight > bestStraight)) {
                best = [cx + dx, cy + dy]; bestF = f; bestStraight = straight;
            }
        }
        if (!best) return null;         // stranded (placement forbids it)
        c.tx = best[0]; c.ty = best[1];
        c.repath = false;
        return "go";
    }

    function removeCreep(c) {
        const i = game.creeps.indexOf(c);
        if (i >= 0) game.creeps.splice(i, 1);
    }

    function endGame(won) {
        game.over = true;
        game.won = won;
        if (game.onGameOver) game.onGameOver(won);
    }

    function leak(c) {
        game.lives -= c.def.leak;
        game.leaks++;
        removeCreep(c);
        if (game.onLeak) game.onLeak(c);
        if (game.lives <= 0 && !game.over) {
            game.lives = 0;
            endGame(false);
        }
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
        }
    };

    game.isSlowed = (c) => game.time < c.slowUntil;
    game.creepSpeed = (c) => c.def.speed * (game.isSlowed(c) ? TOWER_TYPES.frost.slow : 1);

    function updateCreeps(dt) {
        if (game.frozen) return;
        for (const c of [...game.creeps]) {
            c.hitFlash = Math.max(0, c.hitFlash - dt);
            // Rerouted, or the current target got blocked: re-pick from here.
            if (c.repath || game.fieldAt(c.tx, c.ty) < 0) {
                const r = pickNext(c);
                if (r === "base") { leak(c); continue; }
                if (r === null) continue;
            }
            let remaining = game.creepSpeed(c) * dt;
            while (remaining > 0) {
                const dx = c.tx - c.px, dy = c.ty - c.py;
                const dist = Math.hypot(dx, dy);
                if (dist < 1e-6) {
                    const r = pickNext(c);
                    if (r === "base") { leak(c); break; }
                    if (r !== "go") break;
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

    // ── Waves ────────────────────────────────────────────────────────────

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
        if (game.waveActive && !spawnQueue.length && !game.creeps.length && !game.over) {
            game.waveActive = false;
            const bonus = 15 + game.wave * 3;
            game.gold += bonus;
            if (game.onWaveCleared) game.onWaveCleared(game.wave, bonus);
            if (game.wave >= WAVES.length) endGame(true);
        }
    }

    // ── Towers firing ────────────────────────────────────────────────────

    // Chebyshev range (square ring, matches cellsInRange "vertex" display).
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
        const h = 0.72 + (t.elevated ? HSTEP : 0);   // flight height above grade
        game.projectiles.push({
            kind: def.proj,
            x: t.x, y: t.y,               // continuous cell coords
            h, startH: h,
            speed: def.projSpeed,
            dmg: game.towerDamage(t),
            splash: def.splash || 0,
            slow: def.slow ? { dur: def.slowDur } : null,
            target, lastX: target.px, lastY: target.py,
            traveled: 0,
            total: Math.max(0.35, Math.hypot(target.px - t.x, target.py - t.y)),
            yaw: 0,
        });
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
                if (Math.hypot(c.px - ix, c.py - iy) <= p.splash) game.damageCreep(c, p.dmg);
            if (game.onSplash) game.onSplash(Math.round(ix), Math.round(iy));
        } else if (alive) {
            if (p.slow) p.target.slowUntil = game.time + p.slow.dur;
            game.damageCreep(p.target, p.dmg);
        }
    }

    function updateProjectiles(dt) {
        for (const p of [...game.projectiles]) {
            const alive = p.target && p.target.hp > 0 && game.creeps.includes(p.target);
            if (alive) { p.lastX = p.target.px; p.lastY = p.target.py; }
            const dx = p.lastX - p.x, dy = p.lastY - p.y;
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
            p.h = p.kind === "cannon"
                ? p.startH + 4 * 0.85 * t01 * (1 - t01)      // lobbed arc
                : p.startH + (0.32 - p.startH) * t01;        // dive to torso height
        }
    }

    // ── Frame ────────────────────────────────────────────────────────────

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
