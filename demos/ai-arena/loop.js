// loop.js — per-rAF HUD pump + event drain. The sim is auto-ticked by
// Scene3D.scene.attachAIWorld, and each unit's decision loop runs inside
// its AgentBinding via the registered agent's think() (which routes
// execution through Bot.tick). Everything here runs on the render frame.
import { Arena } from "/app/arena.js";
import { AI } from "/app/ai.js";
import { Render } from "/app/render.js";
import { Scene3D } from "/app/scene_setup.js";
import { UI } from "/app/ui.js";
import { Config } from "/app/config.js";
import { Agents } from "/app/agents/registry.js";
import { Panels } from "/app/ui_registry.js";

export const Loop = {};
(function () {
    "use strict";

    function rosterName(id) {
        var R = Arena.ROSTER;
        for (var i = 0; i < R.length; i++) if (R[i].id === id) return R[i].name;
        return "?";
    }

    // Drain damage events that accumulated since the previous frame into the
    // log + FX layer + AI threat tracker. Called once per render frame; events
    // may span multiple ticks when the scene catches up from a stall.
    function drainEvents(state) {
        var evs = state.world.events;
        for (var e = 0; e < evs.length; e++) {
            var ev = evs[e];
            var attacker = state.byId[ev.attackerId];
            var target = state.byId[ev.targetId];
            if (!target) continue;
            AI.recordDamage(ev.targetId, ev.attackerId, ev.amount, state.elapsed);
            var aName = attacker ? rosterName(attacker.unit.id) : "?";
            var tName = rosterName(target.unit.id);
            var cls = attacker && attacker.unit.teamId === 0 ? "log-red" : "log-blue";
            var killMark = ev.killed ? "  +" : "";
            state.pendingLog.push({
                text: aName + " -> " + tName + "  -" + Math.round(ev.amount) + killMark,
                cls: ev.killed ? "log-kill" : cls,
            });
            Render.addDamageNumber(target.x, target.z, ev.amount,
                ev.killed ? "#ffd24a" : "#ffffff");
            if (ev.killed) Render.addExplosion(target.x, target.z, 1.2);
        }
        state.world.clearEvents();
    }

    // Existing HUD panels, migrated onto the Panels registry (see
    // ui_registry.js) so new modes' panels don't need another hardcoded
    // block here — same throttle cadences as before (Config.*_HZ), same
    // update logic, just declared instead of inlined.
    Panels.register({
        id: "roster",
        throttleSec: Config.ROSTER_HZ,
        update: function (state) {
            UI.updateRoster(state.agents);
        },
    });

    Panels.register({
        id: "damageLog",
        throttleSec: Config.ROSTER_HZ,
        update: function (state) {
            if (!state.pendingLog.length) return;
            for (var pl = 0; pl < state.pendingLog.length; pl++) {
                UI.log(state.pendingLog[pl].text, state.pendingLog[pl].cls);
            }
            state.pendingLog.length = 0;
        },
    });

    Panels.register({
        id: "observationAndMask",
        throttleSec: Config.OBS_HZ,
        update: function (state) {
            var focus = state.byId[state.focusId];
            if (!focus) return;
            try {
                var obs = bro.ai.game.buildObservation(focus, state.world);
                UI.drawObservation(obs);
                var mask = bro.ai.game.buildActionMask(focus, state.world);
                UI.drawActionMask(mask.mask);
            } catch (e) { /* observation may throw if agent dead */ }
        },
    });

    Panels.register({
        id: "reward",
        throttleSec: Config.REWARD_HZ,
        update: function (state) {
            var redD = 0, blueD = 0;
            for (var ri = 0; ri < state.agents.length; ri++) {
                var ra = state.agents[ri];
                var tr = state.rewards[ra.unit.id];
                if (!tr) continue;
                var d = tr.consume(ra, state.world);
                var r = d.damageDealt - d.damageTaken + d.kills * 20 - d.deaths * 20;
                if (ra.unit.teamId === 0) redD += r; else blueD += r;
            }
            UI.pushReward(redD, blueD);
            UI.drawReward();
        },
    });

    Panels.register({
        id: "status",
        throttleSec: Config.STATUS_HZ,
        update: function (state) {
            UI.updateAgentStats(Agents.collectStats(state));
            if (state.paused) UI.setStatus("paused");
            else if (state.recording) UI.setStatus("recording  " + state.recorder.frameCount + " frames");
            else UI.setStatus("running  t=" + state.elapsed.toFixed(1) + "s  steps=" + state.simSteps);
        },
    });

    // Per-rAF render frame. Auto-tick handled by the scene; we just drain
    // events, maintain replay/recording, sync the 3D scene, and pump panels.
    Loop.frame = function (state, canvas, dt) {
        if (!state.paused) {
            drainEvents(state);

            state.snapshotAccum += dt;
            if (state.snapshotAccum >= Config.SNAPSHOT_INTERVAL) {
                state.snapshotAccum = 0;
                state.snapshots.push({ t: state.elapsed, snap: state.world.snapshot() });
                while (state.snapshots.length > Config.SNAPSHOT_KEEP) state.snapshots.shift();
            }
            if (state.recording && state.recorder) {
                state.recorder.recordFrame(state.simSteps, state.elapsed, state.world);
            }
        }

        Scene3D.update(state, dt);
        Render.tickFx(dt);

        Panels.tick(state, dt);
    };
})();
