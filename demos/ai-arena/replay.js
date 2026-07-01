// replay.js — Record + playback state machine. Owned by the Record/Play
// buttons in controls.js; main.js consults state.replayPlaying each frame
// and delegates to Replay.drawFrame when true.
import { UI } from "/app/ui.js";
import { Config } from "/app/config.js";
import { Scene3D } from "/app/scene_setup.js";

export const Replay = {};
(function () {
    "use strict";

    // Shared by the manual Stop-Play click and the auto-stop-at-end-of-file
    // path in drawFrame — both need to reset the same button/state.
    Replay.stopPlaying = function (state, msg) {
        state.replayPlaying = false;
        state.replayReader = null;
        var btn = document.getElementById("btn-play");
        if (btn) { btn.textContent = "Play"; btn.classList.remove("active"); }
        UI.log(msg || "replay stopped");
    };

    // Advances playback by dt (real wall-clock frame time — playback runs at
    // the recording's fixed step rate regardless of how the match itself was
    // paced) and pushes the resulting frame onto the scene via
    // Scene3D.renderReplayFrame. state.byId still describes the current
    // roster (teamId/maxHp don't change across a session), so it's reused
    // as the static-data lookup the replay frame itself doesn't carry.
    Replay.drawFrame = function (state, canvas, dt) {
        var rr = state.replayReader;
        state.replayElapsed += dt;
        var idx = Math.floor(state.replayElapsed / Config.SIM_STEP);
        if (idx >= rr.frameCount) {
            idx = rr.frameCount - 1;
            state.replayFrame = idx;
            var f0 = rr.frame(idx);
            if (f0) Scene3D.renderReplayFrame(f0, state.byId);
            Replay.stopPlaying(state, "replay finished (" + rr.frameCount + " frames)");
            return;
        }
        state.replayFrame = idx;
        var f = rr.frame(idx);
        if (!f) { Replay.stopPlaying(state, "replay read failed at frame " + idx); return; }
        Scene3D.renderReplayFrame(f, state.byId);
        UI.setStatus("replay " + (idx + 1) + "/" + rr.frameCount +
                      "  t=" + f.elapsed.toFixed(2) + "s");
    };

    Replay.toggleRecord = function (state, btn) {
        if (!state.recording) {
            state.recorder = bro.ai.game.createRecorder();
            var path = Config.REPLAY_DIR + "arena-" + Date.now() + ".bgar";
            var ok = state.recorder.open(path, 1, Date.now(), Config.SIM_STEP);
            if (!ok) { UI.log("recorder open failed: " + path); return; }
            state.recorder.writeRoster(state.world);
            state.recording = true;
            btn.textContent = "Stop Rec";
            btn.classList.add("active");
            state._recordingPath = path;
            UI.log("recording -> " + path, "log-kill");
        } else {
            state.recorder.close();
            state.recording = false;
            btn.textContent = "Record";
            btn.classList.remove("active");
            UI.log("recording stopped (" + state.recorder.frameCount + " frames)", "log-kill");
        }
    };

    Replay.togglePlay = function (state, btn) {
        if (state.replayPlaying) {
            Replay.stopPlaying(state, "replay stopped");
            return;
        }
        var path = state._recordingPath;
        if (!path) { UI.log("no replay to play - record one first"); return; }
        var rr = bro.ai.game.createReplayReader();
        var ok = rr.open(path);
        if (!ok) { UI.log("replay open failed: " + rr.errorMessage); return; }
        state.replayReader = rr;
        state.replayFrame = 0;
        state.replayElapsed = 0;
        state.replayPlaying = true;
        btn.textContent = "Stop Play";
        btn.classList.add("active");
        UI.log("playing replay - " + rr.frameCount + " frames", "log-kill");
    };

    Replay.rewind = function (state) {
        if (!state.snapshots.length) { UI.log("rewind: no snapshot yet"); return; }
        // Pick a snapshot that is at least REWIND_SECONDS old; else oldest.
        var target = state.snapshots[0];
        for (var i = 0; i < state.snapshots.length; i++) {
            if (state.elapsed - state.snapshots[i].t >= Config.REWIND_SECONDS) {
                target = state.snapshots[i];
            }
        }
        state.world.restore(target.snap);
        UI.log("rewound to t=" + target.t.toFixed(1) + "s", "log-kill");
    };
})();
