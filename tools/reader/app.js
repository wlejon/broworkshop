// Reader — a local read-aloud app for the bro engine.
//
// Import documents (txt / md / html), keep a persistent library with reading
// positions, and have them narrated by a local TTS engine of your choice:
//   Kokoro    — word-accurate karaoke highlight from per-phoneme durations,
//               native speaking-rate control.
//   Qwen3-TTS — preset CustomVoice speakers, sentence-level highlight,
//               speed via playback rate.
// Sentences prefetch ahead of playback on the async synthesis path, so reading
// feels instant after the first sentence. Extras: whole-document WAV export,
// sleep timer, themes, per-document voice memory.
//
// Module map (all ESM under /app/lib/):
//   state.js      settings + theme + $ helpers
//   text.js       html/markdown stripping, paragraph/sentence segmentation
//   docs.js       library records + persistence + import (the test seam)
//   engine.js     weight discovery, Kokoro/Qwen residency, voices, GPU gate
//   player.js     playback controller: prefetch, timing, sleep, preview
//   reader.js     reader view: sentence/word highlight, auto-scroll, transport
//   library.js    library view: cards, import, resume, delete
//   exporter.js   WAV export background job
//   settingsui.js settings modal
import { $, settings, applyTheme } from "/app/lib/state.js";
import { loadLibrary, addDocument } from "/app/lib/docs.js";
import { onEngineChange } from "/app/lib/engine.js";
import * as player from "/app/lib/player.js";
import { initReader, openDocument, readerVisible, showLibraryView, updateBadge } from "/app/lib/reader.js";
import { initLibrary, renderLibrary, importPaths } from "/app/lib/library.js";
import { initExporter } from "/app/lib/exporter.js";
import { initSettings, showSettings } from "/app/lib/settingsui.js";
import { installSystemMenu } from "/lib/system-menu.js";

function init() {
  loadLibrary();
  initReader();
  initLibrary();
  initExporter();
  initSettings();
  applyTheme();
  renderLibrary();
  updateBadge();
  onEngineChange(updateBadge);

  $('#btn-settings') && installSystemMenu({
    file: [{ id: 'file.import', label: 'Import Document…', accel: 'Ctrl+O' }],
    view: [{ id: 'view.settings', label: 'Settings…' }],
    handlers: {
      'file.import': () => $('#btn-import').click(),
      'view.settings': () => showSettings(true),
    },
  });

  // ── keyboard shortcuts (reader view) ────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!readerVisible()) return;
    if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); player.toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); player.next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); player.prev(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); player.paragraphStart(); }
    else if (e.key === 'Escape') showLibraryView();
  });

  // ── drag-drop import (anywhere) ─────────────────────────────────────────────
  document.addEventListener('dragover', (e) => { e.preventDefault(); $('#drop-overlay').style.display = 'flex'; });
  document.addEventListener('dragleave', () => { $('#drop-overlay').style.display = 'none'; });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    $('#drop-overlay').style.display = 'none';
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    const paths = [];
    for (let i = 0; i < files.length; i++) {
      const p = files[i].path || files[i].name || '';
      if (p) paths.push(p);
    }
    if (!paths.length) return;
    const doc = importPaths(paths);
    if (doc && !readerVisible()) renderLibrary();
  });
}

init();

// ── test seam ─────────────────────────────────────────────────────────────────
// Headless tests inject documents programmatically (native dialogs are real
// blocking OS dialogs even headless) and reach the app's live module state.
globalThis.__reader = {
  addDocument: (title, text) => { const d = addDocument(title, text, ''); renderLibrary(); return d; },
  openDocument,
  renderLibrary,
  player,
};
