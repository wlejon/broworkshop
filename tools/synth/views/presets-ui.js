// ---------------------------------------------------------------------------
// Presets UI — the preset dropdown populate/save/load controls.
// ---------------------------------------------------------------------------

import { $, on } from "/std/dom.js";
import { Presets } from "/app/lib/presets.js";
import { Layers } from "/app/lib/layers.js";
import { refreshActive } from "/app/views/state.js";
import { rebuild } from "/app/views/layers-grid.js";

var presetSelect;

function populatePresets() {
    presetSelect.innerHTML = '';
    Presets.list().forEach(function(name) {
        var opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        presetSelect.appendChild(opt);
    });
}

export function initPresetsUI() {
    presetSelect = $('#preset-select');
    populatePresets();

    on(presetSelect, 'change', function() {
        // Re-init layer first, then load preset into it
        Layers.init();
        Presets.load(this.value);
        refreshActive();
        rebuild();
    });

    on($('#preset-save'), 'click', function() {
        var name = presetSelect.value;
        if (Presets.isFactory(name)) name = 'My ' + name;
        Presets.save(name);
        populatePresets();
        presetSelect.value = name;
    });
}
