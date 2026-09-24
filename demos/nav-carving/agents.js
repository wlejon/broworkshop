// agents.js — walkers that follow plan.js routes, links included.
//
// Each agent is a bro.ai.game Agent in one AI world (ORCA avoidance on, with
// the elevation filter, so crowds on different storeys ignore each other)
// plus a capsule. Walk legs run on the kit's route follower (the Agent steers
// in XZ; the route supplies the height). Link legs take the agent off its
// steering and move it by hand:
//
//   CLIMBING          the ladder, straight up or down at CLIMB_SPEED
//   JUMPING           a parabola across the gap (kit linkPoint)
//   WAITING_ELEVATOR  calls the lift to its floor, boards when the doors open
//   RIDING_ELEVATOR   rides the car, steps out at its floor
//
// Repath: a walking agent whose plan predates the surface generation re-plans
// from where it stands; an agent parked short of an unreachable goal
// (`blocked`) re-plans too, so opening the gate sends it on its way.
//
// Why not node.navigateTo? A link ends in a teleport to another storey, and
// the binding plans its next route from the height of the route it last
// walked, not from where the agent now stands (see ENGINE-ISSUES.md).

import { capsule, startRoute, followRoute, linkPoint } from "/lib/kit/nav3d.js";
import { SHAFT, floorOf } from "/app/level.js";
import { nearest, generation } from "/app/nav.js";
import { plan, WALK_SPEED, CLIMB_SPEED, JUMP_TIME } from "/app/plan.js";
import { lift, callLift, boardable } from "/app/elevator.js";

export const STATE = {
    IDLE: 'IDLE', WALKING: 'WALKING', CLIMBING: 'CLIMBING', JUMPING: 'JUMPING',
    WAITING: 'WAITING_ELEVATOR', RIDING: 'RIDING_ELEVATOR',
};

const COLORS = ['#5ad2f4', '#7bed9f', '#ffd166', '#ff8fab', '#a58bff', '#ff8f5a', '#4fd1c5', '#f6e05e'];
const BODY = 0.76;   // capsule() centre above the feet

export const agentState = {
    world: null,
    agents: [],
    nextId: 1,
    traversals: { ladder: 0, jump: 0, lift: 0 },
    repaths: 0,
    seen: new Set(),     // every state any agent has been in (tests, HUD)
};

let sceneRef = null;

export function createAgentWorld(scene) {
    sceneRef = scene;
    agentState.world = bro.ai.game.createWorld();
    agentState.world.setAvoidance(true);
    return agentState.world;
}

export function spawnAgent(at) {
    const p = nearest(at) || at;
    const id = agentState.nextId++;
    const agent = bro.ai.game.createAgent({
        x: p.x, z: p.z, speed: WALK_SPEED, radius: 0.35, elevation: p.y,
        avoidance: { height: 2.0 },
    });
    agentState.world.addAgent(agent);
    const color = COLORS[(id - 1) % COLORS.length];
    const node = capsule(sceneRef, p, { name: `agent.${id}`, color, radius: 0.32, halfHeight: 0.44 });
    const rec = {
        id, agent, node, color, y: p.y, state: STATE.IDLE, goal: null, plan: null, legIdx: 0,
        route: null, leg: 0, done: true, link: null, blocked: false, onChange: null,
    };
    agentState.agents.push(rec);
    return rec;
}

/** A ring of `n` around a point. */
export function spawnSquad(n, at) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        out.push(spawnAgent({ x: at.x + Math.cos(a) * 2.2, y: at.y, z: at.z + Math.sin(a) * 2.2 }));
    }
    return out;
}

export function removeAgent(rec) {
    const i = agentState.agents.indexOf(rec);
    if (i < 0) return;
    agentState.world.removeAgent(rec.agent);
    rec.node.destroy();
    agentState.agents.splice(i, 1);
}

export function clearAgents() {
    for (const rec of agentState.agents.slice()) removeAgent(rec);
}

function setState(rec, s) {
    rec.state = s;
    agentState.seen.add(s);
}

/** Plan to `goal` from where the agent stands and start the first leg. */
export function sendTo(rec, goal) {
    rec.goal = { ...goal };
    rec.plan = plan({ x: rec.agent.x, y: rec.y, z: rec.agent.z }, rec.goal);
    rec.blocked = rec.plan.partial;
    rec.legIdx = -1;
    nextLeg(rec);
    if (rec.onChange) rec.onChange(rec);
    return rec.plan;
}

/**
 * Send everyone to one place, each to its own slot in rings around it (on the
 * surface, on the goal's storey): a crowd told to stand on one point never
 * finishes arriving, because avoidance keeps all but one of them off it.
 */
