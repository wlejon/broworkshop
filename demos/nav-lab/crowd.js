// crowd.js — ORCA local avoidance, made falsifiable.
//
// A navmesh routes agents around the LEVEL. It says nothing about routing them
// around EACH OTHER: sixteen agents handed the same corridor will happily
// occupy the same square metre, because the route is geometry and geometry does
// not move. `world.setAvoidance(true)` turns on the Optimal Reciprocal Collision
// Avoidance pass inside world.tick(): each agent's path-following steering
// becomes its *preferred* velocity, the solver filters it against the nearby
// agents, and the filtered velocity is what actually drives the dynamics.
//
// The problem with demonstrating avoidance is that "it looks better" is not a
// claim. So this module counts, every tick, the number of agent PAIRS whose
// discs overlap, and reports the running mean. Flip the HUD toggle and the
// number falls. That counter is the argument; the pretty queueing at the choke
// point is just what it looks like.
//
// Four scenarios, each isolating one parameter of the avoidance model:
//
//   funnel   — N agents ordered through the 2.6 m doorway from BOTH sides at
//              once. The baseline: avoidance off vs on, one number apart.
//   vip      — priority. A gold VIP at priority 1.0 and a grey control at
//              priority 0.0 make the identical trip through an oncoming crowd.
//              The pair splits the avoidance effort by
//              share = clamp(0.5 + 0.5 * (other - self), 0, 1), so against a
//              0.5-priority crowd the VIP does a quarter of the work and the
//              control does three quarters. Measured as lateral deviation from
//              the straight line between the agent's two endpoints.
//              VIP and control are put on private avoidance layers so they
//              ignore EACH OTHER — otherwise the measurement would be of the
//              two test subjects shoving one another, not of the crowd.
//   factions — layers/mask. Two factions cross the same junction. Each avoids
//              its own kind (mask & layers matches) and walks straight through
//              the other (no match), so cross-faction overlaps stay high while
//              within-faction overlaps collapse.
//   stacked  — the elevation filter. Identical lanes on the hall floor and on
//              the mezzanine four metres above it. Agents carry an `elevation`
//              and an avoidance `height`; when the spans
//              [elevation - height/2, elevation + height/2] do not overlap the
//              solver treats them as different levels and skips the pair
//              entirely. The two crowds walk through each other in XZ and
//              neither notices, which is the correct answer for a bridge over a
//              tunnel and the wrong answer for a flat 2D solver.
//
// A note on why the crowd is not in agents.js: chunk 1's four route-walkers are
// a different demo, and mixing them into the crowd's roster would make the
// overlap counter meaningless. They share the AI world (there is only one tick)
// but sit on avoidance layer 8, which no scenario's mask includes, so they are
// invisible to the crowd and the crowd is invisible to them.

import { findPath, navState } from '/app/navmesh.js';
import { agentState } from '/app/agents.js';

export const crowdState = {
    agents: [],           // see makeAgent() for the record shape
    scenario: 'none',
    count: 16,
    avoidance: false,
    radius: 0.34,
    timeHorizon: 2.0,
    avoidHeight: 2.0,     // vertical extent of the elevation filter
    speed: 2.6,

    // Live + accumulated overlap statistics. `overlapMean` is the honest
    // headline number: an instantaneous count is noisy enough that a lucky
    // frame could show either result.
    overlapNow: 0,
    overlapPeak: 0,
    overlapAccum: 0,
    samples: 0,
    crossFactionAccum: 0,
    sameFactionAccum: 0,
};

export function overlapMean() {
    return crowdState.samples ? crowdState.overlapAccum / crowdState.samples : 0;
}

export function resetStats() {
    crowdState.overlapNow = 0;
    crowdState.overlapPeak = 0;
    crowdState.overlapAccum = 0;
    crowdState.samples = 0;
    crowdState.crossFactionAccum = 0;
    crowdState.sameFactionAccum = 0;
    for (const rec of crowdState.agents) { rec.dev = 0; rec.devN = 0; }
}

// --- World-level toggle ------------------------------------------------------

export function setAvoidance(on) {
    crowdState.avoidance = !!on;
    if (agentState.world) agentState.world.setAvoidance(!!on);
    resetStats();
    return crowdState.avoidance;
}

// --- Roster ------------------------------------------------------------------

const AVOID_DEFAULTS = () => ({
    enabled: true,
    radius: crowdState.radius,
    timeHorizon: crowdState.timeHorizon,
    height: crowdState.avoidHeight,
    neighborDist: 8,
    maxNeighbors: 12,
});

