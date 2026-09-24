// agents/infoset_mcts.js — Per-team fog-of-war squad showcase for
// bro.ai.game.createTeamBelief + observe() + createInfoSetMcts. Ground
// truth stays fully simulated (brogameagent's World has no visibility
// concept); the belief particle filter (sim/belief.js) is a JS-side lens each
// team's planner searches through instead of the live world state. One
// InfoSetMcts instance per living hero (each hero gets its own
// under-partial-observability search over the shared team belief).
//
// Belief propagate/update run every teamTick call (dt-dependent particle
// motion, needs to track real elapsed time) but the per-hero IS-MCTS
// searches — the expensive part, one full search per living hero — are
// throttled to a cadence (REPLAN_EVERY_SEC) with a budgetMs cap each,
// same reasoning as team_mcts.js / layered_planner.js. Best on a small
// roster (Scenarios.SQUAD_3V3 / SQUAD_4V4) — an InfoSetMcts search per
// hero doesn't scale to 8-a-side at interactive budgets.
//
// The search itself is genuinely belief-driven, not decorative:
// InfoSetMcts::search (brogameagent/src/info_set_mcts.cpp) determinizes a
// fresh sample from the belief before every rollout and restores real truth
// only after search completes — enemy positions/hp the rollouts reason over
// are sampled, not read off the live World. That alone isn't sufficient for
// real partial observability end-to-end, though: buildActionMask (used by
// action_exec.js to turn the search's chosen attackSlot into an actual
// target id) reads the live, fully-visible World, so execution could always
// resolve and hit a real enemy at a given slot regardless of whether this
// team's belief had ever detected it. think() closes that gap by passing the
// team's known-enemy set into ActionExec.apply, so a hero can't target what
// its own team has never observed.
import { AI } from "/app/sim/ai.js";
import { beliefTracker } from "/app/sim/belief.js";
import { ActionExec } from "/app/agents/action_exec.js";
import { Agents } from "/app/agents/registry.js";

const REPLAN_EVERY_SEC = 0.4;

const beliefs = beliefTracker(0xBE11F0);
let isMctsByHero = {};    // heroUnitId -> InfoSetMcts
let actionsByTeam = {};   // teamId -> { unitId: CombatAction }
let lastPlanT = {};       // teamId -> simT of last IS-MCTS replan

function ensureIsMcts(heroId) {
    if (!isMctsByHero[heroId]) {
        const m = bro.ai.game.createInfoSetMcts();
        m.setEvaluator("hpDelta");
        m.setPrior("attackBias");
        // priorC — see decoupled_mcts.js for why this is required, not
        // optional, once a node's action space exceeds what the iteration
        // budget can exhaustively try once.
        m.setConfig({ iterations: 150, budgetMs: 10, rolloutHorizon: 12, simDt: 1 / 60, priorC: 1.5 });
        isMctsByHero[heroId] = m;
    }
    return isMctsByHero[heroId];
}

function teamTick(state, teamId, dt) {
    const heroes = (AI.shared.teams[teamId] || []).filter((h) => h && h.unit && h.unit.alive);
    if (!heroes.length) { actionsByTeam[teamId] = null; return; }

    const tb = beliefs.update(teamId, state, dt);

    const simT = AI.shared.simT;
    const last = lastPlanT[teamId];
    if (last !== undefined && (simT - last) < REPLAN_EVERY_SEC) return;
    lastPlanT[teamId] = simT;

    const byUnitId = {};
    for (const hero of heroes) {
        const m = ensureIsMcts(hero.unit.id);
        m.setBelief(tb);
        const action = m.search(AI.shared.world, hero);
        m.advanceRoot(action);
        byUnitId[hero.unit.id] = action;
    }
    actionsByTeam[teamId] = byUnitId;
}

function think(self, world) {
    const u = self.agent.unit;
    if (!u.alive) { self.hold(0.3); return; }
    const byUnitId = actionsByTeam[u.teamId];
    const action = byUnitId && byUnitId[u.id];
    if (!action) { self.hold(0.2); return; }
    ActionExec.apply(self, world, action, beliefs.knownEnemyIds(u.teamId));
}

Agents.register({
    id: "infoset_mcts",
    label: "InfoSet MCTS (fog of war)",
    homeScenarios: ["squad_3v3", "squad_4v4"],
    reset() {
        beliefs.reset();
        isMctsByHero = {}; actionsByTeam = {}; lastPlanT = {};
    },
    teamTick,
    think,
    stats(state, teamId) {
        const tb = beliefs.get(teamId);
        if (!tb) return null;
        return { label: "infoset_mcts", ess: tb.ess, particles: tb.numParticles };
    },
});
