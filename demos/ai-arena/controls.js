// controls.js — toolbar, system menu and status line over `lab`. Every
// control and its menu twin call the same lab function, and one sync()
// repaints both from lab state after any change, so they cannot drift.
import { boot, $, h, toggleButton } from "/lib/kit/index.js";
import { Scenarios } from "/app/sim/scenarios.js";
import { Agents, ExitNet } from "/app/agents/index.js";
import { Config } from "/app/config.js";
import { lab } from "/app/lab.js";

const fs = require("fs");

export function startControls() {
    const { status } = boot({ menu: menu() });
    const el = {
        scenario: $("#sel-scenario"), red: $("#sel-red-ai"), blue: $("#sel-blue-ai"),
        focus: $("#sel-focus"), fogTeam: $("#sel-fog-team"),
        record: $("#btn-record"), play: $("#btn-play"),
    };

    for (const s of Scenarios.ALL) el.scenario.appendChild(h("option", { value: s.id }, s.name));
    for (const sel of [el.red, el.blue]) {
        for (const d of Agents.all()) sel.appendChild(h("option", { value: d.id }, d.label));
    }

    const pause = toggleButton("#btn-pause", { labels: ["Pause", "Resume"], onChange: (on) => lab.setPaused(on) });
    const fogBtn = toggleButton("#btn-fog", { labels: ["Fog off", "Fog on"], onChange: (on) => lab.setFog(on) });

    el.scenario.addEventListener("change", () => lab.setScenario(el.scenario.value));
    el.red.addEventListener("change", () => lab.setAi(0, el.red.value));
    el.blue.addEventListener("change", () => lab.setAi(1, el.blue.value));
    el.focus.addEventListener("change", () => lab.setFocus(+el.focus.value));
    el.fogTeam.addEventListener("change", () => lab.setFogTeam(+el.fogTeam.value));
    $("#btn-rewind").addEventListener("click", () => lab.rewind());
    $("#btn-reset").addEventListener("click", () => lab.reset());
    el.record.addEventListener("click", () => guard(() => lab.toggleRecord()));
    el.play.addEventListener("click", () => guard(() => lab.togglePlay()));

    function guard(fn) {
        try { fn(); } catch (e) { lab.hud.log(e.message || String(e), "err"); }
    }

    function sync() {
        const s = lab.state;
        el.scenario.value = s.scenario.id;
        el.red.value = s.redAi;
        el.blue.value = s.blueAi;
        pause.on = lab.paused;
        fogBtn.on = lab.fog.enabled;
        el.fogTeam.value = String(lab.fog.team);
        el.record.textContent = lab.isRecording() ? "Stop rec" : "Record";
        el.record.classList.toggle("active", lab.isRecording());
        el.play.textContent = lab.isPlaying() ? "Stop play" : "Play";
        el.play.classList.toggle("active", lab.isPlaying());
        if (typeof bro !== "undefined" && bro.menu) {
            bro.menu.updateItem("view.pause", { checked: lab.paused });
            bro.menu.updateItem("view.fog", { checked: lab.fog.enabled });
        }
        showStatus();
    }
    lab.onChange(sync);

    function showStatus() {
        const s = lab.state;
        if (lab.isPlaying()) {
            const p = lab.playback;
            status.set(p ? "replay " + (p.index + 1) + "/" + p.count + "  t=" + p.frame.elapsed.toFixed(2) + "s" : "replay");
        } else if (lab.paused) status.warn("paused");
        else if (lab.isRecording()) status.set("recording  " + s.rec.recorder.frameCount + " frames");
        else status.set("running  t=" + s.elapsed.toFixed(1) + "s  steps=" + s.simSteps);
    }
    let acc = 0;
    return {
        sync,
        /** Per frame (after lab.start): refresh the status line at its cadence. */
        frame(dt) {
            acc += dt;
            if (acc < Config.STATUS_EVERY) return;
            acc = 0;
            showStatus();
        },
    };
}

// File / View menus. Handlers call the same lab functions as the toolbar.
function menu() {
    const scenarioItems = Scenarios.ALL.map((s) => ({ id: "view.scenario." + s.id, label: s.name }));
    const handlers = {
        "file.newMatch": () => lab.reset(),
        "file.saveReplay": saveReplay,
        "file.loadReplay": loadReplay,
        "file.openCheckpoint": openCheckpoint,
        "view.fog": () => lab.setFog(!lab.fog.enabled),
        "view.pause": () => lab.togglePause(),
        "view.resetCamera": () => lab.resetCamera(),
    };
    for (const s of Scenarios.ALL) handlers["view.scenario." + s.id] = () => lab.setScenario(s);
    return {
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
            { id: "view.fog", label: "Fog of War", checked: false },
            { id: "view.pause", label: "Pause", checked: false },
            { separator: true },
            { id: "view.resetCamera", label: "Reset Camera" },
        ],
        handlers,
    };
}

function saveReplay() {
    if (lab.isRecording()) lab.toggleRecord();
    const src = lab.recordingPath();
    if (!src) { lab.hud.log("no replay to save - record one first"); return; }
    const dest = showSaveFileDialog("Replay Files|bgar", "arena-replay.bgar");
    if (!dest) return;
    fs.copyFileSync(src, dest);
    lab.hud.log("replay saved -> " + dest, "kill");
}

function loadReplay() {
    const files = showOpenFileDialog("Replay Files|bgar");
    if (!files.length) return;
    try {
        if (lab.isPlaying()) lab.togglePlay();
        lab.togglePlay(files[0]);
    } catch (e) { lab.hud.log(e.message || String(e), "err"); }
}

function openCheckpoint() {
    if (!ExitNet.available()) { lab.hud.log("exit_net needs bro.ai.game.nn, which this build leaves out", "err"); return; }
    const files = showOpenFileDialog("Checkpoint Files|bgnn");
    if (!files.length) return;
    ExitNet.loadCheckpoint(new Uint8Array(fs.readFileSync(files[0])));
    lab.hud.log("checkpoint loaded -> " + files[0], "kill");
}
