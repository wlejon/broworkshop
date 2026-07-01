// agents/infoset_mcts.js — Per-team fog-of-war squad showcase for
// bro.ai.game.createTeamBelief + observe() + createInfoSetMcts. Ground
// truth stays fully simulated (brogameagent's World has no visibility
// concept); the belief particle filter is a JS-side lens each team's
// planner searches through instead of the live world state. One
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
import { AI } from "/app/ai.js";
import { ActionExec } from "/app/agents/action_exec.js";
import { Agents } from "/app/agents/registry.js";

var VIS_CFG = { fovRadians: Math.PI * 0.6, maxRange: 14, checkLos: true };
var NUM_PARTICLES = 24;
var REPLAN_EVERY_SEC = 0.4;

(function () {
    "use strict";

    var beliefByTeam = {};       // teamId -> TeamBelief
    var registeredByTeam = {};   // teamId -> Set-like {enemyId: true}
    var isMctsByHero = {};       // heroUnitId -> InfoSetMcts
    var actionsByTeam = {};      // teamId -> { unitId: CombatAction }
    var lastPlanT = {};          // teamId -> simT of last IS-MCTS replan

    function ensureBelief(teamId, nav) {
        if (!beliefByTeam[teamId]) {
            beliefByTeam[teamId] = bro.ai.game.createTeamBelief({
                teamId: teamId, numParticles: NUM_PARTICLES, navGrid: nav,
                motion: { maxSpeed: 6, accelStd: 4, spreadOnLoss: 3 },
                seed: (0xBE11F0 + teamId) >>> 0,
            });
            registeredByTeam[teamId] = {};
        }
        return beliefByTeam[teamId];
    }

    // Register every enemy roster member once (seeded with ground-truth
    // start position — matches don't randomize fog at spawn). Belief
    // tracking of hidden movement takes over from there via propagate/update.
    function registerEnemiesOnce(tb, teamId, allAgents) {
        var seen = registeredByTeam[teamId];
        for (var i = 0; i < allAgents.length; i++) {
            var a = allAgents[i];
            if (a.unit.teamId === teamId) continue;
            if (seen[a.unit.id]) continue;
            seen[a.unit.id] = true;
            tb.registerEnemy(a.unit.id, a.unit.maxHp, { x: a.x, z: a.z });
        }
    }

    function ensureIsMcts(heroId) {
        if (!isMctsByHero[heroId]) {
            var m = bro.ai.game.createInfoSetMcts();
            m.setEvaluator("hpDelta");
            m.setPrior("attackBias");
            // priorC — see decoupled_mcts.js for why this is required, not
            // optional, once a node's action space exceeds what the
            // iteration budget can exhaustively try once.
            m.setConfig({ iterations: 150, budgetMs: 10, rolloutHorizon: 12, simDt: 1 / 60, priorC: 1.5 });
            isMctsByHero[heroId] = m;
        }
        return isMctsByHero[heroId];
    }

    function teamTick(appState, teamId, dt) {
        var heroes = (AI.shared.teams[teamId] || []).filter(function (h) {
            return h && h.unit && h.unit.alive;
        });
        if (!heroes.length) { actionsByTeam[teamId] = null; return; }

        var tb = ensureBelief(teamId, appState.nav);
        registerEnemiesOnce(tb, teamId, appState.agents);
        tb.propagate(AI.shared.world, VIS_CFG, dt);
        var teamObs = bro.ai.game.observe(AI.shared.world, teamId, VIS_CFG, appState.elapsed);
        tb.update(teamObs);

        var simT = AI.shared.simT;
        var last = lastPlanT[teamId];
        if (last !== undefined && (simT - last) < REPLAN_EVERY_SEC) return;
        lastPlanT[teamId] = simT;

        var byUnitId = {};
        for (var i = 0; i < heroes.length; i++) {
            var hero = heroes[i];
            var m = ensureIsMcts(hero.unit.id);
            m.setBelief(tb);
            var action = m.search(AI.shared.world, hero);
            m.advanceRoot(action);
            byUnitId[hero.unit.id] = action;
        }
        actionsByTeam[teamId] = byUnitId;
    }

    function think(self, world) {
        var u = self.agent.unit;
        if (!u.alive) { self.hold(0.3); return; }
        var byUnitId = actionsByTeam[u.teamId];
        var action = byUnitId && byUnitId[u.id];
        if (!action) { self.hold(0.2); return; }
        ActionExec.apply(self, world, action);
    }

    Agents.register({
        id: "infoset_mcts",
        label: "InfoSet MCTS (fog of war)",
        homeScenarios: ["squad_3v3", "squad_4v4"],
        reset: function () {
            beliefByTeam = {}; registeredByTeam = {};
            isMctsByHero = {}; actionsByTeam = {}; lastPlanT = {};
        },
        teamTick: teamTick,
        think: think,
        stats: function (appState, teamId) {
            var tb = beliefByTeam[teamId];
            if (!tb) return null;
            return { label: "infoset_mcts", ess: tb.ess, particles: tb.numParticles };
        },
    });
})();
