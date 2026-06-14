// ---------------------------------------------------------------------------
// Mic — toggle + signal-selection UI.
//
// Enabling the mic lazily creates the mic bus; double-enable selects the mic for
// sidebar editing (which bumps the reactive seam via Layers.onSelect).
// ---------------------------------------------------------------------------

import { $, on } from "/std/dom.js";
import { engine } from "/app/lib/synth-engine.js";
import { Layers } from "/app/lib/layers.js";

export function initMic() {
    on($('#mic-toggle'), 'click', async function() {
        if (!engine.hasMic()) {
            await engine.initMic();
            if (!engine.hasMic()) return;
            // Create mic bus on first enable
            Layers.initMicBus();
        }
        var enabled = !engine.isMicEnabled();
        engine.setMicEnabled(enabled);
        var btn = $('#mic-toggle');
        btn.classList.toggle('mic-on', enabled);
        btn.classList.toggle('mic-off', !enabled);

        // Double-click on active mic button selects mic for sidebar editing
        if (enabled && Layers.getMicSignal()) {
            Layers.selectMic();
        }
    });

    on($('#mic-volume'), 'input', function(e) {
        engine.setMicVolume(parseInt(e.target.value) / 100);
    });
}
