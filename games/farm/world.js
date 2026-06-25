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
    ANIMAL_SPECS, ANIMAL_KINDS, CROP_PLOTS, NPC_SPECS, START_RESOURCES, START_TROUGHS,
    CROP_KINDS,
} from './defs.js';
import { createEnv, stepEnv, envObserve, envAlerts } from './env.js';

// ---- life-cycle tuning ------------------------------------------------------
const YOUNG_MS = 45000;     // age below which an animal is 'young' (no produce)
const OLD_MS   = 330000;    // age at/after which it's 'old' (reduced produce)
const BREED_INTERVAL = 35000;   // ms between a pen's breeding checks
const ILL_BASE = 0.0010;    // baseline per-second chance an animal falls sick
const SICK_DECAY = 1.5;     // health/s lost while sick (and recovery is blocked)
const NOTICE_MS = 12000;    // how long event notices (rot/birth/illness) stay up

function ageStageOf(ms) {
    return ms < YOUNG_MS ? 'young' : ms >= OLD_MS ? 'old' : 'adult';
}

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
        env: createEnv(), // season / weather / day-phase substrate (env.js)
        births: 0,        // running count for unique offspring ids
        notices: [],      // transient event alerts: { level, who, msg, until }
        log: [],          // recent action results (most recent first)
        dialog: [],       // recent spoken lines: { t, speaker, text } (most recent first)
    };

    // Pens + their pending (uncollected) produce, capacity cap, and breed timer.
    for (const penId of Object.keys(PENS)) {
        const p = PENS[penId];
        world.pens[penId] = { ...p, pending: 0, cap: p.cap ?? 8, breedTimer: BREED_INTERVAL };
        world.troughs[penId + '-feed']  = { id: penId + '-feed',  penId, kind: 'feed',  x: p.feedTrough.x,  y: p.feedTrough.y,  fill: START_TROUGHS[penId + '-feed']  ?? 100 };
        world.troughs[penId + '-water'] = { id: penId + '-water', penId, kind: 'water', x: p.waterTrough.x, y: p.waterTrough.y, fill: START_TROUGHS[penId + '-water'] ?? 100 };
    }

    for (const a of ANIMAL_SPECS) {
        const sk = ANIMAL_KINDS[a.kind] || {};
        // Seed starting animals as established adults of varied age.
        const ageMs = YOUNG_MS + 20000 + rng() * (OLD_MS - YOUNG_MS - 40000);
        world.animals.push({
            id: a.id, kind: a.kind, penId: a.penId,
            x: a.x, y: a.y,
            homeX: a.x, homeY: a.y,
            tx: a.x, ty: a.y,            // wander target
            hunger: a.hunger, thirst: a.thirst, health: 100,
            produceTimer: (sk.produceInterval || RATES.produceInterval) * (0.5 + rng()),
            alive: true,
            ageMs, ageStage: ageStageOf(ageMs), sick: false,
        });
    }

    for (const c of CROP_PLOTS) {
        const kd = CROP_KINDS[c.kind] || {};
        world.crops.push({
            id: c.id, plotIndex: c.plotIndex, x: c.x, y: c.y,
            kind: c.kind, stage: c.stage, growth: c.growth, moisture: c.moisture,
            ripeTimer: c.stage === 'ripe' ? (kd.spoilMs || 20000) : null,
        });
    }

    for (const n of NPC_SPECS) {
        world.npcs.push({
            id: n.id, name: n.name, role: n.role, voice: n.voice,
            x: n.home.x, y: n.home.y,
            tx: n.home.x, ty: n.home.y,
            home: { ...n.home },
            state: 'idle', carrying: null, task: null, speech: null,
        });
    }

    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

    function pushLog(msg) {
        world.log.unshift({ t: world.clock.t, msg });
        if (world.log.length > 12) world.log.pop();
    }

    // Transient event alert (rot / birth / illness). observe() surfaces these
    // while still within their lifetime so momentary events read in the HUD.
    function pushNotice(level, who, msg) {
        world.notices.unshift({ level, who, msg, until: world.clock.t + NOTICE_MS });
        if (world.notices.length > 16) world.notices.pop();
    }

    function penCenter(penId) {
        const r = REGIONS.find((x) => x.penId === penId);
        return r ? { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 } : { x: 0, y: 0 };
    }

    function spawnAnimal(penId, kind, x, y) {
        const sk = ANIMAL_KINDS[kind] || {};
        const a = {
            id: kind + '-b' + (++world.births), kind, penId,
            x, y, homeX: x, homeY: y, tx: x, ty: y,
            hunger: 18, thirst: 18, health: 100,
            produceTimer: (sk.produceInterval || RATES.produceInterval) * (0.6 + rng() * 0.6),
            alive: true, ageMs: 0, ageStage: 'young', sick: false,
        };
        world.animals.push(a);
        return a;
    }

    // ---- speech channel: the hook the LLM + TTS plug into later -----------
    // say() pushes a line onto the bounded dialog buffer AND, when the speaker
    // is an NPC, sets a transient speech bubble. Later this is where TTS hangs.
    const SPEECH_MS = 3500;
    function say(speakerId, text) {
        world.dialog.unshift({ t: world.clock.t, speaker: speakerId, text });
        if (world.dialog.length > 24) world.dialog.pop();
        const npc = world.npcs.find((n) => n.id === speakerId);
        if (npc) npc.speech = { text, until: world.clock.t + SPEECH_MS };
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

        // Environment: advance season/weather/day-phase and apply passive
        // weather effects (rain watering crops + topping the pool). The mods it
        // produces scale the need/growth integration below.
        stepEnv(world, dt, rng);
        const mods = world.env.mods;

        // Animals: aging, metabolism (per-species), auto-feed/drink, sickness,
        // health, produce.
        for (const a of world.animals) {
            if (!a.alive) continue;
            const sk = ANIMAL_KINDS[a.kind] || {};
            const feed  = world.troughs[a.penId + '-feed'];
            const water = world.troughs[a.penId + '-water'];

            // Aging: young -> adult -> old.
            a.ageMs += dt;
            a.ageStage = ageStageOf(a.ageMs);

            a.hunger = clamp(a.hunger + RATES.hungerRise * mods.hungerMult * (sk.hungerMul || 1) * s, 0, 100);
            a.thirst = clamp(a.thirst + RATES.thirstRise * mods.thirstMult * (sk.thirstMul || 1) * s, 0, 100);

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

            // Health: critical need decays; sickness decays + blocks recovery;
            // otherwise recover when both needs are comfortable.
            const worst = Math.max(a.hunger, a.thirst);
            if (worst > RATES.needCritical) {
                a.health = clamp(a.health - RATES.healthDecay * s, 0, 100);
            } else if (a.hunger < RATES.needComfort && a.thirst < RATES.needComfort && !a.sick) {
                a.health = clamp(a.health + RATES.healthRegen * s, 0, 100);
            }
            if (a.sick) a.health = clamp(a.health - SICK_DECAY * s, 0, 100);
            if (a.health <= 0) {
                a.alive = false;
                pushLog(`${a.id} has died`);
                pushNotice('critical', a.id, `${a.id} ${a.sick ? 'died of illness' : 'has died'}`);
                continue;
            }

            // Illness onset: rare, raised by neglect and harsh weather.
            if (!a.sick) {
                let chance = ILL_BASE;
                if (worst > 50) chance *= 3;
                if (world.env.weather === 'frost' || world.env.weather === 'storm') chance *= 2.5;
                if (rng() < chance * s) {
                    a.sick = true;
                    pushNotice('warning', a.id, `${a.id} fell ill`);
                }
            }

            // Produce: only adults/old, healthy, fed, watered, not sick, by day.
            // Young don't produce yet; old produce at half rate.
            if (a.ageStage !== 'young' && !a.sick && a.health >= RATES.produceMin &&
                a.hunger < 50 && a.thirst < 50 && mods.produceMult > 0) {
                const ageMul = a.ageStage === 'old' ? 0.5 : 1.0;
                a.produceTimer -= s * mods.produceMult * (sk.produceMul || 1) * ageMul;
                if (a.produceTimer <= 0) {
                    world.pens[a.penId].pending += 1;
                    a.produceTimer = sk.produceInterval || RATES.produceInterval;
                }
            }

            wander(a, s, 0.6);
        }

        // Breeding: each pen, on its timer, may birth one young if the herd is
        // healthy + well-fed and below the pen's capacity cap.
        for (const penId of Object.keys(world.pens)) {
            const pen = world.pens[penId];
            pen.breedTimer -= dt;
            if (pen.breedTimer > 0) continue;
            pen.breedTimer = BREED_INTERVAL * (0.8 + 0.4 * rng());
            const herd = world.animals.filter((a) => a.alive && a.penId === penId);
            const adults = herd.filter((a) => a.ageStage !== 'young');
            const thriving = herd.length > 0 && herd.every((a) =>
                a.hunger < 40 && a.thirst < 40 && a.health > 70 && !a.sick);
            if (herd.length < pen.cap && adults.length >= 2 && thriving) {
                const ctr = penCenter(penId);
                const kind = adults[0].kind;
                const baby = spawnAnimal(penId, kind,
                    ctr.x + (rng() * 2 - 1), ctr.y + (rng() * 2 - 1));
                const label = (ANIMAL_KINDS[kind] && ANIMAL_KINDS[kind].label) || kind;
                pushNotice('info', penId, `a ${label.toLowerCase()} was born in the ${pen.label}`);
                say('Farm', `A ${label.toLowerCase()} was born in the ${pen.label}!`);
            }
        }

        // Crops: dry out, grow only while moist, ripen, then spoil if left.
        // Drying/growth are scaled by env (drought dries faster; season/night/
        // storm slow growth; rain sets decay to zero) AND by per-kind growMul/
        // dryMul, so kinds mature and thirst at different rates.
        for (const c of world.crops) {
            if (c.stage === 'empty') continue;
            const kd = CROP_KINDS[c.kind] || {};
            c.moisture = clamp(c.moisture - RATES.moistureDecay * mods.moistureDecayMult * (kd.dryMul || 1) * s, 0, 100);
            if (c.moisture > 0 && c.stage !== 'ripe') {
                c.growth = clamp(c.growth + RATES.growthRate * mods.growthMult * (kd.growMul || 1) * s, 0, 100);
            }
            if (c.stage === 'seed' && c.growth >= RATES.growGrowing) c.stage = 'growing';
            if (c.stage !== 'ripe' && c.growth >= RATES.growRipe) {
                c.stage = 'ripe';
                c.ripeTimer = kd.spoilMs || 20000;   // start the spoilage window
            }
            // Spoilage: a ripe crop left unharvested rots and is lost.
            if (c.stage === 'ripe' && c.ripeTimer != null) {
                c.ripeTimer -= dt;
                if (c.ripeTimer <= 0) {
                    pushNotice('warning', c.id, `${c.kind} in ${c.id} rotted, unharvested`);
                    pushLog(`${c.kind} in ${c.id} rotted`);
                    c.kind = null; c.stage = 'empty'; c.growth = 0; c.moisture = 0; c.ripeTimer = null;
                }
            }
        }

        // NPCs: task executor (app.js) drives any npc with a task; the ones
        // without one fall back to a gentle idle wander. Expire speech bubbles.
        for (const n of world.npcs) {
            if (n.speech && world.clock.t >= n.speech.until) n.speech = null;
            if (n.task) continue;   // advanceTask() owns tasked npcs
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
            id: a.id, kind: a.kind, species: a.kind, penId: a.penId,
            hunger: r1(a.hunger), thirst: r1(a.thirst),
            health: r1(a.health), alive: a.alive,
            age: a.ageStage, sick: !!a.sick,
        }));
        const crops = world.crops.map((c) => {
            const kd = CROP_KINDS[c.kind] || {};
            return {
                id: c.id, plotIndex: c.plotIndex, kind: c.kind,
                stage: c.stage, growth: r1(c.growth), moisture: r1(c.moisture),
                value: kd.gold || 0,
                spoilIn: (c.stage === 'ripe' && c.ripeTimer != null) ? Math.max(0, Math.round(c.ripeTimer)) : null,
            };
        });
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
            env: envObserve(world.env),
            animals, crops, troughs, npcs, resources, pending,
            alerts: deriveAlerts(animals, crops, troughs, resources)
                .concat(envAlerts(world.env))
                .concat(activeNotices()),
        };
    }

    // Event notices still within their lifetime, as alert-shaped objects.
    function activeNotices() {
        return world.notices
            .filter((n) => world.clock.t < n.until)
            .map((n) => ({ level: n.level, who: n.who, msg: n.msg }));
    }

    function deriveAlerts(animals, crops, troughs, resources) {
        const alerts = [];
        for (const a of animals) {
            if (!a.alive) { alerts.push({ level: 'critical', who: a.id, msg: `${a.id} has died` }); continue; }
            if (a.sick) alerts.push({ level: a.health < 35 ? 'critical' : 'warning', who: a.id, msg: `${a.id} is sick` });
            if (a.thirst >= 75) alerts.push({ level: 'critical', who: a.id, msg: `${a.id} thirst critical` });
            else if (a.hunger >= 75) alerts.push({ level: 'critical', who: a.id, msg: `${a.id} hunger critical` });
            if (a.health < 40 && !a.sick) alerts.push({ level: 'warning', who: a.id, msg: `${a.id} health low` });
        }
        for (const t of troughs) {
            if (t.fill <= 5) alerts.push({ level: 'critical', who: t.id, msg: `${t.penId} ${t.kind} trough empty` });
            else if (t.fill < 20) alerts.push({ level: 'warning', who: t.id, msg: `${t.penId} ${t.kind} trough low` });
        }
        for (const c of crops) {
            if (c.stage === 'ripe') {
                if (c.spoilIn != null && c.spoilIn < 8000) alerts.push({ level: 'warning', who: c.id, msg: `${c.id} about to rot` });
                else alerts.push({ level: 'info', who: c.id, msg: `${c.id} ready to harvest` });
            } else if (c.stage !== 'empty' && c.moisture < 15) {
                alerts.push({ level: 'warning', who: c.id, msg: `${c.id} needs water` });
            }
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
            // Season gate: only in-season kinds will take.
            if (!world.env.plantable.includes(kind)) return { ok: false, reason: 'out of season' };
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
            c.kind = null; c.stage = 'empty'; c.growth = 0; c.moisture = 0; c.ripeTimer = null;
            pushLog(`harvested ${kind} (+${gold}g)`);
            return { ok: true, kind, gold };
        },
        // Tend a sick animal back toward health (cures the illness).
        tendAnimal(animalId) {
            const a = world.animals.find((x) => x.id === animalId);
            if (!a) return { ok: false, reason: 'no such animal' };
            if (!a.alive) return { ok: false, reason: 'animal dead' };
            if (!a.sick) return { ok: false, reason: 'not sick' };
            a.sick = false;
            a.health = Math.min(100, a.health + 15);
            pushLog(`tended ${animalId}`);
            return { ok: true, health: a.health };
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
    world.say = say;
    return world;
}
