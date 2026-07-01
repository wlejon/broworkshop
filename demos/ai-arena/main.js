// main.js — Bootstrap. Scene graph drives the sim via attachAIWorld, each
// capsule node owns an agent binding that dispatches to the registered
// agent (Agents.thinkFor) per tick; the agent then issues a plan into
// Bot's queue and calls Bot.tick for execution. The rAF loop is thin:
// refresh shared AI state each frame, then pump HUD updates and drain
// damage events post-tick.
//
// The Red AI / Blue AI selectors pick which registered agent runs for
// each team's units — see agents/registry.js.
import { Config } from "/app/config.js";
import { State } from "/app/state.js";
import { Scenarios } from "/app/scenarios.js";
import { Arena } from "/app/arena.js";
import { AI } from "/app/ai.js";
import "/app/bot.js";
import "/app/options/tactical_options.js";
import { Agents } from "/app/agents/registry.js";
import "/app/agents/random.js";
import "/app/agents/scripted.js";
import "/app/agents/tactical.js";
import "/app/agents/options_shared.js";
import "/app/agents/options_mcts.js";
import "/app/agents/options_commander.js";
import "/app/agents/action_exec.js";
import "/app/agents/capability_scripted.js";
import "/app/agents/decoupled_mcts.js";
import "/app/agents/team_mcts.js";
import "/app/agents/layered_planner.js";
import "/app/agents/infoset_mcts.js";
import { ExitNet } from "/app/agents/exit_net.js";
import { Render } from "/app/render.js";
import { Scene3D } from "/app/scene_setup.js";
import { Fog } from "/app/fog.js";
import { UI } from "/app/ui.js";
import { Replay } from "/app/replay.js";
import { Loop } from "/app/loop.js";
import { Controls } from "/app/controls.js";
import { installSystemMenu } from "/lib/system-menu.js";

