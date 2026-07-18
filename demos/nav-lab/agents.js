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

import { findPath } from '/app/navmesh.js';

export const agentState = {
    world: null,
    agents: [],          // { agent, node, route, leg, speed, done }
    speed: 3.5,
    arriveEps: 0.55,     // XZ distance at which a waypoint counts as reached
};

export function createAgentWorld() {
    agentState.world = bro.ai.game.createWorld();
    // CHUNK 2: agentState.world.setAvoidance({ ... }) — ORCA through the choke.
    return agentState.world;
}

const COLORS = ['#ff6b6b', '#ffd166', '#5ad2f4', '#a58bff', '#7bed9f'];

export function spawnAgent(scene, at, index) {
    const agent = bro.ai.game.createAgent({
        x: at.x, z: at.z,
        speed: agentState.speed,
        radius: 0.4,
        elevation: at.y,     // ORCA-only today; chunk 2 makes it matter
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
        rec.agent.clearTarget();
        return null;
    }
    rec.route = res;
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
export function tickAgents(dt) {
    const world = agentState.world;
    if (!world) return;
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
