// controls.js — Button handlers + event-driven selector state. Controls
// read State.current each time a handler fires (not at bind time), so state
// object swaps from App.rebuild() propagate without rebinding.
import { Agents } from "/app/agents/registry.js";
import { Replay } from "/app/replay.js";
import { State } from "/app/state.js";
import { Fog } from "/app/fog.js";

export const Controls = {};
(function () {
    "use strict";

    // Populate the Red/Blue AI selectors from the Agents registry.
    // Called once at startup; selector options persist across rebuilds.
    Controls.populateSelectors = function (defaultRed, defaultBlue) {
        var selRed  = document.getElementById("sel-red-ai");
        var selBlue = document.getElementById("sel-blue-ai");
        var defs = Agents.all();
        [selRed, selBlue].forEach(function (sel) {
            while (sel.firstChild) sel.removeChild(sel.firstChild);
            for (var i = 0; i < defs.length; i++) {
                var opt = document.createElement("option");
                opt.value = defs[i].id;
                opt.textContent = defs[i].label;
                sel.appendChild(opt);
            }
        });
        if (defaultRed)  selRed.value  = defaultRed;
        if (defaultBlue) selBlue.value = defaultBlue;
    };

    // Shared by the Reset button and the system menu's New Match item, so
    // the two can never drift out of sync (each just calls this instead of
    // duplicating the close-recorder/rebuild/button-reset sequence).
    Controls.resetMatch = function (onReset) {
        var s = State.current;
        if (s && s.recording && s.recorder) s.recorder.close();
        onReset();
        var btnPause  = document.getElementById("btn-pause");
        var btnPlay   = document.getElementById("btn-play");
        var btnRecord = document.getElementById("btn-record");
        if (btnPause)  btnPause.textContent = "Pause";
        if (btnPlay)   { btnPlay.textContent = "Play"; btnPlay.classList.remove("active"); }
        if (btnRecord) { btnRecord.textContent = "Record"; btnRecord.classList.remove("active"); }
    };

    // Shared by the Pause button and the system menu's View > Pause checkbox
    // — keeps bro.menu's checked state and the button text/class in sync
    // regardless of which one the user clicked.
    Controls.togglePause = function () {
        var s = State.current;
        s.paused = !s.paused;
        var btn = document.getElementById("btn-pause");
        if (btn) btn.textContent = s.paused ? "Resume" : "Pause";
        if (typeof bro !== "undefined" && bro.menu) {
            bro.menu.updateItem("view.pause", { checked: s.paused });
        }
    };

    // Shared by the Fog button and the system menu's View > Fog of War
    // checkbox, same reasoning as togglePause above.
    Controls.toggleFog = function () {
        Fog.setEnabled(!Fog.isEnabled());
        var btn = document.getElementById("btn-fog");
        if (btn) {
            btn.textContent = Fog.isEnabled() ? "Fog On" : "Fog Off";
            btn.classList.toggle("active", Fog.isEnabled());
        }
        if (typeof bro !== "undefined" && bro.menu) {
            bro.menu.updateItem("view.fog", { checked: Fog.isEnabled() });
        }
    };

    Controls.bind = function (onReset) {
        var btnPause  = document.getElementById("btn-pause");
        var btnRewind = document.getElementById("btn-rewind");
        var btnRecord = document.getElementById("btn-record");
        var btnPlay   = document.getElementById("btn-play");
        var btnReset  = document.getElementById("btn-reset");
        var selRed    = document.getElementById("sel-red-ai");
        var selBlue   = document.getElementById("sel-blue-ai");
        var selFocus  = document.getElementById("sel-focus");
        var btnFog    = document.getElementById("btn-fog");
        var selFogTeam = document.getElementById("sel-fog-team");

        btnPause.addEventListener("click", Controls.togglePause);
        btnRewind.addEventListener("click", function () { Replay.rewind(State.current); });
        btnRecord.addEventListener("click", function () { Replay.toggleRecord(State.current, btnRecord); });
        btnPlay.addEventListener("click",   function () { Replay.togglePlay(State.current, btnPlay); });
        btnReset.addEventListener("click",  function () { Controls.resetMatch(onReset); });

        selRed.addEventListener("change",  function () { State.current.redAi  = selRed.value;  });
        selBlue.addEventListener("change", function () { State.current.blueAi = selBlue.value; });
        selFocus.addEventListener("change", function () { State.current.focusId = +selFocus.value; });

        Fog.setTeam(+selFogTeam.value);
        btnFog.addEventListener("click", Controls.toggleFog);
        selFogTeam.addEventListener("change", function () { Fog.setTeam(+selFogTeam.value); });
    };

    // Seed state from the current selector values. Called after rebuild
    // since the focus dropdown was just regenerated for the new roster.
    Controls.syncFromDom = function (state) {
        var r = document.getElementById("sel-red-ai");
        var b = document.getElementById("sel-blue-ai");
        var f = document.getElementById("sel-focus");
        if (r && r.value) state.redAi  = r.value;
        if (b && b.value) state.blueAi = b.value;
        if (f && f.value) state.focusId = +f.value;
    };
})();
