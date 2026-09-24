// Hearthfolk domain: the village sim. No shell / HUD / scene wiring (game.js).
//
// createGame(scene, seed) builds the tile world (atlas.js, terrain.js), the
// object kinds (kinds.js) and five villagers who live by tier 0, a utility AI
// over their needs (hunger, tiredness, loneliness, cold) and a day/night
// clock. Tier 1 (mind.js) lets a language model steer them for a while;
// persist.js saves and loads the village.

import {
    MAP_W, MAP_H, CELL, HSTEP, L_OVER, TILE, FLAG, CROP_STAGES,
    DAY_LEN, WALK_SPEED, WORK_TICK, TREE_REGROW, SAY_DUR, HEAR_RANGE,
    START_RES, VILLAGER_DEFS,
} from "/app/defs.js";
import { ACOLS, AROWS, ACELL, TILE_ATLAS, makeAtlas } from "/app/atlas.js";
import { registerKinds } from "/app/kinds.js";
import { genTerrain } from "/app/terrain.js";
import { installMind } from "/app/mind.js";
import { installPersist } from "/app/persist.js";

const ACT_NAME = {
    work: 'working', eat: 'eating', rest: 'sleeping',
    socialize: 'socializing', warm: 'warming', idle: 'idle',
};

function createTileWorld(scene) {
    const atlas = makeAtlas();
    const edge = (id, first) => ({
        id, layer: L_OVER, mode: 'edge', family: 'nonEmpty',
        cells: Array.from({ length: 16 }, (_, i) => first + i),
    });
    return scene.createTileWorld({
        width: MAP_W, height: MAP_H,
        layers: ['ground', 'over'],
        cellSize: CELL, heightStep: HSTEP, chunkSize: 12,
        baseLevel: -3, aoStrength: 0.5,
        atlasPixels: atlas.pixels, atlasWidth: atlas.width, atlasHeight: atlas.height,
        atlasColumns: ACOLS, atlasRows: AROWS,
        tileAtlas: TILE_ATLAS,
        cliffCell: ACELL.CLIFF,
        atlasInset: 0.5,
        autotiles: [edge(TILE.PATH, ACELL.PATH0), edge(TILE.BRIDGE, ACELL.BRIDGE0)],
        overlays: [{}, { alphaCutoff: 0.5 }],
        animations: [
            { id: TILE.WATER, fps: 2.5, frames: [ACELL.WATER0, ACELL.WATER1, ACELL.WATER2] },
            { id: TILE.CROP_C, fps: 2, frames: [ACELL.CROPC0, ACELL.CROPC1, ACELL.CROPC2] },
        ],
    });
}

