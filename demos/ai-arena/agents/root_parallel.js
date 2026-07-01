// agents/root_parallel.js — Showcase for the blocking
// bro.ai.game.rootParallelSearch (Milestone 1's binding): N native threads
// each search their own cloned World, joined and merged into one action.
// rootParallelSearch's contract is single-hero-vs-rest (same shape as
// createMcts), so this fits the 1v1 duel scenario (Scenarios.DUEL_1V1),
// same as decoupled_mcts.js.
//
// Genuinely expensive relative to a per-tick planner (N full searches,
// fully joined before the call returns), so this replans on a cadence
// instead of every think tick and applies the cached action in between.
//
// Clone worlds are built via Arena.build(Arena.scenario) — Arena.build
// reassigns Arena.BOUNDS/OBSTACLES/ROSTER/COLORS/scenario as a side effect,
// but since we always pass Arena's OWN current scenario back into itself,
// those reassignments are identical values — a no-op in practice, just
// avoids duplicating arena.js's ability-registration wiring for a
// throwaway clone.
import { AI } from "/app/ai.js";
import { ActionExec } from "/app/agents/action_exec.js";
import { Agents } from "/app/agents/registry.js";
import { Arena } from "/app/arena.js";

var NUM_WORLDS = 4;
var REPLAN_EVERY_SEC = 0.6;

(function () {
    "use strict";

    var cachedAction = {};   // teamId -> CombatAction
    var lastPlanT = {};      // teamId -> simT of last replan
    var lastStats = {};      // teamId -> ParallelSearchStats

    function buildCloneWorlds(liveWorld) {
        var wsnap = bro.ai.game.captureWorldSnapshot(liveWorld);
        var worlds = [];
        for (var i = 0; i < NUM_WORLDS; i++) {
            var built = Arena.build(Arena.scenario);
            bro.ai.game.applyWorldSnapshot(built.world, wsnap);
            worlds.push(built.world);
        }
        return worlds;
    }

    function teamTick(appState, teamId) {
        var simT = AI.shared.simT;
        var last = lastPlanT[teamId];
        if (last !== undefined && (simT - last) < REPLAN_EVERY_SEC) return;

        var mine = (AI.shared.teams[teamId] || [])[0];
        if (!mine || !mine.unit.alive) { cachedAction[teamId] = null; return; }

        lastPlanT[teamId] = simT;
        var worlds = buildCloneWorlds(AI.shared.world);
        var result = bro.ai.game.rootParallelSearch({
            worlds: worlds, heroId: mine.unit.id,
            iterations: 150, budgetMs: 10, rolloutHorizon: 12, actionRepeat: 3,
            evaluator: "hpDelta", rolloutPolicy: "aggressive", opponentPolicy: "aggressive",
            seed: (0xF00D + teamId) >>> 0,
        });
        cachedAction[teamId] = result.action;
        lastStats[teamId] = result.stats;
    }

    function think(self, world) {
        var u = self.agent.unit;
        if (!u.alive) { self.hold(0.3); return; }
        var action = cachedAction[u.teamId];
        if (!action) { self.hold(0.2); return; }
        ActionExec.apply(self, world, action);
    }

    Agents.register({
        id: "root_parallel",
        label: "Root-Parallel Search (4 threads)",
        reset: function () { cachedAction = {}; lastPlanT = {}; lastStats = {}; },
        teamTick: teamTick,
        think: think,
        stats: function (appState, teamId) {
            var s = lastStats[teamId];
            if (!s) return null;
            return {
                label: "root_parallel",
                threads: s.numThreads, totalIters: s.totalIterations,
                elapsedMs: s.elapsedMs, bestVisits: s.mergedBestVisits,
            };
        },
    });
})();
