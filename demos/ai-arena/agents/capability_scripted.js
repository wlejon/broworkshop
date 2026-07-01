// agents/capability_scripted.js — Showcases the real Capability/
// CapabilitySet system directly (self.moveTo / self.attack / self.cast /
// self.flee / self.hold), driven by a small priority ladder in think() —
// no Bot.tick reflex queue, no manual world.spawnProjectile. Every other
// agent in this app drives execution through bot.js, which bypasses
// "basic_attack" entirely and fires by hand (see bot.js's handleAim); this
// is the one place the built-in basic_attack/flee capabilities actually
// get exercised.
//
// Also registers one JS-authored capability via registerCapability to
// demonstrate that surface. Verified against ai_binding_integration.cpp:
// gate/start/advance all run with ZERO arguments — no per-agent context is
// threaded through, so a custom capability can only be a global, stateless
// trigger. "battle_cry" just logs a rally line on a cooldown; it can't
// target a specific ally or know which agent is evaluating it.
import { AI } from "/app/ai.js";
import { Agents } from "/app/agents/registry.js";

var BATTLE_CRY_COOLDOWN = 8;
var lastCryT = -999;
bro.ai.game.registerCapability("battle_cry", {
    gate: function () { return (AI.shared.simT - lastCryT) >= BATTLE_CRY_COOLDOWN; },
    start: function () { lastCryT = AI.shared.simT; },
    advance: function () { return true; },   // resolves the same tick it starts
});

(function () {
    "use strict";

    function nearestEnemy(agent, enemies) {
        var best = null, bestD = Infinity;
        for (var i = 0; i < enemies.length; i++) {
            var e = enemies[i];
            if (!e.unit.alive) continue;
            var d = (e.x - agent.x) * (e.x - agent.x) + (e.z - agent.z) * (e.z - agent.z);
            if (d < bestD) { bestD = d; best = e; }
        }
        return best;
    }

    function findWoundedAlly(agent, teammates) {
        var myF = agent.unit.maxHp > 0 ? agent.unit.hp / agent.unit.maxHp : 1;
        var best = null, worstF = myF;
        for (var i = 0; i < teammates.length; i++) {
            var t = teammates[i];
            if (t === agent || !t.unit.alive) continue;
            var d = Math.hypot(t.x - agent.x, t.z - agent.z);
            if (d > 4) continue;      // heal range
            var f = t.unit.maxHp > 0 ? t.unit.hp / t.unit.maxHp : 1;
            if (f < 0.75 && f < worstF) { worstF = f; best = t; }
        }
        return best;
    }

    Agents.register({
        id: "capability_scripted",
        label: "Capability-Scripted (self.* direct)",
        think: function (self) {
            var agent = self.agent;
            var u = agent.unit;
            if (!u.alive) { self.hold(0.3); return; }

            var enemies = AI.shared.teams[1 - u.teamId] || [];
            var teammates = AI.shared.teams[u.teamId] || [];
            var hpF = u.maxHp > 0 ? u.hp / u.maxHp : 1;

            if (hpF < 0.3) { self.flee(); return; }

            if (u.mana >= 25) {
                var wounded = findWoundedAlly(agent, teammates);
                if (wounded) { self.cast(0 /*heal*/, wounded.unit.id); return; }
            }

            var target = nearestEnemy(agent, enemies);
            if (!target) { self.hold(0.3); return; }

            if (self.inRange(target)) { self.attack(target.unit.id); return; }
            self.moveTo(target.x, target.z);
        },
    });
})();