export function sendAll(goal) {
    return agentState.agents.map((rec, i) => sendTo(rec, slotAround(goal, i)));
}

function slotAround(goal, i) {
    if (i === 0) return goal;
    const ring = i <= 6 ? 1 : 2, k = ring === 1 ? i - 1 : i - 7, per = ring === 1 ? 6 : 12;
    const a = (k / per) * Math.PI * 2, r = ring * 1.1;
    const p = { x: goal.x + Math.cos(a) * r, y: goal.y, z: goal.z + Math.sin(a) * r };
    const q = nearest(p, { x: 0.4, y: 0.6, z: 0.4 });
    return q && Math.hypot(q.x - p.x, q.z - p.z) < 0.35 ? q : goal;
}

function nextLeg(rec) {
    rec.legIdx++;
    const leg = rec.plan && rec.plan.legs[rec.legIdx];
    if (!leg) {
        rec.done = true;
        rec.agent.clearTarget();
        setState(rec, STATE.IDLE);
        return;
    }
    if (leg.kind === 'walk') {
        // A walk leg planned before a carve may cross what is now a hole.
        if (rec.plan.generation !== generation() && rec.goal) { replan(rec); return; }
        setState(rec, startRoute(rec, leg.route) ? STATE.WALKING : STATE.IDLE);
        if (rec.state === STATE.IDLE) nextLeg(rec);
        return;
    }
    rec.agent.clearTarget();
    rec.link = { leg, t: 0, dur: leg.kind === 'ladder' ? Math.abs(leg.to.y - leg.from.y) / CLIMB_SPEED
                                 : leg.kind === 'jump' ? JUMP_TIME : 0 };
    setState(rec, leg.kind === 'ladder' ? STATE.CLIMBING : leg.kind === 'jump' ? STATE.JUMPING : STATE.WAITING);
}

function replan(rec) {
    agentState.repaths++;
    sendTo(rec, rec.goal);
}

function place(rec, p) {
    rec.agent.setPosition(p.x, p.z);
    rec.y = p.y;
    rec.agent.elevation = p.y;
}

function finishLink(rec) {
    const leg = rec.link.leg;
    place(rec, leg.to);
    agentState.traversals[leg.kind]++;
    rec.link = null;
    nextLeg(rec);
}

/** One fixed step for the world and every agent. */
export function tickAgents(dt) {
    const world = agentState.world;
    if (!world) return;
    world.tick(dt);
    const gen = generation();
    for (const rec of agentState.agents.slice()) {
        switch (rec.state) {
        case STATE.WALKING:
            if (rec.plan.generation !== gen) { replan(rec); break; }
            if (followRoute(rec)) nextLeg(rec);
            break;
        case STATE.IDLE:
            if (rec.blocked && rec.plan && rec.plan.generation !== gen) replan(rec);
            break;
        case STATE.CLIMBING:
        case STATE.JUMPING: {
            const L = rec.link;
            L.t = Math.min(1, L.t + dt / Math.max(0.05, L.dur));
            const p = linkPoint({ kind: L.leg.kind, start: L.leg.from, end: L.leg.to, arc: L.leg.def.arc }, L.t);
            place(rec, p);
            if (L.t >= 1) finishLink(rec);
            break;
        }
        case STATE.WAITING:
            callLift(rec.link.leg.fromFloor);
            if (boardable(rec.link.leg.fromFloor)) {
                setState(rec, STATE.RIDING);
                callLift(rec.link.leg.toFloor);
            }
            break;
        case STATE.RIDING: {
            // Riders stand in a ring on the car so a full lift is readable.
            const k = riderSlot(rec);
            place(rec, { x: SHAFT.x + Math.cos(k) * 0.45, y: lift.y, z: SHAFT.z + Math.sin(k) * 0.45 });
            if (boardable(rec.link.leg.toFloor)) finishLink(rec);
            break;
        }
        }
        rec.node.x = rec.agent.x; rec.node.y = rec.y + BODY; rec.node.z = rec.agent.z;
    }
}

function riderSlot(rec) {
    const riders = agentState.agents.filter((r) => r.state === STATE.RIDING);
    return (riders.indexOf(rec) / Math.max(1, riders.length)) * Math.PI * 2;
}

export function countIn(state) {
    return agentState.agents.filter((r) => r.state === state).length;
}

export function floorCounts() {
    const c = [0, 0, 0];
    for (const r of agentState.agents) c[floorOf(r.y)]++;
    return c;
}
