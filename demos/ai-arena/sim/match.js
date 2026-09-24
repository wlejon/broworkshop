// sim/match.js — one match: build it from a scenario, step it without a
// scene (headless evaluators, training, tests), and judge it.
//
// The live app (lab.js) builds its match here too, then hands the world to
// the scene (attachAIWorld) instead of stepping it itself.
import { Arena } from "/app/sim/arena.js";
import { Scenarios } from "/app/sim/scenarios.js";
import { AI } from "/app/sim/ai.js";
import { Agents } from "/app/agents/index.js";

export const SIM_DT = 1 / 60;

/**
 * Fresh match state for `scenario`. opts: { redAi, blueAi, seed }.
 * Resets AI memory and every agent's closure state, so nothing from the
 * previous match (MCTS trees, belief filters, BotAim) leaks in.
 */
export function newMatch(scenario, opts) {
    const o = opts || {};
    const built = Arena.build(scenario);
    if (o.seed != null) built.world.seed(o.seed);
    AI.reset();
    Agents.resetAll();
    const state = {
        scenario,
        nav: built.nav,
        world: built.world,
        agents: built.agents,
        byId: built.byId,
        redAi: o.redAi || "scripted",
        blueAi: o.blueAi || "scripted",
        elapsed: 0,
        simSteps: 0,
    };
    // Populate the shared view before the first think can fire.
    AI.updateShared(state);
    return state;
}

export function teamAlive(state, teamId) {
    let n = 0;
    for (const a of state.agents) if (a.unit.teamId === teamId && a.unit.alive) n++;
    return n;
}

export function teamHp(state, teamId) {
    let hp = 0;
    for (const a of state.agents) if (a.unit.teamId === teamId && a.unit.alive) hp += a.unit.hp;
    return hp;
}

/** 0 = red won, 1 = blue won, -1 = mutual wipe, null = both teams standing. */
export function decided(state) {
    const r = teamAlive(state, 0), b = teamAlive(state, 1);
    if (r && b) return null;
    return r ? 0 : b ? 1 : -1;
}

/** Final verdict: survivors win; at the time cap, more than 5% more HP wins; else -1. */
export function verdict(state) {
    const d = decided(state);
    if (d !== null) return d;
    const rh = teamHp(state, 0), bh = teamHp(state, 1);
    return bh > rh * 1.05 ? 1 : rh > bh * 1.05 ? 0 : -1;
}

/**
 * Scenario for match #i of red vs blue. Agents that declare homeScenarios
 * (decoupled_mcts: a 1v1; the squad planners: small squads) only produce
 * meaningful results there, so those win over a blind rotation; red's pool
 * first, since the showcased mode is conventionally red vs a baseline blue.
 */
export function pickScenario(redId, blueId, i) {
    const red = Agents.get(redId), blue = Agents.get(blueId);
    const pool = (red && red.homeScenarios) || (blue && blue.homeScenarios);
    if (pool && pool.length) {
        const scn = Scenarios.byId(pool[i % pool.length]);
        if (scn) return scn;
    }
    return Scenarios.ALL[i % Scenarios.ALL.length];
}

// Think at 30 Hz, like the scene's AgentBinding (thinkHz 30).
const THINK_STRIDE = 2;

/**
 * Step `state` through `steps` sim ticks without a scene: team planners and
 * every agent's think each THINK_STRIDE ticks, then world.tick. Stops early
 * once a team is wiped (checked every `checkEvery` ticks). opts.onEvent(ev)
 * sees each damage event. Returns the number of ticks run.
 *
 * Think is two-phase: every agent decides against the same snapshot, then
 * all moves/casts apply together, so neither team gets a first-mover
 * advantage from iteration order (in the scene, AgentBinding spreads thinks
 * across teams evenly). Basic shots are still spawned inside Bot.tick, which
 * is inherent to the reflex robot's firing model.
 */
export function stepHeadless(state, steps, opts) {
    const o = opts || {};
    const checkEvery = o.checkEvery || 30;
    const world = state.world;
    let k = 0;
    for (; k < steps; k++) {
        if (state.simSteps % THINK_STRIDE === 0) {
            AI.updateShared(state);
            Agents.tickTeams(state, SIM_DT * THINK_STRIDE);
            const pending = [];
            for (const a of state.agents) {
                if (!a.unit.alive) continue;
                Agents.thinkFor(capturingSelf(a, pending), world);
            }
            for (const op of pending) {
                if (!op.a.unit.alive) continue;
                if (op.op === "move") op.a.setTarget(op.x, op.z);
                else if (op.op === "cast") world.resolveAbility(op.a, op.slot, op.tid);
                else if (op.op === "attack") world.resolveAttack(op.a, op.tid);
                else op.a.clearTarget();
            }
        }

        world.tick(SIM_DT);
        state.elapsed += SIM_DT;
        state.simSteps++;

        // Damage feeds the threat tracker so cover/flee latches react the
        // same way they do in real-time play.
        for (const ev of world.events) {
            AI.recordDamage(ev.targetId, ev.attackerId, ev.amount, state.elapsed);
            if (o.onEvent) o.onEvent(ev);
        }
        world.clearEvents();

        if (k % checkEvery === 0 && decided(state) !== null) { k++; break; }
    }
    return k;
}

// The `self` proxy for a headless think: records the capability choice
// instead of applying it, mirroring the AgentBinding's built-ins. Custom
// capabilities (useCapability) only run inside a real binding, so they hold.
function capturingSelf(a, pending) {
    return {
        agent: a,
        moveTo: (x, z) => pending.push({ a, op: "move", x, z }),
        flee(x, z) {
            if (x === undefined) ({ x, z } = fleePoint(a));
            pending.push({ a, op: "move", x, z });
        },
        cast:   (slot, tid) => pending.push({ a, op: "cast", slot, tid }),
        attack: (tid) => pending.push({ a, op: "attack", tid }),
        inRange: (t) => Math.hypot(t.x - a.x, t.z - a.z) <= a.unit.attackRange,
        useCapability: () => pending.push({ a, op: "hold" }),
        hold:   () => pending.push({ a, op: "hold" }),
    };
}

// Where the built-in flee heads with no explicit point: away from the
// nearest enemy, one attack range out, inside the walls.
function fleePoint(a) {
    let best = null, bestD = Infinity;
    for (const e of AI.shared.teams[1 - a.unit.teamId] || []) {
        const d = Math.hypot(e.x - a.x, e.z - a.z);
        if (d < bestD) { bestD = d; best = e; }
    }
    if (!best || bestD < 1e-3) return { x: a.x, z: a.z };
    const r = a.unit.attackRange || 9;
    return {
        x: Arena.clampX(a.x + (a.x - best.x) / bestD * r),
        z: Arena.clampZ(a.z + (a.z - best.z) / bestD * r),
    };
}

/** Run a whole headless match; returns { winner, state, wallMs }. */
export function runHeadlessMatch(scenario, opts) {
    const o = opts || {};
    const state = newMatch(scenario, o);
    const t0 = Date.now();
    stepHeadless(state, Math.ceil((o.seconds || 45) / SIM_DT), o);
    return { winner: verdict(state), state, wallMs: Date.now() - t0 };
}
