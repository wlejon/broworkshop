// world.js — pure farm simulation model. NO canvas, NO DOM.
//
// createWorld(opts) builds a mutable world, and exposes:
//   world.step(dt)      advance the sim by dt milliseconds
//   world.observe()     serializable, decision-relevant snapshot + alerts
//   world.actions       map of primitive verbs that mutate the world
//
// observe() and actions are the two seams the AI-agent layer (Pass 2) uses:
// an orchestrator reads observe() to decide, then calls world.actions.* to
// act. The player and NPC tasks will both go through the same verbs.

import {
    GRID, DAY_LENGTH_MS, RATES, REGIONS, PENS,
    ANIMAL_SPECS, CROP_PLOTS, NPC_SPECS, START_RESOURCES, START_TROUGHS,
    CROP_KINDS,
} from './defs.js';

// Small deterministic RNG so wander/produce jitter is reproducible.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function createWorld(opts = {}) {
    const rng = mulberry32(opts.seed != null ? opts.seed : 1337);

    const world = {
        cols: GRID.cols,
        rows: GRID.rows,
        // Start at 06:00 of day 1 (quarter into the day clock).
        clock: { t: DAY_LENGTH_MS * 0.25, day: 1, hour: 6, minute: 0 },
        dayLengthMs: DAY_LENGTH_MS,
        regions: REGIONS.map((r) => ({ ...r })),
        pens: {},
        troughs: {},      // id -> { id, penId, kind, fill }
        animals: [],
        crops: [],
        npcs: [],
        resources: { ...START_RESOURCES },
        log: [],          // recent action results (most recent first)
    };

    // Pens + their pending (uncollected) produce.
    for (const penId of Object.keys(PENS)) {
        const p = PENS[penId];
        world.pens[penId] = { ...p, pending: 0 };
        world.troughs[penId + '-feed']  = { id: penId + '-feed',  penId, kind: 'feed',  x: p.feedTrough.x,  y: p.feedTrough.y,  fill: START_TROUGHS[penId + '-feed']  ?? 100 };
        world.troughs[penId + '-water'] = { id: penId + '-water', penId, kind: 'water', x: p.waterTrough.x, y: p.waterTrough.y, fill: START_TROUGHS[penId + '-water'] ?? 100 };
    }

    for (const a of ANIMAL_SPECS) {
        world.animals.push({
            id: a.id, kind: a.kind, penId: a.penId,
            x: a.x, y: a.y,
            homeX: a.x, homeY: a.y,
            tx: a.x, ty: a.y,            // wander target
            hunger: a.hunger, thirst: a.thirst, health: 100,
            produceTimer: RATES.produceInterval * (0.5 + rng()),
            alive: true,
        });
    }

    for (const c of CROP_PLOTS) {
        world.crops.push({
            id: c.id, plotIndex: c.plotIndex, x: c.x, y: c.y,
            kind: c.kind, stage: c.stage, growth: c.growth, moisture: c.moisture,
        });
    }

    for (const n of NPC_SPECS) {
        world.npcs.push({
            id: n.id, name: n.name, role: n.role, voice: n.voice,
            x: n.home.x, y: n.home.y,
            tx: n.home.x, ty: n.home.y,
            home: { ...n.home },
            state: 'idle', carrying: null, task: null,
        });
    }

    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

    function pushLog(msg) {
        world.log.unshift({ t: world.clock.t, msg });
        if (world.log.length > 12) world.log.pop();
    }

    // ---- simulation step -------------------------------------------------
    function step(dt) {
        if (dt <= 0) return;
        const s = dt / 1000;

        // Clock
        world.clock.t += dt;
        const dayPos = (world.clock.t % world.dayLengthMs) / world.dayLengthMs;
        world.clock.day = Math.floor(world.clock.t / world.dayLengthMs) + 1;
        const hf = dayPos * 24;
        world.clock.hour = Math.floor(hf);
        world.clock.minute = Math.floor((hf - world.clock.hour) * 60);

        // Animals: metabolism, auto-feed/drink from pen troughs, health, produce
        for (const a of world.animals) {
            if (!a.alive) continue;
            const feed  = world.troughs[a.penId + '-feed'];
            const water = world.troughs[a.penId + '-water'];

            a.hunger = clamp(a.hunger + RATES.hungerRise * s, 0, 100);
            a.thirst = clamp(a.thirst + RATES.thirstRise * s, 0, 100);

            // Eat: pull hunger down, draw the feed trough down with it.
            if (a.hunger > 0 && feed.fill > 0) {
                const want = Math.min(RATES.feedRate * s, a.hunger);
                const have = Math.min(want, feed.fill / RATES.troughDraw);
                a.hunger -= have;
                feed.fill = clamp(feed.fill - have * RATES.troughDraw, 0, 100);
            }
            if (a.thirst > 0 && water.fill > 0) {
                const want = Math.min(RATES.feedRate * s, a.thirst);
                const have = Math.min(want, water.fill / RATES.troughDraw);
                a.thirst -= have;
                water.fill = clamp(water.fill - have * RATES.troughDraw, 0, 100);
            }

            // Health: decline if either need is critical; recover if both comfy.
            const worst = Math.max(a.hunger, a.thirst);
            if (worst > RATES.needCritical) {
                a.health = clamp(a.health - RATES.healthDecay * s, 0, 100);
                if (a.health <= 0) { a.alive = false; pushLog(`${a.id} has died`); }
            } else if (a.hunger < RATES.needComfort && a.thirst < RATES.needComfort) {
                a.health = clamp(a.health + RATES.healthRegen * s, 0, 100);
            }

            // Produce goods into the pen's uncollected pile.
            if (a.alive && a.health >= RATES.produceMin &&
                a.hunger < 50 && a.thirst < 50) {
                a.produceTimer -= s;
                if (a.produceTimer <= 0) {
                    world.pens[a.penId].pending += 1;
                    a.produceTimer = RATES.produceInterval;
                }
            }

            wander(a, s, 0.6);
        }

        // Crops: dry out, grow only while moist, ripen.
        for (const c of world.crops) {
            if (c.stage === 'empty') continue;
            c.moisture = clamp(c.moisture - RATES.moistureDecay * s, 0, 100);
            if (c.moisture > 0 && c.stage !== 'ripe') {
                c.growth = clamp(c.growth + RATES.growthRate * s, 0, 100);
            }
            if (c.stage === 'seed' && c.growth >= RATES.growGrowing) c.stage = 'growing';
            if (c.growth >= RATES.growRipe) c.stage = 'ripe';
        }

        // NPCs: idle gentle wander only (Pass 1 — no real tasks yet).
        for (const n of world.npcs) {
            wanderNpc(n, s);
        }
    }

    function wander(e, s, range) {
        const dx = e.tx - e.x, dy = e.ty - e.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.15) {
            // pick a new nearby target within home range
            e.tx = e.homeX + (rng() * 2 - 1) * range;
            e.ty = e.homeY + (rng() * 2 - 1) * range;
        } else {
            const sp = 0.7 * s;
            e.x += (dx / d) * Math.min(sp, d);
            e.y += (dy / d) * Math.min(sp, d);
        }
    }

    function wanderNpc(n, s) {
        const dx = n.tx - n.x, dy = n.ty - n.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.2) {
            n.tx = n.home.x + (rng() * 2 - 1) * 2.5;
            n.ty = n.home.y + (rng() * 2 - 1) * 2.5;
        } else {
            const sp = 1.2 * s;
            n.x += (dx / d) * Math.min(sp, d);
            n.y += (dy / d) * Math.min(sp, d);
        }
    }

    // ---- observe(): the read seam for the agent layer --------------------
    function observe() {
        const r1 = (v) => Math.round(v);
        const animals = world.animals.map((a) => ({
            id: a.id, kind: a.kind, penId: a.penId,
            hunger: r1(a.hunger), thirst: r1(a.thirst),
            health: r1(a.health), alive: a.alive,
        }));
        const crops = world.crops.map((c) => ({
            id: c.id, plotIndex: c.plotIndex, kind: c.kind,
            stage: c.stage, growth: r1(c.growth), moisture: r1(c.moisture),
        }));
        const troughs = Object.values(world.troughs).map((t) => ({
            id: t.id, penId: t.penId, kind: t.kind, fill: r1(t.fill),
        }));
        const npcs = world.npcs.map((n) => ({
            id: n.id, name: n.name, busy: n.task != null,
        }));
        const resources = {};
        for (const k of Object.keys(world.resources)) resources[k] = r1(world.resources[k]);
        const pending = {};
        for (const penId of Object.keys(world.pens)) pending[penId] = world.pens[penId].pending;

        return {
            clock: {
                day: world.clock.day,
                hour: world.clock.hour,
                minute: world.clock.minute,
                time: String(world.clock.hour).padStart(2, '0') + ':' +
                      String(world.clock.minute).padStart(2, '0'),
                t: Math.round(world.clock.t),
            },
            animals, crops, troughs, npcs, resources, pending,
            alerts: deriveAlerts(animals, crops, troughs, resources),
        };
    }

    function deriveAlerts(animals, crops, troughs, resources) {
        const alerts = [];
        for (const a of animals) {
            if (!a.alive) { alerts.push({ level: 'critical', who: a.id, msg: `${a.id} has died` }); continue; }
            if (a.thirst >= 75) alerts.push({ level: 'critical', who: a.id, msg: `${a.id} thirst critical` });
            else if (a.hunger >= 75) alerts.push({ level: 'critical', who: a.id, msg: `${a.id} hunger critical` });
            if (a.health < 40) alerts.push({ level: 'warning', who: a.id, msg: `${a.id} health low` });
        }
        for (const t of troughs) {
            if (t.fill <= 5) alerts.push({ level: 'critical', who: t.id, msg: `${t.penId} ${t.kind} trough empty` });
            else if (t.fill < 20) alerts.push({ level: 'warning', who: t.id, msg: `${t.penId} ${t.kind} trough low` });
        }
        for (const c of crops) {
            if (c.stage === 'ripe') alerts.push({ level: 'info', who: c.id, msg: `${c.id} ready to harvest` });
            else if (c.stage !== 'empty' && c.moisture < 15) alerts.push({ level: 'warning', who: c.id, msg: `${c.id} needs water` });
        }
        if (resources.feed < 40)  alerts.push({ level: 'warning', who: 'barn', msg: 'feed stock low' });
        if (resources.water < 40) alerts.push({ level: 'warning', who: 'well', msg: 'water stock low' });
        return alerts;
    }

    // ---- actions: the write seam for player + NPCs -----------------------
    const TROUGH_CAP = 100;

    function refillTrough(penId, kind, pool) {
        const t = world.troughs[penId + '-' + kind];
        if (!t) return { ok: false, reason: 'no such trough' };
        const room = TROUGH_CAP - t.fill;
        if (room <= 0) return { ok: false, reason: 'trough full', added: 0 };
        const added = Math.min(room, world.resources[pool]);
        if (added <= 0) return { ok: false, reason: `${pool} empty`, added: 0 };
        t.fill += added;
        world.resources[pool] -= added;
        pushLog(`refilled ${penId} ${kind} (+${Math.round(added)})`);
        return { ok: true, added, fill: t.fill };
    }

    const actions = {
        // Top up a pen's feed trough from the feed pool.
        refillFeedTrough(penId) { return refillTrough(penId, 'feed', 'feed'); },
        // Top up a pen's water trough from the water pool.
        refillWaterTrough(penId) { return refillTrough(penId, 'water', 'water'); },

        // Draw water from the well into the water pool.
        drawWater(units = 50) {
            world.resources.water += units;
            pushLog(`drew ${units} water from well`);
            return { ok: true, water: world.resources.water };
        },
        // Load feed from the barn into the feed pool.
        loadFeed(units = 50) {
            world.resources.feed += units;
            pushLog(`loaded ${units} feed from barn`);
            return { ok: true, feed: world.resources.feed };
        },

        // Plant a seed into an empty plot.
        plant(plotIndex, kind = 'wheat') {
            const c = world.crops.find((x) => x.plotIndex === plotIndex);
            if (!c) return { ok: false, reason: 'no such plot' };
            if (c.stage !== 'empty') return { ok: false, reason: 'plot occupied' };
            c.kind = kind; c.stage = 'seed'; c.growth = 0; c.moisture = 60;
            pushLog(`planted ${kind} in plot ${plotIndex}`);
            return { ok: true, cropId: c.id };
        },
        // Water a crop back to full moisture.
        waterCrop(cropId) {
            const c = world.crops.find((x) => x.id === cropId);
            if (!c) return { ok: false, reason: 'no such crop' };
            if (c.stage === 'empty') return { ok: false, reason: 'nothing planted' };
            const used = Math.min(100 - c.moisture, world.resources.water);
            c.moisture = Math.min(100, c.moisture + used);
            world.resources.water -= used;
            return { ok: true, moisture: c.moisture, used };
        },
        // Harvest a ripe crop: clears the plot, banks the good + gold.
        harvest(cropId) {
            const c = world.crops.find((x) => x.id === cropId);
            if (!c) return { ok: false, reason: 'no such crop' };
            if (c.stage !== 'ripe') return { ok: false, reason: 'not ripe' };
            const kind = c.kind;
            const gold = (CROP_KINDS[kind] && CROP_KINDS[kind].gold) || 4;
            world.resources.crops += 1;
            world.resources.gold += gold;
            c.kind = null; c.stage = 'empty'; c.growth = 0; c.moisture = 0;
            pushLog(`harvested ${kind} (+${gold}g)`);
            return { ok: true, kind, gold };
        },
        // Collect a pen's uncollected produce into storage + gold.
        collectProduce(penId) {
            const pen = world.pens[penId];
            if (!pen) return { ok: false, reason: 'no such pen' };
            const n = pen.pending;
            if (n <= 0) return { ok: false, reason: 'nothing to collect', collected: 0 };
            world.resources[pen.good] += n;
            world.resources.gold += n * pen.goldPerGood;
            pen.pending = 0;
            pushLog(`collected ${n} ${pen.good} (+${n * pen.goldPerGood}g)`);
            return { ok: true, good: pen.good, collected: n };
        },
    };

    world.step = step;
    world.observe = observe;
    world.actions = actions;
    return world;
}