function makeAgent(scene, at, opts) {
    const av = Object.assign(AVOID_DEFAULTS(), {
        priority: opts.priority != null ? opts.priority : 0.5,
        layers: opts.layers != null ? opts.layers : 1,
        mask: opts.mask != null ? opts.mask : 1,
    });

    const agent = bro.ai.game.createAgent({
        x: at.x, z: at.z,
        speed: opts.speed != null ? opts.speed : crowdState.speed,
        radius: crowdState.radius,
        elevation: at.y,
        avoidance: av,
    });
    agentState.world.addAgent(agent);

    const node = scene.createMesh({
        name: `crowd.${crowdState.agents.length}`,
        mesh: 'capsule',
        radius: crowdState.radius, halfHeight: 0.38,
        x: at.x, y: at.y + 0.72, z: at.z,
        color: opts.color || '#5ad2f4',
        metallic: 0.05, roughness: 0.5,
        emissive: opts.emissive != null ? opts.emissive : 0.35,
        emissiveColor: opts.color || '#5ad2f4',
    });
    node.castsShadow = false;

    const rec = {
        agent, node,
        route: null, leg: 1, y: at.y,
        endA: { ...at }, endB: null,
        goingToB: true,
        role: opts.role || 'crowd',
        faction: opts.faction != null ? opts.faction : 0,
        priority: av.priority,
        dev: 0, devN: 0,        // accumulated lateral deviation from endA→endB
    };
    crowdState.agents.push(rec);
    return rec;
}

// Plan a route for one crowd member. Uses the app's own findPath so the crowd
// travels the same corridors every other part of this lab draws.
function route(rec, to) {
    const from = { x: rec.agent.x, y: rec.y, z: rec.agent.z };
    const res = findPath(from, to);
    if (!res || res.points.length < 2) {
        rec.route = null;
        rec.agent.clearTarget();
        return null;
    }
    rec.route = res;
    rec.leg = 1;
    rec.agent.setTarget(res.points[1].x, res.points[1].z);
    return res;
}

export function clearCrowd(scene) {
    for (const rec of crowdState.agents) {
        agentState.world.removeAgent(rec.agent);
        scene.destroyNode(rec.node);
    }
    crowdState.agents.length = 0;
    crowdState.scenario = 'none';
    resetStats();
}

// --- Tick --------------------------------------------------------------------
//
// Called immediately after agents.js has ticked the world, never instead of it:
// there is one AI world and it must be stepped exactly once per fixed step.
// Everything here is post-processing — consume waypoints, carry the walker's
// height along the active leg, write the transforms, and measure.

export function tickCrowd(dt) {
    if (!crowdState.agents.length) return;

    for (const rec of crowdState.agents) {
        const { agent, node } = rec;

        if (rec.route) {
            const pts = rec.route.points;
            const tgt = pts[rec.leg];
            if (Math.hypot(agent.x - tgt.x, agent.z - tgt.z) < 0.6) {
                if (rec.leg + 1 < pts.length) {
                    rec.leg++;
                    agent.setTarget(pts[rec.leg].x, pts[rec.leg].z);
                } else if (rec.endB) {
                    // Ping-pong. A crowd that arrives and stops is a crowd you
                    // can only watch once; swapping the endpoints keeps the
                    // choke point under continuous pressure.
                    rec.goingToB = !rec.goingToB;
                    route(rec, rec.goingToB ? rec.endB : rec.endA);
                } else {
                    agent.clearTarget();
                }
            }
            // Height from the active leg, exactly as agents.js does it: this is
            // what puts the mezzanine crowd on the mezzanine.
            const a = pts[Math.max(0, rec.leg - 1)], b = pts[rec.leg];
            if (a && b) {
                const sx = b.x - a.x, sz = b.z - a.z;
                const len2 = sx * sx + sz * sz;
                let t = len2 > 1e-6
                    ? ((agent.x - a.x) * sx + (agent.z - a.z) * sz) / len2 : 1;
                t = Math.max(0, Math.min(1, t));
                rec.y = a.y + (b.y - a.y) * t;
            }
        }

        node.x = agent.x;
        node.y = rec.y + 0.72;
        node.z = agent.z;
        node.rotationY = agent.yaw;
        agent.elevation = rec.y;   // feeds the ORCA elevation filter

        // Lateral deviation from the agent's own straight line, which is the
        // "how much was this agent pushed around" measure the VIP demo needs.
        if (rec.endB) {
            const ax = rec.endA.x, az = rec.endA.z;
            const bx = rec.endB.x, bz = rec.endB.z;
            const dx = bx - ax, dz = bz - az;
            const L = Math.hypot(dx, dz);
            if (L > 1e-6) {
                rec.dev += Math.abs((agent.x - ax) * dz - (agent.z - az) * dx) / L;
                rec.devN++;
            }
        }
    }

    measureOverlaps();
}

