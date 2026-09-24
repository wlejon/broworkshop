// lab.js — the live arena. A match (sim/match.js) is handed to the scene:
// attachAIWorld ticks the world at 60 Hz and each unit capsule carries an
// AgentBinding whose think() routes to the agent selected for its team
// (Agents.thinkFor). The frame loop here is thin: refresh the shared AI view,
// run team planners, drain damage events into the log / FX / threat
// tracker, keep the rewind ring and any recording, then redraw the overlays
// and pump the HUD.
//
// Tests and tools import this module (never main.js) and drive `lab`.
import { Config } from "/app/config.js";
import { Scenarios } from "/app/sim/scenarios.js";
import { Arena } from "/app/sim/arena.js";
import { AI } from "/app/sim/ai.js";
import { newMatch } from "/app/sim/match.js";
import { Agents } from "/app/agents/index.js";
import { initStage, buildStage, updateStage, renderReplayFrame, resetCamera, stage, UNIT_Y } from "/app/view/stage.js";
import { initFx, updateFx, hideFx, clearFx, addDamageNumber, addExplosion } from "/app/view/fx.js";
import { fog } from "/app/view/fog.js";
import { initHud, resetHud, tickHud, accumulateRewards, hud, setFocusOption } from "/app/view/hud.js";
import * as replay from "/app/replay.js";

// Every capability any registered agent uses. One superset list keeps
// hot-swapping the Red/Blue selectors safe: a capability an agent never
// calls is inert. "basic_attack" and "battle_cry" (registered by
// agents/capability_scripted.js) serve capability_scripted; the rest route
// execution through sim/bot.js.
const CAPS = ["move_to", "basic_attack", "cast_ability", "flee", "hold", "battle_cry"];

let state = null;
let paused = false;
const listeners = [];

export const lab = {
    get state() { return state; },
    get paused() { return paused; },
    get scenario() { return state ? state.scenario : null; },
    stage,
    hud,
    fog,

    /** Called after anything the controls mirror changes (pause, fog, recording, scenario). */
    onChange(fn) { listeners.push(fn); },

    start,
    setScenario,
    reset: () => setScenario(state.scenario),
    setAi(teamId, id) {
        if (!Agents.get(id)) throw new Error("unknown agent " + id);
        if (teamId === 0) state.redAi = id; else state.blueAi = id;
        changed();
    },
    setFocus(id) {
        state.focusId = id;
        setFocusOption(id);
    },
    setPaused,
    togglePause: () => setPaused(!paused),
    setFog(on) { fog.enabled = on; changed(); },
    setFogTeam(t) { fog.team = t; changed(); },
    resetCamera,
    rewind() {
        const t = replay.rewind(state);
        hud.log(t == null ? "rewind: no snapshot yet" : "rewound to t=" + t.toFixed(1) + "s", "kill");
    },
    toggleRecord() {
        if (replay.isRecording(state)) {
            hud.log("recording stopped (" + replay.stopRecording(state) + " frames)", "kill");
        } else {
            hud.log("recording -> " + replay.startRecording(state), "kill");
        }
        changed();
    },
    /** Play `path` (default: the last recording), or stop the playback running. */
    togglePlay(path) {
        if (replay.isPlaying(state)) { stopPlayback("replay stopped"); return; }
        const n = replay.startPlayback(state, path);
        detach();         // freeze the live match underneath
        unbindAgents();   // and let the replay own the capsules
        hideFx();
        hud.log("playing replay - " + n + " frames", "kill");
        changed();
    },
    recordingPath: () => replay.recordingPath(state),
    isRecording: () => replay.isRecording(state),
    isPlaying: () => replay.isPlaying(state),
};

function changed() { for (const fn of listeners) fn(lab); }

function start(canvas) {
    initStage(canvas, (id) => lab.setFocus(id), () => state);
    initFx(stage.scene);
    initHud();
    setScenario(Scenarios.ALL[0], { redAi: "scripted", blueAi: "scripted" });
    stage.vp.onFrame(frame);
}

