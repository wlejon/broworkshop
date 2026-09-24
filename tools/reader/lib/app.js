// app.js — Reader's wiring: boot, views, keyboard shortcuts, drag-drop import.
// main.js calls start().

import { boot } from "/lib/kit/app.js";
import { $ } from "/lib/kit/dom.js";
import { applyTheme } from "./state.js";
import { loadLibrary } from "./docs.js";
import { onEngineChange } from "./engine.js";
import * as player from "./player.js";
import { initReader, readerVisible, showLibraryView, updateBadge } from "./reader.js";
import { initLibrary, renderLibrary, importAndShow, importViaDialog } from "./library.js";
import { initExporter } from "./exporter.js";
import { initSettings, showSettings } from "./settingsui.js";

// Reader-view keys; ignored while typing in a field.
const KEYS = {
    ' ': () => player.toggle(),
    Spacebar: () => player.toggle(),
    ArrowRight: () => player.next(),
    ArrowLeft: () => player.prev(),
    ArrowUp: () => player.paragraphStart(),
    Escape: () => showLibraryView(),
};

function bindKeys() {
    document.addEventListener('keydown', (e) => {
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !readerVisible()) return;
        const fn = KEYS[e.key];
        if (!fn) return;
        if (e.key !== 'Escape') e.preventDefault();
        fn();
    });
}

// Drop documents anywhere; they land in the library.
function bindDrop() {
    const overlay = $('#drop-overlay');
    document.addEventListener('dragover', (e) => { e.preventDefault(); overlay.hidden = false; });
    document.addEventListener('dragleave', () => { overlay.hidden = true; });
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        overlay.hidden = true;
        const files = (e.dataTransfer && e.dataTransfer.files) || [];
        const paths = [];
        for (let i = 0; i < files.length; i++) { const p = files[i].path || files[i].name || ''; if (p) paths.push(p); }
        if (paths.length) importAndShow(paths);
    });
}

export function start() {
    const { status } = boot({
        menu: {
            file: [{ id: 'file.import', label: 'Import Document…', accel: 'Ctrl+O' }],
            view: [{ id: 'view.settings', label: 'Settings…' }],
            handlers: { 'file.import': importViaDialog, 'view.settings': () => showSettings(true) },
        },
    });
    loadLibrary();
    initReader(status, renderLibrary);
    initLibrary(status);
    initExporter();
    initSettings();
    applyTheme();
    renderLibrary();
    updateBadge();
    onEngineChange(updateBadge);
    bindKeys();
    bindDrop();
}