// Count overlapping pairs. Only pairs on the same storey are counted — two
// agents stacked four metres apart are not "overlapping" in any sense a player
// would recognise, and counting them would hand the stacked scenario a
// meaningless score.
function measureOverlaps() {
    const a = crowdState.agents;
    const touch = crowdState.radius * 2;
    let n = 0, cross = 0, same = 0;
    for (let i = 0; i < a.length; i++) {
        for (let j = i + 1; j < a.length; j++) {
            if (Math.abs(a[i].y - a[j].y) > 1.0) continue;
            const d = Math.hypot(a[i].agent.x - a[j].agent.x,
                                 a[i].agent.z - a[j].agent.z);
            if (d >= touch) continue;
            n++;
            if (a[i].faction === a[j].faction) same++; else cross++;
        }
    }
    crowdState.overlapNow = n;
    if (n > crowdState.overlapPeak) crowdState.overlapPeak = n;
    crowdState.overlapAccum += n;
    crowdState.sameFactionAccum += same;
    crowdState.crossFactionAccum += cross;
    crowdState.samples++;
}

// Mean lateral deviation for one agent, in metres.
export function deviationOf(rec) {
    return rec && rec.devN ? rec.dev / rec.devN : 0;
}

export function findRole(role) {
    return crowdState.agents.find(r => r.role === role) || null;
}

// --- Scenarios ---------------------------------------------------------------

// Lay out `n` agents in a tidy block so every run starts from the same shape.
// Deterministic on purpose: the smoke test compares avoidance on against
// avoidance off, and a randomised spawn would make those two runs incomparable.
function block(n, cx, cz, y, cols, pitch) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const c = i % cols, r = Math.floor(i / cols);
        out.push({ x: cx + (c - (cols - 1) / 2) * pitch,
                   y,
                   z: cz + (r - 0.5) * pitch });
    }
    return out;
}

const TEAM_A = '#ff7a6b', TEAM_B = '#5ad2f4';

// Two blocks, one either side of the x = 4 doorway, each aimed at the other's
// starting ground. Everything must pass through 2.6 m of corridor.
export function scenarioFunnel(scene, n) {
    clearCrowd(scene);
    n = Math.max(2, n | 0);
    const half = Math.ceil(n / 2);
    const west = { x: -6, z: 0 }, east = { x: 14, z: 0 };

    for (const p of block(half, west.x, west.z, 0, 3, 1.1)) {
        const rec = makeAgent(scene, p, { color: TEAM_A, faction: 0, role: 'crowd' });
        rec.endB = { x: east.x, y: 0, z: east.z };
        route(rec, rec.endB);
    }
    for (const p of block(n - half, east.x, east.z, 0, 3, 1.1)) {
        const rec = makeAgent(scene, p, { color: TEAM_B, faction: 0, role: 'crowd' });
        rec.endB = { x: west.x, y: 0, z: west.z };
        route(rec, rec.endB);
    }
    crowdState.scenario = 'funnel';
    resetStats();
    return crowdState.agents.length;
}

// Priority. Layer plan: the crowd is layers 1 / mask 7 (sees everyone); the VIP
// is layers 2 / mask 1 and the control layers 4 / mask 1, so both see the crowd
// and neither sees the other. That isolation is what makes the two deviation
// numbers comparable.
export function scenarioVip(scene, n) {
    clearCrowd(scene);
    n = Math.max(4, n | 0);
    const goalEast = { x: 14, y: 0, z: 0 }, goalWest = { x: -6, y: 0, z: 0 };

    for (const p of block(n, 14, 0, 0, 3, 1.1)) {
        const rec = makeAgent(scene, p, {
            color: TEAM_B, faction: 0, role: 'crowd',
            priority: 0.5, layers: 1, mask: 7,
        });
        rec.endB = { ...goalWest };
        route(rec, rec.endB);
    }

    const vip = makeAgent(scene, { x: -7, y: 0, z: -0.6 }, {
        color: '#ffd166', emissive: 1.6, faction: 1, role: 'vip',
        priority: 1.0, layers: 2, mask: 1,
    });
    vip.endB = { ...goalEast };
    route(vip, vip.endB);

    const ctl = makeAgent(scene, { x: -7, y: 0, z: 0.6 }, {
        color: '#9aa7b4', emissive: 0.2, faction: 1, role: 'control',
        priority: 0.0, layers: 4, mask: 1,
    });
    ctl.endB = { ...goalEast };
    route(ctl, ctl.endB);

    crowdState.scenario = 'vip';
    resetStats();
    return crowdState.agents.length;
}

