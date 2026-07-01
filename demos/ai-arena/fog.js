// fog.js — Fog-of-war VISUAL layer (Milestone 7). Independent of which AI
// agent is selected (unlike agents/infoset_mcts.js's belief, which only
// exists while that specific agent is picked) — this is a "show me what
// team X can currently see" viewer, toggled on/off from the UI/system menu,
// applied to the scene via Scene3D.syncVisibility/clearFog. Nothing here
// feeds back into any agent's think(); it's read-only over live world state
// through the same createTeamBelief + observe() primitives infoset_mcts.js
// uses for decision-making.
import { AI } from "/app/ai.js";
import { Scene3D } from "/app/scene_setup.js";

var VIS_CFG = { fovRadians: Math.PI * 0.6, maxRange: 14, checkLos: true };
var NUM_PARTICLES = 24;

export const Fog = (function () {
    "use strict";

    var enabled = false;
    var viewTeam = 0;
    var beliefByTeam = {};       // teamId -> TeamBelief (lazy, kept across toggles)
    var registeredByTeam = {};   // teamId -> {enemyId: true}

    function ensureBelief(teamId, nav) {
        if (!beliefByTeam[teamId]) {
            beliefByTeam[teamId] = bro.ai.game.createTeamBelief({
                teamId: teamId, numParticles: NUM_PARTICLES, navGrid: nav,
                motion: { maxSpeed: 6, accelStd: 4, spreadOnLoss: 3 },
                seed: (0xF06E0 + teamId) >>> 0,
            });
            registeredByTeam[teamId] = {};
        }
        return beliefByTeam[teamId];
    }

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

    return {
        setEnabled: function (v) {
            enabled = !!v;
            if (!enabled) Scene3D.clearFog();
        },
        isEnabled: function () { return enabled; },
        setTeam: function (teamId) { viewTeam = teamId; },
        getTeam: function () { return viewTeam; },

        // Called on App.rebuild() — old beliefs reference the previous
        // match's world/nav grid.
        reset: function () {
            beliefByTeam = {};
            registeredByTeam = {};
        },

        tick: function (state, dt) {
            if (!enabled) return;
            var tb = ensureBelief(viewTeam, state.nav);
            registerEnemiesOnce(tb, viewTeam, state.agents);
            tb.propagate(AI.shared.world, VIS_CFG, dt);
            var teamObs = bro.ai.game.observe(AI.shared.world, viewTeam, VIS_CFG, state.elapsed);
            tb.update(teamObs);

            var means = tb.mean();
            var enemies = tb.enemies();
            for (var i = 0; i < enemies.length; i++) {
                var m = means[enemies[i].enemyId];
                enemies[i].meanX = m ? m.x : null;
                enemies[i].meanZ = m ? m.z : null;
            }
            Scene3D.syncVisibility(viewTeam, enemies, state.byId);
        },
    };
})();
