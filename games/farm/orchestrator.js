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
    buildSleep, buildRecover, buildAssessStation, buildReport, prependBriefing,
} from './tasks.js';
import { WORKER, STATIONS } from './defs.js';
import { stationChores, stationById, assignStations } from './stations.js';
import { believedObserve, nearStation } from './knowledge.js';

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
// Foreman's one acknowledgement after the crew turns in their day-recaps at dusk.
const REPORT_ACKS = ['Good work today, everyone.', 'Solid day, team.',
                     'Well done. Get some rest.', 'Nice work out there today.'];

// A quiet-station worker only lends a hand to another station for work at least
// this urgent (survival-grade water/feed/tend/harvest), never low upkeep.
const ASSIST_MIN = 55;

// Central-command information loop. A quiet worker checks in with the Foreman
// this often, refreshing his picture of the field; a station he hasn't heard
// about in STALE_REPORT gets a worker sent to look (turning uncertainty into a
// fresh first-hand read). These cadences set how far behind reality the
// Foreman's dispatch can drift — the source of his honest mistakes.
const REPORT_INTERVAL = 22000;   // ms between a spare worker's voluntary check-ins
const STALE_REPORT    = 38000;   // ms a station may go unheard-of before he investigates

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
    let lastReportDay = 0;    // dusk day-recap tracker

    function decide(world) {
        // Decisions run on BELIEF, not truth. The Foreman keeps the books, so he
        // decides the economy on his own (always-current) econ beliefs; each
        // worker below decides chores on what IT knows. observe() is no longer
        // consulted for dispatch — an agent acts only on what it has learned.
        manageEconomy(world, believedObserve(world, world.foreman));

        // End-of-day debrief: at dusk, each worker reports the day's deeds to the
        // Foreman in a single recap (instead of narrating each chore as it goes),
        // and the Foreman acknowledges once. Fires once per day; a worker who did
        // nothing notable simply says nothing.
        if (world.env.dayPhase === 'dusk' && world.clock.day !== lastReportDay) {
            lastReportDay = world.clock.day;
            let any = false;
            for (const n of world.npcs) if (world.deliverReport(n.id)) any = true;
            if (any && world.foreman) world.say(BOSS, pick(REPORT_ACKS));
        }

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

        // --- station servicing: central command on reported word -------------
        // Two pictures are in play. A worker AT its station sees it first-hand, so
        // it handles its own patch on fresh truth — the survival floor that never
        // goes blind. Everything else is the FOREMAN's call, and he decides on HIS
        // picture, which is only as fresh as the last report he heard. So he sends
        // help where he believes it's needed (sometimes wrong), sends a hand to
        // LOOK at a station that's gone quiet, and otherwise a spare worker checks
        // in to keep his picture current. Honest mistakes, made on stale word.
        const idle = world.npcs.filter((n) => n.task == null);
        if (idle.length === 0) return;

        const now = world.clock.t;
        const fo = believedObserve(world, world.foreman);   // central command's (lagging) view
        const assigned = new Set();
        const free = (j) => j && !inflight.has(j.target) && !assigned.has(j.target);
        const take = (n, task, target) => {
            task.npcId = n.id;
            maybeBrief(world, n, task);
            n.task = task;
            n.state = 'working';
            if (target) { inflight.add(target); assigned.add(target); }
        };

        for (const n of idle) {
            if (!n.station) continue;   // assignStations should have covered all

            // 1) Mind your own patch, on what you can SEE there (first-hand).
            const bo = believedObserve(world, n);
            let job = stationChores(world, bo, n.station).filter(free)[0];
            if (job) {
                const task = job.build();
                task.role = job.role;   // lets the executor apply the specialist bonus
                take(n, task, job.target);
                continue;
            }

            // 2) The Foreman reallocates this spare hand on HIS picture — help
            //    where central command BELIEVES it's needed, which may already be
            //    handled (a wasted trip) or miss a problem he hasn't heard of.
            const others = [];
            for (const st of STATIONS) {
                if (st.id === n.station) continue;
                for (const j of stationChores(world, fo, st.id)) {
                    if (j.priority >= ASSIST_MIN && free(j)) others.push(j);
                }
            }
            job = others.sort((a, b) => b.priority - a.priority)[0];
            if (job) {
                const task = job.build();
                task.role = job.role;
                take(n, task, job.target);
                continue;
            }

            // 3) Stay present on your own patch: if you've drifted off it, head
            //    back so it never goes unwatched (and your read of it stays fresh).
            if (!nearStation(n, n.station)) {
                take(n, buildAssessStation(world, n.station), null);
                continue;
            }

            // 4) Investigate for the Foreman: a station he hasn't heard about in a
            //    while (the night watch, lone cover, tours the stalest aggressively).
            const stale = staleStationForForeman(world, now, isNight && n.id === watchId);
            if (stale && !nearStation(n, stale)) {
                take(n, buildAssessStation(world, stale), null);
                continue;
            }

            // 5) Nothing pressing: check in with the Foreman so his picture stays
            //    current — a quiet worker reports rather than standing idle.
            if (now - (n._lastReport || 0) >= REPORT_INTERVAL) {
                n._lastReport = now;
                take(n, buildReport(world, n.id, reportLine(n, bo)), null);
            }
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

// Prepend the morning briefing (walk to the Foreman, hear the assignment, reply)
// to a freshly-(re)assigned worker's NEXT task — be that a chore or a go-look
// walk — then clear the flag. No-op once the worker has been briefed for the day.
function maybeBrief(world, n, task) {
    if (!n._justAssigned) return;
    const st = stationById(n.station);
    const order = fill(pick(STATION_BRIEF), n.name, st ? st.label : n.station);
    const fpos = world.foreman ? { x: world.foreman.x, y: world.foreman.y } : { x: n.x, y: n.y };
    prependBriefing(task, { foremanId: BOSS, foremanPos: fpos, order, npcId: n.id, ack: pick(ACKS) });
    n._justAssigned = false;
}

// The station the FOREMAN has gone longest without hearing about (Infinity for
// one he's never heard of). He sends a hand to look there, turning his oldest
// uncertainty into a fresh read. `aggressive` (the lone night watch) always
// returns the stalest so coverage keeps circulating; otherwise only one that has
// gone quiet past STALE_REPORT warrants pulling someone to investigate.
function staleStationForForeman(world, now, aggressive) {
    const b = world.foreman && world.foreman.beliefs;
    if (!b) return STATIONS[0] ? STATIONS[0].id : null;
    let best = null, bestAge = -1;
    for (const st of STATIONS) {
        const age = b.age('station:' + st.id, now);
        if (age > bestAge) { bestAge = age; best = st.id; }
    }
    if (aggressive) return best;
    return bestAge > STALE_REPORT ? best : null;
}

// A short, flavorful status line for a worker's check-in, drawn from what it
// last saw at its own station (bo = its beliefs). Content is cosmetic — the
// REPORT's real job is to carry those beliefs to the Foreman by speaking near
// him — but a true-to-its-knowledge line reads better than rote "checking in".
function reportLine(n, bo) {
    const st = stationById(n.station);
    const label = st ? st.label : n.station;
    if (st && st.kind === 'animal') {
        const herd = bo.animals.filter((a) => a.penId === st.penId);
        if (herd.some((a) => a.sick)) return `${label}: one of them's ailing.`;
        if (herd.some((a) => a.thirst >= 55 || a.hunger >= 55)) return `${label} will want a top-up soon.`;
        return `${label}'s all squared away.`;
    }
    if (bo.crops.some((c) => c.stage === 'ripe')) return `${label}: there's a crop ready to bring in.`;
    if (bo.crops.some((c) => c.stage !== 'empty' && c.moisture < 25)) return `${label} could use watering.`;
    return `${label}'s looking good.`;
}
