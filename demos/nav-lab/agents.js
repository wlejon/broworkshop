// agents.js — walkers that actually traverse the routes the navmesh returns.
//
// Deliberately built on the plain `createWorld` / `createAgent` / `world.tick`
// surface with a JS-side waypoint follower, rather than on `attachAgent` +
// `node.navigateTo`. Two reasons:
//
//   1. It keeps the navmesh in the foreground. The route is a `findPath` result
//      this app owns and draws; the agent is only the thing that walks it. With
//      navigateTo the routing disappears into the binding, which is great for a
//      game and useless for a lab.
//
//   2. `Agent` steers in XZ only — `agent.elevation` exists purely to feed the
//      ORCA elevation filter and does not move anything. Height therefore has
//      to come from the waypoints, and doing that explicitly here shows exactly
//      how a 2D steering agent is driven along a 3D route.
//
// Chunk 2 turns on world.setAvoidance and the crowd; the world is created with
// that in mind, which is why it exists at all for what is currently a handful
// of independent walkers.

import { findPath, navState } from '/app/navmesh.js';

export const agentState = {
    world: null,
    agents: [],          // { agent, node, route, leg, speed, done }
    speed: 3.5,
    arriveEps: 0.55,     // XZ distance at which a waypoint counts as reached
    lastGeneration: -1,  // navmesh surface version these routes were planned on
    repaths: 0,          // how many times an obstacle change forced a re-plan
};

// One world for the whole app: the route-walkers here and crowd.js's scenario
// agents share it, because there is exactly one ORCA solve per tick and it has
// to see every body. They are kept apart by avoidance LAYER instead (see
// spawnAgent), which is cheaper and more honest than two worlds that could not
// avoid each other at all.
export function createAgentWorld() {
    agentState.world = bro.ai.game.createWorld();
    return agentState.world;
}

const COLORS = ['#ff6b6b', '#ffd166', '#5ad2f4', '#a58bff', '#7bed9f'];

export function spawnAgent(scene, at, index) {
    const agent = bro.ai.game.createAgent({
        x: at.x, z: at.z,
        speed: agentState.speed,
        radius: 0.4,
        elevation: at.y,     // feeds the ORCA elevation filter; movement is XZ
        // Avoidance layer 8, which no crowd scenario's mask includes. These
        // four walkers are a route demo, not part of the crowd, and letting
        // them wander into the choke would corrupt the crowd's overlap counter.
        avoidance: { layers: 8, mask: 8 },
    });
    agentState.world.addAgent(agent);

    const node = scene.createMesh({
        name: `agent.${index}`,
        mesh: 'capsule',
        radius: 0.34, halfHeight: 0.42,
        x: at.x, y: at.y + 0.76, z: at.z,
        color: COLORS[index % COLORS.length],
        metallic: 0.1, roughness: 0.45,
        emissive: 0.35,
    });

    const rec = { agent, node, route: null, leg: 0, done: true, y: at.y };
    agentState.agents.push(rec);
    return rec;
}

// Re-route one agent to a world point. Plans from where the agent actually
// stands (including its current height, so a walker on the mezzanine plans from
// the mezzanine and not from the hall below it).
export function retarget(rec, to) {
    const from = { x: rec.agent.x, y: rec.y, z: rec.agent.z };
    const res = findPath(from, to);
    if (!res || res.points.length < 2) {
        rec.route = null; rec.done = true;
        rec.goal = { ...to };
        rec.agent.clearTarget();
        return null;
    }
    rec.route = res;
    rec.goal = { ...to };            // kept so an obstacle change can re-plan
    rec.leg = 1;                     // points[0] is the snapped start
    rec.done = false;
    rec.agent.setTarget(res.points[1].x, res.points[1].z);
    return res;
}

export function retargetAll(to) {
    return agentState.agents.map(rec => retarget(rec, to));
}

// Advance every agent one fixed step and write the results onto the scene.
// The world tick does the steering; this function only decides when a waypoint
// has been consumed and what height the walker should be at.
// Re-plan every live route against the current surface. Called when the
// navmesh's `generation` moves, which happens once per applied obstacle batch
// and once per re-bake.
//
// node.navigateTo() does this natively — the binding snapshots `generation` at
// plan time and re-plans itself. This app owns its routes on purpose (the route
// is the thing being demonstrated), so it also owns the repath, and this is
// what that costs: eight lines and one integer comparison.
export function repathAll() {
    let n = 0;
    for (const rec of agentState.agents) {
        if (rec.done || !rec.goal) continue;
        retarget(rec, rec.goal);
        n++;
    }
    agentState.repaths++;
    return n;
}

export function tickAgents(dt) {
    const world = agentState.world;
    if (!world) return;

    // An obstacle dropped into the corridor these agents are walking makes
    // their route a lie. Detect the surface change before stepping, so nobody
    // takes a stride toward a waypoint that is now inside a crate.
    const gen = navState.mesh ? navState.mesh.generation : 0;
    if (agentState.lastGeneration < 0) {
        agentState.lastGeneration = gen;
    } else if (gen !== agentState.lastGeneration) {
        agentState.lastGeneration = gen;
        repathAll();
    }

    world.tick(dt);

    for (const rec of agentState.agents) {
        const { agent, node } = rec;

        if (rec.route && !rec.done) {
            const pts = rec.route.points;
            const tgt = pts[rec.leg];
            const d = Math.hypot(agent.x - tgt.x, agent.z - tgt.z);
            if (d < agentState.arriveEps) {
                if (rec.leg + 1 < pts.length) {
                    rec.leg++;
                    agent.setTarget(pts[rec.leg].x, pts[rec.leg].z);
                } else {
                    rec.done = true;
                    agent.clearTarget();
                }
            }
            // Height comes from the active leg: project the agent onto the
            // segment it is walking and lerp the waypoint heights. This is what
            // carries a walker up a ramp instead of through it.
            const a = pts[rec.leg - 1], b = pts[rec.leg];
            const sx = b.x - a.x, sz = b.z - a.z;
            const segLen2 = sx * sx + sz * sz;
            let t = segLen2 > 1e-6
                ? ((agent.x - a.x) * sx + (agent.z - a.z) * sz) / segLen2
                : 1;
            t = Math.max(0, Math.min(1, t));
            rec.y = a.y + (b.y - a.y) * t;
        }

        node.x = agent.x;
        node.y = rec.y + 0.76;
        node.z = agent.z;
        node.rotationY = agent.yaw;
        // Feeds the ORCA multi-level filter that chunk 2 switches on: two
        // walkers stacked on the mezzanine and the hall must not shove each
        // other through the floor.
        agent.elevation = rec.y;
    }
}

export function allArrived() {
    return agentState.agents.every(r => r.done);
}
