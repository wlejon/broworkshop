// settingsui.js — the settings dialog: theme, text size, default engine /
// voice / speed, and the TTS weights root.

import { $, h, clear } from "/lib/kit/dom.js";
import { bindControl } from "/lib/kit/params.js";
import { pickFolder } from "/lib/kit/ml.js";
import { settings, saveSettings, applyTheme } from "./state.js";
import { engines, paths, listKokoroVoices } from "./engine.js";
import { updateBadge } from "./reader.js";

export function initSettings() {
    $('#btn-settings').addEventListener('click', () => showSettings(true));
    $('#btn-settings-close').addEventListener('click', () => showSettings(false));
    const on = (id, fn) => $(id).addEventListener('change', () => { fn($(id).value); saveSettings(); });

    on('#set-theme', (v) => { settings.theme = v; applyTheme(); });
    on('#set-engine', (v) => { settings.engine = v; updateBadge(); });
    on('#set-voice', (v) => { settings.kokoroVoice = v; });
    on('#set-speed', (v) => { settings.speed = parseFloat(v) || 1; });
    on('#set-dataroot', (v) => { settings.dataRoot = v.trim(); fill(); });   // re-detect the paths
    bindControl('#set-fontsize', {
        out: '#set-fontsize-val', fmt: (v) => v + 'px',
        onChange: (v) => { settings.fontSize = Math.round(v) || 19; saveSettings(); applyTheme(); },
    });
    $('#btn-browse-root').addEventListener('click', () => {
        const r = pickFolder(settings.dataRoot);
        if (!r) return;
        settings.dataRoot = r.replace(/\\/g, '/');
        saveSettings();
        fill();
    });
}

export function showSettings(on) {
    if (on) fill();
    $('#settings-modal').hidden = !on;
}

function fill() {
    $('#set-theme').value = settings.theme;
    $('#set-fontsize').value = String(settings.fontSize);
    $('#set-fontsize-val').textContent = settings.fontSize + 'px';
    $('#set-engine').value = settings.engine;
    $('#set-speed').value = String(settings.speed);
    $('#set-dataroot').value = settings.dataRoot;

    // default Kokoro voice: from the loaded model, else scanned off disk
    const p = paths();
    const voices = engines.kokoro.voices.length ? engines.kokoro.voices : listKokoroVoices(p.kokoro);
    const sel = clear($('#set-voice'));
    for (const v of (voices.length ? voices : [settings.kokoroVoice])) sel.appendChild(h('option', { value: v }, v));
    sel.value = settings.kokoroVoice;
    $('#set-paths').textContent = 'kokoro: ' + p.kokoro + '\nqwen: ' + p.qwen;
}
