// state.js — app settings (the defaults a fresh document starts from) + theme.
// Per-document overrides (engine / voice / speed / position) live on the
// library records in docs.js.

import { prefStore } from "/lib/kit/prefs.js";

// Same localStorage key as before the kit port, so saved settings carry over.
export const prefs = prefStore('reader:settings', {
    theme: 'dark',            // 'dark' | 'light'
    fontSize: 19,             // reader text px
    engine: 'kokoro',         // 'kokoro' | 'qwen'
    kokoroVoice: 'af_heart',
    qwenSpeaker: '',          // '' -> first preset once the model loads
    speed: 1.0,
    dataRoot: '',             // brosoundml weights root override ('' = auto-detect)
});
export const settings = prefs.data;
export function saveSettings() { prefs.save(); }

export function applyTheme() {
    document.body.classList.toggle('light', settings.theme === 'light');
    const t = document.querySelector('#reader-text');
    if (t) t.style.fontSize = settings.fontSize + 'px';
}
