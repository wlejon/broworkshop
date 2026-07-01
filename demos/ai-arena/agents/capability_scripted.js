// agents/capability_scripted.js — Showcases the real Capability/
// CapabilitySet system directly (self.moveTo / self.attack / self.cast /
// self.flee / self.hold / self.useCapability), driven by a small priority
// ladder in think() — no Bot.tick reflex queue, no manual
// world.spawnProjectile. Every other agent in this app drives execution
// through bot.js, which bypasses "basic_attack" entirely and fires by hand
// (see bot.js's handleAim); this is the one place the built-in
// basic_attack/flee capabilities actually get exercised. Note self.attack()
// resolves instantly (world.resolveAttack has no travel-time/dodge window),
// unlike scripted's projectile-based shot — a win/loss here reflects that
// mechanical difference as much as decision quality, so this mode isn't a
// fair head-to-head combat comparison against scripted.
//
// Its real differentiator is "battle_cry", a JS-authored capability
// registered via registerCapability: a team-wide rally buff nothing else in
// this app can replicate, since bot.js's reflex queue has no hook into the
// Capability system at all. Custom capabilities have no self.<name>()
// accessor of their own — self.useCapability(name) (a generic invocation
// method, added because none previously existed: verified against
// ai_binding_integration.cpp that a registerCapability'd spec was
// unreachable from any thinkHook_-driven agent — gate/start never fired
// even when attached) sets it as the pending action. gate/start/advance run
// with ZERO per-agent arguments — the native layer can't tell start() which
// team is calling it — so pendingBuffTeamId below is a synchronous JS
// handoff: think() sets it immediately before calling useCapability(), and
// start() runs synchronously within the same AgentBinding::step call before
// any other agent's think() executes, so it's always still correct when
// read.
import { AI } from "/app/ai.js";
import { Agents } from "/app/agents/registry.js";

var BATTLE_CRY_COOLDOWN = 8;
var BATTLE_CRY_DURATION = 4;
var BATTLE_CRY_RANGE = 12;
var lastCryT = -999;
var pendingBuffTeamId = -1;

bro.ai.game.registerCapability("battle_cry", {
    start: function () {
        var teamId = pendingBuffTeamId;
        pendingBuffTeamId = -1;
        if (teamId < 0) return;
        var mates = AI.shared.teams[teamId] || [];
        for (var i = 0; i < mates.length; i++) {
            var m = mates[i];
            if (!m.unit.alive) continue;
            m.unit.attacksMul = 1.25;
            m.unit.attacksMulRemaining = BATTLE_CRY_DURATION;
            m.unit.moveSpeedMul = 1.2;
            m.unit.moveSpeedMulRemaining = BATTLE_CRY_DURATION;
        }
    },
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

            // Rally the team when a fight is imminent. lastCryT is a
            // module-level (not per-unit) cooldown, so it's shared across
            // every capability_scripted hero on this team — whichever one's
            // think() runs first this window claims it, giving one team-wide
            // cry instead of every hero re-triggering it redundantly.
            var distToTarget = Math.hypot(target.x - agent.x, target.z - agent.z);
            if (distToTarget < BATTLE_CRY_RANGE && (AI.shared.simT - lastCryT) >= BATTLE_CRY_COOLDOWN) {
                lastCryT = AI.shared.simT;
                pendingBuffTeamId = u.teamId;
                self.useCapability("battle_cry");
                return;
            }

            if (self.inRange(target)) { self.attack(target.unit.id); return; }
            self.moveTo(target.x, target.z);
        },
    });
})();
