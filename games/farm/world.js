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
    CROP_KINDS, WORKER, FOREMAN_STATS, PEN_CARE, CROP_CARE,
    makeStatSheet, awardStatXp, staminaMaxFor, staminaDrainMul, moveSpeedMul,
    healthMaxFor, healthRegenMul, hydrationDrainMul,
    STAT_XP, STAT_LABEL,
} from './defs.js';
import { createEnv, stepEnv, envObserve, envAlerts } from './env.js';
import { createMarket, stepMarket, marketObserve, marketAlerts } from './market.js';

// ---- life-cycle tuning ------------------------------------------------------
const YOUNG_MS = 45000;     // age below which an animal is 'young' (no produce)
const OLD_MS   = 330000;    // age at/after which it's 'old' (reduced produce)
const BREED_INTERVAL = 35000;   // ms between a pen's breeding checks
const ILL_BASE = 0.0010;    // baseline per-second chance an animal falls sick
const SICK_DECAY = 1.5;     // health/s lost while sick (and recovery is blocked)
const NOTICE_MS = 12000;    // how long event notices (rot/birth/illness) stay up

// ---- economy tuning ---------------------------------------------------------
const SEED_COST = 3;        // gold deducted when a seed is sown
const BARN_LOW  = 220;      // barnFeed below this -> "buy more" alert
const WELL = { level: 450, cap: 600, regen: 30 };   // renewable water source

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
        market: createMarket(),   // fluctuating prices (market.js)
        well: { ...WELL },        // renewable, rate-limited water source
        // The goal the orchestrator (and later an LLM) optimizes toward.
        objective: { type: 'gold', target: 1500, deadlineDay: 8 },
        births: 0,        // running count for unique offspring ids
        notices: [],      // transient event alerts: { level, who, msg, until }
        log: [],          // recent action results (most recent first)
        dialog: [],       // recent spoken lines: { t, speaker, text } (most recent first)
        // The Foreman: a real, stationary entity (a command post), not just a
        // dialog label. Posted central in the open yard between the field (ends
        // x21) and the pens (start x24), below the barn/well row — central to the
        // survival-critical well/barn -> trough service path so briefing detours
        // stay short. Workers walk here to be briefed before any job (tasks.js).
        foreman: { id: 'Foreman', name: 'Foreman', role: 'foreman', x: 22, y: 12, speech: null,
                   stats: makeStatSheet(FOREMAN_STATS) },
        // Day boundary tracker for the daily stat trickle (vitality/endurance).
        _statDay: 1,
        // Currently inspected entity id (npc id / 'Foreman' / 'You') for the
        // click-to-inspect stat-sheet panel + its on-board selection ring.
        inspect: null,
        // Conversation floor — a single global "talking stick" so spoken NPC
        // exchanges happen ONE at a time and workers take turns. A worker that
        // has reached a say step requests the floor; it's granted in arrival
        // order (FIFO). Until granted, the worker stands and waits its turn, so
        // two briefings never overlap and each NPC's spoken timing lines up with
        // its OWN line instead of elapsing while someone else is being spoken to.
        conversation: { holder: null, waiting: [] },
    };

    // Pens + their pending (uncollected) produce, capacity cap, and breed timer.
    for (const penId of Object.keys(PENS)) {
        const p = PENS[penId];
        world.pens[penId] = { ...p, pending: 0, cap: p.cap ?? 8, breedTimer: BREED_INTERVAL,
                              cleanliness: 85 };   // station-detail: decays, drives illness
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
            weeds: 0,   // station-detail: climbs while planted, slows growth
        });
    }

    for (const n of NPC_SPECS) {
        const npc = {
            id: n.id, name: n.name, role: n.role, voice: n.voice,
            x: n.home.x, y: n.home.y,
            tx: n.home.x, ty: n.home.y,
            home: { ...n.home },
            state: 'idle', carrying: null, task: null, speech: null,
            // Persistent stat sheet — grows from work (tasks.js), drives the
            // meters/movement below (the coupling).
            stats: makeStatSheet(n.stats),
            // Labor depth: stamina drains with work, energy is the daily meal
            // need, hydration is the water need (drains faster in heat), health is
            // the Vitality-driven resilience meter. Stamina CAPACITY scales with
            // Endurance and health CAPACITY with Vitality, so start each full at cap.
            stamina: 100, energy: 100, hydration: 100, health: 100,
            speed: n.speed != null ? n.speed : 1.0,
        };
        npc.stamina = staminaMaxFor(npc);
        npc.health = healthMaxFor(npc);
        world.npcs.push(npc);
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
        // The Foreman is an entity too, so his lines get a speech bubble over the
        // command post (he isn't in world.npcs).
        else if (world.foreman && world.foreman.id === speakerId) {
            world.foreman.speech = { text, until: world.clock.t + SPEECH_MS };
        }
    }

    // ---- conversation floor: turn-taking for spoken exchanges --------------
    // Only ONE briefing exchange is "on the floor" at a time. The say task step
    // (tasks.js) requests the floor when a worker reports in; it's granted in
    // arrival order. A worker not yet granted stands and waits — it does not
    // begin its utterance or its timer — so exchanges never overlap. The floor
    // is held across the whole exchange (the Foreman's order + the worker's ack)
    // and released when the say-run ends or the task finishes/aborts.
    function convRequest(id) {
        const c = world.conversation;
        if (c.holder === id) return true;
        if (!c.waiting.includes(id)) c.waiting.push(id);
        if (c.holder == null && c.waiting[0] === id) {
            c.waiting.shift();
            c.holder = id;
            return true;
        }
        return false;
    }
    function convRelease(id) {
        const c = world.conversation;
        if (c.holder === id) c.holder = null;
        c.waiting = c.waiting.filter((x) => x !== id);
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

        // Daily stat trickle: a worker who lives another day gains a little
        // Vitality (the reserved health stat) and Endurance for the sustained
        // grind. Keeps Vitality growing without coupling it to anything yet.
        if (world.clock.day !== world._statDay) {
            world._statDay = world.clock.day;
            for (const n of world.npcs) {
                awardWork(n, [['vitality', STAT_XP.vitality], ['endurance', STAT_XP.endurance * 0.5]]);
            }
        }

        // Environment: advance season/weather/day-phase and apply passive
        // weather effects (rain watering crops + topping the pool). The mods it
        // produces scale the need/growth integration below.
        stepEnv(world, dt, rng);
        const mods = world.env.mods;

        // Economy: drift market prices; the well slowly refills (rain adds more
        // in stepEnv) up to its cap — water is renewable but rate-limited.
        stepMarket(world, dt, rng);
        world.well.level = Math.min(world.well.cap, world.well.level + world.well.regen * s);

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

            a.hunger = clamp(a.hunger + RATES.hungerRise * mods.hungerMult * mods.needMult * (sk.hungerMul || 1) * s, 0, 100);
            a.thirst = clamp(a.thirst + RATES.thirstRise * mods.thirstMult * mods.needMult * (sk.thirstMul || 1) * s, 0, 100);

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
                // A filthy pen breeds illness — the muck-out chore keeps it down.
                const pen = world.pens[a.penId];
                if (pen && pen.cleanliness < PEN_CARE.filthy) chance *= PEN_CARE.illnessMul;
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
            // Cleanliness decays with time + herd size; a muck-out chore restores
            // it. Low cleanliness raises the illness chance (animal loop above).
            const herdN = world.animals.reduce((acc, a) => acc + (a.alive && a.penId === penId ? 1 : 0), 0);
            pen.cleanliness = clamp(pen.cleanliness - (PEN_CARE.cleanDecay + PEN_CARE.cleanPerHead * herdN) * s, 0, 100);
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
            // Weeds climb while planted and choke growth until pulled (weed chore).
            if (c.weeds == null) c.weeds = 0;
            c.weeds = clamp(c.weeds + CROP_CARE.weedRise * s, 0, 100);
            if (c.moisture > 0 && c.stage !== 'ripe') {
                const weedMul = 1 - (c.weeds / 100) * (1 - CROP_CARE.weedGrowthMin);
                c.growth = clamp(c.growth + RATES.growthRate * mods.growthMult * (kd.growMul || 1) * weedMul * s, 0, 100);
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
                    c.kind = null; c.stage = 'empty'; c.growth = 0; c.moisture = 0; c.ripeTimer = null; c.weeds = 0;
                }
            }
        }

        // NPCs: task executor (app.js) drives any npc with a task; the ones
        // without one fall back to a gentle idle wander. Expire speech bubbles
        // and integrate worker stamina/energy from the current state.
        for (const n of world.npcs) {
            if (n.speech && world.clock.t >= n.speech.until) n.speech = null;
            updateWorkerVitals(n, s);
            if (n.task) continue;   // advanceTask() owns tasked npcs
            wanderNpc(n, s);
        }
        if (world.foreman && world.foreman.speech && world.clock.t >= world.foreman.speech.until) {
            world.foreman.speech = null;
        }
    }

    // Stamina/energy dynamics keyed off the worker's state (set by the task
    // executor). Active states drain; rest/sleep/eat recover. Endurance drives
    // BOTH the cap (sMax) the bar fills to AND the drain rate (drainMul slows it),
    // so a high-Endurance worker has a deeper reserve that empties more slowly.
    function updateWorkerVitals(n, s) {
        const sMax = staminaMaxFor(n);
        const hMax = healthMaxFor(n);
        const drainMul = staminaDrainMul(n);
        const hydrMul = hydrationDrainMul(n);
        if (n.hydration == null) n.hydration = 100;
        if (n.health == null) n.health = hMax;
        // Heat raises thirst: temperature above heatBaseTemp scales the hydration
        // drain up. world.env.temperature already folds in season (summer is hot)
        // AND weather (drought adds, frost subtracts), so one signal covers both.
        const temp = (world.env && world.env.temperature != null) ? world.env.temperature : 18;
        const heatMul = 1 + Math.max(0, temp - WORKER.heatBaseTemp) * WORKER.heatThirstPerDeg;
        const idleThirst = WORKER.hydrationIdle * hydrMul * heatMul * s;
        switch (n.state) {
            case 'sleeping':
                n.stamina = clamp(n.stamina + WORKER.sleepRecover * s, 0, sMax);
                n.energy  = clamp(n.energy  + WORKER.sleepRecover * s, 0, 100);
                n.hydration = clamp(n.hydration - idleThirst * 0.5, 0, 100);   // barely thirsts asleep
                break;
            case 'recovering':   // consolidated home care: rest + eat + drink at once
                n.stamina = clamp(n.stamina + WORKER.restRecover * s, 0, sMax);
                n.energy  = clamp(n.energy  + WORKER.eatEnergy * s, 0, 100);
                n.hydration = clamp(n.hydration + WORKER.drinkRecover * s, 0, 100);
                break;
            case 'resting':
                n.stamina = clamp(n.stamina + WORKER.restRecover * s, 0, sMax);
                n.energy  = clamp(n.energy  - WORKER.energyIdle * s, 0, 100);
                n.hydration = clamp(n.hydration - idleThirst, 0, 100);
                break;
            case 'eating':
                n.stamina = clamp(n.stamina + WORKER.eatStamina * s, 0, sMax);
                n.energy  = clamp(n.energy  + WORKER.eatEnergy * s, 0, 100);
                n.hydration = clamp(n.hydration + WORKER.drinkRecover * s, 0, 100);
                break;
            case 'walking':
            case 'working':
                n.stamina = clamp(n.stamina - WORKER.staminaDrain * drainMul * s, 0, sMax);
                n.energy  = clamp(n.energy  - WORKER.energyDrain * s, 0, 100);
                n.hydration = clamp(n.hydration - WORKER.hydrationDrain * hydrMul * heatMul * s, 0, 100);
                break;
            default: // idle (also talking/listening during a briefing)
                n.stamina = clamp(n.stamina + WORKER.idleRecover * s, 0, sMax);
                n.energy  = clamp(n.energy  - WORKER.energyIdle * s, 0, 100);
                n.hydration = clamp(n.hydration - idleThirst, 0, 100);
                break;
        }

        // Health: FLOORED so a worker can never die or be lost. It decays slowly
        // while a core need (hydration / energy / stamina) is held critical AND the
        // worker isn't being cared for; otherwise it recovers (faster at a home
        // recover visit) at a rate scaled by Vitality. A worker who is critical but
        // already being cared for gets a grace window (holds steady) while the care
        // pulls the need back up.
        const caring = n.state === 'recovering' || n.state === 'resting' ||
                       n.state === 'eating' || n.state === 'sleeping';
        const critNeed = n.hydration <= WORKER.healthCritHydration ||
                         n.energy    <= WORKER.healthCritEnergy ||
                         n.stamina   <= WORKER.healthCritStamina;
        if (critNeed && !caring) {
            n.health = clamp(n.health - WORKER.healthDecay * s, WORKER.healthFloor, hMax);
        } else if (!critNeed) {
            const rate = WORKER.healthRegen * healthRegenMul(n) * (caring ? WORKER.healthCareBonus : 1);
            n.health = clamp(n.health + rate * s, WORKER.healthFloor, hMax);
        }
    }

    // Grant work XP across one or more stats and surface a notice on any level-up.
    // awards: array of [statKey, amount]. The single seam tasks.js calls so all
    // XP + level-up announcements stay centralized here.
    function awardWork(n, awards) {
        if (!n || !n.stats) return;
        for (const [key, amt] of awards) {
            const leveled = awardStatXp(n, key, amt);
            if (leveled) {
                pushNotice('info', n.id, `${n.name}'s ${STAT_LABEL[leveled]} rose to ${n.stats[leveled].level}`);
            }
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
            const sp = 1.2 * moveSpeedMul(n) * s;   // Agility quickens even idle wander
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
                weeds: r1(c.weeds || 0),
                value: kd.gold || 0,
                spoilIn: (c.stage === 'ripe' && c.ripeTimer != null) ? Math.max(0, Math.round(c.ripeTimer)) : null,
            };
        });
        const troughs = Object.values(world.troughs).map((t) => ({
            id: t.id, penId: t.penId, kind: t.kind, fill: r1(t.fill),
        }));
        const npcs = world.npcs.map((n) => ({
            id: n.id, name: n.name, role: n.role, busy: n.task != null,
            station: n.station || null,   // the station this worker is assigned to
            state: n.state === 'walking' ? 'working' : n.state,   // idle|working|resting|sleeping|eating|recovering
            stamina: r1(n.stamina), energy: r1(n.energy),
            hydration: r1(n.hydration), health: r1(n.health),
            staminaMax: r1(staminaMaxFor(n)),   // bar fills against this Endurance-driven cap
            healthMax: r1(healthMaxFor(n)),     // health bar fills against this Vitality-driven cap
        }));
        const resources = {};
        for (const k of Object.keys(world.resources)) resources[k] = r1(world.resources[k]);
        const pending = {};
        const pens = {};
        for (const penId of Object.keys(world.pens)) {
            const p = world.pens[penId];
            pending[penId] = p.pending;
            pens[penId] = { pending: p.pending, cleanliness: r1(p.cleanliness), cap: p.cap };
        }

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
            market: marketObserve(world),
            barnFeed: r1(world.resources.barnFeed),
            well: { level: r1(world.well.level), cap: world.well.cap },
            inventory: { eggs: resources.eggs, milk: resources.milk, wool: resources.wool, crops: resources.crops },
            objective: {
                type: world.objective.type,
                target: world.objective.target,
                progress: resources.gold,
                deadlineDay: world.objective.deadlineDay,
                met: resources.gold >= world.objective.target,
            },
            animals, crops, troughs, npcs, resources, pending, pens,
            alerts: deriveAlerts(animals, crops, troughs, resources)
                .concat(envAlerts(world.env))
                .concat(marketAlerts(world))
                .concat(laborAlerts())
                .concat(activeNotices()),
        };
    }

    // Labor availability alerts: exhausted / hungry workers, and a short-handed
    // night warning when too few workers are awake-and-able.
    function laborAlerts() {
        const out = [];
        let available = 0;
        for (const n of world.npcs) {
            if (n.stamina < WORKER.exhausted) out.push({ level: 'warning', who: n.id, msg: `${n.name} is exhausted` });
            if (n.energy < WORKER.hungry) out.push({ level: 'warning', who: n.id, msg: `${n.name} is hungry` });
            if (n.hydration < WORKER.thirsty) out.push({ level: 'warning', who: n.id, msg: `${n.name} is thirsty` });
            if (n.health < WORKER.weakened) {
                const crit = n.health < WORKER.healthForce;
                out.push({ level: crit ? 'critical' : 'warning', who: n.id,
                           msg: `${n.name} is ${crit ? 'unwell' : 'run down'}` });
            }
            const able = n.stamina >= WORKER.staminaRest && n.energy >= WORKER.energyEat &&
                n.hydration >= WORKER.thirstDrink && n.health >= WORKER.healthForce &&
                n.state !== 'sleeping' && n.state !== 'resting' &&
                n.state !== 'eating' && n.state !== 'recovering';
            if (able) available++;
        }
        if (world.env.dayPhase === 'night' && available < 1) {
            out.push({ level: 'warning', who: 'labor', msg: 'short-handed at night' });
        }
        return out;
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
        if (resources.feed < 40)  alerts.push({ level: 'warning', who: 'feedpool', msg: 'feed pool low' });
        if (resources.water < 40) alerts.push({ level: 'warning', who: 'waterpool', msg: 'water pool low' });
        // Economy pressure. "Broke" = barn empty and not enough gold to restock
        // a meaningful amount of feed.
        const feedPrice = world.market.prices.feed || 0.25;
        if (resources.barnFeed <= 0 && resources.gold < feedPrice * 50) {
            alerts.push({ level: 'critical', who: 'economy', msg: 'broke — can\'t afford feed' });
        } else if (resources.barnFeed < BARN_LOW) {
            alerts.push({ level: 'warning', who: 'barn', msg: 'barn feed low — buy more' });
        }
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

        // Draw water from the WELL into the working water pool. Capped by the
        // well's current level — the well is renewable but finite per moment.
        drawWater(units = 50) {
            const avail = Math.min(units, world.well.level);
            if (avail <= 0) return { ok: false, reason: 'well dry', drawn: 0 };
            world.well.level -= avail;
            world.resources.water += avail;
            pushLog(`drew ${Math.round(avail)} water from well`);
            return { ok: true, drawn: avail, water: world.resources.water, partial: avail < units };
        },
        // Load feed from the finite BARN STOCK into the working feed pool. If
        // barnFeed is short it loads what's there; empty barn -> failure.
        loadFeed(units = 50) {
            const avail = Math.min(units, world.resources.barnFeed);
            if (avail <= 0) return { ok: false, reason: 'barn empty', loaded: 0 };
            world.resources.barnFeed -= avail;
            world.resources.feed += avail;
            pushLog(`loaded ${Math.round(avail)} feed from barn`);
            return { ok: true, loaded: avail, feed: world.resources.feed, partial: avail < units };
        },

        // Plant a seed into an empty plot (costs a small seed fee).
        plant(plotIndex, kind = 'wheat') {
            const c = world.crops.find((x) => x.plotIndex === plotIndex);
            if (!c) return { ok: false, reason: 'no such plot' };
            if (c.stage !== 'empty') return { ok: false, reason: 'plot occupied' };
            // Season gate: only in-season kinds will take.
            if (!world.env.plantable.includes(kind)) return { ok: false, reason: 'out of season' };
            if (world.resources.gold < SEED_COST) return { ok: false, reason: 'no gold for seed' };
            world.resources.gold -= SEED_COST;
            c.kind = kind; c.stage = 'seed'; c.growth = 0; c.moisture = 60; c.weeds = 0;
            pushLog(`planted ${kind} in plot ${plotIndex} (-${SEED_COST}g)`);
            return { ok: true, cropId: c.id, cost: SEED_COST };
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
        // Harvest a ripe crop: clears the plot, banks the good into INVENTORY
        // (sold later at market — no auto-gold).
        harvest(cropId) {
            const c = world.crops.find((x) => x.id === cropId);
            if (!c) return { ok: false, reason: 'no such crop' };
            if (c.stage !== 'ripe') return { ok: false, reason: 'not ripe' };
            const kind = c.kind;
            world.resources.crops += 1;
            c.kind = null; c.stage = 'empty'; c.growth = 0; c.moisture = 0; c.ripeTimer = null; c.weeds = 0;
            pushLog(`harvested ${kind}`);
            return { ok: true, kind };
        },
        // Muck out a pen: reset its cleanliness to full (the rancher's recurring
        // station chore; a clean pen keeps illness down — see the animal loop).
        muckOut(penId) {
            const pen = world.pens[penId];
            if (!pen) return { ok: false, reason: 'no such pen' };
            if (pen.cleanliness >= 95) return { ok: false, reason: 'already clean' };
            pen.cleanliness = PEN_CARE.muckRestore;
            pushLog(`mucked out the ${pen.label}`);
            return { ok: true, cleanliness: pen.cleanliness };
        },
        // Pull the weeds on a planted plot (the gardener's recurring station
        // chore; weeds choke growth until cleared — see the crop loop).
        weedPlot(cropId) {
            const c = world.crops.find((x) => x.id === cropId);
            if (!c) return { ok: false, reason: 'no such crop' };
            if (c.stage === 'empty') return { ok: false, reason: 'nothing planted' };
            if ((c.weeds || 0) < 15) return { ok: false, reason: 'no weeds' };
            c.weeds = Math.max(0, c.weeds - CROP_CARE.weedClear);
            pushLog(`weeded ${cropId}`);
            return { ok: true, weeds: c.weeds };
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
        // Collect a pen's uncollected produce into INVENTORY (sold at market
        // later — no auto-gold).
        collectProduce(penId) {
            const pen = world.pens[penId];
            if (!pen) return { ok: false, reason: 'no such pen' };
            const n = pen.pending;
            if (n <= 0) return { ok: false, reason: 'nothing to collect', collected: 0 };
            world.resources[pen.good] += n;
            pen.pending = 0;
            pushLog(`collected ${n} ${pen.good}`);
            return { ok: true, good: pen.good, collected: n };
        },

        // ---- market (instant management transactions) -----------------------
        // Sell inventory of a good at the current market price -> gold.
        sell(good, units) {
            if (world.resources[good] == null || good === 'feed' || good === 'gold' ||
                good === 'barnFeed' || good === 'water') {
                return { ok: false, reason: 'not sellable' };
            }
            const have = world.resources[good];
            const n = (units == null) ? have : Math.min(units, have);
            if (n <= 0) return { ok: false, reason: 'nothing to sell', sold: 0 };
            const price = world.market.prices[good] || 0;
            const gold = Math.round(n * price);
            world.resources[good] -= n;
            world.resources.gold += gold;
            pushLog(`sold ${n} ${good} (+${gold}g)`);
            return { ok: true, good, sold: n, gold, price };
        },
        // Buy feed (-> barnFeed) or a young animal for a pen under cap. Spends
        // gold; partial-buys feed if gold is short rather than failing outright.
        buy(item, arg) {
            if (item === 'feed') {
                const price = world.market.prices.feed || 0.2;
                let n = (arg == null) ? 200 : arg;
                const maxAfford = Math.floor(world.resources.gold / price);
                if (maxAfford <= 0) return { ok: false, reason: 'cant afford feed', bought: 0 };
                if (n > maxAfford) n = maxAfford;
                const cost = Math.round(n * price);
                world.resources.gold -= cost;
                world.resources.barnFeed += n;
                pushLog(`bought ${n} feed (-${cost}g)`);
                return { ok: true, item: 'feed', bought: n, cost, partial: arg != null && n < arg };
            }
            if (item === 'animal') {
                const price = world.market.prices.animal || 90;
                if (world.resources.gold < price) return { ok: false, reason: 'cant afford animal' };
                // Pick the pen (arg) or the first pen under cap.
                let penId = arg;
                if (!penId || !world.pens[penId]) {
                    penId = Object.keys(world.pens).find((p) =>
                        world.animals.filter((a) => a.alive && a.penId === p).length < world.pens[p].cap);
                }
                if (!penId) return { ok: false, reason: 'no pen has room' };
                const pen = world.pens[penId];
                const herd = world.animals.filter((a) => a.alive && a.penId === penId);
                if (herd.length >= pen.cap) return { ok: false, reason: 'pen full' };
                const kind = (herd[0] && herd[0].kind) ||
                    (penId === 'coop' ? 'chicken' : penId === 'meadow' ? 'sheep' : 'cow');
                const ctr = penCenter(penId);
                world.resources.gold -= Math.round(price);
                const baby = spawnAnimal(penId, kind, ctr.x + (rng() * 2 - 1), ctr.y + (rng() * 2 - 1));
                pushLog(`bought a ${kind} for ${penId} (-${Math.round(price)}g)`);
                return { ok: true, item: 'animal', kind, penId, id: baby.id, cost: Math.round(price) };
            }
            return { ok: false, reason: 'unknown item' };
        },
    };

    world.step = step;
    world.observe = observe;
    world.actions = actions;
    world.say = say;
    world.awardWork = awardWork;   // XP seam the task executor (tasks.js) calls
    world.convRequest = convRequest;   // conversation-floor seam (tasks.js say step)
    world.convRelease = convRelease;
    return world;
}
