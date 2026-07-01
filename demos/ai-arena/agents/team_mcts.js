// agents/team_mcts.js — Cooperative squad showcase for
// bro.ai.game.createTeamMcts. One planner per team searches jointly for the
// whole live squad; teamTick replans on a cadence (REPLAN_EVERY_SEC, not
// every render frame — a joint team search is expensive) and caches the
// per-hero CombatAction (keyed by unit id) in between. A budgetMs cap
// bounds each individual search call. Best on a small roster
// (Scenarios.SQUAD_3V3 / SQUAD_4V4) — searching all 8 heroes of the
// default scenario would still be slow even with these caps.
import { AI } from "/app/ai.js";
import { ActionExec } from "/app/agents/action_exec.js";
import { Agents } from "/app/agents/registry.js";

var REPLAN_EVERY_SEC = 0.35;

(function () {
    "use strict";

    var mctsByTeam = {};      // teamId -> TeamMcts handle
    var actionsByTeam = {};   // teamId -> { unitId: CombatAction }
    var lastPlanT = {};       // teamId -> simT of last replan

    function ensureMcts(teamId) {
        if (!mctsByTeam[teamId]) {
            mctsByTeam[teamId] = bro.ai.game.createTeamMcts({
                iterations: 350, budgetMs: 12, rolloutHorizon: 12, actionRepeat: 3,
                prior: "attackBias", rolloutPolicy: "aggressive",
                opponentPolicy: "aggressive", evaluator: "teamHpDelta",
                seed: (0x7EA3 + teamId) >>> 0,
            });
        }
        return mctsByTeam[teamId];
    }

    function teamTick(appState, teamId) {
        var simT = AI.shared.simT;
        var last = lastPlanT[teamId];
        if (last !== undefined && (simT - last) < REPLAN_EVERY_SEC) return;

        var heroes = (AI.shared.teams[teamId] || []).filter(function (h) {
            return h && h.unit && h.unit.alive;
        });
        if (!heroes.length) { actionsByTeam[teamId] = null; return; }
        lastPlanT[teamId] = simT;

        var m = ensureMcts(teamId);
        var perHero = m.search(AI.shared.world, heroes);
        m.advanceRoot(perHero);

        var byUnitId = {};
        for (var i = 0; i < heroes.length; i++) byUnitId[heroes[i].unit.id] = perHero[i];
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
        id: "team_mcts",
        label: "Team MCTS (cooperative)",
        reset: function () { mctsByTeam = {}; actionsByTeam = {}; lastPlanT = {}; },
        teamTick: teamTick,
        think: think,
        stats: function (appState, teamId) {
            var m = mctsByTeam[teamId];
            if (!m || !m.lastStats) return null;
            return { label: "team_mcts", iterations: m.lastStats.iterations || 0 };
        },
    });
})();
