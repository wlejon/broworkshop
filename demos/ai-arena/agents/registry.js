// agents/registry.js — Registry of AI algorithms selectable per team.
//
// Each entry:
//   id             short id used in state.redAi / state.blueAi and the selectors
//   label          UI label
//   think          (self, world) => void — per-agent think called by the
//                  AgentBinding at thinkHz (or by sim/headless.js). `self` is
//                  the bound capability proxy around the agent.
//   teamTick?      (state, teamId, dt) => void — optional team-level planner
//                  run once per frame before per-agent think. Write plan state
//                  into per-agent memory; think reads it.
//   stats?         (state, teamId) => { label, ... } — optional block for the
//                  AGENT STATS panel; keys render verbatim.
//   reset?         () => void — drop closure-held state between matches.
//   homeScenarios? scenario ids the agent is designed for (the evaluators
//                  pick from these instead of rotating through every scenario).
//
// Register at module-load time. Dispatch looks the id up on every call, so
// hot-swapping via the Red/Blue selectors needs no re-attaching.
import { AI } from "/app/sim/ai.js";

const byId = {};
const ordered = [];

function activeFor(state, teamId) {
    const id = state ? (teamId === 0 ? state.redAi : state.blueAi) : null;
    return byId[id] || null;
}

export const Agents = {
    register(def) {
        if (!def || !def.id || typeof def.think !== "function") throw new Error("Agents.register: invalid definition");
        if (byId[def.id]) throw new Error("Agents.register: duplicate id " + def.id);
        byId[def.id] = def;
        ordered.push(def);
    },

    get: (id) => byId[id] || null,
    all: () => ordered.slice(),

    /**
     * The per-agent think the bindings call. Routes to the agent selected for
     * the unit's team in the current match (AI.shared.state); an unknown id
     * falls back to the first registered agent (scripted).
     */
    thinkFor(self, world) {
        const def = activeFor(AI.shared.state, self.agent.unit.teamId) || ordered[0];
        if (def) def.think(self, world);
    },

    /** Team-level planners, once per frame before per-agent think. */
    tickTeams(state, dt) {
        for (let teamId = 0; teamId < 2; teamId++) {
            const def = activeFor(state, teamId);
            if (def && def.teamTick) def.teamTick(state, teamId, dt);
        }
    },

    /** Drop every agent's closure-held state (called on each new match). */
    resetAll() {
        for (const def of ordered) if (def.reset) def.reset();
    },

    /** Stats from whichever team's agent publishes them; blue first. */
    collectStats(state) {
        for (const teamId of [1, 0]) {
            const def = activeFor(state, teamId);
            const s = def && def.stats ? def.stats(state, teamId) : null;
            if (s) return s;
        }
        return null;
    },
};
