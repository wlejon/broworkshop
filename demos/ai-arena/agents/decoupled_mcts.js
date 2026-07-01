// agents/decoupled_mcts.js — 1v1 showcase for bro.ai.game.createDecoupledMcts
// (simultaneous-move search: both sides searched together in one call).
// Intended for Scenarios.DUEL_1V1 (exactly one hero per team) — on a bigger
// roster it still runs, but only the first living hero on each side gets a
// real decision; the rest hold, since a duel search only ever produces one
// {hero, opp} pair.
//
// teamTick replans on a cadence (REPLAN_EVERY_SEC) rather than every render
// frame — this is a full simultaneous-move MCTS (expensive relative to the
// small per-hero OptionMcts searches options_commander uses), and a
// budgetMs cap bounds each individual search call so a slow frame can't
// turn into a multi-second stall. Cached joint action applies in between.
import { AI } from "/app/ai.js";
import { ActionExec } from "/app/agents/action_exec.js";
import { Agents } from "/app/agents/registry.js";

var REPLAN_EVERY_SEC = 0.35;

(function () {
    "use strict";

    var duel = null;
    var lastPlanT = -999;
    var joint = null;             // { hero: CombatAction, opp: CombatAction }
    var heroUnitId = -1, oppUnitId = -1;

    function ensureDuel() {
        if (!duel) {
            duel = bro.ai.game.createDecoupledMcts({
                iterations: 600, budgetMs: 10, rolloutHorizon: 16, simDt: 1 / 60, actionRepeat: 3,
                // priorC switches selection from plain-UCT to PUCT. Without
                // it, plain-UCT's "unvisited-first" rule forces an
                // exhaustive linear pass through every untried action
                // before any real tree statistics can build — with a
                // ~130-action-per-side space (11 moveDirs x 2 attack x 6
                // ability slots in a 1v1 duel) and a 10ms budget, that
                // never finishes once, so search always returns whatever
                // the FIRST enumerated action happened to be (Hold/no-op).
                // See examples/08_decoupled_1v1.cpp for the reference config.
                prior: "attackBias", priorC: 1.5, evaluator: "hpDelta",
                rolloutPolicy: "aggressive", seed: 0xD3C0,
            });
        }
        return duel;
    }

    function teamTick(appState) {
        var simT = AI.shared.simT;
        if ((simT - lastPlanT) < REPLAN_EVERY_SEC) return;
        lastPlanT = simT;

        var redTeam = AI.shared.teams[0] || [], blueTeam = AI.shared.teams[1] || [];
        var hero = redTeam[0], opp = blueTeam[0];
        if (!hero || !opp || !hero.unit.alive || !opp.unit.alive) { joint = null; return; }
        heroUnitId = hero.unit.id;
        oppUnitId = opp.unit.id;

        var d = ensureDuel();
        joint = d.search(AI.shared.world, hero, opp);
        d.advanceRoot(joint.hero, joint.opp);
    }

    function think(self, world) {
        var u = self.agent.unit;
        if (!u.alive) { self.hold(0.3); return; }
        if (!joint) { self.hold(0.2); return; }
        var action = u.id === heroUnitId ? joint.hero
                   : u.id === oppUnitId ? joint.opp
                   : null;
        if (!action) { self.hold(0.2); return; }
        ActionExec.apply(self, world, action);
    }

    Agents.register({
        id: "decoupled_mcts",
        label: "Decoupled MCTS (1v1)",
        // Only ever produces a real decision for the FIRST hero on each
        // side (see file header) — everywhere else 7/8 heroes would just
        // hold(). The evaluators (fast_eval.js/headless_eval.js) read this
        // to force the matching scenario instead of blindly rotating.
        homeScenarios: ["duel_1v1"],
        reset: function () { duel = null; lastPlanT = -999; joint = null; },
        teamTick: teamTick,
        think: think,
        stats: function () {
            if (!duel || !duel.lastStats) return null;
            var s = duel.lastStats;
            return { label: "decoupled_mcts", iterations: s.iterations || 0,
                     bestVisits: s.bestVisits || 0 };
        },
    });
})();
