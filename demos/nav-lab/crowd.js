// crowd.js — ORCA local avoidance, made falsifiable.
//
// A navmesh routes agents around the LEVEL, not around each other: sixteen
// agents handed one corridor will share a square metre. `world.setAvoidance`
// turns on the ORCA pass inside world.tick(): path-following steering becomes
// each agent's preferred velocity, filtered against its neighbours.
//
// "It looks better" is not a claim, so every tick this module counts the agent
// PAIRS whose discs overlap and keeps the running mean. Four scenarios, one
// parameter each:
//
//   funnel    both halves ordered through the 2.6 m doorway at once: off vs on.
//   vip       priority. A VIP (1.0) and a control (0.0) make the same trip
//             into an oncoming 0.5 crowd; a pair splits the effort by
//             share = clamp(0.5 + 0.5 * (other - self), 0, 1). Measured as
//             lateral deviation from the straight line. VIP and control are
//             on private layers so they ignore EACH OTHER.
//   factions  layers/mask. Each faction masks only its own layer: it queues
//             against its own kind and walks through the other.
//   stacked   the elevation filter. The same lane on the hall floor and on
//             the mezzanine 4 m above; spans [y ± height/2] do not overlap, so
//             the solver skips every cross-level pair.
//
// The crowd shares the one AI world with the route walkers (layer 8) and the
// link walkers (16), which no scenario's mask includes. agents.js steps the
// world; tickCrowd only consumes waypoints, sets heights and measures.

import { capsule, startRoute, followRoute } from "/lib/kit/nav3d.js";
import { findPath } from "/app/navmesh.js";
import { agentState } from "/app/agents.js";

export const crowdState = {
    agents: [],           // see makeAgent() for the record shape
    scenario: 'none',
    count: 16,
    avoidance: false,
    radius: 0.34,
    timeHorizon: 2.0,
    avoidHeight: 2.0,     // vertical extent of the elevation filter
    speed: 2.6,
    // An instantaneous count is noisy; the mean is the honest headline.
    overlapNow: 0, overlapPeak: 0, overlapAccum: 0, samples: 0,
    crossFactionAccum: 0, sameFactionAccum: 0,
};

let sceneRef = null;
export function bindCrowdScene(scene) { sceneRef = scene; }

export function overlapMean() {
    return crowdState.samples ? crowdState.overlapAccum / crowdState.samples : 0;
}

export function resetStats() {
    Object.assign(crowdState, { overlapNow: 0, overlapPeak: 0, overlapAccum: 0, samples: 0, crossFactionAccum: 0, sameFactionAccum: 0 });
    for (const rec of crowdState.agents) { rec.dev = 0; rec.devN = 0; }
}

export function setAvoidance(on) {
    crowdState.avoidance = !!on;
    if (agentState.world) agentState.world.setAvoidance(!!on);
    resetStats();
    return crowdState.avoidance;
}

// --- roster --------------------------------------------------------------------------

function avoidanceOf(rec) {
    return {
        enabled: true, radius: crowdState.radius, timeHorizon: crowdState.timeHorizon,
        height: crowdState.avoidHeight, neighborDist: 8, maxNeighbors: 12,
        priority: rec.priority, layers: rec.layers, mask: rec.mask,
    };
}

function makeAgent(at, opts) {
    const rec = {
        agent: null, node: null, route: null, leg: 1, y: at.y, done: true,
        endA: { ...at }, endB: opts.endB || null, goingToB: true,
        role: opts.role || 'crowd', faction: opts.faction || 0,
        priority: opts.priority != null ? opts.priority : 0.5,
        layers: opts.layers != null ? opts.layers : 1, mask: opts.mask != null ? opts.mask : 1,
        dev: 0, devN: 0,        // accumulated lateral deviation from endA→endB
    };
    rec.agent = bro.ai.game.createAgent({
        x: at.x, z: at.z, speed: crowdState.speed, radius: crowdState.radius,
        elevation: at.y, avoidance: avoidanceOf(rec),
    });
    agentState.world.addAgent(rec.agent);
    const color = opts.color || '#5ad2f4';
    rec.node = capsule(sceneRef, at, { name: `crowd.${crowdState.agents.length}`, color, radius: crowdState.radius, halfHeight: 0.38, emissive: opts.emissive });
    rec.node.castsShadow = false;
    crowdState.agents.push(rec);
    if (rec.endB) route(rec, rec.endB);
    return rec;
}

