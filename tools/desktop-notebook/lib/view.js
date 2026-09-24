// view.js — layout state: view mode, splitter, sidebar, zoom, theme, and the
// window controls (bro.window pin / minimize / maximize).

import { $, trackDrag } from "/lib/kit/dom.js";
import { prefs } from "./store.js";

export const THEMES = { dark: 'Dark Slate', light: 'Light Paper', sepia: 'Warm Sepia', obsidian: 'Obsidian Cyber' };
export const MODES = ['split', 'editor', 'preview'];
const ZOOM_MIN = 70, ZOOM_MAX = 180;

export function setViewMode(mode) {
    if (MODES.indexOf(mode) < 0) mode = 'split';
    const pane = $('#splitPane');
    pane.classList.toggle('mode-editor', mode === 'editor');
    pane.classList.toggle('mode-preview', mode === 'preview');
    for (const b of document.querySelectorAll('#viewModes [data-mode]')) b.classList.toggle('on', b.dataset.mode === mode);
    prefs.set({ viewMode: mode });
}

export function viewMode() {
    const pane = $('#splitPane');
    return pane.classList.contains('mode-editor') ? 'editor' : pane.classList.contains('mode-preview') ? 'preview' : 'split';
}

export function togglePreview() { setViewMode(viewMode() === 'editor' ? 'split' : 'editor'); }

export function toggleSidebar() { $('#sidebar').hidden = !$('#sidebar').hidden; }

export function setZoom(level) {
    level = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(level) || 100));
    $('#editorTextarea').style.fontSize = Math.round(14 * level / 100) + 'px';
    $('#lineGutter').style.fontSize = Math.round(14 * level / 100) + 'px';
    $('#previewPane').style.fontSize = Math.round(15 * level / 100) + 'px';
    $('#statusZoom').textContent = level + '%';
    prefs.set({ zoom: level });
}
export function zoomBy(delta) { setZoom(prefs.data.zoom + delta); }

export function setTheme(name) {
    if (!THEMES[name]) name = 'dark';
    for (const t in THEMES) document.body.classList.toggle('theme-' + t, t === name && t !== 'dark');
    $('#themeSelector').value = name;
    prefs.set({ theme: name });
}

/** Drag the handle between editor and preview (20%..80%). */
export function bindSplitter() {
    const pane = $('#splitPane');
    $('#splitHandle').addEventListener('mousedown', (e) => {
        e.preventDefault();
        trackDrag((ev) => {
            const r = pane.getBoundingClientRect();
            const pct = Math.max(20, Math.min(80, (ev.clientX - r.left) / r.width * 100));
            $('#editorPane').style.flex = '0 0 ' + pct + '%';
            $('#previewPane').style.flex = '1 1 0';
        });
    });
}

// ── window ───────────────────────────────────────────────────────────────────

const win = () => (typeof bro !== 'undefined' && bro.window) || null;

export function minimizeWindow() { const w = win(); if (w && w.minimize) w.minimize(); }

export function toggleMaximize() {
    const w = win();
    if (!w) return;
    if (w.state === 'maximized') w.restore(); else if (w.maximize) w.maximize();
}

let pinnedFallback = false;
/** Toggle always-on-top; returns the new state. */
export function togglePin() {
    const w = win();
    let on;
    if (w && typeof w.alwaysOnTop !== 'undefined') { on = !w.alwaysOnTop; w.alwaysOnTop = on; }
    else on = pinnedFallback = !pinnedFallback;
    $('#btnPinWindow').classList.toggle('on', on);
    return on;
}
