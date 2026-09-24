// agents.js — walkers that traverse the routes the navmesh returns.
//
// Built on the plain `createWorld` / `createAgent` / `world.tick` surface with
// the kit's JS waypoint follower, not on `attachAgent` + `navigateTo`: the
// route is a findPath result this app owns and draws, and the agent is only
// the thing that walks it. `Agent` steers in XZ, so the height has to come
// from the waypoints (kit followRoute), which shows exactly how a 2D steering
// agent is driven along a 3D route. links.js has the binding-driven walkers.
//
// One AI world for the whole app (one ORCA solve per tick has to see every
// body); these four sit on avoidance layer 8, which no crowd scenario masks.

import { capsule, startRoute, followRoute } from "/lib/kit/nav3d.js";
import { findPath, navState } from "/app/navmesh.js";

export const agentState = {
    world: null,
    agents: [],          // { agent, node, route, leg, y, done, goal }
    speed: 3.5,
    lastGeneration: -1,  // navmesh surface version these routes were planned on
    repaths: 0,          // re-plans forced by a surface change
};

const COLORS = ['#ff6b6b', '#ffd166', '#5ad2f4', '#a58bff', '#7bed9f'];
const LIFT = 0.76;       // capsule centre above the surface

export function createAgentWorld() {
    agentState.world = bro.ai.game.createWorld();
    return agentState.world;
}

export function spawnAgent(scene, at, index) {
    const agent = bro.ai.game.createAgent({
        x: at.x, z: at.z, speed: agentState.speed, radius: 0.4, elevation: at.y,
        avoidance: { layers: 8, mask: 8 },
    });
    agentState.world.addAgent(agent);
    const node = capsule(scene, at, { name: `agent.${index}`, color: COLORS[index % COLORS.length] });
    const rec = { agent, node, route: null, leg: 0, done: true, y: at.y, goal: null };
    agentState.agents.push(rec);
    return rec;
}

export function setSpeed(v) {
    agentState.speed = v;
    for (const rec of agentState.agents) rec.agent.speed = v;
}

/** Re-route one walker, planning from where it stands (its height included). */
export function retarget(rec, to) {
    rec.goal = { ...to };
    const res = findPath({ x: rec.agent.x, y: rec.y, z: rec.agent.z }, to);
    startRoute(rec, res);
    return rec.route;
}

export function retargetAll(to) {
    return agentState.agents.map((rec) => retarget(rec, to));
}

/**
 * Re-plan every live route against the current surface. node.navigateTo does
 * this natively (the binding snapshots `generation`); this app owns its
 * routes, so it owns the repath too — one integer comparison per tick.
 */
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

/** Step the world one fixed tick and carry every walker along its route. */
export function tickAgents(dt) {
    const world = agentState.world;
    if (!world) return;
    // Detect a surface change before stepping, so nobody strides toward a
    // waypoint that is now inside a crate.
    const gen = navState.mesh ? navState.mesh.generation : 0;
    if (agentState.lastGeneration >= 0 && gen !== agentState.lastGeneration) repathAll();
    agentState.lastGeneration = gen;

    world.tick(dt);
    for (const rec of agentState.agents) {
        followRoute(rec);
        const { agent, node } = rec;
        node.x = agent.x; node.y = rec.y + LIFT; node.z = agent.z;
    }
}

export function walkingCount() {
    return agentState.agents.filter((a) => !a.done).length;
}
