// sim/arena.js — World construction from a Scenario. Builds the nav grid,
// the world, agents with their ability slots wired, and registers ability
// resolvers against the world. Ability behavior is data-driven: each entry
// in scenario.abilities has a `kind` (projectile | grenade | heal-ally |
// basic-shot) and a parameter block.
import { Scenarios } from "/app/sim/scenarios.js";

export const Arena = {};
(function () {
    "use strict";

    // Stable ability ids (see scenarios.js).
    Arena.AB_HEAL     = Scenarios.AB_HEAL;
    Arena.AB_FIREBALL = Scenarios.AB_FIREBALL;
    Arena.AB_BEAM     = Scenarios.AB_BEAM;
    Arena.AB_GRENADE  = Scenarios.AB_GRENADE;
    Arena.AB_BASIC    = Scenarios.AB_BASIC;

    // Populated by Arena.build(scenario). Downstream modules read these
    // rather than the scenario object so swapping scenarios is a single
    // assignment point.
    Arena.scenario = null;
    Arena.BOUNDS = null;
    Arena.OBSTACLES = null;
    Arena.ROSTER = null;
    Arena.cooldownBySlot = {};   // ability slot -> cooldown seconds

    // Keep AI-picked destinations one unit inside the arena walls.
    var EDGE = 1;
    Arena.clampX = function (x) {
        var B = Arena.BOUNDS;
        return Math.max(B.minX + EDGE, Math.min(B.maxX - EDGE, x));
    };
    Arena.clampZ = function (z) {
        var B = Arena.BOUNDS;
        return Math.max(B.minZ + EDGE, Math.min(B.maxZ - EDGE, z));
    };

    function spawnStraight(caster, tgt, p) {
        var dx = tgt.x - caster.x, dz = tgt.z - caster.z;
        var d = Math.hypot(dx, dz) || 1;
        var out = {
            ownerId: caster.unit.id,
            teamId:  caster.unit.teamId,
            targetId: -1,
            x: caster.x, z: caster.z,
            vx: (dx / d) * p.speed,
            vz: (dz / d) * p.speed,
            speed: p.speed,
            radius: p.radius,
            damage: p.damage,
            remainingLife: p.life || 1.2,
            kind: p.kind,
            mode: p.mode,
        };
        if (p.maxHits) out.maxHits = p.maxHits;
        return out;
    }

    // A basic shot along unit direction (fx, fz), spawned just outside the
    // caster's radius. Shared by the basic-shot ability and the reflex
    // shooters (bot.js, agents/tactical.js) so all of them fire the same
    // projectile.
    function basicShot(caster, fx, fz, p) {
        var u = caster.unit;
        return {
            ownerId: u.id,
            teamId:  u.teamId,
            x: caster.x + fx * (u.radius + 0.4),
            z: caster.z + fz * (u.radius + 0.4),
            vx: fx * p.speed,
            vz: fz * p.speed,
            speed:  p.speed,
            radius: p.radius,
            damage: p.damage,
            remainingLife: p.life,
            kind: p.kind,
            mode: p.mode,
        };
    }

    Arena.spawnBasicShot = function (world, caster, fx, fz) {
        world.spawnProjectile(basicShot(caster, fx, fz, Arena.basicShotParams));
    };

    function registerProjectileAbility(world, ab) {
        var p = ab.projectile;
        world.registerAbility(ab.id, {
            cooldown: ab.cooldown, manaCost: ab.manaCost, range: ab.range,
            fn: function (caster, w, targetId) {
                var tgt = w.findById(targetId);
                if (!tgt) return;
                w.spawnProjectile(spawnStraight(caster, tgt, p));
            },
        });
    }

    function registerGrenadeAbility(world, ab) {
        var p = ab.projectile;
        world.registerAbility(ab.id, {
            cooldown: ab.cooldown, manaCost: ab.manaCost, range: ab.range,
            fn: function (caster, w, targetId) {
                var tgt = w.findById(targetId);
                if (!tgt) return;
                var d = Math.hypot(tgt.x - caster.x, tgt.z - caster.z) || 1;
                var spawn = spawnStraight(caster, tgt, p);
                // Grenade life is tuned so it detonates on the target —
                // derived from travel distance, not a fixed lifetime.
                spawn.remainingLife = Math.min(2.0, d / p.speed + 0.05);
                spawn.splashRadius = p.splashRadius;
                w.spawnProjectile(spawn);
            },
        });
    }

    function registerHealAbility(world, ab) {
        var range2 = ab.range * ab.range;
        world.registerAbility(ab.id, {
            cooldown: ab.cooldown, manaCost: ab.manaCost, range: ab.range,
            fn: function (caster, w, targetId) {
                var tgt = caster;
                if (targetId !== caster.unit.id) {
                    var found = w.findById(targetId);
                    if (found && found.unit.alive &&
                        found.unit.teamId === caster.unit.teamId) {
                        var dx = found.x - caster.x;
                        var dz = found.z - caster.z;
                        if (dx * dx + dz * dz <= range2) tgt = found;
                    }
                }
                tgt.unit.hp = Math.min(tgt.unit.maxHp, tgt.unit.hp + ab.amount);
            },
        });
    }

    // Basic shot: fires along a snapshot-safe direction so MCTS rollouts
    // produce the same projectile physics as live play. Direction priority:
    //   1. targetId (if valid) — aim directly at that unit.
    //   2. caster.aimYaw (world-state, snapshotted with the Agent).
    // Intentionally avoids any JS-side BotAim / AI.memory lookup so the fn
    // is equally correct when invoked from live `self.cast` AND from
    // `mcts::apply` inside the search tree's cloned world. BotAim remains
    // the reflex-robot's turn-rate governor, writing its filtered yaw back
    // to agent.aimYaw each tick — that keeps live firing feel unchanged
    // while making the ability snapshot-safe.
    function registerBasicShotAbility(world, ab) {
        var p = ab.projectile;
        world.registerAbility(ab.id, {
            cooldown: ab.cooldown, manaCost: ab.manaCost, range: ab.range,
            fn: function (caster, w, targetId) {
                var yaw = caster.aimYaw || 0;
                if (targetId !== undefined && targetId >= 0) {
                    var t = w.findById(targetId);
                    if (t) yaw = Math.atan2(t.x - caster.x, -(t.z - caster.z));
                }
                w.spawnProjectile(basicShot(caster, Math.sin(yaw), -Math.cos(yaw), p));
            },
        });
    }

    var REGISTRARS = {
        "projectile": registerProjectileAbility,
        "grenade":    registerGrenadeAbility,
        "heal-ally":  registerHealAbility,
        "basic-shot": registerBasicShotAbility,
    };

    Arena.build = function (scenario) {
        Arena.scenario = scenario;
        Arena.BOUNDS = scenario.bounds;
        Arena.OBSTACLES = scenario.obstacles;
        Arena.ROSTER = scenario.roster;
        Arena.cooldownBySlot = {};
        Arena.basicShotParams = null;
        for (var a = 0; a < scenario.abilities.length; a++) {
            var ab = scenario.abilities[a];
            Arena.cooldownBySlot[ab.slot] = ab.cooldown;
            if (ab.kind === "basic-shot") Arena.basicShotParams = ab.projectile;
        }
        if (!Arena.basicShotParams) throw new Error("scenario " + scenario.id + " has no basic-shot ability");

        var B = scenario.bounds;
        var nav = bro.ai.game.createNavGrid({
            minX: B.minX, minZ: B.minZ, maxX: B.maxX, maxZ: B.maxZ,
            cellSize: scenario.navCell,
            obstacles: scenario.obstacles,
            padding: scenario.navPadding,
        });

        var world = bro.ai.game.createWorld();
        for (var i = 0; i < scenario.obstacles.length; i++) {
            world.addObstacle(scenario.obstacles[i]);
        }

        var ud = scenario.unitDefaults;
        var byId = {};
        var agents = [];
        for (var j = 0; j < scenario.roster.length; j++) {
            var r = scenario.roster[j];
            var agent = bro.ai.game.createAgent({
                navGrid: nav,
                x: r.x, z: r.z,
                speed: ud.speed,
                radius: ud.radius,
                id: r.id,
                teamId: r.teamId,
                hp: ud.hp,
                damage: ud.damage,
                attackRange: ud.attackRange,
            });
            var u = agent.unit;
            u.maxMana = ud.maxMana;
            u.mana = ud.mana;
            u.manaRegenPerSec = ud.manaRegenPerSec;
            u.attacksPerSec = ud.attacksPerSec;
            u.armor = ud.armor;
            // Wire this unit's ability slots — without this every cast
            // silently fails (abilitySlot defaults to -1).
            for (var s = 0; s < scenario.abilities.length; s++) {
                u.setAbilitySlot(scenario.abilities[s].slot, scenario.abilities[s].id);
            }
            world.addAgent(agent);
            agents.push(agent);
            byId[r.id] = agent;
        }

        for (var k = 0; k < scenario.abilities.length; k++) {
            var abk = scenario.abilities[k];
            var reg = REGISTRARS[abk.kind];
            if (!reg) throw new Error("ai-arena: unknown ability kind: " + abk.kind);
            reg(world, abk);
        }

        return { nav: nav, world: world, agents: agents, byId: byId };
    };

    /** Roster display name for a unit id. */
    Arena.nameOf = function (id) {
        var R = Arena.ROSTER || [];
        for (var i = 0; i < R.length; i++) if (R[i].id === id) return R[i].name;
        return "?";
    };
})();
