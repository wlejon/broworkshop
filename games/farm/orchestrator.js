// orchestrator.js — THE SWAPPABLE SEAM.
//
// This is a rule-based stand-in for a future LLM orchestrator. It is isolated
// behind a tiny interface so the LLM version drops in unchanged:
//
//   const orch = createOrchestrator();
//   orch.decide(world);   // reads world.observe(), assigns tasks to idle NPCs,
//                         // and speaks instructions through world.say().
//
// decide() is the ENTIRE contract. The LLM version keeps the same signature:
// read observe(), emit task objects (see tasks.js), set npc.task, and call
// world.say(speakerId, text). It owns no other state the caller depends on.
//
// Rules: prioritize by need severity, never double-assign the same target
// (in-flight goals are read back off the NPCs themselves), and softly prefer
// NPCs by role — but let any idle worker take any job when needed.

import {
    buildServiceWaterTrough, buildServiceFeedTrough,
    buildHarvest, buildWaterCrop, buildPlant, buildCollectProduce, buildTend,
    buildSleep, buildRecover, prependBriefing,
} from './tasks.js';
import { WORKER } from './defs.js';

const BOSS = 'Foreman';   // orchestrator's speaker label in the dialog feed

// Short, varied templates. flavor only — proves the speaking channel before
// the LLM exists. {name} = worker, {what} = subject.
const TEMPLATES = {
    water: [
        '{name}, the {what} are thirsty — top up their water.',
        '{name}, water trough\'s low at the {what}. Go fill it.',
        'Need water at the {what}, {name}.',
    ],
    feed: [
        '{name}, feed\'s running low at the {what} — restock it.',
        '{name}, the {what} need feeding.',
        'Load up some feed for the {what}, {name}.',
    ],
    harvest: [
        '{name}, {what} is ripe — bring it in.',
        '{name}, get that {what} harvested.',
        'Harvest time, {name}: {what}.',
    ],
    waterCrop: [
        '{name}, {what} is parched — give it a drink.',
        '{name}, water {what} before it wilts.',
    ],
    plant: [
        '{name}, sow {what} while there\'s daylight.',
        '{name}, that bed\'s empty — plant {what}.',
    ],
    collect: [
        '{name}, go collect the {what}.',
        '{name}, {what} are piling up — gather them.',
    ],
    tend: [
        '{name}, {what} is sick — go tend to it, quick.',
        '{name}, see to {what}, the poor thing\'s unwell.',
        'Drop what you\'re doing, {name} — {what} needs tending.',
    ],
};

const ACKS = ['On it.', 'Right away.', 'Heading over.', 'Got it.', 'Will do.'];

// ---- economic policy (instant management transactions) ----------------------
// This is the buy/sell layer the LLM will later replace. It runs each decide()
// tick alongside physical job assignment: realize produce for gold (preferring
// high prices) and keep the barn stocked, always holding back a gold reserve so
// the farm never bankrupts itself into starvation.
// Feed is the lifeline: keep only a THIN gold reserve so the barn is always
// restockable (a large reserve that blocks feed-buying would itself starve the
// herd). Feed is cheap, so a thin reserve still buys plenty of stock.
const GOLD_RESERVE = 40;    // small floor; feed-buying spends down to here
const BARN_TARGET  = 600;   // restock barn up to here
const BARN_LOW     = 250;   // restock when barnFeed dips under here
const SELL_PILE    = 6;     // sell a good once inventory reaches this, any price
const ANIMAL_BUY_GOLD = 600;   // only expand the herd when comfortably flush
const SELLABLE = ['eggs', 'milk', 'wool', 'crops'];

