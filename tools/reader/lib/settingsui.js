// ═══ settings panel: theme, type size, defaults, data root ════════════════════
import { $, settings, saveSettings, applyTheme } from "/app/lib/state.js";
import { engines, paths, listKokoroVoices } from "/app/lib/engine.js";
import { updateBadge } from "/app/lib/reader.js";

export function initSettings() {
  $('#btn-settings').addEventListener('click', () => showSettings(true));
  $('#btn-settings-close').addEventListener('click', () => showSettings(false));

  $('#set-theme').addEventListener('change', () => {
    settings.theme = $('#set-theme').value;
    saveSettings(); applyTheme();
  });
  $('#set-fontsize').addEventListener('input', () => {
    settings.fontSize = parseInt($('#set-fontsize').value, 10) || 19;
    $('#set-fontsize-val').textContent = settings.fontSize + 'px';
    saveSettings(); applyTheme();
  });
  $('#set-engine').addEventListener('change', () => {
    settings.engine = $('#set-engine').value;
    saveSettings(); updateBadge();
  });
  $('#set-voice').addEventListener('change', () => {
    settings.kokoroVoice = $('#set-voice').value;
    saveSettings();
  });
  $('#set-speed').addEventListener('change', () => {
    settings.speed = parseFloat($('#set-speed').value) || 1;
    saveSettings();
  });
  $('#set-dataroot').addEventListener('change', () => {
    settings.dataRoot = $('#set-dataroot').value.trim();
    saveSettings();
    fill();   // re-detect + refresh the resolved-path hint
  });
  $('#btn-browse-root').addEventListener('click', () => {
    if (typeof showOpenFolderDialog !== 'function') return;
    const r = showOpenFolderDialog(settings.dataRoot || null);
    if (r && r.length) {
      settings.dataRoot = r[0].replace(/\\/g, '/');
      $('#set-dataroot').value = settings.dataRoot;
      saveSettings(); fill();
    }
  });
}

export function showSettings(on) {
  if (on) fill();
  $('#settings-modal').style.display = on ? 'flex' : 'none';
}

function fill() {
  $('#set-theme').value = settings.theme;
  $('#set-fontsize').value = String(settings.fontSize);
  $('#set-fontsize-val').textContent = settings.fontSize + 'px';
  $('#set-engine').value = settings.engine;
  $('#set-speed').value = String(settings.speed);
  $('#set-dataroot').value = settings.dataRoot;

  // default Kokoro voice — from the loaded model, else scanned off disk
  const p = paths();
  const voices = engines.kokoro.voices.length ? engines.kokoro.voices : listKokoroVoices(p.kokoro);
  const sel = $('#set-voice');
  sel.textContent = '';
  for (const v of (voices.length ? voices : [settings.kokoroVoice])) {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  }
  sel.value = settings.kokoroVoice;
  $('#set-paths').textContent = 'kokoro: ' + p.kokoro + '\nqwen: ' + p.qwen;
}
