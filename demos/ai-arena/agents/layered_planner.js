// agents/layered_planner.js — Showcase for bro.ai.game.createLayeredPlanner
// (TacticMcts over TeamMcts with a tactic-match prior): a coarse team tactic
// is committed every few windows (tacticWindowDecisions), and a per-hero
// fine search runs every decide() call within that tactic's bias. The fine
// search is the expensive part (full TeamMcts per call), so teamTick still
// throttles decide() itself to a cadence (REPLAN_EVERY_SEC) rather than
// calling it every render frame, same reasoning as team_mcts.js. budgetMs
// caps bound both the tactic and fine searches individually. Best on a
// small roster (Scenarios.SQUAD_3V3 / SQUAD_4V4).
import { AI } from "/app/ai.js";
import { ActionExec } from "/app/agents/action_exec.js";
import { Agents } from "/app/agents/registry.js";

var REPLAN_EVERY_SEC = 0.4;

(function () {
    "use strict";

    var plannerByTeam = {};
    var actionsByTeam = {};
    var lastPlanT = {};

    function ensurePlanner(teamId) {
        if (!plannerByTeam[teamId]) {
            // priorC on both layers — see decoupled_mcts.js for why this
            // is required once a node's action space exceeds what the
            // iteration budget can exhaustively try once (plain-UCT's
            // unvisited-first rule otherwise never reaches real tree
            // statistics). fine wraps TeamMcts internally, same exposure
            // as team_mcts.js.
            plannerByTeam[teamId] = bro.ai.game.createLayeredPlanner({
                tactic: { iterations: 150, budgetMs: 8, rolloutHorizon: 10, tacticWindowDecisions: 4, actionRepeat: 4, priorC: 1.5 },
                fine:   { iterations: 250, budgetMs: 10, rolloutHorizon: 10, actionRepeat: 3, priorC: 1.5 },
                // Model the opponent this mode is actually evaluated
                // against — see team_mcts.js for why "aggressive" was wrong.
                rolloutPolicy: "aggressive", opponentPolicy: "scripted",
                evaluator: "teamHpDelta", seed: (0x1A4E + teamId) >>> 0,
            });
        }
        return plannerByTeam[teamId];
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

        var p = ensurePlanner(teamId);
        var group = p.decide(AI.shared.world, heroes);

        var byUnitId = {};
        for (var i = 0; i < heroes.length; i++) byUnitId[heroes[i].unit.id] = group[i];
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
        id: "layered_planner",
        label: "Layered Planner (tactic+fine)",
        homeScenarios: ["squad_3v3", "squad_4v4"],
        reset: function () { plannerByTeam = {}; actionsByTeam = {}; lastPlanT = {}; },
        teamTick: teamTick,
        think: think,
        stats: function (appState, teamId) {
            var p = plannerByTeam[teamId];
            if (!p) return null;
            return {
                label: "layered_planner",
                tactic: p.committedTactic ? p.committedTactic.kind : "?",
                windowsUntilReplan: p.windowsUntilReplan,
                fineIters: (p.lastStats && p.lastStats.fineStats) ? p.lastStats.fineStats.iterations : 0,
            };
        },
    });
})();