function manageEconomy(world, o) {
    const r = world.resources;

    // Sell produce whenever the price is high or inventory is piling up.
    for (const good of SELLABLE) {
        const units = r[good];
        if (units <= 0) continue;
        if (o.market.level[good] === 'high' || units >= SELL_PILE) {
            const res = world.actions.sell(good);
            if (res.ok && res.gold >= 25) {
                world.say(BOSS, `Sold ${res.sold} ${good} at ${res.price.toFixed(1)}g — ${res.gold}g in.`);
            }
        }
    }

    // Buy feed when the barn runs low — the priority spend, down to the reserve.
    if (r.barnFeed < BARN_LOW && r.gold > GOLD_RESERVE) {
        const price = world.market.prices.feed || 0.25;
        const want = Math.min(BARN_TARGET - r.barnFeed, Math.floor((r.gold - GOLD_RESERVE) / price));
        if (want > 0) {
            const res = world.actions.buy('feed', want);
            if (res.ok && res.cost >= 15) world.say(BOSS, `Bought ${res.bought} feed for ${res.cost}g.`);
        }
    }

    // Expand the herd only when very flush and a pen has room.
    if (r.gold > ANIMAL_BUY_GOLD) {
        const room = Object.keys(world.pens).find((p) =>
            world.animals.filter((a) => a.alive && a.penId === p).length < world.pens[p].cap);
        if (room) {
            const res = world.actions.buy('animal', room);
            if (res.ok) world.say(BOSS, `Bought a ${res.kind} for the ${room} — ${res.cost}g.`);
        }
    }
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function fill(tmpl, name, what) {
    return tmpl.replace('{name}', name).replace('{what}', what);
}

// Soft role affinity: rancher -> animals/troughs/produce, gardener -> crops.
// farmhand is a generalist. Score is only a tiebreaker; any idle npc qualifies.
function roleScore(npc, jobRole) {
    if (npc.role === jobRole) return 2;
    if (npc.role === 'farmhand') return 1;   // generalist, always willing
    return 0;
}

export function createOrchestrator() {
    // Build the candidate job list from a snapshot. Each job carries enough to
    // build the task, dedup it, speak about it, and prioritize it.
    function computeJobs(world, o) {
        const jobs = [];
        const animalsByPen = {};
        for (const a of o.animals) {
            if (!a.alive) continue;
            (animalsByPen[a.penId] || (animalsByPen[a.penId] = [])).push(a);
        }
        const troughByPenKind = {};
        for (const t of o.troughs) troughByPenKind[t.penId + ':' + t.kind] = t.fill;

        // Pens: water + feed service, driven by trough level AND animal need.
        for (const penId of Object.keys(animalsByPen)) {
            const herd = animalsByPen[penId];
            const maxThirst = Math.max(...herd.map((a) => a.thirst));
            const maxHunger = Math.max(...herd.map((a) => a.hunger));
            const waterFill = troughByPenKind[penId + ':water'] ?? 100;
            const feedFill = troughByPenKind[penId + ':feed'] ?? 100;
            const subject = penLabelLower(world, penId);

            if (maxThirst >= 60 || waterFill < 35) {
                jobs.push({
                    goal: 'service-water:' + penId, target: 'water:' + penId,
                    role: 'rancher', kind: 'water', subject,
                    priority: maxThirst + (waterFill < 12 ? 50 : 0) + 20,
                    build: () => buildServiceWaterTrough(world, penId),
                });
            }
            if (maxHunger >= 60 || feedFill < 35) {
                jobs.push({
                    goal: 'service-feed:' + penId, target: 'feed:' + penId,
                    role: 'rancher', kind: 'feed', subject,
                    priority: maxHunger + (feedFill < 12 ? 50 : 0) + 15,
                    build: () => buildServiceFeedTrough(world, penId),
                });
            }
        }

        // Sick animals: tend them — high priority, rises as health falls.
        for (const a of o.animals) {
            if (a.alive && a.sick) {
                jobs.push({
                    goal: 'tend:' + a.id, target: 'tend:' + a.id,
                    role: 'rancher', kind: 'tend', subject: a.id,
                    priority: 88 + (a.health < 35 ? 25 : 0),
                    build: () => buildTend(world, a.id),
                });
            }
        }

        // Crops: harvest ripe (sooner as spoilage nears), water dry, plant empty.
        const sow = o.env && o.env.plantable.length ? o.env.plantable[0] : null;
        for (const c of o.crops) {
            if (c.stage === 'ripe') {
                const urgent = c.spoilIn != null && c.spoilIn < 10000;
                const veryUrgent = c.spoilIn != null && c.spoilIn < 5000;
                jobs.push({
                    goal: 'harvest:' + c.id, target: 'crop:' + c.id,
                    role: 'gardener', kind: 'harvest', subject: c.kind + ' (' + c.id + ')',
                    priority: 58 + (veryUrgent ? 45 : urgent ? 22 : 0),
                    build: () => buildHarvest(world, c.id),
                });
            } else if (c.stage === 'empty' && sow) {
                // Sow whatever's in season (skip entirely out of season so the
                // plant action doesn't just abort and churn workers).
                jobs.push({
                    goal: 'plant:' + c.plotIndex, target: 'plot:' + c.plotIndex,
                    role: 'gardener', kind: 'plant', subject: sow,
                    priority: 22,
                    build: () => buildPlant(world, c.plotIndex, sow),
                });
            } else if (c.moisture < 25) {
                jobs.push({
                    goal: 'water-crop:' + c.id, target: 'crop:' + c.id,
                    role: 'gardener', kind: 'waterCrop', subject: c.kind + ' (' + c.id + ')',
                    priority: 46 + (c.moisture < 10 ? 20 : 0),
                    build: () => buildWaterCrop(world, c.id),
                });
            }
        }

        // Produce: collect when it's piling up.
        for (const penId of Object.keys(o.pending)) {
            const n = o.pending[penId];
            if (n >= 2) {
                jobs.push({
                    goal: 'collect:' + penId, target: 'collect:' + penId,
                    role: 'rancher', kind: 'collect',
                    subject: (world.pens[penId] && world.pens[penId].goodLabel) || 'produce',
                    priority: 40 + Math.min(30, n * 4),
                    build: () => buildCollectProduce(world, penId),
                });
            }
        }

        return jobs;
    }

    function decide(world) {
        const o = world.observe();

        // Economic management runs every tick, independent of worker assignment:
        // sell produce for gold and keep the barn stocked (the policy an LLM
        // goal-pursuer will later replace).
        manageEconomy(world, o);

        // In-flight targets, read straight off the workers (no hidden state).
        const inflight = new Set();
        for (const n of world.npcs) {
            if (n.task && n.task.target) inflight.add(n.task.target);
        }
        // Treat whatever the human player is currently standing over as claimed
        // too, so we don't dispatch an NPC to a trough/crop the player is about
        // to handle. The hint clears the moment they walk away.
        if (world.player && world.player.targetHint) {
            inflight.add(world.player.targetHint);
        }

        // --- worker care + day/night schedule --------------------------------
        // Idle workers that need looking after are routed HOME to a single
        // consolidated recover visit (rest + eat + drink + heal in one trip)
        // before any job assignment: sleep at night (all but one rotating
        // night-watch), otherwise recover when any need crosses its threshold —
        // low stamina, low energy, thirst, OR low health. Workers on a care task
        // aren't idle, so they're naturally excluded from jobs.
        const isNight = world.env.dayPhase === 'night';
        const watchId = nightWatch(world);

        // ANTI-COLLAPSE STOPGAP (the MCTS Foreman pass replaces this): the naive
        // per-worker triggers above can stampede the whole crew home at once and
        // starve the animals. Until the smart scheduler exists, hold back only
        // NON-critical care so the on-duty crew never drops below one. A worker
        // whose need is genuinely CRITICAL (exhausted / starving / parched / unwell)
        // still goes regardless — survival of the worker wins over throughput.
        const inCare = (n) => n.state === 'recovering' || n.state === 'resting' ||
                              n.state === 'eating' || n.state === 'sleeping';
        let onDuty = world.npcs.filter((n) => !inCare(n)).length;

        for (const n of world.npcs) {
            if (n.task) continue;
            if (isNight && n.id !== watchId) {
                n.task = buildSleep(world); n.state = 'sleeping';
                onDuty--;
                continue;
            }
            const needCare = n.stamina < WORKER.staminaRest || n.energy < WORKER.energyEat ||
                             n.hydration < WORKER.thirstDrink || n.health < WORKER.healthForce;
            if (!needCare) continue;
            const critical = n.stamina < WORKER.exhausted || n.energy < WORKER.hungry ||
                             n.hydration < WORKER.thirsty || n.health < WORKER.healthForce;
            // Stopgap guard: defer non-critical care that would empty the crew.
            if (!critical && onDuty <= 1) continue;
            n.task = buildRecover(world); n.state = 'recovering';
            onDuty--;
            if (!isNight && n.stamina < WORKER.staminaRest) world.say(n.id, 'Need a breather.');
        }

        let idle = world.npcs.filter((n) => n.task == null);
        if (idle.length === 0) return;

        const jobs = computeJobs(world, o)
            .filter((j) => !inflight.has(j.target))
            .sort((a, b) => b.priority - a.priority);

        const assignedTargets = new Set();
        for (const job of jobs) {
            if (idle.length === 0) break;
            if (assignedTargets.has(job.target)) continue;

            // Best idle worker for this job: role affinity, then stable order.
            idle.sort((a, b) => roleScore(b, job.role) - roleScore(a, job.role));
            const npc = idle.shift();

            const task = job.build();
            task.npcId = npc.id;
            task.role = job.role;     // lets the executor apply the specialist bonus

            // Briefing protocol: instead of speaking the order instantly, prepend
            // a walk-to-Foreman + spoken-order + spoken-ack preamble. The worker
            // physically reports in and HEARS the full order before departing to
            // the job (tasks.js prependBriefing / the duration-gated 'say' step).
            // The job's own steps (and task.target for dedup) follow unchanged.
            const tmpl = TEMPLATES[job.kind];
            const order = tmpl ? fill(pick(tmpl), npc.name, job.subject)
                               : `${npc.name}, see to the ${job.subject}.`;
            const ack = pick(ACKS);
            const fpos = world.foreman ? { x: world.foreman.x, y: world.foreman.y }
                                       : { x: npc.x, y: npc.y };
            prependBriefing(task, { foremanId: BOSS, foremanPos: fpos, order, npcId: npc.id, ack });

            npc.task = task;
            npc.state = 'working';
            assignedTargets.add(job.target);
        }
    }

    return { decide };
}

// One worker stays awake each night, rotating by day so the lost-sleep burden is
// shared. Reduced nighttime animal metabolism (env needMult) lets a single watch
// keep the troughs topped.
function nightWatch(world) {
    const ids = world.npcs.map((n) => n.id);
    if (ids.length === 0) return null;
    return ids[(world.clock.day) % ids.length];
}

function penLabelLower(world, penId) {
    const pen = world.pens[penId];
    if (!pen) return penId;
    // "Cow Pasture" -> "cows", "Chicken Coop" -> "chickens" — light touch.
    if (penId === 'pasture') return 'cows';
    if (penId === 'coop') return 'chickens';
    if (penId === 'meadow') return 'sheep';
    return (pen.label || penId).toLowerCase();
}