export const App = {};
(function () {
    "use strict";

    App.canvas = null;
    App.scenario = null;

    App.setScenario = function (scenario) {
        App.scenario = scenario;
        App.rebuild();
    };

    App.rebuild = function () {
        if (State.current && State.current.world) {
            Scene3D.scene.detachAIWorld();
            for (var di = 0; di < State.current.agents.length; di++) {
                var dn = Scene3D.units[State.current.agents[di].unit.id];
                if (dn) { try { dn.detachAgent(); } catch (e) {} }
            }
        }

        var built = Arena.build(App.scenario);
        Scene3D.build(App.scenario);

        var rewardTrackers = {};
        for (var i = 0; i < built.agents.length; i++) {
            var a = built.agents[i];
            rewardTrackers[a.unit.id] = bro.ai.game.createRewardTracker(a, built.world);
        }

        State.current = {
            nav: built.nav,
            world: built.world,
            agents: built.agents,
            byId: built.byId,
            rewards: rewardTrackers,
            snapshots: [],
            snapshotAccum: 0,
            redAi: "scripted",
            blueAi: "scripted",
            paused: false,
            focusId: -1,
            pendingLog: [],
            simSteps: 0,
            elapsed: 0,
            recorder: null,
            recording: false,
            replayReader: null,
            replayFrame: 0,
            replayPlaying: false,
            replayElapsed: 0,
            agentStats: null,
        };

        AI.memory = {};
        // Per-agent caches (MCTS handles, belief filters, etc.) reference the
        // outgoing world/roster — stale state here silently persisted across
        // Reset/scenario-switch until this call was added, since resetAll()
        // was previously only invoked by fast_eval.js's batch-eval harness.
        Agents.resetAll();
        Fog.reset();

        // Ensure shared state is populated before the first think() fires —
        // attachAIWorld/attachAgent immediately schedule a tick.
        AI.updateShared(State.current);

        Scene3D.scene.attachAIWorld(built.world, {
            stepHz: 60, maxStepsPerFrame: Config.MAX_STEPS_PER_FRAME,
        });

        // Bind each unit capsule to its agent with the scripted think().
        // Superset of every registered agent's needs — an enabled
        // capability that a given agent's think() never calls is inert, so
        // one shared list keeps hot-swapping the Red/Blue AI selector safe
        // regardless of which agent is picked. "basic_attack"/"battle_cry"
        // are for capability_scripted (see agents/capability_scripted.js);
        // everything else routes execution through bot.js instead.
        var CAPS = ["move_to", "basic_attack", "cast_ability", "flee", "hold",
                    "aimed_shot", "battle_cry"];
        for (var j = 0; j < built.agents.length; j++) {
            var ag = built.agents[j];
            var node = Scene3D.units[ag.unit.id];
            if (!node) continue;
            node.attachAgent(built.world, ag, {
                capabilities: CAPS,
                thinkHz: 30,
                faceMovement: true,
                yOffset: Scene3D.UNIT_Y,
                think: Agents.thinkFor,
            });
        }

        Render.clearFx();
        UI.rebuildRoster(Arena.ROSTER);
        Controls.syncFromDom(State.current);
        UI.rewardHistory = { red: [], blue: [] };
        UI.log("arena built - " + built.agents.length + " agents (" +
               App.scenario.name + ")", "");
        UI.setStatus("running");
    };

    var lastT = 0;
    function frame(now) {
        requestAnimationFrame(frame);
        var dt = (now - lastT) / 1000;
        lastT = now;
        if (dt > 0.1) dt = 0.1;

        var state = State.current;
        if (!state) return;

        if (state.replayPlaying && state.replayReader) {
            Replay.drawFrame(state, App.canvas, dt);
            return;
        }

        if (!state.paused) {
            AI.updateShared(state);
            // Team-level planners (portfolio search, influence maps) run
            // before per-agent think fires inside the scene AI tick.
            Agents.tickTeams(state, dt);
            state.elapsed += dt;
            state.simSteps = Math.round(state.elapsed / Config.SIM_STEP);
        }

        Loop.frame(state, App.canvas, dt);
    }

    // File/View content for the native system menu. Every handler here
    // reuses the exact same function the matching in-canvas control calls
    // (Controls.resetMatch/toggleFog/togglePause, Replay.toggleRecord/
    // togglePlay, App.setScenario) so the menu and the canvas UI can never
    // drift out of sync with each other.
    function setupSystemMenu() {
        var fs = require("fs");

        var scenarioItems = [];
        var scenarioHandlers = {};
        for (var i = 0; i < Scenarios.ALL.length; i++) {
            (function (scn) {
                var id = "view.scenario." + scn.id;
                scenarioItems.push({ id: id, label: scn.name });
                scenarioHandlers[id] = function () { App.setScenario(scn); };
            })(Scenarios.ALL[i]);
        }

        var handlers = {
            "file.newMatch": function () { Controls.resetMatch(App.rebuild); },
            "file.saveReplay": function () {
                var s = State.current;
                if (s.recording) Replay.toggleRecord(s, document.getElementById("btn-record"));
                if (!s._recordingPath) { UI.log("no replay to save - record one first"); return; }
                var dest = showSaveFileDialog("Replay Files|bgar", "arena-replay.bgar");
                if (!dest) return;
                fs.copyFileSync(s._recordingPath, dest);
                UI.log("replay saved -> " + dest, "log-kill");
            },
            "file.loadReplay": function () {
                var files = showOpenFileDialog("Replay Files|bgar");
                if (!files.length) return;
                var s = State.current;
                if (s.replayPlaying) Replay.stopPlaying(s, "replay stopped");
                s._recordingPath = files[0];
                Replay.togglePlay(s, document.getElementById("btn-play"));
            },
            "file.openCheckpoint": function () {
                var files = showOpenFileDialog("Checkpoint Files|bgnn");
                if (!files.length) return;
                var bytes = new Uint8Array(fs.readFileSync(files[0]));
                ExitNet.loadCheckpoint(bytes);
                UI.log("checkpoint loaded -> " + files[0], "log-kill");
            },
            "view.fog":         function () { Controls.toggleFog(); },
            "view.pause":       function () { Controls.togglePause(); },
            "view.resetCamera": function () { Scene3D.resetCamera(); },
        };
        for (var id2 in scenarioHandlers) handlers[id2] = scenarioHandlers[id2];

        installSystemMenu({
            file: [
                { id: "file.newMatch", label: "New Match", accel: "Ctrl+N" },
                { separator: true },
                { id: "file.saveReplay", label: "Save Replay As..." },
                { id: "file.loadReplay", label: "Load Replay..." },
                { separator: true },
                { id: "file.openCheckpoint", label: "Open Checkpoint..." },
            ],
            view: [
                { id: "view.scenario", label: "Scenario", items: scenarioItems },
                { id: "view.fog", label: "Fog of War", checked: Fog.isEnabled() },
                { id: "view.pause", label: "Pause", checked: false },
                { separator: true },
                { id: "view.resetCamera", label: "Reset Camera" },
            ],
            handlers: handlers,
        });
    }

    App.canvas = document.getElementById("arena");
    App.scenario = Scenarios.ALL[0];

    setupSystemMenu();
    UI.init();
    Scene3D.init(App.canvas);
    Controls.populateSelectors("scripted", "scripted");
    App.rebuild();
    Controls.bind(App.rebuild);

    // Debug hooks — expose state + scenario switching globally. Script-file
    // headless invocations run as plain classic scripts (no ES module
    // import), so this is the only bridge back into the app's module
    // graph; also doubles as the scenario-switch primitive Milestone 8's
    // system menu will call into.
    window.getState = function () { return State.current; };
    window.setScenario = function (id) {
        var scn = Scenarios.byId(id);
        if (!scn) { console.warn("setScenario: unknown id " + id); return; }
        App.setScenario(scn);
    };
    window.getScene = function () { return Scene3D; };
    window.getExitNet = function () { return ExitNet; };

    lastT = performance.now();
    requestAnimationFrame(frame);

    console.log("ai-arena started");
})();