function route(rec, to) {
    return startRoute(rec, findPath({ x: rec.agent.x, y: rec.y, z: rec.agent.z }, to));
}

export function clearCrowd() {
    for (const rec of crowdState.agents) {
        agentState.world.removeAgent(rec.agent);
        rec.node.destroy();
    }
    crowdState.agents.length = 0;
    crowdState.scenario = 'none';
    resetStats();
}

// --- tick ----------------------------------------------------------------------------

export function tickCrowd() {
    if (!crowdState.agents.length) return;
    for (const rec of crowdState.agents) {
        // Ping-pong: a crowd that arrives and stops can be watched once;
        // swapping the endpoints keeps the choke under pressure.
        if (followRoute(rec, 0.6) && rec.endB) {
            rec.goingToB = !rec.goingToB;
            route(rec, rec.goingToB ? rec.endB : rec.endA);
        }
        const { agent, node } = rec;
        node.x = agent.x; node.y = rec.y + 0.72; node.z = agent.z;
        agent.elevation = rec.y;
        if (rec.endB) {
            // Lateral deviation from the agent's own straight line: "how much
            // was this agent pushed around", which the VIP demo measures.
            const dx = rec.endB.x - rec.endA.x, dz = rec.endB.z - rec.endA.z, L = Math.hypot(dx, dz);
            if (L > 1e-6) {
                rec.dev += Math.abs((agent.x - rec.endA.x) * dz - (agent.z - rec.endA.z) * dx) / L;
                rec.devN++;
            }
        }
    }
    measureOverlaps();
}

// Overlapping pairs on the same storey (agents 4 m apart are not "overlapping"
// in any sense a player would recognise).
function measureOverlaps() {
    const a = crowdState.agents, touch = crowdState.radius * 2;
    let n = 0, cross = 0, same = 0;
    for (let i = 0; i < a.length; i++) {
        for (let j = i + 1; j < a.length; j++) {
            if (Math.abs(a[i].y - a[j].y) > 1.0) continue;
            if (Math.hypot(a[i].agent.x - a[j].agent.x, a[i].agent.z - a[j].agent.z) >= touch) continue;
            n++;
            if (a[i].faction === a[j].faction) same++; else cross++;
        }
    }
    crowdState.overlapNow = n;
    crowdState.overlapPeak = Math.max(crowdState.overlapPeak, n);
    crowdState.overlapAccum += n;
    crowdState.sameFactionAccum += same;
    crowdState.crossFactionAccum += cross;
    crowdState.samples++;
}

/** Mean lateral deviation of one agent, metres. */
export function deviationOf(rec) { return rec && rec.devN ? rec.dev / rec.devN : 0; }
export function findRole(role) { return crowdState.agents.find((r) => r.role === role) || null; }

// --- scenarios -----------------------------------------------------------------------

// A tidy, deterministic block: the tests compare runs, and a randomised spawn
// would make them incomparable.
function block(n, cx, cz, y, cols, pitch) {
    const out = [];
    for (let i = 0; i < n; i++) {
        out.push({ x: cx + ((i % cols) - (cols - 1) / 2) * pitch, y, z: cz + (Math.floor(i / cols) - 0.5) * pitch });
    }
    return out;
}

const TEAM_A = '#ff7a6b', TEAM_B = '#5ad2f4';

function begin(name) { clearCrowd(); crowdState.scenario = name; }
function finish() { resetStats(); return crowdState.agents.length; }

/** Two blocks either side of the x = 4 doorway, each bound for the other's ground. */
export function scenarioFunnel(n) {
    begin('funnel');
    n = Math.max(2, n | 0);
    const half = Math.ceil(n / 2), west = { x: -6, y: 0, z: 0 }, east = { x: 14, y: 0, z: 0 };
    for (const p of block(half, west.x, west.z, 0, 3, 1.1)) makeAgent(p, { color: TEAM_A, endB: east });
    for (const p of block(n - half, east.x, east.z, 0, 3, 1.1)) makeAgent(p, { color: TEAM_B, endB: west });
    return finish();
}

