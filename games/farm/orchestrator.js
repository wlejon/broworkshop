// orchestrator.js — THE SWAPPABLE SEAM.
//
// A rule-based stand-in for a future search/LLM orchestrator, isolated behind a
// tiny interface so a smarter version drops in unchanged:
//
//   const orch = createOrchestrator();
//   orch.decide(world);   // reads world.observe(), assigns workers to STATIONS,
//                         // and lets each work its station autonomously.
//
// The model is STATION OWNERSHIP, not per-chore dispatch: the Foreman assigns
// each worker a station (a pen, or the garden), briefs them once on assignment
// (and again each morning), and from then on the worker pulls whatever its
// station needs (stations.js stationChores) WITHOUT reporting back per chore.
// When a worker's own station is quiet it lends a hand to the neediest other
// station. Care/sleep still preempt. decide() is the entire contract.

import {
    buildSleep, buildRecover, prependBriefing,
} from './tasks.js';
import { WORKER, STATIONS } from './defs.js';
import { stationChores, stationById, assignStations } from './stations.js';

const BOSS = 'Foreman';   // orchestrator's speaker label in the dialog feed

// Assignment briefings — spoken once when a worker takes (or re-takes) a station
// each morning. {name} = worker, {what} = station label. The per-chore briefings
// are gone: a station-owner works autonomously after reporting in.
const STATION_BRIEF = [
    '{name}, you\'re on the {what} today — keep it running.',
    '{name}, take the {what}. Handle whatever it needs.',
    '{name}, the {what} is yours today. Stay on top of it.',
    'Morning, {name}. You\'ve got the {what} — keep it topped up and tidy.',
];
const ACKS = ['On it.', 'Right away.', 'Heading over.', 'Got it.', 'Will do.'];

// A quiet-station worker only lends a hand to another station for work at least
// this urgent (survival-grade water/feed/tend/harvest), never low upkeep.
const ASSIST_MIN = 55;

// ---- economic policy (instant management transactions) ----------------------
// The buy/sell layer the LLM will later replace. Realize produce for gold and
// keep the barn stocked, holding a thin gold reserve so feed stays restockable.
const GOLD_RESERVE = 40;
const BARN_TARGET  = 600;
const BARN_LOW     = 250;
const SELL_PILE    = 6;
const ANIMAL_BUY_GOLD = 600;
const SELLABLE = ['eggs', 'milk', 'wool', 'crops'];

function manageEconomy(world, o) {
    const r = world.resources;

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

    if (r.barnFeed < BARN_LOW && r.gold > GOLD_RESERVE) {
        const price = world.market.prices.feed || 0.25;
        const want = Math.min(BARN_TARGET - r.barnFeed, Math.floor((r.gold - GOLD_RESERVE) / price));
        if (want > 0) {
            const res = world.actions.buy('feed', want);
            if (res.ok && res.cost >= 15) world.say(BOSS, `Bought ${res.bought} feed for ${res.cost}g.`);
        }
    }

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
function fill(tmpl, name, what) { return tmpl.replace('{name}', name).replace('{what}', what); }

export function createOrchestrator() {
    let lastStandupDay = 0;   // morning re-brief tracker

    function decide(world) {
        const o = world.observe();

        // Economic management runs every tick, independent of worker assignment.
        manageEconomy(world, o);

        // Station assignment: every worker owns a station (stable + affine). At a
        // new day, re-brief everyone — the Foreman's morning standup. The brief is
        // prepended to the worker's NEXT chore (no mid-task interruption).
        assignStations(world);
        if (world.clock.day !== lastStandupDay) {
            lastStandupDay = world.clock.day;
            for (const n of world.npcs) if (n.station) n._justAssigned = true;
        }

        // In-flight targets, read straight off the workers (no hidden state) +
        // whatever the human player is standing over (their claim clears on leave).
        const inflight = new Set();
        for (const n of world.npcs) {
            if (n.task && n.task.target) inflight.add(n.task.target);
        }
        if (world.player && world.player.targetHint) inflight.add(world.player.targetHint);

        // --- worker care + day/night schedule --------------------------------
        // Idle workers needing looking-after route HOME to a consolidated recover
        // visit (rest + eat + drink + heal) before any station work: sleep at
        // night (all but a rotating watch), else recover when a need crosses its
        // threshold. The anti-collapse guard keeps the on-duty crew from emptying.
        const isNight = world.env.dayPhase === 'night';
        const watchId = nightWatch(world);
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
            if (!critical && onDuty <= 1) continue;
            n.task = buildRecover(world); n.state = 'recovering';
            onDuty--;
            if (!isNight && n.stamina < WORKER.staminaRest) world.say(n.id, 'Need a breather.');
        }

        // --- station servicing ----------------------------------------------
        // Each idle worker pulls the top chore at ITS station; if its station is
        // quiet it assists the neediest other station's urgent work. The briefing
        // (walk to the Foreman, hear the assignment, ack) is prepended ONLY when
        // the worker was just (re)assigned — otherwise it just goes.
        const idle = world.npcs.filter((n) => n.task == null);
        if (idle.length === 0) return;

        const assigned = new Set();
        for (const n of idle) {
            if (!n.station) continue;   // assignStations should have covered all

            let chores = stationChores(world, o, n.station)
                .filter((j) => !inflight.has(j.target) && !assigned.has(j.target));
            let job = chores[0];

            if (!job) {
                // Overflow: lend a hand to the neediest OTHER station's urgent work.
                const others = [];
                for (const st of STATIONS) {
                    if (st.id === n.station) continue;
                    for (const j of stationChores(world, o, st.id)) {
                        if (j.priority >= ASSIST_MIN && !inflight.has(j.target) && !assigned.has(j.target)) {
                            others.push(j);
                        }
                    }
                }
                job = others.sort((a, b) => b.priority - a.priority)[0];
            }
            if (!job) continue;   // nothing pressing — idle near the station

            const task = job.build();
            task.npcId = n.id;
            task.role = job.role;   // lets the executor apply the specialist bonus

            if (n._justAssigned) {
                const st = stationById(n.station);
                const order = fill(pick(STATION_BRIEF), n.name, st ? st.label : n.station);
                const fpos = world.foreman ? { x: world.foreman.x, y: world.foreman.y }
                                           : { x: n.x, y: n.y };
                prependBriefing(task, { foremanId: BOSS, foremanPos: fpos, order, npcId: n.id, ack: pick(ACKS) });
                n._justAssigned = false;
            }

            n.task = task;
            n.state = 'working';
            inflight.add(job.target);
            assigned.add(job.target);
        }
    }

    return { decide };
}

// One worker stays awake each night, rotating by day so the lost-sleep burden is
// shared. Reduced nighttime metabolism lets a single watch keep troughs topped.
function nightWatch(world) {
    const ids = world.npcs.map((n) => n.id);
    if (ids.length === 0) return null;
    return ids[(world.clock.day) % ids.length];
}
