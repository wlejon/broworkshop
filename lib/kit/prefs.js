// lib/kit/prefs.js — one persisted JSON object per app, in localStorage.
//
//   import { prefStore } from "/lib/kit/prefs.js";
//   const prefs = prefStore('pixart-lab.v2', { steps: 20 });
//   prefs.data.steps;               // saved value, else the default
//   prefs.set({ steps: 30 });       // merge + save
//   prefs.data.prompt = 'x'; prefs.save();
//
// Storage failures are non-fatal (the data object still works in memory).
// Headless runs persist to the app's .storage.json like the windowed app, so
// a test that edits prefs should snapshot() first and restore() at the end.

export function prefStore(key, defaults) {
    const read = () => {
        try { return JSON.parse(window.localStorage.getItem(key) || '{}') || {}; }
        catch (_) { return {}; }
    };
    const data = Object.assign({}, defaults || {}, read());
    const api = {
        key,
        data,
        save() {
            try { window.localStorage.setItem(key, JSON.stringify(data)); } catch (_) {}
            return api;
        },
        /** Merge `patch` into data and save. */
        set(patch) { Object.assign(data, patch); return api.save(); },
        /** The raw stored string (null when absent), for tests to restore later. */
        snapshot() {
            try { return window.localStorage.getItem(key); } catch (_) { return null; }
        },
        restore(raw) {
            try {
                if (raw == null) window.localStorage.removeItem(key);
                else window.localStorage.setItem(key, raw);
            } catch (_) {}
        },
    };
    return api;
}