// layers/mask. Faction A occupies layer 1 and masks layer 1; faction B occupies
// layer 2 and masks layer 2. Each faction is itself two opposing streams, so
// within-faction avoidance has something to do, and the two streams cross at
// the same junction so cross-faction interpenetration is unmissable.
export function scenarioFactions(scene, n) {
    clearCrowd(scene);
    n = Math.max(4, n | 0);
    const per = Math.max(1, Math.floor(n / 4));
    const JX = -10, JZ = -8, REACH = 9;

    const streams = [
        // faction 0 walks along X through the junction, both ways
        { f: 0, from: { x: JX - REACH, z: JZ }, to: { x: JX + REACH, z: JZ } },
        { f: 0, from: { x: JX + REACH, z: JZ }, to: { x: JX - REACH, z: JZ } },
        // faction 1 walks along Z through the same junction
        { f: 1, from: { x: JX, z: JZ - REACH }, to: { x: JX, z: JZ + REACH } },
        { f: 1, from: { x: JX, z: JZ + REACH }, to: { x: JX, z: JZ - REACH } },
    ];

    for (const s of streams) {
        for (const p of block(per, s.from.x, s.from.z, 0, 2, 1.0)) {
            const rec = makeAgent(scene, p, {
                color: s.f ? TEAM_B : TEAM_A,
                faction: s.f, role: 'crowd',
                layers: s.f ? 2 : 1,
                mask: s.f ? 2 : 1,
            });
            rec.endB = { x: s.to.x, y: 0, z: s.to.z };
            route(rec, rec.endB);
        }
    }
    crowdState.scenario = 'factions';
    resetStats();
    return crowdState.agents.length;
}

// The elevation filter. Identical lanes at z = 11, one on the hall floor and
// one on the mezzanine four metres directly above it — the level was built with
// exactly this column of stacked walkable surface in it. Each level runs two
// opposing streams so the within-level solver is busy; across levels the spans
// [y - height/2, y + height/2] miss each other and the pair is skipped.
export const STACK_LANE = { z: 11, west: -19, east: -6 };

// `levels` exists for the smoke test: running the ground lane ALONE and then
// with the mezzanine crowd above it must produce bit-identical ground
// trajectories, which is the only unambiguous way to assert "these agents did
// not influence each other". `per` is derived from n and not from levels, so
// the ground roster is the same in both runs.
export function scenarioStacked(scene, n, levels) {
    clearCrowd(scene);
    n = Math.max(4, n | 0);
    const per = Math.max(1, Math.floor(n / 4));

    for (const y of (levels || [0, 4])) {
        for (const dir of [1, -1]) {
            const fromX = dir > 0 ? STACK_LANE.west : STACK_LANE.east;
            const toX   = dir > 0 ? STACK_LANE.east : STACK_LANE.west;
            for (const p of block(per, fromX + dir * 1.0, STACK_LANE.z, y, 2, 1.0)) {
                const rec = makeAgent(scene, p, {
                    color: y > 0 ? '#a58bff' : TEAM_A,
                    faction: y > 0 ? 1 : 0,
                    role: y > 0 ? 'mezz' : 'ground',
                });
                rec.endB = { x: toX, y, z: STACK_LANE.z };
                route(rec, rec.endB);
            }
        }
    }
    crowdState.scenario = 'stacked';
    resetStats();
    return crowdState.agents.length;
}

// Re-apply the avoidance height to every agent. The stacked test uses this to
// deliberately BREAK the elevation filter — a 12 m extent makes the ground and
// mezzanine spans overlap, the two crowds start seeing each other, and the
// trajectories change. That contrast is the proof the filter was doing work.
export function setAvoidHeight(h) {
    crowdState.avoidHeight = h;
    for (const rec of crowdState.agents) {
        rec.agent.setAvoidance(Object.assign(AVOID_DEFAULTS(), {
            priority: rec.priority,
            layers: rec.role === 'vip' ? 2 : rec.role === 'control' ? 4
                  : (crowdState.scenario === 'factions' ? (rec.faction ? 2 : 1) : 1),
            mask: rec.role === 'vip' || rec.role === 'control' ? 1
                : (crowdState.scenario === 'factions' ? (rec.faction ? 2 : 1)
                  : (crowdState.scenario === 'vip' ? 7 : 1)),
        }));
    }
}

// Snapshot every agent's XZ position and velocity — the stacked test compares
// two runs of the identical setup and needs an exact fingerprint of each.
export function snapshot(role) {
    return crowdState.agents
        .filter(r => !role || r.role === role)
        .map(r => ({ x: r.agent.x, z: r.agent.z,
                     vx: r.agent.velocity.x, vz: r.agent.velocity.z }));
}

// Put every agent back on its start line without rebuilding the roster, so two
// measured runs begin from bit-identical state.
export function resetPositions() {
    for (const rec of crowdState.agents) {
        rec.agent.setPosition(rec.endA.x, rec.endA.z);
        rec.y = rec.endA.y;
        rec.agent.elevation = rec.endA.y;
        rec.goingToB = true;
        route(rec, rec.endB || rec.endA);
    }
    resetStats();
}