/**
 * Priority. The crowd is layers 1 / mask 7 (sees everyone); the VIP layers 2 /
 * mask 1 and the control layers 4 / mask 1: both see the crowd, neither sees
 * the other, which keeps the two deviation numbers comparable.
 */
export function scenarioVip(n) {
    begin('vip');
    n = Math.max(4, n | 0);
    const goalEast = { x: 14, y: 0, z: 0 }, goalWest = { x: -6, y: 0, z: 0 };
    for (const p of block(n, 14, 0, 0, 3, 1.1)) {
        makeAgent(p, { color: TEAM_B, priority: 0.5, layers: 1, mask: 7, endB: goalWest });
    }
    makeAgent({ x: -7, y: 0, z: -0.6 }, { color: '#ffd166', emissive: 1.6, faction: 1, role: 'vip', priority: 1.0, layers: 2, mask: 1, endB: goalEast });
    makeAgent({ x: -7, y: 0, z: 0.6 }, { color: '#9aa7b4', emissive: 0.2, faction: 1, role: 'control', priority: 0.0, layers: 4, mask: 1, endB: goalEast });
    return finish();
}

/** layers/mask: two factions, each two opposing streams, crossing one junction. */
export function scenarioFactions(n) {
    begin('factions');
    n = Math.max(4, n | 0);
    const per = Math.max(1, Math.floor(n / 4)), JX = -10, JZ = -8, R = 9;
    const streams = [
        { f: 0, from: { x: JX - R, z: JZ }, to: { x: JX + R, z: JZ } },
        { f: 0, from: { x: JX + R, z: JZ }, to: { x: JX - R, z: JZ } },
        { f: 1, from: { x: JX, z: JZ - R }, to: { x: JX, z: JZ + R } },
        { f: 1, from: { x: JX, z: JZ + R }, to: { x: JX, z: JZ - R } },
    ];
    for (const s of streams) {
        for (const p of block(per, s.from.x, s.from.z, 0, 2, 1.0)) {
            makeAgent(p, { color: s.f ? TEAM_B : TEAM_A, faction: s.f, layers: s.f ? 2 : 1, mask: s.f ? 2 : 1,
                           endB: { x: s.to.x, y: 0, z: s.to.z } });
        }
    }
    return finish();
}

/** The lane the stacked scenario runs on the hall floor and on the mezzanine above it. */
export const STACK_LANE = { z: 11, west: -19, east: -6 };

/**
 * The elevation filter. `levels` exists for the tests: the ground lane alone
 * and with the mezzanine crowd overhead must produce bit-identical ground
 * trajectories. `per` depends on n only, so the ground roster matches.
 */
export function scenarioStacked(n, levels) {
    begin('stacked');
    n = Math.max(4, n | 0);
    const per = Math.max(1, Math.floor(n / 4));
    for (const y of (levels || [0, 4])) {
        for (const dir of [1, -1]) {
            const fromX = dir > 0 ? STACK_LANE.west : STACK_LANE.east, toX = dir > 0 ? STACK_LANE.east : STACK_LANE.west;
            for (const p of block(per, fromX + dir, STACK_LANE.z, y, 2, 1.0)) {
                makeAgent(p, { color: y > 0 ? '#a58bff' : TEAM_A, faction: y > 0 ? 1 : 0, role: y > 0 ? 'mezz' : 'ground',
                               endB: { x: toX, y, z: STACK_LANE.z } });
            }
        }
    }
    return finish();
}

/**
 * Re-apply the avoidance height to every agent. The stacked test uses it to
 * BREAK the filter on purpose: 12 m spans overlap and the levels interact.
 */
export function setAvoidHeight(h) {
    crowdState.avoidHeight = h;
    for (const rec of crowdState.agents) rec.agent.setAvoidance(avoidanceOf(rec));
}

/** XZ position + velocity of every agent (optionally one role): a run's fingerprint. */
export function snapshot(role) {
    return crowdState.agents.filter((r) => !role || r.role === role)
        .map((r) => ({ x: r.agent.x, z: r.agent.z, vx: r.agent.velocity.x, vz: r.agent.velocity.z }));
}