export function createGame(scene, seed) {
    const world = createTileWorld(scene);
    const stats = {
        kindRegistrations: 0,
        harvests: 0, treesChopped: 0, stoneMined: 0, mealsCooked: 0,
        fireTends: 0, meals: 0,
    };
    const kinds = registerKinds(world, stats);

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
        chronicle: [],               // { t, day, phase, text, kind }
        hearth: null, bench: null, kitchen: null, quarry: null,
        homes: [], bridgeCells: [], riverCells: [], forestCells: [], rockCells: [],
        dirty: { trees: true, static: true, piles: true },
        mind: {
            status: 'off',           // 'off' | 'loading' | 'ready'
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

    // ---- clock + chronicle ----------------------------------------------------

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

    // ---- villagers ------------------------------------------------------------

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

    game.villagerByName = (n) => game.villagers.find((v) => v.name === n) || null;

    const cellOf = (v) => ({ x: Math.round(v.pos.x), y: Math.round(v.pos.y) });
    game.cellOf = cellOf;
    const dist = (a, b) => world.cellDistance(a.x, a.y, b.x, b.y);

    function workSpot(v) {
        switch (v.role) {
            case 'farmer': {
                // Ripe crops first (harvest), else the nearest one.
                const c = cellOf(v);
                let best = null, bestScore = Infinity;
                for (const cr of game.crops) {
                    const score = (cr.stage === 2 ? 0 : 100) + dist(c, cr);
                    if (score < bestScore) { bestScore = score; best = cr; }
                }
                return best ? { x: best.x, y: best.y } : { ...game.hearth };
            }
            case 'forester': {
                // Nearest standing tree via a weighted distance field (rock
                // slows, water blocks): the Dijkstra variant of distanceField.
                const field = world.distanceField([cellOf(v)], {
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
        return cellOf(v);
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
                    const d = dist(c, oc);
                    if (d < bestD) { bestD = d; best = oc; }
                }
                return best || { ...game.hearth };
            }
            default: return cellOf(v);
        }
    }

    // ---- tier 0: utility AI -----------------------------------------------------

    function decide(v) {
        if (v.override && game.time < v.override.until) {
            v.commit = null;
            return { action: v.override.action || 'idle', target: v.override.target };
        }
        if (v.override) v.override = null;

        const night = game.isNight();
        const canEat = game.res.meals > 0 || game.res.food > 0;

        // Trip commitment: a chosen destination holds until arrival (no
        // mid-route flip-flopping) unless a need turns genuinely critical
        // or night falls on a work commute.
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
            // At night the village default is bed: the floor sends everyone
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

    function ensurePath(v, target) {
        // An in-progress walk toward this same target continues: arrival is
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
    // segment's cells (movers re-anchor per frame, see docs/tile-api.js).
    game.renderInfo = function (v) {
        const c = cellOf(v);
        const elev = (p) => world.getElevation(p.x, p.y);
        let y;
        if (v.path && v.seg < v.path.length - 1) {
            const a = v.path[v.seg], b = v.path[v.seg + 1];
            y = (elev(a) + (elev(b) - elev(a)) * v.segT) * HSTEP;
        } else {
            y = elev(c) * HSTEP;
        }
        return {
            anchor: c,
            offsetX: v.pos.x - c.x, offsetZ: v.pos.y - c.y,
            worldY: y,
            yOffset: y - elev(c) * HSTEP,
        };
    };

    // One unit of the villager's trade at their current cell. True when it counted.
    function doWork(v) {
        const c = cellOf(v);
        switch (v.role) {
            case 'farmer': {
                const cr = game.crops.find((k) => k.x === c.x && k.y === c.y);
                if (!cr) return false;
                if (cr.stage < 2) {
                    cr.stage++;
                } else {
                    cr.stage = 0;
                    game.res.food++;
                    stats.harvests++;
                    addEvent(v.name + ' harvests grain (food ' + game.res.food + ')', 'work');
                }
                world.setTile(cr.x, cr.y, CROP_STAGES[cr.stage], L_OVER);
                world.rebuild();
                return true;
            }
            case 'forester': {
                const t = game.trees.find((t) => t.alive && dist(t, c) <= 1);
                if (!t) return false;
                t.alive = false;
                t.regrowT = TREE_REGROW;
                game.res.wood++;
                stats.treesChopped++;
                game.dirty.trees = true;
                addEvent(v.name + ' fells a tree (wood ' + game.res.wood + ')', 'work');
                return true;
            }
            case 'mason':
                if (dist(c, game.quarry) > 1) return false;
                game.res.stone++;
                stats.stoneMined++;
                game.dirty.piles = true;
                addEvent(v.name + ' cuts stone (stone ' + game.res.stone + ')', 'work');
                return true;
            case 'cook':
                if (dist(c, game.kitchen) > 1 || game.res.food <= 0) return false;
                game.res.food--;
                game.res.meals++;
                stats.mealsCooked++;
                game.dirty.piles = true;
                addEvent(v.name + ' cooks a meal (meals ' + game.res.meals + ')', 'work');
                return true;
            case 'elder':
                if (dist(c, game.bench) > 1) return false;
                stats.fireTends++;   // keeping watch counts as the elder's work
                if (game.fire < 0.55 && game.res.wood > 0) {
                    game.res.wood--;
                    game.fire = Math.min(1, game.fire + 0.5);
                    game.dirty.piles = true;
                    addEvent(v.name + ' feeds the hearth fire (wood ' + game.res.wood + ')', 'work');
                }
                return true;
        }
        return false;
    }

    const nearFire = (v) => dist(cellOf(v), game.hearth) <= 2 && game.fire > 0.1;

    function decayNeeds(v, dt) {
        const n = v.needs;
        const sleeping = v.activity === 'sleeping';
        n.hunger = Math.min(1, n.hunger + dt / 75);
        n.energy = sleeping ? Math.max(0, n.energy - dt / 10) : Math.min(1, n.energy + dt / 110);
        n.social = v.activity === 'socializing'
            ? Math.max(0, n.social - dt / 5) : Math.min(1, n.social + dt / 90);
        const sheltered = sleeping || nearFire(v) || !game.isNight();
        n.warmth = sheltered ? Math.max(0, n.warmth - dt / 8) : Math.min(1, n.warmth + dt / 55);
    }

    function finishMeal(v) {
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

    function updateVillager(v, dt) {
        decayNeeds(v, dt);

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
            if (name === 'eating') v.actT = 2.5;   // a meal takes 2.5 sim s
        }

        if (name === 'eating') {
            v.actT -= dt;
            if (v.actT <= 0) finishMeal(v);
        } else if (name === 'working') {
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
        } else if (name === 'socializing') {
            // Drift toward the partner if they moved away.
            const c = cellOf(v);
            if (!game.villagers.some((o) => o !== v && dist(c, cellOf(o)) <= 2)) {
                v.target = null; v.plannedAct = null;
            }
        }
        // sleeping: the needs block handles it and decide() wakes them.
    }

    // ---- speech / hearing ---------------------------------------------------------

    game.speak = function (v, text) {
        v.say = { text, until: game.time + SAY_DUR };
        addEvent(v.name + ': “' + text + '”', 'say');
        const c = cellOf(v);
        for (const o of game.villagers) {
            if (o !== v && dist(c, cellOf(o)) <= HEAR_RANGE) o.heard = { from: v.name, text, t: game.time };
        }
        if (game.onSay) game.onSay(v, text);
    };

    const stepMind = installMind(game, { cellOf, spotFor, addEvent });

    // ---- main update --------------------------------------------------------------

    let lastDay = 1;

    game.update = function (rdt) {
        const dt = rdt * game.speed;
        if (dt <= 0) return;
        game.time += dt;

        if (game.day() !== lastDay) {
            lastDay = game.day();
            addEvent('Day ' + lastDay + ' dawns over Hearthfolk', 'day');
        }

        game.fire = Math.max(0, game.fire - dt / 300);   // burns down slowly

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

    installPersist(game, () => { lastDay = game.day(); });

    // ---- boot -----------------------------------------------------------------------

    genTerrain(game);
    makeVillagers();
    world.rebuildAll();
    addEvent('Day 1 dawns over Hearthfolk', 'day');

    return game;
}
