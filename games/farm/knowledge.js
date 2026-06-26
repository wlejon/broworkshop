// knowledge.js — what each agent BELIEVES about the farm.
//
// No one has global truth. An agent learns facts two ways: by SEEING things near
// it (sense, first-hand, fresh) and by HEARING another agent's report within
// earshot (absorb, second-hand, only as fresh as the teller's own knowledge).
// Every belief carries the sim-time it was learned, so a decision can weigh how
// stale its information is — the Foreman dispatches on belief, not truth, and the
// player's HUD reflects belief too. A trough you saw full ten minutes ago may be
// dry now; you won't know until someone fresher tells you or you go look.
//
// Facts are coarse, matched to the unit of decision and of report: one snapshot
// per STATION (a pen or the garden) plus one 'econ' snapshot (stores / market).
// A worker reports their station; the Foreman keeps the books. createBeliefs()
// is the store; senseInto() is first-hand perception; the snapshots mirror the
// exact fields stations.js reads, so a believed world drops into stationChores
// unchanged (see believedObserve).

import { REGIONS, PENS, STATIONS, CROP_KINDS } from './defs.js';

const r1 = (v) => Math.round(v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// How close (tiles) to a station's work-area an agent must be to SEE its state.
// Tuned so a worker standing among their animals/crops perceives that station,
// while the Foreman at his central post does not see across the yard into the
// far pens — he learns those by word of mouth. ECON (stores/market) is the
// Foreman's standing domain: he always knows it; a laborer only near the barn/silo.
export const SIGHT_RADIUS = 5;

// How close (tiles) a listener must be to a speaker to pick up what they know.
// A conversational range — wider than detailed sight (voices carry), tighter than
// the faint tail of audibility. Standing at the Foreman's post to be briefed, or
// next to a worker as they talk, puts you inside it; this is the ONLY channel by
// which second-hand knowledge moves.
export const EARSHOT = 7;

// ── the belief store ─────────────────────────────────────────────────────────
export function createBeliefs() {
    const facts = new Map();   // key -> { value, at, source }

    // Record key=value as known at sim-time `at` from `source`. FRESHEST WINS: a
    // stale rumor never clobbers more recent knowledge (first-hand or otherwise).
    function learn(key, value, at, source) {
        const prev = facts.get(key);
        if (prev && prev.at >= at) return false;
        facts.set(key, { value, at, source });
        return true;
    }

    return {
        learn,
        get:   (key) => facts.get(key) || null,
        value: (key, dflt) => { const f = facts.get(key); return f ? f.value : dflt; },
        at:    (key) => { const f = facts.get(key); return f ? f.at : -Infinity; },
        age:   (key, now) => { const f = facts.get(key); return f ? now - f.at : Infinity; },
        has:   (key) => facts.has(key),
        keys:  () => Array.from(facts.keys()),
        entries: () => facts,
        // Word of mouth: merge another agent's beliefs in, each at the teller's
        // own timestamp so freshness (not the moment of telling) governs. Returns
        // the count of facts that were new-or-fresher to us.
        absorb: (other) => {
            let n = 0;
            for (const [k, f] of other.entries()) if (learn(k, f.value, f.at, f.source)) n++;
            return n;
        },
    };
}

// ── first-hand perception ────────────────────────────────────────────────────
// Nearest-point distance from a tile to a rectangular region.
function distToRegion(ax, ay, reg) {
    const cx = clamp(ax, reg.x0, reg.x1), cy = clamp(ay, reg.y0, reg.y1);
    return Math.hypot(ax - cx, ay - cy);
}
function regionOf(id) { return REGIONS.find((r) => r.id === id) || null; }

// The decision-facts for one animal station, mirroring what animalChores reads.
function snapshotAnimalStation(world, st) {
    const penId = st.penId;
    const animals = world.animals
        .filter((a) => a.penId === penId)
        .map((a) => ({ id: a.id, kind: a.kind, penId, alive: a.alive,
                       thirst: r1(a.thirst), hunger: r1(a.hunger),
                       health: r1(a.health), sick: !!a.sick }));
    const troughs = ['water', 'feed'].map((kind) => {
        const t = world.troughs[penId + '-' + kind];
        return { penId, kind, fill: t ? r1(t.fill) : 100 };
    });
    const pen = world.pens[penId];
    return {
        kind: 'animal', penId, animals, troughs,
        pen: { pending: pen ? pen.pending : 0, cleanliness: pen ? r1(pen.cleanliness) : 100, cap: pen ? pen.cap : 8 },
    };
}

// The decision-facts for the garden, mirroring what gardenChores reads.
function snapshotGarden(world) {
    const crops = world.crops.map((c) => {
        const kd = CROP_KINDS[c.kind] || {};
        return {
            id: c.id, plotIndex: c.plotIndex, kind: c.kind, stage: c.stage,
            growth: r1(c.growth), moisture: r1(c.moisture), weeds: r1(c.weeds || 0),
            value: kd.gold || 0,
            spoilIn: (c.stage === 'ripe' && c.ripeTimer != null) ? Math.max(0, Math.round(c.ripeTimer)) : null,
        };
    });
    return { kind: 'crop', crops, plantable: (world.env && world.env.plantable) ? world.env.plantable.slice() : [] };
}

function snapshotStation(world, st) {
    return st.kind === 'animal' ? snapshotAnimalStation(world, st) : snapshotGarden(world);
}

// The books: stores + market. The Foreman's standing knowledge; a laborer learns
// it only near the barn/silo.
function snapshotEcon(world) {
    const resources = {};
    for (const k of Object.keys(world.resources)) resources[k] = r1(world.resources[k]);
    const level = {}, prices = {};
    for (const g of Object.keys(world.market.prices)) {
        prices[g] = world.market.prices[g];
        level[g] = world.market.level ? world.market.level[g] : 'mid';
    }
    return { resources, barnFeed: r1(world.resources.barnFeed),
             well: { level: r1(world.well.level), cap: world.well.cap },
             market: { prices, level } };
}

// Whether an agent can see the econ structures (barn / silo) from where it stands.
function nearEcon(ax, ay) {
    const barn = regionOf('barn'), silo = regionOf('silo');
    return (barn && distToRegion(ax, ay, barn) <= SIGHT_RADIUS) ||
           (silo && distToRegion(ax, ay, silo) <= SIGHT_RADIUS);
}

// senseInto(world, agent, now) — fold everything `agent` can SEE right now into
// its beliefs (creating the store on first use). `agent` is any positioned actor
// with an .id and tile .x/.y: a worker, the Foreman, or the player.
//
// isForeman flags the delegation HUB. He keeps the books (econ) wherever he
// stands, but by rule he does NOT inspect the field himself — he learns EVERY
// station's state by word of mouth (worker reports), never first-hand, even for
// a pen his post happens to sit beside. That rule, not his exact post, is what
// makes the operation run on reported word rather than on an overseer's gaze.
export function senseInto(world, agent, now, isForeman) {
    if (!agent) return null;
    if (!agent.beliefs) agent.beliefs = createBeliefs();
    const b = agent.beliefs;
    if (!isForeman) {
        for (const st of STATIONS) {
            const reg = regionOf(st.region);
            if (!reg) continue;
            if (distToRegion(agent.x, agent.y, reg) <= SIGHT_RADIUS) {
                b.learn('station:' + st.id, snapshotStation(world, st), now, agent.id);
            }
        }
    }
    if (isForeman || nearEcon(agent.x, agent.y)) {
        b.learn('econ', snapshotEcon(world), now, agent.id);
    }
    return b;
}

// Drive first-hand perception for every agent once per step: each worker, the
// Foreman, and the player (if spawned) learns what's near them. Pure side-effect
// on the agents' belief stores; no decision is taken here.
export function stepPerception(world) {
    const now = world.clock.t;
    for (const n of world.npcs) senseInto(world, n, now, false);
    if (world.foreman) senseInto(world, world.foreman, now, true);
    if (world.player) senseInto(world, world.player, now, false);
}

// ── word of mouth ────────────────────────────────────────────────────────────
// Every positioned actor that can hold beliefs.
function allAgents(world) {
    const out = world.npcs.slice();
    if (world.foreman) out.push(world.foreman);
    if (world.player) out.push(world.player);
    return out;
}

// Resolve a say() speaker id to its agent (or null for the 'Farm' narrator, which
// has no position and no beliefs to share).
export function agentBySpeakerId(world, speakerId) {
    if (speakerId === 'You') return world.player || null;
    if (world.foreman && speakerId === world.foreman.id) return world.foreman;
    return world.npcs.find((n) => n.id === speakerId) || null;
}

// propagateSpeech(world, speakerId) — the moment a line is spoken, every OTHER
// agent within EARSHOT of the speaker absorbs the speaker's beliefs. This is how
// knowledge travels: a worker checking in at the Foreman's post hands him their
// (possibly stale) read of their station; the player picks up what they overhear
// standing near the talk. Returns how many listeners took something in.
export function propagateSpeech(world, speakerId) {
    const speaker = agentBySpeakerId(world, speakerId);
    if (!speaker || !speaker.beliefs) return 0;   // narrator / unknown: nothing to share
    let listeners = 0;
    for (const a of allAgents(world)) {
        if (a === speaker) continue;
        if (Math.hypot(a.x - speaker.x, a.y - speaker.y) <= EARSHOT) {
            if (!a.beliefs) a.beliefs = createBeliefs();
            a.beliefs.absorb(speaker.beliefs);
            listeners++;
        }
    }
    return listeners;
}
