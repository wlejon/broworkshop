// agents/action_exec.js — Applies a raw CombatAction {moveDir, attackSlot,
// abilitySlot} (what DecoupledMcts / TeamMcts / LayeredPlanner / InfoSetMcts
// all return) to a live agent via the self capability
// proxy (move_to / cast_ability — see main.js's CAPS list).
//
// Mirrors brogameagent's own CombatAction::apply() (brogameagent/src/mcts.cpp)
// so "run the action the search chose" means the same thing here as it does
// inside the search's own rollouts:
//   - attackSlot resolves through buildActionMask's enemyIds — the SAME
//     slot ordering the search reasoned over — never a raw unit id.
//   - abilitySlot targets the attack target if present, else the nearest
//     enemy, matching apply()'s ability_target_id fallback.
//   - Casting an ability consumes the tick (no movement call that tick),
//     same as bot.js's maybeCast-first ordering.
//   - Cardinal MoveDirs (N..NW) are in the *aim-locked local frame*: apply()
//     resets facing to aim toward the resolved target right before turning
//     the direction into a world offset, so a fixed direction like E means
//     "strafe right relative to the target," not "walk toward world +X."
//     PathToTarget/PathAway are the pre-resolved pathfinding directions
//     (lead point 4 units toward/away from the target).
//
// Basic-attack fires via a direct world.resolveAttack(agent, targetId) call
// below, bypassing the native "basic_attack" Capability — that capability
// is BLOCKING (occupies the AgentBinding's single active-capability slot
// for the swing duration, preempting movement), which doesn't match what
// mcts.cpp's own CombatAction::apply() assumes: move, resolveAttack, and
// resolveAbility all happen independently in the same simulated step, none
// blocking the others. Calling world.resolveAttack directly sidesteps the
// capability system entirely so this stays consistent with what the search
// scored the action against.
import { AI } from "/app/ai.js";

export const ActionExec = (function () {
    "use strict";

    var MOVE_VECS = [
        { x: 0, z: 0 },                      // 0 Hold
        { x: 0, z: -1 },                      // 1 N
        { x: 0.70710678, z: -0.70710678 },    // 2 NE
        { x: 1, z: 0 },                       // 3 E
        { x: 0.70710678, z: 0.70710678 },     // 4 SE
        { x: 0, z: 1 },                       // 5 S
        { x: -0.70710678, z: 0.70710678 },    // 6 SW
        { x: -1, z: 0 },                      // 7 W
        { x: -0.70710678, z: -0.70710678 },   // 8 NW
    ];
    var PATH_TO_TARGET = 9, PATH_AWAY = 10;
    var LEAD = 4.0;

    function findById(list, id) {
        for (var i = 0; i < list.length; i++) {
            if (list[i].unit.id === id) return list[i];
        }
        return null;
    }

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

    // yaw=0 faces -Z, yaw increases toward +X (matches brogameagent's
    // aim_yaw_toward convention).
    function aimYawToward(fromX, fromZ, toX, toZ) {
        return Math.atan2(toX - fromX, -(toZ - fromZ));
    }

    // Apply CombatAction `action` to `self` (the bound AgentBinding proxy).
    // `world` is only used to build the action mask (attackSlot -> enemyId).
    function apply(self, world, action) {
        var agent = self.agent;
        var u = agent.unit;
        if (!u.alive) { self.hold(0.2); return; }

        var enemies = AI.shared.teams[1 - u.teamId] || [];

        var attackTargetId = -1;
        if (action.attackSlot >= 0) {
            var am = bro.ai.game.buildActionMask(agent, world);
            if (action.attackSlot < am.enemyIds.length) {
                attackTargetId = am.enemyIds[action.attackSlot];
            }
        }
        var abilityTargetId = attackTargetId;
        if (abilityTargetId < 0 && action.abilitySlot >= 0) {
            var near0 = nearestEnemy(agent, enemies);
            abilityTargetId = near0 ? near0.unit.id : -1;
        }

        // Fires independently of the cast/movement branches below — see
        // the file header. world.resolveAttack no-ops on cooldown/range
        // failure the same way the search's own rollouts would score it.
        if (attackTargetId >= 0) world.resolveAttack(agent, attackTargetId);

        // Ability autocast consumes the tick — no movement call below.
        if (action.abilitySlot >= 0 && abilityTargetId >= 0) {
            self.cast(action.abilitySlot, abilityTargetId);
            return;
        }

        // Movement. Aim-lock reference: attack target, else ability target,
        // else nearest enemy.
        var refId = attackTargetId >= 0 ? attackTargetId
                  : abilityTargetId >= 0 ? abilityTargetId : -1;
        var ref = refId >= 0 ? findById(enemies, refId) : null;
        if (!ref) ref = nearestEnemy(agent, enemies);

        if (action.moveDir === PATH_TO_TARGET || action.moveDir === PATH_AWAY) {
            if (!ref) { self.hold(0.2); return; }
            var dx = ref.x - agent.x, dz = ref.z - agent.z;
            var d = Math.hypot(dx, dz);
            if (d < 1e-3) { self.hold(0.2); return; }
            var sign = action.moveDir === PATH_AWAY ? -1 : 1;
            self.moveTo(agent.x + sign * (dx / d) * LEAD, agent.z + sign * (dz / d) * LEAD);
            return;
        }

        if (!action.moveDir || !ref) {
            // Hold, or nothing to aim-lock movement against.
            self.hold(0.2);
            return;
        }

        var yaw = aimYawToward(agent.x, agent.z, ref.x, ref.z);
        var mv = MOVE_VECS[action.moveDir] || MOVE_VECS[0];
        var wx = mv.x * Math.cos(yaw) - mv.z * Math.sin(yaw);
        var wz = mv.x * Math.sin(yaw) + mv.z * Math.cos(yaw);
        self.moveTo(agent.x + wx * LEAD, agent.z + wz * LEAD);
    }

    return { apply: apply };
})();
