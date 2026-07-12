// ═══ shared state: settings, theme, tiny DOM helpers ═════════════════════════
import { Storage } from "/lib/storage.js";

export const $ = (s) => document.querySelector(s);
export const $$ = (s) => Array.from(document.querySelectorAll(s));

// App settings — persisted via the shared namespaced localStorage wrapper.
// Per-document overrides (engine/voice/speed) live on the library records; these
// are the defaults a fresh document starts from.
export const store = Storage.create('reader');
export const settings = store.load({
  theme: 'dark',            // 'dark' | 'light'
  fontSize: 19,             // reader text px
  engine: 'kokoro',         // 'kokoro' | 'qwen'
  kokoroVoice: 'af_heart',
  qwenSpeaker: '',          // '' → first preset once the model loads
  speed: 1.0,
  dataRoot: '',             // brosoundml weights root override ('' = auto-detect)
});
export function saveSettings() { store.save(); }

export function applyTheme() {
  document.body.classList.toggle('light', settings.theme === 'light');
  const t = $('#reader-text');
  if (t) t.style.fontSize = settings.fontSize + 'px';
}
