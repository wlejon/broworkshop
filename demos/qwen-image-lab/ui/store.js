// Persisted UI state — one localStorage blob, versioned by key.
//
// Minted axes live under a key of their own. They are 4096 floats each and
// prefs are re-serialised on every committed control change; keeping 20 KB of
// direction out of that path is the difference between a slider drag costing
// nothing and costing a JSON round trip per frame.

const STORE_KEY = 'qwen-image-lab.v1';
const MINT_KEY = 'qwen-image-lab.mint.v1';

export function loadPrefs() {
  try { return JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}'); }
  catch (e) { return {}; }
}
export function savePrefs(p) {
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(p)); }
  catch (e) { /* storage unavailable — non-fatal */ }
}

export function loadMinted() {
  try {
    const v = JSON.parse(window.localStorage.getItem(MINT_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
export function saveMinted(list) {
  try { window.localStorage.setItem(MINT_KEY, JSON.stringify(list)); }
  catch (e) { /* storage unavailable — non-fatal */ }
}