// The world ticks only while attached; pause and replay playback detach it.
function attach() {
    stage.scene.attachAIWorld(state.world, { stepHz: 60, maxStepsPerFrame: Config.MAX_STEPS_PER_FRAME });
}
function detach() { stage.scene.detachAIWorld(); }

// The bindings write each capsule's transform every frame; playback has to
// take them off so the recorded positions stick.
function bindAgents() {
    for (const a of state.agents) {
        stage.unitNode(a.unit.id).attachAgent(state.world, a, {
            capabilities: CAPS, thinkHz: 30, faceMovement: true, yOffset: UNIT_Y,
            think: Agents.thinkFor,
        });
    }
}
function unbindAgents() {
    for (const a of state.agents) {
        const node = stage.unitNode(a.unit.id);
        if (node) node.detachAgent();
    }
}

/** Start a fresh match on `scenario` (object or id), keeping the selected agents. */
function setScenario(scenario, opts) {
    const scn = typeof scenario === "string" ? Scenarios.byId(scenario) : scenario;
    if (!scn) throw new Error("unknown scenario " + scenario);
    const o = opts || {};
    if (state) {
        if (replay.isRecording(state)) replay.stopRecording(state);
        detach();
        if (!replay.isPlaying(state)) unbindAgents();
    }
    const redAi = o.redAi || (state ? state.redAi : "scripted");
    const blueAi = o.blueAi || (state ? state.blueAi : "scripted");

    state = newMatch(scn, { redAi, blueAi });
    state.rewards = {};
    for (const a of state.agents) state.rewards[a.unit.id] = bro.ai.game.createRewardTracker(a, state.world);

    buildStage(scn);
    clearFx();
    fog.reset();
    attach();
    bindAgents();
    state.focusId = resetHud(scn.roster);
    paused = false;
    hud.log("arena built - " + state.agents.length + " agents (" + scn.name + ")");
    changed();
}

function setPaused(on) {
    if (!state || on === paused || replay.isPlaying(state)) return;
    paused = !!on;
    if (paused) detach(); else attach();
    changed();
}

function stopPlayback(msg) {
    replay.stopPlayback(state);
    if (!paused) attach();
    bindAgents();
    hud.log(msg);
    changed();
}

function frame(dt) {
    if (!state) return;
    if (replay.isPlaying(state)) { playbackFrame(dt); return; }

    if (!paused) {
        AI.updateShared(state);
        // Team-level planners run before this frame's per-agent thinks.
        Agents.tickTeams(state, dt);
        state.elapsed += dt;
        state.simSteps = Math.round(state.elapsed * 60);
        // The recorder and the reward trackers read the event window, so
        // both go before the drain clears it.
        replay.recordTick(state);
        accumulateRewards(state);
        drainEvents();
        replay.snapshotTick(state, dt);
    }

    updateStage(state);
    updateFx(state, paused ? 0 : dt);
    // After updateStage, so a fogged enemy's hidden capsule stays hidden.
    fog.tick(state, paused ? 0 : dt);
    tickHud(state, dt);
}

// Damage since last frame -> log line, floating number, death blast, and
// the threat tracker scripted's cover logic reads.
function drainEvents() {
    const world = state.world;
    for (const ev of world.events) {
        const target = state.byId[ev.targetId];
        if (!target) continue;
        const attacker = state.byId[ev.attackerId];
        AI.recordDamage(ev.targetId, ev.attackerId, ev.amount, state.elapsed);
        hud.queueLog(state,
            (attacker ? Arena.nameOf(attacker.unit.id) : "?") + " -> " + Arena.nameOf(target.unit.id) +
            "  -" + Math.round(ev.amount) + (ev.killed ? "  +" : ""),
            ev.killed ? "kill" : attacker && attacker.unit.teamId === 0 ? "red" : "blue");
        addDamageNumber(target.x, target.z, ev.amount, ev.killed ? "#ffd24a" : "#ffffff");
        if (ev.killed) addExplosion(target.x, target.z, 1.2);
    }
    world.clearEvents();
}

function playbackFrame(dt) {
    const p = replay.playbackTick(state, dt);
    renderReplayFrame(p.frame, state.byId);
    lab.playback = p;
    if (p.done) stopPlayback("replay finished (" + p.count + " frames)");
}
